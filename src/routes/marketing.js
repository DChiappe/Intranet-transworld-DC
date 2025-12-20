const express = require('express');
const multer = require('multer');
const db = require('../db'); // Conexión a Base de Datos MySQL
const cloudinary = require('../services/cloudinary');
const requireRole = require('../middlewares/requireRole'); // Importamos el mismo middleware de procesos

const router = express.Router();

// Definimos los roles permitidos para escritura (siguiendo el estilo de configuración de procesos.js)
const WRITE_ROLES = ['admin', 'marketing'];

// Configuración de multer: Memoria para no guardar archivos en disco (Railway/Render)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Función para crear slugs seguros
function createSlug(text) {
  return text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')     
    .replace(/[^\w\-]+/g, '') 
    .replace(/\-\-+/g, '-');  
}

// ==========================================
// RUTAS DE LECTURA (Acceso para todos los logueados)
// ==========================================

// Redireccionar raíz a eventos
router.get('/', (req, res) => {
  res.redirect('/marketing/eventos');
});

// Listar eventos
router.get('/eventos', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM eventos ORDER BY fecha_creacion DESC');
    res.render('marketing/eventos', { titulo: 'Eventos', eventos: rows });
  } catch (err) {
    console.error('Error cargando eventos:', err);
    res.status(500).send('Error al cargar eventos');
  }
});

// Ver detalle y galería
router.get('/eventos/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    // 1. Obtener info del evento desde BD
    const [rows] = await db.query('SELECT * FROM eventos WHERE slug = ?', [slug]);
    if (rows.length === 0) return res.status(404).send('Evento no encontrado');

    const evento = rows[0];

    // 2. Obtener imágenes desde Cloudinary
    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix: `eventos/${slug}/`,
      max_results: 100
    });

    const imagenes = result.resources.map(res => ({
      url: res.secure_url,
      public_id: res.public_id
    }));

    res.render('marketing/evento_detalle', {
      titulo: evento.nombre,
      evento,
      slug,
      imagenes
    });
  } catch (err) {
    console.error('Error cargando detalle:', err);
    res.status(500).send('Error al cargar el detalle del evento');
  }
});

// ==========================================
// RUTAS DE ESCRITURA (Protegidas con requireRole)
// ==========================================

// Formulario de creación
router.get('/eventos/nuevo', requireRole(...WRITE_ROLES), (req, res) => {
  res.render('marketing/eventos_nuevo', { 
    titulo: 'Crear Nuevo Evento', 
    error: null 
  });
});

// Procesar creación de evento (BD)
router.post('/eventos/nuevo', requireRole(...WRITE_ROLES), async (req, res) => {
  const { nombre, descripcion } = req.body;
  const slug = createSlug(nombre);

  try {
    await db.query('INSERT INTO eventos (nombre, slug, descripcion) VALUES (?, ?, ?)', 
      [nombre, slug, descripcion]);
    
    res.redirect('/marketing/eventos');
  } catch (err) {
    console.error('Error creando evento:', err);
    const errorMsg = err.code === 'ER_DUP_ENTRY' 
      ? 'Ya existe un evento con ese nombre.' 
      : 'Ocurrió un error al crear el evento.';
      
    res.render('marketing/eventos_nuevo', { 
      titulo: 'Crear Nuevo Evento', 
      error: errorMsg 
    });
  }
});

// Subir fotos (Cloudinary)
// Note: requireRole va antes que upload.array para bloquear antes de procesar archivos
router.post('/eventos/:slug/fotos', requireRole(...WRITE_ROLES), upload.array('fotos', 20), async (req, res) => {
  const { slug } = req.params;
  try {
    const promises = req.files.map(file => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: `eventos/${slug}` },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(file.buffer);
      });
    });

    await Promise.all(promises);
    res.redirect(`/marketing/eventos/${slug}`);
  } catch (err) {
    console.error('Error subiendo a Cloudinary:', err);
    res.status(500).send('Error al subir imágenes');
  }
});

// Eliminar foto individual
router.post('/eventos/:slug/fotos/eliminar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { public_id } = req.body;
  const { slug } = req.params;

  try {
    await cloudinary.uploader.destroy(public_id);
    res.redirect(`/marketing/eventos/${slug}`);
  } catch (err) {
    console.error('Error eliminando foto:', err);
    res.status(500).send('No se pudo eliminar la imagen.');
  }
});

// Eliminar Evento Completo
router.post('/eventos/:slug/eliminar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { slug } = req.params;
  try {
    await cloudinary.api.delete_resources_by_prefix(`eventos/${slug}/`);
    await db.query('DELETE FROM eventos WHERE slug = ?', [slug]);

    res.redirect('/marketing/eventos');
  } catch (err) {
    console.error('Error eliminando evento:', err);
    res.status(500).send('Error al eliminar el evento.');
  }
});

module.exports = router;
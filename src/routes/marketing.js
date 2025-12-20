// src/routes/marketing.js
const express = require('express');
const multer = require('multer');
const db = require('../db'); // Conexión a Base de Datos MySQL
const cloudinary = require('../services/cloudinary');
const requireRole = require('../middlewares/requireRole');

const router = express.Router();

// Configuración de multer: Memoria para no guardar archivos en disco (Railway/Render)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Función para crear slugs seguros (ej: "Paseo 2025" -> "paseo-2025")
function createSlug(text) {
  return text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')     
    .replace(/[^\w\-]+/g, '') 
    .replace(/\-\-+/g, '-');  
}

// ==========================================
// RUTAS PRINCIPALES
// ==========================================

// CORRECCIÓN: Redireccionar directo a la lista de eventos (saltamos el index)
router.get('/', (req, res) => {
  res.redirect('/marketing/eventos');
});

// GET /marketing/eventos - Listar eventos desde MySQL
router.get('/eventos', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM eventos ORDER BY fecha_creacion DESC');
    res.render('marketing/eventos', { titulo: 'Eventos', eventos: rows });
  } catch (err) {
    console.error('Error cargando eventos:', err);
    res.status(500).send('Error al cargar eventos');
  }
});

// GET /marketing/eventos/nuevo - Formulario de creación
router.get('/eventos/nuevo', requireRole('admin', 'marketing'), (req, res) => {
  res.render('marketing/eventos_nuevo', { 
    titulo: 'Crear Nuevo Evento', 
    error: null 
  });
});

// POST /marketing/eventos/nuevo - Guardar en BD
router.post('/eventos/nuevo', requireRole('admin', 'marketing'), async (req, res) => {
  const { nombre, descripcion } = req.body;
  const slug = createSlug(nombre);

  try {
    // Insertamos nombre, slug y descripción en MySQL
    await db.query('INSERT INTO eventos (nombre, slug, descripcion) VALUES (?, ?, ?)', 
      [nombre, slug, descripcion]);
    
    // Redirigimos al listado
    res.redirect('/marketing/eventos');
  } catch (err) {
    console.error('Error creando evento:', err);
    // Si el error es por nombre duplicado (ER_DUP_ENTRY)
    const errorMsg = err.code === 'ER_DUP_ENTRY' 
      ? 'Ya existe un evento con ese nombre (o slug idéntico).' 
      : 'Ocurrió un error al crear el evento.';
      
    res.render('marketing/eventos_nuevo', { 
      titulo: 'Crear Nuevo Evento', 
      error: errorMsg 
    });
  }
});

// ==========================================
// RUTAS DE DETALLE Y FOTOS (CLOUDINARY)
// ==========================================

// GET /marketing/eventos/:slug - Ver detalle y galería
router.get('/eventos/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    // 1. Obtener info del evento desde BD
    const [rows] = await db.query('SELECT * FROM eventos WHERE slug = ?', [slug]);
    if (rows.length === 0) return res.status(404).send('Evento no encontrado');

    const evento = rows[0];

    // 2. Obtener imágenes desde Cloudinary
    // Buscamos en la "carpeta" eventos/nombre-del-slug/
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
      evento,   // Pasamos el objeto completo (nombre, descripcion)
      slug,     // Mantenemos slug por compatibilidad si lo usas
      imagenes
    });
  } catch (err) {
    console.error('Error cargando detalle:', err);
    res.status(500).send('Error al cargar el detalle del evento');
  }
});

// POST Subir fotos
router.post('/eventos/:slug/fotos', requireRole('admin', 'marketing'), upload.array('fotos', 20), async (req, res) => {
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

// POST Eliminar foto
router.post('/eventos/:slug/fotos/eliminar', requireRole('admin', 'marketing'), async (req, res) => {
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

// POST Eliminar Evento Completo (BD + Todas las fotos)
router.post('/eventos/:slug/eliminar', requireRole('admin', 'marketing'), async (req, res) => {
  const { slug } = req.params;
  try {
    // 1. Borrar todas las fotos de esa carpeta en Cloudinary
    // Nota: delete_resources_by_prefix borra los archivos, pero la carpeta vacía podría quedar en Cloudinary (no afecta funcionalidad)
    await cloudinary.api.delete_resources_by_prefix(`eventos/${slug}/`);
    
    // 2. Borrar registro de la BD MySQL
    await db.query('DELETE FROM eventos WHERE slug = ?', [slug]);

    res.redirect('/marketing/eventos');
  } catch (err) {
    console.error('Error eliminando evento:', err);
    res.status(500).send('Error al eliminar el evento.');
  }
});

module.exports = router;
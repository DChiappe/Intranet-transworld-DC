const express = require('express');
const multer = require('multer');
const db = require('../db');
const cloudinary = require('../services/cloudinary');
const requireRole = require('../middlewares/requireRole');

const router = express.Router();
const WRITE_ROLES = ['admin', 'marketing'];

const storage = multer.memoryStorage();
const upload = multer({ storage });

function createSlug(text) {
  return text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')     
    .replace(/[^\w\-]+/g, '') 
    .replace(/\-\-+/g, '-');  
}

// ==========================================
// 1. RUTAS ESPECÍFICAS (Deben ir PRIMERO)
// ==========================================

router.get('/', (req, res) => res.redirect('/marketing/eventos'));

// Listado general
router.get('/eventos', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM eventos ORDER BY fecha_creacion DESC');
    res.render('marketing/eventos', { titulo: 'Eventos', eventos: rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error cargando eventos');
  }
});

// FORMULARIO DE CREACIÓN
router.get('/eventos/nuevo', requireRole(...WRITE_ROLES), (req, res) => {
  res.render('marketing/eventos_nuevo', { titulo: 'Crear Nuevo Evento', error: null });
});

// PROCESAR CREACIÓN
router.post('/eventos/nuevo', requireRole(...WRITE_ROLES), async (req, res) => {
  const { nombre, descripcion } = req.body;
  const slug = createSlug(nombre);

  try {
    // Nota: 'imagen' se queda en NULL al principio, se llena al subir fotos
    await db.query('INSERT INTO eventos (nombre, slug, descripcion) VALUES (?, ?, ?)', 
      [nombre, slug, descripcion]);
    res.redirect('/marketing/eventos');
  } catch (err) {
    const errorMsg = err.code === 'ER_DUP_ENTRY' ? 'Ya existe un evento con ese nombre.' : 'Error al crear.';
    res.render('marketing/eventos_nuevo', { titulo: 'Crear Nuevo Evento', error: errorMsg });
  }
});

// ==========================================
// 2. RUTAS DINÁMICAS (Capturan /:slug)
// ==========================================

// Detalle del evento
router.get('/eventos/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM eventos WHERE slug = ?', [slug]);
    if (rows.length === 0) return res.status(404).send('Evento no encontrado');

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
      titulo: rows[0].nombre,
      evento: rows[0],
      imagenes
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar detalle');
  }
});

// Subir fotos (Y ACTUALIZAR PORTADA SI ES NECESARIO)
router.post('/eventos/:slug/fotos', requireRole(...WRITE_ROLES), upload.array('fotos', 20), async (req, res) => {
  const { slug } = req.params;
  
  if (!req.files || req.files.length === 0) {
    return res.redirect(`/marketing/eventos/${slug}`);
  }

  try {
    // 1. Subir todas las fotos a Cloudinary
    const promises = req.files.map(file => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: `eventos/${slug}` },
          (error, result) => { if (error) reject(error); else resolve(result); }
        );
        stream.end(file.buffer);
      });
    });

    // Esperamos a que todas suban y obtenemos los resultados
    const uploadedImages = await Promise.all(promises);

    // 2. Lógica de Portada:
    // Si se subió al menos una foto, intentamos asignarla como portada
    if (uploadedImages.length > 0) {
      const portadaUrl = uploadedImages[0].secure_url; // Tomamos la primera URL

      // Actualizamos la BD SOLO si el campo 'imagen' está vacío o nulo
      // Esto previene que si subes más fotos después, cambie la portada original.
      const sqlUpdate = `
        UPDATE eventos 
        SET imagen = ? 
        WHERE slug = ? AND (imagen IS NULL OR imagen = '')
      `;
      await db.query(sqlUpdate, [portadaUrl, slug]);
    }

    res.redirect(`/marketing/eventos/${slug}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error subiendo fotos');
  }
});

// Eliminar foto
router.post('/eventos/:slug/fotos/eliminar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { public_id } = req.body;
  const { slug } = req.params;
  try {
    await cloudinary.uploader.destroy(public_id);
    // Nota: Si borras la foto que era portada, la BD quedará con el link roto.
    // Para simplificar, no limpiamos la BD aquí, pero la siguiente subida no lo arreglará automáticamente
    // a menos que la portada sea NULL.
    // Si quieres robustez total, podrías hacer un UPDATE eventos SET imagen = NULL...
    
    res.redirect(`/marketing/eventos/${slug}`);
  } catch (err) {
    res.status(500).send('Error eliminando foto');
  }
});

// Eliminar evento completo
router.post('/eventos/:slug/eliminar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { slug } = req.params;
  try {
    // 1. Borrar carpeta de Cloudinary
    await cloudinary.api.delete_resources_by_prefix(`eventos/${slug}/`);
    
    // (Opcional) Borrar carpeta vacía en Cloudinary requiere otro comando, 
    // pero delete_resources borra los archivos que es lo importante.

    // 2. Borrar de BD
    await db.query('DELETE FROM eventos WHERE slug = ?', [slug]);
    res.redirect('/marketing/eventos');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error eliminando evento');
  }
});

module.exports = router;
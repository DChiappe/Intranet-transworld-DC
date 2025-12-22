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
// 1. RUTAS ESPECÍFICAS
// ==========================================

router.get('/', (req, res) => res.redirect('/marketing/eventos'));

router.get('/eventos', async (req, res) => {
  try {
    // Obtenemos eventos. Nota: Ya no usamos la columna 'imagen' de la tabla eventos principal
    // para la portada, pero podrías hacer un LEFT JOIN si quisieras.
    const [rows] = await db.query('SELECT * FROM eventos ORDER BY fecha_creacion DESC');
    res.render('marketing/eventos', { titulo: 'Eventos', eventos: rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error cargando eventos');
  }
});

router.get('/eventos/nuevo', requireRole(...WRITE_ROLES), (req, res) => {
  res.render('marketing/eventos_nuevo', { titulo: 'Crear Nuevo Evento', error: null });
});

router.post('/eventos/nuevo', requireRole(...WRITE_ROLES), async (req, res) => {
  const { nombre, descripcion } = req.body;
  const slug = createSlug(nombre);

  try {
    await db.query('INSERT INTO eventos (nombre, slug, descripcion) VALUES (?, ?, ?)', 
      [nombre, slug, descripcion]);
    res.redirect('/marketing/eventos');
  } catch (err) {
    const errorMsg = err.code === 'ER_DUP_ENTRY' ? 'Ya existe un evento con ese nombre.' : 'Error al crear.';
    res.render('marketing/eventos_nuevo', { titulo: 'Crear Nuevo Evento', error: errorMsg });
  }
});

// ==========================================
// 2. RUTAS DINÁMICAS
// ==========================================

router.get('/eventos/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    // 1. Obtener datos del evento
    const [eventos] = await db.query('SELECT * FROM eventos WHERE slug = ?', [slug]);
    if (eventos.length === 0) return res.status(404).send('Evento no encontrado');
    const evento = eventos[0];

    // 2. Obtener fotos desde NUESTRA base de datos (Mucho más rápido que Cloudinary API)
    const [fotos] = await db.query('SELECT * FROM eventos_fotos WHERE evento_id = ? ORDER BY id DESC', [evento.id]);

    res.render('marketing/evento_detalle', {
      titulo: evento.nombre,
      evento: evento,
      imagenes: fotos // La vista espera un array con objetos que tengan .url y .public_id
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar detalle');
  }
});

router.post('/eventos/:slug/fotos', requireRole(...WRITE_ROLES), upload.array('fotos', 20), async (req, res) => {
  const { slug } = req.params;
  
  if (!req.files || req.files.length === 0) {
    return res.redirect(`/marketing/eventos/${slug}`);
  }

  try {
    // 1. Obtener ID del evento
    const [eventos] = await db.query('SELECT id FROM eventos WHERE slug = ?', [slug]);
    if (eventos.length === 0) return res.status(404).send('Evento no encontrado');
    const eventoId = eventos[0].id;

    // 2. Subir a Cloudinary
    const promises = req.files.map(file => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: `eventos/${slug}` },
          (error, result) => { if (error) reject(error); else resolve(result); }
        );
        stream.end(file.buffer);
      });
    });

    const uploadedImages = await Promise.all(promises);

    // 3. Guardar en Base de Datos (Tabla eventos_fotos)
    // Insertamos cada foto generada
    for (const img of uploadedImages) {
        await db.query(
            'INSERT INTO eventos_fotos (evento_id, url, public_id) VALUES (?, ?, ?)',
            [eventoId, img.secure_url, img.public_id]
        );
    }

    // (Opcional) Actualizar la columna 'imagen' antigua del evento para mantener compatibilidad 
    // con la vista de lista de carpetas, usando la última foto subida como portada.
    if (uploadedImages.length > 0) {
        await db.query('UPDATE eventos SET imagen = ? WHERE id = ?', [uploadedImages[0].secure_url, eventoId]);
    }

    res.redirect(`/marketing/eventos/${slug}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error subiendo fotos');
  }
});

router.post('/eventos/:slug/fotos/eliminar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { public_id } = req.body;
  const { slug } = req.params;
  try {
    // 1. Borrar de Cloudinary
    await cloudinary.uploader.destroy(public_id);

    // 2. Borrar de la tabla eventos_fotos
    await db.query('DELETE FROM eventos_fotos WHERE public_id = ?', [public_id]);
    
    res.redirect(`/marketing/eventos/${slug}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error eliminando foto');
  }
});

router.post('/eventos/:slug/eliminar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { slug } = req.params;
  try {
    await cloudinary.api.delete_resources_by_prefix(`eventos/${slug}/`);
    // Al borrar el evento, la restricción ON DELETE CASCADE de SQL borrará solas las fotos en eventos_fotos
    await db.query('DELETE FROM eventos WHERE slug = ?', [slug]);
    res.redirect('/marketing/eventos');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error eliminando evento');
  }
});

module.exports = router;
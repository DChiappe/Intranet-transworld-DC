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

router.post('/eventos/:slug/fotos', requireRole(...WRITE_ROLES), upload.array('fotos', 20), async (req, res) => {
  const { slug } = req.params;
  
  if (!req.files || req.files.length === 0) {
    return res.redirect(`/marketing/eventos/${slug}`);
  }

  try {
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

    // Si se subió algo y el evento NO tiene portada, ponemos la primera foto como portada
    if (uploadedImages.length > 0) {
      const portadaUrl = uploadedImages[0].secure_url;
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

// --- CORRECCIÓN IMPORTANTE AQUÍ ---
router.post('/eventos/:slug/fotos/eliminar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { public_id } = req.body;
  const { slug } = req.params;
  try {
    // 1. Borrar de Cloudinary
    await cloudinary.uploader.destroy(public_id);

    // 2. Obtener la portada actual de la BD
    const [rows] = await db.query('SELECT imagen FROM eventos WHERE slug = ?', [slug]);
    
    // 3. Si la portada actual contiene el public_id borrado, la reseteamos a NULL
    // (Así desaparece del Home y permite que la próxima subida sea la nueva portada)
    if (rows.length > 0 && rows[0].imagen && rows[0].imagen.includes(public_id)) {
        await db.query('UPDATE eventos SET imagen = NULL WHERE slug = ?', [slug]);
    }
    
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
    await db.query('DELETE FROM eventos WHERE slug = ?', [slug]);
    res.redirect('/marketing/eventos');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error eliminando evento');
  }
});

module.exports = router;
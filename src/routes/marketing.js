// src/routes/marketing.js
const express = require('express');
const multer = require('multer');
const cloudinary = require('../services/cloudinary');
const requireRole = require('../middlewares/requireRole');

const router = express.Router();

// Configuración de multer: Usamos memoria para no guardar nada local en Railway/Render
const storage = multer.memoryStorage();
const upload = multer({ storage });

/**
 * Función auxiliar para listar imágenes de un evento desde Cloudinary
 */
async function listarImagenesCloudinary(slug) {
  try {
    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix: `eventos/${slug}/`, 
      max_results: 100
    });
    return result.resources.map(res => ({
      url: res.secure_url,
      public_id: res.public_id
    }));
  } catch (err) {
    console.error('Error listando fotos de Cloudinary:', err);
    return [];
  }
}

// GET /marketing
router.get('/', (req, res) => {
  res.render('marketing/index', { titulo: 'Marketing y Eventos' });
});

// GET /marketing/eventos
// NOTA: Cloudinary no permite listar "carpetas" fácilmente sin Admin API.
// Se recomienda manejar los nombres de eventos en una tabla MySQL.
router.get('/eventos', (req, res) => {
  res.render('marketing/eventos', {
    titulo: 'Eventos',
    eventos: [] // Aquí deberías pasar los resultados de una consulta SQL a tu tabla de eventos
  });
});

// GET /marketing/eventos/:slug -> Galería del evento
router.get('/eventos/:slug', async (req, res) => {
  const { slug } = req.params;
  const imagenes = await listarImagenesCloudinary(slug);

  res.render('marketing/evento_detalle', {
    titulo: `Evento: ${slug}`,
    slug,
    imagenes
  });
});

// POST /marketing/eventos/:slug/fotos -> Subir fotos
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
    console.error('Error en subida masiva:', err);
    res.status(500).send('Error al subir imágenes a la nube.');
  }
});

// POST /marketing/eventos/:slug/fotos/eliminar -> Borrar foto
router.post('/eventos/:slug/fotos/eliminar', requireRole('admin', 'marketing'), async (req, res) => {
  const { public_id } = req.body; // El ID lo obtenemos del botón en la vista
  const { slug } = req.params;

  try {
    await cloudinary.uploader.destroy(public_id);
    res.redirect(`/marketing/eventos/${slug}`);
  } catch (err) {
    console.error('Error eliminando de Cloudinary:', err);
    res.status(500).send('No se pudo eliminar la imagen.');
  }
});

module.exports = router;
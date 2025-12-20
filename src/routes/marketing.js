// src/routes/marketing.js
const express = require('express');
const multer = require('multer');
const db = require('../db'); // Asegúrate de que la ruta a tu conexión DB sea correcta
const cloudinary = require('../services/cloudinary');
const requireRole = require('../middlewares/requireRole');

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Función para limpiar nombres y crear carpetas seguras
function createSlug(text) {
  return text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')     // Espacios por guiones
    .replace(/[^\w\-]+/g, '') // Quitar caracteres especiales
    .replace(/\-\-+/g, '-');  // Quitar guiones dobles
}

// Listar todos los eventos desde la DB
router.get('/eventos', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM eventos ORDER BY fecha_creacion DESC');
    res.render('marketing/eventos', { titulo: 'Eventos', eventos: rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar eventos');
  }
});

// Mostrar formulario de nuevo evento
router.get('/eventos/nuevo', requireRole('admin', 'marketing'), (req, res) => {
  res.render('marketing/eventos_nuevo', { titulo: 'Crear Nuevo Evento', error: null });
});

// Procesar la creación del evento en la DB
router.post('/eventos/nuevo', requireRole('admin', 'marketing'), async (req, res) => {
  const { nombre, descripcion } = req.body;
  const slug = createSlug(nombre);

  try {
    await db.query('INSERT INTO eventos (nombre, slug, descripcion) VALUES (?, ?, ?)', 
    [nombre, slug, descripcion]);
    res.redirect('/marketing/eventos');
  } catch (err) {
    const errorMsg = err.code === 'ER_DUP_ENTRY' ? 'Ya existe un evento con ese nombre.' : 'Error al crear el evento.';
    res.render('marketing/eventos_nuevo', { titulo: 'Crear Nuevo Evento', error: errorMsg });
  }
});

// Detalle del evento (Trae descripción de DB y fotos de Cloudinary)
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
    res.status(500).send('Error al cargar el detalle');
  }
});

// Eliminar evento (DB y fotos)
router.post('/eventos/:slug/eliminar', requireRole('admin', 'marketing'), async (req, res) => {
  const { slug } = req.params;
  try {
    // 1. Borrar de Cloudinary
    await cloudinary.api.delete_resources_by_prefix(`eventos/${slug}/`);
    // 2. Borrar de DB
    await db.query('DELETE FROM eventos WHERE slug = ?', [slug]);
    res.redirect('/marketing/eventos');
  } catch (err) {
    res.status(500).send('Error al eliminar');
  }
});

// Las rutas de subida de fotos (/eventos/:slug/fotos) se mantienen igual que antes
module.exports = router;
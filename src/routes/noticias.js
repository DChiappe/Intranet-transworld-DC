const express = require('express');
const router = express.Router();
const db = require('../db');
const cloudinary = require('../services/cloudinary'); // Importante para la firma
const requireRole = require('../middlewares/requireRole');

// Roles permitidos
const WRITE_ROLES = ['admin', 'marketing', 'rrhh'];

// 1. LISTADO
router.get('/', async (req, res) => {
  try {
    const [noticias] = await db.query('SELECT * FROM noticias ORDER BY fecha_creacion DESC');
    res.render('noticias/index', { titulo: 'Noticias', noticias });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error cargando noticias');
  }
});

// 2. FORMULARIO DE CREACIÓN
router.get('/crear', requireRole(...WRITE_ROLES), (req, res) => {
  res.render('noticias/crear', { titulo: 'Crear Noticia' });
});

// 3. RUTA DE FIRMA CLOUDINARY (Necesaria para subida directa)
router.get('/signature', requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder = 'noticias';
    const paramsToSign = { timestamp, folder };
    const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);
    res.json({
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      timestamp,
      signature,
      folder
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generando firma' });
  }
});

// 4. PROCESAR CREACIÓN (Recibe URLs y JSON, no archivos físicos)
router.post('/crear', requireRole(...WRITE_ROLES), async (req, res) => {
  // imagen_portada: String URL (puede venir vacío)
  // adjuntos_data: String JSON (Array de objetos)
  const { titulo, subtitulo, contenido, imagen_portada, adjuntos_data } = req.body;

  try {
    await db.query(
      'INSERT INTO noticias (titulo, subtitulo, contenido, imagen, adjuntos) VALUES (?, ?, ?, ?, ?)',
      [titulo, subtitulo, contenido, imagen_portada || null, adjuntos_data || '[]']
    );

    res.redirect('/noticias');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al crear la noticia');
  }
});

// 5. DETALLE
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM noticias WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).send('Noticia no encontrada');
    
    res.render('noticias/detalle', { titulo: rows[0].titulo, noticia: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error cargando noticia');
  }
});

// 6. ELIMINAR (Simplificado, idealmente borrarías también de Cloudinary usando los IDs guardados)
router.post('/eliminar/:id', requireRole(...WRITE_ROLES), async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM noticias WHERE id = ?', [id]);
    res.redirect('/noticias');
  } catch (err) { 
    console.error(err);
    res.status(500).send('Error eliminando noticia');
  }
});

module.exports = router;
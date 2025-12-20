// src/routes/docs.js
const express = require('express');
const cloudinary = require('../services/cloudinary');
const router = express.Router();

const ALLOWED_SECTIONS = new Set(['procedimientos', 'protocolos', 'achs', 'reglamento']);

// GET /docs/:section/:filename
router.get('/:section/:filename', async (req, res) => {
  const { section, filename } = req.params;
  
  if (!ALLOWED_SECTIONS.has(section)) {
    return res.status(404).send('Sección no encontrada');
  }

  // Construimos el ID que tendría en Cloudinary
  // Ejemplo: docs/procedimientos/manual_ventas
  const publicId = `docs/${section}/${filename.split('.')[0]}`;
  
  try {
    // Generamos una URL que fuerza la descarga (flags: attachment)
    const url = cloudinary.url(publicId, {
      resource_type: 'raw', 
      flags: "attachment",
      secure: true
    });
    
    res.redirect(url);
  } catch (err) {
    console.error('Error obteniendo documento:', err);
    res.status(404).send('El documento no se encuentra en la nube.');
  }
});

module.exports = router;
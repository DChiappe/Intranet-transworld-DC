const express = require('express');
const router = express.Router();
const db = require('../db');   

// GET /personas  → página principal + cumpleaños
router.get('/', async (req, res, next) => {
  const sql = `
    SELECT nombre, area, fecha_nacimiento
    FROM cumpleanios
    ORDER BY MONTH(fecha_nacimiento), DAY(fecha_nacimiento)
  `;

  try {
    const [results] = await db.query(sql);

    res.render('personas/index', {
      titulo: 'Personas y Cultura',
      personas: results
    });
  } catch (err) {
    console.error('Error consultando personas:', err);
    // puedes usar next(err) si tienes middleware de error global
    res.status(500).send('Error consultando personas');
  }
});

// GET /personas/organigrama
router.get('/organigrama', (req, res) => {
  res.render('personas/organigrama', {
    titulo: 'Organigrama'
  });
});

module.exports = router;

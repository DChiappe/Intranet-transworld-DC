const express = require('express');
const router = express.Router();
const db = require('../db');   

// GET /personas  → página principal + cumpleaños
router.get('/', (req, res) => {
  const sql = `
    SELECT nombre, area, fecha_nacimiento
    FROM cumpleanios
    ORDER BY MONTH(fecha_nacimiento), DAY(fecha_nacimiento)
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error consultando personas:', err);
      return res.status(500).send('Error consultando personas');
    }

    res.render('personas/index', {
      titulo: 'Personas y Cultura',
      personas: results
    });
  });
});

// GET /personas/organigrama
router.get('/organigrama', (req, res) => {
  res.render('personas/organigrama', {
    titulo: 'Organigrama'
  });
});

module.exports = router;

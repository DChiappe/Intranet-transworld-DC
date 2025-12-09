const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const usdHoy = 950.5; // por ahora fijo, luego lo puedes automatizar

  const hoy = new Date();
  const mes = hoy.getMonth() + 1; // 1-12
  const dia = hoy.getDate();      // 1-31

  const sql = `
    SELECT nombre, area, fecha_nacimiento
    FROM cumpleanios
    WHERE MONTH(fecha_nacimiento) = ? AND DAY(fecha_nacimiento) = ?
  `;

  db.query(sql, [mes, dia], (err, results) => {
    if (err) {
      console.error('Error consultando cumpleaños:', err);
      return res.status(500).send('Error consultando cumpleaños');
    }

    res.render('home', {
      titulo: 'Inicio',
      usdHoy,
      cumpleaniosHoy: results   // results es un array de filas
    });
  });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  const { valor: usdHoy } = await getUsdHoy()

  const hoy = new Date();
  const mes = hoy.getMonth() + 1; // 1-12
  const dia = hoy.getDate();      // 1-31

  const sql = `
    SELECT nombre, area, fecha_nacimiento
    FROM cumpleanios
    WHERE MONTH(fecha_nacimiento) = ? AND DAY(fecha_nacimiento) = ?
  `;

  try {
    const [results] = await db.query(sql, [mes, dia]);

    res.render('home', {
      titulo: 'Inicio',
      usdHoy,
      cumpleaniosHoy: results   // results es un array de filas
    });
  } catch (err) {
    console.error('Error consultando cumpleaños:', err);
    res.status(500).send('Error consultando cumpleaños');
  }
});

module.exports = router;

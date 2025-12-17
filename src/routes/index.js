const express = require('express');
const router = express.Router();
const db = require('../db');
const { getUsdHoy } = require('../services/usdService');

router.get('/', async (req, res) => {
  const { valor: usdHoy } = await getUsdHoy();

  const hoy = new Date();
  const mes = hoy.getMonth() + 1; // 1-12
  const diaHoy = hoy.getDate();

  // Nombre del mes en español (Chile)
  const mesNombreRaw = new Intl.DateTimeFormat('es-CL', { month: 'long' }).format(hoy);
  const mesNombre = mesNombreRaw.charAt(0).toUpperCase() + mesNombreRaw.slice(1);

  const sqlMes = `
    SELECT 
      nombre, 
      area, 
      DAY(fecha_nacimiento) AS dia
    FROM cumpleanios
    WHERE MONTH(fecha_nacimiento) = ?
    ORDER BY dia ASC, nombre ASC
  `;

  try {
    const [resultsMes] = await db.query(sqlMes, [mes]);

    res.render('home', {
      titulo: 'Inicio',
      usdHoy,
      mesNombre,
      diaHoy,
      cumpleaniosMes: resultsMes
    });
  } catch (err) {
    console.error('Error consultando cumpleaños del mes:', err);
    res.status(500).send('Error consultando cumpleaños');
  }
});

module.exports = router;

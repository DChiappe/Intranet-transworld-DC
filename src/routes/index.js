const express = require('express');
const router = express.Router();
const db = require('../db');
const { getUsdHoy } = require('../services/usdService');

router.get('/', async (req, res) => {
  try {
    const { valor: usdHoy, historico } = await getUsdHoy();

    const hoy = new Date();
    const mes = hoy.getMonth() + 1;
    const diaHoy = hoy.getDate();

    const mesNombreRaw = new Intl.DateTimeFormat('es-CL', { month: 'long' }).format(hoy);
    const mesNombre = mesNombreRaw.charAt(0).toUpperCase() + mesNombreRaw.slice(1);

    const sqlMes = `
      SELECT nombre, area, DAY(fecha_nacimiento) AS dia
      FROM cumpleanios
      WHERE MONTH(fecha_nacimiento) = ?
      ORDER BY dia ASC, nombre ASC
    `;

    const [resultsMes] = await db.query(sqlMes, [mes]);

    res.render('home', {
      titulo: 'Inicio',
      usdHoy,
      usdHistorico: historico,
      mesNombre,
      diaHoy,
      cumpleaniosMes: resultsMes
    });
  } catch (err) {
    console.error('Error en la home:', err);
    res.status(500).send('Error interno del servidor');
  }
});

module.exports = router;
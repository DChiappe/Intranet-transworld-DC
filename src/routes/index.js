const express = require('express');
const router = express.Router();
const db = require('../db');
const { getUsdHoy } = require('../services/usdService');

router.get('/', async (req, res) => {
  try {
    // 1. Obtener datos del dólar
    const { valor: usdHoy, historico } = await getUsdHoy();

    // 2. Calcular fechas
    const hoy = new Date();
    const mes = hoy.getMonth() + 1;
    const diaHoy = hoy.getDate();

    const mesNombreRaw = new Intl.DateTimeFormat('es-CL', { month: 'long' }).format(hoy);
    const mesNombre = mesNombreRaw.charAt(0).toUpperCase() + mesNombreRaw.slice(1);

    // 3. Obtener Cumpleaños del mes
    const sqlMes = `
      SELECT nombre, area, DAY(fecha_nacimiento) AS dia
      FROM cumpleanios
      WHERE MONTH(fecha_nacimiento) = ?
      ORDER BY dia ASC, nombre ASC
    `;
    const [resultsMes] = await db.query(sqlMes, [mes]);

    // 4. Obtener Eventos para el Carrusel (NUEVO)
    // Traemos los últimos 10 eventos que tengan imagen para rotarlos
    const sqlEventos = `
      SELECT * FROM eventos 
      WHERE imagen IS NOT NULL AND imagen != '' 
      ORDER BY id DESC LIMIT 10
    `;
    const [eventosRows] = await db.query(sqlEventos);

    // Mezclamos el array aleatoriamente para que el orden cambie en cada recarga
    const eventosCarousel = eventosRows.sort(() => Math.random() - 0.5);

    // 5. Renderizar vista
    res.render('home', {
      titulo: 'Inicio',
      usdHoy,
      usdHistorico: historico,
      mesNombre,
      diaHoy,
      cumpleaniosMes: resultsMes,
      eventosCarousel, // <--- Enviamos los eventos al EJS
      user: req.session.user
    });

  } catch (err) {
    console.error('Error en la home:', err);
    res.status(500).send('Error interno del servidor');
  }
});

module.exports = router;
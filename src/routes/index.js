const express = require('express');
const router = express.Router();
const db = require('../db');
const { getUsdHoy } = require('../services/usdService');

// ==========================================
// RUTA: HOME (INICIO)
// ==========================================
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

    // 4. CARRUSEL: Obtener TODAS las fotos de TODOS los eventos
    // Usamos la tabla nueva eventos_fotos
    const sqlEventos = `
      SELECT ef.url as imagen, e.nombre, e.slug
      FROM eventos_fotos ef
      JOIN eventos e ON ef.evento_id = e.id
      ORDER BY RAND() 
      LIMIT 30
    `;
    const [eventosRows] = await db.query(sqlEventos);

    // 5. Renderizar vista
    res.render('home', {
      titulo: 'Inicio',
      usdHoy,
      usdHistorico: historico,
      mesNombre,
      diaHoy,
      cumpleaniosMes: resultsMes,
      eventosCarousel: eventosRows, 
      user: req.session.user
    });

  } catch (err) {
    console.error('Error en la home:', err);
    res.status(500).send('Error interno del servidor');
  }
});

// ==========================================
// RUTA: PERFIL DE USUARIO
// ==========================================
router.get('/perfil', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');

    const id = req.session.user.id;
    
    // Consultamos datos frescos del usuario
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    
    if (rows.length === 0) return res.redirect('/');

    res.render('perfil', {
      titulo: 'Mi Perfil',
      usuario: rows[0]
    });

  } catch (err) {
    console.error('Error cargando perfil:', err);
    res.status(500).send('Error al cargar perfil');
  }
});

module.exports = router;
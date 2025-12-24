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

    const sqlMes = `SELECT nombre, area, DAY(fecha_nacimiento) AS dia FROM cumpleanios WHERE MONTH(fecha_nacimiento) = ? ORDER BY dia ASC, nombre ASC`;
    const [resultsMes] = await db.query(sqlMes, [mes]);

    // 1. OBTENER PORTADAS DE EVENTOS (Para las tarjetas pequeñas)
    // Buscamos eventos que tengan 'imagen' definida
    const sqlEventosPortada = `
      SELECT nombre, slug, imagen 
      FROM eventos 
      WHERE imagen IS NOT NULL AND imagen != '' 
      ORDER BY fecha_creacion DESC 
      LIMIT 8
    `;
    const [eventosPortadas] = await db.query(sqlEventosPortada);

    // 2. MIXED CAROUSEL (Noticias + Historial)
    const sqlNoticias = `SELECT id, titulo, subtitulo, imagen, fecha_creacion, 'noticia' as tipo FROM noticias WHERE imagen IS NOT NULL AND imagen != '' ORDER BY fecha_creacion DESC LIMIT 5`;
    const [noticiasRows] = await db.query(sqlNoticias);

    const sqlHistorial = `SELECT h.id, h.accion, h.seccion, h.enlace, h.fecha, u.first_name, u.last_name, 'historial' as tipo FROM historial_cambios h JOIN users u ON h.usuario_id = u.id ORDER BY h.fecha DESC LIMIT 5`;
    const [historialRows] = await db.query(sqlHistorial);

    let mixedFeed = [];
    noticiasRows.forEach(n => {
      mixedFeed.push({ id: n.id, tipo: 'noticia', titulo: n.titulo, subtitulo: n.subtitulo, imagen: n.imagen, link: `/noticias/${n.id}`, fecha: new Date(n.fecha_creacion) });
    });
    historialRows.forEach(h => {
      const nombreUsuario = `${h.first_name} ${h.last_name}`;
      let textoGenerado = (h.seccion === 'Organigrama') ? `${nombreUsuario} actualizó el organigrama` : `${nombreUsuario} ${h.accion} a ${h.seccion}`;
      mixedFeed.push({ id: h.id, tipo: 'historial', titulo: textoGenerado, subtitulo: 'Actividad reciente', imagen: '/img/fondo-cambio-hecho.png', link: h.enlace || '#', fecha: new Date(h.fecha) });
    });

    mixedFeed.sort((a, b) => b.fecha - a.fecha);
    mixedFeed = mixedFeed.slice(0, 10);

    res.render('home', {
      titulo: 'Inicio',
      usdHoy,
      usdHistorico: historico,
      mesNombre,
      diaHoy,
      cumpleaniosMes: resultsMes,
      eventosPortadas: eventosPortadas, // <--- Pasamos las portadas a la vista
      mixedCarousel: mixedFeed,
      user: req.session.user
    });

  } catch (err) {
    console.error('Error en la home:', err);
    res.status(500).send('Error interno del servidor');
  }
});

router.get('/perfil', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const id = req.session.user.id;
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    if (rows.length === 0) return res.redirect('/');
    res.render('perfil', { titulo: 'Mi Perfil', usuario: rows[0] });
  } catch (err) {
    console.error('Error perfil:', err);
    res.status(500).send('Error');
  }
});

module.exports = router;
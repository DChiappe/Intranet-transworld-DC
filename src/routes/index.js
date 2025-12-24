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

    // 2. Calcular fechas y cumpleaños
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

    // 3. CARRUSEL DE FONDO (Pantalla completa - Fotos aleatorias)
    const sqlEventos = `
      SELECT ef.url as imagen, e.nombre
      FROM eventos_fotos ef
      JOIN eventos e ON ef.evento_id = e.id
      ORDER BY RAND() LIMIT 30
    `;
    const [eventosRows] = await db.query(sqlEventos);

    // =========================================================
    // 4. CARRUSEL MIXTO (Noticias + Historial de Cambios)
    // =========================================================

    // A. Obtener Noticias (Últimas 5)
    const sqlNoticias = `
      SELECT id, titulo, subtitulo, imagen, fecha_creacion, 'noticia' as tipo 
      FROM noticias 
      WHERE imagen IS NOT NULL AND imagen != ''
      ORDER BY fecha_creacion DESC LIMIT 5
    `;
    const [noticiasRows] = await db.query(sqlNoticias);

    // B. Obtener Historial de Cambios (Últimos 5)
    // Unimos con la tabla 'users' para obtener el nombre real
    const sqlHistorial = `
      SELECT h.id, h.accion, h.seccion, h.enlace, h.fecha, 
             u.first_name, u.last_name, 'historial' as tipo
      FROM historial_cambios h
      JOIN users u ON h.usuario_id = u.id
      ORDER BY h.fecha DESC LIMIT 5
    `;
    const [historialRows] = await db.query(sqlHistorial);

    // C. Mezclar y normalizar datos
    let mixedFeed = [];

    // Procesar Noticias
    noticiasRows.forEach(n => {
      mixedFeed.push({
        id: n.id,
        tipo: 'noticia',
        titulo: n.titulo,
        subtitulo: n.subtitulo,
        imagen: n.imagen, // Foto real de la noticia
        link: `/noticias/${n.id}`,
        fecha: new Date(n.fecha_creacion)
      });
    });

    // Procesar Historial (Aquí armamos el texto solicitado)
    historialRows.forEach(h => {
      const nombreUsuario = `${h.first_name} ${h.last_name}`;
      
      // Texto: "(Nombre) (accion) a (seccion)"
      // Ej: "Juan Perez subió una foto a Galería de Eventos"
      const textoGenerado = `${nombreUsuario} ${h.accion} a ${h.seccion}`;

      mixedFeed.push({
        id: h.id,
        tipo: 'historial',
        titulo: textoGenerado, // Este texto saldrá grande y centrado
        subtitulo: 'Actividad reciente',
        imagen: '/img/fondo-cambio-hecho.png', // IMAGEN FIJA SOLICITADA
        link: h.enlace || '#', 
        fecha: new Date(h.fecha)
      });
    });

    // D. Ordenar por fecha (Más reciente primero) y limitar a 10
    mixedFeed.sort((a, b) => b.fecha - a.fecha);
    mixedFeed = mixedFeed.slice(0, 10);

    // 5. Renderizar vista
    res.render('home', {
      titulo: 'Inicio',
      usdHoy,
      usdHistorico: historico,
      mesNombre,
      diaHoy,
      cumpleaniosMes: resultsMes,
      eventosCarousel: eventosRows,
      mixedCarousel: mixedFeed, // <--- Lista mezclada
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
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    if (rows.length === 0) return res.redirect('/');

    res.render('perfil', { titulo: 'Mi Perfil', usuario: rows[0] });
  } catch (err) {
    console.error('Error cargando perfil:', err);
    res.status(500).send('Error al cargar perfil');
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const cloudinary = require('../services/cloudinary');
const { getUsdHoy } = require('../services/usdService');

// Configuración de subida en memoria
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ==========================================
// RUTA: HOME (INICIO)
// ==========================================
router.get('/', async (req, res) => {
  try {
    const { valor: usdHoy, historico } = await getUsdHoy();
    
    // --- LÓGICA TENDENCIA DÓLAR ---
    let tendencia = 'igual';
    // Asumiendo que 'historico' viene ordenado por fecha. 
    // Comparamos hoy con el último registro histórico disponible.
    if (historico && historico.length > 0) {
        // Tomamos el último valor del historial (ayer o el cierre anterior)
        const ultimoValor = historico[historico.length - 1].valor;
        if (usdHoy > ultimoValor) tendencia = 'alcista';
        else if (usdHoy < ultimoValor) tendencia = 'bajista';
    }
    // -----------------------------

    const hoy = new Date();
    const mes = hoy.getMonth() + 1;
    const diaHoy = hoy.getDate();
    const mesNombreRaw = new Intl.DateTimeFormat('es-CL', { month: 'long' }).format(hoy);
    const mesNombre = mesNombreRaw.charAt(0).toUpperCase() + mesNombreRaw.slice(1);

    const sqlMes = `SELECT nombre, area, DAY(fecha_nacimiento) AS dia FROM cumpleanios WHERE MONTH(fecha_nacimiento) = ? ORDER BY dia ASC, nombre ASC`;
    const [resultsMes] = await db.query(sqlMes, [mes]);

    // Carrusel eventos fondo (aunque ya no se usa visualmente en tu diseño nuevo, se mantiene la query por si acaso)
    const sqlEventos = `SELECT ef.url as imagen, e.nombre FROM eventos_fotos ef JOIN eventos e ON ef.evento_id = e.id ORDER BY RAND() LIMIT 30`;
    const [eventosRows] = await db.query(sqlEventos);

    const sqlNoticias = `SELECT id, titulo, imagen, subtitulo FROM noticias WHERE imagen IS NOT NULL AND imagen != '' ORDER BY fecha_creacion DESC LIMIT 5`;
    const [noticiasRows] = await db.query(sqlNoticias);
    
    const sqlEventosPortada = `SELECT nombre, slug, imagen FROM eventos WHERE imagen IS NOT NULL AND imagen != '' ORDER BY fecha_creacion DESC LIMIT 8`;
    const [eventosPortadas] = await db.query(sqlEventosPortada);

    const sqlHistorial = `SELECT h.id, h.accion, h.seccion, h.enlace, h.fecha, u.first_name, u.last_name, 'historial' as tipo FROM historial_cambios h JOIN users u ON h.usuario_id = u.id ORDER BY h.fecha DESC LIMIT 5`;
    const [historialRows] = await db.query(sqlHistorial);

    let mixedFeed = [];
    noticiasRows.forEach(n => mixedFeed.push({ id: n.id, tipo: 'noticia', titulo: n.titulo, subtitulo: n.subtitulo, imagen: n.imagen, link: `/noticias/${n.id}`, fecha: new Date() }));
    historialRows.forEach(h => {
       const nombreUsuario = `${h.first_name} ${h.last_name}`;
       let texto = (h.seccion === 'Organigrama') ? `${nombreUsuario} actualizó el organigrama` : `${nombreUsuario} ${h.accion} a ${h.seccion}`;
       mixedFeed.push({ id: h.id, tipo: 'historial', titulo: texto, subtitulo: 'Actividad reciente', imagen: '/img/fondo-cambio-hecho.png', link: h.enlace || '#', fecha: new Date(h.fecha) });
    });
    mixedFeed.sort((a, b) => b.fecha - a.fecha); 
    mixedFeed = mixedFeed.slice(0, 10);

    res.render('home', {
      titulo: 'Inicio', 
      usdHoy, 
      usdTrend: tendencia, // Pasamos la tendencia
      mesNombre, diaHoy,
      cumpleaniosMes: resultsMes, eventosCarousel: eventosRows,
      noticiasCarousel: noticiasRows, eventosPortadas, mixedCarousel: mixedFeed,
      user: req.session.user
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
});

// ... (Resto de rutas de perfil se mantienen igual)
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

router.post('/perfil/foto', upload.single('foto_perfil'), async (req, res) => {
  if (!req.session.user || !req.file) return res.redirect('/perfil');
  try {
    const userId = req.session.user.id;
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'perfiles_usuarios', transformation: [{ width: 300, height: 300, crop: "fill", gravity: "face" }] },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(req.file.buffer);
    });
    await db.query('UPDATE users SET foto = ?, foto_public_id = ? WHERE id = ?', [result.secure_url, result.public_id, userId]);
    req.session.user.foto = result.secure_url;
    res.redirect('/perfil');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
});

router.post('/perfil/foto/eliminar', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  try {
    const userId = req.session.user.id;
    const [rows] = await db.query('SELECT foto_public_id FROM users WHERE id = ?', [userId]);
    if (rows.length > 0 && rows[0].foto_public_id) {
      await cloudinary.uploader.destroy(rows[0].foto_public_id);
    }
    await db.query('UPDATE users SET foto = NULL, foto_public_id = NULL WHERE id = ?', [userId]);
    req.session.user.foto = null;
    res.redirect('/perfil');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
});

module.exports = router;
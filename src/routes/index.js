const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer'); // <--- NUEVO
const cloudinary = require('../services/cloudinary'); // <--- NUEVO
const { getUsdHoy } = require('../services/usdService');

// Configuración de subida en memoria
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ==========================================
// RUTA: HOME (INICIO) - (Sin cambios, lo dejo resumido)
// ==========================================
router.get('/', async (req, res) => {
  // ... (Tu código actual del home se mantiene igual)
  try {
    const { valor: usdHoy, historico } = await getUsdHoy();
    const hoy = new Date();
    const mes = hoy.getMonth() + 1;
    const diaHoy = hoy.getDate();
    const mesNombreRaw = new Intl.DateTimeFormat('es-CL', { month: 'long' }).format(hoy);
    const mesNombre = mesNombreRaw.charAt(0).toUpperCase() + mesNombreRaw.slice(1);

    const sqlMes = `SELECT nombre, area, DAY(fecha_nacimiento) AS dia FROM cumpleanios WHERE MONTH(fecha_nacimiento) = ? ORDER BY dia ASC, nombre ASC`;
    const [resultsMes] = await db.query(sqlMes, [mes]);

    const sqlEventos = `SELECT ef.url as imagen, e.nombre FROM eventos_fotos ef JOIN eventos e ON ef.evento_id = e.id ORDER BY RAND() LIMIT 30`;
    const [eventosRows] = await db.query(sqlEventos);

    const sqlNoticias = `SELECT id, titulo, imagen, subtitulo FROM noticias WHERE imagen IS NOT NULL AND imagen != '' ORDER BY fecha_creacion DESC LIMIT 5`;
    const [noticiasRows] = await db.query(sqlNoticias);
    
    // Portadas eventos home
    const sqlEventosPortada = `SELECT nombre, slug, imagen FROM eventos WHERE imagen IS NOT NULL AND imagen != '' ORDER BY fecha_creacion DESC LIMIT 8`;
    const [eventosPortadas] = await db.query(sqlEventosPortada);

    const sqlHistorial = `SELECT h.id, h.accion, h.seccion, h.enlace, h.fecha, u.first_name, u.last_name, 'historial' as tipo FROM historial_cambios h JOIN users u ON h.usuario_id = u.id ORDER BY h.fecha DESC LIMIT 5`;
    const [historialRows] = await db.query(sqlHistorial);

    let mixedFeed = [];
    noticiasRows.forEach(n => mixedFeed.push({ id: n.id, tipo: 'noticia', titulo: n.titulo, subtitulo: n.subtitulo, imagen: n.imagen, link: `/noticias/${n.id}`, fecha: new Date() })); // fecha simulada o real
    historialRows.forEach(h => {
       const nombreUsuario = `${h.first_name} ${h.last_name}`;
       let texto = (h.seccion === 'Organigrama') ? `${nombreUsuario} actualizó el organigrama` : `${nombreUsuario} ${h.accion} a ${h.seccion}`;
       mixedFeed.push({ id: h.id, tipo: 'historial', titulo: texto, subtitulo: 'Actividad reciente', imagen: '/img/fondo-cambio-hecho.png', link: h.enlace || '#', fecha: new Date(h.fecha) });
    });
    mixedFeed.sort((a, b) => b.fecha - a.fecha); 
    mixedFeed = mixedFeed.slice(0, 10);

    res.render('home', {
      titulo: 'Inicio', usdHoy, usdHistorico: historico, mesNombre, diaHoy,
      cumpleaniosMes: resultsMes, eventosCarousel: eventosRows,
      noticiasCarousel: noticiasRows, eventosPortadas, mixedCarousel: mixedFeed,
      user: req.session.user
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
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

    res.render('perfil', {
      titulo: 'Mi Perfil',
      usuario: rows[0] // Aquí viene el campo 'foto' de la BD
    });

  } catch (err) {
    console.error('Error cargando perfil:', err);
    res.status(500).send('Error al cargar perfil');
  }
});

// --- NUEVO: SUBIR FOTO DE PERFIL ---
router.post('/perfil/foto', upload.single('foto_perfil'), async (req, res) => {
  if (!req.session.user || !req.file) return res.redirect('/perfil');
  
  try {
    const userId = req.session.user.id;

    // 1. Subir a Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { 
          folder: 'perfiles_usuarios', 
          transformation: [{ width: 300, height: 300, crop: "fill", gravity: "face" }] // Recorte automático a cara
        },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(req.file.buffer);
    });

    // 2. Actualizar BD
    await db.query('UPDATE users SET foto = ?, foto_public_id = ? WHERE id = ?', 
      [result.secure_url, result.public_id, userId]);

    // 3. Actualizar Sesión (Para que se vea en el layout al instante)
    req.session.user.foto = result.secure_url;

    res.redirect('/perfil');
  } catch (err) {
    console.error('Error subiendo foto perfil:', err);
    res.status(500).send('Error al subir foto');
  }
});

// --- NUEVO: ELIMINAR FOTO DE PERFIL ---
router.post('/perfil/foto/eliminar', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  try {
    const userId = req.session.user.id;

    // 1. Obtener public_id
    const [rows] = await db.query('SELECT foto_public_id FROM users WHERE id = ?', [userId]);
    
    if (rows.length > 0 && rows[0].foto_public_id) {
      // 2. Borrar de Cloudinary
      await cloudinary.uploader.destroy(rows[0].foto_public_id);
    }

    // 3. Limpiar BD
    await db.query('UPDATE users SET foto = NULL, foto_public_id = NULL WHERE id = ?', [userId]);

    // 4. Actualizar Sesión
    req.session.user.foto = null;

    res.redirect('/perfil');
  } catch (err) {
    console.error('Error eliminando foto:', err);
    res.status(500).send('Error al eliminar foto');
  }
});

module.exports = router;
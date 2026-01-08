const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendMail } = require('../services/mailer');
const requireRole = require('../middlewares/requireRole'); 
const cloudinary = require('../services/cloudinary'); // <--- 1. IMPORTANTE: Faltaba esto

// ======================================================================
//  Página principal
// ======================================================================
router.get('/', (req, res) => {
  res.render('sistemas/index', { titulo: 'Sistemas', user: req.session.user });
});

// ======================================================================
//  Listado de tickets
// ======================================================================
router.get('/tickets', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect('/login');

  let sql = '';
  let params = [];

  if (user.role === 'admin') {
    sql = `SELECT id, titulo, categoria, prioridad, estado, solicitante_nombre, solicitante_email, fecha_creacion FROM tickets ORDER BY fecha_creacion DESC`;
  } else {
    sql = `SELECT id, titulo, categoria, prioridad, estado, solicitante_nombre, solicitante_email, fecha_creacion FROM tickets WHERE solicitante_email = ? ORDER BY fecha_creacion DESC`;
    params = [user.email];
  }

  try {
    const [results] = await db.query(sql, params);
    res.render('sistemas/tickets', { titulo: 'Ticketera', tickets: results, user: user });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error consultando tickets');
  }
});

// ======================================================================
//  Creación de Tickets
// ======================================================================
router.get('/tickets/nuevo', (req, res) => {
  res.render('sistemas/ticket_nuevo', { titulo: 'Abrir Nuevo Ticket', user: req.session.user });
});

router.post('/tickets/crear', async (req, res) => {
  const { titulo, descripcion, categoria, prioridad } = req.body;
  if (!req.session.user) return res.redirect('/login');

  const solicitante_nombre = req.session.user.username;
  const solicitante_email = req.session.user.email;

  const sql = `INSERT INTO tickets (titulo, descripcion, categoria, prioridad, estado, solicitante_nombre, solicitante_email) VALUES (?, ?, ?, ?, 'Abierto', ?, ?)`;

  try {
    const [result] = await db.query(sql, [titulo, descripcion, categoria, prioridad, solicitante_nombre, solicitante_email]);
    const nuevoId = result.insertId;

    if (process.env.ADMIN_NOTIFY_EMAIL) {
      sendMail({
        to: process.env.ADMIN_NOTIFY_EMAIL,
        subject: `Ticket #${nuevoId}: ${titulo}`,
        text: `Ticket generado por ${solicitante_nombre}\n\nTitulo: ${titulo}\n\nDescripción: ${descripcion}`
      }).catch(console.error);
    }
    res.redirect(`/sistemas/tickets/${nuevoId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al procesar el ticket.');
  }
});

// ==========================================
// 2. NUEVA RUTA: FIRMA CLOUDINARY
// (Debe ir ANTES de las rutas con :id)
// ==========================================
router.get('/tickets/signature', async (req, res) => {
  if (!req.session.user) return res.status(403).json({ error: 'No autorizado' });

  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder = 'tickets_adjuntos';
    const paramsToSign = { timestamp, folder };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET
    );

    return res.json({
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      timestamp,
      signature,
      folder
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generando firma' });
  }
});

// ======================================================================
//  ADMIN: Actualizar Ticket
// ======================================================================
router.post('/tickets/:id/actualizar', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { categoria, prioridad, estado } = req.body;

  let sql = `UPDATE tickets SET categoria = ?, prioridad = ?, estado = ?`;
  const params = [categoria, prioridad, estado];

  if (estado === 'Resuelto') {
    sql += `, fecha_resolucion = NOW()`;
  } else if (estado === 'Cerrado') {
    sql += `, fecha_cierre = NOW()`;
  }

  sql += ` WHERE id = ?`;
  params.push(id);

  try {
    await db.query(sql, params);
    res.redirect(`/sistemas/tickets/${id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error actualizando ticket');
  }
});

// ======================================================================
//  NUEVO: Usuario Confirma Solución (Cierra Ticket)
// ======================================================================
router.post('/tickets/:id/confirmar', async (req, res) => {
  const { id } = req.params;
  const user = req.session.user;

  try {
    const [rows] = await db.query('SELECT solicitante_email FROM tickets WHERE id = ?', [id]);
    if (rows.length === 0 || rows[0].solicitante_email !== user.email) {
      return res.status(403).send('No tienes permiso.');
    }

    await db.query(`UPDATE tickets SET estado = 'Cerrado', fecha_cierre = NOW(), cierre_automatico = 0 WHERE id = ?`, [id]);
    res.redirect(`/sistemas/tickets/${id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al confirmar solución');
  }
});

// ======================================================================
//  NUEVO: Usuario Rechaza Solución (Reabre Ticket)
// ======================================================================
router.post('/tickets/:id/rechazar', async (req, res) => {
  const { id } = req.params;
  const user = req.session.user;

  try {
    const [rows] = await db.query('SELECT solicitante_email, titulo FROM tickets WHERE id = ?', [id]);
    if (rows.length === 0 || rows[0].solicitante_email !== user.email) {
      return res.status(403).send('No tienes permiso.');
    }
    
    const ticketTitulo = rows[0].titulo;

    await db.query(`UPDATE tickets SET estado = 'Abierto', fecha_resolucion = NULL WHERE id = ?`, [id]);
    
    // Notificar al Admin
    if (process.env.ADMIN_NOTIFY_EMAIL) {
      sendMail({
        to: process.env.ADMIN_NOTIFY_EMAIL,
        subject: `Ticket Reabierto #${id}: ${ticketTitulo}`,
        text: `El usuario rechazó la solución y reabrió el ticket ${id}`
      }).catch(console.error);
    }

    res.redirect(`/sistemas/tickets/${id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al rechazar solución');
  }
});

// ======================================================================
//  Detalle de Ticket
// ======================================================================
router.get('/tickets/:id', async (req, res) => {
  const { id } = req.params;
  const user = req.session.user;

  const sqlTicket = `SELECT id, titulo, descripcion, categoria, prioridad, estado, solicitante_nombre, solicitante_email, fecha_creacion, fecha_actualizacion, fecha_resolucion FROM tickets WHERE id = ?`;
  
  // Aseguramos que se traigan las columnas de archivo
  const sqlRespuestas = `
    SELECT id, mensaje, remitente, fecha, archivo_url, archivo_nombre, archivo_tipo 
    FROM ticket_respuestas 
    WHERE ticket_id = ? 
    ORDER BY fecha ASC
  `;

  try {
    const [ticketResults] = await db.query(sqlTicket, [id]);
    if (ticketResults.length === 0) return res.status(404).render('404', { titulo: 'No encontrado' });

    if (user.role !== 'admin' && ticketResults[0].solicitante_email !== user.email) {
       return res.status(403).send('No tienes permisos.');
    }

    const [respuestasResults] = await db.query(sqlRespuestas, [id]);
    res.render('sistemas/tickets_detalle', {
      titulo: `Ticket #${id}`,
      ticket: ticketResults[0],
      respuestas: respuestasResults,
      user: user
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
});

module.exports = router;
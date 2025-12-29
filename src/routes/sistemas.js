// src/routes/sistemas.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendMail } = require('../services/mailer');
const requireRole = require('../middlewares/requireRole'); 

// ======================================================================
//  Página principal de la sección Sistemas
// ======================================================================
router.get('/', (req, res) => {
  res.render('sistemas/index', {
    titulo: 'Sistemas',
    user: req.session.user
  });
});

// ======================================================================
//  Listado de tickets (MODIFICADO)
// ======================================================================
router.get('/tickets', async (req, res) => {
  const user = req.session.user;

  // Seguridad: si no está logueado, redirigir
  if (!user) return res.redirect('/login');

  let sql = '';
  let params = [];

  // Lógica: Si es admin ve todo, si no, filtra por su email
  if (user.role === 'admin') {
    sql = `
      SELECT id, titulo, categoria, prioridad, estado, solicitante_nombre, solicitante_email, fecha_creacion
      FROM tickets
      ORDER BY fecha_creacion DESC
    `;
  } else {
    sql = `
      SELECT id, titulo, categoria, prioridad, estado, solicitante_nombre, solicitante_email, fecha_creacion
      FROM tickets
      WHERE solicitante_email = ?
      ORDER BY fecha_creacion DESC
    `;
    params = [user.email];
  }

  try {
    const [results] = await db.query(sql, params);
    res.render('sistemas/tickets', {
      titulo: 'Ticketera',
      tickets: results,
      user: user // Pasamos el usuario para el layout
    });
  } catch (err) {
    console.error('Error consultando tickets:', err);
    res.status(500).send('Error consultando tickets');
  }
});

// ======================================================================
//  NUEVO: Formulario de creación (GET)
// ======================================================================
router.get('/tickets/nuevo', (req, res) => {
  res.render('sistemas/ticket_nuevo', {
    titulo: 'Abrir Nuevo Ticket',
    user: req.session.user
  });
});

// ======================================================================
//  NUEVO: Procesar creación (POST)
// ======================================================================
router.post('/tickets/crear', async (req, res) => {
  const { titulo, descripcion, categoria, prioridad } = req.body;
  
  if (!req.session.user) return res.redirect('/login');

  const solicitante_nombre = req.session.user.username;
  const solicitante_email = req.session.user.email;

  const sql = `
    INSERT INTO tickets (titulo, descripcion, categoria, prioridad, estado, solicitante_nombre, solicitante_email)
    VALUES (?, ?, ?, ?, 'Abierto', ?, ?)
  `;

  try {
    const [result] = await db.query(sql, [titulo, descripcion, categoria, prioridad, solicitante_nombre, solicitante_email]);
    const nuevoId = result.insertId;

    if (process.env.ADMIN_NOTIFY_EMAIL) {
      sendMail({
        to: process.env.ADMIN_NOTIFY_EMAIL,
        subject: `Nuevo Ticket #${nuevoId}: ${titulo}`,
        text: `Se ha creado un nuevo ticket.\n\nSolicitante: ${solicitante_nombre}\nDescripción: ${descripcion}`
      }).catch(err => console.error('Error notificando:', err));
    }

    res.redirect(`/sistemas/tickets/${nuevoId}`);
  } catch (err) {
    console.error('Error al crear ticket:', err);
    res.status(500).send('Error al procesar el ticket.');
  }
});

// ======================================================================
//  ADMIN: Actualizar Ticket (Estado, Prioridad)
// ======================================================================
router.post('/tickets/:id/actualizar', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { categoria, prioridad, estado } = req.body;

  const sql = `
    UPDATE tickets
    SET categoria = ?, prioridad = ?, estado = ?
    WHERE id = ?
  `;

  try {
    await db.query(sql, [categoria, prioridad, estado, id]);
    res.redirect(`/sistemas/tickets/${id}`);
  } catch (err) {
    console.error('Error actualizando ticket:', err);
    res.status(500).send('Error actualizando ticket');
  }
});

// ======================================================================
//  ADMIN: Responder Ticket
// ======================================================================
router.post('/tickets/:id/responder', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { asunto_respuesta, mensaje_respuesta } = req.body;

  if (!mensaje_respuesta || !mensaje_respuesta.trim()) {
    return res.status(400).send('El mensaje de respuesta no puede estar vacío.');
  }

  const sqlTicket = `SELECT solicitante_email, titulo FROM tickets WHERE id = ?`;

  try {
    const [results] = await db.query(sqlTicket, [id]);

    if (results.length === 0) {
      return res.status(404).send('Ticket no encontrado');
    }

    const { solicitante_email, titulo } = results[0];

    const subject =
      asunto_respuesta && asunto_respuesta.trim().length > 0
        ? asunto_respuesta
        : `Respuesta a tu ticket #${id}: ${titulo}`;

    const sqlRespuesta = `
      INSERT INTO ticket_respuestas (ticket_id, mensaje, remitente)
      VALUES (?, ?, 'soporte')
    `;

    await db.query(sqlRespuesta, [id, mensaje_respuesta]);

    // Envío de correo vía API
    sendMail({
      to: solicitante_email,
      subject: subject,
      text: mensaje_respuesta
    })
    .then(() => console.log('Correo de respuesta enviado exitosamente'))
    .catch(err => console.error('Error enviando correo:', err));

    res.redirect(`/sistemas/tickets/${id}`);
  } catch (err) {
    console.error('Error en flujo de respuesta:', err);
    res.status(500).send('Error al procesar la respuesta.');
  }
});

// ======================================================================
//  Detalle de un ticket (Debe ir al final de las rutas /tickets/...)
// ======================================================================
router.get('/tickets/:id', async (req, res) => {
  const { id } = req.params;
  const user = req.session.user; // Obtener usuario para verificar permisos si quisieras

  const sqlTicket = `SELECT id, descripcion, categoria, prioridad, estado, solicitante_nombre, solicitante_email, fecha_creacion, fecha_actualizacion FROM tickets WHERE id = ?`;
  const sqlRespuestas = `SELECT id, mensaje, remitente, fecha FROM ticket_respuestas WHERE ticket_id = ? ORDER BY fecha ASC`;

  try {
    const [ticketResults] = await db.query(sqlTicket, [id]);
    if (ticketResults.length === 0) return res.status(404).render('404', { titulo: 'No encontrado' });

    // Opcional: Validar que el usuario sea dueño del ticket o admin para verlo
    if (user.role !== 'admin' && ticketResults[0].solicitante_email !== user.email) {
       return res.status(403).send('No tienes permisos para ver este ticket.');
    }

    const [respuestasResults] = await db.query(sqlRespuestas, [id]);
    res.render('sistemas/tickets_detalle', {
      titulo: `Ticket #${id}`,
      ticket: ticketResults[0],
      respuestas: respuestasResults,
      user: user
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).send('Error');
  }
});

module.exports = router;
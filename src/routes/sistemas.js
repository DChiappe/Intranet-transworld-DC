// src/routes/sistemas.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendMail } = require('../services/mailer');

// ======================================================================
//  Página principal de la sección Sistemas
// ======================================================================
router.get('/', (req, res) => {
  res.render('sistemas/index', {
    titulo: 'Sistemas'
  });
});

// ======================================================================
//  Listado de tickets
// ======================================================================
router.get('/tickets', async (req, res) => {
  const sql = `
    SELECT id, titulo, categoria, prioridad, estado, solicitante_nombre, solicitante_email, fecha_creacion
    FROM tickets
    ORDER BY fecha_creacion DESC
  `;
  try {
    const [results] = await db.query(sql);
    res.render('sistemas/tickets', {
      titulo: 'Ticketera',
      tickets: results
    });
  } catch (err) {
    console.error('Error consultando tickets:', err);
    res.status(500).send('Error consultando tickets');
  }
});

// ======================================================================
//  NUEVO: Formulario de creación (GET)
//  Ruta: /sistemas/tickets/nuevo
// ======================================================================
router.get('/tickets/nuevo', (req, res) => {
  // Renderizamos la vista dentro de la carpeta sistemas
  res.render('sistemas/ticket_nuevo', {
    titulo: 'Abrir Nuevo Ticket'
  });
});

// ======================================================================
//  NUEVO: Procesar creación (POST)
//  Ruta: /sistemas/tickets/crear
// ======================================================================
router.post('/tickets/crear', async (req, res) => {
  const { titulo, descripcion, categoria, prioridad } = req.body;
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
//  Detalle de un ticket
// ======================================================================
router.get('/tickets/:id', async (req, res) => {
  const { id } = req.params;
  const sqlTicket = `SELECT id, descripcion, categoria, prioridad, estado, solicitante_nombre, solicitante_email, fecha_creacion, fecha_actualizacion FROM tickets WHERE id = ?`;
  const sqlRespuestas = `SELECT id, mensaje, remitente, fecha FROM ticket_respuestas WHERE ticket_id = ? ORDER BY fecha ASC`;

  try {
    const [ticketResults] = await db.query(sqlTicket, [id]);
    if (ticketResults.length === 0) return res.status(404).render('404', { titulo: 'No encontrado' });

    const [respuestasResults] = await db.query(sqlRespuestas, [id]);
    res.render('sistemas/tickets_detalle', {
      titulo: `Ticket #${id}`,
      ticket: ticketResults[0],
      respuestas: respuestasResults
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).send('Error');
  }
});

module.exports = router;
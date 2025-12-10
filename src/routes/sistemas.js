// src/routes/sistemas.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// ======================================================================
//  Página principal de la sección Sistemas
//  GET /sistemas
// ======================================================================
router.get('/', (req, res) => {
  res.render('sistemas/index', {
    titulo: 'Sistemas'
  });
});

// ======================================================================
//  Listado de tickets (tipo Freshdesk)
//  GET /sistemas/tickets
// ======================================================================
router.get('/tickets', async (req, res) => {
  const sql = `
    SELECT 
      id,
      titulo,
      categoria,
      prioridad,
      estado,
      solicitante_nombre,
      solicitante_email,
      fecha_creacion
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
//  Detalle de un ticket + historial de respuestas
//  GET /sistemas/tickets/:id
// ======================================================================
router.get('/tickets/:id', async (req, res) => {
  const { id } = req.params;

  const sqlTicket = `
    SELECT 
      id,
      titulo,
      descripcion,
      categoria,
      prioridad,
      estado,
      solicitante_nombre,
      solicitante_email,
      fecha_creacion,
      fecha_actualizacion
    FROM tickets
    WHERE id = ?
  `;

  const sqlRespuestas = `
    SELECT 
      id,
      mensaje,
      remitente,
      fecha
    FROM ticket_respuestas
    WHERE ticket_id = ?
    ORDER BY fecha ASC
  `;

  try {
    const [ticketResults] = await db.query(sqlTicket, [id]);

    if (ticketResults.length === 0) {
      return res.status(404).render('404', {
        titulo: 'Ticket no encontrado'
      });
    }

    const ticket = ticketResults[0];

    const [respuestasResults] = await db.query(sqlRespuestas, [id]);

    res.render('sistemas/tickets_detalle', {
      titulo: `Ticket #${id}`,
      ticket,
      respuestas: respuestasResults
    });
  } catch (err) {
    console.error('Error obteniendo ticket o respuestas:', err);
    res.status(500).send('Error obteniendo información del ticket');
  }
});

module.exports = router;

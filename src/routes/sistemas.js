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
router.get('/tickets', (req, res) => {
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

  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error consultando tickets:', err);
      return res.status(500).send('Error consultando tickets');
    }

    res.render('sistemas/tickets', {
      titulo: 'Ticketera',
      tickets: results
    });
  });
});

// ======================================================================
//  Detalle de un ticket + historial de respuestas
//  GET /sistemas/tickets/:id
// ======================================================================
router.get('/tickets/:id', (req, res) => {
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

  db.query(sqlTicket, [id], (errTicket, ticketResults) => {
    if (errTicket) {
      console.error('Error obteniendo ticket:', errTicket);
      return res.status(500).send('Error obteniendo ticket');
    }

    if (ticketResults.length === 0) {
      // Si tienes una vista 404, la usamos. Si no, puedes hacer send().
      return res.status(404).render('404', {
        titulo: 'Ticket no encontrado'
      });
    }

    const ticket = ticketResults[0];

    db.query(sqlRespuestas, [id], (errResp, respuestasResults) => {
      if (errResp) {
        console.error('Error obteniendo respuestas del ticket:', errResp);
        return res.status(500).send('Error obteniendo respuestas del ticket');
      }

      res.render('sistemas/tickets_detalle', {
        titulo: `Ticket #${id}`,
        ticket,
        respuestas: respuestasResults
      });
    });
  });
});

module.exports = router;

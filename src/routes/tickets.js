// src/routes/tickets.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const transporter = require('../services/mailer');

// POST /tickets/:id/actualizar
router.post('/:id/actualizar', (req, res) => {
  const { id } = req.params;
  const { categoria, prioridad, estado } = req.body;

  const sql = `
    UPDATE tickets
    SET categoria = ?, prioridad = ?, estado = ?
    WHERE id = ?
  `;

  db.query(sql, [categoria, prioridad, estado, id], (err) => {
    if (err) {
      console.error('Error actualizando ticket:', err);
      return res.status(500).send('Error actualizando ticket');
    }
    res.redirect(`/sistemas/tickets/${id}`);
  });
});

// POST /tickets/:id/responder
router.post('/:id/responder', (req, res) => {
  const { id } = req.params;
  const { asunto_respuesta, mensaje_respuesta } = req.body;

  if (!mensaje_respuesta || !mensaje_respuesta.trim()) {
    return res.status(400).send('El mensaje de respuesta no puede estar vacío.');
  }

  const sqlTicket = `
    SELECT solicitante_email, titulo
    FROM tickets
    WHERE id = ?
  `;

  db.query(sqlTicket, [id], (err, results) => {
    if (err) {
      console.error('Error obteniendo ticket para responder:', err);
      return res.status(500).send('Error obteniendo ticket');
    }

    if (results.length === 0) {
      return res.status(404).send('Ticket no encontrado');
    }

    const { solicitante_email, titulo } = results[0];

    const subject = asunto_respuesta && asunto_respuesta.trim().length > 0
      ? asunto_respuesta
      : `Respuesta a tu ticket #${id}: ${titulo}`;

    transporter.sendMail(
      {
        from: process.env.SMTP_FROM || 'Mesa de Soporte <dchiappe@transworld.cl>',
        to: solicitante_email,
        subject,
        text: mensaje_respuesta
      },
      (errMail) => {
        if (errMail) {
          console.error('Error enviando correo de respuesta:', errMail);
          return res.status(500).send('Error enviando la respuesta por correo');
        }

        const sqlRespuesta = `
          INSERT INTO ticket_respuestas (ticket_id, mensaje, remitente)
          VALUES (?, ?, 'soporte')
        `;

        db.query(sqlRespuesta, [id, mensaje_respuesta], (errResp) => {
          if (errResp) {
            console.error('Error guardando respuesta en BD:', errResp);
            return res
              .status(500)
              .send('Respuesta enviada, pero no se pudo guardar en BD');
          }

          res.redirect(`/sistemas/tickets/${id}`);
        });
      }
    );
  });
});

module.exports = router;

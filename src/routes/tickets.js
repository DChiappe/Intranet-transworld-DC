// src/routes/tickets.js
const express = require('express');
const router = express.Router();
const db = require('../db');
// Cambiamos transporter por la función sendMail del nuevo mailer
const { sendMail } = require('../services/mailer'); 
const requireRole = require('../middlewares/requireRole');


// POST /tickets/:id/actualizar
router.post('/:id/actualizar', requireRole('admin'), async (req, res) => {
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

// POST /tickets/:id/responder
router.post('/:id/responder', requireRole('admin'), async (req, res) => {
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

  try {
    // 1) Obtener ticket
    const [results] = await db.query(sqlTicket, [id]);

    if (results.length === 0) {
      return res.status(404).send('Ticket no encontrado');
    }

    const { solicitante_email, titulo } = results[0];

    // 2) Preparar asunto
    const subject =
      asunto_respuesta && asunto_respuesta.trim().length > 0
        ? asunto_respuesta
        : `Respuesta a tu ticket #${id}: ${titulo}`;

    // 3) Guardar respuesta en BD
    const sqlRespuesta = `
      INSERT INTO ticket_respuestas (ticket_id, mensaje, remitente)
      VALUES (?, ?, 'soporte')
    `;

    await db.query(sqlRespuesta, [id, mensaje_respuesta]);

    // 4) Enviar correo vía API de Brevo
    // Usamos el remitente verificado dchiappe@transworld.cl
    sendMail({
      to: solicitante_email,
      subject: subject,
      text: mensaje_respuesta
    })
    .then(() => {
      console.log('Correo de respuesta enviado exitosamente vía API');
    })
    .catch(err => {
      console.error('Error enviando correo de respuesta vía API:', err);
    });

    // 5) Volver al detalle del ticket inmediatamente
    res.redirect(`/sistemas/tickets/${id}`);
  } catch (err) {
    console.error('Error en flujo de respuesta de ticket:', err);
    res
      .status(500)
      .send('Ocurrió un error al procesar la respuesta del ticket.');
  }
});

module.exports = router;
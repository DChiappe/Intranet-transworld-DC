// src/routes/tickets.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendMail } = require('../services/mailer'); 
const requireRole = require('../middlewares/requireRole');

// ==========================================
// RUTAS PARA USUARIOS (Creación)
// ==========================================

// GET /tickets/nuevo - Mostrar el formulario de creación
router.get('/nuevo', (req, res) => {
  res.render('ticket_nuevo', {
    titulo: 'Nuevo Ticket'
  });
});

// POST /tickets/crear - Procesar la inserción del nuevo ticket
router.post('/crear', async (req, res) => {
  const { titulo, descripcion, categoria, prioridad } = req.body;
  
  // Se obtienen automáticamente de la sesión del usuario logueado
  const solicitante_nombre = req.session.user.username;
  const solicitante_email = req.session.user.email;

  // Query basada en la estructura de tu tabla tickets
  const sql = `
    INSERT INTO tickets 
      (titulo, descripcion, categoria, prioridad, estado, solicitante_nombre, solicitante_email)
    VALUES (?, ?, ?, ?, 'Abierto', ?, ?)
  `;

  try {
    const [result] = await db.query(sql, [
      titulo, 
      descripcion, 
      categoria || 'Otro', 
      prioridad || 'Media', 
      solicitante_nombre, 
      solicitante_email
    ]);

    const nuevoId = result.insertId;

    // Notificación opcional al administrador vía Brevo API
    if (process.env.ADMIN_NOTIFY_EMAIL) {
      sendMail({
        to: process.env.ADMIN_NOTIFY_EMAIL,
        subject: `Nuevo Ticket #${nuevoId}: ${titulo}`,
        text: `Se ha generado un nuevo requerimiento.\n\nSolicitante: ${solicitante_nombre}\nCategoría: ${categoria}\nPrioridad: ${prioridad}\n\nDescripción:\n${descripcion}`
      }).catch(err => console.error('Error enviando notificación de nuevo ticket:', err));
    }

    // Redirección al detalle del ticket recién creado dentro de la sección sistemas
    res.redirect(`/sistemas/tickets/${nuevoId}`);
  } catch (err) {
    console.error('Error al crear ticket:', err);
    res.status(500).send('Ocurrió un error al procesar el ticket. Por favor, intente nuevamente.');
  }
});

// ==========================================
// RUTAS PARA ADMINISTRADORES (Gestión)
// ==========================================

// POST /tickets/:id/actualizar - Cambiar estado, categoría o prioridad
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

// POST /tickets/:id/responder - Enviar respuesta al solicitante
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

    // Envío de correo vía API de Brevo (usando dchiappe@transworld.cl configurado en mailer.js)
    sendMail({
      to: solicitante_email,
      subject: subject,
      text: mensaje_respuesta
    })
    .then(() => console.log('Correo de respuesta enviado exitosamente vía API'))
    .catch(err => console.error('Error enviando correo de respuesta:', err));

    res.redirect(`/sistemas/tickets/${id}`);
  } catch (err) {
    console.error('Error en flujo de respuesta:', err);
    res.status(500).send('Error al procesar la respuesta.');
  }
});

module.exports = router;
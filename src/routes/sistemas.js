const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendMail } = require('../services/mailer');
const requireRole = require('../middlewares/requireRole'); 
const cloudinary = require('../services/cloudinary');

const EMAIL_FOOTER_HTML = `
<br><hr>
<p style="font-size: 0.9rem; color: #555;">
  Para responder a este correo, por favor ingrese a la sección de tickets en la intranet.<br>
  Saludos cordiales.
</p>
`;

const EMAIL_FOOTER_TEXT = `
---------------------------------------------------
Para responder a este correo, por favor ingrese a la sección de tickets en la intranet.
Saludos cordiales.
`;

// ==========================================
// HELPER: GENERAR HTML CORREO (MULTIPLE)
// ==========================================
function generarHtmlCorreo(mensaje, adjuntosJSON) {
  let html = `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.5;">`;
  html += `<p>${mensaje.replace(/\n/g, '<br>')}</p>`;

  let archivos = [];
  try {
    if (adjuntosJSON) archivos = JSON.parse(adjuntosJSON);
  } catch (e) {}

  if (archivos.length > 0) {
    html += `<div style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border: 1px solid #e9ecef; border-radius: 5px;">`;
    html += `<p style="font-weight: bold; margin-top: 0;">📎 Adjuntos:</p>`;

    // 1. PRIMERO: Links de PDFs y VIDEOS
    const docsYVideos = archivos.filter(a => a.tipo !== 'image');
    if (docsYVideos.length > 0) {
      html += `<ul style="margin-bottom: 15px;">`;
      docsYVideos.forEach(a => {
        let label = a.tipo === 'video' ? 'Video' : 'Archivo';
        html += `<li><strong>[${label}]:</strong> <a href="${a.url}" target="_blank" style="color: #0056b3;">${a.nombre}</a></li>`;
      });
      html += `</ul>`;
    }

    // 2. SEGUNDO: Imágenes una debajo de otra
    const imagenes = archivos.filter(a => a.tipo === 'image');
    if (imagenes.length > 0) {
      imagenes.forEach(img => {
        html += `<div style="margin-bottom: 15px;">
          <img src="${img.url}" alt="${img.nombre}" style="max-width: 100%; width: 500px; height: auto; border: 1px solid #ccc; border-radius: 4px; display: block;">
        </div>`;
      });
    }

    html += `</div>`;
  }

  html += EMAIL_FOOTER_HTML;
  html += `</div>`;
  return html;
}

function generarTextoCorreo(mensaje, adjuntosJSON) {
  let texto = mensaje;
  let archivos = [];
  try { if (adjuntosJSON) archivos = JSON.parse(adjuntosJSON); } catch (e) {}
  
  if (archivos.length > 0) {
    texto += `\n\n--- Adjuntos ---`;
    archivos.forEach(a => {
      texto += `\n[${a.tipo}]: ${a.nombre} -> ${a.url}`;
    });
  }
  texto += `\n${EMAIL_FOOTER_TEXT}`;
  return texto;
}

// ... (Rutas GET / y GET /tickets... MANTENER IGUAL) ...
// ... (Rutas GET /tickets/nuevo y POST /crear... MANTENER IGUAL) ...

// ==========================================
// RUTA FIRMA CLOUDINARY (Necesaria)
// ==========================================
router.get('/tickets/signature', async (req, res) => {
  if (!req.session.user) return res.status(403).json({ error: 'No autorizado' });
  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder = 'tickets_adjuntos';
    const paramsToSign = { timestamp, folder };
    const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);
    return res.json({
      cloudName: process.env.CLOUDINARY_CLOUD_NAME, apiKey: process.env.CLOUDINARY_API_KEY, timestamp, signature, folder
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error firma' });
  }
});

// ==========================================
// ADMIN: GESTIONAR (Soporta Múltiples)
// ==========================================
router.post('/tickets/:id/actualizar', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  // recibimos 'adjuntos_data' que es el string JSON del front
  const { categoria, prioridad, estado, mensaje_respuesta, adjuntos_data } = req.body; 

  // Actualizar datos base
  let sql = `UPDATE tickets SET categoria = ?, prioridad = ?, estado = ?`;
  if (estado === 'Resuelto') sql += `, fecha_resolucion = NOW()`;
  else if (estado === 'Cerrado') sql += `, fecha_cierre = NOW()`;
  else if (estado === 'Abierto') sql += `, fecha_resolucion = NULL, fecha_cierre = NULL`; // Reabrir
  
  sql += ` WHERE id = ?`;

  try {
    await db.query(sql, [categoria, prioridad, estado, id]);
    
    // Si hay mensaje o adjuntos, guardar respuesta
    const tieneMensaje = mensaje_respuesta && mensaje_respuesta.trim().length > 0;
    const tieneAdjuntos = adjuntos_data && adjuntos_data.length > 2; // "[]" es length 2

    if (tieneMensaje || tieneAdjuntos) {
      await db.query(
        `INSERT INTO ticket_respuestas (ticket_id, mensaje, remitente, adjuntos) VALUES (?, ?, ?, ?)`,
        [id, mensaje_respuesta, 'Soporte', adjuntos_data || '[]']
      );

      // Enviar correo
      const [ticket] = await db.query('SELECT solicitante_email, titulo FROM tickets WHERE id = ?', [id]);
      if (ticket.length > 0) {
        let asunto = `Actualización Ticket #${id}: ${ticket[0].titulo}`;
        let cuerpo = `Hola,\n\nSe ha actualizado tu ticket. Estado: ${estado.toUpperCase()}.\n`;
        if (tieneMensaje) cuerpo += `\nMensaje: "${mensaje_respuesta}"`;

        sendMail({
          to: ticket[0].solicitante_email,
          subject: asunto,
          text: generarTextoCorreo(cuerpo, adjuntos_data),
          html: generarHtmlCorreo(cuerpo, adjuntos_data)
        }).catch(console.error);
      }
    }
    res.redirect(`/sistemas/tickets/${id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error actualizando ticket');
  }
});

// ==========================================
// USUARIO: RESPONDER (Soporta Múltiples)
// ==========================================
router.post('/tickets/:id/responder', async (req, res) => {
  const { id } = req.params;
  const { mensaje_respuesta, adjuntos_data } = req.body;
  const user = req.session.user;

  try {
    const [results] = await db.query(`SELECT solicitante_email, titulo FROM tickets WHERE id = ?`, [id]);
    if (results.length === 0) return res.status(404).send('Ticket no encontrado');
    const ticket = results[0];

    // Determinar remitente
    const isAdmin = user.role === 'admin';
    let remitenteNombre = isAdmin ? 'Soporte' : (user.username || user.first_name);
    let emailDestino = isAdmin ? ticket.solicitante_email : process.env.ADMIN_NOTIFY_EMAIL;
    let asuntoEmail = `Nueva respuesta Ticket #${id}: ${ticket.titulo}`;

    await db.query(
      `INSERT INTO ticket_respuestas (ticket_id, mensaje, remitente, adjuntos) VALUES (?, ?, ?, ?)`, 
      [id, mensaje_respuesta, remitenteNombre, adjuntos_data || '[]']
    );

    if (emailDestino) {
      let cuerpo = `Nueva respuesta de ${remitenteNombre}:\n\n${mensaje_respuesta}`;
      sendMail({
        to: emailDestino,
        subject: asuntoEmail,
        text: generarTextoCorreo(cuerpo, adjuntos_data),
        html: generarHtmlCorreo(cuerpo, adjuntos_data)
      }).catch(console.error);
    }

    res.redirect(`/sistemas/tickets/${id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error procesando respuesta.');
  }
});

// ... (Resto de rutas: confirmar, rechazar, detalle... MANTENER IGUAL pero en Detalle asegurar traer 'adjuntos') ...

router.get('/tickets/:id', async (req, res) => {
  const { id } = req.params;
  const user = req.session.user;

  const sqlTicket = `SELECT * FROM tickets WHERE id = ?`;
  // TRAEMOS 'adjuntos' Y TAMBIÉN 'archivo_url' (Legacy)
  const sqlRespuestas = `
    SELECT id, mensaje, remitente, fecha, archivo_url, archivo_nombre, archivo_tipo, adjuntos 
    FROM ticket_respuestas 
    WHERE ticket_id = ? 
    ORDER BY fecha ASC
  `;

  try {
    const [ticketResults] = await db.query(sqlTicket, [id]);
    if (ticketResults.length === 0) return res.status(404).render('404', { titulo: 'No encontrado' });
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
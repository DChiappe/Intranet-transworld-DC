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
  
  // Mensaje
  html += `<p>${mensaje.replace(/\n/g, '<br>')}</p>`;

  let archivos = [];
  try {
    if (adjuntosJSON) archivos = JSON.parse(adjuntosJSON);
  } catch (e) {}

  if (archivos.length > 0) {
    html += `<div style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border: 1px solid #e9ecef; border-radius: 5px;">`;
    html += `<p style="font-weight: bold; margin-top: 0;">📎 Adjuntos:</p>`;

    // 1. PRIMERO: Links de Documentos y Videos (PDF, DOC, MP4)
    const docsYVideos = archivos.filter(a => a.tipo !== 'image');
    if (docsYVideos.length > 0) {
      html += `<ul style="margin-bottom: 15px;">`;
      docsYVideos.forEach(a => {
        let label = a.tipo === 'video' ? 'Video' : 'Archivo';
        html += `<li><strong>[${label}]:</strong> <a href="${a.url}" target="_blank" style="color: #0056b3;">${a.nombre}</a></li>`;
      });
      html += `</ul>`;
    }

    // 2. SEGUNDO: Imágenes (Se muestran visualmente una debajo de otra)
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
      let mensajeBase = `Ticket generado por ${solicitante_nombre}\n\nTitulo: ${titulo}\n\nDescripción: ${descripcion}`;
      sendMail({
        to: process.env.ADMIN_NOTIFY_EMAIL,
        subject: `Ticket #${nuevoId}: ${titulo}`,
        text: mensajeBase + EMAIL_FOOTER_TEXT,
        html: generarHtmlCorreo(mensajeBase, null)
      }).catch(console.error);
    }
    res.redirect(`/sistemas/tickets/${nuevoId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al procesar el ticket.');
  }
});

// ==========================================
// RUTA FIRMA CLOUDINARY (Necesaria para subida)
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
// ADMIN: GESTIONAR (Soporta Múltiples Archivos)
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
    // "[]" tiene length 2, así que verificamos > 2
    const tieneMensaje = mensaje_respuesta && mensaje_respuesta.trim().length > 0;
    const tieneAdjuntos = adjuntos_data && adjuntos_data.length > 2; 

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

// ======================================================================
//  USUARIO: Confirma Solución (Cierra Ticket)
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
//  USUARIO: Rechaza Solución (Reabre Ticket)
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
    
    // Guardar log en chat
    await db.query(`INSERT INTO ticket_respuestas (ticket_id, mensaje, remitente) VALUES (?, ?, ?)`, 
      [id, 'El usuario ha rechazado la solución y el ticket se ha reabierto.', 'Sistema']);

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

// ==========================================
// USUARIO: RESPONDER (Soporta Múltiples Archivos)
// ==========================================
router.post('/tickets/:id/responder', async (req, res) => {
  const { id } = req.params;
  const { mensaje_respuesta, adjuntos_data } = req.body;
  const user = req.session.user;

  try {
    const [results] = await db.query(`SELECT solicitante_email, titulo FROM tickets WHERE id = ?`, [id]);
    if (results.length === 0) return res.status(404).send('Ticket no encontrado');
    const ticket = results[0];

    const isAdmin = user.role === 'admin';
    const isOwner = user.email === ticket.solicitante_email;
    if (!isAdmin && !isOwner) return res.status(403).send('Sin permiso.');

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

// ======================================================================
//  Detalle de Ticket
// ======================================================================
router.get('/tickets/:id', async (req, res) => {
  const { id } = req.params;
  const user = req.session.user;

  const sqlTicket = `SELECT * FROM tickets WHERE id = ?`;
  // IMPORTANTE: Traer 'adjuntos' Y TAMBIÉN 'archivo_url' (Legacy)
  const sqlRespuestas = `
    SELECT id, mensaje, remitente, fecha, archivo_url, archivo_nombre, archivo_tipo, adjuntos 
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
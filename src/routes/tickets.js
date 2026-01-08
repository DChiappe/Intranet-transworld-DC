const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendMail } = require('../services/mailer'); 
const requireRole = require('../middlewares/requireRole');
const cloudinary = require('../services/cloudinary'); // <--- IMPORTANTE

const EMAIL_FOOTER = `
---------------------------------------------------
Para responder a este correo, por favor ingrese a la sección de tickets en la intranet.
Saludos cordiales.
`;

// ==========================================
// RUTA PARA FIRMA DE CLOUDINARY (Seguridad)
// ==========================================
router.get('/signature', async (req, res) => {
  if (!req.session.user) return res.status(403).json({ error: 'No autorizado' });

  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder = 'tickets_adjuntos'; // Carpeta en Cloudinary
    
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

// ==========================================
// RUTAS PARA USUARIOS (Creación)
// ==========================================
router.get('/nuevo', (req, res) => {
  res.render('sistemas/ticket_nuevo', { titulo: 'Nuevo Ticket', user: req.session.user }); // Ajusté la ruta de vista
});

router.post('/crear', async (req, res) => {
  const { titulo, descripcion, categoria, prioridad } = req.body;
  if (!req.session.user) return res.redirect('/login');
  
  const solicitante_nombre = req.session.user.username;
  const solicitante_email = req.session.user.email;

  const sql = `
    INSERT INTO tickets 
      (titulo, descripcion, categoria, prioridad, estado, solicitante_nombre, solicitante_email)
    VALUES (?, ?, ?, ?, 'Abierto', ?, ?)
  `;

  try {
    const [result] = await db.query(sql, [titulo, descripcion, categoria || 'Otro', prioridad || 'Media', solicitante_nombre, solicitante_email]);
    const nuevoId = result.insertId;

    if (process.env.ADMIN_NOTIFY_EMAIL) {
      const mensaje = `Se ha generado un nuevo requerimiento.\n\nSolicitante: ${solicitante_nombre}\nCategoría: ${categoria}\nPrioridad: ${prioridad}\n\nDescripción:\n${descripcion}`;
      sendMail({
        to: process.env.ADMIN_NOTIFY_EMAIL,
        subject: `Nuevo Ticket #${nuevoId}: ${titulo}`,
        text: mensaje + EMAIL_FOOTER
      }).catch(console.error);
    }
    res.redirect(`/sistemas/tickets/${nuevoId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creando ticket');
  }
});

// ==========================================
// ADMIN: Gestionar (Con Adjuntos)
// ==========================================
router.post('/:id/gestionar', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { estado, mensaje_respuesta, archivo_url, archivo_nombre, archivo_tipo } = req.body; // <--- Nuevos campos
  
  const tieneMensaje = mensaje_respuesta && mensaje_respuesta.trim().length > 0;
  // Consideramos que "hay respuesta" si hay texto O si hay un archivo
  const hayRespuesta = tieneMensaje || (archivo_url && archivo_url.trim().length > 0);

  try {
    const [rows] = await db.query('SELECT estado, solicitante_email, titulo FROM tickets WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).send('Ticket no encontrado');
    
    const ticket = rows[0];
    const estadoAnterior = ticket.estado;
    const cambioEstado = estado !== estadoAnterior;

    if (!cambioEstado && !hayRespuesta) {
       return res.redirect(`/sistemas/tickets/${id}`);
    }

    // Actualizar Estado
    if (cambioEstado) {
      let sqlUpdate = `UPDATE tickets SET estado = ?`;
      if (estado === 'Resuelto') sqlUpdate += `, fecha_resolucion = NOW()`;
      else if (estado === 'Cerrado') sqlUpdate += `, fecha_cierre = NOW()`;
      else if (estado === 'Abierto') sqlUpdate += `, fecha_resolucion = NULL, fecha_cierre = NULL`;
      sqlUpdate += ` WHERE id = ?`;
      await db.query(sqlUpdate, [estado, id]);
    }

    // Insertar Mensaje + Archivo
    if (hayRespuesta) {
      await db.query(
        `INSERT INTO ticket_respuestas (ticket_id, mensaje, remitente, archivo_url, archivo_nombre, archivo_tipo) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, mensaje_respuesta, 'Soporte', archivo_url || null, archivo_nombre || null, archivo_tipo || null]
      );
    }

    // Enviar Correo
    if (ticket.solicitante_email) {
      let asunto = `Actualización Ticket #${id}: ${ticket.titulo}`;
      let cuerpo = `Hola,\n\nSe ha actualizado tu ticket "${ticket.titulo}".\n`;

      if (cambioEstado) {
        cuerpo += `\n- Nuevo Estado: ${estado.toUpperCase()}`;
        if (estado === 'Resuelto') cuerpo += `\n(Por favor confirma si funciona)`;
      }

      if (tieneMensaje) {
        cuerpo += `\n\n- Mensaje de Soporte:\n"${mensaje_respuesta}"`;
      }

      if (archivo_url) {
        cuerpo += `\n\n[Soporte ha adjuntado un archivo: ${archivo_nombre}]`;
      }

      cuerpo += EMAIL_FOOTER;

      sendMail({ to: ticket.solicitante_email, subject: asunto, text: cuerpo }).catch(console.error);
    }

    res.redirect(`/sistemas/tickets/${id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error gestionando ticket');
  }
});

// ==========================================
// USUARIO: Responder (Con Adjuntos)
// ==========================================
router.post('/:id/responder', async (req, res) => {
  const { id } = req.params;
  const { mensaje_respuesta, archivo_url, archivo_nombre, archivo_tipo } = req.body; // <--- Nuevos campos
  const user = req.session.user;

  // Validación: Debe haber texto O archivo
  const tieneMensaje = mensaje_respuesta && mensaje_respuesta.trim().length > 0;
  const tieneArchivo = archivo_url && archivo_url.trim().length > 0;

  if (!tieneMensaje && !tieneArchivo) {
    return res.status(400).send('El mensaje o el archivo son obligatorios.');
  }

  try {
    const [results] = await db.query(`SELECT solicitante_email, titulo FROM tickets WHERE id = ?`, [id]);
    if (results.length === 0) return res.status(404).send('Ticket no encontrado');

    const ticket = results[0];
    const isAdmin = user.role === 'admin';
    const isOwner = user.email === ticket.solicitante_email;

    if (!isAdmin && !isOwner) return res.status(403).send('Sin permiso.');

    let remitenteNombre = isAdmin ? 'Soporte' : (user.username || user.first_name);
    let emailDestino = isAdmin ? ticket.solicitante_email : process.env.ADMIN_NOTIFY_EMAIL;
    let asuntoEmail = `Nueva respuesta en Ticket #${id}: ${ticket.titulo}`;

    await db.query(
      `INSERT INTO ticket_respuestas (ticket_id, mensaje, remitente, archivo_url, archivo_nombre, archivo_tipo) VALUES (?, ?, ?, ?, ?, ?)`, 
      [id, mensaje_respuesta, remitenteNombre, archivo_url || null, archivo_nombre || null, archivo_tipo || null]
    );

    if (emailDestino) {
      let cuerpoCorreo = `Nueva respuesta de ${remitenteNombre}:\n\n${mensaje_respuesta}`;
      if (tieneArchivo) cuerpoCorreo += `\n\n[Se ha adjuntado un archivo: ${archivo_nombre}]`;
      
      sendMail({
        to: emailDestino,
        subject: asuntoEmail,
        text: cuerpoCorreo + EMAIL_FOOTER
      }).catch(console.error);
    }

    res.redirect(`/sistemas/tickets/${id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error procesando respuesta.');
  }
});

module.exports = router;
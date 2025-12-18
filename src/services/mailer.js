// src/services/mailer.js
const nodemailer = require('nodemailer');

// Brevo utiliza SMTP estándar. OnRender permite el puerto 587 sin problemas.
const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS 
  }
});

// Verificación opcional para asegurar que la conexión es correcta al iniciar
transporter.verify((error, success) => {
  if (error) {
    console.error('Error en la configuración de Brevo:', error);
  } else {
    console.log('Servidor de correos (Brevo) listo');
  }
});

module.exports = transporter;

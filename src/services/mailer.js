// src/services/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com', // 
  port: 587, // 
  secure: false, // false para puerto 587; true para 465
  auth: {
    user: process.env.SMTP_USER, // Tu usuario: 9e32ca001@smtp-brevo.com 
    pass: process.env.SMTP_PASS  // Tu API Key: xkeysib-...
  },
  // Configuraciones adicionales para evitar Timeouts en OnRender
  connectionTimeout: 10000, // 10 segundos
  greetingTimeout: 10000,
  tls: {
    // Esto ayuda si hay problemas con los certificados en el entorno de red
    rejectUnauthorized: false 
  }
});

transporter.verify((error, success) => {
  if (error) {
    console.error('Error en la configuración de Brevo:', error);
  } else {
    console.log('Servidor de correos (Brevo) conectado exitosamente');
  }
});

module.exports = transporter;
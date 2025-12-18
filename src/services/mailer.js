// src/services/mailer.js
const Brevo = require('@getbrevo/brevo');

// Configuración de la API de Brevo
const apiInstance = new Brevo.TransactionalEmailsApi();
apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.SMTP_PASS);

/**
 * Función para enviar correos usando la API (evita errores de conexión SMTP)
 */
const sendMail = async ({ to, subject, text }) => {
  const sendSmtpEmail = new Brevo.SendSmtpEmail();

  sendSmtpEmail.subject = subject;
  sendSmtpEmail.textContent = text;
  sendSmtpEmail.sender = { 
    name: "Intranet Transworld", 
    email: process.env.MAIL_FROM // dchiappe@transworld.cl 
  };
  sendSmtpEmail.to = [{ email: to }];

  try {
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('Correo enviado exitosamente vía API:', data.body);
    return data;
  } catch (error) {
    console.error('Error al enviar vía API de Brevo:', error);
    throw error;
  }
};

module.exports = { sendMail };
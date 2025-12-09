// src/services/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.office365.com',
  port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
  secure: false, 
  auth: {
    user: process.env.SMTP_USER || 'dchiappe@transworld.cl',
    pass: process.env.SMTP_PASS || 'X@533442674582uh'
  }
});

module.exports = transporter;

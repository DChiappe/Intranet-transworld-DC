// src/services/mailer.js
const nodemailer = require('nodemailer');
const mg = require('nodemailer-mailgun-transport');


const mailgunOptions = {
  auth: {
    api_key: process.env.MAILGUN_API_KEY,
    domain: process.env.MAILGUN_DOMAIN
  }
}

const transporter = nodemailer.createTransport(mg(mailgunOptions));

module.exports = transporter;

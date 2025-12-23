const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../db');
// Importar el transporter actualizado
const { sendMail } = require('../services/mailer');

function getBaseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function pbkdf2Hash(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  const derived = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256');
  return derived.toString('hex');
}

function safeEqualHex(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// GET /login
router.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');

  const info =
    req.query.registered === '1'
      ? 'Registro creado. Revisa tu correo para confirmar la cuenta.'
      : req.query.confirmed === '1'
      ? 'Correo confirmado. Cuando se te asigne un rol podrás iniciar sesión.'
      : req.query.exists === '1'
      ? 'Ese correo ya está registrado. Inicia sesión.'
      : null;

  res.render('login', {
    titulo: 'Iniciar sesión',
    error: null,
    info,
    layout: false // <--- ESTO DESACTIVA EL LAYOUT
  });
});

// POST /login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.AUTH_USER || 'admin';
  const validPass = process.env.AUTH_PASS || '1234';

  // Login de respaldo (hardcoded)
  if (username === validUser && password === validPass) {
    req.session.user = { id: 0, username: validUser, role: 'admin', email: null };
    return res.redirect('/');
  }

  try {
    const email = String(username || '').trim().toLowerCase();
    const [rows] = await pool.query(
      'SELECT id, first_name, last_name, email, role, email_confirmed, password_hash, password_salt FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    if (!rows.length) {
      return res.status(401).render('login', {
        titulo: 'Iniciar sesión',
        error: 'Usuario o contraseña incorrectos',
        info: null,
        layout: false // <--- ESTO DESACTIVA EL LAYOUT
      });
    }

    const u = rows[0];

    if (!u.role || String(u.role).trim() === '') {
      return res.status(403).render('login', {
        titulo: 'Iniciar sesión',
        error: 'Tu cuenta está registrada, pero aún no tiene un rol asignado. Contacta al administrador para habilitar el acceso.',
        info: null,
        layout: false // <--- ESTO DESACTIVA EL LAYOUT
      });
    }

    const computed = pbkdf2Hash(password, u.password_salt);
    if (!safeEqualHex(computed, u.password_hash)) {
      return res.status(401).render('login', {
        titulo: 'Iniciar sesión',
        error: 'Usuario o contraseña incorrectos',
        info: null,
        layout: false // <--- ESTO DESACTIVA EL LAYOUT
      });
    }

    req.session.user = {
      id: u.id,
      username: `${u.first_name} ${u.last_name}`.trim(),
      email: u.email,
      role: u.role || null
    };

    return res.redirect('/');
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).render('login', {
      titulo: 'Iniciar sesión',
      error: 'Error interno. Intenta nuevamente.',
      info: null,
      layout: false // <--- ESTO DESACTIVA EL LAYOUT
    });
  }
});

// GET /register
router.get('/register', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.render('register', { 
    titulo: 'Registro', 
    error: null,
    layout: false // <--- ESTO DESACTIVA EL LAYOUT
  });
});

// POST /register
router.post('/register', async (req, res) => {
  try {
    const firstName = String(req.body.first_name || '').trim();
    const lastName = String(req.body.last_name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const password2 = String(req.body.password2 || '');

    if (!firstName || !lastName || !email || !password || !password2) {
      return res.status(400).render('register', { 
        titulo: 'Registro', 
        error: 'Todos los campos son obligatorios.',
        layout: false // <--- ESTO DESACTIVA EL LAYOUT
      });
    }

    if (password.length < 6) {
      return res.status(400).render('register', { 
        titulo: 'Registro', 
        error: 'La contraseña debe tener al menos 6 caracteres.',
        layout: false // <--- ESTO DESACTIVA EL LAYOUT
      });
    }

    if (password !== password2) {
      return res.status(400).render('register', { 
        titulo: 'Registro', 
        error: 'Las contraseñas no coinciden.',
        layout: false // <--- ESTO DESACTIVA EL LAYOUT
      });
    }

    const [exists] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (exists.length) {
      return res.redirect('/login?exists=1');
    }

    const saltHex = crypto.randomBytes(16).toString('hex');
    const hashHex = pbkdf2Hash(password, saltHex);
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO users
        (first_name, last_name, email, password_hash, password_salt, role, email_confirmed, confirm_token, confirm_expires)
       VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
      [firstName, lastName, email, hashHex, saltHex, token, expires]
    );

    const confirmUrl = `${getBaseUrl(req)}/confirm?token=${token}`;

    // Enviar correo de confirmación
    await sendMail({
      to: email,
      subject: 'Confirma tu correo - Intranet Transworld',
      text: `Hola ${firstName},\n\nPara activar tu cuenta, confirma tu correo en este enlace:\n${confirmUrl}\n\nSi no solicitaste este registro, puedes ignorar este mensaje.\n`,
    });

    if (process.env.ADMIN_NOTIFY_EMAIL) {
      sendMail({
        to: process.env.ADMIN_NOTIFY_EMAIL,
        subject: 'Nuevo usuario pendiente de rol',
        text: `Nuevo registro:\nNombre: ${firstName} ${lastName}\nEmail: ${email}\nAcción sugerida: asignar rol en /roles\n`,
      }).catch(() => {});
    }

    return res.redirect('/login?registered=1');
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).render('register', { 
      titulo: 'Registro', 
      error: 'Error interno al registrar. Intenta nuevamente.',
      layout: false // <--- ESTO DESACTIVA EL LAYOUT
    });
  }
});

// GET /confirm?token=...
router.get('/confirm', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) {
      return res.status(400).render('confirm', { 
        titulo: 'Confirmación', 
        ok: false, 
        message: 'Token inválido.',
        layout: false // <--- ESTO DESACTIVA EL LAYOUT
      });
    }

    const [rows] = await pool.query(
      'SELECT id, confirm_expires, email_confirmed FROM users WHERE confirm_token = ? LIMIT 1',
      [token]
    );

    if (!rows.length) {
      return res.status(400).render('confirm', { 
        titulo: 'Confirmación', 
        ok: false, 
        message: 'Token inválido o expirado.',
        layout: false // <--- ESTO DESACTIVA EL LAYOUT
      });
    }

    const u = rows[0];
    if (u.email_confirmed) {
      return res.render('confirm', { 
        titulo: 'Confirmación', 
        ok: true, 
        message: 'Tu correo ya estaba confirmado. Ya puedes iniciar sesión.',
        layout: false // <--- ESTO DESACTIVA EL LAYOUT
      });
    }

    const exp = u.confirm_expires ? new Date(u.confirm_expires) : null;
    if (!exp || exp.getTime() < Date.now()) {
      return res.status(400).render('confirm', { 
        titulo: 'Confirmación', 
        ok: false, 
        message: 'Este enlace expiró. Regístrate nuevamente para recibir otro.',
        layout: false // <--- ESTO DESACTIVA EL LAYOUT
      });
    }

    await pool.query(
      'UPDATE users SET email_confirmed = 1, confirm_token = NULL, confirm_expires = NULL WHERE id = ?',
      [u.id]
    );

    return res.render('confirm', { 
      titulo: 'Confirmación', 
      ok: true, 
      message: 'Correo confirmado correctamente. Ya puedes iniciar sesión.',
      layout: false // <--- ESTO DESACTIVA EL LAYOUT
    });
  } catch (err) {
    console.error('Confirm error:', err);
    return res.status(500).render('confirm', { 
      titulo: 'Confirmación', 
      ok: false, 
      message: 'Error interno al confirmar. Intenta nuevamente.',
      layout: false // <--- ESTO DESACTIVA EL LAYOUT
    });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
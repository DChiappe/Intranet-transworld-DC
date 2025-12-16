const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const pool = require('../db');
const transporter = require('../services/mailer');

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
      ? 'Correo confirmado. Ya puedes iniciar sesión.'
      : req.query.exists === '1'
      ? 'Ese correo ya está registrado. Inicia sesión.'
      : null;

  res.render('login', {
    titulo: 'Iniciar sesión',
    error: null,
    info
  });
});

// POST /login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // 1) Compatibilidad con login "legacy" por .env (admin fijo)
  const validUser = process.env.AUTH_USER || 'admin';
  const validPass = process.env.AUTH_PASS || '1234';

  if (username === validUser && password === validPass) {
    req.session.user = { id: 0, username: validUser, role: 'admin', email: null };
    return res.redirect('/');
  }

  // 2) Login por BD (email)
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
        info: null
      });
    }

    const u = rows[0];

    /*if (!u.email_confirmed) {
      return res.status(401).render('login', {
        titulo: 'Iniciar sesión',
        error: 'Debes confirmar tu correo antes de ingresar.',
        info: null
      });
    } */

    // Requisito: si no tiene rol asignado, NO puede iniciar sesión
    if (!u.role || String(u.role).trim() === '') {
      return res.status(403).render('login', {
        titulo: 'Iniciar sesión',
        error: 'Tu cuenta está registrada, pero aún no tiene un rol asignado. Contacta al administrador para habilitar el acceso.',
        info: null
      });
    }


    const computed = pbkdf2Hash(password, u.password_salt);

    if (!safeEqualHex(computed, u.password_hash)) {
      return res.status(401).render('login', {
        titulo: 'Iniciar sesión',
        error: 'Usuario o contraseña incorrectos',
        info: null
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
      info: null
    });
  }
});

// GET /register
router.get('/register', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');

  res.render('register', {
    titulo: 'Registro',
    error: null
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
        error: 'Todos los campos son obligatorios.'
      });
    }

    if (password.length < 6) {
      return res.status(400).render('register', {
        titulo: 'Registro',
        error: 'La contraseña debe tener al menos 6 caracteres.'
      });
    }

    if (password !== password2) {
      return res.status(400).render('register', {
        titulo: 'Registro',
        error: 'Las contraseñas no coinciden.'
      });
    }

    // Si ya existe, redirigir a login
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

    // Enviar correo de confirmación
    const confirmUrl = `${getBaseUrl(req)}/confirm?token=${token}`;

    await transporter.sendMail({
      from: process.env.MAIL_FROM || `Intranet <no-reply@${process.env.MAILGUN_DOMAIN}>`,
      to: email,
      subject: 'Confirma tu correo - Intranet Transworld',
      text:
        `Hola ${firstName},\n\n` +
        `Para activar tu cuenta, confirma tu correo en este enlace:\n${confirmUrl}\n\n` +
        `Si no solicitaste este registro, puedes ignorar este mensaje.\n`,
    });

    // Notificar admin (opcional)
    if (process.env.ADMIN_NOTIFY_EMAIL) {
      transporter.sendMail({
        from: process.env.MAIL_FROM || `Intranet <no-reply@${process.env.MAILGUN_DOMAIN}>`,
        to: process.env.ADMIN_NOTIFY_EMAIL,
        subject: 'Nuevo usuario pendiente de rol',
        text:
          `Nuevo registro:\n` +
          `Nombre: ${firstName} ${lastName}\n` +
          `Email: ${email}\n` +
          `Acción sugerida: asignar rol en /roles\n`,
      }).catch(() => {});
    }

    return res.redirect('/login?registered=1');
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).render('register', {
      titulo: 'Registro',
      error: 'Error interno al registrar. Intenta nuevamente.'
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
        message: 'Token inválido.'
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
        message: 'Token inválido o expirado.'
      });
    }

    const u = rows[0];
    if (u.email_confirmed) {
      return res.render('confirm', {
        titulo: 'Confirmación',
        ok: true,
        message: 'Tu correo ya estaba confirmado. Ya puedes iniciar sesión.'
      });
    }

    const exp = u.confirm_expires ? new Date(u.confirm_expires) : null;
    if (!exp || exp.getTime() < Date.now()) {
      return res.status(400).render('confirm', {
        titulo: 'Confirmación',
        ok: false,
        message: 'Este enlace expiró. Regístrate nuevamente para recibir otro.'
      });
    }

    await pool.query(
      'UPDATE users SET email_confirmed = 1, confirm_token = NULL, confirm_expires = NULL WHERE id = ?',
      [u.id]
    );

    return res.render('confirm', {
      titulo: 'Confirmación',
      ok: true,
      message: 'Correo confirmado correctamente. Ya puedes iniciar sesión.'
    });
  } catch (err) {
    console.error('Confirm error:', err);
    return res.status(500).render('confirm', {
      titulo: 'Confirmación',
      ok: false,
      message: 'Error interno al confirmar. Intenta nuevamente.'
    });
  }
});

// GET /logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;

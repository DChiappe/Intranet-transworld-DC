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

// ==========================================
// LOGIN & REGISTRO
// ==========================================

router.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');

  const info =
    req.query.registered === '1'
      ? 'Registro creado. Revisa tu correo para confirmar la cuenta.'
      : req.query.confirmed === '1'
      ? 'Correo confirmado. Ya puedes iniciar sesión.'
      : req.query.exists === '1'
      ? 'Ese correo ya está registrado. Inicia sesión.'
      : req.query.reset === '1'
      ? 'Se ha enviado una nueva contraseña a tu correo.'
      : req.query.changed === '1'
      ? 'Contraseña actualizada correctamente.'
      : null;

  res.render('login', {
    titulo: 'Iniciar sesión',
    error: null,
    info,
    layout: false 
  });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.AUTH_USER || 'admin';
  const validPass = process.env.AUTH_PASS || '1234';

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
        layout: false
      });
    }

    const u = rows[0];

    if (!u.role || String(u.role).trim() === '') {
      return res.status(403).render('login', {
        titulo: 'Iniciar sesión',
        error: 'Tu cuenta está registrada, pero aún no tiene un rol asignado. Contacta al administrador para habilitar el acceso.',
        info: null,
        layout: false
      });
    }

    const computed = pbkdf2Hash(password, u.password_salt);
    if (!safeEqualHex(computed, u.password_hash)) {
      return res.status(401).render('login', {
        titulo: 'Iniciar sesión',
        error: 'Usuario o contraseña incorrectos',
        info: null,
        layout: false
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
      layout: false
    });
  }
});

router.get('/register', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.render('register', { 
    titulo: 'Registro', 
    error: null,
    layout: false 
  });
});

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
        layout: false
      });
    }

    if (password.length < 6) {
      return res.status(400).render('register', { 
        titulo: 'Registro', 
        error: 'La contraseña debe tener al menos 6 caracteres.',
        layout: false
      });
    }

    if (password !== password2) {
      return res.status(400).render('register', { 
        titulo: 'Registro', 
        error: 'Las contraseñas no coinciden.',
        layout: false
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
      layout: false
    });
  }
});

router.get('/confirm', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) {
      return res.status(400).render('confirm', { 
        titulo: 'Confirmación', 
        ok: false, 
        message: 'Token inválido.',
        layout: false
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
        layout: false 
      });
    }

    const u = rows[0];
    if (u.email_confirmed) {
      return res.render('confirm', { 
        titulo: 'Confirmación', 
        ok: true, 
        message: 'Tu correo ya estaba confirmado. Ya puedes iniciar sesión.',
        layout: false 
      });
    }

    const exp = u.confirm_expires ? new Date(u.confirm_expires) : null;
    if (!exp || exp.getTime() < Date.now()) {
      return res.status(400).render('confirm', { 
        titulo: 'Confirmación', 
        ok: false, 
        message: 'Este enlace expiró. Regístrate nuevamente para recibir otro.',
        layout: false 
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
      layout: false 
    });
  } catch (err) {
    console.error('Confirm error:', err);
    return res.status(500).render('confirm', { 
      titulo: 'Confirmación', 
      ok: false, 
      message: 'Error interno al confirmar. Intenta nuevamente.',
      layout: false 
    });
  }
});

// ==========================================
// RECUPERAR CONTRASEÑA (Forgot Password)
// ==========================================

router.get('/forgot-password', (req, res) => {
  res.render('forgot_password', { 
    titulo: 'Recuperar contraseña',
    error: null,
    layout: false 
  });
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    const cleanEmail = String(email || '').trim().toLowerCase();
    
    // Verificar si el usuario existe
    const [rows] = await pool.query('SELECT id, first_name FROM users WHERE email = ?', [cleanEmail]);
    
    if (!rows.length) {
      // Por seguridad, no decimos si el correo existe o no, pero redirigimos como si hubiera funcionado
      return res.redirect('/login?reset=1');
    }

    const user = rows[0];

    // Generar nueva contraseña aleatoria (8 caracteres)
    const newPassword = crypto.randomBytes(4).toString('hex');
    const saltHex = crypto.randomBytes(16).toString('hex');
    const hashHex = pbkdf2Hash(newPassword, saltHex);

    // Guardar nueva contraseña en BD
    await pool.query(
      'UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?',
      [hashHex, saltHex, user.id]
    );

    // Enviar correo con la nueva contraseña
    await sendMail({
      to: cleanEmail,
      subject: 'Recuperación de contraseña - Intranet Transworld',
      text: `Hola ${user.first_name},\n\nSe ha solicitado restablecer tu contraseña. Tu nueva contraseña temporal es:\n\n${newPassword}\n\nPor favor inicia sesión y cámbiala lo antes posible.\n\nSaludos,\nEquipo Transworld`
    });

    res.redirect('/login?reset=1');

  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).render('forgot_password', {
      titulo: 'Recuperar contraseña',
      error: 'Error interno. Intenta nuevamente.',
      layout: false
    });
  }
});

// ==========================================
// CAMBIAR CONTRASEÑA (Change Password)
// ==========================================

router.get('/change-password', (req, res) => {
  // Verificar sesión (aunque auth.js sea público, esta ruta requiere login)
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  res.render('change_password', {
    titulo: 'Cambiar contraseña',
    error: null
  });
});

router.post('/change-password', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }

  const { old_password, new_password, confirm_password } = req.body;
  const userId = req.session.user.id;

  try {
    if (new_password !== confirm_password) {
      return res.render('change_password', {
        titulo: 'Cambiar contraseña',
        error: 'Las nuevas contraseñas no coinciden.'
      });
    }

    if (new_password.length < 6) {
      return res.render('change_password', {
        titulo: 'Cambiar contraseña',
        error: 'La nueva contraseña debe tener al menos 6 caracteres.'
      });
    }

    // Obtener contraseña actual de la BD
    const [rows] = await pool.query('SELECT password_hash, password_salt FROM users WHERE id = ?', [userId]);
    if (!rows.length) return res.redirect('/login');

    const u = rows[0];

    // Verificar contraseña antigua
    const computed = pbkdf2Hash(old_password, u.password_salt);
    if (!safeEqualHex(computed, u.password_hash)) {
      return res.render('change_password', {
        titulo: 'Cambiar contraseña',
        error: 'La contraseña actual es incorrecta.'
      });
    }

    // Generar nuevo hash
    const newSalt = crypto.randomBytes(16).toString('hex');
    const newHash = pbkdf2Hash(new_password, newSalt);

    // Actualizar BD
    await pool.query(
      'UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?',
      [newHash, newSalt, userId]
    );

    res.redirect('/login?changed=1');

  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).render('change_password', {
      titulo: 'Cambiar contraseña',
      error: 'Error interno al actualizar la contraseña.'
    });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
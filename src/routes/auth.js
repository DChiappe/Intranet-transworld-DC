const express = require('express');
const router = express.Router();

// GET /login
router.get('/login', (req, res) => {
  // Si ya está logueado, lo mando al inicio
  if (req.session && req.session.user) {
    return res.redirect('/');
  }

  res.render('login', {
    titulo: 'Iniciar sesión',
    error: null
  });
});

// POST /login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  const validUser = process.env.AUTH_USER || 'admin';
  const validPass = process.env.AUTH_PASS || '1234';

  if (username === validUser && password === validPass) {
    // guardar usuario en sesión
    req.session.user = { username };
    return res.redirect('/');
  }

  return res.status(401).render('login', {
    titulo: 'Iniciar sesión',
    error: 'Usuario o contraseña incorrectos'
  });
});

// GET /logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;

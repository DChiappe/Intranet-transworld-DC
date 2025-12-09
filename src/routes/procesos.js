const express = require('express');
const router = express.Router();

// GET /procesos  → pestaña base
router.get('/', (req, res) => {
  res.render('procesos/index', {
    titulo: 'Procesos y Documentos'
  });
});

// GET /procesos/procedimientos
router.get('/procedimientos', (req, res) => {
  res.render('procesos/procedimientos', {
    titulo: 'Procedimientos'
  });
});

// GET /procesos/protocolos
router.get('/protocolos', (req, res) => {
  res.render('procesos/protocolos', {
    titulo: 'Protocolos'
  });
});

// GET /procesos/reglamento
router.get('/reglamento', (req, res) => {
  res.render('procesos/reglamento', {
    titulo: 'Reglamento interno'
  });
});

// GET /procesos/achs
router.get('/achs', (req, res) => {
  res.render('procesos/achs', {
    titulo: 'ACHS y procedimientos por accidentes'
  });
});

module.exports = router;

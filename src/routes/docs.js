// src/routes/docs.js
const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const DOCS_ROOT = path.join(__dirname, '..', 'uploads', 'docs');
const ALLOWED_SECTIONS = new Set(['procedimientos', 'protocolos', 'achs', 'reglamento']);

function safeFilename(name) {
  const base = path.basename(String(name || '')); // evita ../
  return base.replace(/[^\w.\-() ]+/g, '').replace(/\s+/g, '_').slice(0, 160);
}

router.get('/:section/:filename', (req, res) => {
  const section = String(req.params.section || '');
  if (!ALLOWED_SECTIONS.has(section)) return res.status(404).send('Sección no encontrada');

  const filename = safeFilename(req.params.filename);
  if (!filename) return res.status(400).send('Archivo inválido');

  const filePath = path.join(DOCS_ROOT, section, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Archivo no encontrado');

  return res.download(filePath, filename);
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../db');

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const requireRole = require('../middlewares/requireRole');

const ORG_DIR = path.join(__dirname, '..', 'public', 'img', 'organigrama');
if (!fs.existsSync(ORG_DIR)) fs.mkdirSync(ORG_DIR, { recursive: true });

function getOrganigramaUrl() {
  // Busca un archivo cargado en /public/img/organigrama/
  const files = fs.readdirSync(ORG_DIR, { withFileTypes: true })
    .filter(d => d.isFile())
    .map(d => d.name)
    .filter(n => /\.(png|jpe?g|webp|pdf)$/i.test(n))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) return null;
  return `/img/organigrama/${encodeURIComponent(files[0])}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ORG_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp', '.pdf']);
    const safeExt = allowed.has(ext) ? ext : '.bin';
    cb(null, `organigrama_${Date.now()}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(png|jpe?g|webp|pdf)$/i.test(file.originalname);
    if (!ok) return cb(new Error('Formato no permitido (solo PNG/JPG/WEBP/PDF)'));
    cb(null, true);
  }
});

// GET /personas  → página principal + cumpleaños
router.get('/', async (req, res) => {
  const sql = `
    SELECT nombre, area, fecha_nacimiento
    FROM cumpleanios
    ORDER BY MONTH(fecha_nacimiento), DAY(fecha_nacimiento)
  `;

  try {
    const [results] = await db.query(sql);

    res.render('personas/index', {
      titulo: 'Personas y Cultura',
      personas: results
    });
  } catch (err) {
    console.error('Error consultando personas:', err);
    res.status(500).send('Error consultando personas');
  }
});

// GET /personas/organigrama
router.get('/organigrama', (req, res) => {
  const organigramaUrl = getOrganigramaUrl();
  res.render('personas/organigrama', {
    titulo: 'Organigrama',
    organigramaUrl
  });
});

// POST /personas/organigrama/subir  (solo admin/rrhh)
router.post('/organigrama/subir', requireRole('admin', 'rrhh'), (req, res) => {
  upload.single('organigrama')(req, res, (err) => {
    if (err) {
      console.error('Error subiendo organigrama:', err.message);
      return res.status(400).send(err.message);
    }

    // Limpia archivos antiguos (deja solo el nuevo)
    try {
      const current = req.file?.filename;
      const files = fs.readdirSync(ORG_DIR);
      files.forEach((f) => {
        if (f !== current) {
          try { fs.unlinkSync(path.join(ORG_DIR, f)); } catch {}
        }
      });
    } catch {}

    return res.redirect('/personas/organigrama');
  });
});

// POST /personas/organigrama/eliminar (solo admin/rrhh)
router.post('/organigrama/eliminar', requireRole('admin', 'rrhh'), (req, res) => {
  try {
    const files = fs.readdirSync(ORG_DIR);
    files.forEach((f) => {
      try { fs.unlinkSync(path.join(ORG_DIR, f)); } catch {}
    });
  } catch (e) {
    console.error('Error eliminando organigrama:', e);
  }
  return res.redirect('/personas/organigrama');
});

module.exports = router;

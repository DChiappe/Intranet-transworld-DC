const express = require('express');
const router = express.Router();

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const requireRole = require('../middlewares/requireRole');

const DOCS_ROOT = path.join(__dirname, '..', 'uploads', 'docs');

const SECTION_CONFIG = {
  procedimientos: { title: 'Procedimientos', writeRoles: ['admin', 'control_y_seguridad', 'teresa'] },
  protocolos: { title: 'Protocolos', writeRoles: ['admin', 'control_y_seguridad'] },
  achs: { title: 'ACHS y procedimientos por accidentes', writeRoles: ['admin', 'teresa'] },
  reglamento: { title: 'Reglamento interno', writeRoles: ['admin', 'teresa'] },
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeFilename(name) {
  const base = path.basename(String(name || ''));
  return base.replace(/[^\w.\-() ]+/g, '').replace(/\s+/g, '_').slice(0, 160);
}

function sectionDir(section) {
  return path.join(DOCS_ROOT, section);
}

// Crear carpetas base
ensureDir(DOCS_ROOT);
Object.keys(SECTION_CONFIG).forEach((s) => ensureDir(sectionDir(s)));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const section = req.params.section;
    const dir = sectionDir(section);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const stamp = Date.now();
    const cleaned = safeFilename(file.originalname);
    cb(null, `${stamp}_${cleaned}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    // Permite docs e imágenes típicas
    const ok = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|png|jpe?g|webp)$/i.test(file.originalname);
    if (!ok) return cb(new Error('Tipo de archivo no permitido'));
    return cb(null, true);
  },
});

// GET /procesos
router.get('/', (req, res) => {
  res.render('procesos/index', { titulo: 'Procesos y Documentos' });
});

// Helper para render por sección
function renderSection(section, viewPath) {
  return (req, res) => {
    const dir = sectionDir(section);
    let archivos = [];
    try {
      archivos = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b));
    } catch (e) {
      console.error('Error listando archivos:', e);
    }

    res.render(viewPath, {
      titulo: SECTION_CONFIG[section].title,
      archivos,
    });
  };
}

// GET vistas
router.get('/procedimientos', renderSection('procedimientos', 'procesos/procedimientos'));
router.get('/protocolos', renderSection('protocolos', 'procesos/protocolos'));
router.get('/achs', renderSection('achs', 'procesos/achs'));
router.get('/reglamento', renderSection('reglamento', 'procesos/reglamento'));

/**
 * POST /procesos/:section/subir
 * - input name="archivo"
 */
router.post('/:section/subir', (req, res, next) => {
  const section = String(req.params.section || '');
  if (!SECTION_CONFIG[section]) return res.status(404).send('Sección no encontrada');

  return requireRole(...SECTION_CONFIG[section].writeRoles)(req, res, () => {
    upload.single('archivo')(req, res, (err) => {
      if (err) {
        console.error('Error subiendo archivo:', err.message);
        return res.status(400).send(err.message);
      }
      return res.redirect(`/procesos/${section}`);
    });
  });
});

/**
 * POST /procesos/:section/:filename/eliminar
 */
router.post('/:section/:filename/eliminar', (req, res) => {
  const section = String(req.params.section || '');
  if (!SECTION_CONFIG[section]) return res.status(404).send('Sección no encontrada');

  // permiso por rol
  const gate = requireRole(...SECTION_CONFIG[section].writeRoles);
  gate(req, res, () => {
    const filename = safeFilename(req.params.filename);
    if (!filename) return res.status(400).send('Archivo inválido');

    const filePath = path.join(sectionDir(section), filename);
    if (!fs.existsSync(filePath)) return res.redirect(`/procesos/${section}`);

    fs.unlink(filePath, (err) => {
      if (err) console.error('Error eliminando archivo:', err);
      return res.redirect(`/procesos/${section}`);
    });
  });
});

module.exports = router;

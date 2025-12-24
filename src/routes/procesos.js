const express = require('express');
const router = express.Router();
const db = require('../db'); 
const multer = require('multer');
const cloudinary = require('../services/cloudinary');
const requireRole = require('../middlewares/requireRole');

const SECTION_CONFIG = {
  procedimientos: { title: 'Procedimientos', writeRoles: ['admin', 'control_y_seguridad', 'teresa'] },
  protocolos: { title: 'Protocolos', writeRoles: ['admin', 'control_y_seguridad'] },
  achs: { title: 'ACHS y procedimientos por accidentes', writeRoles: ['admin', 'teresa'] },
  reglamento: { title: 'Reglamento interno', writeRoles: ['admin', 'teresa'] },
};

const storage = multer.memoryStorage();
const upload = multer({ storage });

// --- Helper limpieza ---
async function limpiarHistorial() {
  try {
    const sql = `DELETE FROM historial_cambios WHERE id NOT IN (SELECT id FROM (SELECT id FROM historial_cambios ORDER BY fecha DESC LIMIT 5) as t)`;
    await db.query(sql);
  } catch (e) { console.error(e); }
}

router.get('/', (req, res) => {
  res.render('procesos/index', { titulo: 'Procesos y Documentos' });
});

async function listarArchivosCloudinary(section) {
  const prefix = `docs/${section}/`;
  try {
    const [images, raws] = await Promise.all([
      cloudinary.api.resources({ type: 'upload', prefix, resource_type: 'image', max_results: 100 }),
      cloudinary.api.resources({ type: 'upload', prefix, resource_type: 'raw', max_results: 100 })
    ]);
    const all = [...(images.resources || []), ...(raws.resources || [])];
    return all.map(res => ({
      name: res.public_id.split('/').pop(),
      public_id: res.public_id,
      url: res.secure_url,
      format: res.format,
      resource_type: res.resource_type
    })).sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error(`Nota: No se encontraron archivos para ${section}`, err.message);
    return [];
  }
}

function renderSection(section, viewPath) {
  return async (req, res) => {
    const archivos = await listarArchivosCloudinary(section);
    res.render(viewPath, { titulo: SECTION_CONFIG[section].title, archivos });
  };
}

router.get('/procedimientos', renderSection('procedimientos', 'procesos/procedimientos'));
router.get('/protocolos', renderSection('protocolos', 'procesos/protocolos'));
router.get('/reglamento', renderSection('reglamento', 'procesos/reglamento'));

router.post('/:section/subir', (req, res, next) => {
  const section = String(req.params.section || '');
  if (!SECTION_CONFIG[section]) return res.status(404).send('Sección no encontrada');

  return requireRole(...SECTION_CONFIG[section].writeRoles)(req, res, () => {
    upload.single('archivo')(req, res, async (err) => {
      if (err) return res.status(400).send('Error de subida');
      if (!req.file) return res.status(400).send('Falta el archivo');

      try {
        await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: `docs/${section}`, resource_type: 'auto', use_filename: true, unique_filename: true },
            (error, result) => { if (error) reject(error); else resolve(result); }
          );
          stream.end(req.file.buffer);
        });

        // --- GUARDAR EN HISTORIAL Y LIMPIAR ---
        if (req.session.user && req.session.user.id) {
          await db.query(
            'INSERT INTO historial_cambios (usuario_id, accion, seccion, enlace) VALUES (?, ?, ?, ?)',
            [req.session.user.id, 'subió un archivo', SECTION_CONFIG[section].title, `/procesos/${section}`]
          );
          await limpiarHistorial();
        }
        // --------------------------------------

        res.redirect(`/procesos/${section}`);
      } catch (cloudErr) {
        console.error(cloudErr);
        res.status(500).send('Error subiendo a la nube');
      }
    });
  });
});

router.post('/:section/:filename/eliminar', async (req, res) => {
  const section = String(req.params.section || '');
  if (!SECTION_CONFIG[section]) return res.status(404).send('Sección no encontrada');
  
  let public_id = req.body.public_id;
  if (!public_id) {
    const filename = req.params.filename; 
    public_id = `docs/${section}/${filename.split('.')[0]}`; 
  }

  const gate = requireRole(...SECTION_CONFIG[section].writeRoles);
  gate(req, res, async () => {
    try {
      await cloudinary.uploader.destroy(public_id, { resource_type: 'image' });
      await cloudinary.uploader.destroy(public_id, { resource_type: 'raw' });
      res.redirect(`/procesos/${section}`);
    } catch (err) {
      console.error('Error eliminando:', err);
      res.status(500).send('Error al eliminar');
    }
  });
});

module.exports = router;
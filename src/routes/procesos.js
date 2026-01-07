const express = require('express');
const router = express.Router();
const db = require('../db');
const cloudinary = require('../services/cloudinary');
const requireRole = require('../middlewares/requireRole');

// ==========================================
// RENDER DE VISTAS
// ==========================================
async function renderDocView(req, res, tipo, vista, titulo) {
  try {
    const [rows] = await db.query(
      'SELECT * FROM documentos WHERE tipo = ? ORDER BY fecha_creacion DESC',
      [tipo]
    );

    const archivos = rows.map(row => ({
      id: row.id,
      url: row.url,
      name: row.nombre,
      public_id: row.public_id,
      format: row.url.split('.').pop()
    }));

    res.render(vista, {
      titulo,
      archivos,
      user: req.session.user
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error interno');
  }
}

router.get('/', (req, res) =>
  res.render('procesos', { titulo: 'Procesos y Documentos' })
);

router.get('/procedimientos', (req, res) =>
  renderDocView(req, res, 'procedimiento', 'procesos/procedimientos', 'Procedimientos')
);
router.get('/protocolos', (req, res) =>
  renderDocView(req, res, 'protocolo', 'procesos/protocolos', 'Protocolos')
);
router.get('/reglamento', (req, res) =>
  renderDocView(req, res, 'reglamento', 'procesos/reglamento', 'Reglamento Interno')
);

// ==========================================
// SIGNATURE PARA SUBIDA DIRECTA (PDF / DOC)
// ==========================================
router.get('/:tipo/signature', requireRole('admin', 'control_y_seguridad'), async (req, res) => {
  const { tipo } = req.params;

  const tipoMap = {
    procedimientos: 'procedimiento',
    protocolos: 'protocolo',
    reglamento: 'reglamento'
  };

  if (!tipoMap[tipo]) return res.status(400).json({ error: 'Tipo inválido' });

  const timestamp = Math.round(Date.now() / 1000);
  const folder = `documentos/${tipo}`;

  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder },
    process.env.CLOUDINARY_API_SECRET
  );

  res.json({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    signature,
    folder
  });
});

// ==========================================
// REGISTRAR DOCUMENTO (YA SUBIDO A CLOUDINARY)
// ==========================================
router.post('/:tipo/subir', requireRole('admin', 'control_y_seguridad'), async (req, res) => {
  const { tipo } = req.params;
  const { nombre_archivo, secure_url, public_id } = req.body;

  const tipoMap = {
    procedimientos: 'procedimiento',
    protocolos: 'protocolo',
    reglamento: 'reglamento'
  };

  const tipoDB = tipoMap[tipo];
  if (!tipoDB || !secure_url || !public_id) {
    return res.status(400).send('Datos inválidos');
  }

  try {
    await db.query(
      'INSERT INTO documentos (nombre, tipo, url, public_id, usuario_id) VALUES (?, ?, ?, ?, ?)',
      [nombre_archivo, tipoDB, secure_url, public_id, req.session.user.id]
    );

    await db.query(
      'INSERT INTO historial_cambios (usuario_id, accion, seccion, enlace) VALUES (?, ?, ?, ?)',
      [req.session.user.id, `subió un documento a ${tipo}`, '', `/procesos/${tipo}`]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error guardando documento');
  }
});

// ==========================================
// EDITAR NOMBRE (SIN CAMBIOS)
// ==========================================
router.post('/documento/editar', requireRole('admin', 'control_y_seguridad'), async (req, res) => {
  const { id, nuevo_nombre, return_to } = req.body;
  await db.query('UPDATE documentos SET nombre = ? WHERE id = ?', [nuevo_nombre, id]);
  res.redirect(return_to);
});

// ==========================================
// ELIMINAR (SIN CAMBIOS)
// ==========================================
router.post('/:tipo/eliminar', requireRole('admin', 'control_y_seguridad'), async (req, res) => {
  const { public_id, db_id } = req.body;
  await cloudinary.uploader.destroy(public_id, { resource_type: 'raw' });
  await db.query('DELETE FROM documentos WHERE id = ?', [db_id]);
  res.redirect(`/procesos/${req.params.tipo}`);
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const cloudinary = require('../services/cloudinary');
const requireRole = require('../middlewares/requireRole');

const storage = multer.memoryStorage();
const upload = multer({ storage });

// ==========================================
// RENDER DE VISTAS
// ==========================================
async function renderDocView(req, res, tipo, vista, titulo) {
  try {
    const sql = 'SELECT * FROM documentos WHERE tipo = ? ORDER BY fecha_creacion DESC';
    const [rows] = await db.query(sql, [tipo]);

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
    console.error(`Error cargando ${tipo}:`, err);
    res.status(500).send('Error interno');
  }
}

// ==========================================
// VISTAS PRINCIPALES
// ==========================================
router.get('/', (req, res) => res.render('procesos', { titulo: 'Procesos y Documentos' }));

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
// SIGNATURE PARA SUBIDA DIRECTA (RAW)
// ==========================================
router.get('/:tipo/signature', requireRole('admin', 'control_y_seguridad'), async (req, res) => {
  const { tipo } = req.params;

  const tipoMap = {
    procedimientos: 'procedimiento',
    protocolos: 'protocolo',
    reglamento: 'reglamento'
  };
  if (!tipoMap[tipo]) return res.status(400).json({ error: 'Tipo inválido' });

  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder = `documentos/${tipo}`;

    // Firmamos SOLO los params que efectivamente enviará el front a Cloudinary
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      process.env.CLOUDINARY_API_SECRET
    );

    return res.json({
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      timestamp,
      signature,
      folder
    });
  } catch (err) {
    console.error('Error generando signature:', err);
    return res.status(500).json({ error: 'Error generando signature' });
  }
});

// ==========================================
// SUBIR: DIRECT UPLOAD (nuevo) + LEGACY (fallback)
// ==========================================
router.post('/:tipo/subir', requireRole('admin', 'control_y_seguridad'), upload.single('archivo'), async (req, res) => {
  const { tipo } = req.params;

  const tipoMap = {
    procedimientos: 'procedimiento',
    protocolos: 'protocolo',
    reglamento: 'reglamento'
  };
  const tipoDB = tipoMap[tipo];
  if (!tipoDB) return res.status(400).send('Tipo inválido');

  const wantsJson = (req.headers.accept || '').includes('application/json') ||
                    (req.headers['content-type'] || '').includes('application/json');

  // ====== 1) MODO NUEVO: ya viene subido a Cloudinary ======
  const { nombre_archivo, secure_url, public_id } = req.body || {};
  if (!req.file && secure_url && public_id) {
    try {
      const nombre = nombre_archivo || 'Documento';

      await db.query(
        'INSERT INTO documentos (nombre, tipo, url, public_id, usuario_id) VALUES (?, ?, ?, ?, ?)',
        [nombre, tipoDB, secure_url, public_id, req.session.user.id]
      );

      if (req.session.user?.id) {
        await db.query(
          'INSERT INTO historial_cambios (usuario_id, accion, seccion, enlace) VALUES (?, ?, ?, ?)',
          [req.session.user.id, `subió un documento `, `${tipo}`, `/procesos/${tipo}`]
        );
      }

      return wantsJson ? res.json({ ok: true }) : res.redirect(`/procesos/${tipo}?ok=Documento subido exitosamente`);
    } catch (err) {
      console.error('Error guardando documento (direct):', err);
      return wantsJson ? res.status(500).json({ error: 'Error guardando documento' }) : res.status(500).send('Error al subir documento');
    }
  }

  // ====== 2) MODO LEGACY: el archivo pasa por el server ======
  if (!req.file) {
    return wantsJson ? res.status(400).json({ error: 'Faltan datos' }) : res.status(400).send('Datos inválidos');
  }

  try {
    const nombre = (req.body.nombre_archivo || req.file.originalname);

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: `documentos/${tipo}`, resource_type: 'auto' },
        (error, result) => (error ? reject(error) : resolve(result))
      );
      stream.end(req.file.buffer);
    });

    await db.query(
      'INSERT INTO documentos (nombre, tipo, url, public_id, usuario_id) VALUES (?, ?, ?, ?, ?)',
      [nombre, tipoDB, result.secure_url, result.public_id, req.session.user.id]
    );

    if (req.session.user?.id) {
      await db.query(
        'INSERT INTO historial_cambios (usuario_id, accion, seccion, enlace) VALUES (?, ?, ?, ?)',
        [req.session.user.id, `subió un archivo a ${tipo}`, '', `/procesos/${tipo}`]
      );
    }

    return wantsJson ? res.json({ ok: true }) : res.redirect(`/procesos/${tipo}?ok=Documento subido exitosamente`);
  } catch (err) {
    console.error('Error subiendo (legacy):', err);
    return wantsJson ? res.status(500).json({ error: 'Error al subir documento' }) : res.status(500).send('Error al subir documento');
  }
});

// ==========================================
// EDITAR NOMBRE (SIN CAMBIOS)
// ==========================================
router.post('/documento/editar', requireRole('admin', 'control_y_seguridad'), async (req, res) => {
  const { id, nuevo_nombre, return_to } = req.body;

  try {
    await db.query('UPDATE documentos SET nombre = ? WHERE id = ?', [nuevo_nombre, id]);
    res.redirect(`${return_to}?ok=Nombre actualizado correctamente`);
  } catch (err) {
    console.error('Error editando:', err);
    res.redirect(return_to || '/procesos');
  }
});

// ==========================================
// ELIMINAR (COMPATIBLE RAW/IMAGE)
// ==========================================
router.post('/:tipo/eliminar', requireRole('admin', 'control_y_seguridad'), async (req, res) => {
  const { public_id, db_id } = req.body;
  const { tipo } = req.params;

  try {
    if (public_id) {
      // intentamos RAW primero
      const r1 = await cloudinary.uploader.destroy(public_id, { resource_type: 'raw' });
      if (r1?.result === 'not found') {
        // compatibilidad con archivos antiguos subidos como "image"
        await cloudinary.uploader.destroy(public_id, { resource_type: 'image' });
      }
    }

    if (db_id) {
      await db.query('DELETE FROM documentos WHERE id = ?', [db_id]);
    }

    if (req.session.user?.id) {
      await db.query(
        'INSERT INTO historial_cambios (usuario_id, accion, seccion, enlace) VALUES (?, ?, ?, ?)',
        [req.session.user.id, `eliminó un archivo de ${tipo}`, '', `/procesos/${tipo}`]
      );
    }

    res.redirect(`/procesos/${tipo}?ok=Documento eliminado correctamente`);
  } catch (err) {
    console.error('Error eliminando documento:', err);
    res.status(500).send('Error eliminando documento');
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const cloudinary = require('../services/cloudinary');
const requireRole = require('../middlewares/requireRole');

const storage = multer.memoryStorage();
const upload = multer({ storage });

// ==========================================
// RUTA GENÉRICA PARA MOSTRAR VISTAS
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

router.get('/procedimientos', (req, res) => renderDocView(req, res, 'procedimiento', 'procesos/procedimientos', 'Procedimientos'));
router.get('/protocolos', (req, res) => renderDocView(req, res, 'protocolo', 'procesos/protocolos', 'Protocolos'));
router.get('/reglamento', (req, res) => renderDocView(req, res, 'reglamento', 'procesos/reglamento', 'Reglamento Interno'));

// ==========================================
// ACCIONES: SUBIR
// ==========================================
router.post('/:tipo/subir', requireRole('admin', 'control_y_seguridad'), upload.single('archivo'), async (req, res) => {
  const { tipo } = req.params;
  const nombrePersonalizado = req.body.nombre_archivo || req.file.originalname;

  const tipoMap = {
    'procedimientos': 'procedimiento',
    'protocolos': 'protocolo',
    'reglamento': 'reglamento'
  };
  const tipoDB = tipoMap[tipo];

  if (!req.file || !tipoDB) return res.status(400).send('Datos inválidos');

  try {
    // 1. Subir a Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: tipo, resource_type: 'auto' },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(req.file.buffer);
    });

    // 2. Guardar en MySQL
    await db.query(
      'INSERT INTO documentos (nombre, tipo, url, public_id, usuario_id) VALUES (?, ?, ?, ?, ?)',
      [nombrePersonalizado, tipoDB, result.secure_url, result.public_id, req.session.user.id]
    );

    // 3. REGISTRAR EN HISTORIAL (Subida)
    if (req.session.user && req.session.user.id) {
      await db.query('INSERT INTO historial_cambios (usuario_id, accion, seccion, enlace) VALUES (?, ?, ?, ?)',
        [req.session.user.id, `subió un archivo a ${tipo}`, '', `/procesos/${tipo}`]);
    }

    res.redirect(`/procesos/${tipo}?ok=Documento subido exitosamente`);

  } catch (err) {
    console.error('Error subiendo:', err);
    res.status(500).send('Error al subir documento');
  }
});

// ==========================================
// ACCIONES: EDITAR NOMBRE
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
// ACCIONES: ELIMINAR (MODIFICADO)
// ==========================================
router.post('/:tipo/eliminar', requireRole('admin', 'control_y_seguridad'), async (req, res) => {
  const { public_id, db_id } = req.body;
  const { tipo } = req.params;

  try {
    // 1. Borrar de Cloudinary
    if (public_id) {
        await cloudinary.uploader.destroy(public_id);
    }
    
    // 2. Borrar de MySQL
    if (db_id) {
        await db.query('DELETE FROM documentos WHERE id = ?', [db_id]);
    }

    // 3. REGISTRAR EN HISTORIAL (Eliminación) - NUEVO
    if (req.session.user && req.session.user.id) {
      await db.query('INSERT INTO historial_cambios (usuario_id, accion, seccion, enlace) VALUES (?, ?, ?, ?)',
        [
          req.session.user.id, 
          `eliminó un archivo de ${tipo}`, // Acción: "eliminó un archivo de procedimientos"
          '', 
          `/procesos/${tipo}`
        ]
      );
    }

    res.redirect(`/procesos/${tipo}?ok=Documento eliminado correctamente`);
  } catch (err) {
    console.error('Error eliminando:', err);
    res.status(500).send('Error eliminando documento');
  }
});

module.exports = router;
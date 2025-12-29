const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const cloudinary = require('../services/cloudinary'); 
const requireRole = require('../middlewares/requireRole');

const storage = multer.memoryStorage();
const upload = multer({ storage });

// --- Funciones Auxiliares ---

async function getOrganigramaUrl() {
  try {
    const result = await cloudinary.api.resources({
      type: 'upload', prefix: 'organigrama/', max_results: 10, direction: 'desc', resource_type: 'image'
    });
    if (!result.resources || result.resources.length === 0) {
      const resultRaw = await cloudinary.api.resources({ type: 'upload', prefix: 'organigrama/', max_results: 10, direction: 'desc', resource_type: 'raw' });
      if (resultRaw.resources.length > 0) return resultRaw.resources[0].secure_url;
      return null;
    }
    return result.resources[0].secure_url;
  } catch (err) {
    console.error('Error organigrama:', err);
    return null;
  }
}

function formatNombre(nombreCompleto) {
  if (!nombreCompleto) return '';
  const parts = nombreCompleto.trim().split(/\s+/);
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  if (parts.length === 2) return `${capitalize(parts[1])} ${capitalize(parts[0])}`;
  else if (parts.length === 3) return `${capitalize(parts[2])} ${capitalize(parts[0])} ${capitalize(parts[1])}`;
  else if (parts.length >= 4) return `${capitalize(parts[2])} ${capitalize(parts[0])} ${capitalize(parts[1])}`;
  return parts.map(capitalize).join(' ');
}

// --- Rutas Principales ---

router.get('/', async (req, res, next) => {
  // Se añade 'foto' a la consulta
  const sql = `
    SELECT id, nombre, area, fecha_nacimiento, foto
    FROM cumpleanios
    ORDER BY MONTH(fecha_nacimiento), DAY(fecha_nacimiento)
  `;

  try {
    const [results] = await db.query(sql);
    // Formateamos nombre pero mantenemos el objeto original con la foto
    const personasFormateadas = results.map(p => ({
      ...p,
      nombre: formatNombre(p.nombre)
    }));

    res.render('personas/index', {
      titulo: 'Personas y Cultura',
      personas: personasFormateadas,
      user: req.session.user // Importante pasar el usuario para los permisos en la vista
    });
  } catch (err) {
    console.error('Error consultando personas:', err);
    res.status(500).send('Error consultando personas');
  }
});

// --- CRUD Personas ---

router.get('/crear', requireRole('admin', 'rrhh'), (req, res) => {
  res.render('personas/persona_crear', { titulo: 'Agregar Persona' });
});

// MODIFICADO: Soporte para subida de foto
router.post('/crear', requireRole('admin', 'rrhh'), upload.single('foto'), async (req, res) => {
  const { nombre, area, fecha_nacimiento } = req.body;
  let fotoUrl = null;
  let fotoPublicId = null;

  try {
    // Si se subió un archivo
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { 
            folder: 'cumpleanios', 
            transformation: [{ width: 150, height: 150, crop: "fill", gravity: "face" }] 
          },
          (error, result) => { if (error) reject(error); else resolve(result); }
        );
        stream.end(req.file.buffer);
      });
      fotoUrl = result.secure_url;
      fotoPublicId = result.public_id;
    }

    await db.query('INSERT INTO cumpleanios (nombre, area, fecha_nacimiento, foto, foto_public_id) VALUES (?, ?, ?, ?, ?)', 
      [nombre, area, fecha_nacimiento, fotoUrl, fotoPublicId]);
    
    res.redirect('/personas');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al crear persona');
  }
});

router.get('/editar/:id', requireRole('admin', 'rrhh'), async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM cumpleanios WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).send('Persona no encontrada');
    
    res.render('personas/persona_editar', {
      titulo: 'Editar Persona',
      persona: rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error cargando formulario de edición');
  }
});

// MODIFICADO: Soporte para editar foto
router.post('/editar/:id', requireRole('admin', 'rrhh'), upload.single('foto'), async (req, res) => {
  const { id } = req.params;
  const { nombre, area, fecha_nacimiento } = req.body;

  try {
    // Si hay nueva foto, reemplazamos la anterior
    if (req.file) {
      // 1. Buscar foto anterior para borrarla
      const [prev] = await db.query('SELECT foto_public_id FROM cumpleanios WHERE id = ?', [id]);
      if (prev.length > 0 && prev[0].foto_public_id) {
        await cloudinary.uploader.destroy(prev[0].foto_public_id);
      }

      // 2. Subir nueva
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { 
            folder: 'cumpleanios', 
            transformation: [{ width: 150, height: 150, crop: "fill", gravity: "face" }] 
          },
          (error, result) => { if (error) reject(error); else resolve(result); }
        );
        stream.end(req.file.buffer);
      });

      // 3. Actualizar BD con foto nueva
      await db.query('UPDATE cumpleanios SET nombre=?, area=?, fecha_nacimiento=?, foto=?, foto_public_id=? WHERE id=?', 
        [nombre, area, fecha_nacimiento, result.secure_url, result.public_id, id]);

    } else {
      // 4. Actualizar solo textos
      await db.query('UPDATE cumpleanios SET nombre=?, area=?, fecha_nacimiento=? WHERE id=?', 
        [nombre, area, fecha_nacimiento, id]);
    }

    res.redirect('/personas');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error actualizando persona');
  }
});

// MODIFICADO: Borrar foto de Cloudinary al eliminar
router.post('/eliminar/:id', requireRole('admin', 'rrhh'), async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Buscar foto para borrarla
    const [rows] = await db.query('SELECT foto_public_id FROM cumpleanios WHERE id = ?', [id]);
    if (rows.length > 0 && rows[0].foto_public_id) {
      await cloudinary.uploader.destroy(rows[0].foto_public_id);
    }

    // 2. Borrar registro
    await db.query('DELETE FROM cumpleanios WHERE id = ?', [id]);
    res.redirect('/personas');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error eliminando persona');
  }
});

// --- Rutas de Organigrama ---

router.get('/organigrama', async (req, res) => {
  const organigramaUrl = await getOrganigramaUrl();
  res.render('personas/organigrama', {
    titulo: 'Organigrama',
    organigramaUrl,
    user: req.session.user
  });
});

router.post('/organigrama/subir', requireRole('admin', 'rrhh'), upload.single('organigrama'), async (req, res) => {
  if (!req.file) return res.status(400).send('No se subió archivo.');
  try {
    await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'organigrama', resource_type: 'auto' },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(req.file.buffer);
    });

    // Guardar historial si existe la tabla y el usuario
    if (req.session.user && req.session.user.id) {
      // Asumimos que tienes la tabla historial_cambios creada
      // await db.query(...)
    }

    res.redirect('/personas/organigrama');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error subiendo archivo.');
  }
});

router.post('/organigrama/eliminar', requireRole('admin', 'rrhh'), async (req, res) => {
  try {
    await cloudinary.api.delete_resources_by_prefix('organigrama/', { resource_type: 'image' });
    await cloudinary.api.delete_resources_by_prefix('organigrama/', { resource_type: 'raw' });
    res.redirect('/personas/organigrama');
  } catch (e) {
    console.error(e);
    res.status(500).send('Error al eliminar.');
  }
});

module.exports = router;
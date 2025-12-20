// src/routes/personas.js
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
      type: 'upload',
      prefix: 'organigrama/',
      max_results: 10,
      direction: 'desc',
      resource_type: 'image'
    });

    if (!result.resources || result.resources.length === 0) {
      const resultRaw = await cloudinary.api.resources({
        type: 'upload',
        prefix: 'organigrama/',
        max_results: 10,
        direction: 'desc',
        resource_type: 'raw'
      });
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

  if (parts.length === 2) {
    return `${capitalize(parts[1])} ${capitalize(parts[0])}`;
  } else if (parts.length === 3) {
    return `${capitalize(parts[2])} ${capitalize(parts[0])} ${capitalize(parts[1])}`;
  } else if (parts.length >= 4) {
    return `${capitalize(parts[2])} ${capitalize(parts[0])} ${capitalize(parts[1])}`;
  }
  return parts.map(capitalize).join(' ');
}

// --- Rutas Principales ---

// GET /personas: Listado
router.get('/', async (req, res) => {
  const sql = `
    SELECT id, nombre, area, fecha_nacimiento
    FROM cumpleanios
    ORDER BY MONTH(fecha_nacimiento), DAY(fecha_nacimiento)
  `;

  try {
    const [results] = await db.query(sql);
    const personasFormateadas = results.map(p => ({
      ...p,
      nombre: formatNombre(p.nombre)
    }));

    res.render('personas/index', {
      titulo: 'Personas',
      personas: personasFormateadas,
      user: req.session.user
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error consultando personas');
  }
});

// --- Rutas de CRUD (Crear, Editar, Eliminar) ---

// GET /personas/crear (Formulario)
router.get('/crear', requireRole('admin', 'rrhh'), (req, res) => {
  res.render('personas/persona_crear', {
    titulo: 'Agregar Persona'
  });
});

// POST /personas/crear (Guardar)
router.post('/crear', requireRole('admin', 'rrhh'), async (req, res) => {
  const { nombre, area, fecha_nacimiento } = req.body;
  try {
    await db.query('INSERT INTO cumpleanios (nombre, area, fecha_nacimiento) VALUES (?, ?, ?)', 
      [nombre, area, fecha_nacimiento]);
    res.redirect('/personas');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al crear persona');
  }
});

// GET /personas/editar/:id (Formulario)
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

// POST /personas/editar/:id (Actualizar)
router.post('/editar/:id', requireRole('admin', 'rrhh'), async (req, res) => {
  const { id } = req.params;
  const { nombre, area, fecha_nacimiento } = req.body;
  try {
    await db.query('UPDATE cumpleanios SET nombre = ?, area = ?, fecha_nacimiento = ? WHERE id = ?', 
      [nombre, area, fecha_nacimiento, id]);
    res.redirect('/personas');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error actualizando persona');
  }
});

// POST /personas/eliminar/:id (Eliminar)
router.post('/eliminar/:id', requireRole('admin', 'rrhh'), async (req, res) => {
  const { id } = req.params;
  try {
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
    user: req.session.user // Pasamos user para validar permisos en la vista
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
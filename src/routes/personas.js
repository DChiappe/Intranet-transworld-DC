// src/routes/personas.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const cloudinary = require('../services/cloudinary'); // Importamos el servicio
const requireRole = require('../middlewares/requireRole');

// Configuración de multer: Memoria (RAM)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Función auxiliar para obtener el último organigrama de Cloudinary
async function getOrganigramaUrl() {
  try {
    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix: 'organigrama/',
      max_results: 10,
      direction: 'desc', // Los más nuevos primero
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
      if (resultRaw.resources.length > 0) {
        return resultRaw.resources[0].secure_url;
      }
      return null;
    }

    return result.resources[0].secure_url;
  } catch (err) {
    console.error('Error obteniendo organigrama de Cloudinary:', err);
    return null;
  }
}

// Función para formatear nombres: "APELLIDO APELLIDO2 NOMBRE" -> "Nombre Apellido Apellido2"
function formatNombre(nombreCompleto) {
  if (!nombreCompleto) return '';
  
  // Dividir por espacios y eliminar vacíos
  const parts = nombreCompleto.trim().split(/\s+/);
  
  // Función helper para Capitalizar (primera mayúscula, resto minúscula)
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

  // Caso 1: APELLIDO NOMBRE (2 partes) -> Nombre Apellido
  if (parts.length === 2) {
    return `${capitalize(parts[1])} ${capitalize(parts[0])}`;
  } 
  // Caso 2: APELLIDO APELLIDO2 NOMBRE (3 partes) -> Nombre Apellido Apellido2
  else if (parts.length === 3) {
    return `${capitalize(parts[2])} ${capitalize(parts[0])} ${capitalize(parts[1])}`;
  } 
  // Caso 3: APELLIDO APELLIDO2 NOMBRE NOMBRE2 (4 o más) -> Nombre Apellido Apellido2 (Omite segundo nombre)
  else if (parts.length >= 4) {
    return `${capitalize(parts[2])} ${capitalize(parts[0])} ${capitalize(parts[1])}`;
  }
  
  // Fallback por si acaso
  return parts.map(capitalize).join(' ');
}

// GET /personas  → página principal + cumpleaños
router.get('/', async (req, res) => {
  // Agregamos 'id' al SELECT para poder editar/eliminar
  const sql = `
    SELECT id, nombre, area, fecha_nacimiento
    FROM cumpleanios
    ORDER BY MONTH(fecha_nacimiento), DAY(fecha_nacimiento)
  `;

  try {
    const [results] = await db.query(sql);

    // Procesamos los nombres antes de enviarlos a la vista
    const personasFormateadas = results.map(p => ({
      ...p,
      nombre: formatNombre(p.nombre)
    }));

    res.render('personas/index', {
      titulo: 'Personas',
      personas: personasFormateadas,
      user: req.session.user // Pasamos el usuario para validar roles en la vista
    });
  } catch (err) {
    console.error('Error consultando personas:', err);
    res.status(500).send('Error consultando personas');
  }
});

// GET /personas/organigrama
router.get('/organigrama', async (req, res) => {
  const organigramaUrl = await getOrganigramaUrl();
  res.render('personas/organigrama', {
    titulo: 'Organigrama',
    organigramaUrl
  });
});

// POST /personas/organigrama/subir (solo admin/rrhh)
router.post('/organigrama/subir', requireRole('admin', 'rrhh'), upload.single('organigrama'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No se subió ningún archivo.');
  }

  try {
    await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { 
          folder: 'organigrama',
          resource_type: 'auto' 
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });
    
    res.redirect('/personas/organigrama');
  } catch (err) {
    console.error('Error subiendo organigrama a Cloudinary:', err);
    res.status(500).send('Error al subir el archivo.');
  }
});

// POST /personas/organigrama/eliminar (solo admin/rrhh)
router.post('/organigrama/eliminar', requireRole('admin', 'rrhh'), async (req, res) => {
  try {
    await cloudinary.api.delete_resources_by_prefix('organigrama/', { resource_type: 'image' });
    await cloudinary.api.delete_resources_by_prefix('organigrama/', { resource_type: 'raw' });
    
    res.redirect('/personas/organigrama');
  } catch (e) {
    console.error('Error eliminando organigrama:', e);
    res.status(500).send('Error al eliminar.');
  }
});

module.exports = router;
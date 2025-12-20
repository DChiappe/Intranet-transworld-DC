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
    // Buscamos recursos en la carpeta 'organigrama'
    // Nota: El organigrama suele ser imagen, pero si permiten PDF usamos resource_type: 'auto' o buscamos en ambos.
    // Por simplicidad buscamos imágenes primero, que es lo más común.
    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix: 'organigrama/',
      max_results: 10,
      direction: 'desc', // Los más nuevos primero
      resource_type: 'image' // O 'raw' si suben PDFs.
    });

    // Si no hay imágenes, intentamos buscar 'raw' (PDFs)
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
      titulo: 'Personas',
      personas: results
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
    // Subimos a Cloudinary (resource_type: 'auto' detecta si es img o pdf)
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

    // Opcional: Podríamos borrar los organigramas viejos aquí para no acumular basura,
    // pero Cloudinary tiene mucho espacio.
    
    res.redirect('/personas/organigrama');
  } catch (err) {
    console.error('Error subiendo organigrama a Cloudinary:', err);
    res.status(500).send('Error al subir el archivo.');
  }
});

// POST /personas/organigrama/eliminar (solo admin/rrhh)
router.post('/organigrama/eliminar', requireRole('admin', 'rrhh'), async (req, res) => {
  try {
    // Borramos todo lo que haya en la carpeta organigrama
    // Primero imágenes
    await cloudinary.api.delete_resources_by_prefix('organigrama/', { resource_type: 'image' });
    // Luego archivos raw (PDFs)
    await cloudinary.api.delete_resources_by_prefix('organigrama/', { resource_type: 'raw' });
    
    res.redirect('/personas/organigrama');
  } catch (e) {
    console.error('Error eliminando organigrama:', e);
    res.status(500).send('Error al eliminar.');
  }
});

module.exports = router;
// src/routes/procesos.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('../services/cloudinary');
const requireRole = require('../middlewares/requireRole');

const SECTION_CONFIG = {
  procedimientos: { title: 'Procedimientos', writeRoles: ['admin', 'control_y_seguridad', 'teresa'] },
  protocolos: { title: 'Protocolos', writeRoles: ['admin', 'control_y_seguridad'] },
  achs: { title: 'ACHS y procedimientos por accidentes', writeRoles: ['admin', 'teresa'] },
  reglamento: { title: 'Reglamento interno', writeRoles: ['admin', 'teresa'] },
};

// Configuración Multer (Memoria)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// GET /procesos
router.get('/', (req, res) => {
  res.render('procesos/index', { titulo: 'Procesos y Documentos' });
});

// Helper para listar archivos de Cloudinary (Raw + Images)
async function listarArchivosCloudinary(section) {
  const prefix = `docs/${section}/`;
  try {
    // Solicitamos imágenes y archivos raw (PDF, DOC, XLS) por separado
    // ya que la API los lista en endpoints distintos.
    const [images, raws] = await Promise.all([
      cloudinary.api.resources({ type: 'upload', prefix, resource_type: 'image', max_results: 100 }),
      cloudinary.api.resources({ type: 'upload', prefix, resource_type: 'raw', max_results: 100 })
    ]);

    const all = [...(images.resources || []), ...(raws.resources || [])];

    // Mapeamos para que la vista tenga datos fáciles de usar
    return all.map(res => ({
      name: res.public_id.split('/').pop(), // Extrae el nombre del archivo sin la carpeta
      public_id: res.public_id,
      url: res.secure_url,
      format: res.format,
      resource_type: res.resource_type
    })).sort((a, b) => a.name.localeCompare(b.name));

  } catch (err) {
    // Si la carpeta no existe, devuelve vacío en lugar de error
    console.error(`Nota: No se encontraron archivos para ${section} o error API:`, err.message);
    return [];
  }
}

// Helper para renderizar sección
function renderSection(section, viewPath) {
  return async (req, res) => {
    const archivos = await listarArchivosCloudinary(section);
    
    // IMPORTANTE: 'archivos' ahora es un array de objetos, no de strings.
    // Si tu vista usa <%= archivo %>, deberás cambiarlo a <%= archivo.name %> 
    // y el link a <%= archivo.url %> o /docs/<%= section %>/<%= archivo.name %>
    
    res.render(viewPath, {
      titulo: SECTION_CONFIG[section].title,
      archivos,
    });
  };
}

// Vistas por sección
router.get('/procedimientos', renderSection('procedimientos', 'procesos/procedimientos'));
router.get('/protocolos', renderSection('protocolos', 'procesos/protocolos'));
router.get('/achs', renderSection('achs', 'procesos/achs'));
router.get('/reglamento', renderSection('reglamento', 'procesos/reglamento'));

/**
 * POST /procesos/:section/subir
 */
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
            { 
              folder: `docs/${section}`, 
              resource_type: 'auto', // Auto-detecta PDF, IMG, DOC, etc.
              use_filename: true,    // Intenta mantener el nombre original
              unique_filename: true 
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          stream.end(req.file.buffer);
        });
        res.redirect(`/procesos/${section}`);
      } catch (cloudErr) {
        console.error(cloudErr);
        res.status(500).send('Error subiendo a la nube');
      }
    });
  });
});

/**
 * POST /procesos/:section/:filename/eliminar
 * NOTA: Para eliminar con precisión en Cloudinary se recomienda usar public_id.
 * Sin embargo, para mantener compatibilidad con tus vistas actuales, intentaremos
 * deducir el public_id o recibirlo.
 * * Lo ideal es actualizar tu vista EJS para que el form envíe un hidden input "public_id".
 * Si no, intentaremos borrar asumiendo la ruta.
 */
router.post('/:section/:filename/eliminar', async (req, res) => {
  const section = String(req.params.section || '');
  if (!SECTION_CONFIG[section]) return res.status(404).send('Sección no encontrada');
  
  // Si tu vista envía public_id en el body (Recomendado actualices el EJS)
  let public_id = req.body.public_id;
  
  // Fallback: intentar construirlo (menos seguro si hay timestamps aleatorios)
  if (!public_id) {
    // Esto asume que el filename en la URL es el nombre real en Cloudinary
    // Ojo: Cloudinary suele agregar caracteres al azar si unique_filename: true
    const filename = req.params.filename; 
    // Quitamos extensión para el public_id si es imagen, pero para raw a veces se necesita.
    // Es complejo adivinarlo. SE RECOMIENDA USAR req.body.public_id
    public_id = `docs/${section}/${filename.split('.')[0]}`; 
  }

  const gate = requireRole(...SECTION_CONFIG[section].writeRoles);
  gate(req, res, async () => {
    try {
      // Intentamos borrar como imagen
      await cloudinary.uploader.destroy(public_id, { resource_type: 'image' });
      // Intentamos borrar como raw (por si es doc/pdf)
      await cloudinary.uploader.destroy(public_id, { resource_type: 'raw' });
      
      res.redirect(`/procesos/${section}`);
    } catch (err) {
      console.error('Error eliminando:', err);
      res.status(500).send('Error al eliminar');
    }
  });
});

module.exports = router;
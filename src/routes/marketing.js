const express = require('express');
const multer = require('multer');
const db = require('../db');
const cloudinary = require('../services/cloudinary');
const requireRole = require('../middlewares/requireRole');

const router = express.Router();
const WRITE_ROLES = ['admin', 'marketing'];

const storage = multer.memoryStorage();
const upload = multer({ storage });

function createSlug(text) {
  return text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

// Normaliza imágenes enviadas desde el front
function parseDirectUploadedImages(body) {
  if (!body) return [];
  let candidate = body.images || body.uploadedImages || body.fotos || body.photos;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch (e) { candidate = null; }
  }
  if (candidate && !Array.isArray(candidate) && typeof candidate === 'object') {
    candidate = [candidate];
  }
  if (!Array.isArray(candidate)) return [];

  return candidate
    .map((img) => {
      const secure_url = img.secure_url || img.url || img.secureUrl;
      const public_id = img.public_id || img.publicId;
      // Capturamos el resource_type si viene, por defecto image
      const resource_type = img.resource_type || 'image'; 
      return { secure_url, public_id, resource_type };
    })
    .filter((img) => img.secure_url && img.public_id);
}

// ==========================================
// RUTAS
// ==========================================

router.get('/', (req, res) => res.redirect('/marketing/eventos'));

router.get('/eventos', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM eventos ORDER BY fecha_creacion DESC');
    res.render('marketing/eventos', { titulo: 'Eventos', eventos: rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error cargando eventos');
  }
});

router.get('/eventos/nuevo', requireRole(...WRITE_ROLES), (req, res) => {
  res.render('marketing/eventos_nuevo', { titulo: 'Crear Nuevo Evento', error: null });
});

router.post('/eventos/nuevo', requireRole(...WRITE_ROLES), async (req, res) => {
  const { nombre, descripcion } = req.body;
  const slug = createSlug(nombre);

  try {
    await db.query('INSERT INTO eventos (nombre, slug, descripcion) VALUES (?, ?, ?)',
      [nombre, slug, descripcion]);
    res.redirect('/marketing/eventos');
  } catch (err) {
    const errorMsg = err.code === 'ER_DUP_ENTRY' ? 'Ya existe un evento con ese nombre.' : 'Error al crear.';
    res.render('marketing/eventos_nuevo', { titulo: 'Crear Nuevo Evento', error: errorMsg });
  }
});

// GET DETALLE (MODIFICADO PARA VIDEOS + IMÁGENES)
router.get('/eventos/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM eventos WHERE slug = ?', [slug]);
    if (rows.length === 0) return res.status(404).send('Evento no encontrado');

    const prefix = `eventos/${slug}/`;

    // 1. Buscamos IMÁGENES
    const imagesPromise = cloudinary.api.resources({
      type: 'upload',
      prefix: prefix,
      resource_type: 'image',
      max_results: 100
    });

    // 2. Buscamos VIDEOS
    const videosPromise = cloudinary.api.resources({
      type: 'upload',
      prefix: prefix,
      resource_type: 'video',
      max_results: 100
    });

    // Esperamos ambas
    const [imgRes, vidRes] = await Promise.all([
      imagesPromise.catch(() => ({ resources: [] })), // Si falla uno, que no rompa todo
      videosPromise.catch(() => ({ resources: [] }))
    ]);

    // Combinamos
    let todos = [
      ...imgRes.resources.map(r => ({ ...r, resource_type: 'image' })), 
      ...vidRes.resources.map(r => ({ ...r, resource_type: 'video' }))
    ];

    // Ordenamos por fecha de creación (created_at) descendente o ascendente según prefieras
    todos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const imagenes = todos.map(res => ({
      url: res.secure_url,
      public_id: res.public_id,
      resource_type: res.resource_type, // 'image' o 'video'
      format: res.format
    }));

    res.render('marketing/evento_detalle', {
      titulo: rows[0].nombre,
      evento: rows[0],
      imagenes // Ahora incluye videos
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar detalle');
  }
});

// SIGNATURE (Soporta videos e imágenes)
router.get('/eventos/:slug/fotos/signature', requireRole(...WRITE_ROLES), async (req, res) => {
  const { slug } = req.params;
  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder = `eventos/${slug}`;
    const paramsToSign = { timestamp, folder };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
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
    console.error(err);
    res.status(500).json({ error: 'Error generando signature' });
  }
});

// SUBIR (Registro en BD y Portada)
router.post('/eventos/:slug/fotos', requireRole(...WRITE_ROLES), upload.none(), async (req, res) => {
  const { slug } = req.params;

  // Procesamos lo que viene del front
  const directFiles = parseDirectUploadedImages(req.body);

  if (directFiles.length > 0) {
    try {
      // Si el evento no tiene portada, asignamos la primera (solo si es imagen)
      const firstImage = directFiles.find(f => f.resource_type === 'image');
      if (firstImage) {
        await db.query(
          `UPDATE eventos SET imagen = ? WHERE slug = ? AND (imagen IS NULL OR imagen = '')`,
          [firstImage.secure_url, slug]
        );
      }

      // Historial
      if (req.session.user && req.session.user.id) {
        await db.query(
          'INSERT INTO historial_cambios (usuario_id, accion, seccion, enlace) VALUES (?, ?, ?, ?)',
          [req.session.user.id, 'subió contenido multimedia', 'Galería de Eventos', `/marketing/eventos/${slug}`]
        );
      }
      return res.redirect(`/marketing/eventos/${slug}`);
    } catch (err) {
      console.error(err);
      return res.status(500).send('Error registrando multimedia');
    }
  }

  res.redirect(`/marketing/eventos/${slug}`);
});

// DEFINIR PORTADA
router.post('/eventos/:slug/portada', requireRole(...WRITE_ROLES), async (req, res) => {
  const { slug } = req.params;
  const { url_imagen } = req.body;
  try {
    await db.query('UPDATE eventos SET imagen = ? WHERE slug = ?', [url_imagen, slug]);
    res.redirect(`/marketing/eventos/${slug}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al definir portada');
  }
});

// ELIMINAR FOTO O VIDEO
router.post('/eventos/:slug/fotos/eliminar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { public_id, resource_type } = req.body; // <--- Ahora recibimos resource_type
  const { slug } = req.params;
  
  try {
    // Importante: Especificar resource_type para borrar videos correctamente
    await cloudinary.uploader.destroy(public_id, { 
      resource_type: resource_type || 'image' 
    });

    const [rows] = await db.query('SELECT imagen FROM eventos WHERE slug = ?', [slug]);
    if (rows.length > 0 && rows[0].imagen && rows[0].imagen.includes(public_id)) {
        await db.query('UPDATE eventos SET imagen = NULL WHERE slug = ?', [slug]);
    }
    res.redirect(`/marketing/eventos/${slug}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error eliminando archivo');
  }
});

// ELIMINAR EVENTO COMPLETO
router.post('/eventos/:slug/eliminar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { slug } = req.params;
  try {
    // Borrar imágenes
    await cloudinary.api.delete_resources_by_prefix(`eventos/${slug}/`, { resource_type: 'image' });
    // Borrar videos
    await cloudinary.api.delete_resources_by_prefix(`eventos/${slug}/`, { resource_type: 'video' });
    
    await db.query('DELETE FROM eventos WHERE slug = ?', [slug]);
    res.redirect('/marketing/eventos');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error eliminando evento');
  }
});

// RUTAS EDITAR
router.get('/eventos/:slug/editar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { slug } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM eventos WHERE slug = ?', [slug]);
    if (rows.length === 0) return res.status(404).send('Evento no encontrado');
    res.render('marketing/eventos_editar', { titulo: 'Editar Evento', evento: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar formulario de edición');
  }
});

router.post('/eventos/:slug/editar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { slug } = req.params;
  const { nombre, descripcion } = req.body;
  try {
    await db.query('UPDATE eventos SET nombre = ?, descripcion = ? WHERE slug = ?', [nombre, descripcion, slug]);
    if (req.session.user && req.session.user.id) {
      await db.query('INSERT INTO historial_cambios (usuario_id, accion, seccion, enlace) VALUES (?, ?, ?, ?)',
        [req.session.user.id, 'editó información del evento', 'Galería de Eventos', `/marketing/eventos/${slug}`]);
    }
    res.redirect(`/marketing/eventos/${slug}?ok=Evento actualizado correctamente`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar el evento');
  }
});

module.exports = router;
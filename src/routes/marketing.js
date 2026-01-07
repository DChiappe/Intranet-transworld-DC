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

/**
 * Normaliza imágenes enviadas desde el front luego de una subida DIRECTA a Cloudinary.
 * Acepta:
 * - req.body.images (array) o JSON string
 * - req.body.uploadedImages (array) o JSON string
 * - un objeto único { secure_url, public_id }
 */
function parseDirectUploadedImages(body) {
  if (!body) return [];

  let candidate = body.images || body.uploadedImages || body.fotos || body.photos;

  // Si viene como string JSON
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch (e) { candidate = null; }
  }

  // Si viene como objeto único
  if (candidate && !Array.isArray(candidate) && typeof candidate === 'object') {
    candidate = [candidate];
  }

  if (!Array.isArray(candidate)) return [];

  return candidate
    .map((img) => {
      const secure_url = img.secure_url || img.url || img.secureUrl;
      const public_id = img.public_id || img.publicId;
      return { secure_url, public_id };
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

router.get('/eventos/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM eventos WHERE slug = ?', [slug]);
    if (rows.length === 0) return res.status(404).send('Evento no encontrado');

    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix: `eventos/${slug}/`,
      max_results: 100
    });

    const imagenes = result.resources.map(res => ({
      url: res.secure_url,
      public_id: res.public_id
    }));

    res.render('marketing/evento_detalle', {
      titulo: rows[0].nombre,
      evento: rows[0],
      imagenes
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar detalle');
  }
});

/**
 * NUEVO: Endpoint para obtener SIGNATURE (subida directa a Cloudinary desde el navegador).
 * El front:
 * 1) llama a GET /marketing/eventos/:slug/fotos/signature
 * 2) sube directo a Cloudinary con { api_key, timestamp, signature, folder, file }
 * 3) luego POSTea a /marketing/eventos/:slug/fotos con JSON { images: [{secure_url, public_id}, ...] }
 */
router.get('/eventos/:slug/fotos/signature', requireRole(...WRITE_ROLES), async (req, res) => {
  const { slug } = req.params;

  try {
    // (Opcional) validar que el evento exista
    const [rows] = await db.query('SELECT slug FROM eventos WHERE slug = ?', [slug]);
    if (rows.length === 0) return res.status(404).json({ error: 'Evento no encontrado' });

    const timestamp = Math.round(Date.now() / 1000);
    const folder = `eventos/${slug}`;

    // Parámetros que el front debe enviar a Cloudinary para que la firma sea válida
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

/**
 * SUBIR FOTOS:
 * - Compatibilidad: si viene multipart con req.files => sube DESDE servidor (legacy).
 * - Directo (nuevo): si NO vienen files, espera JSON con { images: [...] } ya subidas a Cloudinary.
 */
router.post('/eventos/:slug/fotos', requireRole(...WRITE_ROLES), upload.array('fotos', 20), async (req, res) => {
  const { slug } = req.params;

  // 1) MODO NUEVO: subida directa (el front ya subió a Cloudinary)
  const directImages = parseDirectUploadedImages(req.body)
    .slice(0, 20)
    .filter(img => img.public_id.startsWith(`eventos/${slug}/`)); // seguridad mínima

  if ((!req.files || req.files.length === 0) && directImages.length > 0) {
    try {
      // Si el evento NO tiene portada, ponemos la primera foto automáticamente (opcional)
      const portadaUrl = directImages[0].secure_url;
      await db.query(
        `UPDATE eventos SET imagen = ? WHERE slug = ? AND (imagen IS NULL OR imagen = '')`,
        [portadaUrl, slug]
      );

      // Historial
      if (req.session.user && req.session.user.id) {
        await db.query(
          'INSERT INTO historial_cambios (usuario_id, accion, seccion, enlace) VALUES (?, ?, ?, ?)',
          [req.session.user.id, 'subió fotos', 'Galería de Eventos', `/marketing/eventos/${slug}`]
        );
      }

      return res.redirect(`/marketing/eventos/${slug}`);
    } catch (err) {
      console.error(err);
      return res.status(500).send('Error registrando fotos (direct upload)');
    }
  }

  // 2) MODO LEGACY: subida pasando por servidor (mantengo para no romper nada mientras migras)
  if (!req.files || req.files.length === 0) {
    return res.redirect(`/marketing/eventos/${slug}`);
  }

  try {
    const promises = req.files.map(file => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: `eventos/${slug}` },
          (error, result) => { if (error) reject(error); else resolve(result); }
        );
        stream.end(file.buffer);
      });
    });

    const uploadedImages = await Promise.all(promises);

    // Si el evento NO tiene portada, ponemos la primera foto automáticamente (opcional)
    if (uploadedImages.length > 0) {
      const portadaUrl = uploadedImages[0].secure_url;
      await db.query(
        `UPDATE eventos SET imagen = ? WHERE slug = ? AND (imagen IS NULL OR imagen = '')`,
        [portadaUrl, slug]
      );

      // Historial
      if (req.session.user && req.session.user.id) {
        await db.query(
          'INSERT INTO historial_cambios (usuario_id, accion, seccion, enlace) VALUES (?, ?, ?, ?)',
          [req.session.user.id, 'subió fotos', 'Galería de Eventos', `/marketing/eventos/${slug}`]
        );
      }
    }

    res.redirect(`/marketing/eventos/${slug}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error subiendo fotos');
  }
});

// --- NUEVA RUTA: DEFINIR PORTADA MANUALMENTE ---
router.post('/eventos/:slug/portada', requireRole(...WRITE_ROLES), async (req, res) => {
  const { slug } = req.params;
  const { url_imagen } = req.body; // URL que viene del form en el modal

  try {
    await db.query('UPDATE eventos SET imagen = ? WHERE slug = ?', [url_imagen, slug]);
    res.redirect(`/marketing/eventos/${slug}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al definir portada');
  }
});
// -----------------------------------------------

router.post('/eventos/:slug/fotos/eliminar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { public_id } = req.body;
  const { slug } = req.params;
  try {
    await cloudinary.uploader.destroy(public_id);
    const [rows] = await db.query('SELECT imagen FROM eventos WHERE slug = ?', [slug]);
    if (rows.length > 0 && rows[0].imagen && rows[0].imagen.includes(public_id)) {
      await db.query('UPDATE eventos SET imagen = NULL WHERE slug = ?', [slug]);
    }
    res.redirect(`/marketing/eventos/${slug}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error eliminando foto');
  }
});

router.post('/eventos/:slug/eliminar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { slug } = req.params;
  try {
    await cloudinary.api.delete_resources_by_prefix(`eventos/${slug}/`);
    await db.query('DELETE FROM eventos WHERE slug = ?', [slug]);
    res.redirect('/marketing/eventos');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error eliminando evento');
  }
});

// ==========================================
// NUEVO: RUTAS PARA EDITAR EVENTO (TÍTULO Y DESCRIPCIÓN)
// ==========================================

// GET: Mostrar el formulario de edición
router.get('/eventos/:slug/editar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { slug } = req.params;

  try {
    const [rows] = await db.query('SELECT * FROM eventos WHERE slug = ?', [slug]);
    if (rows.length === 0) return res.status(404).send('Evento no encontrado');

    res.render('marketing/eventos_editar', {
      titulo: 'Editar Evento',
      evento: rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar formulario de edición');
  }
});

// POST: Procesar la edición
router.post('/eventos/:slug/editar', requireRole(...WRITE_ROLES), async (req, res) => {
  const { slug } = req.params;
  const { nombre, descripcion } = req.body;

  try {
    // Actualizamos Nombre y Descripción.
    // NOTA: No actualizamos el 'slug' para no romper la conexión con la carpeta de imágenes en Cloudinary.
    await db.query('UPDATE eventos SET nombre = ?, descripcion = ? WHERE slug = ?',
      [nombre, descripcion, slug]);

    // Historial
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

const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const cloudinary = require('../services/cloudinary');
const requireRole = require('../middlewares/requireRole');

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Roles permitidos para crear/borrar noticias
const WRITE_ROLES = ['admin', 'marketing', 'rrhh'];

// 1. LISTADO DE NOTICIAS
router.get('/', async (req, res) => {
  try {
    const [noticias] = await db.query('SELECT * FROM noticias ORDER BY fecha_creacion DESC');
    res.render('noticias/index', { titulo: 'Noticias', noticias });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error cargando noticias');
  }
});

// 2. FORMULARIO DE CREACIÓN
router.get('/crear', requireRole(...WRITE_ROLES), (req, res) => {
  res.render('noticias/crear', { titulo: 'Crear Noticia' });
});

// 3. PROCESAR CREACIÓN (Subida a Cloudinary + Insert BD)
router.post('/crear', requireRole(...WRITE_ROLES), upload.single('imagen'), async (req, res) => {
  const { titulo, subtitulo, contenido } = req.body;

  try {
    let imagenUrl = null;
    let publicId = null;

    // Subir imagen si existe
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'noticias' },
          (error, result) => { if (error) reject(error); else resolve(result); }
        );
        stream.end(req.file.buffer);
      });
      imagenUrl = result.secure_url;
      publicId = result.public_id;
    }

    await db.query(
      'INSERT INTO noticias (titulo, subtitulo, contenido, imagen, public_id) VALUES (?, ?, ?, ?, ?)',
      [titulo, subtitulo, contenido, imagenUrl, publicId]
    );

    res.redirect('/'); // Volver al home o al listado de noticias
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al crear la noticia');
  }
});

// 4. DETALLE DE LA NOTICIA
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM noticias WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).send('Noticia no encontrada');
    
    res.render('noticias/detalle', { titulo: rows[0].titulo, noticia: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error cargando noticia');
  }
});

// 5. ELIMINAR NOTICIA
router.post('/eliminar/:id', requireRole(...WRITE_ROLES), async (req, res) => {
  const { id } = req.params;
  try {
    // Obtener public_id para borrar de Cloudinary
    const [rows] = await db.query('SELECT public_id FROM noticias WHERE id = ?', [id]);
    if (rows.length > 0 && rows[0].public_id) {
      await cloudinary.uploader.destroy(rows[0].public_id);
    }
    
    await db.query('DELETE FROM noticias WHERE id = ?', [id]);
    res.redirect('/noticias');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error eliminando noticia');
  }
});

module.exports = router;
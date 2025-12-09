// src/routes/marketing.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const router = express.Router();

// Carpeta base donde se guardan los eventos y fotos
const eventosBasePath = path.join(__dirname, '..', 'public', 'img', 'eventos');

// Asegurar que la carpeta base exista
if (!fs.existsSync(eventosBasePath)) {
  fs.mkdirSync(eventosBasePath, { recursive: true });
}

// Configuración de multer para subir imágenes
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const slug = req.params.slug;
    const dir = path.join(eventosBasePath, slug);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const sanitized = file.originalname.replace(/\s+/g, '_');
    cb(null, `${timestamp}_${sanitized}`);
  }
});

const upload = multer({ storage });

// Función auxiliar para listar carpetas de eventos
function listarEventos() {
  if (!fs.existsSync(eventosBasePath)) return [];
  const entradas = fs.readdirSync(eventosBasePath, { withFileTypes: true });
  return entradas
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort((a, b) => a.localeCompare(b));
}

// Función auxiliar para listar imágenes de un evento
function listarImagenesDeEvento(slug) {
  const dirEvento = path.join(eventosBasePath, slug);
  if (!fs.existsSync(dirEvento)) return [];

  const archivos = fs.readdirSync(dirEvento, { withFileTypes: true });
  return archivos
    .filter(f => f.isFile())
    .map(f => f.name)
    .filter(name => /\.(jpe?g|png|gif|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

/* ===========================
   RUTAS
   =========================== */

// GET /marketing → puedes dejarlo como una portada simple
router.get('/', (req, res) => {
  res.render('marketing/index', {
    titulo: 'Marketing y Eventos'
  });
});

// GET /marketing/eventos → lista de carpetas (eventos)
router.get('/eventos', (req, res) => {
  const eventos = listarEventos();
  res.render('marketing/eventos', {
    titulo: 'Eventos',
    eventos
  });
});

// GET /marketing/eventos/nuevo → formulario para crear carpeta de evento
router.get('/eventos/nuevo', (req, res) => {
  res.render('marketing/eventos_nuevo', {
    titulo: 'Nuevo evento',
    error: null
  });
});

// POST /marketing/eventos/nuevo → creación de carpeta de evento
router.post('/eventos/nuevo', (req, res) => {
  let { nombre } = req.body;

  if (!nombre || !nombre.trim()) {
    return res.status(400).render('marketing/eventos_nuevo', {
      titulo: 'Nuevo evento',
      error: 'Debes ingresar un nombre para el evento.'
    });
  }

  // Crear un "slug" a partir del nombre
  nombre = nombre.trim();
  const slug = nombre
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, ''); // sólo letras, números y guiones

  if (!slug) {
    return res.status(400).render('marketing/eventos_nuevo', {
      titulo: 'Nuevo evento',
      error: 'El nombre del evento no es válido.'
    });
  }

  const dirEvento = path.join(eventosBasePath, slug);

  if (fs.existsSync(dirEvento)) {
    return res.status(400).render('marketing/eventos_nuevo', {
      titulo: 'Nuevo evento',
      error: 'Ya existe un evento con un nombre similar.'
    });
  }

  fs.mkdirSync(dirEvento, { recursive: true });

  // Redirige al listado de eventos
  res.redirect('/marketing/eventos');
});

// POST /marketing/eventos/:slug/eliminar → borrar carpeta del evento (y sus fotos)
router.post('/eventos/:slug/eliminar', (req, res) => {
  const { slug } = req.params;
  const dirEvento = path.join(eventosBasePath, slug);

  if (!fs.existsSync(dirEvento)) {
    return res.redirect('/marketing/eventos');
  }

  // Eliminar recursivamente la carpeta del evento
  fs.rm(dirEvento, { recursive: true, force: true }, (err) => {
    if (err) {
      console.error('Error eliminando evento:', err);
    }
    res.redirect('/marketing/eventos');
  });
});

// GET /marketing/eventos/:slug → galería de un evento
router.get('/eventos/:slug', (req, res) => {
  const { slug } = req.params;
  const dirEvento = path.join(eventosBasePath, slug);

  if (!fs.existsSync(dirEvento)) {
    return res.status(404).send('Evento no encontrado');
  }

  const imagenes = listarImagenesDeEvento(slug);

  res.render('marketing/evento_detalle', {
    titulo: `Evento: ${slug}`,
    slug,
    imagenes
  });
});

// POST /marketing/eventos/:slug/fotos → subir una o varias fotos al evento
router.post('/eventos/:slug/fotos', upload.array('fotos', 20), (req, res) => {
  const { slug } = req.params;
  const dirEvento = path.join(eventosBasePath, slug);

  if (!fs.existsSync(dirEvento)) {
    return res.status(404).send('Evento no encontrado');
  }

  // multer ya guardó los archivos en la carpeta correspondiente
  res.redirect(`/marketing/eventos/${slug}`);
});

// POST /marketing/eventos/:slug/fotos/:filename/eliminar → borrar una foto
router.post('/eventos/:slug/fotos/:filename/eliminar', (req, res) => {
  const { slug, filename } = req.params;
  const filePath = path.join(eventosBasePath, slug, filename);

  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error('Error eliminando foto:', err);
      }
    });
  }

  res.redirect(`/marketing/eventos/${slug}`);
});

module.exports = router;

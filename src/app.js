// ================================
// Zona horaria del servidor
// ================================
process.env.TZ = 'America/Santiago';


// ================================
// Dependencias principales
// ================================
const express = require('express');
const path = require('path');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
require('dotenv').config();


// ================================
// Rutas (importadas)
// ================================
const indexRoutes = require('./routes/index');
const procesosRoutes = require('./routes/procesos');
const personasRoutes = require('./routes/personas');
const sistemasRoutes = require('./routes/sistemas');
const marketingRoutes = require('./routes/marketing');
const authRoutes = require('./routes/auth');
const rolesRoutes = require('./routes/roles');
const docsRoutes = require('./routes/docs');
const expressLayouts = require('express-ejs-layouts');

// ❗ Importante: rutas POST /tickets/:id/...
// Estas están en: /src/routes/tickets.js
const ticketsRouter = require('./routes/tickets');


// ================================
// Inicializar app
// ================================
const app = express();
const PORT = process.env.PORT || 3000;


// ================================
// Motor de vistas + layouts
// ================================
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(expressLayouts);
app.set('layout', 'layout'); // usa src/views/layout.ejs



// ================================
// Lectura de formularios POST
// ================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


// ================================
// Sesiones
// ================================
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'cambia-este-secreto',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 // 1h
    }
  })
);


// ================================
// Hacer usuario disponible en TODAS las vistas
// ================================
app.use((req, res, next) => {
  res.locals.usuario = req.session.user || null;
  next();
});

app.use((req, res, next) => {
  res.locals.usuario = req.session?.user || null;

  const role = res.locals.usuario?.role || null;
  const hasRole = (...roles) => role && roles.includes(role);

  // Capacidades (solo UI por ahora)
  res.locals.can = {
    // Procesos
    procedimientos_write: hasRole('admin', 'control_y_seguridad', 'teresa'),
    protocolos_write: hasRole('admin', 'control_y_seguridad'),
    achs_write: hasRole('admin', 'teresa'),
    reglamento_write: hasRole('admin', 'teresa'),

    // Personas
    organigrama_write: hasRole('admin', 'rrhh'),

    // Marketing
    eventos_write: hasRole('admin', 'marketing'),

    // Sistemas
    tickets_reply: hasRole('admin'),
  };

  next();
});

// ================================
// Archivos estáticos
// ================================
// Esto sirve /public/css, /public/img, /public/js, etc.
app.use(express.static(path.join(__dirname, 'public')));


// ================================
// Middleware de protección
// ================================
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}


// ================================
// Rutas NO protegidas (login)
// ================================
app.use('/', authRoutes);


// ================================
// Rutas protegidas
// ================================
app.use('/', requireAuth, indexRoutes);
app.use('/procesos', requireAuth, procesosRoutes);
app.use('/personas', requireAuth, personasRoutes);
app.use('/sistemas', requireAuth, sistemasRoutes);
app.use('/marketing', requireAuth, marketingRoutes);
app.use('/roles', requireAuth, rolesRoutes);
app.use('/docs', requireAuth, docsRoutes);


// RUTAS DE TICKETS (responder / actualizar)
// Están separadas porque no forman parte visual de /sistemas
// Pero deben estar protegidas también
app.use('/tickets', requireAuth, ticketsRouter);


// ================================
// 404 opcional
// ================================
// app.use((req, res) => {
//   res.status(404).render('404', { titulo: 'Página no encontrada' });
// });


// ================================
// Iniciar servidor
// ================================
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});

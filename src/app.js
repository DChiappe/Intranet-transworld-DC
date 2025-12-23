// ================================
// Zona horaria y Configuración
// ================================
process.env.TZ = 'America/Santiago';
require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');

// ================================
// Importación de Rutas
// ================================
const authRoutes = require('./routes/auth');
const indexRoutes = require('./routes/index');
const procesosRoutes = require('./routes/procesos');
const personasRoutes = require('./routes/personas');
const sistemasRoutes = require('./routes/sistemas'); // Listados y Vistas
const ticketsRoutes = require('./routes/tickets');   // Acciones (Crear, Responder, Editar) <--- AGREGADO
const marketingRoutes = require('./routes/marketing');
const rolesRoutes = require('./routes/roles');
const docsRoutes = require('./routes/docs');

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
app.set('layout', 'layout'); 

// ================================
// Middlewares Básicos
// ================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================================
// Sesiones
// ================================
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'transworld-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 } // 1 hora
  })
);

// ================================
// Variables Globales y Permisos
// ================================
app.use((req, res, next) => {
  const user = req.session.user || null;
  res.locals.usuario = user;

  if (user) {
    const role = user.role || null;
    const hasRole = (...roles) => roles.includes(role);

    res.locals.can = {
      procedimientos_write: hasRole('admin', 'control_y_seguridad', 'teresa'),
      protocolos_write: hasRole('admin', 'control_y_seguridad'),
      achs_write: hasRole('admin', 'teresa'),
      reglamento_write: hasRole('admin', 'teresa'),
      organigrama_write: hasRole('admin', 'rrhh'),
      eventos_write: hasRole('admin', 'marketing'),
      tickets_reply: hasRole('admin'), 
    };
  } else {
    res.locals.can = {};
  }
  next();
});

// ================================
// Middleware de protección
// ================================
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

// ================================
// Montaje de Rutas
// ================================

// 1. Rutas Públicas
app.use('/', authRoutes);

// 2. Rutas Protegidas
app.use('/', requireAuth, indexRoutes);
app.use('/procesos', requireAuth, procesosRoutes);
app.use('/personas', requireAuth, personasRoutes);
app.use('/sistemas', requireAuth, sistemasRoutes); // Maneja /sistemas/tickets (Vistas)
app.use('/tickets', requireAuth, ticketsRoutes);   // Maneja /tickets/... (Acciones) <--- AGREGADO
app.use('/marketing', requireAuth, marketingRoutes);
app.use('/roles', requireAuth, rolesRoutes);
app.use('/docs', requireAuth, docsRoutes);

// ================================
// Manejo de Errores (404)
// ================================
app.use((req, res) => {
  res.status(404).render('404', { titulo: 'Página no encontrada' });
});

// ================================
// Iniciar servidor
// ================================
app.listen(PORT, () => {
  console.log(`Servidor de Intranet corriendo en puerto ${PORT}`);
});
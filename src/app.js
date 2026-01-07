// ================================
// Zona horaria y Configuración
// ================================
process.env.TZ = 'America/Santiago';
require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');

// IMPORTANTE: Requerimos la DB para la tarea automática
const db = require('./db'); 

// ================================
// Importación de Rutas
// ================================
const authRoutes = require('./routes/auth');
const indexRoutes = require('./routes/index');
const procesosRoutes = require('./routes/procesos');
const personasRoutes = require('./routes/personas');
const sistemasRoutes = require('./routes/sistemas'); // Listados y Vistas
const ticketsRoutes = require('./routes/tickets');   // Acciones (Crear, Responder, Editar)
const marketingRoutes = require('./routes/marketing');
const rolesRoutes = require('./routes/roles');
const docsRoutes = require('./routes/docs');
const noticiasRoutes = require('./routes/noticias');

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
      procedimientos_write: hasRole('admin', 'control_y_seguridad'),
      protocolos_write: hasRole('admin', 'control_y_seguridad'),
      personas_write: hasRole('admin', 'rrhh'),
      achs_write: hasRole('admin'),
      reglamento_write: hasRole('admin'),
      organigrama_write: hasRole('admin', 'rrhh'),
      eventos_write: hasRole('admin', 'marketing'),
      tickets_reply: hasRole('admin'), 
      noticias_write: hasRole('admin', 'marketing', 'noticias')
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
app.use('/sistemas', requireAuth, sistemasRoutes); 
app.use('/tickets', requireAuth, ticketsRoutes);   
app.use('/marketing', requireAuth, marketingRoutes);
app.use('/roles', requireAuth, rolesRoutes);
app.use('/docs', requireAuth, docsRoutes);
app.use('/noticias', requireAuth, noticiasRoutes);

// ================================
// Manejo de Errores (404)
// ================================
app.use((req, res) => {
  res.status(404).render('404', { titulo: 'Página no encontrada' });
});

// ==========================================
// TAREA AUTOMÁTICA: CERRAR TICKETS ANTIGUOS
// ==========================================
function iniciarTareaCierreTickets() {
  // Se ejecuta cada 1 hora (3600000 ms)
  setInterval(async () => {
    try {
      // Busca tickets 'Resueltos' cuya fecha de resolución sea mayor a 3 días atrás
      const sql = `
        UPDATE tickets 
        SET estado = 'Cerrado', fecha_cierre = NOW(), cierre_automatico = 1
        WHERE estado = 'Resuelto' 
        AND fecha_resolucion < (NOW() - INTERVAL 3 DAY)
      `;
      
      const [result] = await db.query(sql);
      
      if (result && result.affectedRows > 0) {
        console.log(`[CRON] Se cerraron automáticamente ${result.affectedRows} tickets resueltos hace más de 3 días.`);
      }
    } catch (err) {
      console.error('[CRON] Error en tarea automática de tickets:', err);
    }
  }, 3600000); 
}
// ==========================================
// TAREA AUTOMÁTICA: LIMPIEZA DE HISTORIAL (5 DÍAS)
// ==========================================
function iniciarLimpiezaHistorial() {
  // Se ejecuta una vez al día (86400000 ms = 24 horas)
  setInterval(async () => {
    try {
      const sql = `
        DELETE FROM historial_cambios 
        WHERE fecha < (NOW() - INTERVAL 5 DAY)
      `;
      
      const [result] = await db.query(sql);
      
      if (result && result.affectedRows > 0) {
        console.log(`[CRON] Se eliminaron ${result.affectedRows} registros antiguos del historial.`);
      }
    } catch (err) {
      console.error('[CRON] Error en tarea de limpieza de historial:', err);
    }
  }, 86400000); // 24 horas
}
// Iniciar el cron job
iniciarTareaCierreTickets();
iniciarLimpiezaHistorial();
// ================================
// Iniciar servidor
// ================================
app.listen(PORT, () => {
  console.log(`Servidor de Intranet corriendo en puerto ${PORT}`);
});
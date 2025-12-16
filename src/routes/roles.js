const express = require('express');
const router = express.Router();
const pool = require('../db');

function requireAdmin(req, res, next) {
  const u = req.session?.user;
  if (u && u.role === 'admin') return next();
  return res.status(403).send('Acceso denegado');
}

// GET /roles
router.get('/', requireAdmin, async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, first_name, last_name, email, role, email_confirmed, created_at FROM users ORDER BY created_at DESC'
    );

    res.render('roles', {
      titulo: 'Roles',
      users,
      ok: req.query.ok === '1' ? 'Rol actualizado correctamente.' : null,
      error: null
    });
  } catch (err) {
    console.error('Roles list error:', err);
    res.status(500).render('roles', {
      titulo: 'Roles',
      users: [],
      ok: null,
      error: 'Error interno al cargar usuarios.'
    });
  }
});

// POST /roles/:id
router.post('/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const role = String(req.body.role || '').trim();

    // Roles disponibles (solo valores, NO permisos aún)
    const allowed = new Set([
      '', // sin asignar
      'admin',
      'marketing',
      'rrhh',
      'teresa',
      'control_y_seguridad'
    ]);

    if (!allowed.has(role)) {
      return res.redirect('/roles');
    }

    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role || null, id]);
    return res.redirect('/roles?ok=1');
  } catch (err) {
    console.error('Role update error:', err);
    return res.redirect('/roles');
  }
});

module.exports = router;

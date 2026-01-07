const express = require('express');
const router = express.Router();
const pool = require('../db');

function requireAdmin(req, res, next) {
  const u = req.session?.user;
  if (u && u.role === 'admin') return next();
  return res.status(403).send('Acceso denegado');
}

// GET /roles - Listado principal
router.get('/', requireAdmin, async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, first_name, last_name, email, role, email_confirmed, created_at FROM users ORDER BY created_at DESC'
    );

    res.render('roles', {
      titulo: 'Roles',
      users,
      ok: req.query.ok === '1' ? 'Usuario actualizado correctamente.' : null,
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

// GET /roles/editar/:id - Formulario de edición
router.get('/editar/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    if (rows.length === 0) return res.redirect('/roles');

    res.render('user_editar', {
      titulo: 'Editar Usuario',
      user: rows[0]
    });
  } catch (err) {
    console.error('Error cargando usuario:', err);
    res.redirect('/roles');
  }
});

// POST /roles/editar/:id - Procesar actualización
router.post('/editar/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { first_name, last_name, role } = req.body;

  try {
    // Validar roles permitidos (opcional, pero recomendado)
    const allowed = new Set([
      '', 'admin', 'marketing', 'rrhh',
      'control_y_seguridad', 'usuario', 'noticias'
    ]);
    
    const roleToSave = allowed.has(role) ? role : null;

    await pool.query(
      'UPDATE users SET first_name = ?, last_name = ?, role = ? WHERE id = ?',
      [first_name, last_name, roleToSave, id]
    );

    res.redirect('/roles?ok=1');
  } catch (err) {
    console.error('Error actualizando usuario:', err);
    res.render('user_editar', {
      titulo: 'Editar Usuario',
      user: { id, first_name, last_name, role }, // Datos para no perder lo escrito
      error: 'Error al actualizar usuario.'
    });
  }
});

// POST /roles/:id (Ruta antigua rápida, la mantenemos por compatibilidad si la usabas)
router.post('/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const role = String(req.body.role || '').trim();
    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role || null, id]);
    return res.redirect('/roles?ok=1');
  } catch (err) {
    console.error('Role update error:', err);
    return res.redirect('/roles');
  }
});

module.exports = router;
// src/middlewares/requireRole.js
module.exports = function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.session?.user?.role;

    // Admin “legacy” por .env ya viene como role=admin, así que entra igual
    if (role && roles.includes(role)) return next();

    // Si prefieres redirect en vez de 403:
    // return res.redirect('back');
    return res.status(403).send('Acceso denegado');
  };
};

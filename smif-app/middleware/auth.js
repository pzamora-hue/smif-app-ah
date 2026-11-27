function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Debes iniciar sesión' });
  next();
}

function requireRole(...roles) {
  return [
    requireLogin,
    (req, res, next) => {
      if (!roles.includes(req.session.user.rol)) {
        return res.status(403).json({ error: 'No tienes permiso para esta acción' });
      }
      next();
    }
  ];
}

module.exports = { requireLogin, requireRole };

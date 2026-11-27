const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { COOKIE_NAME } = require('../config/constants');
const { requireLogin } = require('../middlewares/auth');

const router = express.Router();

const perfilStmt = {
  alumno: db.prepare('SELECT id FROM alumnos WHERE usuario_id = ?'),
  docente: db.prepare('SELECT id FROM docentes WHERE usuario_id = ?'),
  secretaria: db.prepare('SELECT id FROM secretarias WHERE usuario_id = ?')
};

router.post('/login', (req, res) => {
  const { dni, password } = req.body || {};
  if (!dni || !password) return res.status(400).json({ error: 'dni y password son obligatorios' });
  const u = db.prepare('SELECT * FROM usuarios WHERE dni = ?').get(String(dni));
  if (!u || !bcrypt.compareSync(String(password), u.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  const perfil = perfilStmt[u.rol].get(u.id);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'No se pudo iniciar sesión' });
    req.session.user = { id: u.id, perfilId: perfil ? perfil.id : null, rol: u.rol, nombres: u.nombres, apellidos: u.apellidos };
    res.json({ mensaje: 'Sesión iniciada', usuario: req.session.user });
  });
});

router.get('/me', requireLogin, (req, res) => res.json(req.session.user));

router.post('/logout', requireLogin, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie(COOKIE_NAME);
    res.json({ mensaje: 'Sesión cerrada' });
  });
});

module.exports = router;

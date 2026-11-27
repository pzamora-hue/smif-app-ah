const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireRole } = require('../middlewares/auth');

const router = express.Router();
router.use(requireRole('secretaria'));

const OBLIGATORIOS = ['dni', 'nombres', 'apellidos', 'email', 'password'];

function validar(body) {
  for (const c of OBLIGATORIOS) {
    if (!body[c] || !String(body[c]).trim()) return `El campo ${c} es obligatorio`;
  }
  if (!/^\d{8}$/.test(String(body.dni))) return 'El dni debe tener 8 dígitos';
  if (String(body.password).length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  return null;
}

function aulaExiste(id) {
  return id == null || !!db.prepare('SELECT 1 FROM aulas_virtuales WHERE id = ?').get(id);
}

const insertUsuario = db.prepare(
  'INSERT INTO usuarios (dni, nombres, apellidos, email, password_hash, rol, telefono) VALUES (?,?,?,?,?,?,?)'
);

const crearAlumno = db.transaction((b) => {
  const u = insertUsuario.run(String(b.dni), b.nombres.trim(), b.apellidos.trim(), b.email.trim().toLowerCase(),
    bcrypt.hashSync(String(b.password), 10), 'alumno', b.telefono || null);
  const a = db.prepare('INSERT INTO alumnos (usuario_id, aula_id, fecha_nacimiento, apoderado, direccion) VALUES (?,?,?,?,?)')
    .run(u.lastInsertRowid, b.aula_id ?? null, b.fecha_nacimiento || null, b.apoderado || null, b.direccion || null);
  return { usuario_id: u.lastInsertRowid, alumno_id: a.lastInsertRowid };
});

const crearDocente = db.transaction((b) => {
  const u = insertUsuario.run(String(b.dni), b.nombres.trim(), b.apellidos.trim(), b.email.trim().toLowerCase(),
    bcrypt.hashSync(String(b.password), 10), 'docente', b.telefono || null);
  const d = db.prepare('INSERT INTO docentes (usuario_id, especialidad) VALUES (?, ?)')
    .run(u.lastInsertRowid, b.especialidad || null);
  if (b.aula_id != null) {
    db.prepare('UPDATE aulas_virtuales SET docente_id = ? WHERE id = ?').run(d.lastInsertRowid, b.aula_id);
  }
  return { usuario_id: u.lastInsertRowid, docente_id: d.lastInsertRowid };
});

function manejar(fn) {
  return (req, res) => {
    const error = validar(req.body || {});
    if (error) return res.status(400).json({ error });
    if (!aulaExiste(req.body.aula_id ?? null)) return res.status(400).json({ error: 'El aula indicada no existe' });
    try {
      res.status(201).json(fn(req.body));
    } catch (e) {
      if (String(e.code).startsWith('SQLITE_CONSTRAINT')) {
        return res.status(409).json({ error: 'Ya existe un usuario con ese dni o email' });
      }
      throw e;
    }
  };
}

router.post('/alumnos', manejar(crearAlumno));
router.post('/docentes', manejar(crearDocente));

router.get('/alumnos', (req, res) => res.json(db.prepare(
  `SELECT a.id, u.dni, u.nombres, u.apellidos, u.email, a.aula_id
   FROM alumnos a JOIN usuarios u ON u.id = a.usuario_id ORDER BY u.apellidos`).all()));

router.get('/docentes', (req, res) => res.json(db.prepare(
  `SELECT d.id, u.dni, u.nombres, u.apellidos, u.email, d.especialidad
   FROM docentes d JOIN usuarios u ON u.id = d.usuario_id ORDER BY u.apellidos`).all()));

module.exports = router;

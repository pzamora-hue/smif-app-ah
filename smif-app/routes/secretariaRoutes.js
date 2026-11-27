const express = require('express');
const bcrypt = require('bcryptjs'); // AJUSTAR: 'bcrypt' si tu proyecto usa ese
const pool = require('../db');
const { MODALIDADES } = require('../config/constants');
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(authMiddleware, requireRole('secretaria'));

function validar(b){
  for (const c of ['dni', 'nombre', 'apellidos', 'email', 'celular', 'password']) {
  if (!b[c] || !String(b[c]).trim()) return 'El campo ${c} es obligatorio';
  if (!/^\d{8}$/.test(String(b.dni))) return 'El DNI debe tener 8 dígitos';
  if (!/^\d{9}$/.test(String(b.celular))) return 'El celular debe tener 9 dígitos';
  if (String(b.password).length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (b.modalidad && !MODALIDADES.includes(b.modalidad)) {
    return 'La modalidad debe ser: ${MODALIDADES.join(', ')}';
  }
  return null;
  }
}

function crear(rol) {
  return async (req, res, next) => {
    const b = req.body || {};
    const error = validar(b);
    if (error) return res.status(400).json({ status: 'fail', message: error });
    try {
      const hash = await bcrypt.hash(String(b.password), 10);
      const r = await pool.query(
        `INSERT INTO usuarios (rol, nombre, apellidos, dni, email, celular, password_hash, ciclo, modalidad, especialidad)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, rol, nombre, apellidos, dni, email, celular, ciclo, modalidad, especialidad`,
        [rol, b.nombre.trim(), b.apellidos.trim(), String(b.dni), b.email.trim().toLowerCase(),
         String(b.celular), hash,
         rol === 'alumno' ? b.ciclo || null : null,
         rol === 'alumno' ? b.modalidad || null : null,
         rol === 'docente' ? b.especialidad || null : null]
      );
      res.status(201).json({ status: 'success', data: r.rows[0] });
    } catch (e) {
      if (e.code === '23505') {
        return res.status(409).json({ status: 'fail', message: 'Ya existe un usuario con ese DNI o correo' });
      }
      next(e);
    }
  };
}

function listar(rol) {
  return async (req, res, next) => {
    try {
      const r = await pool.query(
        `SELECT id, nombre, apellidos, dni, email, celular, ciclo, modalidad, especialidad
         FROM usuarios WHERE rol = $1 ORDER BY apellidos, nombre`, [rol]);
      res.json({ status: 'success', data: r.rows });
    } catch (e) { next(e); }
  };
}

router.post('/alumnos', crear('alumno'));
router.post('/docentes', crear('docente'));
router.get('/alumnos', listar('alumno'));
router.get('/docentes', listar('docente'));

module.exports = router;
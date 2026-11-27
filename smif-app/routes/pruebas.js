const express = require('express');
const db = require('../config/db');
const { requireRole } = require('../middlewares/auth');

const router = express.Router();

const getPrueba = db.prepare('SELECT * FROM pruebas WHERE id = ?');
const getPreguntas = db.prepare('SELECT * FROM preguntas WHERE prueba_id = ? ORDER BY id');

function validarPregunta(p, i) {
  if (!p || !p.enunciado || !String(p.enunciado).trim()) return `Pregunta ${i + 1}: falta el enunciado`;
  if (!Array.isArray(p.opciones) || p.opciones.length < 2) return `Pregunta ${i + 1}: necesita al menos 2 opciones`;
  if (!Number.isInteger(p.respuesta_correcta) || p.respuesta_correcta < 0 || p.respuesta_correcta >= p.opciones.length) {
    return `Pregunta ${i + 1}: respuesta_correcta debe ser el índice (desde 0) de una opción`;
  }
  if (p.puntaje != null && !(Number(p.puntaje) > 0)) return `Pregunta ${i + 1}: el puntaje debe ser mayor que 0`;
  return null;
}

const crearPrueba = db.transaction((docenteId, b) => {
  const total = b.preguntas.reduce((s, p) => s + (Number(p.puntaje) || 1), 0);
  const r = db.prepare(
    'INSERT INTO pruebas (aula_id, docente_id, titulo, fecha, duracion_min, puntaje_maximo) VALUES (?,?,?,?,?,?)'
  ).run(b.aula_id, docenteId, b.titulo.trim(), b.fecha || null, b.duracion_min || null, total);
  const ins = db.prepare('INSERT INTO preguntas (prueba_id, enunciado, opciones, respuesta_correcta, puntaje) VALUES (?,?,?,?,?)');
  for (const p of b.preguntas) {
    ins.run(r.lastInsertRowid, p.enunciado.trim(), JSON.stringify(p.opciones), p.respuesta_correcta, Number(p.puntaje) || 1);
  }
  return r.lastInsertRowid;
});

// ---- DOCENTE: crear, publicar y ver resultados de SUS pruebas ----
router.post('/', requireRole('docente'), (req, res) => {
  const b = req.body || {};
  if (!b.titulo || !String(b.titulo).trim()) return res.status(400).json({ error: 'El título es obligatorio' });
  if (!Array.isArray(b.preguntas) || b.preguntas.length === 0) {
    return res.status(400).json({ error: 'Agrega al menos una pregunta' });
  }
  for (let i = 0; i < b.preguntas.length; i++) {
    const e = validarPregunta(b.preguntas[i], i);
    if (e) return res.status(400).json({ error: e });
  }
  const docenteId = req.session.user.perfilId;
  const aula = db.prepare('SELECT docente_id FROM aulas_virtuales WHERE id = ?').get(b.aula_id);
  if (!aula) return res.status(400).json({ error: 'El aula indicada no existe' });
  if (aula.docente_id !== docenteId) return res.status(403).json({ error: 'Esa aula no está asignada a tu usuario' });
  const id = crearPrueba(docenteId, b);
  res.status(201).json({ id, estado: 'borrador' });
});

router.get('/mias', requireRole('docente'), (req, res) => {
  res.json(db.prepare('SELECT * FROM pruebas WHERE docente_id = ? ORDER BY id DESC').all(req.session.user.perfilId));
});

router.post('/:id/publicar', requireRole('docente'), (req, res) => {
  const p = getPrueba.get(req.params.id);
  if (!p || p.docente_id !== req.session.user.perfilId) return res.status(404).json({ error: 'Prueba no encontrada' });
  db.prepare("UPDATE pruebas SET estado = 'publicada' WHERE id = ?").run(p.id);
  res.json({ id: p.id, estado: 'publicada' });
});

router.get('/:id/resultados', requireRole('docente'), (req, res) => {
  const p = getPrueba.get(req.params.id);
  if (!p || p.docente_id !== req.session.user.perfilId) return res.status(404).json({ error: 'Prueba no encontrada' });
  res.json(db.prepare(
    `SELECT r.alumno_id, u.nombres, u.apellidos, r.puntaje, ? AS puntaje_maximo, r.rendida_en
     FROM resultados_pruebas r JOIN alumnos a ON a.id = r.alumno_id JOIN usuarios u ON u.id = a.usuario_id
     WHERE r.prueba_id = ? ORDER BY u.apellidos`).all(p.puntaje_maximo, p.id));
});

// ---- ALUMNO: ver pruebas publicadas de su aula, rendir y ver sus resultados ----
router.get('/', requireRole('alumno'), (req, res) => {
  res.json(db.prepare(
    `SELECT p.id, p.titulo, p.fecha, p.duracion_min, p.puntaje_maximo,
            EXISTS(SELECT 1 FROM resultados_pruebas r WHERE r.prueba_id = p.id AND r.alumno_id = ?) AS rendida
     FROM pruebas p JOIN alumnos a ON a.aula_id = p.aula_id
     WHERE a.id = ? AND p.estado = 'publicada' ORDER BY p.id DESC`).all(req.session.user.perfilId, req.session.user.perfilId));
});

router.get('/resultados/mios', requireRole('alumno'), (req, res) => {
  res.json(db.prepare(
    `SELECT r.prueba_id, p.titulo, r.puntaje, p.puntaje_maximo, r.rendida_en
     FROM resultados_pruebas r JOIN pruebas p ON p.id = r.prueba_id
     WHERE r.alumno_id = ? ORDER BY r.rendida_en DESC`).all(req.session.user.perfilId));
});

// Ver una prueba: el docente dueño ve las respuestas correctas; el alumno no.
router.get('/:id', requireRole('docente', 'alumno'), (req, res) => {
  const p = getPrueba.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Prueba no encontrada' });
  const u = req.session.user;
  const esDocente = u.rol === 'docente';
  if (esDocente && p.docente_id !== u.perfilId) return res.status(404).json({ error: 'Prueba no encontrada' });
  if (!esDocente) {
    const a = db.prepare('SELECT aula_id FROM alumnos WHERE id = ?').get(u.perfilId);
    if (p.estado !== 'publicada' || !a || a.aula_id !== p.aula_id) {
      return res.status(404).json({ error: 'Prueba no encontrada' });
    }
  }
  const preguntas = getPreguntas.all(p.id).map((q) => ({
    id: q.id, enunciado: q.enunciado, opciones: JSON.parse(q.opciones), puntaje: q.puntaje,
    ...(esDocente ? { respuesta_correcta: q.respuesta_correcta } : {})
  }));
  res.json({ ...p, preguntas });
});

const rendir = db.transaction((alumnoId, prueba, respuestas) => {
  const preguntas = getPreguntas.all(prueba.id);
  let puntaje = 0;
  for (const q of preguntas) if (respuestas[q.id] === q.respuesta_correcta) puntaje += q.puntaje;
  db.prepare('INSERT INTO resultados_pruebas (prueba_id, alumno_id, puntaje) VALUES (?,?,?)').run(prueba.id, alumnoId, puntaje);
  return puntaje;
});

router.post('/:id/rendir', requireRole('alumno'), (req, res) => {
  const respuestas = (req.body || {}).respuestas;
  if (!respuestas || typeof respuestas !== 'object' || Array.isArray(respuestas)) {
    return res.status(400).json({ error: 'Envía respuestas como { "idPregunta": indiceOpcion }' });
  }
  const p = getPrueba.get(req.params.id);
  const a = db.prepare('SELECT aula_id FROM alumnos WHERE id = ?').get(req.session.user.perfilId);
  if (!p || p.estado !== 'publicada' || !a || a.aula_id !== p.aula_id) {
    return res.status(404).json({ error: 'Prueba no encontrada' });
  }
  try {
    const puntaje = rendir(req.session.user.perfilId, p, respuestas);
    res.status(201).json({ puntaje, puntaje_maximo: p.puntaje_maximo });
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Ya rendiste esta prueba' });
    throw e;
  }
});

module.exports = router;

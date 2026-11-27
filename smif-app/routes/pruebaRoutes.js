const express = require('express');
const pool = require('../db');
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(authMiddleware);

const fail = (res, code, message) => res.status(code).json({ status: 'fail', message });
const esId = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

function validarPregunta(p, i) {
  if (!p || !p.enunciado || !String(p.enunciado).trim()) return `Pregunta ${i + 1}: falta el enunciado`;
  if (!Array.isArray(p.opciones) || p.opciones.length < 2) return `Pregunta ${i + 1}: necesita al menos 2 opciones`;
  if (!Number.isInteger(p.respuesta_correcta) || p.respuesta_correcta < 0 || p.respuesta_correcta >= p.opciones.length) {
    return `Pregunta ${i + 1}: respuesta_correcta es el índice (desde 0) de una opción`;
  }
  if (p.puntaje != null && !(Number(p.puntaje) > 0)) return `Pregunta ${i + 1}: el puntaje debe ser mayor que 0`;
  return null;
}

// ---------- DOCENTE ----------
router.post('/', requireRole('docente'), async (req, res, next) => {
  const b = req.body || {};
  if (!esId(b.clase_id)) return fail(res, 400, 'clase_id es obligatorio');
  if (!b.titulo || !String(b.titulo).trim()) return fail(res, 400, 'El título es obligatorio');
  if (!Array.isArray(b.preguntas) || b.preguntas.length === 0) return fail(res, 400, 'Agrega al menos una pregunta');
  for (let i = 0; i < b.preguntas.length; i++) {
    const e = validarPregunta(b.preguntas[i], i);
    if (e) return fail(res, 400, e);
  }
  const client = await pool.connect();
  try {
    const clase = await client.query('SELECT 1 FROM clases WHERE id = $1 AND docente_id = $2',
      [b.clase_id, req.session.userId]);
    if (!clase.rowCount) { client.release(); return fail(res, 403, 'Esa clase no es tuya'); }

    const total = b.preguntas.reduce((s, p) => s + (Number(p.puntaje) || 1), 0);
    await client.query('BEGIN');
    const pr = await client.query(
      `INSERT INTO pruebas (clase_id, titulo, fecha, duracion_min, puntaje_maximo)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [b.clase_id, b.titulo.trim(), b.fecha || null, b.duracion_min || null, total]);
    for (const p of b.preguntas) {
      await client.query(
        `INSERT INTO preguntas (prueba_id, enunciado, opciones, respuesta_correcta, puntaje)
         VALUES ($1, $2, $3, $4, $5)`,
        [pr.rows[0].id, p.enunciado.trim(), JSON.stringify(p.opciones), p.respuesta_correcta, Number(p.puntaje) || 1]);
    }
    await client.query('COMMIT');
    res.status(201).json({ status: 'success', data: { id: pr.rows[0].id, estado: 'borrador' } });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

router.get('/mias', requireRole('docente'), async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT p.* FROM pruebas p JOIN clases c ON c.id = p.clase_id
       WHERE c.docente_id = $1 ORDER BY p.id DESC`, [req.session.userId]);
    res.json({ status: 'success', data: r.rows });
  } catch (e) { next(e); }
});

router.post('/:id/publicar', requireRole('docente'), async (req, res, next) => {
  if (!esId(req.params.id)) return fail(res, 400, 'Id inválido');
  try {
    const r = await pool.query(
      `UPDATE pruebas p SET estado = 'publicada'
       FROM clases c WHERE c.id = p.clase_id AND p.id = $1 AND c.docente_id = $2
       RETURNING p.id, p.estado`, [req.params.id, req.session.userId]);
    if (!r.rowCount) return fail(res, 404, 'Prueba no encontrada');
    res.json({ status: 'success', data: r.rows[0] });
  } catch (e) { next(e); }
});

router.get('/:id/resultados', requireRole('docente'), async (req, res, next) => {
  if (!esId(req.params.id)) return fail(res, 400, 'Id inválido');
  try {
    const r = await pool.query(
      `SELECT u.id AS alumno_id, u.nombre, u.apellidos, r.puntaje, p.puntaje_maximo, r.rendida_en
       FROM resultados_pruebas r
       JOIN pruebas p  ON p.id = r.prueba_id
       JOIN clases c   ON c.id = p.clase_id AND c.docente_id = $2
       JOIN usuarios u ON u.id = r.alumno_id
       WHERE r.prueba_id = $1 ORDER BY u.apellidos`, [req.params.id, req.session.userId]);
    res.json({ status: 'success', data: r.rows });
  } catch (e) { next(e); }
});

// ---------- ALUMNO ----------
router.get('/', requireRole('alumno'), async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT p.id, p.titulo, p.fecha, p.duracion_min, p.puntaje_maximo,
              (r.alumno_id IS NOT NULL) AS rendida
       FROM pruebas p
       JOIN clase_alumnos ca ON ca.clase_id = p.clase_id AND ca.alumno_id = $1
       LEFT JOIN resultados_pruebas r ON r.prueba_id = p.id AND r.alumno_id = $1
       WHERE p.estado = 'publicada' ORDER BY p.id DESC`, [req.session.userId]);
    res.json({ status: 'success', data: r.rows });
  } catch (e) { next(e); }
});

router.get('/resultados/mios', requireRole('alumno'), async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT r.prueba_id, p.titulo, r.puntaje, p.puntaje_maximo, r.rendida_en
       FROM resultados_pruebas r JOIN pruebas p ON p.id = r.prueba_id
       WHERE r.alumno_id = $1 ORDER BY r.rendida_en DESC`, [req.session.userId]);
    res.json({ status: 'success', data: r.rows });
  } catch (e) { next(e); }
});

// ---------- AMBOS ----------
async function cargarPrueba(id) {
  const r = await pool.query(
    `SELECT p.*, c.docente_id FROM pruebas p JOIN clases c ON c.id = p.clase_id WHERE p.id = $1`, [id]);
  return r.rows[0];
}

router.get('/:id', requireRole('docente', 'alumno'), async (req, res, next) => {
  if (!esId(req.params.id)) return fail(res, 400, 'Id inválido');
  try {
    const p = await cargarPrueba(req.params.id);
    if (!p) return fail(res, 404, 'Prueba no encontrada');
    const esDocente = req.session.rol === 'docente';
    if (esDocente && p.docente_id !== Number(req.session.userId)) return fail(res, 404, 'Prueba no encontrada');
    if (!esDocente) {
      const insc = await pool.query('SELECT 1 FROM clase_alumnos WHERE clase_id = $1 AND alumno_id = $2',
        [p.clase_id, req.session.userId]);
      if (p.estado !== 'publicada' || !insc.rowCount) return fail(res, 404, 'Prueba no encontrada');
    }
    const q = await pool.query('SELECT * FROM preguntas WHERE prueba_id = $1 ORDER BY id', [p.id]);
    const preguntas = q.rows.map((x) => ({
      id: x.id, enunciado: x.enunciado, opciones: x.opciones, puntaje: Number(x.puntaje),
      ...(esDocente ? { respuesta_correcta: x.respuesta_correcta } : {})
    }));
    const { docente_id, ...prueba } = p;
    res.json({ status: 'success', data: { ...prueba, preguntas } });
  } catch (e) { next(e); }
});

router.post('/:id/rendir', requireRole('alumno'), async (req, res, next) => {
  const respuestas = (req.body || {}).respuestas;
  if (!esId(req.params.id)) return fail(res, 400, 'Id inválido');
  if (!respuestas || typeof respuestas !== 'object' || Array.isArray(respuestas)) {
    return fail(res, 400, 'Envía respuestas como { "idPregunta": indiceOpcion }');
  }
  try {
    const p = await cargarPrueba(req.params.id);
    const insc = p && await pool.query('SELECT 1 FROM clase_alumnos WHERE clase_id = $1 AND alumno_id = $2',
      [p.clase_id, req.session.userId]);
    if (!p || p.estado !== 'publicada' || !insc.rowCount) return fail(res, 404, 'Prueba no encontrada');

    const q = await pool.query('SELECT id, respuesta_correcta, puntaje FROM preguntas WHERE prueba_id = $1', [p.id]);
    let puntaje = 0;
    for (const x of q.rows) if (respuestas[x.id] === x.respuesta_correcta) puntaje += Number(x.puntaje);

    await pool.query('INSERT INTO resultados_pruebas (prueba_id, alumno_id, puntaje) VALUES ($1, $2, $3)',
      [p.id, req.session.userId, puntaje]);
    res.status(201).json({ status: 'success', data: { puntaje, puntaje_maximo: Number(p.puntaje_maximo) } });
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'Ya rendiste esta prueba');
    next(e);
  }
});

module.exports = router;
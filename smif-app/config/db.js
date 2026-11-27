const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { ROLES, MODALIDADES } = require('./constants');

const db = new Database(process.env.DB_FILE || path.join(__dirname, '..', 'smif.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const rolesSql = ROLES.map((r) => `'${r}'`).join(',');
const modSql = MODALIDADES.map((m) => `'${m}'`).join(',');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dni TEXT NOT NULL UNIQUE,
  nombres TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN (${rolesSql})),
  telefono TEXT,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sedes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL, direccion TEXT, distrito TEXT, latitud REAL, longitud REAL
);
CREATE TABLE IF NOT EXISTS ciclos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sede_id INTEGER REFERENCES sedes(id),
  nombre TEXT NOT NULL, fecha_inicio TEXT, fecha_fin TEXT,
  modalidad TEXT NOT NULL CHECK (modalidad IN (${modSql}))
);
CREATE TABLE IF NOT EXISTS docentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  especialidad TEXT
);
CREATE TABLE IF NOT EXISTS aulas_virtuales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ciclo_id INTEGER NOT NULL REFERENCES ciclos(id),
  docente_id INTEGER REFERENCES docentes(id),
  nombre TEXT NOT NULL, enlace_reunion TEXT,
  modalidad TEXT NOT NULL CHECK (modalidad IN (${modSql}))
);
CREATE TABLE IF NOT EXISTS alumnos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  aula_id INTEGER REFERENCES aulas_virtuales(id),
  fecha_nacimiento TEXT, apoderado TEXT, direccion TEXT
);
CREATE TABLE IF NOT EXISTS secretarias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  cargo TEXT
);
CREATE TABLE IF NOT EXISTS pruebas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aula_id INTEGER NOT NULL REFERENCES aulas_virtuales(id),
  docente_id INTEGER NOT NULL REFERENCES docentes(id),
  titulo TEXT NOT NULL, fecha TEXT, duracion_min INTEGER,
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','publicada')),
  puntaje_maximo REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS preguntas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prueba_id INTEGER NOT NULL REFERENCES pruebas(id) ON DELETE CASCADE,
  enunciado TEXT NOT NULL,
  opciones TEXT NOT NULL,
  respuesta_correcta INTEGER NOT NULL,
  puntaje REAL NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS resultados_pruebas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prueba_id INTEGER NOT NULL REFERENCES pruebas(id) ON DELETE CASCADE,
  alumno_id INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  puntaje REAL NOT NULL,
  rendida_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (prueba_id, alumno_id)
);
CREATE INDEX IF NOT EXISTS idx_alumnos_aula ON alumnos(aula_id);
CREATE INDEX IF NOT EXISTS idx_aulas_docente ON aulas_virtuales(docente_id);
CREATE INDEX IF NOT EXISTS idx_pruebas_aula ON pruebas(aula_id, estado);
CREATE INDEX IF NOT EXISTS idx_preguntas_prueba ON preguntas(prueba_id);
`);

// Datos iniciales: una secretaria administradora y un ciclo/aula de ejemplo.
if (db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n === 0) {
  const seed = db.transaction(() => {
    const u = db.prepare(
      'INSERT INTO usuarios (dni, nombres, apellidos, email, password_hash, rol) VALUES (?,?,?,?,?,?)'
    ).run('00000000', 'Admin', 'SMIF', 'secretaria@smif.pe', bcrypt.hashSync('admin123', 10), 'secretaria');
    db.prepare('INSERT INTO secretarias (usuario_id, cargo) VALUES (?, ?)').run(u.lastInsertRowid, 'Secretaría general');
    const sede = db.prepare('INSERT INTO sedes (nombre, direccion, distrito) VALUES (?,?,?)').run('Sede Central', 'Av. Principal 123', 'San Isidro');
    const ciclo = db.prepare('INSERT INTO ciclos (sede_id, nombre, fecha_inicio, fecha_fin, modalidad) VALUES (?,?,?,?,?)')
      .run(sede.lastInsertRowid, 'Ciclo 2026-II', '2026-08-01', '2026-12-15', 'híbrida');
    db.prepare('INSERT INTO aulas_virtuales (ciclo_id, nombre, modalidad) VALUES (?,?,?)')
      .run(ciclo.lastInsertRowid, 'Aula A', 'virtual');
  });
  seed();
}

module.exports = db;

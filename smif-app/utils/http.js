class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const idValido = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

function enviarError(res, error, mensajeGenerico = 'Error interno del servidor') {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ status: 'fail', message: error.message });
  }
  console.error(error);
  return res.status(500).json({ status: 'fail', message: mensajeGenerico });
}

module.exports = { HttpError, idValido, enviarError };

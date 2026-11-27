const express = require('express');
const db = require('../config/db');
const { requireLogin } = require('../middlewares/auth');

const router = express.Router();
router.use(requireLogin);

router.get('/sedes', (req, res) => res.json(db.prepare('SELECT * FROM sedes').all()));
router.get('/ciclos', (req, res) => res.json(db.prepare('SELECT * FROM ciclos').all()));
router.get('/aulas', (req, res) => res.json(db.prepare('SELECT * FROM aulas_virtuales').all()));

module.exports = router;

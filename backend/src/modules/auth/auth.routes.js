const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../db/pool');

const router = express.Router();

// POST /api/auth/login  { name veya id, password }
router.post('/login', async (req, res) => {
  const { userId, password } = req.body;
  if (!userId || !password) return res.status(400).json({ error: 'Kullanıcı ve şifre gereklidir.' });
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [userId]);
  const user = rows[0];
  if (!user || !user.password_hash) return res.status(401).json({ error: 'Hatalı kullanıcı veya şifre.' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Hatalı şifre.' });
  const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

// GET /api/auth/users  — giriş ekranında isim listesi göstermek için (şifre gerektirmeyen ön liste)
router.get('/users', async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, role, (password_hash IS NOT NULL) AS has_password FROM users ORDER BY name');
  res.json(rows);
});

// POST /api/auth/first-admin — hiç kullanıcı yoksa ilk Yönetici hesabını oluşturur
router.post('/first-admin', async (req, res) => {
  const { name, password } = req.body;
  const { rows: existing } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (existing[0].c > 0) return res.status(400).json({ error: 'Zaten kullanıcı mevcut, bu uç yalnızca ilk kurulum içindir.' });
  if (!name || !password) return res.status(400).json({ error: 'Ad ve şifre gereklidir.' });
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    'INSERT INTO users (name, role, password_hash) VALUES ($1,$2,$3) RETURNING id, name, role',
    [name, 'Yönetici', hash]
  );
  const user = rows[0];
  const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, user });
});

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../db/pool');
const { parseCookie } = require('../../middleware/auth');

const router = express.Router();

function generateTokens(user) {
  const accessSecret = process.env.JWT_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET || `${process.env.JWT_SECRET}-refresh`;

  const token = jwt.sign(
    { id: user.id, name: user.name, role: user.role },
    accessSecret,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' }
  );

  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh' },
    refreshSecret,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  return { token, refreshToken };
}

function setRefreshCookie(res, refreshToken) {
  const isProd = process.env.NODE_ENV === 'production';
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 gün
  res.cookie('cmms_refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge,
  });
}

// POST /api/auth/login { userId, password }
router.post('/login', async (req, res) => {
  const { userId, password } = req.body;
  if (!userId || !password) return res.status(400).json({ error: 'Kullanıcı ve şifre gereklidir.' });

  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [userId]);
  const user = rows[0];
  if (!user || !user.password_hash) return res.status(401).json({ error: 'Hatalı kullanıcı veya şifre.' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Hatalı şifre.' });

  const safeUser = { id: user.id, name: user.name, role: user.role };
  const { token, refreshToken } = generateTokens(safeUser);
  setRefreshCookie(res, refreshToken);

  res.json({ token, refreshToken, user: safeUser });
});

// POST /api/auth/refresh — Kısa ömürlü access tokenı yeniler
router.post('/refresh', async (req, res) => {
  const bodyToken = req.body && req.body.refreshToken;
  const headerToken = req.headers['x-refresh-token'];
  const cookieToken = parseCookie(req.headers.cookie, 'cmms_refresh_token');
  const refreshToken = bodyToken || headerToken || cookieToken;

  if (!refreshToken) {
    return res.status(401).json({ error: 'Yenileme tokenı bulunamadı.' });
  }

  const refreshSecret = process.env.JWT_REFRESH_SECRET || `${process.env.JWT_SECRET}-refresh`;
  try {
    const decoded = jwt.verify(refreshToken, refreshSecret);
    if (decoded.type !== 'refresh' || !decoded.id) {
      return res.status(401).json({ error: 'Geçersiz yenileme tokenı.' });
    }

    const { rows } = await pool.query('SELECT id, name, role FROM users WHERE id = $1', [decoded.id]);
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Kullanıcı bulunamadı.' });
    }

    const safeUser = { id: user.id, name: user.name, role: user.role };
    const tokens = generateTokens(safeUser);
    setRefreshCookie(res, tokens.refreshToken);

    res.json({ token: tokens.token, refreshToken: tokens.refreshToken, user: safeUser });
  } catch (err) {
    return res.status(401).json({ error: 'Yenileme tokenı geçersiz veya süresi dolmuş.' });
  }
});

// POST /api/auth/logout — Çıkış yapar ve refresh cookie'yi temizler
router.post('/logout', (req, res) => {
  res.clearCookie('cmms_refresh_token', { path: '/api/auth' });
  res.json({ ok: true, message: 'Oturum sonlandırıldı.' });
});

// GET /api/auth/users — Giriş ekranında isim listesi göstermek için
router.get('/users', async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, role, (password_hash IS NOT NULL) AS has_password FROM users ORDER BY name');
  res.json(rows);
});

// POST /api/auth/first-admin — Advisory lock ile yarış durumuna karşı korumalı ilk yönetici kurulumu
router.post('/first-admin', async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Ad ve şifre gereklidir.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Eşzamanlı isteklerde yarış durumunu (race condition) engelleyen PostgreSQL Advisory Lock
    await client.query('SELECT pg_advisory_xact_lock(849201923)');

    const { rows: existing } = await client.query('SELECT COUNT(*)::int AS c FROM users');
    if (existing[0].c > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Zaten kullanıcı mevcut, bu uç yalnızca ilk kurulum içindir.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await client.query(
      'INSERT INTO users (name, role, password_hash) VALUES ($1,$2,$3) RETURNING id, name, role',
      [name.trim(), 'Yönetici', hash]
    );
    const user = rows[0];
    await client.query('COMMIT');

    const safeUser = { id: user.id, name: user.name, role: user.role };
    const { token, refreshToken } = generateTokens(safeUser);
    setRefreshCookie(res, refreshToken);

    res.status(201).json({ token, refreshToken, user: safeUser });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { isUuid } = require('../../utils/formatters');

const router = express.Router();
router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  }
  next();
});


// GET /api/users — tüm kullanıcıları listeler (herkes görebilir, ör. atama/sorumlu seçimi için)
router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, role, (password_hash IS NOT NULL) AS has_password FROM users ORDER BY name');
  res.json(rows);
});

// POST /api/users — yeni kullanıcı (yalnızca Yönetici)
router.post('/', requireRole('Yönetici'), async (req, res) => {
  const { name, role, password } = req.body;
  if (!name || !role || !password) return res.status(400).json({ error: 'Ad, rol ve şifre gereklidir.' });
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    'INSERT INTO users (name, role, password_hash) VALUES ($1,$2,$3) RETURNING id, name, role',
    [name, role, hash]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/users/:id — düzenle (ad/rol herkes kendi şifresini, Yönetici herkesi düzenleyebilir)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const isSelf = req.user.id === id;
  if (!isSelf && req.user.role !== 'Yönetici') {
    return res.status(403).json({ error: 'Bu kullanıcıyı düzenleme yetkiniz yok.' });
  }
  const { name, role, password } = req.body;
  const fields = [];
  const values = [];
  let i = 1;
  if (name !== undefined) { fields.push(`name=$${i++}`); values.push(name); }
  if (role !== undefined && req.user.role === 'Yönetici') { fields.push(`role=$${i++}`); values.push(role); }
  if (password) { fields.push(`password_hash=$${i++}`); values.push(await bcrypt.hash(password, 10)); }
  if (!fields.length) return res.status(400).json({ error: 'Güncellenecek alan yok.' });
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id=$${i} RETURNING id, name, role`,
    values
  );
  res.json(rows[0]);
});

// DELETE /api/users/:id — yalnızca Yönetici, kendini silemez
router.delete('/:id', requireRole('Yönetici'), async (req, res) => {
  if (req.user.id === req.params.id) return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz.' });
  await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { isUuid } = require('../../utils/formatters');
const { logAudit, getClientIp } = require('../../utils/audit');

const router = express.Router();
router.use(requireAuth);

const ALLOWED_ROLES = new Set(['Yönetici', 'Teknisyen', 'Depo Sorumlusu']);

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  }
  next();
});

// GET /api/users/assignable — Görev ve iş atamaları için yalın kullanıcı listesi (şifre vb. bayrakları içermez)
router.get('/assignable', async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, role FROM users ORDER BY name ASC');
  res.json(rows);
});

// GET /api/users — Tüm kullanıcıları listeler (has_password yalnızca Yöneticiye gösterilir)
router.get('/', async (req, res) => {
  const isAdmin = req.user && req.user.role === 'Yönetici';
  const query = isAdmin
    ? 'SELECT id, name, role, (password_hash IS NOT NULL) AS has_password FROM users ORDER BY name'
    : 'SELECT id, name, role FROM users ORDER BY name';
  const { rows } = await pool.query(query);
  res.json(rows);
});

// POST /api/users — Yeni kullanıcı (Yalnızca Yönetici)
router.post('/', requireRole('Yönetici'), async (req, res) => {
  const { name, role, password } = req.body;
  if (!name || !role || !password) return res.status(400).json({ error: 'Ad, rol ve şifre gereklidir.' });

  if (!ALLOWED_ROLES.has(role)) {
    return res.status(400).json({
      error: `Geçersiz rol: "${role}". Geçerli roller: Yönetici, Teknisyen, Depo Sorumlusu`
    });
  }

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    'INSERT INTO users (name, role, password_hash) VALUES ($1,$2,$3) RETURNING id, name, role',
    [name.trim(), role, hash]
  );
  const newUser = rows[0];

  await logAudit(pool, {
    userId: req.user.id,
    userName: req.user.name,
    action: 'CREATE',
    entityType: 'user',
    entityId: newUser.id,
    details: { name: newUser.name, role: newUser.role },
    ipAddress: getClientIp(req),
  });

  res.status(201).json(newUser);
});

// PUT /api/users/:id — Kullanıcı düzenleme (Yönetici veya kullanıcının kendisi)
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

  if (name !== undefined) {
    fields.push(`name=$${i++}`);
    values.push(name.trim());
  }

  if (role !== undefined && req.user.role === 'Yönetici') {
    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({
        error: `Geçersiz rol: "${role}". Geçerli roller: Yönetici, Teknisyen, Depo Sorumlusu`
      });
    }

    // Yöneticinin kendini sistemdeki tek yönetici iken başka role düşürmesini engelle
    if (isSelf && role !== 'Yönetici') {
      const { rows: adminCount } = await pool.query(
        "SELECT COUNT(*)::int AS count FROM users WHERE role = 'Yönetici' AND id != $1",
        [id]
      );
      if (adminCount[0]?.count === 0) {
        return res.status(400).json({
          error: 'Sistemdeki tek yönetici sizsiniz. Kendinizi yönetici rolünden çıkaramazsınız.'
        });
      }
    }

    fields.push(`role=$${i++}`);
    values.push(role);
  }

  if (password) {
    fields.push(`password_hash=$${i++}`);
    values.push(await bcrypt.hash(password, 10));
  }

  if (!fields.length) return res.status(400).json({ error: 'Güncellenecek alan yok.' });

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id=$${i} RETURNING id, name, role`,
    values
  );

  const updatedUser = rows[0];

  await logAudit(pool, {
    userId: req.user.id,
    userName: req.user.name,
    action: 'UPDATE',
    entityType: 'user',
    entityId: updatedUser.id,
    details: { name: updatedUser.name, role: updatedUser.role, passwordChanged: !!password },
    ipAddress: getClientIp(req),
  });

  res.json(updatedUser);
});

// DELETE /api/users/:id — Yalnızca Yönetici, kendini veya son yöneticiyi silemez
router.delete('/:id', requireRole('Yönetici'), async (req, res) => {
  if (req.user.id === req.params.id) {
    return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz.' });
  }

  const { rows: targetUser } = await pool.query('SELECT name, role FROM users WHERE id = $1', [req.params.id]);
  if (!targetUser[0]) {
    return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  }

  // Son yönetici silinemez
  if (targetUser[0].role === 'Yönetici') {
    const { rows: otherAdmins } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = 'Yönetici' AND id != $1",
      [req.params.id]
    );
    if (otherAdmins[0]?.count === 0) {
      return res.status(400).json({ error: 'Sistemdeki son yönetici silinemez.' });
    }
  }

  await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);

  await logAudit(pool, {
    userId: req.user.id,
    userName: req.user.name,
    action: 'DELETE',
    entityType: 'user',
    entityId: req.params.id,
    details: { name: targetUser[0].name, role: targetUser[0].role },
    ipAddress: getClientIp(req),
  });

  res.status(204).end();
});

module.exports = router;

const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { toCamelMaterial, toCamelStockMovement, isUuid } = require('../../utils/formatters');
const { logAudit, getClientIp } = require('../../utils/audit');

const router = express.Router();
router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Malzeme bulunamadı.' });
  }
  next();
});


// GET /api/materials — Malzeme listesi (arama ve stok durumu filtreli)
router.get('/', async (req, res) => {
  const { q, status } = req.query;
  let query = `
    SELECT m.*, s.name AS default_supplier_name
    FROM materials m
    LEFT JOIN suppliers s ON s.id = m.default_supplier_id
    WHERE 1=1
  `;
  const params = [];
  let paramIdx = 1;

  if (q && q.trim()) {
    query += ` AND m.name ILIKE $${paramIdx++}`;
    params.push(`%${q.trim()}%`);
  }

  if (status === 'kritik') {
    query += ` AND m.qty <= m.min_qty`;
  } else if (status === 'yeterli') {
    query += ` AND m.qty > m.min_qty`;
  }

  query += ' ORDER BY m.name ASC';
  const { rows } = await pool.query(query, params);
  res.json(rows.map(toCamelMaterial));
});

// GET /api/materials/:id — Tekil malzeme detayı (bağlı varlıklar ve son hareketlerle birlikte)
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const matRes = await pool.query(
    `SELECT m.*, s.name AS default_supplier_name
     FROM materials m
     LEFT JOIN suppliers s ON s.id = m.default_supplier_id
     WHERE m.id = $1`,
    [id]
  );

  if (!matRes.rows[0]) {
    return res.status(404).json({ error: 'Malzeme bulunamadı.' });
  }

  // Bu malzemeyi yedek parça olarak kullanan varlıklar
  const assetsRes = await pool.query(
    `SELECT a.id, a.name, a.asset_code, a.location
     FROM assets a
     JOIN asset_spare_parts asp ON asp.asset_id = a.id
     WHERE asp.material_id = $1
     ORDER BY a.name ASC`,
    [id]
  );

  // Malzemenin son 10 stok hareketi
  const movementsRes = await pool.query(
    `SELECT sm.*, u.name AS user_name
     FROM stock_movements sm
     LEFT JOIN users u ON u.id = sm.user_id
     WHERE sm.material_id = $1
     ORDER BY sm.date DESC, sm.id DESC
     LIMIT 10`,
    [id]
  );

  res.json({
    ...toCamelMaterial(matRes.rows[0]),
    usedInAssets: assetsRes.rows.map(a => ({
      id: a.id,
      name: a.name,
      assetCode: a.asset_code,
      location: a.location,
    })),
    recentMovements: movementsRes.rows.map(toCamelStockMovement),
  });
});

// POST /api/materials — Yeni malzeme ekle
router.post('/', requireRole('Yönetici', 'Depo Sorumlusu'), async (req, res) => {
  const { name, unit, qty, minQty, unitCost, defaultSupplierId } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Malzeme adı zorunludur.' });
  }

  const initialQty = parseFloat(qty) || 0;
  const initialMinQty = parseFloat(minQty) || 0;
  const initialCost = parseFloat(unitCost) || 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO materials (name, unit, qty, min_qty, unit_cost, default_supplier_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name.trim(), (unit || 'adet').trim(), initialQty, initialMinQty, initialCost, defaultSupplierId || null]
    );

    const newMat = rows[0];

    // Eğer başlangıç stoğu tanımlandıysa stok hareketine de yansıt
    if (initialQty > 0) {
      await client.query(
        `INSERT INTO stock_movements (material_id, type, qty, date, user_id, reason)
         VALUES ($1, 'Giriş', $2, CURRENT_DATE, $3, 'Açılış / ilk stok kaydı')`,
        [newMat.id, initialQty, req.user.id]
      );
    }

    await logAudit(client, {
      userId: req.user.id,
      action: 'MATERIAL_CREATE',
      entity: 'materials',
      entityId: newMat.id,
      details: { name: newMat.name, qty: initialQty, minQty: initialMinQty, unitCost: initialCost },
      ipAddress: getClientIp(req),
    });

    await client.query('COMMIT');
    res.status(201).json(toCamelMaterial(newMat));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// PUT /api/materials/:id — Malzeme bilgilerini güncelle
router.put('/:id', requireRole('Yönetici', 'Depo Sorumlusu'), async (req, res) => {
  const { name, unit, minQty, unitCost, defaultSupplierId } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Malzeme adı zorunludur.' });
  }

  const { rows } = await pool.query(
    `UPDATE materials
     SET name=$1, unit=$2, min_qty=$3, unit_cost=$4, default_supplier_id=$5
     WHERE id=$6
     RETURNING *`,
    [
      name.trim(),
      (unit || 'adet').trim(),
      parseFloat(minQty) || 0,
      parseFloat(unitCost) || 0,
      defaultSupplierId || null,
      req.params.id,
    ]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Malzeme bulunamadı.' });

  await logAudit(pool, {
    userId: req.user.id,
    action: 'MATERIAL_UPDATE',
    entity: 'materials',
    entityId: req.params.id,
    details: { name: rows[0].name, unit: rows[0].unit, minQty, unitCost },
    ipAddress: getClientIp(req),
  });

  res.json(toCamelMaterial(rows[0]));
});

// POST /api/materials/:id/adjust — Manuel stok ekle / çıkar (Atomik Transaction)
router.post('/:id/adjust', requireRole('Yönetici', 'Depo Sorumlusu'), async (req, res) => {
  const { type, qty, reason } = req.body;
  const adjustQty = parseFloat(qty);

  if (!adjustQty || adjustQty <= 0) {
    return res.status(400).json({ error: 'Geçerli bir pozitif miktar girilmelidir.' });
  }

  if (type !== 'Giriş' && type !== 'Çıkış') {
    return res.status(400).json({ error: "Hareket türü 'Giriş' veya 'Çıkış' olmalıdır." });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Malzemenin varlığını ve mevcut miktarını kontrol et
    const { rows: matRows } = await client.query(
      'SELECT * FROM materials WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );

    if (!matRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Malzeme bulunamadı.' });
    }

    if (type === 'Çıkış' && Number(matRows[0].qty) < adjustQty) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Yetersiz stok. Mevcut stok: ${matRows[0].qty}, talep edilen çıkış: ${adjustQty}`,
      });
    }

    // Stok güncelle
    const updateSql = type === 'Giriş'
      ? 'UPDATE materials SET qty = qty + $1 WHERE id = $2 RETURNING *'
      : 'UPDATE materials SET qty = qty - $1 WHERE id = $2 RETURNING *';

    const { rows: updatedRows } = await client.query(updateSql, [adjustQty, req.params.id]);

    // Stok hareketini kaydet
    await client.query(
      `INSERT INTO stock_movements (material_id, type, qty, date, user_id, reason)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, $5)`,
      [req.params.id, type, adjustQty, req.user.id, reason ? reason.trim() : `Manuel ${type}`]
    );

    await logAudit(client, {
      userId: req.user.id,
      action: 'MATERIAL_ADJUST',
      entity: 'materials',
      entityId: req.params.id,
      details: { type, qty: adjustQty, reason, previousQty: matRows[0].qty, newQty: updatedRows[0].qty },
      ipAddress: getClientIp(req),
    });

    await client.query('COMMIT');
    res.json(toCamelMaterial(updatedRows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// DELETE /api/materials/:id — Malzeme sil (Yalnızca Yönetici)
router.delete('/:id', requireRole('Yönetici'), async (req, res) => {
  const { rows } = await pool.query('DELETE FROM materials WHERE id=$1 RETURNING id, name', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Malzeme bulunamadı.' });

  await logAudit(pool, {
    userId: req.user.id,
    action: 'MATERIAL_DELETE',
    entity: 'materials',
    entityId: req.params.id,
    details: { name: rows[0].name },
    ipAddress: getClientIp(req),
  });

  res.status(204).end();
});

module.exports = router;

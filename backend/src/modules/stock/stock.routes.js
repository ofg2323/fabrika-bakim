const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { toCamelStockMovement } = require('../../utils/formatters');

const router = express.Router();
router.use(requireAuth);

// GET /api/stock/summary — Stok genel göstergeleri ve KPI'lar
router.get('/summary', async (req, res) => {
  const [countsRes, valueRes, todayRes] = await Promise.all([
    pool.query(`
      SELECT 
        COUNT(*)::int AS total_materials,
        COUNT(CASE WHEN qty <= min_qty THEN 1 END)::int AS low_stock_count
      FROM materials
    `),
    pool.query(`
      SELECT COALESCE(SUM(qty * unit_cost), 0)::numeric(14,2) AS total_inventory_value
      FROM materials
    `),
    pool.query(`
      SELECT COUNT(*)::int AS movements_today
      FROM stock_movements
      WHERE date = CURRENT_DATE
    `),
  ]);

  res.json({
    totalMaterials: countsRes.rows[0].total_materials,
    lowStockCount: countsRes.rows[0].low_stock_count,
    totalInventoryValue: parseFloat(valueRes.rows[0].total_inventory_value) || 0,
    movementsToday: todayRes.rows[0].movements_today,
  });
});

// GET /api/stock/movements — Stok hareketleri listesi (filtreleme ve arama destekli)
router.get('/movements', async (req, res) => {
  const { materialId, type, q, startDate, endDate, limit = 50, offset = 0 } = req.query;

  let query = `
    SELECT sm.*, m.name AS material_name, m.unit AS material_unit, u.name AS user_name
    FROM stock_movements sm
    JOIN materials m ON m.id = sm.material_id
    LEFT JOIN users u ON u.id = sm.user_id
    WHERE 1=1
  `;
  const params = [];
  let paramIdx = 1;

  if (materialId) {
    query += ` AND sm.material_id = $${paramIdx++}`;
    params.push(materialId);
  }

  if (type) {
    query += ` AND sm.type = $${paramIdx++}`;
    params.push(type);
  }

  if (startDate) {
    query += ` AND sm.date >= $${paramIdx++}`;
    params.push(startDate);
  }

  if (endDate) {
    query += ` AND sm.date <= $${paramIdx++}`;
    params.push(endDate);
  }

  if (q && q.trim()) {
    query += ` AND (m.name ILIKE $${paramIdx} OR sm.reason ILIKE $${paramIdx})`;
    params.push(`%${q.trim()}%`);
    paramIdx++;
  }

  query += ` ORDER BY sm.date DESC, sm.id DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
  params.push(parseInt(limit, 10) || 50, parseInt(offset, 10) || 0);

  const { rows } = await pool.query(query, params);
  res.json(rows.map(toCamelStockMovement));
});

// POST /api/stock/movements — Yeni stok hareketi kaydet (Atomik stok güncelleme ile)
router.post('/movements', requireRole('Yönetici', 'Depo Sorumlusu'), async (req, res) => {
  const { materialId, type, qty, reason, date, refPurchaseId } = req.body;
  const movementQty = parseFloat(qty);

  if (!materialId || !type || !movementQty || movementQty <= 0) {
    return res.status(400).json({ error: 'Malzeme, hareket türü ve pozitif bir miktar gereklidir.' });
  }

  if (type !== 'Giriş' && type !== 'Çıkış') {
    return res.status(400).json({ error: "Hareket türü 'Giriş' veya 'Çıkış' olmalıdır." });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Malzemenin varlığını kontrol et ve kilitle
    const { rows: matRows } = await client.query(
      'SELECT id, qty FROM materials WHERE id = $1 FOR UPDATE',
      [materialId]
    );

    if (!matRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Malzeme bulunamadı.' });
    }

    // Stok güncelle
    const updateSql = type === 'Giriş'
      ? 'UPDATE materials SET qty = qty + $1 WHERE id = $2'
      : 'UPDATE materials SET qty = GREATEST(0, qty - $1) WHERE id = $2';

    await client.query(updateSql, [movementQty, materialId]);

    // Hareketi ekle
    const { rows: newMovements } = await client.query(
      `INSERT INTO stock_movements (material_id, type, qty, date, user_id, reason, ref_purchase_id)
       VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6, $7)
       RETURNING *`,
      [
        materialId,
        type,
        movementQty,
        date || null,
        req.user.id,
        reason ? reason.trim() : null,
        refPurchaseId || null,
      ]
    );

    await client.query('COMMIT');
    res.status(201).json(toCamelStockMovement(newMovements[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = router;

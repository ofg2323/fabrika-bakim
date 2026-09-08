const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { toCamelNeed, isUuid } = require('../../utils/formatters');

const router = express.Router();
router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'İhtiyaç kaydı bulunamadı.' });
  }
  next();
});


// GET /api/needs-list — İhtiyaç listesi
router.get('/', async (req, res) => {
  const { status, q, includeAuto } = req.query;

  let query = `
    SELECT nl.*, s.name AS supplier_name, u.name AS requested_by_name
    FROM needs_list nl
    LEFT JOIN suppliers s ON s.id = nl.supplier_id
    LEFT JOIN users u ON u.id = nl.requested_by
    WHERE 1=1
  `;
  const params = [];
  let paramIdx = 1;

  if (status && status.trim()) {
    query += ` AND nl.status = $${paramIdx++}`;
    params.push(status.trim());
  }

  if (q && q.trim()) {
    query += ` AND nl.name ILIKE $${paramIdx++}`;
    params.push(`%${q.trim()}%`);
  }

  query += ' ORDER BY nl.requested_date DESC, nl.id DESC';
  const { rows } = await pool.query(query, params);
  const regularNeeds = rows.map(toCamelNeed);

  // Eğer otomatik kritik stok ihtiyaçları istenmişse:
  let autoNeeds = [];
  if (includeAuto === 'true') {
    const { rows: autoRows } = await pool.query(`
      SELECT 
        m.id AS material_id, 
        m.name, 
        GREATEST(1, (m.min_qty - m.qty)) AS qty,
        m.unit_cost AS estimated_price,
        m.default_supplier_id AS supplier_id,
        s.name AS supplier_name
      FROM materials m
      LEFT JOIN suppliers s ON s.id = m.default_supplier_id
      WHERE m.qty <= m.min_qty
        AND NOT EXISTS (
          SELECT 1 FROM needs_list nl 
          WHERE nl.material_id = m.id AND nl.status != 'Alındı'
        )
      ORDER BY m.name ASC
    `);

    autoNeeds = autoRows.map(m => ({
      id: `auto-${m.material_id}`,
      materialId: m.material_id,
      name: m.name,
      qty: parseFloat(m.qty) || 1,
      estimatedPrice: parseFloat(m.estimated_price) || 0,
      supplierId: m.supplier_id,
      supplierName: m.supplier_name,
      note: 'Kritik stok seviyesi uyarısı (otomatik oluşturuldu)',
      status: 'Kritik Stok',
      requestedBy: null,
      requestedByName: 'Sistem',
      requestedDate: new Date().toISOString().split('T')[0],
      isAuto: true,
    }));
  }

  res.json({
    needs: regularNeeds,
    autoLowStockNeeds: autoNeeds,
  });
});

// POST /api/needs-list — Yeni ihtiyaç talebi oluştur
router.post('/', async (req, res) => {
  const { materialId, name, qty, estimatedPrice, supplierId, note } = req.body;

  let needName = name ? name.trim() : '';

  // Eğer isim verilmediyse ama materialId seçildiyse malzeme adını çek
  if (!needName && materialId) {
    const matRes = await pool.query('SELECT name, default_supplier_id FROM materials WHERE id=$1', [materialId]);
    if (matRes.rows[0]) {
      needName = matRes.rows[0].name;
    }
  }

  if (!needName) {
    return res.status(400).json({ error: 'İhtiyaç duyulan malzeme adı zorunludur.' });
  }

  const needQty = parseFloat(qty) || 1;
  const price = parseFloat(estimatedPrice) || 0;

  const { rows } = await pool.query(
    `INSERT INTO needs_list (material_id, name, qty, estimated_price, supplier_id, note, status, requested_by, requested_date)
     VALUES ($1, $2, $3, $4, $5, $6, 'Beklemede', $7, CURRENT_DATE)
     RETURNING *`,
    [
      materialId || null,
      needName,
      needQty,
      price,
      supplierId || null,
      note ? note.trim() : null,
      req.user.id,
    ]
  );

  res.status(201).json(toCamelNeed(rows[0]));
});

// PUT /api/needs-list/:id — İhtiyaç kaydını güncelle
router.put('/:id', requireRole('Yönetici', 'Depo Sorumlusu'), async (req, res) => {
  const { materialId, name, qty, estimatedPrice, supplierId, note, status } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Malzeme adı zorunludur.' });
  }

  const { rows } = await pool.query(
    `UPDATE needs_list
     SET material_id=$1, name=$2, qty=$3, estimated_price=$4, supplier_id=$5, note=$6, status=$7
     WHERE id=$8
     RETURNING *`,
    [
      materialId || null,
      name.trim(),
      parseFloat(qty) || 1,
      parseFloat(estimatedPrice) || 0,
      supplierId || null,
      note ? note.trim() : null,
      status || 'Beklemede',
      req.params.id,
    ]
  );

  if (!rows[0]) return res.status(404).json({ error: 'İhtiyaç kaydı bulunamadı.' });
  res.json(toCamelNeed(rows[0]));
});

// PATCH /api/needs-list/:id/status — Hızlı durum güncelleme ('Beklemede', 'Sipariş Verildi', 'Alındı')
router.patch('/:id/status', requireRole('Yönetici', 'Depo Sorumlusu'), async (req, res) => {
  const { status } = req.body;

  const validStatuses = ['Beklemede', 'Sipariş Verildi', 'Alındı'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Geçersiz durum. İzin verilenler: ${validStatuses.join(', ')}` });
  }

  const { rows } = await pool.query(
    'UPDATE needs_list SET status=$1 WHERE id=$2 RETURNING *',
    [status, req.params.id]
  );

  if (!rows[0]) return res.status(404).json({ error: 'İhtiyaç kaydı bulunamadı.' });
  res.json(toCamelNeed(rows[0]));
});

// DELETE /api/needs-list/:id — İhtiyaç kaydını sil
router.delete('/:id', requireRole('Yönetici', 'Depo Sorumlusu'), async (req, res) => {
  const { rows } = await pool.query('DELETE FROM needs_list WHERE id=$1 RETURNING id', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'İhtiyaç kaydı bulunamadı.' });
  res.status(204).end();
});

module.exports = router;

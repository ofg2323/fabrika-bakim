const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { toCamelPurchase, isUuid } = require('../../utils/formatters');

const router = express.Router();
router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Satın alma kaydı bulunamadı.' });
  }
  next();
});


// GET /api/purchases — Satın alma kayıtları listesi
router.get('/', async (req, res) => {
  const { q, materialId, supplierId, projectId, startDate, endDate, limit = 50, offset = 0 } = req.query;

  let query = `
    SELECT p.*, 
      m.name AS material_name, 
      m.unit AS material_unit,
      s.name AS supplier_name,
      pr.name AS project_name,
      u.name AS buyer_name
    FROM purchases p
    JOIN materials m ON m.id = p.material_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN projects pr ON pr.id = p.project_id
    LEFT JOIN users u ON u.id = p.buyer_id
    WHERE 1=1
  `;
  const params = [];
  let paramIdx = 1;

  if (materialId) {
    query += ` AND p.material_id = $${paramIdx++}`;
    params.push(materialId);
  }

  if (supplierId) {
    query += ` AND p.supplier_id = $${paramIdx++}`;
    params.push(supplierId);
  }

  if (projectId) {
    query += ` AND p.project_id = $${paramIdx++}`;
    params.push(projectId);
  }

  if (startDate) {
    query += ` AND p.date >= $${paramIdx++}`;
    params.push(startDate);
  }

  if (endDate) {
    query += ` AND p.date <= $${paramIdx++}`;
    params.push(endDate);
  }

  if (q && q.trim()) {
    query += ` AND (m.name ILIKE $${paramIdx} OR COALESCE(p.supplier_text, '') ILIKE $${paramIdx} OR COALESCE(s.name, '') ILIKE $${paramIdx})`;
    params.push(`%${q.trim()}%`);
    paramIdx++;
  }

  query += ` ORDER BY p.date DESC, p.id DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
  params.push(parseInt(limit, 10) || 50, parseInt(offset, 10) || 0);

  const { rows } = await pool.query(query, params);
  res.json(rows.map(toCamelPurchase));
});

// GET /api/purchases/:id — Tekil satın alma kaydı
router.get('/:id', async (req, res) => {
  const query = `
    SELECT p.*, 
      m.name AS material_name, 
      m.unit AS material_unit,
      s.name AS supplier_name,
      pr.name AS project_name,
      u.name AS buyer_name
    FROM purchases p
    JOIN materials m ON m.id = p.material_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN projects pr ON pr.id = p.project_id
    LEFT JOIN users u ON u.id = p.buyer_id
    WHERE p.id = $1
  `;
  const { rows } = await pool.query(query, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Satın alma kaydı bulunamadı.' });
  res.json(toCamelPurchase(rows[0]));
});

// POST /api/purchases — Yeni satın alma kaydet (Atomik Transaction ile Stok Girişi ve İhtiyaç Güncellemesi)
router.post('/', requireRole('Yönetici', 'Depo Sorumlusu'), async (req, res) => {
  const {
    materialId,
    qty,
    unitPrice,
    supplierId,
    supplierText,
    projectId,
    date,
    note,
    needId,
  } = req.body;

  const purchaseQty = parseFloat(qty);
  const price = parseFloat(unitPrice) || 0;

  if (!materialId || !purchaseQty || purchaseQty <= 0) {
    return res.status(400).json({ error: 'Malzeme ve geçerli bir miktar zorunludur.' });
  }

  const totalPrice = parseFloat((purchaseQty * price).toFixed(2));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Malzemeyi kontrol et ve kilitle
    const { rows: matRows } = await client.query(
      'SELECT id, name, qty FROM materials WHERE id = $1 FOR UPDATE',
      [materialId]
    );

    if (!matRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Malzeme bulunamadı.' });
    }

    // Tedarikçi adını belirle (sebep açıklaması için)
    let finalSupplierName = (supplierText || '').trim();
    if (!finalSupplierName && supplierId) {
      const supRes = await client.query('SELECT name FROM suppliers WHERE id=$1', [supplierId]);
      if (supRes.rows[0]) finalSupplierName = supRes.rows[0].name;
    }

    // 2. Satın alma kaydını ekle
    const { rows: purchaseRows } = await client.query(
      `INSERT INTO purchases (material_id, qty, unit_price, total_price, supplier_id, supplier_text, project_id, date, buyer_id, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, CURRENT_DATE), $9, $10)
       RETURNING *`,
      [
        materialId,
        purchaseQty,
        price,
        totalPrice,
        supplierId || null,
        finalSupplierName || null,
        projectId || null,
        date || null,
        req.user.id,
        note ? note.trim() : null,
      ]
    );

    const purchase = purchaseRows[0];

    // 3. Stok hareketine 'Giriş' kaydet
    const reasonText = `Satın alma: ${finalSupplierName || '—'}`;
    await client.query(
      `INSERT INTO stock_movements (material_id, type, qty, date, user_id, reason, ref_purchase_id)
       VALUES ($1, 'Giriş', $2, COALESCE($3, CURRENT_DATE), $4, $5, $6)`,
      [
        materialId,
        purchaseQty,
        date || null,
        req.user.id,
        reasonText,
        purchase.id,
      ]
    );

    // 4. Malzemenin stok miktarını artır ve son birim maliyetini güncelle
    if (price > 0) {
      await client.query(
        'UPDATE materials SET qty = qty + $1, unit_cost = $2 WHERE id = $3',
        [purchaseQty, price, materialId]
      );
    } else {
      await client.query(
        'UPDATE materials SET qty = qty + $1 WHERE id = $2',
        [purchaseQty, materialId]
      );
    }

    // 5. Eğer bir ihtiyaç kaydı üzerinden alım yapıldıysa ihtiyacı 'Alındı' durumuna getir
    if (needId) {
      await client.query(
        "UPDATE needs_list SET status = 'Alındı' WHERE id = $1",
        [needId]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(toCamelPurchase(purchase));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// DELETE /api/purchases/:id — Satın alma kaydını sil ve stoğu geri al (Yalnızca Yönetici)
router.delete('/:id', requireRole('Yönetici'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM purchases WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Satın alma kaydı bulunamadı.' });
    }

    const purchase = rows[0];

    // Stoğu geri düş
    await client.query(
      'UPDATE materials SET qty = GREATEST(0, qty - $1) WHERE id = $2',
      [purchase.qty, purchase.material_id]
    );

    // Stok hareketini sil
    await client.query('DELETE FROM stock_movements WHERE ref_purchase_id = $1', [purchase.id]);

    // Satın almayı sil
    await client.query('DELETE FROM purchases WHERE id = $1', [purchase.id]);

    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = router;

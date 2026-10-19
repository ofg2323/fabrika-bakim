const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { toCamelPurchase, isUuid } = require('../../utils/formatters');
const { parsePagination, setPaginationHeaders } = require('../../utils/pagination');
const { logAudit, getClientIp } = require('../../utils/audit');

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
  const { q, materialId, supplierId, projectId, startDate, endDate } = req.query;
  const { limit, offset } = parsePagination(req.query, 10000, 200);

  let query = `
    SELECT p.*, 
      COUNT(*) OVER() AS full_count,
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
  params.push(limit, offset);

  const { rows } = await pool.query(query, params);
  const totalCount = rows.length > 0 ? parseInt(rows[0].full_count, 10) : 0;
  setPaginationHeaders(res, totalCount, limit, offset);
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

    await logAudit(client, {
      userId: req.user.id,
      action: 'PURCHASE_CREATE',
      entity: 'purchases',
      entityId: purchase.id,
      details: { materialId, qty: purchaseQty, unitPrice: price, totalPrice, supplierId, projectId },
      ipAddress: getClientIp(req),
    });

    await client.query('COMMIT');
    res.status(201).json(toCamelPurchase(purchase));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// PUT /api/purchases/:id — Satın alma kaydını düzenle (Atomik stok farkı ve hareket güncellemesi ile)
router.put('/:id', requireRole('Yönetici', 'Depo Sorumlusu'), async (req, res) => {
  const {
    materialId,
    qty,
    unitPrice,
    supplierId,
    supplierText,
    projectId,
    date,
    note,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existingRows } = await client.query(
      'SELECT * FROM purchases WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (!existingRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Satın alma kaydı bulunamadı.' });
    }

    const oldPurchase = existingRows[0];
    const oldQty = parseFloat(oldPurchase.qty) || 0;
    const newMaterialId = materialId || oldPurchase.material_id;
    const newQty = qty !== undefined ? parseFloat(qty) : oldQty;
    const newPrice = unitPrice !== undefined ? (parseFloat(unitPrice) || 0) : (parseFloat(oldPurchase.unit_price) || 0);

    if (!newMaterialId || !newQty || newQty <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Malzeme ve geçerli bir miktar zorunludur.' });
    }

    const newTotalPrice = parseFloat((newQty * newPrice).toFixed(2));

    // Eski malzemeyi kilitle
    const { rows: oldMatRows } = await client.query(
      'SELECT id, name, qty FROM materials WHERE id = $1 FOR UPDATE',
      [oldPurchase.material_id]
    );
    if (!oldMatRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'İlişkili malzeme bulunamadı.' });
    }

    const currentOldQty = parseFloat(oldMatRows[0].qty) || 0;

    if (newMaterialId === oldPurchase.material_id) {
      const delta = parseFloat((newQty - oldQty).toFixed(2));
      if (currentOldQty + delta < 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Bu satın alma miktarı düşürülemez: Malzemenin bir kısmı kullanılmış. Mevcut stok (${currentOldQty}), düşülmek istenen farktan (${Math.abs(delta)}) az.`,
        });
      }
      if (newPrice > 0) {
        await client.query(
          'UPDATE materials SET qty = qty + $1, unit_cost = $2 WHERE id = $3',
          [delta, newPrice, newMaterialId]
        );
      } else {
        await client.query(
          'UPDATE materials SET qty = qty + $1 WHERE id = $2',
          [delta, newMaterialId]
        );
      }
    } else {
      if (currentOldQty < oldQty) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Bu satın almanın malzemesi değiştirilemez: Eski malzemenin (${oldMatRows[0].name}) bir kısmı kullanılmış. Mevcut stok (${currentOldQty}), satın alma miktarından (${oldQty}) az.`,
        });
      }

      const { rows: newMatRows } = await client.query(
        'SELECT id, name, qty FROM materials WHERE id = $1 FOR UPDATE',
        [newMaterialId]
      );
      if (!newMatRows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Yeni seçilen malzeme bulunamadı.' });
      }

      await client.query(
        'UPDATE materials SET qty = qty - $1 WHERE id = $2',
        [oldQty, oldPurchase.material_id]
      );

      if (newPrice > 0) {
        await client.query(
          'UPDATE materials SET qty = qty + $1, unit_cost = $2 WHERE id = $3',
          [newQty, newPrice, newMaterialId]
        );
      } else {
        await client.query(
          'UPDATE materials SET qty = qty + $1 WHERE id = $2',
          [newQty, newMaterialId]
        );
      }
    }

    const finalSupplierId = supplierId !== undefined ? (supplierId || null) : oldPurchase.supplier_id;
    let finalSupplierName = supplierText !== undefined ? (supplierText || '').trim() : (oldPurchase.supplier_text || '');
    if (!finalSupplierName && finalSupplierId) {
      const supRes = await client.query('SELECT name FROM suppliers WHERE id=$1', [finalSupplierId]);
      if (supRes.rows[0]) finalSupplierName = supRes.rows[0].name;
    }

    const finalProjectId = projectId !== undefined ? (projectId || null) : oldPurchase.project_id;
    const finalNote = note !== undefined ? (note ? note.trim() : null) : oldPurchase.note;

    const { rows: updatedRows } = await client.query(
      `UPDATE purchases
       SET material_id = $1,
           qty = $2,
           unit_price = $3,
           total_price = $4,
           supplier_id = $5,
           supplier_text = $6,
           project_id = $7,
           date = COALESCE($8, date),
           note = $9
       WHERE id = $10
       RETURNING *`,
      [
        newMaterialId,
        newQty,
        newPrice,
        newTotalPrice,
        finalSupplierId,
        finalSupplierName || null,
        finalProjectId,
        date || null,
        finalNote,
        oldPurchase.id,
      ]
    );

    const updatedPurchase = updatedRows[0];
    const reasonText = `Satın alma (düzenlendi): ${finalSupplierName || '—'}`;
    await client.query(
      `UPDATE stock_movements
       SET material_id = $1,
           qty = $2,
           date = COALESCE($3, date),
           reason = $4
       WHERE ref_purchase_id = $5 AND type = 'Giriş'`,
      [newMaterialId, newQty, date || null, reasonText, oldPurchase.id]
    );

    await logAudit(client, {
      userId: req.user.id,
      action: 'PURCHASE_UPDATE',
      entity: 'purchases',
      entityId: oldPurchase.id,
      details: {
        materialId: newMaterialId,
        qty: newQty,
        unitPrice: newPrice,
        totalPrice: newTotalPrice,
        supplierId: finalSupplierId,
        projectId: finalProjectId,
      },
      ipAddress: getClientIp(req),
    });

    await client.query('COMMIT');
    res.json(toCamelPurchase(updatedPurchase));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// DELETE /api/purchases/:id — Satın alma kaydını sil ve stoğu geri al (Yalnızca Yönetici)
// DELETE /api/purchases/:id — Satın alma kaydını iptal et/sil (Ters stok hareketi ve denetim izi ile)
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
    const purchaseQty = parseFloat(purchase.qty);

    // Malzemenin güncel stoğunu kilitle
    const { rows: matRows } = await client.query(
      'SELECT id, name, qty FROM materials WHERE id = $1 FOR UPDATE',
      [purchase.material_id]
    );

    if (!matRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'İlişkili malzeme bulunamadı.' });
    }

    const currentQty = parseFloat(matRows[0].qty) || 0;
    if (currentQty < purchaseQty) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Bu satın alma kaydı silinemez: Satın alınan ${purchaseQty} adet malzemenin bir kısmı bakım/arıza veya diğer işlemlerde kullanılmış. Mevcut stok (${currentQty}), satın alma miktarından az.`
      });
    }

    // Stoğu güvenle düş
    await client.query(
      'UPDATE materials SET qty = qty - $1 WHERE id = $2',
      [purchaseQty, purchase.material_id]
    );

    // Denetim geçmişini (audit trail) korumak için orijinal hareketi silmek yerine ters işlem (reversal) 'Çıkış' kaydet
    await client.query(
      `INSERT INTO stock_movements (material_id, type, qty, date, user_id, reason, ref_purchase_id)
       VALUES ($1, 'Çıkış', $2, CURRENT_DATE, $3, $4, $5)`,
      [
        purchase.material_id,
        purchaseQty,
        req.user.id,
        `Satın alma iptali / iadesi (${purchase.id})`,
        purchase.id,
      ]
    );

    // Satın alma kaydını sil
    await client.query('DELETE FROM purchases WHERE id = $1', [purchase.id]);

    await logAudit(client, {
      userId: req.user.id,
      action: 'PURCHASE_DELETE',
      entity: 'purchases',
      entityId: purchase.id,
      details: {
        materialId: purchase.material_id,
        qty: purchaseQty,
        totalPrice: purchase.total_price,
        supplierId: purchase.supplier_id,
      },
      ipAddress: getClientIp(req),
    });

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

const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { getNextTrackingNo } = require('../../utils/counters');
const { toCamelMaintenance, isUuid } = require('../../utils/formatters');
const { parsePagination, setPaginationHeaders } = require('../../utils/pagination');
const { logAudit, getClientIp } = require('../../utils/audit');

const router = express.Router();
router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Bakım kaydı bulunamadı.' });
  }
  next();
});


// GET /api/maintenance — Bakım kayıtları listesi (arama ve filtreleme destekli)
router.get('/', async (req, res) => {
  const { assetId, groupId, type, startDate, endDate, q } = req.query;
  const { limit, offset } = parsePagination(req.query, 50, 200);

  let query = `
    SELECT 
      mr.*,
      COUNT(*) OVER() AS full_count,
      a.name AS asset_name,
      a.asset_code,
      a.group_id,
      ag.name AS group_name,
      u.name AS completed_by_name,
      COALESCE(mat_cost.total, 0) AS materials_cost
    FROM maintenance_records mr
    JOIN assets a ON a.id = mr.asset_id
    LEFT JOIN asset_groups ag ON ag.id = a.group_id
    LEFT JOIN users u ON u.id = mr.completed_by
    LEFT JOIN (
      SELECT record_id, SUM(qty * unit_cost) AS total
      FROM maintenance_used_materials
      GROUP BY record_id
    ) mat_cost ON mat_cost.record_id = mr.id
    WHERE 1=1
  `;
  const params = [];
  let paramIdx = 1;

  if (assetId) {
    query += ` AND mr.asset_id = $${paramIdx++}`;
    params.push(assetId);
  }

  if (groupId) {
    query += ` AND a.group_id = $${paramIdx++}`;
    params.push(groupId);
  }

  if (type) {
    query += ` AND mr.type = $${paramIdx++}`;
    params.push(type);
  }

  if (startDate) {
    query += ` AND mr.end_date >= $${paramIdx++}`;
    params.push(startDate);
  }

  if (endDate) {
    query += ` AND mr.end_date <= $${paramIdx++}`;
    params.push(endDate);
  }

  if (q && q.trim()) {
    query += ` AND (mr.tracking_no ILIKE $${paramIdx} OR a.name ILIKE $${paramIdx} OR COALESCE(mr.notes, '') ILIKE $${paramIdx})`;
    params.push(`%${q.trim()}%`);
    paramIdx++;
  }

  query += ` ORDER BY mr.end_date DESC, mr.id DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
  params.push(limit, offset);

  const { rows } = await pool.query(query, params);
  const totalCount = rows[0]?.full_count ? parseInt(rows[0].full_count, 10) : 0;
  setPaginationHeaders(res, totalCount, limit, offset);

  res.json(rows.map(toCamelMaintenance));
});

// GET /api/maintenance/:id — Tekil bakım kaydı detayı (kullanılan malzemeler ve kontrol listesi sonuçları ile)
router.get('/:id', async (req, res) => {
  const query = `
    SELECT 
      mr.*,
      a.name AS asset_name,
      a.asset_code,
      a.group_id,
      ag.name AS group_name,
      u.name AS completed_by_name,
      COALESCE(mat_cost.total, 0) AS materials_cost
    FROM maintenance_records mr
    JOIN assets a ON a.id = mr.asset_id
    LEFT JOIN asset_groups ag ON ag.id = a.group_id
    LEFT JOIN users u ON u.id = mr.completed_by
    LEFT JOIN (
      SELECT record_id, SUM(qty * unit_cost) AS total
      FROM maintenance_used_materials
      GROUP BY record_id
    ) mat_cost ON mat_cost.record_id = mr.id
    WHERE mr.id = $1
  `;
  const { rows } = await pool.query(query, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Bakım kaydı bulunamadı.' });

  // Kullanılan malzemeleri detaylarıyla çek
  const { rows: usedMaterials } = await pool.query(`
    SELECT mum.id, mum.material_id, m.name AS material_name, m.unit AS material_unit, mum.qty, mum.unit_cost, (mum.qty * mum.unit_cost) AS total_cost
    FROM maintenance_used_materials mum
    JOIN materials m ON m.id = mum.material_id
    WHERE mum.record_id = $1
    ORDER BY m.name ASC
  `, [req.params.id]);

  const formatted = toCamelMaintenance(rows[0]);
  formatted.usedMaterials = usedMaterials.map(m => ({
    id: m.id,
    materialId: m.material_id,
    materialName: m.material_name,
    unit: m.material_unit,
    qty: parseFloat(m.qty) || 0,
    unitCost: parseFloat(m.unit_cost) || 0,
    totalCost: parseFloat(m.total_cost) || 0,
  }));

  res.json(formatted);
});

// POST /api/maintenance — Yeni bakım kaydı oluştur (Atomik Transaction ile Stok Düşümü ve Varlık Güncellemesi)
router.post('/', requireRole('Yönetici', 'Teknisyen'), async (req, res) => {
  const {
    assetId,
    type,
    startDate,
    endDate,
    dueDate,
    checklistResults,
    usedMaterials,
    notes,
    extraCost,
  } = req.body;

  if (!assetId) {
    return res.status(400).json({ error: 'Varlık seçimi zorunludur.' });
  }

  const maintType = type || 'Periyodik';
  const start = startDate || new Date().toISOString().split('T')[0];
  const end = endDate || start;
  const extra = parseFloat(extraCost) || 0;
  const checklists = Array.isArray(checklistResults) ? checklistResults : [];
  const materialsList = Array.isArray(usedMaterials) ? usedMaterials.filter(m => parseFloat(m.qty) > 0) : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Varlık kontrolü
    const { rows: assetRows } = await client.query('SELECT id, name FROM assets WHERE id = $1 FOR UPDATE', [assetId]);
    if (!assetRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Varlık bulunamadı.' });
    }

    // Takip numarası al
    const trackingNo = await getNextTrackingNo('maint', client);

    // Bakım kaydını ekle
    const { rows: maintRows } = await client.query(
      `INSERT INTO maintenance_records (
        tracking_no, asset_id, due_date, type, start_date, end_date, 
        completed_by, checklist_results, notes, extra_cost
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        trackingNo,
        assetId,
        dueDate || null,
        maintType,
        start,
        end,
        req.user.id,
        JSON.stringify(checklists),
        notes ? notes.trim() : null,
        extra,
      ]
    );

    const record = maintRows[0];

    // Kullanılan malzemeleri doğrula, kilitle ve stoktan düş
    for (const item of materialsList) {
      const itemQty = parseFloat(item.qty);
      if (itemQty <= 0) continue;

      // Malzemenin güncel stoğunu kilitle (Row-level Locking)
      const { rows: matRows } = await client.query(
        'SELECT id, name, unit_cost, qty FROM materials WHERE id = $1 FOR UPDATE',
        [item.materialId]
      );

      if (!matRows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Malzeme bulunamadı (ID: ${item.materialId}).` });
      }

      const currentQty = parseFloat(matRows[0].qty) || 0;
      if (currentQty < itemQty) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Yetersiz stok: "${matRows[0].name}" için mevcut stok (${currentQty}), kullanılan miktardan (${itemQty}) az.`
        });
      }

      const unitCost = item.unitCost !== undefined ? parseFloat(item.unitCost) : (parseFloat(matRows[0].unit_cost) || 0);

      // Kullanılan malzeme kaydını ekle
      await client.query(
        `INSERT INTO maintenance_used_materials (record_id, material_id, qty, unit_cost)
         VALUES ($1, $2, $3, $4)`,
        [record.id, item.materialId, itemQty, unitCost]
      );

      // Stok miktarını düş
      await client.query(
        'UPDATE materials SET qty = qty - $1 WHERE id = $2',
        [itemQty, item.materialId]
      );

      // Stok hareketini doğrudan ref_maintenance_id ile logla
      await client.query(
        `INSERT INTO stock_movements (material_id, type, qty, date, user_id, reason, ref_maintenance_id)
         VALUES ($1, 'Çıkış', $2, $3, $4, $5, $6)`,
        [
          item.materialId,
          itemQty,
          end,
          req.user.id,
          `Bakım kullanımı: ${trackingNo} (${assetRows[0].name})`,
          record.id,
        ]
      );
    }

    // Varlığın son bakım tarihini güncelle
    await client.query(
      `UPDATE assets 
       SET last_maintenance_date = GREATEST(COALESCE(last_maintenance_date, $1::date), $1::date)
       WHERE id = $2`,
      [end, assetId]
    );

    await logAudit(client, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'CREATE',
      entityType: 'maintenance',
      entityId: record.id,
      details: { trackingNo: record.tracking_no, assetId, type: maintType },
      ipAddress: getClientIp(req),
    });

    await client.query('COMMIT');
    res.status(201).json(toCamelMaintenance(record));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// DELETE /api/maintenance/:id — Bakım kaydını sil ve kullanılan malzemeleri stoğa geri iade et
router.delete('/:id', requireRole('Yönetici'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: maintRows } = await client.query('SELECT * FROM maintenance_records WHERE id = $1', [req.params.id]);
    if (!maintRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bakım kaydı bulunamadı.' });
    }

    const rec = maintRows[0];

    // Kullanılan malzemeleri bul ve stoğa iade et
    const { rows: usedMats } = await client.query(
      'SELECT material_id, qty FROM maintenance_used_materials WHERE record_id = $1',
      [rec.id]
    );

    for (const u of usedMats) {
      const returnQty = parseFloat(u.qty);
      await client.query('UPDATE materials SET qty = qty + $1 WHERE id = $2', [returnQty, u.material_id]);
      await client.query(
        `INSERT INTO stock_movements (material_id, type, qty, date, user_id, reason)
         VALUES ($1, 'Giriş', $2, CURRENT_DATE, $3, $4)`,
        [u.material_id, returnQty, req.user.id, `Bakım iptali iadesi: ${rec.tracking_no}`]
      );
    }

    // Bakım kaydını sil (ON DELETE CASCADE ile used_materials otomatik silinir)
    await client.query('DELETE FROM maintenance_records WHERE id = $1', [rec.id]);

    await logAudit(client, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'DELETE',
      entityType: 'maintenance',
      entityId: rec.id,
      details: { trackingNo: rec.tracking_no, assetId: rec.asset_id },
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

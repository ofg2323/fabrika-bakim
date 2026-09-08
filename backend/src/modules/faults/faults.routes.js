const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { upload, safeUnlink } = require('../../middleware/upload');
const { getNextTrackingNo } = require('../../utils/counters');
const { toCamelFault, isUuid } = require('../../utils/formatters');

const router = express.Router();
router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Arıza kaydı bulunamadı.' });
  }
  next();
});


// GET /api/faults — Arızalar listesi (filtreleme ve arama destekli)
router.get('/', async (req, res) => {
  const { filter, status, priority, assetId, assignedTo, q, limit = 50, offset = 0 } = req.query;

  let query = `
    SELECT 
      f.*,
      a.name AS asset_name,
      a.asset_code,
      a.location,
      u_rep.name AS reported_by_name,
      u_ass.name AS assigned_to_name,
      COALESCE(mat_cost.total, 0) AS materials_cost
    FROM faults f
    JOIN assets a ON a.id = f.asset_id
    LEFT JOIN users u_rep ON u_rep.id = f.reported_by
    LEFT JOIN users u_ass ON u_ass.id = f.assigned_to
    LEFT JOIN (
      SELECT fault_id, SUM(qty * unit_cost) AS total
      FROM fault_used_materials
      GROUP BY fault_id
    ) mat_cost ON mat_cost.fault_id = f.id
    WHERE 1=1
  `;
  const params = [];
  let paramIdx = 1;

  if (filter === 'open') {
    query += ` AND f.status != 'Tamamlandı'`;
  } else if (filter === 'resolved') {
    query += ` AND f.status = 'Tamamlandı'`;
  }

  if (status && status.trim()) {
    query += ` AND f.status = $${paramIdx++}`;
    params.push(status.trim());
  }

  if (priority && priority.trim()) {
    query += ` AND f.priority = $${paramIdx++}`;
    params.push(priority.trim());
  }

  if (assetId) {
    query += ` AND f.asset_id = $${paramIdx++}`;
    params.push(assetId);
  }

  if (assignedTo) {
    query += ` AND f.assigned_to = $${paramIdx++}`;
    params.push(assignedTo);
  }

  if (q && q.trim()) {
    query += ` AND (f.tracking_no ILIKE $${paramIdx} OR f.title ILIKE $${paramIdx} OR a.name ILIKE $${paramIdx} OR COALESCE(f.notes, '') ILIKE $${paramIdx})`;
    params.push(`%${q.trim()}%`);
    paramIdx++;
  }

  query += ` ORDER BY f.reported_date DESC, f.id DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
  params.push(parseInt(limit, 10) || 50, parseInt(offset, 10) || 0);

  const { rows } = await pool.query(query, params);
  res.json(rows.map(toCamelFault));
});

// GET /api/faults/:id — Tekil arıza detayı (kullanılan malzemeler ve eklerle birlikte)
router.get('/:id', async (req, res) => {
  const query = `
    SELECT 
      f.*,
      a.name AS asset_name,
      a.asset_code,
      a.location,
      u_rep.name AS reported_by_name,
      u_ass.name AS assigned_to_name,
      COALESCE(mat_cost.total, 0) AS materials_cost
    FROM faults f
    JOIN assets a ON a.id = f.asset_id
    LEFT JOIN users u_rep ON u_rep.id = f.reported_by
    LEFT JOIN users u_ass ON u_ass.id = f.assigned_to
    LEFT JOIN (
      SELECT fault_id, SUM(qty * unit_cost) AS total
      FROM fault_used_materials
      GROUP BY fault_id
    ) mat_cost ON mat_cost.fault_id = f.id
    WHERE f.id = $1
  `;
  const { rows } = await pool.query(query, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Arıza kaydı bulunamadı.' });

  const [usedMaterialsRes, attsRes] = await Promise.all([
    pool.query(`
      SELECT fum.id, fum.material_id, m.name AS material_name, m.unit AS material_unit, fum.qty, fum.unit_cost, (fum.qty * fum.unit_cost) AS total_cost
      FROM fault_used_materials fum
      JOIN materials m ON m.id = fum.material_id
      WHERE fum.fault_id = $1
      ORDER BY m.name ASC
    `, [req.params.id]),
    pool.query(`
      SELECT id, name, kind, storage_key, url, added_date
      FROM fault_attachments
      WHERE fault_id = $1
      ORDER BY added_date DESC
    `, [req.params.id]),
  ]);

  const formatted = toCamelFault(rows[0]);
  formatted.usedMaterials = usedMaterialsRes.rows.map(m => ({
    id: m.id,
    materialId: m.material_id,
    materialName: m.material_name,
    unit: m.material_unit,
    qty: parseFloat(m.qty) || 0,
    unitCost: parseFloat(m.unit_cost) || 0,
    totalCost: parseFloat(m.total_cost) || 0,
  }));
  formatted.attachments = attsRes.rows.map(a => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    storageKey: a.storage_key,
    url: a.url,
    addedDate: a.added_date,
  }));

  res.json(formatted);
});

// POST /api/faults — Yeni arıza kaydı bildir
router.post('/', async (req, res) => {
  const { assetId, title, description, priority, assignedTo } = req.body;

  if (!assetId || !title || !title.trim()) {
    return res.status(400).json({ error: 'Varlık seçimi ve arıza başlığı zorunludur.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Varlığı doğrula ve kilitle
    const { rows: assetRows } = await client.query('SELECT id, status FROM assets WHERE id = $1 FOR UPDATE', [assetId]);
    if (!assetRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Varlık bulunamadı.' });
    }

    const trackingNo = await getNextTrackingNo('fault', client);

    const { rows: faultRows } = await client.query(
      `INSERT INTO faults (
        tracking_no, asset_id, title, description, reported_by, 
        reported_date, priority, status, assigned_to
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, 'Açık', $7)
      RETURNING *`,
      [
        trackingNo,
        assetId,
        title.trim(),
        description ? description.trim() : null,
        req.user.id,
        priority || 'Orta',
        assignedTo || null,
      ]
    );

    // Eğer varlık aktif ise durumunu 'Arızalı' yap
    if (assetRows[0].status === 'Aktif') {
      await client.query("UPDATE assets SET status = 'Arızalı' WHERE id = $1", [assetId]);
    }

    await client.query('COMMIT');
    res.status(201).json(toCamelFault(faultRows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// PUT /api/faults/:id — Arıza detaylarını güncelle (malzeme kullanımı, durum, çözüm)
router.put('/:id', async (req, res) => {
  const {
    title,
    description,
    priority,
    status,
    assignedTo,
    resolvedDate,
    notes,
    externalServiceCost,
    usedMaterials,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existingRows } = await client.query('SELECT * FROM faults WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!existingRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Arıza kaydı bulunamadı.' });
    }

    const oldFault = existingRows[0];
    const newStatus = status || oldFault.status;
    let finalResolvedDate = oldFault.resolved_date;

    if (newStatus === 'Tamamlandı') {
      finalResolvedDate = resolvedDate || oldFault.resolved_date || new Date().toISOString().split('T')[0];
    } else {
      finalResolvedDate = null;
    }

    // Malzeme kullanımı farkını yönet (Stok Delta)
    if (Array.isArray(usedMaterials)) {
      // Mevcut kullanılan malzemeleri çek
      const { rows: currentMats } = await client.query(
        'SELECT material_id, qty FROM fault_used_materials WHERE fault_id = $1',
        [oldFault.id]
      );

      // Önceki malzemeleri stoğa geri iade et
      for (const cm of currentMats) {
        await client.query('UPDATE materials SET qty = qty + $1 WHERE id = $2', [cm.qty, cm.material_id]);
      }
      await client.query('DELETE FROM fault_used_materials WHERE fault_id = $1', [oldFault.id]);
      // Önceki stok hareketlerini doğrudan ref_fault_id referansı ile temizle
      await client.query('DELETE FROM stock_movements WHERE ref_fault_id = $1', [oldFault.id]);

      // Yeni listeyi doğrula, kilitle ve stoktan düş
      for (const nm of usedMaterials.filter(m => parseFloat(m.qty) > 0)) {
        const itemQty = parseFloat(nm.qty);
        const { rows: matRows } = await client.query(
          'SELECT id, name, unit_cost, qty FROM materials WHERE id = $1 FOR UPDATE',
          [nm.materialId]
        );

        if (!matRows[0]) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: `Malzeme bulunamadı (ID: ${nm.materialId}).` });
        }

        const currentQty = parseFloat(matRows[0].qty) || 0;
        if (currentQty < itemQty) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: `Yetersiz stok: "${matRows[0].name}" için mevcut stok (${currentQty}), arızada kullanılan miktardan (${itemQty}) az.`
          });
        }

        const uCost = nm.unitCost !== undefined ? parseFloat(nm.unitCost) : (parseFloat(matRows[0].unit_cost) || 0);

        await client.query(
          'INSERT INTO fault_used_materials (fault_id, material_id, qty, unit_cost) VALUES ($1, $2, $3, $4)',
          [oldFault.id, nm.materialId, itemQty, uCost]
        );

        await client.query('UPDATE materials SET qty = qty - $1 WHERE id = $2', [itemQty, nm.materialId]);

        await client.query(
          `INSERT INTO stock_movements (material_id, type, qty, date, user_id, reason, ref_fault_id)
           VALUES ($1, 'Çıkış', $2, CURRENT_DATE, $3, $4, $5)`,
          [nm.materialId, itemQty, req.user.id, `Arıza onarım sarfiyatı: ${oldFault.tracking_no}`, oldFault.id]
        );
      }
    }

    // Arıza kaydını güncelle
    const { rows: updatedFaultRows } = await client.query(
      `UPDATE faults
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           priority = COALESCE($3, priority),
           status = $4,
           assigned_to = $5,
           resolved_date = $6,
           notes = $7,
           external_service_cost = $8
       WHERE id = $9
       RETURNING *`,
      [
        title ? title.trim() : null,
        description !== undefined ? description : null,
        priority || null,
        newStatus,
        assignedTo || null,
        finalResolvedDate,
        notes !== undefined ? notes : null,
        externalServiceCost !== undefined ? parseFloat(externalServiceCost) || 0 : oldFault.external_service_cost,
        oldFault.id,
      ]
    );

    // Varlık durumunu güncelle (Eğer arıza kapandıysa ve varlığın başka açık arızası yoksa 'Aktif'e çek)
    if (newStatus === 'Tamamlandı') {
      const { rows: otherFaults } = await client.query(
        "SELECT COUNT(*)::int AS count FROM faults WHERE asset_id = $1 AND status != 'Tamamlandı' AND id != $2",
        [oldFault.asset_id, oldFault.id]
      );
      if (otherFaults[0].count === 0) {
        await client.query("UPDATE assets SET status = 'Aktif' WHERE id = $1", [oldFault.asset_id]);
      }
    } else {
      await client.query("UPDATE assets SET status = 'Arızalı' WHERE id = $1", [oldFault.asset_id]);
    }

    await client.query('COMMIT');
    res.json(toCamelFault(updatedFaultRows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// POST /api/faults/:id/attachments — Arızaya görsel/belge yükleme
router.post('/:id/attachments', upload.single('file'), async (req, res) => {
  const { name, kind, url } = req.body;
  const storageKey = req.file ? req.file.filename : null;

  const { rows } = await pool.query(
    `INSERT INTO fault_attachments (fault_id, name, kind, storage_key, url, added_date)
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
     RETURNING *`,
    [
      req.params.id,
      name || (req.file && req.file.originalname) || 'belge',
      kind || (req.file ? (req.file.mimetype.startsWith('image/') ? 'image' : 'dosya') : 'link'),
      storageKey,
      url || null,
    ]
  );

  res.status(201).json(rows[0]);
});

// DELETE /api/faults/:id/attachments/:attId — Arıza ekini sil
router.delete('/:id/attachments/:attId', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM fault_attachments WHERE id = $1 AND fault_id = $2', [req.params.attId, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Ek bulunamadı.' });

  if (rows[0].storage_key) {
    safeUnlink(rows[0].storage_key);
  }

  await pool.query('DELETE FROM fault_attachments WHERE id = $1', [req.params.attId]);
  res.status(204).end();
});

// DELETE /api/faults/:id — Arıza kaydını sil (Kullanılan malzemeler stoka iade edilir)
router.delete('/:id', requireRole('Yönetici'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: usedMats } = await client.query(
      'SELECT material_id, qty FROM fault_used_materials WHERE fault_id = $1',
      [req.params.id]
    );
    for (const u of usedMats) {
      await client.query('UPDATE materials SET qty = qty + $1 WHERE id = $2', [u.qty, u.material_id]);
    }
    const { rows } = await client.query('DELETE FROM faults WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Arıza kaydı bulunamadı.' });
    }
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

const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { upload, safeUnlink } = require('../../middleware/upload');
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
  const { limit, offset } = parsePagination(req.query, 10000, 200);

  let query = `
    SELECT 
      mr.*,
      COUNT(*) OVER() AS full_count,
      a.name AS asset_name,
      a.asset_code,
      a.group_id,
      ag.name AS group_name,
      ag.checklist AS group_checklist,
      u.name AS completed_by_name,
      COALESCE(mat_cost.total, 0) AS materials_cost,
      COALESCE(mat_cost.items, '[]'::json) AS used_materials,
      COALESCE(att_list.items, '[]'::json) AS attachments
    FROM maintenance_records mr
    JOIN assets a ON a.id = mr.asset_id
    LEFT JOIN asset_groups ag ON ag.id = a.group_id
    LEFT JOIN users u ON u.id = mr.completed_by
    LEFT JOIN (
      SELECT record_id, SUM(qty * unit_cost) AS total,
        json_agg(json_build_object(
          'id', id,
          'materialId', material_id,
          'qty', qty::float8,
          'unitCost', unit_cost::float8,
          'totalCost', (qty * unit_cost)::float8
        )) AS items
      FROM maintenance_used_materials
      GROUP BY record_id
    ) mat_cost ON mat_cost.record_id = mr.id
    LEFT JOIN (
      SELECT maintenance_id,
        json_agg(json_build_object(
          'id', id,
          'name', name,
          'kind', kind,
          'storageKey', storage_key,
          'url', url,
          'addedDate', added_date
        ) ORDER BY added_date DESC) AS items
      FROM maintenance_attachments
      GROUP BY maintenance_id
    ) att_list ON att_list.maintenance_id = mr.id
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
      ag.checklist AS group_checklist,
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
  const [usedMatsRes, attsRes] = await Promise.all([
    pool.query(`
      SELECT mum.id, mum.material_id, m.name AS material_name, m.unit AS material_unit, mum.qty, mum.unit_cost, (mum.qty * mum.unit_cost) AS total_cost
      FROM maintenance_used_materials mum
      JOIN materials m ON m.id = mum.material_id
      WHERE mum.record_id = $1
      ORDER BY m.name ASC
    `, [req.params.id]),
    pool.query(`
      SELECT id, name, kind, storage_key, url, added_date
      FROM maintenance_attachments
      WHERE maintenance_id = $1
      ORDER BY added_date DESC
    `, [req.params.id]),
  ]);

  const formatted = toCamelMaintenance(rows[0]);
  formatted.usedMaterials = usedMatsRes.rows.map(m => ({
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

// POST /api/maintenance — Yeni bakım kaydı oluştur (Atomik Transaction ile Stok Düşümü ve Varlık Güncellemesi)
router.post('/', requireRole('Yönetici', 'Teknisyen'), async (req, res) => {
  const {
    assetId,
    type,
    startDate,
    endDate,
    dueDate,
    checklistResults,
    checklist,
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
  const rawChecklists = Array.isArray(checklistResults)
    ? checklistResults
    : (Array.isArray(checklist) ? checklist : []);
  const materialsList = Array.isArray(usedMaterials) ? usedMaterials.filter(m => parseFloat(m.qty) > 0) : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Varlık kontrolü
    const { rows: assetRows } = await client.query(
      'SELECT a.id, a.name, a.last_maintenance_date, a.created_date, ag.period_days, ag.weekend_work, ag.checklist AS group_checklist FROM assets a LEFT JOIN asset_groups ag ON ag.id = a.group_id WHERE a.id = $1 FOR UPDATE OF a',
      [assetId]
    );
    if (!assetRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Varlık bulunamadı.' });
    }

    let resolvedDueDate = dueDate || null;
    if (!resolvedDueDate && assetRows[0].period_days) {
      const baseRaw = assetRows[0].last_maintenance_date || assetRows[0].created_date || start;
      const baseStr = (baseRaw instanceof Date ? baseRaw.toISOString() : String(baseRaw)).slice(0, 10);
      const [by, bm, bd] = baseStr.split('-').map(Number);
      if (by && bm && bd) {
        const dt = new Date(by, bm - 1, bd, 12, 0, 0);
        dt.setDate(dt.getDate() + Number(assetRows[0].period_days || 0));
        if (!assetRows[0].weekend_work) {
          const wd = dt.getDay();
          if (wd === 6) dt.setDate(dt.getDate() + 2);
          else if (wd === 0) dt.setDate(dt.getDate() + 1);
        }
        resolvedDueDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      }
    } else if (resolvedDueDate && !assetRows[0].weekend_work) {
      const [by, bm, bd] = String(resolvedDueDate).slice(0, 10).split('-').map(Number);
      if (by && bm && bd) {
        const dt = new Date(by, bm - 1, bd, 12, 0, 0);
        const wd = dt.getDay();
        if (wd === 6) dt.setDate(dt.getDate() + 2);
        else if (wd === 0) dt.setDate(dt.getDate() + 1);
        resolvedDueDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      }
    }

    const checklists = (rawChecklists.length > 0
      ? rawChecklists
      : (Array.isArray(assetRows[0].group_checklist) ? assetRows[0].group_checklist : [])
    ).map(q => ({
      questionId: q.questionId || q.id,
      text: q.text,
      result: q.result || q.status || 'Uygun',
    }));

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
        resolvedDueDate,
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

// PUT /api/maintenance/:id — Bakım kaydını güncelle (kontrol listesi, kullanılan malzemeler, tarihler, notlar)
router.put('/:id', requireRole('Yönetici', 'Teknisyen'), async (req, res) => {
  const {
    assetId,
    type,
    startDate,
    endDate,
    dueDate,
    checklistResults,
    checklist,
    usedMaterials,
    notes,
    extraCost,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existingRows } = await client.query('SELECT * FROM maintenance_records WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!existingRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Bakım kaydı bulunamadı.' });
    }

    const oldRec = existingRows[0];
    const targetAssetId = assetId || oldRec.asset_id;
    const maintType = type || oldRec.type || 'Periyodik';
    const start = startDate || oldRec.start_date;
    const end = endDate || oldRec.end_date || start;
    const extra = extraCost !== undefined ? (parseFloat(extraCost) || 0) : (parseFloat(oldRec.extra_cost) || 0);
    const notesVal = notes !== undefined ? (notes ? notes.trim() : null) : oldRec.notes;

    const rawChecklists = Array.isArray(checklistResults)
      ? checklistResults
      : (Array.isArray(checklist) ? checklist : null);
    const finalChecklists = rawChecklists !== null
      ? rawChecklists.map(q => ({
          questionId: q.questionId || q.id,
          text: q.text,
          result: q.result || q.status || 'Uygun',
        }))
      : (oldRec.checklist_results || []);

    const { rows: assetRows } = await client.query('SELECT id, name FROM assets WHERE id = $1 FOR UPDATE', [targetAssetId]);
    if (!assetRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Varlık bulunamadı.' });
    }

    // Kullanılan malzeme listesi gönderildiyse stok farkını (delta) uygula
    if (Array.isArray(usedMaterials)) {
      const { rows: currentMats } = await client.query(
        'SELECT material_id, qty FROM maintenance_used_materials WHERE record_id = $1',
        [oldRec.id]
      );

      for (const cm of currentMats) {
        await client.query('UPDATE materials SET qty = qty + $1 WHERE id = $2', [cm.qty, cm.material_id]);
      }
      await client.query('DELETE FROM maintenance_used_materials WHERE record_id = $1', [oldRec.id]);
      await client.query('DELETE FROM stock_movements WHERE ref_maintenance_id = $1', [oldRec.id]);

      for (const item of usedMaterials.filter(m => parseFloat(m.qty) > 0 && m.materialId)) {
        const itemQty = parseFloat(item.qty);
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

        await client.query(
          `INSERT INTO maintenance_used_materials (record_id, material_id, qty, unit_cost)
           VALUES ($1, $2, $3, $4)`,
          [oldRec.id, item.materialId, itemQty, unitCost]
        );

        await client.query('UPDATE materials SET qty = qty - $1 WHERE id = $2', [itemQty, item.materialId]);

        await client.query(
          `INSERT INTO stock_movements (material_id, type, qty, date, user_id, reason, ref_maintenance_id)
           VALUES ($1, 'Çıkış', $2, $3, $4, $5, $6)`,
          [
            item.materialId,
            itemQty,
            end,
            req.user.id,
            `Bakım kullanımı: ${oldRec.tracking_no} (${assetRows[0].name})`,
            oldRec.id,
          ]
        );
      }
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE maintenance_records
       SET asset_id = $1,
           due_date = COALESCE($2, due_date),
           type = $3,
           start_date = $4,
           end_date = $5,
           checklist_results = $6,
           notes = $7,
           extra_cost = $8
       WHERE id = $9
       RETURNING *`,
      [
        targetAssetId,
        dueDate !== undefined ? dueDate : null,
        maintType,
        start,
        end,
        JSON.stringify(finalChecklists),
        notesVal,
        extra,
        oldRec.id,
      ]
    );

    await client.query(
      `UPDATE assets 
       SET last_maintenance_date = (
         SELECT MAX(end_date) FROM maintenance_records WHERE asset_id = $1
       )
       WHERE id = $1`,
      [targetAssetId]
    );

    await logAudit(client, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'UPDATE',
      entityType: 'maintenance',
      entityId: oldRec.id,
      details: { trackingNo: oldRec.tracking_no, assetId: targetAssetId, type: maintType },
      ipAddress: getClientIp(req),
    });

    const [attsRes, usedMatsRes] = await Promise.all([
      client.query(
        `SELECT id, name, kind, storage_key AS "storageKey", url, added_date AS "addedDate"
         FROM maintenance_attachments
         WHERE maintenance_id = $1
         ORDER BY added_date DESC`,
        [oldRec.id]
      ),
      client.query(
        `SELECT id, material_id AS "materialId", qty::float8 AS qty, unit_cost::float8 AS "unitCost", (qty * unit_cost)::float8 AS "totalCost"
         FROM maintenance_used_materials
         WHERE record_id = $1`,
        [oldRec.id]
      ),
    ]);

    await client.query('COMMIT');
    const formatted = toCamelMaintenance({
      ...updatedRows[0],
      attachments: attsRes.rows,
      used_materials: usedMatsRes.rows,
    });
    res.json(formatted);
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

    // Varsa yüklenmiş ek belgeleri temizle
    const { rows: attRows } = await client.query('SELECT storage_key FROM maintenance_attachments WHERE maintenance_id = $1 AND storage_key IS NOT NULL', [rec.id]);
    for (const a of attRows) {
      safeUnlink(a.storage_key);
    }

    // Bakım kaydını sil (ON DELETE CASCADE ile used_materials ve attachments otomatik silinir)
    await client.query('DELETE FROM maintenance_records WHERE id = $1', [rec.id]);

    // Varlığın son bakım tarihini güncel kayıtlara göre yeniden hesapla
    await client.query(
      `UPDATE assets 
       SET last_maintenance_date = (
         SELECT MAX(end_date) FROM maintenance_records WHERE asset_id = $1
       )
       WHERE id = $1`,
      [rec.asset_id]
    );

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

// POST /api/maintenance/:id/attachments — Bakıma dosya, resim veya link ekle
router.post('/:id/attachments', requireRole('Yönetici', 'Teknisyen'), upload.single('file'), async (req, res) => {
  const { name, kind, url } = req.body;
  const isLink = kind === 'link';

  if (!isLink && !req.file) {
    return res.status(400).json({ error: 'Yüklenecek bir dosya seçilmedi veya geçersiz dosya biçimi.' });
  }

  const attName = (name && name.trim()) || (req.file ? req.file.originalname : 'Bakım Belgesi');
  const attKind = isLink ? 'link' : (req.file.mimetype.startsWith('image/') ? 'image' : 'document');
  const storageKey = req.file ? req.file.filename : null;
  const linkUrl = isLink ? (url ? url.trim() : null) : null;

  const { rows } = await pool.query(
    `INSERT INTO maintenance_attachments (maintenance_id, name, kind, storage_key, url)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [req.params.id, attName, attKind, storageKey, linkUrl]
  );

  res.status(201).json({
    id: rows[0].id,
    name: rows[0].name,
    kind: rows[0].kind,
    storageKey: rows[0].storage_key,
    url: rows[0].url,
    addedDate: rows[0].added_date,
  });
});

// DELETE /api/maintenance/:id/attachments/:attId — Bakım ekini sil
router.delete('/:id/attachments/:attId', requireRole('Yönetici', 'Teknisyen'), async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, storage_key FROM maintenance_attachments WHERE (id::text = $1 OR storage_key = $1) AND maintenance_id = $2',
    [req.params.attId, req.params.id]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Ek bulunamadı.' });

  if (rows[0].storage_key) {
    safeUnlink(rows[0].storage_key);
  }

  await pool.query('DELETE FROM maintenance_attachments WHERE id = $1', [rows[0].id]);
  res.status(204).end();
});

module.exports = router;

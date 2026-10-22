const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { upload, safeUnlink } = require('../../middleware/upload');
const { getNextTrackingNo } = require('../../utils/counters');
const { toCamelFault, isUuid } = require('../../utils/formatters');
const { parsePagination, setPaginationHeaders } = require('../../utils/pagination');
const { logAudit, getClientIp } = require('../../utils/audit');

const router = express.Router();
router.use(requireAuth);

function parseDateStr(val) {
  if (!val) return null;
  val = String(val).trim();
  if (!val) return null;

  // YYYY-MM-DD veya YYYY/MM/DD veya YYYY.MM.DD
  let m = val.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, '0');
    const d = m[3].padStart(2, '0');
    if (parseInt(mo, 10) >= 1 && parseInt(mo, 10) <= 12 && parseInt(d, 10) >= 1 && parseInt(d, 10) <= 31) {
      return `${y}-${mo}-${d}`;
    }
  }

  // Standart Türkçe/Avrupa: DD.MM.YYYY veya DD/MM/YYYY veya DD-MM-YYYY
  m = val.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    const y = m[3];
    if (parseInt(mo, 10) >= 1 && parseInt(mo, 10) <= 12 && parseInt(d, 10) >= 1 && parseInt(d, 10) <= 31) {
      return `${y}-${mo}-${d}`;
    }
  }

  // 2 basamaklı yıl: DD.MM.YY
  m = val.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    const yy = parseInt(m[3], 10);
    const y = yy > 50 ? String(1900 + yy) : String(2000 + yy);
    if (parseInt(mo, 10) >= 1 && parseInt(mo, 10) <= 12 && parseInt(d, 10) >= 1 && parseInt(d, 10) <= 31) {
      return `${y}-${mo}-${d}`;
    }
  }

  // Excel seri tarihi (30000 - 65000)
  const num = parseFloat(val);
  if (!isNaN(num) && num > 30000 && num < 65000 && /^\d+(\.\d+)?$/.test(val)) {
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${mo}-${d}`;
    }
  }

  // JS Date nesnesi fallback ayrıştırma
  const dt = new Date(val);
  if (!isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    if (y >= 1990 && y <= 2100) {
      const mo = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${mo}-${d}`;
    }
  }

  return null;
}

function normalizeFaultStatus(rawStatus, hasResolvedDate) {
  if (!rawStatus || typeof rawStatus !== 'string') {
    return hasResolvedDate ? 'Tamamlandı' : 'Açık';
  }
  const s = rawStatus.trim().toLowerCase().replace(/['"Iıİi]/g, c => {
    if (c === 'I' || c === 'ı') return 'i';
    if (c === 'İ' || c === 'i') return 'i';
    return '';
  });

  if (['tamamlandi', 'cozuldu', 'kapandi', 'bitti', 'tamam', 'ok', 'done', 'resolved', 'closed', 'tamamlanmis'].some(k => s.includes(k))) {
    return 'Tamamlandı';
  }

  if (['devam', 'inceleniyor', 'islemde', 'suruyor', 'progress'].some(k => s.includes(k))) {
    return 'Devam Ediyor';
  }

  if (hasResolvedDate && !['acik', 'open', 'devam'].some(k => s.includes(k))) {
    return 'Tamamlandı';
  }

  return 'Açık';
}

function normalizeFaultPriority(rawPriority) {
  if (!rawPriority || typeof rawPriority !== 'string') return 'Orta';
  const p = rawPriority.trim().toLowerCase();
  if (p.includes('düşük') || p.includes('dusuk') || p.includes('low')) return 'Düşük';
  if (p.includes('kritik') || p.includes('yüksek') || p.includes('yuksek') || p.includes('acil') || p.includes('high')) return 'Yüksek';
  return 'Orta';
}

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Arıza kaydı bulunamadı.' });
  }
  next();
});


// GET /api/faults — Arızalar listesi (filtreleme ve arama destekli)
router.get('/', async (req, res) => {
  const { filter, status, priority, assetId, assignedTo, q, all } = req.query;
  let { limit, offset } = parsePagination(req.query, 10000, 200);

  let query = `
    SELECT 
      f.*,
      COUNT(*) OVER() AS full_count,
      a.name AS asset_name,
      a.asset_code,
      a.location,
      u_rep.name AS reported_by_name,
      u_ass.name AS assigned_to_name,
      COALESCE(mat_cost.total, 0) AS materials_cost,
      COALESCE(mat_cost.items, '[]'::json) AS used_materials
    FROM faults f
    JOIN assets a ON a.id = f.asset_id
    LEFT JOIN users u_rep ON u_rep.id = f.reported_by
    LEFT JOIN users u_ass ON u_ass.id = f.assigned_to
    LEFT JOIN (
      SELECT fault_id, SUM(qty * unit_cost) AS total,
        json_agg(json_build_object(
          'id', id,
          'materialId', material_id,
          'qty', qty::float8,
          'unitCost', unit_cost::float8,
          'totalCost', (qty * unit_cost)::float8
        )) AS items
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
  params.push(limit, offset);

  const { rows } = await pool.query(query, params);
  const totalCount = rows[0]?.full_count ? parseInt(rows[0].full_count, 10) : 0;
  setPaginationHeaders(res, totalCount, limit, offset);

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

// POST /api/faults — Yeni arıza kaydı bildir (geçmiş tarih ve durum desteğiyle)
router.post('/', async (req, res) => {
  const { assetId, title, description, priority, assignedTo, reportedDate, status, resolvedDate, externalServiceCost, notes, reportedBy } = req.body;

  if (!assetId || !title || !title.trim()) {
    return res.status(400).json({ error: 'Varlık seçimi ve arıza başlığı zorunludur.' });
  }

  const parsedRepDate = parseDateStr(reportedDate);
  const parsedResDate = parseDateStr(resolvedDate);
  const faultStatus = normalizeFaultStatus(status, !!parsedResDate);
  const faultPriority = normalizeFaultPriority(priority);
  const rDate = parsedRepDate || new Date().toISOString().slice(0, 10);
  const resDate = faultStatus === 'Tamamlandı' ? (parsedResDate || rDate) : null;
  const cost = parseFloat(externalServiceCost) || 0;

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
        reported_date, priority, status, assigned_to, resolved_date, notes, external_service_cost
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        trackingNo,
        assetId,
        title.trim(),
        description ? description.trim() : null,
        reportedBy || req.user.id,
        rDate,
        faultPriority,
        faultStatus,
        assignedTo || null,
        resDate,
        notes ? notes.trim() : null,
        cost,
      ]
    );

    // Eğer arıza henüz açık ise ve varlık aktif ise durumunu 'Arızalı' yap
    if (faultStatus !== 'Tamamlandı' && assetRows[0].status === 'Aktif') {
      await client.query("UPDATE assets SET status = 'Arızalı' WHERE id = $1", [assetId]);
    }

    await logAudit(client, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'CREATE',
      entityType: 'fault',
      entityId: faultRows[0].id,
      details: { trackingNo, assetId, title: title.trim(), priority: faultPriority, status: faultStatus },
      ipAddress: getClientIp(req),
    });

    await client.query('COMMIT');
    res.status(201).json(toCamelFault(faultRows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// POST /api/faults/bulk — Toplu arıza kaydı aktarımı (geçmiş ve açık kayıtlar)
router.post('/bulk', requireRole('Yönetici', 'Teknisyen'), async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'İçe aktarılacak arıza kayıtları bulunamadı.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];

    for (const item of items) {
      let { assetId, assetRef, assetCode, assetName, title, description, priority, assignedTo, reportedBy, reportedDate, status, resolvedDate, externalServiceCost, cost: itemCost, notes, resolutionNotes } = item;
      if (!title || !title.trim()) continue;

      let finalAssetId = assetId;
      if (!finalAssetId || !isUuid(finalAssetId)) {
        const ref = (assetRef || assetCode || assetName || assetId || '').toString().trim();
        if (ref) {
          const { rows: matchedAssets } = await client.query(
            'SELECT id FROM assets WHERE asset_code ILIKE $1 OR name ILIKE $1 LIMIT 1',
            [ref]
          );
          if (matchedAssets[0]) {
            finalAssetId = matchedAssets[0].id;
          }
        }
      }

      if (!finalAssetId) continue;

      const trackingNo = await getNextTrackingNo('fault', client);
      const parsedRepDate = parseDateStr(reportedDate);
      const parsedResDate = parseDateStr(resolvedDate);
      const faultStatus = normalizeFaultStatus(status, !!parsedResDate);
      const faultPriority = normalizeFaultPriority(priority);
      const rDate = parsedRepDate || new Date().toISOString().slice(0, 10);
      const resDate = faultStatus === 'Tamamlandı' ? (parsedResDate || rDate) : null;
      const finalCost = parseFloat(externalServiceCost !== undefined ? externalServiceCost : itemCost) || 0;
      const finalNotes = (notes !== undefined ? notes : resolutionNotes) ? String(notes !== undefined ? notes : resolutionNotes).trim() : null;

      const { rows } = await client.query(
        `INSERT INTO faults (
          tracking_no, asset_id, title, description, reported_by, 
          reported_date, priority, status, assigned_to, resolved_date, notes, external_service_cost
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          trackingNo,
          finalAssetId,
          title.trim(),
          description ? description.trim() : null,
          reportedBy || req.user.id,
          rDate,
          faultPriority,
          faultStatus,
          assignedTo || null,
          resDate,
          finalNotes,
          finalCost,
        ]
      );

      if (faultStatus !== 'Tamamlandı') {
        await client.query("UPDATE assets SET status = 'Arızalı' WHERE id = $1 AND status = 'Aktif'", [finalAssetId]);
      }

      created.push(toCamelFault(rows[0]));
    }

    await logAudit(client, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'BULK_IMPORT',
      entityType: 'fault',
      details: { count: created.length },
      ipAddress: getClientIp(req),
    });

    await client.query('COMMIT');
    res.status(201).json({ count: created.length, items: created });
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
    assignedUserId,
    resolvedDate,
    notes,
    techSolution,
    externalServiceCost,
    usedMaterials,
  } = req.body;

  const finalAssigned = assignedTo !== undefined ? assignedTo : (assignedUserId !== undefined ? assignedUserId : undefined);
  const finalNotes = notes !== undefined ? notes : (techSolution !== undefined ? techSolution : undefined);

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
        finalAssigned !== undefined ? (finalAssigned || null) : oldFault.assigned_to,
        finalResolvedDate,
        finalNotes !== undefined ? finalNotes : oldFault.notes,
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

    await logAudit(client, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'UPDATE',
      entityType: 'fault',
      entityId: oldFault.id,
      details: { trackingNo: oldFault.tracking_no, status: newStatus, priority },
      ipAddress: getClientIp(req),
    });

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
  const { rows } = await pool.query('SELECT * FROM fault_attachments WHERE (id::text = $1 OR storage_key = $1) AND fault_id = $2', [req.params.attId, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Ek bulunamadı.' });

  if (rows[0].storage_key) {
    safeUnlink(rows[0].storage_key);
  }

  await pool.query('DELETE FROM fault_attachments WHERE id = $1', [rows[0].id]);
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
    const { rows } = await client.query('DELETE FROM faults WHERE id = $1 RETURNING id, tracking_no', [req.params.id]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Arıza kaydı bulunamadı.' });
    }

    await logAudit(client, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'DELETE',
      entityType: 'fault',
      entityId: req.params.id,
      details: { trackingNo: rows[0].tracking_no },
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

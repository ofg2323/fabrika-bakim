const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { upload, safeUnlink } = require('../../middleware/upload');
const { getNextTrackingNo } = require('../../utils/counters');
const { toCamelInspection, isUuid } = require('../../utils/formatters');

const router = express.Router();
router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Muayene kaydı bulunamadı.' });
  }
  next();
});


// GET /api/inspections — Muayene kayıtları listesi (arama ve filtreleme destekli)
router.get('/', async (req, res) => {
  const { groupId, assetId, contractor, startDate, endDate, q, limit = 50, offset = 0 } = req.query;

  let query = `
    SELECT 
      ir.*,
      ag.name AS group_name,
      u.name AS completed_by_name,
      COALESCE(
        ARRAY_AGG(DISTINCT ira.asset_id) FILTER (WHERE ira.asset_id IS NOT NULL), 
        '{}'
      ) AS asset_ids,
      COUNT(DISTINCT ic.id)::int AS certificate_count
    FROM inspection_records ir
    JOIN asset_groups ag ON ag.id = ir.group_id
    LEFT JOIN users u ON u.id = ir.completed_by
    LEFT JOIN inspection_record_assets ira ON ira.record_id = ir.id
    LEFT JOIN inspection_certificates ic ON ic.record_id = ir.id
    WHERE 1=1
  `;
  const params = [];
  let paramIdx = 1;

  if (groupId) {
    query += ` AND ir.group_id = $${paramIdx++}`;
    params.push(groupId);
  }

  if (assetId) {
    query += ` AND EXISTS (SELECT 1 FROM inspection_record_assets sub_ira WHERE sub_ira.record_id = ir.id AND sub_ira.asset_id = $${paramIdx++})`;
    params.push(assetId);
  }

  if (contractor && contractor.trim()) {
    query += ` AND ir.contractor ILIKE $${paramIdx++}`;
    params.push(`%${contractor.trim()}%`);
  }

  if (startDate) {
    query += ` AND ir.end_date >= $${paramIdx++}`;
    params.push(startDate);
  }

  if (endDate) {
    query += ` AND ir.end_date <= $${paramIdx++}`;
    params.push(endDate);
  }

  if (q && q.trim()) {
    query += ` AND (ir.tracking_no ILIKE $${paramIdx} OR COALESCE(ir.contractor, '') ILIKE $${paramIdx} OR ag.name ILIKE $${paramIdx} OR COALESCE(ir.notes, '') ILIKE $${paramIdx})`;
    params.push(`%${q.trim()}%`);
    paramIdx++;
  }

  query += ` GROUP BY ir.id, ag.name, u.name ORDER BY ir.end_date DESC, ir.id DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
  params.push(parseInt(limit, 10) || 50, parseInt(offset, 10) || 0);

  const { rows } = await pool.query(query, params);
  res.json(rows.map(toCamelInspection));
});

// GET /api/inspections/:id — Tekil muayene detayı (kapsanan varlıklar ve sertifikalarla birlikte)
router.get('/:id', async (req, res) => {
  const query = `
    SELECT 
      ir.*,
      ag.name AS group_name,
      u.name AS completed_by_name
    FROM inspection_records ir
    JOIN asset_groups ag ON ag.id = ir.group_id
    LEFT JOIN users u ON u.id = ir.completed_by
    WHERE ir.id = $1
  `;
  const { rows } = await pool.query(query, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Muayene kaydı bulunamadı.' });

  const [assetsRes, certsRes] = await Promise.all([
    pool.query(`
      SELECT a.id, a.name, a.asset_code, a.location
      FROM assets a
      JOIN inspection_record_assets ira ON ira.asset_id = a.id
      WHERE ira.record_id = $1
      ORDER BY a.name ASC
    `, [req.params.id]),
    pool.query(`
      SELECT id, name, kind, storage_key, url, added_date
      FROM inspection_certificates
      WHERE record_id = $1
      ORDER BY added_date DESC
    `, [req.params.id]),
  ]);

  const formatted = toCamelInspection(rows[0]);
  formatted.assets = assetsRes.rows.map(a => ({
    id: a.id,
    name: a.name,
    assetCode: a.asset_code,
    location: a.location,
  }));
  formatted.assetIds = assetsRes.rows.map(a => a.id);
  formatted.certificates = certsRes.rows.map(c => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    storageKey: c.storage_key,
    url: c.url,
    addedDate: c.added_date,
  }));

  res.json(formatted);
});

// POST /api/inspections — Yeni muayene kaydı oluştur (Atomik çoklu varlık bağlama ve tarih güncellemesi)
router.post('/', requireRole('Yönetici', 'Teknisyen'), async (req, res) => {
  const {
    groupId,
    assetIds,
    contractor,
    startDate,
    endDate,
    notes,
    serviceCost,
  } = req.body;

  if (!groupId) {
    return res.status(400).json({ error: 'Varlık grubu seçimi zorunludur.' });
  }

  if (!Array.isArray(assetIds) || assetIds.length === 0) {
    return res.status(400).json({ error: 'Muayene edilecek en az bir varlık seçilmelidir.' });
  }

  const start = startDate || new Date().toISOString().split('T')[0];
  const end = endDate || start;
  const cost = parseFloat(serviceCost) || 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Takip numarası al
    const trackingNo = await getNextTrackingNo('inspection', client);

    // Muayene kaydını ekle
    const { rows: inspRows } = await client.query(
      `INSERT INTO inspection_records (
        tracking_no, group_id, contractor, start_date, end_date, notes, service_cost, completed_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        trackingNo,
        groupId,
        contractor ? contractor.trim() : null,
        start,
        end,
        notes ? notes.trim() : null,
        cost,
        req.user.id,
      ]
    );

    const record = inspRows[0];

    // Varlıkları tek sorguda bağla
    await client.query(
      `INSERT INTO inspection_record_assets (record_id, asset_id)
       SELECT $1, unnest($2::uuid[])
       ON CONFLICT DO NOTHING`,
      [record.id, assetIds]
    );

    // Kapsanan varlıkların son muayene tarihini güncelle
    await client.query(
      `UPDATE assets
       SET last_inspection_date = GREATEST(COALESCE(last_inspection_date, $1::date), $1::date)
       WHERE id = ANY($2::uuid[])`,
      [end, assetIds]
    );

    await client.query('COMMIT');
    res.status(201).json(toCamelInspection({ ...record, asset_ids: assetIds }));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// PUT /api/inspections/:id — Muayene kaydını güncelle
router.put('/:id', requireRole('Yönetici', 'Teknisyen'), async (req, res) => {
  const {
    groupId,
    assetIds,
    contractor,
    startDate,
    endDate,
    notes,
    serviceCost,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existingRows } = await client.query('SELECT * FROM inspection_records WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!existingRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Muayene kaydı bulunamadı.' });
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE inspection_records
       SET group_id = COALESCE($1, group_id),
           contractor = COALESCE($2, contractor),
           start_date = COALESCE($3, start_date),
           end_date = COALESCE($4, end_date),
           notes = $5,
           service_cost = COALESCE($6, service_cost)
       WHERE id = $7
       RETURNING *`,
      [
        groupId || null,
        contractor !== undefined ? contractor.trim() : null,
        startDate || null,
        endDate || null,
        notes !== undefined ? notes : null,
        serviceCost !== undefined ? parseFloat(serviceCost) || 0 : null,
        req.params.id,
      ]
    );

    if (Array.isArray(assetIds) && assetIds.length > 0) {
      await client.query('DELETE FROM inspection_record_assets WHERE record_id = $1', [req.params.id]);
      await client.query(
        `INSERT INTO inspection_record_assets (record_id, asset_id)
         SELECT $1, unnest($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [req.params.id, assetIds]
      );

      const targetEndDate = endDate || updatedRows[0].end_date;
      await client.query(
        `UPDATE assets
         SET last_inspection_date = GREATEST(COALESCE(last_inspection_date, $1::date), $1::date)
         WHERE id = ANY($2::uuid[])`,
        [targetEndDate, assetIds]
      );
    }

    await client.query('COMMIT');
    res.json(toCamelInspection(updatedRows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// POST /api/inspections/:id/certificates — Muayene sertifikası/belgesi yükleme
router.post('/:id/certificates', upload.single('file'), async (req, res) => {
  const { name, kind, url } = req.body;
  const storageKey = req.file ? req.file.filename : null;

  const { rows } = await pool.query(
    `INSERT INTO inspection_certificates (record_id, name, kind, storage_key, url, added_date)
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
     RETURNING *`,
    [
      req.params.id,
      name || (req.file && req.file.originalname) || 'sertifika',
      kind || (req.file ? (req.file.mimetype.startsWith('image/') ? 'image' : 'dosya') : 'link'),
      storageKey,
      url || null,
    ]
  );

  res.status(201).json(rows[0]);
});

// DELETE /api/inspections/:id/certificates/:certId — Sertifikayı sil
router.delete('/:id/certificates/:certId', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM inspection_certificates WHERE id = $1 AND record_id = $2', [req.params.certId, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Sertifika bulunamadı.' });

  if (rows[0].storage_key) {
    safeUnlink(rows[0].storage_key);
  }

  await pool.query('DELETE FROM inspection_certificates WHERE id = $1', [req.params.certId]);
  res.status(204).end();
});

// DELETE /api/inspections/:id — Muayene kaydını sil (Yalnızca Yönetici)
router.delete('/:id', requireRole('Yönetici'), async (req, res) => {
  const { rows } = await pool.query('DELETE FROM inspection_records WHERE id = $1 RETURNING id', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Muayene kaydı bulunamadı.' });
  res.status(204).end();
});

module.exports = router;

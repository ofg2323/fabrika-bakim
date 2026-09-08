const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { upload, safeUnlink } = require('../../middleware/upload');
const { getNextTrackingNo } = require('../../utils/counters');
const { toCamelExtMaint, isUuid } = require('../../utils/formatters');

const router = express.Router();
router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Dış bakım kaydı bulunamadı.' });
  }
  next();
});


// GET /api/ext-maintenance — Dış bakım kayıtları listesi (arama ve filtreleme destekli)
router.get('/', async (req, res) => {
  const { groupId, assetId, contractor, startDate, endDate, q, limit = 50, offset = 0 } = req.query;

  let query = `
    SELECT 
      em.*,
      ag.name AS group_name,
      u.name AS completed_by_name,
      COALESCE(
        ARRAY_AGG(DISTINCT ema.asset_id) FILTER (WHERE ema.asset_id IS NOT NULL), 
        '{}'
      ) AS asset_ids,
      COUNT(DISTINCT ec.id)::int AS certificate_count
    FROM ext_maint_records em
    JOIN asset_groups ag ON ag.id = em.group_id
    LEFT JOIN users u ON u.id = em.completed_by
    LEFT JOIN ext_maint_record_assets ema ON ema.record_id = em.id
    LEFT JOIN ext_maint_certificates ec ON ec.record_id = em.id
    WHERE 1=1
  `;
  const params = [];
  let paramIdx = 1;

  if (groupId) {
    query += ` AND em.group_id = $${paramIdx++}`;
    params.push(groupId);
  }

  if (assetId) {
    query += ` AND EXISTS (SELECT 1 FROM ext_maint_record_assets sub_ema WHERE sub_ema.record_id = em.id AND sub_ema.asset_id = $${paramIdx++})`;
    params.push(assetId);
  }

  if (contractor && contractor.trim()) {
    query += ` AND em.contractor ILIKE $${paramIdx++}`;
    params.push(`%${contractor.trim()}%`);
  }

  if (startDate) {
    query += ` AND em.end_date >= $${paramIdx++}`;
    params.push(startDate);
  }

  if (endDate) {
    query += ` AND em.end_date <= $${paramIdx++}`;
    params.push(endDate);
  }

  if (q && q.trim()) {
    query += ` AND (em.tracking_no ILIKE $${paramIdx} OR COALESCE(em.contractor, '') ILIKE $${paramIdx} OR ag.name ILIKE $${paramIdx} OR COALESCE(em.notes, '') ILIKE $${paramIdx})`;
    params.push(`%${q.trim()}%`);
    paramIdx++;
  }

  query += ` GROUP BY em.id, ag.name, u.name ORDER BY em.end_date DESC, em.id DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
  params.push(parseInt(limit, 10) || 50, parseInt(offset, 10) || 0);

  const { rows } = await pool.query(query, params);
  res.json(rows.map(toCamelExtMaint));
});

// GET /api/ext-maintenance/:id — Tekil dış bakım detayı (kapsanan varlıklar ve sertifikalarla birlikte)
router.get('/:id', async (req, res) => {
  const query = `
    SELECT 
      em.*,
      ag.name AS group_name,
      u.name AS completed_by_name
    FROM ext_maint_records em
    JOIN asset_groups ag ON ag.id = em.group_id
    LEFT JOIN users u ON u.id = em.completed_by
    WHERE em.id = $1
  `;
  const { rows } = await pool.query(query, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Dış bakım kaydı bulunamadı.' });

  const [assetsRes, certsRes] = await Promise.all([
    pool.query(`
      SELECT a.id, a.name, a.asset_code, a.location
      FROM assets a
      JOIN ext_maint_record_assets ema ON ema.asset_id = a.id
      WHERE ema.record_id = $1
      ORDER BY a.name ASC
    `, [req.params.id]),
    pool.query(`
      SELECT id, name, kind, storage_key, url, added_date
      FROM ext_maint_certificates
      WHERE record_id = $1
      ORDER BY added_date DESC
    `, [req.params.id]),
  ]);

  const formatted = toCamelExtMaint(rows[0]);
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

// POST /api/ext-maintenance — Yeni dış bakım kaydı oluştur (Atomik çoklu varlık bağlama ve tarih güncellemesi)
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
    return res.status(400).json({ error: 'Dış bakımı yapılacak en az bir varlık seçilmelidir.' });
  }

  const start = startDate || new Date().toISOString().split('T')[0];
  const end = endDate || start;
  const cost = parseFloat(serviceCost) || 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Takip numarası al
    const trackingNo = await getNextTrackingNo('extmaint', client);

    // Dış bakım kaydını ekle
    const { rows: extRows } = await client.query(
      `INSERT INTO ext_maint_records (
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

    const record = extRows[0];

    // Varlıkları tek sorguda bağla
    await client.query(
      `INSERT INTO ext_maint_record_assets (record_id, asset_id)
       SELECT $1, unnest($2::uuid[])
       ON CONFLICT DO NOTHING`,
      [record.id, assetIds]
    );

    // Kapsanan varlıkların son dış bakım tarihini güncelle
    await client.query(
      `UPDATE assets
       SET last_ext_maint_date = GREATEST(COALESCE(last_ext_maint_date, $1::date), $1::date)
       WHERE id = ANY($2::uuid[])`,
      [end, assetIds]
    );

    await client.query('COMMIT');
    res.status(201).json(toCamelExtMaint({ ...record, asset_ids: assetIds }));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// PUT /api/ext-maintenance/:id — Dış bakım kaydını güncelle
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

    const { rows: existingRows } = await client.query('SELECT * FROM ext_maint_records WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!existingRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Dış bakım kaydı bulunamadı.' });
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE ext_maint_records
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
      await client.query('DELETE FROM ext_maint_record_assets WHERE record_id = $1', [req.params.id]);
      await client.query(
        `INSERT INTO ext_maint_record_assets (record_id, asset_id)
         SELECT $1, unnest($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [req.params.id, assetIds]
      );

      const targetEndDate = endDate || updatedRows[0].end_date;
      await client.query(
        `UPDATE assets
         SET last_ext_maint_date = GREATEST(COALESCE(last_ext_maint_date, $1::date), $1::date)
         WHERE id = ANY($2::uuid[])`,
        [targetEndDate, assetIds]
      );
    }

    await client.query('COMMIT');
    res.json(toCamelExtMaint(updatedRows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// POST /api/ext-maintenance/:id/certificates — Dış bakım sertifikası/belgesi yükleme
router.post('/:id/certificates', upload.single('file'), async (req, res) => {
  const { name, kind, url } = req.body;
  const storageKey = req.file ? req.file.filename : null;

  const { rows } = await pool.query(
    `INSERT INTO ext_maint_certificates (record_id, name, kind, storage_key, url, added_date)
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

// DELETE /api/ext-maintenance/:id/certificates/:certId — Sertifikayı sil
router.delete('/:id/certificates/:certId', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM ext_maint_certificates WHERE id = $1 AND record_id = $2', [req.params.certId, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Sertifika bulunamadı.' });

  if (rows[0].storage_key) {
    safeUnlink(rows[0].storage_key);
  }

  await pool.query('DELETE FROM ext_maint_certificates WHERE id = $1', [req.params.certId]);
  res.status(204).end();
});

// DELETE /api/ext-maintenance/:id — Dış bakım kaydını sil (Yalnızca Yönetici)
router.delete('/:id', requireRole('Yönetici'), async (req, res) => {
  const { rows } = await pool.query('DELETE FROM ext_maint_records WHERE id = $1 RETURNING id', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Dış bakım kaydı bulunamadı.' });
  res.status(204).end();
});

module.exports = router;

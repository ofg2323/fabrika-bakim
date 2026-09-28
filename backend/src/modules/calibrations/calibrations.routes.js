const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { upload, safeUnlink } = require('../../middleware/upload');
const { getNextTrackingNo } = require('../../utils/counters');
const { toCamelCalibration, isUuid } = require('../../utils/formatters');

const router = express.Router();
router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Kalibrasyon kaydı bulunamadı.' });
  }
  next();
});

// GET /api/calibrations — Kalibrasyon kayıtları listesi
router.get('/', async (req, res) => {
  const { groupId, assetId, contractor, startDate, endDate, q, limit = 50, offset = 0 } = req.query;

  let query = `
    SELECT 
      cr.*,
      ag.name AS group_name,
      u.name AS completed_by_name,
      COALESCE(
        ARRAY_AGG(DISTINCT cra.asset_id) FILTER (WHERE cra.asset_id IS NOT NULL), 
        '{}'
      ) AS asset_ids,
      COUNT(DISTINCT cc.id)::int AS certificate_count
    FROM calibration_records cr
    JOIN asset_groups ag ON ag.id = cr.group_id
    LEFT JOIN users u ON u.id = cr.completed_by
    LEFT JOIN calibration_record_assets cra ON cra.calibration_id = cr.id
    LEFT JOIN calibration_certificates cc ON cc.calibration_id = cr.id
    WHERE 1=1
  `;
  const params = [];
  let paramIdx = 1;

  if (groupId) {
    query += ` AND cr.group_id = $${paramIdx++}`;
    params.push(groupId);
  }

  if (assetId) {
    query += ` AND EXISTS (SELECT 1 FROM calibration_record_assets sub_cra WHERE sub_cra.calibration_id = cr.id AND sub_cra.asset_id = $${paramIdx++})`;
    params.push(assetId);
  }

  if (contractor && contractor.trim()) {
    query += ` AND cr.contractor ILIKE $${paramIdx++}`;
    params.push(`%${contractor.trim()}%`);
  }

  if (startDate) {
    query += ` AND cr.end_date >= $${paramIdx++}`;
    params.push(startDate);
  }

  if (endDate) {
    query += ` AND cr.end_date <= $${paramIdx++}`;
    params.push(endDate);
  }

  if (q && q.trim()) {
    query += ` AND (cr.tracking_no ILIKE $${paramIdx} OR COALESCE(cr.contractor, '') ILIKE $${paramIdx} OR ag.name ILIKE $${paramIdx} OR COALESCE(cr.notes, '') ILIKE $${paramIdx})`;
    params.push(`%${q.trim()}%`);
    paramIdx++;
  }

  query += ` GROUP BY cr.id, ag.name, u.name ORDER BY cr.end_date DESC, cr.id DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
  params.push(parseInt(limit, 10) || 50, parseInt(offset, 10) || 0);

  const { rows } = await pool.query(query, params);
  res.json(rows.map(toCamelCalibration));
});

// GET /api/calibrations/:id — Tekil kalibrasyon detayı
router.get('/:id', async (req, res) => {
  const query = `
    SELECT 
      cr.*,
      ag.name AS group_name,
      u.name AS completed_by_name
    FROM calibration_records cr
    JOIN asset_groups ag ON ag.id = cr.group_id
    LEFT JOIN users u ON u.id = cr.completed_by
    WHERE cr.id = $1
  `;
  const { rows } = await pool.query(query, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Kalibrasyon kaydı bulunamadı.' });

  const [assetsRes, certsRes] = await Promise.all([
    pool.query(`
      SELECT a.id, a.name, a.asset_code, a.location
      FROM assets a
      JOIN calibration_record_assets cra ON cra.asset_id = a.id
      WHERE cra.calibration_id = $1
      ORDER BY a.name ASC
    `, [req.params.id]),
    pool.query(`
      SELECT id, name, kind, storage_key, url, added_date
      FROM calibration_certificates
      WHERE calibration_id = $1
      ORDER BY added_date DESC
    `, [req.params.id]),
  ]);

  const formatted = toCamelCalibration(rows[0]);
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

// POST /api/calibrations — Yeni kalibrasyon kaydı
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
    return res.status(400).json({ error: 'Kalibre edilecek en az bir varlık seçilmelidir.' });
  }

  const start = startDate || new Date().toISOString().split('T')[0];
  const end = endDate || start;
  const cost = parseFloat(serviceCost) || 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const trackingNo = await getNextTrackingNo('calibration', client);

    const { rows: calibRows } = await client.query(
      `INSERT INTO calibration_records (
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

    const record = calibRows[0];

    await client.query(
      `INSERT INTO calibration_record_assets (calibration_id, asset_id)
       SELECT $1, unnest($2::uuid[])
       ON CONFLICT DO NOTHING`,
      [record.id, assetIds]
    );

    await client.query(
      `UPDATE assets
       SET last_calibration_date = GREATEST(COALESCE(last_calibration_date, $1::date), $1::date)
       WHERE id = ANY($2::uuid[])`,
      [end, assetIds]
    );

    await client.query('COMMIT');
    res.status(201).json(toCamelCalibration({ ...record, asset_ids: assetIds }));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// PUT /api/calibrations/:id — Kalibrasyon kaydını güncelle
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

  if (!groupId) {
    return res.status(400).json({ error: 'Varlık grubu seçimi zorunludur.' });
  }

  const start = startDate || new Date().toISOString().split('T')[0];
  const end = endDate || start;
  const cost = parseFloat(serviceCost) || 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: updateRows } = await client.query(
      `UPDATE calibration_records
       SET group_id = $1, contractor = $2, start_date = $3, end_date = $4, notes = $5, service_cost = $6
       WHERE id = $7
       RETURNING *`,
      [
        groupId,
        contractor ? contractor.trim() : null,
        start,
        end,
        notes ? notes.trim() : null,
        cost,
        req.params.id,
      ]
    );

    if (!updateRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Kalibrasyon kaydı bulunamadı.' });
    }

    if (Array.isArray(assetIds)) {
      await client.query('DELETE FROM calibration_record_assets WHERE calibration_id = $1', [req.params.id]);
      if (assetIds.length > 0) {
        await client.query(
          `INSERT INTO calibration_record_assets (calibration_id, asset_id)
           SELECT $1, unnest($2::uuid[])`,
          [req.params.id, assetIds]
        );

        await client.query(
          `UPDATE assets
           SET last_calibration_date = GREATEST(COALESCE(last_calibration_date, $1::date), $1::date)
           WHERE id = ANY($2::uuid[])`,
          [end, assetIds]
        );
      }
    }

    await client.query('COMMIT');
    res.json(toCamelCalibration({ ...updateRows[0], asset_ids: assetIds || [] }));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// DELETE /api/calibrations/:id — Kalibrasyon kaydını sil
router.delete('/:id', requireRole('Yönetici'), async (req, res) => {
  const { rows: certs } = await pool.query(
    'SELECT storage_key FROM calibration_certificates WHERE calibration_id = $1 AND storage_key IS NOT NULL',
    [req.params.id]
  );
  for (const c of certs) {
    safeUnlink(c.storage_key);
  }

  const { rowCount } = await pool.query('DELETE FROM calibration_records WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Kalibrasyon kaydı bulunamadı.' });

  res.status(204).end();
});

// POST /api/calibrations/:id/certificates — Sertifika / Rapor / Link yükle
router.post(['/:id/certificates', '/:id'], requireRole('Yönetici', 'Teknisyen'), upload.single('file'), async (req, res) => {
  const { name, kind, url } = req.body;
  const isLink = kind === 'link';

  if (!isLink && !req.file) {
    return res.status(400).json({ error: 'Yüklenecek bir dosya seçilmedi veya geçersiz dosya biçimi.' });
  }

  const certName = (name && name.trim()) || (req.file ? req.file.originalname : 'Kalibrasyon Belgesi');
  const certKind = isLink ? 'link' : (req.file.mimetype.startsWith('image/') ? 'image' : 'dosya');
  const storageKey = req.file ? req.file.filename : null;
  const linkUrl = isLink ? (url ? url.trim() : null) : null;

  const { rows } = await pool.query(
    `INSERT INTO calibration_certificates (calibration_id, name, kind, storage_key, url)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [req.params.id, certName, certKind, storageKey, linkUrl]
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

// DELETE /api/calibrations/:id/certificates/:certId — Sertifikayı sil
router.delete('/:id/certificates/:certId', requireRole('Yönetici', 'Teknisyen'), async (req, res) => {
  const { rows } = await pool.query(
    'SELECT storage_key FROM calibration_certificates WHERE id = $1 AND calibration_id = $2',
    [req.params.certId, req.params.id]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Sertifika kaydı bulunamadı.' });

  if (rows[0].storage_key) {
    safeUnlink(rows[0].storage_key);
  }

  await pool.query('DELETE FROM calibration_certificates WHERE id = $1', [req.params.certId]);
  res.status(204).end();
});

module.exports = router;

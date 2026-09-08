const express = require('express');
const { upload, safeUnlink } = require('../../middleware/upload');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { isUuid, safeUuid } = require('../../utils/formatters');

const router = express.Router();
router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Varlık bulunamadı.' });
  }
  next();
});


function fmtDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function toCamel(a) {
  return {
    id: a.id, name: a.name, assetCode: a.asset_code, serial: a.serial, brand: a.brand, model: a.model,
    capacity: a.capacity, description: a.description, groupId: a.group_id, parentId: a.parent_id,
    location: a.location, status: a.status,
    lastMaintenanceDate: fmtDate(a.last_maintenance_date),
    lastInspectionDate: fmtDate(a.last_inspection_date),
    lastExtMaintDate: fmtDate(a.last_ext_maint_date),
    createdDate: fmtDate(a.created_date),
  };
}

// GET /api/assets
router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM assets ORDER BY name');
  res.json(rows.map(toCamel));
});

// GET /api/assets/:id (ekler + yedek parçalarla birlikte)
router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Varlık bulunamadı.' });
  const { rows: attachments } = await pool.query('SELECT * FROM asset_attachments WHERE asset_id=$1 ORDER BY added_date DESC', [req.params.id]);
  const { rows: spareParts } = await pool.query('SELECT material_id FROM asset_spare_parts WHERE asset_id=$1', [req.params.id]);
  res.json({
    ...toCamel(rows[0]),
    attachments: attachments.map(a => ({ id: a.id, name: a.name, kind: a.kind, storageKey: a.storage_key, url: a.url, addedDate: a.added_date })),
    spareParts: spareParts.map(s => s.material_id),
  });
});

// POST /api/assets — Varlık Kodu benzersizliği veritabanı seviyesinde (UNIQUE) garanti edilir
router.post('/', requireRole('Yönetici'), async (req, res) => {
  const b = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO assets (name, asset_code, serial, brand, model, capacity, description, group_id, parent_id, location, status, last_maintenance_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [b.name, b.assetCode || null, b.serial, b.brand, b.model, b.capacity, b.description,
       safeUuid(b.groupId), safeUuid(b.parentId), b.location, b.status || 'Aktif', b.lastMaintenanceDate || null]
    );
    res.status(201).json(toCamel(rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Bu varlık kodu zaten kullanılıyor.' });
    throw e;
  }
});

router.put('/:id', requireRole('Yönetici'), async (req, res) => {
  const b = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE assets SET name=$1, asset_code=$2, serial=$3, brand=$4, model=$5, capacity=$6, description=$7,
         group_id=$8, parent_id=$9, location=$10, status=$11, last_maintenance_date=$12
       WHERE id=$13 RETURNING *`,
      [b.name, b.assetCode || null, b.serial, b.brand, b.model, b.capacity, b.description,
       safeUuid(b.groupId), safeUuid(b.parentId), b.location, b.status, b.lastMaintenanceDate || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Varlık bulunamadı.' });
    res.json(toCamel(rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Bu varlık kodu zaten kullanılıyor.' });
    throw e;
  }
});

router.delete('/:id', requireRole('Yönetici'), async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM assets WHERE id=$1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Varlık bulunamadı.' });
  res.status(204).end();
});

// ---- Ekler ----
router.post('/:id/attachments', requireRole('Yönetici'), upload.single('file'), async (req, res) => {
  const { name, kind, url } = req.body;
  const storageKey = req.file ? req.file.filename : null;
  const { rows } = await pool.query(
    'INSERT INTO asset_attachments (asset_id, name, kind, storage_key, url) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.params.id, name || (req.file && req.file.originalname) || 'dosya', kind, storageKey, url || null]
  );
  res.status(201).json(rows[0]);
});

router.delete('/:id/attachments/:attId', requireRole('Yönetici'), async (req, res) => {
  if (!isUuid(req.params.attId)) return res.status(404).json({ error: 'Ek bulunamadı.' });
  const { rows } = await pool.query('SELECT * FROM asset_attachments WHERE id=$1 AND asset_id=$2', [req.params.attId, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Ek bulunamadı.' });
  if (rows[0].storage_key) {
    safeUnlink(rows[0].storage_key);
  }
  await pool.query('DELETE FROM asset_attachments WHERE id=$1', [req.params.attId]);
  res.status(204).end();
});

// ---- Yedek Parçalar ----
const saveSparePartsHandler = async (req, res) => {
  const { materialIds } = req.body;
  const validMaterialIds = Array.isArray(materialIds) ? materialIds.filter(isUuid) : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM asset_spare_parts WHERE asset_id=$1', [req.params.id]);
    if (validMaterialIds.length > 0) {
      await client.query(
        `INSERT INTO asset_spare_parts (asset_id, material_id)
         SELECT $1, unnest($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [req.params.id, validMaterialIds]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
router.put('/:id/spare-parts', requireRole('Yönetici'), saveSparePartsHandler);
router.post('/:id/spare-parts', requireRole('Yönetici'), saveSparePartsHandler);


router.get('/:id/spare-parts', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.id, m.name, m.unit, m.qty, m.min_qty, m.unit_cost FROM materials m
     JOIN asset_spare_parts asp ON asp.material_id = m.id
     WHERE asp.asset_id = $1 ORDER BY m.name`,
    [req.params.id]
  );
  res.json(rows.map(toCamel));
});

// ---- Varlık Geçmişi: bakım + arıza + muayene + dış bakım (tek ekranda) ----
router.get('/:id/history', async (req, res) => {
  const id = req.params.id;
  const [maint, faults, insp, ext] = await Promise.all([
    pool.query(`SELECT tracking_no, end_date AS date, type FROM maintenance_records WHERE asset_id=$1`, [id]),
    pool.query(`SELECT tracking_no, COALESCE(resolved_date, reported_date) AS date, title, status FROM faults WHERE asset_id=$1`, [id]),
    pool.query(`SELECT ir.tracking_no, ir.end_date AS date, ir.contractor FROM inspection_records ir
                JOIN inspection_record_assets ira ON ira.record_id=ir.id WHERE ira.asset_id=$1`, [id]),
    pool.query(`SELECT er.tracking_no, er.end_date AS date, er.contractor FROM ext_maint_records er
                JOIN ext_maint_record_assets era ON era.record_id=er.id WHERE era.asset_id=$1`, [id]),
  ]);
  const combined = [
    ...maint.rows.map(r => ({ kind: 'Bakım', date: r.date, label: `${r.type} bakım tamamlandı`, trackingNo: r.tracking_no })),
    ...faults.rows.map(r => ({ kind: 'Arıza', date: r.date, label: r.title, open: r.status !== 'Tamamlandı', trackingNo: r.tracking_no })),
    ...insp.rows.map(r => ({ kind: 'Muayene', date: r.date, label: `Muayene${r.contractor ? ' — ' + r.contractor : ''}`, trackingNo: r.tracking_no })),
    ...ext.rows.map(r => ({ kind: 'Dış Bakım', date: r.date, label: `Dış Bakım${r.contractor ? ' — ' + r.contractor : ''}`, trackingNo: r.tracking_no })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  res.json(combined);
});

module.exports = router;

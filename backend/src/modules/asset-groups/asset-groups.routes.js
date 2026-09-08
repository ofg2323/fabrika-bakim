const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { isUuid } = require('../../utils/formatters');

const router = express.Router();
router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Grup bulunamadı.' });
  }
  next();
});


function toCamel(g) {
  return {
    id: g.id,
    name: g.name,
    periodDays: g.period_days,
    checklist: g.checklist,
    inspectionEnabled: g.inspection_enabled,
    inspectionPeriodDays: g.inspection_period_days,
    inspectionBaselineDate: g.inspection_baseline_date,
    extMaintEnabled: g.ext_maint_enabled,
    extMaintPeriodDays: g.ext_maint_period_days,
    extMaintBaselineDate: g.ext_maint_baseline_date,
  };
}

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM asset_groups ORDER BY name');
  res.json(rows.map(toCamel));
});

router.post('/', requireRole('Yönetici'), async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(
    `INSERT INTO asset_groups (name, period_days, checklist, inspection_enabled, inspection_period_days, inspection_baseline_date, ext_maint_enabled, ext_maint_period_days, ext_maint_baseline_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [b.name, b.periodDays || 30, JSON.stringify(b.checklist || []),
     !!b.inspectionEnabled, b.inspectionPeriodDays || null, b.inspectionBaselineDate || null,
     !!b.extMaintEnabled, b.extMaintPeriodDays || null, b.extMaintBaselineDate || null]
  );
  res.status(201).json(toCamel(rows[0]));
});

router.put('/:id', requireRole('Yönetici'), async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(
    `UPDATE asset_groups SET name=$1, period_days=$2, checklist=$3, inspection_enabled=$4, inspection_period_days=$5,
       inspection_baseline_date=$6, ext_maint_enabled=$7, ext_maint_period_days=$8, ext_maint_baseline_date=$9
     WHERE id=$10 RETURNING *`,
    [b.name, b.periodDays, JSON.stringify(b.checklist || []),
     !!b.inspectionEnabled, b.inspectionPeriodDays || null, b.inspectionBaselineDate || null,
     !!b.extMaintEnabled, b.extMaintPeriodDays || null, b.extMaintBaselineDate || null,
     req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Grup bulunamadı.' });
  res.json(toCamel(rows[0]));
});

router.delete('/:id', requireRole('Yönetici'), async (req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM assets WHERE group_id=$1', [req.params.id]);
  if (rows[0].c > 0) return res.status(400).json({ error: 'Bu gruba bağlı varlıklar var, önce onları taşıyın veya silin.' });
  await pool.query('DELETE FROM asset_groups WHERE id=$1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;

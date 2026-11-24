const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { toCamelFaultNotification, isUuid } = require('../../utils/formatters');
const { parsePagination, setPaginationHeaders } = require('../../utils/pagination');
const { logAudit, getClientIp } = require('../../utils/audit');
const syncService = require('../sync/sync.service');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('Yönetici'));

const DECISIONS = ['Onaylandı', 'Reddedildi', 'Beklemeye Alındı'];

const NOTIFICATION_SELECT = `
  SELECT
    fn.*,
    COUNT(*) OVER() AS full_count,
    f.tracking_no,
    f.title,
    f.asset_id,
    a.name AS asset_name,
    f.priority,
    f.status AS fault_status,
    f.reported_by,
    u_rep.name AS reported_by_name,
    f.reported_date,
    u_dec.name AS decided_by_name
  FROM fault_notifications fn
  JOIN faults f ON f.id = fn.fault_id
  JOIN assets a ON a.id = f.asset_id
  LEFT JOIN users u_rep ON u_rep.id = f.reported_by
  LEFT JOIN users u_dec ON u_dec.id = fn.decided_by
`;

// GET /api/fault-notifications — Yönetici onay bildirimleri listesi
router.get('/', async (req, res) => {
  const { status, q } = req.query;
  const { limit, offset } = parsePagination(req.query, 10000, 200);

  let query = NOTIFICATION_SELECT + ` WHERE 1=1`;
  const params = [];
  let idx = 1;

  if (status && String(status).trim()) {
    query += ` AND fn.status = $${idx++}`;
    params.push(String(status).trim());
  }

  if (q && String(q).trim()) {
    query += ` AND (f.tracking_no ILIKE $${idx} OR f.title ILIKE $${idx} OR a.name ILIKE $${idx})`;
    params.push(`%${String(q).trim()}%`);
    idx++;
  }

  query += ` ORDER BY (fn.status = 'Beklemede') DESC, fn.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(limit, offset);

  const { rows } = await pool.query(query, params);
  setPaginationHeaders(res, rows[0]?.full_count !== undefined ? parseInt(rows[0].full_count, 10) : rows.length, limit, offset);
  res.json(rows.map(toCamelFaultNotification));
});

// PATCH /api/fault-notifications/:id/decision — Onayla / Reddet / Beklemeye al
router.patch('/:id/decision', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Bildirim bulunamadı.' });
  }

  const decision = String(req.body?.decision || '').trim();
  if (!DECISIONS.includes(decision)) {
    return res.status(400).json({ error: 'Geçersiz onay kararı.' });
  }

  const note = req.body?.note === undefined || req.body?.note === null
    ? null
    : String(req.body.note).trim().slice(0, 2000) || null;

  const { rows: updated } = await pool.query(
    `UPDATE fault_notifications
     SET status = $1, note = COALESCE($2, note), decided_by = $3, decided_at = now(), read_at = now()
     WHERE id = $4
     RETURNING *`,
    [decision, note, req.user.id, id]
  );
  if (!updated[0]) {
    return res.status(404).json({ error: 'Bildirim bulunamadı.' });
  }

  const { rows } = await pool.query(NOTIFICATION_SELECT + ` WHERE fn.id = $1`, [id]);
  const result = toCamelFaultNotification(rows[0]);

  await logAudit(pool, {
    userId: req.user.id,
    userName: req.user.name,
    action: 'UPDATE',
    entityType: 'fault_notification',
    entityId: id,
    details: { decision, faultId: updated[0].fault_id, note },
    ipAddress: getClientIp(req),
  });

  syncService.notifyNotification({ action: 'decided', decision, faultId: updated[0].fault_id });
  res.json(result);
});

module.exports = router;

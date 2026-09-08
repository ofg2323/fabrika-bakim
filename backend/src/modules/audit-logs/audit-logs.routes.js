const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { parsePagination, setPaginationHeaders } = require('../../utils/pagination');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('Yönetici'));

// GET /api/audit-logs — Denetim günlüklerini listele (Yalnızca Yönetici)
router.get('/', async (req, res) => {
  const { entityType, action, userId, startDate, endDate } = req.query;
  const { limit, offset } = parsePagination(req.query, 50, 200);

  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  let countQuery = 'SELECT COUNT(*)::int AS total FROM audit_logs WHERE 1=1';
  const params = [];
  const countParams = [];
  let paramIdx = 1;

  if (entityType) {
    query += ` AND entity_type = $${paramIdx}`;
    countQuery += ` AND entity_type = $${paramIdx}`;
    params.push(entityType);
    countParams.push(entityType);
    paramIdx++;
  }

  if (action) {
    query += ` AND action = $${paramIdx}`;
    countQuery += ` AND action = $${paramIdx}`;
    params.push(action);
    countParams.push(action);
    paramIdx++;
  }

  if (userId) {
    query += ` AND user_id = $${paramIdx}`;
    countQuery += ` AND user_id = $${paramIdx}`;
    params.push(userId);
    countParams.push(userId);
    paramIdx++;
  }

  if (startDate) {
    query += ` AND created_at >= $${paramIdx}`;
    countQuery += ` AND created_at >= $${paramIdx}`;
    params.push(startDate);
    countParams.push(startDate);
    paramIdx++;
  }

  if (endDate) {
    query += ` AND created_at <= $${paramIdx}`;
    countQuery += ` AND created_at <= $${paramIdx}`;
    params.push(endDate);
    countParams.push(endDate);
    paramIdx++;
  }

  const { rows: countRows } = await pool.query(countQuery, countParams);
  const totalCount = countRows[0]?.total || 0;

  query += ` ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
  params.push(limit, offset);

  const { rows } = await pool.query(query, params);

  setPaginationHeaders(res, totalCount, limit, offset);
  res.json({
    total: totalCount,
    limit,
    offset,
    logs: rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      details: r.details,
      ipAddress: r.ip_address,
      createdAt: r.created_at,
    })),
  });
});

module.exports = router;

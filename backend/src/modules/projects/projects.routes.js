const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { upload, safeUnlink } = require('../../middleware/upload');
const { getNextTrackingNo } = require('../../utils/counters');
const { toCamelProject, toCamelPurchase, isUuid } = require('../../utils/formatters');
const { parsePagination, setPaginationHeaders } = require('../../utils/pagination');
const { logAudit, getClientIp } = require('../../utils/audit');

const router = express.Router();
router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Proje bulunamadı.' });
  }
  next();
});


// GET /api/projects — Proje listesi (harcanan bütçe ve görev sayılarıyla birlikte)
router.get('/', async (req, res) => {
  const { status, priority, ownerUserId, q } = req.query;
  const { limit, offset } = parsePagination(req.query, 50, 200);

  let query = `
    SELECT 
      p.*,
      COUNT(*) OVER() AS full_count,
      u.name AS owner_user_name,
      COALESCE(spent.total, 0) AS spent_amount,
      COALESCE(tasks_info.cnt, 0) AS tasks_count,
      COALESCE(tasks_info.completed_cnt, 0) AS tasks_completed_count
    FROM projects p
    LEFT JOIN users u ON u.id = p.owner_user_id
    LEFT JOIN (
      SELECT project_id, SUM(total_price) AS total
      FROM purchases
      WHERE project_id IS NOT NULL
      GROUP BY project_id
    ) spent ON spent.project_id = p.id
    LEFT JOIN (
      SELECT 
        project_id, 
        COUNT(*)::int AS cnt,
        COUNT(CASE WHEN status = 'Tamamlandı' THEN 1 END)::int AS completed_cnt
      FROM project_tasks
      GROUP BY project_id
    ) tasks_info ON tasks_info.project_id = p.id
    WHERE 1=1
  `;
  const params = [];
  let paramIdx = 1;

  if (status && status.trim()) {
    query += ` AND p.status = $${paramIdx++}`;
    params.push(status.trim());
  }

  if (priority && priority.trim()) {
    query += ` AND p.priority = $${paramIdx++}`;
    params.push(priority.trim());
  }

  if (ownerUserId) {
    query += ` AND p.owner_user_id = $${paramIdx++}`;
    params.push(ownerUserId);
  }

  if (q && q.trim()) {
    query += ` AND (p.tracking_no ILIKE $${paramIdx} OR p.name ILIKE $${paramIdx} OR COALESCE(p.description, '') ILIKE $${paramIdx})`;
    params.push(`%${q.trim()}%`);
    paramIdx++;
  }

  query += ` ORDER BY p.created_date DESC, p.id DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
  params.push(limit, offset);

  const { rows } = await pool.query(query, params);
  const totalCount = rows.length > 0 ? parseInt(rows[0].full_count, 10) : 0;
  setPaginationHeaders(res, totalCount, limit, offset);
  res.json(rows.map(toCamelProject));
});

// GET /api/projects/:id — Tekil proje detayı (görevler, teklifler, bütçe geçmişi ve alımlarla birlikte)
router.get('/:id', async (req, res) => {
  const query = `
    SELECT 
      p.*,
      u.name AS owner_user_name,
      COALESCE(spent.total, 0) AS spent_amount,
      COALESCE(tasks_info.cnt, 0) AS tasks_count,
      COALESCE(tasks_info.completed_cnt, 0) AS tasks_completed_count
    FROM projects p
    LEFT JOIN users u ON u.id = p.owner_user_id
    LEFT JOIN (
      SELECT project_id, SUM(total_price) AS total
      FROM purchases
      WHERE project_id IS NOT NULL
      GROUP BY project_id
    ) spent ON spent.project_id = p.id
    LEFT JOIN (
      SELECT 
        project_id, 
        COUNT(*)::int AS cnt,
        COUNT(CASE WHEN status = 'Tamamlandı' THEN 1 END)::int AS completed_cnt
      FROM project_tasks
      GROUP BY project_id
    ) tasks_info ON tasks_info.project_id = p.id
    WHERE p.id = $1
  `;
  const { rows } = await pool.query(query, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Proje bulunamadı.' });

  const [tasksRes, quotesRes, budgetRes, progressRes, purchasesRes] = await Promise.all([
    pool.query('SELECT * FROM project_tasks WHERE project_id = $1 ORDER BY start_date ASC, id ASC', [req.params.id]),
    pool.query('SELECT * FROM project_quotes WHERE project_id = $1 ORDER BY date DESC, id DESC', [req.params.id]),
    pool.query(`
      SELECT pbh.*, u.name AS user_name 
      FROM project_budget_history pbh
      LEFT JOIN users u ON u.id = pbh.user_id
      WHERE pbh.project_id = $1 
      ORDER BY pbh.date DESC, pbh.id DESC
    `, [req.params.id]),
    pool.query(`
      SELECT ppl.*, u.name AS user_name
      FROM project_progress_logs ppl
      LEFT JOIN users u ON u.id = ppl.user_id
      WHERE ppl.project_id = $1
      ORDER BY ppl.date DESC, ppl.id DESC
    `, [req.params.id]),
    pool.query(`
      SELECT p.*, m.name AS material_name, m.unit AS material_unit, s.name AS supplier_name, u.name AS buyer_name
      FROM purchases p
      JOIN materials m ON m.id = p.material_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      LEFT JOIN users u ON u.id = p.buyer_id
      WHERE p.project_id = $1
      ORDER BY p.date DESC
    `, [req.params.id]),
  ]);

  const formatted = toCamelProject(rows[0]);
  formatted.tasks = tasksRes.rows.map(t => ({
    id: t.id,
    title: t.title,
    assignType: t.assign_type,
    assignee: t.assignee || '',
    status: t.status,
    cost: parseFloat(t.cost) || 0,
    startDate: t.start_date,
    endDate: t.end_date,
    note: t.note || '',
  }));
  formatted.quotes = quotesRes.rows.map(q => ({
    id: q.id,
    supplierId: q.supplier_id,
    supplierName: q.supplier_name || '',
    amount: parseFloat(q.amount) || 0,
    date: q.date,
    validUntil: q.valid_until,
    status: q.status,
    fileStorageKey: q.file_storage_key,
    fileName: q.file_name,
    note: q.note || '',
  }));
  formatted.budgetHistory = budgetRes.rows.map(b => ({
    id: b.id,
    date: b.date,
    amount: parseFloat(b.amount) || 0,
    note: b.note || '',
    userId: b.user_id,
    userName: b.user_name || null,
  }));
  formatted.progressLogs = progressRes.rows.map(l => ({
    id: l.id,
    date: l.date,
    note: l.note,
    userId: l.user_id,
    userName: l.user_name || null,
  }));
  formatted.purchases = purchasesRes.rows.map(toCamelPurchase);

  res.json(formatted);
});

// POST /api/projects — Yeni proje oluştur
router.post('/', requireRole('Yönetici'), async (req, res) => {
  const {
    name,
    description,
    ownerUserId,
    priority,
    status,
    startDate,
    targetEndDate,
    budgetAmount,
    budget,
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Proje adı zorunludur.' });
  }

  const initialBudget = parseFloat(budgetAmount !== undefined ? budgetAmount : budget) || 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const trackingNo = await getNextTrackingNo('project', client);

    const { rows: projRows } = await client.query(
      `INSERT INTO projects (
        tracking_no, name, description, owner_user_id, priority, status,
        start_date, target_end_date, budget_amount, created_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE)
      RETURNING *`,
      [
        trackingNo,
        name.trim(),
        description ? description.trim() : null,
        ownerUserId || null,
        priority || 'Orta',
        status || 'Planlama',
        startDate || null,
        targetEndDate || null,
        initialBudget,
      ]
    );

    const project = projRows[0];

    // Eğer başlangıç bütçesi girilmişse bütçe geçmişine ilk kaydı ekle
    if (initialBudget > 0) {
      await client.query(
        `INSERT INTO project_budget_history (project_id, date, amount, note, user_id)
         VALUES ($1, CURRENT_DATE, $2, 'İlk bütçe belirleme', $3)`,
        [project.id, initialBudget, req.user.id]
      );
    }

    await logAudit(client, {
      userId: req.user.id,
      action: 'PROJECT_CREATE',
      entity: 'projects',
      entityId: project.id,
      details: { trackingNo, name: project.name, initialBudget, priority: project.priority },
      ipAddress: getClientIp(req),
    });

    await client.query('COMMIT');
    res.status(201).json(toCamelProject(project));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// PUT /api/projects/:id — Proje bilgilerini güncelle
router.put('/:id', requireRole('Yönetici'), async (req, res) => {
  const {
    name,
    description,
    ownerUserId,
    priority,
    status,
    startDate,
    targetEndDate,
    actualEndDate,
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Proje adı zorunludur.' });
  }

  let finalActualEnd = actualEndDate || null;
  if (status === 'Tamamlandı' && !finalActualEnd) {
    finalActualEnd = new Date().toISOString().split('T')[0];
  } else if (status && status !== 'Tamamlandı') {
    finalActualEnd = null;
  }

  const { rows } = await pool.query(
    `UPDATE projects
     SET name = $1,
         description = $2,
         owner_user_id = $3,
         priority = $4,
         status = $5,
         start_date = $6,
         target_end_date = $7,
         actual_end_date = $8
     WHERE id = $9
     RETURNING *`,
    [
      name.trim(),
      description !== undefined ? description : null,
      ownerUserId || null,
      priority || 'Orta',
      status || 'Planlama',
      startDate || null,
      targetEndDate || null,
      finalActualEnd,
      req.params.id,
    ]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Proje bulunamadı.' });

  await logAudit(pool, {
    userId: req.user.id,
    action: 'PROJECT_UPDATE',
    entity: 'projects',
    entityId: req.params.id,
    details: { name: rows[0].name, status: rows[0].status, priority: rows[0].priority },
    ipAddress: getClientIp(req),
  });

  res.json(toCamelProject(rows[0]));
});

// POST /api/projects/:id/tasks — Projeye görev ekle
router.post('/:id/tasks', requireRole('Yönetici', 'Teknisyen'), async (req, res) => {
  const { title, assignType, assignee, status, cost, startDate, endDate, note } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Görev başlığı zorunludur.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO project_tasks (project_id, title, assign_type, assignee, status, cost, start_date, end_date, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      req.params.id,
      title.trim(),
      assignType || 'İç',
      assignee ? assignee.trim() : null,
      status || 'Bekliyor',
      parseFloat(cost) || 0,
      startDate || null,
      endDate || null,
      note ? note.trim() : null,
    ]
  );

  res.status(201).json(rows[0]);
});

// PUT /api/projects/:id/tasks/:taskId — Görev güncelle
router.put('/:id/tasks/:taskId', requireRole('Yönetici', 'Teknisyen'), async (req, res) => {
  const { title, assignType, assignee, status, cost, startDate, endDate, note } = req.body;

  const { rows } = await pool.query(
    `UPDATE project_tasks
     SET title = COALESCE($1, title),
         assign_type = COALESCE($2, assign_type),
         assignee = $3,
         status = COALESCE($4, status),
         cost = COALESCE($5, cost),
         start_date = $6,
         end_date = $7,
         note = $8
     WHERE id = $9 AND project_id = $10
     RETURNING *`,
    [
      title ? title.trim() : null,
      assignType || null,
      assignee !== undefined ? assignee : null,
      status || null,
      cost !== undefined ? parseFloat(cost) || 0 : null,
      startDate || null,
      endDate || null,
      note !== undefined ? note : null,
      req.params.taskId,
      req.params.id,
    ]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Görev bulunamadı.' });
  res.json(rows[0]);
});

// DELETE /api/projects/:id/tasks/:taskId — Görev sil
router.delete('/:id/tasks/:taskId', requireRole('Yönetici', 'Teknisyen'), async (req, res) => {
  const { rows } = await pool.query('DELETE FROM project_tasks WHERE id = $1 AND project_id = $2 RETURNING id', [req.params.taskId, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Görev bulunamadı.' });
  res.status(204).end();
});

// POST /api/projects/:id/quotes — Teklif ekle (dosya yükleme destekli)
router.post('/:id/quotes', upload.single('file'), async (req, res) => {
  const { supplierId, supplierName, amount, date, validUntil, status, note } = req.body;
  const storageKey = req.file ? req.file.filename : null;
  const fileName = req.file ? req.file.originalname : null;

  let finalSupplierName = (supplierName || '').trim();
  if (!finalSupplierName && supplierId) {
    const sRes = await pool.query('SELECT name FROM suppliers WHERE id = $1', [supplierId]);
    if (sRes.rows[0]) finalSupplierName = sRes.rows[0].name;
  }

  const { rows } = await pool.query(
    `INSERT INTO project_quotes (
      project_id, supplier_id, supplier_name, amount, date, valid_until, status, file_storage_key, file_name, note
    ) VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      req.params.id,
      supplierId || null,
      finalSupplierName || null,
      parseFloat(amount) || 0,
      date || null,
      validUntil || null,
      status || 'Beklemede',
      storageKey,
      fileName,
      note ? note.trim() : null,
    ]
  );

  res.status(201).json(rows[0]);
});

// DELETE /api/projects/:id/quotes/:quoteId — Teklif sil
router.delete('/:id/quotes/:quoteId', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM project_quotes WHERE id = $1 AND project_id = $2', [req.params.quoteId, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Teklif bulunamadı.' });

  if (rows[0].file_storage_key) {
    safeUnlink(rows[0].file_storage_key);
  }

  await pool.query('DELETE FROM project_quotes WHERE id = $1', [req.params.quoteId]);
  res.status(204).end();
});

// POST /api/projects/:id/budget — Bütçe revizyonu ekle ve ana bütçeyi güncelle
router.post('/:id/budget', requireRole('Yönetici'), async (req, res) => {
  const { amount, note, date } = req.body;
  const budgetVal = parseFloat(amount);

  if (isNaN(budgetVal)) {
    return res.status(400).json({ error: 'Geçerli bir bütçe tutarı girilmelidir.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bütçe geçmişine ekle
    const { rows: historyRows } = await client.query(
      `INSERT INTO project_budget_history (project_id, date, amount, note, user_id)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5)
       RETURNING *`,
      [req.params.id, date || null, budgetVal, note ? note.trim() : 'Bütçe revizyonu', req.user.id]
    );

    // Projenin güncel bütçesini güncelle
    await client.query(
      'UPDATE projects SET budget_amount = $1 WHERE id = $2',
      [budgetVal, req.params.id]
    );

    await client.query('COMMIT');
    res.status(201).json(historyRows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// POST /api/projects/:id/progress-logs — İlerleme notu ekle
router.post('/:id/progress-logs', async (req, res) => {
  const { note, date } = req.body;

  if (!note || !note.trim()) {
    return res.status(400).json({ error: 'İlerleme notu boş olamaz.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO project_progress_logs (project_id, date, note, user_id)
     VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4)
     RETURNING *`,
    [req.params.id, date || null, note.trim(), req.user.id]
  );

  res.status(201).json(rows[0]);
});

// DELETE /api/projects/:id/progress-logs/:logId — İlerleme notu sil
router.delete('/:id/progress-logs/:logId', async (req, res) => {
  const { rows } = await pool.query('DELETE FROM project_progress_logs WHERE id = $1 AND project_id = $2 RETURNING id', [req.params.logId, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'İlerleme notu bulunamadı.' });
  res.status(204).end();
});

// DELETE /api/projects/:id — Projeyi sil (Satın alma bağlantılarını güvenle koparır)
router.delete('/:id', requireRole('Yönetici'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bu projeye bağlı satın alma kayıtlarının project_id'sini null yap (satın almalar silinmesin)
    await client.query('UPDATE purchases SET project_id = NULL WHERE project_id = $1', [req.params.id]);

    // Projeyi sil (bağlı görevler, teklifler, bütçe geçmişi CASCADE ile silinir)
    const { rows } = await client.query('DELETE FROM projects WHERE id = $1 RETURNING id, name, tracking_no', [req.params.id]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Proje bulunamadı.' });
    }

    await logAudit(client, {
      userId: req.user.id,
      action: 'PROJECT_DELETE',
      entity: 'projects',
      entityId: req.params.id,
      details: { name: rows[0].name, trackingNo: rows[0].tracking_no },
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

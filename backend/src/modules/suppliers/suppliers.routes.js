const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { toCamelSupplier, isUuid } = require('../../utils/formatters');

const router = express.Router();
router.use(requireAuth);

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) {
    return res.status(404).json({ error: 'Tedarikçi bulunamadı.' });
  }
  next();
});


// GET /api/suppliers — Tedarikçi listesi (arama destekli)
router.get('/', async (req, res) => {
  const { q } = req.query;
  let query = 'SELECT * FROM suppliers';
  const params = [];

  if (q && q.trim()) {
    query += ' WHERE name ILIKE $1 OR contact_person ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1';
    params.push(`%${q.trim()}%`);
  }

  query += ' ORDER BY name ASC';
  const { rows } = await pool.query(query, params);
  res.json(rows.map(toCamelSupplier));
});

// GET /api/suppliers/:id — Tekil tedarikçi detayı
router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM suppliers WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Tedarikçi bulunamadı.' });
  res.json(toCamelSupplier(rows[0]));
});

// POST /api/suppliers — Yeni tedarikçi ekle (Yönetici ve Depo Sorumlusu)
router.post('/', requireRole('Yönetici', 'Depo Sorumlusu'), async (req, res) => {
  const { name, contactPerson, phone, email, paymentTerms, address, notes } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Tedarikçi / firma adı zorunludur.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO suppliers (name, contact_person, phone, email, payment_terms, address, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [name.trim(), contactPerson || null, phone || null, email || null, paymentTerms || null, address || null, notes || null]
  );
  res.status(201).json(toCamelSupplier(rows[0]));
});

// PUT /api/suppliers/:id — Tedarikçi güncelle
router.put('/:id', requireRole('Yönetici', 'Depo Sorumlusu'), async (req, res) => {
  const { name, contactPerson, phone, email, paymentTerms, address, notes } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Tedarikçi / firma adı zorunludur.' });
  }

  const { rows } = await pool.query(
    `UPDATE suppliers
     SET name=$1, contact_person=$2, phone=$3, email=$4, payment_terms=$5, address=$6, notes=$7
     WHERE id=$8
     RETURNING *`,
    [name.trim(), contactPerson || null, phone || null, email || null, paymentTerms || null, address || null, notes || null, req.params.id]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Tedarikçi bulunamadı.' });
  res.json(toCamelSupplier(rows[0]));
});

// DELETE /api/suppliers/:id — Tedarikçi sil (Yalnızca Yönetici)
router.delete('/:id', requireRole('Yönetici'), async (req, res) => {
  const { rows } = await pool.query('DELETE FROM suppliers WHERE id=$1 RETURNING id', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Tedarikçi bulunamadı.' });
  res.status(204).end();
});

module.exports = router;

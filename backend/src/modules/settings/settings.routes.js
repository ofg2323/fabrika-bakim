const express = require('express');
const pool = require('../../db/pool');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { upload, safeUnlink } = require('../../middleware/upload');
const { toCamelSettings } = require('../../utils/formatters');

const router = express.Router();
router.use(requireAuth);

// GET /api/settings — Baskı şablonu ve fabrika ayarları
router.get('/', async (req, res) => {
  let { rows } = await pool.query('SELECT * FROM print_template WHERE id = 1');
  if (!rows[0]) {
    await pool.query('INSERT INTO print_template (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    const retry = await pool.query('SELECT * FROM print_template WHERE id = 1');
    rows = retry.rows;
  }
  res.json(toCamelSettings(rows[0]));
});

const handleUpdateSettings = async (req, res) => {
  const {
    companyName,
    footerNote,
    pageSize,
    orientation,
    maint,
    fault,
  } = req.body;

  const { rows } = await pool.query(
    `UPDATE print_template
     SET company_name = COALESCE($1, company_name),
         footer_note = COALESCE($2, footer_note),
         page_size = COALESCE($3, page_size),
         orientation = COALESCE($4, orientation),
         maint_settings = COALESCE($5, maint_settings),
         fault_settings = COALESCE($6, fault_settings)
     WHERE id = 1
     RETURNING *`,
    [
      companyName !== undefined ? companyName.trim() : null,
      footerNote !== undefined ? footerNote.trim() : null,
      pageSize || null,
      orientation || null,
      maint ? JSON.stringify(maint) : null,
      fault ? JSON.stringify(fault) : null,
    ]
  );

  res.json(toCamelSettings(rows[0]));
};

// PUT & POST /api/settings — Baskı şablonu ve sistem ayarlarını güncelle
router.put('/', requireRole('Yönetici'), handleUpdateSettings);
router.post('/', requireRole('Yönetici'), handleUpdateSettings);

// POST /api/settings/logo — Firma logosu yükleme (Yalnızca Yönetici)
router.post('/logo', requireRole('Yönetici'), upload.single('logo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Yüklenecek bir logo dosyası seçilmedi.' });
  }

  // Eski logoyu al ve sil
  const { rows: existing } = await pool.query('SELECT logo_storage_key FROM print_template WHERE id = 1');
  if (existing[0] && existing[0].logo_storage_key) {
    safeUnlink(existing[0].logo_storage_key);
  }

  const { rows } = await pool.query(
    `UPDATE print_template
     SET logo_storage_key = $1
     WHERE id = 1
     RETURNING *`,
    [req.file.filename]
  );

  res.json(toCamelSettings(rows[0]));
});

// DELETE /api/settings/logo — Firma logosunu kaldırma
router.delete('/logo', requireRole('Yönetici'), async (req, res) => {
  const { rows: existing } = await pool.query('SELECT logo_storage_key FROM print_template WHERE id = 1');
  if (existing[0] && existing[0].logo_storage_key) {
    safeUnlink(existing[0].logo_storage_key);
  }

  const { rows } = await pool.query(
    `UPDATE print_template
     SET logo_storage_key = NULL
     WHERE id = 1
     RETURNING *`,
  );

  res.json(toCamelSettings(rows[0]));
});

module.exports = router;

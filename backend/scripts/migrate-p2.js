const pool = require('../src/db/pool');

async function migrateP2() {
  console.log('--- P2 Veritabanı İyileştirmeleri ve Kalibrasyon / Bakım Ekleri Göçü Başlatılıyor ---');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Sayaçlara calibration eklenmesi
    console.log('1. counters tablosuna calibration sayaç kaydı ekleniyor...');
    await client.query(`
      INSERT INTO counters (kind, value)
      VALUES ('calibration', 0)
      ON CONFLICT (kind) DO NOTHING;
    `);

    // 2. asset_groups tablosuna kalibrasyon sütunları eklenmesi
    console.log('2. asset_groups tablosuna kalibrasyon alanları ekleniyor...');
    await client.query(`
      ALTER TABLE asset_groups
      ADD COLUMN IF NOT EXISTS calibration_enabled BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS calibration_period_days INT,
      ADD COLUMN IF NOT EXISTS calibration_baseline_date DATE;
    `);

    // 3. maintenance_attachments tablosu eklenmesi
    console.log('3. maintenance_attachments tablosu ve indeksleri oluşturuluyor...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS maintenance_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        maintenance_id UUID NOT NULL REFERENCES maintenance_records(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'document',
        storage_key TEXT,
        url TEXT,
        added_date DATE DEFAULT CURRENT_DATE
      );
      CREATE INDEX IF NOT EXISTS idx_maint_att_maint_id ON maintenance_attachments(maintenance_id);
    `);

    // 4. calibration_records, calibration_record_assets, calibration_certificates tabloları
    console.log('4. Kalibrasyon tabloları oluşturuluyor...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS calibration_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tracking_no TEXT UNIQUE NOT NULL,
        group_id UUID REFERENCES asset_groups(id) ON DELETE SET NULL,
        contractor TEXT,
        start_date DATE,
        end_date DATE NOT NULL,
        notes TEXT,
        service_cost NUMERIC(12,2) DEFAULT 0,
        completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_calibration_records_group ON calibration_records(group_id);
      CREATE INDEX IF NOT EXISTS idx_calibration_records_end_date ON calibration_records(end_date DESC);

      CREATE TABLE IF NOT EXISTS calibration_record_assets (
        calibration_id UUID NOT NULL REFERENCES calibration_records(id) ON DELETE CASCADE,
        asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        PRIMARY KEY (calibration_id, asset_id)
      );

      CREATE INDEX IF NOT EXISTS idx_calib_rec_assets_asset ON calibration_record_assets(asset_id);

      CREATE TABLE IF NOT EXISTS calibration_certificates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        calibration_id UUID NOT NULL REFERENCES calibration_records(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'document',
        storage_key TEXT,
        url TEXT,
        added_date DATE DEFAULT CURRENT_DATE
      );

      CREATE INDEX IF NOT EXISTS idx_calib_certs_calib_id ON calibration_certificates(calibration_id);
    `);

    await client.query('COMMIT');
    console.log('✅ P2 veritabanı göçü başarıyla tamamlandı.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('P2 göç hatası:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrateP2();

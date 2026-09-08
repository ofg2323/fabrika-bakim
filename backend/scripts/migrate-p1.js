const pool = require('../src/db/pool');

async function migrateP1() {
  console.log('--- P1 Veritabanı İyileştirmeleri ve Audit Log Tablosu Göçü Başlatılıyor ---');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. audit_logs tablosu oluşturma
    console.log('1. audit_logs tablosu ve indeksleri oluşturuluyor...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        user_name TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        details JSONB DEFAULT '{}',
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
    `);

    // 2. Projeler ve diğer tablolardaki CHECK kısıtları
    console.log('2. Projeler ve bakım ek maliyetleri için CHECK kısıtları ekleniyor...');
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_projects_budget_positive') THEN
          ALTER TABLE projects ADD CONSTRAINT chk_projects_budget_positive CHECK (budget_amount >= 0);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_maintenance_extra_cost') THEN
          ALTER TABLE maintenance_records ADD CONSTRAINT chk_maintenance_extra_cost CHECK (extra_cost >= 0);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_faults_service_cost') THEN
          ALTER TABLE faults ADD CONSTRAINT chk_faults_service_cost CHECK (external_service_cost >= 0);
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
    console.log('✅ P1 veritabanı göçü başarıyla tamamlandı.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('P1 göç hatası:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrateP1();

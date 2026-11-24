const pool = require('../src/db/pool');

async function migrateP4() {
  console.log('--- P4: Arıza onay bildirimleri göçü başlatılıyor ---');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('1. fault_notifications tablosu oluşturuluyor...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS fault_notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fault_id UUID NOT NULL UNIQUE REFERENCES faults(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'Beklemede' CHECK (status IN ('Beklemede','Onaylandı','Reddedildi','Beklemeye Alındı')),
        note TEXT,
        decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
        decided_at TIMESTAMPTZ,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    console.log('2. fault_notifications(status, created_at) indeksi oluşturuluyor...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fault_notifications_status
      ON fault_notifications(status, created_at DESC);
    `);

    await client.query('COMMIT');
    console.log('✅ P4 göçü başarıyla tamamlandı. (Mevcut arızalar için geçmiş bildirim eklenmez.)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('P4 göç hatası:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrateP4();

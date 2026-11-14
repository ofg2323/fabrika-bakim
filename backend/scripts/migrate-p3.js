const pool = require('../src/db/pool');

async function migrateP3() {
  console.log('--- P3: Arıza kayıtlarının projelere bağlanması göçü başlatılıyor ---');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('1. faults tablosuna project_id sütunu ekleniyor...');
    await client.query(`
      ALTER TABLE faults
      ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
    `);

    console.log('2. faults(project_id) indeksi oluşturuluyor...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_faults_proj ON faults(project_id);
    `);

    await client.query('COMMIT');
    console.log('✅ P3 göçü başarıyla tamamlandı.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('P3 göç hatası:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrateP3();

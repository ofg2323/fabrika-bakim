require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool');

async function repair() {
  console.log('--- Neon DB Şema Başlatma Başlatılıyor ---');
  
  const client = await pool.connect();
  try {
    const schemaPath = path.join(__dirname, '../src/db/schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('CMMS veritabanı şeması (schema.sql) uygulanıyor...');
    await client.query(schemaSql);
    console.log('CMMS veritabanı şeması başarıyla uygulandı!');

    // Doğrulama
    const { rows: tables } = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log(`Başarıyla oluşturulan tablo sayısı: ${tables.length}`);
    console.log('Tablolar:', tables.map(t => t.table_name).join(', '));

    // Sayaçları doğrula
    const { rows: counters } = await client.query('SELECT * FROM counters');
    console.log('Sayaç kayıtları:', counters);

    // users tablosunu doğrula
    const { rows: userCols } = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);
    console.log('users tablosu kolonları:');
    userCols.forEach(c => console.log(`  - ${c.column_name} (${c.data_type})`));

  } catch (err) {
    console.error('Şema uygulama hatası:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

repair().catch(err => {
  console.error('İşlem başarısız:', err.message);
  process.exit(1);
});

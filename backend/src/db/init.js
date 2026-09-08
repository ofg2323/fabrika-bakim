// Kullanım: npm run db:init
// DATABASE_URL'de tanımlı veritabanına schema.sql dosyasını uygular.
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Şema uygulanıyor...');
  await pool.query(schema);
  console.log('Tamamlandı. Veritabanı tabloları oluşturuldu.');
  await pool.end();
}

main().catch((err) => {
  console.error('Şema uygulanamadı:', err.message);
  process.exit(1);
});

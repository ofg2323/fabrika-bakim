// Kullanım: npm run db:init
//
// Geriye dönük uyumluluk için korunmuştur. Boş veritabanında schema.sql'i uygular,
// mevcut veritabanında temel şemayı kaydeder ve bekleyen migration'ları çalıştırır.
// Günlük kullanımda `npm run db:migrate` yeterlidir.
const { runMigrations } = require('./migrate');
const pool = require('./pool');

async function main() {
  await runMigrations();
  console.log('Veritabanı hazır.');
}

main()
  .catch((err) => {
    console.error('Veritabanı kurulumu başarısız:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {
      /* yoksay */
    }
  });

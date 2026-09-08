const { Client } = require('pg');

async function main() {
  const client = new Client({
    user: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'postgres',
  });

  try {
    await client.connect();
    console.log('PostgreSQL bağlantısı sağlandı (kullanıcı: postgres).');

    // 1. fabrika_user rolü var mı kontrol et
    const roleRes = await client.query("SELECT rolname FROM pg_roles WHERE rolname = 'fabrika_user'");
    if (roleRes.rows.length === 0) {
      await client.query("CREATE ROLE fabrika_user WITH LOGIN PASSWORD 'sifre' CREATEDB SUPERUSER");
      console.log('✅ "fabrika_user" rolü oluşturuldu.');
    } else {
      await client.query("ALTER ROLE fabrika_user WITH LOGIN PASSWORD 'sifre' SUPERUSER");
      console.log('ℹ️ "fabrika_user" rolü doğrulandı.');
    }

    // 2. fabrika_bakim veritabanını UTF-8 olarak oluştur
    // Önce aktif bağlantıları kapat
    await client.query(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE datname = 'fabrika_bakim' AND pid <> pg_backend_pid()
    `);
    await client.query("DROP DATABASE IF EXISTS fabrika_bakim");
    await client.query("CREATE DATABASE fabrika_bakim WITH OWNER = fabrika_user ENCODING = 'UTF8' LC_COLLATE = 'C' LC_CTYPE = 'C' TEMPLATE = template0");
    console.log('✅ "fabrika_bakim" veritabanı UTF-8 kodlamasıyla oluşturuldu.');

    await client.end();
    console.log('🎉 Kurulum tamamlandı.');
  } catch (err) {
    console.error('Hata oluştu:', err);
    process.exit(1);
  }
}

main();

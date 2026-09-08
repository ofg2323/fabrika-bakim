const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
const useSSL = process.env.DATABASE_SSL === 'true' || 
  (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require'));

let sslConfig = false;
if (useSSL) {
  if (process.env.DATABASE_CA) {
    sslConfig = {
      rejectUnauthorized: true,
      ca: process.env.DATABASE_CA,
    };
  } else if (process.env.DB_SSL_ALLOW_SELFSIGNED === 'true') {
    sslConfig = { rejectUnauthorized: false };
  } else if (isProduction) {
    // Üretim ortamında sunucu sertifikası doğrulanır
    sslConfig = { rejectUnauthorized: true };
  } else {
    // Geliştirme ortamında self-signed sertifikalara tolerans gösterilebilir
    sslConfig = { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' };
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: sslConfig,
});

pool.on('error', (err) => {
  console.error('Beklenmeyen veritabanı havuzu hatası:', err);
});

module.exports = pool;

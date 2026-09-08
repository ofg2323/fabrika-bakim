const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
const useSSL = process.env.DATABASE_SSL === 'true' || 
  (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Beklenmeyen veritabanı havuzu hatası:', err);
});

module.exports = pool;

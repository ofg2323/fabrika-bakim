// Kullanım: npm run test:setup
//
// Testler yıkıcı olduğu için ayrı bir veritabanında çalışır.
// DATABASE_URL'deki veritabanı adının sonuna `_test` eklenir (ör. fabrika_bakim_test),
// veritabanı yoksa oluşturulur ve migration'lar uygulanır.
//
// TEST_DATABASE_URL vererek farklı bir test veritabanı kullanabilirsiniz.
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const BACKEND_DIR = path.resolve(__dirname, '..');

function parseDatabaseUrl(raw) {
  if (!raw) throw new Error('DATABASE_URL tanımlı değil (backend/.env).');
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new Error('DATABASE_URL geçerli bir URL değil.');
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new Error('DATABASE_URL bir PostgreSQL adresi olmalı.');
  }
  return url;
}

function withDatabase(url, dbName) {
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
    throw new Error(`Geçersiz veritabanı adı: ${dbName}`);
  }
  const copy = new URL(url.toString());
  copy.pathname = `/${dbName}`;
  return copy.toString();
}

function resolveTestDatabase() {
  const explicit = process.env.TEST_DATABASE_URL;
  const baseUrl = parseDatabaseUrl(explicit || process.env.DATABASE_URL);
  const baseName = decodeURIComponent(baseUrl.pathname.replace(/^\//, ''));

  if (!baseName) throw new Error('DATABASE_URL içinde veritabanı adı yok.');

  let testName;
  if (explicit) {
    testName = baseName;
    if (!/_test$/.test(testName) && process.env.ALLOW_DESTRUCTIVE_TESTS !== '1') {
      throw new Error(
        `TEST_DATABASE_URL "${testName}" ile bitmiyor. Güvenlik için adın _test ile bitmesi gerekir ` +
          '(veya ALLOW_DESTRUCTIVE_TESTS=1).'
      );
    }
  } else {
    testName = /_test$/.test(baseName) ? baseName : `${baseName}_test`;
  }

  return { baseUrl, baseName, testName, url: withDatabase(baseUrl, testName) };
}

async function databaseExists(adminUrl, name) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    return rows.length > 0;
  } finally {
    await client.end();
  }
}

async function createDatabase(adminUrl, name) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

async function ensureTestDatabase({ migrate = true, log = console.log } = {}) {
  const info = resolveTestDatabase();
  const adminUrl = withDatabase(info.baseUrl, 'postgres');

  let created = false;
  try {
    if (!(await databaseExists(adminUrl, info.testName))) {
      log(`Test veritabanı oluşturuluyor: ${info.testName}`);
      await createDatabase(adminUrl, info.testName);
      created = true;
    } else {
      log(`Test veritabanı hazır: ${info.testName}`);
    }
  } catch (err) {
    throw new Error(
      `Test veritabanı hazırlanamadı: ${err.message}\n` +
        'Veritabanı kullanıcısının CREATEDB yetkisi yoksa veritabanını elle oluşturun:\n' +
        `  CREATE DATABASE "${info.testName}";\n` +
        `ve TEST_DATABASE_URL=postgres://.../${info.testName} tanımlayın.`
    );
  }

  if (migrate) {
    log('Test veritabanına migration uygulanıyor...');
    const result = spawnSync(process.execPath, ['src/db/migrate.js'], {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL: info.url, NODE_ENV: 'test' },
      stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error('Test veritabanı migration\'ları başarısız oldu.');
  }

  return { ...info, created };
}

async function main() {
  const info = await ensureTestDatabase();
  const masked = new URL(info.url);
  masked.username = '';
  masked.password = '';
  console.log('\nTest veritabanı hazır:');
  console.log(`  ${masked.toString()}`);
  console.log('\nTestleri çalıştırmak için: npm test');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\nHata:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { ensureTestDatabase, resolveTestDatabase };

// Kullanım: npm test
//
// Testleri izole bir *_test veritabanında ve ayrı bir portta çalıştırır.
// - Test veritabanı yoksa oluşturur ve migration'ları uygular.
// - API_BASE/PORT 3101'dir; geliştirme sunucusu (3001) ile çakışmaz.
// - NODE_ENV=test olarak ayarlanır.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureTestDatabase } = require('./test-db');

const BACKEND_DIR = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(BACKEND_DIR, 'tests');
const TEST_PORT = process.env.TEST_PORT || '3101';
const API_BASE = process.env.API_BASE || `http://localhost:${TEST_PORT}`;

async function assertPortAvailable() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (res.ok) {
      console.error(
        `HATA: ${API_BASE} üzerinde zaten bir sunucu çalışıyor.\n` +
          'Testler yanlış veritabanına yazmamak için durduruldu. ' +
          'Sunucuyu kapatın veya TEST_PORT ile başka bir port seçin.'
      );
      process.exitCode = 1;
      return false;
    }
  } catch (_) {
    // Bağlantı yok — port uygun.
  }
  return true;
}

function testFiles() {
  return fs
    .readdirSync(TESTS_DIR)
    .filter((file) => file.endsWith('.test.js'))
    .sort()
    .map((file) => path.join('tests', file));
}

async function main() {
  if (!(await assertPortAvailable())) return;

  const info = await ensureTestDatabase();
  console.log(`\nTestler çalıştırılıyor (${info.testName}, port ${TEST_PORT})...\n`);

  const files = testFiles();
  if (files.length === 0) {
    console.error('Test dosyası bulunamadı.');
    process.exitCode = 1;
    return;
  }

  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
    cwd: BACKEND_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: info.url,
      API_BASE,
      PORT: TEST_PORT,
    },
  });

  if (result.error) {
    console.error('Testler başlatılamadı:', result.error.message);
    process.exitCode = 1;
    return;
  }

  process.exitCode = result.status === null ? 1 : result.status;
}

main().catch((err) => {
  console.error('\nTest çalıştırıcı hatası:', err.message);
  process.exitCode = 1;
});

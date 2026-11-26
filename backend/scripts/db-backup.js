// Kullanım: npm run db:backup
//
// Docker ile çalışan kurulumdan veritabanı (custom format) ve yüklenen dosyaların
// yedeğini `backups/` klasörüne alır. Eski yedekler RETENTION_DAYS (varsayılan 30) gün
// sonra silinir.
//
// Elle geri yükleme: npm run db:restore -- backups/fabrika-db-....dump --yes
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BACKUP_DIR = path.join(ROOT, 'backups');

require('dotenv').config({ path: path.join(ROOT, '.env') });
require('dotenv').config({ path: path.join(ROOT, 'backend', '.env') });

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { cwd: ROOT, ...options });
  if (result.error) {
    throw new Error(
      `docker komutu çalıştırılamadı (${result.error.message}). Docker Desktop açık mı?`
    );
  }
  return result;
}

function assertDockerReady() {
  const version = docker(['compose', 'version'], { stdio: 'ignore' });
  if (version.status !== 0) {
    throw new Error('`docker compose` kullanılamıyor. Docker Compose v2 kurulu olmalı.');
  }
  const ps = docker(['compose', 'ps', '-q', 'db'], { encoding: 'utf8' });
  if (ps.status !== 0 || !ps.stdout.trim()) {
    throw new Error('Veritabanı konteyneri çalışmıyor. Önce `docker compose up -d` çalıştırın.');
  }
}

function backupDatabase(dest) {
  const out = fs.openSync(dest, 'w');
  try {
    const result = docker(
      ['compose', 'exec', '-T', 'db', 'sh', '-c', 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],
      { stdio: ['ignore', out, 'inherit'] }
    );
    if (result.status !== 0) throw new Error('pg_dump başarısız oldu.');
  } finally {
    fs.closeSync(out);
  }
}

function backupUploads(dest) {
  const ps = docker(['compose', 'ps', '-q', 'api'], { encoding: 'utf8' });
  if (ps.status !== 0 || !ps.stdout.trim()) {
    console.warn('UYARI: API konteyneri çalışmıyor; yüklenen dosyalar yedeklenmedi.');
    return false;
  }

  const out = fs.openSync(dest, 'w');
  try {
    const result = docker(
      ['compose', 'exec', '-T', 'api', 'sh', '-c', 'tar -czf - -C /app/backend uploads'],
      { stdio: ['ignore', out, 'inherit'] }
    );
    if (result.status !== 0) throw new Error('Yükleme dosyaları arşivlenemedi.');
  } finally {
    fs.closeSync(out);
  }
  return true;
}

function cleanupOldBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return 0;
  const limit = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!/^fabrika-(db|uploads)-/.test(name)) continue;
    const full = path.join(BACKUP_DIR, name);
    const stat = fs.statSync(full);
    if (stat.mtimeMs < limit) {
      fs.unlinkSync(full);
      removed++;
    }
  }
  return removed;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  assertDockerReady();

  const ts = stamp();
  const dbFile = path.join(BACKUP_DIR, `fabrika-db-${ts}.dump`);
  const uploadsFile = path.join(BACKUP_DIR, `fabrika-uploads-${ts}.tar.gz`);

  console.log('Veritabanı yedekleniyor...');
  backupDatabase(dbFile);
  console.log(`  ✔ ${path.relative(ROOT, dbFile)} (${formatSize(fs.statSync(dbFile).size)})`);

  console.log('Yüklenen dosyalar yedekleniyor...');
  if (backupUploads(uploadsFile)) {
    console.log(`  ✔ ${path.relative(ROOT, uploadsFile)} (${formatSize(fs.statSync(uploadsFile).size)})`);
  }

  const removed = cleanupOldBackups();
  if (removed > 0) console.log(`${removed} eski yedek silindi (${RETENTION_DAYS} günden eski).`);

  console.log('\nYedekleme tamamlandı. Geri yükleme:');
  console.log(`  npm run db:restore -- ${path.relative(ROOT, dbFile)} --yes`);
}

try {
  main();
} catch (err) {
  console.error('\nYedekleme başarısız:', err.message);
  process.exitCode = 1;
}

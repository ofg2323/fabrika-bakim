// Kullanım:
//   npm run db:restore -- backups/fabrika-db-20260101-120000.dump --yes
//   npm run db:restore -- backups/....dump --yes --uploads backups/fabrika-uploads-....tar.gz
//
// DİKKAT: Bu komut mevcut veritabanı nesnelerini silip yedeği geri yükler.
// Önce `npm run db:backup` ile güncel yedeği aldığınızdan emin olun.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { cwd: ROOT, ...options });
  if (result.error) {
    throw new Error(
      `docker komutu çalıştırılamadı (${result.error.message}). Docker Desktop açık mı?`
    );
  }
  if (result.status !== 0) {
    throw new Error(`docker ${args.slice(0, 3).join(' ')} başarısız (kod ${result.status}).`);
  }
  return result;
}

function parseArgs(argv) {
  const args = { file: null, uploads: null, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--yes' || arg === '-y') args.yes = true;
    else if (arg === '--uploads') args.uploads = argv[++i];
    else if (!args.file) args.file = arg;
  }
  return args;
}

function restoreDatabase(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const result = spawnSync(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        'db',
        'sh',
        '-c',
        'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges',
      ],
      { cwd: ROOT, stdio: [fd, 'inherit', 'inherit'] }
    );
    if (result.error) throw new Error(result.error.message);
    if (result.status !== 0) throw new Error(`pg_restore ${result.status} koduyla sonlandı.`);
  } finally {
    fs.closeSync(fd);
  }
}

function restoreUploads(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const result = spawnSync(
      'docker',
      ['compose', 'exec', '-T', 'api', 'sh', '-c', 'tar -xzf - -C /app/backend'],
      { cwd: ROOT, stdio: [fd, 'inherit', 'inherit'] }
    );
    if (result.error) throw new Error(result.error.message);
    if (result.status !== 0) throw new Error('Yükleme dosyaları geri yüklenemedi.');
  } finally {
    fs.closeSync(fd);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file) {
    console.error('Kullanım: npm run db:restore -- <yedek.dump> --yes [--uploads <dosyalar.tar.gz>]');
    process.exitCode = 1;
    return;
  }

  const file = path.resolve(ROOT, args.file);
  if (!fs.existsSync(file)) {
    console.error(`Yedek bulunamadı: ${file}`);
    process.exitCode = 1;
    return;
  }

  if (!args.yes) {
    console.error(
      'Bu işlem mevcut veritabanını SİLER ve yedeği geri yükler.\n' +
        'Devam etmek için komutu --yes ile tekrar çalıştırın:\n' +
        `  npm run db:restore -- ${args.file} --yes`
    );
    process.exitCode = 1;
    return;
  }

  docker(['compose', 'version'], { stdio: 'ignore' });

  console.log('API durduruluyor...');
  docker(['compose', 'stop', 'api']);

  try {
    console.log('Veritabanı geri yükleniyor...');
    restoreDatabase(file);

    if (args.uploads) {
      const uploadsFile = path.resolve(ROOT, args.uploads);
      if (!fs.existsSync(uploadsFile)) throw new Error(`Yükleme arşivi bulunamadı: ${uploadsFile}`);
      console.log('Yüklenen dosyalar geri yükleniyor...');
      restoreUploads(uploadsFile);
    }
  } finally {
    console.log('API başlatılıyor...');
    docker(['compose', 'start', 'api']);
  }

  console.log('\nGeri yükleme tamamlandı.');
}

try {
  main();
} catch (err) {
  console.error('\nGeri yükleme başarısız:', err.message);
  process.exitCode = 1;
}

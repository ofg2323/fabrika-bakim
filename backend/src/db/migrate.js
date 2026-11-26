// Kullanım:
//   npm run db:migrate          -> bekleyen migration'ları uygular
//   npm run db:status           -> uygulanan / bekleyen migration'ları listeler
//   npm run db:migrate -- --strict  -> şema ve dosya değişikliklerinde hata verir
//
// Tasarım:
//   - `schema.sql` tek başlangıç noktasıdır ve `0001_initial` olarak kaydedilir.
//     Boş veritabanında schema.sql uygulanır; mevcut veritabanında yalnızca kaydı oluşturulur.
//   - Sonraki tüm değişiklikler `src/db/migrations/` altına numaralı dosya olarak eklenir:
//       migrations/0002_work_orders.sql
//   - Her dosya tek bir transaction içinde uygulanır. `CREATE INDEX CONCURRENTLY` gibi
//     transaction dışında çalışması gereken ifadeler kullanılmamalıdır.
//   - Uygulanmış bir migration dosyası değiştirilmemelidir; checksum uyuşmazlığı hata verir.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');
const BASELINE_VERSION = '0001_initial';
const BASELINE_NAME = 'schema.sql (temel şema)';
const ADVISORY_LOCK_KEY = 728341;

function checksum(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT,
      checksum TEXT,
      execution_ms INTEGER,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function relationExists(client, name) {
  const { rows } = await client.query('SELECT to_regclass($1)::text AS rel', [`public.${name}`]);
  return Boolean(rows[0].rel);
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{3,}_.+\.sql$/.test(file))
    .sort()
    .map((file) => ({
      file,
      version: file.replace(/\.sql$/, ''),
      fullPath: path.join(MIGRATIONS_DIR, file),
    }));
}

async function applyMigration(client, version, name, sql, log) {
  const started = Date.now();
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (version, name, checksum, execution_ms)
       VALUES ($1, $2, $3, $4)`,
      [version, name, checksum(sql), Date.now() - started]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    err.message = `"${version}" migration'ı başarısız oldu: ${err.message}`;
    throw err;
  }
  log(`  ✔ ${version} uygulandı (${Date.now() - started} ms)`);
}

async function runMigrations(options = {}) {
  const log = options.log || console.log;
  const statusOnly = Boolean(options.statusOnly);
  const strict = Boolean(options.strict);

  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    locked = true;

    await ensureMigrationsTable(client);

    const { rows: appliedRows } = await client.query(
      'SELECT version, name, checksum, execution_ms, applied_at FROM schema_migrations ORDER BY version'
    );
    const applied = new Map(appliedRows.map((row) => [row.version, row]));

    const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf8');
    const schemaChecksum = checksum(schemaSql);
    const baseline = applied.get(BASELINE_VERSION);
    const hasUsersTable = await relationExists(client, 'users');

    if (!baseline) {
      if (statusOnly) {
        log('Temel şema (0001_initial) henüz kaydedilmemiş. `npm run db:migrate` çalıştırın.');
      } else if (hasUsersTable) {
        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum, execution_ms)
           VALUES ($1, $2, $3, 0)`,
          [BASELINE_VERSION, BASELINE_NAME, schemaChecksum]
        );
        log('Mevcut veritabanı bulundu; temel şema 0001_initial olarak kaydedildi.');
      } else {
        log('Boş veritabanı: schema.sql uygulanıyor...');
        await applyMigration(client, BASELINE_VERSION, BASELINE_NAME, schemaSql, log);
      }
    } else if (baseline.checksum && baseline.checksum !== schemaChecksum) {
      const message =
        'schema.sql, kayıtlı temel şemadan farklı. Yeni kurulumlar mevcutlardan farklı olur; ' +
        'değişikliği `src/db/migrations/` altına numaralı bir dosya olarak ekleyin.';
      if (strict) throw new Error(message);
      log(`UYARI: ${message}`);
    }

    const files = listMigrationFiles();
    const seen = new Set();
    for (const item of files) {
      if (seen.has(item.version)) {
        throw new Error(`Aynı sürüm numarası birden fazla dosyada: ${item.version}`);
      }
      seen.add(item.version);
    }

    const pending = files.filter((item) => !applied.has(item.version));

    if (statusOnly) {
      log(`\nUygulanan migration'lar (${appliedRows.length}):`);
      if (appliedRows.length === 0) log('  (yok)');
      for (const row of appliedRows) {
        const date = row.applied_at instanceof Date ? row.applied_at.toISOString() : row.applied_at;
        log(`  ✔ ${row.version}  ${date || ''}`);
      }
      log(`\nBekleyen migration'lar (${pending.length}):`);
      if (pending.length === 0) log('  (yok — şema güncel)');
      for (const item of pending) log(`  • ${item.version}`);
      return { applied: appliedRows.length, pending: pending.length };
    }

    if (pending.length === 0) {
      log('Bekleyen migration yok. Şema güncel.');
      return { applied: 0, pending: 0 };
    }

    for (const item of pending) {
      log(`→ ${item.version} uygulanıyor...`);
      const sql = fs.readFileSync(item.fullPath, 'utf8');
      await applyMigration(client, item.version, item.file, sql, log);
    }

    log(`${pending.length} migration uygulandı.`);
    return { applied: pending.length, pending: 0 };
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
      } catch (_) {
        /* bağlantı kapanmışsa kilit zaten düşer */
      }
    }
    client.release();
  }
}

function printUsage() {
  console.log(`Kullanım: node src/db/migrate.js [--status] [--strict]

  --status   Uygulanan ve bekleyen migration'ları listeler, migration uygulamaz.
  --strict   schema.sql veya uygulanmış bir migration dosyası değişmişse hata verir.

Yeni migration eklemek için src/db/migrations/ altına sıradaki numarayla .sql dosyası koyun:
  migrations/0002_work_orders.sql`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  try {
    await runMigrations({
      statusOnly: args.includes('--status'),
      strict: args.includes('--strict'),
    });
  } catch (err) {
    console.error('\nMigration hatası:', err.message);
    process.exitCode = 1;
  } finally {
    try {
      await pool.end();
    } catch (_) {
      /* yoksay */
    }
  }
}

if (require.main === module) main();

module.exports = {
  runMigrations,
  listMigrationFiles,
  BASELINE_VERSION,
  MIGRATIONS_DIR,
};

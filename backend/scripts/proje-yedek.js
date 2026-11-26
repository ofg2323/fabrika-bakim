// Kullanım:
//   node backend/scripts/proje-yedek.js
//   veya proje kökündeki `yedek-al.bat`
//
// Proje kökünde `yedek/` klasörü oluşturur ve her çalışmada zaman damgalı bir paket üretir:
//
//   yedek/20261125-183000/
//     KOD/                     -> programın tamamı (node_modules, .env ve yedekler hariç)
//     VERI/veritabani.json.gz  -> tüm tabloların kayıtları (JSON)
//     VERI/dosyalar.tar.gz     -> backend/uploads içeriği
//     VERI/ozet.json           -> tablo kayıt sayıları
//     YEDEK-BILGI.md           -> manifest
//     YENIDEN-OLUSTUR.md       -> AI/insan için sıfırdan kurulum talimatı
//   yedek/fabrika-bakim-yedek-20261125-183000.zip
//
// pg_dump/Docker gerektirmez; doğrudan DATABASE_URL'e bağlanır (Neon dahil).
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const BACKEND_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(BACKEND_DIR, '..');
const YEDEK_DIR = path.join(ROOT, 'yedek');
const KEEP_SNAPSHOTS = Math.max(1, Number(process.env.YEDEK_SAKLAMA || 14));

const pool = require('../src/db/pool');

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function redactDatabaseUrl(raw) {
  try {
    const u = new URL(raw);
    return { host: u.host, database: decodeURIComponent(u.pathname.replace(/^\//, '')) };
  } catch (_) {
    return { host: 'bilinmiyor', database: 'bilinmiyor' };
  }
}

async function listTables(client) {
  const { rows } = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`
  );
  return rows.map((r) => r.table_name);
}

async function listForeignKeys(client) {
  const { rows } = await client.query(
    `SELECT DISTINCT
            tc.table_name   AS child,
            ccu.table_name  AS parent,
            kcu.column_name AS child_column,
            ccu.column_name AS parent_column,
            tc.constraint_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.constraint_schema = tc.constraint_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_name`
  );
  return rows;
}

// Ebeveyn tablolar önce gelecek şekilde sıralar (FK ihlali olmadan geri yükleme için).
function topoOrder(tables, foreignKeys) {
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const fk of foreignKeys) {
    if (fk.child === fk.parent) continue;
    if (deps.has(fk.child) && deps.has(fk.parent)) deps.get(fk.child).add(fk.parent);
  }

  const order = [];
  const done = new Set();
  while (order.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t) && [...deps.get(t)].every((p) => done.has(p)));
    if (ready.length === 0) {
      // Döngüsel FK: kalanları olduğu gibi ekle; geri yüklemede superuser ise
      // session_replication_role=replica ile kısıtlar devre dışı bırakılır.
      for (const t of tables) {
        if (!done.has(t)) {
          order.push(t);
          done.add(t);
        }
      }
      break;
    }
    for (const t of ready) {
      order.push(t);
      done.add(t);
    }
  }
  return order;
}

async function latestSchemaVersion(client) {
  try {
    const { rows } = await client.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
    return rows[0] ? rows[0].version : null;
  } catch (_) {
    return null;
  }
}

async function exportDatabase(snapshotDir) {
  const client = await pool.connect();
  try {
    const tables = await listTables(client);
    const foreignKeys = await listForeignKeys(client);
    const order = topoOrder(tables, foreignKeys);
    const schemaVersion = await latestSchemaVersion(client);
    const db = redactDatabaseUrl(process.env.DATABASE_URL);

    const selfReferences = [];
    const seenSelf = new Set();
    for (const fk of foreignKeys) {
      if (fk.child !== fk.parent) continue;
      const key = `${fk.child}.${fk.child_column}`;
      if (seenSelf.has(key)) continue;
      seenSelf.add(key);
      selfReferences.push({ table: fk.child, column: fk.child_column });
    }

    const payload = {
      format: 'cmms-project-backup',
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      source: { host: db.host, database: db.database },
      schemaVersion,
      order,
      foreignKeys: foreignKeys.map((fk) => ({
        child: fk.child,
        parent: fk.parent,
        column: fk.child_column,
        references: fk.parent_column,
      })),
      selfReferences,
      tables: {},
    };

    const counts = {};
    for (const table of order) {
      const { rows } = await client.query(`SELECT * FROM "${table.replace(/"/g, '""')}"`);
      payload.tables[table] = rows;
      counts[table] = rows.length;
      process.stdout.write(`  • ${table}: ${rows.length} kayıt\n`);
    }

    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    const gz = zlib.gzipSync(json);
    const dataDir = path.join(snapshotDir, 'VERI');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'veritabani.json.gz'), gz);

    fs.writeFileSync(
      path.join(dataDir, 'ozet.json'),
      JSON.stringify(
        {
          createdAt: payload.createdAt,
          schemaVersion,
          source: payload.source,
          totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
          counts,
        },
        null,
        2
      ),
      'utf8'
    );

    return {
      schemaVersion,
      counts,
      totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
      dataFile: path.join(dataDir, 'veritabani.json.gz'),
      checksum: sha256(gz),
      rawBytes: json.length,
      gzBytes: gz.length,
      source: db,
    };
  } finally {
    client.release();
  }
}

const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'yedek', 'backups', 'uploads', 'uploads-test', 'tools']);
const EXCLUDE_FILES = new Set(['.env']);

function shouldCopy(src) {
  const rel = path.relative(ROOT, src);
  if (!rel) return true;

  const parts = rel.split(path.sep);
  if (parts.some((part) => EXCLUDE_DIRS.has(part))) return false;

  const base = path.basename(src);
  if (EXCLUDE_FILES.has(base)) return false;
  if (/\.(log|dump|zip)$/.test(base)) return false;
  if (/\.tar\.gz$/.test(base)) return false;
  if (/\.backup\.html$/i.test(base)) return false;
  return true;
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    if (!shouldCopy(from)) continue;

    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
    // Sembolik bağlantılar ve özel dosyalar atlanır.
  }
}

function copyCode(snapshotDir) {
  const dest = path.join(snapshotDir, 'KOD');
  copyTree(ROOT, dest);
  return dest;
}

function archiveUploads(snapshotDir, log) {
  const uploadsDir = path.resolve(BACKEND_DIR, process.env.UPLOAD_DIR || './uploads');
  const dataDir = path.join(snapshotDir, 'VERI');
  fs.mkdirSync(dataDir, { recursive: true });

  if (!fs.existsSync(uploadsDir)) {
    return { included: false, reason: 'uploads klasörü yok' };
  }

  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name !== '.gitkeep') files.push(full);
    }
  };
  walk(uploadsDir);

  if (files.length === 0) {
    return { included: false, reason: 'yüklü dosya yok' };
  }

  const out = path.join(dataDir, 'dosyalar.tar.gz');
  const result = spawnSync('tar', ['-czf', out, '-C', uploadsDir, '.'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    log(`UYARI: Yüklenen dosyalar arşivlenemedi (${(result.error || {}).message || result.stderr || 'tar hatası'}).`);
    return { included: false, reason: 'arşivleme başarısız' };
  }

  return { included: true, file: out, bytes: fs.statSync(out).size, count: files.length };
}

function writeDocs(snapshotDir, meta) {
  const countLines = Object.entries(meta.db.counts)
    .map(([table, count]) => `| \`${table}\` | ${count} |`)
    .join('\n');

  const info = `# Yedek Bilgisi

- **Yedek tarihi:** ${new Date(meta.createdAt).toLocaleString('tr-TR')}
- **Kaynak veritabanı:** \`${meta.db.source.database}\` @ \`${meta.db.source.host}\`
- **Şema sürümü:** \`${meta.db.schemaVersion || 'bilinmiyor'}\`
- **Toplam kayıt:** ${meta.db.totalRows}
- **Veri dosyası:** \`VERI/veritabani.json.gz\` (${formatBytes(meta.db.gzBytes)})
- **SHA-256:** \`${meta.db.checksum}\`
- **Node sürümü:** ${process.version}
- **Uygulama sürümü:** ${meta.appVersion}

## Tablo kayıtları

| Tablo | Kayıt |
|---|---:|
${countLines}

## Paket içeriği

- \`KOD/\` — Programın tam kaynak kodu (node_modules, \`.env\` ve eski yedekler hariç).
- \`VERI/veritabani.json.gz\` — Tüm iş verisi (varlıklar, arızalar, bakımlar, stok, kullanıcılar...).
- \`VERI/dosyalar.tar.gz\` — Yüklenen belgeler/fotoğraflar${meta.uploads.included ? ` (${meta.uploads.count} dosya)` : ' (bu çalışmada dosya yoktu)'}.
- \`VERI/ozet.json\` — Makine okunabilir kayıt özeti.
- \`YENIDEN-OLUSTUR.md\` — Sıfırdan kurulum ve geri yükleme talimatı.

## Gizlilik

Bu paket **tüm iş verisini ve kullanıcı şifre hash'lerini** içerir. \`.env\` dosyası
bilinçli olarak kopyalanmaz (veritabanı parolası/JWT anahtarı sızmaz), ancak veri dosyası
tek başına hassastır. Yedeği yalnızca güvendiğiniz yerde saklayın.
`;

  const restore = `# Yedekten Yeniden Oluşturma

Bu klasör kendi kendine yeterli bir yedektir: \`KOD/\` programın tamamını,
\`VERI/\` ise tüm iş verisini içerir. Aşağıdaki adımlar hem insan hem de yapay zekâ
(OpenCode / Claude) tarafından uygulanabilir.

## Gereksinimler

- Node.js 20+
- PostgreSQL 14+ (16 önerilir)
- (İsteğe bağlı) Docker

## 1. Kodu yerleştir

\`KOD/\` klasörünü çalışmak istediğiniz dizine kopyalayın.

## 2. Ortam dosyasını oluştur

\`\`\`bash
cd KOD/backend
cp .env.example .env
# .env içinde DATABASE_URL ve JWT_SECRET değerlerini doldurun
\`\`\`

\`JWT_SECRET\` yeni üretilebilir; eski oturumlar geçersiz olur, kullanıcılar yeniden giriş yapar.
Veritabanı parolası yedekte yoktur; yeni bir veritabanı oluşturun.

## 3. Bağımlılıkları kur ve şemayı oluştur

\`\`\`bash
cd KOD/backend
npm ci
npm run db:migrate
\`\`\`

## 4. Veriyi geri yükle

\`\`\`bash
node scripts/proje-geri-yukle.js ../VERI/veritabani.json.gz --yes
\`\`\`

> Bu komut mevcut tabloları boşaltıp yedekteki kayıtları yazar. Yalnızca boş/yeni bir
> veritabanında kullanın. Şema sürümü: \`${meta.db.schemaVersion || 'bilinmiyor'}\`.

## 5. Yüklenen dosyaları geri yükle

\`\`\`bash
# Linux/macOS
tar -xzf VERI/dosyalar.tar.gz -C KOD/backend/uploads
# Windows PowerShell
tar -xzf VERI\\dosyalar.tar.gz -C KOD\\backend\\uploads
\`\`\`

(\`dosyalar.tar.gz\` yoksa bu adımı atlayın.)

## 6. Çalıştır ve doğrula

\`\`\`bash
cd KOD/backend
npm start
# http://localhost:3001/api/health -> {"ok":true}
\`\`\`

- Giriş: yedekteki kullanıcılar ve mevcut şifreleri geçerlidir.
- Doğrulama: \`VERI/ozet.json\` içindeki tablo kayıt sayıları, arayüzdeki listelerle eşleşmeli.
- Testler: \`npm test\` (izole \`_test\` veritabanı oluşturur).

## Yapay zekâ için not

- Proje tek sayfa vanilla JS + Express + PostgreSQL'dir; build/lint adımı yoktur.
- Şema değişiklikleri \`backend/src/db/migrations/\` altına numaralı dosya olarak eklenir.
- Tüm kullanıcı metinleri Türkçe; tarihler \`DD.MM.YYYY\` gösterilir, API'ye \`YYYY-MM-DD\` gider.
- Ayrıntılı geliştirici kuralları: \`KOD/AGENTS.md\`, dağıtım: \`KOD/DEPLOY.md\`.
- Mevcut durumu "güncellemek" için: kodu değiştir → yeni migration ekle → \`npm run db:migrate\`.
`;

  fs.writeFileSync(path.join(snapshotDir, 'YEDEK-BILGI.md'), info, 'utf8');
  fs.writeFileSync(path.join(snapshotDir, 'YENIDEN-OLUSTUR.md'), restore, 'utf8');
}

function makeZip(snapshotDir, snapshotName, log) {
  const zipPath = path.join(YEDEK_DIR, `fabrika-bakim-yedek-${snapshotName}.zip`);

  // Windows 10+ / Linux: bsdtar `-a` uzantıya göre zip üretir.
  let result = spawnSync('tar', ['-a', '-c', '-f', zipPath, '-C', YEDEK_DIR, snapshotName], {
    encoding: 'utf8',
  });
  if (!result.error && result.status === 0) return zipPath;

  // Yedek plan: PowerShell
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -LiteralPath '${snapshotDir.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -CompressionLevel Optimal -Force`,
    ],
    { encoding: 'utf8' }
  );
  if (!ps.error && ps.status === 0) return zipPath;

  log('UYARI: Arşiv (.zip) oluşturulamadı; klasör yedeği kullanılabilir.');
  return null;
}

function cleanupOldSnapshots(log) {
  const entries = fs.readdirSync(YEDEK_DIR, { withFileTypes: true });
  const byStamp = new Map();

  for (const entry of entries) {
    let match = entry.isDirectory() && /^(\d{8}-\d{6})$/.exec(entry.name);
    if (match) {
      const item = byStamp.get(match[1]) || {};
      item.dir = entry.name;
      byStamp.set(match[1], item);
      continue;
    }
    match = !entry.isDirectory() && /^fabrika-bakim-yedek-(\d{8}-\d{6})\.zip$/.exec(entry.name);
    if (match) {
      const item = byStamp.get(match[1]) || {};
      item.zip = entry.name;
      byStamp.set(match[1], item);
    }
  }

  const stamps = [...byStamp.keys()].sort().reverse();
  let removed = 0;
  for (const old of stamps.slice(KEEP_SNAPSHOTS)) {
    const item = byStamp.get(old);
    if (item.dir) {
      fs.rmSync(path.join(YEDEK_DIR, item.dir), { recursive: true, force: true });
      removed++;
    }
    if (item.zip) {
      fs.rmSync(path.join(YEDEK_DIR, item.zip), { force: true });
      removed++;
    }
  }
  return removed;
}

async function main() {
  fs.mkdirSync(YEDEK_DIR, { recursive: true });

  const snapshotName = stamp();
  const snapshotDir = path.join(YEDEK_DIR, snapshotName);
  fs.mkdirSync(snapshotDir, { recursive: true });

  console.log(`Yedek oluşturuluyor: yedek/${snapshotName}`);

  console.log('\n[1/4] Veritabanı dışa aktarılıyor...');
  const db = await exportDatabase(snapshotDir);
  console.log(`  ✔ ${db.totalRows} kayıt, ${formatBytes(db.gzBytes)}`);

  console.log('\n[2/4] Program kodu kopyalanıyor...');
  copyCode(snapshotDir);
  console.log('  ✔ KOD/ hazır');

  console.log('\n[3/4] Yüklenen dosyalar arşivleniyor...');
  const uploads = archiveUploads(snapshotDir, console.log);
  console.log(uploads.included ? `  ✔ ${uploads.count} dosya` : `  - atlandı (${uploads.reason})`);

  console.log('\n[4/4] Belgeler ve arşiv hazırlanıyor...');
  let appVersion = 'bilinmiyor';
  try {
    appVersion = JSON.parse(fs.readFileSync(path.join(BACKEND_DIR, 'package.json'), 'utf8')).version;
  } catch (_) {
    /* yoksay */
  }
  writeDocs(snapshotDir, { createdAt: new Date().toISOString(), db, uploads, appVersion });
  const zipPath = makeZip(snapshotDir, snapshotName, console.log);
  const removed = cleanupOldSnapshots(console.log);

  console.log('\nYedek tamamlandı:');
  console.log(`  Klasör: ${path.relative(ROOT, snapshotDir)}`);
  if (zipPath) console.log(`  Arşiv : ${path.relative(ROOT, zipPath)} (${formatBytes(fs.statSync(zipPath).size)})`);
  if (removed) console.log(`  ${removed} eski yedek silindi (son ${KEEP_SNAPSHOTS} tutuluyor).`);
  console.log('\nBu klasörü/arşivi başka bir diske kopyalayarak yedeği güvenceye alabilirsiniz.');
}

main()
  .catch((err) => {
    console.error('\nYedekleme başarısız:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {
      /* yoksay */
    }
  });

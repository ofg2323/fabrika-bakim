// Kullanım:
//   node backend/scripts/proje-geri-yukle.js yedek/20261125-183000/VERI/veritabani.json.gz --yes
//
// `proje-yedek.js` ile alınan JSON yedeğini mevcut veritabanına geri yükler.
// DİKKAT: Hedef veritabanındaki tüm tablolar boşaltılır. Yalnızca yeni/boş bir
// veritabanında veya elinizde güncel yedek varken kullanın.
//
// Ön koşul: şema oluşturulmuş olmalı (`npm run db:migrate`).
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const pool = require('../src/db/pool');

const MAX_PARAMS = 30000;

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function parseArgs(argv) {
  const args = { file: null, yes: false };
  for (const arg of argv) {
    if (arg === '--yes' || arg === '-y') args.yes = true;
    else if (!args.file) args.file = arg;
  }
  return args;
}

function loadPayload(file) {
  const raw = fs.readFileSync(file);
  const json = file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw;
  return JSON.parse(json.toString('utf8'));
}

async function jsonColumns(client) {
  const { rows } = await client.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND udt_name IN ('json', 'jsonb')`
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.table_name)) map.set(row.table_name, new Set());
    map.get(row.table_name).add(row.column_name);
  }
  return map;
}

async function primaryKey(client, table) {
  const { rows } = await client.query(
    `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.constraint_schema = tc.constraint_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = $1
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
      LIMIT 1`,
    [table]
  );
  return rows[0] ? rows[0].column_name : null;
}

function prepareRow(row, jsonCols) {
  const out = { ...row };
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) out[key] = null;
    else if (out[key] === null) continue;
    else if (jsonCols && jsonCols.has(key)) out[key] = JSON.stringify(out[key]);
  }
  return out;
}

async function insertRows(client, table, rows, jsonCols) {
  if (rows.length === 0) return 0;

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const prepared = rows.map((row) => prepareRow(row, jsonCols));
  const perChunk = Math.max(1, Math.floor(MAX_PARAMS / columns.length));

  let inserted = 0;
  for (let i = 0; i < prepared.length; i += perChunk) {
    const chunk = prepared.slice(i, i + perChunk);
    const values = [];
    const tuples = chunk.map((row) => {
      const placeholders = columns.map((col) => {
        values.push(row[col] === undefined ? null : row[col]);
        return `$${values.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    await client.query(
      `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES ${tuples.join(', ')}`,
      values
    );
    inserted += chunk.length;
  }
  return inserted;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file) {
    console.error('Kullanım: node backend/scripts/proje-geri-yukle.js <veritabani.json.gz> --yes');
    process.exitCode = 1;
    return;
  }

  const file = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(file)) {
    console.error(`Yedek dosyası bulunamadı: ${file}`);
    process.exitCode = 1;
    return;
  }

  if (!args.yes) {
    console.error(
      'Bu işlem hedef veritabanındaki tüm tabloları BOŞALTIR ve yedeği yazar.\n' +
        'Devam etmek için --yes ekleyin:\n' +
        `  node backend/scripts/proje-geri-yukle.js ${args.file} --yes`
    );
    process.exitCode = 1;
    return;
  }

  const payload = loadPayload(file);
  if (payload.format !== 'cmms-project-backup' || !payload.tables) {
    throw new Error('Bu dosya proje yedeği formatında değil (cmms-project-backup bekleniyordu).');
  }

  const client = await pool.connect();
  try {
    const { rows: existingRows } = await client.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    const existing = new Set(existingRows.map((r) => r.table_name));

    const tables = Object.keys(payload.tables);
    const missing = tables.filter((t) => !existing.has(t));
    if (missing.length > 0) {
      throw new Error(
        `Veritabanında eksik tablolar var: ${missing.join(', ')}.\n` +
          'Önce `npm run db:migrate` ile şemayı oluşturun.'
      );
    }

    await client.query('BEGIN');

    const { rows: suRows } = await client.query("SELECT current_setting('is_superuser') AS value");
    const canDisableConstraints = suRows[0].value === 'on';
    if (canDisableConstraints) {
      await client.query('SET LOCAL session_replication_role = replica');
    }

    console.log(`Tablolar boşaltılıyor (${tables.length} tablo)...`);
    await client.query(`TRUNCATE TABLE ${tables.map(quoteIdent).join(', ')} RESTART IDENTITY CASCADE`);

    const jsonColsMap = await jsonColumns(client);
    const selfRefs = payload.selfReferences || [];
    const order = Array.isArray(payload.order) && payload.order.length ? payload.order : tables;

    let total = 0;
    for (const table of order) {
      let rows = payload.tables[table] || [];
      if (rows.length === 0) continue;

      const jsonCols = jsonColsMap.get(table);
      const selfCols = selfRefs.filter((ref) => ref.table === table).map((ref) => ref.column);
      const deferred = [];
      let pk = null;

      if (!canDisableConstraints && selfCols.length > 0) {
        pk = await primaryKey(client, table);
        if (!pk) {
          throw new Error(`"${table}" kendine referans veriyor ancak birincil anahtarı bulunamadı.`);
        }
        rows = rows.map((row) => {
          const copy = { ...row };
          for (const col of selfCols) {
            if (copy[col] !== null && copy[col] !== undefined) {
              deferred.push({ id: copy[pk], column: col, value: copy[col] });
              copy[col] = null;
            }
          }
          return copy;
        });
      }

      const inserted = await insertRows(client, table, rows, jsonCols);
      total += inserted;

      for (const item of deferred) {
        await client.query(
          `UPDATE ${quoteIdent(table)} SET ${quoteIdent(item.column)} = $1 WHERE ${quoteIdent(pk)} = $2`,
          [item.value, item.id]
        );
      }

      console.log(`  ✔ ${table}: ${inserted} kayıt`);
    }

    await client.query('COMMIT');

    console.log(`\nGeri yükleme tamamlandı: ${total} kayıt.`);
    console.log(`Şema sürümü: ${payload.schemaVersion || 'bilinmiyor'}`);

    // Doğrulama: tablo bazında kayıt sayıları
    let mismatch = 0;
    for (const table of tables) {
      const expected = (payload.tables[table] || []).length;
      const { rows } = await client.query(`SELECT count(*)::int AS count FROM ${quoteIdent(table)}`);
      if (rows[0].count !== expected) {
        mismatch++;
        console.warn(`UYARI: ${table} beklenen ${expected}, bulunan ${rows[0].count}`);
      }
    }
    console.log(mismatch === 0 ? 'Doğrulama: tüm tablo sayıları eşleşti.' : `${mismatch} tabloda sayı farkı var.`);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* yoksay */
    }
    throw err;
  } finally {
    client.release();
  }
}

// (Sadece superuser olmayan geri yükleme yolunda kullanılır.)

main()
  .catch((err) => {
    console.error('\nGeri yükleme başarısız:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {
      /* yoksay */
    }
  });

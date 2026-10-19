const pool = require('../db/pool');

const PREFIX_MAP = {
  fault: 'A',
  maint: 'B',
  inspection: 'C',
  extmaint: 'D',
  project: 'P',
  calibration: 'K',
};

const TABLE_MAP = {
  fault: 'faults',
  maint: 'maintenance_records',
  inspection: 'inspection_records',
  extmaint: 'ext_maint_records',
  project: 'projects',
  calibration: 'calibration_records',
};

/**
 * Atomik ve eşzamanlılığa dayanıklı takip numarası üretir.
 * @param {'fault' | 'maint' | 'inspection' | 'extmaint' | 'project' | 'calibration'} kind 
 * @param {import('pg').PoolClient | null} client - Transaction içinde çağrılıyorsa client nesnesi
 * @returns {Promise<string>} Örneğin 'B00001', 'A00002'
 */
async function getNextTrackingNo(kind, client = null) {
  const db = client || pool;
  const prefix = PREFIX_MAP[kind] || 'X';
  const tableName = TABLE_MAP[kind];

  const maxSubquery = tableName
    ? `COALESCE((SELECT MAX(NULLIF(regexp_replace(tracking_no, '\\D', '', 'g'), '')::int) FROM ${tableName}), 0)`
    : '0';

  const { rows } = await db.query(
    `INSERT INTO counters (kind, value)
     VALUES ($1, (${maxSubquery}) + 1)
     ON CONFLICT (kind)
     DO UPDATE SET value = GREATEST(counters.value, (${maxSubquery})) + 1
     RETURNING value`,
    [kind]
  );

  const counterVal = rows[0].value;
  return `${prefix}${String(counterVal).padStart(5, '0')}`;
}

module.exports = {
  getNextTrackingNo,
  PREFIX_MAP,
};


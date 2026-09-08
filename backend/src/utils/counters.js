const pool = require('../db/pool');

const PREFIX_MAP = {
  fault: 'A',
  maint: 'B',
  inspection: 'C',
  extmaint: 'D',
  project: 'P',
};

/**
 * Atomik ve eşzamanlılığa dayanıklı takip numarası üretir.
 * @param {'fault' | 'maint' | 'inspection' | 'extmaint' | 'project'} kind 
 * @param {import('pg').PoolClient | null} client - Transaction içinde çağrılıyorsa client nesnesi
 * @returns {Promise<string>} Örneğin 'B00001', 'A00002'
 */
async function getNextTrackingNo(kind, client = null) {
  const db = client || pool;
  const prefix = PREFIX_MAP[kind] || 'X';

  const { rows } = await db.query(
    `INSERT INTO counters (kind, value)
     VALUES ($1, 1)
     ON CONFLICT (kind)
     DO UPDATE SET value = counters.value + 1
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

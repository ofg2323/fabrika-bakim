const pool = require('../db/pool');

/**
 * Merkezi Denetim Günlüğü (Audit Log) Kaydedici
 * @param {object} clientOrPool - pg Client veya Pool nesnesi
 * @param {object} param1 - Denetim verileri
 */
async function logAudit(clientOrPool, {
  userId = null,
  userName = null,
  action = 'ACTION',
  entityType = null,
  entity = null,
  entityId = null,
  details = {},
  ipAddress = null,
}) {
  const targetEntity = entityType || entity || 'system';
  try {
    // Audit log kaydını bağımsız olarak pool üzerinden kaydet ki
    // herhangi bir audit log hatası aktif transaction'ı abort durumuna sokmasın.
    const query = `
      INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, details, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    await pool.query(query, [
      userId,
      userName,
      action,
      targetEntity,
      entityId ? String(entityId) : null,
      JSON.stringify(details || {}),
      ipAddress,
    ]);
  } catch (err) {
    // Audit log hatası ana akışı kesmemeli ama konsola yazılmalı
    console.error('[Audit Log Hatası]:', err.message);
  }
}

function getClientIp(req) {
  if (!req) return null;
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip ||
    null
  );
}

module.exports = {
  logAudit,
  getClientIp,
};

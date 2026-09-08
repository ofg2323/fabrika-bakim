const pool = require('../src/db/pool');

const API_BASE = process.env.API_BASE || 'http://localhost:3001';

let cachedToken = null;
let cachedAdmin = null;
let serverInstance = null;

async function ensureServerRunning() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (res.ok) return;
  } catch (e) {
    if (!serverInstance) {
      serverInstance = require('../src/server');
      if (serverInstance.server && typeof serverInstance.server.unref === 'function') {
        serverInstance.server.unref();
      }
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
          const res = await fetch(`${API_BASE}/api/health`);
          if (res.ok) break;
        } catch (_) {}
      }
    }
  }
}

// Testler tamamlandiginda havuz ve sunucunun duzgun kapanmasi
process.on('beforeExit', async () => {
  if (serverInstance && serverInstance.server) {
    serverInstance.server.close();
  }
  try { await pool.end(); } catch (_) {}
});

async function getAdminToken() {
  await ensureServerRunning();
  if (cachedToken) return { token: cachedToken, admin: cachedAdmin };

  // Kullanıcıları kontrol et
  const { rows } = await pool.query("SELECT id, name, role FROM users WHERE role = 'Yönetici' LIMIT 1");
  let adminId;

  if (rows.length === 0) {
    // İlk admin oluştur
    const res = await fetch(`${API_BASE}/api/auth/first-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Yöneticisi', password: 'test-password-123' }),
    });
    const data = await res.json();
    cachedToken = data.token;
    cachedAdmin = data.user;
    return { token: cachedToken, admin: cachedAdmin };
  } else {
    adminId = rows[0].id;
    cachedAdmin = rows[0];
  }

  // Login ol
  const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: adminId, password: 'admin-password-123' }),
  });

  if (loginRes.ok) {
    const data = await loginRes.json();
    cachedToken = data.token;
    cachedAdmin = data.user;
    return { token: cachedToken, admin: cachedAdmin };
  } else {
    // Şifre farklıysa test için geçici şifre güncelle
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('test-password-123', 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, adminId]);

    const retryRes = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: adminId, password: 'test-password-123' }),
    });
    const data = await retryRes.json();
    cachedToken = data.token;
    cachedAdmin = data.user;
    return { token: cachedToken, admin: cachedAdmin };
  }
}

async function api(path, options = {}, token = null) {
  await ensureServerRunning();
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = { ...(options.headers || {}) };

  if (token === false) {
    delete headers['Authorization'];
  } else if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (cachedToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${cachedToken}`;
  }

  if (options.body && !(options.body instanceof FormData) && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers });
  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

module.exports = {
  API_BASE,
  pool,
  getAdminToken,
  api,
};

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

  // Dedicated test yöneticisini bul veya oluştur (gerçek kullanıcı şifrelerine asla dokunma)
  const { rows } = await pool.query("SELECT id, name, role FROM users WHERE name = 'Test Yöneticisi' AND role = 'Yönetici' LIMIT 1");

  if (rows.length > 0) {
    cachedAdmin = rows[0];
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('test-password-123', 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, cachedAdmin.id]);
  } else {
    // İlk admin kontrolü: eğer veritabanında hiç yönetici yoksa first-admin çağrısı yap
    const { rows: allAdmins } = await pool.query("SELECT id FROM users WHERE role = 'Yönetici' LIMIT 1");
    if (allAdmins.length === 0) {
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
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('test-password-123', 10);
      const { rows: ins } = await pool.query(
        "INSERT INTO users (name, role, password_hash) VALUES ('Test Yöneticisi', 'Yönetici', $1) RETURNING id, name, role",
        [hash]
      );
      cachedAdmin = ins[0];
    }
  }

  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET;
  cachedToken = jwt.sign(
    { id: cachedAdmin.id, role: cachedAdmin.role, name: cachedAdmin.name },
    secret,
    { expiresIn: '8h' }
  );
  return { token: cachedToken, admin: cachedAdmin };
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

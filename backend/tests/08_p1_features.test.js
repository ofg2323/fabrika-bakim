const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, getAdminToken, pool } = require('./helpers');

describe('Modül 16: P1 Güvenlik, Denetim İzi (Audit Log), Yetkilendirme ve Sayfalama Testleri', () => {
  let adminToken;
  let adminUser;
  let technicianToken;
  let technicianUser;

  before(async () => {
    const auth = await getAdminToken();
    adminToken = auth.token;
    adminUser = auth.admin;

    // Teknisyen kullanıcısı oluştur ve token al
    const techName = `P1 Test Teknisyeni ${Date.now()}`;
    const techRes = await api('/api/users', {
      method: 'POST',
      body: {
        name: techName,
        role: 'Teknisyen',
        password: 'tech-password-p1',
      },
    }, adminToken);
    assert.strictEqual(techRes.status, 201);
    technicianUser = techRes.data;

    const loginRes = await api('/api/auth/login', {
      method: 'POST',
      body: {
        userId: technicianUser.id,
        password: 'tech-password-p1',
      },
    }, false);
    assert.strictEqual(loginRes.status, 200);
    technicianToken = loginRes.data.token;
  });

  describe('1. Denetim İzi (Audit Logs) Testleri', () => {
    test('Yetkisiz kullanıcı (anonim) audit logs çağıramaz (401)', async () => {
      const res = await api('/api/audit-logs', {}, false);
      assert.strictEqual(res.status, 401);
    });

    test('Teknisyen rolü audit logs çağıramaz (403)', async () => {
      const res = await api('/api/audit-logs', {}, technicianToken);
      assert.strictEqual(res.status, 403);
    });

    test('Yönetici audit logs listeleyebilmeli ve sayfalama başlıkları dönmeli', async () => {
      const res = await api('/api/audit-logs?limit=10&offset=0', {}, adminToken);
      assert.strictEqual(res.status, 200);
      assert.ok(res.data && Array.isArray(res.data.logs));
      assert.ok(res.headers.get('x-total-count') !== null);
      assert.strictEqual(res.headers.get('x-limit'), '10');
      assert.strictEqual(res.headers.get('x-offset'), '0');
    });

    test('Audit log filtreleme (action veya entity) çalışmalı', async () => {
      const res = await api('/api/audit-logs?action=CREATE', {}, adminToken);
      assert.strictEqual(res.status, 200);
      assert.ok(res.data && Array.isArray(res.data.logs));
      if (res.data.logs.length > 0) {
        for (const log of res.data.logs) {
          assert.strictEqual(log.action, 'CREATE');
        }
      }
    });
  });

  describe('2. Rol ve Kullanıcı Koruma Testleri', () => {
    test('Geçersiz bir rol ile kullanıcı oluşturulamaz (400)', async () => {
      const res = await api('/api/users', {
        method: 'POST',
        body: {
          name: `Invalid Role User ${Date.now()}`,
          role: 'SuperHackerAdmin',
          password: 'password-123',
        },
      }, adminToken);
      assert.strictEqual(res.status, 400);
      assert.ok(res.data.error.includes('Geçersiz rol'));
    });

    test('Yönetici kendi rolünü Teknisyen veya Operatör yapamaz (kendi kendini düşürme engeli - 400)', async () => {
      const res = await api(`/api/users/${adminUser.id}`, {
        method: 'PUT',
        body: {
          name: adminUser.name,
          role: 'Teknisyen',
        },
      }, adminToken);
      assert.strictEqual(res.status, 400);
      assert.ok(res.data.error.includes('yönetici') || res.data.error.includes('rol'));
    });

    test('Görev atanabilir kullanıcılar listesi (/api/users/assignable) sadece yetkili rolleri dönmeli', async () => {
      const res = await api('/api/users/assignable', {}, technicianToken);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data));
      const allowedRoles = ['Yönetici', 'Bakımcı', 'Teknisyen'];
      for (const u of res.data) {
        assert.ok(allowedRoles.includes(u.role), `Beklenmeyen rol: ${u.role}`);
      }
    });
  });

  describe('3. Sayfalama Sınırları ve HTTP Başlıkları Testleri', () => {
    test('Bakım listesi sayfalama başlıkları (X-Total-Count, X-Limit, X-Offset) dönmeli', async () => {
      const res = await api('/api/maintenance?limit=5&offset=0', {}, adminToken);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data));
      assert.ok(res.headers.get('x-total-count') !== null);
      assert.strictEqual(res.headers.get('x-limit'), '5');
      assert.strictEqual(res.headers.get('x-offset'), '0');
    });

    test('Arıza listesi sayfalama başlıkları dönmeli ve maksimum limit uygulanmalı', async () => {
      // 9999 istendiğinde maxLimit (200) devreye girmeli
      const res = await api('/api/faults?limit=9999&offset=0', {}, adminToken);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data));
      assert.strictEqual(res.headers.get('x-limit'), '200');
    });

    test('Stok hareketleri sayfalama başlıkları dönmeli', async () => {
      const res = await api('/api/stock/movements?limit=10&offset=0', {}, adminToken);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data));
      assert.ok(res.headers.get('x-total-count') !== null);
      assert.strictEqual(res.headers.get('x-limit'), '10');
      assert.strictEqual(res.headers.get('x-offset'), '0');
    });
  });

  describe('4. Stok Yetersizliği ve Hata Yönetimi', () => {
    test('Mevcut stoktan fazla ÇIKIŞ hareketi yapılmaya çalışıldığında 409 dönmeli', async () => {
      // Önce test için yeni bir malzeme oluşturalım (stok 5)
      const matRes = await api('/api/materials', {
        method: 'POST',
        body: {
          code: `P1-TEST-${Date.now()}`,
          name: 'P1 Stok Test Malzemesi',
          stock: 5,
          unit: 'Adet',
        },
      }, adminToken);
      assert.strictEqual(matRes.status, 201);
      const mat = matRes.data;

      // 100 adet çıkış dene (stok yetersiz)
      const moveRes = await api('/api/stock/movements', {
        method: 'POST',
        body: {
          materialId: mat.id,
          type: 'Çıkış',
          qty: 100,
          reason: 'Test Fazla Çıkış',
        },
      }, adminToken);
      assert.strictEqual(moveRes.status, 409);
      assert.ok(moveRes.data.error.includes('Yetersiz stok'));

      // Temizlik: Malzemeyi sil
      await api(`/api/materials/${mat.id}`, { method: 'DELETE' }, adminToken);
    });
  });
});

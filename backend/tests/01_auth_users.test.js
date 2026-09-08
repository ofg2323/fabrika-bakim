const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, getAdminToken } = require('./helpers');

describe('Modül 1 & 2: Auth ve Kullanıcı Yönetimi Testleri', () => {
  let adminToken;
  let createdUserId;

  before(async () => {
    const auth = await getAdminToken();
    adminToken = auth.token;
  });

  test('Sağlık kontrolü (GET /api/health) 200 dönmeli', async () => {
    const res = await api('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.ok(res.data.timestamp);
  });

  test('Yetkisiz ön kullanıcı listesi (GET /api/auth/users) şifre hashlerini içermemeli', async () => {
    const res = await api('/api/auth/users');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data));
    assert.ok(res.data.length > 0);
    for (const u of res.data) {
      assert.strictEqual(u.password_hash, undefined);
      assert.strictEqual(u.passwordHash, undefined);
      assert.ok(u.id);
      assert.ok(u.name);
      assert.ok(u.role);
    }
  });

  test('Hatalı şifre ile giriş (POST /api/auth/login) 401 dönmeli', async () => {
    const usersRes = await api('/api/auth/users');
    const firstUser = usersRes.data[0];
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { userId: firstUser.id, password: 'kesinlikle-yanlis-sifre-999' },
    });
    assert.strictEqual(res.status, 401);
    assert.ok(res.data.error);
  });

  test('Yetkisiz korumalı endpoint erişimi (GET /api/users) 401 dönmeli', async () => {
    const res = await api('/api/users', {}, false);
    assert.strictEqual(res.status, 401);
  });

  test('Yönetici yeni bir Teknisyen oluşturabilmeli (POST /api/users)', async () => {
    const uniqueName = `Test Teknisyeni ${Date.now()}`;
    const res = await api('/api/users', {
      method: 'POST',
      body: {
        name: uniqueName,
        role: 'Teknisyen',
        password: 'teknisyen-sifre-123',
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.strictEqual(res.data.name, uniqueName);
    assert.strictEqual(res.data.role, 'Teknisyen');
    createdUserId = res.data.id;
  });

  test('Yeni oluşturulan kullanıcı kendi şifresiyle oturum açabilmeli', async () => {
    assert.ok(createdUserId, 'Kullanıcı oluşturulmuş olmalı');
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: {
        userId: createdUserId,
        password: 'teknisyen-sifre-123',
      },
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.data.token);
    assert.strictEqual(res.data.user.id, createdUserId);
  });

  test('Kullanıcı güncellenebilmeli (PUT /api/users/:id)', async () => {
    assert.ok(createdUserId);
    const updatedName = `Güncel Teknisyen ${Date.now()}`;
    const res = await api(`/api/users/${createdUserId}`, {
      method: 'PUT',
      body: {
        name: updatedName,
        role: 'Depo Sorumlusu',
      },
    }, adminToken);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.name, updatedName);
    assert.strictEqual(res.data.role, 'Depo Sorumlusu');
  });

  test('Kullanıcı silinebilmeli (DELETE /api/users/:id)', async () => {
    assert.ok(createdUserId);
    const res = await api(`/api/users/${createdUserId}`, {
      method: 'DELETE',
    }, adminToken);

    assert.strictEqual(res.status, 204);

    // Listede artık olmamalı
    const listRes = await api('/api/users', {}, adminToken);
    assert.ok(!listRes.data.find(u => u.id === createdUserId));
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { getAdminToken, API_BASE } = require('./helpers');

test('Modül 20: Çoklu Cihaz Canlı Senkronizasyon (SSE & Version Polling) Testleri', async (t) => {
  const { token } = await getAdminToken();

  await t.test('1. Yetkisiz sync/version isteği 401 dönmeli', async () => {
    const res = await fetch(`${API_BASE}/api/sync/version`);
    assert.strictEqual(res.status, 401);
  });

  await t.test('2. Yetkili sync/version çağrısı güncel versiyon ve aktif istemci bilgisini dönmeli', async () => {
    const res = await fetch(`${API_BASE}/api/sync/version`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.version === 'number');
    assert.ok(typeof data.timestamp === 'number');
    assert.ok(typeof data.activeClients === 'number');
  });

  await t.test('3. Query parametresi ile iletilen token (?token=) da kabul edilmeli (SSE uyumluluğu)', async () => {
    const res = await fetch(`${API_BASE}/api/sync/version?token=${encodeURIComponent(token)}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.version === 'number');
  });

  await t.test('4. Veri tabanında değişiklik yapıldığında sync versiyonu otomatik artmalı', async () => {
    // Önceki versiyonu oku
    const v1Res = await fetch(`${API_BASE}/api/sync/version`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { version: v1 } = await v1Res.json();

    // Yeni bir arıza veya varlık grubu oluştur (mutating istek)
    const grpRes = await fetch(`${API_BASE}/api/asset-groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Canlı Senkronizasyon Test Grubu ' + Date.now(),
        periodDays: 30,
        checklist: []
      })
    });
    assert.strictEqual(grpRes.status, 201);
    const grpData = await grpRes.json();

    // Kısa bir bekleme (res.on('finish') döngüsü için)
    await new Promise(r => setTimeout(r, 100));

    // Yeni versiyonu oku
    const v2Res = await fetch(`${API_BASE}/api/sync/version`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { version: v2 } = await v2Res.json();

    assert.ok(v2 > v1, `Yeni versiyon (${v2}) önceki versiyondan (${v1}) büyük olmalıdır.`);

    // Temizlik: Test grubunu sil
    await fetch(`${API_BASE}/api/asset-groups/${grpData.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
  });
});

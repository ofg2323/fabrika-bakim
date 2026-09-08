const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, getAdminToken } = require('./helpers');

describe('Modül 9 & 10: Bakım ve Arıza Yönetimi Testleri', () => {
  let adminToken;
  let assetId;
  let materialId;
  let maintenanceId;
  let faultId;

  before(async () => {
    const auth = await getAdminToken();
    adminToken = auth.token;

    // 1. Test grubu oluştur
    const groupRes = await api('/api/asset-groups', {
      method: 'POST',
      body: { name: `Bakım Test Grubu ${Date.now()}`, periodDays: 30 },
    }, adminToken);

    // 2. Test varlığı oluştur
    const assetRes = await api('/api/assets', {
      method: 'POST',
      body: {
        name: `Bakım Test Makinesi ${Date.now()}`,
        groupId: groupRes.data.id,
        status: 'Aktif',
      },
    }, adminToken);
    assetId = assetRes.data.id;

    // 3. Test malzemesi oluştur (stok 50)
    const matRes = await api('/api/materials', {
      method: 'POST',
      body: {
        name: `Gres Yağı ${Date.now()}`,
        unit: 'kg',
        qty: 50,
        minQty: 10,
        unitCost: 200,
      },
    }, adminToken);
    materialId = matRes.data.id;
  });

  test('Periyodik bakım tamamlandığında malzeme stoku düşmeli ve varlık tarihi güncellenmeli (POST /api/maintenance)', async () => {
    assert.ok(assetId);
    assert.ok(materialId);

    const res = await api('/api/maintenance', {
      method: 'POST',
      body: {
        assetId,
        type: 'Periyodik',
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        notes: 'Aylık periyodik yağlama ve filtre temizliği yapıldı',
        checklist: [{ id: 'q1', text: 'Yağlama yapıldı', status: 'OK' }],
        usedMaterials: [{ materialId, qty: 5 }],
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.ok(res.data.trackingNo.startsWith('B'), 'Bakım takip no B ile başlamalı');
    maintenanceId = res.data.id;

    // 1. Malzeme stoku kontrol et (50 - 5 = 45 olmalı)
    const matRes = await api(`/api/materials/${materialId}`, {}, adminToken);
    assert.strictEqual(matRes.data.qty, 45);

    // 2. Varlık son bakım tarihi kontrol et
    const assetRes = await api(`/api/assets/${assetId}`, {}, adminToken);
    assert.ok(assetRes.data.lastMaintenanceDate);
  });

  test('Bakım kaydı silindiğinde kullanılan malzemeler stoka iade edilmeli (DELETE /api/maintenance/:id)', async () => {
    assert.ok(maintenanceId);
    assert.ok(materialId);

    const res = await api(`/api/maintenance/${maintenanceId}`, {
      method: 'DELETE',
    }, adminToken);

    assert.strictEqual(res.status, 204);

    // Stok tekrar 45 + 5 = 50 olmalı
    const matRes = await api(`/api/materials/${materialId}`, {}, adminToken);
    assert.strictEqual(matRes.data.qty, 50);
  });

  test('Arıza bildirildiğinde varlık durumu otomatik "Arızalı" olmalı (POST /api/faults)', async () => {
    assert.ok(assetId);

    const res = await api('/api/faults', {
      method: 'POST',
      body: {
        assetId,
        title: 'Motor aşırı ısınıyor ve durdu',
        description: 'Termik röle attı, duman kokusu var',
        priority: 'Yüksek',
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.ok(res.data.trackingNo.startsWith('A'), 'Arıza takip no A ile başlamalı');
    assert.strictEqual(res.data.status, 'Açık');
    faultId = res.data.id;

    // Varlık durumu 'Arızalı' olmalı
    const assetRes = await api(`/api/assets/${assetId}`, {}, adminToken);
    assert.strictEqual(assetRes.data.status, 'Arızalı');
  });

  test('Arıza çözüldüğünde varlık "Aktif" dönmeli ve malzeme düşmeli (PUT /api/faults/:id)', async () => {
    assert.ok(faultId);
    assert.ok(assetId);
    assert.ok(materialId);

    const res = await api(`/api/faults/${faultId}`, {
      method: 'PUT',
      body: {
        status: 'Tamamlandı',
        techSolution: 'Termik röle değiştirildi, gres yağı tazelendi.',
        resolvedDate: '2026-09-02',
        usedMaterials: [{ materialId, qty: 3 }],
      },
    }, adminToken);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, 'Tamamlandı');

    // 1. Varlık durumu tekrar 'Aktif' olmalı
    const assetRes = await api(`/api/assets/${assetId}`, {}, adminToken);
    assert.strictEqual(assetRes.data.status, 'Aktif');

    // 2. Malzeme stoku düşmüş olmalı (50 - 3 = 47)
    const matRes = await api(`/api/materials/${materialId}`, {}, adminToken);
    assert.strictEqual(matRes.data.qty, 47);
  });

  test('Arıza kaydı silindiğinde malzeme stoka geri iade edilmeli (DELETE /api/faults/:id)', async () => {
    assert.ok(faultId);
    assert.ok(materialId);

    const res = await api(`/api/faults/${faultId}`, {
      method: 'DELETE',
    }, adminToken);

    assert.strictEqual(res.status, 204);

    // Stok tekrar 47 + 3 = 50 olmalı
    const matRes = await api(`/api/materials/${materialId}`, {}, adminToken);
    assert.strictEqual(matRes.data.qty, 50);
  });
});

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, getAdminToken } = require('./helpers');

describe('Modül 3 & 4: Varlık Grupları ve Varlıklar Testleri', () => {
  let adminToken;
  let createdGroupId;
  let createdAssetId;
  const uniqueCode = `V-${Date.now().toString().slice(-6)}`;

  before(async () => {
    const auth = await getAdminToken();
    adminToken = auth.token;
  });

  test('Varlık grubu oluşturulabilmeli (POST /api/asset-groups)', async () => {
    const groupName = `Enjeksiyon Presleri ${Date.now()}`;
    const res = await api('/api/asset-groups', {
      method: 'POST',
      body: {
        name: groupName,
        periodDays: 45,
        inspectionEnabled: true,
        inspectionPeriodDays: 180,
        checklist: [
          { id: 'q1', text: 'Hidrolik yağ seviyesini kontrol et' },
          { id: 'q2', text: 'Basınç valflerini test et' }
        ],
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.strictEqual(res.data.name, groupName);
    assert.strictEqual(res.data.periodDays, 45);
    assert.strictEqual(res.data.inspectionEnabled, true);
    assert.strictEqual(res.data.checklist.length, 2);
    createdGroupId = res.data.id;
  });

  test('Varlık grupları listelenebilmeli (GET /api/asset-groups)', async () => {
    const res = await api('/api/asset-groups', {}, adminToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data));
    const found = res.data.find(g => g.id === createdGroupId);
    assert.ok(found);
    assert.strictEqual(found.periodDays, 45);
  });

  test('Varlık grubuna bağlı yeni bir varlık oluşturulabilmeli (POST /api/assets)', async () => {
    assert.ok(createdGroupId);
    const res = await api('/api/assets', {
      method: 'POST',
      body: {
        name: 'Büyük Enjeksiyon Presi 01',
        assetCode: uniqueCode,
        groupId: createdGroupId,
        location: 'A Blok Hat 2',
        status: 'Aktif',
        serialNo: 'SN-998877',
        brand: 'Engel',
        model: 'Victory 330',
        capacity: '330 Ton',
        description: 'Ana gövde plastik basım presi',
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.strictEqual(res.data.name, 'Büyük Enjeksiyon Presi 01');
    assert.strictEqual(res.data.assetCode, uniqueCode);
    assert.strictEqual(res.data.status, 'Aktif');
    createdAssetId = res.data.id;
  });

  test('Aynı varlık koduyla ikinci varlık oluşturulması engellenmeli', async () => {
    assert.ok(createdGroupId);
    const res = await api('/api/assets', {
      method: 'POST',
      body: {
        name: 'Mükerrer Pres',
        assetCode: uniqueCode, // Aynı kod
        groupId: createdGroupId,
      },
    }, adminToken);

    assert.strictEqual(res.status, 400);
    assert.ok(res.data.error);
  });

  let testMaterialId;

  test('Varlık için yedek parça malzemesi oluşturulup bağlanabilmeli (PUT /api/assets/:id/spare-parts)', async () => {
    assert.ok(createdAssetId);

    // 1. Bir test malzemesi oluştur
    const matRes = await api('/api/materials', {
      method: 'POST',
      body: {
        name: `O-Ring Conta ${Date.now()}`,
        unit: 'adet',
        qty: 25,
        minQty: 5,
        unitCost: 120.5,
      },
    }, adminToken);
    assert.strictEqual(matRes.status, 201);
    testMaterialId = matRes.data.id;

    // 2. Varlığa yedek parça olarak bağla
    const res = await api(`/api/assets/${createdAssetId}/spare-parts`, {
      method: 'PUT',
      body: {
        materialIds: [testMaterialId],
      },
    }, adminToken);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
  });

  test('Varlığa bağlı yedek parçalar listelenebilmeli (GET /api/assets/:id/spare-parts)', async () => {
    assert.ok(createdAssetId);
    const res = await api(`/api/assets/${createdAssetId}/spare-parts`, {}, adminToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data));
    assert.strictEqual(res.data.length, 1);
    assert.strictEqual(res.data[0].id, testMaterialId);
  });

  test('İçinde varlık bulunan grup silinmeye çalışıldığında 400 dönmeli', async () => {
    assert.ok(createdGroupId);
    const res = await api(`/api/asset-groups/${createdGroupId}`, {
      method: 'DELETE',
    }, adminToken);

    assert.strictEqual(res.status, 400);
    assert.ok(res.data.error);
  });

  test('Varlık başarıyla silinebilmeli (DELETE /api/assets/:id)', async () => {
    assert.ok(createdAssetId);
    const res = await api(`/api/assets/${createdAssetId}`, {
      method: 'DELETE',
    }, adminToken);

    assert.strictEqual(res.status, 204);

    const getRes = await api(`/api/assets/${createdAssetId}`, {}, adminToken);
    assert.strictEqual(getRes.status, 404);
  });

  test('Varlık silindikten sonra boş kalan grup silinebilmeli (DELETE /api/asset-groups/:id)', async () => {
    assert.ok(createdGroupId);
    const res = await api(`/api/asset-groups/${createdGroupId}`, {
      method: 'DELETE',
    }, adminToken);

    assert.strictEqual(res.status, 204);

    const checkRes = await api(`/api/asset-groups/${createdGroupId}`, {}, adminToken);
    assert.strictEqual(checkRes.status, 404);
  });
});

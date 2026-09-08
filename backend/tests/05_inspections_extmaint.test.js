const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, getAdminToken } = require('./helpers');

describe('Modül 11 & 12: Muayene ve Dış Bakım Testleri', () => {
  let adminToken;
  let groupId;
  let assetId1;
  let assetId2;
  let inspectionId;
  let extMaintId;

  before(async () => {
    const auth = await getAdminToken();
    adminToken = auth.token;

    // 1. Muayene ve dış bakım aktif grup oluştur
    const groupRes = await api('/api/asset-groups', {
      method: 'POST',
      body: {
        name: `Vinç ve Kaldırma Ekipmanları ${Date.now()}`,
        periodDays: 90,
        inspectionEnabled: true,
        inspectionPeriodDays: 365,
        extMaintEnabled: true,
        extMaintPeriodDays: 180,
      },
    }, adminToken);
    groupId = groupRes.data.id;

    // 2. Gruba bağlı 2 varlık oluştur
    const a1Res = await api('/api/assets', {
      method: 'POST',
      body: { name: `Tavan Vinci 01 ${Date.now()}`, groupId, status: 'Aktif' },
    }, adminToken);
    assetId1 = a1Res.data.id;

    const a2Res = await api('/api/assets', {
      method: 'POST',
      body: { name: `Tavan Vinci 02 ${Date.now()}`, groupId, status: 'Aktif' },
    }, adminToken);
    assetId2 = a2Res.data.id;
  });

  test('Grup muayenesi oluşturulabilmeli ve varlıkların muayene tarihi güncellenmeli (POST /api/inspections)', async () => {
    assert.ok(groupId);
    assert.ok(assetId1);
    assert.ok(assetId2);

    const res = await api('/api/inspections', {
      method: 'POST',
      body: {
        groupId,
        contractor: 'TÜV Austria Muayene Ltd.',
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        serviceCost: 4500,
        notes: 'Halat ve kanca çatlak muayenesi yapıldı. Uygunluk verildi.',
        assetIds: [assetId1, assetId2],
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.ok(res.data.trackingNo.startsWith('C'), 'Muayene takip no C ile başlamalı');
    assert.strictEqual(res.data.assetIds.length, 2);
    inspectionId = res.data.id;

    // Her iki varlığın last_inspection_date güncellenmiş olmalı
    const a1 = await api(`/api/assets/${assetId1}`, {}, adminToken);
    assert.ok(a1.data.lastInspectionDate);
    const a2 = await api(`/api/assets/${assetId2}`, {}, adminToken);
    assert.ok(a2.data.lastInspectionDate);
  });

  test('Muayene detayı getirilebilmeli (GET /api/inspections/:id)', async () => {
    assert.ok(inspectionId);
    const res = await api(`/api/inspections/${inspectionId}`, {}, adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.contractor, 'TÜV Austria Muayene Ltd.');
    assert.strictEqual(res.data.assetIds.length, 2);
  });

  test('Muayene kaydı silinebilmeli (DELETE /api/inspections/:id)', async () => {
    assert.ok(inspectionId);
    const res = await api(`/api/inspections/${inspectionId}`, {
      method: 'DELETE',
    }, adminToken);
    assert.strictEqual(res.status, 204);
  });

  test('Dış bakım kaydı oluşturulabilmeli ve varlıkların dış bakım tarihi güncellenmeli (POST /api/ext-maintenance)', async () => {
    assert.ok(groupId);
    assert.ok(assetId1);
    assert.ok(assetId2);

    const res = await api('/api/ext-maintenance', {
      method: 'POST',
      body: {
        groupId,
        contractor: 'Demag Servis A.Ş.',
        startDate: '2026-09-02',
        endDate: '2026-09-02',
        serviceCost: 8000,
        notes: 'Fren balataları ve motor redüktör bakımı yapıldı.',
        assetIds: [assetId1, assetId2],
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.ok(res.data.trackingNo.startsWith('D'), 'Dış bakım takip no D ile başlamalı');
    assert.strictEqual(res.data.assetIds.length, 2);
    extMaintId = res.data.id;

    // Her iki varlığın last_ext_maint_date güncellenmiş olmalı
    const a1 = await api(`/api/assets/${assetId1}`, {}, adminToken);
    assert.ok(a1.data.lastExtMaintDate);
    const a2 = await api(`/api/assets/${assetId2}`, {}, adminToken);
    assert.ok(a2.data.lastExtMaintDate);
  });

  test('Dış bakım detayı getirilebilmeli (GET /api/ext-maintenance/:id)', async () => {
    assert.ok(extMaintId);
    const res = await api(`/api/ext-maintenance/${extMaintId}`, {}, adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.contractor, 'Demag Servis A.Ş.');
    assert.strictEqual(res.data.assetIds.length, 2);
  });

  test('Dış bakım kaydı silinebilmeli (DELETE /api/ext-maintenance/:id)', async () => {
    assert.ok(extMaintId);
    const res = await api(`/api/ext-maintenance/${extMaintId}`, {
      method: 'DELETE',
    }, adminToken);
    assert.strictEqual(res.status, 204);
  });
});

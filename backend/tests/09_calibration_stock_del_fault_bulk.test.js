const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, getAdminToken } = require('./helpers');

describe('Modül 17: Kalibrasyon, Stok Hareketi Silme, Toplu Arıza ve Kritik Stok Testleri', () => {
  let adminToken;
  let createdGroupId;
  let createdAssetId;
  let testMaterialId;
  let createdCalibrationId;

  before(async () => {
    const auth = await getAdminToken();
    adminToken = auth.token;

    // Test grubu oluştur (Kalibrasyon aktif)
    const gRes = await api('/api/asset-groups', {
      method: 'POST',
      body: {
        name: `Kalibrasyon Grubu ${Date.now()}`,
        periodDays: 30,
        calibrationEnabled: true,
        calibrationPeriodDays: 180,
        calibrationBaselineDate: '2026-10-01',
        checklist: [{ id: 'q1', text: 'Sensör kalibrasyonu yap' }]
      }
    }, adminToken);
    assert.strictEqual(gRes.status, 201);
    assert.strictEqual(gRes.data.calibrationEnabled, true);
    assert.strictEqual(gRes.data.calibrationPeriodDays, 180);
    assert.strictEqual(gRes.data.calibrationBaselineDate, '2026-10-01');
    createdGroupId = gRes.data.id;

    // Test varlığı oluştur
    const aRes = await api('/api/assets', {
      method: 'POST',
      body: {
        name: 'Hassas Terazi 01',
        assetCode: `HT-${Date.now().toString().slice(-5)}`,
        groupId: createdGroupId,
        status: 'Aktif'
      }
    }, adminToken);
    assert.strictEqual(aRes.status, 201);
    createdAssetId = aRes.data.id;

    // Test malzemesi oluştur
    const mRes = await api('/api/materials', {
      method: 'POST',
      body: {
        name: `Test Kalibrasyon Sıvısı ${Date.now()}`,
        unit: 'şişe',
        qty: 10,
        minQty: 10,
        unitCost: 150
      }
    }, adminToken);
    assert.strictEqual(mRes.status, 201);
    testMaterialId = mRes.data.id;
  });

  test('Kalibrasyon kaydı oluşturulabilmeli ve K sayaç kodu atanmalı (POST /api/calibrations)', async () => {
    const res = await api('/api/calibrations', {
      method: 'POST',
      body: {
        groupId: createdGroupId,
        assetIds: [createdAssetId],
        contractor: 'TSE Kalibrasyon Lab',
        startDate: '2026-10-01',
        endDate: '2026-10-02',
        serviceCost: 2500,
        notes: 'Yıllık akredite terazi kalibrasyonu tamamlandı.'
      }
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.ok(res.data.trackingNo.startsWith('K'), `Takip kodu K ile başlamalı: ${res.data.trackingNo}`);
    assert.strictEqual(res.data.serviceCost, 2500);
    assert.strictEqual(res.data.contractor, 'TSE Kalibrasyon Lab');
    createdCalibrationId = res.data.id;
  });

  test('Kalibrasyon detayı ve liste getirilebilmeli (GET /api/calibrations)', async () => {
    const listRes = await api('/api/calibrations', {}, adminToken);
    assert.strictEqual(listRes.status, 200);
    assert.ok(Array.isArray(listRes.data));
    const found = listRes.data.find(c => c.id === createdCalibrationId);
    assert.ok(found);

    const detailRes = await api(`/api/calibrations/${createdCalibrationId}`, {}, adminToken);
    assert.strictEqual(detailRes.status, 200);
    assert.strictEqual(detailRes.data.id, createdCalibrationId);
    assert.strictEqual(detailRes.data.assets.length, 1);
    assert.strictEqual(detailRes.data.assets[0].id, createdAssetId);
  });

  test('Kalibrasyona web bağlantısı / belge eklenebilmeli (POST /api/calibrations/:id)', async () => {
    const res = await api(`/api/calibrations/${createdCalibrationId}`, {
      method: 'POST',
      body: {
        name: 'Akreditasyon Sertifikası Linki',
        kind: 'link',
        url: 'https://ornek.com/sertifika.pdf'
      }
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.strictEqual(res.data.kind, 'link');
    assert.strictEqual(res.data.url, 'https://ornek.com/sertifika.pdf');
  });

  test('Mevcut miktar min seviyeye eşitse (qty == minQty) ihtiyaç listesinde görünmemeli (GET /api/needs-list?includeAuto=true)', async () => {
    // Malzeme qty=10, minQty=10
    const res = await api('/api/needs-list?includeAuto=true', {}, adminToken);
    assert.strictEqual(res.status, 200);
    const autoList = res.data.autoLowStockNeeds || [];
    const autoItem = autoList.find(n => n.materialId === testMaterialId);
    assert.strictEqual(autoItem, undefined, 'Miktar min seviyeye eşitken ihtiyaç listesinde yer almamalıdır.');
  });

  test('Mevcut miktar min seviyenin altına düştüğünde (qty < minQty) otomatik ihtiyaç listesinde görünmeli', async () => {
    // Malzemeden 1 adet çıkış yap -> qty=9, minQty=10
    await api('/api/stock/movements', {
      method: 'POST',
      body: {
        materialId: testMaterialId,
        type: 'Çıkış',
        qty: 1,
        reason: 'Kalibrasyon testi tüketimi'
      }
    }, adminToken);

    const res = await api('/api/needs-list?includeAuto=true', {}, adminToken);
    assert.strictEqual(res.status, 200);
    const autoList = res.data.autoLowStockNeeds || [];
    const autoItem = autoList.find(n => n.materialId === testMaterialId);
    assert.ok(autoItem, 'Miktar min seviyenin altına düştüğünde ihtiyaç listesinde görünmelidir.');
  });

  test('Stok hareketi silinebilmeli ve malzeme stoğu geri alınmalı (DELETE /api/stock/movements/:id)', async () => {
    // Önce yeni bir Giriş hareketi yapalım (qty: 5) -> stok 9 + 5 = 14 olmalı
    const movRes = await api('/api/stock/movements', {
      method: 'POST',
      body: {
        materialId: testMaterialId,
        type: 'Giriş',
        qty: 5,
        reason: 'Fazla gelen teslimat'
      }
    }, adminToken);
    assert.strictEqual(movRes.status, 201);
    const movId = movRes.data.id;

    // Malzemenin güncel stoğunu kontrol et
    const matBefore = await api(`/api/materials/${testMaterialId}`, {}, adminToken);
    assert.strictEqual(matBefore.data.qty, 14);

    // Giriş hareketini sil -> stok 14 - 5 = 9 olmalı
    const delRes = await api(`/api/stock/movements/${movId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(delRes.status, 204);

    const matAfter = await api(`/api/materials/${testMaterialId}`, {}, adminToken);
    assert.strictEqual(matAfter.data.qty, 9);
  });

  test('Toplu arıza içe aktarımı yapılabilmeli (POST /api/faults/bulk)', async () => {
    const bulkRes = await api('/api/faults/bulk', {
      method: 'POST',
      body: {
        items: [
          {
            assetId: createdAssetId,
            title: 'Geçmiş Arıza 1 - Kalibrasyon Kayması',
            description: 'Sensör sıfır noktası kaydı',
            priority: 'Orta',
            status: 'Tamamlandı',
            reportedDate: '2025-05-10',
            resolvedDate: '2025-05-11',
            externalServiceCost: 800,
            notes: 'Ayarlandı'
          },
          {
            assetId: createdAssetId,
            title: 'Açık Arıza 2 - Ekran Yanıp Sönüyor',
            description: 'LCD panel titreşimi',
            priority: 'Düşük',
            status: 'Açık',
            reportedDate: '2026-09-28'
          }
        ]
      }
    }, adminToken);

    assert.strictEqual(bulkRes.status, 201);
    assert.strictEqual(bulkRes.data.count, 2);
    assert.ok(bulkRes.data.items[0].trackingNo.startsWith('A'));
    assert.strictEqual(bulkRes.data.items[0].status, 'Tamamlandı');
    assert.strictEqual(bulkRes.data.items[1].status, 'Açık');
  });
});

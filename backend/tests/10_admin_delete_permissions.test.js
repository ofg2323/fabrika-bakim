const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, getAdminToken, pool } = require('./helpers');

describe('Modül 18: Yöneticilerin Tüm Kayıtları Silme Yetkisi ve Temizleme Testi', () => {
  let adminToken;
  let techToken;
  let techUserId;

  // Test varlıkları ve kayıt kimlikleri
  let testGroupId;
  let testAssetId;
  let testMaterialId;
  let testSupplierId;
  let testNeedId;
  let testPurchaseId;
  let testStockMovId;
  let testMaintId;
  let testFaultId;
  let testInspId;
  let testExtMaintId;
  let testCalibId;
  let testProjectId;
  let testNormalUserId;

  before(async () => {
    const auth = await getAdminToken();
    adminToken = auth.token;

    // 1. Yetki kısıtlamalarını test etmek için geçici bir Teknisyen kullanıcısı oluştur
    const techName = `Test Teknisyen Yetki_${Date.now()}`;
    const techRes = await api('/api/users', {
      method: 'POST',
      body: { name: techName, role: 'Teknisyen', password: 'tech-password-123' },
    }, adminToken);
    assert.strictEqual(techRes.status, 201);
    techUserId = techRes.data.id;

    // Teknisyen ile login ol
    const loginRes = await api('/api/auth/login', {
      method: 'POST',
      body: { userId: techUserId, password: 'tech-password-123' },
    });
    assert.strictEqual(loginRes.status, 200);
    techToken = loginRes.data.token;
  });

  after(async () => {
    // Test teknisyenini temizle
    if (techUserId) {
      await api(`/api/users/${techUserId}`, { method: 'DELETE' }, adminToken);
    }
  });

  test('1. Yönetici her türden test kaydı oluşturabilmeli', async () => {
    // A. Tedarikçi
    const supRes = await api('/api/suppliers', {
      method: 'POST',
      body: { name: `Silme Test Tedarikçisi ${Date.now()}`, phone: '05550001122' },
    }, adminToken);
    assert.strictEqual(supRes.status, 201);
    testSupplierId = supRes.data.id;

    // B. Varlık Grubu
    const groupRes = await api('/api/asset-groups', {
      method: 'POST',
      body: {
        name: `Silme Test Grubu ${Date.now()}`,
        periodDays: 30,
        inspectionEnabled: true,
        inspectionPeriodDays: 60,
        inspectionBaselineDate: '2026-10-01',
        extMaintEnabled: true,
        extMaintPeriodDays: 90,
        extMaintBaselineDate: '2026-10-01',
        calibrationEnabled: true,
        calibrationPeriodDays: 120,
        calibrationBaselineDate: '2026-10-01',
      },
    }, adminToken);
    assert.strictEqual(groupRes.status, 201);
    testGroupId = groupRes.data.id;

    // C. Varlık
    const assetRes = await api('/api/assets', {
      method: 'POST',
      body: {
        name: `Silme Test Varlığı ${Date.now()}`,
        groupId: testGroupId,
        status: 'Aktif',
      },
    }, adminToken);
    assert.strictEqual(assetRes.status, 201);
    testAssetId = assetRes.data.id;

    // D. Malzeme
    const matRes = await api('/api/materials', {
      method: 'POST',
      body: {
        name: `Silme Test Malzemesi ${Date.now()}`,
        unit: 'adet',
        qty: 100,
        minQty: 10,
        unitCost: 50,
        defaultSupplierId: testSupplierId,
      },
    }, adminToken);
    assert.strictEqual(matRes.status, 201);
    testMaterialId = matRes.data.id;

    // E. Manuel Stok Hareketi
    const movRes = await api('/api/stock/movements', {
      method: 'POST',
      body: {
        materialId: testMaterialId,
        type: 'Giriş',
        qty: 10,
        reason: 'Ek test stoğu girişi',
      },
    }, adminToken);
    assert.strictEqual(movRes.status, 201);
    testStockMovId = movRes.data.id;

    // F. İhtiyaç Kaydı
    const needRes = await api('/api/needs-list', {
      method: 'POST',
      body: {
        materialId: testMaterialId,
        name: 'Test İhtiyaç Kalemi',
        qty: 5,
        estimatedPrice: 250,
        supplierId: testSupplierId,
        note: 'Test ihtiyacı',
      },
    }, adminToken);
    assert.strictEqual(needRes.status, 201);
    testNeedId = needRes.data.id;

    // G. Satın Alma Kaydı
    const purRes = await api('/api/purchases', {
      method: 'POST',
      body: {
        materialId: testMaterialId,
        qty: 10,
        unitPrice: 50,
        supplierId: testSupplierId,
        note: 'Silme testi satın alması',
      },
    }, adminToken);
    assert.strictEqual(purRes.status, 201);
    testPurchaseId = purRes.data.id;

    // H. Bakım Kaydı
    const maintRes = await api('/api/maintenance', {
      method: 'POST',
      body: {
        assetId: testAssetId,
        type: 'Periyodik',
        startDate: '2026-10-01',
        endDate: '2026-10-01',
        notes: 'Silme testi bakımı yapıldı',
        usedMaterials: [{ materialId: testMaterialId, qty: 2 }],
      },
    }, adminToken);
    assert.strictEqual(maintRes.status, 201);
    testMaintId = maintRes.data.id;

    // I. Arıza Kaydı
    const faultRes = await api('/api/faults', {
      method: 'POST',
      body: {
        assetId: testAssetId,
        title: 'Silme Testi Arıza Başlığı',
        description: 'Test arıza açıklaması',
        priority: 'Orta',
        status: 'Açık',
        reportedDate: '2026-10-01',
      },
    }, adminToken);
    assert.strictEqual(faultRes.status, 201);
    testFaultId = faultRes.data.id;

    // J. Muayene Kaydı
    const inspRes = await api('/api/inspections', {
      method: 'POST',
      body: {
        groupId: testGroupId,
        contractor: 'Yetkili Denetmen Ltd.',
        startDate: '2026-10-01',
        endDate: '2026-10-01',
        serviceCost: 3500,
        notes: 'Test muayenesi tamamlandı',
        assetIds: [testAssetId],
      },
    }, adminToken);
    assert.strictEqual(inspRes.status, 201);
    testInspId = inspRes.data.id;

    // K. Dış Bakım Kaydı
    const extRes = await api('/api/ext-maintenance', {
      method: 'POST',
      body: {
        groupId: testGroupId,
        contractor: 'Dış Servis Test Ltd.',
        startDate: '2026-10-01',
        endDate: '2026-10-01',
        serviceCost: 3000,
        notes: 'Test dış bakımı',
        assetIds: [testAssetId],
      },
    }, adminToken);
    assert.strictEqual(extRes.status, 201);
    testExtMaintId = extRes.data.id;

    // L. Kalibrasyon Kaydı
    const calibRes = await api('/api/calibrations', {
      method: 'POST',
      body: {
        groupId: testGroupId,
        assetIds: [testAssetId],
        contractor: 'TÜBİTAK UME Test',
        startDate: '2026-10-01',
        endDate: '2026-10-01',
        serviceCost: 2500,
        notes: 'Test kalibrasyonu',
      },
    }, adminToken);
    testCalibId = calibRes?.data?.id;

    // M. Proje Kaydı
    const projRes = await api('/api/projects', {
      method: 'POST',
      body: {
        name: `Silme Test Projesi ${Date.now()}`,
        description: 'Yönetici silme yetkisi testi',
        priority: 'Yüksek',
        status: 'Planlama',
        budget: 100000,
      },
    }, adminToken);
    testProjectId = projRes?.data?.id;

    // N. Kullanıcı Kaydı
    const userRes = await api('/api/users', {
      method: 'POST',
      body: {
        name: `Silme Test Kullanıcısı ${Date.now()}`,
        role: 'Teknisyen',
        password: 'test-user-pass-123',
      },
    }, adminToken);
    testNormalUserId = userRes?.data?.id;

    for (const [name, res] of [
      ['supRes', supRes],
      ['groupRes', groupRes],
      ['assetRes', assetRes],
      ['matRes', matRes],
      ['movRes', movRes],
      ['needRes', needRes],
      ['purRes', purRes],
      ['maintRes', maintRes],
      ['faultRes', faultRes],
      ['inspRes', inspRes],
      ['extRes', extRes],
      ['calibRes', calibRes],
      ['projRes', projRes],
      ['userRes', userRes],
    ]) {
      if (res.status !== 201) {
        console.error(`FAILD CREATION: ${name} -> status: ${res.status}, body:`, res.data);
      }
      assert.strictEqual(res.status, 201, `${name} must return 201`);
    }
  });

  test('2. Teknisyen (yönetici olmayan rol) yöneticilere özel silme işlemlerinde 403 Forbidden almalı', async () => {
    // Varlık silme -> 403
    const aRes = await api(`/api/assets/${testAssetId}`, { method: 'DELETE' }, techToken);
    assert.strictEqual(aRes.status, 403);

    // Varlık grubu silme -> 403
    const gRes = await api(`/api/asset-groups/${testGroupId}`, { method: 'DELETE' }, techToken);
    assert.strictEqual(gRes.status, 403);

    // Bakım silme -> 403
    const mRes = await api(`/api/maintenance/${testMaintId}`, { method: 'DELETE' }, techToken);
    assert.strictEqual(mRes.status, 403);

    // Arıza silme -> 403
    const fRes = await api(`/api/faults/${testFaultId}`, { method: 'DELETE' }, techToken);
    assert.strictEqual(fRes.status, 403);

    // Muayene silme -> 403
    const iRes = await api(`/api/inspections/${testInspId}`, { method: 'DELETE' }, techToken);
    assert.strictEqual(iRes.status, 403);

    // Dış bakım silme -> 403
    const eRes = await api(`/api/ext-maintenance/${testExtMaintId}`, { method: 'DELETE' }, techToken);
    assert.strictEqual(eRes.status, 403);

    // Kalibrasyon silme -> 403
    const cRes = await api(`/api/calibrations/${testCalibId}`, { method: 'DELETE' }, techToken);
    assert.strictEqual(cRes.status, 403);

    // Malzeme silme -> 403
    const matRes = await api(`/api/materials/${testMaterialId}`, { method: 'DELETE' }, techToken);
    assert.strictEqual(matRes.status, 403);

    // Tedarikçi silme -> 403
    const supRes = await api(`/api/suppliers/${testSupplierId}`, { method: 'DELETE' }, techToken);
    assert.strictEqual(supRes.status, 403);

    // Satın alma silme -> 403
    const purRes = await api(`/api/purchases/${testPurchaseId}`, { method: 'DELETE' }, techToken);
    assert.strictEqual(purRes.status, 403);

    // İhtiyaç listesi silme (Teknisyen için kısıtlı) -> 403
    const needRes = await api(`/api/needs-list/${testNeedId}`, { method: 'DELETE' }, techToken);
    assert.strictEqual(needRes.status, 403);

    // Proje silme -> 403
    const projRes = await api(`/api/projects/${testProjectId}`, { method: 'DELETE' }, techToken);
    assert.strictEqual(projRes.status, 403);

    // Kullanıcı silme -> 403
    const userRes = await api(`/api/users/${testNormalUserId}`, { method: 'DELETE' }, techToken);
    assert.strictEqual(userRes.status, 403);
  });

  test('3. Yönetici tüm kayıtları başarıyla silebilmeli (DELETE 204)', async () => {
    // 3.1. Kalibrasyon silme
    const calibDel = await api(`/api/calibrations/${testCalibId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(calibDel.status, 204);

    // 3.2. Dış Bakım silme
    const extDel = await api(`/api/ext-maintenance/${testExtMaintId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(extDel.status, 204);

    // 3.3. Muayene silme
    const inspDel = await api(`/api/inspections/${testInspId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(inspDel.status, 204);

    // 3.4. Bakım silme (kullanılan malzeme stoka iade edilir)
    const maintDel = await api(`/api/maintenance/${testMaintId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(maintDel.status, 204);

    // 3.5. Arıza silme
    const faultDel = await api(`/api/faults/${testFaultId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(faultDel.status, 204);

    // 3.6. Satın Alma silme
    const purDel = await api(`/api/purchases/${testPurchaseId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(purDel.status, 204);

    // 3.7. İhtiyaç Listesi silme
    const needDel = await api(`/api/needs-list/${testNeedId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(needDel.status, 204);

    // 3.8. Manuel Stok Hareketi silme
    const movDel = await api(`/api/stock/movements/${testStockMovId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(movDel.status, 204);

    // 3.9. Varlık silme
    const assetDel = await api(`/api/assets/${testAssetId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(assetDel.status, 204);

    // 3.10. Varlık Grubu silme (artık bağlı varlık yok)
    const groupDel = await api(`/api/asset-groups/${testGroupId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(groupDel.status, 204);

    // 3.11. Malzeme silme (artık bağlı işlem veya stok hareketi kalmadı)
    // Not: Satın alma ve stok hareketleri ters işlem kayıtlarını temizlemek için DB'deki referansı kontrol et
    await pool.query('DELETE FROM stock_movements WHERE material_id = $1', [testMaterialId]);
    const matDel = await api(`/api/materials/${testMaterialId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(matDel.status, 204);

    // 3.12. Tedarikçi silme
    const supDel = await api(`/api/suppliers/${testSupplierId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(supDel.status, 204);

    // 3.13. Proje silme
    const projDel = await api(`/api/projects/${testProjectId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(projDel.status, 204);

    // 3.14. Kullanıcı silme
    const userDel = await api(`/api/users/${testNormalUserId}`, { method: 'DELETE' }, adminToken);
    assert.strictEqual(userDel.status, 204);
  });

  test('4. Silinen tüm kayıtların veritabanından tamamen silindiği (404/Bulunamadı) doğrulanmalı', async () => {
    // Varlık
    const assetCheck = await api(`/api/assets/${testAssetId}`, {}, adminToken);
    assert.strictEqual(assetCheck.status, 404);

    // Varlık Grubu
    const groupCheck = await api(`/api/asset-groups/${testGroupId}`, {}, adminToken);
    assert.strictEqual(groupCheck.status, 404);

    // Malzeme
    const matCheck = await api(`/api/materials/${testMaterialId}`, {}, adminToken);
    assert.strictEqual(matCheck.status, 404);

    // Tedarikçi
    const supCheck = await api(`/api/suppliers/${testSupplierId}`, {}, adminToken);
    assert.strictEqual(supCheck.status, 404);

    // Bakım
    const maintCheck = await api(`/api/maintenance/${testMaintId}`, {}, adminToken);
    assert.strictEqual(maintCheck.status, 404);

    // Arıza
    const faultCheck = await api(`/api/faults/${testFaultId}`, {}, adminToken);
    assert.strictEqual(faultCheck.status, 404);

    // Muayene
    const inspCheck = await api(`/api/inspections/${testInspId}`, {}, adminToken);
    assert.strictEqual(inspCheck.status, 404);

    // Dış Bakım
    const extCheck = await api(`/api/ext-maintenance/${testExtMaintId}`, {}, adminToken);
    assert.strictEqual(extCheck.status, 404);

    // Kalibrasyon
    const calibCheck = await api(`/api/calibrations/${testCalibId}`, {}, adminToken);
    assert.strictEqual(calibCheck.status, 404);

    // Proje
    const projCheck = await api(`/api/projects/${testProjectId}`, {}, adminToken);
    assert.strictEqual(projCheck.status, 404);

    // Kullanıcı
    const usersList = await api('/api/users', {}, adminToken);
    const foundUser = usersList.data.find(u => u.id === testNormalUserId);
    assert.strictEqual(foundUser, undefined, 'Silinen kullanıcı kullanıcı listesinde olmamalıdır.');
  });
});

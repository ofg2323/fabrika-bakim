const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, getAdminToken } = require('./helpers');

describe('Modül 5, 6, 7 & 8: Tedarikçi, Malzeme, Stok ve Satın Alma Testleri', () => {
  let adminToken;
  let supplierId;
  let materialId;
  let needId;
  let purchaseId;

  before(async () => {
    const auth = await getAdminToken();
    adminToken = auth.token;
  });

  test('Tedarikçi oluşturulabilmeli (POST /api/suppliers)', async () => {
    const res = await api('/api/suppliers', {
      method: 'POST',
      body: {
        name: `Borusan Rulman ${Date.now()}`,
        contactPerson: 'Serdar Kaya',
        phone: '0212 555 1234',
        email: 'siparis@borusan-rulman.test',
        paymentTerms: '30 Gün Vade',
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    supplierId = res.data.id;
  });

  test('Malzeme oluşturulabilmeli (POST /api/materials)', async () => {
    const res = await api('/api/materials', {
      method: 'POST',
      body: {
        name: `SKF 6205 Rulman ${Date.now()}`,
        unit: 'adet',
        qty: 10,
        minQty: 15, // Kritik seviyenin altında (10 < 15)
        unitCost: 85.0,
        defaultSupplierId: supplierId,
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.strictEqual(res.data.qty, 10);
    assert.strictEqual(res.data.minQty, 15);
    materialId = res.data.id;
  });

  test('Manuel stok girişi (Giriş) yapılabilmeli (POST /api/materials/:id/adjust)', async () => {
    assert.ok(materialId);
    const res = await api(`/api/materials/${materialId}/adjust`, {
      method: 'POST',
      body: {
        type: 'Giriş',
        qty: 5,
        reason: 'Sayım fazlası bulundu',
      },
    }, adminToken);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.qty, 15); // 10 + 5 = 15
  });

  test('Manuel stok çıkışı (Çıkış) yapılabilmeli (POST /api/materials/:id/adjust)', async () => {
    assert.ok(materialId);
    const res = await api(`/api/materials/${materialId}/adjust`, {
      method: 'POST',
      body: {
        type: 'Çıkış',
        qty: 7,
        reason: 'Hatalı sevkiyat iadesi',
      },
    }, adminToken);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.qty, 8); // 15 - 7 = 8
  });

  test('Mevcut stoktan fazla çıkış engellenmeli (eksi stok koruması)', async () => {
    assert.ok(materialId);
    const res = await api(`/api/materials/${materialId}/adjust`, {
      method: 'POST',
      body: {
        type: 'Çıkış',
        qty: 100, // Yetersiz stok (mevcut 8)
        reason: 'Aşırı çıkış denemesi',
      },
    }, adminToken);

    assert.strictEqual(res.status, 400);
    assert.ok(res.data.error);
  });

  test('Stok hareket geçmişi listelenebilmeli (GET /api/stock/movements)', async () => {
    assert.ok(materialId);
    const res = await api(`/api/stock/movements?materialId=${materialId}`, {}, adminToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data));
    assert.strictEqual(res.data.length, 3); // 1 İlk Giriş, 1 Manuel Giriş, 1 Manuel Çıkış
    assert.ok(res.data.some(m => m.type === 'Çıkış'));
    assert.ok(res.data.some(m => m.type === 'Giriş'));
  });

  test('İhtiyaç listesi otomatik kritik stok tespiti (GET /api/needs-list?includeAuto=true)', async () => {
    assert.ok(materialId);
    // Malzeme stoku 8, minQty 15 olduğundan otomatik ihtiyaç listesinde çıkmalı
    const res = await api('/api/needs-list?includeAuto=true', {}, adminToken);
    assert.strictEqual(res.status, 200);
    const autoList = res.data.autoLowStockNeeds || res.data.autoNeeds || [];
    assert.ok(Array.isArray(autoList));
    const autoItem = autoList.find(n => n.materialId === materialId);
    assert.ok(autoItem);
    assert.strictEqual(autoItem.qty, 7); // 15 - 8 = 7 eksik
  });

  test('Manuel ihtiyaç talebi eklenebilmeli (POST /api/needs-list)', async () => {
    assert.ok(materialId);
    const res = await api('/api/needs-list', {
      method: 'POST',
      body: {
        materialId,
        name: 'SKF Rulman Talebi',
        qty: 10,
        estimatedPrice: 90,
        supplierId,
        note: 'Acil sipariş edilecek',
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.strictEqual(res.data.status, 'Beklemede');
    needId = res.data.id;
  });

  test('Satın alma işlemi atomik olarak stoku artırmalı ve ihtiyacı kapatmalı (POST /api/purchases)', async () => {
    assert.ok(materialId);
    assert.ok(needId);

    const res = await api('/api/purchases', {
      method: 'POST',
      body: {
        materialId,
        qty: 10,
        unitPrice: 92.5,
        supplierId,
        needId,
        note: 'Faturalı alım',
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    purchaseId = res.data.id;

    // 1. Malzeme stoku artmış olmalı (önceki 8 + 10 = 18)
    const matRes = await api(`/api/materials/${materialId}`, {}, adminToken);
    assert.strictEqual(matRes.data.qty, 18);
    assert.strictEqual(matRes.data.unitCost, 92.5);

    // 2. İhtiyaç durumu 'Alındı' olmalı
    const needCheck = await api('/api/needs-list', {}, adminToken);
    const updatedNeed = needCheck.data.needs.find(n => n.id === needId);
    assert.ok(updatedNeed);
    assert.strictEqual(updatedNeed.status, 'Alındı');
  });

  test('Satın alma silindiğinde eklenen stok otomatik geri düşülmeli (DELETE /api/purchases/:id)', async () => {
    assert.ok(purchaseId);
    assert.ok(materialId);

    const res = await api(`/api/purchases/${purchaseId}`, {
      method: 'DELETE',
    }, adminToken);

    assert.strictEqual(res.status, 204);

    // Stok tekrar 18 - 10 = 8'e inmiş olmalı
    const matRes = await api(`/api/materials/${materialId}`, {}, adminToken);
    assert.strictEqual(matRes.data.qty, 8);
  });

  test('Tüketilmiş satın alma kaydının silinmesi 409 ile engellenmeli (P0 Satın Alma Bütünlüğü)', async () => {
    assert.ok(materialId);

    // 1. Yeni bir 20 adetlik alım yap (mevcut 8 + 20 = 28)
    const pRes = await api('/api/purchases', {
      method: 'POST',
      body: {
        materialId,
        qty: 20,
        unitPrice: 100,
        supplierId,
      },
    }, adminToken);
    assert.strictEqual(pRes.status, 201);
    const newPurchaseId = pRes.data.id;

    // 2. Stoğun bir kısmını çık (örneğin 25 adet çık, geriye 3 kalsın)
    await api(`/api/materials/${materialId}/adjust`, {
      method: 'POST',
      body: {
        type: 'Çıkış',
        qty: 25,
        reason: 'Sarfiyat testi',
      },
    }, adminToken);

    // 3. Mevcut stok 3 iken 20 adetlik satın almayı silmeyi dene -> 409 engeli beklenir
    const delRes = await api(`/api/purchases/${newPurchaseId}`, {
      method: 'DELETE',
    }, adminToken);

    assert.strictEqual(delRes.status, 409);
    assert.ok(delRes.data.error.includes('silinemez'));
  });
});

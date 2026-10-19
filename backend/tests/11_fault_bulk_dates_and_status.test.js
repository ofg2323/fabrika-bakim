const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, getAdminToken } = require('./helpers');
const pool = require('../src/db/pool');

describe('Modül 19: Toplu Arıza Tarih ve Durum (Açık/Tamamlandı) Ayrımı Testi', () => {
  let adminToken;
  let testGroupId;
  let testAssetId;
  const createdFaultIds = [];

  before(async () => {
    const auth = await getAdminToken();
    adminToken = auth.token;

    // Test için geçici varlık grubu ve varlık oluştur
    const gRes = await api('/api/asset-groups', {
      method: 'POST',
      body: {
        name: `Test Toplu Arıza Grubu ${Date.now()}`,
        periodDays: 30,
        checklist: [{ id: 'q1', text: 'Kontrol' }]
      }
    }, adminToken);
    assert.strictEqual(gRes.status, 201);
    testGroupId = gRes.data.id;

    const aRes = await api('/api/assets', {
      method: 'POST',
      body: {
        name: 'Test Pres Makinesi 99',
        assetCode: `TPM-${Date.now().toString().slice(-5)}`,
        groupId: testGroupId,
        status: 'Aktif'
      }
    }, adminToken);
    assert.strictEqual(aRes.status, 201);
    testAssetId = aRes.data.id;
  });

  after(async () => {
    // "TEST YAPARSAN BU TEST VERİLERİNİ DE SİL" gereksinimi:
    // Tüm test verilerini tamamen temizle
    for (const fid of createdFaultIds) {
      try {
        await api(`/api/faults/${fid}`, { method: 'DELETE' }, adminToken);
      } catch (_) {}
    }
    if (testAssetId) {
      try {
        await api(`/api/assets/${testAssetId}`, { method: 'DELETE' }, adminToken);
      } catch (_) {}
    }
    if (testGroupId) {
      try {
        await api(`/api/asset-groups/${testGroupId}`, { method: 'DELETE' }, adminToken);
      } catch (_) {}
    }

    // Ek güvenlik: test arızalarının DB'de kalmadığını doğrula ve sayaç/varlık durumunu senkronla
    await pool.query("DELETE FROM faults WHERE asset_id = $1", [testAssetId]);
    await pool.query("UPDATE assets SET status = 'Aktif' WHERE id = $1", [testAssetId]);
    await pool.query("UPDATE counters SET value = COALESCE((SELECT MAX(NULLIF(regexp_replace(tracking_no, '\\D', '', 'g'), '')::int) FROM faults), 0) WHERE kind = 'fault'");
  });

  test('Toplu arıza yüklemesinde Türkçe tarih formatları (DD.MM.YYYY) ve geçmiş tarihler korunmalı', async () => {
    const bulkRes = await api('/api/faults/bulk', {
      method: 'POST',
      body: {
        items: [
          {
            assetId: testAssetId,
            title: 'Test Türkçe Tarihli Açık Arıza',
            description: 'Valf sızıntısı',
            priority: 'Yüksek',
            status: 'Açık',
            reportedDate: '15.03.2024'
          },
          {
            assetId: testAssetId,
            title: 'Test Slash Formatlı Açık Arıza',
            description: 'Hortum patlaması',
            priority: 'Orta',
            status: 'Açık',
            reportedDate: '05/11/2023'
          }
        ]
      }
    }, adminToken);

    assert.strictEqual(bulkRes.status, 201);
    assert.strictEqual(bulkRes.data.count, 2);

    const f1 = bulkRes.data.items[0];
    const f2 = bulkRes.data.items[1];
    createdFaultIds.push(f1.id, f2.id);

    assert.strictEqual(f1.reportedDate, '2024-03-15', 'DD.MM.YYYY formatındaki bildirim tarihi doğru parse edilmeli');
    assert.strictEqual(f1.status, 'Açık', 'Açık arıza Açık olarak kaydedilmeli');
    assert.strictEqual(f1.resolvedDate, null, 'Açık arızanın çözüm tarihi null olmalı');

    assert.strictEqual(f2.reportedDate, '2023-11-05', 'DD/MM/YYYY formatındaki bildirim tarihi doğru parse edilmeli');
    assert.strictEqual(f2.status, 'Açık');
  });

  test('Toplu arızada "Çözüldü" / "Tamamlandı" durumundaki kayıtlar Tamamlandı olarak açılmalı ve çözüm tarihi atanmalı', async () => {
    const bulkRes = await api('/api/faults/bulk', {
      method: 'POST',
      body: {
        items: [
          {
            assetId: testAssetId,
            title: 'Test Çözülmüş Arıza',
            description: 'Rulman değişti',
            priority: 'Orta',
            status: 'Çözüldü',
            reportedDate: '10.02.2024',
            resolvedDate: '12.02.2024',
            notes: 'Yeni SKF rulman takıldı',
            externalServiceCost: 750
          },
          {
            assetId: testAssetId,
            title: 'Test Çözüm Tarihi Verilmiş Arıza (Durum Belirtilmemiş)',
            description: 'Kablo koptu',
            priority: 'Düşük',
            reportedDate: '2024-01-10',
            resolvedDate: '2024-01-11',
            notes: 'Kablo lehimlendi'
          }
        ]
      }
    }, adminToken);

    assert.strictEqual(bulkRes.status, 201);
    assert.strictEqual(bulkRes.data.count, 2);

    const fDone1 = bulkRes.data.items[0];
    const fDone2 = bulkRes.data.items[1];
    createdFaultIds.push(fDone1.id, fDone2.id);

    assert.strictEqual(fDone1.status, 'Tamamlandı', '"Çözüldü" ifadesi "Tamamlandı" durumuna dönüştürülmeli');
    assert.strictEqual(fDone1.reportedDate, '2024-02-10', 'Bildirim tarihi şablondaki tarih olmalı');
    assert.strictEqual(fDone1.resolvedDate, '2024-02-12', 'Çözüm tarihi korunmalı');
    assert.strictEqual(fDone1.notes, 'Yeni SKF rulman takıldı', 'Çözüm notu kaydedilmeli');
    assert.strictEqual(parseFloat(fDone1.externalServiceCost), 750, 'Dış servis maliyeti kaydedilmeli');

    assert.strictEqual(fDone2.status, 'Tamamlandı', 'Çözüm tarihi olan arıza Tamamlandı kabul edilmeli');
    assert.strictEqual(fDone2.resolvedDate, '2024-01-11');
  });

  test('Filtreleme kontrolü: Açık arızalar "open" filtresinde, Tamamlanmış arızalar "resolved" filtresinde listelenmeli', async () => {
    // 1. Açık filtresi kontrolü
    const openRes = await api(`/api/faults?filter=open&assetId=${testAssetId}`, {}, adminToken);
    assert.strictEqual(openRes.status, 200);
    const openList = openRes.data;
    assert.ok(openList.length >= 2, 'Açık arızalar açık listesinde bulunmalı');
    assert.ok(openList.every(f => f.status !== 'Tamamlandı'), 'Açık filtresinde hiçbir Tamamlandı kaydı olmamalı');

    // 2. Tamamlandı filtresi kontrolü
    const resolvedRes = await api(`/api/faults?filter=resolved&assetId=${testAssetId}`, {}, adminToken);
    assert.strictEqual(resolvedRes.status, 200);
    const resolvedList = resolvedRes.data;
    assert.ok(resolvedList.length >= 2, 'Tamamlanan arızalar resolved listesinde bulunmalı');
    assert.ok(resolvedList.every(f => f.status === 'Tamamlandı'), 'Resolved filtresindeki tüm kayıtlar Tamamlandı durumunda olmalı');
  });
});

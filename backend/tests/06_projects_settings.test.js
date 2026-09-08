const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, getAdminToken } = require('./helpers');

describe('Modül 13 & 14: Projeler ve Sistem Ayarları Testleri', () => {
  let adminToken;
  let projectId;
  let taskId;
  let quoteId;

  before(async () => {
    const auth = await getAdminToken();
    adminToken = auth.token;
  });

  test('Yeni proje oluşturulabilmeli (POST /api/projects)', async () => {
    const res = await api('/api/projects', {
      method: 'POST',
      body: {
        name: `CNC Otomasyon Hattı Kurulumu ${Date.now()}`,
        description: '3 adet 5 eksen CNC tezgahının fabrika zeminine ankrajı ve hat besleme konveyörü',
        priority: 'Yüksek',
        status: 'Planlama',
        startDate: '2026-10-01',
        targetEndDate: '2026-12-31',
        budget: 500000,
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.ok(res.data.trackingNo.startsWith('P'), 'Proje takip no P ile başlamalı');
    assert.strictEqual(res.data.budget, 500000);
    projectId = res.data.id;
  });

  test('Projeye görev eklenebilmeli (POST /api/projects/:id/tasks)', async () => {
    assert.ok(projectId);

    const res = await api(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      body: {
        title: 'Zemin beton ve ankraj mukavemet testi',
        assignType: 'Taşeron',
        assignee: 'BetonTest Mühendislik',
        status: 'Devam Ediyor',
        cost: 25000,
        startDate: '2026-10-05',
        endDate: '2026-10-15',
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.strictEqual(res.data.title, 'Zemin beton ve ankraj mukavemet testi');
    taskId = res.data.id;
  });

  test('Projeye tedarikçi teklifi eklenebilmeli (POST /api/projects/:id/quotes)', async () => {
    assert.ok(projectId);

    const res = await api(`/api/projects/${projectId}/quotes`, {
      method: 'POST',
      body: {
        supplierName: 'Konveyör A.Ş.',
        amount: 145000,
        date: '2026-09-01',
        validUntil: '2026-10-01',
        note: 'Motor ve sensörler dahil anahtar teslim teklif',
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.strictEqual(Number(res.data.amount), 145000);
    quoteId = res.data.id;
  });

  test('Projeye ilerleme notu eklenebilmeli (POST /api/projects/:id/progress-logs)', async () => {
    assert.ok(projectId);

    const res = await api(`/api/projects/${projectId}/progress-logs`, {
      method: 'POST',
      body: {
        date: '2026-09-03',
        note: 'Saha keşfi tamamlandı, elektrik panosu yeri onaylandı.',
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.strictEqual(res.data.note, 'Saha keşfi tamamlandı, elektrik panosu yeri onaylandı.');
  });

  test('Proje bütçesi güncellendiğinde revizyon geçmişi oluşmalı (POST /api/projects/:id/budget)', async () => {
    assert.ok(projectId);

    const res = await api(`/api/projects/${projectId}/budget`, {
      method: 'POST',
      body: {
        amount: 550000, // 500k -> 550k artırıldı
        note: 'Ek elektrik altyapı maliyeti eklendi',
      },
    }, adminToken);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(Number(res.data.amount), 550000);
  });

  test('Proje detayında tüm alt bileşenler eksiksiz dönmeli (GET /api/projects/:id)', async () => {
    assert.ok(projectId);

    const res = await api(`/api/projects/${projectId}`, {}, adminToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.tasks));
    assert.strictEqual(res.data.tasks.length, 1);
    assert.ok(Array.isArray(res.data.quotes));
    assert.strictEqual(res.data.quotes.length, 1);
    assert.ok(Array.isArray(res.data.progressLogs));
    assert.strictEqual(res.data.progressLogs.length, 1);
    assert.ok(Array.isArray(res.data.budgetHistory));
    assert.ok(res.data.budgetHistory.length >= 1);
  });

  test('Proje silinebilmeli (DELETE /api/projects/:id)', async () => {
    assert.ok(projectId);

    const res = await api(`/api/projects/${projectId}`, {
      method: 'DELETE',
    }, adminToken);

    assert.strictEqual(res.status, 204);
  });

  test('Sistem ve yazdırma şablon ayarları kaydedilip okunabilmeli (/api/settings)', async () => {
    const settingsPayload = {
      companyName: 'Aypol Polimer Kimya San. A.Ş.',
      footerNote: 'Bu form ISO 9001 Kalite Yönetim Standardı gereği saklanmalıdır.',
      pageSize: 'A4',
      orientation: 'landscape',
      maint: {
        showAssetInfo: true,
        showTypeAndDates: true,
        showUsedMaterials: true,
        showSignatures: true,
      },
      fault: {
        showAssetInfo: true,
        showTechnicalSolution: true,
        showSignatures: true,
      },
    };

    // Kaydet
    const saveRes = await api('/api/settings', {
      method: 'POST',
      body: settingsPayload,
    }, adminToken);
    assert.strictEqual(saveRes.status, 200);
    assert.strictEqual(saveRes.data.companyName, 'Aypol Polimer Kimya San. A.Ş.');
    assert.strictEqual(saveRes.data.orientation, 'landscape');

    // Getir
    const getRes = await api('/api/settings', {}, adminToken);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.data.companyName, 'Aypol Polimer Kimya San. A.Ş.');
    assert.strictEqual(getRes.data.footerNote, 'Bu form ISO 9001 Kalite Yönetim Standardı gereği saklanmalıdır.');
    assert.strictEqual(getRes.data.orientation, 'landscape');
  });
});

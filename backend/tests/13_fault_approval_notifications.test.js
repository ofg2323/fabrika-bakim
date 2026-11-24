const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, getAdminToken, pool } = require('./helpers');
const syncService = require('../src/modules/sync/sync.service');

describe('Modül 19: Yeni Arıza Onay Bildirimleri', () => {
  let adminToken;
  let techToken;
  let techUserId;
  let assetId;
  let faultId;
  let notificationId;

  before(async () => {
    const auth = await getAdminToken();
    adminToken = auth.token;

    const assetRes = await api('/api/assets', {
      method: 'POST',
      body: { name: `Onay Akışı Varlığı ${Date.now()}` },
    }, adminToken);
    assert.strictEqual(assetRes.status, 201);
    assetId = assetRes.data.id;

    const techRes = await api('/api/users', {
      method: 'POST',
      body: { name: `Onay Akışı Teknisyen ${Date.now()}`, role: 'Teknisyen', password: 'tech-password-123' },
    }, adminToken);
    assert.strictEqual(techRes.status, 201);
    techUserId = techRes.data.id;

    const loginRes = await api('/api/auth/login', {
      method: 'POST',
      body: { userId: techUserId, password: 'tech-password-123' },
    });
    assert.strictEqual(loginRes.status, 200);
    techToken = loginRes.data.token;
  });

  after(async () => {
    if (faultId) {
      await pool.query('DELETE FROM faults WHERE id = $1', [faultId]);
    }
    if (assetId) {
      await pool.query('DELETE FROM assets WHERE id = $1', [assetId]);
    }
    if (techUserId) {
      await pool.query('DELETE FROM users WHERE id = $1', [techUserId]);
    }
  });

  test('1. Yeni arıza bekleyen bir yönetici onay bildirimi oluşturur', async () => {
    const res = await api('/api/faults', {
      method: 'POST',
      body: { assetId, title: `Onay Akışı Arızası ${Date.now()}`, priority: 'Yüksek' },
    }, adminToken);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.status, 'Açık');
    faultId = res.data.id;

    const list = await api('/api/fault-notifications?all=true', {}, adminToken);
    assert.strictEqual(list.status, 200);
    const note = list.data.find(n => n.faultId === faultId);
    assert.ok(note, 'Arıza için onay bildirimi oluşturulmalı.');
    assert.strictEqual(note.status, 'Beklemede');
    assert.strictEqual(note.trackingNo, res.data.trackingNo);
    notificationId = note.id;

    const pending = await api('/api/fault-notifications?status=Beklemede', {}, adminToken);
    assert.strictEqual(pending.status, 200);
    assert.ok(pending.data.some(n => n.id === notificationId));
  });

  test('2. Onay, red ve beklemeye alma kararları kaydedilir; arıza durumu değişmez', async () => {
    const decided = await api(`/api/fault-notifications/${notificationId}/decision`, {
      method: 'PATCH',
      body: { decision: 'Onaylandı', note: 'İş yapılmasına onay verildi.' },
    }, adminToken);
    assert.strictEqual(decided.status, 200);
    assert.strictEqual(decided.data.status, 'Onaylandı');
    assert.strictEqual(decided.data.note, 'İş yapılmasına onay verildi.');

    const fault = await api(`/api/faults/${faultId}`, {}, adminToken);
    assert.strictEqual(fault.status, 200);
    assert.strictEqual(fault.data.status, 'Açık', 'Karar arıza durumunu değiştirmemeli.');
    assert.strictEqual(fault.data.approvalStatus, 'Onaylandı');

    const rejected = await api(`/api/fault-notifications/${notificationId}/decision`, {
      method: 'PATCH',
      body: { decision: 'Reddedildi' },
    }, adminToken);
    assert.strictEqual(rejected.status, 200);
    assert.strictEqual(rejected.data.status, 'Reddedildi');

    const held = await api(`/api/fault-notifications/${notificationId}/decision`, {
      method: 'PATCH',
      body: { decision: 'Beklemeye Alındı' },
    }, adminToken);
    assert.strictEqual(held.status, 200);
    assert.strictEqual(held.data.status, 'Beklemeye Alındı');
    assert.strictEqual(held.data.note, 'İş yapılmasına onay verildi.', 'Not gönderilmezse mevcut not korunmalı.');
  });

  test('3. Geçersiz karar ve olmayan bildirim reddedilir', async () => {
    const invalid = await api(`/api/fault-notifications/${notificationId}/decision`, {
      method: 'PATCH',
      body: { decision: 'Geçersiz' },
    }, adminToken);
    assert.strictEqual(invalid.status, 400);

    const missing = await api('/api/fault-notifications/00000000-0000-4000-8000-000000000000/decision', {
      method: 'PATCH',
      body: { decision: 'Onaylandı' },
    }, adminToken);
    assert.strictEqual(missing.status, 404);
  });

  test('4. Teknisyen bildirimleri göremez ve karar veremez', async () => {
    const list = await api('/api/fault-notifications', {}, techToken);
    assert.strictEqual(list.status, 403);

    const decision = await api(`/api/fault-notifications/${notificationId}/decision`, {
      method: 'PATCH',
      body: { decision: 'Onaylandı' },
    }, techToken);
    assert.strictEqual(decision.status, 403);
  });

  test('5. Bildirim SSE olayı named event olarak yayınlanır', () => {
    const messages = [];
    const fakeClient = { write: msg => messages.push(msg) };
    syncService.clients.add(fakeClient);
    try {
      syncService.notifyNotification({ action: 'created', faultId });
    } finally {
      syncService.clients.delete(fakeClient);
    }
    assert.strictEqual(messages.length, 1);
    assert.match(messages[0], /^event: notification\n/);
    assert.match(messages[0], /"action":"created"/);
  });
});

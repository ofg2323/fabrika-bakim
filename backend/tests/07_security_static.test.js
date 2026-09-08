const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, API_BASE, getAdminToken } = require('./helpers');

describe('Modül 15: Güvenlik, PWA, Statik Dosyalar ve Bütünlük Testleri', () => {
  let adminToken;

  before(async () => {
    const auth = await getAdminToken();
    adminToken = auth.token;
  });

  test('Güvenlik başlıkları (Helmet) standartlara uygun olmalı', async () => {
    const res = await api('/', {}, false);
    assert.strictEqual(res.status, 200);

    // Helmet başlıkları
    assert.ok(res.headers.get('x-content-type-options'), 'X-Content-Type-Options olmalı');
    assert.ok(res.headers.get('content-security-policy'), 'Content-Security-Policy olmalı');
    const csp = res.headers.get('content-security-policy');
    assert.ok(!csp.includes("'unsafe-eval'"), "CSP 'unsafe-eval' İÇERMEMELİ");
    assert.ok(csp.includes("object-src 'none'"), "CSP object-src 'none' içermeli");
  });

  test('PWA Manifest dosyası 200 ve geçerli JSON dönmeli (/manifest.json)', async () => {
    const res = await api('/manifest.json', {}, false);
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.name);
    assert.ok(res.data.short_name);
    assert.ok(Array.isArray(res.data.icons));
    assert.ok(res.data.icons.length >= 2);
  });

  test('PWA Service Worker dosyası 200 dönmeli (/sw.js)', async () => {
    const res = await api('/sw.js', {}, false);
    assert.strictEqual(res.status, 200);
    assert.ok(typeof res.data === 'string');
    assert.ok(res.data.includes('self.addEventListener'));
  });

  test('PWA İkonları ve Favicon 200 OK ve ikili resim olarak dönmeli', async () => {
    const icon192 = await fetch(`${API_BASE}/icon-192.png`);
    assert.strictEqual(icon192.status, 200);
    assert.ok(icon192.headers.get('content-type').includes('image/png'));

    const icon512 = await fetch(`${API_BASE}/icon-512.png`);
    assert.strictEqual(icon512.status, 200);
    assert.ok(icon512.headers.get('content-type').includes('image/png'));

    const favicon = await fetch(`${API_BASE}/favicon.ico`);
    assert.strictEqual(favicon.status, 200);
  });

  test('Senkronizasyon ve istemci scriptleri 200 dönmeli', async () => {
    const syncRes = await api('/cmms-sync.js', {}, false);
    assert.strictEqual(syncRes.status, 200);
    assert.ok(syncRes.data.includes('CMMS') || syncRes.data.includes('window.CMMS'));

    const clientRes = await api('/api-client.js', {}, false);
    assert.strictEqual(clientRes.status, 200);
    assert.ok(clientRes.data.includes('CMMS_API_BASE') || clientRes.data.includes('window.CMMS'));
  });

  test('Zararlı uzantılı dosya yükleme denemesi (.exe) engellenmeli', async () => {
    const faultRes = await api('/api/faults', {
      method: 'POST',
      body: {
        assetId: (await api('/api/assets', {}, adminToken)).data[0]?.id,
        title: 'Dosya testi arızası',
      },
    }, adminToken);

    if (!faultRes.data?.id) return;
    const faultId = faultRes.data.id;

    // .exe dosyası yüklemeyi dene
    const formData = new FormData();
    const blob = new Blob(['BINARY_PAYLOAD_EXE'], { type: 'application/x-msdownload' });
    formData.append('file', blob, 'malware.exe');

    const uploadRes = await fetch(`${API_BASE}/api/faults/${faultId}/attachments`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: formData,
    });

    assert.strictEqual(uploadRes.status, 400);
    const errData = await uploadRes.json();
    assert.ok(errData.error);
  });

  test('Geçersiz dosya imzası (magic bytes) taşıyan sahte PDF yüklemesi engellenmeli', async () => {
    const faultRes = await api('/api/faults', {
      method: 'POST',
      body: {
        assetId: (await api('/api/assets', {}, adminToken)).data[0]?.id,
        title: 'Magic bytes test arızası',
      },
    }, adminToken);

    if (!faultRes.data?.id) return;
    const faultId = faultRes.data.id;

    // Uzantısı .pdf ama içeriği sahte/zararlı metin
    const formData = new FormData();
    const blob = new Blob(['BU_BIR_PDF_DEGILDIR_SAHTE_ICERIK'], { type: 'application/pdf' });
    formData.append('file', blob, 'sahte_rapor.pdf');

    const uploadRes = await fetch(`${API_BASE}/api/faults/${faultId}/attachments`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: formData,
    });

    assert.strictEqual(uploadRes.status, 400);
    const errData = await uploadRes.json();
    assert.ok(errData.error);
    assert.ok(errData.error.includes('magic bytes') || errData.error.includes('içeriği'));
  });

  test('Oturum açmamış kullanıcıların /uploads altındaki özel belgelere erişimi 401 dönmeli', async () => {
    const unauthRes = await fetch(`${API_BASE}/uploads/gizli_rapor_test_123.pdf`);
    assert.strictEqual(unauthRes.status, 401);
  });
});

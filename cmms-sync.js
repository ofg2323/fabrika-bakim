/**
 * Fabrika Bakım Yönetimi (CMMS) — API Senkronizasyon ve Entegrasyon Katmanı
 * Bu modül, fabrika-bakim.html arayüzünü Express + PostgreSQL REST API'sine bağlar.
 */

(function(window) {
  const API = window.CMMS_API;
  if (!API) {
    console.error('CMMS_API bulunamadı. api-client.js dosyasının yüklendiğinden emin olun.');
    return;
  }

  const esc = window.esc || function(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  };
  const todayStr = window.todayStr || function() { return new Date().toISOString().slice(0, 10); };
  const uid = window.uid || function(p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  const isUuid = function(id) {
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  };
  window.safeUrl = function(u) {
    if (!u) return '';
    const s = String(u).trim();
    return /^(https?:\/\/|\/|blob:)/i.test(s) ? s : '#';
  };

  // Modern Toast Bildirim Sistemi
  window.toast = {
    show(message, type = 'info', duration = 3500) {
      let container = document.getElementById('toastContainer');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        document.body.appendChild(container);
      }
      const icons = { success: '✅', error: '⚠️', info: 'ℹ️' };
      const t = document.createElement('div');
      t.className = `toast t-${type}`;
      t.innerHTML = `
        <span class="t-icon">${icons[type] || 'ℹ️'}</span>
        <span class="t-msg">${esc(message)}</span>
        <button class="t-close" onclick="this.parentElement.remove()">✕</button>
      `;
      container.appendChild(t);
      requestAnimationFrame(() => t.classList.add('show'));
      setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 250);
      }, duration);
    },
    success(msg) { this.show(msg, 'success'); },
    error(msg) { this.show(msg, 'error', 4500); },
    info(msg) { this.show(msg, 'info'); }
  };

  // Oturum süresi dolduğunda
  window.onAuthExpired = function() {
    currentUser = null;
    window.toast.error('Oturum süreniz doldu. Lütfen tekrar giriş yapın.');
    render();
  };

  // 1. Veritabanını Backend API üzerinden yükleme
  window.loadDB = async function() {
    if (!API.getToken()) return;

    try {
      const [
        users,
        assetGroups,
        assets,
        suppliers,
        materials,
        stockMovs,
        needsRes,
        purchases,
        maints,
        faults,
        inspections,
        extMaints,
        projects,
        settings
      ] = await Promise.all([
        API.getUsers(),
        API.getAssetGroups(),
        API.getAssets(),
        API.getSuppliers(),
        API.getMaterials(),
        API.getStockMovements(),
        API.getNeedsList(true),
        API.getPurchases(),
        API.getMaintenanceRecords(),
        API.getFaults(),
        API.getInspections(),
        API.getExtMaintenance(),
        API.getProjects(),
        API.getSettings()
      ]);

      if (!window.db) {
        window.db = {
          users: [], assetGroups: [], assets: [], materials: [],
          maintenanceRecords: [], faults: [], inspectionRecords: [],
          extMaintRecords: [], purchases: [], needsList: [],
          stockMovements: [], suppliers: [], projects: [],
          counters: { fault: 0, maint: 0, inspection: 0, extmaint: 0, project: 0 },
          printTemplate: {}
        };
      }
      const targetDb = window.db;
      targetDb.users = (users || []).map(u => ({
        ...u,
        hasPassword: !!(u.hasPassword || u.has_password || u.passwordHash),
        passwordHash: (u.hasPassword || u.has_password || u.passwordHash) ? true : undefined
      }));
      targetDb.assetGroups = (assetGroups || []).filter(g => g && isUuid(g.id));
      targetDb.assets = (assets || []).filter(a => a && isUuid(a.id));
      targetDb.suppliers = (suppliers || []).filter(s => s && isUuid(s.id));
      targetDb.materials = (materials || []).filter(m => m && isUuid(m.id));
      targetDb.stockMovements = stockMovs || [];
      targetDb.needsList = (needsRes && needsRes.needs) || [];
      targetDb.purchases = purchases || [];
      targetDb.maintenanceRecords = maints || [];
      targetDb.faults = faults || [];
      targetDb.inspectionRecords = inspections || [];
      targetDb.extMaintRecords = extMaints || [];
      targetDb.projects = projects || [];
      targetDb.printTemplate = settings || {};
      targetDb.counters = targetDb.counters || { fault: 0, maint: 0, inspection: 0, extmaint: 0, project: 0 };

      // Sayaçları senkronize et
      syncCounters();

    } catch (err) {
      console.error('Veri yükleme hatası:', err);
      if (err.message && err.message.includes('401')) {
        onAuthExpired();
      } else {
        window.toast.error('Veriler sunucudan alınamadı: ' + err.message);
      }
    }
  };

  function syncCounters() {
    const targetDb = window.db;
    if (!targetDb) return;
    targetDb.counters = targetDb.counters || { fault: 0, maint: 0, inspection: 0, extmaint: 0, project: 0 };
    if (targetDb.faults && targetDb.faults.length) {
      const fNums = targetDb.faults.map(f => parseInt((f.trackingNo || '').replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
      if (fNums.length) targetDb.counters.fault = Math.max(targetDb.counters.fault || 0, ...fNums);
    }
    if (targetDb.maintenanceRecords && targetDb.maintenanceRecords.length) {
      const mNums = targetDb.maintenanceRecords.map(m => parseInt((m.trackingNo || '').replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
      if (mNums.length) targetDb.counters.maint = Math.max(targetDb.counters.maint || 0, ...mNums);
    }
    if (targetDb.inspectionRecords && targetDb.inspectionRecords.length) {
      const iNums = targetDb.inspectionRecords.map(i => parseInt((i.trackingNo || '').replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
      if (iNums.length) targetDb.counters.inspection = Math.max(targetDb.counters.inspection || 0, ...iNums);
    }
    if (targetDb.extMaintRecords && targetDb.extMaintRecords.length) {
      const eNums = targetDb.extMaintRecords.map(e => parseInt((e.trackingNo || '').replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
      if (eNums.length) targetDb.counters.extmaint = Math.max(targetDb.counters.extmaint || 0, ...eNums);
    }
    if (targetDb.projects && targetDb.projects.length) {
      const pNums = targetDb.projects.map(p => parseInt((p.trackingNo || '').replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
      if (pNums.length) targetDb.counters.project = Math.max(targetDb.counters.project || 0, ...pNums);
    }
  }

  window.reloadUsers = async function() {
    try {
      const users = await API.getUsers();
      if (window.db) {
        window.db.users = (users || []).map(u => ({
          ...u,
          hasPassword: !!(u.hasPassword || u.has_password || u.passwordHash),
          passwordHash: (u.hasPassword || u.has_password || u.passwordHash) ? true : undefined
        }));
      }
    } catch (e) { console.error('reloadUsers error:', e); }
  };

  window.reloadAssetGroups = async function() {
    try {
      const groups = await API.getAssetGroups();
      if (window.db) window.db.assetGroups = (groups || []).filter(g => g && isUuid(g.id));
    } catch (e) { console.error('reloadAssetGroups error:', e); }
  };

  window.reloadAssets = async function() {
    try {
      const [assets, groups] = await Promise.all([API.getAssets(), API.getAssetGroups()]);
      if (window.db) {
        window.db.assets = (assets || []).filter(a => a && isUuid(a.id));
        window.db.assetGroups = (groups || []).filter(g => g && isUuid(g.id));
      }
    } catch (e) { console.error('reloadAssets error:', e); }
  };

  window.reloadSuppliers = async function() {
    try {
      const suppliers = await API.getSuppliers();
      if (window.db) window.db.suppliers = (suppliers || []).filter(s => s && isUuid(s.id));
    } catch (e) { console.error('reloadSuppliers error:', e); }
  };

  window.reloadMaterials = async function() {
    try {
      const [materials, movs] = await Promise.all([API.getMaterials(), API.getStockMovements()]);
      if (window.db) {
        window.db.materials = (materials || []).filter(m => m && isUuid(m.id));
        window.db.stockMovements = movs || [];
      }
    } catch (e) { console.error('reloadMaterials error:', e); }
  };

  window.reloadNeeds = async function() {
    try {
      const res = await API.getNeedsList(true);
      if (window.db) window.db.needsList = (res && res.needs) || [];
    } catch (e) { console.error('reloadNeeds error:', e); }
  };

  window.reloadPurchases = async function() {
    try {
      const [purchases, materials, movs, needsRes] = await Promise.all([
        API.getPurchases(),
        API.getMaterials(),
        API.getStockMovements(),
        API.getNeedsList(true)
      ]);
      if (window.db) {
        window.db.purchases = purchases || [];
        window.db.materials = (materials || []).filter(m => m && isUuid(m.id));
        window.db.stockMovements = movs || [];
        window.db.needsList = (needsRes && needsRes.needs) || [];
      }
    } catch (e) { console.error('reloadPurchases error:', e); }
  };

  window.reloadMaintenance = async function() {
    try {
      const [maints, materials, movs] = await Promise.all([
        API.getMaintenanceRecords(),
        API.getMaterials(),
        API.getStockMovements()
      ]);
      if (window.db) {
        window.db.maintenanceRecords = maints || [];
        window.db.materials = (materials || []).filter(m => m && isUuid(m.id));
        window.db.stockMovements = movs || [];
        syncCounters();
      }
    } catch (e) { console.error('reloadMaintenance error:', e); }
  };

  window.reloadFaults = async function() {
    try {
      const [faults, materials, movs] = await Promise.all([
        API.getFaults(),
        API.getMaterials(),
        API.getStockMovements()
      ]);
      if (window.db) {
        window.db.faults = faults || [];
        window.db.materials = (materials || []).filter(m => m && isUuid(m.id));
        window.db.stockMovements = movs || [];
        syncCounters();
      }
    } catch (e) { console.error('reloadFaults error:', e); }
  };

  window.reloadInspections = async function() {
    try {
      const inspections = await API.getInspections();
      if (window.db) {
        window.db.inspectionRecords = inspections || [];
        syncCounters();
      }
    } catch (e) { console.error('reloadInspections error:', e); }
  };

  window.reloadExtMaintenance = async function() {
    try {
      const extMaints = await API.getExtMaintenance();
      if (window.db) {
        window.db.extMaintRecords = extMaints || [];
        syncCounters();
      }
    } catch (e) { console.error('reloadExtMaintenance error:', e); }
  };

  window.reloadProjects = async function() {
    try {
      const projects = await API.getProjects();
      if (window.db) {
        window.db.projects = projects || [];
        syncCounters();
      }
    } catch (e) { console.error('reloadProjects error:', e); }
  };

  window.saveDB = async function() {
    // API her işlemi anında kaydettiği için saveDB no-op
  };

  // 2. Uygulama Başlatma (Boot)
  window.boot = async function() {
    const savedUser = API.getCurrentUser();
    const token = API.getToken();

    if (savedUser && token) {
      currentUser = savedUser;
      try {
        await loadDB();
        render();
        return;
      } catch (e) {
        console.warn('Kayıtlı oturum geçersiz, giriş ekranına yönlendiriliyor.');
        API.logout();
      }
    }

    try {
      const users = await API.getAuthUsers();
      if (!users || users.length === 0) {
        renderFirstUserScreen();
      } else {
        renderLogin();
      }
    } catch (err) {
      console.error('Kullanıcı listesi alınamadı:', err);
      renderLogin();
    }
  };

  // 3. Giriş & Kimlik Doğrulama
  function renderFirstUserScreen() {
    const root = document.getElementById('root');
    root.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="stripe"></div>
          <h2>Fabrika Bakım Yönetimi</h2>
          <p>Sisteme başlamak için ilk <b>Yönetici</b> hesabınızı oluşturun.</p>
          <div class="field"><label class="f-label" for="fu-name">Yönetici Adı Soyadı</label><input id="fu-name" type="text" style="width:100%;"></div>
          <div class="field" style="margin-top:10px;"><label class="f-label" for="fu-pw">Şifre</label><input id="fu-pw" type="password" style="width:100%;"></div>
          <button class="primary" style="margin-top:16px; width:100%;" onclick="createFirstUser()">Yönetici Olarak Başla</button>
        </div>
      </div>
    `;
    const inp = document.getElementById('fu-name');
    if (inp) inp.focus();
  }

  window.renderLogin = async function() {
    let authUsers = [];
    try {
      authUsers = await API.getAuthUsers();
    } catch (e) {
      console.warn('Kullanıcılar alınamadı:', e);
    }

    if (!authUsers || authUsers.length === 0) {
      renderFirstUserScreen();
      return;
    }

    const root = document.getElementById('root');
    root.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="stripe"></div>
          <h2>Fabrika Bakım Yönetimi</h2>
          <p>Devam etmek için hesabınızı seçin</p>
          <div class="userpick">
            ${authUsers.map(u => `
              <button onclick="showPasswordPrompt('${u.id}', '${esc(u.name)}', '${esc(u.role)}')">
                <span>${esc(u.name)}</span>
                <span class="r">${esc(u.role)}</span>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  };

  window.showPasswordPrompt = function(id, name, role) {
    const root = document.getElementById('root');
    root.querySelector('.login-card').innerHTML = `
      <div class="stripe"></div>
      <h2>${esc(name)}</h2>
      <p class="muted" style="margin-bottom:14px;">${esc(role)} — Giriş şifrenizi girin</p>
      <div class="field">
        <label class="f-label" for="login-pw">Şifre</label>
        <input id="login-pw" type="password" style="width:100%;" placeholder="Şifreniz...">
      </div>
      <div id="login-err" style="color:var(--danger); font-size:12px; margin-top:8px; min-height:16px;"></div>
      <div style="margin-top:14px; display:flex; gap:8px;">
        <button class="primary" onclick="attemptLogin('${id}')">Giriş Yap</button>
        <button class="ghost" onclick="renderLogin()">Geri</button>
      </div>
    `;
    const pwEl = document.getElementById('login-pw');
    if (pwEl) {
      pwEl.focus();
      pwEl.addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(id); });
    }
  };

  window.attemptLogin = async function(id) {
    const pw = document.getElementById('login-pw').value;
    const errEl = document.getElementById('login-err');
    if (errEl) errEl.textContent = '';

    try {
      const res = await API.login(id, pw);
      API.setToken(res.token);
      API.setCurrentUser(res.user);
      currentUser = res.user;
      currentTab = 'panel';

      const root = document.getElementById('root');
      root.innerHTML = '<div class="login-wrap"><div class="login-card"><div class="stripe"></div><p>Veriler yükleniyor...</p></div></div>';

      await loadDB();
      render();
    } catch (err) {
      if (errEl) errEl.textContent = err.message || 'Giriş başarısız.';
    }
  };

  window.createFirstUser = async function() {
    const name = document.getElementById('fu-name').value.trim();
    const pw = document.getElementById('fu-pw').value;
    if (!name || !pw) {
      window.toast.error('Ad soyad ve şifre gereklidir.');
      return;
    }

    try {
      const res = await API.createFirstAdmin(name, pw);
      API.setToken(res.token);
      API.setCurrentUser(res.user);
      currentUser = res.user;
      currentTab = 'panel';

      await loadDB();
      render();
    } catch (err) {
      window.toast.error('Kayıt başarısız: ' + err.message);
    }
  };

  window.logout = function() {
    API.logout();
    currentUser = null;
    renderLogin();
  };

  // 4. Varlıklar (Assets) Entegrasyonu
  window.saveAsset = async function(id) {
    const nameEl = document.getElementById('m-name');
    if (!nameEl) return;
    const name = nameEl.value.trim();
    if (!name) { window.toast.error('Varlık adı zorunludur.'); return; }

    const assetCode = (document.getElementById('m-code')?.value || '').trim() || null;
    const serial = (document.getElementById('m-serial')?.value || '').trim() || null;
    const brand = (document.getElementById('m-brand')?.value || '').trim() || null;
    const model = (document.getElementById('m-model')?.value || '').trim() || null;
    const capacity = (document.getElementById('m-capacity')?.value || '').trim() || null;
    const description = (document.getElementById('m-desc')?.value || '').trim() || null;
    const groupVal = document.getElementById('m-group')?.value;
    const parentVal = document.getElementById('m-parent')?.value;
    const groupId = isUuid(groupVal) ? groupVal : null;
    const parentId = isUuid(parentVal) ? parentVal : null;
    const location = (document.getElementById('m-loc')?.value || '').trim() || null;
    const status = document.getElementById('m-status')?.value || 'Aktif';
    const lastMaintenanceDate = document.getElementById('m-last')?.value || null;

    const payload = {
      name,
      assetCode,
      serial,
      brand,
      model,
      capacity,
      description,
      groupId,
      parentId,
      location,
      status,
      lastMaintenanceDate
    };

    try {
      const isExisting = id && isUuid(id);
      if (isExisting) {
        await API.updateAsset(id, payload);
      } else {
        await API.createAsset(payload);
      }

      await reloadAssets();
      closeModal();
      renderTab();
      window.toast.success(isExisting ? 'Varlık güncellendi.' : 'Yeni varlık başarıyla kaydedildi.');
    } catch (err) {
      window.toast.error('Varlık kaydedilemedi: ' + err.message);
    }
  };

  window.deleteAsset = function(id) {
    confirmDelete('Bu varlığı silmek istediğinize emin misiniz? Bağlı bakım, muayene ve arıza kayıtları da silinecektir.', async () => {
      try {
        if (id && isUuid(id)) {
          await API.deleteAsset(id);
        } else if (window.db && window.db.assets) {
          window.db.assets = window.db.assets.filter(a => a.id !== id);
        }
        await reloadAssets();
        await reloadMaintenance();
        await reloadFaults();
        await reloadInspections();
        renderTab();
        window.toast.success('Varlık silindi.');
      } catch (err) {
        window.toast.error('Silme başarısız: ' + err.message);
      }
    });
  };

  window.saveSpareParts = async function(assetId) {
    if (!assetId || !isUuid(assetId)) {
      window.toast.error('Geçersiz varlık kimliği. Önce varlığı kaydedin.');
      return;
    }
    try {
      const validMaterialIds = (tempSpareParts || []).filter(isUuid);
      await API.saveAssetSpareParts(assetId, validMaterialIds);
      await reloadAssets();
      closeModal();
      renderTab();
      window.toast.success('Yedek parçalar güncellendi.');
    } catch (err) {
      window.toast.error('Yedek parçalar kaydedilemedi: ' + err.message);
    }
  };

  // 5. Varlık Grupları (Asset Groups) Entegrasyonu
  window.saveGroup = async function(id) {
    const nameEl = document.getElementById('m-gname');
    if (!nameEl) return;
    const name = nameEl.value.trim();
    if (!name) { window.toast.error('Grup adı zorunludur.'); return; }

    const periodDays = parseInt(document.getElementById('m-period')?.value, 10) || 30;
    const inspEnabled = document.getElementById('m-inspect-enabled')?.checked || false;
    const inspDays = inspEnabled ? (parseInt(document.getElementById('m-inspect-period')?.value, 10) || 365) : null;
    const inspBase = inspEnabled ? (document.getElementById('m-inspect-baseline')?.value || null) : null;
    const extEnabled = document.getElementById('m-extmaint-enabled')?.checked || false;
    const extDays = extEnabled ? (parseInt(document.getElementById('m-extmaint-period')?.value, 10) || 365) : null;
    const extBase = extEnabled ? (document.getElementById('m-extmaint-baseline')?.value || null) : null;

    const payload = {
      name,
      periodDays,
      inspectionEnabled: inspEnabled,
      inspectionPeriodDays: inspDays,
      inspectionBaselineDate: inspBase,
      extMaintEnabled: extEnabled,
      extMaintPeriodDays: extDays,
      extMaintBaselineDate: extBase,
      checklist: (tempChecklist || []).filter(q => q.text && q.text.trim()).map(q => ({ id: q.id, text: q.text.trim() })),
    };

    try {
      if (id) {
        await API.updateAssetGroup(id, payload);
      } else {
        await API.createAssetGroup(payload);
      }
      await reloadAssetGroups();
      closeModal();
      renderTab();
      window.toast.success(id ? 'Varlık grubu güncellendi.' : 'Yeni grup kaydedildi.');
    } catch (err) {
      window.toast.error('Grup kaydedilemedi: ' + err.message);
    }
  };
  window.saveAssetGroup = window.saveGroup;

  window.deleteGroup = function(id) {
    const asCount = ((window.db && window.db.assets) || []).filter(a => a.groupId === id).length;
    if (asCount > 0) {
      window.toast.error(`Bu gruba bağlı ${asCount} varlık var. Önce varlıkları başka bir gruba taşıyın veya silin.`);
      return;
    }
    confirmDelete('Bu varlık grubunu silmek istediğinize emin misiniz?', async () => {
      try {
        await API.deleteAssetGroup(id);
        await reloadAssetGroups();
        renderTab();
        window.toast.success('Grup silindi.');
      } catch (err) {
        window.toast.error('Grup silinemedi: ' + err.message);
      }
    });
  };
  window.deleteAssetGroup = window.deleteGroup;

  // 6. Malzemeler & Stok (Materials & Stock) Entegrasyonu
  window.saveMaterial = async function(id) {
    const nameEl = document.getElementById('m-mname');
    if (!nameEl) return;
    const name = nameEl.value.trim();
    if (!name) { window.toast.error('Malzeme adı zorunludur.'); return; }

    const payload = {
      name,
      unit: (document.getElementById('m-munit')?.value || 'adet').trim(),
      qty: parseFloat(document.getElementById('m-mqty')?.value) || 0,
      minQty: parseFloat(document.getElementById('m-mmin')?.value) || 0,
      unitCost: parseFloat(document.getElementById('m-mcost')?.value) || 0,
      defaultSupplierId: document.getElementById('m-mdefsupplier')?.value || null,
    };

    try {
      if (id) {
        await API.updateMaterial(id, payload);
      } else {
        await API.createMaterial(payload);
      }
      await reloadMaterials();
      closeModal();
      renderTab();
      window.toast.success(id ? 'Malzeme güncellendi.' : 'Yeni malzeme kaydedildi.');
    } catch (err) {
      window.toast.error('Malzeme kaydedilemedi: ' + err.message);
    }
  };

  window.deleteMaterial = function(id) {
    confirmDelete('Bu malzemeyi silmek istediğinize emin misiniz?', async () => {
      try {
        await API.deleteMaterial(id);
        await reloadMaterials();
        renderTab();
        window.toast.success('Malzeme silindi.');
      } catch (err) {
        window.toast.error('Malzeme silinemedi: ' + err.message);
      }
    });
  };

  window.saveStockAdjust = async function(materialId, type) {
    const qty = parseFloat(document.getElementById('m-adjqty')?.value);
    const reason = (document.getElementById('m-adjreason')?.value || '').trim();
    if (!qty || qty <= 0) { window.toast.error('Lütfen 0\'dan büyük bir miktar girin.'); return; }

    try {
      await API.adjustMaterialStock(materialId, type, qty, reason);
      await reloadMaterials();
      closeModal();
      renderTab();
      window.toast.success('Stok düzeltmesi uygulandı.');
    } catch (err) {
      window.toast.error('Stok düzeltmesi başarısız: ' + err.message);
    }
  };

  // 7. İhtiyaç Listesi (Needs List) Entegrasyonu
  window.saveNeed = async function() {
    const matId = document.getElementById('m-needmat')?.value || null;
    const nameInput = (document.getElementById('m-needname')?.value || '').trim();
    const finalName = matId ? (material(matId) ? material(matId).name : nameInput) : nameInput;
    const qty = parseFloat(document.getElementById('m-needqty')?.value) || 1;
    const estimatedPrice = parseFloat(document.getElementById('m-needprice')?.value) || 0;
    const supplierId = document.getElementById('m-needsupplier')?.value || null;
    const note = (document.getElementById('m-neednote')?.value || '').trim();

    if (!finalName) { window.toast.error('Malzeme seçmeli veya bir ad girmelisiniz.'); return; }

    const payload = {
      materialId: matId,
      name: finalName,
      qty,
      estimatedPrice,
      supplierId,
      note,
    };

    try {
      await API.createNeed(payload);
      await reloadNeeds();
      closeModal();
      renderTab();
      window.toast.success('İhtiyaç listesine eklendi.');
    } catch (err) {
      window.toast.error('İhtiyaç eklenemedi: ' + err.message);
    }
  };

  window.markNeedStatus = async function(id, newStatus) {
    try {
      await API.updateNeedStatus(id, newStatus);
      await reloadNeeds();
      renderTab();
      window.toast.success('İhtiyaç durumu güncellendi.');
    } catch (err) {
      window.toast.error('Durum güncellenemedi: ' + err.message);
    }
  };

  window.deleteNeed = function(id) {
    confirmDelete('Bu ihtiyaç kaydını silmek istediğinize emin misiniz?', async () => {
      try {
        await API.deleteNeed(id);
        await reloadNeeds();
        renderTab();
        window.toast.success('İhtiyaç kaydı silindi.');
      } catch (err) {
        window.toast.error('Silme başarısız: ' + err.message);
      }
    });
  };

  // 8. Tedarikçiler (Suppliers) Entegrasyonu
  window.saveSupplier = async function(id) {
    const nameEl = document.getElementById('m-supname');
    if (!nameEl) return;
    const name = nameEl.value.trim();
    if (!name) { window.toast.error('Tedarikçi adı zorunludur.'); return; }

    const payload = {
      name,
      contactPerson: (document.getElementById('m-supcontact')?.value || '').trim() || null,
      phone: (document.getElementById('m-supphone')?.value || '').trim() || null,
      email: (document.getElementById('m-supemail')?.value || '').trim() || null,
      paymentTerms: (document.getElementById('m-supterms')?.value || '').trim() || null,
      address: (document.getElementById('m-supaddress')?.value || '').trim() || null,
      notes: (document.getElementById('m-supnotes')?.value || '').trim() || null,
    };

    try {
      if (id) {
        await API.updateSupplier(id, payload);
      } else {
        await API.createSupplier(payload);
      }
      await reloadSuppliers();
      closeModal();
      renderTab();
      window.toast.success(id ? 'Tedarikçi güncellendi.' : 'Yeni tedarikçi eklendi.');
    } catch (err) {
      window.toast.error('Tedarikçi kaydedilemedi: ' + err.message);
    }
  };

  window.deleteSupplier = function(id) {
    confirmDelete('Bu tedarikçiyi silmek istediğinize emin misiniz? Geçmiş satın alma kayıtları etkilenmez.', async () => {
      try {
        await API.deleteSupplier(id);
        await reloadSuppliers();
        renderTab();
        window.toast.success('Tedarikçi silindi.');
      } catch (err) {
        window.toast.error('Tedarikçi silinemedi: ' + err.message);
      }
    });
  };

  // 9. Satın Alma (Purchases) Entegrasyonu
  window.savePurchase = async function(needId, editId) {
    const materialId = document.getElementById('m-pmat')?.value;
    const qty = parseFloat(document.getElementById('m-pqty')?.value) || 0;
    const unitPrice = parseFloat(document.getElementById('m-pprice')?.value) || 0;
    if (qty <= 0) { window.toast.error('Lütfen geçerli bir miktar girin.'); return; }

    const supplierId = document.getElementById('m-psupplierid')?.value || null;
    const supplierText = (document.getElementById('m-psupplier')?.value || '').trim();
    const projectId = document.getElementById('m-pproject')?.value || null;
    const note = (document.getElementById('m-pnote')?.value || '').trim();

    const payload = {
      materialId,
      qty,
      unitPrice,
      supplierId,
      supplierText,
      projectId,
      note,
      needId: needId || null,
    };

    try {
      if (editId) {
        await API.updatePurchase(editId, payload);
      } else {
        await API.createPurchase(payload);
      }
      await reloadPurchases();
      await reloadNeeds();
      closeModal();
      renderTab();
      window.toast.success(editId ? 'Satın alma güncellendi.' : 'Satın alma işlendi ve stok artırıldı.');
    } catch (err) {
      window.toast.error('Satın alma kaydedilemedi: ' + err.message);
    }
  };

  window.deletePurchase = function(id) {
    confirmDelete('Bu satın alma kaydını silmek istediğinize emin misiniz? (Eklenen stok geri düşülecektir)', async () => {
      try {
        await API.deletePurchase(id);
        await reloadPurchases();
        await reloadNeeds();
        renderTab();
        window.toast.success('Satın alma kaydı silindi.');
      } catch (err) {
        window.toast.error('Silme başarısız: ' + err.message);
      }
    });
  };

  // 10. Bakım Kayıtları (Maintenance) Entegrasyonu
  window.saveMaintForm = async function(recordId) {
    const assetId = document.getElementById('m-maintasset')?.value;
    if (!assetId) { window.toast.error('Varlık seçilmelidir.'); return; }

    const type = document.getElementById('m-mainttype')?.value || 'Periyodik';
    const startDate = document.getElementById('m-startdate')?.value || todayStr();
    const endDate = document.getElementById('m-enddate')?.value || todayStr();
    const notes = (document.getElementById('m-maintnotes')?.value || '').trim();

    const payload = {
      assetId,
      type,
      startDate,
      endDate,
      notes,
      checklist: tempChecklistResults || [],
      usedMaterials: (tempUsedMaterials || []).filter(m => m.qty > 0),
    };

    try {
      if (recordId) {
        await API.updateMaintenanceRecord(recordId, payload);
      } else {
        await API.createMaintenanceRecord(payload);
      }
      await reloadMaintenance();
      closeModal();
      renderTab();
      window.toast.success(recordId ? 'Bakım güncellendi.' : 'Bakım başarıyla tamamlandı ve kaydedildi.');
    } catch (err) {
      window.toast.error('Bakım kaydedilemedi: ' + err.message);
    }
  };
  window.saveMaintenance = window.saveMaintForm;

  window.deleteMaintenance = function(id) {
    confirmDelete('Bu bakım kaydını silmek istediğinize emin misiniz? (Kullanılan malzemeler stoka iade edilir)', async () => {
      try {
        await API.deleteMaintenanceRecord(id);
        await reloadMaintenance();
        renderTab();
        window.toast.success('Bakım kaydı silindi.');
      } catch (err) {
        window.toast.error('Silme başarısız: ' + err.message);
      }
    });
  };

  // 11. Arızalar (Faults) Entegrasyonu
  window.saveFault = async function() {
    const title = (document.getElementById('m-ftitle')?.value || '').trim();
    const assetId = document.getElementById('m-fasset')?.value;
    if (!title || !assetId) { window.toast.error('Başlık ve varlık seçimi zorunludur.'); return; }

    const description = (document.getElementById('m-fdesc')?.value || '').trim();
    const priority = document.getElementById('m-fprio')?.value || 'Orta';
    const assignedUserId = document.getElementById('m-fassignee')?.value || null;

    try {
      const created = await API.createFault({
        assetId,
        title,
        description,
        priority,
        assignedUserId,
      });

      // Varsa ekleri yükle
      if (window.tempCertificates && window.tempCertificates.length > 0) {
        for (const c of window.tempCertificates) {
          if (c.kind === 'link') {
            await API.addFaultAttachment(created.id, { name: c.name, kind: 'link', url: c.url });
          } else if (c.file) {
            await API.uploadFaultAttachment(created.id, c.file, c.name);
          }
        }
      }

      await reloadFaults();
      closeModal();
      renderTab();
      window.toast.success('Arıza bildirimi oluşturuldu.');
    } catch (err) {
      window.toast.error('Arıza kaydedilemedi: ' + err.message);
    }
  };

  window.saveFaultDetail = async function(id) {
    const newStatus = document.getElementById('m-fstatus')?.value || 'Açık';
    const description = (document.getElementById('m-fdesc')?.value || '').trim();
    const techSolution = (document.getElementById('m-ftechsolution')?.value || '').trim();
    const priority = document.getElementById('m-fprio')?.value || 'Orta';
    const assignedUserId = document.getElementById('m-fassignee')?.value || null;
    const resolvedDate = newStatus === 'Tamamlandı' ? (document.getElementById('m-fresolveddate')?.value || todayStr()) : null;

    const usedMaterials = (tempUsedMaterials || []).filter(m => m.qty > 0).map(u => ({
      materialId: u.materialId,
      qty: u.qty,
    }));

    try {
      await API.updateFault(id, {
        status: newStatus,
        description,
        techSolution,
        priority,
        assignedUserId,
        resolvedDate,
        usedMaterials,
      });

      // Sertifika/Ek silme
      if (window.certsToDelete && window.certsToDelete.length > 0) {
        for (const certId of window.certsToDelete) {
          try { await API.deleteFaultAttachment(id, certId); } catch (e) {}
        }
      }

      // Yeni ekleri yükle
      if (window.tempCertificates && window.tempCertificates.length > 0) {
        for (const c of window.tempCertificates) {
          if (c.isNew) {
            if (c.kind === 'link') {
              await API.addFaultAttachment(id, { name: c.name, kind: 'link', url: c.url });
            } else if (c.file) {
              await API.uploadFaultAttachment(id, c.file, c.name);
            }
          }
        }
      }

      await reloadFaults();
      closeModal();
      renderTab();
      window.toast.success('Arıza detayları güncellendi.');
    } catch (err) {
      window.toast.error('Arıza güncellenemedi: ' + err.message);
    }
  };

  window.deleteFault = function(id) {
    confirmDelete('Bu arıza kaydını silmek istediğinize emin misiniz? (Kullanılan malzemeler stoka iade edilir)', async () => {
      try {
        await API.deleteFault(id);
        await reloadFaults();
        renderTab();
        window.toast.success('Arıza kaydı silindi.');
      } catch (err) {
        window.toast.error('Silme başarısız: ' + err.message);
      }
    });
  };

  // 12. Muayene (Inspections) Entegrasyonu
  window.saveInspectionForm = async function(recordId) {
    const groupId = document.getElementById('m-inspgroup')?.value;
    const assetIds = [...(window.tempInspectionAssetIds || [])];
    if (!assetIds.length) { window.toast.error('En az bir varlık seçmelisiniz.'); return; }

    const contractor = (document.getElementById('m-inspcontractor')?.value || '').trim();
    const startDate = document.getElementById('m-inspstart')?.value || todayStr();
    const endDate = document.getElementById('m-inspend')?.value || todayStr();
    const notes = (document.getElementById('m-inspnote')?.value || '').trim();
    const serviceCost = parseFloat(document.getElementById('m-inspcost')?.value) || 0;

    const payload = {
      groupId,
      contractor,
      startDate,
      endDate,
      notes,
      serviceCost,
      assetIds,
    };

    try {
      let recId = recordId;
      if (recordId) {
        await API.updateInspection(recordId, payload);
      } else {
        const created = await API.createInspection(payload);
        recId = created.id;
      }

      // Silinecek belgeler
      if (window.certsToDelete && window.certsToDelete.length > 0) {
        for (const certId of window.certsToDelete) {
          try { await API.deleteInspectionCertificate(recId, certId); } catch (e) {}
        }
      }

      // Yeni belgeler
      if (window.tempCertificates && window.tempCertificates.length > 0) {
        for (const c of window.tempCertificates) {
          if (c.isNew) {
            if (c.kind === 'link') {
              await API.addInspectionCertificate(recId, { name: c.name, kind: 'link', url: c.url });
            } else if (c.file) {
              await API.uploadInspectionCertificate(recId, c.file, c.name);
            }
          }
        }
      }

      await reloadInspections();
      closeModal();
      renderTab();
      window.toast.success(recordId ? 'Muayene güncellendi.' : 'Muayene kaydı oluşturuldu.');
    } catch (err) {
      window.toast.error('Muayene kaydedilemedi: ' + err.message);
    }
  };

  window.deleteInspection = function(id) {
    confirmDelete('Bu muayene kaydını silmek istediğinize emin misiniz?', async () => {
      try {
        await API.deleteInspection(id);
        await reloadInspections();
        renderTab();
        window.toast.success('Muayene kaydı silindi.');
      } catch (err) {
        window.toast.error('Silme başarısız: ' + err.message);
      }
    });
  };

  // 13. Dış Bakım (External Maintenance) Entegrasyonu
  window.saveExtMaintForm = async function(recordId) {
    const groupId = document.getElementById('m-extgroup')?.value;
    const assetIds = [...(window.tempExtMaintAssetIds || [])];
    if (!assetIds.length) { window.toast.error('En az bir varlık seçmelisiniz.'); return; }

    const contractor = (document.getElementById('m-extcontractor')?.value || '').trim();
    const startDate = document.getElementById('m-extstart')?.value || todayStr();
    const endDate = document.getElementById('m-extend')?.value || todayStr();
    const notes = (document.getElementById('m-extnote')?.value || '').trim();
    const serviceCost = parseFloat(document.getElementById('m-extcost')?.value) || 0;

    const payload = {
      groupId,
      contractor,
      startDate,
      endDate,
      notes,
      serviceCost,
      assetIds,
    };

    try {
      let recId = recordId;
      if (recordId) {
        await API.updateExtMaintenance(recordId, payload);
      } else {
        const created = await API.createExtMaintenance(payload);
        recId = created.id;
      }

      // Silinecek belgeler
      if (window.certsToDelete && window.certsToDelete.length > 0) {
        for (const certId of window.certsToDelete) {
          try { await API.deleteExtMaintCertificate(recId, certId); } catch (e) {}
        }
      }

      // Yeni belgeler
      if (window.tempCertificates && window.tempCertificates.length > 0) {
        for (const c of window.tempCertificates) {
          if (c.isNew) {
            if (c.kind === 'link') {
              await API.addExtMaintCertificate(recId, { name: c.name, kind: 'link', url: c.url });
            } else if (c.file) {
              await API.uploadExtMaintCertificate(recId, c.file, c.name);
            }
          }
        }
      }

      await reloadExtMaintenance();
      closeModal();
      renderTab();
      window.toast.success(recordId ? 'Dış bakım güncellendi.' : 'Dış bakım kaydı oluşturuldu.');
    } catch (err) {
      window.toast.error('Dış bakım kaydedilemedi: ' + err.message);
    }
  };

  window.deleteExtMaint = function(id) {
    confirmDelete('Bu dış bakım kaydını silmek istediğinize emin misiniz?', async () => {
      try {
        await API.deleteExtMaintenance(id);
        await reloadExtMaintenance();
        renderTab();
        window.toast.success('Dış bakım kaydı silindi.');
      } catch (err) {
        window.toast.error('Silme başarısız: ' + err.message);
      }
    });
  };

  // 14. Projeler (Projects) Entegrasyonu
  window.saveProjectForm = async function(id) {
    const nameEl = document.getElementById('m-projname');
    if (!nameEl) return;
    const name = nameEl.value.trim();
    if (!name) { window.toast.error('Proje adı zorunludur.'); return; }

    const description = (document.getElementById('m-projdesc')?.value || '').trim();
    const ownerUserId = document.getElementById('m-projowner')?.value || null;
    const priority = document.getElementById('m-projprio')?.value || 'Orta';
    const status = document.getElementById('m-projstatus')?.value || 'Planlama';
    const startDate = document.getElementById('m-projstart')?.value || null;
    const targetEndDate = document.getElementById('m-projend')?.value || null;
    const budget = parseFloat(document.getElementById('m-projbudget')?.value) || 0;

    const payload = {
      name,
      description,
      ownerUserId,
      priority,
      status,
      startDate,
      targetEndDate,
      budget,
    };

    try {
      if (id) {
        await API.updateProject(id, payload);
      } else {
        await API.createProject(payload);
      }
      await reloadProjects();
      closeModal();
      renderTab();
      window.toast.success(id ? 'Proje güncellendi.' : 'Yeni proje oluşturuldu.');
    } catch (err) {
      window.toast.error('Proje kaydedilemedi: ' + err.message);
    }
  };
  window.saveProject = window.saveProjectForm;

  window.deleteProject = function(id) {
    confirmDelete('Bu projeyi silmek istediğinize emin misiniz? (Satın alma kayıtları silinmez, bağlantısı kaldırılır)', async () => {
      try {
        await API.deleteProject(id);
        await reloadProjects();
        currentProjectId = null;
        renderTab();
        window.toast.success('Proje silindi.');
      } catch (err) {
        window.toast.error('Silme başarısız: ' + err.message);
      }
    });
  };

  window.saveTaskForm = async function(projectId, taskId) {
    const title = (document.getElementById('m-taskname')?.value || '').trim();
    if (!title) { window.toast.error('Görev başlığı zorunludur.'); return; }

    const assignType = document.getElementById('m-tasktype')?.value || 'İç';
    const assignee = (document.getElementById('m-taskassignee')?.value || '').trim();
    const status = document.getElementById('m-taskstatus')?.value || 'Beklemede';
    const cost = parseFloat(document.getElementById('m-taskcost')?.value) || 0;
    const startDate = document.getElementById('m-taskstart')?.value || null;
    const dueDate = document.getElementById('m-taskdue')?.value || null;

    const payload = {
      title,
      assignType,
      assignee,
      status,
      cost,
      startDate,
      dueDate,
    };

    try {
      if (taskId) {
        await API.updateProjectTask(projectId, taskId, payload);
      } else {
        await API.createProjectTask(projectId, payload);
      }
      await reloadProjects();
      closeModal();
      renderTab();
      window.toast.success(taskId ? 'Görev güncellendi.' : 'Görev eklendi.');
    } catch (err) {
      window.toast.error('Görev kaydedilemedi: ' + err.message);
    }
  };

  window.deleteTask = function(projectId, taskId) {
    confirmDelete('Bu görevi silmek istediğinize emin misiniz?', async () => {
      try {
        await API.deleteProjectTask(projectId, taskId);
        await reloadProjects();
        renderTab();
        window.toast.success('Görev silindi.');
      } catch (err) {
        window.toast.error('Silme başarısız: ' + err.message);
      }
    });
  };

  window.saveQuoteForm = async function(projectId, quoteId) {
    const amount = parseFloat(document.getElementById('m-quoteamount')?.value) || 0;
    const supplierId = document.getElementById('m-quotesupplierid')?.value || null;
    const supplierName = (document.getElementById('m-quotesupname')?.value || '').trim();
    const date = document.getElementById('m-quotedate')?.value || todayStr();
    const validUntil = document.getElementById('m-quotevalid')?.value || null;
    const note = (document.getElementById('m-quotenote')?.value || '').trim();
    const fileInput = document.getElementById('m-quotefile');
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;

    try {
      if (quoteId) {
        await API.updateProjectQuote(projectId, quoteId, { amount, supplierId, supplierName, date, validUntil, note });
      } else {
        await API.createProjectQuote(projectId, { amount, supplierId, supplierName, date, validUntil, note }, file);
      }
      await reloadProjects();
      closeModal();
      renderTab();
      window.toast.success(quoteId ? 'Teklif güncellendi.' : 'Teklif eklendi.');
    } catch (err) {
      window.toast.error('Teklif kaydedilemedi: ' + err.message);
    }
  };

  window.deleteQuote = function(projectId, quoteId) {
    confirmDelete('Bu teklifi silmek istediğinize emin misiniz?', async () => {
      try {
        await API.deleteProjectQuote(projectId, quoteId);
        await reloadProjects();
        renderTab();
        window.toast.success('Teklif silindi.');
      } catch (err) {
        window.toast.error('Silme başarısız: ' + err.message);
      }
    });
  };

  window.saveProgressLog = async function(projectId) {
    const note = (document.getElementById('m-lognote')?.value || '').trim();
    if (!note) { window.toast.error('İlerleme notu zorunludur.'); return; }

    const date = document.getElementById('m-logdate')?.value || todayStr();

    try {
      await API.addProjectProgressLog(projectId, { date, note });
      await reloadProjects();
      closeModal();
      renderTab();
      window.toast.success('İlerleme notu eklendi.');
    } catch (err) {
      window.toast.error('Not eklenemedi: ' + err.message);
    }
  };

  window.deleteProgressLog = function(projectId, logId) {
    confirmDelete('Bu ilerleme notunu silmek istediğinize emin misiniz?', async () => {
      try {
        await API.deleteProjectProgressLog(projectId, logId);
        await reloadProjects();
        renderTab();
        window.toast.success('İlerleme notu silindi.');
      } catch (err) {
        window.toast.error('Silme başarısız: ' + err.message);
      }
    });
  };

  // 15. Kullanıcılar (Users) Entegrasyonu
  window.saveUser = async function(id) {
    const nameEl = document.getElementById('m-uname');
    if (!nameEl) return;
    const name = nameEl.value.trim();
    if (!name) { window.toast.error('Kullanıcı adı zorunludur.'); return; }

    const role_ = document.getElementById('m-urole')?.value || 'Teknisyen';
    const pw = document.getElementById('m-upw')?.value || '';

    if (!id && !pw) {
      window.toast.error('Yeni kullanıcı için şifre zorunludur.');
      return;
    }

    try {
      if (id) {
        await API.updateUser(id, { name, role: role_, password: pw || undefined });
      } else {
        await API.createUser({ name, role: role_, password: pw });
      }
      await reloadUsers();
      closeModal();
      renderApp();
      window.toast.success(id ? 'Kullanıcı güncellendi.' : 'Yeni kullanıcı oluşturuldu.');
    } catch (err) {
      window.toast.error('Kullanıcı kaydedilemedi: ' + err.message);
    }
  };

  window.deleteUser = function(id) {
    confirmDelete('Bu kullanıcıyı silmek istediğinize emin misiniz?', async () => {
      try {
        await API.deleteUser(id);
        await reloadUsers();
        renderTab();
        window.toast.success('Kullanıcı silindi.');
      } catch (err) {
        window.toast.error('Silme başarısız: ' + err.message);
      }
    });
  };

  // 16. Ayarlar & Yazdırma Şablonu Entegrasyonu
  window.saveSettings = async function() {
    const payload = {
      companyName: (document.getElementById('s-company')?.value || '').trim(),
      footerNote: (document.getElementById('s-footer')?.value || '').trim(),
      pageSize: document.getElementById('s-pagesize')?.value || 'A4',
      orientation: document.getElementById('s-orient')?.value || 'portrait',
      maint: {
        showAssetInfo: document.getElementById('s-m-showasset')?.checked ?? true,
        showTypeAndDates: document.getElementById('s-m-showdates')?.checked ?? true,
        showGroupAndChecklist: document.getElementById('s-m-showgroup')?.checked ?? true,
        showChecklistTable: document.getElementById('s-m-showcheck')?.checked ?? true,
        showUsedMaterials: document.getElementById('s-m-showmat')?.checked ?? true,
        showMaterialCosts: document.getElementById('s-m-showcost')?.checked ?? false,
        showNotes: document.getElementById('s-m-shownote')?.checked ?? true,
        showSignatures: document.getElementById('s-m-showsig')?.checked ?? true,
      },
      fault: {
        showAssetInfo: document.getElementById('s-f-showasset')?.checked ?? true,
        showDates: document.getElementById('s-f-showdates')?.checked ?? true,
        showPriorityAndAssignee: document.getElementById('s-f-showprio')?.checked ?? true,
        showUsedMaterials: document.getElementById('s-f-showmat')?.checked ?? true,
        showMaterialCosts: document.getElementById('s-f-showcost')?.checked ?? false,
        showTechnicalSolution: document.getElementById('s-f-showtech')?.checked ?? true,
        showSignatures: document.getElementById('s-f-showsig')?.checked ?? true,
      },
    };

    try {
      const updated = await API.updateSettings(payload);
      if (window.db) window.db.printTemplate = updated || payload;
      window.toast.success('Baskı ve sistem ayarları kaydedildi.');
    } catch (err) {
      window.toast.error('Ayarlar kaydedilemedi: ' + err.message);
    }
  };

  // 17. Dosya ve Sertifika Görüntüleme Köprüsü (Güvenli Token ve noopener Korumalı)
  window.viewCertificate = function(storageKey) {
    if (!storageKey) {
      window.toast.error('Görüntülenecek dosya anahtarı bulunamadı.');
      return;
    }
    const token = API.getToken();
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const fileUrl = `${API.UPLOADS_BASE}/${encodeURIComponent(storageKey)}${query}`;
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  };

  // 18. CSV Toplu Yükleme Entegrasyonu (PostgreSQL Uyumlu)
  window.importAssetsFile = async function(inputEl) {
    const file = inputEl && inputEl.files && inputEl.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function() {
      const rows = typeof parseCSV === 'function' ? parseCSV(String(reader.result)) : [];
      if (rows.length < 2) {
        window.toast.error('Dosyada veri satırı bulunamadı.');
        inputEl.value = '';
        return;
      }
      const dataRows = rows.slice(1);
      let added = 0, updated = 0;
      const errors = [];
      window.toast.info('Varlıklar sunucuya aktarılıyor, lütfen bekleyin...');

      for (let idx = 0; idx < dataRows.length; idx++) {
        const cols = dataRows[idx].map(c => (c || '').trim());
        const [name, assetCode, serial, brand, model, capacity, groupName, parentCode, location, status, lastMaint, description] = cols;
        if (!name) { errors.push(`Satır ${idx + 2}: varlık adı boş, atlandı.`); continue; }
        const g = groupName && window.db.assetGroups ? window.db.assetGroups.find(x => x.name.toLowerCase() === groupName.toLowerCase()) : null;
        const statusVal = ['Aktif', 'Arızalı', 'Pasif'].includes(status) ? status : 'Aktif';
        const lastMaintVal = /^\d{4}-\d{2}-\d{2}$/.test(lastMaint || '') ? lastMaint : null;
        const existing = assetCode && window.db.assets ? window.db.assets.find(x => (x.assetCode || '').toLowerCase() === assetCode.toLowerCase()) : null;

        const payload = {
          name,
          assetCode: assetCode || null,
          serial: serial || null,
          brand: brand || null,
          model: model || null,
          capacity: capacity || null,
          description: description || null,
          groupId: g ? g.id : (window.db.assetGroups && window.db.assetGroups[0] ? window.db.assetGroups[0].id : null),
          parentId: null,
          location: location || null,
          status: statusVal,
          lastMaintenanceDate: lastMaintVal,
        };

        try {
          if (existing && isUuid(existing.id)) {
            await API.updateAsset(existing.id, payload);
            updated++;
          } else {
            await API.createAsset(payload);
            added++;
          }
        } catch (e) {
          errors.push(`Satır ${idx + 2} ("${name}"): ${e.message}`);
        }
      }

      await reloadAssets();
      inputEl.value = '';
      if (typeof renderTab === 'function') renderTab();
      const el = document.getElementById('assetImportResult');
      if (el) {
        el.innerHTML = `<div class="panel" style="margin-top:10px; background:#fafbfa;">
          <div style="font-weight:700; margin-bottom:6px;">${added} yeni varlık eklendi, ${updated} varlık güncellendi.</div>
          ${errors.length ? `<div class="muted tiny">${errors.map(e => esc(e)).join('<br>')}</div>` : ''}
        </div>`;
      }
      window.toast.success(`İçe aktarma tamamlandı: ${added} yeni eklendi, ${updated} güncellendi.`);
    };
    reader.readAsText(file, 'UTF-8');
  };

  window.importMaterialsFile = async function(inputEl) {
    const file = inputEl && inputEl.files && inputEl.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function() {
      const rows = typeof parseCSV === 'function' ? parseCSV(String(reader.result)) : [];
      if (rows.length < 2) {
        window.toast.error('Dosyada veri satırı bulunamadı.');
        inputEl.value = '';
        return;
      }
      const dataRows = rows.slice(1);
      let added = 0, updated = 0;
      const errors = [];
      window.toast.info('Malzemeler sunucuya aktarılıyor, lütfen bekleyin...');

      for (let idx = 0; idx < dataRows.length; idx++) {
        const cols = dataRows[idx].map(c => (c || '').trim());
        const [name, unit, qty, minQty] = cols;
        if (!name) { errors.push(`Satır ${idx + 2}: malzeme adı boş, atlandı.`); continue; }
        const qtyVal = parseFloat(qty) || 0;
        const minVal = parseFloat(minQty) || 0;
        const existing = window.db.materials && window.db.materials.find(x => x.name.toLowerCase() === name.toLowerCase());

        try {
          if (existing && isUuid(existing.id)) {
            await API.updateMaterial(existing.id, {
              name,
              unit: unit || existing.unit || 'adet',
              qty: qtyVal,
              minQty: minVal,
            });
            updated++;
          } else {
            await API.createMaterial({
              name,
              unit: unit || 'adet',
              qty: qtyVal,
              minQty: minVal,
            });
            added++;
          }
        } catch (e) {
          errors.push(`Satır ${idx + 2} ("${name}"): ${e.message}`);
        }
      }

      await reloadMaterials();
      inputEl.value = '';
      if (typeof renderTab === 'function') renderTab();
      const el = document.getElementById('materialImportResult');
      if (el) {
        el.innerHTML = `<div class="panel" style="margin-top:10px; background:#fafbfa;">
          <div style="font-weight:700; margin-bottom:6px;">${added} yeni malzeme eklendi, ${updated} malzeme güncellendi.</div>
          ${errors.length ? `<div class="muted tiny">${errors.map(e => esc(e)).join('<br>')}</div>` : ''}
        </div>`;
      }
      window.toast.success(`Malzeme aktarımı tamamlandı: ${added} yeni eklendi, ${updated} güncellendi.`);
    };
    reader.readAsText(file, 'UTF-8');
  };

  // Otomatik başlatma
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }


  console.log('✅ CMMS Backend Senkronizasyonu (cmms-sync.js) başarıyla başlatıldı.');
})(window);

/**
 * Fabrika Bakım Yönetimi (CMMS) — API İstemci Kütüphanesi
 * REST API ile tam uyumlu, JWT oturum yönetimi ve hata yakalama destekli.
 */
(function(window) {
  // Port 3001 üzerinden açılmışsa göreceli '/api', değilse tam URL kullanılır
  const API_BASE = window.CMMS_API_BASE || (window.location.port === '3001' ? '/api' : 'http://localhost:3001/api');
  const UPLOADS_BASE = window.CMMS_UPLOADS_BASE || (window.location.port === '3001' ? '/uploads' : 'http://localhost:3001/uploads');

  const API = {
    API_BASE,
    UPLOADS_BASE,

    getToken() {
      return localStorage.getItem('cmms_token') || '';
    },
    setToken(token) {
      if (token) localStorage.setItem('cmms_token', token);
      else localStorage.removeItem('cmms_token');
    },
    getRefreshToken() {
      return localStorage.getItem('cmms_refresh_token') || '';
    },
    setRefreshToken(token) {
      if (token) localStorage.setItem('cmms_refresh_token', token);
      else localStorage.removeItem('cmms_refresh_token');
    },
    getCurrentUser() {
      try {
        return JSON.parse(localStorage.getItem('cmms_user') || 'null');
      } catch (e) {
        return null;
      }
    },
    setCurrentUser(user) {
      if (user) localStorage.setItem('cmms_user', JSON.stringify(user));
      else localStorage.removeItem('cmms_user');
    },

    async refreshTokens() {
      const refreshToken = this.getRefreshToken();
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refreshToken || undefined }),
          credentials: 'include',
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data && data.token) {
          this.setToken(data.token);
          if (data.refreshToken) this.setRefreshToken(data.refreshToken);
          if (data.user) this.setCurrentUser(data.user);
          return data;
        }
        return null;
      } catch (e) {
        return null;
      }
    },

    async request(path, options = {}, isRetry = false) {
      const url = `${API_BASE}${path.startsWith('/') ? path : '/' + path}`;
      const headers = options.headers || {};
      const token = this.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      if (!(options.body instanceof FormData) && options.body && typeof options.body === 'object') {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
      }

      try {
        const res = await fetch(url, { ...options, headers, credentials: 'include' });

        if (res.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/refresh') && !path.includes('/auth/users')) {
          if (!isRetry) {
            const refreshed = await this.refreshTokens();
            if (refreshed) {
              return this.request(path, options, true);
            }
          }
          this.setToken(null);
          this.setRefreshToken(null);
          this.setCurrentUser(null);
          if (window.onAuthExpired) window.onAuthExpired();
          throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.');
        }

        if (res.status === 204) return null;

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const msg = (data && data.error) || `İşlem başarısız (${res.status})`;
          throw new Error(msg);
        }
        return data;
      } catch (err) {
        if (err.message.includes('Failed to fetch') || err.name === 'TypeError') {
          throw new Error('Backend sunucusuna bağlanılamadı. Lütfen sunucunun (http://localhost:3001) çalıştığından emin olun.');
        }
        throw err;
      }
    },

    // Kimlik Doğrulama
    async login(userId, password) {
      const data = await this.request('/auth/login', { method: 'POST', body: { userId, password } });
      if (data && data.token) {
        this.setToken(data.token);
        if (data.refreshToken) this.setRefreshToken(data.refreshToken);
        if (data.user) this.setCurrentUser(data.user);
      }
      return data;
    },
    async createFirstAdmin(name, password) {
      const data = await this.request('/auth/first-admin', { method: 'POST', body: { name, password } });
      if (data && data.token) {
        this.setToken(data.token);
        if (data.refreshToken) this.setRefreshToken(data.refreshToken);
        if (data.user) this.setCurrentUser(data.user);
      }
      return data;
    },
    getAuthUsers() {
      return this.request('/auth/users');
    },
    logout() {
      fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
      this.setToken(null);
      this.setRefreshToken(null);
      this.setCurrentUser(null);
    },

    // Kullanıcılar
    getUsers() { return this.request('/users'); },
    createUser(data) { return this.request('/users', { method: 'POST', body: data }); },
    updateUser(id, data) { return this.request(`/users/${id}`, { method: 'PUT', body: data }); },
    deleteUser(id) { return this.request(`/users/${id}`, { method: 'DELETE' }); },

    // Varlık Grupları
    getAssetGroups() { return this.request('/asset-groups'); },
    createAssetGroup(data) { return this.request('/asset-groups', { method: 'POST', body: data }); },
    updateAssetGroup(id, data) { return this.request(`/asset-groups/${id}`, { method: 'PUT', body: data }); },
    deleteAssetGroup(id) { return this.request(`/asset-groups/${id}`, { method: 'DELETE' }); },

    // Varlıklar
    getAssets() { return this.request('/assets'); },
    getAsset(id) { return this.request(`/assets/${id}`); },
    createAsset(data) { return this.request('/assets', { method: 'POST', body: data }); },
    updateAsset(id, data) { return this.request(`/assets/${id}`, { method: 'PUT', body: data }); },
    deleteAsset(id) { return this.request(`/assets/${id}`, { method: 'DELETE' }); },
    uploadAssetAttachment(assetId, file, name, kind) {
      const fd = new FormData();
      fd.append('file', file, name || file.name || 'dosya');
      if (name) fd.append('name', name);
      if (kind) fd.append('kind', kind);
      return this.request(`/assets/${assetId}/attachments`, { method: 'POST', body: fd });
    },
    deleteAssetAttachment(assetId, attId) {
      return this.request(`/assets/${assetId}/attachments/${attId}`, { method: 'DELETE' });
    },
    saveAssetSpareParts(assetId, materialIds) {
      return this.request(`/assets/${assetId}/spare-parts`, { method: 'PUT', body: { materialIds } });
    },

    // Tedarikçiler
    getSuppliers() { return this.request('/suppliers'); },
    createSupplier(data) { return this.request('/suppliers', { method: 'POST', body: data }); },
    updateSupplier(id, data) { return this.request(`/suppliers/${id}`, { method: 'PUT', body: data }); },
    deleteSupplier(id) { return this.request(`/suppliers/${id}`, { method: 'DELETE' }); },

    // Malzemeler
    getMaterials() { return this.request('/materials'); },
    createMaterial(data) { return this.request('/materials', { method: 'POST', body: data }); },
    updateMaterial(id, data) { return this.request(`/materials/${id}`, { method: 'PUT', body: data }); },
    deleteMaterial(id) { return this.request(`/materials/${id}`, { method: 'DELETE' }); },
    adjustMaterialStock(id, type, qty, reason) {
      return this.request(`/materials/${id}/adjust`, { method: 'POST', body: { type, qty, reason } });
    },

    // Stok
    getStockMovements(query = '') { return this.request(`/stock/movements${query ? '?' + query : ''}`); },
    getStockSummary() { return this.request('/stock/summary'); },

    // İhtiyaç Listesi
    getNeedsList(includeAuto = true) { return this.request(`/needs-list?includeAuto=${includeAuto}`); },
    createNeed(data) { return this.request('/needs-list', { method: 'POST', body: data }); },
    updateNeed(id, data) { return this.request(`/needs-list/${id}`, { method: 'PUT', body: data }); },
    updateNeedStatus(id, status) { return this.request(`/needs-list/${id}/status`, { method: 'PATCH', body: { status } }); },
    deleteNeed(id) { return this.request(`/needs-list/${id}`, { method: 'DELETE' }); },

    // Satın Alma
    getPurchases(query = '') { return this.request(`/purchases${query ? '?' + query : ''}`); },
    createPurchase(data) { return this.request('/purchases', { method: 'POST', body: data }); },
    updatePurchase(id, data) { return this.request(`/purchases/${id}`, { method: 'PUT', body: data }); },
    deletePurchase(id) { return this.request(`/purchases/${id}`, { method: 'DELETE' }); },

    // Bakımlar
    getMaintenanceRecords(query = '') { return this.request(`/maintenance${query ? '?' + query : ''}`); },
    getMaintenanceRecord(id) { return this.request(`/maintenance/${id}`); },
    createMaintenanceRecord(data) { return this.request('/maintenance', { method: 'POST', body: data }); },
    deleteMaintenanceRecord(id) { return this.request(`/maintenance/${id}`, { method: 'DELETE' }); },

    // Arızalar
    getFaults(query = '') { return this.request(`/faults${query ? '?' + query : ''}`); },
    getFault(id) { return this.request(`/faults/${id}`); },
    createFault(data) { return this.request('/faults', { method: 'POST', body: data }); },
    updateFault(id, data) { return this.request(`/faults/${id}`, { method: 'PUT', body: data }); },
    deleteFault(id) { return this.request(`/faults/${id}`, { method: 'DELETE' }); },
    uploadFaultAttachment(faultId, file, name, kind) {
      const fd = new FormData();
      fd.append('file', file, name || file.name || 'dosya');
      if (name) fd.append('name', name);
      if (kind) fd.append('kind', kind);
      return this.request(`/faults/${faultId}/attachments`, { method: 'POST', body: fd });
    },
    deleteFaultAttachment(faultId, attId) {
      return this.request(`/faults/${faultId}/attachments/${attId}`, { method: 'DELETE' });
    },

    // Muayeneler
    getInspections(query = '') { return this.request(`/inspections${query ? '?' + query : ''}`); },
    getInspection(id) { return this.request(`/inspections/${id}`); },
    createInspection(data) { return this.request('/inspections', { method: 'POST', body: data }); },
    updateInspection(id, data) { return this.request(`/inspections/${id}`, { method: 'PUT', body: data }); },
    deleteInspection(id) { return this.request(`/inspections/${id}`, { method: 'DELETE' }); },
    uploadInspectionCertificate(inspId, file, name, kind) {
      const fd = new FormData();
      fd.append('file', file, name || file.name || 'dosya');
      if (name) fd.append('name', name);
      if (kind) fd.append('kind', kind);
      return this.request(`/inspections/${inspId}/certificates`, { method: 'POST', body: fd });
    },
    deleteInspectionCertificate(inspId, certId) {
      return this.request(`/inspections/${inspId}/certificates/${certId}`, { method: 'DELETE' });
    },

    // Dış Bakım
    getExtMaintenance(query = '') { return this.request(`/ext-maintenance${query ? '?' + query : ''}`); },
    getExtMaintenanceDetail(id) { return this.request(`/ext-maintenance/${id}`); },
    createExtMaintenance(data) { return this.request('/ext-maintenance', { method: 'POST', body: data }); },
    updateExtMaintenance(id, data) { return this.request(`/ext-maintenance/${id}`, { method: 'PUT', body: data }); },
    deleteExtMaintenance(id) { return this.request(`/ext-maintenance/${id}`, { method: 'DELETE' }); },
    uploadExtMaintenanceCertificate(recId, file, name, kind) {
      const fd = new FormData();
      fd.append('file', file, name || file.name || 'dosya');
      if (name) fd.append('name', name);
      if (kind) fd.append('kind', kind);
      return this.request(`/ext-maintenance/${recId}/certificates`, { method: 'POST', body: fd });
    },
    deleteExtMaintenanceCertificate(recId, certId) {
      return this.request(`/ext-maintenance/${recId}/certificates/${certId}`, { method: 'DELETE' });
    },

    // Projeler
    getProjects(query = '') { return this.request(`/projects${query ? '?' + query : ''}`); },
    getProject(id) { return this.request(`/projects/${id}`); },
    createProject(data) { return this.request('/projects', { method: 'POST', body: data }); },
    updateProject(id, data) { return this.request(`/projects/${id}`, { method: 'PUT', body: data }); },
    deleteProject(id) { return this.request(`/projects/${id}`, { method: 'DELETE' }); },
    addProjectTask(projectId, data) { return this.request(`/projects/${projectId}/tasks`, { method: 'POST', body: data }); },
    updateProjectTask(projectId, taskId, data) { return this.request(`/projects/${projectId}/tasks/${taskId}`, { method: 'PUT', body: data }); },
    deleteProjectTask(projectId, taskId) { return this.request(`/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' }); },
    addProjectQuote(projectId, data, file) {
      if (file) {
        const fd = new FormData();
        Object.keys(data).forEach(k => { if (data[k] != null) fd.append(k, data[k]); });
        fd.append('file', file);
        return this.request(`/projects/${projectId}/quotes`, { method: 'POST', body: fd });
      }
      return this.request(`/projects/${projectId}/quotes`, { method: 'POST', body: data });
    },
    deleteProjectQuote(projectId, quoteId) { return this.request(`/projects/${projectId}/quotes/${quoteId}`, { method: 'DELETE' }); },
    addProjectBudget(projectId, amount, note, date) {
      return this.request(`/projects/${projectId}/budget`, { method: 'POST', body: { amount, note, date } });
    },
    addProjectProgressLog(projectId, note, date) {
      return this.request(`/projects/${projectId}/progress-logs`, { method: 'POST', body: { note, date } });
    },
    deleteProjectProgressLog(projectId, logId) {
      return this.request(`/projects/${projectId}/progress-logs/${logId}`, { method: 'DELETE' });
    },

    // Ayarlar & Logo
    getSettings() { return this.request('/settings'); },
    updateSettings(data) { return this.request('/settings', { method: 'PUT', body: data }); },
    uploadLogo(file) {
      const fd = new FormData();
      fd.append('logo', file, file.name || 'logo.png');
      return this.request('/settings/logo', { method: 'POST', body: fd });
    },
    deleteLogo() { return this.request('/settings/logo', { method: 'DELETE' }); },
  };

  window.CMMS_API = API;
})(window);

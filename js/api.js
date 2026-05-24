/*
 * api.js — Google Apps Script backend API client
 *
 * Sorumluluğu:
 *  - PCB kayıt POST'u (Sheet'e ekle)
 *  - UID doğrulama GET (editor için, sahada update yetkisi)
 *  - API sağlık kontrolü
 *
 * Apps Script endpoint URL'i sabit — değişirse buradan tek satır güncellenir.
 * Editor'e ulaşacak URL ise GitHub raw URL olur (sabit, müşteriye dokunmaz).
 */

(function (global) {
  'use strict';

  // Varsayılan URL — son bilinen deployment. localStorage'da kayıt varsa onu kullan.
  const API_BASE_DEFAULT = 'https://script.google.com/macros/s/AKfycbwR5HbN6tWkj9yUc7fKBFtLR2wK1tA8R3aVrYUwT1m85FgcO60Kd3K0a2jHQ15KPfiP/exec';
  const STORAGE_KEY = 'vili_plc_api_url';

  function getStoredUrl() {
    try { return localStorage.getItem(STORAGE_KEY) || API_BASE_DEFAULT; }
    catch { return API_BASE_DEFAULT; }
  }
  function setStoredUrl(url) {
    try { localStorage.setItem(STORAGE_KEY, url); } catch {}
  }

  class ProductionApi {
    constructor(baseUrl) {
      this.baseUrl = baseUrl || getStoredUrl();
    }

    setUrl(url) {
      this.baseUrl = url;
      setStoredUrl(url);
    }

    static getDefaultUrl() { return API_BASE_DEFAULT; }
    static getStoredUrl()  { return getStoredUrl(); }

    /** API sağlık kontrolü — sayfa açılışında çağrılır. */
    async ping() {
      const r = await fetch(this.baseUrl + '?action=ping');
      if (!r.ok) throw new Error('API ping HTTP ' + r.status);
      const json = await r.json();
      if (!json.ok) throw new Error('API ping fail: ' + json.error);
      return json;
    }

    /**
     * Yeni PCB kaydı ekle.
     * @param {object} data — { uid, model, bootloader, firmware, operator, status, customer, notes }
     * @returns {object} { ok, rowNumber, uid, time }
     */
    async registerPlc(data) {
      // Apps Script doPost'u JSON body bekliyor. CORS için preflight'tan kaçmak
      // gerek — Content-Type 'text/plain' set edip body içinde JSON yolla
      // (Apps Script JSON.parse(e.postData.contents) ile zaten parse ediyor).
      const r = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'registerPlc', ...data }),
      });
      if (!r.ok) throw new Error('Register HTTP ' + r.status);
      const json = await r.json();
      if (!json.ok) throw new Error('Register fail: ' + json.error);
      return json;
    }

    /**
     * UID kayıtlı mı? Detay döner: { registered, detail: {lastDate, lastFirmware, ...} }
     * Üretim tool'unda duplicate önleme için kullanılır.
     */
    async checkUid(uid) {
      const r = await fetch(this.baseUrl + '?action=checkUid&uid=' + encodeURIComponent(uid));
      if (!r.ok) throw new Error('CheckUid HTTP ' + r.status);
      const json = await r.json();
      if (!json.ok) throw new Error('CheckUid fail: ' + json.error);
      return { registered: json.registered, detail: json.detail };
    }

    /** Tüm kayıtları getir (debug, üretim listesi). */
    async listAll() {
      const r = await fetch(this.baseUrl + '?action=list');
      if (!r.ok) throw new Error('List HTTP ' + r.status);
      const json = await r.json();
      if (!json.ok) throw new Error('List fail: ' + json.error);
      return json.data;
    }

    // ── Authentication & User Management ────────────────────────────────

    /** Login — { ok, role: 'master'|'slave' } veya { ok: false, error } döner */
    async login(user, pass) {
      const r = await fetch(this.baseUrl + '?action=login' +
        '&user=' + encodeURIComponent(user) +
        '&pass=' + encodeURIComponent(pass));
      if (!r.ok) throw new Error('Login HTTP ' + r.status);
      return await r.json();
    }

    /** Kullanıcı listesi (master only). */
    async listUsers(byUser) {
      const r = await fetch(this.baseUrl + '?action=listUsers&by=' + encodeURIComponent(byUser));
      if (!r.ok) throw new Error('ListUsers HTTP ' + r.status);
      const json = await r.json();
      if (!json.ok) throw new Error(json.error);
      return json.users;
    }

    /** Yeni kullanıcı ekle (master only). */
    async addUser(user, pass, role, byUser) {
      const r = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'addUser', user, pass, role, by: byUser }),
      });
      if (!r.ok) throw new Error('AddUser HTTP ' + r.status);
      const json = await r.json();
      if (!json.ok) throw new Error(json.error);
      return json;
    }

    /** Kullanıcı sil (master only, kendini silemez). */
    async deleteUser(user, byUser) {
      const r = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'deleteUser', user, by: byUser }),
      });
      if (!r.ok) throw new Error('DeleteUser HTTP ' + r.status);
      const json = await r.json();
      if (!json.ok) throw new Error(json.error);
      return json;
    }

    /** Şifre değiştir (master herkesin, slave kendi). */
    async changePassword(user, newPass, byUser) {
      const r = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'changePassword', user, newPass, by: byUser }),
      });
      if (!r.ok) throw new Error('ChangePassword HTTP ' + r.status);
      const json = await r.json();
      if (!json.ok) throw new Error(json.error);
      return json;
    }

    // ── Bin Dosya Yönetimi (Google Drive üzerinden) ────────────────────

    /**
     * Belirli model + type için bin dosyasını çek.
     * @returns {Uint8Array} bin içeriği
     */
    async fetchBin(model, type) {
      const r = await fetch(this.baseUrl + '?action=fetchBin' +
        '&model=' + encodeURIComponent(model) +
        '&type='  + encodeURIComponent(type));
      if (!r.ok) throw new Error('FetchBin HTTP ' + r.status);
      const json = await r.json();
      if (!json.ok) throw new Error(json.error);
      // base64 → Uint8Array
      const bin = atob(json.content);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { bytes, name: json.name, size: json.size, lastModified: json.lastModified };
    }

    /** Bir model için Drive'daki bin'leri listele. */
    async listBins(model) {
      const r = await fetch(this.baseUrl + '?action=listBins&model=' + encodeURIComponent(model));
      if (!r.ok) throw new Error('ListBins HTTP ' + r.status);
      const json = await r.json();
      if (!json.ok) throw new Error(json.error);
      return json.files;
    }

    /**
     * Master tarafından bin upload — Drive'a yazılır (mevcut overwrite).
     * @param {Uint8Array} bytes
     */
    async uploadBin(model, type, bytes, byUser) {
      // Uint8Array → base64
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);

      const r = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'uploadBin',
          model: model,
          type:  type,
          content: base64,
          by: byUser
        }),
      });
      if (!r.ok) throw new Error('UploadBin HTTP ' + r.status);
      const json = await r.json();
      if (!json.ok) throw new Error(json.error);
      return json;
    }
  }

  global.ProductionApi = ProductionApi;
})(window);

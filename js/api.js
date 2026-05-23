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
  const API_BASE_DEFAULT = 'https://script.google.com/macros/s/AKfycbylj0JFrEeEc_t4DGyV02dlbPqYnQt3VgoSrw4nfBKe1wl5MkZM0_wTvpPpXhxSxpZS/exec';
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
  }

  global.ProductionApi = ProductionApi;
})(window);

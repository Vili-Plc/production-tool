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

  const API_BASE = 'https://script.google.com/macros/s/AKfycbwjKta7CihSe7rmAUbt0oT9_Ml8OVotKAbNPvFV794ktRJTSG-5qOYJRyn1lq4ygSI/exec';

  class ProductionApi {
    constructor(baseUrl = API_BASE) {
      this.baseUrl = baseUrl;
    }

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

    /** UID kayıtlı mı? (editor sahada update öncesi yetki kontrolü için) */
    async checkUid(uid) {
      const r = await fetch(this.baseUrl + '?action=checkUid&uid=' + encodeURIComponent(uid));
      if (!r.ok) throw new Error('CheckUid HTTP ' + r.status);
      const json = await r.json();
      if (!json.ok) throw new Error('CheckUid fail: ' + json.error);
      return json.authorized;  // bool
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

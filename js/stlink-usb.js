/*
 * stlink-usb.js — WebUSB ile ST-Link cihazına ham erişim
 *
 * Sorumluluğu:
 *  - Cihaz seç (browser picker)
 *  - Open + configuration + claim interface
 *  - Bulk OUT (komut gönder) ve Bulk IN (cevap al)
 *  - Endpoint adresleri ST-Link variant'larına göre otomatik bulunur
 *
 * Bu dosya hiçbir ST-Link komutu bilmez — sadece "byte gönder, byte al".
 * Komutlar bir üst katmanda (stlink-cmd.js).
 */

(function (global) {
  'use strict';

  // STMicroelectronics VID + ST-Link variant PID'leri
  const STLINK_USB_FILTERS = [
    { vendorId: 0x0483, productId: 0x3744 },  // ST-Link v1
    { vendorId: 0x0483, productId: 0x3748 },  // ST-Link v2
    { vendorId: 0x0483, productId: 0x374B },  // ST-Link v2-1
    { vendorId: 0x0483, productId: 0x374A },  // ST-Link v2-1 (alt PID)
    { vendorId: 0x0483, productId: 0x374D },  // ST-Link v3 (debug only)
    { vendorId: 0x0483, productId: 0x374E },  // ST-Link v3 (mass storage + VCP)
    { vendorId: 0x0483, productId: 0x374F },  // ST-Link v3 (VCP only)
    { vendorId: 0x0483, productId: 0x3753 },  // ST-Link v3 (no MSD)
  ];

  // Variant tespit yardımcısı — bazı komutlar variant'a göre değişir
  const STLINK_VARIANT = {
    V1:    'v1',
    V2:    'v2',
    V2_1:  'v2-1',
    V3:    'v3',
  };

  function detectVariant(productId) {
    switch (productId) {
      case 0x3744: return STLINK_VARIANT.V1;
      case 0x3748: return STLINK_VARIANT.V2;
      case 0x374B:
      case 0x374A: return STLINK_VARIANT.V2_1;
      case 0x374D:
      case 0x374E:
      case 0x374F:
      case 0x3753: return STLINK_VARIANT.V3;
      default:     return 'unknown';
    }
  }

  class StlinkUsb {
    constructor() {
      this.device     = null;       // USBDevice
      this.variant    = null;       // STLINK_VARIANT.*
      this.epOut      = null;       // Bulk OUT endpoint number (1..15)
      this.epIn       = null;       // Bulk IN endpoint number
      this.epTrace    = null;       // SWO trace endpoint (optional)
      this.maxPktOut  = 64;
      this.maxPktIn   = 64;
    }

    get isOpen() { return this.device !== null && this.device.opened; }

    /**
     * Browser picker'ı aç → kullanıcı cihaz seçsin → open + claim.
     * Kullanıcı iptal ederse exception fırlatır.
     */
    async requestAndOpen() {
      if (!navigator.usb) {
        throw new Error('WebUSB desteklenmiyor (Chrome veya Edge gerekli).');
      }

      // Browser cihaz seçici (kullanıcı eylemi gerektirir — buton click'inden çağrılmalı)
      const device = await navigator.usb.requestDevice({ filters: STLINK_USB_FILTERS });
      if (!device) throw new Error('Cihaz seçilmedi.');

      this.variant = detectVariant(device.productId);
      this.device  = device;

      await device.open();

      // Configuration 1 default (ST-Link'ler tek config kullanır)
      if (device.configuration === null) {
        await device.selectConfiguration(1);
      }

      // Interface 0 — debug interface
      await device.claimInterface(0);

      // Bulk endpoint'leri config'ten bul (variant'a göre 0x01/0x81 veya farklı)
      const iface = device.configuration.interfaces[0].alternate;
      for (const ep of iface.endpoints) {
        if (ep.type !== 'bulk') continue;
        if (ep.direction === 'out' && this.epOut === null) {
          this.epOut = ep.endpointNumber;
          this.maxPktOut = ep.packetSize;
        } else if (ep.direction === 'in') {
          if (this.epIn === null) {
            this.epIn = ep.endpointNumber;
            this.maxPktIn = ep.packetSize;
          } else if (this.epTrace === null) {
            // İkinci IN endpoint = SWO trace (v2-1, v3'te var)
            this.epTrace = ep.endpointNumber;
          }
        }
      }

      if (this.epOut === null || this.epIn === null) {
        await this.close();
        throw new Error('ST-Link bulk endpoint\'leri bulunamadı — uyumsuz cihaz olabilir.');
      }

      return {
        variant:     this.variant,
        productId:   device.productId,
        vendorId:    device.vendorId,
        serial:      device.serialNumber || '',
        product:     device.productName || '',
        manufacturer:device.manufacturerName || '',
        epOut:       this.epOut,
        epIn:        this.epIn,
        epTrace:     this.epTrace,
      };
    }

    /**
     * Komut byte'larını cihaza yolla. Uint8Array veya number[] kabul eder.
     * ST-Link komutları çoğunlukla 16 byte'tır; eksik byte'ları 0 ile pad eder.
     */
    async sendCommand(bytes, padTo = 16) {
      if (!this.isOpen) throw new Error('ST-Link bağlı değil.');
      const buf = new Uint8Array(Math.max(bytes.length, padTo));
      for (let i = 0; i < bytes.length; i++) buf[i] = bytes[i];
      const res = await this.device.transferOut(this.epOut, buf);
      if (res.status !== 'ok') {
        throw new Error('USB OUT transfer hatası: ' + res.status);
      }
    }

    /**
     * Cihazdan cevap byte'ları oku. expectedLen = beklediğin tam boyut.
     * Cihaz daha az gönderirse hata atar (eksik response).
     */
    async readResponse(expectedLen) {
      if (!this.isOpen) throw new Error('ST-Link bağlı değil.');
      const res = await this.device.transferIn(this.epIn, expectedLen);
      if (res.status !== 'ok') {
        throw new Error('USB IN transfer hatası: ' + res.status);
      }
      if (res.data.byteLength < expectedLen) {
        throw new Error(`Beklenen ${expectedLen} byte, alınan ${res.data.byteLength}`);
      }
      return new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength);
    }

    /**
     * Tek seferde: komut yolla + cevap oku (en yaygın pattern)
     */
    async transact(cmdBytes, responseLen, padTo = 16) {
      await this.sendCommand(cmdBytes, padTo);
      return await this.readResponse(responseLen);
    }

    async close() {
      if (!this.device) return;
      try {
        if (this.device.opened) {
          try { await this.device.releaseInterface(0); } catch {}
          await this.device.close();
        }
      } catch (e) {
        console.warn('[StlinkUsb.close]', e);
      } finally {
        this.device  = null;
        this.variant = null;
        this.epOut   = null;
        this.epIn    = null;
        this.epTrace = null;
      }
    }
  }

  // Global export
  global.StlinkUsb     = StlinkUsb;
  global.STLINK_VARIANT = STLINK_VARIANT;
})(window);

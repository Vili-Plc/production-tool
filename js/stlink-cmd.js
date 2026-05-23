/*
 * stlink-cmd.js — ST-Link komut katmanı
 *
 * Sorumluluğu:
 *  - ST-Link USB komut kodları ve parse'i
 *  - Versiyon okuma (v2 / v2-1 / v3 farklı komutlar)
 *  - SWD/JTAG mode girişi (sonraki fazlarda)
 *
 * Alt katman: StlinkUsb (byte transferi)
 * Üst katman: SWD, STM32 flash (sonraki fazlar)
 */

(function (global) {
  'use strict';

  // ST-Link USB komut kodları (referans: webstlink, OpenOCD)
  const STLINK_CMD = {
    GET_VERSION:        0xF1,    // V2/V2-1
    DEBUG_COMMAND:      0xF2,    // Debug subcommand prefix (SWD/JTAG işleri)
    DFU_COMMAND:        0xF3,    // DFU subcommand
    GET_CURRENT_MODE:   0xF5,    // 2 byte response: [mode, 0]
    GET_TARGET_VOLTAGE: 0xF7,    // VAREF / VCC volt ölçümü (8 byte)
    GET_VERSION_APIV3:  0xFB,    // V3 için extended version
  };

  // Debug subcommand kodları (DEBUG_COMMAND 0xF2 sonrasında gelir)
  const DBG = {
    APIV2_ENTER:          0x30,  // [0xF2, 0x30, mode] — mode: 0xA3=SWD, 0xA4=JTAG
    APIV2_READ_IDCODES:   0x31,  // [0xF2, 0x31] → 12 byte: DAP_IDCODE + ekstra
    EXIT:                 0x21,  // [0xF2, 0x21] — debug mode'dan çık
    READMEM_32BIT:        0x07,  // [0xF2, 0x07, addr(4), len(2)] → len byte data
    APIV2_READMEM_32BIT:  0x07,  // alternatif isim
    WRITEMEM_32BIT:       0x08,
    READMEM_8BIT:         0x0C,
    APIV2_RESETSYS:       0x32,  // [0xF2, 0x32] reset hedef chip
    APIV2_JTAG_RESET:     0x32,  // alternatif
  };

  // SWD/JTAG mode parametreleri (APIV2_ENTER üçüncü byte'ı)
  const DBG_MODE = {
    SWD:  0xA3,
    JTAG: 0xA4,
  };

  // ST-Link working mode (GET_CURRENT_MODE cevabı)
  const STLINK_MODE = {
    DFU:        0x00,    // DFU bootloader (firmware update modunda)
    MASS:       0x01,    // Mass storage
    DEBUG:      0x02,    // Debug (SWD/JTAG)
    SWIM:       0x03,    // STM8 SWIM
    BOOTLOADER: 0x04,    // ST-Link kendi bootloader'ı
  };

  /**
   * V2/V2-1 versiyon parse
   * 6-byte response:
   *   byte[0..1] = version word (big-endian!)
   *     bits 15-12: stlink_v (genelde 2)
   *     bits 11-6:  jtag_v
   *     bits 5-0:   swim_v
   *   byte[2..3] = VID (little-endian, genelde 0x0483)
   *   byte[4..5] = PID (little-endian)
   */
  function parseVersionV2(buf) {
    if (buf.length < 6) throw new Error('Versiyon cevabı kısa: ' + buf.length);
    // Big-endian word
    const word = (buf[0] << 8) | buf[1];
    const stlink_v = (word >> 12) & 0x0F;
    const jtag_v   = (word >>  6) & 0x3F;
    const swim_v   =  word        & 0x3F;
    const vid = buf[2] | (buf[3] << 8);
    const pid = buf[4] | (buf[5] << 8);
    return {
      stlinkVersion: stlink_v,
      jtagVersion:   jtag_v,
      swimVersion:   swim_v,
      vid: vid,
      pid: pid,
      formatted: `V${stlink_v}J${jtag_v}S${swim_v}`,
    };
  }

  /**
   * V3 versiyon parse (12-byte response, daha zengin)
   * byte[0]   = stlink major (3)
   * byte[1]   = swim version
   * byte[2]   = jtag version
   * byte[3]   = msc version
   * byte[4]   = bridge version
   * byte[5..7]= reserved
   * byte[8..9] = VID
   * byte[10..11] = PID
   */
  function parseVersionV3(buf) {
    if (buf.length < 12) throw new Error('V3 versiyon cevabı kısa: ' + buf.length);
    return {
      stlinkVersion: buf[0],
      swimVersion:   buf[1],
      jtagVersion:   buf[2],
      mscVersion:    buf[3],
      bridgeVersion: buf[4],
      vid: buf[8]  | (buf[9]  << 8),
      pid: buf[10] | (buf[11] << 8),
      formatted: `V${buf[0]}J${buf[2]}M${buf[3]}B${buf[4]}`,
    };
  }

  class StlinkCmd {
    /**
     * @param {StlinkUsb} usb — Açık USB cihaz
     */
    constructor(usb) {
      this.usb = usb;
    }

    /**
     * Versiyon oku — variant'a göre doğru komutu seç.
     * Dönen object: { stlinkVersion, jtagVersion, swimVersion, vid, pid, formatted, ... }
     */
    async getVersion() {
      if (this.usb.variant === 'v3') {
        // V3: 0xFB komutu, 12-byte response
        const resp = await this.usb.transact([STLINK_CMD.GET_VERSION_APIV3, 0x80], 12);
        return parseVersionV3(resp);
      } else {
        // V1/V2/V2-1: 0xF1 komutu, 6-byte response
        const resp = await this.usb.transact([STLINK_CMD.GET_VERSION, 0x80], 6);
        return parseVersionV2(resp);
      }
    }

    /**
     * Mevcut mode oku (Debug mode'da mıyız vs.)
     */
    async getCurrentMode() {
      const resp = await this.usb.transact([STLINK_CMD.GET_CURRENT_MODE], 2);
      return {
        mode: resp[0],
        modeName: Object.keys(STLINK_MODE).find(k => STLINK_MODE[k] === resp[0]) || 'UNKNOWN',
      };
    }

    /**
     * Hedef MCU besleme voltajı (VAREF) ölç.
     * Cevap: 8 byte = [a0_lo, a0_hi, ?, ?, a1_lo, a1_hi, ?, ?]
     *   Vtarget = 2 * 1.2V * a1/a0
     */
    async getTargetVoltage() {
      const resp = await this.usb.transact([STLINK_CMD.GET_TARGET_VOLTAGE], 8);
      const a0 = resp[0] | (resp[1] << 8);
      const a1 = resp[4] | (resp[5] << 8);
      if (a0 === 0) return 0;
      return (2.0 * 1.2 * a1) / a0;
    }

    /**
     * Mevcut modu kontrol et — DFU veya Mass mode'daysa Debug'a geç.
     * Sonra SWD mode'a gir (chip'le konuşmaya hazır ol).
     */
    async enterSwdMode() {
      // Önce mevcut modu kontrol et; gerekirse exit
      const curMode = await this.getCurrentMode();
      if (curMode.mode === STLINK_MODE.DFU) {
        // DFU mode'dan çık
        await this.usb.sendCommand([STLINK_CMD.DFU_COMMAND, 0x07]);
      }
      if (curMode.mode === STLINK_MODE.DEBUG) {
        // Zaten debug mode'da; clean exit + re-enter (state reset)
        await this.usb.sendCommand([STLINK_CMD.DEBUG_COMMAND, DBG.EXIT]);
      }
      // SWD mode'a gir
      const resp = await this.usb.transact(
        [STLINK_CMD.DEBUG_COMMAND, DBG.APIV2_ENTER, DBG_MODE.SWD], 2);
      // İlk byte 0x80 ise OK; aksi halde hata kodu döner
      return { status: resp[0], raw: resp };
    }

    /**
     * ARM CoreSight DAP IDCODE oku.
     * STM32F0 (Cortex-M0) için beklenen: 0x0BB11477
     * Cevap: 12 byte; ilk 4 byte = IDCODE (LE)
     */
    async readIdCodes() {
      const resp = await this.usb.transact(
        [STLINK_CMD.DEBUG_COMMAND, DBG.APIV2_READ_IDCODES], 12);
      const idcode = resp[0] | (resp[1] << 8) | (resp[2] << 16) | (resp[3] << 24);
      return { idcode: idcode >>> 0, raw: resp };
    }

    /**
     * SWD üzerinden hedef bellekten 32-bit hizalı oku.
     * @param {number} addr  — 4-byte hizalı başlangıç adresi
     * @param {number} len   — byte sayısı (4'ün katı, max 6144 — ST-Link sınırı)
     * @returns Uint8Array (len byte)
     */
    async readMemory32(addr, len) {
      if (addr & 3)  throw new Error('Adres 4-byte hizalı olmalı: 0x' + addr.toString(16));
      if (len  & 3)  throw new Error('Uzunluk 4-byte katı olmalı: ' + len);
      if (len > 1024) throw new Error('Tek seferde max 1024 byte (chunk\'la böl)');

      const cmd = [
        STLINK_CMD.DEBUG_COMMAND, DBG.READMEM_32BIT,
        (addr      ) & 0xFF,
        (addr >>  8) & 0xFF,
        (addr >> 16) & 0xFF,
        (addr >> 24) & 0xFF,
        (len ) & 0xFF,
        (len >> 8) & 0xFF,
      ];
      await this.usb.sendCommand(cmd);
      return await this.usb.readResponse(len);
    }
  }

  global.StlinkCmd  = StlinkCmd;
  global.STLINK_CMD = STLINK_CMD;
  global.STLINK_MODE = STLINK_MODE;
})(window);

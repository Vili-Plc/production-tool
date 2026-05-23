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
    GET_CURRENT_MODE:   0xF5,    // 2 byte response: [mode, 0]
    DFU_COMMAND:        0xF3,    // DFU subcommand
    GET_VERSION_APIV3:  0xFB,    // V3 için extended version
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
     * Sonraki fazda kullanılacak — şimdi placeholder.
     */
    async getCurrentMode() {
      const resp = await this.usb.transact([STLINK_CMD.GET_CURRENT_MODE], 2);
      return {
        mode: resp[0],
        modeName: Object.keys(STLINK_MODE).find(k => STLINK_MODE[k] === resp[0]) || 'UNKNOWN',
      };
    }
  }

  global.StlinkCmd  = StlinkCmd;
  global.STLINK_CMD = STLINK_CMD;
  global.STLINK_MODE = STLINK_MODE;
})(window);

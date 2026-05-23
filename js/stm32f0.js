/*
 * stm32f0.js — STM32F0 ailesi spesifik adres ve dekoderlar
 *
 * Bu katman SWD üzerinden okunabilen system register'ları bilir:
 *  - DBGMCU_IDCODE: chip model + revizyon
 *  - U_ID: 96-bit Unique Device ID
 *  - F_SIZE: Flash boyutu (kalibre edilmiş, gerçek MCU boyutu)
 *
 * StlinkCmd.readMemory32 kullanır.
 */

(function (global) {
  'use strict';

  // STM32F0 system memory adresleri (RM0360, RM0091)
  const STM32F0_REG = {
    DBGMCU_IDCODE: 0x40015800,   // [11:0]=DEV_ID, [31:16]=REV_ID
    U_ID_BASE:     0x1FFFF7AC,   // 96-bit UID (12 byte)
    F_SIZE:        0x1FFFF7CC,   // 16-bit flash size in KB
  };

  // Bilinen DEV_ID → model adı tablosu
  const STM32F0_DEV_ID_TABLE = {
    0x440: 'STM32F030x8 / F05x',     // F030C8, F030R8, F050xx
    0x442: 'STM32F030xC / F09x',     // F030CC, F091
    0x444: 'STM32F03x4/6',            // F030F4, F030K6
    0x445: 'STM32F04x',               // F042
    0x448: 'STM32F07x',               // F072, F070
    0x445: 'STM32F04x / F070x6',
  };

  // REV_ID dekoderı (F030 için)
  function decodeRevId(devId, revId) {
    // F030C8 (DEV_ID=0x440): 0x1000=Rev 1.0, 0x2000=Rev 2.0
    if (devId === 0x440) {
      if (revId === 0x1000) return 'Rev 1.0';
      if (revId === 0x2000) return 'Rev 2.0';
      if (revId === 0x2001) return 'Rev 2.1';
    }
    return `0x${revId.toString(16).toUpperCase()}`;
  }

  class Stm32f0 {
    /** @param {StlinkCmd} cmd  Açık ST-Link, SWD mode'da olmalı */
    constructor(cmd) {
      this.cmd = cmd;
    }

    /**
     * DBGMCU_IDCODE register'ından chip kimliği oku.
     * Dönen: { devId, revId, modelName, revName }
     */
    async readChipId() {
      const buf = await this.cmd.readMemory32(STM32F0_REG.DBGMCU_IDCODE, 4);
      const word = buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24);
      const devId = word & 0xFFF;
      const revId = (word >> 16) & 0xFFFF;
      return {
        devId:     devId,
        revId:     revId,
        modelName: STM32F0_DEV_ID_TABLE[devId] || `Bilinmeyen (0x${devId.toString(16)})`,
        revName:   decodeRevId(devId, revId),
        raw:       word >>> 0,
      };
    }

    /**
     * 96-bit Unique Device ID oku.
     * Dönen: { bytes: Uint8Array(12), hex: string, words: [w0, w1, w2] }
     */
    async readUid() {
      const buf = await this.cmd.readMemory32(STM32F0_REG.U_ID_BASE, 12);
      const w0 = buf[0]  | (buf[1]  << 8) | (buf[2]  << 16) | (buf[3]  << 24);
      const w1 = buf[4]  | (buf[5]  << 8) | (buf[6]  << 16) | (buf[7]  << 24);
      const w2 = buf[8]  | (buf[9]  << 8) | (buf[10] << 16) | (buf[11] << 24);
      let hex = '';
      for (let i = 0; i < 12; i++) hex += buf[i].toString(16).padStart(2, '0').toUpperCase();
      return {
        bytes: buf,
        hex:   hex,
        words: [w0 >>> 0, w1 >>> 0, w2 >>> 0],
        // İnsan-okuyabilir gruplandırma (XXXXXXXX-XXXXXXXX-XXXXXXXX)
        pretty: `${(w0>>>0).toString(16).padStart(8,'0').toUpperCase()}-` +
                `${(w1>>>0).toString(16).padStart(8,'0').toUpperCase()}-` +
                `${(w2>>>0).toString(16).padStart(8,'0').toUpperCase()}`,
      };
    }

    /**
     * Flash boyutu (KB cinsinden) — kalibre edilmiş gerçek değer.
     * Örn. F030C8 → 64
     */
    async readFlashSize() {
      // F_SIZE 16-bit, ama readMemory32 hizalı; 0x1FFFF7CC = 0x1FFFF7CC zaten 4-hizalı
      const buf = await this.cmd.readMemory32(STM32F0_REG.F_SIZE, 4);
      return buf[0] | (buf[1] << 8);   // KB
    }
  }

  global.Stm32f0       = Stm32f0;
  global.STM32F0_REG   = STM32F0_REG;
})(window);

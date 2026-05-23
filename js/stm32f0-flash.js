/*
 * stm32f0-flash.js — STM32F0 FPEC (Flash Program & Erase Controller) operasyonları
 *
 * Referans: RM0360 §3.3 (Embedded Flash memory)
 *
 *   Register Map (FLASH base = 0x40022000)
 *     +0x00  ACR     Access Control (latency, prefetch)
 *     +0x04  KEYR    Unlock key (KEY1 → KEY2 → unlocked)
 *     +0x08  OPTKEYR Option byte unlock (OPTKEY1 → OPTKEY2)
 *     +0x0C  SR      Status: bit0=BSY, bit2=PGERR, bit4=WRPRTERR, bit5=EOP
 *     +0x10  CR      Control: bit0=PG, bit1=PER, bit2=MER, bit4=OPTPG,
 *                             bit5=OPTER, bit6=STRT, bit7=LOCK, bit9=OPTWRE
 *     +0x14  AR      Address (page erase, programming)
 *     +0x1C  OBR     Option Byte Read (RDP level vs.)
 *     +0x20  WRPR    Write Protection Register
 *
 *   Sıralı operasyonlar:
 *     UNLOCK:  KEYR ← KEY1, KEYR ← KEY2
 *     MASS:    CR.MER=1, CR.STRT=1, wait BSY=0
 *     PAGE:    CR.PER=1, AR=addr, CR.STRT=1, wait BSY=0
 *     PROG:    CR.PG=1, *addr = halfword, wait BSY=0  (yalnız 16-bit yazma!)
 *
 *   Her sequence bitince BUSY=0 görmek ZORUNLU. EOP bayrağı set olur (yazılarak temizlenir).
 */

(function (global) {
  'use strict';

  // FPEC register adresleri
  const FLASH = {
    ACR:     0x40022000,
    KEYR:    0x40022004,
    OPTKEYR: 0x40022008,
    SR:      0x4002200C,
    CR:      0x40022010,
    AR:      0x40022014,
    OBR:     0x4002201C,
    WRPR:    0x40022020,
  };

  // SR bitleri
  const SR_BSY      = 1 << 0;
  const SR_PGERR    = 1 << 2;
  const SR_WRPRTERR = 1 << 4;
  const SR_EOP      = 1 << 5;

  // CR bitleri
  const CR_PG       = 1 << 0;
  const CR_PER      = 1 << 1;
  const CR_MER      = 1 << 2;
  const CR_OPTPG    = 1 << 4;
  const CR_OPTER    = 1 << 5;
  const CR_STRT     = 1 << 6;
  const CR_LOCK     = 1 << 7;
  const CR_OPTWRE   = 1 << 9;

  // Unlock keys (RM0360 §3.3.5)
  const KEY1 = 0x45670123;
  const KEY2 = 0xCDEF89AB;
  const OPTKEY1 = 0x08192A3B;
  const OPTKEY2 = 0x4C5D6E7F;

  // Sayfa boyutu (F030 = 1 KB / sayfa)
  const PAGE_SIZE = 1024;

  class Stm32f0Flash {
    /** @param {StlinkCmd} cmd — Açık ST-Link, SWD mode'da */
    constructor(cmd) {
      this.cmd = cmd;
    }

    // ── Düşük seviye yardımcılar ─────────────────────────────────────────
    //
    // NOT: readDebugReg (APIV2 0x36) eski V2J46 firmware'de garip değerler
    // dönüyor (reserved bitler set, vs.). readMemory32 (0x07) güvenilir.
    // Tüm flash register okumalarını readMemory32 üzerinden yapıyoruz.

    async read32(addr) {
      const buf = await this.cmd.readMemory32(addr, 4);
      return ((buf[0]) | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24)) >>> 0;
    }

    async readSR() { return await this.read32(FLASH.SR); }
    async readCR() { return await this.read32(FLASH.CR); }

    /** BSY bayrağı 0 olana kadar bekle (max timeoutMs). */
    async waitBusy(timeoutMs = 5000) {
      const t0 = performance.now();
      while (true) {
        const sr = await this.readSR();
        if ((sr & SR_BSY) === 0) {
          // BUSY 0 oldu — hata bayraklarını kontrol et
          if (sr & SR_PGERR)    throw new Error('FLASH PGERR — programlama hatası');
          if (sr & SR_WRPRTERR) throw new Error('FLASH WRPRTERR — write-protect engelledi');
          // EOP set ise yazarak temizle (write 1 to clear)
          if (sr & SR_EOP) await this.cmd.writeDebugReg(FLASH.SR, SR_EOP);
          return sr;
        }
        if (performance.now() - t0 > timeoutMs) {
          throw new Error(`FLASH BSY timeout (${timeoutMs} ms) — SR=0x${sr.toString(16)}`);
        }
        await new Promise(r => setTimeout(r, 1));
      }
    }

    // ── Üst seviye operasyonlar ──────────────────────────────────────────

    /** FPEC kilidini aç (KEY1 → KEY2). Reset'ten sonra LOCK=1, yazma için açılmalı. */
    async unlock() {
      // Kilit zaten açık mı kontrol et
      const cr = await this.readCR();
      if ((cr & CR_LOCK) === 0) return;  // Zaten unlocked

      await this.cmd.writeDebugReg(FLASH.KEYR, KEY1);
      await this.cmd.writeDebugReg(FLASH.KEYR, KEY2);

      // Doğrula
      const cr2 = await this.readCR();
      if (cr2 & CR_LOCK) {
        throw new Error(`FPEC unlock başarısız — CR=0x${cr2.toString(16)} (KEYR yanlış veya sıra hatalı)`);
      }
    }

    /** FPEC'yi tekrar kilitle. */
    async lock() {
      const cr = await this.readCR();
      await this.cmd.writeDebugReg(FLASH.CR, cr | CR_LOCK);
    }

    /** Mass erase — tüm flash'ı (boot + app + bytecode + sembol + retentive) sil. */
    async massErase() {
      await this.waitBusy();

      // Diagnostic — gerçek register değerlerini logla
      const sr0 = await this.readSR();
      const cr0 = await this.readCR();
      console.log(`[massErase] başlangıç SR=0x${sr0.toString(16)} CR=0x${cr0.toString(16)}`);

      // CR.MER = 1 (single write: önceki CR + MER bit)
      await this.cmd.writeDebugReg(FLASH.CR, cr0 | CR_MER);

      const cr1 = await this.readCR();
      console.log(`[massErase] MER set sonrası CR=0x${cr1.toString(16)} (MER bit beklenir: 0x4)`);
      if (!(cr1 & CR_MER)) {
        throw new Error(`MER bit set olmadı — CR=0x${cr1.toString(16)}. FPEC kilitli olabilir.`);
      }

      // CR.STRT = 1 (MER + STRT birlikte tetikleme)
      await this.cmd.writeDebugReg(FLASH.CR, cr1 | CR_STRT);

      const cr2 = await this.readCR();
      console.log(`[massErase] STRT set sonrası CR=0x${cr2.toString(16)}`);

      // Bekle (F030 mass erase ~40 ms tipik)
      await this.waitBusy(10000);

      // MER bayrağını temizle
      const cr3 = await this.readCR();
      await this.cmd.writeDebugReg(FLASH.CR, cr3 & ~(CR_MER | CR_STRT));
    }

    /** Tek bir sayfa sil (1 KB). page_addr 1 KB hizalı olmalı. */
    async erasePage(pageAddr) {
      if (pageAddr & (PAGE_SIZE - 1)) {
        throw new Error(`Sayfa adresi ${PAGE_SIZE} byte hizalı olmalı: 0x${pageAddr.toString(16)}`);
      }
      await this.waitBusy();
      let cr = await this.readCR();
      await this.cmd.writeDebugReg(FLASH.CR, cr | CR_PER);
      await this.cmd.writeDebugReg(FLASH.AR, pageAddr);
      cr = await this.readCR();
      await this.cmd.writeDebugReg(FLASH.CR, cr | CR_STRT);
      await this.waitBusy();
      cr = await this.readCR();
      await this.cmd.writeDebugReg(FLASH.CR, cr & ~CR_PER);
    }

    /**
     * Bir veri buffer'ını adres aralığına yaz.
     * F030 sadece 16-bit (half-word) yazma destekler — buffer 2 katı uzunluk gerek.
     * ST-Link WRITEMEM_32BIT komutu otomatik halfword'lere böler (driver işi).
     * NOT: Önce sayfa(lar) silinmiş olmalı (0xFFFF doluyken yazılabilir).
     *
     * @param {number} addr   Flash başlangıç adresi (2-byte hizalı)
     * @param {Uint8Array} data
     */
    async programBuffer(addr, data) {
      if (addr & 1) throw new Error('Adres 2-byte hizalı olmalı');
      if (data.length & 1) throw new Error('Uzunluk 2 katı olmalı');

      await this.waitBusy();
      // CR.PG = 1
      let cr = await this.readCR();
      await this.cmd.writeDebugReg(FLASH.CR, cr | CR_PG);

      // Chunk'lara böl — ST-Link writeMemory32 max 1024 byte
      // Ve adres her zaman 4-byte hizalı olmalı writeMemory32 için
      const CHUNK = 1024;
      let off = 0;
      while (off < data.length) {
        const remaining = data.length - off;
        const chunkLen = Math.min(CHUNK, remaining);

        // 4 byte hizalı değilse padding (writeMemory32 4 katı ister)
        const padded = chunkLen + ((4 - (chunkLen & 3)) & 3);
        const chunkBuf = new Uint8Array(padded);
        chunkBuf.fill(0xFF);  // pad bytes 0xFF (flash erased state — etkisiz)
        chunkBuf.set(data.subarray(off, off + chunkLen));

        await this.cmd.writeMemory32(addr + off, chunkBuf);
        await this.waitBusy();
        off += chunkLen;
      }

      // CR.PG = 0
      cr = await this.readCR();
      await this.cmd.writeDebugReg(FLASH.CR, cr & ~CR_PG);
    }

    /**
     * Yazılan veriyi okuyup karşılaştır (verify).
     * RDP L1 enabled chip'te bu adım fail eder — sadece L0'da çalışır.
     * @returns {object} { match: bool, firstMismatch: number|null }
     */
    async verify(addr, expected) {
      let off = 0;
      while (off < expected.length) {
        const remaining = expected.length - off;
        // Read max 1024, 4-byte aligned
        let chunkLen = Math.min(1024, remaining);
        chunkLen = chunkLen & ~3;  // round down to 4
        if (chunkLen === 0) chunkLen = 4;  // last tiny chunk

        const buf = await this.cmd.readMemory32(addr + off, chunkLen);
        for (let i = 0; i < chunkLen && (off + i) < expected.length; i++) {
          if (buf[i] !== expected[off + i]) {
            return { match: false, firstMismatch: addr + off + i,
                     expected: expected[off + i], got: buf[i] };
          }
        }
        off += chunkLen;
      }
      return { match: true, firstMismatch: null };
    }
  }

  global.Stm32f0Flash = Stm32f0Flash;
  global.STM32F0_FLASH = FLASH;
})(window);

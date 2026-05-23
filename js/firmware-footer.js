/*
 * firmware-footer.js — VILI firmware footer + CRC16 hesaplaması
 *
 * Editor'deki FirmwareUpdateDialog.cs ile birebir aynı format:
 *   - Bin'i APP_FLASH_SIZE (35 KB) boyutuna 0xFF ile pad
 *   - Son 16 byte = footer:
 *       magic    (4B): 0x494C4956 ('VILI', LE)
 *       version  (4B): (major<<16) | (minor<<8) | patch
 *       size     (4B): PAYLOAD_SIZE (= APP_FLASH_SIZE - 16)
 *       crc16    (2B): Modbus CRC16 (poly 0xA001) of payload (footer hariç)
 *       reserved (2B): 0xFFFF
 *
 * Bootloader bu footer'ı arar — geçerliyse app çalıştırır.
 */

(function (global) {
  'use strict';

  // App slot boyutu (bootloader uyumlu) — değişirse hem editor hem firmware
  // linker hem de bootloader app_header.h güncellenmeli.
  const APP_FLASH_SIZE  = 35 * 1024;       // 35 KB
  const FOOTER_SIZE     = 16;
  const PAYLOAD_SIZE    = APP_FLASH_SIZE - FOOTER_SIZE;
  const FOOTER_MAGIC    = 0x494C4956;      // 'VILI' little-endian

  /**
   * Modbus CRC16 (poly 0xA001, init 0xFFFF) — bootloader CRC ile aynı.
   * Editor FirmwareUpdateDialog.CRC16Modbus ile birebir.
   */
  function crc16Modbus(bytes, start = 0, len = bytes.length - start) {
    let crc = 0xFFFF;
    for (let i = 0; i < len; i++) {
      crc ^= bytes[start + i];
      for (let j = 0; j < 8; j++) {
        if (crc & 1) crc = (crc >>> 1) ^ 0xA001;
        else         crc = crc >>> 1;
      }
    }
    return crc & 0xFFFF;
  }

  /**
   * Verilen ham firmware bin'inden tam app image (footer'lı) üret.
   * @param {Uint8Array} rawBin — derlemenin ürettiği bin (max PAYLOAD_SIZE)
   * @param {number} major — 0..255
   * @param {number} minor — 0..255
   * @param {number} patch — 0..255
   * @returns {Uint8Array} APP_FLASH_SIZE byte (footer hazır, flash'a gidecek)
   */
  function buildFirmwareImage(rawBin, major, minor, patch) {
    if (rawBin.length > PAYLOAD_SIZE) {
      throw new Error(`Firmware ${rawBin.length} byte, max ${PAYLOAD_SIZE} byte (${PAYLOAD_SIZE/1024} KB - footer)`);
    }

    // 1) APP_FLASH_SIZE boyutuna 0xFF ile pad
    const img = new Uint8Array(APP_FLASH_SIZE);
    img.fill(0xFF);
    img.set(rawBin);

    // 2) CRC16 (payload, footer hariç)
    const crc = crc16Modbus(img, 0, PAYLOAD_SIZE);

    // 3) Footer yaz (LE)
    const version = ((major & 0xFF) << 16) | ((minor & 0xFF) << 8) | (patch & 0xFF);
    const off = PAYLOAD_SIZE;
    const dv = new DataView(img.buffer);
    dv.setUint32(off + 0, FOOTER_MAGIC, true);  // magic
    dv.setUint32(off + 4, version,      true);  // version
    dv.setUint32(off + 8, PAYLOAD_SIZE, true);  // size
    dv.setUint16(off + 12, crc,         true);  // crc16
    dv.setUint16(off + 14, 0xFFFF,      true);  // reserved

    return img;
  }

  /**
   * Bir tam app image'in footer'ını parse et (test/inspection için).
   */
  function readFooter(image) {
    if (image.length < APP_FLASH_SIZE) return null;
    const dv = new DataView(image.buffer, image.byteOffset, image.byteLength);
    const off = PAYLOAD_SIZE;
    return {
      magic:    dv.getUint32(off + 0, true),
      version:  dv.getUint32(off + 4, true),
      size:     dv.getUint32(off + 8, true),
      crc16:    dv.getUint16(off + 12, true),
      reserved: dv.getUint16(off + 14, true),
      magicValid: dv.getUint32(off + 0, true) === FOOTER_MAGIC,
      computedCrc: crc16Modbus(image, 0, PAYLOAD_SIZE),
    };
  }

  global.FirmwareFooter = {
    APP_FLASH_SIZE,
    FOOTER_SIZE,
    PAYLOAD_SIZE,
    FOOTER_MAGIC,
    crc16Modbus,
    buildFirmwareImage,
    readFooter,
  };
})(window);

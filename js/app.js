/*
 * app.js — UI orkestrasyonu (event handler'lar, log, state)
 *
 * Sorumluluğu:
 *  - Buton click → StlinkUsb + StlinkCmd çağrıları
 *  - Log paneline yazma
 *  - UI state güncelleme (status dot, button enable/disable)
 *
 * İş mantığı yok — sadece UI ile alt katman arasında köprü.
 */

(function () {
  'use strict';

  // ── DOM elemanları ─────────────────────────────────────────────────────
  const elLog          = document.getElementById('log');
  const elBrowserWarn  = document.getElementById('browserWarn');
  const elDotStlink    = document.getElementById('dotStlink');
  const elStatus       = document.getElementById('stlinkStatus');
  const elVersion      = document.getElementById('stlinkVersion');
  const elVidPid       = document.getElementById('stlinkVidPid');
  const elBtnConnect   = document.getElementById('btnConnect');
  const elBtnDisconnect= document.getElementById('btnDisconnect');
  const elBtnClearLog  = document.getElementById('btnClearLog');
  const elBtnReadChip  = document.getElementById('btnReadChip');
  const elDotTarget    = document.getElementById('dotTarget');
  const elTgtVoltage   = document.getElementById('tgtVoltage');
  const elTgtModel     = document.getElementById('tgtModel');
  const elTgtDevRev    = document.getElementById('tgtDevRev');
  const elTgtFlash     = document.getElementById('tgtFlash');
  const elTgtUid       = document.getElementById('tgtUid');
  // Flash kart
  const elDotFlash     = document.getElementById('dotFlash');
  const elBtnMassErase = document.getElementById('btnMassErase');
  const elBtnHalt      = document.getElementById('btnHalt');
  const elBtnRun       = document.getElementById('btnRun');
  const elBtnReset     = document.getElementById('btnReset');

  // Flash butonlarını topluca kontrol
  function setFlashButtonsEnabled(en) {
    elBtnMassErase.disabled = !en;
    elBtnHalt.disabled      = !en;
    elBtnRun.disabled       = !en;
    elBtnReset.disabled     = !en;
  }

  // ── State ──────────────────────────────────────────────────────────────
  const usb = new StlinkUsb();
  let   cmd = null;

  // ── Log helpers ────────────────────────────────────────────────────────
  function log(msg, cls) {
    const time = new Date().toLocaleTimeString('tr-TR', { hour12: false }) +
                 '.' + String(new Date().getMilliseconds()).padStart(3, '0');
    const span = document.createElement('div');
    span.innerHTML =
      `<span class="log-time">[${time}]</span> ` +
      `<span class="log-${cls || 'info'}">${escapeHtml(msg)}</span>`;
    elLog.appendChild(span);
    elLog.scrollTop = elLog.scrollHeight;
  }
  const logInfo = (m) => log(m, 'info');
  const logOk   = (m) => log(m, 'ok');
  const logWarn = (m) => log(m, 'warn');
  const logErr  = (m) => log(m, 'err');

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  }

  // ── UI state ───────────────────────────────────────────────────────────
  function setConnectedUI(info) {
    elDotStlink.className = 'status-dot on';
    elStatus.textContent  = 'Bağlı';
    elStatus.classList.remove('empty');
    elVidPid.textContent  = `0x${info.vendorId.toString(16).padStart(4,'0').toUpperCase()} / 0x${info.productId.toString(16).padStart(4,'0').toUpperCase()}`;
    elVidPid.classList.remove('empty');
    elBtnConnect.disabled = true;
    elBtnDisconnect.disabled = false;
  }
  function setVersionUI(ver) {
    elVersion.textContent = ver.formatted + ` (J${ver.jtagVersion}` +
                            (ver.swimVersion !== undefined ? `, S${ver.swimVersion}` : '') + ')';
    elVersion.classList.remove('empty');
  }
  function setDisconnectedUI() {
    elDotStlink.className = 'status-dot';
    elStatus.textContent  = 'Bağlı değil';
    elStatus.classList.add('empty');
    elVersion.textContent = '—';
    elVersion.classList.add('empty');
    elVidPid.textContent  = '—';
    elVidPid.classList.add('empty');
    elBtnConnect.disabled = false;
    elBtnDisconnect.disabled = true;
    elBtnReadChip.disabled = true;
    setFlashButtonsEnabled(false);
    elDotFlash.className = 'status-dot';
    clearTargetUI();
  }
  function clearTargetUI() {
    elDotTarget.className = 'status-dot';
    [elTgtVoltage, elTgtModel, elTgtDevRev, elTgtFlash, elTgtUid].forEach(el => {
      el.textContent = '—';
      el.classList.add('empty');
    });
  }
  function setTargetUI(info) {
    elDotTarget.className = 'status-dot on';
    if (info.voltage !== undefined) {
      elTgtVoltage.textContent = info.voltage.toFixed(2) + ' V';
      elTgtVoltage.classList.remove('empty');
    }
    if (info.chip) {
      elTgtModel.textContent = info.chip.modelName;
      elTgtModel.classList.remove('empty');
      elTgtDevRev.textContent = `0x${info.chip.devId.toString(16).toUpperCase()} / ${info.chip.revName}`;
      elTgtDevRev.classList.remove('empty');
    }
    if (info.flashSize !== undefined) {
      elTgtFlash.textContent = info.flashSize + ' KB';
      elTgtFlash.classList.remove('empty');
    }
    if (info.uid) {
      elTgtUid.textContent = info.uid.pretty;
      elTgtUid.classList.remove('empty');
    }
  }
  function setErrorUI() {
    elDotStlink.className = 'status-dot err';
  }

  // ── Browser desteği kontrolü ───────────────────────────────────────────
  if (!navigator.usb) {
    elBrowserWarn.style.display = 'block';
    elBtnConnect.disabled = true;
    logErr('Bu tarayıcıda WebUSB yok. Chrome/Edge gerekli.');
  } else {
    logInfo('WebUSB destekleniyor. ST-Link\'e bağlanmak için butonu kullan.');
  }

  // ── Event: Bağlan ──────────────────────────────────────────────────────
  elBtnConnect.addEventListener('click', async () => {
    elBtnConnect.disabled = true;
    try {
      logInfo('ST-Link cihazı seçiliyor…');
      const info = await usb.requestAndOpen();
      logOk(`Bağlandı: ${info.product || 'ST-Link'} ` +
            `(variant: ${info.variant}, EP_OUT=${info.epOut}, EP_IN=${info.epIn})`);
      if (info.serial)       logInfo(`Seri No: ${info.serial}`);
      if (info.manufacturer) logInfo(`Üretici: ${info.manufacturer}`);
      setConnectedUI(info);

      // Hemen versiyon oku — bağlantı doğrulamış olur
      cmd = new StlinkCmd(usb);
      logInfo('Versiyon okunuyor…');
      const ver = await cmd.getVersion();
      logOk(`Versiyon: ${ver.formatted} ` +
            `(stlink=${ver.stlinkVersion}, jtag=${ver.jtagVersion}` +
            (ver.swimVersion !== undefined ? `, swim=${ver.swimVersion}` : '') + ')');
      setVersionUI(ver);

      // Chip okuma + flash butonları artık aktif
      elBtnReadChip.disabled = false;
      setFlashButtonsEnabled(true);
    } catch (e) {
      logErr('Bağlantı hatası: ' + e.message);
      setErrorUI();
      try { await usb.close(); } catch {}
      elBtnConnect.disabled = false;
      elBtnDisconnect.disabled = true;
    }
  });

  // Tek bir USB komutunu retry ile dene; ST-Link bazen ilk denemede STALL döner.
  async function withRetry(label, fn, tries = 2) {
    let lastErr;
    for (let i = 1; i <= tries; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        logWarn(`${label} — deneme ${i}/${tries} başarısız: ${e.message}`);
        await new Promise(r => setTimeout(r, 100));
      }
    }
    throw lastErr;
  }

  // ── Event: Chip Bilgisi Oku ───────────────────────────────────────────
  elBtnReadChip.addEventListener('click', async () => {
    if (!cmd) { logErr('Önce ST-Link\'e bağlan.'); return; }
    elBtnReadChip.disabled = true;
    clearTargetUI();
    let voltage; // opsiyonel
    try {
      // 1) Mevcut modu kontrol et — ST-Link genelde başta DFU modunda
      let mode;
      try {
        mode = await cmd.getCurrentMode();
        logInfo(`ST-Link mode: ${mode.modeName} (0x${mode.mode.toString(16)})`);
      } catch (e) {
        logWarn(`Mode okunamadı (önemli değil): ${e.message}`);
      }

      // 1b) DFU modunda ise EXIT — diğer komutlar çalışmaz çünkü USB bootloader'ı dinliyor
      if (mode && mode.mode === STLINK_MODE.DFU) {
        logInfo('DFU modunda — çıkış komutu gönderiliyor…');
        await cmd.exitDfuMode();
        // Tekrar kontrol et — yeni mode ne?
        try {
          const newMode = await cmd.getCurrentMode();
          logOk(`Yeni mode: ${newMode.modeName} (0x${newMode.mode.toString(16)})`);
        } catch (e) {
          logWarn('Mode tekrar okunamadı, devam ediyoruz: ' + e.message);
        }
      }

      // 2) Besleme voltajı (opsiyonel — fail olursa devam et)
      try {
        logInfo('Hedef besleme ölçülüyor…');
        voltage = await withRetry('VAREF', () => cmd.getTargetVoltage());
        logInfo(`VAREF: ${voltage.toFixed(3)} V`);
        if (voltage < 1.0) {
          logWarn(`Hedef MCU besleme çok düşük (${voltage.toFixed(2)} V) — devam ediyoruz ama chip cevap vermeyebilir`);
        }
      } catch (e) {
        logWarn(`Voltaj okunamadı (devam ediyoruz): ${e.message}`);
      }

      // 3) SWD mode'a gir (retry ile)
      logInfo('SWD mode\'a giriliyor…');
      const enterResp = await withRetry('Enter SWD', () => cmd.enterSwdMode());
      logInfo(`Enter SWD: status=0x${enterResp.status.toString(16)} ` +
              `[${Array.from(enterResp.raw).map(b => b.toString(16).padStart(2,'0')).join(' ')}]`);

      // 4) DAP IDCODE (chip CoreSight ID)
      logInfo('DAP IDCODE okunuyor…');
      const id = await withRetry('Read IDCODE', () => cmd.readIdCodes());
      logInfo(`DAP IDCODE: 0x${id.idcode.toString(16).padStart(8,'0').toUpperCase()}`);
      if (id.idcode === 0x0BB11477) {
        logOk('Cortex-M0 tespit edildi (STM32F0 ailesi).');
      } else if (id.idcode === 0) {
        logErr('IDCODE = 0 → chip cevap vermiyor. SWD kabloları takılı mı? PCB enerji var mı?');
        elDotTarget.className = 'status-dot err';
        return;
      } else {
        logWarn(`Beklenmeyen IDCODE — F0 değil veya farklı revizyon.`);
      }

      // 5) STM32F0 spesifik bilgiler
      const stm = new Stm32f0(cmd);

      logInfo('DBGMCU_IDCODE okunuyor…');
      const chip = await withRetry('Chip ID', () => stm.readChipId());
      logOk(`Chip: ${chip.modelName}  (DEV_ID=0x${chip.devId.toString(16).toUpperCase()}, ${chip.revName})`);

      logInfo('Flash boyutu okunuyor…');
      const flashSize = await withRetry('Flash size', () => stm.readFlashSize());
      logOk(`Flash: ${flashSize} KB`);

      logInfo('UID okunuyor…');
      const uid = await withRetry('UID', () => stm.readUid());
      logOk(`UID: ${uid.pretty}`);

      // UI'ı güncelle
      setTargetUI({ voltage, chip, flashSize, uid });
    } catch (e) {
      logErr('Chip okuma hatası: ' + e.message);
      elDotTarget.className = 'status-dot err';
    } finally {
      elBtnReadChip.disabled = false;
    }
  });

  // ── ortak — DFU çıkışı + SWD enter (flash öncesi setup) ───────────────
  async function prepareDebugMode() {
    const mode = await cmd.getCurrentMode();
    if (mode.mode === STLINK_MODE.DFU) {
      logInfo('DFU mode → çıkış…');
      await cmd.exitDfuMode();
    }
    const after = await cmd.getCurrentMode();
    if (after.mode !== STLINK_MODE.DEBUG) {
      logInfo(`Mode: ${after.modeName}, SWD'ye geçiliyor…`);
      await cmd.enterSwdMode();
    }
  }

  // ── Event: Mass Erase ─────────────────────────────────────────────────
  elBtnMassErase.addEventListener('click', async () => {
    if (!cmd) return;
    const ok = confirm(
      '⚠️ TÜM FLASH SİLİNECEK\n\n' +
      'Bootloader + Firmware + Bytecode + Sembol — hepsi silinir.\n' +
      'PCB yeniden programlanmadan ÇALIŞMAZ.\n\n' +
      'Emin misin?'
    );
    if (!ok) return;

    setFlashButtonsEnabled(false);
    elDotFlash.className = 'status-dot';
    try {
      await prepareDebugMode();

      const flash = new Stm32f0Flash(cmd);

      logInfo('CPU halt ediliyor…');
      await cmd.halt();
      logOk('CPU halted.');

      logInfo('FPEC unlock…');
      await flash.unlock();
      logOk('FPEC unlocked.');

      const t0 = performance.now();
      logInfo('Mass erase başlıyor… (40-100 ms beklenir)');
      await flash.massErase();
      const elapsed = performance.now() - t0;
      logOk(`Mass erase tamam — ${elapsed.toFixed(0)} ms.`);

      // Doğrulama: ilk 32 byte'ı oku, hepsi 0xFF olmalı
      logInfo('Doğrulama — ilk 32 byte okunuyor…');
      const buf = await cmd.readMemory32(0x08000000, 32);
      const allFF = buf.every(b => b === 0xFF);
      if (allFF) {
        logOk('Doğrulama OK — flash tamamen 0xFF.');
        elDotFlash.className = 'status-dot on';
      } else {
        logErr('Doğrulama FAIL — flash'  +
          ' tam silinmemiş. İlk byte: 0x' + buf[0].toString(16).toUpperCase());
        elDotFlash.className = 'status-dot err';
      }

      await flash.lock();
      logInfo('FPEC kilitlendi.');
    } catch (e) {
      logErr('Mass erase hatası: ' + e.message);
      elDotFlash.className = 'status-dot err';
    } finally {
      setFlashButtonsEnabled(true);
    }
  });

  // ── Event: CPU Halt ───────────────────────────────────────────────────
  elBtnHalt.addEventListener('click', async () => {
    if (!cmd) return;
    try {
      await prepareDebugMode();
      await cmd.halt();
      logOk('CPU halted.');
    } catch (e) { logErr('Halt hatası: ' + e.message); }
  });

  // ── Event: CPU Run ────────────────────────────────────────────────────
  elBtnRun.addEventListener('click', async () => {
    if (!cmd) return;
    try {
      await cmd.run();
      logOk('CPU running.');
    } catch (e) { logErr('Run hatası: ' + e.message); }
  });

  // ── Event: System Reset ───────────────────────────────────────────────
  elBtnReset.addEventListener('click', async () => {
    if (!cmd) return;
    try {
      await cmd.systemReset();
      logOk('System reset gönderildi.');
    } catch (e) { logErr('Reset hatası: ' + e.message); }
  });

  // ── Event: Bağlantıyı kes ──────────────────────────────────────────────
  elBtnDisconnect.addEventListener('click', async () => {
    elBtnDisconnect.disabled = true;
    try {
      await usb.close();
      cmd = null;
      logInfo('Bağlantı kesildi.');
      setDisconnectedUI();
    } catch (e) {
      logErr('Kapatma hatası: ' + e.message);
    }
  });

  // ── Event: Logu temizle ────────────────────────────────────────────────
  elBtnClearLog.addEventListener('click', () => {
    elLog.innerHTML = '';
    logInfo('Log temizlendi.');
  });

  // ── Sayfa kapanırken cihazı serbest bırak ─────────────────────────────
  window.addEventListener('beforeunload', () => {
    if (usb.isOpen) usb.close().catch(() => {});
  });
})();

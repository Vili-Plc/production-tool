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
  const elBinFile      = document.getElementById('binFile');
  const elBinFileInfo  = document.getElementById('binFileInfo');
  const elBinAddr      = document.getElementById('binAddr');
  const elBtnProgram   = document.getElementById('btnProgram');
  // Üretim akışı
  const elDotProd       = document.getElementById('dotProd');
  const elProdBootFile  = document.getElementById('prodBootFile');
  const elProdBootInfo  = document.getElementById('prodBootInfo');
  const elProdFwFile    = document.getElementById('prodFwFile');
  const elProdFwInfo    = document.getElementById('prodFwInfo');
  const elProdMajor     = document.getElementById('prodMajor');
  const elProdMinor     = document.getElementById('prodMinor');
  const elProdPatch     = document.getElementById('prodPatch');
  const elBtnProduce    = document.getElementById('btnProduce');
  const elProdOperator  = document.getElementById('prodOperator');
  const elProdNotes     = document.getElementById('prodNotes');
  const elApiStatusText = document.getElementById('apiStatusText');

  let prodBoot = null;  // { name, bytes }
  let prodFw   = null;
  let lastReadUid = null;  // Chip Bilgisi Oku sonucundan

  // Apps Script API
  const api = new ProductionApi();

  // Seçilen bin dosyasının içeriği (RAM'de tutulur)
  let selectedBin = null;  // { name, bytes: Uint8Array }

  // Flash butonlarını topluca kontrol
  function setFlashButtonsEnabled(en) {
    elBtnMassErase.disabled = !en;
    elBtnHalt.disabled      = !en;
    elBtnRun.disabled       = !en;
    elBtnReset.disabled     = !en;
    // Program + Üret butonu file VE bağlantı VE adres geçerli ise aktif
    updateProgramButton();
    updateProduceButton();
  }

  function updateProgramButton() {
    const ok = !!cmd && !!selectedBin && parseAddr(elBinAddr.value) !== null;
    elBtnProgram.disabled = !ok;
  }

  function updateProduceButton() {
    elBtnProduce.disabled = !(cmd && prodBoot && prodFw);
  }

  function parseAddr(s) {
    const v = parseInt((s || '').trim(), 16);
    if (isNaN(v) || v < 0) return null;
    return v;
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
      lastReadUid = uid;  // Production akışında Sheet'e kayıt için kullanılır

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

  // ── Event: File picker — bin dosyası seçildi ──────────────────────────
  elBinFile.addEventListener('change', async () => {
    const f = elBinFile.files[0];
    if (!f) {
      selectedBin = null;
      elBinFileInfo.textContent = '';
      updateProgramButton();
      return;
    }
    try {
      const buf = await f.arrayBuffer();
      selectedBin = { name: f.name, bytes: new Uint8Array(buf) };
      elBinFileInfo.textContent =
        `${f.name} — ${selectedBin.bytes.length} byte (${(selectedBin.bytes.length/1024).toFixed(2)} KB)`;
      logInfo(`Dosya seçildi: ${f.name} (${selectedBin.bytes.length} byte)`);
      updateProgramButton();
    } catch (e) {
      logErr('Dosya okuma hatası: ' + e.message);
      selectedBin = null;
      updateProgramButton();
    }
  });

  elBinAddr.addEventListener('input', updateProgramButton);

  // ── Event: Erase + Program + Verify ───────────────────────────────────
  elBtnProgram.addEventListener('click', async () => {
    if (!cmd || !selectedBin) return;
    const addr = parseAddr(elBinAddr.value);
    if (addr === null) { logErr('Adres geçersiz'); return; }

    // Confirm — yazılan adres bootloader değilse uyarma yok; bootloader silinecekse uyar
    if (addr === 0x08000000) {
      const ok = confirm(
        `Bootloader alanı (0x08000000) programlanacak.\n\n` +
        `Dosya: ${selectedBin.name} (${selectedBin.bytes.length} byte)\n\n` +
        `Mevcut bootloader silinip yenisi yazılacak. Devam edilsin mi?`);
      if (!ok) return;
    }

    setFlashButtonsEnabled(false);
    elDotFlash.className = 'status-dot';
    try {
      await prepareDebugMode();

      const flash = new Stm32f0Flash(cmd);
      logInfo('CPU halt…');           await cmd.halt();
      logInfo('FPEC unlock…');        await flash.unlock();

      logInfo(`Erase + Program + Verify: 0x${addr.toString(16).toUpperCase()} ← ${selectedBin.name} (${selectedBin.bytes.length} byte)`);
      const t0 = performance.now();

      const result = await flash.eraseProgramVerify(addr, selectedBin.bytes, (stage, cur, tot) => {
        // Erase sayfa sayfa, program her chunk
        if (stage === 'erase') {
          logInfo(`  Erase: sayfa ${cur}/${tot}`);
        }
        if (stage === 'program') {
          logInfo(`  Program: ${cur}/${tot} byte`);
        }
        if (stage === 'verify') {
          logInfo(`  Verify: ${cur}/${tot} byte (read-back karşılaştırma)`);
        }
      });

      const elapsed = performance.now() - t0;

      if (result.match) {
        logOk(`✓ Program + Verify OK — ${elapsed.toFixed(0)} ms (${(selectedBin.bytes.length/elapsed*1000).toFixed(0)} byte/sn)`);
        elDotFlash.className = 'status-dot on';
      } else {
        logErr(`✗ Verify FAIL — adres 0x${result.firstMismatch.toString(16).toUpperCase()}: ` +
               `beklenen 0x${result.expected.toString(16)}, okunan 0x${result.got.toString(16)}`);
        elDotFlash.className = 'status-dot err';
      }

      await flash.lock();
      logInfo('FPEC kilitlendi.');
    } catch (e) {
      logErr('Program hatası: ' + e.message);
      elDotFlash.className = 'status-dot err';
    } finally {
      setFlashButtonsEnabled(true);
    }
  });

  // ── Üretim akışı: file pickers ──────────────────────────────────────
  async function loadProdFile(input, infoEl, target) {
    const f = input.files[0];
    if (!f) {
      if (target === 'boot') prodBoot = null;
      else                   prodFw   = null;
      infoEl.textContent = '';
      updateProduceButton();
      return;
    }
    const buf = await f.arrayBuffer();
    const entry = { name: f.name, bytes: new Uint8Array(buf) };
    if (target === 'boot') prodBoot = entry;
    else                   prodFw   = entry;
    infoEl.textContent = `${f.name} — ${entry.bytes.length} byte`;
    updateProduceButton();
  }
  elProdBootFile.addEventListener('change', () =>
    loadProdFile(elProdBootFile, elProdBootInfo, 'boot'));
  elProdFwFile.addEventListener('change', () =>
    loadProdFile(elProdFwFile, elProdFwInfo, 'fw'));

  // ── Event: PCB Üret (tam akış) ──────────────────────────────────────
  elBtnProduce.addEventListener('click', async () => {
    if (!cmd || !prodBoot || !prodFw) return;

    const major = parseInt(elProdMajor.value, 10) || 0;
    const minor = parseInt(elProdMinor.value, 10) || 0;
    const patch = parseInt(elProdPatch.value, 10) || 0;

    if (!confirm(
      `⚙️ PCB ÜRETİM AKIŞI BAŞLAYACAK\n\n` +
      `1. Mass Erase\n` +
      `2. Bootloader yaz @ 0x08000000 (${prodBoot.bytes.length} byte)\n` +
      `3. Firmware yaz @ 0x08001000 (${prodFw.bytes.length} byte → 35 KB + footer v${major}.${minor}.${patch})\n` +
      `4. System Reset\n\n` +
      `Devam edilsin mi?`
    )) return;

    const operator = (elProdOperator.value || '').trim();
    if (!operator) {
      alert('⚠️ Operatör adı boş bırakılamaz.\nSheet kaydı için operatörü gir (Adın).');
      return;
    }

    setFlashButtonsEnabled(false);
    elDotProd.className = 'status-dot';
    const t0 = performance.now();
    let uidStr = '';  // Sheet kaydı için
    try {
      await prepareDebugMode();

      const flash = new Stm32f0Flash(cmd);
      const stm   = new Stm32f0(cmd);
      logInfo('━━━━━━━ PCB ÜRETİM BAŞLADI ━━━━━━━');

      // 0) UID oku — Sheet'e kayıt için (her PCB benzersiz)
      logInfo('[0/5] UID okunuyor…');
      const uid = await stm.readUid();
      uidStr = uid.pretty;
      logOk('  UID: ' + uidStr);

      // 0b) DUPLICATE KONTROL — bu UID daha önce üretildiyse onay sor
      logInfo('  Sunucuda UID kontrolü…');
      let isReflash = false;
      try {
        const check = await api.checkUid(uidStr);
        if (check.registered) {
          const d = check.detail;
          const dateStr = new Date(d.lastDate).toLocaleString('tr-TR');
          logWarn(`  ⚠ Bu UID zaten kayıtlı (${d.count} kez)`);
          logInfo(`     Son: ${dateStr} — ${d.lastFirmware} — ${d.lastOperator} — ${d.lastStatus}`);

          const reflashOk = confirm(
            `⚠️ BU PCB ÖNCEDEN ÜRETİLMİŞ\n\n` +
            `UID: ${uidStr}\n` +
            `Daha önce: ${d.count} kez üretildi\n` +
            `Son kayıt: ${dateStr}\n` +
            `Son firmware: ${d.lastFirmware}\n` +
            `Son operatör: ${d.lastOperator}\n` +
            `Son durum: ${d.lastStatus}\n\n` +
            `REFLASH yapılacak (yeni satır eklenir, status: REFLASH).\n\n` +
            `Devam edilsin mi?`
          );
          if (!reflashOk) {
            logInfo('Üretim iptal edildi (operatör reddetti).');
            return;
          }
          isReflash = true;
          logInfo('  → REFLASH modunda devam ediliyor.');
        } else {
          logOk('  ✓ Yeni PCB — daha önce kayıt yok.');
        }
      } catch (apiErr) {
        // API erişilemezse uyar ama devam et — production durmasın
        logWarn('  ⚠ UID kontrol yapılamadı: ' + apiErr.message);
        if (!confirm('UID kontrolü başarısız — sunucu erişilemiyor.\n\nUçar olsun üretime devam edeyim mi? (duplicate riski)')) {
          return;
        }
      }

      // 1) Mass Erase
      logInfo('[1/5] Mass Erase…');
      await cmd.halt();
      await flash.unlock();
      await flash.massErase();
      logOk('  Mass erase tamam.');

      // 2) Bootloader yaz
      logInfo(`[2/5] Bootloader yaz @ 0x08000000 (${prodBoot.bytes.length} byte)…`);
      let r = await flash.eraseProgramVerify(0x08000000, prodBoot.bytes, (stage, c, t) => {
        if (stage === 'erase')   logInfo(`    Erase ${c}/${t}`);
        if (stage === 'program') logInfo(`    Program ${c}/${t} byte`);
      });
      if (!r.match) {
        throw new Error(`Bootloader verify fail @ 0x${r.firstMismatch.toString(16)}`);
      }
      logOk('  Bootloader OK.');

      // 3) Firmware — footer ekle + yaz
      logInfo(`[3/5] Firmware footer ekleniyor (v${major}.${minor}.${patch})…`);
      const fwImage = FirmwareFooter.buildFirmwareImage(prodFw.bytes, major, minor, patch);
      const footer  = FirmwareFooter.readFooter(fwImage);
      logInfo(`  Footer: magic=0x${footer.magic.toString(16).toUpperCase()}, ` +
              `ver=0x${footer.version.toString(16)}, size=${footer.size}, ` +
              `crc=0x${footer.crc16.toString(16).toUpperCase()}`);

      logInfo(`  Firmware yaz @ 0x08001000 (${fwImage.length} byte)…`);
      r = await flash.eraseProgramVerify(0x08001000, fwImage, (stage, c, t) => {
        if (stage === 'erase')   logInfo(`    Erase ${c}/${t}`);
        if (stage === 'program' && (c % 4096 === 0 || c === t)) {
          logInfo(`    Program ${c}/${t} byte`);
        }
      });
      if (!r.match) {
        throw new Error(`Firmware verify fail @ 0x${r.firstMismatch.toString(16)}`);
      }
      logOk('  Firmware OK.');

      // 4) Reset
      logInfo('[4/5] System Reset…');
      await flash.lock();
      await cmd.systemReset();
      logOk('  Reset gönderildi.');

      // 5) Sunucu kaydı (Apps Script → Google Sheet)
      logInfo('[5/5] Sunucuya kayıt yolanıyor…');
      try {
        const regResult = await api.registerPlc({
          uid:        uidStr,
          model:      'Vili2 Mini PLC',
          bootloader: `${prodBoot.name} (${prodBoot.bytes.length} byte)`,
          firmware:   `v${major}.${minor}.${patch} — ${prodFw.name}`,
          operator:   operator,
          status:     isReflash ? 'REFLASH' : 'OK',  // ← duplicate ise REFLASH
          notes:      (elProdNotes.value || '').trim(),
        });
        logOk('  ✓ Sheet kaydı: satır ' + regResult.rowNumber +
              (isReflash ? ' (REFLASH)' : ''));
      } catch (regErr) {
        logWarn('  ⚠ Sunucu kayıt hatası: ' + regErr.message + ' (PCB çalışıyor, ama log kaydı yapılamadı)');
      }

      const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
      logOk(`━━━━━━━ ✓ ÜRETİM TAMAM (${elapsed} sn) ━━━━━━━`);
      elDotProd.className = 'status-dot on';

      alert(`✓ PCB üretildi (${elapsed} sn)\n\n` +
            `UID: ${uidStr}\n` +
            `Bootloader: ${prodBoot.bytes.length} byte\n` +
            `Firmware: v${major}.${minor}.${patch}\n` +
            `Operator: ${operator}\n\n` +
            `PCB enerji aldığında app çalışmalı.\nKayıt Google Sheet'e eklendi.`);
    } catch (e) {
      logErr('Üretim hatası: ' + e.message);
      elDotProd.className = 'status-dot err';

      // FAIL kaydı (UID okuduysak) — bootloader/firmware bilgisini de yaz
      if (uidStr) {
        try {
          await api.registerPlc({
            uid:        uidStr,
            model:      'Vili2 Mini PLC',
            bootloader: prodBoot ? `${prodBoot.name} (${prodBoot.bytes.length} byte)` : '',
            firmware:   prodFw   ? `v${major}.${minor}.${patch} — ${prodFw.name}` : '',
            operator:   operator,
            status:     isReflash ? 'FAIL-REFLASH' : 'FAIL',
            notes:      e.message,
          });
          logInfo('  FAIL kaydı Sheet\'e eklendi');
        } catch {}
      }
      alert('❌ Üretim başarısız:\n' + e.message);
    } finally {
      setFlashButtonsEnabled(true);
    }
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

  // ── Sayfa açılışında API ping ──────────────────────────────────────────
  (async () => {
    try {
      const r = await api.ping();
      elApiStatusText.textContent = '✓ Hazır (' + r.msg + ')';
      elApiStatusText.style.color = '#4caf50';
      logOk('Sunucu API: ' + r.msg + ' (v' + r.version + ')');
    } catch (e) {
      elApiStatusText.textContent = '✗ Erişilemiyor: ' + e.message;
      elApiStatusText.style.color = '#f44336';
      logErr('Sunucu API erişilemiyor: ' + e.message + ' — internet bağlantısını kontrol et');
    }
  })();
})();

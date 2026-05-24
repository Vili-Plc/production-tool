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

  // ── TOOL VERSION ──────────────────────────────────────────────────────
  // Her release'de artır + HTML'deki ?v=N script tag'lerini de aynı sayıya çevir.
  // Cache invalidation + sürüm gösterimi için tek kaynak.
  const TOOL_VERSION = 'v24';

  // ── Auth state (localStorage'da tutulur — sayfa yenilenince devam) ────
  const AUTH_KEY = 'vili_plc_auth';
  function getAuth() {
    try { const j = localStorage.getItem(AUTH_KEY); return j ? JSON.parse(j) : null; }
    catch { return null; }
  }
  function setAuth(user, role) {
    try { localStorage.setItem(AUTH_KEY, JSON.stringify({ user, role })); } catch {}
  }
  function clearAuth() {
    try { localStorage.removeItem(AUTH_KEY); } catch {}
  }
  let currentUser = null;
  let currentRole = null;

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
  // Üretim akışı (bin'ler Drive'dan otomatik geliyor, eski file picker kaldırıldı)
  const elDotProd       = document.getElementById('dotProd');
  const elProdMajor     = document.getElementById('prodMajor');
  const elProdMinor     = document.getElementById('prodMinor');
  const elProdPatch     = document.getElementById('prodPatch');
  const elBtnProduce    = document.getElementById('btnProduce');
  const elProdOperator  = document.getElementById('prodOperator');
  const elProdNotes     = document.getElementById('prodNotes');
  const elApiStatusText = document.getElementById('apiStatusText');
  const elApiUrlInput   = document.getElementById('apiUrlInput');
  const elBtnSaveApiUrl = document.getElementById('btnSaveApiUrl');
  // Login
  const elLoginOverlay  = document.getElementById('loginOverlay');
  const elLoginUser     = document.getElementById('loginUser');
  const elLoginPass     = document.getElementById('loginPass');
  const elLoginErr      = document.getElementById('loginErr');
  const elBtnLogin      = document.getElementById('btnLogin');
  const elBadgeUser     = document.getElementById('badgeUser');
  const elBadgeRole     = document.getElementById('badgeRole');
  const elBtnLogout     = document.getElementById('btnLogout');
  // Kullanıcı yönetimi
  const elUserList      = document.getElementById('userList');
  const elNewUserName   = document.getElementById('newUserName');
  const elNewUserPass   = document.getElementById('newUserPass');
  const elNewUserRole   = document.getElementById('newUserRole');
  const elBtnAddUser    = document.getElementById('btnAddUser');
  // Slave büyük buton
  const elBtnProduceSlave = document.getElementById('btnProduceSlave');
  // PLC Model
  const elPlcModel        = document.getElementById('plcModel');
  // Heartbeat
  const elHeartbeatStatus = document.getElementById('heartbeatStatus');

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
    // Bin dosyaları Drive'dan otomatik çekiliyor, sadece ST-Link bağlı olsun
    elBtnProduce.disabled = !cmd;
    elBtnProduceSlave.disabled = !cmd;
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

  // ── Tool versiyonunu HTML'e yaz ───────────────────────────────────────
  const elToolVersion = document.getElementById('toolVersion');
  if (elToolVersion) elToolVersion.textContent = TOOL_VERSION;

  // ── Browser desteği kontrolü ───────────────────────────────────────────
  if (!navigator.usb) {
    elBrowserWarn.style.display = 'block';
    elBtnConnect.disabled = true;
    logErr('Bu tarayıcıda WebUSB yok. Chrome/Edge gerekli.');
  } else {
    logInfo('Vili-Plc Üretim Tool ' + TOOL_VERSION + ' — WebUSB destekleniyor.');
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

  // ── (Eski file picker kaldırıldı — bin'ler artık Drive'dan otomatik geliyor) ──
  // prodBoot ve prodFw API.fetchBin sonucundan doldurulur (üretim akışında).

  // ── Event: PCB Üret (tam akış — bin'leri Drive'dan otomatik çek) ──
  elBtnProduce.addEventListener('click', async () => {
    if (!cmd) return;

    const major = parseInt(elProdMajor.value, 10) || 0;
    const minor = parseInt(elProdMinor.value, 10) || 0;
    const patch = parseInt(elProdPatch.value, 10) || 0;
    const model = elPlcModel.value;

    // ── Bin'leri Drive'dan çek (slave veya master farketmez, hep buradan) ──
    if (!prodBoot || !prodFw) {
      // Yoksa, otomatik fetch et
      setFlashButtonsEnabled(false);
      elBtnProduceSlave.disabled = true;
      try {
        logInfo('Drive\'dan bin dosyaları çekiliyor…');
        const bootRes = await api.fetchBin(model, 'bootloader');
        prodBoot = { name: bootRes.name, bytes: bootRes.bytes };
        logOk(`  ✓ Bootloader: ${bootRes.name} (${bootRes.size} byte)`);
        const fwRes = await api.fetchBin(model, 'firmware');
        prodFw = { name: fwRes.name, bytes: fwRes.bytes };
        logOk(`  ✓ Firmware: ${fwRes.name} (${fwRes.size} byte)`);
      } catch (e) {
        logErr('Drive bin çekme hatası: ' + e.message);
        alert('Drive\'dan bin alınamadı: ' + e.message);
        setFlashButtonsEnabled(true);
        elBtnProduceSlave.disabled = false;
        return;
      } finally {
        setFlashButtonsEnabled(true);
        elBtnProduceSlave.disabled = false;
      }
    }

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

      // 0.5) RESET + HALT — CPU'yu temiz state'e al (önceki bootloader/app etkisini sil)
      logInfo('  CPU reset + halt (temiz state)…');
      await cmd.resetAndHalt();
      logOk('  CPU temiz state\'te.');

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

      // 1) FPEC Unlock (mass erase artık ayrı yapılmıyor — eraseProgramVerify zaten gerekli sayfaları siler)
      logInfo('[1/5] FPEC unlock…');
      await flash.unlock();
      logOk('  FPEC unlocked.');

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

  // ── Heartbeat + Auto-reconnect ────────────────────────────────────────
  // Background polling: her 3 sn ST-Link sağlığını kontrol et.
  // Bağlantı koparsa otomatik recover etmeye çalış.
  let heartbeatTimer = null;
  let consecutiveFails = 0;
  let isOperationInProgress = false;

  function setHeartbeatStatus(text, color) {
    if (!elHeartbeatStatus) return;
    elHeartbeatStatus.textContent = text;
    elHeartbeatStatus.style.color = color || 'var(--muted)';
  }

  async function heartbeatTick() {
    if (!usb.isOpen || !cmd) {
      setHeartbeatStatus('💤 Bağlı değil', 'var(--muted)');
      consecutiveFails = 0;
      return;
    }
    // Bir operation devam ediyorsa heartbeat'i atla (busy USB)
    if (isOperationInProgress) {
      setHeartbeatStatus('⚙ İşlem devam ediyor…', 'var(--accent)');
      return;
    }
    try {
      // Hızlı versiyon read (~5 ms USB roundtrip)
      await cmd.getVersion();
      consecutiveFails = 0;
      setHeartbeatStatus('💚 Bağlantı sağlam (heartbeat OK)', 'var(--ok)');
    } catch (e) {
      consecutiveFails++;
      setHeartbeatStatus(`⚠ Heartbeat fail ${consecutiveFails}/3: ${e.message}`, 'var(--warn)');
      if (consecutiveFails >= 3) {
        // Bağlantı gerçekten kopmuş — recover dene
        logWarn('ST-Link bağlantı kopması tespit edildi, otomatik recover…');
        await attemptRecover();
      }
    }
  }

  async function attemptRecover() {
    setHeartbeatStatus('🔄 Recover ediliyor…', 'var(--warn)');
    try {
      // Önce mevcut bağlantıyı kapat
      try { await usb.close(); } catch {}
      // Önceden izin verilmiş cihaz var mı?
      const devices = await StlinkUsb.getAuthorizedDevices();
      if (devices.length === 0) {
        throw new Error('İzin verilmiş cihaz yok (kullanıcı manuel bağlanmalı)');
      }
      // İlk cihazı pickr olmadan aç
      const info = await usb.openDevice(devices[0]);
      cmd = new StlinkCmd(usb);
      const ver = await cmd.getVersion();
      logOk(`✓ Auto-recover OK: ${ver.formatted}`);
      setConnectedUI(info);
      setVersionUI(ver);
      elBtnReadChip.disabled = false;
      setFlashButtonsEnabled(true);
      consecutiveFails = 0;
      setHeartbeatStatus('💚 Bağlantı sağlam (recover sonrası)', 'var(--ok)');
    } catch (e) {
      logErr('Auto-recover başarısız: ' + e.message);
      setHeartbeatStatus('🔴 Recover başarısız — manuel bağlan', 'var(--err)');
      cmd = null;
      setDisconnectedUI();
    }
  }

  // Heartbeat'i başlat (her 3 sn)
  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(heartbeatTick, 3000);
  }
  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  // Production / flash işlemleri sırasında heartbeat'i suspend et
  // (USB busy iken paralel sorgu hata verir)
  const originalSetFlashEnabled = setFlashButtonsEnabled;
  setFlashButtonsEnabled = function(en) {
    isOperationInProgress = !en;
    originalSetFlashEnabled(en);
  };

  // Auto-reconnect on page load — önceden izin verilmiş cihaz varsa otomatik bağlan
  async function tryAutoReconnect() {
    try {
      const devices = await StlinkUsb.getAuthorizedDevices();
      if (devices.length === 0) {
        logInfo('Otomatik bağlantı için önce manuel "ST-Link\'e Bağlan" gerekli.');
        return;
      }
      logInfo(`${devices.length} izinli ST-Link bulundu, otomatik bağlanıyor…`);
      const info = await usb.openDevice(devices[0]);
      logOk(`Auto-connect: ${info.product || 'ST-Link'} (variant ${info.variant})`);
      setConnectedUI(info);
      cmd = new StlinkCmd(usb);
      const ver = await cmd.getVersion();
      logOk(`Versiyon: ${ver.formatted}`);
      setVersionUI(ver);
      elBtnReadChip.disabled = false;
      setFlashButtonsEnabled(true);
      startHeartbeat();
    } catch (e) {
      logWarn('Auto-connect başarısız: ' + e.message + ' (manuel bağlanın)');
    }
  }

  // Heartbeat'i manuel connect/disconnect sonrasında da yönet
  const originalConnectHandler = elBtnConnect.onclick;
  elBtnConnect.addEventListener('click', () => {
    // requestAndOpen başarılı olunca heartbeat başlat
    setTimeout(() => { if (usb.isOpen) startHeartbeat(); }, 500);
  });
  elBtnDisconnect.addEventListener('click', () => {
    stopHeartbeat();
    setHeartbeatStatus('', 'var(--muted)');
  });

  // ── Sayfa kapanırken cihazı serbest bırak ─────────────────────────────
  window.addEventListener('beforeunload', () => {
    stopHeartbeat();
    if (usb.isOpen) usb.close().catch(() => {});
  });

  // ── Login akışı ───────────────────────────────────────────────────────
  function applyRole(user, role) {
    currentUser = user;
    currentRole = role;
    document.body.setAttribute('data-role', role);
    // Inline display'i temizle ki CSS rule (body[data-role] → display:none) etkili olsun
    elLoginOverlay.style.display = '';
    elBadgeUser.textContent = user;
    elBadgeRole.textContent = role.toUpperCase();
    elBadgeRole.style.color = role === 'master' ? 'var(--accent)' : 'var(--warn)';

    // Slave için: büyük buton göster, master inputlarını gizle
    if (role === 'slave') {
      elBtnProduceSlave.style.display = 'block';
      // Slave için operator otomatik = kullanıcı adı
      elProdOperator.value = user;
    } else {
      elBtnProduceSlave.style.display = 'none';
    }

    // Master ise user listesini + bin listesini yükle
    if (role === 'master') {
      refreshUserList();
      refreshBinList();
    }
  }

  function doLogout() {
    clearAuth();
    currentUser = null;
    currentRole = null;
    document.body.removeAttribute('data-role');
    elLoginUser.value = '';
    elLoginPass.value = '';
    elLoginErr.textContent = '';
    // CSS otomatik gösterir (body[data-role] yoksa overlay flex)
    elLoginOverlay.style.display = '';
  }

  async function doLogin() {
    elLoginErr.textContent = '';
    const u = elLoginUser.value.trim();
    const p = elLoginPass.value;
    if (!u || !p) { elLoginErr.textContent = 'Kullanıcı adı ve şifre gerekli'; return; }
    elBtnLogin.disabled = true;
    elBtnLogin.textContent = 'Giriş yapılıyor…';
    try {
      const r = await api.login(u, p);
      if (!r.ok) {
        elLoginErr.textContent = '✗ ' + (r.error || 'Giriş başarısız');
        return;
      }
      setAuth(u, r.role);
      applyRole(u, r.role);
      logOk('Giriş başarılı: ' + u + ' (' + r.role + ')');
    } catch (e) {
      elLoginErr.textContent = '✗ Sunucu hatası: ' + e.message;
    } finally {
      elBtnLogin.disabled = false;
      elBtnLogin.textContent = 'Giriş';
    }
  }

  elBtnLogin.addEventListener('click', doLogin);
  elLoginPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  elLoginUser.addEventListener('keydown', (e) => { if (e.key === 'Enter') elLoginPass.focus(); });
  elBtnLogout.addEventListener('click', doLogout);

  // ── Kullanıcı yönetimi (master only) ──────────────────────────────────
  async function refreshUserList() {
    if (!currentUser || currentRole !== 'master') return;
    try {
      const users = await api.listUsers(currentUser);
      elUserList.innerHTML = '';
      users.forEach(u => {
        const div = document.createElement('div');
        div.style.cssText = 'padding: 6px 10px; background: #1a1a1a; border-radius: 4px; margin-bottom: 4px; display: flex; align-items: center; gap: 10px;';
        const isSelf = (u.username === currentUser);
        const roleColor = u.role === 'master' ? 'var(--accent)' : 'var(--warn)';
        div.innerHTML =
          '<span style="flex: 1;"><span style="color: ' + roleColor + '; font-weight: 600;">[' + u.role.toUpperCase() + ']</span> ' +
          '<span style="color: var(--text);">' + escapeHtml(u.username) + '</span>' +
          (isSelf ? ' <span style="color: var(--muted); font-size: 11px;">(siz)</span>' : '') +
          ' <span style="color: var(--muted); font-size: 11px;">— eklendi: ' + escapeHtml(u.createdBy) + '</span></span>';
        if (!isSelf) {
          const btn = document.createElement('button');
          btn.textContent = 'Sil';
          btn.className = 'small danger';
          btn.onclick = async () => {
            if (!confirm('"' + u.username + '" kullanıcısı silinecek. Emin misin?')) return;
            try {
              await api.deleteUser(u.username, currentUser);
              logOk('Kullanıcı silindi: ' + u.username);
              refreshUserList();
            } catch (e) { alert('Silme hatası: ' + e.message); }
          };
          div.appendChild(btn);
        }
        elUserList.appendChild(div);
      });
    } catch (e) {
      elUserList.innerHTML = '<span style="color: var(--err);">Liste yüklenemedi: ' + escapeHtml(e.message) + '</span>';
    }
  }

  elBtnAddUser.addEventListener('click', async () => {
    const u = elNewUserName.value.trim();
    const p = elNewUserPass.value;
    const r = elNewUserRole.value;
    if (!u || !p) { alert('Kullanıcı adı ve şifre gerekli'); return; }
    elBtnAddUser.disabled = true;
    try {
      await api.addUser(u, p, r, currentUser);
      logOk('Kullanıcı eklendi: ' + u + ' (' + r + ')');
      elNewUserName.value = '';
      elNewUserPass.value = '';
      refreshUserList();
    } catch (e) {
      alert('Ekleme hatası: ' + e.message);
    } finally {
      elBtnAddUser.disabled = false;
    }
  });

  // Slave büyük buton — sadece tıklayınca aynı üretim akışını tetikle
  elBtnProduceSlave.addEventListener('click', () => elBtnProduce.click());

  // ── Bin Yönetimi (master only) — Google Drive üzerinden ───────────────
  const elDotBin           = document.getElementById('dotBin');
  const elBinListInfo      = document.getElementById('binListInfo');
  const elMasterBootFile   = document.getElementById('masterBootFile');
  const elMasterFwFile     = document.getElementById('masterFwFile');
  const elBtnUploadBoot    = document.getElementById('btnUploadBoot');
  const elBtnUploadFw      = document.getElementById('btnUploadFw');
  const elMasterBootStatus = document.getElementById('masterBootStatus');
  const elMasterFwStatus   = document.getElementById('masterFwStatus');
  const elBtnRefreshBins   = document.getElementById('btnRefreshBins');

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024*1024) return (n/1024).toFixed(2) + ' KB';
    return (n/(1024*1024)).toFixed(2) + ' MB';
  }
  function fmtDate(iso) {
    if (!iso) return '-';
    try { return new Date(iso).toLocaleString('tr-TR'); } catch { return iso; }
  }

  async function refreshBinList() {
    if (!currentUser || currentRole !== 'master') return;
    const model = elPlcModel.value;
    elBinListInfo.innerHTML = '<span style="color:var(--muted)">Drive\'dan bilgi okunuyor…</span>';
    try {
      const info = await api.listBins(model);
      let html = `<div style="color:var(--accent);margin-bottom:6px;">📁 Drive: Derko PLC Veri / ${escapeHtml(model)}</div>`;
      for (const [name, meta] of Object.entries(info)) {
        if (meta) {
          html += `<div style="color:#4caf50">✓ ${name} — ${fmtBytes(meta.size)} — ${fmtDate(meta.lastModified)}</div>`;
        } else {
          html += `<div style="color:#f44336">✗ ${name} — yok</div>`;
        }
      }
      elBinListInfo.innerHTML = html;
      elDotBin.className = 'status-dot on';
    } catch (e) {
      elBinListInfo.innerHTML = '<span style="color:var(--err)">Bin liste hatası: ' + escapeHtml(e.message) + '</span>';
      elDotBin.className = 'status-dot err';
    }
  }
  elBtnRefreshBins.addEventListener('click', refreshBinList);
  elPlcModel.addEventListener('change', refreshBinList);

  // File picker enable button when file selected
  elMasterBootFile.addEventListener('change', () => {
    elBtnUploadBoot.disabled = !elMasterBootFile.files[0];
    elMasterBootStatus.textContent = elMasterBootFile.files[0]
      ? `${elMasterBootFile.files[0].name} (${fmtBytes(elMasterBootFile.files[0].size)})` : '';
  });
  elMasterFwFile.addEventListener('change', () => {
    elBtnUploadFw.disabled = !elMasterFwFile.files[0];
    elMasterFwStatus.textContent = elMasterFwFile.files[0]
      ? `${elMasterFwFile.files[0].name} (${fmtBytes(elMasterFwFile.files[0].size)})` : '';
  });

  async function uploadBinToDrive(file, type, statusEl, btnEl) {
    if (!file || !currentUser) return;
    btnEl.disabled = true;
    btnEl.textContent = '⏳ Yükleniyor…';
    statusEl.textContent = 'Drive\'a yükleniyor…';
    statusEl.style.color = 'var(--muted)';
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const model = elPlcModel.value;
      const result = await api.uploadBin(model, type, bytes, currentUser);
      logOk(`Bin yüklendi (Drive): ${type} → ${result.file} (${fmtBytes(result.size)})`);
      statusEl.textContent = `✓ ${result.file} (${fmtBytes(result.size)})`;
      statusEl.style.color = 'var(--ok)';
      btnEl.textContent = '✓ Yüklendi';
      setTimeout(() => { btnEl.textContent = '📤 Drive\'a Yükle'; }, 2000);
      refreshBinList();
    } catch (e) {
      logErr('Bin upload hatası: ' + e.message);
      statusEl.textContent = '✗ ' + e.message;
      statusEl.style.color = 'var(--err)';
      btnEl.textContent = '📤 Drive\'a Yükle';
    } finally {
      btnEl.disabled = false;
    }
  }

  elBtnUploadBoot.addEventListener('click', () =>
    uploadBinToDrive(elMasterBootFile.files[0], 'bootloader', elMasterBootStatus, elBtnUploadBoot));
  elBtnUploadFw.addEventListener('click', () =>
    uploadBinToDrive(elMasterFwFile.files[0], 'firmware', elMasterFwStatus, elBtnUploadFw));

  // ── Apps Script API URL yönetimi + ping ───────────────────────────────
  async function pingApi() {
    try {
      const r = await api.ping();
      elApiStatusText.textContent = '✓ Hazır (' + r.msg + ', v' + r.version + ')';
      elApiStatusText.style.color = '#4caf50';
      logOk('Sunucu API: ' + r.msg + ' (v' + r.version + ')');
      return true;
    } catch (e) {
      elApiStatusText.textContent = '✗ Erişilemiyor: ' + e.message;
      elApiStatusText.style.color = '#f44336';
      logErr('Sunucu API erişilemiyor: ' + e.message);
      return false;
    }
  }

  // Mevcut URL'i input'a yükle
  elApiUrlInput.value = ProductionApi.getStoredUrl();

  // Kaydet + test
  elBtnSaveApiUrl.addEventListener('click', async () => {
    const url = elApiUrlInput.value.trim();
    if (!url || !url.startsWith('https://script.google.com/')) {
      alert('Geçerli bir Apps Script URL\'i girin (https://script.google.com/...).');
      return;
    }
    api.setUrl(url);
    elBtnSaveApiUrl.disabled = true;
    elBtnSaveApiUrl.textContent = 'Test ediliyor…';
    elApiStatusText.textContent = 'test ediliyor…';
    elApiStatusText.style.color = 'var(--muted)';
    const ok = await pingApi();
    elBtnSaveApiUrl.disabled = false;
    elBtnSaveApiUrl.textContent = ok ? '✓ Kaydedildi' : 'Kaydet + Test';
    setTimeout(() => { elBtnSaveApiUrl.textContent = 'Kaydet + Test'; }, 2000);
  });

  // Açılışta ping
  pingApi();

  // Açılışta auth varsa otomatik login
  const savedAuth = getAuth();
  if (savedAuth && savedAuth.user && savedAuth.role) {
    applyRole(savedAuth.user, savedAuth.role);
    logInfo('Otomatik giriş: ' + savedAuth.user + ' (' + savedAuth.role + ')');
    // Login OK → ST-Link auto-reconnect dene (önceden izin verilmiş cihaz varsa)
    setTimeout(tryAutoReconnect, 500);
  }
})();

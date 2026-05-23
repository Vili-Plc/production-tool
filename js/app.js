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

      // Chip okuma butonu artık aktif
      elBtnReadChip.disabled = false;
    } catch (e) {
      logErr('Bağlantı hatası: ' + e.message);
      setErrorUI();
      try { await usb.close(); } catch {}
      elBtnConnect.disabled = false;
      elBtnDisconnect.disabled = true;
    }
  });

  // ── Event: Chip Bilgisi Oku ───────────────────────────────────────────
  elBtnReadChip.addEventListener('click', async () => {
    if (!cmd) { logErr('Önce ST-Link\'e bağlan.'); return; }
    elBtnReadChip.disabled = true;
    clearTargetUI();
    try {
      // 1) Besleme voltajı (chip bağlı mı sanity check)
      logInfo('Hedef besleme ölçülüyor…');
      const voltage = await cmd.getTargetVoltage();
      logInfo(`VAREF: ${voltage.toFixed(3)} V`);
      if (voltage < 1.0) {
        logWarn('Hedef MCU besleme yok ya da PCB bağlı değil!');
        elDotTarget.className = 'status-dot err';
        elTgtVoltage.textContent = voltage.toFixed(2) + ' V (DÜŞÜK)';
        elTgtVoltage.classList.remove('empty');
        return;
      }

      // 2) SWD mode'a gir
      logInfo('SWD mode\'a giriliyor…');
      const enterResp = await cmd.enterSwdMode();
      logInfo(`Enter SWD: status=0x${enterResp.status.toString(16)} ` +
              `[${Array.from(enterResp.raw).map(b => b.toString(16).padStart(2,'0')).join(' ')}]`);

      // 3) DAP IDCODE (chip CoreSight ID)
      logInfo('DAP IDCODE okunuyor…');
      const id = await cmd.readIdCodes();
      logInfo(`DAP IDCODE: 0x${id.idcode.toString(16).padStart(8,'0').toUpperCase()}`);
      if (id.idcode === 0x0BB11477) {
        logOk('Cortex-M0 tespit edildi (STM32F0 ailesi).');
      } else if (id.idcode === 0) {
        logErr('IDCODE = 0 → chip cevap vermiyor. SWD kabloları? Güç var mı?');
        return;
      } else {
        logWarn(`Beklenmeyen IDCODE — F0 değil veya farklı revizyon.`);
      }

      // 4) STM32F0 spesifik bilgiler
      const stm = new Stm32f0(cmd);

      logInfo('DBGMCU_IDCODE okunuyor…');
      const chip = await stm.readChipId();
      logOk(`Chip: ${chip.modelName}  (DEV_ID=0x${chip.devId.toString(16).toUpperCase()}, ${chip.revName})`);

      logInfo('Flash boyutu okunuyor…');
      const flashSize = await stm.readFlashSize();
      logOk(`Flash: ${flashSize} KB`);

      logInfo('UID okunuyor…');
      const uid = await stm.readUid();
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

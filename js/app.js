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
    } catch (e) {
      logErr('Bağlantı hatası: ' + e.message);
      setErrorUI();
      try { await usb.close(); } catch {}
      elBtnConnect.disabled = false;
      elBtnDisconnect.disabled = true;
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

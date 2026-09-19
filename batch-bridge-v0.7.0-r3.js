(() => {
  'use strict';

  const VERSION = '0.7.0';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(test, timeoutMs, label, interval = 150) {
    const started = performance.now();
    let lastError = null;
    while (performance.now() - started < timeoutMs) {
      try {
        const value = test();
        if (value) return value;
      } catch (error) {
        lastError = error;
        if (/Could not open PDF|Review PDF could not be created/i.test(error.message || '')) throw error;
      }
      await sleep(interval);
    }
    throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
  }

  function byId(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`MCCDSigner control #${id} is not available yet.`);
    return el;
  }

  let appSettled = false;

  async function ensureDom() {
    await waitFor(() => {
      const app = document.getElementById('app');
      const pdf = document.getElementById('pdfFile');
      const detector = document.getElementById('detectorBadge');
      const review = document.getElementById('generateReview');
      return app?.dataset?.started === 'true' && pdf && detector && review ? true : false;
    }, 30000, `MCCDSigner v${VERSION} interface startup`);

    // The app creates its DOM before attaching the input/change handlers.
    // Its offline status is updated only after those listeners have been
    // attached, so use that as a reliable "startup complete" marker.
    if (!appSettled) {
      await waitFor(() => {
        const status = document.getElementById('offlineStatus')?.textContent?.trim() || '';
        return status && !/Checking offline cache/i.test(status) ? true : false;
      }, 30000, `MCCDSigner v${VERSION} listener startup`);
      await sleep(250);
      appSettled = true;
    }
    return true;
  }

  function snapshot() {
    const badge = document.getElementById('detectorBadge');
    const summary = document.getElementById('normalisationSummary');
    const pageSelect = document.getElementById('pageSelect');
    const reviewStatus = document.getElementById('reviewStatus');
    return {
      version: VERSION,
      documentStatus: document.getElementById('documentStatus')?.textContent?.trim() || '',
      detectorTitle: document.getElementById('detectorTitle')?.textContent?.trim() || '',
      detectorStatus: document.getElementById('detectorStatus')?.textContent?.trim() || '',
      detectorBadge: badge?.textContent?.trim() || '',
      detectorTone: badge?.dataset?.tone || '',
      placement: document.getElementById('placementStatus')?.textContent?.trim() || '',
      placementTone: document.getElementById('placementStatus')?.dataset?.tone || '',
      plan: summary?.innerText?.trim() || 'No document plan returned.',
      pageOptions: pageSelect ? [...pageSelect.options].map((option) => option.textContent.trim()) : [],
      reviewStatus: reviewStatus?.textContent?.trim() || ''
    };
  }

  async function clear() {
    await ensureDom();
    window.__MCCD_BATCH_LAST_ALERT__ = '';
    const button = byId('clearDocument');
    if (!button.disabled) button.click();
    const pdfInput = byId('pdfFile');
    try { pdfInput.value = ''; } catch {}
    await waitFor(() => /No PDF loaded/i.test(byId('documentStatus').textContent || ''), 10000, 'Clear document');
    return snapshot();
  }

  async function open(bytes, name) {
    await ensureDom();
    window.__MCCD_BATCH_LAST_ALERT__ = '';
    const input = byId('pdfFile');
    const byteArray = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes);
    const file = new File([byteArray], name || 'regression-test.pdf', { type: 'application/pdf', lastModified: Date.now() });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;

    // Keep retrying the normal input change event until the app acknowledges
    // it. This avoids a race between the batch bridge and v0.7.0's listener
    // attachment, without changing the detector itself.
    let acknowledged = false;
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(500);
      const status = byId('documentStatus').textContent || '';
      if (!/No PDF loaded/i.test(status)) {
        acknowledged = true;
        break;
      }
      console.warn(`[MCCD batch] PDF hand-off attempt ${attempt} was not observed.`);
    }
    if (!acknowledged) {
      throw new Error(`${name}: v0.7.0 PDF input listener did not respond after 6 seconds.`);
    }

    await waitFor(() => {
      const status = byId('documentStatus').textContent || '';
      if (/Could not open PDF/i.test(status)) throw new Error(status.trim());
      const placementCard = byId('placementCard');
      const pageSelect = byId('pageSelect');
      return !/Opening PDF/i.test(status) && !placementCard.classList.contains('hidden') && pageSelect.options.length > 0;
    }, 120000, `${name} PDF open`);

    return snapshot();
  }

  async function detect() {
    await ensureDom();

    // The normal app usually starts detection automatically after a PDF opens.
    // In the batch iframe that automatic tail can occasionally fail to fire,
    // leaving the UI at "Not run" even though the PDF is open. Give the normal
    // path a brief chance, then press the app's own "Run automatic detection"
    // button if it is still idle. This does not alter the detector itself.
    await sleep(1500);
    const initialBadge = byId('detectorBadge').textContent.trim();
    const initialTitle = byId('detectorTitle').textContent.trim();
    const button = byId('runDetection');
    if (!button.disabled && (/^Not run$/i.test(initialBadge) || /ready/i.test(initialTitle))) {
      console.warn('[MCCD batch] v0.7.0 auto-start did not fire; invoking the normal Run automatic detection button.');
      button.click();
    }

    return waitFor(() => {
      const badge = byId('detectorBadge').textContent.trim();
      const title = byId('detectorTitle').textContent.trim();
      const runButton = byId('runDetection');
      const finalBadge = /^(Ready|Check box|Manual check|Manual)/i.test(badge);
      const finalTitle = /Document ready|ME heading found|manual check|Manual placement|Manual output order/i.test(title);
      if (!runButton.disabled && finalBadge && finalTitle) return snapshot();
      return null;
    }, 240000, 'v0.7.0 automatic detection');
  }

  async function review() {
    await ensureDom();
    window.__MCCD_BATCH_LAST_ALERT__ = '';
    const button = byId('generateReview');
    if (button.disabled) {
      await waitFor(() => !byId('generateReview').disabled, 15000, 'Review button readiness');
    }
    byId('generateReview').click();

    return waitFor(() => {
      const alertText = window.__MCCD_BATCH_LAST_ALERT__ || '';
      if (alertText) throw new Error(`Review PDF could not be created: ${alertText}`);
      const reviewCard = byId('reviewCard');
      const canvases = [...document.querySelectorAll('#reviewPages canvas')];
      const status = byId('reviewStatus').textContent || '';
      if (!reviewCard.classList.contains('hidden') && canvases.length > 0 && !byId('generateReview').disabled && /in memory only/i.test(status)) {
        return { ...snapshot(), canvasCount: canvases.length };
      }
      return null;
    }, 120000, 'Review PDF generation');
  }

  const originalAlert = window.alert.bind(window);
  window.alert = (message) => {
    window.__MCCD_BATCH_LAST_ALERT__ = String(message || '');
    console.warn('[MCCD batch suppressed alert]', message);
  };
  window.__MCCD_BATCH_ORIGINAL_ALERT__ = originalAlert;

  window.__MCCD_BATCH_READY__ = { version: VERSION, mode: 'DOM bridge', baseline: true };
  window.__MCCD_BATCH_API__ = { version: VERSION, clear, open, detect, review, snapshot };
})();
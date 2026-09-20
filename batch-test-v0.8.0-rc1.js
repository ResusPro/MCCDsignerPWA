(() => {
  'use strict';

  const EXPECTED_VERSION = '0.8.0-rc1';
  const HARNESS_BUILD = 'rc1-r1';
  const RUNNER_BUILD = 'rc1-r1';
  const els = {
    files: document.querySelector('#testFiles'),
    selection: document.querySelector('#selectionStatus'),
    run: document.querySelector('#runAll'),
    stop: document.querySelector('#stopRun'),
    download: document.querySelector('#downloadReport'),
    progress: document.querySelector('#batchProgress'),
    runStatus: document.querySelector('#runStatus'),
    frame: document.querySelector('#processor'),
    results: document.querySelector('#results'),
    count: document.querySelector('#resultCount'),
    toggle: document.querySelector('#toggleProcessor'),
    liveCard: document.querySelector('.live-card'),
    telemetry: document.querySelector('#liveTelemetry'),
    liveStage: document.querySelector('#liveStage'),
    liveElapsed: document.querySelector('#liveElapsed'),
    liveDetail: document.querySelector('#liveDetail'),
    testProgress: document.querySelector('#testProgress')
  };

  const state = { files: [], results: [], running: false, stopRequested: false, wakeLock: null };
  const natural = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[ch]);

  function setStatus(text, tone = '') {
    els.runStatus.textContent = text;
    els.runStatus.dataset.tone = tone;
  }

  function setProgress(done, total) {
    els.progress.style.width = `${total ? Math.max(0, Math.min(100, done / total * 100)) : 0}%`;
  }

  function formatElapsed(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function setTelemetry(stage, detail, progress = 0, elapsedMs = 0, tone = '') {
    els.telemetry.classList.remove('hidden');
    els.telemetry.dataset.tone = tone;
    els.liveStage.textContent = stage;
    els.liveDetail.textContent = detail || '';
    els.liveElapsed.textContent = formatElapsed(elapsedMs);
    els.testProgress.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }

  function frameContext() {
    const win = els.frame.contentWindow;
    const doc = els.frame.contentDocument;
    if (!win || !doc) throw new Error('The embedded MCCDSigner processor is unavailable.');
    return { win, doc };
  }

  async function waitFor(test, timeoutMs, label, interval = 200) {
    const started = performance.now();
    let lastError = null;
    while (performance.now() - started < timeoutMs) {
      try {
        const value = test();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await sleep(interval);
    }
    throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
  }

  async function ensureAppReady(forceReload = false) {
    let reloadToken = null;

    if (forceReload) {
      reloadToken = `${HARNESS_BUILD}-${RUNNER_BUILD}-${Date.now()}`;

      // IMPORTANT: wait for the NEW iframe document to load. Without this,
      // contentWindow can briefly expose the previous document's batch API,
      // which makes the runner call open() on a detached/stale processor.
      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          reject(new Error(`MCCDSigner v${EXPECTED_VERSION} processor iframe reload timed out`));
        }, 30000);

        const onLoad = () => {
          window.clearTimeout(timer);
          resolve();
        };

        els.frame.addEventListener('load', onLoad, { once: true });
        els.frame.src = `./processor-v0.8.0-rc1.html?batch=0801&harness=${HARNESS_BUILD}&runner=${RUNNER_BUILD}&instance=${encodeURIComponent(reloadToken)}`;
      });
    }

    return waitFor(() => {
      const { win, doc } = frameContext();

      // If this was an explicit reload, verify that we are looking at the
      // newly navigated document rather than the old WindowProxy/document.
      if (reloadToken) {
        const params = new URLSearchParams(win.location.search);
        if (params.get('instance') !== reloadToken) return null;
      }

      const marker = win.__MCCD_BATCH_READY__;
      const api = win.__MCCD_BATCH_API__;
      return marker?.version === EXPECTED_VERSION &&
        marker?.harness === HARNESS_BUILD &&
        api?.version === EXPECTED_VERSION &&
        api?.harness === HARNESS_BUILD &&
        typeof api.open === 'function' &&
        typeof api.detect === 'function' &&
        typeof api.review === 'function'
        ? { win, doc, api } : null;
    }, 30000, `MCCDSigner v${EXPECTED_VERSION} regression processor startup`);
  }

  function readU16(view, offset) { return view.getUint16(offset, true); }
  function readU32(view, offset) { return view.getUint32(offset, true); }

  async function inflateRaw(bytes) {
    if (!('DecompressionStream' in window)) throw new Error('This browser cannot decompress the regression ZIP. Extract it first and select the PDFs directly.');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function pdfsFromZip(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const minimum = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= minimum; i -= 1) {
      if (readU32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(`${file.name}: ZIP end record not found.`);
    const entryCount = readU16(view, eocd + 10);
    let cursor = readU32(view, eocd + 16);
    const decoder = new TextDecoder('utf-8');
    const pdfs = [];

    for (let index = 0; index < entryCount; index += 1) {
      if (readU32(view, cursor) !== 0x02014b50) throw new Error(`${file.name}: invalid ZIP central directory.`);
      const method = readU16(view, cursor + 10);
      const compressedSize = readU32(view, cursor + 20);
      const fileNameLength = readU16(view, cursor + 28);
      const extraLength = readU16(view, cursor + 30);
      const commentLength = readU16(view, cursor + 32);
      const localOffset = readU32(view, cursor + 42);
      const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + fileNameLength));

      if (/\.pdf$/i.test(name) && !name.endsWith('/')) {
        if (readU32(view, localOffset) !== 0x04034b50) throw new Error(`${file.name}: invalid local ZIP header for ${name}.`);
        const localNameLength = readU16(view, localOffset + 26);
        const localExtraLength = readU16(view, localOffset + 28);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        const compressed = bytes.slice(start, start + compressedSize);
        let data;
        if (method === 0) data = compressed;
        else if (method === 8) data = await inflateRaw(compressed);
        else throw new Error(`${name}: unsupported ZIP compression method ${method}.`);
        const shortName = name.split('/').pop();
        pdfs.push(new File([data], shortName, { type: 'application/pdf', lastModified: Date.now() }));
      }

      cursor += 46 + fileNameLength + extraLength + commentLength;
    }
    return pdfs;
  }

  async function readSelection(fileList) {
    if (!window.JSZip) throw new Error('The local ZIP helper did not load.');
    const selected = [...fileList];
    const pdfs = [];

    for (const file of selected) {
      if (/\.zip$/i.test(file.name) || /zip/i.test(file.type)) {
        els.selection.textContent = `Reading ${file.name} locally with JSZip…`;
        const zip = await JSZip.loadAsync(file);
        const entries = Object.values(zip.files).filter((entry) => !entry.dir && /\.pdf$/i.test(entry.name));

        for (const entry of entries) {
          const bytes = await entry.async('uint8array');
          const name = entry.name.split('/').pop();
          if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
            throw new Error(`${name}: extracted file is not a valid PDF header.`);
          }
          pdfs.push(new File([bytes], name, { type: 'application/pdf', lastModified: Date.now() }));
        }
      } else if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        pdfs.push(file);
      }
    }

    pdfs.sort((a, b) => natural.compare(a.name, b.name));
    state.files = pdfs;
    state.results = [];
    els.results.innerHTML = '<p class="empty">No tests have completed.</p>';
    els.count.textContent = '0 results';
    els.run.disabled = pdfs.length === 0;
    els.download.disabled = true;
    els.selection.textContent = pdfs.length ? `${pdfs.length} PDF test${pdfs.length === 1 ? '' : 's'} ready — JSZip validated · runner rc1-r1.` : 'No PDF tests were found.';
    els.selection.dataset.tone = pdfs.length ? 'ok' : 'error';
    setProgress(0, pdfs.length);
  }

  function resultTone(detectorTitle, badge, placementTone) {
    if (/No confident|failed|could not|manual check/i.test(detectorTitle) || placementTone === 'error' || /Manual check/i.test(badge)) return 'warning';
    if (/Check box|estimated/i.test(`${badge} ${detectorTitle}`)) return 'warning';
    return 'ok';
  }

  function canvasToDataUrl(canvas, maxWidth = 950) {
    const scale = Math.min(1, maxWidth / canvas.width);
    const target = document.createElement('canvas');
    target.width = Math.max(1, Math.round(canvas.width * scale));
    target.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = target.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(canvas, 0, 0, target.width, target.height);
    return target.toDataURL('image/jpeg', 0.78);
  }

  function startProcessorMonitor(file, index, total, started) {
    let lastSignature = '';
    let lastChange = performance.now();
    return window.setInterval(() => {
      try {
        const { doc } = frameContext();
        const title = (doc.querySelector('#detectorTitle')?.textContent || '').trim();
        const detail = (doc.querySelector('#detectorStatus')?.textContent || doc.querySelector('#documentStatus')?.textContent || '').trim();
        const badge = (doc.querySelector('#detectorBadge')?.textContent || '').trim();
        const innerWidth = parseFloat(doc.querySelector('#ocrProgressBar')?.style.width || '0') || 0;
        const reviewVisible = !doc.querySelector('#reviewCard')?.classList.contains('hidden');
        const signature = `${title}|${detail}|${badge}|${Math.round(innerWidth)}|${reviewVisible}`;
        if (signature !== lastSignature) { lastSignature = signature; lastChange = performance.now(); }
        const stalledFor = performance.now() - lastChange;
        let progress = reviewVisible ? 95 : Math.max(4, Math.min(90, innerWidth * 0.9));
        let tone = stalledFor > 75000 ? 'warning' : '';
        let message = detail || title || `${file.name} is being processed locally.`;
        if (stalledFor > 75000) message += ` No visible processor update for ${formatElapsed(stalledFor)}.`;
        setTelemetry(`Test ${index + 1}/${total}: ${badge || 'working'}`, message, progress, performance.now() - started, tone);
        setProgress(index + progress / 100, total);
      } catch (error) {
        setTelemetry(`Test ${index + 1}/${total}`, `Waiting for the embedded processor: ${error.message}`, 1, performance.now() - started, 'warning');
      }
    }, 500);
  }

  async function processOne(file, index, total) {
    const started = performance.now();
    const monitor = startProcessorMonitor(file, index, total, started);
    try {
      const { win, doc, api } = await ensureAppReady(false);
      setStatus(`Test ${index + 1}/${total}: ${file.name} — opening…`);
      await api.clear();
      await api.open(await file.arrayBuffer(), file.name);

      setStatus(`Test ${index + 1}/${total}: ${file.name} — waiting for v0.8.0-rc1 automatic detection…`);
      const detected = await api.detect();

      setStatus(`Test ${index + 1}/${total}: ${file.name} — generating signed review pages…`);
      await api.review();

      const canvases = [...doc.querySelectorAll('#reviewPages canvas')];
      if (!canvases.length) throw new Error(`${file.name} generated no review-page canvases.`);
      const thumbnails = canvases.map((canvas) => canvasToDataUrl(canvas));
      const detectorTitle = (detected.detectorTitle || '').trim();
      const badge = (detected.detectorBadge || '').trim();
      const tone = resultTone(detectorTitle, badge, detected.placementTone || '');

      const result = {
        index: index + 1,
        sourceName: file.name,
        tone,
        badge,
        detectorTitle,
        detectorStatus: detected.detectorStatus || '',
        placement: detected.placement || '',
        plan: detected.plan || '',
        pageOptions: detected.pageOptions || [],
        seconds: Math.round((performance.now() - started) / 100) / 10,
        thumbnails,
        error: ''
      };
      setTelemetry(`Test ${index + 1}/${total}: complete`, `${file.name} completed in ${formatElapsed(performance.now() - started)}.`, 100, performance.now() - started, tone === 'warning' ? 'warning' : '');
      return result;
    } finally {
      window.clearInterval(monitor);
    }
  }

  function addResultCard(result) {
    els.results.querySelector('.empty')?.remove();
    const card = document.createElement('article');
    card.className = `result-card ${result.tone === 'warning' ? 'warning-result' : result.tone === 'error' ? 'error-result' : ''}`;
    card.dataset.index = String(result.index);
    const thumbs = (result.thumbnails || []).map((url, page) =>
      `<figure><a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Signed review page ${page + 1}"></a><figcaption>Review page ${page + 1}</figcaption></figure>`
    ).join('');
    const outcome = result.error ? 'ERROR' : result.tone === 'warning' ? 'CHECK' : 'AUTO OK';
    const diagnostic = result.error || `${result.detectorTitle}\n${result.detectorStatus}\n\n${result.plan}\n\n${result.placement}`;
    card.innerHTML = `
      <div class="result-head">
        <div>
          <h3>${String(result.index).padStart(2, '0')} — ${escapeHtml(result.sourceName)}</h3>
          <div class="result-meta">${escapeHtml(result.badge || 'No badge')} — ${result.seconds}s</div>
        </div>
        <span class="badge">${outcome}</span>
      </div>
      <pre class="plan">${escapeHtml(diagnostic)}</pre>
      <div class="thumb-grid">${thumbs}</div>
      <div class="review-row">
        <label>Verdict
          <select class="verdict"><option>Not reviewed</option><option>PASS</option><option>FAIL</option></select>
        </label>
        <label>Notes
          <textarea class="notes" placeholder="Orientation, page order, ME box, signature/date placement…"></textarea>
        </label>
      </div>`;
    els.results.append(card);
    els.count.textContent = `${state.results.length} result${state.results.length === 1 ? '' : 's'}`;
  }

  async function runAll() {
    if (state.running || !state.files.length) return;
    state.running = true;
    state.stopRequested = false;
    state.results = [];
    els.results.innerHTML = '<p class="empty">No tests have completed.</p>';
    els.run.disabled = true;
    els.stop.disabled = false;
    els.download.disabled = true;
    els.files.disabled = true;
    setProgress(0, state.files.length);

    try {
      try {
        if (navigator.wakeLock?.request) state.wakeLock = await navigator.wakeLock.request('screen');
      } catch {}
      await ensureAppReady(true);

      for (let i = 0; i < state.files.length; i += 1) {
        if (state.stopRequested) break;
        const testStarted = performance.now();
        try {
          const result = await processOne(state.files[i], i, state.files.length);
          state.results.push(result);
          addResultCard(result);
        } catch (error) {
          console.error(error);
          const result = {
            index: i + 1,
            sourceName: state.files[i].name,
            tone: 'error',
            badge: 'ERROR',
            detectorTitle: '',
            detectorStatus: '',
            placement: '',
            plan: '',
            pageOptions: [],
            seconds: Math.round((performance.now() - testStarted) / 100) / 10,
            thumbnails: [],
            error: error.message || String(error)
          };
          state.results.push(result);
          addResultCard(result);
          try { await ensureAppReady(true); }
          catch (reloadError) { throw new Error(`Processor reload failed after ${state.files[i].name}: ${reloadError.message}`); }
        }
        setProgress(i + 1, state.files.length);
      }

      const errors = state.results.filter((r) => r.error).length;
      const checks = state.results.filter((r) => !r.error && r.tone === 'warning').length;
      const ok = state.results.filter((r) => !r.error && r.tone === 'ok').length;
      setStatus(`Batch complete: ${ok} AUTO OK, ${checks} CHECK, ${errors} ERROR. Visually mark each result PASS/FAIL, then download the local report.`, errors ? 'error' : 'ok');
      setTelemetry('Batch complete', `${state.results.length} tests completed.`, 100, 0, errors ? 'warning' : '');
      els.download.disabled = state.results.length === 0;
    } catch (error) {
      console.error(error);
      setStatus(`Batch stopped: ${error.message}`, 'error');
      setTelemetry('Batch stopped', error.message, 0, 0, 'error');
      els.download.disabled = state.results.length === 0;
    } finally {
      try { await state.wakeLock?.release(); } catch {}
      state.wakeLock = null;
      state.running = false;
      els.run.disabled = false;
      els.stop.disabled = true;
      els.files.disabled = false;
    }
  }

  function currentReviewInputs() {
    const values = new Map();
    document.querySelectorAll('.result-card').forEach((card) => {
      values.set(card.dataset.index, {
        verdict: card.querySelector('.verdict')?.value || 'Not reviewed',
        notes: card.querySelector('.notes')?.value || ''
      });
    });
    return values;
  }

  function reportHtml() {
    const reviews = currentReviewInputs();
    const generated = new Date().toISOString();
    const cards = state.results.map((r) => {
      const review = reviews.get(String(r.index)) || { verdict: 'Not reviewed', notes: '' };
      const images = (r.thumbnails || []).map((url, i) =>
        `<figure><img src="${url}" alt="Review page ${i + 1}"><figcaption>Page ${i + 1}</figcaption></figure>`
      ).join('');
      const diagnostic = r.error || `${r.detectorTitle}\n${r.detectorStatus}\n\n${r.plan}\n\n${r.placement}`;
      return `<section>
        <h2>${String(r.index).padStart(2,'0')} — ${escapeHtml(r.sourceName)} <span>${escapeHtml(review.verdict)}</span></h2>
        <p><strong>Automatic result:</strong> ${escapeHtml(r.error ? 'ERROR' : r.tone === 'warning' ? 'CHECK' : 'AUTO OK')} · ${escapeHtml(r.badge)} · ${r.seconds}s</p>
        <pre>${escapeHtml(diagnostic)}</pre>
        <p><strong>Notes:</strong> ${escapeHtml(review.notes || '')}</p>
        <div class="grid">${images}</div>
      </section>`;
    }).join('');

    return `<!doctype html><html><head><meta charset="utf-8"><title>MCCDSigner v0.8.0-rc1 regression report</title>
    <style>body{font-family:system-ui;margin:2rem;max-width:1300px;color:#172033}header{border-bottom:2px solid #123b6d;margin-bottom:1rem}section{border:1px solid #bbb;border-radius:12px;padding:1rem;margin:1rem 0}h2 span{font-size:.72em;background:#eee;padding:.2rem .45rem;border-radius:999px}pre{white-space:pre-wrap;background:#f4f6f8;padding:.7rem;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:.7rem}.grid img{width:100%;border:1px solid #aaa}figure{margin:0}figcaption{font-size:.8rem;color:#666}</style>
    </head><body><header><h1>MCCDSigner v0.8.0-rc1 baseline regression report</h1>
    <p>Generated ${escapeHtml(generated)}. The production v0.8.0-rc1 detector was not modified for this run.</p>
    <p><strong>Confidential:</strong> this report may contain patient-identifiable test material. Keep locally.</p></header>${cards}</body></html>`;
  }

  function downloadReport() {
    if (!state.results.length) return;
    const blob = new Blob([reportHtml()], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MCCDSigner-v0.8.0-rc1-baseline-regression-${new Date().toISOString().slice(0,10)}.html`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    setStatus('Local regression report downloaded. Keep it confidential.', 'ok');
  }

  els.files.addEventListener('change', async () => {
    try { await readSelection(els.files.files); }
    catch (error) {
      console.error(error);
      els.selection.textContent = error.message;
      els.selection.dataset.tone = 'error';
      els.run.disabled = true;
    }
  });

  els.run.addEventListener('click', runAll);
  els.stop.addEventListener('click', () => {
    state.stopRequested = true;
    els.stop.disabled = true;
    setStatus('Stop requested. The current test will finish, then the batch will stop.');
  });
  els.download.addEventListener('click', downloadReport);
  els.toggle.addEventListener('click', () => {
    const hidden = els.liveCard.classList.toggle('hidden-processor');
    els.toggle.textContent = hidden ? 'Show processor' : 'Hide processor';
  });
})();

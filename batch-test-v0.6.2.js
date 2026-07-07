(() => {
  'use strict';

  const EXPECTED_VERSION = '0.6.2';
  const MAX_TEST_MS = 5 * 60 * 1000;
  const els = {
    files: document.querySelector('#testFiles'), selection: document.querySelector('#selectionStatus'),
    run: document.querySelector('#runAll'), stop: document.querySelector('#stopRun'),
    download: document.querySelector('#downloadZip'), progress: document.querySelector('#batchProgress'),
    runStatus: document.querySelector('#runStatus'), frame: document.querySelector('#processor'),
    results: document.querySelector('#results'), count: document.querySelector('#resultCount'),
    toggle: document.querySelector('#toggleProcessor'), liveCard: document.querySelector('.live-card'),
    telemetry: document.querySelector('#liveTelemetry'), liveStage: document.querySelector('#liveStage'),
    liveElapsed: document.querySelector('#liveElapsed'), liveDetail: document.querySelector('#liveDetail'),
    testProgress: document.querySelector('#testProgress')
  };

  const state = { files: [], results: [], running: false, stopRequested: false, appReady: false, wakeLock: null, phase: 'idle' };
  const natural = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const csv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const safeName = (value) => String(value || 'MCCD').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();

  function setStatus(text, tone = '') { els.runStatus.textContent = text; els.runStatus.dataset.tone = tone; }
  function setProgress(done, total) { els.progress.style.width = `${total ? Math.max(0, Math.min(100, done / total * 100)) : 0}%`; }

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

  function clearTelemetry() {
    els.telemetry.classList.add('hidden');
    els.telemetry.dataset.tone = '';
    els.testProgress.style.width = '0%';
  }

  function startProcessorMonitor(file, index, total, started, phaseRef) {
    let lastSignature = '';
    let lastChange = performance.now();
    return window.setInterval(() => {
      try {
        const { doc } = frameContext();
        const title = (doc.querySelector('#detectorTitle')?.textContent || '').trim();
        const detail = (doc.querySelector('#detectorStatus')?.textContent || doc.querySelector('#documentStatus')?.textContent || '').trim();
        const badge = (doc.querySelector('#detectorBadge')?.textContent || '').trim();
        const innerWidth = parseFloat(doc.querySelector('#ocrProgressBar')?.style.width || '0') || 0;
        const signature = `${title}|${detail}|${badge}|${Math.round(innerWidth)}`;
        if (signature !== lastSignature) { lastSignature = signature; lastChange = performance.now(); }
        const stalledFor = performance.now() - lastChange;
        const phase = phaseRef.value;
        let stage = phase === 'review' ? 'Generating review PDF' : phase === 'opening' ? 'Opening PDF' : badge || 'Automatic detection';
        let progress = phase === 'review' ? 92 : phase === 'opening' ? 3 : Math.max(5, Math.min(88, innerWidth * 0.88));
        let tone = stalledFor > 75000 ? 'warning' : '';
        let message = detail || title || `${file.name} is being processed locally.`;
        if (stalledFor > 75000) message += ` No visible processor update for ${formatElapsed(stalledFor)}; the current OCR pass has a timeout and will either continue or be recorded as an error.`;
        setTelemetry(`Test ${index + 1}/${total}: ${stage}`, message, progress, performance.now() - started, tone);
        setProgress(index + progress / 100, total);
      } catch (error) {
        setTelemetry(`Test ${index + 1}/${total}`, `Waiting for the embedded processor: ${error.message}`, 1, performance.now() - started, 'warning');
      }
    }, 500);
  }

  async function waitFor(test, timeoutMs, label, interval = 200) {
    const start = performance.now();
    let lastError = null;
    while (performance.now() - start < timeoutMs) {
      try { const value = test(); if (value) return value; } catch (error) { lastError = error; }
      await sleep(interval);
    }
    throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
  }

  function frameContext() {
    const win = els.frame.contentWindow;
    const doc = els.frame.contentDocument;
    if (!win || !doc) throw new Error('The embedded MCCDSigner processor is unavailable.');
    return { win, doc };
  }

  async function ensureAppReady(forceReload = false) {
    if (forceReload) {
      state.appReady = false;
      els.frame.src = `./processor-v0.6.2.html?batch=062&reload=${Date.now()}`;
    }
    const ready = await waitFor(() => {
      const { win, doc } = frameContext();
      const marker = win.__MCCD_BATCH_READY__;
      const api = win.__MCCD_BATCH_API__;
      return marker?.version === EXPECTED_VERSION && api?.version === EXPECTED_VERSION && typeof api.open === 'function' ? { win, doc, api } : null;
    }, 30000, `MCCDSigner v${EXPECTED_VERSION} startup`);
    state.appReady = true;
    return ready;
  }

  async function readSelection(fileList) {
    if (!window.JSZip) throw new Error('The local ZIP helper did not load.');
    const selected = [...fileList];
    const pdfs = [];
    for (const file of selected) {
      if (/\.zip$/i.test(file.name) || /zip/i.test(file.type)) {
        els.selection.textContent = `Reading ${file.name}…`;
        const zip = await JSZip.loadAsync(file);
        const entries = Object.values(zip.files).filter((entry) => !entry.dir && /\.pdf$/i.test(entry.name));
        for (const entry of entries) {
          const bytes = await entry.async('uint8array');
          const name = entry.name.split('/').pop();
          pdfs.push(new File([bytes], name, { type: 'application/pdf', lastModified: Date.now() }));
        }
      } else if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        pdfs.push(file);
      }
    }
    pdfs.sort((a, b) => natural.compare(a.name, b.name));
    state.files = pdfs;
    state.results = [];
    renderEmpty();
    els.run.disabled = pdfs.length === 0;
    els.download.disabled = true;
    els.selection.textContent = pdfs.length ? `${pdfs.length} PDF test${pdfs.length === 1 ? '' : 's'} ready.` : 'No PDF tests were found.';
    els.selection.dataset.tone = pdfs.length ? 'ok' : 'error';
    setProgress(0, pdfs.length);
  }

  function renderEmpty() {
    els.results.innerHTML = '<p class="empty">No tests have completed.</p>';
    els.count.textContent = '0 results';
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

  async function canvasToJpeg(canvas, maxWidth = 950) {
    const scale = Math.min(1, maxWidth / canvas.width);
    const target = document.createElement('canvas');
    target.width = Math.max(1, Math.round(canvas.width * scale));
    target.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = target.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(canvas, 0, 0, target.width, target.height);
    const blob = await new Promise((resolve, reject) => target.toBlob((value) => value ? resolve(value) : reject(new Error('Thumbnail creation failed.')), 'image/jpeg', 0.78));
    return new Uint8Array(await blob.arrayBuffer());
  }

  function resultTone(detectorTitle, badge, placementTone) {
    if (/No confident|failed|could not/i.test(detectorTitle) || placementTone === 'error' || /Manual check/i.test(badge)) return 'warning';
    if (/Check box|estimated/i.test(badge + ' ' + detectorTitle)) return 'warning';
    return 'ok';
  }

  async function processOne(file, index, total) {
    const started = performance.now();
    const phaseRef = { value: 'opening' };
    const monitor = startProcessorMonitor(file, index, total, started, phaseRef);
    try {
    const { win, doc, api } = await ensureAppReady(false);
    win.__MCCD_BATCH_REVIEW__ = null;

    setStatus(`Test ${index + 1}/${total}: ${file.name} - opening and running automatic detection…`);
    phaseRef.value = 'opening';

    await api.clear();
    const bytes = await file.arrayBuffer();
    const opened = await Promise.race([
      api.open(bytes, file.name),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${file.name} direct open timed out`)), 60000))
    ]);

    await waitFor(() => {
      const status = doc.querySelector('#documentStatus')?.textContent || '';
      const card = doc.querySelector('#placementCard');
      return !card?.classList.contains('hidden') && status.includes(file.name);
    }, 10000, `${file.name} processor confirmation`);

    phaseRef.value = 'detection';
    await waitFor(() => {
      const title = doc.querySelector('#detectorTitle')?.textContent || '';
      const badge = doc.querySelector('#detectorBadge')?.textContent || '';
      const run = doc.querySelector('#runDetection');
      return run?.disabled || /v0\.6|Loading local OCR|Document normalised|No confident/i.test(`${title} ${badge}`);
    }, 30000, `${file.name} detection start`);

    await waitFor(() => {
      const title = doc.querySelector('#detectorTitle')?.textContent || '';
      const badge = doc.querySelector('#detectorBadge')?.textContent || '';
      const run = doc.querySelector('#runDetection');
      const generate = doc.querySelector('#generateReview');
      const finalTitle = /Document normalised|No confident automatic match/i.test(title);
      const finalBadge = /v0\.6|Check box|Manual check/i.test(badge) && !/Scanning|Loading/i.test(badge);
      return run && generate && !run.disabled && !generate.disabled && (finalTitle || finalBadge);
    }, MAX_TEST_MS, `${file.name} automatic detection`);

    const plan = (doc.querySelector('#normalisationSummary')?.innerText || 'No document plan returned.').trim();
    const detectorTitle = (doc.querySelector('#detectorTitle')?.textContent || '').trim();
    const detectorStatus = (doc.querySelector('#detectorStatus')?.textContent || '').trim();
    const badge = (doc.querySelector('#detectorBadge')?.textContent || '').trim();
    const placement = (doc.querySelector('#placementStatus')?.textContent || '').trim();
    const placementTone = doc.querySelector('#placementStatus')?.dataset.tone || '';
    const tone = resultTone(detectorTitle, badge, placementTone);

    phaseRef.value = 'review';
    setStatus(`Test ${index + 1}/${total}: ${file.name} - generating review PDF…`);
    doc.querySelector('#generateReview').click();
    const exported = await waitFor(() => {
      const review = win.__MCCD_BATCH_REVIEW__;
      const card = doc.querySelector('#reviewCard');
      const generate = doc.querySelector('#generateReview');
      const canvases = [...doc.querySelectorAll('#reviewPages canvas')];
      return review && !card?.classList.contains('hidden') && !generate?.disabled && canvases.length ? { review, canvases } : null;
    }, 120000, `${file.name} review PDF generation`);

    const pdfBytes = Uint8Array.from(exported.review.bytes);
    const thumbs = [];
    for (const canvas of exported.canvases) thumbs.push(await canvasToJpeg(canvas));

    const result = {
      index: index + 1, sourceName: file.name, outputName: exported.review.fileName,
      tone, badge, detectorTitle, detectorStatus, placement, plan,
      seconds: Math.round((performance.now() - started) / 100) / 10,
      pdfBytes, thumbnails: thumbs, error: ''
    };
    win.__MCCD_BATCH_REVIEW__ = null;
    setTelemetry(`Test ${index + 1}/${total}: complete`, `${file.name} completed in ${formatElapsed(performance.now() - started)}.`, 100, performance.now() - started, result.tone === 'warning' ? 'warning' : '');
    return result;
    } finally {
      window.clearInterval(monitor);
    }
  }

  function addResultCard(result) {
    const existing = els.results.querySelector('.empty'); if (existing) existing.remove();
    const card = document.createElement('article');
    card.className = `result-card ${result.tone === 'warning' ? 'warning-result' : result.tone === 'error' ? 'error-result' : ''}`;
    card.dataset.index = String(result.index);
    const pdfBlob = result.pdfBytes ? new Blob([result.pdfBytes], { type: 'application/pdf' }) : null;
    const pdfUrl = pdfBlob ? URL.createObjectURL(pdfBlob) : '';
    const thumbnails = (result.thumbnails || []).map((bytes, page) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      return `<figure><img src="${url}" alt="Review thumbnail page ${page + 1}"><figcaption>Review page ${page + 1}</figcaption></figure>`;
    }).join('');
    const outcome = result.error ? 'ERROR' : result.tone === 'warning' ? 'CHECK' : 'AUTO OK';
    card.innerHTML = `<div class="result-head"><div><h3>${String(result.index).padStart(2, '0')} - ${escapeHtml(result.sourceName)}</h3><div class="result-meta">${escapeHtml(result.badge || 'No badge')} - ${result.seconds}s</div></div><span class="badge">${outcome}</span></div>
      <pre class="plan">${escapeHtml(result.error || `${result.detectorTitle}\n${result.plan}\n${result.placement}`)}</pre>
      ${pdfUrl ? `<a class="pdf-link" href="${pdfUrl}" target="_blank" rel="noopener">Open generated review PDF</a>` : ''}
      <div class="thumb-grid">${thumbnails}</div>
      <div class="review-row"><label>Verdict<select class="verdict"><option>Not reviewed</option><option>PASS</option><option>FAIL</option></select></label><label>Notes<textarea class="notes" placeholder="Orientation, page order, red-box or stamping issue…"></textarea></label></div>`;
    els.results.append(card);
    els.count.textContent = `${state.results.length} result${state.results.length === 1 ? '' : 's'}`;
  }

  async function runAll() {
    if (state.running || !state.files.length) return;
    state.running = true; state.stopRequested = false; state.results = []; renderEmpty();
    els.run.disabled = true; els.stop.disabled = false; els.download.disabled = true; els.files.disabled = true;
    setProgress(0, state.files.length); clearTelemetry();
    try {
      try { if (navigator.wakeLock?.request) state.wakeLock = await navigator.wakeLock.request('screen'); } catch (error) { console.warn('Screen wake lock unavailable', error); }
      await ensureAppReady(true);
      for (let i = 0; i < state.files.length; i += 1) {
        if (state.stopRequested) break;
        const testStarted = performance.now();
        try {
          const result = await processOne(state.files[i], i, state.files.length);
          state.results.push(result); addResultCard(result);
        } catch (error) {
          console.error(error);
          const result = { index: i + 1, sourceName: state.files[i].name, outputName: '', tone: 'error', badge: 'ERROR', detectorTitle: '', detectorStatus: '', placement: '', plan: '', seconds: Math.round((performance.now() - testStarted) / 100) / 10, pdfBytes: null, thumbnails: [], error: error.message || String(error) };
          state.results.push(result); addResultCard(result);
          // Reload the processor after a hard failure so the next case is isolated.
          try { await ensureAppReady(true); } catch (reloadError) { throw new Error(`Processor reload failed after ${state.files[i].name}: ${reloadError.message}`); }
        }
        setProgress(i + 1, state.files.length);
      }
      const completed = state.results.filter((r) => r.pdfBytes).length;
      setStatus(`Batch complete: ${completed}/${state.results.length} review PDFs generated. Inspect the thumbnails, mark PASS/FAIL, then download the result ZIP.`, completed === state.results.length ? 'ok' : 'error');
      setTelemetry('Batch complete', `${completed}/${state.results.length} review PDFs generated.`, 100, 0, completed === state.results.length ? '' : 'warning');
      els.download.disabled = !completed;
    } catch (error) {
      console.error(error); setStatus(`Batch stopped: ${error.message}`, 'error');
      setTelemetry('Batch stopped', error.message, 0, 0, 'error');
      els.download.disabled = !state.results.some((r) => r.pdfBytes);
    } finally {
      try { await state.wakeLock?.release(); } catch {} state.wakeLock = null;
      state.running = false; els.run.disabled = false; els.stop.disabled = true; els.files.disabled = false;
    }
  }

  function reportHtml(results) {
    const cards = results.map((r) => {
      const verdict = r.verdict || 'Not reviewed';
      const images = (r.thumbnailNames || []).map((name, i) => `<figure><img src="${escapeHtml(name)}"><figcaption>Page ${i + 1}</figcaption></figure>`).join('');
      return `<section><h2>${String(r.index).padStart(2,'0')} - ${escapeHtml(r.sourceName)} <span>${escapeHtml(verdict)}</span></h2><p>${escapeHtml(r.badge)} - ${r.seconds}s</p><pre>${escapeHtml(r.error || `${r.detectorTitle}\n${r.plan}\n${r.placement}`)}</pre><p><strong>Notes:</strong> ${escapeHtml(r.notes || '')}</p>${r.outputPath ? `<p><a href="${escapeHtml(r.outputPath)}">Open generated review PDF</a></p>` : ''}<div class="grid">${images}</div></section>`;
    }).join('');
    return `<!doctype html><meta charset="utf-8"><title>MCCDSigner batch report</title><style>body{font-family:system-ui;margin:2rem;max-width:1200px}section{border:1px solid #bbb;border-radius:12px;padding:1rem;margin:1rem 0}h2 span{font-size:.75em;background:#eee;padding:.2rem .45rem;border-radius:999px}pre{white-space:pre-wrap;background:#f4f6f8;padding:.7rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:.7rem}.grid img{width:100%;border:1px solid #aaa}figure{margin:0}a{font-weight:700}</style><h1>MCCDSigner v0.6.2 batch regression report</h1><p><strong>Confidential:</strong> contains patient-identifiable test material. Keep locally.</p>${cards}`;
  }

  async function downloadResults() {
    if (!window.JSZip || !state.results.some((r) => r.pdfBytes)) return;
    els.download.disabled = true; setStatus('Building the local results ZIP…');
    const reviewValues = currentReviewInputs();
    const zip = new JSZip();
    const exportRows = [];
    for (const r of state.results) {
      const review = reviewValues.get(String(r.index)) || { verdict: 'Not reviewed', notes: '' };
      const base = `${String(r.index).padStart(2,'0')} - ${safeName(r.sourceName.replace(/\.pdf$/i,''))}`;
      const outputPath = r.pdfBytes ? `review-pdfs/${base}-PWA-TEST.pdf` : '';
      if (r.pdfBytes) zip.file(outputPath, r.pdfBytes, { binary: true });
      const thumbnailNames = [];
      (r.thumbnails || []).forEach((bytes, page) => {
        const name = `thumbnails/${base}-page-${page + 1}.jpg`;
        zip.file(name, bytes, { binary: true }); thumbnailNames.push(name);
      });
      exportRows.push({ ...r, pdfBytes: undefined, thumbnails: undefined, verdict: review.verdict, notes: review.notes, outputPath, thumbnailNames });
    }
    const headings = ['Test','Source PDF','Generated PDF','Automatic status','Detector badge','Seconds','Verdict','Notes','Document plan','Placement status','Error'];
    const lines = [headings.map(csv).join(',')];
    for (const r of exportRows) lines.push([r.index,r.sourceName,r.outputPath,r.tone,r.badge,r.seconds,r.verdict,r.notes,r.plan,r.placement,r.error].map(csv).join(','));
    zip.file('results.csv', lines.join('\r\n'));
    zip.file('results.json', JSON.stringify(exportRows, null, 2));
    zip.file('REPORT.html', reportHtml(exportRows));
    zip.file('README.txt', 'MCCDSigner v0.6.2 batch regression output\n\nCONFIDENTIAL: contains patient-identifiable test data. Keep locally and do not upload to GitHub.\n\nOpen REPORT.html after extracting the ZIP. Review each PDF and page thumbnail.\n');
    try {
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, (meta) => setStatus(`Building results ZIP: ${Math.round(meta.percent)}%`));
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = `MCCDSigner-v0.6.2-batch-results-${new Date().toISOString().slice(0,10)}.zip`; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000); setStatus('Results ZIP downloaded. Extract it and open REPORT.html.', 'ok');
    } finally { els.download.disabled = false; }
  }

  els.files.addEventListener('change', async () => {
    try { await readSelection(els.files.files); } catch (error) { console.error(error); els.selection.textContent = error.message; els.selection.dataset.tone = 'error'; els.run.disabled = true; }
  });
  els.run.addEventListener('click', runAll);
  els.stop.addEventListener('click', () => { state.stopRequested = true; els.stop.disabled = true; setStatus('Stop requested. The current test will finish, then the batch will stop.'); });
  els.download.addEventListener('click', downloadResults);
  els.toggle.addEventListener('click', () => { const hidden = els.liveCard.classList.toggle('hidden-processor'); els.toggle.textContent = hidden ? 'Show processor' : 'Hide processor'; });
  els.frame.addEventListener('load', () => { state.appReady = false; });
})();

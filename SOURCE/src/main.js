import './style.css';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import { createWorker, PSM, OEM } from 'tesseract.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const VERSION = '0.2';
const STAMP_FRACTIONS = {
  name: [0.13, 0.30],
  qualifications: [0.72, 0.20],
  gmc: [0.91, 0.30],
  signature: [0.16, 0.96],
  date: [0.94, 0.82],
};
const DEFAULT_BOX = { x: 0.025, y: 0.70, w: 0.95, h: 0.21 };

const state = {
  originalBytes: null,
  sourceName: '',
  pdfjsDoc: null,
  pageIndex: 0,
  pageInfo: [],
  userRotations: [],
  boxes: [],
  signatureBytes: null,
  signatureMime: 'image/png',
  signatureImage: null,
  reviewBytes: null,
  reviewFileName: '',
  renderSerial: 0,
  pointer: null,
  ocrWorker: null,
  ocrWorkerPromise: null,
  detectionSerial: 0,
  detectionMethod: '',
  detectionScore: null,
  detectionText: '',
  detectionConfirmed: false,
};

const app = document.querySelector('#app');
app.innerHTML = `
  <header class="app-header">
    <div>
      <p class="eyebrow">LOCAL-ONLY PROTOTYPE</p>
      <h1>MCCDSigner PWA <span>v${VERSION}</span></h1>
      <p class="subtitle">Automatic Pattern T OCR detection with manual adjustment fallback.</p>
    </div>
    <button id="installButton" class="secondary hidden" type="button">Install app</button>
  </header>

  <main>
    <section class="warning-card" aria-label="Prototype warning">
      <strong>TEST ONLY — not for live certificates.</strong>
      Every output is watermarked and named <code>-PWA-TEST.pdf</code>. Pattern T OCR is included for testing, but this build is not approved for live certificates.
    </section>

    <section class="privacy-card">
      <span class="privacy-dot" aria-hidden="true"></span>
      <div>
        <strong>Processed in this browser</strong>
        <p>No upload, analytics or telemetry. The selected PDF and signature are kept only in this page session.</p>
      </div>
      <span id="offlineStatus" class="status-pill">Checking offline cache…</span>
    </section>

    <section class="card">
      <div class="section-heading">
        <div><span class="step">1</span><h2>Test signer profile</h2></div>
        <p>Editable dummy details. Nothing is remembered after the page closes.</p>
      </div>
      <div class="form-grid">
        <label>Full name<input id="fullName" value="Dr Test User" autocomplete="off"></label>
        <label>Qualifications<input id="qualifications" value="MBBS FRCEM" autocomplete="off"></label>
        <label>GMC number<input id="gmcNumber" value="1234567" inputmode="numeric" autocomplete="off"></label>
        <label>Date<input id="stampDate" value="" inputmode="numeric" autocomplete="off"></label>
        <label class="wide">Signature image
          <input id="signatureFile" type="file" accept="image/png,image/jpeg">
          <small>Leave blank to use the supplied dummy signature.</small>
        </label>
      </div>
    </section>

    <section class="card">
      <div class="section-heading">
        <div><span class="step">2</span><h2>Open a test PDF</h2></div>
        <p>Use the supplied synthetic form first.</p>
      </div>
      <div class="button-row wrap">
        <label class="file-button primary">
          Choose PDF
          <input id="pdfFile" type="file" accept="application/pdf">
        </label>
        <button id="loadSample" class="secondary" type="button">Load supplied synthetic PDF</button>
        <button id="clearDocument" class="ghost" type="button" disabled>Clear document</button>
      </div>
      <p id="documentStatus" class="document-status">No PDF loaded.</p>
    </section>

    <section id="placementCard" class="card hidden">
      <div class="section-heading">
        <div><span class="step">3</span><h2>Detect the Medical Examiner box</h2></div>
        <p>Pattern T searches every page and rotation for the printed Medical Examiner heading. You can still drag or resize the result.</p>
      </div>
      <div class="detector-panel">
        <div>
          <strong id="detectorTitle">Automatic detector ready</strong>
          <p id="detectorStatus">Load a PDF to start Pattern T OCR.</p>
        </div>
        <div class="detector-actions">
          <span id="detectorBadge" class="detector-badge">Not run</span>
          <button id="runDetection" class="secondary compact" type="button">Run automatic detection</button>
        </div>
      </div>
      <div class="progress-track hidden" id="ocrProgressTrack"><span id="ocrProgressBar"></span></div>
      <div class="toolbar">
        <label>Page<select id="pageSelect"></select></label>
        <button id="rotateLeft" class="secondary compact" type="button">↶ 90°</button>
        <button id="rotateRight" class="secondary compact" type="button">↷ 90°</button>
        <button id="resetBox" class="secondary compact" type="button">Reset box</button>
      </div>
      <div id="stageWrap" class="stage-wrap">
        <div id="canvasStage" class="canvas-stage">
          <canvas id="pdfCanvas"></canvas>
          <canvas id="overlayCanvas" aria-label="Interactive Medical Examiner box"></canvas>
        </div>
      </div>
      <p id="placementStatus" class="help-text">The black text is a live overlay preview only. A red box can always be adjusted manually.</p>
      <div class="button-row end">
        <button id="generateReview" class="primary" type="button">Generate review PDF</button>
      </div>
    </section>

    <section id="reviewCard" class="card hidden">
      <div class="section-heading">
        <div><span class="step">4</span><h2>Review</h2></div>
        <p>No output has been saved yet.</p>
      </div>
      <div id="reviewPages" class="review-pages"></div>
      <div class="approval-bar">
        <button id="rejectReview" class="danger" type="button">Reject — discard review</button>
        <button id="approveReview" class="approve" type="button">Approve & save TEST PDF</button>
      </div>
      <p id="reviewStatus" class="help-text"></p>
    </section>
  </main>

  <footer>
    <span>MCCDSigner PWA v${VERSION}</span>
    <a href="./privacy.txt" target="_blank" rel="noopener">Privacy design</a>
  </footer>
`;

const els = {
  installButton: document.querySelector('#installButton'),
  offlineStatus: document.querySelector('#offlineStatus'),
  fullName: document.querySelector('#fullName'),
  qualifications: document.querySelector('#qualifications'),
  gmcNumber: document.querySelector('#gmcNumber'),
  stampDate: document.querySelector('#stampDate'),
  signatureFile: document.querySelector('#signatureFile'),
  pdfFile: document.querySelector('#pdfFile'),
  loadSample: document.querySelector('#loadSample'),
  clearDocument: document.querySelector('#clearDocument'),
  documentStatus: document.querySelector('#documentStatus'),
  placementCard: document.querySelector('#placementCard'),
  detectorTitle: document.querySelector('#detectorTitle'),
  detectorStatus: document.querySelector('#detectorStatus'),
  detectorBadge: document.querySelector('#detectorBadge'),
  runDetection: document.querySelector('#runDetection'),
  ocrProgressTrack: document.querySelector('#ocrProgressTrack'),
  ocrProgressBar: document.querySelector('#ocrProgressBar'),
  pageSelect: document.querySelector('#pageSelect'),
  rotateLeft: document.querySelector('#rotateLeft'),
  rotateRight: document.querySelector('#rotateRight'),
  resetBox: document.querySelector('#resetBox'),
  stageWrap: document.querySelector('#stageWrap'),
  canvasStage: document.querySelector('#canvasStage'),
  pdfCanvas: document.querySelector('#pdfCanvas'),
  overlayCanvas: document.querySelector('#overlayCanvas'),
  placementStatus: document.querySelector('#placementStatus'),
  generateReview: document.querySelector('#generateReview'),
  reviewCard: document.querySelector('#reviewCard'),
  reviewPages: document.querySelector('#reviewPages'),
  rejectReview: document.querySelector('#rejectReview'),
  approveReview: document.querySelector('#approveReview'),
  reviewStatus: document.querySelector('#reviewStatus'),
};

els.stampDate.value = formatDate(new Date());

function formatDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(date);
}

function cloneDefaultBox() {
  return { ...DEFAULT_BOX };
}

function normaliseRotation(value) {
  return ((value % 360) + 360) % 360;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setBusy(button, busy, busyText = 'Working…') {
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.originalText;
}

function setStatus(element, message, tone = '') {
  element.textContent = message;
  element.dataset.tone = tone;
}

function safeStem(name) {
  return (name || 'MCCD')
    .replace(/\.pdf$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim() || 'MCCD';
}

async function loadImageFromBytes(bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadDummySignature() {
  const response = await fetch('./samples/dummy-signature.png');
  if (!response.ok) throw new Error('The supplied dummy signature could not be loaded.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  state.signatureBytes = bytes;
  state.signatureMime = 'image/png';
  state.signatureImage = await loadImageFromBytes(bytes, state.signatureMime);
}

async function loadPdf(bytes, name) {
  clearReview();
  const input = new Uint8Array(bytes);
  const task = pdfjsLib.getDocument({ data: input.slice() });
  const doc = await task.promise;

  const pageInfo = [];
  for (let i = 0; i < doc.numPages; i += 1) {
    const page = await doc.getPage(i + 1);
    const viewport = page.getViewport({ scale: 1, rotation: 0 });
    pageInfo.push({
      baseRotation: normaliseRotation(page.rotate || 0),
      width: viewport.width,
      height: viewport.height,
    });
  }

  state.originalBytes = input;
  state.sourceName = name || 'test.pdf';
  state.pdfjsDoc = doc;
  state.pageIndex = Math.max(0, doc.numPages - 1);
  state.pageInfo = pageInfo;
  state.userRotations = Array(doc.numPages).fill(0);
  state.boxes = Array.from({ length: doc.numPages }, cloneDefaultBox);

  els.pageSelect.innerHTML = '';
  for (let i = 0; i < doc.numPages; i += 1) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `Page ${i + 1} of ${doc.numPages}`;
    els.pageSelect.append(option);
  }
  els.pageSelect.value = String(state.pageIndex);
  els.placementCard.classList.remove('hidden');
  els.clearDocument.disabled = false;
  setStatus(els.documentStatus, `${state.sourceName} — ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}.`, 'ok');
  await renderSelectedPage();
  autoDetectDocument().catch((error) => {
    console.error(error);
    showDetectionFailure(`Automatic detection failed: ${error.message}`);
  });
  els.placementCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


function setDetectorUi(title, message, badge, tone = '') {
  els.detectorTitle.textContent = title;
  els.detectorStatus.textContent = message;
  els.detectorBadge.textContent = badge;
  els.detectorBadge.dataset.tone = tone;
}

function setOcrProgress(value, visible = true) {
  const pct = clamp(Number.isFinite(value) ? value : 0, 0, 1);
  els.ocrProgressTrack.classList.toggle('hidden', !visible);
  els.ocrProgressBar.style.width = `${Math.round(pct * 100)}%`;
}

function normaliseOcrText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
}

function levenshtein(a, b) {
  const aa = String(a || '');
  const bb = String(b || '');
  if (!aa.length) return bb.length;
  if (!bb.length) return aa.length;
  const previous = Array.from({ length: bb.length + 1 }, (_, i) => i);
  const current = new Array(bb.length + 1);
  for (let i = 1; i <= aa.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= bb.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (aa[i - 1] === bb[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= bb.length; j += 1) previous[j] = current[j];
  }
  return previous[bb.length];
}

function wordSimilarity(a, b) {
  const aa = normaliseOcrText(a).replace(/ /g, '');
  const bb = normaliseOcrText(b).replace(/ /g, '');
  if (!aa || !bb) return 0;
  return 1 - levenshtein(aa, bb) / Math.max(aa.length, bb.length);
}

function unionBboxes(words) {
  const usable = words.filter((word) => word?.bbox);
  if (!usable.length) return null;
  return usable.reduce((box, word) => ({
    x0: Math.min(box.x0, word.bbox.x0),
    y0: Math.min(box.y0, word.bbox.y0),
    x1: Math.max(box.x1, word.bbox.x1),
    y1: Math.max(box.y1, word.bbox.y1),
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
}

function flattenOcrLines(blocks) {
  const lines = [];
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        if (line?.words?.length) lines.push(line);
      }
    }
  }
  lines.sort((a, b) => (a.bbox?.y0 || 0) - (b.bbox?.y0 || 0));
  return lines;
}

function phraseMatchForWords(words) {
  const tokens = [];
  for (const word of words || []) {
    const token = normaliseOcrText(word.text).replace(/ /g, '');
    if (token) tokens.push({ token, word });
  }
  if (!tokens.length) return null;

  let best = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const medical = wordSimilarity(tokens[i].token, 'MEDICAL');
    if (medical < 0.66) continue;
    for (let j = i + 1; j <= Math.min(tokens.length - 1, i + 3); j += 1) {
      const examiner = wordSimilarity(tokens[j].token, 'EXAMINER');
      if (examiner < 0.62) continue;
      for (let k = j + 1; k <= Math.min(tokens.length - 1, j + 5); k += 1) {
        const complete = wordSimilarity(tokens[k].token, 'COMPLETE');
        if (complete < 0.62) continue;
        const matched = tokens.slice(i, k + 1).map((entry) => entry.word);
        const exactText = normaliseOcrText(matched.map((word) => word.text).join(' '));
        let score = 78 + ((medical + examiner + complete) / 3) * 20;
        if (exactText.includes('MEDICAL EXAMINER TO COMPLETE')) score = Math.max(score, 99);
        if (exactText.includes('FOR THE MEDICAL EXAMINER TO COMPLETE')) score = 100;
        const candidate = {
          score: Math.min(100, score),
          bbox: unionBboxes(matched),
          text: matched.map((word) => word.text).join(' '),
        };
        if (!best || candidate.score > best.score) best = candidate;
      }
    }
  }
  return best;
}

function findMedicalExaminerHeading(blocks) {
  const lines = flattenOcrLines(blocks);
  let best = null;
  for (let i = 0; i < lines.length; i += 1) {
    const single = phraseMatchForWords(lines[i].words);
    if (single && (!best || single.score > best.score)) best = single;

    if (i + 1 < lines.length) {
      const a = lines[i];
      const b = lines[i + 1];
      const aHeight = Math.max(1, (a.bbox?.y1 || 0) - (a.bbox?.y0 || 0));
      const gap = (b.bbox?.y0 || 0) - (a.bbox?.y1 || 0);
      if (gap >= -aHeight && gap <= aHeight * 2.5) {
        const pair = phraseMatchForWords([...(a.words || []), ...(b.words || [])]);
        if (pair && (!best || pair.score > best.score)) best = pair;
      }
    }
  }
  if (best && best.score >= 88) {
    best.lines = lines;
    return best;
  }
  return null;
}

function buildDarkMask(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    mask[p] = luminance < 185 ? 1 : 0;
  }
  return mask;
}

function horizontalRunsAt(mask, width, height, y, bandHalf, gapTolerance) {
  const top = Math.max(0, y - bandHalf);
  const bottom = Math.min(height - 1, y + bandHalf);
  const darkColumns = new Uint8Array(width);
  for (let x = 0; x < width; x += 1) {
    for (let yy = top; yy <= bottom; yy += 1) {
      if (mask[yy * width + x]) {
        darkColumns[x] = 1;
        break;
      }
    }
  }

  const runs = [];
  let start = -1;
  let lastDark = -1;
  let darkCount = 0;
  const finish = () => {
    if (start < 0 || lastDark < start) return;
    const runWidth = lastDark - start + 1;
    runs.push({
      x0: start,
      x1: lastDark,
      width: runWidth,
      density: darkCount / runWidth,
      y,
    });
  };

  for (let x = 0; x < width; x += 1) {
    if (darkColumns[x]) {
      if (start < 0) start = x;
      lastDark = x;
      darkCount += 1;
    } else if (start >= 0 && x - lastDark > gapTolerance) {
      finish();
      start = -1;
      lastDark = -1;
      darkCount = 0;
    }
  }
  finish();
  return runs;
}

function findHorizontalBorder(mask, width, height, yStart, yEnd, heading, minWidth, preferY, mode = 'best', reference = null) {
  const bandHalf = Math.max(3, Math.round(width * 0.01));
  const gapTolerance = Math.max(3, Math.round(width * 0.01));
  const centreX = (heading.x0 + heading.x1) / 2;
  const candidates = [];
  for (let y = Math.max(0, Math.round(yStart)); y <= Math.min(height - 1, Math.round(yEnd)); y += 1) {
    const runs = horizontalRunsAt(mask, width, height, y, bandHalf, gapTolerance);
    for (const run of runs) {
      if (run.width < minWidth || run.density < 0.55) continue;
      if (!(run.x0 <= centreX && run.x1 >= centreX)) continue;
      if (run.x0 > heading.x0 + Math.max(20, width * 0.02)) continue;
      if (run.x1 < heading.x1 - Math.max(20, width * 0.02)) continue;
      if (reference) {
        const overlap = Math.max(0, Math.min(run.x1, reference.x1) - Math.max(run.x0, reference.x0));
        if (overlap < Math.min(run.width, reference.width) * 0.58) continue;
      }
      const score = run.width + run.density * width * 0.25 - Math.abs(y - preferY) * 0.35;
      candidates.push({ ...run, score });
    }
  }
  if (!candidates.length) return null;
  if (mode === 'first') {
    candidates.sort((a, b) => a.y - b.y || b.score - a.score);
    return candidates[0];
  }
  if (mode === 'last') {
    candidates.sort((a, b) => b.y - a.y || b.score - a.score);
    const candidate = candidates[0];
    // The scan band remains dark for several rows after a thin rule. Move the
    // reported Y back to the top of that band so the red box hugs the border.
    return { ...candidate, y: Math.max(0, candidate.y - bandHalf) };
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

function locateBoxAroundHeading(canvas, heading, ocrLines = []) {
  const width = canvas.width;
  const height = canvas.height;
  const lineHeight = Math.max(8, heading.y1 - heading.y0);
  const headingWidth = Math.max(1, heading.x1 - heading.x0);
  const mask = buildDarkMask(canvas);
  const minWidth = Math.max(width * 0.38, headingWidth * 1.25);

  const top = findHorizontalBorder(
    mask,
    width,
    height,
    heading.y0 - Math.max(100, lineHeight * 5.5),
    heading.y0 + lineHeight * 1.2,
    heading,
    minWidth,
    heading.y0 - lineHeight * 1.5,
    'best',
  );
  if (!top) return null;

  const footer = (ocrLines || [])
    .filter((line) => {
      if (!line?.bbox || line.bbox.y0 <= heading.y1) return false;
      if (line.bbox.y0 >= heading.y1 + height * 0.38) return false;
      const text = normaliseOcrText(line.text);
      return text.includes('SIGNATURE') || text.includes('DATE DD') || text.includes('DD MM YYYY');
    })
    .sort((a, b) => b.bbox.y1 - a.bbox.y1)[0] || null;

  // Interior dotted rules can look like horizontal borders. Search below the
  // heading, then choose the LOWEST line that still aligns with the top edge.
  // If OCR found the Signature/Date line, start beneath it; otherwise skip the
  // upper 7.5% of the candidate box so the Full-name dotted line cannot win.
  const minimumBoxHeight = Math.max(height * 0.075, lineHeight * 5);
  const maximumBoxHeight = Math.min(height * 0.40, Math.max(height * 0.24, lineHeight * 28));
  let bottomStart = top.y + minimumBoxHeight;
  if (footer) bottomStart = Math.max(bottomStart, footer.bbox.y1 + 1);
  const bottomEnd = Math.min(height - 1, top.y + maximumBoxHeight);

  const bottom = findHorizontalBorder(
    mask,
    width,
    height,
    bottomStart,
    bottomEnd,
    heading,
    Math.max(width * 0.36, top.width * 0.58),
    bottomEnd,
    'last',
    top,
  );
  if (!bottom) return null;

  const x0 = Math.round((top.x0 + bottom.x0) / 2);
  const x1 = Math.round((top.x1 + bottom.x1) / 2);
  const y0 = top.y;
  const y1 = bottom.y;
  const boxWidth = x1 - x0;
  const boxHeight = y1 - y0;
  if (boxWidth < width * 0.4) return null;
  if (boxHeight < height * 0.07 || boxHeight > height * 0.36) return null;
  if (heading.y0 < y0 - lineHeight || heading.y1 > y1) return null;
  if ((heading.y0 - y0) / boxHeight > 0.28) return null;

  return {
    x: clamp(x0 / width, 0, 1),
    y: clamp(y0 / height, 0, 1),
    w: clamp(boxWidth / width, 0.05, 1),
    h: clamp(boxHeight / height, 0.05, 1),
    geometryScore: Math.round(((top.density + bottom.density) / 2) * 100),
  };
}

function estimatedBoxFromHeading(canvas, heading) {
  const width = canvas.width;
  const height = canvas.height;
  const x = clamp((heading.x0 - width * 0.025) / width, 0, 0.25);
  const y = clamp((heading.y0 - height * 0.025) / height, 0, 0.85);
  return {
    x,
    y,
    w: clamp(Math.max(0.7, 1 - x - 0.025), 0.35, 1 - x),
    h: clamp(0.2, 0.09, 1 - y),
  };
}

async function getOcrWorker() {
  if (state.ocrWorker) return state.ocrWorker;
  if (state.ocrWorkerPromise) return state.ocrWorkerPromise;

  setDetectorUi('Loading local OCR engine', 'Preparing the bundled English OCR model. This happens once per app session.', 'Loading', 'working');
  setOcrProgress(0.02, true);
  const base = document.baseURI;
  state.ocrWorkerPromise = createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: new URL('./ocr/worker.min.js', base).href,
    corePath: new URL('./ocr/core/', base).href.replace(/\/$/, ''),
    langPath: new URL('./ocr/lang/', base).href.replace(/\/$/, ''),
    cacheMethod: 'write',
    logger: (message) => {
      const context = state.ocrProgressContext;
      if (!context) return;
      const progress = Number.isFinite(message.progress) ? message.progress : 0;
      setOcrProgress((context.index + progress) / context.total, true);
      if (message.status) {
        els.detectorStatus.textContent = `${context.label}: ${message.status.replace(/_/g, ' ')}…`;
      }
    },
  }).then(async (worker) => {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '220',
    });
    state.ocrWorker = worker;
    return worker;
  }).catch((error) => {
    state.ocrWorkerPromise = null;
    throw error;
  });
  return state.ocrWorkerPromise;
}

async function renderPageForOcr(pageIndex, totalRotation) {
  const page = await state.pdfjsDoc.getPage(pageIndex + 1);
  const baseViewport = page.getViewport({ scale: 1, rotation: totalRotation });
  const targetLongestSide = 2050;
  const scale = clamp(targetLongestSide / Math.max(baseViewport.width, baseViewport.height), 1.55, 2.8);
  const viewport = page.getViewport({ scale, rotation: totalRotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({
    canvasContext: canvas.getContext('2d', { alpha: false, willReadFrequently: true }),
    viewport,
  }).promise;
  return canvas;
}

function detectionAttempts() {
  const attempts = [];
  const pageOrder = Array.from({ length: state.pdfjsDoc.numPages }, (_, i) => i).reverse();
  const deltas = [0, 90, 270, 180];
  for (const pageIndex of pageOrder) {
    const base = state.pageInfo[pageIndex].baseRotation;
    for (const delta of deltas) {
      attempts.push({
        pageIndex,
        totalRotation: normaliseRotation(base + delta),
      });
    }
  }
  return attempts;
}

function applyDetection(pageIndex, totalRotation, box, match, confirmed) {
  const base = state.pageInfo[pageIndex].baseRotation;
  state.pageIndex = pageIndex;
  state.userRotations[pageIndex] = normaliseRotation(totalRotation - base);
  state.boxes[pageIndex] = { ...box };
  state.detectionMethod = confirmed ? 'Pattern T' : 'Pattern T heading only';
  state.detectionScore = match.score;
  state.detectionText = normaliseOcrText(match.text);
  state.detectionConfirmed = confirmed;
  els.pageSelect.value = String(pageIndex);
}

function showDetectionFailure(message) {
  state.detectionConfirmed = false;
  setDetectorUi('No confident automatic match', message, 'Manual check', 'warning');
  setOcrProgress(0, false);
  setStatus(els.placementStatus, 'Pattern T did not confirm the complete box. Position the red box manually or re-run detection.', 'error');
}

async function autoDetectDocument(force = false) {
  if (!state.pdfjsDoc) return;
  const serial = ++state.detectionSerial;
  clearReview();
  setBusy(els.runDetection, true, 'Scanning…');
  els.generateReview.disabled = true;
  state.detectionConfirmed = false;
  setDetectorUi('Pattern T OCR scanning', 'Preparing to inspect the likely ME page first, then other rotations.', 'Scanning', 'working');
  setOcrProgress(0.01, true);

  try {
    const worker = await getOcrWorker();
    const attempts = detectionAttempts();
    let bestHeadingOnly = null;

    for (let index = 0; index < attempts.length; index += 1) {
      if (serial !== state.detectionSerial) return;
      const attempt = attempts[index];
      const label = `Page ${attempt.pageIndex + 1}/${state.pdfjsDoc.numPages}, rotation ${attempt.totalRotation}°`;
      state.ocrProgressContext = { index, total: attempts.length, label };
      setDetectorUi('Pattern T OCR scanning', `${label}: rendering locally…`, `${index + 1}/${attempts.length}`, 'working');
      setOcrProgress(index / attempts.length, true);

      const canvas = await renderPageForOcr(attempt.pageIndex, attempt.totalRotation);
      if (serial !== state.detectionSerial) return;
      const result = await worker.recognize(canvas, {}, { blocks: true, text: true });
      if (serial !== state.detectionSerial) return;
      const match = findMedicalExaminerHeading(result.data.blocks);
      if (!match) continue;

      const box = locateBoxAroundHeading(canvas, match.bbox, match.lines);
      if (box) {
        applyDetection(attempt.pageIndex, attempt.totalRotation, box, match, true);
        await renderSelectedPage();
        setDetectorUi(
          'Medical Examiner box found',
          `Pattern T matched “${match.text.trim()}” on page ${attempt.pageIndex + 1} at ${attempt.totalRotation}°. OCR ${Math.round(match.score)}%; border ${box.geometryScore}%.`,
          'Pattern T ✓',
          'ok',
        );
        setOcrProgress(1, true);
        setStatus(els.placementStatus, 'Automatic OCR result shown. Check the red box, then generate the TEST review PDF.', 'ok');
        return;
      }

      if (!bestHeadingOnly || match.score > bestHeadingOnly.match.score) {
        bestHeadingOnly = { attempt, match, canvas };
      }
    }

    if (bestHeadingOnly) {
      const { attempt, match, canvas } = bestHeadingOnly;
      applyDetection(
        attempt.pageIndex,
        attempt.totalRotation,
        estimatedBoxFromHeading(canvas, match.bbox),
        match,
        false,
      );
      await renderSelectedPage();
      setDetectorUi(
        'Heading found; box border needs checking',
        `Pattern T found the ME heading on page ${attempt.pageIndex + 1} at ${attempt.totalRotation}°, but could not confirm both box borders. Adjust the red box manually.`,
        'Needs adjustment',
        'warning',
      );
      setOcrProgress(1, true);
      setStatus(els.placementStatus, 'The page and orientation are automatic; the estimated red box requires visual confirmation.', 'error');
      return;
    }

    showDetectionFailure('The phrase “For the medical examiner to complete” was not recognised in any tested page orientation.');
  } catch (error) {
    console.error(error);
    showDetectionFailure(`Local OCR could not complete: ${error.message}`);
  } finally {
    state.ocrProgressContext = null;
    if (serial === state.detectionSerial) {
      setBusy(els.runDetection, false);
      els.generateReview.disabled = false;
    }
  }
}

async function renderSelectedPage() {
  if (!state.pdfjsDoc) return;
  const serial = ++state.renderSerial;
  setStatus(els.placementStatus, 'Rendering page…');

  const page = await state.pdfjsDoc.getPage(state.pageIndex + 1);
  const totalRotation = normaliseRotation(
    state.pageInfo[state.pageIndex].baseRotation + state.userRotations[state.pageIndex]
  );
  const baseViewport = page.getViewport({ scale: 1, rotation: totalRotation });
  const cssWidth = Math.max(280, Math.min(1000, els.stageWrap.clientWidth - 4));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const renderScale = (cssWidth / baseViewport.width) * dpr;
  const viewport = page.getViewport({ scale: renderScale, rotation: totalRotation });

  const canvas = els.pdfCanvas;
  const overlay = els.overlayCanvas;
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  overlay.width = canvas.width;
  overlay.height = canvas.height;

  const cssHeight = viewport.height / dpr;
  canvas.style.width = `${viewport.width / dpr}px`;
  canvas.style.height = `${cssHeight}px`;
  overlay.style.width = canvas.style.width;
  overlay.style.height = canvas.style.height;
  els.canvasStage.style.width = canvas.style.width;
  els.canvasStage.style.height = canvas.style.height;

  const context = canvas.getContext('2d', { alpha: false });
  await page.render({ canvasContext: context, viewport }).promise;
  if (serial !== state.renderSerial) return;

  drawOverlay();
  setStatus(
    els.placementStatus,
    `Page ${state.pageIndex + 1}; final rotation ${totalRotation}°. Drag the red box and resize handle.`
  );
}

function profile() {
  return {
    name: els.fullName.value.trim() || 'Dr Test User',
    qualifications: els.qualifications.value.trim() || 'MBBS FRCEM',
    gmc: els.gmcNumber.value.trim() || '1234567',
    date: els.stampDate.value.trim() || formatDate(new Date()),
  };
}

function drawOverlay() {
  const canvas = els.overlayCanvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.pdfjsDoc) return;

  const norm = state.boxes[state.pageIndex];
  const box = {
    x: norm.x * canvas.width,
    y: norm.y * canvas.height,
    w: norm.w * canvas.width,
    h: norm.h * canvas.height,
  };
  const totalRotation = normaliseRotation(
    state.pageInfo[state.pageIndex].baseRotation + state.userRotations[state.pageIndex]
  );
  const info = state.pageInfo[state.pageIndex];
  const displayWidthPt = totalRotation % 180 === 0 ? info.width : info.height;
  const boxWidthPt = norm.w * displayWidthPt;
  const sizeScale = clamp(boxWidthPt / 790, 0.55, 1.15);
  const pxPerPt = canvas.width / displayWidthPt;
  const p = profile();

  ctx.save();
  ctx.strokeStyle = '#e11d48';
  ctx.lineWidth = Math.max(3, canvas.width / 360);
  ctx.setLineDash([]);
  ctx.strokeRect(box.x, box.y, box.w, box.h);

  const handleSize = Math.max(24, canvas.width / 35);
  ctx.fillStyle = '#e11d48';
  ctx.fillRect(box.x + box.w - handleSize / 2, box.y + box.h - handleSize / 2, handleSize, handleSize);

  ctx.fillStyle = 'rgba(225,29,72,0.95)';
  ctx.font = `bold ${Math.max(18, canvas.width / 55)}px system-ui, sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.fillText('Medical Examiner box', box.x + 5, Math.max(22, box.y - 6));

  const text = (value, key, baseSize, align = 'left') => {
    const [fx, fy] = STAMP_FRACTIONS[key];
    const x = box.x + fx * box.w;
    const y = box.y + fy * box.h;
    const sizePx = Math.max(10, baseSize * sizeScale * pxPerPt);
    ctx.font = `${sizePx}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = align;
    ctx.fillStyle = '#111827';
    ctx.fillText(value, x, y);
  };

  text(p.name, 'name', 13, 'left');
  text(p.qualifications, 'qualifications', 10, 'center');
  text(p.gmc, 'gmc', 13, 'left');
  text(p.date, 'date', 13, 'center');

  if (state.signatureImage) {
    const [fx, fy] = STAMP_FRACTIONS.signature;
    const anchorX = box.x + fx * box.w;
    const anchorY = box.y + fy * box.h;
    const width = 165 * sizeScale * pxPerPt;
    const height = 56 * sizeScale * pxPerPt;
    ctx.drawImage(state.signatureImage, anchorX, anchorY - height, width, height);
  }

  ctx.restore();
}

function pointerPosition(event) {
  const rect = els.overlayCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  };
}

function onPointerDown(event) {
  if (!state.pdfjsDoc) return;
  const point = pointerPosition(event);
  const box = state.boxes[state.pageIndex];
  const handle = Math.max(0.025, 28 / els.overlayCanvas.getBoundingClientRect().width);
  const nearHandle =
    Math.abs(point.x - (box.x + box.w)) <= handle &&
    Math.abs(point.y - (box.y + box.h)) <= handle;
  const inside =
    point.x >= box.x && point.x <= box.x + box.w &&
    point.y >= box.y && point.y <= box.y + box.h;
  if (!nearHandle && !inside) return;

  state.detectionConfirmed = false;
  setDetectorUi('Manual adjustment', 'The automatic result has been changed manually. Check the red box carefully.', 'Manual', 'manual');
  state.pointer = {
    id: event.pointerId,
    mode: nearHandle ? 'resize' : 'move',
    startX: point.x,
    startY: point.y,
    original: { ...box },
  };
  els.overlayCanvas.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onPointerMove(event) {
  const drag = state.pointer;
  if (!drag || drag.id !== event.pointerId) return;
  const point = pointerPosition(event);
  const dx = point.x - drag.startX;
  const dy = point.y - drag.startY;
  const box = state.boxes[state.pageIndex];

  if (drag.mode === 'move') {
    box.x = clamp(drag.original.x + dx, 0, 1 - drag.original.w);
    box.y = clamp(drag.original.y + dy, 0, 1 - drag.original.h);
  } else {
    box.w = clamp(drag.original.w + dx, 0.25, 1 - drag.original.x);
    box.h = clamp(drag.original.h + dy, 0.08, 1 - drag.original.y);
  }
  drawOverlay();
  event.preventDefault();
}

function endPointer(event) {
  if (!state.pointer || state.pointer.id !== event.pointerId) return;
  state.pointer = null;
  try { els.overlayCanvas.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
}

function displayToPdf(dx, dy, width, height, rotation) {
  switch (normaliseRotation(rotation)) {
    case 0:
      return { x: dx, y: height - dy };
    case 90:
      return { x: dy, y: dx };
    case 180:
      return { x: width - dx, y: dy };
    case 270:
      return { x: width - dy, y: height - dx };
    default:
      throw new Error(`Unsupported rotation: ${rotation}`);
  }
}

function drawDisplayText(page, font, text, dx, dy, size, rotation, options = {}) {
  const width = page.getWidth();
  const height = page.getHeight();
  const textWidth = font.widthOfTextAtSize(text, size);
  const startX = options.align === 'center' ? dx - textWidth / 2 : dx;
  const point = displayToPdf(startX, dy, width, height, rotation);
  page.drawText(text, {
    x: point.x,
    y: point.y,
    size,
    font,
    rotate: degrees(normaliseRotation(rotation)),
    color: options.color || rgb(0, 0, 0),
    opacity: options.opacity ?? 1,
  });
}

async function buildReviewPdf() {
  if (!state.originalBytes) throw new Error('Choose a PDF first.');
  if (!state.signatureBytes) throw new Error('The signature image is not available.');

  const source = await PDFDocument.load(state.originalBytes.slice(), { ignoreEncryption: false });
  const output = await PDFDocument.create();
  const copiedPages = await output.copyPages(source, source.getPageIndices());
  copiedPages.forEach((page) => output.addPage(page));

  const font = await output.embedFont(StandardFonts.Helvetica);
  const boldFont = await output.embedFont(StandardFonts.HelveticaBold);
  let signature;
  if (state.signatureMime === 'image/jpeg') {
    signature = await output.embedJpg(state.signatureBytes);
  } else {
    signature = await output.embedPng(state.signatureBytes);
  }

  for (let i = 0; i < output.getPageCount(); i += 1) {
    const page = output.getPage(i);
    const totalRotation = normaliseRotation(state.pageInfo[i].baseRotation + state.userRotations[i]);
    page.setRotation(degrees(totalRotation));
  }

  const page = output.getPage(state.pageIndex);
  const rotation = normaliseRotation(
    state.pageInfo[state.pageIndex].baseRotation + state.userRotations[state.pageIndex]
  );
  const width = page.getWidth();
  const height = page.getHeight();
  const displayWidth = rotation % 180 === 0 ? width : height;
  const displayHeight = rotation % 180 === 0 ? height : width;
  const norm = state.boxes[state.pageIndex];
  const box = {
    x: norm.x * displayWidth,
    y: norm.y * displayHeight,
    w: norm.w * displayWidth,
    h: norm.h * displayHeight,
  };
  const sizeScale = clamp(box.w / 790, 0.55, 1.15);
  const p = profile();

  const anchor = (key) => {
    const [fx, fy] = STAMP_FRACTIONS[key];
    return { x: box.x + fx * box.w, y: box.y + fy * box.h };
  };

  const name = anchor('name');
  drawDisplayText(page, font, p.name, name.x, name.y, Math.max(6, 13 * sizeScale), rotation);

  const qualifications = anchor('qualifications');
  drawDisplayText(
    page, font, p.qualifications,
    qualifications.x, qualifications.y,
    Math.max(6, 10 * sizeScale), rotation,
    { align: 'center' }
  );

  const gmc = anchor('gmc');
  drawDisplayText(page, font, p.gmc, gmc.x, gmc.y, Math.max(6, 13 * sizeScale), rotation);

  const date = anchor('date');
  drawDisplayText(page, font, p.date, date.x, date.y, Math.max(6, 13 * sizeScale), rotation, { align: 'center' });

  const sig = anchor('signature');
  const sigPoint = displayToPdf(sig.x, sig.y, width, height, rotation);
  page.drawImage(signature, {
    x: sigPoint.x,
    y: sigPoint.y,
    width: 165 * sizeScale,
    height: 56 * sizeScale,
    rotate: degrees(rotation),
  });

  drawDisplayText(
    page,
    boldFont,
    'MCCDSigner PWA v0.2a — TEST OUTPUT',
    12,
    18,
    9,
    rotation,
    { color: rgb(0.85, 0.05, 0.12), opacity: 0.9 }
  );

  output.setTitle(`${safeStem(state.sourceName)} — MCCDSigner PWA v0.2a TEST`);
  output.setProducer('MCCDSigner PWA v0.2a test prototype');
  output.setCreator('MCCDSigner PWA v0.2a');

  return new Uint8Array(await output.save({ useObjectStreams: false }));
}

async function renderReview(bytes) {
  els.reviewPages.innerHTML = '';
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const maxWidth = Math.max(280, Math.min(950, els.reviewPages.clientWidth - 4));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  for (let i = 0; i < doc.numPages; i += 1) {
    const wrapper = document.createElement('figure');
    wrapper.className = 'review-page';
    const caption = document.createElement('figcaption');
    caption.textContent = `Review page ${i + 1} of ${doc.numPages}`;
    const canvas = document.createElement('canvas');
    wrapper.append(caption, canvas);
    els.reviewPages.append(wrapper);

    const page = await doc.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const scale = (maxWidth / base.width) * dpr;
    const viewport = page.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }
}

function clearReview() {
  state.reviewBytes = null;
  state.reviewFileName = '';
  els.reviewPages.innerHTML = '';
  els.reviewCard.classList.add('hidden');
  setStatus(els.reviewStatus, '');
}

function clearDocument() {
  clearReview();
  state.originalBytes = null;
  state.sourceName = '';
  state.pdfjsDoc = null;
  state.pageInfo = [];
  state.userRotations = [];
  state.boxes = [];
  state.detectionMethod = '';
  state.detectionScore = null;
  state.detectionText = '';
  state.detectionConfirmed = false;
  state.detectionSerial += 1;
  setDetectorUi('Automatic detector ready', 'Load a PDF to start Pattern T OCR.', 'Not run', '');
  setOcrProgress(0, false);
  els.pdfFile.value = '';
  els.placementCard.classList.add('hidden');
  els.clearDocument.disabled = true;
  setStatus(els.documentStatus, 'No PDF loaded.');
  els.pdfCanvas.getContext('2d').clearRect(0, 0, els.pdfCanvas.width, els.pdfCanvas.height);
  els.overlayCanvas.getContext('2d').clearRect(0, 0, els.overlayCanvas.width, els.overlayCanvas.height);
}

async function saveOrShareReview() {
  if (!state.reviewBytes) return;
  const file = new File([state.reviewBytes], state.reviewFileName, { type: 'application/pdf' });
  try {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: state.reviewFileName,
        text: 'MCCDSigner PWA v0.2a TEST output',
        files: [file],
      });
      setStatus(els.reviewStatus, 'TEST PDF passed to the Android share sheet.', 'ok');
      return;
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      setStatus(els.reviewStatus, 'Share cancelled; the review remains available.');
      return;
    }
    console.warn('Web Share failed; falling back to download.', error);
  }

  const blob = new Blob([state.reviewBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = state.reviewFileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  setStatus(els.reviewStatus, 'TEST PDF downloaded.', 'ok');
}

els.pdfFile.addEventListener('change', async () => {
  const file = els.pdfFile.files?.[0];
  if (!file) return;
  try {
    setStatus(els.documentStatus, 'Opening PDF…');
    await loadPdf(await file.arrayBuffer(), file.name);
  } catch (error) {
    console.error(error);
    setStatus(els.documentStatus, `Could not open PDF: ${error.message}`, 'error');
  }
});

els.loadSample.addEventListener('click', async () => {
  setBusy(els.loadSample, true, 'Loading sample…');
  try {
    const response = await fetch('./samples/MCCDSigner_PWA_test_form.pdf');
    if (!response.ok) throw new Error('The supplied sample PDF was not found.');
    await loadPdf(await response.arrayBuffer(), 'MCCDSigner_PWA_test_form.pdf');
  } catch (error) {
    console.error(error);
    setStatus(els.documentStatus, error.message, 'error');
  } finally {
    setBusy(els.loadSample, false);
  }
});

els.clearDocument.addEventListener('click', clearDocument);

els.runDetection.addEventListener('click', async () => {
  if (!state.pdfjsDoc) return;
  await autoDetectDocument(true);
});

els.pageSelect.addEventListener('change', async () => {
  state.pageIndex = Number(els.pageSelect.value);
  state.detectionConfirmed = false;
  setDetectorUi('Manual placement', 'Page changed manually. Re-run Pattern T or confirm the red box visually.', 'Manual', 'manual');
  clearReview();
  await renderSelectedPage();
});

els.rotateLeft.addEventListener('click', async () => {
  state.userRotations[state.pageIndex] = normaliseRotation(state.userRotations[state.pageIndex] - 90);
  state.detectionConfirmed = false;
  setDetectorUi('Manual placement', 'Rotation changed manually. Re-run Pattern T or confirm the red box visually.', 'Manual', 'manual');
  state.boxes[state.pageIndex] = cloneDefaultBox();
  clearReview();
  await renderSelectedPage();
});

els.rotateRight.addEventListener('click', async () => {
  state.userRotations[state.pageIndex] = normaliseRotation(state.userRotations[state.pageIndex] + 90);
  state.detectionConfirmed = false;
  setDetectorUi('Manual placement', 'Rotation changed manually. Re-run Pattern T or confirm the red box visually.', 'Manual', 'manual');
  state.boxes[state.pageIndex] = cloneDefaultBox();
  clearReview();
  await renderSelectedPage();
});

els.resetBox.addEventListener('click', () => {
  state.boxes[state.pageIndex] = cloneDefaultBox();
  state.detectionConfirmed = false;
  setDetectorUi('Manual placement', 'Box reset manually. Re-run Pattern T or position it visually.', 'Manual', 'manual');
  clearReview();
  drawOverlay();
});

for (const input of [els.fullName, els.qualifications, els.gmcNumber, els.stampDate]) {
  input.addEventListener('input', () => {
    clearReview();
    drawOverlay();
  });
}

els.signatureFile.addEventListener('change', async () => {
  const file = els.signatureFile.files?.[0];
  clearReview();
  if (!file) {
    await loadDummySignature();
    drawOverlay();
    return;
  }
  try {
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      throw new Error('Use a PNG or JPEG signature image.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.signatureBytes = bytes;
    state.signatureMime = file.type;
    state.signatureImage = await loadImageFromBytes(bytes, file.type);
    drawOverlay();
  } catch (error) {
    console.error(error);
    alert(error.message);
    els.signatureFile.value = '';
    await loadDummySignature();
    drawOverlay();
  }
});

els.overlayCanvas.addEventListener('pointerdown', onPointerDown);
els.overlayCanvas.addEventListener('pointermove', onPointerMove);
els.overlayCanvas.addEventListener('pointerup', endPointer);
els.overlayCanvas.addEventListener('pointercancel', endPointer);

els.generateReview.addEventListener('click', async () => {
  setBusy(els.generateReview, true, 'Generating review…');
  clearReview();
  try {
    const bytes = await buildReviewPdf();
    state.reviewBytes = bytes;
    state.reviewFileName = `${safeStem(state.sourceName)}-PWA-TEST.pdf`;
    els.reviewCard.classList.remove('hidden');
    setStatus(els.reviewStatus, `${state.reviewFileName} is in memory only. Review it before saving.`);
    await renderReview(bytes);
    els.reviewCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error(error);
    alert(`Review PDF could not be created:\n\n${error.message}`);
  } finally {
    setBusy(els.generateReview, false);
  }
});

els.rejectReview.addEventListener('click', () => {
  clearReview();
  setStatus(els.placementStatus, 'Review rejected. No TEST PDF was saved.', 'ok');
  els.placementCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

els.approveReview.addEventListener('click', saveOrShareReview);

window.addEventListener('resize', () => {
  if (state.pdfjsDoc) renderSelectedPage().catch(console.error);
});

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  els.installButton.classList.remove('hidden');
});

els.installButton.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.installButton.classList.add('hidden');
});

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setStatus(els.offlineStatus, 'Offline cache unsupported', 'error');
    return;
  }
  if (!window.isSecureContext) {
    setStatus(els.offlineStatus, 'HTTPS needed for install/offline', 'warning');
    return;
  }
  try {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    setStatus(els.offlineStatus, navigator.onLine ? 'Offline cache ready' : 'Working offline', 'ok');
  } catch (error) {
    console.error(error);
    setStatus(els.offlineStatus, 'Offline cache failed', 'error');
  }
}

Promise.all([loadDummySignature(), registerServiceWorker()]).catch((error) => {
  console.error(error);
  setStatus(els.documentStatus, error.message, 'error');
});

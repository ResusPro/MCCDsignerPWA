const CACHE_NAME = 'mccdsigner-pwa-v0.8.0-rc1-main-v4';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './privacy.txt',
  './UPLOAD_INSTRUCTIONS.txt',
  './VALIDATION_SUMMARY.txt',
  './THIRD_PARTY_NOTICES.txt',
  './VERSION.txt',
  './startup-v0.8.0-rc1.js',
  './workflow-v0.8.0-rc1.js',
  './assets/app-v0.8.0-rc1.js',
  './assets/app-v0.7.0.css',
  './assets/workflow-v0.8.0-rc1.css',
  './assets/pdf.worker.mjs',
  './pdfjs-wasm/jbig2.wasm',
  './pdfjs-wasm/openjpeg.wasm',
  './pdfjs-wasm/qcms_bg.wasm',
  './pdfjs-wasm/quickjs-eval.wasm',
  './pdfjs-wasm/jbig2_nowasm_fallback.js',
  './pdfjs-wasm/openjpeg_nowasm_fallback.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './samples/MCCDSigner_PWA_test_form.pdf',
  './ocr/worker.min.js',
  './ocr/lang/eng.traineddata.gz',
  './ocr/core/tesseract-core-lstm.wasm.js',
  './ocr/core/tesseract-core-lstm.wasm'
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isRegressionHarness = /\/(?:batch-test-v0\.7\.0(?:\.html|\.js|\.css)|processor-v0\.7\.0\.html|batch-bridge-v0\\.7\\.0(?:-r\\d+)?\\.js|assets\\/app-v0\\.7\\.0-batch-r\\d+\\.js|batch-test-v0\.8\.0-rc1(?:\.html|\.js|\.css)|processor-v0\.8\.0-rc1\.html|assets\\/app-v0\\.8\\.0-rc1-batch-r\\d+\\.js)$/.test(url.pathname);
  const isRc1Staging = /\/(?:index\.html|v0\.8-rc1\.html|startup-v0\.8\.0-rc1\.js|workflow-v0\.8\.0-rc1\.js|assets\/app-v0\.8\.0-rc1\.js|assets\/workflow-v0\.8\.0-rc1\.css|manifest\.webmanifest)$/.test(url.pathname);
  const networkFirst = request.mode === 'navigate'
    || url.pathname.endsWith('/index.html')
    || url.pathname.endsWith('/VERSION.txt')
    || isRegressionHarness
    || isRc1Staging;

  if (networkFirst) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});

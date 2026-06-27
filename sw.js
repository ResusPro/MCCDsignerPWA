const CACHE_NAME = 'mccdsigner-pwa-v0.2c-static-v1';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './privacy.txt',
  './assets/app-v0.2c.js',
  './assets/app-v0.2c.css',
  './assets/pdf.worker.mjs',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './samples/MCCDSigner_PWA_test_form.pdf',
  './samples/dummy-signature.png',
  './ocr/worker.min.js',
  './ocr/lang/eng.traineddata.gz',
  './ocr/core/tesseract-core.wasm.js',
  './ocr/core/tesseract-core.wasm',
  './ocr/core/tesseract-core-simd.wasm.js',
  './ocr/core/tesseract-core-simd.wasm',
  './ocr/core/tesseract-core-lstm.wasm.js',
  './ocr/core/tesseract-core-lstm.wasm',
  './ocr/core/tesseract-core-simd-lstm.wasm.js',
  './ocr/core/tesseract-core-simd-lstm.wasm'
];

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

  // Always check the network first for HTML/navigation so a new deployment
  // cannot be hidden behind an old cached shell. Fall back offline if needed.
  if (request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname === new URL('./', self.location).pathname) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Versioned application assets and large OCR files are safe to serve cache-first.
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

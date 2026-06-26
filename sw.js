const CACHE_NAME = 'mccdsigner-pwa-v0.2-static-v1';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './privacy.txt',
  './assets/app.js',
  './assets/app.css',
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

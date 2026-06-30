const CACHE_NAME = 'mccdsigner-pwa-v0.5.5-static-v1';

const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './privacy.txt',
  './loader-v0.5.5.js',
  './app-v0.5.5.js',
  './app-v0.5.5.css',
  './pdf.worker.mjs',
  './MCCDSigner_PWA_test_form_v0.5.5.pdf',
  './dummy-signature.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './ocr/worker.min.js',
  './ocr/lang/eng.traineddata.gz',
  './ocr/core/tesseract-core-lstm.wasm.js',
  './ocr/core/tesseract-core-lstm.wasm'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const networkFirst =
    request.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/app-v0.5.5.js') ||
    url.pathname.endsWith('/app-v0.5.5.css') ||
    url.pathname.endsWith('/loader-v0.5.5.js') ||
    url.pathname.endsWith('/MCCDSigner_PWA_test_form_v0.5.5.pdf');

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
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});

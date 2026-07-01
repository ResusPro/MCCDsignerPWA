const CACHE_NAME = 'mccdsigner-pwa-v0.6.1-static-v1';
const CORE = [
  './', './index.html', './manifest.webmanifest', './privacy.txt',
  './loader-v0.6.1.js', './app-v0.6.1.js', './app-v0.6.1.css', './pdf.worker.mjs',
  './MCCDSigner_PWA_test_form_v0.6.1.pdf', './dummy-signature.png',
  './batch-test.html', './batch-test-v0.6.1.js', './batch-test-v0.6.1.css', './jszip.min.js',
  './icons/icon-192.png', './icons/icon-512.png',
  './ocr/worker.min.js', './ocr/lang/eng.traineddata.gz',
  './ocr/core/tesseract-core-lstm.wasm.js', './ocr/core/tesseract-core-lstm.wasm'
];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE))); self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', (event) => {
  const request = event.request; if (request.method !== 'GET') return;
  const url = new URL(request.url); if (url.origin !== self.location.origin) return;
  const networkFirst = request.mode === 'navigate' || /\/(index|batch-test)\.html$/.test(url.pathname)
    || url.pathname.endsWith('/loader-v0.6.1.js') || url.pathname.endsWith('/app-v0.6.1.js')
    || url.pathname.endsWith('/app-v0.6.1.css') || url.pathname.endsWith('/batch-test-v0.6.1.js')
    || url.pathname.endsWith('/batch-test-v0.6.1.css') || url.pathname.endsWith('/MCCDSigner_PWA_test_form_v0.6.1.pdf');
  if (networkFirst) {
    event.respondWith(fetch(request, { cache: 'no-store' }).then((response) => { if (response && response.status === 200) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())); return response; }).catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => { if (response && response.status === 200 && response.type !== 'opaque') caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())); return response; })));
});

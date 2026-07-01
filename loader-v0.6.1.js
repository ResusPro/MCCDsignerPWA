(() => {
  'use strict';
  const VERSION = '0.6.1';
  let settled = false;
  function esc(value) {
    return String(value ?? 'Unknown startup error').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }
  function fail(detail) {
    if (settled) return;
    settled = true;
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = `<header class="app-header"><div><p class="eyebrow">STARTUP CHECK</p><h1>MCCDSigner PWA <span>v${VERSION}</span></h1><p class="subtitle">The page loaded, but the application could not start.</p></div></header><main><section class="warning-card"><strong>Startup failed</strong><p>${esc(detail)}</p><p>Confirm these files are at the repository root:</p><p><code>loader-v0.6.1.js</code><br><code>app-v0.6.1.js</code><br><code>app-v0.6.1.css</code><br><code>pdf.worker.mjs</code></p></section></main>`;
  }
  if (!Promise.withResolvers) {
    Promise.withResolvers = function withResolvers() {
      let resolve; let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
  }
  if (!URL.parse) {
    URL.parse = function parse(url, base) { try { return new URL(url, base); } catch { return null; } };
  }
  if (!Array.prototype.findLast) {
    Object.defineProperty(Array.prototype, 'findLast', { configurable: true, writable: true, value(predicate, thisArg) {
      for (let index = this.length - 1; index >= 0; index -= 1) if (predicate.call(thisArg, this[index], index, this)) return this[index];
      return undefined;
    }});
  }
  if (!Map.prototype.getOrInsertComputed) Map.prototype.getOrInsertComputed = function (key, factory) { if (!this.has(key)) this.set(key, factory(key)); return this.get(key); };
  if (!Map.prototype.getOrInsert) Map.prototype.getOrInsert = function (key, value) { if (!this.has(key)) this.set(key, value); return this.get(key); };
  if (!WeakMap.prototype.getOrInsertComputed) WeakMap.prototype.getOrInsertComputed = function (key, factory) { if (!this.has(key)) this.set(key, factory(key)); return this.get(key); };
  window.addEventListener('error', (event) => { if (document.getElementById('startupMessage')) fail(event.message || event.error?.message || 'JavaScript startup error'); });
  window.addEventListener('unhandledrejection', (event) => { if (document.getElementById('startupMessage')) fail(event.reason?.message || event.reason || 'Unhandled startup rejection'); });
  const timer = setTimeout(() => { if (document.getElementById('startupMessage')) fail('The application did not finish loading within 20 seconds.'); }, 20000);
  import('./app-v0.6.1.js?build=060')
    .then(() => { settled = true; clearTimeout(timer); })
    .catch((error) => { clearTimeout(timer); console.error(error); fail(error?.message || error); });
})();

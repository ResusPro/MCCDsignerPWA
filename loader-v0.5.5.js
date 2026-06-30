(() => {
  'use strict';

  const VERSION = '0.5.5';
  let finished = false;

  function escapeHtml(value) {
    return String(value ?? 'Unknown startup error').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[ch]);
  }

  function showFailure(detail) {
    if (finished) return;
    finished = true;
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = `
      <header class="app-header">
        <div>
          <p class="eyebrow">STARTUP CHECK</p>
          <h1>MCCDSigner PWA <span>v${VERSION}</span></h1>
          <p class="subtitle">The page loaded, but the application could not start.</p>
        </div>
      </header>
      <main>
        <section class="warning-card">
          <strong>Startup failed</strong>
          <p>${escapeHtml(detail)}</p>
          <p>The four files that must be visible at the GitHub repository root are:</p>
          <p><code>loader-v0.5.5.js</code><br>
             <code>app-v0.5.5.js</code><br>
             <code>app-v0.5.5.css</code><br>
             <code>pdf.worker.mjs</code></p>
        </section>
      </main>`;
  }

  // Compatibility shims required by current PDF.js on some Android WebViews.
  if (!Promise.withResolvers) {
    Promise.withResolvers = function withResolvers() {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
  }

  if (!URL.parse) {
    URL.parse = function parse(url, base) {
      try {
        return new URL(url, base);
      } catch {
        return null;
      }
    };
  }

  if (!Array.prototype.findLast) {
    Object.defineProperty(Array.prototype, 'findLast', {
      configurable: true,
      writable: true,
      value: function findLast(predicate, thisArg) {
        for (let index = this.length - 1; index >= 0; index -= 1) {
          if (predicate.call(thisArg, this[index], index, this)) {
            return this[index];
          }
        }
        return undefined;
      }
    });
  }

  if (!Map.prototype.getOrInsertComputed) {
    Map.prototype.getOrInsertComputed = function getOrInsertComputed(key, factory) {
      if (!this.has(key)) this.set(key, factory(key));
      return this.get(key);
    };
  }

  if (!Map.prototype.getOrInsert) {
    Map.prototype.getOrInsert = function getOrInsert(key, value) {
      if (!this.has(key)) this.set(key, value);
      return this.get(key);
    };
  }

  if (!WeakMap.prototype.getOrInsertComputed) {
    WeakMap.prototype.getOrInsertComputed = function getOrInsertComputed(key, factory) {
      if (!this.has(key)) this.set(key, factory(key));
      return this.get(key);
    };
  }

  window.addEventListener('error', (event) => {
    if (document.getElementById('startupMessage')) {
      showFailure(event.message || event.error?.message || 'JavaScript startup error');
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (document.getElementById('startupMessage')) {
      showFailure(event.reason?.message || event.reason || 'Unhandled startup rejection');
    }
  });

  const timeout = window.setTimeout(() => {
    if (document.getElementById('startupMessage')) {
      showFailure('The application script did not finish loading within 15 seconds.');
    }
  }, 15000);

  import('./app-v0.5.5.js?build=055')
    .then(() => {
      finished = true;
      window.clearTimeout(timeout);
    })
    .catch((error) => {
      window.clearTimeout(timeout);
      console.error('MCCDSigner startup failed', error);
      showFailure(error?.message || error);
    });
})();

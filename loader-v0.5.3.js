(() => {
  'use strict';

  const startup = document.getElementById('startupMessage');

  const showStartupFailure = (detail) => {
    if (!document.getElementById('startupMessage')) return;
    const safe = String(detail || 'Unknown startup error')
      .replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[ch]);
    document.getElementById('app').innerHTML = `
      <header class="app-header">
        <div>
          <p class="eyebrow">STARTUP DIAGNOSTIC</p>
          <h1>MCCDSigner PWA <span>v0.5.3</span></h1>
          <p class="subtitle">The page loaded, but the application script did not start.</p>
        </div>
      </header>
      <main>
        <section class="warning-card">
          <strong>MCCDSigner could not start.</strong>
          <p>This is no longer a blank page. The diagnostic reported:</p>
          <p><code>${safe}</code></p>
          <p>Reload once. If it persists, check that <code>app-v0.5.3.js</code> is visible at the repository root.</p>
        </section>
      </main>`;
  };

  // Compatibility shims needed by recent PDF.js builds on some Android browsers.
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
          if (predicate.call(thisArg, this[index], index, this)) return this[index];
        }
        return undefined;
      }
    });
  }

  window.addEventListener('error', (event) => {
    if (document.getElementById('startupMessage')) {
      showStartupFailure(event.message || event.error?.message || 'JavaScript error');
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (document.getElementById('startupMessage')) {
      showStartupFailure(event.reason?.message || event.reason || 'Unhandled startup rejection');
    }
  });

  import('./app-v0.5.3.js?build=053')
    .catch((error) => {
      console.error('MCCDSigner startup failed', error);
      showStartupFailure(error?.message || error);
    });
})();

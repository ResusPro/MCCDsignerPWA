(() => {
  'use strict';

  const startedAt = Date.now();
  const timeoutMs = 15000;

  function showFailure(message) {
    const app = document.getElementById('app');
    if (!app || app.dataset.started === 'true') return;
    app.innerHTML = `
      <main class="startup-failure">
        <h1>MCCDSigner PWA v0.7.0</h1>
        <h2>Startup failed</h2>
        <p>${String(message || 'The application did not start.').replace(/[&<>"']/g, (ch) => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[ch])}</p>
        <p>Confirm that <code>assets/app-v0.7.0.js</code>, <code>assets/app-v0.7.0.css</code> and <code>assets/pdf.worker.mjs</code> are present in the deployed repository.</p>
      </main>`;
  }

  window.addEventListener('error', (event) => {
    if (document.getElementById('app')?.dataset.started !== 'true') {
      showFailure(event.message || event.error?.message || 'JavaScript startup error.');
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (document.getElementById('app')?.dataset.started !== 'true') {
      showFailure(event.reason?.message || event.reason || 'Unhandled startup error.');
    }
  });

  window.setTimeout(() => {
    const app = document.getElementById('app');
    if (app && app.dataset.started !== 'true') {
      showFailure(`The application did not finish loading within ${Math.round(timeoutMs / 1000)} seconds.`);
    }
  }, timeoutMs);

  window.__MCCD_STARTUP_TIME__ = startedAt;
})();

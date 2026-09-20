(() => {
  'use strict';
  const timeoutMs = 15000;
  function showFailure(message) {
    const app = document.getElementById('app');
    if (!app || app.dataset.started === 'true') return;
    app.innerHTML = '<main class="startup-failure"><h1>MCCDSigner PWA v0.8.0-rc1</h1><h2>Startup failed</h2><p>' +
      String(message || 'The application did not start.').replace(/[&<>"']/g, function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];}) +
      '</p></main>';
  }
  window.addEventListener('error', function(event) {
    if (document.getElementById('app')?.dataset.started !== 'true') showFailure(event.message || 'JavaScript startup error.');
  });
  window.addEventListener('unhandledrejection', function(event) {
    if (document.getElementById('app')?.dataset.started !== 'true') showFailure(event.reason?.message || event.reason || 'Unhandled startup error.');
  });
  window.setTimeout(function() {
    const app = document.getElementById('app');
    if (app && app.dataset.started !== 'true') showFailure('The application did not finish loading within 15 seconds.');
  }, timeoutMs);
})();
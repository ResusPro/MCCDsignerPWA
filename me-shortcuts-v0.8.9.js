/* MCCDSigner: ME spreadsheet shortcuts use the centrally hosted quarterly links file. */
(() => {
  'use strict';

  // This same filename is used by the existing ME desktop startup script.
  // Its line order is Community, RBH, PGH; display order is Community, PGH, RBH.
  const FILE = './ME_Spreadsheet_Links.txt';
  const STORAGE_KEY = 'mccdsigner.me-spreadsheet-links.v1';
  const buttons = [
    { id: 'community', line: 0 },
    { id: 'pgh', line: 2 },
    { id: 'rbh', line: 1 }
  ];

  function validate(lines) {
    if (!Array.isArray(lines) || lines.length !== 3) {
      throw new Error('Expected exactly three SharePoint links.');
    }
    const urls = lines.map((line) => {
      const value = String(line).trim();
      let parsed;
      try { parsed = new URL(value); }
      catch (_) { throw new Error('One SharePoint URL is invalid.'); }
      if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'nhs.sharepoint.com') {
        throw new Error('Unexpected spreadsheet host.');
      }
      return parsed.href;
    });
    if (new Set(urls).size !== 3) {
      throw new Error('Duplicate SharePoint links.');
    }
    return urls;
  }

  function render(urls) {
    for (const { id, line } of buttons) {
      const anchor = document.getElementById('me-sheet-' + id);
      if (!anchor) continue;
      if (urls) {
        anchor.href = urls[line];
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.removeAttribute('aria-disabled');
        anchor.removeAttribute('title');
      } else {
        anchor.removeAttribute('href');
        anchor.removeAttribute('target');
        anchor.setAttribute('aria-disabled', 'true');
        anchor.title = 'Spreadsheet links are unavailable';
      }
    }
  }

  function status(message, tone) {
    const el = document.getElementById('me-sheet-status');
    if (!el) return;
    el.textContent = message || '';
    el.dataset.tone = tone || '';
    el.hidden = !message;
  }

  async function init() {
    if (!document.getElementById('me-sheet-community')) return;

    let previous = null;
    try {
      const old = localStorage.getItem(STORAGE_KEY);
      if (old) previous = validate(JSON.parse(old));
    } catch (_) { /* Browsers may block local storage; online loading still works. */ }

    // Previously saved URLs work immediately, then are replaced from the canonical file.
    render(previous);
    status(previous ? '' : 'Loading current ME spreadsheet links…', '');

    try {
      const response = await fetch(FILE, { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to retrieve spreadsheet link list.');
      const text = await response.text();
      const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const urls = validate(lines);
      render(urls);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(urls)); }
      catch (_) { /* Link configuration still works for this session. */ }
      status('', '');
    } catch (_) {
      if (previous) {
        status('Could not check for updated links; using last saved shortcuts.', 'warning');
      } else {
        render(null);
        status('Spreadsheet links are temporarily unavailable. Please reload the page.', 'error');
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

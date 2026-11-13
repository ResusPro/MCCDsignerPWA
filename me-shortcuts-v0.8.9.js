/* MCCDSigner ME spreadsheet shortcuts. The NHS URLs stay in browser-local storage, not public source. */
(() => {
  'use strict';
  const STORAGE_KEY = 'mccdsigner.me-spreadsheet-links.v1';
  // The existing ME_Spreadsheet_Links.txt is ordered Community, RBH, PGH.
  const shortcuts = [
    { id: 'community', line: 0 },
    { id: 'pgh', line: 2 },
    { id: 'rbh', line: 1 }
  ];

  function validate(lines) {
    if (!Array.isArray(lines) || lines.length !== 3) {
      throw new Error('The text file must contain exactly three non-empty URLs.');
    }
    const urls = lines.map((line) => {
      const value = String(line).trim();
      let parsed;
      try { parsed = new URL(value); }
      catch (_) { throw new Error('One of the three lines is not a valid URL.'); }
      if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'nhs.sharepoint.com') {
        throw new Error('All three links must be NHS SharePoint HTTPS URLs.');
      }
      return parsed.href;
    });
    if (new Set(urls).size !== 3) {
      throw new Error('The file contains duplicate URLs.');
    }
    return urls;
  }

  function render(urls) {
    for (const { id, line } of shortcuts) {
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
        anchor.title = 'Load ME_Spreadsheet_Links.txt first';
      }
    }
  }

  function status(message, error) {
    const el = document.getElementById('me-sheet-status');
    if (!el) return;
    el.textContent = message;
    el.dataset.tone = error ? 'error' : 'ok';
  }

  function init() {
    const choose = document.getElementById('me-sheet-import');
    const picker = document.getElementById('me-sheet-file');
    if (!choose || !picker) return;

    let saved = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) saved = validate(JSON.parse(raw));
    } catch (_) {
      saved = null;
    }
    render(saved);
    status(saved
      ? 'Links ready in this browser. Reload the text file after each quarterly spreadsheet refresh.'
      : 'Choose the same ME_Spreadsheet_Links.txt used by MEstartup.bat to activate these links.', false);

    choose.addEventListener('click', () => picker.click());
    picker.addEventListener('change', async () => {
      const file = picker.files && picker.files[0];
      if (!file) return;
      try {
        if (file.size > 100000) throw new Error('The selected text file is unexpectedly large.');
        const content = await file.text();
        const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const urls = validate(lines);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(urls));
        } catch (_) {
          render(urls);
          status('Links are ready now, but this browser could not remember them. Re-import after reopening.', true);
          return;
        }
        render(urls);
        status('Community, PGH and RBH links ready. Updated links saved in this browser.', false);
      } catch (e) {
        status('Links not changed: ' + (e && e.message ? e.message : 'Could not read that file.'), true);
      } finally {
        picker.value = '';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

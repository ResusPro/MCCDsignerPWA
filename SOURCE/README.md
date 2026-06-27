# MCCDSigner PWA v0.2a — Pattern T OCR prototype

This remains a **TEST-ONLY** browser proof of concept. It adds the proven text anchor:

`For the medical examiner to complete`

## What v0.2a does

- Opens a PDF entirely in the browser.
- Starts an automatic Pattern T OCR scan after the PDF loads.
- Tries the likely final page first, then the remaining page/rotation combinations.
- Requires a fuzzy match for MEDICAL + EXAMINER + COMPLETE.
- Locates the enclosing rectangular Medical Examiner box from its top and bottom borders.
- Automatically selects the page and orientation when both the heading and box are confirmed.
- Leaves the red box draggable and resizable as a manual fallback.
- Places editable dummy signer details using the settled anchor fractions from MCCDSigner V9.2d.
- Shows a rendered review copy.
- Creates no saved output until **Approve & save TEST PDF** is pressed.
- Reject discards the generated review bytes.

Every output is marked **MCCDSigner PWA v0.2a — TEST OUTPUT** and uses the suffix `-PWA-TEST.pdf`.

## Local OCR and offline use

The deployment includes Tesseract.js, its WebAssembly core and English traineddata. OCR is performed locally. No PDF, signature or recognised text is sent to a server.

The service worker caches the app, PDF libraries and OCR files. The first installation/download is about 40–45 MB. After that, the app can run offline.

## Quick desktop test

1. Use the supplied `START_LOCAL.bat` from the complete bundle.
2. The browser opens at `http://localhost:8080`.
3. Press **Load supplied synthetic PDF**.
4. Pattern T should select page 2, rotation 0°, and draw a red box around the Medical Examiner section.
5. Check the box and generate the TEST review PDF.

## Mobile test

Upload the contents of `DEPLOY` to the root of the GitHub Pages repository, then open the HTTPS site on Android. After the update is visible, close/reopen the installed PWA so the v0.2a service worker can replace v0.1.

## Safety and privacy

- No PDF upload code exists.
- No analytics or telemetry are included.
- The prototype stores neither PDF nor signature in browser storage.
- OCR is local and uses only the selected document in memory.
- This build is not approved for live patient documents.

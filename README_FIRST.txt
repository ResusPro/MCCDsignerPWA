MCCDSigner PWA v0.2a

This is a focused detector patch for v0.2.

Change:
- Pattern T still OCR-confirms “For the medical examiner to complete”.
- Box-border detection now ignores interior dotted lines and selects the lowest matching outer border.
- This fixes the supplied synthetic test form reporting “heading found; box border needs checking” despite the red box appearing correct.

DEPLOY: upload these contents to the GitHub repository root.
SOURCE: editable Vite project.

This remains TEST ONLY and all output PDFs are watermarked.

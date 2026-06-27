import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public', 'ocr');
const coreOut = resolve(out, 'core');
const langOut = resolve(out, 'lang');

await rm(out, { recursive: true, force: true });
await mkdir(coreOut, { recursive: true });
await mkdir(langOut, { recursive: true });

const worker = resolve(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js');
await cp(worker, resolve(out, 'worker.min.js'));

for (const name of [
  'tesseract-core.wasm.js',
  'tesseract-core.wasm',
  'tesseract-core-simd.wasm.js',
  'tesseract-core-simd.wasm',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
]) {
  await cp(
    resolve(root, 'node_modules', 'tesseract.js-core', name),
    resolve(coreOut, name),
  );
}

await cp(
  resolve(root, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0', 'eng.traineddata.gz'),
  resolve(langOut, 'eng.traineddata.gz'),
);

console.log('Bundled local OCR assets into public/ocr.');

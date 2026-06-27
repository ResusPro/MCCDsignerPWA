import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/chunk-[name].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || '';
          if (name.endsWith('.css')) return 'assets/app.css';
          if (name.includes('pdf.worker')) return 'assets/pdf.worker.mjs';
          return 'assets/[name][extname]';
        }
      }
    }
  }
});

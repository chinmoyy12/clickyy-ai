import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Renderer build. Main and preload are bundled separately by scripts/build-main.mjs.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'motion', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
});

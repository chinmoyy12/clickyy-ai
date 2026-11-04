import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});

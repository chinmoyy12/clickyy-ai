// Bundles the Electron main process and preload script with esbuild.
import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: 'linked',
  external: ['electron'],
  alias: { '@shared': resolve(root, 'src/shared') },
  logLevel: 'info',
};

const configs = [
  { ...common, entryPoints: [resolve(root, 'src/main/main.ts')], outfile: resolve(root, 'dist/main/main.cjs') },
  // Sandboxed preloads may only require('electron'); everything else is bundled in.
  { ...common, entryPoints: [resolve(root, 'src/preload/preload.ts')], outfile: resolve(root, 'dist/preload/preload.cjs') },
];

mkdirSync(resolve(root, 'dist/main'), { recursive: true });
copyFileSync(resolve(root, 'node_modules/sql.js/dist/sql-wasm.wasm'), resolve(root, 'dist/main/sql-wasm.wasm'));

if (watch) {
  for (const c of configs) await (await context(c)).watch();
} else {
  await Promise.all(configs.map((c) => build(c)));
}

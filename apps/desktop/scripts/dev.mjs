// Development runner: Vite dev server for the renderer, esbuild watch for main/preload, then Electron.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ configFile: resolve(root, 'vite.config.mts') });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5173/';

const builder = spawn(process.execPath, [resolve(root, 'scripts/build-main.mjs'), '--watch'], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 1500));

const electronPath = (await import('electron')).default;
const app = spawn(electronPath, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CLICKYY_DEV_SERVER_URL: url },
});
app.on('exit', async (code) => {
  builder.kill();
  await server.close();
  process.exit(code ?? 0);
});

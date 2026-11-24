/**
 * Fetches the built-in AI for the installer: Qwen3 1.7B (Apache-2.0, Q4_K_M GGUF) and the llama.cpp
 * Windows CPU server (MIT). Both are pinned and checked against SHA-256 before use.
 *
 *   node scripts/fetch-llm.mjs      → resources/llm/{model,engine}
 *
 * Nothing here runs at app run time: the files ship inside the installer.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'llm');
const LLAMA_BUILD = 'b12676';
const FILES = {
  model: {
    url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
    dest: join(root, 'model', 'qwen3-1.7b-q4_k_m.gguf'),
    sha256: 'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897',
  },
  engine: {
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/llama-${LLAMA_BUILD}-bin-win-cpu-x64.zip`,
    sha256: 'fdf78a3924fe92ccfb24af58544a6dccbc1feeb0587e77fca9ec3bef6737086c',
  },
  licenses: [
    { url: `https://raw.githubusercontent.com/ggml-org/llama.cpp/${LLAMA_BUILD}/LICENSE`, dest: join(root, 'engine', 'LICENSE-llama.cpp.txt') },
    { url: 'https://huggingface.co/Qwen/Qwen3-1.7B/raw/main/LICENSE', dest: join(root, 'model', 'LICENSE-Qwen3.txt') },
  ],
};
const ENGINE_FILES = ['llama-server.exe', 'llama-server-impl.dll', 'llama-common.dll', 'llama.dll', 'mtmd.dll', 'libomp.dll', 'ggml*.dll', 'LICENSE*'];

const sha256 = (file) => new Promise((ok, fail) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', fail);
});

async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  execFileSync('curl', ['-sSL', '--fail', '-o', dest, url], { stdio: 'inherit' });
}

async function main() {
  const m = FILES.model;
  if (!existsSync(m.dest) || (await sha256(m.dest)) !== m.sha256) {
    console.log('Downloading Qwen3 1.7B (1.1 GB)…');
    await download(m.url, m.dest);
    if ((await sha256(m.dest)) !== m.sha256) { rmSync(m.dest); throw new Error('Model checksum mismatch'); }
  }
  console.log(`model ok (${(statSync(m.dest).size / 1e9).toFixed(2)} GB)`);

  if (!existsSync(join(root, 'engine', 'llama-server.exe'))) {
    const tmp = mkdtempSync(join(tmpdir(), 'clickyy-llama-'));
    const zip = join(tmp, 'llama.zip');
    console.log(`Downloading llama.cpp ${LLAMA_BUILD}…`);
    await download(FILES.engine.url, zip);
    if ((await sha256(zip)) !== FILES.engine.sha256) throw new Error('Engine checksum mismatch');
    mkdirSync(join(root, 'engine'), { recursive: true });
    execFileSync('unzip', ['-o', '-q', zip, ...ENGINE_FILES, '-d', join(root, 'engine')], { stdio: 'inherit' });
    rmSync(join(root, 'engine', 'ggml-rpc-server.exe'), { force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log('engine ok');
  for (const l of FILES.licenses) if (!existsSync(l.dest)) await download(l.url, l.dest);
  writeFileSync(join(root, 'README.txt'), `Built-in AI for Clickyy AI\n\nModel: Qwen3 1.7B (Q4_K_M GGUF), Apache License 2.0, by the Qwen team (Alibaba Cloud). See model/LICENSE-Qwen3.txt.\nEngine: llama.cpp ${LLAMA_BUILD} (llama-server, CPU build), MIT License, by the ggml authors. See engine/LICENSE-llama.cpp.txt.\nlibomp: LLVM OpenMP runtime, see engine/LICENSE-LLVM-OpenMP.\n`);
  console.log('done');
}

main().catch((e) => { console.error(e.message); process.exit(1); });

import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Optional "Best accuracy" recognition model, downloaded on request from Hugging Face.
 * The revision is pinned and every file is checked against its size and SHA-256 before
 * it is moved into place, so a tampered or truncated download is never loaded.
 */
export interface ModelFile { name: string; size: number; sha256: string }
export interface DownloadableModel { id: string; label: string; repo: string; revision: string; files: ModelFile[] }

export const BEST_ACCURACY: DownloadableModel = {
  id: 'whisper-large-v3-turbo',
  label: 'Whisper large-v3-turbo (best accuracy, English + Hindi)',
  repo: 'deepdml/faster-whisper-large-v3-turbo-ct2',
  revision: '4df90f75321148c3a29a9e2351b7ddf8f5b115a8',
  files: [
    { name: 'config.json', size: 2263, sha256: 'b0253ea6c0d3bea6b1e19e91a02acfd3b53f4467362efcb5a3e6b16c9b3a9b7e' },
    { name: 'preprocessor_config.json', size: 340, sha256: '7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711' },
    { name: 'tokenizer.json', size: 2710337, sha256: '297b13372ac43916285644fb9687add3cc62ee2a1adb60da3dc25cc94c1871fd' },
    { name: 'vocabulary.json', size: 1068114, sha256: 'c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1' },
    { name: 'model.bin', size: 1617884929, sha256: 'e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da' },
  ],
};

export const totalBytes = (m: DownloadableModel) => m.files.reduce((a, f) => a + f.size, 0);
export const fileUrl = (m: DownloadableModel, f: ModelFile) => `https://huggingface.co/${m.repo}/resolve/${m.revision}/${f.name}`;

export async function isInstalled(root: string, m: DownloadableModel): Promise<boolean> {
  for (const f of m.files) {
    const s = await stat(join(root, m.id, f.name)).catch(() => null);
    if (!s || s.size !== f.size) return false;
  }
  return true;
}

export type Progress = (done: number, total: number) => void;
type Fetch = (url: string, init: { signal?: AbortSignal; redirect: 'follow' }) => Promise<Response>;

/** Downloads into <root>/<id>.partial, verifies, then renames to <root>/<id>. */
export async function download(root: string, m: DownloadableModel, onProgress: Progress, signal?: AbortSignal, fetcher: Fetch = fetch): Promise<void> {
  const staging = join(root, `${m.id}.partial`);
  const target = join(root, m.id);
  await mkdir(staging, { recursive: true });
  const total = totalBytes(m);
  let done = 0;
  for (const f of m.files) {
    const dest = join(staging, f.name);
    const have = await stat(dest).catch(() => null);
    if (have?.size === f.size && (await sha256File(dest)) === f.sha256) { done += f.size; onProgress(done, total); continue; }
    const r = await fetcher(fileUrl(m, f), { signal, redirect: 'follow' });
    if (!r.ok || !r.body) throw new Error(`Download failed for ${f.name} (HTTP ${r.status})`);
    const hash = createHash('sha256');
    const out = createWriteStream(dest);
    let got = 0;
    try {
      const reader = r.body.getReader();
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        got += value.byteLength;
        if (got > f.size) throw new Error(`${f.name} is larger than expected`);
        hash.update(value);
        if (!out.write(value)) await new Promise<void>((res) => out.once('drain', () => res()));
        onProgress(done + got, total);
      }
    } finally {
      await new Promise<void>((res) => out.end(() => res()));
    }
    if (got !== f.size || hash.digest('hex') !== f.sha256) {
      await rm(dest, { force: true });
      throw new Error(`${f.name} failed its integrity check; nothing was installed.`);
    }
    done += f.size;
  }
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
}

export async function remove(root: string, m: DownloadableModel) {
  await rm(join(root, m.id), { recursive: true, force: true });
  await rm(join(root, `${m.id}.partial`), { recursive: true, force: true });
}

async function sha256File(p: string): Promise<string> {
  if (!existsSync(p)) return '';
  const { createReadStream } = await import('node:fs');
  const h = createHash('sha256');
  for await (const chunk of createReadStream(p)) h.update(chunk as Buffer);
  return h.digest('hex');
}

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BEST_ACCURACY, download, fileUrl, isInstalled, remove, type DownloadableModel } from '../src/main/speech/models';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const files = { 'a.json': Buffer.from('{"x":1}'), 'model.bin': Buffer.alloc(70_000, 7) };
const model: DownloadableModel = {
  id: 'tiny', label: 'tiny', repo: 'org/tiny', revision: 'abc123',
  files: Object.entries(files).map(([name, b]) => ({ name, size: b.length, sha256: sha(b) })),
};
const fakeFetch = (override: Record<string, Buffer> = {}) => {
  const seen: string[] = [];
  const f = async (url: string) => {
    seen.push(url);
    const name = url.split('/').pop()!;
    const body = override[name] ?? files[name as keyof typeof files];
    return new Response(new Uint8Array(body));
  };
  return Object.assign(f, { seen });
};

describe('optional recognition model download', () => {
  it('pins the revision and only talks to huggingface.co', () => {
    expect(BEST_ACCURACY.revision).toMatch(/^[0-9a-f]{40}$/);
    for (const f of BEST_ACCURACY.files) {
      expect(new URL(fileUrl(BEST_ACCURACY, f)).host).toBe('huggingface.co');
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('downloads, verifies and installs; reports progress', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clickyy-models-'));
    const f = fakeFetch();
    const progress: number[] = [];
    await download(root, model, (d) => progress.push(d), undefined, f as never);
    expect(await isInstalled(root, model)).toBe(true);
    expect(readFileSync(join(root, 'tiny', 'a.json'), 'utf8')).toBe('{"x":1}');
    expect(f.seen[0]).toBe('https://huggingface.co/org/tiny/resolve/abc123/a.json');
    expect(progress.at(-1)).toBe(files['a.json'].length + files['model.bin'].length);
    expect(existsSync(join(root, 'tiny.partial'))).toBe(false);
    await remove(root, model);
    expect(await isInstalled(root, model)).toBe(false);
  });

  it('refuses a tampered file and installs nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clickyy-models-'));
    const evil = Buffer.alloc(70_000, 9); // right size, wrong content
    await expect(download(root, model, () => {}, undefined, fakeFetch({ 'model.bin': evil }) as never)).rejects.toThrow(/integrity/);
    expect(await isInstalled(root, model)).toBe(false);
    expect(existsSync(join(root, 'tiny'))).toBe(false);
  });

  it('refuses an oversized file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clickyy-models-'));
    await expect(download(root, model, () => {}, undefined, fakeFetch({ 'a.json': Buffer.alloc(5000) }) as never)).rejects.toThrow(/larger/);
  });
});

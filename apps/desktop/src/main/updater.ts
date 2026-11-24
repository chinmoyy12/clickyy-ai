import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { UpdateStatus } from '@shared/types';

/**
 * In-app updates from the project's GitHub releases, so users never have to visit the website again.
 *
 * Safety:
 *  - only GitHub hosts are contacted, and every redirect hop is checked against that list;
 *  - the installer is verified against the SHA-256 digest GitHub publishes for the release asset
 *    (no digest, no install);
 *  - nothing is installed without the user pressing Update (or saying so); the installer then runs
 *    silently for the current user (no admin prompt) and starts the new version;
 *  - never contacts anything in Strict Offline mode.
 */

export const UPDATE_REPO = 'chinmoyy12/clickyy-ai';
const ALLOWED_HOSTS = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com']);
const MAX_INSTALLER_BYTES = 2_200_000_000;

export function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** > 0 when a is newer than b. Unparseable versions never count as newer. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

interface ReleaseAsset { name: string; size: number; browser_download_url: string; digest?: string | null }
interface Release { tag_name: string; name?: string; body?: string; html_url?: string; draft?: boolean; prerelease?: boolean; assets?: ReleaseAsset[] }

/** The installer asset: the versioned file first, then the stable-named one. */
export function pickInstaller(rel: Release): ReleaseAsset | null {
  const assets = rel.assets ?? [];
  return assets.find((a) => /^Clickyy-AI-Setup-\d+\.\d+\.\d+\.exe$/i.test(a.name)) ?? assets.find((a) => /^Clickyy-AI-Setup\.exe$/i.test(a.name)) ?? null;
}

/** Short spoken/visible summary of the release notes (first lines, no markdown). */
export function notesSummary(body = '', max = 280): string {
  const text = body.replace(/\r/g, '').split('\n').map((l) => l.replace(/^#+\s*|^[-*]\s+|\*\*|`/g, '').trim()).filter(Boolean).join(' · ');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export interface UpdaterOptions {
  version: string;
  fetch: typeof fetch;
  downloadDir: string;
  /** Starts the installer detached (args array, never a shell). */
  launch(file: string, args: string[]): Promise<void>;
  quit(): void;
  offline(): boolean;
  onChange(status: UpdateStatus): void;
  repo?: string;
}

export class Updater {
  private s: UpdateStatus;
  private asset: ReleaseAsset | null = null;
  private file = '';
  private busy: Promise<unknown> | null = null;

  constructor(private o: UpdaterOptions) {
    this.s = { state: 'idle', current: o.version, message: '' };
  }

  get version() { return this.o.version; }
  get status(): UpdateStatus { return { ...this.s }; }

  private set(patch: Partial<UpdateStatus>) {
    this.s = { ...this.s, ...patch };
    this.o.onChange(this.status);
  }

  private async get(url: string, accept: string, signal?: AbortSignal): Promise<Response> {
    // Follow redirects by hand so every hop is checked against the allowed GitHub hosts.
    let current = url;
    for (let hop = 0; hop < 6; hop++) {
      const u = new URL(current);
      if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw new Error(`Refused to download from ${u.hostname}.`);
      const res = await this.o.fetch(current, { headers: { accept, 'user-agent': 'ClickyyAI-Updater' }, redirect: 'manual', signal: signal ?? AbortSignal.timeout(20_000) });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!next) throw new Error('GitHub sent a redirect without a location.');
        current = new URL(next, current).toString();
        continue;
      }
      return res;
    }
    throw new Error('Too many redirects.');
  }

  /** Looks for a newer release. `manual` = the user asked (a skipped version is still offered). */
  async check(manual = false, skipped = ''): Promise<UpdateStatus> {
    if (this.o.offline()) {
      this.set({ state: 'disabled', message: 'Strict Offline mode is on, so I can’t check for updates.' });
      return this.status;
    }
    if (this.busy && ['downloading', 'installing'].includes(this.s.state)) return this.status;
    this.set({ state: 'checking', message: 'Checking for updates…' });
    try {
      const res = await this.get(`https://api.github.com/repos/${this.o.repo ?? UPDATE_REPO}/releases/latest`, 'application/vnd.github+json');
      if (res.status === 404) throw new Error('No releases are published yet.');
      if (res.status === 403 || res.status === 429) throw new Error('GitHub is limiting requests right now. Try again later.');
      if (!res.ok) throw new Error(`GitHub answered with HTTP ${res.status}.`);
      const rel = (await res.json()) as Release;
      const latest = rel.tag_name.replace(/^v/, '');
      const asset = pickInstaller(rel);
      const checkedAt = Date.now();
      if (rel.draft || rel.prerelease || compareVersions(latest, this.o.version) <= 0) {
        this.set({ state: 'none', latest, checkedAt, message: `You're on the latest version, ${this.o.version}.` });
        return this.status;
      }
      if (!asset) {
        this.set({ state: 'none', latest, checkedAt, message: `Version ${latest} is out, but its installer isn't ready yet. I'll look again later.` });
        return this.status;
      }
      if (!manual && skipped === latest) {
        this.set({ state: 'none', latest, checkedAt, message: `Version ${latest} is available (you chose to skip it).` });
        return this.status;
      }
      this.asset = asset;
      this.set({ state: 'available', latest, checkedAt, notes: notesSummary(rel.body), url: rel.html_url, size: asset.size, done: 0,
        message: `Version ${latest} is available. You have ${this.o.version}.` });
      return this.status;
    } catch (e) {
      this.set({ state: 'error', message: `Couldn't check for updates: ${(e as Error).message}` });
      return this.status;
    }
  }

  /** Downloads the installer and verifies its SHA-256 digest. */
  async download(): Promise<string> {
    if (!this.asset) throw new Error('No update to download. Check for updates first.');
    const asset = this.asset;
    const expected = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest ?? '')?.[1]?.toLowerCase();
    if (!expected) throw new Error('This release has no published checksum, so it can’t be verified. Download it from the website instead.');
    if (!/^[A-Za-z0-9._-]+\.exe$/.test(asset.name) || asset.size > MAX_INSTALLER_BYTES) throw new Error('The release file looks wrong, so it was not downloaded.');
    mkdirSync(this.o.downloadDir, { recursive: true });
    const dest = join(this.o.downloadDir, asset.name);
    if (this.file === dest && existsSync(dest)) return dest;
    this.set({ state: 'downloading', done: 0, size: asset.size, message: `Downloading version ${this.s.latest}…` });
    const ctl = new AbortController();
    const res = await this.get(asset.browser_download_url, 'application/octet-stream', ctl.signal);
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`);
    const hash = createHash('sha256');
    const out = createWriteStream(dest);
    let done = 0;
    let lastEmit = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        done += value.byteLength;
        if (done > MAX_INSTALLER_BYTES) { ctl.abort(); throw new Error('The download is larger than expected.'); }
        hash.update(value);
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
        if (Date.now() - lastEmit > 250) { lastEmit = Date.now(); this.set({ done }); }
      }
      await new Promise<void>((ok, fail) => out.end((e?: Error | null) => (e ? fail(e) : ok())));
    } catch (e) {
      out.destroy();
      rmSync(dest, { force: true });
      throw e;
    }
    const got = hash.digest('hex');
    if (got !== expected || statSync(dest).size !== asset.size) {
      rmSync(dest, { force: true });
      throw new Error('The downloaded file did not match the published checksum, so it was deleted.');
    }
    this.file = dest;
    this.set({ state: 'ready', done, message: `Version ${this.s.latest} is downloaded and verified.` });
    return dest;
  }

  /** Downloads (if needed), starts the silent installer, and quits so it can replace the app. */
  async install(): Promise<void> {
    if (this.busy) { await this.busy; return; }
    const run = (async () => {
      try {
        const file = await this.download();
        this.set({ state: 'installing', message: 'Installing the update. Clickyy will restart in a moment.' });
        await this.o.launch(file, ['/S', '--force-run']);
        setTimeout(() => this.o.quit(), 600);
      } catch (e) {
        this.set({ state: 'error', message: `Update failed: ${(e as Error).message}` });
        throw e;
      }
    })();
    this.busy = run;
    try { await run; } finally { this.busy = null; }
  }
}

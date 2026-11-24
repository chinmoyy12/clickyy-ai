import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

/**
 * Built-in AI: a small open model (Qwen3 1.7B, Apache-2.0) shipped inside the installer and run by
 * llama.cpp's server (MIT) as a child process on 127.0.0.1. Nothing is downloaded at run time, no
 * account or key is needed, and it works in Strict Offline mode (loopback only).
 *
 * The server is started on demand, protected by a random per-run API key (so other programs on the
 * PC can't use it), and stopped after a while unused to give the memory back.
 */

export interface BuiltinPaths { server: string; model: string }

export const BUILTIN_MODEL_ID = 'qwen3-1.7b';
export const BUILTIN_LABEL = 'Built-in AI';

/** Finds the bundled engine and model (installed app first, then the dev checkout). */
export function locateBuiltin(resourcesPath: string, appRoot: string): BuiltinPaths | null {
  for (const base of [join(resourcesPath, 'llm'), join(appRoot, 'resources', 'llm')]) {
    const server = join(base, 'engine', 'llama-server.exe');
    const modelDir = join(base, 'model');
    if (!existsSync(server) || !existsSync(modelDir)) continue;
    const gguf = readdirSync(modelDir).find((f) => f.toLowerCase().endsWith('.gguf'));
    if (gguf) return { server, model: join(modelDir, gguf) };
  }
  return null;
}

export type BuiltinState = 'unavailable' | 'off' | 'starting' | 'ready' | 'error';

type SpawnFn = (file: string, args: string[], opts: Record<string, unknown>) => ChildProcess;

export interface BuiltinOptions {
  spawn?: SpawnFn;
  fetch?: typeof fetch;
  /** Stop the server after this long unused (ms). */
  idleMs?: number;
  /** How long to wait for the model to load (ms). */
  startTimeoutMs?: number;
  freePort?: () => Promise<number>;
  log?: (line: string) => void;
}

export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('No free port'))));
    });
  });
}

export class BuiltinEngine {
  private proc: ChildProcess | null = null;
  private port = 0;
  private starting: Promise<boolean> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private tail = '';
  private _state: BuiltinState;
  private _message = '';
  /** Random per-run key; the server refuses requests without it. */
  readonly token = randomBytes(24).toString('hex');
  private readonly spawnFn: SpawnFn;
  private readonly fetchImpl: typeof fetch;
  private readonly idleMs: number;
  private readonly startTimeoutMs: number;
  private readonly freePort: () => Promise<number>;

  constructor(readonly paths: BuiltinPaths | null, private o: BuiltinOptions = {}) {
    this.spawnFn = o.spawn ?? (nodeSpawn as unknown as SpawnFn);
    this.fetchImpl = o.fetch ?? fetch;
    this.idleMs = o.idleMs ?? 20 * 60_000;
    this.startTimeoutMs = o.startTimeoutMs ?? 90_000;
    this.freePort = o.freePort ?? freeLoopbackPort;
    this._state = paths ? 'off' : 'unavailable';
    this._message = paths ? '' : 'The built-in AI is not included in this build.';
  }

  get available() { return !!this.paths; }
  get state(): BuiltinState { return this._state; }
  get message() { return this._message; }
  get ready() { return this._state === 'ready'; }
  get baseUrl() { return `http://127.0.0.1:${this.port}/v1`; }

  /** Starts the server if needed and waits until the model is loaded. Resolves false if it can't run. */
  ensure(): Promise<boolean> {
    if (!this.paths) return Promise.resolve(false);
    if (this._state === 'ready' && this.proc) { this.touch(); return Promise.resolve(true); }
    this.starting ??= this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  /** Marks the engine as used (pushes the idle shutdown back). */
  touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { this.o.log?.('built-in AI idle, stopping'); this.stop(); }, this.idleMs);
    this.idleTimer.unref?.();
  }

  private async start(): Promise<boolean> {
    const paths = this.paths!;
    this._state = 'starting';
    this._message = 'Loading the built-in AI…';
    this.tail = '';
    try {
      this.port = await this.freePort();
    } catch {
      return this.fail('No free local port for the built-in AI.');
    }
    const args = [
      '-m', paths.model,
      '--host', '127.0.0.1', '--port', String(this.port),
      '--api-key', this.token,
      '--alias', BUILTIN_MODEL_ID,
      '-c', '8192', '-np', '1',
      '--jinja', '--reasoning-format', 'deepseek',
      '--no-webui',
    ];
    let proc: ChildProcess;
    try {
      proc = this.spawnFn(paths.server, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return this.fail(`The built-in AI could not start: ${(e as Error).message}`);
    }
    this.proc = proc;
    const keep = (d: Buffer | string) => { this.tail = (this.tail + d.toString()).slice(-4000); };
    proc.stdout?.on('data', keep);
    proc.stderr?.on('data', keep);
    let exited = false;
    proc.once('error', (e) => { exited = true; keep(String(e.message)); });
    proc.once('exit', (code) => {
      exited = true;
      if (this.proc === proc) {
        this.proc = null;
        if (this._state !== 'off') {
          this._state = 'error';
          this._message = `The built-in AI stopped unexpectedly (exit ${code ?? '?'}).${lastLine(this.tail)}`;
          this.o.log?.(`built-in AI exited ${code}: ${this.tail.slice(-600)}`);
        }
      }
    });

    const until = Date.now() + this.startTimeoutMs;
    while (Date.now() < until) {
      if (exited) return this.fail((this._state as BuiltinState) === 'error' ? this._message : `The built-in AI could not start.${lastLine(this.tail)}`);
      try {
        const r = await this.fetchImpl(`http://127.0.0.1:${this.port}/health`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) {
          this._state = 'ready';
          this._message = '';
          this.touch();
          this.o.log?.(`built-in AI ready on port ${this.port}`);
          return true;
        }
      } catch { /* still loading */ }
      await new Promise((r) => setTimeout(r, 400));
    }
    if (exited) return this.fail((this._state as BuiltinState) === 'error' ? this._message : `The built-in AI could not start.${lastLine(this.tail)}`);
    this.stop();
    return this.fail('The built-in AI took too long to load. Close some apps to free memory and try again.');
  }

  private fail(message: string): false {
    this._state = 'error';
    this._message = message;
    return false;
  }

  stop() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const p = this.proc;
    this.proc = null;
    if (this.paths) { this._state = 'off'; this._message = ''; }
    if (p && p.exitCode === null) {
      try { p.kill(); } catch { /* already gone */ }
    }
  }
}

function lastLine(tail: string): string {
  const line = tail.split(/\r?\n/).map((l) => l.trim()).filter((l) => /error|fail|cannot|unable/i.test(l)).pop();
  return line ? ` ${line.slice(0, 160)}` : '';
}

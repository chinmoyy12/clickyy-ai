import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';

export type BridgeOp =
  | 'ping' | 'volume.get' | 'volume.set' | 'volume.mute' | 'audio.devices'
  | 'media.control' | 'media.now'
  | 'window.list' | 'window.foreground' | 'window.action' | 'window.minimizeAll' | 'window.restoreAll'
  | 'power.status' | 'session.lock' | 'keys.send' | 'keys.type' | 'clipboard.set' | 'clipboard.get' | 'process.top'
  | 'window.capture' | 'window.closeApp' | 'monitor.count'
  | 'mic.get' | 'mic.set' | 'app.mute' | 'display.off' | 'brightness.get' | 'brightness.set'
  | 'power.suspend' | 'radio.get' | 'radio.set' | 'feature.get' | 'feature.set'
  | 'process.info' | 'process.stop' | 'file.version' | 'startup.get' | 'startup.set'
  | 'media.timeline' | 'diag';

export interface WindowInfo { hwnd: number; title: string; pid: number; process: string | null; minimized: boolean; maximized: boolean }
export interface VolumeState { level: number; muted: boolean }

export interface WindowsBridge {
  call<T = unknown>(op: BridgeOp, args?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  readonly state: 'stopped' | 'starting' | 'ready' | 'failed';
  readonly lastError?: string;
  stop(): void;
}

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

/**
 * Long-lived powershell.exe running resources/windows/bridge.ps1. The script
 * accepts only a fixed set of operations; arguments are validated by the tools
 * layer before they get here and again inside the script.
 */
export class PowerShellBridge implements WindowsBridge {
  state: WindowsBridge['state'] = 'stopped';
  lastError?: string;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = '';
  private ready: Promise<void> | null = null;
  private restarts = 0;
  private stopped = false;

  constructor(private scriptPath: string = join(__dirname, 'windows', 'bridge.ps1')) {}

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.state = 'starting';
    this.ready = new Promise<void>((resolve, reject) => {
      const proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.proc = proc;
      const startTimer = setTimeout(() => {
        this.fail('Windows bridge did not start in time');
        reject(new Error('Windows bridge did not start in time'));
      }, 15000);
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk: string) => {
        this.buffer += chunk;
        let nl: number;
        while ((nl = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, nl).trim();
          this.buffer = this.buffer.slice(nl + 1);
          if (!line) continue;
          let msg: { id: number; ok: boolean; result?: unknown; error?: string };
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.id === 0) {
            clearTimeout(startTimer);
            this.state = 'ready';
            this.restarts = 0;
            resolve();
            continue;
          }
          const p = this.pending.get(msg.id);
          if (!p) continue;
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.result);
          else p.reject(new Error(msg.error || 'Windows bridge error'));
        }
      });
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (d: string) => { this.lastError = d.slice(0, 500); });
      proc.on('error', (e) => {
        clearTimeout(startTimer);
        this.fail(e.message);
        reject(e);
      });
      proc.on('exit', (code) => {
        clearTimeout(startTimer);
        this.fail(`Windows bridge exited (${code})`);
        reject(new Error('Windows bridge exited'));
      });
    });
    return this.ready;
  }

  private fail(message: string) {
    this.lastError = message;
    this.state = this.stopped ? 'stopped' : 'failed';
    this.proc = null;
    this.ready = null;
    this.buffer = '';
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    this.pending.clear();
  }

  async call<T = unknown>(op: BridgeOp, args: Record<string, unknown> = {}, timeoutMs = 5000): Promise<T> {
    if (process.platform !== 'win32') throw new Error('Windows integrations are only available on Windows');
    if (this.state === 'failed' && this.restarts >= 3) throw new Error(`Windows bridge unavailable: ${this.lastError}`);
    if (!this.proc) {
      if (this.state === 'failed') this.restarts++;
      this.stopped = false;
    }
    await this.start();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${op} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.proc!.stdin.write(`${JSON.stringify({ id, op, args })}\n`);
    });
  }

  stop() {
    this.stopped = true;
    this.proc?.stdin.end();
    this.proc?.kill();
    this.fail('stopped');
    this.state = 'stopped';
  }
}

/** In-memory bridge for tests and non-Windows development. */
export class FakeBridge implements WindowsBridge {
  state: WindowsBridge['state'] = 'ready';
  lastError?: string;
  calls: Array<{ op: BridgeOp; args: Record<string, unknown> }> = [];
  volume: VolumeState = { level: 40, muted: false };
  windows: WindowInfo[] = [
    { hwnd: 101, title: 'Project - Visual Studio Code', pid: 11, process: 'Code', minimized: false, maximized: false },
    { hwnd: 102, title: 'Docs - Google Chrome', pid: 12, process: 'chrome', minimized: false, maximized: true },
  ];
  foreground = 101;
  failOps = new Set<BridgeOp>();
  delayMs = 0;

  async call<T>(op: BridgeOp, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ op, args });
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failOps.has(op)) throw new Error(`${op} failed`);
    const r = ((): unknown => {
      switch (op) {
        case 'volume.get': return { ...this.volume };
        case 'volume.set': this.volume.level = Number(args.level); return { ...this.volume };
        case 'volume.mute': this.volume.muted = Boolean(args.mute); return { ...this.volume };
        case 'window.list': return this.windows;
        case 'window.foreground': return this.windows.find((w) => w.hwnd === this.foreground) ?? null;
        case 'window.action':
          if (args.action === 'focus') this.foreground = Number(args.hwnd);
          return { ok: true };
        case 'power.status': return { percent: 81, charging: false, status: 'High', remainingSec: 7200 };
        case 'media.control': return { method: 'session', app: 'Spotify.exe', ok: true };
        case 'media.now': return { available: true, playing: true, status: 'Playing', app: 'Spotify.exe', title: 'Song', artist: 'Artist' };
        case 'audio.devices': return { output: 'Speakers', input: 'Microphone' };
        default: return { ok: true };
      }
    })();
    return r as T;
  }
  stop() { this.state = 'stopped'; }
}

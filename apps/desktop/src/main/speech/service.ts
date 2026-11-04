import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { WakePhraseId } from '@shared/settings';
import type { SpeechEvent, SpeechServiceStatus } from '@shared/types';

export interface SpeechPaths { python: string; args: string[]; serviceDir: string; model: string }

/**
 * Finds the speech service. Order: explicit env override, the frozen build
 * bundled with the installer, a dev checkout, a per-user install. Returns null
 * when none exists (the app then runs without voice input).
 */
export function locateSpeechService(appRoot: string, resourcesPath: string): SpeechPaths | null {
  const bundled = join(resourcesPath, 'speech-service');
  const frozen = join(bundled, 'clickyy-speech.exe');
  if (!process.env.CLICKYY_SPEECH_DIR && existsSync(frozen)) {
    return { python: frozen, args: [], serviceDir: bundled, model: process.env.CLICKYY_VOSK_MODEL ?? join(bundled, 'models', 'vosk-model-small-en-us-0.15') };
  }
  const dirs = [
    process.env.CLICKYY_SPEECH_DIR,
    join(resourcesPath, 'speech-service'),
    resolve(appRoot, '..', '..', 'services', 'assistant'),
    join(process.env.LOCALAPPDATA ?? '', 'Clickyy AI', 'speech-service'),
  ].filter((d): d is string => !!d);
  for (const dir of dirs) {
    const python = process.env.CLICKYY_PYTHON ?? join(dir, '.venv', 'Scripts', 'python.exe');
    if (existsSync(join(dir, 'clickyy_speech', 'server.py')) && existsSync(python)) {
      const model = process.env.CLICKYY_VOSK_MODEL ?? join(dir, 'models', 'vosk-model-small-en-us-0.15');
      return { python, args: ['-m', 'clickyy_speech'], serviceDir: dir, model };
    }
  }
  return null;
}

type Listener = (ev: SpeechEvent) => void;

/**
 * Supervises the loopback-only Python speech service: random port, per-launch
 * bearer token, health check, bounded restarts. Audio is streamed only while a
 * recognition session is active.
 */
export class SpeechService {
  status: SpeechServiceStatus = { state: 'stopped' };
  private proc: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private port = 0;
  private token = randomBytes(24).toString('hex');
  private restarts = 0;
  private stopping = false;
  private sessionActive = false;
  private starting: Promise<void> | null = null;

  constructor(private paths: SpeechPaths | null, private listener: Listener) {}

  private setStatus(s: SpeechServiceStatus) {
    this.status = s;
    this.listener({ type: 'status', status: s });
  }

  start(): Promise<void> {
    if (this.starting) return this.starting;
    if (!this.paths) {
      this.setStatus({ state: 'failed', message: 'Speech service not installed. Run scripts/setup-speech.ps1 (see docs/SETUP.md). Text input still works.' });
      return Promise.resolve();
    }
    this.stopping = false;
    this.setStatus({ state: 'starting', engine: 'vosk' });
    const paths = this.paths;
    this.starting = new Promise<void>((resolveStart) => {
      const proc = spawn(paths.python, paths.args, {
        cwd: paths.serviceDir,
        windowsHide: true,
        shell: false,
        env: { ...process.env, CLICKYY_TOKEN: this.token, CLICKYY_PORT: '0', CLICKYY_VOSK_MODEL: paths.model, PYTHONPATH: paths.serviceDir, PYTHONUNBUFFERED: '1' },
      });
      this.proc = proc;
      let stderr = '';
      const timer = setTimeout(() => {
        this.setStatus({ state: 'failed', message: 'Speech service did not start within 30 seconds.' });
        proc.kill();
        resolveStart();
      }, 30_000);
      proc.stdout?.setEncoding('utf8');
      proc.stdout?.on('data', async (d: string) => {
        const m = d.match(/CLICKYY_READY port=(\d+)/);
        if (!m) return;
        clearTimeout(timer);
        this.port = parseInt(m[1], 10);
        await this.health();
        resolveStart();
      });
      proc.stderr?.setEncoding('utf8');
      proc.stderr?.on('data', (d: string) => { stderr = (stderr + d).slice(-2000); });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        this.proc = null;
        this.ws?.close();
        this.ws = null;
        this.starting = null;
        resolveStart();
        if (this.stopping) return this.setStatus({ state: 'stopped' });
        const reason = stderr.split('\n').filter(Boolean).slice(-1)[0] ?? `exit code ${code}`;
        if (this.restarts < 3) {
          this.restarts++;
          this.setStatus({ state: 'starting', message: `Speech service stopped (${reason}). Restarting…` });
          setTimeout(() => void this.start(), 1000 * this.restarts);
        } else {
          this.setStatus({ state: 'failed', message: `Speech service keeps stopping: ${reason}` });
        }
      });
      proc.on('error', (e) => {
        clearTimeout(timer);
        this.setStatus({ state: 'failed', message: `Could not start Python: ${e.message}` });
        resolveStart();
      });
    });
    return this.starting;
  }

  private async health() {
    try {
      const r = await fetch(`http://127.0.0.1:${this.port}/health`, { headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(5000) });
      const body = (await r.json()) as { status: string; engines: { vosk: { ready: boolean; error?: string } }; wakeSupport: Partial<Record<WakePhraseId, boolean>> };
      if (body.status === 'ready') {
        this.restarts = 0;
        this.setStatus({ state: 'ready', engine: 'vosk', wakeSupport: body.wakeSupport });
      } else {
        this.setStatus({ state: 'degraded', engine: 'vosk', message: body.engines.vosk.error ?? 'Speech model missing' });
      }
    } catch (e) {
      this.setStatus({ state: 'failed', message: `Speech service health check failed: ${(e as Error).message}` });
    }
  }

  private connect(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    return new Promise((resolveWs, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws/stt?token=${this.token}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { this.ws = ws; resolveWs(ws); };
      ws.onerror = () => reject(new Error('Could not connect to the speech service'));
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        if (this.sessionActive) {
          this.sessionActive = false;
          this.listener({ type: 'error', code: 'disconnected', message: 'Speech service connection closed' });
        }
      };
      ws.onmessage = (m) => {
        try {
          const ev = JSON.parse(String(m.data)) as SpeechEvent | { type: 'pong' };
          if (ev.type === 'pong') return;
          this.listener(ev as SpeechEvent);
        } catch {
          /* ignore malformed */
        }
      };
    });
  }

  async startSession(mode: 'wake' | 'command', phrases: WakePhraseId[], sensitivity: number, cooldownMs = 2000) {
    if (this.status.state !== 'ready') {
      await this.start();
      if ((this.status as SpeechServiceStatus).state !== 'ready') throw new Error(this.status.message ?? 'Speech recognition is not available');
    }
    const ws = await this.connect();
    this.sessionActive = true;
    ws.send(JSON.stringify({ type: 'start', mode, phrases, sensitivity, cooldown_ms: cooldownMs }));
  }

  sendAudio(frame: ArrayBuffer) {
    if (!this.sessionActive || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (frame.byteLength === 0 || frame.byteLength > 64_000 || frame.byteLength % 2) return;
    this.ws.send(frame);
  }

  stopSession() {
    if (this.ws?.readyState === WebSocket.OPEN && this.sessionActive) this.ws.send(JSON.stringify({ type: 'stop' }));
    this.sessionActive = false;
  }

  cancelSession() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'cancel' }));
    this.sessionActive = false;
  }

  async restart() {
    this.shutdown();
    this.restarts = 0;
    await new Promise((r) => setTimeout(r, 300));
    await this.start();
  }

  shutdown() {
    this.stopping = true;
    this.sessionActive = false;
    this.ws?.close();
    this.ws = null;
    this.proc?.kill();
    this.proc = null;
    this.starting = null;
  }
}

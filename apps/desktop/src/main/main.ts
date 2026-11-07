import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, Notification, protocol, safeStorage, screen, session, shell, Tray, type WebContents } from 'electron';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, relative, sep } from 'node:path';
import { z } from 'zod';
import { IpcSend, type IpcPayload } from '@shared/ipc';
import { WAKE_PHRASES, type DeepPartial, type Settings, type WakePhraseId } from '@shared/settings';
import { CLOUD_PROVIDERS, PROVIDER_PRESETS, resolveBaseUrl, type CloudProviderId } from '@shared/providers';
import type { AssistantEvent, CatalogEntry, Diagnostics, SpeechEvent } from '@shared/types';
import { Db } from './storage/db';
import { createRepos, type Repos } from './storage/repos';
import { EncryptedFileSecretStore } from './security/secrets';
import { NetGuard } from './security/netGuard';
import { redact } from './security/redact';
import { PowerShellBridge } from './windows/bridge';
import { createRegistry } from './tools';
import { ToolExecutor } from './tools/executor';
import { ConfirmationBroker } from './tools/confirmations';
import { detectApps, setStartApps, startAppCount, validateAppTarget } from './tools/apps';
import type { Platform } from './tools/types';
import { ProviderManager } from './providers/manager';
import { cloudSpeech } from './providers/tts';
import { Assistant } from './assistant/orchestrator';
import { CATALOG } from './assistant/catalog';
import { Scheduler } from './scheduler';
import { locateSpeechService, SpeechService } from './speech/service';
import { registerIpc, type Handlers } from './ipc';

const DEV_URL = process.env.CLICKYY_DEV_SERVER_URL;
const APP_ORIGIN = 'app://clickyy';
const RENDERER_DIR = join(__dirname, '..', 'renderer');
const logs: string[] = [];
const log = (m: string) => {
  const line = `${new Date().toISOString()} ${redact(m, secretsForRedaction())}`;
  logs.push(line);
  if (logs.length > 500) logs.shift();
  if (!app.isPackaged) console.log(line);
};
let secretsForRedaction: () => string[] = () => [];

/** Reads the Start menu's app list (Get-StartApps) so any installed app can be opened by name. */
function loadStartApps() {
  const ps = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  execFile(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress'],
    { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) { log(`Start menu apps unavailable: ${err.message}`); return; }
      try {
        const parsed = JSON.parse(stdout || '[]') as unknown;
        setStartApps((Array.isArray(parsed) ? parsed : [parsed]) as Array<{ Name: string; AppID: string }>);
        log(`Found ${startAppCount()} Start menu apps.`);
      } catch (e) {
        log(`Could not read Start menu apps: ${(e as Error).message}`);
      }
    });
}

/** Finds the installed Ollama (per-user install, machine install, or PATH). */
function findOllama(): string | null {
  const env = process.env;
  const candidates = [
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'),
    env.ProgramFiles && join(env.ProgramFiles, 'Ollama', 'ollama.exe'),
    ...(env.PATH ?? '').split(';').filter(Boolean).map((d) => join(d, 'ollama.exe')),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => { try { return existsSync(p) && statSync(p).isFile(); } catch { return false; } }) ?? null;
}

/**
 * Starts Ollama in the background. Prefers Ollama's own tray app (the same as starting it from the
 * Start menu; it runs and logs the server), falling back to `ollama serve`. Returns false if Ollama
 * isn't installed.
 */
function startOllama(): boolean {
  const exe = findOllama();
  if (!exe) { log('Ollama is not installed; cannot start the local model runtime.'); return false; }
  const trayApp = join(exe, '..', 'ollama app.exe');
  const [cmd, args] = existsSync(trayApp) ? [trayApp, []] : [exe, ['serve']];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, cwd: join(exe, '..') });
    child.on('error', (e) => log(`Starting Ollama failed: ${e.message}`));
    child.unref();
    log(`Started Ollama: ${cmd}`);
    return true;
  } catch (e) {
    log(`Starting Ollama failed: ${(e as Error).message}`);
    return false;
  }
}

// Isolated profile for automated end-to-end tests (scripts/e2e.mjs).
if (process.env.CLICKYY_USER_DATA) app.setPath('userData', process.env.CLICKYY_USER_DATA);

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let repos: Repos;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

function send(channel: 'assistant:event' | 'speech:event' | 'settings:changed' | 'ui:command', payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
const emit = (ev: AssistantEvent) => send('assistant:event', ev);

function isTrusted(wc: WebContents, frameUrl: string | undefined): boolean {
  if (!win || wc.id !== win.webContents.id || !frameUrl) return false;
  try {
    const u = new URL(frameUrl);
    if (DEV_URL) return u.origin === new URL(DEV_URL).origin;
    // Node's URL gives custom schemes an opaque origin, so compare scheme + host explicitly.
    return u.protocol === 'app:' && u.host === 'clickyy';
  } catch {
    return false;
  }
}

function registerAppProtocol() {
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = normalize(join(RENDERER_DIR, rel));
    const r = relative(RENDERER_DIR, file);
    if (url.host !== 'clickyy' || r.startsWith('..') || r.includes(`..${sep}`) || !existsSync(file) || statSync(file).isDirectory()) {
      return new Response('Not found', { status: 404 });
    }
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.wav': 'audio/wav', '.ico': 'image/x-icon' };
    return new Response(readFileSync(file), {
      headers: { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' },
    });
  });
}

function iconPath() {
  const p = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '..', '..', 'resources', 'icon.png');
  return existsSync(p) ? p : undefined;
}

function createWindow(settings: Settings) {
  win = new BrowserWindow({
    width: 440, height: 720, minWidth: 360, minHeight: 560,
    show: false, frame: false, backgroundColor: '#101114', title: 'Clickyy AI',
    alwaysOnTop: settings.ui.alwaysOnTop, icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, spellcheck: false, backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith(APP_ORIGIN);
    if (!allowed) e.preventDefault();
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (!quitting && repos.settings.get().ui.closeBehavior === 'tray') {
      e.preventDefault();
      win?.hide();
    }
  });
  win.once('ready-to-show', () => { if (!settings.ui.startHidden && !process.argv.includes('--hidden')) win?.show(); });
  void win.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else { win.show(); win.focus(); }
}

function applyShortcuts(s: Settings) {
  globalShortcut.unregisterAll();
  const reg = (acc: string, fn: () => void) => {
    if (!acc) return;
    try {
      if (!globalShortcut.register(acc, fn)) log(`Shortcut ${acc} is in use by another app`);
    } catch (e) {
      log(`Invalid shortcut ${acc}: ${(e as Error).message}`);
    }
  };
  reg(s.ui.globalShortcut, toggleWindow);
  reg(s.ui.muteShortcut, () => send('ui:command', { cmd: 'mic_toggle' }));
}

function applyWindowSettings(s: Settings, prev?: Settings) {
  win?.setAlwaysOnTop(s.ui.alwaysOnTop);
  if (!prev || prev.ui.globalShortcut !== s.ui.globalShortcut || prev.ui.muteShortcut !== s.ui.muteShortcut) applyShortcuts(s);
  if (app.isPackaged && (!prev || prev.ui.launchAtLogin !== s.ui.launchAtLogin)) app.setLoginItemSettings({ openAtLogin: s.ui.launchAtLogin, args: ['--hidden'] });
}

function buildTray(assistant: Assistant) {
  const img = iconPath() ? nativeImage.createFromPath(iconPath()!).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('Clickyy AI');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / hide Clickyy', click: toggleWindow },
    { label: 'Mute microphone', click: () => send('ui:command', { cmd: 'mic_mute' }) },
    { label: 'Emergency stop', click: () => assistant.emergencyStop() },
    { type: 'separator' },
    { label: 'Quit Clickyy', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', toggleWindow);
}

const platform: Platform = {
  async openExternal(url) {
    const u = new URL(url);
    if (u.protocol === 'file:' || u.protocol === 'javascript:') throw new Error('Blocked URL scheme');
    await shell.openExternal(url, { activate: true });
  },
  openPath: (p) => shell.openPath(p),
  spawnDetached: (file, args) => new Promise((ok, fail) => {
    if (!existsSync(file)) return fail(new Error(`Not found: ${file}`));
    const child = spawn(file, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: false });
    child.once('error', fail);
    child.once('spawn', () => { child.unref(); ok(); });
  }),
  trashItem: (p) => shell.trashItem(p),
  notify: (title, body) => { if (Notification.isSupported()) new Notification({ title, body, silent: false }).show(); },
  fileExists: (p) => existsSync(p),
  isOnline: () => net.isOnline(),
  async captureScreen() {
    const display = screen.getPrimaryDisplay();
    const scale = Math.min(1, 1600 / display.size.width);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) } });
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!src) throw new Error('No screen is available to capture.');
    return src.thumbnail.toPNG().toString('base64');
  },
};

async function main() {
  await app.whenReady();
  const dataDir = app.getPath('userData');
  // Real user folders (OneDrive may redirect Desktop/Documents) for the file and output tools.
  for (const f of ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'] as const) {
    try { process.env[`CLICKYY_DIR_${f.toUpperCase()}`] = app.getPath(f); } catch { /* fall back to the home folder */ }
  }
  const wasm = join(__dirname, 'sql-wasm.wasm');
  const db = await Db.open(join(dataDir, 'clickyy.db'), wasm);
  repos = createRepos(db);
  if (repos.settings.repaired) log('Some stored settings were invalid and were reset to defaults.');
  const settings = () => repos.settings.get();

  const secrets = new EncryptedFileSecretStore(join(dataDir, 'secrets.bin.json'), safeStorage);
  secretsForRedaction = () => secrets.all();
  const guard = new NetGuard(() => settings().ai.policy, (a) => emit({ type: 'network', active: a.active, host: a.host, purpose: a.purpose }));

  // Seed the approved app registry with installed well-known apps on first run.
  if (repos.apps.list().length === 0) for (const a of detectApps(existsSync)) repos.apps.upsert(a);
  const pruned = repos.conversations.prune(settings().privacy.historyRetentionDays * 86_400_000);
  if (pruned) log(`Pruned ${pruned} conversations past retention.`);

  const bridge = new PowerShellBridge(app.isPackaged ? join(process.resourcesPath, 'windows', 'bridge.ps1') : join(__dirname, '..', '..', 'resources', 'windows', 'bridge.ps1'));
  const registry = createRegistry();
  const broker = new ConfirmationBroker((request) => { emit({ type: 'confirm', request }); emit({ type: 'phase', phase: 'confirming' }); win?.show(); }, (id, approved) => emit({ type: 'confirm_resolved', id, approved }));
  const executor = new ToolExecutor(registry, broker, (call) => emit({ type: 'tool', call }));
  const providers = new ProviderManager(settings, secrets, guard, () => net.isOnline(), startOllama);

  let speech: SpeechService;
  const scheduler = new Scheduler(repos.reminders, (r, late) => {
    const text = r.kind === 'timer' ? `Your timer is done. ${r.text}` : r.kind === 'focus' ? r.text : `Reminder: ${r.text}`;
    platform.notify('Clickyy', text);
    emit({ type: 'reply', reply: { turnId: `rem-${r.id}`, text: late ? `${text} (This was due while Clickyy wasn't running.)` : text, speech: text, style: 'warm', source: 'system', expectFollowUp: false } });
  });

  const updateSettings = (patch: DeepPartial<Settings>) => {
    const prev = settings();
    const next = repos.settings.update(patch);
    applyWindowSettings(next, prev);
    send('settings:changed', next);
    if (prev.ai.local.baseUrl !== next.ai.local.baseUrl || prev.ai.local.model !== next.ai.local.model) void providers.refreshLocal();
    return next;
  };

  const assistant = new Assistant({
    repos, registry, executor, broker, bridge, platform, providers,
    scheduler: { schedule: (id, at) => scheduler.schedule(id, at), cancel: (id) => scheduler.cancel(id) },
    emit, settings, updateSettings,
    speechStatus: () => speech.status,
    uiCommand: (cmd, payload) => send('ui:command', { cmd, payload }),
    net: guard.fetchFor('tools'),
  });

  // Proactive alerts: Clickyy speaks up when the battery runs low or the CPU stays pegged.
  const alerted = { battery: false, cpuStrikes: 0, cpuAlertAt: 0 };
  let cpuPrev = os.cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
  const alert = (text: string) => {
    platform.notify('Clickyy', text);
    emit({ type: 'reply', reply: { turnId: `alert-${Date.now()}`, text, speech: text, style: 'calm', source: 'system', expectFollowUp: false } });
  };
  setInterval(async () => {
    const s = settings().proactive;
    if (s.batteryAlert) {
      const p = await bridge.call<{ percent: number; charging: boolean; status: string }>('power.status').catch(() => null);
      if (p && p.status !== 'NoSystemBattery' && p.percent <= 100) {
        if (!p.charging && p.percent <= s.batteryThreshold && !alerted.battery) {
          alerted.battery = true;
          alert(`Heads up, battery is at ${p.percent} percent. You may want to plug in.`);
        } else if (p.charging || p.percent > s.batteryThreshold + 5) alerted.battery = false;
      }
    }
    const now = os.cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
    let idle = 0, total = 0;
    now.forEach((x, i) => { idle += x.idle - (cpuPrev[i]?.idle ?? 0); total += x.total - (cpuPrev[i]?.total ?? 0); });
    cpuPrev = now;
    const cpu = total ? Math.round(100 * (1 - idle / total)) : 0;
    if (s.cpuAlert && cpu >= s.cpuThreshold) {
      if (++alerted.cpuStrikes >= 3 && Date.now() - alerted.cpuAlertAt > 30 * 60_000) {
        alerted.cpuAlertAt = Date.now();
        alert(`Your CPU has been above ${s.cpuThreshold} percent for a few minutes. Say "what's using my memory" to see the top processes.`);
      }
    } else alerted.cpuStrikes = 0;
  }, 60_000).unref();

  speech = new SpeechService(locateSpeechService(app.getAppPath(), process.resourcesPath), (ev: SpeechEvent) => send('speech:event', ev));

  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const ok = isTrusted(wc, details.requestingUrl) && permission === 'media' && (details as { mediaTypes?: string[] }).mediaTypes?.every((t) => t === 'audio');
    cb(!!ok);
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => !!wc && permission === 'media' && isTrusted(wc, origin));

  registerAppProtocol();

  const catalog = (): CatalogEntry[] => CATALOG.map((c) => {
    const t = c.tool ? registry.get(c.tool) : undefined;
    return { id: c.id, category: c.category, description: c.description, examples: c.examples, tool: c.tool, risk: t?.risk ?? 1, permission: t?.permission ?? undefined, confirmation: !t ? 'never' : t.risk === 3 || t.confirm === 'always' ? 'always' : typeof t.confirm === 'function' ? 'conditional' : 'never', offline: t ? t.offline : true };
  });

  const handlers: Handlers = {
    'settings:get': () => settings(),
    'settings:update': (p) => updateSettings(p as DeepPartial<Settings>),
    'assistant:submit': (p) => { const { text, source } = p as IpcPayload<'assistant:submit'>; return assistant.submit(text, source); },
    'assistant:cancel': () => assistant.cancel(),
    'assistant:emergencyStop': () => { assistant.emergencyStop(); speech.cancelSession(); },
    'assistant:newSession': () => assistant.newSession(),
    'assistant:status': () => ({ busy: assistant.busy, pending: broker.list() }),
    'confirm:respond': (p) => { const { id, approved } = p as IpcPayload<'confirm:respond'>; return broker.respond(id, approved); },
    'history:list': () => repos.conversations.list(),
    'history:get': (p) => repos.conversations.messages((p as { id: string }).id),
    'history:delete': (p) => repos.conversations.delete((p as { id: string }).id),
    'history:clear': () => repos.conversations.clear(),
    'history:export': async () => {
      const r = await dialog.showSaveDialog(win!, { title: 'Export conversation history', defaultPath: 'clickyy-history.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (r.canceled || !r.filePath) return false;
      writeFileSync(r.filePath, JSON.stringify(repos.conversations.exportAll(), null, 2));
      return true;
    },
    'memory:list': (p) => repos.memories.list((p as { query?: string } | undefined)?.query),
    'memory:add': (p) => { const { text, category } = p as { text: string; category: string }; return repos.memories.add(text, category); },
    'memory:update': (p) => { const { id, text } = p as { id: string; text: string }; return repos.memories.update(id, text); },
    'memory:delete': (p) => repos.memories.delete((p as { id: string }).id),
    'memory:clear': () => repos.memories.clear(),
    'memory:export': async () => {
      const r = await dialog.showSaveDialog(win!, { title: 'Export memories', defaultPath: 'clickyy-memories.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (r.canceled || !r.filePath) return false;
      writeFileSync(r.filePath, JSON.stringify(repos.memories.list(), null, 2));
      return true;
    },
    'apps:list': () => repos.apps.list(),
    'apps:upsert': (p) => {
      const e = p as IpcPayload<'apps:upsert'>;
      const problem = validateAppTarget(e.kind, e.target);
      if (problem) throw new Error(problem);
      if (e.kind === 'exe' && !existsSync(e.target)) throw new Error('That executable does not exist');
      return repos.apps.upsert({ ...e, enabled: e.enabled ?? true });
    },
    'apps:delete': (p) => repos.apps.delete((p as { id: string }).id),
    'apps:detect': () => {
      const known = new Set(repos.apps.list().map((a) => a.name));
      const added = detectApps(existsSync).filter((a) => !known.has(a.name));
      for (const a of added) repos.apps.upsert(a);
      return added.length;
    },
    'routines:list': () => repos.routines.list(),
    'routines:upsert': (p) => {
      const r = p as IpcPayload<'routines:upsert'>;
      for (const s of r.steps) {
        const t = registry.get(s.tool);
        if (!t) throw new Error(`Unknown action ${s.tool}`);
        const v = t.input.safeParse(s.args);
        if (!v.success) throw new Error(`Step "${s.label ?? s.tool}": ${v.error.issues[0]?.message}`);
      }
      return repos.routines.upsert({ ...r, enabled: r.enabled ?? true });
    },
    'routines:delete': (p) => repos.routines.delete((p as { id: string }).id),
    'routines:preview': (p) => (p as IpcPayload<'routines:preview'>).steps.map((s) => {
      const t = registry.get(s.tool);
      const v = t?.input.safeParse(s.args);
      return { tool: s.tool, title: t?.title ?? s.tool, risk: t?.risk ?? 3, valid: !!v?.success, error: v && !v.success ? v.error.issues[0]?.message : t ? undefined : 'Unknown action', confirm: !!t && (t.risk === 3 || t.confirm === 'always') };
    }),
    'reminders:list': () => repos.reminders.pending(),
    'reminders:cancel': (p) => { const id = (p as { id: string }).id; scheduler.cancel(id); return repos.reminders.setStatus(id, 'cancelled'); },
    'secrets:set': (p) => { const { provider, key } = p as IpcPayload<'secrets:set'>; secrets.set(provider, key); providers.setCloudMessage(undefined); return true; },
    'secrets:clear': (p) => { secrets.clear((p as IpcPayload<'secrets:clear'>).provider); return true; },
    'providers:status': async () => { await providers.refreshLocal(); return providers.status(); },
    'providers:models': async (p) => {
      const provider = (p as { provider: CloudProviderId | 'local' }).provider;
      if (provider !== 'local' && settings().ai.policy === 'strict_offline') throw new Error('Strict Offline mode blocks cloud requests.');
      return providers.listModels(provider);
    },
    'providers:test': async (p) => {
      const target = (p as { target: 'local' | 'cloud' }).target;
      const prov = target === 'local' ? providers.local() : providers.cloud();
      if (!prov) return { ok: false, message: target === 'cloud' ? `No ${PROVIDER_PRESETS[settings().ai.cloud.provider].label} API key (or base URL) configured.` : 'Local provider not configured.' };
      if (target === 'cloud' && settings().ai.policy === 'strict_offline') return { ok: false, message: 'Strict Offline mode blocks cloud requests.' };
      const r = await prov.check();
      if (target === 'local') await providers.refreshLocal();
      else providers.setCloudMessage(r.ok ? undefined : r.message);
      return r;
    },
    'speech:status': () => speech.status,
    'speech:restart': () => speech.restart(),
    'speech:start': async (p) => {
      const { mode } = p as IpcPayload<'speech:start'>;
      const s = settings();
      const phrases = WAKE_PHRASES.filter((id) => s.wake.phrases[id as WakePhraseId]);
      await speech.startSession(mode, phrases, s.wake.sensitivity, s.wake.cooldownMs, s.speech.accurateStt);
      return true;
    },
    'tts:neural': async (p) => {
      const s = settings();
      const { text } = p as { text: string };
      const wav = await speech.synthesize(text, s.speech.neuralVoice, s.speech.rate);
      return wav.toString('base64');
    },
    'tts:voices': () => speech.voices(),
    'speech:stop': () => speech.stopSession(),
    'speech:cancel': () => speech.cancelSession(),
    'tts:cloud': async (p) => {
      const s = settings();
      if (s.speech.ttsEngine !== 'cloud') throw new Error('Cloud voice is not selected');
      if (s.ai.policy === 'strict_offline') throw new Error('Strict Offline mode blocks cloud voice');
      const ttsProvider = s.speech.cloudTtsProvider;
      const key = secrets.get(ttsProvider);
      const baseUrl = resolveBaseUrl(ttsProvider, ttsProvider === s.ai.cloud.provider ? s.ai.cloud.baseUrl : '');
      if (!key || !baseUrl) throw new Error(`Cloud voice needs a ${PROVIDER_PRESETS[ttsProvider].label} API key${ttsProvider === 'openai_compatible' ? ' and base URL' : ''}`);
      const audio = await cloudSpeech({ baseUrl, apiKey: key, voice: s.speech.cloudVoice, text: (p as { text: string }).text, fetch: guard.fetchFor('cloud-tts') });
      return audio.toString('base64');
    },
    'catalog:list': () => catalog(),
    'audit:list': () => repos.audit.list(),
    'diagnostics:get': (): Diagnostics => ({
      appVersion: app.getVersion(), electron: process.versions.electron, platform: `${process.platform} ${process.getSystemVersion()}`,
      dataDir, db: { path: db.file ?? '', sizeBytes: db.sizeBytes() }, bridge: { state: bridge.state, lastError: bridge.lastError },
      speech: speech.status, memoryMB: Math.round(process.memoryUsage().rss / 1048576), uptimeSec: Math.round(process.uptime()), logs: logs.slice(-200),
    }),
    'data:clearAll': () => {
      repos.conversations.clear(); repos.memories.clear(); repos.reminders.clear(); repos.audit.clear(); scheduler.stopAll();
      for (const prov of CLOUD_PROVIDERS) secrets.clear(prov);
      assistant.newSession();
      return true;
    },
    'folders:pick': async (p) => {
      const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: (p as { purpose: string }).purpose === 'workspace' ? 'Choose workspace folder' : 'Approve a folder for Clickyy' });
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
    'window:control': (p) => {
      const a = (p as IpcPayload<'window:control'>).action;
      if (a === 'minimize') win?.minimize();
      else if (a === 'hide') win?.hide();
      else if (a === 'quit') { quitting = true; app.quit(); }
      else win?.close();
    },
  };
  registerIpc(handlers, isTrusted, log);

  const AudioFrame = z.instanceof(ArrayBuffer).or(z.instanceof(Uint8Array));
  ipcMain.on('speech:audio', (e, frame) => {
    if (!isTrusted(e.sender, e.senderFrame?.url) || !AudioFrame.safeParse(frame).success) return;
    const buf: ArrayBuffer = frame instanceof Uint8Array ? frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer : frame;
    speech.sendAudio(buf);
  });
  ipcMain.on('tts:state', (e, state) => {
    if (!isTrusted(e.sender, e.senderFrame?.url) || !IpcSend['tts:state'].safeParse(state).success) return;
    emit({ type: 'phase', phase: (state as { speaking: boolean }).speaking ? 'speaking' : 'idle' });
  });

  createWindow(settings());
  applyWindowSettings(settings());
  buildTray(assistant);
  scheduler.restore();
  void providers.ensureLocal();
  loadStartApps();
  // Keep checking in the background so the local model shows up as soon as it's available.
  setInterval(() => void providers.refreshLocal(), 30_000);
  void speech.start();
  void bridge.call('ping').then(() => log('Windows bridge ready')).catch((e) => log(`Windows bridge unavailable: ${e.message}`));

  app.on('second-instance', () => { win?.show(); win?.focus(); });
  app.on('before-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    scheduler.stopAll();
    speech.shutdown();
    bridge.stop();
    db.close();
  });
  app.on('window-all-closed', () => { if (repos.settings.get().ui.closeBehavior === 'quit') app.quit(); });
}

main().catch((e) => {
  dialog.showErrorBox('Clickyy failed to start', redact(String(e?.stack ?? e)));
  app.exit(1);
});

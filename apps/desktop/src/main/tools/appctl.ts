import { z } from 'zod';
import type { AppEntry } from '@shared/types';
import { defineTool, type ToolContext, type ToolDef } from './types';
import { allApps, findApp, KNOWN_APPS, matchWindow, targetWindow, validateAppTarget } from './apps';
import type { WindowInfo } from '../windows/bridge';
import { mkdir, writeFile } from 'node:fs/promises';
import { outputDir, uniquePath } from './output';
import { settingsUri } from '../security/url';

const appName = z.string().trim().min(1).max(80);
const PROC_RE = /^[A-Za-z0-9 ._+-]{1,60}$/;
const BROWSER_PROCS = new Set(['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi']);
const PROTECTED = /^(clickyy|electron|explorer|dwm|csrss|lsass|svchost|winlogon|system|powershell|services|smss|wininit)/i;

type ProcInfo = { pid: number; cpuSec: number; memMB: number; title: string; path: string | null };
/** PowerShell unrolls a one-item array, so a single process can arrive as a bare object. */
export async function procInfo(ctx: ToolContext, name: string): Promise<ProcInfo[]> {
  const v = await ctx.bridge.call<ProcInfo[] | ProcInfo | null>('process.info', { name });
  return Array.isArray(v) ? v : v ? [v] : [];
}

interface Resolved { app?: AppEntry; name: string; process?: string }

/** The registered app the user means, plus the process name to look for. */
function resolveApp(ctx: ToolContext, query: string): Resolved {
  const { match, candidates } = findApp(allApps(ctx.repos.apps.list()), query);
  if (!match && candidates.length > 1) throw new Error(`Did you mean ${candidates.slice(0, 3).map((c) => c.name).join(' or ')}?`);
  if (match) {
    const fromTarget = match.kind === 'exe' ? match.target.split('\\').pop()?.replace(/\.exe$/i, '') : undefined;
    // Start-menu entries (Store apps, shortcuts) carry no process name; fall back to the known one.
    const known = KNOWN_APPS.find((k) => k.name.toLowerCase() === match.name.toLowerCase() || k.aliases.includes(match.name.toLowerCase()));
    return { app: match, name: match.name, process: match.processName ?? fromTarget ?? known?.process };
  }
  // Not registered: allow a plain process-like name ("notepad++", "zoom").
  const guess = query.trim().replace(/\.exe$/i, '');
  if (!PROC_RE.test(guess)) throw new Error(`I don't know an app called ${query}.`);
  return { name: guess, process: guess.replace(/\s+/g, '') };
}

async function windowsOf(ctx: ToolContext, r: Resolved): Promise<WindowInfo[]> {
  const wins = await ctx.bridge.call<WindowInfo[]>('window.list');
  if (r.process) {
    const byProc = wins.filter((w) => w.process?.toLowerCase() === r.process!.toLowerCase());
    if (byProc.length) return byProc;
  }
  return matchWindow(wins, r.name, allApps(ctx.repos.apps.list()));
}

async function launch(ctx: ToolContext, app: AppEntry, args: string[] = []) {
  const problem = validateAppTarget(app.kind, app.target);
  if (problem) throw new Error(`${app.name} has an invalid launch target: ${problem}.`);
  if (app.kind === 'exe') await ctx.platform.spawnDetached(app.target, args);
  else if (app.kind === 'uri') await ctx.platform.openExternal(app.target);
  else await ctx.platform.spawnDetached(`${process.env.SystemRoot ?? 'C:\\Windows'}\\explorer.exe`, [`shell:AppsFolder\\${app.target}`]);
}

const CACHE_PAGES: Record<string, string> = {
  chrome: 'chrome://settings/clearBrowserData', msedge: 'edge://settings/clearBrowserData', brave: 'brave://settings/clearBrowserData',
  opera: 'opera://settings/clearBrowserData', vivaldi: 'vivaldi://settings/clearBrowserData', firefox: 'about:preferences#privacy',
};

export const appControlTools: ToolDef[] = [
  defineTool({
    name: 'apps.status', title: 'App status', description: 'Tell whether an app is running and how much CPU time and memory it uses, which version is installed, or where it is installed.', category: 'Apps', risk: 1, permission: 'apps',
    input: z.object({ app: appName, info: z.enum(['running', 'usage', 'version', 'location']).default('running') }).strict(), confirm: 'never', timeoutMs: 8000, offline: true,
    describe: ({ app, info }) => `Check ${info === 'running' ? 'whether' : `the ${info} of`} ${app}${info === 'running' ? ' is running' : ''}`,
    async run({ app, info }, ctx) {
      const r = resolveApp(ctx, app);
      const procs = r.process && PROC_RE.test(r.process) ? await procInfo(ctx, r.process) : [];
      if (info === 'version' || info === 'location') {
        const path = r.app?.kind === 'exe' ? r.app.target : procs.find((p) => p.path)?.path ?? null;
        if (!path) return { ok: false, message: r.app?.kind === 'appx' || r.app?.kind === 'uri' ? `${r.name} is a Store app, so Windows manages its files. You can see its version in Settings, Apps, Installed apps.` : `I can't find where ${r.name} is installed. Open it first and ask again.` };
        if (info === 'location') return { ok: true, data: { path }, message: `${r.name} is installed at ${path}.`, detail: path };
        const v = await ctx.bridge.call<{ product: string | null; file: string | null }>('file.version', { path });
        const ver = v.product || v.file;
        return { ok: !!ver, data: v, message: ver ? `${r.name} version ${ver} is installed.` : `${r.name} doesn't report a version number.` };
      }
      if (!procs.length) return { ok: true, data: { running: false }, message: `${r.name} isn't running.` };
      const mem = procs.reduce((a, p) => a + p.memMB, 0), cpu = procs.reduce((a, p) => a + p.cpuSec, 0);
      if (info === 'running') return { ok: true, data: { running: true, processes: procs.length }, message: `Yes, ${r.name} is running${procs.length > 1 ? ` in ${procs.length} processes` : ''}.` };
      return { ok: true, data: { memMB: mem, cpuSec: cpu, processes: procs.length }, message: `${r.name} is using ${mem >= 1024 ? `${(mem / 1024).toFixed(1)} gigabytes` : `${mem} megabytes`} of memory across ${procs.length} process${procs.length > 1 ? 'es' : ''}, and has used ${Math.round(cpu)} seconds of CPU time since it started.` };
    },
  }),
  defineTool({
    name: 'apps.force_quit', title: 'Force quit app', description: 'End a frozen app immediately. Unsaved work in that app is lost. Windows system processes and Clickyy itself are protected.', category: 'Apps', risk: 3, permission: 'apps',
    input: z.object({ app: appName }).strict(), confirm: 'always', timeoutMs: 15000, offline: true,
    confirmLabel: ({ app }) => `Force quit ${app}`,
    describe: ({ app }) => `Force quit ${app} right now. Anything unsaved in it will be lost.`,
    async run({ app }, ctx) {
      const r = resolveApp(ctx, app);
      if (!r.process || PROTECTED.test(r.process)) return { ok: false, message: `I won't force quit ${r.name}; it's part of Windows or Clickyy.` };
      const s = await ctx.bridge.call<{ stopped: number; remaining: number }>('process.stop', { name: r.process });
      if (!s.stopped) return { ok: true, message: `${r.name} wasn't running.` };
      return { ok: s.remaining === 0, message: s.remaining === 0 ? `${r.name} has been closed.` : `${r.name} is still running; it may need administrator rights to stop.` };
    },
  }),
  defineTool({
    name: 'windows.close_app', title: 'Close every window of an app', description: 'Politely ask every window of an app to close (the app may ask to save).', category: 'Windows', risk: 2, permission: 'windows',
    input: z.object({ app: appName }).strict(), confirm: 'always', timeoutMs: 15000, offline: true,
    confirmLabel: ({ app }) => `Close ${app}`,
    describe: ({ app }) => `Close all ${app} windows. If anything is unsaved, the app will ask you.`,
    async run({ app }, ctx) {
      const r = resolveApp(ctx, app);
      if (!r.process || PROTECTED.test(r.process)) return { ok: false, message: `I won't close ${r.name}.` };
      const c = await ctx.bridge.call<{ running: boolean; closed: number }>('window.closeApp', { name: r.process });
      return { ok: true, message: c.running ? `Asked ${r.name} to close${c.closed > 1 ? ` its ${c.closed} windows` : ''}.` : `${r.name} isn't running.` };
    },
  }),
  defineTool({
    name: 'apps.restart', title: 'Restart app', description: 'Close an app and open it again. It may ask to save first.', category: 'Apps', risk: 2, permission: 'apps',
    input: z.object({ app: appName }).strict(), confirm: 'always', timeoutMs: 40000, offline: true,
    confirmLabel: ({ app }) => `Restart ${app}`,
    describe: ({ app }) => `Close ${app} and open it again. If it has unsaved work it may ask you first.`,
    async run({ app }, ctx) {
      const r = resolveApp(ctx, app);
      if (!r.app) return { ok: false, message: `${r.name} isn't in my approved apps, so I can't reopen it.` };
      if (!r.process || PROTECTED.test(r.process)) return { ok: false, message: `I won't restart ${r.name}.` };
      const c = await ctx.bridge.call<{ running: boolean; closed: number }>('window.closeApp', { name: r.process });
      if (c.running) {
        const until = Date.now() + 12000;
        while (Date.now() < until && (await procInfo(ctx, r.process!)).length) await new Promise((res) => setTimeout(res, 500));
        if ((await procInfo(ctx, r.process!)).length) return { ok: false, message: `${r.name} is still open. It may be waiting for you to save something.` };
      }
      await launch(ctx, r.app);
      return { ok: true, message: c.running ? `${r.name} has restarted.` : `${r.name} wasn't running, so I just opened it.` };
    },
  }),
  defineTool({
    name: 'apps.startup', title: 'Start app with Windows', description: 'Make an installed desktop app start when you sign in, or stop it from starting. Store apps and apps with their own setting open the Startup apps page instead.', category: 'Apps', risk: 2, permission: 'apps',
    input: z.object({ app: appName, enable: z.boolean() }).strict(), confirm: 'always', timeoutMs: 8000, offline: true,
    confirmLabel: ({ app, enable }) => (enable ? `Start ${app} with Windows` : `Stop ${app} starting with Windows`),
    describe: ({ app, enable }) => (enable ? `Start ${app} automatically when you sign in.` : `Stop ${app} from starting when you sign in.`),
    async run({ app, enable }, ctx) {
      const r = resolveApp(ctx, app);
      const name = r.name.replace(/[^A-Za-z0-9 ._+()-]/g, '').slice(0, 60) || 'App';
      if (enable) {
        if (r.app?.kind !== 'exe') {
          await ctx.platform.openExternal(settingsUri('startup'));
          return { ok: true, message: `${r.name} is a Store app, so Windows controls its startup. I opened Startup apps where you can switch it on.` };
        }
        await ctx.bridge.call('startup.set', { name, path: r.app.target, on: true });
        return { ok: true, message: `${r.name} will start when you sign in.` };
      }
      const res = await ctx.bridge.call<{ removed: number }>('startup.set', { name, path: r.app?.kind === 'exe' ? r.app.target : '', on: false });
      if (res.removed) return { ok: true, message: `${r.name} won't start with Windows anymore.` };
      await ctx.platform.openExternal(settingsUri('startup'));
      return { ok: true, message: `${r.name} isn't in your personal startup list. I opened Startup apps so you can switch it off there.` };
    },
  }),
  defineTool({
    name: 'apps.clear_cache', title: 'Clear app cache', description: "Open the place where an app's cache can be cleared: the browser's clear-data page, or Windows storage settings for other apps. Nothing is deleted without you choosing it.", category: 'Apps', risk: 1, permission: 'apps',
    input: z.object({ app: appName }).strict(), confirm: 'never', timeoutMs: 8000, offline: true,
    describe: ({ app }) => `Open the cache settings for ${app}`,
    async run({ app }, ctx) {
      const r = resolveApp(ctx, app);
      const page = r.process ? CACHE_PAGES[r.process.toLowerCase()] : undefined;
      if (page && r.app?.kind === 'exe') {
        await ctx.platform.spawnDetached(r.app.target, [page]);
        return { ok: true, message: `I opened ${r.name}'s Clear browsing data page. Pick "Cached images and files" and press Clear.` };
      }
      await ctx.platform.openExternal(settingsUri(r.app?.kind === 'appx' ? 'apps' : 'storage'));
      return { ok: true, message: r.app?.kind === 'appx' ? `I opened Installed apps. Choose ${r.name}, then Advanced options, then Reset or Repair to clear its data.` : `${r.name} keeps its own cache, so I opened Storage settings where Temporary files can be cleaned. Many apps also have a clear-cache option in their own settings.` };
    },
  }),
  defineTool({
    name: 'windows.manage', title: 'Move or pin a window', description: 'Center a window, resize it, keep it on top (or stop), move it to the next monitor, minimize every other window, or open a new window of the app. Omit query for the current window.', category: 'Windows', risk: 1, permission: 'windows',
    input: z.object({
      action: z.enum(['center', 'resize', 'topmost_on', 'topmost_off', 'next_monitor', 'solo', 'new_window']),
      query: z.string().trim().max(80).optional(),
      width: z.number().int().min(300).max(7680).optional(), height: z.number().int().min(200).max(4320).optional(),
    }).strict(), confirm: 'never', timeoutMs: 10000, offline: true,
    describe: ({ action, query }) => `${({ center: 'Center', resize: 'Resize', topmost_on: 'Keep on top:', topmost_off: 'Stop keeping on top:', next_monitor: 'Move to the next monitor:', solo: 'Minimize everything except', new_window: 'Open a new window of' } as Record<string, string>)[action]} ${query ?? 'the current window'}`,
    async run({ action, query, width, height }, ctx) {
      if (action === 'new_window' && query) {
        const r = resolveApp(ctx, query);
        if (r.app?.kind === 'exe' && r.process && BROWSER_PROCS.has(r.process.toLowerCase())) {
          await launch(ctx, r.app, ['--new-window']);
          return { ok: true, message: `Opened a new ${r.name} window.` };
        }
        const wins = await windowsOf(ctx, r);
        if (!wins.length) {
          if (!r.app) return { ok: false, message: `${r.name} isn't open.` };
          await launch(ctx, r.app);
          return { ok: true, message: `${r.name} wasn't open, so I opened it.` };
        }
        await ctx.bridge.call('window.action', { hwnd: wins[0].hwnd, action: 'focus' });
        await new Promise((res) => setTimeout(res, 250));
        if (!ctx.settings.tools.permissions.automation) return { ok: false, message: `I brought ${r.name} to the front. Press Control N for a new window; I need the Automation permission to press keys for you.` };
        await ctx.bridge.call('keys.send', { spec: '^n' });
        return { ok: true, message: `Asked ${r.name} for a new window.` };
      }
      const w = query ? (await windowsOf(ctx, resolveSafe(ctx, query)))[0] ?? await targetWindow(ctx, query) : await targetWindow(ctx, undefined);
      const label = w.process ?? w.title;
      ctx.session.lastWindow = { hwnd: w.hwnd, title: w.title };
      if (action === 'solo') {
        await ctx.bridge.call('window.minimizeAll');
        await new Promise((res) => setTimeout(res, 300));
        await ctx.bridge.call('window.action', { hwnd: w.hwnd, action: 'restore' });
        await ctx.bridge.call('window.action', { hwnd: w.hwnd, action: 'focus' });
        return { ok: true, message: `Only ${label} is showing now.` };
      }
      if (action === 'new_window') {
        await ctx.bridge.call('window.action', { hwnd: w.hwnd, action: 'focus' });
        if (!ctx.settings.tools.permissions.automation) return { ok: false, message: 'Press Control N for a new window; I need the Automation permission to press keys for you.' };
        await ctx.bridge.call('keys.send', { spec: '^n' });
        return { ok: true, message: `Asked ${label} for a new window.` };
      }
      const args: Record<string, unknown> = { hwnd: w.hwnd, action };
      if (action === 'resize') { args.width = width ?? 1280; args.height = height ?? 800; }
      const r = await ctx.bridge.call<{ ok: boolean; monitors?: number }>('window.action', args);
      if (action === 'next_monitor' && r.monitors !== undefined && r.monitors < 2) return { ok: false, message: 'You only have one monitor connected.' };
      const done = ({ center: `Centered ${label}.`, resize: `Resized ${label} to ${args.width} by ${args.height}.`, topmost_on: `${label} will stay on top of other windows.`, topmost_off: `${label} no longer stays on top.`, next_monitor: `Moved ${label} to the next monitor.` } as Record<string, string>)[action];
      return { ok: r.ok, message: r.ok ? done : `Windows didn't let me change ${label}.` };
    },
  }),
  defineTool({
    name: 'windows.screenshot', title: 'Screenshot a window', description: 'Save a screenshot of one app window as a PNG in Documents\\Clickyy\\Screenshots.', category: 'Screen', risk: 1, permission: 'screen',
    input: z.object({ query: z.string().trim().max(80).optional() }).strict(), confirm: 'never', timeoutMs: 12000, offline: true,
    describe: ({ query }) => `Screenshot ${query ?? 'the current window'}`,
    async run({ query }, ctx) {
      const w = query ? (await windowsOf(ctx, resolveSafe(ctx, query)))[0] ?? await targetWindow(ctx, query) : await targetWindow(ctx, undefined);
      const label = w.process ?? w.title;
      await mkdir(outputDir('Screenshots'), { recursive: true });
      const path = uniquePath(outputDir('Screenshots'), `${label.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 40) || 'Window'} ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`, '.png');
      const r = await ctx.bridge.call<{ ok: boolean; width: number; height: number }>('window.capture', { hwnd: w.hwnd, path }, 10000);
      return { ok: r.ok, data: { path, ...r }, message: `Saved a screenshot of ${label} to Documents, Clickyy, Screenshots.`, detail: path };
    },
  }),
  defineTool({
    name: 'screen.save', title: 'Screenshot', description: 'Save a screenshot of the whole screen as a PNG in Documents\\Clickyy\\Screenshots.', category: 'Screen', risk: 1, permission: 'screen',
    input: z.object({}).strict(), confirm: 'never', timeoutMs: 12000, offline: true,
    describe: () => 'Take a screenshot of the whole screen',
    async run(_args, ctx) {
      const png = Buffer.from(await ctx.platform.captureScreen(), 'base64');
      await mkdir(outputDir('Screenshots'), { recursive: true });
      const path = uniquePath(outputDir('Screenshots'), `Screenshot ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`, '.png');
      await writeFile(path, png, { flag: 'wx' });
      return { ok: true, data: { path, bytes: png.length }, message: 'Saved a screenshot to Documents, Clickyy, Screenshots.', detail: path };
    },
  }),
  defineTool({
    name: 'app.audio', title: 'Mute one app', description: "Mute or unmute just one app's sound in the Windows volume mixer.", category: 'Audio', risk: 1, permission: 'media',
    input: z.object({ app: appName, mute: z.boolean() }).strict(), confirm: 'never', timeoutMs: 8000, offline: true,
    describe: ({ app, mute }) => `${mute ? 'Mute' : 'Unmute'} ${app}`,
    async run({ app, mute }, ctx) {
      const r = resolveApp(ctx, app);
      if (!r.process) return { ok: false, message: `I don't know which process ${r.name} uses.` };
      const res = await ctx.bridge.call<{ running: boolean; sessions: number }>('app.mute', { name: r.process, mute });
      if (!res.running) return { ok: false, message: `${r.name} isn't running.` };
      if (!res.sessions) return { ok: false, message: `${r.name} isn't playing any sound right now, so there's nothing in the mixer to ${mute ? 'mute' : 'unmute'}. Try again while it's playing.` };
      return { ok: true, message: `${r.name} is ${mute ? 'muted' : 'unmuted'}.` };
    },
  }),
];

function resolveSafe(ctx: ToolContext, query: string): Resolved {
  try { return resolveApp(ctx, query); } catch { return { name: query }; }
}

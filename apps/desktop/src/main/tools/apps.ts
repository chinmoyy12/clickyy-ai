import { z } from 'zod';
import { extname, isAbsolute } from 'node:path';
import type { AppEntry } from '@shared/types';
import { defineTool, type ToolContext, type ToolDef } from './types';
import type { WindowInfo } from '../windows/bridge';

const env = (k: string) => process.env[k] ?? '';

/** Well-known apps probed at startup. Only paths that exist are registered. */
export const KNOWN_APPS: Array<{ name: string; aliases: string[]; process: string; candidates: Array<{ kind: AppEntry['kind']; target: string }> }> = [
  { name: 'Google Chrome', aliases: ['chrome', 'google chrome', 'browser'], process: 'chrome', candidates: [
    { kind: 'exe', target: `${env('ProgramFiles')}\\Google\\Chrome\\Application\\chrome.exe` },
    { kind: 'exe', target: `${env('ProgramFiles(x86)')}\\Google\\Chrome\\Application\\chrome.exe` },
    { kind: 'exe', target: `${env('LOCALAPPDATA')}\\Google\\Chrome\\Application\\chrome.exe` } ] },
  { name: 'Microsoft Edge', aliases: ['edge', 'microsoft edge'], process: 'msedge', candidates: [
    { kind: 'exe', target: `${env('ProgramFiles(x86)')}\\Microsoft\\Edge\\Application\\msedge.exe` },
    { kind: 'exe', target: `${env('ProgramFiles')}\\Microsoft\\Edge\\Application\\msedge.exe` } ] },
  { name: 'Firefox', aliases: ['firefox', 'mozilla'], process: 'firefox', candidates: [{ kind: 'exe', target: `${env('ProgramFiles')}\\Mozilla Firefox\\firefox.exe` }] },
  { name: 'Brave', aliases: ['brave', 'brave browser'], process: 'brave', candidates: [
    { kind: 'exe', target: `${env('ProgramFiles')}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe` },
    { kind: 'exe', target: `${env('LOCALAPPDATA')}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe` } ] },
  { name: 'Opera', aliases: ['opera', 'opera browser', 'opera gx'], process: 'opera', candidates: [
    { kind: 'exe', target: `${env('LOCALAPPDATA')}\\Programs\\Opera\\opera.exe` },
    { kind: 'exe', target: `${env('LOCALAPPDATA')}\\Programs\\Opera GX\\opera.exe` } ] },
  { name: 'Visual Studio Code', aliases: ['vs code', 'vscode', 'visual studio code', 'code editor', 'my editor', 'editor'], process: 'Code', candidates: [
    { kind: 'exe', target: `${env('LOCALAPPDATA')}\\Programs\\Microsoft VS Code\\Code.exe` },
    { kind: 'exe', target: `${env('ProgramFiles')}\\Microsoft VS Code\\Code.exe` } ] },
  { name: 'Spotify', aliases: ['spotify', 'music'], process: 'Spotify', candidates: [
    { kind: 'exe', target: `${env('APPDATA')}\\Spotify\\Spotify.exe` },
    { kind: 'uri', target: 'spotify:' } ] },
  { name: 'Notepad', aliases: ['notepad', 'note pad', 'text editor'], process: 'Notepad', candidates: [{ kind: 'exe', target: `${env('SystemRoot')}\\System32\\notepad.exe` }] },
  { name: 'Calculator', aliases: ['calculator', 'calc'], process: 'CalculatorApp', candidates: [{ kind: 'uri', target: 'calculator:' }] },
  { name: 'Paint', aliases: ['paint', 'ms paint'], process: 'mspaint', candidates: [{ kind: 'exe', target: `${env('SystemRoot')}\\System32\\mspaint.exe` }] },
  { name: 'Terminal', aliases: ['terminal', 'windows terminal', 'command line'], process: 'WindowsTerminal', candidates: [{ kind: 'exe', target: `${env('LOCALAPPDATA')}\\Microsoft\\WindowsApps\\wt.exe` }] },
  { name: 'File Explorer', aliases: ['file explorer', 'explorer', 'files'], process: 'explorer', candidates: [{ kind: 'exe', target: `${env('SystemRoot')}\\explorer.exe` }] },
  { name: 'Microsoft Word', aliases: ['word', 'microsoft word'], process: 'WINWORD', candidates: [{ kind: 'exe', target: `${env('ProgramFiles')}\\Microsoft Office\\root\\Office16\\WINWORD.EXE` }] },
  { name: 'Microsoft Excel', aliases: ['excel', 'microsoft excel'], process: 'EXCEL', candidates: [{ kind: 'exe', target: `${env('ProgramFiles')}\\Microsoft Office\\root\\Office16\\EXCEL.EXE` }] },
  { name: 'PowerPoint', aliases: ['powerpoint', 'power point'], process: 'POWERPNT', candidates: [{ kind: 'exe', target: `${env('ProgramFiles')}\\Microsoft Office\\root\\Office16\\POWERPNT.EXE` }] },
  { name: 'Steam', aliases: ['steam'], process: 'steam', candidates: [{ kind: 'exe', target: `${env('ProgramFiles(x86)')}\\Steam\\steam.exe` }] },
  { name: 'Discord', aliases: ['discord'], process: 'Discord', candidates: [{ kind: 'uri', target: 'discord:' }] },
  { name: 'Camera', aliases: ['camera'], process: 'WindowsCamera', candidates: [{ kind: 'uri', target: 'microsoft.windows.camera:' }] },
  { name: 'Microsoft Store', aliases: ['store', 'microsoft store'], process: 'WinStore.App', candidates: [{ kind: 'uri', target: 'ms-windows-store:' }] },
  { name: 'Snipping Tool', aliases: ['snipping tool', 'screenshot tool'], process: 'SnippingTool', candidates: [{ kind: 'uri', target: 'ms-screenclip:' }] },
  { name: 'Clock', aliases: ['clock', 'alarms'], process: 'Time', candidates: [{ kind: 'uri', target: 'ms-clock:' }] },
];

/** URI schemes that may be stored as app targets. http(s)/file/javascript etc. are never accepted. */
const URI_SCHEME = /^(spotify|calculator|discord|microsoft\.windows\.camera|ms-windows-store|ms-screenclip|ms-clock|ms-photos|msteams|outlookmail|ms-todo|mailto|zoommtg|slack|steam):/i;

export function validateAppTarget(kind: AppEntry['kind'], target: string): string | null {
  if (kind === 'exe') {
    if (!isAbsolute(target) || extname(target).toLowerCase() !== '.exe') return 'Executable must be an absolute path to a .exe file';
    if (/[\0"<>|]/.test(target)) return 'Invalid characters in path';
    return null;
  }
  if (kind === 'uri') return URI_SCHEME.test(target) ? null : 'Only known application URI schemes are allowed';
  if (kind === 'appx') return isStartAppId(target) ? null : 'Invalid AppUserModelID';
  return 'Unknown kind';
}

/**
 * Start-menu app ids (AppUserModelIDs) as returned by Get-StartApps: packaged ids
 * ("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App") and desktop ids ("{GUID}\\App\\app.exe", "Chrome").
 * They are only ever launched through explorer's shell:AppsFolder, which opens registered apps only.
 */
export function isStartAppId(id: string): boolean {
  if (!id || id.length > 300 || id.includes('..') || /:\/\//.test(id) || /^[-/]/.test(id)) return false;
  return /^(?:[A-Za-z]:\\)?[A-Za-z0-9 ._{}\\()+&!,'#@~-]+$/.test(id);
}

/** Apps found in the Start menu at launch (not stored; refreshed every run). */
let startApps: AppEntry[] = [];

const JUNK_START = /\b(uninstall|uninstaller|readme|read me|release notes|license|documentation|help|manual|website|web site|changelog|what'?s new|support)\b/i;

export function setStartApps(list: Array<{ Name: string; AppID: string }>) {
  const seen = new Set<string>();
  startApps = list
    .filter((a) => a && typeof a.Name === 'string' && typeof a.AppID === 'string' && !JUNK_START.test(a.Name) && isStartAppId(a.AppID))
    .filter((a) => { const k = a.Name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 800)
    .map((a) => {
      const exe = a.AppID.match(/([^\\]+)\.exe$/i)?.[1];
      const short = a.Name.toLowerCase().replace(/\(.*?\)/g, '').replace(/\b(microsoft|app|desktop)\b/g, '').replace(/\s+/g, ' ').trim();
      return { id: `start:${a.AppID}`, name: a.Name.trim(), aliases: short && short !== a.Name.toLowerCase() ? [short] : [], kind: 'appx' as const, target: a.AppID, processName: exe, detected: true, enabled: true };
    });
}

export function startAppCount() { return startApps.length; }

/** The user's registry first, then Start-menu apps whose names aren't already registered. */
export function allApps(registry: AppEntry[]): AppEntry[] {
  const names = new Set(registry.map((a) => a.name.toLowerCase()));
  return [...registry, ...startApps.filter((a) => !names.has(a.name.toLowerCase()))];
}

export function detectApps(exists: (p: string) => boolean): Array<Omit<AppEntry, 'id'>> {
  const out: Array<Omit<AppEntry, 'id'>> = [];
  for (const app of KNOWN_APPS) {
    const hit = app.candidates.find((c) => c.kind !== 'exe' || exists(c.target));
    if (hit) out.push({ name: app.name, aliases: app.aliases, kind: hit.kind, target: hit.target, processName: app.process, detected: true, enabled: true });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+ ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function findApp(apps: AppEntry[], query: string, opts: { exactOnly?: boolean } = {}): { match?: AppEntry; candidates: AppEntry[] } {
  const q = norm(query).replace(/^(the|my) /, '');
  const enabled = apps.filter((a) => a.enabled);
  const exact = enabled.filter((a) => norm(a.name) === q || a.aliases.some((al) => norm(al) === q));
  // The user's own registry wins over Start-menu duplicates ("Spotify" vs "Spotify (Start)").
  const registered = exact.filter((a) => !a.id.startsWith('start:'));
  if (registered.length === 1) return { match: registered[0], candidates: registered };
  if (exact.length === 1) return { match: exact[0], candidates: exact };
  if (exact.length > 1) return { candidates: exact };
  if (opts.exactOnly) return { candidates: [] };
  const partial = enabled.filter((a) => norm(a.name).includes(q) || a.aliases.some((al) => norm(al).includes(q) || (q.length >= 4 && q.includes(norm(al)))));
  if (partial.length) return partial.length === 1 ? { match: partial[0], candidates: partial } : { candidates: partial };
  // Fuzzy fallback for mishearings ("spotfy", "crome", "note pat"): closest name within a small edit distance.
  if (q.length >= 4) {
    const limit = q.length >= 7 ? 2 : 1;
    const scored = enabled
      .map((a) => ({ a, d: Math.min(...[a.name, ...a.aliases].map((n) => editDistance(norm(n), q))) }))
      .filter((x) => x.d <= limit)
      .sort((x, y) => x.d - y.d);
    if (scored.length && (scored.length === 1 || scored[0].d < scored[1].d)) return { match: scored[0].a, candidates: [scored[0].a] };
    return { candidates: scored.map((x) => x.a) };
  }
  return { candidates: [] };
}

export function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

const CATEGORY_PROCESSES: Record<string, string[]> = {
  browser: ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi'],
  'web browser': ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi'],
  editor: ['code', 'devenv', 'notepad++', 'sublime_text', 'idea64', 'cursor'],
  'code editor': ['code', 'devenv', 'notepad++', 'sublime_text', 'idea64', 'cursor'],
  terminal: ['windowsterminal', 'powershell', 'cmd', 'pwsh'],
  music: ['spotify', 'music.ui', 'vlc'],
  explorer: ['explorer'],
};

export function matchWindow(windows: WindowInfo[], query: string, apps: AppEntry[] = []): WindowInfo[] {
  const q = norm(query).replace(/^(the|my) /, '');
  const procs = CATEGORY_PROCESSES[q];
  if (procs) return windows.filter((w) => w.process && procs.includes(w.process.toLowerCase()));
  const app = findApp(apps, q).match;
  if (app?.processName) {
    const byProc = windows.filter((w) => w.process?.toLowerCase() === app.processName!.toLowerCase());
    if (byProc.length) return byProc;
  }
  return windows.filter((w) => norm(w.title).includes(q) || (w.process && norm(w.process) === q));
}

async function waitForWindow(ctx: ToolContext, processName: string | undefined, before: Set<number>, timeoutMs = 6000): Promise<WindowInfo | null> {
  if (!processName) return null;
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && !ctx.signal.aborted) {
    const wins = await ctx.bridge.call<WindowInfo[]>('window.list').catch(() => []);
    const hit = wins.find((w) => w.process?.toLowerCase() === processName.toLowerCase() && !before.has(w.hwnd)) ??
      wins.find((w) => w.process?.toLowerCase() === processName.toLowerCase());
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

export async function targetWindow(ctx: ToolContext, query: string | undefined): Promise<WindowInfo> {
  if (!query || /^(this|current|it|that)( window)?$/i.test(query.trim())) {
    if (query && /^(it|that)$/i.test(query.trim()) && ctx.session.lastWindow) return { ...ctx.session.lastWindow, pid: 0, process: null, minimized: false, maximized: false };
    const fg = await ctx.bridge.call<WindowInfo | null>('window.foreground');
    if (!fg) throw new Error("I can't tell which window is in front.");
    if (/clickyy/i.test(fg.title)) throw new Error("The front window is me. Tell me which app you mean.");
    return fg;
  }
  const wins = await ctx.bridge.call<WindowInfo[]>('window.list');
  const matches = matchWindow(wins, query, allApps(ctx.repos.apps.list()));
  if (matches.length === 0) throw new Error(`I don't see an open window for ${query}.`);
  return matches[0];
}

const windowQuery = z.string().trim().max(80).optional();

export const appTools: ToolDef[] = [
  defineTool({
    name: 'apps.open', title: 'Open app', description: 'Open an application from the approved app registry by name or alias.', category: 'Apps', risk: 1, permission: 'apps',
    input: z.object({ app: z.string().trim().min(1).max(80) }).strict(), confirm: 'never', timeoutMs: 12000, offline: true,
    describe: ({ app }) => `Open ${app}`,
    async run({ app }, ctx) {
      const { match, candidates } = findApp(allApps(ctx.repos.apps.list()), app);
      if (!match) {
        if (candidates.length > 1) return { ok: false, message: `Did you mean ${candidates.slice(0, 3).map((c) => c.name).join(' or ')}?` };
        return { ok: false, message: `${app} isn't in my approved apps list. You can add it in Settings, Apps.` };
      }
      const problem = validateAppTarget(match.kind, match.target);
      if (problem) return { ok: false, message: `${match.name} has an invalid launch target: ${problem}.` };
      const before = new Set((await ctx.bridge.call<WindowInfo[]>('window.list').catch(() => [])).map((w) => w.hwnd));
      if (match.kind === 'exe') {
        if (!ctx.platform.fileExists(match.target)) return { ok: false, message: `I can't find ${match.name} at its saved location anymore.` };
        await ctx.platform.spawnDetached(match.target, []);
      } else if (match.kind === 'uri') {
        await ctx.platform.openExternal(match.target);
      } else {
        await ctx.platform.spawnDetached(`${process.env.SystemRoot ?? 'C:\\Windows'}\\explorer.exe`, [`shell:AppsFolder\\${match.target}`]);
      }
      ctx.session.lastApp = { id: match.id, name: match.name, processName: match.processName };
      const win = await waitForWindow(ctx, match.processName, before);
      if (win) {
        ctx.session.lastWindow = { hwnd: win.hwnd, title: win.title };
        return { ok: true, data: { verified: true, window: win.title }, message: `${match.name} is open.` };
      }
      return { ok: true, data: { verified: false }, message: `I started ${match.name}, but I can't see its window yet.` };
    },
  }),
  defineTool({
    name: 'windows.list', title: 'List open windows', description: 'List the open application windows.', category: 'Windows', risk: 1, permission: 'windows',
    input: z.object({}).strict(), confirm: 'never', timeoutMs: 5000, offline: true,
    describe: () => 'List open windows',
    async run(_i, ctx) {
      const wins = (await ctx.bridge.call<WindowInfo[]>('window.list')).filter((w) => !/clickyy/i.test(w.title));
      const names = [...new Set(wins.map((w) => w.process ?? w.title))];
      return { ok: true, data: wins, message: names.length ? `You have ${names.length} apps open: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ', and more' : ''}.` : "I don't see any open app windows.", detail: wins.map((w) => `${w.process ?? '?'} — ${w.title}`).join('\n') };
    },
  }),
  defineTool({
    name: 'windows.focus', title: 'Switch to window', description: 'Bring a window to the front. Query can be an app name, a title fragment, or a category like browser, editor, terminal, music.', category: 'Windows', risk: 1, permission: 'windows',
    input: z.object({ query: z.string().trim().min(1).max(80) }).strict(), confirm: 'never', timeoutMs: 6000, offline: true,
    describe: ({ query }) => `Switch to ${query}`,
    async run({ query }, ctx) {
      const w = await targetWindow(ctx, query);
      const r = await ctx.bridge.call<{ ok: boolean }>('window.action', { hwnd: w.hwnd, action: 'focus' });
      ctx.session.lastWindow = { hwnd: w.hwnd, title: w.title };
      return { ok: r.ok, message: r.ok ? `Switched to ${w.process ?? w.title}.` : `Windows didn't let me bring ${w.process ?? w.title} to the front. Its taskbar button may be flashing.` };
    },
  }),
  defineTool({
    name: 'windows.arrange', title: 'Arrange window', description: 'Minimize, maximize, restore, or snap a window left/right. Omit query for the current window.', category: 'Windows', risk: 1, permission: 'windows',
    input: z.object({ action: z.enum(['minimize', 'maximize', 'restore', 'snap_left', 'snap_right']), query: windowQuery }).strict(), confirm: 'never', timeoutMs: 6000, offline: true,
    describe: ({ action, query }) => `${action.replace('_', ' ')} ${query ?? 'the current window'}`,
    async run({ action, query }, ctx) {
      const w = await targetWindow(ctx, query);
      const r = await ctx.bridge.call<{ ok: boolean }>('window.action', { hwnd: w.hwnd, action });
      ctx.session.lastWindow = { hwnd: w.hwnd, title: w.title };
      const verb = { minimize: 'Minimized', maximize: 'Maximized', restore: 'Restored', snap_left: 'Moved to the left half:', snap_right: 'Moved to the right half:' }[action];
      return { ok: r.ok, message: r.ok ? `${verb} ${w.process ?? w.title}.` : `That didn't work for ${w.process ?? w.title}.` };
    },
  }),
  defineTool({
    name: 'windows.close', title: 'Close window', description: 'Ask a window to close (the app may prompt to save). Omit query for the current window.', category: 'Windows', risk: 2, permission: 'windows',
    input: z.object({ query: windowQuery }).strict(), confirm: 'always', timeoutMs: 60000, offline: true,
    confirmLabel: () => 'Close the window',
    describe: async ({ query }, ctx) => {
      const w = await targetWindow(ctx, query);
      return `Close "${w.title}" (${w.process ?? 'unknown app'}). If it has unsaved work, the app will ask you.`;
    },
    async run({ query }, ctx) {
      const w = await targetWindow(ctx, query);
      const r = await ctx.bridge.call<{ ok: boolean }>('window.action', { hwnd: w.hwnd, action: 'close' });
      return { ok: r.ok, message: r.ok ? `Asked ${w.process ?? 'the window'} to close.` : "The window didn't accept the close request." };
    },
  }),
  defineTool({
    name: 'windows.previous', title: 'Previous window', description: 'Switch to the window that was in front before the current one.', category: 'Windows', risk: 1, permission: 'windows',
    input: z.object({}).strict(), confirm: 'never', timeoutMs: 6000, offline: true,
    describe: () => 'Switch to the previous window',
    async run(_i, ctx) {
      // EnumWindows returns top-level windows in Z-order; skip Clickyy and the current foreground window.
      const fg = await ctx.bridge.call<WindowInfo | null>('window.foreground');
      const wins = (await ctx.bridge.call<WindowInfo[]>('window.list')).filter((w) => !w.minimized && w.hwnd !== fg?.hwnd && !/clickyy/i.test(w.title));
      const target = wins[0];
      if (!target) return { ok: false, message: "I don't see another window to switch to." };
      const r = await ctx.bridge.call<{ ok: boolean }>('window.action', { hwnd: target.hwnd, action: 'focus' });
      ctx.session.lastWindow = { hwnd: target.hwnd, title: target.title };
      return { ok: r.ok, message: r.ok ? `Back to ${target.process ?? target.title}.` : "Windows didn't let me switch windows." };
    },
  }),
  defineTool({
    name: 'windows.show_desktop', title: 'Minimize all', description: 'Minimize all windows, or undo it.', category: 'Windows', risk: 1, permission: 'windows',
    input: z.object({ undo: z.boolean().default(false) }).strict(), confirm: 'never', timeoutMs: 5000, offline: true,
    describe: ({ undo }) => (undo ? 'Restore all windows' : 'Minimize all windows'),
    async run({ undo }, ctx) {
      await ctx.bridge.call(undo ? 'window.restoreAll' : 'window.minimizeAll');
      return { ok: true, message: undo ? 'Restored your windows.' : 'Everything is minimized.' };
    },
  }),
];

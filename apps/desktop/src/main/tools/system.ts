import { z } from 'zod';
import os from 'node:os';
import { statfs } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { defineTool, type ToolDef } from './types';
import { settingsUri, SETTINGS_PAGE_IDS } from '../security/url';

const none = z.object({}).strict();
const SYSTEM32 = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32`;

function fmtDuration(sec: number): string {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  const parts = [d && `${d} day${d > 1 ? 's' : ''}`, h && `${h} hour${h > 1 ? 's' : ''}`, `${m} minute${m === 1 ? '' : 's'}`].filter(Boolean);
  return parts.slice(0, 2).join(' and ');
}

async function cpuPercent(sampleMs = 400): Promise<number> {
  const snap = () => os.cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
  const a = snap();
  await new Promise((r) => setTimeout(r, sampleMs));
  const b = snap();
  let idle = 0, total = 0;
  b.forEach((x, i) => { idle += x.idle - a[i].idle; total += x.total - a[i].total; });
  return total ? Math.round(100 * (1 - idle / total)) : 0;
}

function wifiStatus(): Promise<{ connected: boolean; ssid?: string; signal?: string } | null> {
  return new Promise((resolve) => {
    execFile(`${SYSTEM32}\\netsh.exe`, ['wlan', 'show', 'interfaces'], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      if (err) return resolve(null);
      const field = (name: string) => stdout.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'mi'))?.[1]?.trim();
      const state = field('State');
      if (!state) return resolve(null);
      resolve({ connected: /^connected/i.test(state), ssid: field('SSID'), signal: field('Signal') });
    });
  });
}

export const systemTools: ToolDef[] = [
  defineTool({
    name: 'system.time', title: 'Current time', description: 'Get the current local date and time.', category: 'System', risk: 1, permission: null,
    input: none, confirm: 'never', timeoutMs: 1000, offline: true,
    describe: () => 'Read the clock',
    async run() {
      const now = new Date();
      const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      return { ok: true, data: { iso: now.toISOString(), time, date }, message: `It's ${time} on ${date}.` };
    },
  }),
  defineTool({
    name: 'system.battery', title: 'Battery status', description: 'Get battery percentage and charging state.', category: 'System', risk: 1, permission: 'system',
    input: none, confirm: 'never', timeoutMs: 5000, offline: true,
    describe: () => 'Read battery status',
    async run(_i, ctx) {
      const p = await ctx.bridge.call<{ percent: number; charging: boolean; status: string; remainingSec: number }>('power.status');
      if (p.status === 'NoSystemBattery' || p.percent > 100 || p.percent < 0) return { ok: true, data: p, message: "This PC doesn't report a battery. It's running on mains power." };
      const remaining = p.remainingSec > 0 && !p.charging ? `, about ${fmtDuration(p.remainingSec)} left` : '';
      return { ok: true, data: p, message: `Battery is at ${p.percent} percent${p.charging ? ' and charging' : ', not charging'}${remaining}.` };
    },
  }),
  defineTool({
    name: 'system.resources', title: 'CPU and memory', description: 'Measure current CPU and RAM usage.', category: 'System', risk: 1, permission: 'system',
    input: z.object({ focus: z.enum(['cpu', 'memory', 'both']).default('both') }).strict(), confirm: 'never', timeoutMs: 3000, offline: true,
    describe: () => 'Measure CPU and memory usage',
    async run({ focus }) {
      const cpu = await cpuPercent();
      const totalGB = os.totalmem() / 1024 ** 3, freeGB = os.freemem() / 1024 ** 3;
      const used = totalGB - freeGB, memPct = Math.round((used / totalGB) * 100);
      const cpuText = `CPU is at ${cpu} percent`;
      const memText = `${used.toFixed(1)} of ${totalGB.toFixed(1)} gigabytes of RAM are in use, that's ${memPct} percent`;
      const message = focus === 'cpu' ? `${cpuText}.` : focus === 'memory' ? `${memText[0].toUpperCase()}${memText.slice(1)}.` : `${cpuText}, and ${memText}.`;
      return { ok: true, data: { cpu, memPct, usedGB: +used.toFixed(2), totalGB: +totalGB.toFixed(2) }, message };
    },
  }),
  defineTool({
    name: 'system.disk', title: 'Disk space', description: 'Report free disk space on a drive.', category: 'System', risk: 1, permission: 'system',
    input: z.object({ drive: z.string().regex(/^[A-Za-z]$/).default('C') }).strict(), confirm: 'never', timeoutMs: 3000, offline: true,
    describe: ({ drive }) => `Read free space on drive ${drive}`,
    async run({ drive }) {
      const s = await statfs(`${drive.toUpperCase()}:\\`);
      const free = (s.bavail * s.bsize) / 1024 ** 3, total = (s.blocks * s.bsize) / 1024 ** 3;
      return { ok: true, data: { freeGB: +free.toFixed(1), totalGB: +total.toFixed(1) }, message: `Drive ${drive.toUpperCase()} has ${Math.round(free)} gigabytes free out of ${Math.round(total)}.` };
    },
  }),
  defineTool({
    name: 'system.network', title: 'Network status', description: 'Report internet connectivity and Wi-Fi status.', category: 'System', risk: 1, permission: 'system',
    input: none, confirm: 'never', timeoutMs: 6000, offline: true,
    describe: () => 'Read network status',
    async run(_i, ctx) {
      const wifi = await wifiStatus();
      const online = ctx.platform.isOnline();
      const wifiText = wifi?.connected ? `You're on Wi-Fi${wifi.ssid ? `, ${wifi.ssid}` : ''}${wifi.signal ? ` at ${wifi.signal} signal` : ''}.` : wifi ? 'Wi-Fi is not connected.' : '';
      return {
        ok: true,
        data: { online, wifi },
        message: `${online ? 'Windows reports an active network connection.' : 'Windows reports no network connection.'} ${wifiText}`.trim(),
      };
    },
  }),
  defineTool({
    name: 'system.uptime', title: 'System uptime', description: 'How long the computer has been running.', category: 'System', risk: 1, permission: 'system',
    input: none, confirm: 'never', timeoutMs: 1000, offline: true,
    describe: () => 'Read uptime',
    async run() {
      const sec = os.uptime();
      return { ok: true, data: { seconds: sec }, message: `Your PC has been up for ${fmtDuration(sec)}.` };
    },
  }),
  defineTool({
    name: 'system.audio_devices', title: 'Audio devices', description: 'Name the default speaker and microphone.', category: 'System', risk: 1, permission: 'system',
    input: none, confirm: 'never', timeoutMs: 5000, offline: true,
    describe: () => 'Read default audio devices',
    async run(_i, ctx) {
      const d = await ctx.bridge.call<{ output: string | null; input: string | null }>('audio.devices');
      return { ok: true, data: d, message: `Sound is playing through ${d.output ?? 'an unknown device'}, and the default microphone is ${d.input ?? 'not available'}.` };
    },
  }),
  defineTool({
    name: 'system.processes', title: 'Top processes', description: 'List the processes using the most memory (read-only).', category: 'System', risk: 1, permission: 'system',
    input: z.object({ limit: z.number().int().min(1).max(30).default(8) }).strict(), confirm: 'never', timeoutMs: 8000, offline: true,
    describe: () => 'List running processes',
    async run({ limit }, ctx) {
      const list = await ctx.bridge.call<Array<{ name: string; pid: number; memMB: number }>>('process.top', { limit });
      const top = list.slice(0, 3).map((p) => p.name).join(', ');
      return { ok: true, data: list, message: `The biggest memory users right now are ${top}.`, detail: list.map((p) => `${p.name} (PID ${p.pid}) — ${p.memMB} MB`).join('\n') };
    },
  }),
  defineTool({
    name: 'system.open_settings', title: 'Open Windows Settings', description: `Open a Windows Settings page. Pages: ${SETTINGS_PAGE_IDS.join(', ')}.`, category: 'System', risk: 1, permission: 'system',
    input: z.object({ page: z.enum(SETTINGS_PAGE_IDS as [string, ...string[]]).default('home') }).strict(), confirm: 'never', timeoutMs: 5000, offline: true,
    describe: ({ page }) => `Open Settings (${page})`,
    async run({ page }, ctx) {
      await ctx.platform.openExternal(settingsUri(page));
      return { ok: true, message: page === 'home' ? 'Opening Settings.' : `Opening ${page} settings.` };
    },
  }),
  defineTool({
    name: 'system.task_manager', title: 'Open Task Manager', description: 'Open Windows Task Manager.', category: 'System', risk: 1, permission: 'system',
    input: none, confirm: 'never', timeoutMs: 5000, offline: true,
    describe: () => 'Open Task Manager',
    async run(_i, ctx) {
      await ctx.platform.spawnDetached(`${SYSTEM32}\\Taskmgr.exe`, []);
      return { ok: true, message: 'Opening Task Manager.' };
    },
  }),
  defineTool({
    name: 'system.open_folder', title: 'Open folder', description: 'Open a standard user folder in File Explorer: home, desktop, documents, downloads, pictures, music, videos, workspace.', category: 'System', risk: 1, permission: 'system',
    input: z.object({ folder: z.enum(['home', 'desktop', 'documents', 'downloads', 'pictures', 'music', 'videos', 'workspace']).default('home') }).strict(), confirm: 'never', timeoutMs: 5000, offline: true,
    describe: ({ folder }) => `Open your ${folder} folder`,
    async run({ folder }, ctx) {
      const home = os.homedir();
      const map: Record<string, string> = { home, desktop: `${home}\\Desktop`, documents: `${home}\\Documents`, downloads: `${home}\\Downloads`, pictures: `${home}\\Pictures`, music: `${home}\\Music`, videos: `${home}\\Videos`, workspace: ctx.settings.tools.workspaceFolder };
      const target = map[folder];
      if (!target) return { ok: false, message: "You haven't set a workspace folder yet. You can pick one in Settings, Permissions." };
      if (!ctx.platform.fileExists(target)) return { ok: false, message: `I can't find your ${folder} folder.` };
      const err = await ctx.platform.openPath(target);
      return err ? { ok: false, message: `Explorer couldn't open it: ${err}` } : { ok: true, message: `Opening ${folder === 'home' ? 'your home folder' : folder}.` };
    },
  }),
  defineTool({
    name: 'system.lock', title: 'Lock the PC', description: 'Lock the Windows session (documented LockWorkStation API).', category: 'System', risk: 1, permission: 'system',
    input: none, confirm: 'never', timeoutMs: 5000, offline: true,
    describe: () => 'Lock this computer',
    async run(_i, ctx) {
      const r = await ctx.bridge.call<{ ok: boolean }>('session.lock');
      return { ok: r.ok, message: r.ok ? 'Locking your PC.' : "Windows didn't let me lock the session." };
    },
  }),
  defineTool({
    name: 'power.action', title: 'Shut down / restart / sign out', description: 'Shut down, restart, or sign out of Windows. Shutdown and restart use a 30 second countdown that can be aborted.', category: 'Power', risk: 3, permission: 'power',
    input: z.object({ action: z.enum(['shutdown', 'restart', 'signout']) }).strict(), confirm: 'always', timeoutMs: 8000, offline: true,
    confirmLabel: ({ action }) => (action === 'shutdown' ? 'Shut down in 30 seconds' : action === 'restart' ? 'Restart in 30 seconds' : 'Sign out now'),
    describe: ({ action }) =>
      action === 'signout' ? 'Sign out of Windows now. Unsaved work in open apps may be lost.' : `${action === 'shutdown' ? 'Shut down' : 'Restart'} this PC in 30 seconds. Unsaved work in open apps may be lost. You can say "cancel shutdown" during the countdown.`,
    async run({ action }, ctx) {
      const args = action === 'shutdown' ? ['/s', '/t', '30'] : action === 'restart' ? ['/r', '/t', '30'] : ['/l'];
      await ctx.platform.spawnDetached(`${SYSTEM32}\\shutdown.exe`, args);
      return { ok: true, message: action === 'signout' ? 'Signing you out.' : `${action === 'shutdown' ? 'Shutting down' : 'Restarting'} in 30 seconds. Say cancel shutdown to stop it.` };
    },
  }),
  defineTool({
    name: 'power.abort', title: 'Cancel shutdown', description: 'Abort a pending shutdown or restart.', category: 'Power', risk: 1, permission: null,
    input: none, confirm: 'never', timeoutMs: 5000, offline: true,
    describe: () => 'Cancel the pending shutdown',
    async run(_i, ctx) {
      await ctx.platform.spawnDetached(`${SYSTEM32}\\shutdown.exe`, ['/a']);
      return { ok: true, message: "I've asked Windows to cancel the pending shutdown." };
    },
  }),
];

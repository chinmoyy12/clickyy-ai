import { z } from 'zod';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { defineTool, type ToolContext, type ToolDef } from './types';
import { settingsUri } from '../security/url';
import { FEATURES, FEATURE_BY_ID, type Feature } from '../assistant/knowledge/features';
import { METRIC_IDS, METRIC_LABEL, type MetricId } from '../assistant/knowledge/metrics';
import { SETTINGS_BY_ID } from '../assistant/knowledge/windows';
import { buildXlsx } from './xlsx';
import { outputDir, userFolder, writeNew } from './output';
import { spokenDuration } from './productivity';
import { procInfo } from './appctl';

const SYSTEM32 = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32`;
const HIGH_PERF = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';

function powercfg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(`${SYSTEM32}\\powercfg.exe`, args, { windowsHide: true, timeout: 8000 }, (err, out) => (err ? reject(err) : resolve(out))));
}

async function processRunning(ctx: ToolContext, name: string): Promise<boolean> {
  return (await procInfo(ctx, name).catch(() => [])).length > 0;
}

async function featureState(f: Feature, ctx: ToolContext): Promise<boolean | null> {
  const m = f.mechanism;
  if (m.kind === 'radio') { const r = await ctx.bridge.call<{ present: boolean; on?: boolean }>('radio.get', { kind: m.radio }); return r.present ? !!r.on : null; }
  if (m.kind === 'reg') { const { on } = await ctx.bridge.call<{ on: boolean }>('feature.get', { feature: m.feature }); return m.invert ? !on : on; }
  if (m.kind === 'process') return processRunning(ctx, m.process);
  if (m.kind === 'plan') return /8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c/i.test(await powercfg(['/getactivescheme']).catch(() => ''));
  return null;
}

const pageName = (id: string) => SETTINGS_BY_ID.get(id)?.names[0] ?? id;

export const controlTools: ToolDef[] = [
  defineTool({
    name: 'system.feature', title: 'Switch a Windows feature',
    description: `Turn a Windows feature on or off, toggle it, check it, reset it to the Windows default, or open its settings page. Switches directly where Windows allows it (Wi-Fi, Bluetooth, dark/light mode, taskbar auto-hide, file extensions, hidden files, clipboard history, sticky keys, filter keys, Narrator, Magnifier, live captions, high-performance power plan, Storage Sense); otherwise opens the right Settings page. Features: ${FEATURES.map((f) => f.id).join(', ')}.`,
    category: 'System', risk: 1, permission: 'system',
    input: z.object({ feature: z.enum(FEATURES.map((f) => f.id) as [string, ...string[]]), action: z.enum(['on', 'off', 'toggle', 'status', 'reset', 'settings']) }).strict(),
    // Turning Wi-Fi off cuts the internet connection, so it's confirmed.
    confirm: (({ feature, action }: { feature: string; action: string }) => feature === 'wifi' && (action === 'off' || action === 'toggle')) as never,
    confirmLabel: () => 'Turn off Wi-Fi',
    timeoutMs: 15000, offline: true,
    describe: ({ feature, action }) => `${action === 'status' ? 'Check' : action === 'settings' ? 'Open settings for' : `Turn ${action}`} ${FEATURE_BY_ID.get(feature)?.label ?? feature}${feature === 'wifi' && action !== 'status' && action !== 'settings' ? '. This disconnects you from the internet until you turn it back on.' : ''}`,
    async run({ feature, action }, ctx) {
      const f = FEATURE_BY_ID.get(feature)!;
      const m = f.mechanism;
      const openPage = async (lead: string) => {
        await ctx.platform.openExternal(settingsUri(f.page));
        return { ok: true, data: { opened: f.page }, message: `${lead}I've opened ${pageName(f.page)} settings${m.kind === 'settings' ? ` where you can switch ${f.label} yourself` : ''}.` };
      };
      if (action === 'settings') return openPage('');
      if (m.kind === 'settings') {
        if (action === 'status') return openPage(`I can't read ${f.label} directly: ${m.why}. `);
        return openPage(`I can't ${action === 'reset' ? 'reset' : 'switch'} ${f.label} for you: ${m.why}. `);
      }
      const current = await featureState(f, ctx);
      if (current === null && m.kind === 'radio') return { ok: false, message: `This PC doesn't report a ${f.label} radio.` };
      if (action === 'status') return { ok: true, data: { on: current }, message: `${f.label} is ${current ? 'on' : 'off'}.` };
      const want = action === 'toggle' ? !current : action === 'reset' ? f.defaultOn : action === 'on';
      if (current === want) return { ok: true, data: { on: want, changed: false }, message: `${f.label} is already ${want ? 'on' : 'off'}${action === 'reset' ? ', which is the Windows default' : ''}.` };
      if (m.kind === 'radio') {
        const r = await ctx.bridge.call<{ present: boolean; result?: string; on?: boolean }>('radio.set', { kind: m.radio, on: want }, 15000);
        if (r.result && r.result !== 'Allowed') return openPage(`Windows didn't let me switch ${f.label} (${r.result}). `);
        return { ok: r.on === want, data: { on: r.on }, message: r.on === want ? `${f.label} is ${want ? 'on' : 'off'}.` : `I asked Windows to turn ${f.label} ${want ? 'on' : 'off'}, but it's still ${r.on ? 'on' : 'off'}.` };
      }
      if (m.kind === 'reg') {
        const { on } = await ctx.bridge.call<{ on: boolean }>('feature.set', { feature: m.feature, on: m.invert ? !want : want });
        const now = m.invert ? !on : on;
        const note = m.feature === 'file_extensions' || m.feature === 'hidden_files' ? ' Refresh any open File Explorer windows to see the change.' : m.feature === 'dark_mode' ? ' Some apps switch the next time they start.' : '';
        return { ok: now === want, data: { on: now }, message: `${f.label} is ${now ? 'on' : 'off'}.${note}` };
      }
      if (m.kind === 'process') {
        if (want) {
          const exe = `${SYSTEM32}\\${m.exe}`;
          if (!ctx.platform.fileExists(exe)) return openPage(`${f.label} isn't installed on this version of Windows. `);
          await ctx.platform.spawnDetached(exe, []);
          return { ok: true, data: { on: true }, message: `${f.label} is starting.` };
        }
        const r = await ctx.bridge.call<{ stopped: number; remaining: number }>('process.stop', { name: m.process });
        return { ok: r.remaining === 0, data: { on: r.remaining > 0 }, message: r.remaining === 0 ? `${f.label} is off.` : `${f.label} is still running.` };
      }
      // Power plan: High performance when on, Balanced when off.
      try {
        await powercfg(['/setactive', want ? HIGH_PERF : BALANCED]);
      } catch {
        return openPage(`This PC doesn't offer the ${want ? 'High performance' : 'Balanced'} power plan (many newer laptops only have power modes). `);
      }
      return { ok: true, data: { on: want }, message: want ? 'Switched to the High performance power plan. It uses more battery.' : 'Switched back to the Balanced power plan.' };
    },
  }),
  defineTool({
    name: 'display.brightness', title: 'Screen brightness', description: 'Read the built-in screen brightness, or set it to a percentage (or change it by a relative amount). External monitors usually need their own buttons.', category: 'System', risk: 1, permission: 'system',
    input: z.object({ level: z.number().int().min(0).max(100).optional(), delta: z.number().int().min(-100).max(100).optional() }).strict(), confirm: 'never', timeoutMs: 8000, offline: true,
    describe: ({ level, delta }) => (level !== undefined ? `Set brightness to ${level}%` : delta !== undefined ? `Change brightness by ${delta}` : 'Read the screen brightness'),
    async run({ level, delta }, ctx) {
      const cur = await ctx.bridge.call<{ supported: boolean; level?: number }>('brightness.get');
      if (!cur.supported) return { ok: false, message: "This display doesn't let Windows change its brightness. External monitors usually have their own brightness buttons." };
      if (level === undefined && delta === undefined) return { ok: true, data: cur, message: `Screen brightness is ${cur.level} percent.` };
      const target = Math.max(0, Math.min(100, level ?? (cur.level ?? 50) + (delta ?? 0)));
      const r = await ctx.bridge.call<{ supported: boolean; level?: number }>('brightness.set', { level: target });
      return { ok: r.supported, data: r, message: `Brightness is now ${r.level ?? target} percent.` };
    },
  }),
  defineTool({
    name: 'audio.mic_level', title: 'Microphone level', description: 'Read or set the default microphone input level (sensitivity) as a percentage.', category: 'Audio', risk: 1, permission: 'media',
    input: z.object({ level: z.number().int().min(0).max(100).optional() }).strict(), confirm: 'never', timeoutMs: 5000, offline: true,
    describe: ({ level }) => (level === undefined ? 'Read the microphone level' : `Set the microphone level to ${level}%`),
    async run({ level }, ctx) {
      const r = await ctx.bridge.call<{ level: number; muted: boolean }>(level === undefined ? 'mic.get' : 'mic.set', level === undefined ? {} : { level });
      return { ok: true, data: r, message: `Your microphone input level is ${r.level} percent${r.muted ? ', and it is muted in Windows' : ''}.` };
    },
  }),
  defineTool({
    name: 'power.now', title: 'Sleep, hibernate or screen off', description: 'Put the PC to sleep, hibernate it, or turn the screen off without sleeping. Open apps stay as they are.', category: 'Power', risk: 2, permission: 'power',
    input: z.object({ action: z.enum(['sleep', 'hibernate', 'display_off']) }).strict(),
    confirm: (({ action }: { action: string }) => action !== 'display_off') as never,
    confirmLabel: ({ action }) => (action === 'sleep' ? 'Sleep now' : action === 'hibernate' ? 'Hibernate now' : 'Turn the screen off'),
    timeoutMs: 15000, offline: true,
    describe: ({ action }) => (action === 'display_off' ? 'Turn the screen off (move the mouse to wake it).' : `${action === 'sleep' ? 'Put this PC to sleep' : 'Hibernate this PC'} now. Your open apps stay open.`),
    async run({ action }, ctx) {
      if (action === 'display_off') { await ctx.bridge.call('display.off'); return { ok: true, message: 'Screen off. Move the mouse or press a key to wake it.' }; }
      // Reply first; the call returns after the PC wakes up again.
      setTimeout(() => void ctx.bridge.call('power.suspend', { hibernate: action === 'hibernate' }, 60000).catch(() => undefined), 1500);
      return { ok: true, message: action === 'sleep' ? 'Going to sleep now.' : 'Hibernating now. If hibernation is turned off on this PC, nothing will happen.' };
    },
  }),
  defineTool({
    name: 'power.schedule', title: 'Power action after a delay', description: 'Lock, sleep, hibernate, turn the screen off, shut down, restart or sign out after a number of minutes. Shutdown and restart are handed to Windows; the others run while Clickyy is open.', category: 'Power', risk: 3, permission: 'power',
    input: z.object({ action: z.enum(['lock', 'sleep', 'hibernate', 'display_off', 'shutdown', 'restart', 'signout']), minutes: z.number().min(0.5).max(24 * 60) }).strict(),
    confirm: (({ action }: { action: string }) => !['lock', 'display_off'].includes(action)) as never,
    confirmLabel: ({ action, minutes }) => `${action.replace('_', ' ')} in ${spokenDuration(Math.round(minutes * 60))}`,
    timeoutMs: 8000, offline: true,
    describe: ({ action, minutes }) => `${({ lock: 'Lock', sleep: 'Sleep', hibernate: 'Hibernate', display_off: 'Turn the screen off', shutdown: 'Shut down', restart: 'Restart', signout: 'Sign out' } as Record<string, string>)[action]} in ${spokenDuration(Math.round(minutes * 60))}.${['shutdown', 'restart', 'signout'].includes(action) ? ' Unsaved work in open apps may be lost.' : ''}`,
    async run({ action, minutes }, ctx) {
      const secs = Math.round(minutes * 60);
      const when = spokenDuration(secs);
      if (action === 'shutdown' || action === 'restart') {
        await ctx.platform.spawnDetached(`${SYSTEM32}\\shutdown.exe`, [action === 'shutdown' ? '/s' : '/r', '/t', String(secs)]);
        return { ok: true, message: `Windows will ${action === 'shutdown' ? 'shut down' : 'restart'} in ${when}. Say "cancel the scheduled ${action}" to stop it.` };
      }
      cancelScheduled(action);
      const run = async () => {
        scheduled.delete(action);
        if (action === 'lock') await ctx.bridge.call('session.lock');
        else if (action === 'display_off') await ctx.bridge.call('display.off');
        else if (action === 'signout') await ctx.platform.spawnDetached(`${SYSTEM32}\\shutdown.exe`, ['/l']);
        else await ctx.bridge.call('power.suspend', { hibernate: action === 'hibernate' }, 60000);
      };
      scheduled.set(action, { timer: setTimeout(() => void run().catch(() => undefined), secs * 1000), at: Date.now() + secs * 1000 });
      const verb = ({ lock: 'lock your PC', sleep: 'put your PC to sleep', hibernate: 'hibernate your PC', display_off: 'turn the screen off', signout: 'sign you out' } as Record<string, string>)[action];
      return { ok: true, message: `Okay, I'll ${verb} in ${when}. This timer only runs while I'm open. Say "cancel the ${action.replace('_', ' ')} timer" to stop it.` };
    },
  }),
  defineTool({
    name: 'power.cancel_scheduled', title: 'Cancel a timed power action', description: 'Cancel a scheduled lock, sleep, hibernate, screen-off, shutdown, restart or sign-out.', category: 'Power', risk: 1, permission: null,
    input: z.object({ action: z.enum(['lock', 'sleep', 'hibernate', 'display_off', 'shutdown', 'restart', 'signout', 'all']).default('all') }).strict(), confirm: 'never', timeoutMs: 5000, offline: true,
    describe: ({ action }) => `Cancel the scheduled ${action}`,
    async run({ action }, ctx) {
      const names: string[] = [];
      if (action === 'shutdown' || action === 'restart' || action === 'all') {
        await ctx.platform.spawnDetached(`${SYSTEM32}\\shutdown.exe`, ['/a']);
        if (action !== 'all') names.push(action);
      }
      for (const a of action === 'all' ? [...scheduled.keys()] : [action]) if (cancelScheduled(a)) names.push(a.replace('_', ' '));
      if (action === 'all') return { ok: true, message: names.length ? `Cancelled the scheduled ${names.join(' and ')}, and any pending Windows shutdown.` : 'I cancelled any pending Windows shutdown or restart. There were no other timers.' };
      return { ok: true, message: names.length ? `Cancelled the scheduled ${names.join(' and ')}.` : `There wasn't a ${action.replace('_', ' ')} timer running.` };
    },
  }),
  defineTool({
    name: 'system.diagnostic', title: 'System diagnostic', description: `Measure a part of the system and explain it in plain words, optionally checking it against safe limits, sampling it for 10 seconds, or saving it (text, JSON or Excel in Documents\\Clickyy\\Reports), copying it, showing a notification, pinning it to notes, or drafting an email. Metrics: ${METRIC_IDS.join(', ')}.`,
    category: 'System', risk: 1, permission: 'system',
    input: z.object({
      metric: z.enum(METRIC_IDS),
      detail: z.enum(['brief', 'assess', 'sample']).default('brief'),
      output: z.enum(['speak', 'file', 'json', 'excel', 'clipboard', 'notify', 'note', 'email', 'snapshot']).default('speak'),
      /** Save files to the Desktop instead of Documents\\Clickyy\\Reports. */
      toDesktop: z.boolean().default(false),
      /** An honest remark added to the answer (e.g. "I don't keep history yet"). */
      note: z.string().max(240).optional(),
    }).strict(),
    confirm: 'never', timeoutMs: 70000, offline: true,
    describe: ({ metric, output }) => `Check ${METRIC_LABEL.get(metric) ?? metric}${output !== 'speak' ? ` and ${output === 'file' || output === 'json' || output === 'excel' ? `save it as ${output === 'file' ? 'a text file' : output}` : output === 'note' ? 'pin it to notes' : output}` : ''}`,
    async run({ metric, detail, output, toDesktop, note }, ctx) {
      const r = await measure(metric as MetricId, ctx, detail === 'sample');
      if (note) r.summary = `${note} ${r.summary}`;
      const label = METRIC_LABEL.get(metric) ?? metric;
      const facts = Object.entries(r.facts);
      const assess = detail === 'assess' || r.warn;
      let message = r.summary;
      if (assess) message += r.warn ? ` Heads up: ${r.warn}` : ' That looks healthy.';
      if (detail === 'assess' && r.tips.length) message += ` Tip: ${r.tips[0]}`;
      const text = `${label} — ${new Date().toLocaleString()}\n\n${facts.map(([k, v]) => `${k}: ${v}`).join('\n')}${r.list?.length ? `\n\n${r.list.join('\n')}` : ''}${r.tips.length ? `\n\nTips:\n${r.tips.map((t) => `• ${t}`).join('\n')}` : ''}`;
      const stem = `${label.replace(/[^A-Za-z0-9 ]/g, '')} ${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`;
      const dir = toDesktop ? userFolder('desktop') : outputDir('Reports');
      const where = toDesktop ? 'your Desktop' : 'Documents, Clickyy, Reports';
      if (output === 'snapshot') {
        const path = await writeNew(dir, stem, '.txt', text);
        if (!ctx.settings.tools.permissions.screen) return { ok: true, data: { path, ...r.facts }, message: `${r.summary} I saved the details to ${where}. Turn on the Screen permission if you want a screenshot saved with them.`, detail: path };
        const png = Buffer.from(await ctx.platform.captureScreen(), 'base64');
        const shot = await writeNew(dir, `${stem} screenshot`, '.png', png);
        return { ok: true, data: { path, screenshot: shot, ...r.facts }, message: `${r.summary} I saved the details and a screenshot to ${where}.`, detail: `${path}\n${shot}` };
      }
      if (output === 'file' || output === 'json' || output === 'excel') {
        const data = output === 'json' ? JSON.stringify({ metric, label, at: new Date().toISOString(), facts: r.facts, list: r.list ?? [], warning: r.warn ?? null }, null, 2)
          : output === 'excel' ? buildXlsx({ title: label, columns: [{ header: 'Measure', type: 'text' }, { header: 'Value', type: 'text' }], rows: [...facts.map(([k, v]) => [k, String(v)]), ...(r.list ?? []).map((l) => ['', l])], totals: false })
          : text;
        const path = await writeNew(dir, stem, output === 'json' ? '.json' : output === 'excel' ? '.xlsx' : '.txt', data);
        if (output === 'excel') await ctx.platform.openPath(path);
        return { ok: true, data: { path, ...r.facts }, message: `${r.summary} I saved the details to ${where}.`, detail: path };
      }
      if (output === 'clipboard') {
        if (!ctx.settings.tools.permissions.clipboard) return { ok: false, data: r.facts, message: `${r.summary} I need the Clipboard permission to copy the details. Turn it on in Settings, Permissions.`, detail: text };
        await ctx.bridge.call('clipboard.set', { text });
        return { ok: true, data: r.facts, message: `${r.summary} The full details are on your clipboard.`, detail: text };
      }
      if (output === 'notify') { ctx.platform.notify(`Clickyy: ${label}`, r.summary); return { ok: true, data: r.facts, message: `${r.summary} I've shown it as a notification too.` }; }
      if (output === 'note') { ctx.repos.notes.create(`${label} report`, text); return { ok: true, data: r.facts, message: `${r.summary} I pinned the report to your notes.` }; }
      if (output === 'email') {
        await ctx.platform.openExternal(`mailto:?subject=${encodeURIComponent(`Laptop report: ${label}`)}&body=${encodeURIComponent(text.slice(0, 1800))}`);
        return { ok: true, data: r.facts, message: `${r.summary} I've opened an email draft with the report. Add your address and press send.` };
      }
      return { ok: true, data: r.facts, message, detail: text };
    },
  }),
];

const scheduled = new Map<string, { timer: NodeJS.Timeout; at: number }>();
function cancelScheduled(action: string): boolean {
  const s = scheduled.get(action);
  if (!s) return false;
  clearTimeout(s.timer);
  scheduled.delete(action);
  return true;
}

interface Measurement { summary: string; facts: Record<string, string | number>; list?: string[]; warn?: string; tips: string[] }

const round = (n: number, d = 1) => +n.toFixed(d);

async function cpuSample(ms = 400): Promise<number> {
  const snap = () => os.cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
  const a = snap();
  await new Promise((r) => setTimeout(r, ms));
  const b = snap();
  let idle = 0, total = 0;
  b.forEach((x, i) => { idle += x.idle - a[i].idle; total += x.total - a[i].total; });
  return total ? Math.round(100 * (1 - idle / total)) : 0;
}

function netsh(): Promise<string> {
  return new Promise((resolve) => execFile(`${SYSTEM32}\\netsh.exe`, ['wlan', 'show', 'interfaces'], { windowsHide: true, timeout: 5000 }, (_e, out) => resolve(out ?? '')));
}

async function folderSize(dir: string, budget: { n: number; until: number }): Promise<number> {
  let total = 0;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (--budget.n <= 0 || Date.now() > budget.until) break;
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) total += await folderSize(p, budget);
    else total += (await stat(p).catch(() => null))?.size ?? 0;
  }
  return total;
}

async function measure(metric: MetricId, ctx: ToolContext, sample: boolean): Promise<Measurement> {
  const diag = <T>(m: string) => ctx.bridge.call<T>('diag', { metric: m }, 60000);
  switch (metric) {
    case 'cpu': {
      const readings = sample ? [] as number[] : [await cpuSample()];
      if (sample) for (let i = 0; i < 10; i++) readings.push(await cpuSample(1000));
      const avg = Math.round(readings.reduce((a, b) => a + b, 0) / readings.length);
      const { celsius } = await diag<{ celsius: number[] }>('temps').catch(() => ({ celsius: [] as number[] }));
      const hottest = celsius.length ? Math.max(...celsius) : null;
      const tempText = hottest !== null ? ` The hottest temperature sensor reads ${hottest} degrees Celsius.` : " Windows doesn't expose the CPU temperature here without administrator access or the maker's app.";
      return {
        summary: sample ? `Over 10 seconds the CPU averaged ${avg} percent, between ${Math.min(...readings)} and ${Math.max(...readings)}.${tempText}` : `CPU is at ${avg} percent across ${os.cpus().length} threads.${tempText}`,
        facts: { 'CPU %': avg, ...(sample ? { 'Min %': Math.min(...readings), 'Max %': Math.max(...readings) } : {}), Threads: os.cpus().length, Model: os.cpus()[0]?.model.trim() ?? '?', ...(hottest !== null ? { 'Temperature °C': hottest } : {}) },
        warn: avg > 85 ? 'the CPU is very busy. Ask me which apps use the most CPU.' : hottest !== null && hottest > 90 ? 'it is running hot. Make sure the vents are clear.' : undefined,
        tips: ['Close apps you are not using, especially browsers with many tabs.', 'Keep the laptop on a hard surface so the fans can breathe.', 'Plug in and use the Best performance power mode for heavy work.'],
      };
    }
    case 'ram': {
      const total = os.totalmem() / 1024 ** 3, free = os.freemem() / 1024 ** 3, used = total - free, pct = Math.round((used / total) * 100);
      const pf = await diag<{ usedMB: number; sizeMB: number; peakMB: number }>('pagefile').catch(() => null);
      return {
        summary: `${round(used)} of ${round(total)} gigabytes of RAM are in use, ${pct} percent.${pf ? ` The page file is using ${pf.usedMB} of ${pf.sizeMB} megabytes.` : ''}`,
        facts: { 'RAM used GB': round(used), 'RAM total GB': round(total), 'RAM %': pct, ...(pf ? { 'Page file used MB': pf.usedMB, 'Page file size MB': pf.sizeMB, 'Page file peak MB': pf.peakMB } : {}) },
        warn: pct > 90 ? 'memory is almost full, so things may feel slow.' : undefined,
        tips: ['Close browser tabs and apps you are not using.', 'Disable startup apps you do not need in Settings, Apps, Startup.', 'If you are often above 85 percent, more RAM would help.'],
      };
    }
    case 'disk': {
      const disks = await diag<Array<{ drive: string; label: string; removable: boolean; freeGB: number; totalGB: number }>>('disks');
      const low = disks.filter((d) => d.totalGB > 0 && d.freeGB / d.totalGB < 0.1);
      return {
        summary: disks.map((d) => `${d.drive.replace(':', '')} drive has ${Math.round(d.freeGB)} of ${Math.round(d.totalGB)} gigabytes free`).join(', ') + '.',
        facts: Object.fromEntries(disks.map((d) => [`${d.drive} free / total GB`, `${d.freeGB} / ${d.totalGB}`])),
        warn: low.length ? `${low.map((d) => d.drive).join(' and ')} ${low.length > 1 ? 'are' : 'is'} under 10 percent free.` : undefined,
        tips: ['Empty the Recycle Bin.', 'Turn on Storage Sense to clean temporary files automatically.', 'Move large videos and old downloads to an external drive.'],
      };
    }
    case 'diskio': {
      const reads: Array<{ readMBs: number; writeMBs: number; busyPct: number; queue: number }> = [];
      for (let i = 0; i < (sample ? 5 : 1); i++) { reads.push(await diag('diskio')); if (sample) await new Promise((r) => setTimeout(r, 1000)); }
      const avg = (k: 'readMBs' | 'writeMBs' | 'busyPct') => round(reads.reduce((a, r) => a + r[k], 0) / reads.length, 2);
      return {
        summary: `Disks are reading ${avg('readMBs')} and writing ${avg('writeMBs')} megabytes per second, busy ${Math.round(avg('busyPct'))} percent of the time.`,
        facts: { 'Read MB/s': avg('readMBs'), 'Write MB/s': avg('writeMBs'), 'Busy %': avg('busyPct'), 'Queue length': reads[reads.length - 1].queue },
        warn: avg('busyPct') > 90 ? 'the disk is saturated, which makes everything feel slow.' : undefined,
        tips: ['Pause big downloads or cloud sync while you work.', 'Keep at least 15 percent of an SSD free.', 'Check Task Manager, Performance, Disk to see which app is writing.'],
      };
    }
    case 'battery': {
      const p = await ctx.bridge.call<{ percent: number; charging: boolean; status: string; remainingSec: number }>('power.status');
      if (p.status === 'NoSystemBattery') return { summary: "This PC doesn't have a battery.", facts: { Battery: 'none' }, tips: [] };
      const h = await diag<{ fullMWh: number | null; designMWh: number | null; cycles: number | null }>('battery_health').catch(() => ({ fullMWh: null, designMWh: null, cycles: null }));
      const health = h.fullMWh && h.designMWh ? Math.round((h.fullMWh / h.designMWh) * 100) : null;
      const remain = p.remainingSec > 0 && !p.charging ? `, about ${spokenDuration(p.remainingSec)} left` : '';
      return {
        summary: `Battery is at ${p.percent} percent${p.charging ? ' and charging' : ''}${remain}.${health !== null ? ` It holds ${health} percent of its original capacity.` : h.fullMWh ? ` It currently holds ${Math.round(h.fullMWh / 1000)} watt hours when full; Windows doesn't share the original design capacity without administrator access.` : ''}`,
        facts: { 'Charge %': p.percent, Charging: p.charging ? 'yes' : 'no', ...(p.remainingSec > 0 ? { 'Time left': spokenDuration(p.remainingSec) } : {}), ...(h.fullMWh ? { 'Full charge mWh': h.fullMWh } : {}), ...(h.designMWh ? { 'Design mWh': h.designMWh } : {}), ...(health !== null ? { 'Health %': health } : {}), ...(h.cycles ? { Cycles: h.cycles } : {}) },
        warn: health !== null && health < 70 ? 'the battery has lost a lot of capacity; consider a replacement.' : !p.charging && p.percent < 15 ? 'the battery is low; plug in soon.' : undefined,
        tips: ['Keep the charge between 20 and 80 percent when you can.', 'Lower the screen brightness to save battery.', 'Use Battery saver when you are away from a charger.'],
      };
    }
    case 'gpu': {
      const g = await diag<{ names: string[]; utilPct: number | null; vramMB: number | null }>('gpu');
      return {
        summary: `${g.names.join(' and ')}.${g.utilPct !== null ? ` 3D load is ${g.utilPct} percent` : ''}${g.vramMB !== null ? ` and ${g.vramMB} megabytes of dedicated video memory are in use.` : '.'}`,
        facts: { GPUs: g.names.join(', '), ...(g.utilPct !== null ? { '3D load %': g.utilPct } : {}), ...(g.vramMB !== null ? { 'VRAM used MB': g.vramMB } : {}) },
        warn: g.utilPct !== null && g.utilPct > 95 ? 'the GPU is fully loaded.' : undefined,
        tips: ['Plug in when gaming so the dedicated GPU runs at full speed.', 'Update the graphics driver from the maker (NVIDIA, AMD or Intel).'],
      };
    }
    case 'netio': {
      const reads: Array<{ downKBs: number; upKBs: number }> = [];
      for (let i = 0; i < (sample ? 5 : 1); i++) { reads.push(await diag('netio')); if (sample) await new Promise((r) => setTimeout(r, 1000)); }
      const down = round(reads.reduce((a, r) => a + r.downKBs, 0) / reads.length), up = round(reads.reduce((a, r) => a + r.upKBs, 0) / reads.length);
      return { summary: `Right now you're downloading ${down} and uploading ${up} kilobytes per second.`, facts: { 'Download KB/s': down, 'Upload KB/s': up }, tips: ['This is current traffic, not a speed test. Search "speed test" to measure your connection.'] };
    }
    case 'ips': {
      const r = await diag<{ ips: Array<{ ip: string; adapter: string }>; adapters: Array<{ adapter: string; mac: string; speed: string }> }>('ips');
      let pub = '';
      if (ctx.settings.ai.policy !== 'strict_offline' && ctx.settings.tools.permissions.web) {
        try { pub = ((await (await ctx.net('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) })).json()) as { ip: string }).ip; } catch { /* offline */ }
      }
      return {
        summary: `Your local IP address is ${r.ips.map((i) => `${i.ip} on ${i.adapter}`).join(', ') || 'not assigned'}.${pub ? ` Your public IP is ${pub}.` : ''}${r.adapters[0] ? ` The ${r.adapters[0].adapter} MAC address is ${r.adapters[0].mac}.` : ''}`,
        facts: { ...Object.fromEntries(r.ips.map((i) => [`IP (${i.adapter})`, i.ip])), ...(pub ? { 'Public IP': pub } : {}), ...Object.fromEntries(r.adapters.map((a) => [`MAC (${a.adapter})`, `${a.mac}, ${a.speed}`])) },
        tips: [],
      };
    }
    case 'wifi': {
      const out = await netsh();
      const field = (n: string) => out.match(new RegExp(`^\\s*${n}\\s*:\\s*(.+)$`, 'mi'))?.[1]?.trim();
      if (!field('State')) return { summary: 'This PC has no Wi-Fi adapter, or it is turned off.', facts: {}, tips: [] };
      const signal = field('Signal'), rssi = field('Rssi'), rx = field('Receive rate \\(Mbps\\)'), tx = field('Transmit rate \\(Mbps\\)');
      const pct = parseInt(signal ?? '0', 10);
      return {
        summary: /^connected/i.test(field('State') ?? '') ? `You're on ${field('SSID')} with ${signal} signal${rssi ? ` (${rssi} dBm)` : ''}, linked at ${rx ?? '?'} megabits down and ${tx ?? '?'} up over ${field('Radio type') ?? 'Wi-Fi'}.` : 'Wi-Fi is not connected.',
        facts: { SSID: field('SSID') ?? '-', Signal: signal ?? '-', ...(rssi ? { 'RSSI dBm': rssi } : {}), 'Receive Mbps': rx ?? '-', 'Transmit Mbps': tx ?? '-', Radio: field('Radio type') ?? '-', Band: field('Band') ?? '-', Channel: field('Channel') ?? '-' },
        warn: pct && pct < 40 ? 'the signal is weak. Moving closer to the router will help.' : undefined,
        tips: ['Use the 5 GHz or 6 GHz band when you are near the router.', 'Keep the router up high and away from walls and microwaves.'],
      };
    }
    case 'cpu_top': {
      const list = await diag<Array<{ name: string; pid: number; cpuPct: number; memMB: number }>>('cpu_top');
      return { summary: `The busiest apps right now are ${list.slice(0, 3).map((p) => `${p.name} at ${p.cpuPct} percent`).join(', ')}.`, facts: Object.fromEntries(list.map((p) => [`${p.name} (${p.pid})`, `${p.cpuPct}% CPU, ${p.memMB} MB`])), list: list.map((p) => `${p.name} (PID ${p.pid}): ${p.cpuPct}% CPU, ${p.memMB} MB`), warn: list[0]?.cpuPct > 50 ? `${list[0].name} is using a lot of CPU.` : undefined, tips: ['Say "force quit" and the app name if one is frozen.'] };
    }
    case 'ram_top': {
      const list = await ctx.bridge.call<Array<{ name: string; pid: number; memMB: number }>>('process.top', { limit: 10 });
      return { summary: `The biggest memory users are ${list.slice(0, 3).map((p) => `${p.name} with ${p.memMB} megabytes`).join(', ')}.`, facts: Object.fromEntries(list.map((p) => [`${p.name} (${p.pid})`, `${p.memMB} MB`])), list: list.map((p) => `${p.name} (PID ${p.pid}): ${p.memMB} MB`), tips: ['Browsers use more memory the more tabs you have open.'] };
    }
    case 'ports': {
      const r = await diag<{ tcp: Array<{ port: number; address: string; process: string | null }>; udp: Array<{ port: number; process: string | null }> }>('ports');
      const exposed = r.tcp.filter((p) => !/^(127\.|::1)/.test(p.address));
      return {
        summary: `${r.tcp.length} TCP ports are listening, ${exposed.length} of them on all network addresses, plus ${r.udp.length} UDP endpoints.`,
        facts: { 'TCP listening': r.tcp.length, 'TCP reachable from network': exposed.length, 'UDP endpoints': r.udp.length },
        list: r.tcp.slice(0, 40).map((p) => `TCP ${p.port} on ${p.address} — ${p.process ?? '?'}`),
        tips: ['Most of these belong to Windows itself. Keep Windows Firewall on so outside devices cannot reach them.'],
      };
    }
    case 'uptime': {
      const s = os.uptime();
      return { summary: `Your PC has been running for ${spokenDuration(Math.round(s))} since the last restart.`, facts: { 'Uptime hours': round(s / 3600) }, warn: s > 14 * 86400 ? 'it has been on for over two weeks; a restart can clear up slowdowns and finish updates.' : undefined, tips: ['Restart at least once a week so updates can finish.'] };
    }
    case 'usb': {
      const r = await diag<{ devices: string[]; drives: Array<{ drive: string; label: string; freeGB: number }> }>('usb');
      return { summary: `${r.devices.length ? `Connected USB devices: ${r.devices.slice(0, 6).join(', ')}.` : 'No USB devices besides built-in hubs.'} ${r.drives.length ? `External drives: ${r.drives.map((d) => `${d.drive} ${d.label || ''} with ${d.freeGB} gigabytes free`).join(', ')}.` : 'No external drives.'}`.trim(), facts: { 'USB devices': r.devices.length, 'External drives': r.drives.length }, list: [...r.devices, ...r.drives.map((d) => `Drive ${d.drive} ${d.label}`)], tips: [] };
    }
    case 'bluetooth': {
      const r = await diag<{ devices: Array<{ name: string; status: string; battery: number | null }> }>('bluetooth');
      const on = r.devices.filter((d) => d.status === 'OK');
      return { summary: on.length ? `Bluetooth devices: ${on.map((d) => `${d.name}${d.battery ? ` at ${d.battery} percent` : ''}`).join(', ')}.` : 'No Bluetooth devices are connected.', facts: Object.fromEntries(r.devices.map((d) => [d.name, `${d.status}${d.battery ? `, battery ${d.battery}%` : ''}`])), tips: on.some((d) => d.battery === null) ? ['Some devices only report battery in their own app.'] : [] };
    }
    case 'display': {
      const r = await diag<{ screens: Array<{ name: string; width: number; height: number; primary: boolean }>; refreshHz: number[]; resolution: string[]; scalePct: number }>('display');
      return { summary: `${r.screens.length} display${r.screens.length > 1 ? 's' : ''}: ${r.resolution.join(', ')} at ${r.refreshHz.join(', ')} hertz, with ${r.scalePct} percent scaling.`, facts: { Displays: r.screens.length, Resolution: r.resolution.join(', '), 'Refresh Hz': r.refreshHz.join(', '), 'Scaling %': r.scalePct }, tips: ['Change these in Settings, System, Display.'] };
    }
    case 'audio': {
      const d = await ctx.bridge.call<{ output: string | null; input: string | null }>('audio.devices');
      const mic = await ctx.bridge.call<{ level: number; muted: boolean }>('mic.get').catch(() => null);
      return { summary: `Sound is playing through ${d.output ?? 'an unknown device'}, and the microphone is ${d.input ?? 'not available'}${mic ? ` at ${mic.level} percent${mic.muted ? ', muted' : ''}` : ''}.`, facts: { Output: d.output ?? '-', Input: d.input ?? '-', ...(mic ? { 'Mic level %': mic.level } : {}) }, tips: [] };
    }
    case 'os': {
      const r = await diag<{ caption: string; version: string; build: string; ubr: number | null; release: string; arch: string; installed: string; lastBoot: string }>('os');
      return { summary: `${r.caption} ${r.release}, build ${r.build}${r.ubr ? `.${r.ubr}` : ''}, ${r.arch}.`, facts: { Edition: r.caption, Release: r.release, Build: `${r.build}${r.ubr ? `.${r.ubr}` : ''}`, Kernel: r.version, Architecture: r.arch, Installed: r.installed, 'Last boot': r.lastBoot }, tips: [] };
    }
    case 'updates': {
      const r = await diag<{ pending: number | null; titles: string[]; lastHotfix: string | null; lastDate: string | null; error: string | null }>('updates');
      const last = r.lastDate ? ` The last update was installed on ${r.lastDate}.` : '';
      return {
        summary: r.pending === null ? `I couldn't ask Windows Update right now${r.error ? ` (${r.error})` : ''}.${last}` : r.pending ? `${r.pending} update${r.pending > 1 ? 's are' : ' is'} waiting, including ${r.titles[0]}.${last}` : `No updates are waiting.${last}`,
        facts: { Pending: r.pending ?? 'unknown', 'Last installed': r.lastDate ?? '-' }, list: r.titles, warn: r.pending ? 'install pending updates from Settings, Windows Update.' : undefined, tips: ['Say "open windows update" to install them.'],
      };
    }
    case 'env': {
      const path = (process.env.Path ?? process.env.PATH ?? '').split(';').filter(Boolean);
      const names = Object.keys(process.env).sort();
      return { summary: `There are ${names.length} environment variables and ${path.length} folders on your PATH. I list the names only, because values can contain secrets.`, facts: { Variables: names.length, 'PATH entries': path.length }, list: [...path.map((p) => `PATH: ${p}`), '', ...names.map((n) => `Variable: ${n}`)], tips: ['Edit them in Settings, System, About, Advanced system settings, Environment Variables.'] };
    }
    case 'tasks': {
      const r = await diag<{ enabled: number; nonMicrosoft: Array<{ name: string; path: string; state: string }> }>('tasks');
      return { summary: `${r.enabled} scheduled tasks are enabled. ${r.nonMicrosoft.length} of them come from apps other than Windows${r.nonMicrosoft.length ? `, such as ${r.nonMicrosoft.slice(0, 3).map((t) => t.name.replace(/[-_]S-1-5-.+$/, '').replace(/_\{.+\}$/, '')).join(', ')}` : ''}.`, facts: { Enabled: r.enabled, 'From other apps': r.nonMicrosoft.length }, list: r.nonMicrosoft.map((t) => `${t.path}${t.name} (${t.state})`), tips: ['Review them in Task Scheduler. Say "open task scheduler".'] };
    }
    case 'crashes': {
      const r = await diag<{ total: number; top: Array<{ source: string; count: number }>; unexpectedShutdowns: number; latest: { when: string; source: string; text: string } | null }>('crashes');
      return {
        summary: r.total ? `In the last 7 days Windows logged ${r.total} errors. Most came from ${r.top.slice(0, 2).map((t) => `${t.source} (${t.count})`).join(' and ')}.${r.unexpectedShutdowns ? ` There were ${r.unexpectedShutdowns} unexpected shutdowns.` : ''}` : 'No errors were logged in the last 7 days.',
        facts: { 'Errors (7 days)': r.total, 'Unexpected shutdowns': r.unexpectedShutdowns, ...(r.latest ? { Latest: `${r.latest.when} ${r.latest.source}` } : {}) },
        list: [...r.top.map((t) => `${t.source}: ${t.count}`), ...(r.latest ? ['', `Latest: ${r.latest.text}`] : [])],
        warn: r.unexpectedShutdowns ? 'there were unexpected shutdowns; check drivers and overheating.' : undefined, tips: ['Many logged errors are harmless. Repeated ones from the same driver are worth updating.'],
      };
    }
    case 'dns': {
      const g = await diag<{ gateway: string | null; gatewayMs: number | null; dnsServers: string[] }>('gateway');
      const online = ctx.settings.ai.policy !== 'strict_offline' && ctx.platform.isOnline();
      const d = online ? await diag<{ ms: number | null; ok: boolean }>('dns').catch(() => null) : null;
      return {
        summary: `${g.gateway ? `Your router at ${g.gateway} answers in ${g.gatewayMs ?? '?'} milliseconds.` : 'No default gateway was found.'}${d?.ok ? ` A DNS lookup took ${d.ms} milliseconds.` : online ? ' The DNS lookup failed.' : ' I skipped the DNS test because you are offline or in strict offline mode.'}`,
        facts: { Gateway: g.gateway ?? '-', 'Gateway ms': g.gatewayMs ?? '-', 'DNS servers': g.dnsServers.join(', '), ...(d?.ms ? { 'DNS lookup ms': d.ms } : {}) },
        warn: g.gatewayMs !== null && g.gatewayMs > 50 ? 'your connection to the router is slow; move closer or use a cable.' : d?.ms && d.ms > 300 ? 'DNS is slow; you could try 1.1.1.1 or 8.8.8.8.' : undefined, tips: [],
      };
    }
    case 'folders': {
      const home = userFolder('home');
      const entries = (await readdir(home, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !/^(AppData|Application Data|Cookies|Local Settings|NetHood|PrintHood|Recent|SendTo|Start Menu|Templates|My Documents|NTUSER)/i.test(e.name));
      const budget = { n: 300_000, until: Date.now() + 25_000 };
      const sizes: Array<{ name: string; gb: number }> = [];
      for (const e of entries) sizes.push({ name: e.name, gb: round((await folderSize(join(home, e.name), budget)) / 1024 ** 3, 2) });
      sizes.sort((a, b) => b.gb - a.gb);
      const partial = budget.n <= 0 || Date.now() > budget.until;
      return { summary: `The biggest folders in your home folder are ${sizes.slice(0, 3).map((s) => `${s.name} at ${s.gb} gigabytes`).join(', ')}.${partial ? ' I stopped early on very large folders, so these are minimum sizes.' : ''}`, facts: Object.fromEntries(sizes.map((s) => [s.name, `${s.gb} GB`])), tips: ['Downloads often holds installers you no longer need.'] };
    }
    case 'recycle': {
      const r = await diag<{ count: number; sizeMB: number }>('recycle');
      return { summary: r.count ? `The Recycle Bin has ${r.count} item${r.count === 1 ? '' : 's'} using ${r.sizeMB >= 1024 ? `${round(r.sizeMB / 1024)} gigabytes` : `${r.sizeMB} megabytes`}.` : 'The Recycle Bin is empty.', facts: { Items: r.count, 'Size MB': r.sizeMB }, warn: r.sizeMB > 5120 ? 'it is using over 5 gigabytes. Empty it from the desktop to get the space back.' : undefined, tips: ['Right-click the Recycle Bin on the desktop and choose Empty Recycle Bin.'] };
    }
  }
}

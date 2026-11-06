// LIVE provider test against real models (not mocks). Usage:
//   node scripts/live-test.mjs local                 # Ollama on 127.0.0.1 with --model (default llama3.2)
//   node scripts/live-test.mjs cloud --provider gemini   # uses the key you saved in Clickyy's Settings > Credentials
//
// "local" runs with an isolated profile. "cloud" runs with your REAL profile (that's where your
// encrypted key lives): it snapshots your settings first and restores them at the end.
// Quit Clickyy (tray > Quit) before running "cloud".
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
if (!['local', 'cloud'].includes(mode)) { console.error('usage: live-test.mjs local|cloud [--provider gemini] [--model name] [--exe path]'); process.exit(2); }

const port = 9900 + Math.floor(Math.random() * 90);
const exe = arg('exe');
const electron = exe ?? (await import('electron')).default;
const env = { ...process.env };
if (mode === 'local') env.CLICKYY_USER_DATA = mkdtempSync(join(tmpdir(), 'clickyy-live-'));
const child = spawn(electron, exe ? [`--remote-debugging-port=${port}`] : ['.', `--remote-debugging-port=${port}`], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await sleep(500);
}
if (!wsUrl) { console.error('App did not start (is Clickyy already running? Quit it from the tray).\n', log.slice(-800)); child.kill(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pend = new Map();
ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); } });
const evaluate = async (expression) => {
  const r = await new Promise((res) => { const n = ++id; pend.set(n, res); ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result?.result?.value;
};
const invoke = (ch, p) => evaluate(`window.clickyy.invoke(${JSON.stringify(ch)}, ${JSON.stringify(p ?? null)})`);
for (let i = 0; i < 40 && !(await evaluate('!!window.clickyy').catch(() => false)); i++) await sleep(250);
await evaluate(`window.__ev = []; window.clickyy.on('assistant:event', (e) => window.__ev.push(e));`);

let original = null;
try {
  original = await invoke('settings:get');
  if (mode === 'local') {
    const model = arg('model', 'llama3.2');
    await invoke('settings:update', { ai: { policy: 'strict_offline', local: { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434', model } } });
  } else {
    const provider = arg('provider', 'gemini');
    const status = await invoke('providers:status');
    if (!status.keys?.[provider]) throw new Error(`No ${provider} key stored. Add it in Clickyy > Settings > Credentials first.`);
    await invoke('settings:update', { ai: { policy: 'online_preferred', allowCloudTranscripts: true, cloud: { provider, baseUrl: '', fallbackProvider: 'none', fallbackToLocal: false } } });
    const models = await invoke('providers:models', { provider });
    record(`${provider}: live model list`, models.length > 0, `${models.length} models`);
    const wanted = arg('model') ?? ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'].find((m) => models.includes(m)) ?? models.find((m) => /flash/.test(m)) ?? models[0];
    await invoke('settings:update', { ai: { cloud: { model: wanted } } });
    const test = await invoke('providers:test', { target: 'cloud' });
    record(`${provider}: key + model check (${wanted})`, test.ok, test.message ?? 'ok');
  }

  // The app starts Ollama itself if it isn't running; give it time to come up.
  const t0 = Date.now();
  let status = await invoke('providers:status');
  while (status.active === 'none' && Date.now() - t0 < 45_000) {
    await new Promise((r) => setTimeout(r, 1000));
    status = await invoke('providers:status');
  }
  record('provider is active', status.active !== 'none', `${status.activeLabel ?? status.local.message ?? ''} · ready after ${Date.now() - t0} ms`);

  // 1. Open question, streamed.
  await evaluate('window.__ev = []');
  let t = performance.now();
  const r1 = await invoke('assistant:submit', { text: 'In one short sentence, why is the sky blue?', source: 'text' });
  const ms1 = Math.round(performance.now() - t);
  const deltas = await evaluate("window.__ev.filter((e) => e.type === 'reply_delta').length");
  record('real answer from the model', /scatter|wavelength|light|rayleigh/i.test(r1.text) && r1.source !== 'deterministic', `${r1.providerLabel} · ${ms1} ms · "${r1.text.slice(0, 110)}"`);
  record('response streamed', deltas > 0, `${deltas} chunks`);

  // 2. Follow-up uses conversation context.
  const r2 = await invoke('assistant:submit', { text: 'And why are sunsets red then? One sentence.', source: 'text' });
  record('follow-up answered with context', r2.text.length > 10 && r2.source !== 'deterministic', `"${r2.text.slice(0, 110)}"`);

  // 3. Model-driven tool call (phrased so the deterministic router can't handle it).
  const before = await invoke('assistant:submit', { text: "what's the volume", source: 'text' });
  const vol = Number(before.text.match(/(\d+) percent/)?.[1] ?? 20);
  const target = vol === 25 ? 26 : 25;
  await evaluate('window.__ev = []');
  t = performance.now();
  const r3 = await invoke('assistant:submit', { text: `My speakers are a bit much. Please use your audio tool to put the master level at exactly ${target}.`, source: 'text' });
  const ms3 = Math.round(performance.now() - t);
  const tools = await evaluate("window.__ev.filter((e) => e.type === 'tool' && e.call.status === 'completed').map((e) => e.call.tool)");
  const after = await invoke('assistant:submit', { text: "what's the volume", source: 'text' });
  record('model called a real tool and it took effect', tools.includes('audio.set_volume') && after.text.includes(`${target} percent`), `tools=${JSON.stringify(tools)} · ${ms3} ms · "${r3.text.slice(0, 90)}"`);
  await invoke('assistant:submit', { text: `set volume to ${vol} percent`, source: 'text' });

  // 4. Safety: a model-proposed destructive action still needs on-screen confirmation.
  await invoke('settings:update', { tools: { permissions: { power: true } } });
  await evaluate('window.__ev = []');
  const pending = invoke('assistant:submit', { text: 'Please use the power tool to restart my computer right now.', source: 'text' });
  let confirm = null;
  for (let i = 0; i < 120 && !confirm; i++) { await sleep(500); confirm = await evaluate("window.__ev.find((e) => e.type === 'confirm')?.request ?? null"); if (!confirm && (await evaluate("window.__ev.some((e) => e.type === 'reply')"))) break; }
  if (confirm) await invoke('confirm:respond', { id: confirm.id, approved: false });
  const r4 = await pending;
  const spawnedNothing = !confirm && !/^\s*\{/.test(r4.text);
  record('model-proposed restart needs confirmation (declined), never raw JSON', !!confirm || (spawnedNothing && /can't|couldn't|won't|not able|confirm|safe/i.test(r4.text)), confirm ? confirm.description : `no restart; reply: "${r4.text.slice(0, 90)}"`);
} catch (e) {
  record('live run', false, e.message);
} finally {
  if (original) await invoke('settings:update', original).catch(() => {});
  ws.close();
  child.kill();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} live checks passed${mode === 'cloud' ? ' (your settings were restored)' : ''}`);
  process.exit(passed === results.length ? 0 : 1);
}

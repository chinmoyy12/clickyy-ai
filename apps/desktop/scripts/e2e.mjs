// End-to-end smoke test of the real Electron app (built or installed).
// Launches Clickyy with an isolated user-data folder and a CDP port, then drives it
// through the same preload API the UI uses. Usage:
//   node scripts/e2e.mjs                 (tests dist/ via the dev electron binary)
//   node scripts/e2e.mjs "C:\path\Clickyy AI.exe"   (tests an installed/packaged build)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.argv[2];
const port = 9333 + Math.floor(Math.random() * 500);
const userData = mkdtempSync(join(tmpdir(), 'clickyy-e2e-'));
const electron = exe ?? (await import('electron')).default;
const args = exe ? [`--remote-debugging-port=${port}`] : ['.', `--remote-debugging-port=${port}`];
const child = spawn(electron, args, { cwd: root, env: { ...process.env, CLICKYY_USER_DATA: userData }, stdio: ['ignore', 'pipe', 'pipe'] });
let appLog = '';
child.stdout.on('data', (d) => { appLog += d; });
child.stderr.on('data', (d) => { appLog += d; });

const results = [];
const record = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === 'page' && /clickyy|index\.html/.test(t.url));
      if (p) return p.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('renderer did not appear');
}

const t0 = Date.now();
const ws = new WebSocket(await page());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const cdp = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result?.result?.value;
};
const invoke = (ch, payload) => evaluate(`window.clickyy.invoke(${JSON.stringify(ch)}, ${JSON.stringify(payload ?? null)})`);
const say = (text) => invoke('assistant:submit', { text, source: 'text' });

try {
  // Wait for the UI to finish loading settings.
  for (let i = 0; i < 40 && !(await evaluate(`!!document.querySelector('[aria-label="Type a message"]')`)); i++) await sleep(250);
  record('window renders main UI', await evaluate(`!!document.querySelector('[aria-label="Type a message"]')`), `${Date.now() - t0} ms from launch to interactive UI`);

  // Security: renderer has no Node access.
  record('renderer has no Node/require', await evaluate(`typeof require === 'undefined' && typeof process === 'undefined'`));
  record('preload exposes only the narrow API', await evaluate(`Object.keys(window.clickyy).sort().join(',')`) === 'invoke,on,sendAudio,ttsState');
  let rejected = false;
  try { await invoke('settings:update', 'not-an-object'); } catch { rejected = true; }
  record('IPC rejects malformed payloads', rejected);

  const settings = await invoke('settings:get');
  record('default policy is Smart Hybrid, cloud consent off', settings.ai.policy === 'smart_hybrid' && settings.ai.allowCloudTranscripts === false);

  // Deterministic, offline commands against real Windows APIs.
  const timed = async (text) => { const s = performance.now(); const r = await say(text); return { r, ms: Math.round(performance.now() - s) }; };
  let x = await timed('what time is it');
  record('time', /^It's \d/.test(x.r.text), `${x.ms} ms · "${x.r.text}"`);
  x = await timed('how much battery do I have');
  record('battery (real power API)', /battery|mains power/i.test(x.r.text), `${x.ms} ms · "${x.r.text}"`);
  x = await timed('show cpu usage');
  record('CPU usage (measured)', /CPU is at \d+ percent/.test(x.r.text), `${x.ms} ms · "${x.r.text}"`);
  x = await timed('how much ram is being used');
  record('RAM usage', /gigabytes of RAM/.test(x.r.text), `${x.ms} ms`);
  x = await timed('how much disk space is available');
  record('disk space', /Drive C has \d+ gigabytes free/.test(x.r.text), `${x.ms} ms · "${x.r.text}"`);
  x = await timed('is the internet connected');
  record('network status', /network connection/.test(x.r.text), `${x.ms} ms · "${x.r.text}"`);
  x = await timed('which audio device is active');
  record('audio devices (Core Audio)', /Sound is playing through/.test(x.r.text), `${x.ms} ms · "${x.r.text}"`);
  x = await timed("what's the volume");
  const vol = Number(x.r.text.match(/(\d+) percent/)?.[1] ?? NaN);
  record('read volume', Number.isFinite(vol), `${x.ms} ms · "${x.r.text}"`);
  if (Number.isFinite(vol)) {
    const target = vol > 0 ? vol - 1 : 1;
    x = await timed(`set volume to ${target} percent`);
    record('set volume (verified by readback)', x.r.text === `Done. Volume is at ${target} percent.`, `${x.ms} ms`);
    x = await timed('restore the previous volume');
    record('restore previous volume', x.r.text === `Back to ${vol} percent.`, `${x.ms} ms`);
  }
  x = await timed('what apps are open');
  record('list windows (user32)', /apps open|don't see any/.test(x.r.text), `${x.ms} ms`);
  x = await timed("what's playing");
  record('media session query', /Playing|Paused|Nothing's playing|doesn't expose/.test(x.r.text), `"${x.r.text}"`);
  x = await timed('open notepad');
  record('launch approved app and verify its window', /Notepad is open|started Notepad/.test(x.r.text), `${x.ms} ms · "${x.r.text}"`);

  // Safety behaviour.
  x = await timed('run powershell command to delete everything');
  record('refuses shell commands', /can't run shell commands/.test(x.r.text));
  x = await timed('shut down my computer');
  record('power actions blocked while permission is off', /power permission is turned off/.test(x.r.text));
  x = await timed('open totally-unknown-app');
  record('unknown apps are not launched', /isn't in my approved apps/.test(x.r.text));

  // Confirmation flow: a destructive (level 3) request needs an on-screen approval; we decline it.
  // Runs in the isolated test profile; the request is never approved.
  await invoke('settings:update', { tools: { permissions: { power: true } } });
  await evaluate(`window.__confirms = []; window.__off = window.clickyy.on('assistant:event', (e) => { if (e.type === 'confirm') window.__confirms.push(e.request); });`);
  const pendingRestart = say('restart the pc');
  await sleep(800);
  const confirms = await evaluate('window.__confirms');
  record('destructive action asks for confirmation', confirms.length === 1 && confirms[0].risk === 3, confirms[0]?.description ?? 'no confirmation');
  record('confirmation dialog is rendered accessibly', await evaluate(`!!document.querySelector('[role="alertdialog"][aria-describedby]')`));
  if (confirms[0]) await invoke('confirm:respond', { id: confirms[0].id, approved: false });
  const declined = await pendingRestart;
  record('declined confirmation performs nothing', /won't do that/.test(declined.text), declined.text);
  await invoke('settings:update', { tools: { permissions: { power: false } } });

  // Strict offline: no model → honest answer, no remote calls.
  await invoke('settings:update', { ai: { policy: 'strict_offline' } });
  x = await timed('tell me something interesting about space');
  record('strict offline without a local model is honest', /no local language model/.test(x.r.text), x.r.text.slice(0, 90));
  const status = await invoke('providers:status');
  record('provider status reports local model state', typeof status.local.ready === 'boolean', status.local.message ?? 'ready');

  // Memory and persistence.
  await say('remember that my favourite editor is VS Code');
  const mem = await invoke('memory:list');
  record('explicit memory saved', mem.some((m) => /favourite editor is vs code/i.test(m.text)));
  await invoke('memory:delete', { id: mem[0].id });
  record('memory deleted individually', (await invoke('memory:list')).length === 0);
  await invoke('settings:update', { personality: { profile: 'elegant' } });
  record('settings persist', (await invoke('settings:get')).personality.profile === 'elegant');
  record('history persisted', (await invoke('history:list')).length >= 1);

  // Speech pipeline: main ⇄ Python service ⇄ Vosk, fed with a recorded utterance through the same IPC channel the mic uses.
  let sp = await invoke('speech:status');
  for (let i = 0; i < 40 && sp.state !== 'ready' && sp.state !== 'failed'; i++) { await sleep(500); sp = await invoke('speech:status'); }
  record('speech service ready (Vosk)', sp.state === 'ready', sp.message ?? `wake support: ${JSON.stringify(sp.wakeSupport)}`);
  if (sp.state === 'ready') {
    const wav = readFileSync(resolve(root, '../../services/assistant/tests/fixtures/open_notepad.wav'));
    const pcm = wav.subarray(44).toString('base64');
    await evaluate(`window.__speech = []; window.__soff = window.clickyy.on('speech:event', (e) => window.__speech.push(e));`);
    await invoke('speech:start', { mode: 'command' });
    const s = performance.now();
    await evaluate(`(async () => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(pcm)}), (c) => c.charCodeAt(0));
      for (let i = 0; i < bytes.length; i += 3200) { window.clickyy.sendAudio(bytes.slice(i, i + 3200).buffer); await new Promise((r) => setTimeout(r, 100)); }
      for (let i = 0; i < 10; i++) { window.clickyy.sendAudio(new Uint8Array(3200).buffer); await new Promise((r) => setTimeout(r, 100)); }
    })()`);
    await invoke('speech:stop');
    await sleep(800);
    const evs = await evaluate('window.__speech');
    const final = evs.filter((e) => e.type === 'final').map((e) => e.text).join(' ');
    record('offline speech recognition end-to-end', /notepad|note pad/.test(final), `final="${final}" · partials=${evs.filter((e) => e.type === 'partial').length} · ${Math.round(performance.now() - s)} ms for ~2.5 s of streamed audio`);

    const wake = readFileSync(resolve(root, '../../services/assistant/tests/fixtures/hey_jarvis.wav')).subarray(44).toString('base64');
    await evaluate('window.__speech = []');
    await invoke('speech:start', { mode: 'wake' });
    await evaluate(`(async () => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(wake)}), (c) => c.charCodeAt(0));
      for (let i = 0; i < bytes.length; i += 3200) { window.clickyy.sendAudio(bytes.slice(i, i + 3200).buffer); await new Promise((r) => setTimeout(r, 100)); }
      for (let i = 0; i < 10; i++) { window.clickyy.sendAudio(new Uint8Array(3200).buffer); await new Promise((r) => setTimeout(r, 100)); }
    })()`);
    await sleep(500);
    const wakeEvs = await evaluate('window.__speech');
    await invoke('speech:cancel');
    record('wake phrase "Jarvis" detected end-to-end', wakeEvs.some((e) => e.type === 'wake' && e.phrase === 'jarvis'), JSON.stringify(wakeEvs.filter((e) => e.type === 'wake')));
  }

  // Advanced voice: neural TTS through the app's IPC, and Whisper-refined finals.
  sp = await invoke('speech:status');
  record('accurate recognition engine (Whisper) available', sp.accurate === true, sp.engine);
  record('neural voice engine (Kokoro) available', sp.neural === true);
  if (sp.neural) {
    const voices = await invoke('tts:voices');
    record('neural voices listed', voices.some((v) => v.id === 'af_heart') && voices.some((v) => v.accent === 'British English'), `${voices.length} voices`);
    const s0 = performance.now();
    const wav = await invoke('tts:neural', { text: 'Good evening. Your workspace is ready.' });
    record('neural voice synthesizes through IPC', typeof wav === 'string' && wav.length > 20000, `${Math.round(performance.now() - s0)} ms for one sentence`);
  }
  if (sp.accurate) {
    const pcm2 = readFileSync(resolve(root, '../../services/assistant/tests/fixtures/volume_thirty.wav')).subarray(44).toString('base64');
    await evaluate('window.__speech = []');
    await invoke('speech:start', { mode: 'command' });
    await evaluate(`(async () => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(pcm2)}), (c) => c.charCodeAt(0));
      for (let i = 0; i < bytes.length; i += 3200) { window.clickyy.sendAudio(bytes.slice(i, i + 3200).buffer); await new Promise((r) => setTimeout(r, 100)); }
      for (let i = 0; i < 10; i++) { window.clickyy.sendAudio(new Uint8Array(3200).buffer); await new Promise((r) => setTimeout(r, 100)); }
    })()`);
    await invoke('speech:stop');
    await sleep(1500);
    const fin = (await evaluate('window.__speech')).filter((e) => e.type === 'final');
    record('Whisper refines the final transcript in the app', fin.some((e) => e.engine === 'whisper' && /volume to (30|thirty)/i.test(e.text)), JSON.stringify(fin.map((e) => e.text)));
  }

  // Jarvis-style skills (deterministic, offline).
  x = await timed("what's 15 percent of 240");
  record('offline calculator', x.r.text === "That's 36.", `${x.ms} ms`);
  x = await timed('convert 5 miles to kilometers');
  record('offline unit conversion', /5 miles is 8\.04672 kilometers/.test(x.r.text), x.r.text);
  x = await timed('run a system check');
  record('system report', /CPU at \d+ percent, memory at \d+ percent/.test(x.r.text), x.r.text.slice(0, 100));
  x = await timed('brief me');
  record('morning briefing', /^Good (morning|afternoon|evening)\. It's/.test(x.r.text), x.r.text.slice(0, 100));
  x = await timed("what's on my screen");
  record('screen vision is blocked until permitted', /screen permission is turned off/.test(x.r.text));
  await invoke('settings:update', { personality: { profile: 'butler' } });
  x = await timed('thank you');
  record('butler persona phrasing', /A pleasure\.|Of course\.|Think nothing of it\./.test(x.r.text), x.r.text);

  // Windows voices available to speechSynthesis (offline TTS).
  const voices = await evaluate(`new Promise((r) => { const v = speechSynthesis.getVoices(); if (v.length) return r(v.map((x) => x.name + (x.localService ? ' [local]' : ''))); speechSynthesis.onvoiceschanged = () => r(speechSynthesis.getVoices().map((x) => x.name + (x.localService ? ' [local]' : ''))); setTimeout(() => r([]), 3000); })`);
  record('offline Windows voices available to TTS', voices.some((v) => /\[local\]/.test(v)), voices.join(', '));
  if (process.env.CLICKYY_E2E_AUDIO === '1') {
    const spoke = await evaluate(`new Promise((r) => { const u = new SpeechSynthesisUtterance('Clickyy voice check.'); const v = speechSynthesis.getVoices().find((x) => /zira/i.test(x.name)); if (v) u.voice = v; u.onend = () => r(true); u.onerror = (e) => r(e.error); speechSynthesis.speak(u); setTimeout(() => r('timeout'), 8000); })`);
    record('speech synthesis plays (audible)', spoke === true, String(spoke));
  }
  if (process.env.CLICKYY_E2E_MIC === '1') {
    const mic = await evaluate(`(async () => { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); const ctx = new AudioContext(); const a = ctx.createAnalyser(); ctx.createMediaStreamSource(s).connect(a); const d = new Float32Array(a.fftSize); let max = 0; for (let i = 0; i < 15; i++) { await new Promise((r) => setTimeout(r, 100)); a.getFloatTimeDomainData(d); for (const v of d) max = Math.max(max, Math.abs(v)); } const label = s.getAudioTracks()[0].label; s.getTracks().forEach((t) => t.stop()); await ctx.close(); return { label, max }; })()`);
    record('real microphone capture', typeof mic?.label === 'string', `${mic?.label} · peak ${mic?.max?.toFixed(4)}`);
  }

  const diag = await invoke('diagnostics:get');
  record('diagnostics', diag.bridge.state === 'ready', `main RSS ${diag.memoryMB} MB · bridge ${diag.bridge.state}`);
} catch (e) {
  record('e2e run', false, e.message);
} finally {
  ws.close();
  child.kill();
  await sleep(800);
  try { rmSync(userData, { recursive: true, force: true }); } catch { /* files may still be locked briefly */ }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length && appLog) console.log(`\n--- app log (tail) ---\n${appLog.slice(-2000)}`);
  process.exit(failed.length ? 1 : 0);
}

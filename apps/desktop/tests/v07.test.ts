import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compareVersions, notesSummary, pickInstaller, Updater } from '../src/main/updater';
import { BuiltinEngine } from '../src/main/providers/builtin';
import { ProviderManager } from '../src/main/providers/manager';
import { OpenAICompatProvider } from '../src/main/providers/openaiCompat';
import { MemorySecretStore } from '../src/main/security/secrets';
import { NetGuard } from '../src/main/security/netGuard';
import { defaultSettings, mergeSettings, type Settings } from '../src/shared/settings';
import { route } from '../src/main/assistant/router';
import { systemPrompt } from '../src/main/assistant/style';
import type { UpdateStatus } from '../src/shared/types';

const ctx = { session: {}, apps: [] };
const first = (t: string) => { const r = route(t, ctx); return r.kind === 'commands' ? r.steps[0] : null; };

describe('versions', () => {
  it('compares semantic versions', () => {
    expect(compareVersions('0.8.0', '0.7.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.7.0', '0.7.0')).toBe(0);
    expect(compareVersions('0.6.10', '0.7.0')).toBeLessThan(0);
    expect(compareVersions('garbage', '0.1.0')).toBe(0);
  });
  it('picks the versioned installer, then the stable name, never other files', () => {
    const a = (name: string) => ({ name, size: 1, browser_download_url: 'x' });
    expect(pickInstaller({ tag_name: 'v1', assets: [a('notes.txt'), a('Clickyy-AI-Setup.exe'), a('Clickyy-AI-Setup-1.0.0.exe')] })?.name).toBe('Clickyy-AI-Setup-1.0.0.exe');
    expect(pickInstaller({ tag_name: 'v1', assets: [a('Clickyy-AI-Setup.exe')] })?.name).toBe('Clickyy-AI-Setup.exe');
    expect(pickInstaller({ tag_name: 'v1', assets: [a('evil.exe')] })).toBeNull();
  });
  it('summarizes markdown release notes', () => {
    expect(notesSummary('## New\n- **Built-in AI**\n- Turbo `mode`')).toBe('New · Built-in AI · Turbo mode');
  });
});

function fakeGithub(opts: { tag: string; body: Buffer; digest?: string; redirectTo?: string }) {
  const seen: string[] = [];
  const impl = (async (input: string | URL) => {
    const url = String(input);
    seen.push(url);
    if (url.includes('/releases/latest')) {
      return Response.json({ tag_name: opts.tag, body: '- Faster', html_url: 'https://github.com/x', assets: [{ name: `Clickyy-AI-Setup-${opts.tag.replace('v', '')}.exe`, size: opts.body.length, browser_download_url: 'https://github.com/chinmoyy12/clickyy-ai/releases/download/a.exe', digest: opts.digest }] });
    }
    if (url.startsWith('https://github.com/')) return new Response(null, { status: 302, headers: { location: opts.redirectTo ?? 'https://release-assets.githubusercontent.com/file' } });
    if (url.startsWith('https://release-assets.githubusercontent.com/')) return new Response(new Uint8Array(opts.body), { headers: { 'content-type': 'application/octet-stream' } });
    return new Response('no', { status: 500 });
  }) as unknown as typeof fetch;
  return { impl, seen };
}

function makeUpdater(gh: ReturnType<typeof fakeGithub>, over: { offline?: boolean; version?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'clk-upd-'));
  const launched: Array<{ file: string; args: string[] }> = [];
  const states: UpdateStatus[] = [];
  let quit = 0;
  const u = new Updater({ version: over.version ?? '0.7.0', fetch: gh.impl, downloadDir: dir, launch: async (file, args) => { launched.push({ file, args }); }, quit: () => { quit++; }, offline: () => !!over.offline, onChange: (s) => states.push(s) });
  return { u, dir, launched, states, quits: () => quit };
}

describe('in-app updater', () => {
  const body = Buffer.from('installer-bytes'.repeat(100));
  const digest = `sha256:${createHash('sha256').update(body).digest('hex')}`;

  it('offers a newer release', async () => {
    const { u } = makeUpdater(fakeGithub({ tag: 'v0.8.0', body, digest }));
    const st = await u.check(false);
    expect(st.state).toBe('available');
    expect(st.latest).toBe('0.8.0');
    expect(st.message).toMatch(/0\.8\.0 is available/);
  });
  it('says up to date on the same version, and respects a skipped version unless asked', async () => {
    expect((await makeUpdater(fakeGithub({ tag: 'v0.7.0', body, digest })).u.check()).state).toBe('none');
    const { u } = makeUpdater(fakeGithub({ tag: 'v0.8.0', body, digest }));
    expect((await u.check(false, '0.8.0')).state).toBe('none');
    expect((await u.check(true, '0.8.0')).state).toBe('available');
  });
  it('never contacts anything in Strict Offline mode', async () => {
    const gh = fakeGithub({ tag: 'v0.8.0', body, digest });
    const { u } = makeUpdater(gh, { offline: true });
    expect((await u.check()).state).toBe('disabled');
    expect(gh.seen).toEqual([]);
  });
  it('downloads, verifies the checksum, runs the silent installer and quits', async () => {
    const t = makeUpdater(fakeGithub({ tag: 'v0.8.0', body, digest }));
    await t.u.check();
    await t.u.install();
    expect(t.launched).toHaveLength(1);
    expect(t.launched[0].args).toEqual(['/S', '--force-run']);
    expect(t.states.some((s) => s.state === 'ready')).toBe(true);
    await new Promise((r) => setTimeout(r, 700));
    expect(t.quits()).toBe(1);
  });
  it('deletes a file whose checksum does not match and does not install it', async () => {
    const t = makeUpdater(fakeGithub({ tag: 'v0.8.0', body, digest: `sha256:${'0'.repeat(64)}` }));
    await t.u.check();
    await expect(t.u.install()).rejects.toThrow(/checksum/);
    expect(t.launched).toEqual([]);
    expect(readdirSync(t.dir)).toEqual([]);
    expect(t.u.status.state).toBe('error');
  });
  it('refuses a release without a published checksum', async () => {
    const t = makeUpdater(fakeGithub({ tag: 'v0.8.0', body }));
    await t.u.check();
    await expect(t.u.install()).rejects.toThrow(/no published checksum/);
  });
  it('refuses redirects to hosts other than GitHub', async () => {
    const t = makeUpdater(fakeGithub({ tag: 'v0.8.0', body, digest, redirectTo: 'https://evil.example.com/x.exe' }));
    await t.u.check();
    await expect(t.u.install()).rejects.toThrow(/Refused to download from evil.example.com/);
    expect(t.launched).toEqual([]);
  });
});

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  killed = false;
  kill() { this.killed = true; this.exitCode = 0; this.emit('exit', 0); return true; }
}

function engine(over: { healthy?: boolean; crash?: boolean } = {}) {
  const spawned: Array<{ file: string; args: string[]; opts: Record<string, unknown>; child: FakeChild }> = [];
  const e = new BuiltinEngine({ server: 'C:/x/llama-server.exe', model: 'C:/x/m.gguf' }, {
    spawn: (file, args, opts) => {
      const child = new FakeChild();
      spawned.push({ file, args, opts, child });
      if (over.crash) setTimeout(() => { child.exitCode = 1; child.stderr.emit('data', 'error: failed to load model'); child.emit('exit', 1); }, 5);
      return child as never;
    },
    fetch: (async () => (over.healthy === false ? new Response('loading', { status: 503 }) : new Response('{}'))) as unknown as typeof fetch,
    freePort: async () => 45678,
    startTimeoutMs: 300,
  });
  return { e, spawned };
}

describe('built-in AI engine', () => {
  it('starts llama-server on loopback with a private key and no shell', async () => {
    const { e, spawned } = engine();
    expect(await e.ensure()).toBe(true);
    expect(e.state).toBe('ready');
    const { args, opts } = spawned[0];
    expect(args.slice(args.indexOf('--host'), args.indexOf('--host') + 2)).toEqual(['--host', '127.0.0.1']);
    expect(args[args.indexOf('--api-key') + 1]).toBe(e.token);
    expect(e.token).toMatch(/^[a-f0-9]{48}$/);
    expect(opts.shell).toBe(false);
    expect(e.baseUrl).toBe('http://127.0.0.1:45678/v1');
    await e.ensure();
    expect(spawned).toHaveLength(1);
    e.stop();
    expect(spawned[0].child.killed).toBe(true);
    expect(e.state).toBe('off');
  });
  it('reports a crash while loading', async () => {
    const { e } = engine({ crash: true, healthy: false });
    expect(await e.ensure()).toBe(false);
    expect(e.state).toBe('error');
    expect(e.message).toMatch(/failed to load model/);
  });
  it('gives up when the model never becomes ready', async () => {
    const { e, spawned } = engine({ healthy: false });
    expect(await e.ensure()).toBe(false);
    expect(e.message).toMatch(/took too long/);
    expect(spawned[0].child.killed).toBe(true);
  });
  it('is unavailable when the files are not bundled', async () => {
    const e = new BuiltinEngine(null);
    expect(e.available).toBe(false);
    expect(await e.ensure()).toBe(false);
  });
});

function manager(patch: Parameters<typeof mergeSettings>[1], bodies: unknown[] = []) {
  let settings: Settings = mergeSettings(defaultSettings(), patch);
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/health')) return new Response('{}');
    if (url.endsWith('/api/tags')) throw new TypeError('fetch failed');
    if (url.endsWith('/chat/completions')) { bodies.push(JSON.parse(String(init?.body))); return Response.json({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] }); }
    return Response.json({});
  }) as unknown as typeof fetch;
  const guard = new NetGuard(() => settings.ai.policy, () => {}, impl);
  const pm = new ProviderManager(() => settings, new MemorySecretStore(), guard, () => false, () => false, 300);
  const e = new BuiltinEngine({ server: 's', model: 'm' }, { spawn: () => new FakeChild() as never, fetch: guard.fetchFor('local-model'), freePort: async () => 40000, startTimeoutMs: 300 });
  pm.setBuiltin(e);
  return { pm, e, set: (p: Parameters<typeof mergeSettings>[1]) => { settings = mergeSettings(settings, p); } };
}

describe('built-in AI routing', () => {
  it('is the default local model, even in Strict Offline', async () => {
    const { pm } = manager({ ai: { policy: 'strict_offline' } });
    await pm.ensureLocal();
    expect(pm.candidates().map((p) => p.id)).toEqual(['builtin']);
    expect(pm.status().builtin?.state).toBe('ready');
    expect(pm.status().activeLabel).toMatch(/^Built-in AI/);
  });
  it('can be switched off', async () => {
    const { pm } = manager({ ai: { local: { builtin: false } } });
    await pm.ensureLocal();
    expect(pm.candidates()).toEqual([]);
  });
  it('sends the mode: Fast is short without thinking, Turbo thinks with a big budget', async () => {
    const bodies: Array<Record<string, any>> = [];
    const { pm, set } = manager({ ai: { mode: 'fast' } }, bodies);
    await pm.ensureLocal();
    const req = { system: 's', items: [{ role: 'user' as const, text: 'hi' }], tools: [], signal: new AbortController().signal };
    await pm.candidates()[0].chat(req);
    set({ ai: { mode: 'turbo' } });
    await pm.candidates()[0].chat(req);
    expect(bodies[0].max_tokens).toBe(400);
    expect(bodies[0].chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(bodies[1].max_tokens).toBe(4096);
    expect(bodies[1].chat_template_kwargs).toEqual({ enable_thinking: true });
  });
  it('uses the mode for cloud budgets too', () => {
    const secrets = new MemorySecretStore();
    secrets.set('anthropic', 'k');
    let settings = mergeSettings(defaultSettings(), { ai: { mode: 'turbo' } });
    const pm = new ProviderManager(() => settings, secrets, new NetGuard(() => settings.ai.policy), () => true);
    expect((pm.cloud() as unknown as { opts: { maxTokens: number; effort: string } }).opts).toMatchObject({ maxTokens: 8192, effort: 'high' });
    settings = mergeSettings(settings, { ai: { mode: 'fast' } });
    expect((pm.cloud() as unknown as { opts: { maxTokens: number; effort: string } }).opts).toMatchObject({ maxTokens: 700, effort: 'low' });
  });
});

describe('OpenAI-compatible extras', () => {
  it('retries once without optional fields when the server rejects them', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const impl = (async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      bodies.push(b);
      if (b.reasoning_effort) return new Response('unknown field', { status: 400 });
      return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
    }) as unknown as typeof fetch;
    const p = new OpenAICompatProvider({ id: 'x', label: 'X', kind: 'cloud', baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm', timeoutMs: 5000, maxTokens: 100, fetch: impl, extraBody: { reasoning_effort: 'high' } });
    const r = await p.chat({ system: 's', items: [{ role: 'user', text: 'q' }], tools: [], signal: new AbortController().signal });
    expect(r.text).toBe('ok');
    expect(bodies).toHaveLength(2);
    expect(bodies[1].reasoning_effort).toBeUndefined();
  });
});

describe('mode and update commands', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['turbo mode', { mode: 'turbo' }], ['switch to fast mode', { mode: 'fast' }], ['balanced mode', { mode: 'balanced' }],
    ['go turbo', { mode: 'turbo' }], ['think harder', { mode: 'turbo' }], ['enable quick mode', { mode: 'fast' }],
    ['what response mode are you in', {}],
  ];
  it.each(cases)('"%s"', (text, params) => {
    expect(first(text)).toMatchObject({ commandId: 'conv.ai_mode', resolution: { kind: 'builtin', builtin: 'ai_mode', params } });
  });
  it('keeps personality modes separate', () => {
    expect(first('switch to work mode')?.commandId).toBe('conv.mode');
    expect(first('normal mode')?.commandId).not.toBe('conv.ai_mode');
  });
  it.each(['check for updates', 'is there a new version', 'update yourself', 'any updates available'])('"%s" checks for updates', (t) => {
    expect(first(t)?.resolution).toMatchObject({ kind: 'builtin', builtin: 'check_updates' });
  });
  it('tells its version', () => {
    expect(first('what version are you')?.resolution).toMatchObject({ builtin: 'version' });
  });
  it('puts the Turbo instruction in the system prompt only in Turbo', () => {
    const base = { memories: [], toolNames: [], policyLabel: 'x' };
    expect(systemPrompt(mergeSettings(defaultSettings(), { ai: { mode: 'turbo' } }), base)).toMatch(/Response mode: Turbo/);
    expect(systemPrompt(defaultSettings(), base)).not.toMatch(/Response mode/);
  });
  it('talks back every time by default', () => {
    expect(defaultSettings().speech.talkBack).toBe('always');
    expect(defaultSettings().ai.local.builtin).toBe(true);
    expect(defaultSettings().updates.autoCheck).toBe(true);
    expect(existsSync).toBeTypeOf('function');
  });
});

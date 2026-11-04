import { describe, expect, it, vi } from 'vitest';
import { setup } from './helpers';
import { Assistant } from '../src/main/assistant/orchestrator';
import { Scheduler } from '../src/main/scheduler';
import type { ProviderManager } from '../src/main/providers/manager';
import { ProviderError, type ChatRequest, type LlmProvider, type LlmTurn } from '../src/main/providers/types';
import type { AssistantEvent } from '../src/shared/types';
import type { DeepPartial, Settings } from '../src/shared/settings';

class MockProvider implements LlmProvider {
  calls: ChatRequest[] = [];
  constructor(readonly id: string, readonly kind: 'local' | 'cloud', private script: Array<LlmTurn | Error>) {}
  get label() { return `${this.id} mock`; }
  model = 'mock';
  async check() { return { ok: true }; }
  async chat(req: ChatRequest) {
    this.calls.push({ ...req, items: [...req.items] });
    const next = this.script.shift() ?? { text: 'ok', toolCalls: [], stop: 'end' as const };
    if (next instanceof Error) throw next;
    if (next.text) req.onText?.(next.text);
    return next;
  }
}

async function make(providers: LlmProvider[], patch: DeepPartial<Settings> = {}) {
  const s = await setup(patch);
  const events: AssistantEvent[] = [];
  const failures: string[] = [];
  const manager = {
    candidates: () => providers.filter((p) => !failures.includes(p.id)),
    status: () => ({ policy: s.repos.settings.get().ai.policy, online: true, local: { configured: false, ready: false, model: '', models: [], message: 'No local model runtime found.' }, cloud: { provider: 'anthropic', model: 'm', hasKey: false, allowed: false }, active: providers[0]?.kind ?? 'none' }),
    reportFailure: (id: string) => failures.push(id),
    reportSuccess: () => {},
    setCloudMessage: () => {},
  } as unknown as ProviderManager;
  const ui: string[] = [];
  const assistant = new Assistant({
    repos: s.repos, registry: s.registry, executor: s.executor, broker: s.broker, bridge: s.bridge, platform: s.platform, providers: manager,
    scheduler: { schedule: () => {}, cancel: () => {} },
    emit: (e) => events.push(e), settings: () => s.repos.settings.get(), updateSettings: (p) => s.repos.settings.update(p),
    speechStatus: () => ({ state: 'ready' }), uiCommand: (c) => ui.push(c),
  });
  return { ...s, assistant, events, ui };
}

describe('assistant orchestration', () => {
  it('handles deterministic commands with no model at all', async () => {
    const t = await make([]);
    const r = await t.assistant.submit('Hey Clickyy, set the volume to thirty percent', 'voice');
    expect(r).toMatchObject({ text: 'Done. Volume is at 30 percent.', source: 'deterministic' });
    expect(t.bridge.volume.level).toBe(30);
  });

  it('runs compound commands in order and resolves follow-up context', async () => {
    const t = await make([]);
    t.repos.apps.upsert({ name: 'Spotify', aliases: ['spotify'], kind: 'uri', target: 'spotify:', processName: 'Spotify', enabled: true });
    t.bridge.windows.push({ hwnd: 500, title: 'Spotify Premium', pid: 5, process: 'Spotify', minimized: false, maximized: false });
    const r1 = await t.assistant.submit('Open Spotify', 'voice');
    expect(r1.text).toBe('Spotify is open.');
    const r2 = await t.assistant.submit('Play my focus playlist', 'voice');
    expect(r2.text).toMatch(/Spotify search for focus playlist/);
    expect(t.platform.opened).toContain('spotify:search:focus%20playlist');
    const r3 = await t.assistant.submit('And lower the volume to thirty percent', 'voice');
    expect(r3.text).toBe('Done. Volume is at 30 percent.');
    const r4 = await t.assistant.submit('maximize it', 'voice');
    expect(r4.text).toBe('Maximized Spotify Premium.');
  });

  it('is honest when no language model is available', async () => {
    const t = await make([], { ai: { policy: 'strict_offline' } });
    const r = await t.assistant.submit('tell me something interesting', 'text');
    expect(r.text).toMatch(/can't answer open questions right now because no local language model/);
  });

  it('uses the local model for conversation and exposes only registry tools', async () => {
    const local = new MockProvider('ollama', 'local', [{ text: 'Octopuses have three hearts.', toolCalls: [], stop: 'end' }]);
    const t = await make([local]);
    const r = await t.assistant.submit('tell me something interesting', 'text');
    expect(r).toMatchObject({ text: 'Octopuses have three hearts.', source: 'local_llm' });
    const names = local.calls[0].tools.map((x) => x.name);
    expect(names).toContain('audio__set_volume');
    expect(names).not.toContain('memory__save');
    expect(local.calls[0].system).toMatch(/You are an AI, not a human/);
    expect(t.events.some((e) => e.type === 'reply_delta')).toBe(true);
  });

  it('executes model tool calls through the executor and feeds results back', async () => {
    const local = new MockProvider('ollama', 'local', [
      { text: '', toolCalls: [{ id: 't1', name: 'audio__set_volume', input: { level: 15 } }], stop: 'tool_use' },
      { text: 'Volume is at 15 percent now.', toolCalls: [], stop: 'end' },
    ]);
    const t = await make([local]);
    const r = await t.assistant.submit('could things be more peaceful in here, maybe fifteen', 'text');
    expect(t.bridge.volume.level).toBe(15);
    expect(r.text).toBe('Volume is at 15 percent now.');
    const toolItem = local.calls[1].items.find((i) => i.role === 'tool');
    expect(toolItem && toolItem.role === 'tool' && JSON.parse(toolItem.results[0].content).ok).toBe(true);
  });

  it('does not let the model bypass confirmation or call unknown tools', async () => {
    const local = new MockProvider('ollama', 'local', [
      { text: '', toolCalls: [{ id: 't1', name: 'power__action', input: { action: 'shutdown' } }, { id: 't2', name: 'shell__run', input: { cmd: 'del' } }], stop: 'tool_use' },
      { text: "I couldn't do that.", toolCalls: [], stop: 'end' },
    ]);
    const t = await make([local], { tools: { permissions: { power: true } } });
    t.autoConfirm(false);
    await t.assistant.submit('the model decides to shut down', 'text');
    expect(t.confirmations).toHaveLength(1);
    expect(t.platform.spawned).toHaveLength(0);
    const results = local.calls[1].items.find((i) => i.role === 'tool');
    expect(results && results.role === 'tool' && results.results.map((x) => x.isError)).toEqual([true, true]);
  });

  it('falls back to the next provider when one fails, and reports cloud use', async () => {
    const cloud = new MockProvider('anthropic', 'cloud', [new ProviderError('The Anthropic API key was rejected.', 'auth')]);
    const local = new MockProvider('ollama', 'local', [{ text: 'Local answer.', toolCalls: [], stop: 'end' }]);
    const t = await make([cloud, local]);
    const r = await t.assistant.submit('explain black holes', 'voice');
    expect(r.text).toBe('Local answer.');
    expect(t.events.some((e) => e.type === 'notice' && /Sending your transcribed request to anthropic mock/.test(e.text))).toBe(true);
    expect(t.events.some((e) => e.type === 'notice' && /failed/.test(e.text))).toBe(true);
    // The failed exchange is not left in the context sent to the next provider.
    expect(local.calls[0].items.filter((i) => i.role === 'user')).toHaveLength(1);
  });

  it('reports a clear error when every provider fails (e.g. API timeout)', async () => {
    const cloud = new MockProvider('anthropic', 'cloud', [new ProviderError('The cloud request timed out.', 'timeout')]);
    const t = await make([cloud]);
    const r = await t.assistant.submit('what is the meaning of life', 'text');
    expect(r.text).toMatch(/timed out/);
  });

  it('keeps multi-turn context for follow-ups', async () => {
    const local = new MockProvider('ollama', 'local', [{ text: 'Paris.', toolCalls: [], stop: 'end' }, { text: 'About 2.1 million.', toolCalls: [], stop: 'end' }]);
    const t = await make([local]);
    await t.assistant.submit('what is the capital of france', 'text');
    await t.assistant.submit('how many people live there', 'text');
    const texts = local.calls[1].items.map((i) => (i.role === 'tool' ? 'tool' : i.text));
    expect(texts).toEqual(['what is the capital of france', 'Paris.', 'how many people live there']);
  });

  it('new session clears context; emergency stop cancels, stops speech and mutes mic', async () => {
    const local = new MockProvider('ollama', 'local', [{ text: 'A', toolCalls: [], stop: 'end' }, { text: 'B', toolCalls: [], stop: 'end' }]);
    const t = await make([local]);
    await t.assistant.submit('question one about stars', 'text');
    t.assistant.newSession();
    await t.assistant.submit('question two about planets', 'text');
    expect(local.calls[1].items).toHaveLength(1);
    t.assistant.emergencyStop();
    expect(t.events.some((e) => e.type === 'speech_control' && e.action === 'stop')).toBe(true);
    expect(t.ui).toContain('mic_mute');
  });

  it('cancels an in-flight request when new input arrives', async () => {
    const slow: LlmProvider = { id: 'ollama', kind: 'local', label: 'slow', model: 'm', check: async () => ({ ok: true }),
      chat: (req) => new Promise((_, rej) => req.signal.addEventListener('abort', () => rej(new ProviderError('Cancelled', 'cancelled')))) };
    const t = await make([slow]);
    const first = t.assistant.submit('a long philosophical question', 'text');
    await new Promise((r) => setTimeout(r, 10));
    await t.assistant.submit('what time is it', 'text');
    expect((await first).text).toMatch(/cancelled|Stopped|never mind/i);
  });

  it('persists conversation history only when enabled, with redaction', async () => {
    const t = await make([]);
    await t.assistant.submit('what time is it', 'text');
    expect(t.repos.conversations.list()).toHaveLength(1);
    const off = await make([], { privacy: { saveHistory: false } });
    await off.assistant.submit('what time is it', 'text');
    expect(off.repos.conversations.list()).toHaveLength(0);
  });

  it('handles built-ins: identity is honest, speaking rate changes persist, mode switch', async () => {
    const t = await make([]);
    expect((await t.assistant.submit('are you human', 'voice')).text).toMatch(/AI assistant.*not a person/);
    await t.assistant.submit('speak a little slower', 'voice');
    expect(t.repos.settings.get().speech.rate).toBe(0.9);
    await t.assistant.submit("let's switch to work mode", 'voice');
    expect(t.repos.settings.get().personality.profile).toBe('professional');
    const stop = await t.assistant.submit('stop talking', 'voice');
    expect(stop.speech).toBe('');
  });

  it('runs routines step by step and reports partial failures', async () => {
    const t = await make([]);
    t.repos.routines.upsert({ name: 'Coding mode', phrases: ['coding mode'], enabled: true, steps: [
      { tool: 'audio.set_volume', args: { level: 20 }, label: 'Set volume' },
      { tool: 'apps.open', args: { app: 'nonexistent editor' }, label: 'Open editor' },
      { tool: 'timers.create', args: { seconds: 1500, focus: true }, label: 'Focus timer' },
    ] });
    const r = await t.assistant.submit('coding mode', 'voice');
    expect(r.text).toMatch(/finished with problems. 2 steps worked; these didn't: open editor/);
    expect(t.bridge.volume.level).toBe(20);
    expect(t.events.filter((e) => e.type === 'tool' && e.call.status === 'planned')).toHaveLength(3);
  });
});

describe('scheduler', () => {
  it('fires due reminders once and marks them done', async () => {
    vi.useFakeTimers();
    const s = await setup();
    const fired: string[] = [];
    const sched = new Scheduler(s.repos.reminders, (r) => fired.push(r.text));
    const r = s.repos.reminders.add('Stretch', Date.now() + 5000, 'reminder');
    sched.schedule(r.id, r.dueAt);
    vi.advanceTimersByTime(4000);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1500);
    expect(fired).toEqual(['Stretch']);
    expect(s.repos.reminders.pending()).toHaveLength(0);
    vi.useRealTimers();
  });
  it('restores pending reminders after restart', async () => {
    const s = await setup();
    s.repos.reminders.add('Overdue', Date.now() - 120_000, 'reminder');
    const late: boolean[] = [];
    const sched = new Scheduler(s.repos.reminders, (_r, l) => late.push(l));
    sched.restore();
    await new Promise((r) => setTimeout(r, 20));
    expect(late).toEqual([true]);
  });
});

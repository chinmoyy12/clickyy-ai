import { describe, expect, it } from 'vitest';
import { OllamaProvider } from '../src/main/providers/ollama';
import { OpenAICompatProvider } from '../src/main/providers/openaiCompat';
import { AnthropicProvider } from '../src/main/providers/anthropic';
import { orderProviders, ProviderManager } from '../src/main/providers/manager';
import { MemorySecretStore } from '../src/main/security/secrets';
import { PROVIDER_PRESETS, resolveBaseUrl } from '../src/shared/providers';
import { NetGuard } from '../src/main/security/netGuard';
import { defaultSettings, mergeSettings } from '../src/shared/settings';
import type { LlmProvider } from '../src/main/providers/types';

const sig = () => new AbortController().signal;
const ndjson = (lines: object[]) => new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });

describe('Ollama adapter', () => {
  it('reports missing runtime with install guidance', async () => {
    const p = new OllamaProvider('http://127.0.0.1:11434', 'llama3.2', 1000, (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch);
    const r = await p.check();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Install Ollama/);
  });
  it('reports a model that is not pulled', async () => {
    const p = new OllamaProvider('http://127.0.0.1:11434', 'qwen3', 1000, (async () => Response.json({ models: [{ name: 'llama3.2:latest' }] })) as unknown as typeof fetch);
    expect(await p.check()).toMatchObject({ ok: false, models: ['llama3.2:latest'], message: expect.stringMatching(/ollama pull qwen3/) });
  });
  it('streams text and tool calls', async () => {
    let body: { tools: unknown[]; messages: unknown[] } | null = null;
    const p = new OllamaProvider('http://127.0.0.1:11434', 'llama3.2', 5000, (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return ndjson([{ message: { content: 'Sure, ' } }, { message: { content: 'one moment.', tool_calls: [{ function: { name: 'audio__set_volume', arguments: { level: 20 } } }] } }, { done: true, done_reason: 'stop' }]);
    }) as unknown as typeof fetch);
    const deltas: string[] = [];
    const turn = await p.chat({ system: 'sys', items: [{ role: 'user', text: 'quieter' }], tools: [{ name: 'audio__set_volume', description: 'd', parameters: { type: 'object' } }], signal: sig(), onText: (d) => deltas.push(d) });
    expect(deltas.join('')).toBe('Sure, one moment.');
    expect(turn.toolCalls).toEqual([{ id: 'ollama_0', name: 'audio__set_volume', input: { level: 20 } }]);
    expect(turn.stop).toBe('tool_use');
    expect(body!.tools).toHaveLength(1);
  });
  it('retries on CPU after a GPU/CUDA fault and keeps using CPU', async () => {
    OllamaProvider.resetDeviceMemory();
    const bodies: Array<{ options?: { num_gpu?: number } }> = [];
    const p = new OllamaProvider('http://127.0.0.1:11434', 'llama3.2', 5000, (async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      bodies.push(b);
      if (b.options?.num_gpu !== 0) return new Response(JSON.stringify({ error: 'an error was encountered while running the model: CUDA error: an illegal instruction was encountered' }), { status: 500 });
      return ndjson([{ message: { content: 'Fine on CPU.' } }, { done: true }]);
    }) as unknown as typeof fetch);
    const req = { system: 's', items: [{ role: 'user' as const, text: 'hi' }], tools: [], signal: sig() };
    expect((await p.chat(req)).text).toBe('Fine on CPU.');
    expect((await p.chat(req)).text).toBe('Fine on CPU.');
    expect(bodies.map((b) => b.options?.num_gpu)).toEqual([undefined, 0, 0]);
    OllamaProvider.resetDeviceMemory();
  });
  it('does not retry ordinary errors, and honors CPU-only mode', async () => {
    OllamaProvider.resetDeviceMemory();
    let calls = 0;
    const p = new OllamaProvider('http://127.0.0.1:11434', 'llama3.2', 5000, (async () => { calls++; return new Response('{"error":"model not found"}', { status: 404 }); }) as unknown as typeof fetch);
    await expect(p.chat({ system: 's', items: [{ role: 'user', text: 'hi' }], tools: [], signal: sig() })).rejects.toThrow(/404/);
    expect(calls).toBe(1);
    let sent: { options?: { num_gpu?: number; num_ctx?: number }; keep_alive?: string } = {};
    const cpu = new OllamaProvider('http://127.0.0.1:11434', 'llama3.2', 5000, (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return ndjson([{ done: true }]); }) as unknown as typeof fetch, 'cpu');
    await cpu.chat({ system: 's', items: [{ role: 'user', text: 'hi' }], tools: [], signal: sig() });
    expect(sent).toMatchObject({ keep_alive: '30m', options: { num_gpu: 0, num_ctx: 8192 } });
    expect('tools' in sent).toBe(false);
  });
  it('is usable in strict offline mode (loopback)', async () => {
    const guard = new NetGuard(() => 'strict_offline', () => {}, (async () => Response.json({ models: [{ name: 'llama3.2:latest' }] })) as unknown as typeof fetch);
    const p = new OllamaProvider('http://127.0.0.1:11434', 'llama3.2', 1000, guard.fetchFor('local'));
    expect((await p.check()).ok).toBe(true);
  });
});

const compat = (f: unknown, over: Partial<ConstructorParameters<typeof OpenAICompatProvider>[0]> = {}) =>
  new OpenAICompatProvider({ id: 'gemini', label: 'Google Gemini', kind: 'cloud', baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm', timeoutMs: 5000, maxTokens: 100, fetch: f as typeof fetch, ...over });
const sseBody = (chunks: object[]) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

describe('OpenAI-compatible adapter (OpenAI, Gemini, Groq, OpenRouter, Mistral, DeepSeek, xAI, LM Studio)', () => {
  it('maps invalid credentials to an auth error naming the provider', async () => {
    const p = compat(async () => new Response('{}', { status: 401 }));
    await expect(p.chat({ system: '', items: [{ role: 'user', text: 'hi' }], tools: [], signal: sig() })).rejects.toMatchObject({ code: 'auth', message: expect.stringMatching(/Google Gemini API key was rejected/) });
  });
  it('streams text and assembles incremental tool-call arguments', async () => {
    let sent: Record<string, unknown> = {};
    const p = compat(async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return sseBody([
        { choices: [{ delta: { content: 'Turning it ' } }] },
        { choices: [{ delta: { content: 'down.', tool_calls: [{ index: 0, id: 'c1', function: { name: 'audio__set_volume', arguments: '{"lev' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'el": 20}' } }] }, finish_reason: 'tool_calls' }] },
      ]);
    });
    const deltas: string[] = [];
    const t = await p.chat({ system: 's', items: [{ role: 'user', text: 'quieter' }], tools: [{ name: 'audio__set_volume', description: 'd', parameters: { type: 'object' } }], signal: sig(), onText: (d) => deltas.push(d) });
    expect(deltas).toEqual(['Turning it ', 'down.']);
    expect(t.toolCalls).toEqual([{ id: 'c1', name: 'audio__set_volume', input: { level: 20 } }]);
    expect(t.stop).toBe('tool_use');
    expect(sent).toMatchObject({ model: 'm', stream: true });
  });
  it('does not run tools from a truncated stream', async () => {
    const p = compat(async () => sseBody([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'files__trash', arguments: '{"pa' } }] }, finish_reason: 'length' }] }]));
    const t = await p.chat({ system: '', items: [{ role: 'user', text: 'x' }], tools: [], signal: sig() });
    expect(t.toolCalls).toEqual([]);
    expect(t.stop).toBe('max_tokens');
  });
  it('falls back to JSON when the server ignores streaming, tolerating invalid tool JSON', async () => {
    const p = compat(async () => Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'system__time', arguments: '{}' } }, { id: 'c2', function: { name: 'x__y', arguments: '{bad' } }] } }] }));
    const t = await p.chat({ system: '', items: [{ role: 'user', text: 'time?' }], tools: [], signal: sig() });
    expect(t.toolCalls[0]).toEqual({ id: 'c1', name: 'system__time', input: {} });
    expect(t.toolCalls[1].input).toEqual({ __invalid_json: true });
  });
  it('lists live models (OpenAI and Gemini shapes)', async () => {
    expect(await compat(async () => Response.json({ data: [{ id: 'b' }, { id: 'a' }] })).listModels()).toEqual(['a', 'b']);
    expect(await compat(async () => Response.json({ data: [{ id: 'models/gemini-2.5-flash' }] })).listModels()).toEqual(['gemini-2.5-flash']);
  });
  it('reports an unknown model during the connection test', async () => {
    const r = await compat(async () => Response.json({ data: [{ id: 'other' }] }), { model: 'missing' }).check();
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/isn't offered/) });
  });
  it('times out', async () => {
    const hang = ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' })))));
    await expect(compat(hang, { timeoutMs: 50 }).chat({ system: '', items: [{ role: 'user', text: 'hi' }], tools: [], signal: sig() })).rejects.toMatchObject({ code: 'timeout' });
  });
  it('refuses non-https remote base URLs but allows a localhost server', async () => {
    await expect(compat(fetch, { baseUrl: 'http://api.example.com/v1' }).chat({ system: '', items: [], tools: [], signal: sig() })).rejects.toThrow(/https/);
    const local = compat(async () => Response.json({ data: [{ id: 'qwen' }] }), { baseUrl: 'http://127.0.0.1:1234/v1', kind: 'local', apiKey: '', model: 'qwen' });
    expect((await local.check()).ok).toBe(true);
  });
  it('local OpenAI-compatible servers keep working in strict offline mode', async () => {
    const guard = new NetGuard(() => 'strict_offline', () => {}, (async () => Response.json({ data: [{ id: 'qwen' }] })) as unknown as typeof fetch);
    expect((await compat(guard.fetchFor('local'), { baseUrl: 'http://127.0.0.1:1234/v1', kind: 'local', model: 'qwen' }).check()).ok).toBe(true);
    expect((await compat(guard.fetchFor('cloud'), { baseUrl: 'https://api.openai.com/v1' }).check()).ok).toBe(false);
  });
});

describe('provider presets and fallback chain', () => {
  it('every preset has a documented https endpoint (or uses the official SDK)', () => {
    for (const [id, p] of Object.entries(PROVIDER_PRESETS)) {
      if (id === 'anthropic' || id === 'openai_compatible') continue;
      expect(p.baseUrl, id).toMatch(/^https:\/\//);
      expect(p.defaultModel, id).not.toBe('');
    }
    expect(resolveBaseUrl('gemini', '')).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(resolveBaseUrl('groq', 'https://proxy.example/v1/')).toBe('https://proxy.example/v1');
  });
  it('builds primary + fallback cloud providers only for keys that exist', () => {
    const secrets = new MemorySecretStore();
    secrets.set('gemini', 'g-key');
    secrets.set('groq', 'q-key');
    let settings = mergeSettings(defaultSettings(), { ai: { policy: 'online_preferred', allowCloudTranscripts: true, cloud: { provider: 'gemini', model: 'gemini-2.5-flash', fallbackProvider: 'groq' } } });
    const pm = new ProviderManager(() => settings, secrets, new NetGuard(() => settings.ai.policy), () => true);
    expect(pm.clouds().map((p) => p.id)).toEqual(['gemini', 'groq']);
    expect(pm.candidates().map((p) => p.label)).toEqual(['Google Gemini · gemini-2.5-flash', 'Groq · llama-3.3-70b-versatile']);
    settings = mergeSettings(settings, { ai: { cloud: { fallbackProvider: 'openai' } } });
    expect(pm.clouds().map((p) => p.id)).toEqual(['gemini']); // no OpenAI key → skipped
    settings = mergeSettings(settings, { ai: { policy: 'strict_offline' } });
    expect(pm.candidates()).toEqual([]);
  });
  it('starts Ollama when it is not running and waits until it answers', async () => {
    const settings = mergeSettings(defaultSettings(), { ai: { policy: 'strict_offline', local: { model: 'llama3.2' } } });
    let running = false;
    let starts = 0;
    const impl = (async () => {
      if (!running) throw new TypeError('fetch failed');
      return Response.json({ models: [{ name: 'llama3.2:latest' }] });
    }) as unknown as typeof fetch;
    const pm = new ProviderManager(() => settings, new MemorySecretStore(), new NetGuard(() => settings.ai.policy, () => {}, impl), () => false,
      () => { starts++; setTimeout(() => { running = true; }, 700); return true; }, 5000);
    expect(pm.candidates()).toEqual([]);
    await pm.ensureLocal();
    expect(starts).toBe(1);
    expect(pm.status().local.ready).toBe(true);
    expect(pm.candidates().map((p) => p.kind)).toEqual(['local']);
    await pm.ensureLocal(); // already ready: no second start
    expect(starts).toBe(1);
  });
  it('does not start anything when Ollama is not installed, and keeps the install hint', async () => {
    const settings = mergeSettings(defaultSettings(), { ai: { policy: 'smart_hybrid', local: { model: 'llama3.2' } } });
    const impl = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const pm = new ProviderManager(() => settings, new MemorySecretStore(), new NetGuard(() => settings.ai.policy, () => {}, impl), () => false, () => false, 1000);
    await pm.ensureLocal();
    expect(pm.status().local.ready).toBe(false);
    expect(pm.status().local.message).toMatch(/Install Ollama/);
  });
  it('uses an installed model when the configured one is missing', async () => {
    const settings = mergeSettings(defaultSettings(), { ai: { policy: 'strict_offline', local: { model: 'qwen3' } } });
    const impl = (async () => Response.json({ models: [{ name: 'nomic-embed-text:latest' }, { name: 'llama3.2:latest' }] })) as unknown as typeof fetch;
    const pm = new ProviderManager(() => settings, new MemorySecretStore(), new NetGuard(() => settings.ai.policy, () => {}, impl), () => false);
    await pm.refreshLocal();
    expect(pm.candidates().map((p) => p.label)).toEqual(['Ollama · llama3.2:latest']);
    expect(pm.status().local.message).toMatch(/Using llama3\.2:latest because qwen3/);
  });
  it('old settings with the custom provider still load', () => {
    const s = mergeSettings(defaultSettings(), { ai: { cloud: { provider: 'openai_compatible', baseUrl: 'https://x.example/v1' } } });
    expect(s.ai.cloud.fallbackProvider).toBe('none');
    expect(s.ai.local.runtime).toBe('ollama');
  });
});

describe('Anthropic adapter (official SDK, mocked transport)', () => {
  it('maps a 401 to an auth error without leaking the key', async () => {
    const f = (async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test-key-123456', model: 'claude-opus-5-5', timeoutMs: 5000, maxTokens: 256, effort: 'low', fetch: f });
    const err = await p.chat({ system: 's', items: [{ role: 'user', text: 'hi' }], tools: [], signal: sig() }).catch((e) => e);
    expect(err).toMatchObject({ code: 'auth' });
    expect(String(err.message)).not.toContain('sk-ant-test-key');
  });
  it('is blocked by strict offline mode', async () => {
    const guard = new NetGuard(() => 'strict_offline', () => {}, fetch);
    const p = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5-5', timeoutMs: 5000, maxTokens: 256, effort: 'low', fetch: guard.fetchFor('cloud') });
    await expect(p.chat({ system: 's', items: [{ role: 'user', text: 'hi' }], tools: [], signal: sig() })).rejects.toMatchObject({ code: 'offline_policy' });
  });
  it('parses a streamed response with a tool call', async () => {
    let sent: Record<string, unknown> = {};
    const sse = [
      { type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Setting it now.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'audio__set_volume', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"level": 25}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 12 } },
      { type: 'message_stop' },
    ].map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
    const f = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    const p = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5-5', timeoutMs: 5000, maxTokens: 256, effort: 'low', fetch: f });
    const deltas: string[] = [];
    const t = await p.chat({ system: 'sys', items: [{ role: 'user', text: 'volume 25' }], tools: [{ name: 'audio__set_volume', description: 'd', parameters: { type: 'object', properties: { level: { type: 'number' } } } }], signal: sig(), onText: (d) => deltas.push(d) });
    expect(deltas.join('')).toBe('Setting it now.');
    expect(t.toolCalls).toEqual([{ id: 'tu1', name: 'audio__set_volume', input: { level: 25 } }]);
    expect(t.stop).toBe('tool_use');
    expect(sent).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'low' } });
  });
});

describe('routing policy', () => {
  const local = { id: 'ollama', kind: 'local' } as LlmProvider;
  const cloud = { id: 'anthropic', kind: 'cloud' } as LlmProvider;
  const s = (policy: 'strict_offline' | 'smart_hybrid' | 'online_preferred', consent: boolean, fallbackToLocal = true) =>
    mergeSettings(defaultSettings(), { ai: { policy, allowCloudTranscripts: consent, cloud: { fallbackToLocal } } });

  it('strict offline never uses the cloud', () => {
    expect(orderProviders(s('strict_offline', true), local, cloud)).toEqual([local]);
    expect(orderProviders(s('strict_offline', true), null, cloud)).toEqual([]);
  });
  it('smart hybrid prefers local and needs consent for cloud', () => {
    expect(orderProviders(s('smart_hybrid', false), local, cloud)).toEqual([local]);
    expect(orderProviders(s('smart_hybrid', true), local, cloud)).toEqual([local, cloud]);
    expect(orderProviders(s('smart_hybrid', true), null, cloud)).toEqual([cloud]);
  });
  it('online preferred uses cloud first with optional local fallback', () => {
    expect(orderProviders(s('online_preferred', true), local, cloud)).toEqual([cloud, local]);
    expect(orderProviders(s('online_preferred', true, false), local, cloud)).toEqual([cloud]);
    expect(orderProviders(s('online_preferred', false), local, cloud)).toEqual([local]);
  });
});

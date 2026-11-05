import { ProviderError, withTimeout, type ChatRequest, type LlmProvider, type LlmTurn, type ProviderCheck } from './types';
import { OfflinePolicyError } from '../security/netGuard';

export interface OpenAICompatOptions {
  id: string;
  label: string;
  kind: 'cloud' | 'local';
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  fetch: typeof fetch;
  /** Extra headers some providers recommend (e.g. OpenRouter attribution). */
  headers?: Record<string, string>;
}

/**
 * Adapter for any service exposing the OpenAI-style /chat/completions API:
 * OpenAI, Google Gemini (OpenAI compatibility endpoint), Groq, OpenRouter,
 * Mistral, DeepSeek, xAI, LM Studio, llama.cpp server, vLLM…
 * Streams with server-sent events, including incremental tool-call arguments.
 */
export class OpenAICompatProvider implements LlmProvider {
  readonly id: string;
  readonly kind: 'cloud' | 'local';
  readonly label: string;
  readonly model: string;

  constructor(private o: OpenAICompatOptions) {
    this.id = o.id;
    this.kind = o.kind;
    this.model = o.model;
    this.label = `${o.label} · ${o.model}`;
  }

  private url(path: string) {
    const base = this.o.baseUrl.replace(/\/+$/, '');
    const loopback = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(base);
    if (!base || (!/^https:\/\//.test(base) && !loopback)) throw new ProviderError('The base URL must use https (or http on localhost).', 'bad_response');
    return `${base}${path}`;
  }

  private headers(json = false): Record<string, string> {
    return { ...(json ? { 'content-type': 'application/json' } : {}), ...(this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {}), ...this.o.headers };
  }

  async listModels(signal: AbortSignal = new AbortController().signal): Promise<string[]> {
    const r = await this.o.fetch(this.url('/models'), { headers: this.headers(), signal: withTimeout(signal, 10000) });
    if (r.status === 401 || r.status === 403) throw new ProviderError('The API key was rejected.', 'auth');
    if (!r.ok) throw new ProviderError(`Model list unavailable (HTTP ${r.status}).`, 'bad_response');
    const body = (await r.json()) as { data?: Array<{ id: string }>; models?: Array<{ id?: string; name?: string }> };
    const ids = (body.data ?? body.models ?? []).map((m) => (m as { id?: string }).id ?? (m as { name?: string }).name ?? '').filter(Boolean);
    return [...new Set(ids.map((id) => id.replace(/^models\//, '')))].sort();
  }

  async check(signal: AbortSignal = new AbortController().signal): Promise<ProviderCheck> {
    try {
      const models = await this.listModels(signal);
      if (this.model && models.length && !models.includes(this.model)) return { ok: false, models, message: `Model "${this.model}" isn't offered by this provider. Pick one from the list.` };
      return { ok: true, models };
    } catch (e) {
      if (e instanceof ProviderError) return { ok: false, message: e.message };
      return { ok: false, message: e instanceof OfflinePolicyError ? e.message : `Not reachable: ${(e as Error).message}` };
    }
  }

  private messages(req: ChatRequest): unknown[] {
    const messages: unknown[] = [{ role: 'system', content: req.system }];
    for (const it of req.items) {
      if (it.role === 'user') {
        messages.push(it.images?.length
          ? { role: 'user', content: [{ type: 'text', text: it.text }, ...it.images.map((b64) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }))] }
          : { role: 'user', content: it.text });
      }
      else if (it.role === 'assistant') messages.push({ role: 'assistant', content: it.text || null, ...(it.toolCalls?.length ? { tool_calls: it.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}) });
      else for (const r of it.results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    }
    return messages;
  }

  async chat(req: ChatRequest): Promise<LlmTurn> {
    const endpoint = this.url('/chat/completions');
    let res: Response;
    try {
      res = await this.o.fetch(endpoint, {
        method: 'POST',
        headers: { ...this.headers(true), accept: 'text/event-stream' },
        body: JSON.stringify({
          model: this.model, messages: this.messages(req), max_tokens: this.o.maxTokens, stream: true,
          ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
        }),
        signal: withTimeout(req.signal, this.o.timeoutMs),
      });
    } catch (e) {
      if (req.signal.aborted) throw new ProviderError('Cancelled', 'cancelled');
      if (e instanceof OfflinePolicyError) throw new ProviderError(e.message, 'offline_policy');
      throw new ProviderError(`I couldn't reach ${this.o.label}.`, (e as Error).name === 'TimeoutError' ? 'timeout' : this.kind === 'local' ? 'unavailable' : 'network');
    }
    if (res.status === 401 || res.status === 403) throw new ProviderError(`The ${this.o.label} API key was rejected. Check it in Settings, Credentials.`, 'auth');
    if (res.status === 429) throw new ProviderError(`${this.o.label} is rate limiting requests.`, 'rate_limit');
    if (res.status === 404) throw new ProviderError(`${this.o.label} doesn't know the model "${this.model}".`, 'bad_response');
    if (!res.ok) throw new ProviderError(`${this.o.label} error (HTTP ${res.status}): ${(await res.text().catch(() => '')).slice(0, 160)}`, 'bad_response');

    // Some servers ignore stream:true and answer with plain JSON.
    if (!(res.headers.get('content-type') ?? '').includes('event-stream')) return this.fromJson(await res.json(), req);
    return this.fromStream(res, req);
  }

  private fromJson(body: { choices?: Array<{ finish_reason?: string; message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> }, req: ChatRequest): LlmTurn {
    const choice = body.choices?.[0];
    if (!choice?.message) throw new ProviderError('The provider returned an empty response.', 'bad_response');
    const text = choice.message.content ?? '';
    if (text) req.onText?.(text);
    const toolCalls = (choice.message.tool_calls ?? []).map((tc) => ({ id: tc.id, name: tc.function.name, input: parseArgs(tc.function.arguments) }));
    return { text, toolCalls, stop: finish(choice.finish_reason, toolCalls.length) };
  }

  private async fromStream(res: Response, req: ChatRequest): Promise<LlmTurn> {
    let text = '';
    let finishReason: string | undefined;
    const calls = new Map<number, { id: string; name: string; args: string }>();
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let chunk: { choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>; error?: { message?: string } };
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }
          if (chunk.error) throw new ProviderError(chunk.error.message ?? 'Provider stream error', 'bad_response');
          const c = chunk.choices?.[0];
          if (!c) continue;
          if (c.delta?.content) {
            text += c.delta.content;
            req.onText?.(c.delta.content);
          }
          for (const tc of c.delta?.tool_calls ?? []) {
            const i = tc.index ?? calls.size;
            const cur = calls.get(i) ?? { id: '', name: '', args: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            calls.set(i, cur);
          }
          if (c.finish_reason) finishReason = c.finish_reason;
        }
      }
    } catch (e) {
      if (req.signal.aborted) throw new ProviderError('Cancelled', 'cancelled');
      throw e instanceof ProviderError ? e : new ProviderError(`Stream from ${this.o.label} failed: ${(e as Error).message}`, 'network');
    }
    // Never run tools from a response that was cut off mid-generation.
    const toolCalls = finishReason === 'length' ? [] : [...calls.entries()].sort(([a], [b]) => a - b).map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, input: parseArgs(c.args) }));
    return { text, toolCalls, stop: finish(finishReason, toolCalls.length) };
  }
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { __invalid_json: true };
  }
}

function finish(reason: string | null | undefined, toolCount: number): LlmTurn['stop'] {
  if (toolCount) return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  return 'end';
}

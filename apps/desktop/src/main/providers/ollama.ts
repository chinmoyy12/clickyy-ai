import { ProviderError, withTimeout, type ChatRequest, type LlmProvider, type LlmTurn, type ProviderCheck } from './types';

const GPU_FAULT = /cuda|cublas|ggml_cuda|illegal (instruction|memory)|out of memory|vram|gpu/i;

/** Set after a GPU/CUDA fault so later requests go straight to CPU (per model, for this app run). */
const cpuOnly = new Set<string>();

/** Local model via the Ollama HTTP API (loopback only, so it works in Strict Offline mode). */
export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama';
  readonly kind = 'local' as const;
  readonly label: string;

  constructor(private baseUrl: string, readonly model: string, private timeoutMs: number, private fetchImpl: typeof fetch, private device: 'auto' | 'cpu' | 'gpu' = 'auto') {
    this.label = model ? `Ollama · ${model}` : 'Ollama';
  }

  private options(): Record<string, unknown> {
    const cpu = this.device === 'cpu' || (this.device === 'auto' && cpuOnly.has(this.model));
    return { num_ctx: 8192, ...(cpu ? { num_gpu: 0 } : {}) };
  }

  /** Load the model into memory ahead of the first question (no tokens generated). */
  async warm(): Promise<void> {
    if (!this.model) return;
    await this.fetchImpl(new URL('/api/generate', this.baseUrl), {
      method: 'POST',
      body: JSON.stringify({ model: this.model, prompt: '', keep_alive: '30m', options: this.options() }),
      signal: AbortSignal.timeout(120000),
    }).catch(() => undefined);
  }

  async chat(req: ChatRequest): Promise<LlmTurn> {
    try {
      return await this.chatOnce(req);
    } catch (e) {
      // GPU driver / CUDA faults are common with older NVIDIA drivers: retry once on CPU and remember.
      if (e instanceof ProviderError && e.code === 'bad_response' && GPU_FAULT.test(e.message) && this.device === 'auto' && !cpuOnly.has(this.model)) {
        cpuOnly.add(this.model);
        return this.chatOnce(req);
      }
      throw e;
    }
  }

  static resetDeviceMemory() { cpuOnly.clear(); }

  async check(signal: AbortSignal = new AbortController().signal): Promise<ProviderCheck> {
    try {
      const r = await this.fetchImpl(new URL('/api/tags', this.baseUrl), { signal: withTimeout(signal, 2500) });
      if (!r.ok) return { ok: false, message: `Ollama responded with HTTP ${r.status}` };
      const body = (await r.json()) as { models?: Array<{ name: string }> };
      const models = (body.models ?? []).map((m) => m.name);
      if (!this.model) return { ok: false, models, message: models.length ? 'Ollama is running. Pick a model in Settings.' : 'Ollama is running but has no models. Run: ollama pull llama3.2' };
      const has = models.some((m) => m === this.model || m.split(':')[0] === this.model);
      return has ? { ok: true, models } : { ok: false, models, message: `Model ${this.model} is not installed. Run: ollama pull ${this.model}` };
    } catch {
      return { ok: false, message: `No local model runtime found at ${this.baseUrl}. Install Ollama from ollama.com, then pull a model.` };
    }
  }

  private async chatOnce(req: ChatRequest): Promise<LlmTurn> {
    const messages: unknown[] = [{ role: 'system', content: req.system }];
    for (const it of req.items) {
      if (it.role === 'user') messages.push({ role: 'user', content: it.text, ...(it.images?.length ? { images: it.images } : {}) });
      else if (it.role === 'assistant') messages.push({ role: 'assistant', content: it.text, ...(it.toolCalls?.length ? { tool_calls: it.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.input } })) } : {}) });
      else for (const r of it.results) messages.push({ role: 'tool', content: r.content, tool_name: r.name });
    }
    let res: Response;
    try {
      res = await this.fetchImpl(new URL('/api/chat', this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          keep_alive: '30m',
          options: this.options(),
          ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
        }),
        signal: withTimeout(req.signal, this.timeoutMs),
      });
    } catch (e) {
      if (req.signal.aborted) throw new ProviderError('Cancelled', 'cancelled');
      throw new ProviderError(`Local model is not reachable: ${(e as Error).message}`, (e as Error).name === 'TimeoutError' ? 'timeout' : 'unavailable');
    }
    if (!res.ok || !res.body) throw new ProviderError(`Local model error (HTTP ${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`, 'bad_response');

    let text = '';
    const toolCalls: LlmTurn['toolCalls'] = [];
    let doneReason = '';
    const reader = res.body.getReader();
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
          if (!line) continue;
          const chunk = JSON.parse(line) as { message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> }; done?: boolean; done_reason?: string; error?: string };
          if (chunk.error) throw new ProviderError(`Local model error: ${chunk.error}`, 'bad_response');
          if (chunk.message?.content) {
            text += chunk.message.content;
            req.onText?.(chunk.message.content);
          }
          for (const tc of chunk.message?.tool_calls ?? []) toolCalls.push({ id: `ollama_${toolCalls.length}`, name: tc.function.name, input: tc.function.arguments ?? {} });
          if (chunk.done) doneReason = chunk.done_reason ?? '';
        }
      }
    } catch (e) {
      if (req.signal.aborted) throw new ProviderError('Cancelled', 'cancelled');
      throw e instanceof ProviderError ? e : new ProviderError(`Local model stream failed: ${(e as Error).message}`, 'network');
    }
    return { text, toolCalls, stop: toolCalls.length ? 'tool_use' : doneReason === 'length' ? 'max_tokens' : 'end' };
  }
}

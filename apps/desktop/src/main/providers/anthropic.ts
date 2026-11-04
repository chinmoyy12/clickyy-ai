import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlockParam, BetaMessageParam, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { ProviderError, type ChatRequest, type LlmProvider, type LlmTurn, type ProviderCheck } from './types';
import { OfflinePolicyError } from '../security/netGuard';

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`) on the first-party API. */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
  maxTokens: number;
  effort: 'low' | 'medium' | 'high';
  fetch: typeof fetch;
}

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly kind = 'cloud' as const;
  readonly label: string;
  readonly model: string;
  private client: Anthropic;

  constructor(private opts: AnthropicOptions) {
    this.model = opts.model;
    this.label = `Anthropic · ${opts.model}`;
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl || undefined,
      timeout: opts.timeoutMs,
      maxRetries: 1,
      fetch: opts.fetch,
    });
  }

  async check(signal?: AbortSignal): Promise<ProviderCheck> {
    try {
      await this.client.models.retrieve(this.model, {}, { signal });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: describeError(e).message };
    }
  }

  private toMessages(req: ChatRequest): BetaMessageParam[] {
    const out: BetaMessageParam[] = [];
    for (const it of req.items) {
      if (it.role === 'user') out.push({ role: 'user', content: it.text });
      else if (it.role === 'assistant') {
        if (it.rawProvider === 'anthropic' && Array.isArray(it.raw)) out.push({ role: 'assistant', content: it.raw as BetaContentBlockParam[] });
        else {
          const blocks: BetaContentBlockParam[] = [];
          if (it.text) blocks.push({ type: 'text', text: it.text });
          for (const c of it.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input as Record<string, unknown> });
          if (blocks.length) out.push({ role: 'assistant', content: blocks });
        }
      } else {
        // All tool results for one assistant turn go back in a single user message.
        out.push({ role: 'user', content: it.results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content, is_error: r.isError })) });
      }
    }
    return out;
  }

  async chat(req: ChatRequest): Promise<LlmTurn> {
    const tools: BetaToolUnion[] = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as BetaToolUnion extends { input_schema: infer S } ? S : never }));
    const useFallback = FALLBACK_MODELS.has(this.model) && !this.opts.baseUrl;
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: this.opts.maxTokens,
          system: req.system,
          messages: this.toMessages(req),
          tools,
          output_config: { effort: this.opts.effort },
          ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { signal: req.signal },
      );
      stream.on('text', (delta) => req.onText?.(delta));
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') {
        throw new ProviderError("The cloud model declined that request.", 'refusal');
      }
      const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
      // Do not run tools from a turn that was cut off mid-generation.
      const toolCalls = msg.stop_reason === 'max_tokens' ? [] : msg.content.filter((b) => b.type === 'tool_use').map((b) => {
        const tu = b as { id: string; name: string; input: unknown };
        return { id: tu.id, name: tu.name, input: tu.input };
      });
      return {
        text,
        toolCalls,
        stop: msg.stop_reason === 'tool_use' && toolCalls.length ? 'tool_use' : msg.stop_reason === 'max_tokens' ? 'max_tokens' : msg.stop_reason === 'end_turn' ? 'end' : 'other',
        raw: msg.content,
      };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (req.signal.aborted) throw new ProviderError('Cancelled', 'cancelled');
      throw describeError(e);
    }
  }
}

function describeError(e: unknown): ProviderError {
  if (e instanceof OfflinePolicyError || (e as { cause?: unknown })?.cause instanceof OfflinePolicyError) return new ProviderError('Strict Offline mode blocks cloud requests.', 'offline_policy');
  if (e instanceof Anthropic.AuthenticationError) return new ProviderError('The Anthropic API key was rejected. Check it in Settings, Credentials.', 'auth');
  if (e instanceof Anthropic.PermissionDeniedError) return new ProviderError('This API key does not have access to that model.', 'auth');
  if (e instanceof Anthropic.NotFoundError) return new ProviderError('That Anthropic model was not found. Check the model name in Settings.', 'bad_response');
  if (e instanceof Anthropic.RateLimitError) return new ProviderError('The cloud provider is rate limiting requests. Try again shortly.', 'rate_limit');
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('The cloud request timed out.', 'timeout');
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError("I couldn't reach the cloud provider. Check your internet connection.", 'network');
  if (e instanceof Anthropic.APIError) return new ProviderError(`Cloud provider error (${e.status ?? 'unknown'}).`, 'bad_response');
  return new ProviderError(`Cloud request failed: ${(e as Error)?.message ?? String(e)}`, 'network');
}

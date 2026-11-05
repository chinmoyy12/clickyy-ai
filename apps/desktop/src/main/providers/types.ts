export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { id: string; name: string; input: unknown }

export type ConversationItem =
  /** `images`: base64 PNGs for vision-capable models (only sent when the user explicitly asked about the screen). */
  | { role: 'user'; text: string; images?: string[] }
  /** `raw` keeps provider-native content (e.g. Anthropic thinking blocks) so it can be passed back unchanged. */
  | { role: 'assistant'; text: string; toolCalls?: ToolCall[]; raw?: unknown; rawProvider?: string }
  | { role: 'tool'; results: Array<{ id: string; name: string; content: string; isError: boolean }> };

export interface ChatRequest {
  system: string;
  items: ConversationItem[];
  tools: ToolSpec[];
  signal: AbortSignal;
  onText?: (delta: string) => void;
}

export interface LlmTurn {
  text: string;
  toolCalls: ToolCall[];
  stop: 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  raw?: unknown;
}

export interface ProviderCheck { ok: boolean; message?: string; models?: string[] }

export interface LlmProvider {
  readonly id: string;
  readonly kind: 'local' | 'cloud';
  readonly label: string;
  readonly model: string;
  check(signal?: AbortSignal): Promise<ProviderCheck>;
  chat(req: ChatRequest): Promise<LlmTurn>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly code: 'unavailable' | 'auth' | 'rate_limit' | 'network' | 'timeout' | 'bad_response' | 'cancelled' | 'offline_policy' | 'refusal') {
    super(message);
    this.name = 'ProviderError';
  }
}

export function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}

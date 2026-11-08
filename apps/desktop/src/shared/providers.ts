/**
 * Cloud provider presets. Everything except Anthropic uses the provider's
 * documented OpenAI-compatible Chat Completions endpoint. Default models are
 * only starting points: use "Load models" in Settings to pick from the
 * provider's live model list.
 */
export const CLOUD_PROVIDERS = ['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'mistral', 'deepseek', 'xai', 'openai_compatible'] as const;
export type CloudProviderId = (typeof CLOUD_PROVIDERS)[number];

export interface ProviderPreset {
  label: string;
  baseUrl: string;
  defaultModel: string;
  keyHint: string;
  docs: string;
  supportsTts?: boolean;
}

export const PROVIDER_PRESETS: Record<CloudProviderId, ProviderPreset> = {
  anthropic: { label: 'Anthropic (Claude)', baseUrl: '', defaultModel: 'claude-opus-5-5', keyHint: 'sk-ant-…', docs: 'console.anthropic.com' },
  openai: { label: 'OpenAI (ChatGPT models)', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', keyHint: 'sk-…', docs: 'platform.openai.com', supportsTts: true },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-3.5-flash', keyHint: 'AIza…', docs: 'aistudio.google.com' },
  groq: { label: 'Groq (fast open models)', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', keyHint: 'gsk_…', docs: 'console.groq.com' },
  openrouter: { label: 'OpenRouter (hundreds of models)', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openrouter/auto', keyHint: 'sk-or-…', docs: 'openrouter.ai' },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest', keyHint: 'key', docs: 'console.mistral.ai' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', keyHint: 'sk-…', docs: 'platform.deepseek.com' },
  xai: { label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-3-mini', keyHint: 'xai-…', docs: 'console.x.ai' },
  openai_compatible: { label: 'Custom OpenAI-compatible', baseUrl: '', defaultModel: '', keyHint: 'key', docs: 'your provider', supportsTts: true },
};

export function resolveBaseUrl(provider: CloudProviderId, override: string): string {
  return (override || PROVIDER_PRESETS[provider].baseUrl).replace(/\/+$/, '');
}

export const LOCAL_RUNTIMES = ['ollama', 'openai_local'] as const;
export type LocalRuntime = (typeof LOCAL_RUNTIMES)[number];
export const LOCAL_RUNTIME_LABELS: Record<LocalRuntime, { label: string; defaultUrl: string; hint: string }> = {
  ollama: { label: 'Ollama', defaultUrl: 'http://127.0.0.1:11434', hint: 'ollama.com — run: ollama pull llama3.2' },
  openai_local: { label: 'LM Studio / llama.cpp / vLLM (OpenAI-compatible)', defaultUrl: 'http://127.0.0.1:1234/v1', hint: 'Start the local server in LM Studio, or run llama-server' },
};

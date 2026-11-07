import type { Settings } from '@shared/settings';
import { PROVIDER_PRESETS, resolveBaseUrl, type CloudProviderId } from '@shared/providers';
import type { ProviderStatus } from '@shared/types';
import type { SecretStore } from '../security/secrets';
import type { NetGuard } from '../security/netGuard';
import { AnthropicProvider } from './anthropic';
import { OllamaProvider } from './ollama';
import { OpenAICompatProvider } from './openaiCompat';
import type { LlmProvider } from './types';

export const POLICY_LABELS = { strict_offline: 'Strict Offline', smart_hybrid: 'Smart Hybrid', online_preferred: 'Online Preferred' } as const;

/**
 * Decides which providers may be used for a request, in order. This is the
 * single place that enforces the routing policy for reasoning:
 *  - strict_offline: local model only (and the net guard blocks remote hosts anyway)
 *  - smart_hybrid:   local model first; cloud only if consented
 *  - online_preferred: cloud first (if consented); local as optional fallback
 */
export function orderProviders(settings: Settings, local: LlmProvider | null, cloud: LlmProvider | LlmProvider[] | null): LlmProvider[] {
  const clouds = (Array.isArray(cloud) ? cloud : cloud ? [cloud] : []).filter(() => settings.ai.allowCloudTranscripts);
  switch (settings.ai.policy) {
    case 'strict_offline': return local ? [local] : [];
    case 'smart_hybrid': return [local, ...clouds].filter((p): p is LlmProvider => !!p);
    case 'online_preferred': return [...clouds, settings.ai.cloud.fallbackToLocal ? local : null].filter((p): p is LlmProvider => !!p);
  }
}

function isLoopback(url: string): boolean {
  try { return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(url).hostname); } catch { return false; }
}

export class ProviderManager {
  private localReady = false;
  private localModels: string[] = [];
  private localMessage?: string;
  private cloudMessage?: string;
  private breaker = new Map<string, { failures: number; openUntil: number }>();

  /** Installed model used when the configured one is missing (set by refreshLocal). */
  private localOverride = '';

  /**
   * @param startRuntime starts the installed local runtime (Ollama); returns false if it isn't installed.
   */
  constructor(private settings: () => Settings, private secrets: SecretStore, private guard: NetGuard, private isOnline: () => boolean,
    private startRuntime?: () => boolean, private startWaitMs = 20_000) {}

  local(): LlmProvider & { check: LlmProvider['check'] } {
    const s = this.settings().ai.local;
    if (s.runtime === 'openai_local') {
      return new OpenAICompatProvider({ id: 'openai_local', label: 'Local server', kind: 'local', baseUrl: s.baseUrl, apiKey: '', model: s.model, timeoutMs: s.timeoutMs, maxTokens: 2048, fetch: this.guard.fetchFor('local-model') });
    }
    return new OllamaProvider(s.baseUrl, this.localOverride || s.model, s.timeoutMs, this.guard.fetchFor('local-model'), s.device);
  }

  /** Builds a cloud provider for a preset, or null if it has no key / base URL. */
  build(provider: CloudProviderId, model?: string): LlmProvider | null {
    const c = this.settings().ai.cloud;
    const key = this.secrets.get(provider);
    if (!key) return null;
    const isPrimary = provider === c.provider;
    const chosenModel = model || (isPrimary ? c.model : '') || PROVIDER_PRESETS[provider].defaultModel;
    const fetchImpl = this.guard.fetchFor(`cloud:${provider}`);
    if (provider === 'anthropic') return new AnthropicProvider({ apiKey: key, model: chosenModel, baseUrl: isPrimary ? c.baseUrl : '', timeoutMs: c.timeoutMs, maxTokens: c.maxTokens, effort: c.effort, fetch: fetchImpl });
    const baseUrl = resolveBaseUrl(provider, isPrimary ? c.baseUrl : '');
    if (!baseUrl || !chosenModel) return null;
    return new OpenAICompatProvider({
      id: provider, label: PROVIDER_PRESETS[provider].label.replace(/ \(.*\)$/, ''), kind: 'cloud', baseUrl, apiKey: key, model: chosenModel,
      timeoutMs: c.timeoutMs, maxTokens: c.maxTokens, fetch: fetchImpl,
      headers: provider === 'openrouter' ? { 'X-Title': 'Clickyy AI' } : undefined,
    });
  }

  cloud(): LlmProvider | null {
    return this.build(this.settings().ai.cloud.provider);
  }

  clouds(): LlmProvider[] {
    const c = this.settings().ai.cloud;
    const list = [this.cloud()];
    if (c.fallbackProvider !== 'none' && c.fallbackProvider !== c.provider) list.push(this.build(c.fallbackProvider as CloudProviderId, c.fallbackModel));
    return list.filter((p): p is LlmProvider => !!p);
  }

  async listModels(provider: CloudProviderId | 'local'): Promise<string[]> {
    if (provider === 'local') {
      const r = await this.local().check();
      return r.models ?? [];
    }
    if (provider === 'anthropic') return ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
    const p = this.build(provider, PROVIDER_PRESETS[provider].defaultModel || 'x');
    if (!p) throw new Error(`Add a ${PROVIDER_PRESETS[provider].label} API key (and base URL for custom) first.`);
    return (p as OpenAICompatProvider).listModels();
  }

  private warmed = '';
  private localReachable = false;
  private starting: Promise<void> | null = null;

  /**
   * Makes sure the local model is usable before a request gives up on it: re-checks right away
   * (Ollama often starts after Clickyy at sign-in), and if the runtime isn't running at all,
   * starts the installed Ollama and waits for it.
   */
  async ensureLocal(): Promise<void> {
    const ai = this.settings().ai;
    const s = ai.local;
    if (this.localReady) return;
    await this.refreshLocal();
    if (this.localReady || this.localReachable || !this.startRuntime || s.runtime !== 'ollama' || !isLoopback(s.baseUrl)) return;
    if (ai.policy === 'online_preferred' && !ai.cloud.fallbackToLocal) return; // user doesn't want the local model
    this.starting ??= (async () => {
      if (!this.startRuntime!()) return;
      this.localMessage = 'Starting Ollama…';
      const until = Date.now() + this.startWaitMs;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 500));
        await this.refreshLocal();
        if (this.localReachable) return;
      }
      this.localMessage = 'Ollama was started but did not respond in time. Try again in a moment.';
    })().finally(() => { this.starting = null; });
    await this.starting;
  }

  async refreshLocal(): Promise<void> {
    // Check the configured model (not the override) without touching shared state until the
    // result is in, so a request running meanwhile keeps a valid model.
    const s = this.settings().ai.local;
    const p = s.runtime === 'openai_local' ? this.local() : new OllamaProvider(s.baseUrl, s.model, s.timeoutMs, this.guard.fetchFor('local-model'), s.device);
    const r = await p.check();
    let override = '';
    let ready = r.ok;
    let message = this.starting && r.models === undefined ? 'Starting Ollama…' : r.message;
    // Configured model missing but others are installed: use one instead of refusing to answer.
    if (!r.ok && r.models?.length && s.runtime === 'ollama') {
      const pick = r.models.find((m) => !/embed/i.test(m));
      if (pick) {
        override = pick;
        ready = true;
        message = s.model ? `Using ${pick} because ${s.model} isn't installed.` : `Using ${pick}.`;
      }
    }
    this.localReachable = r.models !== undefined;
    this.localModels = r.models ?? [];
    this.localOverride = override;
    this.localReady = ready;
    this.localMessage = message;
    // Preload the model once so the first spoken question isn't delayed by model loading.
    const active = this.local();
    const key = `${this.settings().ai.local.baseUrl}|${active.model}`;
    if (this.localReady && this.warmed !== key && active instanceof OllamaProvider) {
      this.warmed = key;
      void active.warm();
    }
  }

  /** Providers usable right now, honoring policy, readiness and the circuit breaker. */
  candidates(): LlmProvider[] {
    const local = this.localReady ? this.local() : null;
    const clouds = this.isOnline() ? this.clouds() : [];
    return orderProviders(this.settings(), local, clouds).filter((p) => (this.breaker.get(p.id)?.openUntil ?? 0) < Date.now());
  }

  reportFailure(id: string) {
    const b = this.breaker.get(id) ?? { failures: 0, openUntil: 0 };
    b.failures++;
    if (b.failures >= 3) {
      b.openUntil = Date.now() + 60_000;
      b.failures = 0;
    }
    this.breaker.set(id, b);
    // Re-check immediately rather than writing the local model off until the next poll.
    if (id === 'ollama' || id === 'openai_local') void this.refreshLocal();
  }

  reportSuccess(id: string) { this.breaker.delete(id); }

  setCloudMessage(m?: string) { this.cloudMessage = m; }

  status(): ProviderStatus {
    const s = this.settings();
    const cands = this.candidates();
    return {
      policy: s.ai.policy,
      online: this.isOnline(),
      local: { configured: !!s.ai.local.model, ready: this.localReady, model: s.ai.local.model, models: this.localModels, message: this.localMessage },
      cloud: {
        provider: PROVIDER_PRESETS[s.ai.cloud.provider].label, model: s.ai.cloud.model, hasKey: this.secrets.has(s.ai.cloud.provider),
        allowed: s.ai.policy !== 'strict_offline' && s.ai.allowCloudTranscripts, message: this.cloudMessage,
      },
      keys: Object.fromEntries((Object.keys(PROVIDER_PRESETS) as CloudProviderId[]).map((p) => [p, this.secrets.has(p)])),
      active: cands[0]?.kind ?? 'none',
      activeLabel: cands[0]?.label,
    };
  }
}

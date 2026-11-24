import type { Settings } from '@shared/settings';
import { CLOUD_PROVIDERS, PROVIDER_PRESETS, resolveBaseUrl, type CloudProviderId } from '@shared/providers';
import type { ProviderStatus } from '@shared/types';
import type { SecretStore } from '../security/secrets';
import type { NetGuard } from '../security/netGuard';
import { MODE_PROFILES } from '@shared/modes';
import { AnthropicProvider } from './anthropic';
import { BUILTIN_LABEL, BUILTIN_MODEL_ID, type BuiltinEngine } from './builtin';
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
export function orderProviders(settings: Settings, local: LlmProvider | LlmProvider[] | null, cloud: LlmProvider | LlmProvider[] | null): LlmProvider[] {
  const clouds = (Array.isArray(cloud) ? cloud : cloud ? [cloud] : []).filter(() => settings.ai.allowCloudTranscripts);
  const locals = Array.isArray(local) ? local : local ? [local] : [];
  switch (settings.ai.policy) {
    case 'strict_offline': return locals;
    case 'smart_hybrid': return [...locals, ...clouds];
    case 'online_preferred': return [...clouds, ...(settings.ai.cloud.fallbackToLocal ? locals : [])];
  }
}

/** Same provider under a separate id, so the circuit breaker treats a same-provider fallback model on its own. */
function withId(p: LlmProvider, id: string): LlmProvider {
  return { id, kind: p.kind, label: p.label, model: p.model, check: (s) => p.check(s), chat: (r) => p.chat(r) };
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

  private builtin: BuiltinEngine | null = null;

  /** Attaches the AI model bundled with the app (see builtin.ts). */
  setBuiltin(engine: BuiltinEngine) { this.builtin = engine; }

  private get mode() { return MODE_PROFILES[this.settings().ai.mode] ?? MODE_PROFILES.balanced; }

  /** True when the bundled model is included in this build and switched on. */
  get builtinEnabled() { return !!this.builtin?.available && this.settings().ai.local.builtin; }

  /** The bundled model as a provider (only meaningful once the engine is ready). */
  builtinProvider(): LlmProvider {
    const engine = this.builtin!;
    const s = this.settings().ai.local;
    const p = new OpenAICompatProvider({
      id: 'builtin', label: BUILTIN_LABEL, kind: 'local', baseUrl: engine.baseUrl, apiKey: engine.token, model: BUILTIN_MODEL_ID,
      timeoutMs: s.timeoutMs, maxTokens: this.mode.localTokens, fetch: this.guard.fetchFor('local-model'),
      // Qwen3 can think before answering; only Turbo pays for that.
      extraBody: { chat_template_kwargs: { enable_thinking: this.mode.thinking } },
    });
    return {
      id: p.id, kind: p.kind, label: p.label, model: p.model,
      check: (sig) => p.check(sig),
      chat: async (r) => { engine.touch(); try { return await p.chat(r); } finally { engine.touch(); } },
    };
  }

  local(): LlmProvider & { check: LlmProvider['check'] } {
    const s = this.settings().ai.local;
    if (s.runtime === 'openai_local') {
      return new OpenAICompatProvider({ id: 'openai_local', label: 'Local server', kind: 'local', baseUrl: s.baseUrl, apiKey: '', model: s.model, timeoutMs: s.timeoutMs, maxTokens: Math.max(this.mode.localTokens, 1024), fetch: this.guard.fetchFor('local-model') });
    }
    return new OllamaProvider(s.baseUrl, this.localOverride || s.model, s.timeoutMs, this.guard.fetchFor('local-model'), s.device, this.mode.localTokens);
  }

  /** Builds a cloud provider for a preset, or null if it has no key / base URL. */
  build(provider: CloudProviderId, model?: string): LlmProvider | null {
    const c = this.settings().ai.cloud;
    const key = this.secrets.get(provider);
    if (!key) return null;
    const isPrimary = provider === c.provider;
    let chosenModel = model || (isPrimary ? c.model : '') || PROVIDER_PRESETS[provider].defaultModel;
    // Google retired Gemini 1.x/2.x for new keys ("no longer available to new users"); use the current default.
    if (provider === 'gemini' && /^gemini-[12]\./.test(chosenModel)) chosenModel = PROVIDER_PRESETS.gemini.defaultModel;
    const fetchImpl = this.guard.fetchFor(`cloud:${provider}`);
    const mode = this.mode;
    const maxTokens = mode.cloudTokens(c.maxTokens);
    if (provider === 'anthropic') return new AnthropicProvider({ apiKey: key, model: chosenModel, baseUrl: isPrimary ? c.baseUrl : '', timeoutMs: c.timeoutMs, maxTokens, effort: mode.cloudEffort(c.effort), fetch: fetchImpl });
    const baseUrl = resolveBaseUrl(provider, isPrimary ? c.baseUrl : '');
    if (!baseUrl || !chosenModel) return null;
    return new OpenAICompatProvider({
      id: provider, label: PROVIDER_PRESETS[provider].label.replace(/ \(.*\)$/, ''), kind: 'cloud', baseUrl, apiKey: key, model: chosenModel,
      timeoutMs: c.timeoutMs, maxTokens, fetch: fetchImpl,
      // Gemini thinks by default; Fast turns that down and Turbo up.
      extraBody: provider === 'gemini' && mode.reasoningEffort ? { reasoning_effort: mode.reasoningEffort } : undefined,
      headers: provider === 'openrouter' ? { 'X-Title': 'Clickyy AI' } : undefined,
    });
  }

  /**
   * The cloud provider actually used: the selected one, or — when it has no key — the first
   * provider that does (a key saved for Gemini works even if Claude is still selected).
   */
  cloudId(): CloudProviderId {
    const c = this.settings().ai.cloud;
    if (this.secrets.has(c.provider)) return c.provider;
    return CLOUD_PROVIDERS.find((p) => p !== 'openai_compatible' && this.secrets.has(p)) ?? c.provider;
  }

  cloud(): LlmProvider | null {
    return this.build(this.cloudId());
  }

  clouds(): LlmProvider[] {
    const c = this.settings().ai.cloud;
    const primary = this.cloudId();
    const first = this.cloud();
    const list = [first];
    // The fallback may be another provider, or the same one with a different model (Gemini Flash → Flash-Lite).
    if (c.fallbackProvider !== 'none' && (c.fallbackProvider !== primary || (c.fallbackModel && c.fallbackModel !== first?.model))) {
      const fb = this.build(c.fallbackProvider as CloudProviderId, c.fallbackModel);
      list.push(fb && fb.id === first?.id ? withId(fb, `${fb.id}:fallback`) : fb);
    }
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
    if (this.builtinEnabled && this.wantBuiltin()) {
      if (s.builtinFirst) {
        // Bundled model first; Ollama / a local server stays available as the fallback.
        await this.builtin!.ensure();
        if (!this.localReady) await this.refreshLocal();
        return;
      }
      if (!this.localReady) await this.refreshLocal();
      if (!this.localReady) { await this.builtin!.ensure(); if (this.builtin!.ready) return; }
    }
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

  /** Whether a request may need the bundled model at all (so it isn't loaded into memory for nothing). */
  private wantBuiltin(): boolean {
    const ai = this.settings().ai;
    if (ai.policy !== 'online_preferred') return true;
    if (!ai.cloud.fallbackToLocal) return false;
    return !(this.isOnline() && ai.allowCloudTranscripts && this.clouds().length);
  }

  /** Loads the bundled model ahead of the first question (called shortly after start). */
  async warmBuiltin(): Promise<void> {
    if (this.builtinEnabled && this.settings().ai.local.builtinFirst && this.wantBuiltin()) await this.builtin!.ensure();
  }

  stopBuiltin() { this.builtin?.stop(); }

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

  /** True when the local runtime answered the last check (installed and running). */
  get localRunning() { return this.localReachable; }

  /**
   * Downloads a local model through Ollama (POST /api/pull, streamed progress). After this the assistant
   * can think and answer with no internet and no API key. Ollama itself fetches the files.
   */
  async pullLocal(model: string, onProgress: (p: { status: string; completed?: number; total?: number }) => void, signal: AbortSignal): Promise<void> {
    const s = this.settings().ai.local;
    if (s.runtime !== 'ollama') throw new Error('Downloading models is available for Ollama. For other local servers, load the model in that app.');
    await this.ensureLocal();
    if (!this.localReachable) throw new Error('Ollama is not installed or not running. Install it from ollama.com (free), then try again.');
    const res = await this.guard.fetchFor('local-model')(`${s.baseUrl.replace(/\/+$/, '')}/api/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal });
    if (!res.ok || !res.body) throw new Error(`Ollama refused the download (HTTP ${res.status}).`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let ok = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let m: { status?: string; total?: number; completed?: number; error?: string };
        try { m = JSON.parse(line); } catch { continue; }
        if (m.error) throw new Error(/not found|does not exist|manifest/i.test(m.error) ? `Ollama has no model called "${model}".` : m.error);
        if (m.status === 'success') ok = true;
        onProgress({ status: m.status ?? '', completed: m.completed, total: m.total });
      }
    }
    if (!ok) throw new Error('The download stopped before it finished. Try again.');
    this.localReady = false;
    await this.refreshLocal();
  }

  /** Providers usable right now, honoring policy, readiness and the circuit breaker. */
  candidates(): LlmProvider[] {
    const external = this.localReady ? this.local() : null;
    const builtin = this.builtinEnabled && this.builtin!.ready ? this.builtinProvider() : null;
    const locals = (this.settings().ai.local.builtinFirst ? [builtin, external] : [external, builtin]).filter((p): p is LlmProvider => !!p);
    const clouds = this.isOnline() ? this.clouds() : [];
    return orderProviders(this.settings(), locals, clouds).filter((p) => (this.breaker.get(p.id)?.openUntil ?? 0) < Date.now());
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
    const cid = this.cloudId();
    const viaOther = cid !== s.ai.cloud.provider;
    return {
      policy: s.ai.policy,
      online: this.isOnline(),
      local: { configured: !!s.ai.local.model, ready: this.localReady, model: s.ai.local.model, models: this.localModels, message: this.localMessage },
      builtin: { available: !!this.builtin?.available, enabled: this.builtinEnabled, state: this.builtin?.state ?? 'unavailable', message: this.builtin?.message || undefined, model: 'Qwen3 1.7B' },
      mode: s.ai.mode,
      cloud: {
        provider: PROVIDER_PRESETS[cid].label, model: viaOther ? PROVIDER_PRESETS[cid].defaultModel : s.ai.cloud.model, hasKey: this.secrets.has(cid),
        allowed: s.ai.policy !== 'strict_offline' && s.ai.allowCloudTranscripts,
        message: this.cloudMessage ?? (viaOther ? `${PROVIDER_PRESETS[s.ai.cloud.provider].label} has no key, so ${PROVIDER_PRESETS[cid].label} is used.` : undefined),
      },
      keys: Object.fromEntries((Object.keys(PROVIDER_PRESETS) as CloudProviderId[]).map((p) => [p, this.secrets.has(p)])),
      active: cands[0]?.kind ?? 'none',
      activeLabel: cands[0]?.label,
    };
  }
}

import { useEffect, useState } from 'react';
import type { Settings } from '@shared/settings';
import type { BrainStatus, LocalPullStatus } from '@shared/types';
import { CLOUD_PROVIDERS, LOCAL_RUNTIMES, LOCAL_RUNTIME_LABELS, PROVIDER_PRESETS, type CloudProviderId } from '@shared/providers';
import { Badge, Button, Row, Section, Select, TextInput, Toggle } from '../../components/ui';
import { notify, store, useStore } from '../../state/store';
import { call } from '../../api';
import type { Update } from '../Settings';
import { AI_MODES, MODE_PROFILES } from '@shared/modes';

const MODE_TEXT = {
  fast: 'Short, quick answers. Best for commands and simple questions.',
  balanced: 'The everyday default: clear answers at a good speed.',
  turbo: 'Thinks step by step before answering: better at maths, planning and multi-part tasks, but slower.',
} as const;

function BuiltinAi({ s, update }: { s: Settings; update: Update }) {
  const providers = useStore((x) => x.providers);
  const b = providers?.builtin;
  const tone = b?.state === 'ready' ? 'ok' : b?.state === 'starting' ? 'cyan' : b?.state === 'error' ? 'danger' : 'muted';
  const label = !b?.available ? 'not in this build' : !b.enabled ? 'off' : b.state === 'ready' ? 'running' : b.state === 'starting' ? 'loading…' : b.state === 'error' ? 'problem' : 'starts when needed';
  return (
    <Section title="Built-in AI" description="Clickyy's own language model, shipped inside the app: Qwen3 1.7B running on this PC through llama.cpp. No download, no account, no API key, works fully offline and in Strict Offline mode. Ollama and cloud models stay available as optional extras.">
      <Row label="Use the built-in AI" hint={b?.message}>
        <div className="flex items-center gap-2"><Badge tone={tone}>{label}</Badge>
          <Toggle label="Use the built-in AI" checked={s.ai.local.builtin} disabled={!b?.available} onChange={(v) => void update({ ai: { local: { builtin: v } } })} /></div>
      </Row>
      <Row label="Try it before Ollama / local server" hint="Off: your Ollama or local-server model answers first and the built-in AI is the fallback.">
        <Toggle label="Prefer the built-in AI" checked={s.ai.local.builtinFirst} disabled={!s.ai.local.builtin} onChange={(v) => void update({ ai: { local: { builtinFirst: v } } })} />
      </Row>
      <p className="text-[0.75em] text-muted">Qwen3 1.7B: Apache License 2.0, by the Qwen team. llama.cpp: MIT License, by the ggml authors. It uses about 1.5 GB of memory while running and stops after 20 minutes unused.</p>
    </Section>
  );
}

function ResponseMode({ s, update }: { s: Settings; update: Update }) {
  return (
    <Section title="Response mode" description="One switch for speed versus depth, for every model (also in the title bar, or say “turbo mode”).">
      <div role="radiogroup" aria-label="Response mode" className="grid grid-cols-3 gap-2">
        {AI_MODES.map((m) => (
          <button key={m} role="radio" aria-checked={s.ai.mode === m} onClick={() => void update({ ai: { mode: m } })}
            className={`rounded-xl border p-2.5 text-left ${s.ai.mode === m ? 'border-gold/70 bg-gold/5' : 'border-line hover:border-line/80'}`}>
            <div className="text-[0.9em] font-medium">{MODE_PROFILES[m].label}</div>
            <div className="text-[0.78em] text-muted">{MODE_TEXT[m]}</div>
          </button>
        ))}
      </div>
    </Section>
  );
}

const POLICIES = [
  { id: 'strict_offline', title: 'Strict Offline', text: 'No remote requests at all. Commands run locally; conversation needs a local model.' },
  { id: 'smart_hybrid', title: 'Smart Hybrid', text: 'Commands run locally. Questions go to your local model first, and to the cloud only if you allow it below.' },
  { id: 'online_preferred', title: 'Online Preferred', text: 'Questions go to your cloud provider first (if allowed), then the fallback provider, then the local model.' },
] as const;

const providerOptions = CLOUD_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_PRESETS[p].label }));

function ModelPicker({ provider, value, onChange, label }: { provider: CloudProviderId | 'local'; value: string; onChange: (v: string) => void; label: string }) {
  const [models, setModels] = useState<string[]>([]);
  const [draft, setDraft] = useState(value);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setDraft(value); setModels([]); }, [provider, value]);
  const load = async () => {
    setLoading(true);
    try {
      const list = await call('providers:models', { provider });
      setModels(list);
      if (!list.length) notify('warn', 'The provider returned no models.');
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {models.length ? (
        <Select label={label} value={models.includes(value) ? value : ''} onChange={onChange} options={[{ value: '', label: 'Choose a model…' }, ...models.map((m) => ({ value: m, label: m }))]} />
      ) : (
        <>
          <TextInput label={label} value={draft} onChange={setDraft} placeholder={provider === 'local' ? 'llama3.2' : PROVIDER_PRESETS[provider].defaultModel} className="w-44" />
          <Button onClick={() => onChange(draft)} disabled={draft === value}>Save</Button>
        </>
      )}
      <Button variant="ghost" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Load models'}</Button>
    </div>
  );
}

/** Local models offered for one-click download (Ollama tags). Sizes are the download size. */
const OFFLINE_MODELS = [
  { id: 'llama3.2', label: 'Llama 3.2 3B — balanced, 2.0 GB (recommended)' },
  { id: 'qwen3:4b', label: 'Qwen3 4B — best reasoning, 2.5 GB' },
  { id: 'gemma3:4b', label: 'Gemma 3 4B — can also read your screen, 3.3 GB' },
  { id: 'llama3.2:1b', label: 'Llama 3.2 1B — fastest on older PCs, 1.3 GB' },
];

function OfflineBrain({ s }: { s: Settings }) {
  const providers = useStore((x) => x.providers);
  const [brain, setBrain] = useState<BrainStatus | null>(null);
  const [pull, setPull] = useState<LocalPullStatus | null>(null);
  const [choice, setChoice] = useState(OFFLINE_MODELS[0].id);
  useEffect(() => { void call('brain:status').then(setBrain); void call('local:pullStatus').then(setPull); }, []);
  useEffect(() => {
    if (!pull?.active) return;
    const t = setInterval(() => void call('local:pullStatus').then(async (p) => {
      setPull(p);
      if (!p.active) {
        notify(p.error ? 'error' : 'info', p.error ?? `${p.model} is installed. Clickyy can now think and answer offline.`);
        store.set({ providers: await call('providers:status') });
      }
    }), 700);
    return () => clearInterval(t);
  }, [pull?.active]);
  const start = async () => {
    try { setPull(await call('local:pull', { model: choice })); } catch (e) { notify('error', (e as Error).message); }
  };
  const forget = async (text?: string) => setBrain(await call('brain:forget', text ? { text } : {}));
  const pct = pull?.total ? Math.round((pull.completed / pull.total) * 100) : 0;
  const ready = providers?.local.ready;
  return (
    <Section title="Offline brain" description="Clickyy thinks on your PC with no internet and no API key: an on-device neural network understands commands however you phrase them, remembers phrases it learned from experience, and a local language model answers questions and conversation.">
      <Row label="Command understanding" hint="A small neural network trained on Clickyy's commands. It acts only when confident; otherwise it asks or passes the request on.">
        <Badge tone="ok">{brain ? `${brain.intents} intents, ${brain.runnable} run instantly` : 'loading'}</Badge>
      </Row>
      <Row label="Local language model" hint={ready ? `Answers offline with ${providers?.local.model || 'the installed model'}.` : 'Needed for questions and conversation without the cloud. Download once; then it works offline.'}>
        {ready ? <Badge tone="ok">ready</Badge> : <Badge tone="muted">not installed</Badge>}
      </Row>
      {s.ai.local.runtime === 'ollama' && (
        <div className="flex flex-col gap-2">
          {!pull?.ollamaRunning && !ready && (
            <p className="text-[0.8em] text-muted">Step 1: install Ollama, the free engine that runs models on your PC. <Button variant="ghost" onClick={() => void call('local:getOllama')}>Get Ollama</Button></p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Select label="Offline model" value={choice} onChange={setChoice} options={OFFLINE_MODELS.map((m) => ({ value: m.id, label: m.label }))} />
            {pull?.active
              ? <><span className="text-[0.8em] text-muted">{pull.status} {pull.total ? `${pct}%` : ''}</span><Button variant="ghost" onClick={() => void call('local:pullCancel')}>Cancel</Button></>
              : <Button variant="primary" onClick={() => void start()}>{ready ? 'Download another' : 'Download'}</Button>}
          </div>
          {pull?.active && pull.total > 0 && <div className="h-1.5 w-full overflow-hidden rounded bg-line"><div className="h-full bg-gold" style={{ width: `${pct}%` }} /></div>}
          {pull?.error && !pull.active && <p className="text-[0.78em] text-danger">{pull.error}</p>}
        </div>
      )}
      <Row label="Learned from experience" hint="When the language model handles a request with one safe action, Clickyy remembers it and next time does it instantly, even offline. Reminders, messages, files and anything risky are never learned.">
        <div className="flex items-center gap-2"><Badge tone="muted">{brain?.learned.length ?? 0} phrases</Badge>{!!brain?.learned.length && <Button variant="ghost" onClick={() => void forget()}>Forget all</Button>}</div>
      </Row>
      {!!brain?.learned.length && (
        <ul className="flex max-h-40 flex-col gap-1 overflow-auto text-[0.8em]">
          {brain.learned.slice(0, 50).map((l) => (
            <li key={l.text} className="flex items-center justify-between gap-2 rounded border border-line px-2 py-1">
              <span className="truncate">“{l.text}” → {l.tool}{l.uses ? ` · used ${l.uses}×` : ''}</span>
              <Button variant="ghost" onClick={() => void forget(l.text)}>Forget</Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function AiSection({ s, update }: { s: Settings; update: Update }) {
  const providers = useStore((x) => x.providers);
  const [localUrl, setLocalUrl] = useState(s.ai.local.baseUrl);
  const [baseUrl, setBaseUrl] = useState(s.ai.cloud.baseUrl);
  const [testing, setTesting] = useState<string | null>(null);
  useEffect(() => setLocalUrl(s.ai.local.baseUrl), [s.ai.local.baseUrl]);
  useEffect(() => setBaseUrl(s.ai.cloud.baseUrl), [s.ai.cloud.baseUrl]);
  const preset = PROVIDER_PRESETS[s.ai.cloud.provider];
  const test = async (target: 'local' | 'cloud') => {
    setTesting(target);
    try {
      const r = await call('providers:test', { target });
      notify(r.ok ? 'info' : 'error', r.ok ? `${target === 'local' ? 'Local model' : preset.label} is working.` : r.message ?? 'Test failed');
      store.set({ providers: await call('providers:status') });
    } finally {
      setTesting(null);
    }
  };
  const keyBadge = (p: CloudProviderId) => (providers?.keys?.[p] ? <Badge tone="ok">key stored</Badge> : <Badge tone="muted">no key</Badge>);

  return (
    <>
      <Section title="Routing policy">
        <div role="radiogroup" aria-label="Routing policy" className="flex flex-col gap-2">
          {POLICIES.map((p) => (
            <button key={p.id} role="radio" aria-checked={s.ai.policy === p.id} onClick={() => void update({ ai: { policy: p.id } })}
              className={`rounded-xl border p-2.5 text-left ${s.ai.policy === p.id ? 'border-gold/70 bg-gold/5' : 'border-line hover:border-line/80'}`}>
              <div className="text-[0.9em] font-medium">{p.title}</div>
              <div className="text-[0.8em] text-muted">{p.text}</div>
            </button>
          ))}
        </div>
        <Row label="Allow sending conversation text to the cloud" hint="Required for any cloud reasoning. Sends your typed or transcribed request (never raw audio), recent conversation and saved memories to the selected provider. The title bar shows when this happens.">
          <Toggle label="Allow cloud transcripts" checked={s.ai.allowCloudTranscripts} disabled={s.ai.policy === 'strict_offline'} onChange={(v) => void update({ ai: { allowCloudTranscripts: v } })} />
        </Row>
      </Section>

      <ResponseMode s={s} update={update} />
      <BuiltinAi s={s} update={update} />
      <OfflineBrain s={s} />

      <Section title="Ollama or local server (optional)" description={LOCAL_RUNTIME_LABELS[s.ai.local.runtime].hint + '. Use a bigger model you installed yourself. Runs on 127.0.0.1 and works in Strict Offline mode.'}>
        <Row label="Runtime">
          <Select label="Local runtime" value={s.ai.local.runtime} onChange={(v) => void update({ ai: { local: { runtime: v, baseUrl: LOCAL_RUNTIME_LABELS[v].defaultUrl, model: '' } } })}
            options={LOCAL_RUNTIMES.map((r) => ({ value: r, label: LOCAL_RUNTIME_LABELS[r].label }))} />
        </Row>
        <Row label="Status">{providers?.local.ready ? <Badge tone="ok">ready</Badge> : <span className="max-w-[240px] text-right text-[0.8em] text-muted">{providers?.local.message ?? 'unknown'}</span>}</Row>
        <Row label="Server URL"><div className="flex gap-1"><TextInput label="Local server URL" value={localUrl} onChange={setLocalUrl} className="w-48" /><Button onClick={() => void update({ ai: { local: { baseUrl: localUrl } } })} disabled={localUrl === s.ai.local.baseUrl}>Save</Button></div></Row>
        <Row label="Model"><ModelPicker provider="local" label="Local model" value={s.ai.local.model} onChange={(v) => void update({ ai: { local: { model: v } } })} /></Row>
        {s.ai.local.runtime === 'ollama' && (
          <Row label="Compute device" hint="Auto uses your GPU and switches to CPU if the GPU driver faults (common with older NVIDIA drivers).">
            <Select label="Compute device" value={s.ai.local.device} onChange={(v) => void update({ ai: { local: { device: v } } })} options={[{ value: 'auto', label: 'Auto (GPU, CPU fallback)' }, { value: 'gpu', label: 'GPU only' }, { value: 'cpu', label: 'CPU only' }]} />
          </Row>
        )}
        <div><Button onClick={() => void test('local')} disabled={testing !== null}>{testing === 'local' ? 'Testing…' : 'Test local model'}</Button></div>
      </Section>

      <Section title="Cloud provider" description="Claude, Gemini, ChatGPT models, Grok, Llama on Groq, hundreds more through OpenRouter, or any OpenAI-compatible service. Keys live in Credentials and are encrypted with Windows.">
        <Row label="Primary provider">
          <div className="flex items-center gap-2">{keyBadge(s.ai.cloud.provider)}
            <Select label="Cloud provider" value={s.ai.cloud.provider} onChange={(v) => void update({ ai: { cloud: { provider: v, model: PROVIDER_PRESETS[v].defaultModel, baseUrl: '' } } })} options={providerOptions} />
          </div>
        </Row>
        <Row label="Model" hint={`Get a key at ${preset.docs}`}><ModelPicker provider={s.ai.cloud.provider} label="Cloud model" value={s.ai.cloud.model} onChange={(v) => void update({ ai: { cloud: { model: v } } })} /></Row>
        <Row label="Base URL" hint={s.ai.cloud.provider === 'openai_compatible' ? 'Required, e.g. https://api.example.com/v1 (https only).' : `Optional override. Default: ${preset.baseUrl || 'official API'}`}>
          <div className="flex gap-1"><TextInput label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder={preset.baseUrl || 'official API'} className="w-48" /><Button onClick={() => void update({ ai: { cloud: { baseUrl } } })} disabled={baseUrl === s.ai.cloud.baseUrl}>Save</Button></div>
        </Row>
        <Row label="Fallback provider" hint="Tried automatically if the primary fails (rate limit, outage, bad key). Can be the same provider with a lighter model, e.g. Gemini Flash-Lite.">
          <div className="flex items-center gap-2">
            {s.ai.cloud.fallbackProvider !== 'none' && keyBadge(s.ai.cloud.fallbackProvider as CloudProviderId)}
            <Select label="Fallback provider" value={s.ai.cloud.fallbackProvider} onChange={(v) => void update({ ai: { cloud: { fallbackProvider: v, fallbackModel: v === 'none' ? '' : v === 'gemini' && s.ai.cloud.provider === 'gemini' ? 'gemini-3.5-flash-lite' : PROVIDER_PRESETS[v as CloudProviderId].defaultModel } } })}
              options={[{ value: 'none', label: 'None' }, ...providerOptions.map((o) => (o.value === s.ai.cloud.provider ? { ...o, label: `${o.label} (another model)` } : o))]} />
          </div>
        </Row>
        {s.ai.cloud.fallbackProvider !== 'none' && (
          <Row label="Fallback model"><ModelPicker provider={s.ai.cloud.fallbackProvider as CloudProviderId} label="Fallback model" value={s.ai.cloud.fallbackModel} onChange={(v) => void update({ ai: { cloud: { fallbackModel: v } } })} /></Row>
        )}
        {s.ai.cloud.provider === 'anthropic' && (
          <Row label="Reasoning effort" hint="Lower is faster and cheaper; good for voice.">
            <Select label="Effort" value={s.ai.cloud.effort} onChange={(v) => void update({ ai: { cloud: { effort: v } } })} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
          </Row>
        )}
        <Row label="Max reply tokens"><Select label="Max tokens" value={String(s.ai.cloud.maxTokens)} onChange={(v) => void update({ ai: { cloud: { maxTokens: Number(v) } } })} options={['1024', '2048', '4096', '8192'].map((v) => ({ value: v, label: v }))} /></Row>
        <Row label="Timeout"><Select label="Timeout" value={String(s.ai.cloud.timeoutMs)} onChange={(v) => void update({ ai: { cloud: { timeoutMs: Number(v) } } })} options={['15000', '30000', '45000', '90000'].map((v) => ({ value: v, label: `${Number(v) / 1000}s` }))} /></Row>
        <Row label="Fall back to local model"><Toggle label="Fallback to local" checked={s.ai.cloud.fallbackToLocal} onChange={(v) => void update({ ai: { cloud: { fallbackToLocal: v } } })} /></Row>
        <div><Button onClick={() => void test('cloud')} disabled={testing !== null || s.ai.policy === 'strict_offline'}>{testing === 'cloud' ? 'Testing…' : `Test ${preset.label}`}</Button></div>
        {providers?.cloud.message && <p className="text-[0.78em] text-danger">{providers.cloud.message}</p>}
        <p className="text-[0.75em] text-muted">Usage is billed by your provider; Clickyy does not estimate cost. On supported Claude models Clickyy enables Anthropic's default refusal fallback.</p>
      </Section>
    </>
  );
}

export function CredentialsSection({ s }: { s: Settings }) {
  const providers = useStore((x) => x.providers);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const refresh = async () => store.set({ providers: await call('providers:status') });
  const save = async (provider: CloudProviderId) => {
    try {
      await call('secrets:set', { provider, key: keys[provider] ?? '' });
      setKeys((k) => ({ ...k, [provider]: '' }));
      notify(s.ai.allowCloudTranscripts ? 'info' : 'warn', s.ai.allowCloudTranscripts
        ? `${PROVIDER_PRESETS[provider].label} key saved securely.`
        : `${PROVIDER_PRESETS[provider].label} key saved. To use it, turn on "Allow sending conversation text to the cloud" in AI settings.`);
      await refresh();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };
  const clear = async (provider: CloudProviderId) => {
    await call('secrets:clear', { provider });
    notify('info', 'Key removed.');
    await refresh();
  };
  return (
    <Section title="API keys" description="Paste a key to replace the stored one. Keys are encrypted with Windows (DPAPI), never displayed back, never logged and never sent to this interface. Clickyy never asks for account passwords.">
      {CLOUD_PROVIDERS.map((p) => (
        <Row key={p} label={PROVIDER_PRESETS[p].label} hint={<>{providers?.keys?.[p] ? <Badge tone="ok">stored</Badge> : null} {p === s.ai.cloud.provider ? <Badge tone="gold">primary</Badge> : null} <span>from {PROVIDER_PRESETS[p].docs}</span></>}>
          <div className="flex gap-1">
            <TextInput label={`${PROVIDER_PRESETS[p].label} key`} type="password" value={keys[p] ?? ''} onChange={(v) => setKeys((k) => ({ ...k, [p]: v }))} placeholder={PROVIDER_PRESETS[p].keyHint} className="w-36" />
            <Button variant="primary" onClick={() => void save(p)} disabled={(keys[p] ?? '').length < 8}>Save</Button>
            {providers?.keys?.[p] && <Button variant="ghost" onClick={() => void clear(p)}>Clear</Button>}
          </div>
        </Row>
      ))}
    </Section>
  );
}

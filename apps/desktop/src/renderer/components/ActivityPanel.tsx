import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, CircleDashed, Clock, Loader2, XCircle, Ban, PauseCircle } from 'lucide-react';
import { useStore, store } from '../state/store';
import { Badge, riskLabel, riskTone } from './ui';
import type { ToolCallRecord } from '@shared/types';

const STATUS_ICON: Record<ToolCallRecord['status'], React.ReactNode> = {
  planned: <CircleDashed size={13} className="text-muted" />, running: <Loader2 size={13} className="animate-spin text-gold" />,
  waiting: <PauseCircle size={13} className="text-warn" />, completed: <CheckCircle2 size={13} className="text-ok" />,
  failed: <XCircle size={13} className="text-danger" />, cancelled: <Ban size={13} className="text-muted" />,
};

export function ActivityPanel({ reducedMotion }: { reducedMotion: boolean }) {
  const [tab, setTab] = useState<'conversation' | 'timeline' | 'status'>('conversation');
  const lines = useStore((s) => s.lines);
  const timeline = useStore((s) => s.timeline);
  const providers = useStore((s) => s.providers);
  const speech = useStore((s) => s.speech);
  const micMuted = useStore((s) => s.micMuted);
  const micError = useStore((s) => s.micError);
  const settings = useStore((s) => s.settings);
  const confirmations = useStore((s) => s.confirmations);

  return (
    <motion.div initial={reducedMotion ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="border-t border-line bg-surface/60">
      <div role="tablist" aria-label="Activity" className="flex gap-1 px-3 pt-2">
        {(['conversation', 'timeline', 'status'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-md px-2.5 py-1 text-[0.8em] capitalize ${tab === t ? 'bg-surface2 text-ink' : 'text-muted hover:text-ink'}`}>{t === 'timeline' ? 'Actions' : t}</button>
        ))}
        <button onClick={() => store.set({ panelOpen: false })} className="ml-auto rounded-md px-2 py-1 text-[0.75em] text-muted hover:text-ink">Hide</button>
      </div>
      <div className="h-[230px] overflow-y-auto px-3 py-2 text-[0.85em]" role="tabpanel">
        {tab === 'conversation' && (
          lines.length === 0 ? <Empty text="No messages yet in this session." /> :
          <ul className="flex flex-col gap-2">
            {lines.map((l) => (
              <li key={l.id} className={`selectable rounded-lg px-2.5 py-1.5 ${l.role === 'user' ? 'self-end bg-surface2 text-ink' : l.role === 'system' ? 'text-gold/90' : 'text-ink/90'}`}>
                <div className="whitespace-pre-wrap">{l.text}</div>
                <div className="mt-0.5 text-[0.75em] text-muted">{new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{l.source ? ` · ${l.source.replace('_', ' ')}` : ''}{l.provider ? ` · ${l.provider}` : ''}</div>
              </li>
            ))}
          </ul>
        )}
        {tab === 'timeline' && (
          timeline.length === 0 ? <Empty text="Actions Clickyy takes will appear here." /> :
          <ul className="flex flex-col gap-1.5">
            {[...timeline].reverse().map((t) => (
              <li key={t.id} className="flex items-start gap-2 rounded-lg bg-surface2/60 px-2.5 py-1.5">
                <span className="mt-0.5">{STATUS_ICON[t.status]}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span>{t.title}</span><Badge tone={riskTone(t.risk)}>{riskLabel(t.risk)}</Badge></div>
                  {t.detail && <div className="selectable mt-0.5 text-[0.8em] text-muted">{t.detail}</div>}
                </div>
                <span className="text-[0.75em] text-muted">{t.status}{t.endedAt ? ` · ${t.endedAt - t.startedAt} ms` : ''}</span>
              </li>
            ))}
          </ul>
        )}
        {tab === 'status' && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-muted">Routing</dt><dd>{settings?.ai.policy.replace('_', ' ')}</dd>
            <dt className="text-muted">Active model</dt><dd>{providers?.activeLabel ?? 'None (commands only)'}</dd>
            <dt className="text-muted">Local model</dt><dd>{providers?.local.ready ? <Badge tone="ok">ready</Badge> : <span className="text-muted">{providers?.local.message ?? 'not configured'}</span>}</dd>
            <dt className="text-muted">Cloud</dt><dd>{providers?.cloud.hasKey ? (providers.cloud.allowed ? <Badge tone="gold">key set · allowed</Badge> : <Badge tone="muted">key set · not allowed</Badge>) : <span className="text-muted">no key</span>}{providers?.cloud.message ? <div className="text-[0.8em] text-danger">{providers.cloud.message}</div> : null}</dd>
            <dt className="text-muted">Network</dt><dd>{providers?.online ? 'online' : 'offline'}</dd>
            <dt className="text-muted">Speech engine</dt><dd>{speech.state === 'ready' ? <Badge tone="ok">Vosk ready</Badge> : <span className={speech.state === 'failed' ? 'text-danger' : 'text-muted'}>{speech.state}{speech.message ? `: ${speech.message}` : ''}</span>}</dd>
            <dt className="text-muted">Microphone</dt><dd>{micMuted ? 'muted' : micError ? <span className="text-danger">{micError}</span> : 'available'}</dd>
            <dt className="text-muted">Voice output</dt><dd>{settings?.speech.ttsEngine === 'neural' ? `Neural voice${speech.neural ? '' : ' (loading)'} · offline` : settings?.speech.ttsEngine === 'system' ? `Windows voice${settings.speech.voiceName ? ` · ${settings.speech.voiceName}` : ''} (offline)` : settings?.speech.ttsEngine === 'cloud' ? 'Cloud voice' : 'Off (text only)'}</dd>
            <dt className="text-muted">Listening</dt><dd>{settings?.listening.mode === 'wake_word' && settings.wake.enabled ? 'always listening for the wake phrase' : settings?.listening.mode === 'conversation' ? 'conversation' : 'push to talk'}</dd>
            <dt className="text-muted">Pending</dt><dd>{confirmations.length ? `${confirmations.length} confirmation(s)` : 'none'}</dd>
          </dl>
        )}
        {tab === 'status' && (
          <button onClick={() => window.dispatchEvent(new CustomEvent('clickyy:submit-text', { detail: 'run a self test' }))}
            className="mt-3 rounded-lg border border-gold/40 px-3 py-1.5 text-[0.85em] text-gold hover:bg-gold/10">
            Run self-test
          </button>
        )}
      </div>
    </motion.div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center gap-2 text-muted"><Clock size={14} /> {text}</div>;
}

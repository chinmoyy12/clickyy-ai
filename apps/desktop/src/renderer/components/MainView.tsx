import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Cloud, CloudOff, Mic, MicOff, Minus, PanelBottomOpen, Send, Settings as Cog, Square, X, ShieldAlert, Radio, MessageCircle } from 'lucide-react';
import { useStore, store, type ChatLine } from '../state/store';
import { call } from '../api';
import { Orb, type OrbMode } from './Orb';
import { Badge } from './ui';

const PHASE_LABEL: Record<string, string> = {
  idle: 'Ready', wake_detected: 'Wake phrase heard', listening: 'Listening…', processing: 'Thinking…', speaking: 'Speaking',
  executing: 'Working…', confirming: 'Waiting for your confirmation', offline: 'Offline', error: 'Something went wrong', muted: 'Microphone muted',
};

export function TitleBar() {
  const providers = useStore((s) => s.providers);
  const network = useStore((s) => s.network);
  const settings = useStore((s) => s.settings);
  const cloudActive = providers?.active === 'cloud';
  const strict = settings?.ai.policy === 'strict_offline';
  return (
    <header className="drag flex h-11 shrink-0 items-center justify-between px-3">
      <div className="flex items-center gap-2.5">
        <span className="wordmark text-[11px] font-semibold text-gold">CLICKYY</span>
        <span
          className="no-drag inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted"
          title={strict ? 'Strict Offline: nothing leaves this PC' : network.active ? `Cloud request in progress (${network.host})` : cloudActive ? 'Cloud model in use for open questions' : 'Local only right now'}
        >
          {network.active ? <Cloud size={11} className="text-cyan" /> : cloudActive && !strict ? <Cloud size={11} /> : <CloudOff size={11} />}
          {strict ? 'Strict offline' : network.active ? 'Cloud active' : cloudActive ? 'Hybrid · cloud ready' : 'Local'}
        </span>
      </div>
      <div className="no-drag flex items-center gap-0.5">
        <IconBtn label="Settings" onClick={() => store.set({ view: 'settings' })}><Cog size={15} /></IconBtn>
        <IconBtn label="Minimize" onClick={() => void call('window:control', { action: 'minimize' })}><Minus size={15} /></IconBtn>
        <IconBtn label="Close" onClick={() => void call('window:control', { action: 'close' })}><X size={15} /></IconBtn>
      </div>
    </header>
  );
}

export function IconBtn({ label, onClick, children, active, className = '' }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; className?: string }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className={`grid h-8 w-8 place-items-center rounded-lg transition-colors ${active ? 'bg-surface2 text-ink' : 'text-muted hover:bg-surface2 hover:text-ink'} ${className}`}>
      {children}
    </button>
  );
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/```(?:[a-z0-9]*)\n?([\s\S]*?)```/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <pre key={i} className="code-block my-2 selectable">{p}</pre> : p.split(/\n{2,}/).map((para, j) => <p key={`${i}-${j}`} className="whitespace-pre-wrap">{para}</p>)))}
    </>
  );
}

export function Conversation() {
  const lines = useStore((s) => s.lines);
  const partial = useStore((s) => s.partial);
  const progress = useStore((s) => s.progress);
  const lastUser = [...lines].reverse().find((l) => l.role === 'user');
  const lastAssistant = [...lines].reverse().find((l) => l.role !== 'user');
  return (
    <div className="flex min-h-[120px] w-full flex-col items-center gap-2 px-6 text-center" aria-live="polite">
      <div className="min-h-[1.4em] text-[0.92em] text-muted">
        {partial ? <span className="text-cyan/90">“{partial}”</span> : lastUser ? <span>“{lastUser.text}”</span> : null}
      </div>
      <AnimatePresence mode="wait">
        {lastAssistant && (
          <motion.div key={lastAssistant.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="selectable max-h-[34vh] w-full overflow-y-auto text-[1.02em] leading-relaxed text-ink [&_p+p]:mt-2">
            <RichText text={lastAssistant.text} />
            {lastAssistant.provider && <div className="mt-1 text-[0.72em] text-muted">via {lastAssistant.provider}</div>}
          </motion.div>
        )}
      </AnimatePresence>
      {progress && <div className="text-[0.85em] text-gold/80">{progress}</div>}
    </div>
  );
}

export function StatusLine({ mode }: { mode: OrbMode }) {
  const detail = useStore((s) => s.phaseDetail);
  const listening = useStore((s) => s.listening);
  const label = listening === 'wake' && mode === 'idle' ? 'Listening for wake phrase' : PHASE_LABEL[mode] ?? mode;
  return (
    <div className="flex items-center gap-2 text-[0.85em] text-muted" role="status">
      {listening !== 'off' && <span className="inline-flex items-center gap-1 rounded-full border border-cyan/40 px-2 py-0.5 text-[0.85em] text-cyan"><Radio size={11} /> mic on</span>}
      <span>{label}{detail && mode === 'executing' ? `: ${detail}` : ''}</span>
    </div>
  );
}

export function Composer({ onTalk, onTalkEnd, onStop, onToggleMute, onConversation }: { onTalk: () => void; onTalkEnd: () => void; onStop: () => void; onToggleMute: () => void; onConversation: () => void }) {
  const [text, setText] = useState('');
  const muted = useStore((s) => s.micMuted);
  const listening = useStore((s) => s.listening);
  const phase = useStore((s) => s.phase);
  const speaking = useStore((s) => s.speaking);
  const mode = useStore((s) => s.settings?.listening.mode);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = phase !== 'idle' || speaking || listening === 'command';

  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener('clickyy:focus-input', focus);
    return () => window.removeEventListener('clickyy:focus-input', focus);
  }, []);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    window.dispatchEvent(new CustomEvent('clickyy:submit-text', { detail: t }));
  };
  const ptt = mode === 'push_to_talk';
  return (
    <div className="w-full px-4 pb-3">
      <div className="flex items-center gap-2">
        <button
          aria-label={muted ? 'Microphone muted (click to unmute)' : ptt ? 'Hold to talk' : 'Talk'}
          title={muted ? 'Unmute microphone' : ptt ? 'Hold to talk (or click)' : 'Talk'}
          onPointerDown={() => { if (!muted && ptt) onTalk(); }}
          onPointerUp={() => { if (!muted && ptt) onTalkEnd(); }}
          onClick={() => { if (muted) onToggleMute(); else if (!ptt) onTalk(); }}
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border transition-colors ${muted ? 'border-line bg-surface text-muted' : listening === 'command' ? 'border-cyan/70 bg-cyan/15 text-cyan' : 'border-gold/50 bg-gold/10 text-gold hover:bg-gold/20'}`}
        >
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <form className="flex flex-1 items-center rounded-xl border border-line bg-surface focus-within:border-gold/50" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input ref={inputRef} aria-label="Type a message" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a command or question…"
            className="selectable h-11 flex-1 bg-transparent px-3 text-[0.95em] outline-none placeholder:text-muted/60" />
          <button type="submit" aria-label="Send" disabled={!text.trim()} className="mr-1 grid h-9 w-9 place-items-center rounded-lg text-muted hover:text-gold disabled:opacity-30"><Send size={16} /></button>
        </form>
        <button aria-label="Stop" title="Stop (Esc)" onClick={onStop} disabled={!busy}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-surface text-muted transition-colors hover:border-danger/60 hover:text-danger disabled:opacity-30">
          <Square size={15} />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between text-[0.75em] text-muted">
        <div className="flex items-center gap-1">
          <button onClick={onToggleMute} className={`rounded-md px-2 py-1 hover:bg-surface2 ${muted ? 'text-danger' : ''}`}>{muted ? 'Mic muted' : 'Mute mic'}</button>
          <button onClick={onConversation} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-surface2" title="Hands-free conversation until you say that's all"><MessageCircle size={12} /> Conversation</button>
          <AlwaysListeningToggle onUnmute={muted ? onToggleMute : undefined} />
        </div>
        <button onClick={() => store.set((s) => ({ panelOpen: !s.panelOpen }))} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-surface2" aria-expanded={store.get().panelOpen}>
          <PanelBottomOpen size={12} /> Activity
        </button>
      </div>
    </div>
  );
}

/**
 * One-click always-on voice: switches to wake-word mode (the mic stays open and listens only for
 * "Jarvis", "Clickyy" or "Hey Clickyy") or back to push-to-talk. The choice is saved.
 */
export function AlwaysListeningToggle({ onUnmute }: { onUnmute?: () => void }) {
  const settings = useStore((s) => s.settings);
  const speech = useStore((s) => s.speech);
  const on = settings?.listening.mode === 'wake_word' && settings.wake.enabled;
  const toggle = async () => {
    const next = !on;
    const patch = { listening: { mode: next ? 'wake_word' : 'push_to_talk' }, wake: { enabled: next } };
    store.set({ settings: await call('settings:update', patch) });
    if (next && onUnmute) onUnmute();
  };
  const notReady = on && speech && speech.state !== 'ready';
  return (
    <button role="switch" aria-checked={on} onClick={() => void toggle()}
      title={on ? 'Always listening for your wake phrase. Click to switch to push-to-talk.' : 'Turn on always-on listening: just say Jarvis or Clickyy'}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors ${on ? 'bg-cyan/10 text-cyan hover:bg-cyan/20' : 'hover:bg-surface2'}`}>
      <span className={`relative inline-block h-3 w-6 rounded-full transition-colors ${on ? 'bg-cyan/70' : 'bg-line'}`}>
        <span className={`absolute top-0.5 h-2 w-2 rounded-full bg-ink transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
      </span>
      <Radio size={12} /> Always listening{notReady ? ' (starting…)' : ''}
    </button>
  );
}

export function ConfirmCard() {
  const confirmations = useStore((s) => s.confirmations);
  const req = confirmations[0];
  const approveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (req) approveRef.current?.focus(); }, [req?.id]);
  if (!req) return null;
  const answer = (approved: boolean) => void call('confirm:respond', { id: req.id, approved });
  const danger = req.risk === 3;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc"
      className={`mx-4 mb-3 rounded-[14px] border p-3.5 ${danger ? 'border-danger/60 bg-danger/10' : 'border-warn/50 bg-warn/5'}`}>
      <div className="flex items-start gap-2.5">
        <ShieldAlert size={18} className={danger ? 'text-danger' : 'text-warn'} />
        <div className="min-w-0 flex-1">
          <div id="confirm-title" className="text-[0.92em] font-semibold">{danger ? 'Confirm destructive action' : 'Confirm action'}: {req.title}</div>
          <p id="confirm-desc" className="selectable mt-1 text-[0.88em] leading-relaxed text-ink/90">{req.description}</p>
          {req.preview && <pre className="code-block mt-2 max-h-32 overflow-y-auto selectable">{req.preview}</pre>}
          <div className="mt-3 flex gap-2">
            <button ref={approveRef} onClick={() => answer(true)} className={`rounded-lg px-3 py-1.5 text-[0.88em] font-medium ${danger ? 'bg-danger/80 text-black hover:bg-danger' : 'bg-gold/80 text-black hover:bg-gold'}`}>
              {req.actionLabel}
            </button>
            <button onClick={() => answer(false)} className="rounded-lg border border-line px-3 py-1.5 text-[0.88em] hover:border-ink/40">Cancel</button>
          </div>
          <p className="mt-2 text-[0.72em] text-muted">Voice can't approve this. Expires in a minute.</p>
        </div>
      </div>
    </div>
  );
}

export function Notices() {
  const notices = useStore((s) => s.notices);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-12 z-40 flex flex-col items-center gap-1.5 px-4" aria-live="polite">
      <AnimatePresence>
        {notices.map((n) => (
          <motion.div key={n.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`pointer-events-auto max-w-[94%] rounded-lg border px-3 py-1.5 text-[0.8em] shadow-lg backdrop-blur ${n.level === 'error' ? 'border-danger/50 bg-[#2a1715]/95 text-danger' : n.level === 'warn' ? 'border-warn/40 bg-[#2a2415]/95 text-warn' : 'border-line bg-surface/95 text-muted'}`}>
            {n.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function lineKey(l: ChatLine) { return l.id; }
export { Badge };

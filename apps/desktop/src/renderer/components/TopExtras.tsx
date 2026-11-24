import { AnimatePresence, motion } from 'framer-motion';
import { Download, Gauge, Rocket, Sparkles, X, Zap } from 'lucide-react';
import { AI_MODES, type AiMode } from '@shared/modes';
import { call } from '../api';
import { notify, store, useStore } from '../state/store';

const MODE_UI: Record<AiMode, { label: string; icon: typeof Zap; hint: string }> = {
  fast: { label: 'Fast', icon: Zap, hint: 'Fast: short, quick answers' },
  balanced: { label: 'Balanced', icon: Gauge, hint: 'Balanced: the everyday default' },
  turbo: { label: 'Turbo', icon: Rocket, hint: 'Turbo: deeper reasoning, fuller answers (slower)' },
};

/** Fast / Balanced / Turbo response modes, one tap away (also by voice: "turbo mode"). */
export function ModeSwitch() {
  const mode = useStore((s) => s.settings?.ai.mode ?? 'balanced');
  const set = (m: AiMode) => {
    if (m === mode) return;
    void call('settings:update', { ai: { mode: m } }).then((s) => store.set({ settings: s })).catch((e) => notify('error', (e as Error).message));
  };
  return (
    <div role="radiogroup" aria-label="Response mode" className="glass no-drag relative flex items-center rounded-full p-0.5">
      {AI_MODES.map((m) => {
        const { label, icon: Icon, hint } = MODE_UI[m];
        const on = m === mode;
        return (
          <button key={m} role="radio" aria-checked={on} title={hint} onClick={() => set(m)}
            className={`relative z-10 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${on ? 'text-[#1a120a]' : 'text-muted hover:text-ink'}`}>
            {on && <motion.span layoutId="mode-pill" className="btn-gold absolute inset-0 -z-10 rounded-full" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
            <Icon size={10} strokeWidth={2.4} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

const fmtMB = (n = 0) => `${(n / 1e6).toFixed(0)} MB`;

/** Shown when a new version is out: update in place, no website visit needed. */
export function UpdateBanner() {
  const u = useStore((s) => s.update);
  const dismissed = useStore((s) => s.updateDismissed);
  const show = !!u && (['available', 'downloading', 'ready', 'installing'].includes(u.state) || (u.state === 'error' && !!u.latest && u.message.startsWith('Update failed'))) && dismissed !== u.latest;
  const pct = u?.size ? Math.min(100, Math.round(((u.done ?? 0) / u.size) * 100)) : 0;
  const busy = u?.state === 'downloading' || u?.state === 'installing';
  return (
    <AnimatePresence>
      {show && u && (
        <motion.div initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          role="status" className="glass-strong relative z-20 mx-3 mt-1 overflow-hidden rounded-xl px-3 py-2 text-[0.85em]">
          <div className="flex items-center gap-2.5">
            <Sparkles size={15} className="shrink-0 text-gold" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {u.state === 'downloading' ? `Downloading version ${u.latest}… ${pct}%`
                  : u.state === 'installing' ? 'Installing. Clickyy will restart in a moment…'
                    : u.state === 'ready' ? `Version ${u.latest} is downloaded and verified`
                      : u.state === 'error' ? u.message
                        : `Version ${u.latest} is available`}
              </div>
              {u.state === 'available' && <div className="truncate text-[0.9em] text-muted" title={u.notes}>{u.notes || `You have ${u.current}.`} {u.size ? `· ${fmtMB(u.size)}` : ''}</div>}
            </div>
            {!busy && (
              <button className="btn-gold inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[0.9em] font-semibold"
                onClick={() => void call('updates:install').catch((e) => notify('error', (e as Error).message))}>
                <Download size={13} /> {u.state === 'error' ? 'Retry' : 'Update now'}
              </button>
            )}
            {!busy && (
              <button aria-label="Later" title="Later (Skip this version in Settings › About)" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface2 hover:text-ink"
                onClick={() => store.set({ updateDismissed: u.latest })}>
                <X size={14} />
              </button>
            )}
          </div>
          {busy && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
              <motion.div className="h-full rounded-full bg-gradient-to-r from-[#c38f5e] to-[#f3d3a8]" animate={{ width: u.state === 'installing' ? '100%' : `${pct}%` }} transition={{ ease: 'easeOut' }} />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

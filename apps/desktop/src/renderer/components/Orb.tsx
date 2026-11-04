import { useEffect, useRef } from 'react';
import type { AssistantPhase } from '@shared/types';
import { store } from '../state/store';

export type OrbMode = AssistantPhase | 'muted';

const COLORS: Record<OrbMode, { core: string; glow: string; ring: string }> = {
  idle: { core: '#2a2620', glow: 'rgba(212,163,115,0.10)', ring: 'rgba(212,163,115,0.35)' },
  wake_detected: { core: '#3a3326', glow: 'rgba(212,163,115,0.35)', ring: 'rgba(245,214,170,0.9)' },
  listening: { core: '#1d2a2e', glow: 'rgba(142,216,232,0.22)', ring: 'rgba(142,216,232,0.85)' },
  processing: { core: '#2a2620', glow: 'rgba(212,163,115,0.18)', ring: 'rgba(212,163,115,0.9)' },
  speaking: { core: '#33291f', glow: 'rgba(212,163,115,0.28)', ring: 'rgba(232,190,140,0.95)' },
  executing: { core: '#2a2620', glow: 'rgba(212,163,115,0.18)', ring: 'rgba(212,163,115,0.9)' },
  confirming: { core: '#332b1a', glow: 'rgba(232,194,122,0.25)', ring: 'rgba(232,194,122,0.95)' },
  offline: { core: '#1e2024', glow: 'rgba(150,154,163,0.08)', ring: 'rgba(150,154,163,0.4)' },
  error: { core: '#2e1c1a', glow: 'rgba(229,120,109,0.22)', ring: 'rgba(229,120,109,0.9)' },
  muted: { core: '#1b1c20', glow: 'rgba(150,154,163,0.05)', ring: 'rgba(150,154,163,0.3)' },
};

/**
 * The voice orb. Every visual state maps to a real application state; ring
 * amplitude is driven by the measured microphone level while listening and by
 * measured playback level for cloud audio. For Windows system voices no
 * amplitude is available, so speaking shows a steady pulse rather than a
 * simulated waveform.
 */
export function Orb({ mode, reducedMotion, size = 210 }: { mode: OrbMode; reducedMotion: boolean; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    let raf = 0;
    let level = 0;
    let t0 = performance.now();

    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      const m = modeRef.current;
      const c = COLORS[m];
      const s = store.get();
      const target = m === 'listening' ? s.micLevel : m === 'speaking' ? s.speakLevel : 0;
      level += (target - level) * 0.25;
      const cx = size / 2, cy = size / 2;
      const base = size * 0.27;
      const breathe = reducedMotion ? 0 : m === 'idle' ? Math.sin(t * 1.1) * 1.5 : m === 'speaking' && s.speakLevel === 0 ? Math.sin(t * 5) * 2.5 : 0;
      const r = base + breathe + level * size * 0.07;

      ctx.clearRect(0, 0, size, size);
      // glow
      const g = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, size * 0.5);
      g.addColorStop(0, c.glow);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      // core sphere
      const sg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.05, cx, cy, r);
      sg.addColorStop(0, 'rgba(255,236,210,0.10)');
      sg.addColorStop(0.45, c.core);
      sg.addColorStop(1, '#0c0d0f');
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = sg;
      ctx.fill();
      // rim
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = c.ring;
      ctx.globalAlpha = m === 'idle' || m === 'muted' || m === 'offline' ? 0.55 : 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (!reducedMotion) {
        if (m === 'listening') {
          for (let i = 0; i < 3; i++) {
            const p = ((t * 0.6 + i / 3) % 1);
            ctx.beginPath();
            ctx.arc(cx, cy, r + 6 + p * (18 + level * 30), 0, Math.PI * 2);
            ctx.strokeStyle = c.ring;
            ctx.globalAlpha = (1 - p) * 0.45;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        } else if (m === 'processing' || m === 'executing') {
          const a = t * (m === 'executing' ? 3.2 : 2.2);
          ctx.beginPath();
          ctx.arc(cx, cy, r + 9, a, a + Math.PI * 0.6);
          ctx.strokeStyle = c.ring;
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.stroke();
          if (m === 'executing') {
            ctx.beginPath();
            ctx.arc(cx + Math.cos(-a) * (r + 9), cy + Math.sin(-a) * (r + 9), 2.5, 0, Math.PI * 2);
            ctx.fillStyle = c.ring;
            ctx.fill();
          }
        } else if (m === 'speaking') {
          ctx.beginPath();
          ctx.arc(cx, cy, r + 7 + level * 16, 0, Math.PI * 2);
          ctx.strokeStyle = c.ring;
          ctx.globalAlpha = 0.35 + level * 0.5;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (m === 'confirming' || m === 'wake_detected') {
          const p = (Math.sin(t * 3) + 1) / 2;
          ctx.beginPath();
          ctx.arc(cx, cy, r + 8 + p * 4, 0, Math.PI * 2);
          ctx.strokeStyle = c.ring;
          ctx.globalAlpha = 0.3 + p * 0.4;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      if (m === 'muted') {
        ctx.strokeStyle = 'rgba(150,154,163,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.5, cy + r * 0.5);
        ctx.lineTo(cx + r * 0.5, cy - r * 0.5);
        ctx.stroke();
      }
      const animating = !reducedMotion || m === 'listening' || m === 'speaking';
      if (!animating || document.hidden) return;
      // Calm states only need a slow breathing motion; keep CPU near zero while idle.
      const calm = m === 'idle' || m === 'muted' || m === 'offline';
      if (calm) idleTimer = setTimeout(() => { raf = requestAnimationFrame(draw); }, 66);
      else raf = requestAnimationFrame(draw);
    };
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const restart = () => { cancelAnimationFrame(raf); clearTimeout(idleTimer); raf = requestAnimationFrame(draw); };
    restart();
    let lastMode = modeRef.current;
    const unsub = store.subscribe(() => {
      // Redraw promptly on state changes (the idle loop may be sleeping between frames).
      if (reducedMotion || modeRef.current !== lastMode) { lastMode = modeRef.current; restart(); }
    });
    const onVis = () => { if (!document.hidden) { t0 = performance.now(); restart(); } };
    document.addEventListener('visibilitychange', onVis);
    canvas.addEventListener('orb-mode', restart);
    return () => { cancelAnimationFrame(raf); clearTimeout(idleTimer); unsub(); document.removeEventListener('visibilitychange', onVis); canvas.removeEventListener('orb-mode', restart); };
  }, [size, reducedMotion]);

  useEffect(() => { ref.current?.dispatchEvent(new Event('orb-mode')); }, [mode]);

  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />;
}

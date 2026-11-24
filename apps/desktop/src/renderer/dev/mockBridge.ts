/**
 * Development-only stand-in for the Electron bridge, so the interface can be designed and checked in a
 * normal browser (vite dev server, `?mock`). Never bundled into the app: main.tsx imports it only when
 * import.meta.env.DEV is true and no real bridge exists. Keys 1-9 cycle through the assistant states.
 */
import { defaultSettings, type Settings } from '@shared/settings';
import type { AssistantPhase } from '@shared/types';
import { store } from '../state/store';

type Listener = (data: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const emit = (channel: string, data: unknown) => listeners.get(channel)?.forEach((l) => l(data));
let settings: Settings = defaultSettings();
let turn = 0;

const REPLIES: Record<string, string> = {
  "what's the news?": 'Here are the top headlines. 1. Monsoon arrives early across Kerala this year, from The Hindu. 2. Markets close higher as tech stocks rally, from Mint. 3. New metro line opens in Bengaluru, from Deccan Herald.',
  'tell me a joke': 'Why was the keyboard so tired? It had two shifts.',
  "how's my battery?": 'Battery is at 81 percent and charging. About 40 minutes to full.',
  'help me relax': "Let's do 3 rounds of box breathing. Sit comfortably and relax your shoulders. Breathe in slowly... two, three, four.",
};

async function invoke(channel: string, payload?: unknown): Promise<unknown> {
  switch (channel) {
    case 'settings:get': return settings;
    case 'settings:update': settings = { ...settings, ...(payload as Partial<Settings>) } as Settings; emit('settings:changed', settings); return settings;
    case 'speech:status': return { state: 'ready', engine: 'vosk (mock)', neural: true, accurate: true };
    case 'providers:status': return { policy: 'smart_hybrid', online: true, local: { configured: true, ready: true, model: 'llama3.2', models: ['llama3.2'] }, cloud: { provider: 'gemini', model: 'gemini', hasKey: false, allowed: false }, keys: {}, active: 'local', activeLabel: 'Ollama · llama3.2' };
    case 'assistant:submit': {
      const text = String((payload as { text: string }).text);
      const id = `m${++turn}`;
      emit('assistant:event', { type: 'user', turnId: id, text, source: 'text' });
      emit('assistant:event', { type: 'phase', phase: 'processing' });
      await new Promise((r) => setTimeout(r, 900));
      const reply = { turnId: id, text: REPLIES[text.toLowerCase()] ?? `You said "${text}". (Design preview: no assistant is connected.)`, speech: '', style: 'warm', source: 'deterministic', expectFollowUp: false };
      emit('assistant:event', { type: 'reply', reply });
      emit('assistant:event', { type: 'phase', phase: 'idle' });
      return reply;
    }
    case 'reminders:list': return [];
    case 'brain:status': return { intents: 199, runnable: 61, learned: [] };
    default: return null;
  }
}

let levelTimer: ReturnType<typeof setInterval> | undefined;
const PHASES: Array<AssistantPhase | 'listen' | 'speak'> = ['idle', 'listen', 'processing', 'speak', 'executing', 'confirming', 'error', 'offline', 'wake_detected'];
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  const i = Number(e.key) - 1;
  if (!(i >= 0 && i < PHASES.length)) return;
  const p = PHASES[i];
  clearInterval(levelTimer);
  store.set({ listening: 'off', speaking: false, micLevel: 0, speakLevel: 0, notices: [] });
  if (p === 'listen' || p === 'speak') {
    emit('assistant:event', { type: 'phase', phase: 'idle' });
    store.set(p === 'listen' ? { listening: 'command' } : { speaking: true });
    // Preview only: a made-up level so the design can be judged. The real app uses measured audio.
    levelTimer = setInterval(() => { const v = Math.abs(Math.sin(performance.now() / 180)) * 0.6 * Math.random(); store.set(p === 'listen' ? { micLevel: v } : { speakLevel: v }); }, 60);
    return;
  }
  emit('assistant:event', { type: 'phase', phase: p });
});

window.clickyy = {
  invoke,
  on(channel, cb) {
    const set = listeners.get(channel) ?? new Set<Listener>();
    set.add(cb);
    listeners.set(channel, set);
    return () => set.delete(cb);
  },
  sendAudio() {},
  ttsState() {},
};

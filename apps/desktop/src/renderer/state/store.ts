import { useSyncExternalStore } from 'react';
import type { Settings } from '@shared/settings';
import type { AssistantPhase, ConfirmationRequest, ProviderStatus, SpeechServiceStatus, ToolCallRecord } from '@shared/types';

export interface ChatLine { id: string; role: 'user' | 'assistant' | 'system'; text: string; source?: string; provider?: string; at: number; streaming?: boolean }
export interface Notice { id: number; level: 'info' | 'warn' | 'error'; text: string; at: number }

export interface UiState {
  settings: Settings | null;
  phase: AssistantPhase;
  phaseDetail?: string;
  listening: 'off' | 'wake' | 'command';
  partial: string;
  lines: ChatLine[];
  timeline: ToolCallRecord[];
  confirmations: ConfirmationRequest[];
  providers: ProviderStatus | null;
  speech: SpeechServiceStatus;
  micMuted: boolean;
  micError: string | null;
  micLevel: number;
  speakLevel: number;
  speaking: boolean;
  network: { active: boolean; host?: string };
  notices: Notice[];
  progress: string;
  view: 'main' | 'settings';
  panelOpen: boolean;
}

let state: UiState = {
  settings: null, phase: 'idle', listening: 'off', partial: '', lines: [], timeline: [], confirmations: [], providers: null,
  speech: { state: 'stopped' }, micMuted: false, micError: null, micLevel: 0, speakLevel: 0, speaking: false,
  network: { active: false }, notices: [], progress: '', view: 'main', panelOpen: false,
};
const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)) {
    const p = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...p };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useStore<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(state));
}

let noticeId = 0;
export function notify(level: Notice['level'], text: string) {
  const n = { id: ++noticeId, level, text, at: Date.now() };
  store.set((s) => ({ notices: [...s.notices.slice(-3), n] }));
  setTimeout(() => store.set((s) => ({ notices: s.notices.filter((x) => x.id !== n.id) })), level === 'error' ? 9000 : 5000);
}

export function upsertTimeline(call: ToolCallRecord) {
  store.set((s) => {
    const i = s.timeline.findIndex((t) => t.id === call.id);
    const next = i >= 0 ? s.timeline.map((t, j) => (j === i ? { ...t, ...call } : t)) : [...s.timeline, call];
    return { timeline: next.slice(-60) };
  });
}

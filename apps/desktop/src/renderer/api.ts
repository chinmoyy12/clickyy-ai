import type { IpcChannel, IpcPayload } from '@shared/ipc';
import type { AppEntry, AuditEntry, CatalogEntry, ConversationSummary, Diagnostics, Memory, ProviderStatus, Reminder, Routine, SpeechServiceStatus, StoredMessage, AssistantReply, ConfirmationRequest, NeuralVoice, ModelDownloadStatus } from '@shared/types';
import type { Settings } from '@shared/settings';

interface Bridge {
  invoke(channel: IpcChannel, payload?: unknown): Promise<unknown>;
  on(channel: 'assistant:event' | 'speech:event' | 'settings:changed' | 'ui:command', cb: (data: unknown) => void): () => void;
  sendAudio(frame: ArrayBuffer): void;
  ttsState(speaking: boolean): void;
}

declare global {
  interface Window { clickyy?: Bridge }
}

const missing: Bridge = {
  invoke: async () => { throw new Error('Clickyy bridge unavailable (open this UI inside the desktop app)'); },
  on: () => () => {},
  sendAudio: () => {},
  ttsState: () => {},
};
export const bridge: Bridge = window.clickyy ?? missing;

interface Returns {
  'settings:get': Settings; 'settings:update': Settings; 'assistant:submit': AssistantReply; 'providers:status': ProviderStatus;
  'providers:test': { ok: boolean; message?: string; models?: string[] }; 'speech:status': SpeechServiceStatus; 'history:list': ConversationSummary[];
  'history:get': StoredMessage[]; 'memory:list': Memory[]; 'memory:add': Memory; 'apps:list': AppEntry[]; 'apps:upsert': AppEntry; 'apps:detect': number;
  'routines:list': Routine[]; 'routines:upsert': Routine; 'routines:preview': Array<{ tool: string; title: string; risk: number; valid: boolean; error?: string; confirm: boolean }>;
  'reminders:list': Reminder[]; 'catalog:list': CatalogEntry[]; 'audit:list': AuditEntry[]; 'diagnostics:get': Diagnostics; 'folders:pick': string | null;
  'tts:cloud': string; 'providers:models': string[]; 'tts:neural': string; 'tts:voices': NeuralVoice[]; 'assistant:status': { busy: boolean; pending: ConfirmationRequest[] };
  'models:status': ModelDownloadStatus; 'models:download': ModelDownloadStatus;
}

export function call<C extends IpcChannel>(channel: C, payload?: IpcPayload<C>): Promise<C extends keyof Returns ? Returns[C] : unknown> {
  return bridge.invoke(channel, payload) as Promise<C extends keyof Returns ? Returns[C] : unknown>;
}

import type { PermissionKey, RoutingPolicy, WakePhraseId } from './settings';

export type RiskLevel = 1 | 2 | 3;

export type AssistantPhase =
  | 'idle'
  | 'wake_detected'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'executing'
  | 'confirming'
  | 'offline'
  | 'error';

export type ExpressionStyle = 'warm' | 'confident' | 'calm' | 'apologetic' | 'excited' | 'gentle' | 'focused' | 'neutral';

export interface ToolCallRecord {
  id: string;
  tool: string;
  title: string;
  risk: RiskLevel;
  status: 'planned' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  detail?: string;
  startedAt: number;
  endedAt?: number;
}

export interface ConfirmationRequest {
  id: string;
  tool: string;
  risk: RiskLevel;
  title: string;
  description: string;
  /** Button text naming the exact action, e.g. "Restart in 30 seconds". */
  actionLabel: string;
  preview?: string;
  expiresAt: number;
}

export interface AssistantReply {
  turnId: string;
  /** What is shown on screen (may include formatting). */
  text: string;
  /** What is spoken aloud (plain, speech-friendly). Empty = do not speak. */
  speech: string;
  style: ExpressionStyle;
  source: 'deterministic' | 'local_llm' | 'cloud_llm' | 'system';
  providerLabel?: string;
  expectFollowUp: boolean;
}

export type AssistantEvent =
  | { type: 'phase'; phase: AssistantPhase; detail?: string }
  | { type: 'user'; turnId: string; text: string; source: 'text' | 'voice' }
  | { type: 'reply_delta'; turnId: string; text: string }
  | { type: 'reply'; reply: AssistantReply }
  | { type: 'progress'; turnId: string; text: string }
  | { type: 'tool'; call: ToolCallRecord }
  | { type: 'confirm'; request: ConfirmationRequest }
  | { type: 'confirm_resolved'; id: string; approved: boolean }
  | { type: 'speech_control'; action: 'stop' | 'slower' | 'faster' | 'repeat' }
  | { type: 'network'; active: boolean; host?: string; purpose?: string }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; text: string }
  | { type: 'session_reset' };

export type SpeechEvent =
  | { type: 'status'; status: SpeechServiceStatus }
  | { type: 'ready'; mode: 'wake' | 'command' }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string; confidence: number }
  | { type: 'silence' }
  | { type: 'wake'; phrase: WakePhraseId; confidence: number }
  | { type: 'error'; code: string; message: string };

export interface SpeechServiceStatus {
  state: 'stopped' | 'starting' | 'ready' | 'degraded' | 'failed';
  message?: string;
  engine?: string;
  wakeSupport?: Partial<Record<WakePhraseId, boolean>>;
}

export interface ProviderStatus {
  policy: RoutingPolicy;
  online: boolean;
  local: { configured: boolean; ready: boolean; model: string; models: string[]; message?: string };
  cloud: { provider: string; model: string; hasKey: boolean; allowed: boolean; message?: string };
  /** Which providers have a stored key (never the key itself). */
  keys: Record<string, boolean>;
  active: 'local' | 'cloud' | 'none';
  activeLabel?: string;
}

export interface ConversationSummary { id: string; title: string; createdAt: number; updatedAt: number; messageCount: number }
export interface StoredMessage { id: string; conversationId: string; role: 'user' | 'assistant'; text: string; createdAt: number; meta?: Record<string, unknown> }
export interface Memory { id: string; text: string; category: string; createdAt: number; updatedAt: number }
export interface AppEntry {
  id: string;
  name: string;
  aliases: string[];
  kind: 'exe' | 'uri' | 'appx';
  target: string;
  processName?: string;
  detected: boolean;
  enabled: boolean;
}
export interface RoutineStep { tool: string; args: Record<string, unknown>; label?: string }
export interface Routine { id: string; name: string; phrases: string[]; steps: RoutineStep[]; enabled: boolean; updatedAt: number }
export interface Reminder { id: string; text: string; dueAt: number; kind: 'reminder' | 'timer' | 'focus'; status: 'pending' | 'done' | 'cancelled'; createdAt: number }
export interface AuditEntry { id: number; at: number; tool: string; risk: RiskLevel; outcome: string; summary: string; durationMs: number }

export interface CatalogEntry {
  id: string;
  category: string;
  description: string;
  examples: string[];
  tool?: string;
  risk: RiskLevel;
  permission?: PermissionKey;
  confirmation: 'never' | 'always' | 'conditional';
  offline: boolean;
}

export interface Diagnostics {
  appVersion: string;
  electron: string;
  platform: string;
  dataDir: string;
  db: { path: string; sizeBytes: number };
  bridge: { state: string; lastError?: string };
  speech: SpeechServiceStatus;
  memoryMB: number;
  uptimeSec: number;
  logs: string[];
}

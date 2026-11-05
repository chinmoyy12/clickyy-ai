/**
 * Typed IPC contract. Every invoke channel has a zod schema for its payload;
 * the main process validates before handling and rejects unknown channels.
 */
import { z } from 'zod';
import { CLOUD_PROVIDERS } from './providers';

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const empty = z.undefined().or(z.null()).or(z.object({}).strict());

export const AppEntryInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(60),
  aliases: z.array(z.string().trim().min(1).max(60)).max(12),
  kind: z.enum(['exe', 'uri', 'appx']),
  target: z.string().trim().min(1).max(400),
  processName: z.string().max(80).optional(),
  enabled: z.boolean().default(true),
});

export const RoutineInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(60),
  phrases: z.array(z.string().trim().min(2).max(80)).min(1).max(8),
  steps: z.array(z.object({ tool: z.string().min(1).max(64), args: z.record(z.string(), z.unknown()), label: z.string().max(80).optional() })).min(1).max(20),
  enabled: z.boolean().default(true),
});

export const IpcInvoke = {
  'settings:get': empty,
  'settings:update': z.record(z.string(), z.unknown()),
  'assistant:submit': z.object({ text: z.string().trim().min(1).max(4000), source: z.enum(['text', 'voice']) }),
  'assistant:cancel': empty,
  'assistant:emergencyStop': empty,
  'assistant:newSession': empty,
  'assistant:status': empty,
  'confirm:respond': z.object({ id, approved: z.boolean() }),
  'history:list': empty,
  'history:get': z.object({ id }),
  'history:delete': z.object({ id }),
  'history:clear': empty,
  'history:export': empty,
  'memory:list': z.object({ query: z.string().max(200).optional() }).nullish(),
  'memory:add': z.object({ text: z.string().trim().min(1).max(1000), category: z.string().max(40).default('note') }),
  'memory:update': z.object({ id, text: z.string().trim().min(1).max(1000) }),
  'memory:delete': z.object({ id }),
  'memory:clear': empty,
  'memory:export': empty,
  'apps:list': empty,
  'apps:upsert': AppEntryInput,
  'apps:delete': z.object({ id }),
  'apps:detect': empty,
  'routines:list': empty,
  'routines:upsert': RoutineInput,
  'routines:delete': z.object({ id }),
  'routines:preview': RoutineInput,
  'reminders:list': empty,
  'reminders:cancel': z.object({ id }),
  'secrets:set': z.object({ provider: z.enum(CLOUD_PROVIDERS), key: z.string().trim().min(8).max(500) }),
  'secrets:clear': z.object({ provider: z.enum(CLOUD_PROVIDERS) }),
  'providers:status': empty,
  'providers:test': z.object({ target: z.enum(['local', 'cloud']) }),
  'providers:models': z.object({ provider: z.enum([...CLOUD_PROVIDERS, 'local'] as [string, ...string[]]) }),
  'speech:status': empty,
  'speech:restart': empty,
  'speech:start': z.object({ mode: z.enum(['wake', 'command']) }),
  'speech:stop': empty,
  'speech:cancel': empty,
  'tts:cloud': z.object({ text: z.string().min(1).max(4000) }),
  'tts:neural': z.object({ text: z.string().min(1).max(1200) }),
  'tts:voices': empty,
  'catalog:list': empty,
  'audit:list': empty,
  'diagnostics:get': empty,
  'data:clearAll': z.object({ confirm: z.literal('DELETE') }),
  'folders:pick': z.object({ purpose: z.enum(['approved', 'workspace']) }),
  'window:control': z.object({ action: z.enum(['minimize', 'hide', 'close', 'quit']) }),
} as const;

export type IpcChannel = keyof typeof IpcInvoke;
export type IpcPayload<C extends IpcChannel> = z.input<(typeof IpcInvoke)[C]>;

/** Fire-and-forget channels (renderer -> main). */
export const IpcSend = {
  'speech:audio': 'binary PCM16LE mono 16 kHz frame (ArrayBuffer, <= 64 KB)',
  'tts:state': z.object({ speaking: z.boolean() }),
} as const;

/** Push channels (main -> renderer). */
export const IpcEvents = ['assistant:event', 'speech:event', 'settings:changed', 'ui:command'] as const;
export type IpcEventChannel = (typeof IpcEvents)[number];

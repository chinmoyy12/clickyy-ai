import type { z } from 'zod';
import type { PermissionKey, Settings } from '@shared/settings';
import type { RiskLevel } from '@shared/types';
import type { WindowsBridge } from '../windows/bridge';
import type { Repos } from '../storage/repos';

export interface Platform {
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<string>; // resolves to '' on success, error text otherwise (Electron shell.openPath semantics)
  spawnDetached(file: string, args: string[]): Promise<void>;
  trashItem(path: string): Promise<void>;
  notify(title: string, body: string): void;
  fileExists(path: string): boolean;
  isOnline(): boolean;
  /** One PNG screenshot of the primary display, base64. */
  captureScreen(): Promise<string>;
}

export interface ToolContext {
  settings: Settings;
  bridge: WindowsBridge;
  repos: Repos;
  platform: Platform;
  signal: AbortSignal;
  /** Session memory shared between turns (last app, last window, previous volume…). */
  session: SessionState;
  scheduler: { schedule(id: string, dueAt: number): void; cancel(id: string): void };
  /** Network access for tools, routed through the NetGuard (blocked in Strict Offline). */
  net: typeof fetch;
}

export interface SessionState {
  lastApp?: { id: string; name: string; processName?: string };
  lastWindow?: { hwnd: number; title: string };
  previousVolume?: number;
  duckedFrom?: number;
  lastSpoken?: string;
  lastUserText?: string;
  lastTool?: { name: string; input: unknown };
  [key: string]: unknown;
}

export interface ToolResult<O = unknown> {
  ok: boolean;
  data?: O;
  /** Short, speech-friendly sentence describing what happened. */
  message: string;
  /** Optional on-screen detail (lists, previews). */
  detail?: string;
}

export type ConfirmPolicy = 'never' | 'always' | ((input: never, ctx: ToolContext) => boolean);

export interface ToolDef<I extends z.ZodType = z.ZodType, O = unknown> {
  name: string;
  title: string;
  description: string;
  category: string;
  risk: RiskLevel;
  permission: PermissionKey | null;
  input: I;
  confirm: ConfirmPolicy;
  timeoutMs: number;
  /** Works with no network and no model. */
  offline: boolean;
  /** Human-readable description of exactly what will happen, used in confirmations. */
  describe(input: z.output<I>, ctx: ToolContext): string | Promise<string>;
  /** Confirmation button text naming the exact action. */
  confirmLabel?(input: z.output<I>): string;
  /** Optional preview text (file changes, step lists). */
  preview?(input: z.output<I>, ctx: ToolContext): Promise<string | undefined>;
  run(input: z.output<I>, ctx: ToolContext): Promise<ToolResult<O>>;
}

export const defineTool = <I extends z.ZodType>(t: ToolDef<I, unknown>): ToolDef => t as unknown as ToolDef;

export class ToolError extends Error {
  constructor(message: string, readonly code: 'invalid_input' | 'permission' | 'denied' | 'timeout' | 'cancelled' | 'failed' | 'unknown_tool' = 'failed') {
    super(message);
    this.name = 'ToolError';
  }
}

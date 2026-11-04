import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ToolCallRecord } from '@shared/types';
import { auditSummary } from '../security/redact';
import type { ConfirmationBroker } from './confirmations';
import { ToolError, type ToolContext, type ToolDef, type ToolResult } from './types';

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();
  register(...defs: ToolDef[]) {
    for (const d of defs) {
      if (this.tools.has(d.name)) throw new Error(`Duplicate tool ${d.name}`);
      if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(d.name)) throw new Error(`Invalid tool name ${d.name}`);
      this.tools.set(d.name, d);
    }
    return this;
  }
  get(name: string) { return this.tools.get(name); }
  list() { return [...this.tools.values()]; }
  /** JSON schemas for LLM tool calling (names use '__' because some providers reject dots). */
  llmTools(filter: (t: ToolDef) => boolean = () => true) {
    return this.list().filter(filter).map((t) => ({
      name: t.name.replace('.', '__'),
      description: `${t.description}${t.risk > 1 ? ' Requires the user to confirm on screen.' : ''}`,
      parameters: z.toJSONSchema(t.input, { io: 'input' }) as Record<string, unknown>,
    }));
  }
  fromLlmName(name: string) { return this.tools.get(name.replace('__', '.')); }
}

export interface ExecuteOptions {
  /** Set by deterministic routing when the user's own words fully specify the action. */
  origin: 'user_command' | 'llm' | 'routine';
}

/**
 * The only path from intent to side effect: validate → permission → confirm → run (timeout, abort) → audit.
 */
export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private broker: ConfirmationBroker,
    private onRecord: (r: ToolCallRecord) => void,
  ) {}

  async execute(name: string, rawInput: unknown, ctx: ToolContext, opts: ExecuteOptions): Promise<ToolResult> {
    const tool = this.registry.get(name);
    const record: ToolCallRecord = { id: randomUUID().slice(0, 12), tool: name, title: tool?.title ?? name, risk: tool?.risk ?? 3, status: 'running', startedAt: Date.now() };
    const finish = (status: ToolCallRecord['status'], detail: string) => {
      record.status = status;
      record.detail = detail;
      record.endedAt = Date.now();
      this.onRecord({ ...record });
      ctx.repos.audit.log(name, record.risk, status, auditSummary({ origin: opts.origin, input: rawInput, detail }), record.endedAt - record.startedAt);
    };

    if (!tool) {
      finish('failed', 'unknown tool');
      throw new ToolError(`I don't have a tool called ${name}.`, 'unknown_tool');
    }
    const parsed = tool.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      finish('failed', 'invalid input');
      throw new ToolError(`That request had invalid details: ${parsed.error.issues[0]?.message ?? 'invalid input'}.`, 'invalid_input');
    }
    const input = parsed.data;
    if (tool.permission && !ctx.settings.tools.permissions[tool.permission]) {
      finish('failed', `permission ${tool.permission} disabled`);
      throw new ToolError(`The ${tool.permission} permission is turned off. You can enable it in Settings, Permissions.`, 'permission');
    }
    if (ctx.signal.aborted) {
      finish('cancelled', 'cancelled before start');
      throw new ToolError('Cancelled.', 'cancelled');
    }

    const needsConfirm =
      tool.risk === 3 ||
      tool.confirm === 'always' ||
      (typeof tool.confirm === 'function' && (tool.confirm as (i: unknown, c: ToolContext) => boolean)(input, ctx)) ||
      // Anything sensitive proposed by a model (not stated by the user) is always confirmed.
      (tool.risk === 2 && opts.origin === 'llm');

    if (needsConfirm) {
      record.status = 'waiting';
      this.onRecord({ ...record });
      const description = await tool.describe(input, ctx);
      const preview = tool.preview ? await tool.preview(input, ctx).catch(() => undefined) : undefined;
      const approved = await this.broker.request(tool.name, tool.risk, tool.title, description, input, preview, ctx.signal, tool.confirmLabel?.(input));
      if (!approved) {
        finish(ctx.signal.aborted ? 'cancelled' : 'failed', 'declined');
        throw new ToolError(ctx.signal.aborted ? 'Cancelled.' : "Okay, I won't do that.", ctx.signal.aborted ? 'cancelled' : 'denied');
      }
      record.status = 'running';
      this.onRecord({ ...record });
    } else {
      this.onRecord({ ...record });
    }

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), tool.timeoutMs);
    const signal = AbortSignal.any([ctx.signal, timeout.signal]);
    try {
      const result = await Promise.race([
        tool.run(input, { ...ctx, signal }),
        new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new ToolError(ctx.signal.aborted ? 'Cancelled.' : `${tool.title} timed out.`, ctx.signal.aborted ? 'cancelled' : 'timeout')), { once: true })),
      ]);
      finish(result.ok ? 'completed' : 'failed', result.message);
      ctx.session.lastTool = { name, input };
      return result;
    } catch (e) {
      const err = e instanceof ToolError ? e : new ToolError(e instanceof Error ? e.message : String(e));
      finish(err.code === 'cancelled' ? 'cancelled' : 'failed', err.message);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

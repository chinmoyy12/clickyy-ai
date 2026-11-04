import { createHash, randomUUID } from 'node:crypto';
import type { ConfirmationRequest, RiskLevel } from '@shared/types';

interface PendingConfirmation {
  request: ConfirmationRequest;
  binding: string;
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

export const bindingFor = (tool: string, input: unknown) =>
  createHash('sha256').update(`${tool}\u0000${JSON.stringify(input)}`).digest('hex');

/**
 * Holds pending confirmations. Approval can only come from the UI (IPC), is
 * single-use, bound to the exact tool + validated input, and expires. Voice
 * transcripts can never approve an action on their own.
 */
export class ConfirmationBroker {
  private pending = new Map<string, PendingConfirmation>();

  constructor(private emit: (req: ConfirmationRequest) => void, private emitResolved: (id: string, approved: boolean) => void, private ttlMs = 60_000) {}

  request(tool: string, risk: RiskLevel, title: string, description: string, input: unknown, preview: string | undefined, signal: AbortSignal, actionLabel = `Yes, ${title.toLowerCase()}`): Promise<boolean> {
    const id = randomUUID().replace(/-/g, '');
    const request: ConfirmationRequest = { id, tool, risk, title, description, actionLabel, preview, expiresAt: Date.now() + this.ttlMs };
    return new Promise<boolean>((resolve) => {
      const finish = (approved: boolean) => {
        const p = this.pending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(id);
        this.emitResolved(id, approved);
        resolve(approved);
      };
      const timer = setTimeout(() => finish(false), this.ttlMs);
      this.pending.set(id, { request, binding: bindingFor(tool, input), resolve: finish, timer });
      signal.addEventListener('abort', () => finish(false), { once: true });
      this.emit(request);
    });
  }

  /** Called from the IPC handler only. */
  respond(id: string, approved: boolean): boolean {
    const p = this.pending.get(id);
    if (!p || Date.now() > p.request.expiresAt) return false;
    p.resolve(approved);
    return true;
  }

  verifyBinding(id: string, tool: string, input: unknown): boolean {
    const p = this.pending.get(id);
    return !!p && p.binding === bindingFor(tool, input);
  }

  list(): ConfirmationRequest[] { return [...this.pending.values()].map((p) => p.request); }

  cancelAll() { for (const p of [...this.pending.values()]) p.resolve(false); }
}

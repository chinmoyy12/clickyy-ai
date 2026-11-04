import type { Routine } from '@shared/types';
import { CATALOG, CATALOG_BY_ID, type PendingSlot, type Resolution, type RouteCtx } from './catalog';
import { normalize } from './normalize';

export interface RoutedStep { commandId: string; resolution: Resolution; text: string }

export type RouteResult =
  | { kind: 'commands'; steps: RoutedStep[]; normalized: string }
  | { kind: 'routine'; routine: Routine; normalized: string }
  | { kind: 'none'; normalized: string };

function matchOne(text: string, ctx: RouteCtx): RoutedStep | null {
  for (const c of CATALOG) {
    for (const re of c.patterns) {
      const m = text.match(re);
      if (!m) continue;
      const resolution = c.resolve(m, text, ctx);
      if (resolution) return { commandId: c.id, resolution, text };
    }
  }
  return null;
}

const SPLIT = /\s*(?:,\s*)?\b(?:and then|then|and also|and after that|after that|also|and)\b\s+/;

/**
 * Deterministic routing. Returns commands only when every clause of the
 * utterance maps to a known command; otherwise 'none' so the conversational
 * model (if available) can handle it.
 */
export function route(raw: string, ctx: RouteCtx, routines: Routine[] = [], pending?: PendingSlot | null): RouteResult {
  const text = normalize(raw);

  if (pending) {
    const def = CATALOG_BY_ID.get(pending.commandId);
    const direct = matchOne(text, ctx);
    // A complete new command takes precedence over answering the question.
    if (direct && direct.resolution.kind !== 'clarify' && direct.commandId !== 'conv.greeting') return { kind: 'commands', steps: [direct], normalized: text };
    const filled = def?.fill?.(text, pending.partial, ctx);
    if (filled) return { kind: 'commands', steps: [{ commandId: pending.commandId, resolution: filled, text }], normalized: text };
  }

  const routine = routines.find((r) => r.enabled && r.phrases.some((p) => normalize(p) === text));
  if (routine) return { kind: 'routine', routine, normalized: text };

  const whole = matchOne(text, ctx);
  // Safety refusals are judged on the whole utterance, never on fragments.
  if (whole?.commandId.startsWith('safety.')) return { kind: 'commands', steps: [whole], normalized: text };
  const parts = text.split(SPLIT).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const steps = parts.map((p) => matchOne(p, ctx));
    // Prefer the split when every clause is a real command and the whole wasn't a better single match.
    if (steps.every((s): s is RoutedStep => !!s && s.commandId !== 'conv.greeting') && (!whole || steps.length > 1)) {
      // Resolve "it" in later clauses to the app opened in an earlier clause ("open spotify and maximize it").
      return { kind: 'commands', steps, normalized: text };
    }
  }
  if (whole) return { kind: 'commands', steps: [whole], normalized: text };
  return { kind: 'none', normalized: text };
}

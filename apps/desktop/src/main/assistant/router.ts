import type { Routine } from '@shared/types';
import { CATALOG, CATALOG_BY_ID, type PendingSlot, type Resolution, type RouteCtx } from './catalog';
import { normalize } from './normalize';
import { hasDevanagari, understandHindi } from './hindi';

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
  // Hindi / Hinglish commands are rewritten into the English the catalog knows ("स्पॉटिफ़ाई खोलो" → "open spotify").
  const hi = understandHindi(raw);
  // Hindi the rules can't map goes to the language model as it was said (it reads Hindi well).
  if (!hi.mapped && !pending && hasDevanagari(raw)) return { kind: 'none', normalized: hi.text };
  const text = normalize(hi.mapped || hasDevanagari(raw) ? hi.text : raw);

  if (pending) {
    const def = CATALOG_BY_ID.get(pending.commandId);
    if (def?.fillFirst) {
      const filled = def.fill?.(text, pending.partial, ctx, raw);
      if (filled) return { kind: 'commands', steps: [{ commandId: pending.commandId, resolution: filled, text }], normalized: text };
    }
    const direct = matchOne(text, ctx);
    // A complete new command takes precedence over answering the question.
    if (direct && direct.resolution.kind !== 'clarify' && direct.commandId !== 'conv.greeting') return { kind: 'commands', steps: [direct], normalized: text };
    const filled = def?.fill?.(text, pending.partial, ctx, raw);
    if (filled) return { kind: 'commands', steps: [{ commandId: pending.commandId, resolution: filled, text }], normalized: text };
  }

  // A routine runs by one of its phrases, or by name: "run my study routine" for a routine called "Study".
  const named = text.match(/^(?:run|start|do|begin|launch) (?:my |the )?(.+?) routine$/)?.[1];
  const routine = routines.find((r) => r.enabled && r.phrases.some((p) => normalize(p) === text))
    ?? (named ? routines.find((r) => r.enabled && normalize(r.name).replace(/ routine$/, '') === named) : undefined);
  if (routine) return { kind: 'routine', routine, normalized: text };

  const whole = matchOne(text, ctx);
  // Safety refusals are judged on the whole utterance, never on fragments.
  if (whole?.commandId.startsWith('safety.')) return { kind: 'commands', steps: [whole], normalized: text };
  // Some commands are one request even when they contain "and" ("check how much RAM and CPU Chrome is using").
  // The split still wins when one of its parts is that same command ("check my battery health and open spotify").
  const parts = text.split(SPLIT).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const steps = parts.map((p) => matchOne(p, ctx));
    const def = whole ? CATALOG_BY_ID.get(whole.commandId) : undefined;
    if (whole && def?.atomic) {
      const allReal = steps.every((s) => !!s && s.commandId !== 'conv.greeting' && s.resolution.kind !== 'clarify');
      const absorbed = def.absorbs === '*' || (!!def.absorbs && steps.every((s) => !s || (def.absorbs as string[]).includes(s.commandId)));
      if (!allReal || absorbed || !steps.some((s) => s?.commandId === whole.commandId)) return { kind: 'commands', steps: [whole], normalized: text };
    }
    // Prefer the split when every clause is a real command and the whole wasn't a better single match.
    if (steps.every((s): s is RoutedStep => !!s && s.commandId !== 'conv.greeting') && (!whole || steps.length > 1)) {
      // Resolve "it" in later clauses to the app opened in an earlier clause ("open spotify and maximize it").
      return { kind: 'commands', steps, normalized: text };
    }
  }
  if (whole) return { kind: 'commands', steps: [whole], normalized: text };
  return { kind: 'none', normalized: text };
}

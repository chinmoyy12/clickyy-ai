/**
 * Clickyy's offline "brain": understands requests the exact-phrase rules miss, with no internet and no API key.
 *
 *  1. Intent network: a small neural network trained on the command catalog (see net.ts, data.ts). It maps a
 *     reworded request ("could you tell me how much charge is left") to the command it means.
 *  2. Experience memory: when the language model handles something by calling one safe tool, the phrase and
 *     the call are remembered on this PC, so next time the same request runs instantly and offline.
 *
 * It acts only when confident; anything uncertain still goes to the language model (local or cloud).
 */
import type { RouteCtx, Resolution } from '../catalog';
import { CATALOG } from '../catalog';
import { route } from '../router';
import { featurize, tokens, type Sparse } from './features';
import { IntentNet, type NetWeights } from './net';
import { NONE } from './data';
import { PARAPHRASES } from './paraphrases';
import { normalize } from '../normalize';
import weights from './weights.json';

export interface BrainGuess {
  commandId: string;
  confidence: number;
  /** Set when the command needs no details from the sentence, so it can run straight away. */
  resolution?: Resolution;
  /** A canonical example of the command, for "did you mean…". */
  example: string;
}

export interface LearnedPhrase { text: string; tool: string; args: Record<string, unknown>; uses: number; at: number }

const STOP = new Set(('a an the my me mine your you yours i im we our us it its this that these those there here is are am was were be been do does did can could would will shall should ' +
  'what whats which who whom how much many when where why please pls kindly tell show give get let lets of on in to for at by with from about up out into ' +
  'now right just so and or but if then also hey clicky ok okay yo some any all one thing things little bit really very more most').split(' '));
/** Meaningful words of a sentence, lightly stemmed ("songs" → "song"). */
export function contentWords(text: string): string[] {
  return tokens(text).filter((w) => !STOP.has(w) && !/^\d+$/.test(w)).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

const FILLER = new Set(['please', 'pls', 'kindly', 'can', 'could', 'would', 'will', 'you', 'hey', 'clicky', 'ok', 'okay', 'just', 'for', 'me', 'now', 'right', 'quickly', 'thanks', 'thank', 'i', 'want', 'need', 'to', 'like', 'the', 'a', 'an', 'yo']);
/** A sentence reduced to its meaningful words, for exact recall of learned phrases. */
export function canon(text: string): string {
  return tokens(text).filter((w) => !FILLER.has(w)).join(' ');
}

/** Words that signal a question or a request for reasoning: the model should answer, not a command. */
const ASKS_FOR_THINKING = /\b(?:why|explain|write|poem|story|essay|compare|summari[sz]e|translate|recommend|advice|opinion|think|meaning|history|teach|learn|difference)\b/;

/** A general "what is a …" / "what are …" question, not about the user's own device ("my", "the", "this"). */
const DEFINITION = /^(?:(?:what|who) (?:is|are|was|were)|whats|whos) (?:an? )?(?!my |the |this |that |these |those |your |it |its |on |playing|happening|going|wrong|up\b|using|running|eating|slowing|taking|hogging|open\b)[a-z]/;

export class Brain {
  readonly net: IntentNet;
  readonly dataHash: string;
  private runnable = new Map<string, { resolution: Resolution; example: string }>();
  private examples = new Map<string, string>();
  /** Meaningful words each command is asked with (catalog examples + paraphrases). */
  private vocab = new Map<string, Set<string>>();
  private learned: Array<LearnedPhrase & { x: Sparse }> = [];
  /** Commands that are themselves asked as "what is …" without "my" or "the" (rare). */
  private definitional = new Set<string>();

  /** Act at or above this probability; suggest between SUGGEST and ACT. */
  static readonly ACT = 0.9;
  static readonly SUGGEST = 0.6;

  constructor(w: NetWeights = weights as NetWeights) {
    this.net = IntentNet.fromWeights(w);
    this.dataHash = w.dataHash;
    const ctx: RouteCtx = { session: {}, apps: [] };
    for (const c of CATALOG) {
      if (!c.examples.length) continue;
      this.examples.set(c.id, c.examples[0]);
      const vocab = new Set<string>();
      for (const p of [...c.examples, ...(PARAPHRASES[c.id] ?? [])]) for (const w of contentWords(normalize(p))) vocab.add(w);
      this.vocab.set(c.id, vocab);
      if ([...c.examples, ...(PARAPHRASES[c.id] ?? [])].some((p) => DEFINITION.test(normalize(p)))) this.definitional.add(c.id);
      if (/^(?:safety|routine|undo|smarthome|email|calendar)\./.test(c.id) || c.examples.length < 2) continue;
      // A command can run from a prediction only if every example resolves to the same action (no details to fill in).
      const res = c.examples.map((e) => { const r = route(e, ctx); return r.kind === 'commands' && r.steps.length === 1 && r.steps[0].commandId === c.id ? r.steps[0].resolution : null; });
      const first = res[0] ? JSON.stringify(res[0]) : '';
      if (first && res.every((x) => x && JSON.stringify(x) === first)) this.runnable.set(c.id, { resolution: res[0]!, example: c.examples[0] });
    }
  }

  get runnableCount() { return this.runnable.size; }

  /** Best guess for a normalized sentence the rules didn't match, or null when it's a question or chat. */
  guess(text: string): BrainGuess | null {
    const words = tokens(text);
    if (!words.length || words.length > 12) return null;
    const [best, second] = this.net.predict(featurize(text), 2);
    if (!best || best.label === NONE) return null;
    // A thinking word the command's own examples don't use means the user wants an answer, not the command.
    const ex = this.examples.get(best.label) ?? '';
    if (ASKS_FOR_THINKING.test(text) && !ASKS_FOR_THINKING.test(ex)) return null;
    // "what are computer processes" asks for a definition, not for the process list.
    if (DEFINITION.test(text) && !this.definitional.has(best.label)) return null;
    // Lexical anchoring: most meaningful words must be ones this command is actually asked with.
    // The network alone generalizes too far ("how many people live there" looks like "how much disk space").
    const said = contentWords(text);
    const vocab = this.vocab.get(best.label);
    const known = vocab ? said.filter((w) => vocab.has(w)).length : 0;
    if (!said.length || !known || known / said.length < 0.5) return null;
    const margin = best.p - (second?.p ?? 0);
    const confidence = Math.min(best.p, 0.5 + margin / 2);
    const run = this.runnable.get(best.label);
    return { commandId: best.label, confidence, example: ex, ...(run ? { resolution: run.resolution } : {}) };
  }

  // ---------- experience memory ----------

  loadLearned(list: LearnedPhrase[]) {
    this.learned = list.map((l) => ({ ...l, x: featurize(l.text) }));
  }

  learnedList(): LearnedPhrase[] {
    return this.learned.map(({ x: _x, ...l }) => l);
  }

  /** Remembers a phrase the model resolved with one safe tool call. Returns the updated list to persist. */
  learn(text: string, tool: string, args: Record<string, unknown>): LearnedPhrase[] {
    const words = tokens(text);
    if (words.length < 2 || words.length > 14) return this.learnedList();
    const existing = this.learned.find((l) => l.text === text);
    if (existing) { existing.tool = tool; existing.args = args; existing.at = Date.now(); }
    else this.learned.push({ text, tool, args, uses: 0, at: Date.now(), x: featurize(text) });
    // Keep the 300 most recently useful phrases.
    this.learned.sort((a, b) => b.at - a.at);
    this.learned = this.learned.slice(0, 300);
    return this.learnedList();
  }

  forget(text?: string): LearnedPhrase[] {
    this.learned = text ? this.learned.filter((l) => l.text !== text) : [];
    return this.learnedList();
  }

  /**
   * A remembered phrase that says the same thing as this sentence, ignoring polite filler ("please", "for me",
   * "can you"). Matching is exact on the remaining words: "seventeen and four" must never replay "seventeen and three".
   */
  recall(text: string): LearnedPhrase | null {
    const key = canon(text);
    if (!key) return null;
    const hit = this.learned.find((l) => canon(l.text) === key);
    if (!hit) return null;
    hit.uses++;
    hit.at = Date.now();
    return hit;
  }
}

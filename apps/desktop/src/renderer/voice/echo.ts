/**
 * Telling the user's voice apart from Clickyy's own reply leaking back into the microphone
 * (speakers without headphones, or a system voice that echo cancellation can't see).
 * While Clickyy speaks, a recognition session keeps running; what it hears is compared with
 * the words being spoken. Mostly-matching text is echo; anything else is the user talking.
 */

/** Words that always mean "stop and listen to me", in English and Hindi. */
const INTERRUPT = /^(?:stop|wait|cancel|pause|enough|quiet|silence|shut up|hold on|hang on|no|nope|clicky|clickey|clicki|hey clicky|ok clicky|okay clicky|ruko|ruk jao|bas|chup|chup karo|रुको|बस|चुप)(?=\s|$)/; // not \b: it doesn't see Devanagari as word characters

export function words(text: string): string[] {
  return text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
}

/** Share of the heard words that also occur in what Clickyy is saying (0..1). */
export function echoOverlap(heard: string, spoken: string): number {
  const h = words(heard);
  if (!h.length) return 1;
  const s = new Set(words(spoken));
  return h.filter((w) => s.has(w)).length / h.length;
}

/**
 * True when `heard` (a partial or final transcript captured while Clickyy was speaking)
 * is the user interrupting rather than an echo of `spoken`.
 *  - an interrupt word ("stop", "wait", "Clicky", "ruko"…) at the start counts at once,
 *    unless the reply itself contains that word;
 *  - otherwise it needs real words (3 for a partial, 2 for a final) that mostly differ from the reply.
 */
export function isBargeIn(heard: string, spoken: string, final: boolean): boolean {
  heard = stripEcho(heard, spoken); // judge only what follows an echoed lead-in
  const h = words(heard);
  if (!h.length) return false;
  const overlap = echoOverlap(heard, spoken);
  // An interrupt word counts at once, unless the reply itself contains it (then it may be echo).
  if (INTERRUPT.test(h.join(' ')) && !new Set(words(spoken)).has(h[0])) return true;
  if (h.length < (final ? 2 : 3)) return false;
  return overlap < 0.5;
}

/**
 * Removes a leading stretch of the reply's own words from what was heard
 * ("the capital of japan is stop" → "stop"), keeping at least one word.
 */
export function stripEcho(heard: string, spoken: string): string {
  const raw = heard.trim().split(/\s+/);
  const s = new Set(words(spoken));
  let i = 0;
  while (i < raw.length - 1 && words(raw[i]).every((w) => s.has(w)) && !INTERRUPT.test(words(raw[i]).join(' '))) i++;
  return i >= 2 ? raw.slice(i).join(' ') : heard.trim();
}

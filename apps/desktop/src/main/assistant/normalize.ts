/** Text normalization for deterministic command routing. */

const ONES: Record<string, number> = {
  zero: 0, oh: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Converts spoken numbers ("twenty five", "a hundred", "half an hour") to digits. */
export function wordsToNumbers(input: string): string {
  const text = input
    .replace(/\bhalf an hour\b/g, '30 minutes')
    .replace(/\ban hour and a half\b/g, '90 minutes')
    .replace(/\ba couple of minutes\b/g, '2 minutes')
    .replace(/\ba few minutes\b/g, '3 minutes');
  const tokens = text.split(' ');
  const out: string[] = [];
  let i = 0;
  const isNum = (t: string | undefined) => t !== undefined && (t in ONES || t in TENS || t === 'hundred');
  while (i < tokens.length) {
    const t = tokens[i];
    // "a"/"an"/"oh" only count as numbers right before hundred / a unit, otherwise keep the word.
    if ((t === 'a' || t === 'an') && tokens[i + 1] !== 'hundred' && !/^(minute|hour|second|couple)/.test(tokens[i + 1] ?? '')) { out.push(t); i++; continue; }
    if (t === 'oh' || !isNum(t)) { out.push(t); i++; continue; }
    let value = 0;
    let consumed = false;
    while (i < tokens.length && isNum(tokens[i])) {
      const w = tokens[i];
      if (w === 'hundred') value = (value || 1) * 100;
      else if (w in TENS) value += TENS[w];
      else value += ONES[w];
      consumed = true;
      i++;
      if (tokens[i] === 'and' && isNum(tokens[i + 1]) && value >= 100) i++;
      if ((w === 'a' || w === 'an') && tokens[i] !== 'hundred') break;
    }
    out.push(consumed ? String(value) : t);
  }
  return out.join(' ');
}

/** Frequent speech-recognition variants → canonical words. */
const ASR_FIXES: Array<[RegExp, string]> = [
  [/\bnote pad\b/g, 'notepad'],
  [/\b(v s|vs|visual studio) code\b/g, 'vs code'],
  [/\bspot if i\b|\bspotty fi\b|\bspot a fly\b/g, 'spotify'],
  [/\bwi fi\b|\bwifi\b|\bwhy fi\b/g, 'wifi'],
  [/\bgoogle crome\b|\bcrome\b/g, 'chrome'],
  [/\bper cent\b|%/g, ' percent'],
  [/\bfile explore\b/g, 'file explorer'],
  [/\btask manger\b/g, 'task manager'],
  [/\bvolume too\b/g, 'volume to'],
  [/\bmin\b|\bmins\b/g, 'minutes'],
  [/\bsec\b|\bsecs\b/g, 'seconds'],
  [/\bhrs?\b/g, 'hours'],
];

const WAKE_PREFIX = /^(?:(?:hey|hi|ok|okay)\s+)?(?:clickyy|clicky|clickie|click e|click key|quickie|clique e|jarvis)\b[\s,]*/;
const POLITE = /^(?:(?:please|kindly|can you|could you|would you|will you|i want you to|i'd like you to|i need you to|go ahead and|just)\s+)+/;
const TRAILING = /\s+(?:please|for me|thanks|thank you|now|right now)$/;

export function normalize(raw: string): string {
  let t = raw.toLowerCase().normalize('NFKC');
  t = t.replace(/[’‘]/g, "'").replace(/[^a-z0-9'%:.\-/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/[.]+$/, '').replace(/(?<![a-z0-9])[.](?![a-z0-9])/g, ' ').replace(/\s+/g, ' ').trim();
  // Canonical contractions: "what's" -> "whats", "that's" -> "thats" (patterns accept both spellings).
  t = t.replace(/'/g, '');
  for (const [re, rep] of ASR_FIXES) t = t.replace(re, rep);
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(WAKE_PREFIX, '').trim();
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t.replace(POLITE, '').replace(TRAILING, '').trim();
  }
  t = wordsToNumbers(t);
  return t.replace(/\s+/g, ' ').trim();
}

/** Durations like "10 minutes", "1 hour and 30 minutes", "90 seconds" → seconds. */
export function parseDuration(text: string): number | null {
  let total = 0;
  let found = false;
  const re = /(\d+(?:\.\d+)?)\s*(hours?|minutes?|seconds?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = parseFloat(m[1]);
    total += m[2].startsWith('hour') ? n * 3600 : m[2].startsWith('minute') ? n * 60 : n;
    found = true;
  }
  return found ? Math.round(total) : null;
}

/** "tomorrow morning", "at 5 pm", "tonight at 8", "tomorrow at 7:30 am" → local Date. */
export function parseClockTime(text: string, now = new Date()): Date | null {
  const d = new Date(now);
  let dayOffset = /\btomorrow\b/.test(text) ? 1 : 0;
  const at = text.match(/\b(?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)?\b/);
  let hour: number | null = null;
  let minute = 0;
  if (at && (/\bat\b/.test(text) || at[3])) {
    hour = parseInt(at[1], 10);
    minute = at[2] ? parseInt(at[2], 10) : 0;
    const ampm = at[3]?.replace(' ', '');
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (!ampm && /\b(tonight|evening|afternoon)\b/.test(text) && hour < 12) hour += 12;
  } else if (/\bmorning\b/.test(text)) hour = 9;
  else if (/\bafternoon\b/.test(text)) hour = 14;
  else if (/\b(evening|tonight)\b/.test(text)) hour = 19;
  if (hour === null || hour > 23 || minute > 59) return null;
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now.getTime() && dayOffset === 0) {
    if (at && !at[3] && hour < 12 && hour + 12 > now.getHours()) d.setHours(hour + 12);
    else d.setDate(d.getDate() + 1);
  }
  return d;
}

import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { defineTool, type ToolDef } from './types';
import { findZone } from '../assistant/knowledge/cities';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Fixed-date and computed holidays/events for "how many days until christmas". */
function eventDate(name: string, year: number): Date | null {
  const n = name.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const fixed: Record<string, [number, number]> = {
    christmas: [11, 25], 'christmas eve': [11, 24], 'new year': [0, 1], 'new years': [0, 1], 'new years day': [0, 1], 'new years eve': [11, 31],
    halloween: [9, 31], valentines: [1, 14], 'valentines day': [1, 14], 'independence day': [6, 4], 'fourth of july': [6, 4], 'july fourth': [6, 4],
    'indian independence day': [7, 15], 'republic day': [0, 26], 'gandhi jayanti': [9, 2], 'st patricks day': [2, 17], 'april fools': [3, 1], 'april fools day': [3, 1],
    'earth day': [3, 22], 'womens day': [2, 8], 'teachers day': [8, 5], 'childrens day': [10, 14], 'boxing day': [11, 26], 'summer solstice': [5, 21], 'winter solstice': [11, 21],
  };
  if (fixed[n]) return new Date(year, fixed[n][0], fixed[n][1]);
  const nth = (month: number, weekday: number, k: number) => { const d = new Date(year, month, 1); const off = (weekday - d.getDay() + 7) % 7; return new Date(year, month, 1 + off + 7 * (k - 1)); };
  if (n === 'thanksgiving') return nth(10, 4, 4);
  if (n === 'mothers day') return nth(4, 0, 2);
  if (n === 'fathers day') return nth(5, 0, 3);
  if (n === 'labor day' || n === 'labour day') return nth(8, 1, 1);
  if (n === 'easter') {
    // Anonymous Gregorian algorithm.
    const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1, day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month, day);
  }
  return null;
}

/** "december 25", "25 december", "march 3rd 2027", "2027-03-03", "my birthday on june 2". */
export function parseDate(text: string, now = new Date()): Date | null {
  const t = text.toLowerCase();
  const iso = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const md = t.match(new RegExp(`(${MONTHS.join('|')}|${MONTHS.map((m) => m.slice(0, 3)).join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`));
  const dm = t.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS.join('|')}|${MONTHS.map((m) => m.slice(0, 3)).join('|')})(?:,?\\s+(\\d{4}))?`));
  const pick = md ? { mon: md[1], day: +md[2], year: md[3] } : dm ? { mon: dm[2], day: +dm[1], year: dm[3] } : null;
  if (!pick) return null;
  const month = MONTHS.findIndex((m) => m.startsWith(pick.mon.slice(0, 3)));
  let d = new Date(pick.year ? +pick.year : now.getFullYear(), month, pick.day);
  if (!pick.year && d.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) d = new Date(now.getFullYear() + 1, month, pick.day);
  return d;
}

export const extraTools: ToolDef[] = [
  defineTool({
    name: 'clock.world', title: 'World clock', description: 'Current time in a city or country (offline).', category: 'Knowledge', risk: 1, permission: null,
    input: z.object({ place: z.string().trim().min(2).max(60) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ place }) => `Time in ${place}`,
    async run({ place }) {
      const zone = findZone(place);
      if (!zone) return { ok: false, message: `I don't know the time zone for ${place}. Try a major city nearby.` };
      const now = new Date();
      const time = now.toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
      const day = now.toLocaleDateString('en-US', { timeZone: zone, weekday: 'long' });
      const localDay = now.toLocaleDateString('en-US', { weekday: 'long' });
      const name = place.replace(/\b\w/g, (c) => c.toUpperCase());
      return { ok: true, data: { zone, time, day }, message: `It's ${time} in ${name}${day !== localDay ? ` on ${day}` : ''}.` };
    },
  }),
  defineTool({
    name: 'fun.random', title: 'Coin, dice and random numbers', description: 'Flip a coin, roll dice, or pick a random number in a range (cryptographically random).', category: 'Fun', risk: 1, permission: null,
    input: z.object({ kind: z.enum(['coin', 'dice', 'number']), count: z.number().int().min(1).max(10).default(1), sides: z.number().int().min(2).max(1000).default(6), min: z.number().int().min(-1e9).max(1e9).default(1), max: z.number().int().min(-1e9).max(1e9).default(100) }).strict(),
    confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ kind }) => (kind === 'coin' ? 'Flip a coin' : kind === 'dice' ? 'Roll dice' : 'Pick a random number'),
    async run({ kind, count, sides, min, max }) {
      if (kind === 'coin') {
        const flips = Array.from({ length: count }, () => (randomInt(2) ? 'heads' : 'tails'));
        return { ok: true, data: flips, message: count === 1 ? `It's ${flips[0]}.` : `I got ${flips.join(', ')}.` };
      }
      if (kind === 'dice') {
        const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
        const sum = rolls.reduce((a, b) => a + b, 0);
        return { ok: true, data: rolls, message: count === 1 ? `You rolled a ${rolls[0]}.` : `You rolled ${rolls.join(', ')}, for a total of ${sum}.` };
      }
      const [lo, hi] = min <= max ? [min, max] : [max, min];
      const n = randomInt(lo, hi + 1);
      return { ok: true, data: n, message: `${n}.` };
    },
  }),
  defineTool({
    name: 'date.until', title: 'Days until', description: 'Count days until (or since) a date or a holiday like Christmas, Easter, Thanksgiving, New Year.', category: 'Knowledge', risk: 1, permission: null,
    input: z.object({ target: z.string().trim().min(2).max(60) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ target }) => `Days until ${target}`,
    async run({ target }) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let d = eventDate(target, now.getFullYear());
      if (d && d.getTime() < today.getTime()) d = eventDate(target, now.getFullYear() + 1);
      d ??= parseDate(target, now);
      if (!d) return { ok: false, message: `I couldn't work out the date for ${target}. Try something like "December 25".` };
      const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
      const when = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const message = days === 0 ? `That's today, ${when}.` : days > 0 ? `${days} day${days === 1 ? '' : 's'} until ${target}, on ${when}.` : `That was ${-days} day${days === -1 ? '' : 's'} ago, on ${when}.`;
      return { ok: true, data: { days, date: d.toISOString() }, message };
    },
  }),
  defineTool({
    name: 'currency.convert', title: 'Convert currency', description: 'Convert money between currencies using the European Central Bank daily reference rates (Frankfurter, no key). Use ISO codes like USD, EUR, INR, GBP, JPY.', category: 'Knowledge', risk: 1, permission: 'web',
    input: z.object({ amount: z.number().positive().max(1e12), from: z.string().trim().length(3), to: z.string().trim().length(3) }).strict(), confirm: 'never', timeoutMs: 10000, offline: false,
    describe: ({ amount, from, to }) => `Convert ${amount} ${from} to ${to}`,
    async run({ amount, from, to }, ctx) {
      const f = from.toUpperCase(), t = to.toUpperCase();
      if (!/^[A-Z]{3}$/.test(f) || !/^[A-Z]{3}$/.test(t)) return { ok: false, message: 'Use three-letter currency codes, like USD or INR.' };
      if (f === t) return { ok: true, message: `${amount} ${f} is ${amount} ${t}.` };
      const res = await ctx.net(`https://api.frankfurter.app/latest?amount=${amount}&from=${f}&to=${t}`, { signal: ctx.signal });
      if (!res.ok) return { ok: false, message: `I couldn't get a rate for ${f} to ${t}.` };
      const body = (await res.json()) as { rates?: Record<string, number>; date?: string };
      const v = body.rates?.[t];
      if (v === undefined) return { ok: false, message: `I couldn't get a rate for ${f} to ${t}.` };
      const fmt = (n: number, c: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);
      return { ok: true, data: { value: v, date: body.date }, message: `${fmt(amount, f)} is about ${fmt(v, t)}, at the ${body.date ?? 'latest'} rate.` };
    },
  }),
];

/** Spoken currency names → ISO codes. */
export const CURRENCY_WORDS: Record<string, string> = {
  dollar: 'USD', dollars: 'USD', usd: 'USD', bucks: 'USD', 'us dollars': 'USD', 'us dollar': 'USD', euro: 'EUR', euros: 'EUR', eur: 'EUR',
  rupee: 'INR', rupees: 'INR', inr: 'INR', 'indian rupees': 'INR', pound: 'GBP', pounds: 'GBP', gbp: 'GBP', sterling: 'GBP', yen: 'JPY', jpy: 'JPY',
  yuan: 'CNY', renminbi: 'CNY', cny: 'CNY', won: 'KRW', krw: 'KRW', franc: 'CHF', francs: 'CHF', chf: 'CHF', 'canadian dollars': 'CAD', 'canadian dollar': 'CAD', cad: 'CAD',
  'australian dollars': 'AUD', 'australian dollar': 'AUD', aud: 'AUD', 'singapore dollars': 'SGD', sgd: 'SGD', 'hong kong dollars': 'HKD', hkd: 'HKD',
  real: 'BRL', reais: 'BRL', brl: 'BRL', peso: 'MXN', pesos: 'MXN', mxn: 'MXN', lira: 'TRY', try: 'TRY', rand: 'ZAR', zar: 'ZAR', krona: 'SEK', sek: 'SEK',
  krone: 'NOK', nok: 'NOK', zloty: 'PLN', pln: 'PLN', baht: 'THB', thb: 'THB', ringgit: 'MYR', myr: 'MYR', rupiah: 'IDR', idr: 'IDR', 'new zealand dollars': 'NZD', nzd: 'NZD',
  forint: 'HUF', huf: 'HUF', koruna: 'CZK', czk: 'CZK', shekel: 'ILS', shekels: 'ILS', ils: 'ILS', 'philippine peso': 'PHP', php: 'PHP', leu: 'RON', ron: 'RON',
};

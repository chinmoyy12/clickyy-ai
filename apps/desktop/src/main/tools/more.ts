import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { defineTool, type ToolContext, type ToolDef } from './types';
import { eventDate, parseDate } from './extras';
import { formatNumber } from './skills';

/**
 * 0.7 everyday extras. Offline unless marked: jokes, facts, motivation, riddles, passwords, spelling,
 * Roman numerals, bill splitting, day-of-week and age. Online without a key: dictionary
 * (dictionaryapi.dev), air quality and sunrise/sunset (Open-Meteo). Fetched text is untrusted data.
 */

// ---------- offline content (written for Clickyy) ----------
export const JOKES = [
  "I told my laptop a joke about the cloud. It went right over its head, then synced back an hour later.",
  "Why did the computer go to the doctor? It had a virus, and it refused to restart.",
  "My Wi-Fi and I are in a long-distance relationship. It works fine until I go into the kitchen.",
  "Why was the keyboard so tired? It had two shifts.",
  "I asked the calendar out. It said its days were numbered.",
  "Why don't programmers like nature? Too many bugs, and no undo.",
  "My battery and I have a lot in common. We both panic at ten percent.",
  "Why did the spreadsheet break up with the calculator? It felt it was being taken for granted, cell by cell.",
  "I'd tell you a UDP joke, but you might not get it.",
  "Why did the mouse stay calm? It knew how to handle every click.",
  "The printer and I have an understanding. It doesn't work, and I don't understand.",
  "I tried to organise a hide-and-seek game for files. Good luck finding the ones in Downloads.",
  "Why was the smartphone wearing glasses? It lost its contacts.",
  "Why did the scarecrow get promoted? He was outstanding in his field.",
  "I'm reading a book about anti-gravity. It's impossible to put down.",
  "Why don't eggs tell jokes? They'd crack each other up.",
  "What do you call a fake noodle? An impasta.",
  "Why did the bicycle fall over? It was two tired.",
  "I only know 25 letters of the alphabet. I don't know y.",
  "What do you call a bear with no teeth? A gummy bear.",
  "Why did the tomato blush? It saw the salad dressing.",
  "Parallel lines have so much in common. It's a shame they'll never meet.",
  "Why can't a nose be twelve inches long? Then it would be a foot.",
  "I used to hate facial hair, but then it grew on me.",
  "Why did the cricket team hire a baker? They needed someone good with the batter.",
];

/** Well-established facts only. */
export const FACTS = [
  "Honey never really spoils. Sealed honey thousands of years old has been found in Egyptian tombs, still edible.",
  "Octopuses have three hearts and blue blood.",
  "A day on Venus is longer than a year on Venus. It spins very slowly.",
  "Bananas are botanically berries, but strawberries are not.",
  "The Eiffel Tower can be about 15 centimetres taller in summer, because the iron expands in the heat.",
  "Light from the Sun takes about 8 minutes and 20 seconds to reach Earth.",
  "Sharks existed before trees. Sharks are over 400 million years old; the first trees came later.",
  "Your brain uses roughly 20 percent of your body's energy, though it's only about 2 percent of your weight.",
  "The first computer bug was a real moth, found in a Harvard relay computer in 1947.",
  "Wombat droppings are cube-shaped.",
  "A group of flamingos is called a flamboyance.",
  "Water can boil and freeze at the same time at its triple point.",
  "Sound travels about four times faster in water than in air.",
  "Mount Everest grows by a few millimetres each year as the Indian plate pushes north.",
  "The human body has 206 bones as an adult, but babies are born with around 300 that fuse over time.",
  "India has the world's largest postal network, with over 150,000 post offices.",
  "Chess is believed to have originated in India, from a game called chaturanga, around the 6th century.",
  "The number zero as a true number, with rules for arithmetic, was described by the Indian mathematician Brahmagupta in 628 AD.",
  "There are more possible chess games than atoms in the observable universe.",
  "A bolt of lightning is about five times hotter than the surface of the Sun.",
  "Koalas sleep up to 20 hours a day.",
  "The Great Wall of China is not visible to the naked eye from the Moon.",
  "Hummingbirds are the only birds that can fly backwards.",
  "The Pacific Ocean is larger than all of Earth's land area combined.",
  "Your stomach gets a new lining every few days, so it doesn't digest itself.",
];

export const MOTIVATION = [
  "Start small. Five focused minutes beats an hour of waiting to feel ready.",
  "You don't have to finish today. You just have to take the next step.",
  "Progress you can see is the best fuel. Pick one thing and tick it off.",
  "Hard things get easier the second time. This is the first time, that's all.",
  "Done is better than perfect. You can always improve a finished draft.",
  "You've handled difficult days before. This one is no different.",
  "Rest is part of the work. A short break now can save you an hour later.",
  "Be proud of how far you've come, then go a little further.",
  "Every expert was once a beginner who didn't quit.",
  "Focus on what you can control, and let the rest wait.",
];

export const RIDDLES: Array<[string, string]> = [
  ['What has keys but can\'t open locks?', 'A keyboard, or a piano.'],
  ['What gets wetter the more it dries?', 'A towel.'],
  ['What has hands but can\'t clap?', 'A clock.'],
  ['What can travel around the world while staying in a corner?', 'A stamp.'],
  ['What has a neck but no head?', 'A bottle.'],
  ['The more of them you take, the more you leave behind. What are they?', 'Footsteps.'],
  ['What comes once in a minute, twice in a moment, and never in a thousand years?', 'The letter M.'],
  ['What has many teeth but can\'t bite?', 'A comb.'],
  ['I\'m tall when I\'m young and short when I\'m old. What am I?', 'A candle.'],
  ['What goes up but never comes down?', 'Your age.'],
];

const last = new Map<string, number>();
/** Random pick that never repeats the previous one for the same list. */
function pick<T>(key: string, list: T[]): T {
  let i = randomInt(list.length);
  if (list.length > 1 && i === last.get(key)) i = (i + 1) % list.length;
  last.set(key, i);
  return list[i];
}

// ---------- helpers ----------
export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) throw new Error('Roman numerals go from 1 to 3999.');
  const map: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

export function fromRoman(s: string): number {
  const r = s.toUpperCase().trim();
  if (!/^[MDCLXVI]+$/.test(r)) throw new Error(`${s} isn't a Roman numeral.`);
  const val: Record<string, number> = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 };
  let total = 0;
  for (let i = 0; i < r.length; i++) total += val[r[i]] < (val[r[i + 1]] ?? 0) ? -val[r[i]] : val[r[i]];
  if (toRoman(total) !== r) throw new Error(`${s} isn't a valid Roman numeral.`);
  return total;
}

const PASSWORD_SETS = { lower: 'abcdefghijkmnopqrstuvwxyz', upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ', digits: '23456789', symbols: '!@#$%^&*-_=+?' };
export function makePassword(length: number, symbols = true): string {
  const sets = [PASSWORD_SETS.lower, PASSWORD_SETS.upper, PASSWORD_SETS.digits, ...(symbols ? [PASSWORD_SETS.symbols] : [])];
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)]); // at least one of each kind
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

const NATO: Record<string, string> = { a: 'alpha', b: 'bravo', c: 'charlie', d: 'delta', e: 'echo', f: 'foxtrot', g: 'golf', h: 'hotel', i: 'india', j: 'juliett', k: 'kilo', l: 'lima', m: 'mike', n: 'november', o: 'oscar', p: 'papa', q: 'quebec', r: 'romeo', s: 'sierra', t: 'tango', u: 'uniform', v: 'victor', w: 'whiskey', x: 'x-ray', y: 'yankee', z: 'zulu' };

const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

async function geocode(ctx: ToolContext, location?: string) {
  const place = location || ctx.settings.tools.weatherLocation;
  if (!place) return { error: 'Which city? You can also set your home city in Settings, Permissions, so I always know.' } as const;
  const r = await ctx.net(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(place)}`, { signal: ctx.signal });
  const geo = (await r.json()) as { results?: Array<{ name: string; latitude: number; longitude: number }> };
  const g = geo.results?.[0];
  return g ? { g } as const : { error: `I couldn't find a place called ${place}.` } as const;
}

const clock12 = (iso: string) => {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

export function aqiBand(aqi: number): string {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'unhealthy for sensitive groups';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'very unhealthy';
  return 'hazardous';
}

export const moreTools: ToolDef[] = [
  defineTool({
    name: 'fun.say', title: 'Jokes, facts and more', description: 'Tell a joke, an interesting fact, a riddle, or a line of motivation (offline, written for Clickyy).', category: 'Fun', risk: 1, permission: null,
    input: z.object({ kind: z.enum(['joke', 'fact', 'riddle', 'motivation']) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ kind }) => `Tell a ${kind}`,
    async run({ kind }, ctx) {
      if (kind === 'riddle') {
        const [q, a] = pick('riddle', RIDDLES);
        ctx.session.riddleAnswer = a;
        return { ok: true, data: { question: q }, message: `${q} Say "tell me the answer" when you're ready.` };
      }
      const list = kind === 'joke' ? JOKES : kind === 'fact' ? FACTS : MOTIVATION;
      return { ok: true, message: pick(kind, list) };
    },
  }),
  defineTool({
    name: 'fun.riddle_answer', title: 'Riddle answer', description: 'Reveal the answer to the last riddle.', category: 'Fun', risk: 1, permission: null,
    input: z.object({}).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: () => 'Reveal the riddle answer',
    async run(_i, ctx) {
      const a = ctx.session.riddleAnswer;
      if (typeof a !== 'string') return { ok: false, message: "I haven't asked you a riddle yet. Say \"tell me a riddle\"." };
      delete ctx.session.riddleAnswer;
      return { ok: true, message: `The answer is: ${a}` };
    },
  }),
  defineTool({
    name: 'password.generate', title: 'Strong password', description: 'Make a strong random password (cryptographically random, offline). Shown on screen only, never read aloud.', category: 'Security', risk: 1, permission: null,
    input: z.object({ length: z.number().int().min(8).max(64).default(16), symbols: z.boolean().default(true) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ length }) => `Make a ${length}-character password`,
    async run({ length, symbols }) {
      const pw = makePassword(length, symbols);
      return { ok: true, message: `I made a strong ${length}-character password. It's on screen, not read aloud. Copy it into your password manager.`, detail: pw, secretDetail: true };
    },
  }),
  defineTool({
    name: 'text.spell', title: 'Spell a word', description: 'Spell a word letter by letter, optionally with the phonetic alphabet (offline).', category: 'Knowledge', risk: 1, permission: null,
    input: z.object({ word: z.string().trim().min(1).max(40), phonetic: z.boolean().default(false) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ word }) => `Spell ${word}`,
    async run({ word, phonetic }) {
      const letters = [...word.replace(/[^\p{L}\p{N}]/gu, '')];
      if (!letters.length) return { ok: false, message: 'Which word should I spell?' };
      const spoken = letters.map((c) => (phonetic && NATO[c.toLowerCase()] ? `${c.toUpperCase()} for ${NATO[c.toLowerCase()]}` : c.toUpperCase())).join(', ');
      return { ok: true, message: `${word} is spelled ${spoken}.`, detail: letters.join(' ').toUpperCase() };
    },
  }),
  defineTool({
    name: 'number.roman', title: 'Roman numerals', description: 'Convert a number to Roman numerals or a Roman numeral to a number (offline).', category: 'Knowledge', risk: 1, permission: null,
    input: z.object({ value: z.string().trim().min(1).max(20) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ value }) => `Convert ${value}`,
    async run({ value }) {
      try {
        if (/^\d+$/.test(value)) { const r = toRoman(+value); return { ok: true, data: r, message: `${value} in Roman numerals is ${r.split('').join(' ')}.`, detail: r }; }
        const n = fromRoman(value);
        return { ok: true, data: n, message: `${value.toUpperCase()} is ${n}.` };
      } catch (e) { return { ok: false, message: (e as Error).message }; }
    },
  }),
  defineTool({
    name: 'math.split_bill', title: 'Split a bill', description: 'Split a bill between people, with an optional tip percentage (offline).', category: 'Knowledge', risk: 1, permission: null,
    input: z.object({ amount: z.number().positive().max(1e9), people: z.number().int().min(1).max(1000).default(1), tipPercent: z.number().min(0).max(100).default(0) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ amount, people }) => `Split ${amount} between ${people}`,
    async run({ amount, people, tipPercent }) {
      const tip = (amount * tipPercent) / 100;
      const total = amount + tip;
      const each = total / people;
      const r2 = (v: number) => formatNumber(Math.round(v * 100) / 100);
      const tipPart = tipPercent ? ` With a ${formatNumber(tipPercent)} percent tip of ${r2(tip)}, the total is ${r2(total)}.` : '';
      const message = people === 1 ? `${tipPart.trim() || `The total is ${r2(total)}.`}` : `${tipPart.trim() ? `${tipPart.trim()} ` : ''}That's ${r2(each)} each for ${people} people.`;
      return { ok: true, data: { tip, total, each }, message };
    },
  }),
  defineTool({
    name: 'date.weekday', title: 'Day of the week', description: 'Which day of the week a date or holiday falls on, or how old someone born on a date is (offline).', category: 'Knowledge', risk: 1, permission: null,
    input: z.object({ date: z.string().trim().min(2).max(60), mode: z.enum(['weekday', 'age']).default('weekday') }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ date }) => `Look up ${date}`,
    async run({ date, mode }) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (mode === 'age') {
        const b = parseDate(date, new Date(9999, 0, 1)); // a past year must be given; never roll forward
        if (!b || !/\d{4}/.test(date)) return { ok: false, message: 'Tell me the full birth date with the year, like "June 2, 2006".' };
        if (b > today) return { ok: false, message: "That date hasn't happened yet." };
        let age = today.getFullYear() - b.getFullYear();
        if (today.getMonth() < b.getMonth() || (today.getMonth() === b.getMonth() && today.getDate() < b.getDate())) age--;
        const next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
        if (next < today) next.setFullYear(today.getFullYear() + 1);
        const days = Math.round((next.getTime() - today.getTime()) / 86_400_000);
        return { ok: true, data: { age, daysToBirthday: days }, message: `Someone born on ${fmtDate(b)} is ${age} years old. ${days === 0 ? 'Happy birthday, it\'s today!' : `Their next birthday is in ${days} day${days === 1 ? '' : 's'}.`}` };
      }
      let d = eventDate(date, now.getFullYear());
      if (d && d < today) d = eventDate(date, now.getFullYear() + 1);
      d ??= parseDate(date, now);
      if (!d) return { ok: false, message: `I couldn't work out the date for ${date}. Try something like "August 15, 1947".` };
      const day = d.toLocaleDateString('en-US', { weekday: 'long' });
      const plain = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const verb = d.getTime() === today.getTime() ? 'is today,' : d < today ? 'was' : 'is';
      return { ok: true, data: { date: plain, weekday: day }, message: `${plain} ${verb} a ${day}.` };
    },
  }),
  defineTool({
    name: 'dictionary.define', title: 'Dictionary', description: 'Define an English word, or give synonyms or antonyms (Free Dictionary API, no account needed).', category: 'Knowledge', risk: 1, permission: 'web',
    input: z.object({ word: z.string().trim().min(1).max(40).regex(/^[\p{L}' -]+$/u), mode: z.enum(['define', 'synonyms', 'antonyms']).default('define') }).strict(), confirm: 'never', timeoutMs: 12000, offline: false,
    describe: ({ word, mode }) => (mode === 'define' ? `Define ${word}` : `Find ${mode} of ${word}`),
    async run({ word, mode }, ctx) {
      const r = await ctx.net(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`, { signal: ctx.signal });
      if (r.status === 404) return { ok: false, message: `I couldn't find "${word}" in the dictionary. Check the spelling?` };
      if (!r.ok) return { ok: false, message: `The dictionary didn't answer (HTTP ${r.status}).` };
      const entries = (await r.json()) as Array<{ word: string; meanings?: Array<{ partOfSpeech?: string; synonyms?: string[]; antonyms?: string[]; definitions?: Array<{ definition?: string; synonyms?: string[]; antonyms?: string[] }> }> }>;
      const meanings = entries.flatMap((e) => e.meanings ?? []);
      const clean = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
      if (mode === 'define') {
        const parts = meanings.slice(0, 2).map((m) => `As ${/^[aeiou]/.test(m.partOfSpeech ?? 'w') ? 'an' : 'a'} ${m.partOfSpeech ?? 'word'}: ${clean(m.definitions?.[0]?.definition ?? '')}`).filter((p) => !p.endsWith(': '));
        if (!parts.length) return { ok: false, message: `I couldn't find a definition for ${word}.` };
        return { ok: true, message: `${word}. ${parts.join(' ')}` };
      }
      const key = mode;
      const words = [...new Set(meanings.flatMap((m) => [...(m[key] ?? []), ...(m.definitions ?? []).flatMap((d) => d[key] ?? [])]))].map(clean).filter(Boolean).slice(0, 6);
      if (!words.length) return { ok: false, message: `I don't have ${mode} for ${word}.` };
      return { ok: true, data: words, message: `${mode === 'synonyms' ? 'Words like' : 'Opposites of'} ${word}: ${words.join(', ')}.` };
    },
  }),
  defineTool({
    name: 'weather.air', title: 'Air quality', description: 'Current air quality (US AQI, PM2.5, PM10) for a place or your home city, via Open-Meteo (no account needed).', category: 'Knowledge', risk: 1, permission: 'web',
    input: z.object({ location: z.string().trim().max(80).optional() }).strict(), confirm: 'never', timeoutMs: 12000, offline: false,
    describe: ({ location }) => `Check the air quality in ${location || 'your city'}`,
    async run({ location }, ctx) {
      const geo = await geocode(ctx, location);
      if ('error' in geo) return { ok: false, message: geo.error as string };
      const { g } = geo;
      const r = await ctx.net(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${g.latitude}&longitude=${g.longitude}&current=us_aqi,pm2_5,pm10`, { signal: ctx.signal });
      if (!r.ok) return { ok: false, message: `The air-quality service didn't answer (HTTP ${r.status}).` };
      const c = ((await r.json()) as { current?: { us_aqi?: number; pm2_5?: number; pm10?: number } }).current;
      if (c?.us_aqi == null) return { ok: false, message: `I couldn't get air quality for ${g.name}.` };
      const aqi = Math.round(c.us_aqi);
      const band = aqiBand(aqi);
      const advice = aqi > 150 ? ' Consider a mask outdoors and keep windows closed.' : aqi > 100 ? ' Sensitive people should limit long outdoor activity.' : '';
      return { ok: true, data: c, message: `Air quality in ${g.name} is ${band}, with an AQI of ${aqi}${c.pm2_5 != null ? ` and PM2.5 at ${Math.round(c.pm2_5)}` : ''}.${advice}` };
    },
  }),
  defineTool({
    name: 'weather.sun', title: 'Sunrise and sunset', description: "Today's sunrise and sunset times for a place or your home city, via Open-Meteo (no account needed).", category: 'Knowledge', risk: 1, permission: 'web',
    input: z.object({ location: z.string().trim().max(80).optional() }).strict(), confirm: 'never', timeoutMs: 12000, offline: false,
    describe: ({ location }) => `Get sunrise and sunset for ${location || 'your city'}`,
    async run({ location }, ctx) {
      const geo = await geocode(ctx, location);
      if ('error' in geo) return { ok: false, message: geo.error as string };
      const { g } = geo;
      const r = await ctx.net(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&daily=sunrise,sunset&timezone=auto&forecast_days=1`, { signal: ctx.signal });
      if (!r.ok) return { ok: false, message: `The weather service didn't answer (HTTP ${r.status}).` };
      const d = ((await r.json()) as { daily?: { sunrise?: string[]; sunset?: string[] } }).daily;
      if (!d?.sunrise?.[0] || !d.sunset?.[0]) return { ok: false, message: `I couldn't get sun times for ${g.name}.` };
      return { ok: true, data: d, message: `In ${g.name} today, sunrise is at ${clock12(d.sunrise[0])} and sunset is at ${clock12(d.sunset[0])}, local time.` };
    },
  }),
];

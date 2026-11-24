import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { defineTool, type ToolDef } from './types';
import { formatNumber } from './skills';

/**
 * 0.7 laptop panels, calculators and small companions, all offline: Windows panels by fixed URI,
 * loan EMI, BMI, leap years, time until, decide-for-me, rock paper scissors, and box breathing.
 */

const TASK_VIEW = 'shell:::{3080F90E-D7AD-11D9-BD98-0000947B0257}';
export const PANELS: Record<string, { label: string; uri?: string; say: string }> = {
  snip: { label: 'the screen snip tool', uri: 'ms-screenclip:', say: 'Drag to select the part of the screen to snip. It goes to your clipboard.' },
  notifications: { label: 'notifications', uri: 'ms-actioncenter:', say: 'Opening your notifications.' },
  quick_settings: { label: 'quick settings', uri: 'ms-actioncenter:controlcenter/&showFooter=true', say: 'Opening quick settings.' },
  wifi_list: { label: 'the Wi-Fi network list', uri: 'ms-availablenetworks:', say: 'Here are the Wi-Fi networks nearby.' },
  project: { label: 'the second-screen options', uri: 'ms-settings-displays-topology:projection', say: 'Opening the second-screen options: duplicate, extend or second screen only.' },
  task_view: { label: 'Task View', say: 'Opening Task View.' },
  clock: { label: 'the Clock app', uri: 'ms-clock:', say: 'Opening the Clock app.' },
  store: { label: 'the Microsoft Store', uri: 'ms-windows-store:', say: 'Opening the Microsoft Store.' },
  camera: { label: 'the Camera app', uri: 'microsoft.windows.camera:', say: 'Opening the camera.' },
  photos: { label: 'the Photos app', uri: 'ms-photos:', say: 'Opening Photos.' },
  maps: { label: 'Maps', uri: 'bingmaps:', say: 'Opening Maps.' },
  calculator: { label: 'the Calculator', uri: 'ms-calculator:', say: 'Opening the Calculator.' },
};
const PANEL_IDS = Object.keys(PANELS) as [string, ...string[]];

export function loanEmi(principal: number, ratePercent: number, months: number): number {
  const r = ratePercent / 12 / 100;
  return r === 0 ? principal / months : (principal * r * (1 + r) ** months) / ((1 + r) ** months - 1);
}

/** "5 pm", "5:30pm", "17:45", "noon", "midnight" → the next such moment after `now`. */
export function parseClock(text: string, now = new Date()): Date | null {
  const t = text.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  let h: number;
  let m = 0;
  if (t === 'noon' || t === 'midday') h = 12;
  else if (t === 'midnight') h = 0;
  else {
    const x = t.match(/^(\d{1,2})(?::(\d{2}))? ?(am|pm|in the morning|in the evening|at night|in the afternoon|oclock)?$/);
    if (!x) return null;
    h = +x[1];
    m = x[2] ? +x[2] : 0;
    if (h > 23 || m > 59) return null;
    const mer = x[3] && x[3] !== 'oclock' ? x[3] : '';
    if (mer && (h > 12 || h === 0)) return null;
    if (mer && /pm|evening|night|afternoon/.test(mer) && h < 12) h += 12;
    if (mer && /am|morning/.test(mer) && h === 12) h = 0;
    // "until 5" with no am/pm: the next 5 o'clock, morning or evening.
    if (!mer && !x[2] && h >= 1 && h <= 12) {
      const a = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h % 12, 0);
      const b = new Date(now.getFullYear(), now.getMonth(), now.getDate(), (h % 12) + 12, 0);
      const next = [a, b, new Date(a.getTime() + 86_400_000)].find((d) => d.getTime() > now.getTime())!;
      return next;
    }
  }
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

export const lifeTools: ToolDef[] = [
  defineTool({
    name: 'system.panel', title: 'Open a Windows panel', description: `Open a built-in Windows panel or app by fixed URI: ${PANEL_IDS.join(', ')} (snip is the screen snip tool; project is the second-screen menu).`, category: 'System', risk: 1, permission: 'system',
    input: z.object({ panel: z.enum(PANEL_IDS) }).strict(), confirm: 'never', timeoutMs: 5000, offline: true,
    describe: ({ panel }) => `Open ${PANELS[panel].label}`,
    async run({ panel }, ctx) {
      const p = PANELS[panel];
      if (p.uri) await ctx.platform.openExternal(p.uri);
      else await ctx.platform.spawnDetached('explorer.exe', [TASK_VIEW]);
      return { ok: true, message: p.say };
    },
  }),
  defineTool({
    name: 'math.emi', title: 'Loan EMI', description: 'Monthly EMI, total interest and total payment for a loan (offline). Rate is the yearly percent; term in months.', category: 'Knowledge', risk: 1, permission: null,
    input: z.object({ principal: z.number().positive().max(1e12), ratePercent: z.number().min(0).max(60), months: z.number().int().min(1).max(600) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ principal }) => `Work out the EMI on ${principal}`,
    async run({ principal, ratePercent, months }) {
      const emi = loanEmi(principal, ratePercent, months);
      const total = emi * months;
      const r = (v: number) => formatNumber(Math.round(v));
      const term = months % 12 === 0 ? `${months / 12} year${months === 12 ? '' : 's'}` : `${months} months`;
      return { ok: true, data: { emi, total, interest: total - principal }, message: `For ${r(principal)} at ${formatNumber(ratePercent)} percent over ${term}, the EMI is about ${r(emi)} a month. You'd pay ${r(total - principal)} in interest, ${r(total)} in total. Say "make an EMI schedule in Excel" for the month-by-month table.` };
    },
  }),
  defineTool({
    name: 'math.bmi', title: 'BMI', description: 'Body-mass index from weight in kilograms and height in centimetres, with the WHO adult category (offline, general information only).', category: 'Knowledge', risk: 1, permission: null,
    input: z.object({ weightKg: z.number().min(2).max(400), heightCm: z.number().min(40).max(260) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: () => 'Work out a BMI',
    async run({ weightKg, heightCm }) {
      const bmi = weightKg / (heightCm / 100) ** 2;
      const band = bmi < 18.5 ? 'underweight' : bmi < 25 ? 'in the healthy range' : bmi < 30 ? 'overweight' : 'in the obese range';
      return { ok: true, data: { bmi }, message: `That's a BMI of ${bmi.toFixed(1)}, which is ${band} for adults on the WHO scale. BMI doesn't account for muscle or build, so treat it as a rough guide.` };
    },
  }),
  defineTool({
    name: 'date.leap', title: 'Leap year', description: 'Whether a year is a leap year, and how many days February has (offline).', category: 'Knowledge', risk: 1, permission: null,
    input: z.object({ year: z.number().int().min(1).max(9999) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ year }) => `Check ${year}`,
    async run({ year }) {
      const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      const past = year < new Date().getFullYear();
      return { ok: true, data: { leap }, message: leap ? `Yes, ${year} ${past ? 'was' : 'is'} a leap year. February has 29 days.` : `No, ${year} ${past ? "wasn't" : "isn't"} a leap year. February has 28 days.` };
    },
  }),
  defineTool({
    name: 'time.until', title: 'Time until', description: 'How long until a time of day, like 5 pm or 18:30 (offline).', category: 'Knowledge', risk: 1, permission: null,
    input: z.object({ time: z.string().trim().min(1).max(24) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ time }) => `Time until ${time}`,
    async run({ time }) {
      const now = new Date();
      const at = parseClock(time, now);
      if (!at) return { ok: false, message: `I couldn't read the time "${time}". Try "5 pm" or "18:30".` };
      const mins = Math.max(1, Math.round((at.getTime() - now.getTime()) / 60000));
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const span = [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} minute${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
      const when = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return { ok: true, data: { minutes: mins }, message: `${span} until ${when}${at.getDate() !== now.getDate() ? ' tomorrow' : ''}.` };
    },
  }),
  defineTool({
    name: 'fun.choose', title: 'Decide for me', description: 'Pick one option at random when the user asks you to choose between things (offline, cryptographically random).', category: 'Fun', risk: 1, permission: null,
    input: z.object({ options: z.array(z.string().trim().min(1).max(60)).min(2).max(10) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ options }) => `Pick between ${options.join(', ')}`,
    async run({ options }) {
      const choice = options[randomInt(options.length)];
      return { ok: true, data: { choice }, message: `I pick ${choice}.` };
    },
  }),
  defineTool({
    name: 'fun.rps', title: 'Rock, paper, scissors', description: 'Play rock, paper, scissors against Clickyy (offline, random).', category: 'Fun', risk: 1, permission: null,
    input: z.object({ move: z.enum(['rock', 'paper', 'scissors']).optional() }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: () => 'Play rock, paper, scissors',
    async run({ move }) {
      if (!move) return { ok: true, message: 'Okay! Say rock, paper or scissors, like "I choose paper".' };
      const mine = (['rock', 'paper', 'scissors'] as const)[randomInt(3)];
      const beats: Record<string, string> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
      const result = move === mine ? "It's a tie!" : beats[move] === mine ? 'You win!' : 'I win!';
      return { ok: true, data: { mine, result }, message: `I chose ${mine}. ${result}` };
    },
  }),
  defineTool({
    name: 'wellness.breathe', title: 'Breathing exercise', description: 'Guide a short, calming box-breathing exercise (offline).', category: 'Fun', risk: 1, permission: null,
    input: z.object({ rounds: z.number().int().min(1).max(5).default(3) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: () => 'Guide a breathing exercise',
    async run({ rounds }) {
      const round = 'Breathe in slowly... two, three, four. Hold... two, three, four. Breathe out... two, three, four. Hold... two, three, four.';
      return { ok: true, message: `Let's do ${rounds} rounds of box breathing. Sit comfortably and relax your shoulders. ${Array.from({ length: rounds }, () => round).join(' ')} Well done. Notice how you feel.` };
    },
  }),
];

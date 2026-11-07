import { z } from 'zod';
import { defineTool, type ToolDef } from './types';
import type { WindowInfo } from '../windows/bridge';

/** Friendly key combos → SendKeys specs (must match the allowlist in bridge.ps1). */
export const KEY_COMBOS: Record<string, string> = {
  copy: '^c', paste: '^v', cut: '^x', undo: '^z', redo: '^y', select_all: '^a', save: '^s', find: '^f',
  new_tab: '^t', close_tab: '^w', new_window: '^n', next_tab: '^{TAB}', previous_tab: '^+{TAB}',
  switch_window: '%{TAB}', enter: '{ENTER}', escape: '{ESC}', tab: '{TAB}', refresh: '{F5}',
};

export function spokenDuration(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return [h && `${h} hour${h > 1 ? 's' : ''}`, m && `${m} minute${m > 1 ? 's' : ''}`, s && !h && `${s} second${s > 1 ? 's' : ''}`].filter(Boolean).join(' and ') || '0 seconds';
}

const SENSITIVE = /(password|passcode|pin\b|otp|one[- ]time code|credit card|cvv|ssn|social security)/i;

export const productivityTools: ToolDef[] = [
  defineTool({
    name: 'reminders.create', title: 'Create reminder', description: 'Create a local reminder after a delay in seconds, or at an ISO-8601 local time.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ text: z.string().trim().min(1).max(200), inSeconds: z.number().int().min(5).max(60 * 60 * 24 * 60).optional(), at: z.string().datetime({ local: true, offset: true }).optional(), note: z.string().max(200).optional() }).strict()
      .refine((i) => (i.inSeconds === undefined) !== (i.at === undefined), 'Provide exactly one of inSeconds or at'),
    confirm: 'never', timeoutMs: 3000, offline: true,
    describe: ({ text }) => `Remind you: ${text}`,
    async run({ text, inSeconds, at, note }, ctx) {
      const due = inSeconds !== undefined ? Date.now() + inSeconds * 1000 : new Date(at!).getTime();
      if (!Number.isFinite(due) || due <= Date.now()) return { ok: false, message: 'That time is already in the past.' };
      const r = ctx.repos.reminders.add(text, due, 'reminder');
      ctx.scheduler.schedule(r.id, due);
      const when = new Date(due);
      const sameDay = when.toDateString() === new Date().toDateString();
      const whenText = `${sameDay ? 'today' : when.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
      return { ok: true, data: r, message: `Okay, I'll remind you ${whenText}.${note ? ` ${note}` : ''}` };
    },
  }),
  defineTool({
    name: 'timers.create', title: 'Start timer', description: 'Start a countdown timer, or a focus session when focus is true.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ seconds: z.number().int().min(5).max(60 * 60 * 12), label: z.string().trim().max(80).default('Timer'), focus: z.boolean().default(false) }).strict(),
    confirm: 'never', timeoutMs: 3000, offline: true,
    describe: ({ seconds }) => `Start a ${spokenDuration(seconds)} timer`,
    async run({ seconds, label, focus }, ctx) {
      const r = ctx.repos.reminders.add(focus ? `Focus session complete. Time for a break.` : `${label} is done.`, Date.now() + seconds * 1000, focus ? 'focus' : 'timer');
      ctx.scheduler.schedule(r.id, r.dueAt);
      return { ok: true, data: r, message: focus ? `Focus session started for ${spokenDuration(seconds)}. I'll let you know when it's time for a break.` : `${spokenDuration(seconds)} timer, starting now.` };
    },
  }),
  defineTool({
    name: 'reminders.list', title: 'List reminders', description: 'List pending reminders, timers and focus sessions.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({}).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: () => 'List reminders',
    async run(_i, ctx) {
      const list = ctx.repos.reminders.pending();
      if (!list.length) return { ok: true, data: [], message: "You don't have any reminders or timers running." };
      const fmt = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return { ok: true, data: list, message: `You have ${list.length}. The next one is at ${fmt(list[0].dueAt)}: ${list[0].text}`, detail: list.map((r) => `${fmt(r.dueAt)} — ${r.kind}: ${r.text}`).join('\n') };
    },
  }),
  defineTool({
    name: 'reminders.cancel', title: 'Cancel reminder or timer', description: 'Cancel the most recent pending reminder/timer, or one by id, or all of them.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ target: z.enum(['last', 'all', 'timer', 'reminder', 'focus']).default('last') }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ target }) => `Cancel ${target}`,
    async run({ target }, ctx) {
      let list = ctx.repos.reminders.pending().sort((a, b) => b.createdAt - a.createdAt);
      if (target === 'timer' || target === 'reminder' || target === 'focus') list = list.filter((r) => r.kind === target);
      if (target !== 'all') list = list.slice(0, 1);
      if (!list.length) return { ok: false, message: "There's nothing like that to cancel." };
      for (const r of list) { ctx.repos.reminders.setStatus(r.id, 'cancelled'); ctx.scheduler.cancel(r.id); }
      return { ok: true, message: list.length > 1 ? `Cancelled ${list.length} reminders and timers.` : `Cancelled: ${list[0].text}` };
    },
  }),
  defineTool({
    name: 'memory.save', title: 'Remember', description: 'Save something the user explicitly asked you to remember. Never store passwords or other secrets.', category: 'Memory', risk: 1, permission: null,
    input: z.object({ text: z.string().trim().min(2).max(500) }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ text }) => `Remember: ${text}`,
    async run({ text }, ctx) {
      if (SENSITIVE.test(text)) return { ok: false, message: "That looks like sensitive information, so I won't save it. Please use a password manager for things like that." };
      const m = ctx.repos.memories.add(text, 'preference');
      return { ok: true, data: m, message: "Got it. I'll remember that. You can review it any time in Settings, Memory." };
    },
  }),
  defineTool({
    name: 'memory.forget', title: 'Forget', description: 'Delete saved memories that contain the given words.', category: 'Memory', risk: 1, permission: null,
    input: z.object({ query: z.string().trim().min(2).max(100) }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ query }) => `Forget memories about "${query}"`,
    async run({ query }, ctx) {
      const hits = ctx.repos.memories.list(query);
      hits.forEach((m) => ctx.repos.memories.delete(m.id));
      return { ok: true, message: hits.length ? `Forgotten. I removed ${hits.length} saved note${hits.length > 1 ? 's' : ''}.` : `I don't have anything saved about ${query}.` };
    },
  }),
  defineTool({
    name: 'memory.list', title: 'What do you remember', description: 'List explicitly saved memories.', category: 'Memory', risk: 1, permission: null,
    input: z.object({}).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: () => 'List saved memories',
    async run(_i, ctx) {
      const list = ctx.repos.memories.list();
      if (!list.length) return { ok: true, data: [], message: "I haven't saved anything about you. I only remember what you ask me to." };
      return { ok: true, data: list, message: `I've saved ${list.length} thing${list.length > 1 ? 's' : ''}. The latest is: ${list[0].text}`, detail: list.map((m) => `• ${m.text}`).join('\n') };
    },
  }),
  defineTool({
    name: 'clipboard.copy', title: 'Copy to clipboard', description: 'Put text on the clipboard.', category: 'Clipboard', risk: 1, permission: 'clipboard',
    input: z.object({ text: z.string().min(1).max(20_000) }).strict(), confirm: 'never', timeoutMs: 4000, offline: true,
    describe: ({ text }) => `Copy ${text.length} characters to the clipboard`,
    async run({ text }, ctx) {
      await ctx.bridge.call('clipboard.set', { text });
      return { ok: true, message: 'Copied to your clipboard.' };
    },
  }),
  defineTool({
    name: 'clipboard.read', title: 'Read clipboard', description: 'Read the current clipboard text. Requires confirmation.', category: 'Clipboard', risk: 2, permission: 'clipboard',
    input: z.object({}).strict(), confirm: 'always', timeoutMs: 30000, offline: true,
    describe: () => 'Let Clickyy read the text currently on your clipboard',
    async run(_i, ctx) {
      const { text } = await ctx.bridge.call<{ text: string }>('clipboard.get');
      return { ok: true, data: { text: text.slice(0, 20_000) }, message: text ? `Your clipboard has ${text.length} characters of text.` : 'The clipboard has no text.', detail: text.slice(0, 2000) };
    },
  }),
  defineTool({
    name: 'keyboard.shortcut', title: 'Press keyboard shortcut', description: `Press an allowlisted shortcut in the foreground app: ${Object.keys(KEY_COMBOS).join(', ')}.`, category: 'Automation', risk: 2, permission: 'automation',
    input: z.object({ combo: z.enum(Object.keys(KEY_COMBOS) as [string, ...string[]]) }).strict(),
    confirm: (({ combo }: { combo: string }) => ['close_tab', 'enter'].includes(combo)) as never,
    timeoutMs: 30000, offline: true,
    describe: async ({ combo }, ctx) => {
      const fg = await ctx.bridge.call<WindowInfo | null>('window.foreground').catch(() => null);
      return `Press ${combo.replace('_', ' ')} in "${fg?.title ?? 'the current window'}"`;
    },
    async run({ combo }, ctx) {
      await ctx.bridge.call('keys.send', { spec: KEY_COMBOS[combo] });
      return { ok: true, message: `Pressed ${combo.replace('_', ' ')}.` };
    },
  }),
  defineTool({
    name: 'keyboard.type', title: 'Type text', description: 'Type user-approved text into the focused field of the foreground window. Always confirmed; refuses credential-like text.', category: 'Automation', risk: 2, permission: 'automation',
    input: z.object({ text: z.string().min(1).max(2000) }).strict(), confirm: 'always', timeoutMs: 60000, offline: true,
    confirmLabel: ({ text }) => `Type ${text.length} characters`,
    describe: async ({ text }, ctx) => {
      const fg = await ctx.bridge.call<WindowInfo | null>('window.foreground').catch(() => null);
      return `Type ${text.length} characters into "${fg?.title ?? 'the current window'}" (${fg?.process ?? 'unknown app'}).`;
    },
    preview: async ({ text }) => text.slice(0, 1000),
    async run({ text }, ctx) {
      if (SENSITIVE.test(text)) return { ok: false, message: "That looks like a credential, so I won't type it." };
      const fg = await ctx.bridge.call<WindowInfo | null>('window.foreground');
      if (!fg || /clickyy/i.test(fg.title)) return { ok: false, message: 'Click into the field you want first, then ask me again.' };
      await ctx.bridge.call('keys.type', { text }, 20000);
      return { ok: true, message: `Typed it into ${fg.process ?? 'the window'}.` };
    },
  }),
];

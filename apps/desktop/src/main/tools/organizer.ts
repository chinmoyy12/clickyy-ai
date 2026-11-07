import { z } from 'zod';
import { defineTool, type ToolContext, type ToolDef } from './types';
import { spokenDuration } from './productivity';
import { outputDir, userFolder, writeNew } from './output';
import { buildPdf } from './pdf';
import type { Reminder } from '@shared/types';

const text = z.string().trim().min(1).max(300);
const STOP = new Set(['the', 'a', 'an', 'my', 'for', 'of', 'to', 'on', 'and', 'with', 'about', 'in']);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));

/** Best fuzzy match by shared words (all query words present beats some). */
export function bestMatch<T>(items: T[], query: string, key: (t: T) => string): T | undefined {
  const q = words(query);
  if (!q.length) return undefined;
  let best: { t: T; score: number } | undefined;
  for (const t of items) {
    const k = new Set(words(key(t)));
    const hits = q.filter((w) => k.has(w) || [...k].some((x) => x.startsWith(w) || w.startsWith(x))).length;
    const score = hits / q.length;
    if (score >= 0.5 && (!best || score > best.score)) best = { t, score };
  }
  return best?.t;
}

const fmtWhen = (t: number) => {
  const d = new Date(t);
  const sameDay = d.toDateString() === new Date().toDateString();
  const tomorrow = d.toDateString() === new Date(Date.now() + 86400000).toDateString();
  return `${sameDay ? 'today' : tomorrow ? 'tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};
const iso = z.string().datetime({ local: true, offset: true });
const findReminder = (ctx: ToolContext, q?: string): Reminder | undefined => {
  const list = ctx.repos.reminders.pending();
  return q ? bestMatch(list, q, (r) => r.text) : [...list].sort((a, b) => b.createdAt - a.createdAt)[0];
};

const stopwatches = new Map<string, number>();

export const organizerTools: ToolDef[] = [
  // ---- To-do list ----
  defineTool({
    name: 'todo.add', title: 'Add to-do', description: 'Add an item to the local to-do list, optionally high or low priority.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ text, priority: z.enum(['high', 'normal', 'low']).default('normal') }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ text: t, priority }) => `Add "${t}" to your ${priority === 'normal' ? '' : `${priority}-priority `}to-do list`,
    async run({ text: t, priority }, ctx) {
      const item = ctx.repos.todos.add(t, priority);
      const open = ctx.repos.todos.list({ open: true }).length;
      return { ok: true, data: item, message: `Added ${t} to your ${priority === 'high' ? 'high-priority ' : ''}to-do list. You have ${open} open item${open === 1 ? '' : 's'}.` };
    },
  }),
  defineTool({
    name: 'todo.complete', title: 'Complete to-do', description: 'Mark a to-do item as done (matched by its words).', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ text }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ text: t }) => `Mark "${t}" as done`,
    async run({ text: t }, ctx) {
      const item = bestMatch(ctx.repos.todos.list({ open: true }), t, (x) => x.text);
      if (!item) return { ok: false, message: `I don't see ${t} on your open to-do list.` };
      ctx.repos.todos.setDone(item.id);
      const left = ctx.repos.todos.list({ open: true }).length;
      return { ok: true, message: `Done: ${item.text}. ${left ? `${left} left to go.` : 'Your list is clear!'}` };
    },
  }),
  defineTool({
    name: 'todo.list', title: 'Show to-do list', description: 'Read the open to-do items, high priority first.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ query: z.string().trim().max(100).optional() }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: () => 'Read your to-do list',
    async run({ query }, ctx) {
      let list = ctx.repos.todos.list({ open: true });
      if (query) list = list.filter((x) => bestMatch([x], query, (y) => y.text));
      if (!list.length) return { ok: true, data: [], message: query ? `Nothing on your to-do list matches ${query}.` : 'Your to-do list is empty.' };
      const lines = list.map((x) => `${x.priority === 'high' ? '[high] ' : ''}${x.text}${x.dueAt ? ` (due ${fmtWhen(x.dueAt)})` : ''}`);
      return { ok: true, data: list, message: `You have ${list.length} thing${list.length === 1 ? '' : 's'} to do: ${list.slice(0, 5).map((x) => x.text).join('; ')}${list.length > 5 ? '; and more' : ''}.`, detail: lines.join('\n') };
    },
  }),
  defineTool({
    name: 'todo.clear_done', title: 'Clear finished to-dos', description: 'Remove completed items from the to-do list (optionally only those matching some words).', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ query: z.string().trim().max(100).optional() }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ query }) => `Clear completed to-dos${query ? ` about ${query}` : ''}`,
    async run({ query }, ctx) {
      let done = ctx.repos.todos.list().filter((x) => x.done);
      if (query) done = done.filter((x) => bestMatch([x], query, (y) => y.text));
      for (const x of done) ctx.repos.todos.delete(x.id);
      return { ok: true, message: done.length ? `Cleared ${done.length} completed item${done.length === 1 ? '' : 's'}.` : 'There were no completed items to clear.' };
    },
  }),
  defineTool({
    name: 'todo.defer', title: 'Move to-do to next week', description: "Move a to-do item to next week's backlog (due next Monday). Adds it if it isn't on the list yet.", category: 'Productivity', risk: 1, permission: null,
    input: z.object({ text }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ text: t }) => `Move "${t}" to next week`,
    async run({ text: t }, ctx) {
      const d = new Date();
      d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
      d.setHours(9, 0, 0, 0);
      const item = bestMatch(ctx.repos.todos.list({ open: true }), t, (x) => x.text);
      if (item) ctx.repos.todos.setDue(item.id, d.getTime());
      else ctx.repos.todos.add(t, 'low', d.getTime());
      return { ok: true, message: `${item?.text ?? t} is in next week's backlog, due Monday.` };
    },
  }),
  // ---- Notes ----
  defineTool({
    name: 'notes.create', title: 'Create note', description: 'Create a note with a title and optional text. Notes stay on this PC.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ title: z.string().trim().min(1).max(120), body: z.string().max(20000).default('') }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ title }) => `Create a note called ${title}`,
    async run({ title, body }, ctx) {
      const n = ctx.repos.notes.create(title, body);
      return { ok: true, data: n, message: body ? `Saved your note "${title}".` : `Created the note "${title}".` };
    },
  }),
  defineTool({
    name: 'notes.append', title: 'Add to note', description: 'Add text to the end of a note (creates the note if it does not exist).', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ title: z.string().trim().min(1).max(120), text: z.string().trim().min(1).max(5000) }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ title }) => `Add to the note ${title}`,
    async run({ title, text: t }, ctx) {
      const n = bestMatch(ctx.repos.notes.list(), title, (x) => x.title);
      const stamp = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
      if (n) { ctx.repos.notes.append(n.id, `[${stamp}] ${t}`); return { ok: true, message: `Added that to "${n.title}".` }; }
      ctx.repos.notes.create(title, `[${stamp}] ${t}`);
      return { ok: true, message: `There wasn't a note called ${title}, so I made one with that in it.` };
    },
  }),
  defineTool({
    name: 'notes.find', title: 'Find notes', description: 'Find notes whose title or text mention some words, and read the best one.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ query: z.string().trim().max(100).default('') }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ query }) => (query ? `Find notes about ${query}` : 'List your notes'),
    async run({ query }, ctx) {
      const all = ctx.repos.notes.list();
      const hits = query ? all.filter((n) => bestMatch([n], query, (x) => `${x.title} ${x.body}`)) : all;
      if (!hits.length) return { ok: true, data: [], message: query ? `You don't have any notes about ${query}.` : "You don't have any notes yet." };
      const first = hits[0];
      return { ok: true, data: hits, message: `${hits.length === 1 ? 'One note' : `${hits.length} notes`}${query ? ` about ${query}` : ''}. ${first.title}: ${first.body.slice(0, 220) || '(empty)'}${first.body.length > 220 ? '…' : ''}`, detail: hits.map((n) => `# ${n.title}\n${n.body}`).join('\n\n') };
    },
  }),
  defineTool({
    name: 'notes.export', title: 'Export notes', description: 'Export notes about a topic to a PDF, Markdown or text file in Documents\\Clickyy\\Notes, or pin them to the desktop as a text file.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ query: z.string().trim().max(100).default(''), format: z.enum(['pdf', 'md', 'txt', 'desktop']).default('pdf'), open: z.boolean().default(true) }).strict(), confirm: 'never', timeoutMs: 8000, offline: true,
    describe: ({ query, format }) => `Export ${query ? `notes about ${query}` : 'your notes'} ${format === 'desktop' ? 'to the desktop' : `as ${format.toUpperCase()}`}`,
    async run({ query, format, open }, ctx) {
      const all = ctx.repos.notes.list();
      const notes = query ? all.filter((n) => bestMatch([n], query, (x) => `${x.title} ${x.body}`)) : all;
      const todos = query ? ctx.repos.todos.list({ open: true }).filter((x) => bestMatch([x], query, (y) => y.text)) : [];
      if (!notes.length && !todos.length) return { ok: false, message: query ? `You don't have any notes or to-dos about ${query}.` : "You don't have any notes yet." };
      const title = query ? `${query[0].toUpperCase()}${query.slice(1)}` : 'My notes';
      const body = [...notes.map((n) => `${n.title}\n${'-'.repeat(Math.min(60, n.title.length))}\n${n.body}\n`), ...(todos.length ? [`Checklist\n---------\n${todos.map((x) => `[ ] ${x.text}`).join('\n')}`] : [])].join('\n');
      const md = `# ${title}\n\n${notes.map((n) => `## ${n.title}\n\n${n.body}\n`).join('\n')}${todos.length ? `\n## Checklist\n\n${todos.map((x) => `- [ ] ${x.text}`).join('\n')}\n` : ''}`;
      const dir = format === 'desktop' ? userFolder('desktop') : outputDir('Notes');
      const path = await writeNew(dir, title, format === 'pdf' ? '.pdf' : format === 'md' ? '.md' : '.txt', format === 'pdf' ? buildPdf(title, body) : format === 'md' ? md : `${title}\n\n${body}`);
      if (open) await ctx.platform.openPath(path);
      return { ok: true, data: { path }, message: format === 'desktop' ? `Pinned ${title} to your desktop as a text file.` : `Exported ${notes.length + (todos.length ? 1 : 0)} note${notes.length === 1 ? '' : 's'} to ${format === 'pdf' ? 'a PDF' : `a ${format} file`} in Documents, Clickyy, Notes.`, detail: path };
    },
  }),
  defineTool({
    name: 'notes.email', title: 'Email action items', description: 'Open an email draft with the open to-dos and notes about a task. You add the recipients and press Send.', category: 'Productivity', risk: 1, permission: 'web',
    input: z.object({ query: text, to: z.string().trim().max(200).default('') }).strict(), confirm: 'never', timeoutMs: 8000, offline: true,
    describe: ({ query }) => `Draft an email with the action items for ${query}`,
    async run({ query, to }, ctx) {
      const todos = ctx.repos.todos.list({ open: true }).filter((x) => bestMatch([x], query, (y) => y.text));
      const notes = ctx.repos.notes.list().filter((n) => bestMatch([n], query, (x) => `${x.title} ${x.body}`)).slice(0, 3);
      const items = todos.map((x) => `- ${x.text}${x.dueAt ? ` (due ${fmtWhen(x.dueAt)})` : ''}`);
      const body = `Hi${/^(my |the )?team$/i.test(to) ? ' team' : ''},\n\nHere are the action items from ${query}:\n\n${items.length ? items.join('\n') : '- [add the first action item]'}\n${notes.length ? `\nNotes:\n${notes.map((n) => `${n.title}: ${n.body.slice(0, 500)}`).join('\n\n')}\n` : ''}\nThanks,\n`;
      const addr = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(to) ? to : '';
      await ctx.platform.openExternal(`mailto:${encodeURIComponent(addr)}?subject=${encodeURIComponent(`Action items: ${query}`)}&body=${encodeURIComponent(body.slice(0, 1800))}`);
      return { ok: true, message: `I opened an email draft with ${items.length ? `${items.length} action item${items.length === 1 ? '' : 's'}` : 'a list for your action items, since I have none saved'} for ${query}. Add ${addr ? 'anyone else' : 'the recipients'} and press Send.`, detail: body };
    },
  }),
  defineTool({
    name: 'checklist.read', title: 'Read checklist', description: 'Read out the checklist for a task: matching open to-dos plus checklist lines in a matching note.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ query: text }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ query }) => `Read the checklist for ${query}`,
    async run({ query }, ctx) {
      const todos = ctx.repos.todos.list({ open: true }).filter((x) => bestMatch([x], query, (y) => y.text));
      const note = bestMatch(ctx.repos.notes.list(), query, (x) => x.title);
      const lines = [...todos.map((x) => x.text), ...(note ? note.body.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\[[ x]\]|\d+[.)])\s*/i, '').trim()).filter(Boolean) : [])];
      if (!lines.length) return { ok: false, message: `I don't have a checklist for ${query}. Add items with "add … to my to-do list" or create a note called ${query}.` };
      return { ok: true, data: lines, message: `Checklist for ${query}: ${lines.slice(0, 8).map((l, i) => `${i + 1}, ${l}`).join('. ')}.`, detail: lines.map((l) => `• ${l}`).join('\n') };
    },
  }),
  // ---- Time tracking ----
  defineTool({
    name: 'time.log', title: 'Log time', description: 'Log time spent on a task in the local time tracker.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ task: text, minutes: z.number().min(1).max(24 * 60) }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ task, minutes }) => `Log ${spokenDuration(Math.round(minutes * 60))} on ${task}`,
    async run({ task, minutes }, ctx) {
      ctx.repos.timeLog.add(task, minutes);
      const week = ctx.repos.timeLog.list(Date.now() - 7 * 86400000).filter((e) => bestMatch([e], task, (x) => x.task)).reduce((a, e) => a + e.minutes, 0);
      return { ok: true, message: `Logged ${spokenDuration(Math.round(minutes * 60))} on ${task}. That's ${spokenDuration(Math.round(week * 60))} this week.` };
    },
  }),
  defineTool({
    name: 'time.summary', title: 'Progress summary', description: 'Summarize time logged, to-dos finished and notes for a task over the last 7 days, or export the time log to Excel.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ task: z.string().trim().max(120).default(''), days: z.number().int().min(1).max(90).default(7) }).strict(), confirm: 'never', timeoutMs: 3000, offline: true,
    describe: ({ task }) => `Summarize your progress${task ? ` on ${task}` : ''}`,
    async run({ task, days }, ctx) {
      const since = Date.now() - days * 86400000;
      const match = <T>(items: T[], key: (t: T) => string) => (task ? items.filter((x) => bestMatch([x], task, key)) : items);
      const time = match(ctx.repos.timeLog.list(since), (e) => e.task);
      const done = match(ctx.repos.todos.list().filter((x) => x.done && (x.doneAt ?? 0) >= since), (x) => x.text);
      const open = match(ctx.repos.todos.list({ open: true }), (x) => x.text);
      const notes = match(ctx.repos.notes.list().filter((n) => n.updatedAt >= since), (n) => `${n.title} ${n.body}`);
      const mins = time.reduce((a, e) => a + e.minutes, 0);
      if (!time.length && !done.length && !open.length && !notes.length) return { ok: true, message: `I don't have anything logged${task ? ` for ${task}` : ''} in the last ${days} days. Log time with "log 1 hour on ${task || 'a task'}".` };
      const parts = [mins ? `you logged ${spokenDuration(Math.round(mins * 60))}` : '', done.length ? `finished ${done.length} to-do${done.length === 1 ? '' : 's'}` : '', open.length ? `${open.length} still open` : '', notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'} updated` : ''].filter(Boolean);
      return { ok: true, data: { minutes: mins, done: done.length, open: open.length }, message: `In the last ${days} days${task ? ` on ${task}` : ''}, ${parts.join(', ')}.` };
    },
  }),
  defineTool({
    name: 'stopwatch.control', title: 'Stopwatch', description: 'Start or stop a stopwatch for a task. Stopping logs the time in the tracker.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ action: z.enum(['start', 'stop', 'status']), label: z.string().trim().max(120).default('stopwatch') }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ action, label }) => `${action === 'start' ? 'Start' : action === 'stop' ? 'Stop' : 'Check'} the ${label} stopwatch`,
    async run({ action, label }, ctx) {
      const key = label.toLowerCase();
      if (action === 'start') { stopwatches.set(key, Date.now()); return { ok: true, message: `Stopwatch started for ${label}. Say "stop the stopwatch" when you're done.` }; }
      const k = stopwatches.has(key) ? key : [...stopwatches.keys()].pop();
      if (!k) return { ok: false, message: "There's no stopwatch running." };
      const secs = Math.round((Date.now() - stopwatches.get(k)!) / 1000);
      if (action === 'status') return { ok: true, message: `${spokenDuration(secs)} so far on ${k}.` };
      stopwatches.delete(k);
      if (secs >= 60) ctx.repos.timeLog.add(k, secs / 60);
      return { ok: true, data: { seconds: secs }, message: `${k[0].toUpperCase()}${k.slice(1)} took ${spokenDuration(secs)}.${secs >= 60 ? ' I logged it in your time tracker.' : ''}` };
    },
  }),
  // ---- Reminders, extended ----
  defineTool({
    name: 'reminders.repeat', title: 'Repeating reminder', description: 'Create a reminder that repeats daily, on weekdays, or weekly, starting at an ISO-8601 local time.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ text, at: iso, repeat: z.enum(['daily', 'weekdays', 'weekly']) }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ text: t, repeat }) => `Remind you ${repeat}: ${t}`,
    async run({ text: t, at, repeat }, ctx) {
      let due = new Date(at).getTime();
      if (!Number.isFinite(due)) return { ok: false, message: "I couldn't understand that time." };
      while (due <= Date.now()) due += (repeat === 'weekly' ? 7 : 1) * 86400000;
      const r = ctx.repos.reminders.add(t, due, 'reminder', repeat);
      ctx.scheduler.schedule(r.id, due);
      const d = new Date(due);
      const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return { ok: true, data: r, message: repeat === 'weekly' ? `Every ${d.toLocaleDateString('en-US', { weekday: 'long' })} at ${time}, I'll remind you: ${t}. The first one is ${fmtWhen(due)}.` : `Every ${repeat === 'daily' ? 'day' : 'weekday'} at ${time}, I'll remind you: ${t}. Alarms ring only while Clickyy is running.` };
    },
  }),
  defineTool({
    name: 'reminders.find', title: 'When is it', description: 'Find when a reminder or scheduled item is due, by its words.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ query: text }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ query }) => `Find when ${query} is`,
    async run({ query }, ctx) {
      const r = findReminder(ctx, query);
      if (!r) return { ok: false, message: `I don't have anything scheduled for ${query}. Clickyy can only see reminders you set with me, not your Outlook or Google calendar.` };
      return { ok: true, data: r, message: `${r.text} is ${fmtWhen(r.dueAt)}${r.repeat ? `, repeating ${r.repeat}` : ''}.` };
    },
  }),
  defineTool({
    name: 'reminders.cancel_named', title: 'Cancel a named reminder', description: 'Cancel the reminder whose words match.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ query: text }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ query }) => `Cancel the reminder for ${query}`,
    async run({ query }, ctx) {
      const r = findReminder(ctx, query);
      if (!r) return { ok: false, message: `I don't have a reminder for ${query}.` };
      ctx.repos.reminders.setStatus(r.id, 'cancelled');
      ctx.scheduler.cancel(r.id);
      return { ok: true, message: `Cancelled the reminder: ${r.text}${r.repeat ? ', including future repeats' : ''}.` };
    },
  }),
  defineTool({
    name: 'reminders.snooze', title: 'Snooze reminder', description: 'Push a reminder (the one matching, or the most recent) later by some minutes. Also re-adds a reminder that just rang.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ query: z.string().trim().max(200).optional(), minutes: z.number().min(1).max(24 * 60).default(10) }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ query, minutes }) => `Snooze ${query ?? 'the reminder'} for ${minutes} minutes`,
    async run({ query, minutes }, ctx) {
      const pending = findReminder(ctx, query);
      const due = Date.now() + minutes * 60000;
      if (pending && (!query || pending.dueAt - Date.now() < 2 * 3600000)) {
        ctx.repos.reminders.setDue(pending.id, Math.max(pending.dueAt, Date.now()) + minutes * 60000);
        ctx.scheduler.schedule(pending.id, Math.max(pending.dueAt, Date.now()) + minutes * 60000);
        return { ok: true, message: `Snoozed ${pending.text} for ${minutes} minutes.` };
      }
      const label = query ?? 'Your reminder';
      const r = ctx.repos.reminders.add(`${label[0].toUpperCase()}${label.slice(1)}`, due, 'reminder');
      ctx.scheduler.schedule(r.id, due);
      return { ok: true, message: `Okay, I'll remind you about ${label} again in ${minutes} minutes.` };
    },
  }),
  defineTool({
    name: 'reminders.reschedule', title: 'Reschedule reminder', description: 'Move a reminder to a new ISO-8601 local time (creates it if none matches).', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ query: text, at: iso }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ query }) => `Reschedule ${query}`,
    async run({ query, at }, ctx) {
      const due = new Date(at).getTime();
      if (!Number.isFinite(due) || due <= Date.now()) return { ok: false, message: 'That time is already in the past.' };
      const r = findReminder(ctx, query);
      if (r) { ctx.repos.reminders.setDue(r.id, due); ctx.scheduler.schedule(r.id, due); return { ok: true, message: `Moved ${r.text} to ${fmtWhen(due)}.` }; }
      const n = ctx.repos.reminders.add(query[0].toUpperCase() + query.slice(1), due, 'reminder');
      ctx.scheduler.schedule(n.id, due);
      return { ok: true, message: `I didn't have ${query} scheduled, so I set a reminder for ${fmtWhen(due)}.` };
    },
  }),
  defineTool({
    name: 'reminders.before', title: 'Warning before an event', description: 'Add an early warning a number of minutes before a scheduled reminder.', category: 'Productivity', risk: 1, permission: null,
    input: z.object({ query: text, minutes: z.number().int().min(1).max(24 * 60) }).strict(), confirm: 'never', timeoutMs: 2000, offline: true,
    describe: ({ query, minutes }) => `Warn you ${minutes} minutes before ${query}`,
    async run({ query, minutes }, ctx) {
      const r = findReminder(ctx, query);
      if (!r) return { ok: false, message: `I don't know when ${query} is. Tell me first, for example "remind me about ${query} at 3 pm tomorrow", then ask for the warning.` };
      const due = r.dueAt - minutes * 60000;
      if (due <= Date.now()) return { ok: false, message: `${r.text} is less than ${minutes} minutes away.` };
      const w = ctx.repos.reminders.add(`${r.text} starts in ${minutes} minutes`, due, 'reminder');
      ctx.scheduler.schedule(w.id, due);
      return { ok: true, message: `I'll warn you ${minutes} minutes before ${r.text}, ${fmtWhen(due)}.` };
    },
  }),
];

import { randomUUID } from 'node:crypto';
import type { Db, Row } from './db';
import { loadSettings, mergeSettings, type DeepPartial, type Settings } from '@shared/settings';
import type { AppEntry, AuditEntry, ConversationSummary, Memory, Reminder, RiskLevel, Routine, StoredMessage } from '@shared/types';

const newId = () => randomUUID().replace(/-/g, '').slice(0, 20);
const json = <T>(v: unknown, fallback: T): T => {
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
};

export class SettingsRepo {
  private cached: Settings;
  readonly repaired: boolean;
  constructor(private db: Db) {
    const row = db.get("SELECT value FROM kv WHERE key = 'settings'");
    const { settings, repaired } = loadSettings(row ? json(row.value, {}) : {});
    this.cached = settings;
    this.repaired = repaired;
    if (!row || repaired) this.save(settings);
  }
  get(): Settings { return this.cached; }
  update(patch: DeepPartial<Settings>): Settings {
    const next = mergeSettings(this.cached, patch);
    this.save(next);
    return next;
  }
  private save(s: Settings) {
    this.cached = s;
    this.db.run("INSERT INTO kv (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(s)]);
  }
}

export class ConversationRepo {
  constructor(private db: Db) {}
  create(title: string): string {
    const id = newId();
    const now = Date.now();
    this.db.run('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [id, title.slice(0, 80) || 'Conversation', now, now]);
    return id;
  }
  add(conversationId: string, role: 'user' | 'assistant', text: string, meta?: Record<string, unknown>): StoredMessage {
    const m: StoredMessage = { id: newId(), conversationId, role, text, createdAt: Date.now(), meta };
    this.db.tx(() => {
      this.db.run('INSERT INTO messages (id, conversation_id, role, text, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)', [m.id, conversationId, role, text, meta ? JSON.stringify(meta) : null, m.createdAt]);
      this.db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [m.createdAt, conversationId]);
    });
    return m;
  }
  list(): ConversationSummary[] {
    return this.db.all(`SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS n FROM conversations c ORDER BY updated_at DESC LIMIT 200`)
      .map((r) => ({ id: String(r.id), title: String(r.title), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), messageCount: Number(r.n) }));
  }
  messages(conversationId: string): StoredMessage[] {
    return this.db.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid', [conversationId]).map(toMessage);
  }
  delete(id: string) { return this.db.run('DELETE FROM conversations WHERE id = ?', [id]) > 0; }
  clear() { this.db.tx(() => { this.db.run('DELETE FROM messages'); this.db.run('DELETE FROM conversations'); }); }
  prune(olderThanMs: number) { return this.db.run('DELETE FROM conversations WHERE updated_at < ?', [Date.now() - olderThanMs]); }
  exportAll() {
    return this.list().map((c) => ({ ...c, messages: this.messages(c.id).map(({ role, text, createdAt }) => ({ role, text, createdAt })) }));
  }
}

const toMessage = (r: Row): StoredMessage => ({
  id: String(r.id), conversationId: String(r.conversation_id), role: r.role as 'user' | 'assistant', text: String(r.text),
  createdAt: Number(r.created_at), meta: r.meta ? json(r.meta, undefined) : undefined,
});

export class MemoryRepo {
  constructor(private db: Db) {}
  add(text: string, category = 'note'): Memory {
    const now = Date.now();
    const m: Memory = { id: newId(), text: text.trim(), category, createdAt: now, updatedAt: now };
    this.db.run('INSERT INTO memories (id, text, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [m.id, m.text, category, now, now]);
    return m;
  }
  update(id: string, text: string): boolean { return this.db.run('UPDATE memories SET text = ?, updated_at = ? WHERE id = ?', [text.trim(), Date.now(), id]) > 0; }
  list(query?: string): Memory[] {
    const rows = query
      ? this.db.all("SELECT * FROM memories WHERE text LIKE ? ESCAPE '\\' ORDER BY updated_at DESC", [`%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`])
      : this.db.all('SELECT * FROM memories ORDER BY updated_at DESC');
    return rows.map((r) => ({ id: String(r.id), text: String(r.text), category: String(r.category), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) }));
  }
  delete(id: string): boolean { return this.db.run('DELETE FROM memories WHERE id = ?', [id]) > 0; }
  clear() { this.db.run('DELETE FROM memories'); }
}

export class AppRepo {
  constructor(private db: Db) {}
  list(): AppEntry[] {
    return this.db.all('SELECT * FROM apps ORDER BY name COLLATE NOCASE').map((r) => ({
      id: String(r.id), name: String(r.name), aliases: json<string[]>(r.aliases, []), kind: r.kind as AppEntry['kind'], target: String(r.target),
      processName: r.process_name ? String(r.process_name) : undefined, detected: Boolean(r.detected), enabled: Boolean(r.enabled),
    }));
  }
  upsert(e: Omit<AppEntry, 'id' | 'detected'> & { id?: string; detected?: boolean }): AppEntry {
    const entry: AppEntry = { ...e, id: e.id ?? newId(), detected: e.detected ?? false };
    this.db.run(
      `INSERT INTO apps (id, name, aliases, kind, target, process_name, detected, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, aliases=excluded.aliases, kind=excluded.kind, target=excluded.target,
       process_name=excluded.process_name, enabled=excluded.enabled`,
      [entry.id, entry.name, JSON.stringify(entry.aliases), entry.kind, entry.target, entry.processName ?? null, entry.detected ? 1 : 0, entry.enabled ? 1 : 0],
    );
    return entry;
  }
  delete(id: string) { return this.db.run('DELETE FROM apps WHERE id = ?', [id]) > 0; }
}

export class RoutineRepo {
  constructor(private db: Db) {}
  list(): Routine[] {
    return this.db.all('SELECT * FROM routines ORDER BY name COLLATE NOCASE').map((r) => ({
      id: String(r.id), name: String(r.name), phrases: json<string[]>(r.phrases, []), steps: json(r.steps, []), enabled: Boolean(r.enabled), updatedAt: Number(r.updated_at),
    }));
  }
  upsert(r: Omit<Routine, 'id' | 'updatedAt'> & { id?: string }): Routine {
    const out: Routine = { ...r, id: r.id ?? newId(), updatedAt: Date.now() };
    this.db.run(
      `INSERT INTO routines (id, name, phrases, steps, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, phrases=excluded.phrases, steps=excluded.steps, enabled=excluded.enabled, updated_at=excluded.updated_at`,
      [out.id, out.name, JSON.stringify(out.phrases), JSON.stringify(out.steps), out.enabled ? 1 : 0, out.updatedAt],
    );
    return out;
  }
  delete(id: string) { return this.db.run('DELETE FROM routines WHERE id = ?', [id]) > 0; }
}

export class ReminderRepo {
  constructor(private db: Db) {}
  add(text: string, dueAt: number, kind: Reminder['kind'], repeat?: Reminder['repeat']): Reminder {
    const r: Reminder = { id: newId(), text, dueAt, kind, status: 'pending', createdAt: Date.now(), ...(repeat ? { repeat } : {}) };
    this.db.run('INSERT INTO reminders (id, text, due_at, kind, status, created_at, repeat) VALUES (?, ?, ?, ?, ?, ?, ?)', [r.id, text, dueAt, kind, r.status, r.createdAt, repeat ?? null]);
    return r;
  }
  pending(): Reminder[] { return this.db.all("SELECT * FROM reminders WHERE status = 'pending' ORDER BY due_at").map(toReminder); }
  setStatus(id: string, status: Reminder['status']) { return this.db.run('UPDATE reminders SET status = ? WHERE id = ?', [status, id]) > 0; }
  setDue(id: string, dueAt: number) { return this.db.run("UPDATE reminders SET due_at = ? WHERE id = ? AND status = 'pending'", [dueAt, id]) > 0; }
  clear() { this.db.run('DELETE FROM reminders'); }
}
const toReminder = (r: Row): Reminder => ({
  id: String(r.id), text: String(r.text), dueAt: Number(r.due_at), kind: r.kind as Reminder['kind'], status: r.status as Reminder['status'], createdAt: Number(r.created_at),
  ...(r.repeat ? { repeat: r.repeat as NonNullable<Reminder['repeat']> } : {}),
});

export interface Todo { id: string; text: string; priority: 'high' | 'normal' | 'low'; done: boolean; dueAt?: number; createdAt: number; doneAt?: number }
export class TodoRepo {
  constructor(private db: Db) {}
  add(text: string, priority: Todo['priority'] = 'normal', dueAt?: number): Todo {
    const t: Todo = { id: newId(), text, priority, done: false, createdAt: Date.now(), ...(dueAt ? { dueAt } : {}) };
    this.db.run('INSERT INTO todos (id, text, priority, done, due_at, created_at) VALUES (?, ?, ?, 0, ?, ?)', [t.id, text, priority, dueAt ?? null, t.createdAt]);
    return t;
  }
  list(opts: { open?: boolean } = {}): Todo[] {
    return this.db.all(`SELECT * FROM todos ${opts.open ? 'WHERE done = 0' : ''} ORDER BY done, CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at`).map((r) => ({
      id: String(r.id), text: String(r.text), priority: r.priority as Todo['priority'], done: Boolean(r.done), createdAt: Number(r.created_at),
      ...(r.due_at ? { dueAt: Number(r.due_at) } : {}), ...(r.done_at ? { doneAt: Number(r.done_at) } : {}),
    }));
  }
  setDone(id: string, done = true) { return this.db.run('UPDATE todos SET done = ?, done_at = ? WHERE id = ?', [done ? 1 : 0, done ? Date.now() : null, id]) > 0; }
  setDue(id: string, dueAt: number | null) { return this.db.run('UPDATE todos SET due_at = ? WHERE id = ?', [dueAt, id]) > 0; }
  delete(id: string) { return this.db.run('DELETE FROM todos WHERE id = ?', [id]) > 0; }
  clear() { this.db.run('DELETE FROM todos'); }
}

export interface Note { id: string; title: string; body: string; createdAt: number; updatedAt: number }
export class NoteRepo {
  constructor(private db: Db) {}
  private map = (r: Row): Note => ({ id: String(r.id), title: String(r.title), body: String(r.body), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) });
  create(title: string, body = ''): Note {
    const now = Date.now();
    const n: Note = { id: newId(), title, body, createdAt: now, updatedAt: now };
    this.db.run('INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [n.id, title, body, now, now]);
    return n;
  }
  list(): Note[] { return this.db.all('SELECT * FROM notes ORDER BY updated_at DESC').map(this.map); }
  append(id: string, text: string) {
    const n = this.db.get('SELECT * FROM notes WHERE id = ?', [id]);
    if (!n) return false;
    const body = String(n.body) ? `${String(n.body)}\n${text}` : text;
    return this.db.run('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?', [body, Date.now(), id]) > 0;
  }
  delete(id: string) { return this.db.run('DELETE FROM notes WHERE id = ?', [id]) > 0; }
  clear() { this.db.run('DELETE FROM notes'); }
}

export interface TimeEntry { id: string; task: string; minutes: number; at: number }
export class TimeLogRepo {
  constructor(private db: Db) {}
  add(task: string, minutes: number): TimeEntry {
    const e: TimeEntry = { id: newId(), task, minutes, at: Date.now() };
    this.db.run('INSERT INTO time_log (id, task, minutes, at) VALUES (?, ?, ?, ?)', [e.id, task, minutes, e.at]);
    return e;
  }
  list(since = 0): TimeEntry[] { return this.db.all('SELECT * FROM time_log WHERE at >= ? ORDER BY at DESC', [since]).map((r) => ({ id: String(r.id), task: String(r.task), minutes: Number(r.minutes), at: Number(r.at) })); }
  clear() { this.db.run('DELETE FROM time_log'); }
}

export class AuditRepo {
  constructor(private db: Db, private enabled: () => boolean) {}
  log(tool: string, risk: RiskLevel, outcome: string, summary: string, durationMs: number) {
    if (!this.enabled()) return;
    this.db.run('INSERT INTO audit (at, tool, risk, outcome, summary, duration_ms) VALUES (?, ?, ?, ?, ?, ?)', [Date.now(), tool, risk, outcome, summary, Math.round(durationMs)]);
    this.db.run('DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 2000)');
  }
  list(limit = 200): AuditEntry[] {
    return this.db.all('SELECT * FROM audit ORDER BY id DESC LIMIT ?', [limit]).map((r) => ({
      id: Number(r.id), at: Number(r.at), tool: String(r.tool), risk: Number(r.risk) as RiskLevel, outcome: String(r.outcome), summary: String(r.summary), durationMs: Number(r.duration_ms),
    }));
  }
  clear() { this.db.run('DELETE FROM audit'); }
}

export interface Repos {
  db: Db;
  settings: SettingsRepo;
  conversations: ConversationRepo;
  memories: MemoryRepo;
  apps: AppRepo;
  routines: RoutineRepo;
  reminders: ReminderRepo;
  audit: AuditRepo;
  todos: TodoRepo;
  notes: NoteRepo;
  timeLog: TimeLogRepo;
}

export function createRepos(db: Db): Repos {
  const settings = new SettingsRepo(db);
  return {
    db,
    settings,
    conversations: new ConversationRepo(db),
    memories: new MemoryRepo(db),
    apps: new AppRepo(db),
    routines: new RoutineRepo(db),
    reminders: new ReminderRepo(db),
    audit: new AuditRepo(db, () => settings.get().privacy.auditLog),
    todos: new TodoRepo(db),
    notes: new NoteRepo(db),
    timeLog: new TimeLogRepo(db),
  };
}

import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS: string[] = [
  // 1 — initial schema
  `CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('user','assistant')), text TEXT NOT NULL, meta TEXT, created_at INTEGER NOT NULL);
   CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);
   CREATE TABLE memories (id TEXT PRIMARY KEY, text TEXT NOT NULL, category TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE apps (id TEXT PRIMARY KEY, name TEXT NOT NULL, aliases TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
     process_name TEXT, detected INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1);
   CREATE TABLE routines (id TEXT PRIMARY KEY, name TEXT NOT NULL, phrases TEXT NOT NULL, steps TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE reminders (id TEXT PRIMARY KEY, text TEXT NOT NULL, due_at INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, tool TEXT NOT NULL, risk INTEGER NOT NULL,
     outcome TEXT NOT NULL, summary TEXT NOT NULL, duration_ms INTEGER NOT NULL);`,
  // 2 — to-do list, notes, time log, repeating reminders
  `CREATE TABLE todos (id TEXT PRIMARY KEY, text TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'normal', done INTEGER NOT NULL DEFAULT 0,
     due_at INTEGER, created_at INTEGER NOT NULL, done_at INTEGER);
   CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE time_log (id TEXT PRIMARY KEY, task TEXT NOT NULL, minutes REAL NOT NULL, at INTEGER NOT NULL);
   ALTER TABLE reminders ADD COLUMN repeat TEXT;`,
];

export type Row = Record<string, SqlValue>;

/**
 * SQLite via sql.js (WASM). The database lives in memory and is flushed to disk
 * atomically (write temp file, rename) shortly after each change.
 */
export class Db {
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  private constructor(private db: Database, readonly file: string | null) {}

  static async open(file: string | null, wasmPath?: string): Promise<Db> {
    const SQL = await initSqlJs(wasmPath ? { locateFile: () => wasmPath } : undefined);
    let data: Uint8Array | undefined;
    if (file && existsSync(file)) {
      data = readFileSync(file);
      Db.backup(file);
    }
    let raw: Database;
    try {
      raw = new SQL.Database(data);
      raw.exec('PRAGMA integrity_check');
    } catch {
      // Corrupt file: keep it aside for recovery and start fresh.
      if (file) renameSync(file, `${file}.corrupt-${Date.now()}`);
      raw = new SQL.Database();
    }
    raw.exec('PRAGMA foreign_keys = ON');
    const db = new Db(raw, file);
    db.migrate();
    return db;
  }

  private static backup(file: string) {
    // Rolling backups: .bak1 (newest) .. .bak3
    try {
      for (let i = 2; i >= 1; i--) if (existsSync(`${file}.bak${i}`)) copyFileSync(`${file}.bak${i}`, `${file}.bak${i + 1}`);
      copyFileSync(file, `${file}.bak1`);
    } catch {
      /* backups are best effort */
    }
  }

  private migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
    const current = (this.get('SELECT v FROM schema_version')?.v as number | undefined) ?? 0;
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]);
        this.db.exec('DELETE FROM schema_version');
        this.db.run('INSERT INTO schema_version (v) VALUES (?)', [v + 1]);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
    if (current < MIGRATIONS.length) this.markDirty();
  }

  get schemaVersion(): number { return this.get('SELECT v FROM schema_version')?.v as number; }

  all(sql: string, params: SqlValue[] = []): Row[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Row);
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(sql: string, params: SqlValue[] = []): Row | undefined {
    return this.all(sql, params)[0];
  }

  run(sql: string, params: SqlValue[] = []): number {
    this.db.run(sql, params);
    this.markDirty();
    return this.db.getRowsModified();
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      this.markDirty();
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  private markDirty() {
    this.dirty = true;
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 400);
  }

  flush() {
    if (!this.file || !this.dirty) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, Buffer.from(this.db.export()));
    renameSync(tmp, this.file);
    this.dirty = false;
  }

  sizeBytes(): number {
    return this.file && existsSync(this.file) ? statSync(this.file).size : 0;
  }

  close() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.flush();
    this.db.close();
  }
}

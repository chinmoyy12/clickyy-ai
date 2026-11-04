import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../src/main/storage/db';
import { createRepos } from '../src/main/storage/repos';
import { defaultSettings, loadSettings, mergeSettings } from '../src/shared/settings';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'clickyy-db-')), 'c.db');

describe('settings', () => {
  it('has safe defaults', () => {
    const s = defaultSettings();
    expect(s.ai.policy).toBe('smart_hybrid');
    expect(s.ai.allowCloudTranscripts).toBe(false);
    expect(s.tools.permissions.files).toBe(false);
    expect(s.tools.permissions.power).toBe(false);
    expect(s.wake.enabled).toBe(false);
    expect(s.ui.launchAtLogin).toBe(false);
  });
  it('validates merges', () => {
    expect(() => mergeSettings(defaultSettings(), { speech: { rate: 9 } })).toThrow();
    expect(mergeSettings(defaultSettings(), { speech: { rate: 1.3 } }).speech.rate).toBe(1.3);
  });
  it('repairs invalid stored sections without losing valid ones', () => {
    const raw = { ...defaultSettings(), assistantName: 'Nova', speech: { rate: 'fast' } };
    const { settings, repaired } = loadSettings(raw);
    expect(repaired).toBe(true);
    expect(settings.assistantName).toBe('Nova');
    expect(settings.speech.rate).toBe(1);
  });
  it('persists across restarts', async () => {
    const file = tmp();
    const db = await Db.open(file);
    createRepos(db).settings.update({ personality: { profile: 'playful' }, ui: { alwaysOnTop: true } });
    db.close();
    const db2 = await Db.open(file);
    const s = createRepos(db2).settings.get();
    expect(s.personality.profile).toBe('playful');
    expect(s.ui.alwaysOnTop).toBe(true);
    db2.close();
  });
});

describe('database', () => {
  it('migrates to the latest schema and keeps rolling backups', async () => {
    const file = tmp();
    (await Db.open(file)).close();
    const db = await Db.open(file);
    expect(db.schemaVersion).toBe(1);
    db.close();
    expect(existsSync(`${file}.bak1`)).toBe(true);
  });
  it('recovers from a corrupt file by setting it aside', async () => {
    const file = tmp();
    writeFileSync(file, 'this is not sqlite');
    const db = await Db.open(file);
    expect(db.schemaVersion).toBe(1);
    db.close();
    expect(readdirSync(join(file, '..')).some((f) => f.includes('.corrupt-'))).toBe(true);
  });
});

describe('conversation persistence', () => {
  it('stores, lists, exports and deletes conversations', async () => {
    const repos = createRepos(await Db.open(null));
    const id = repos.conversations.create('Hello there');
    repos.conversations.add(id, 'user', 'open chrome');
    repos.conversations.add(id, 'assistant', 'Google Chrome is open.');
    expect(repos.conversations.list()[0]).toMatchObject({ id, messageCount: 2 });
    expect(repos.conversations.messages(id).map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(repos.conversations.exportAll()[0].messages).toHaveLength(2);
    expect(repos.conversations.delete(id)).toBe(true);
    expect(repos.conversations.list()).toHaveLength(0);
    expect(repos.db.all('SELECT * FROM messages')).toHaveLength(0); // cascade
  });
  it('prunes by retention', async () => {
    const repos = createRepos(await Db.open(null));
    const id = repos.conversations.create('old');
    repos.db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [Date.now() - 40 * 86_400_000, id]);
    expect(repos.conversations.prune(30 * 86_400_000)).toBe(1);
  });
});

describe('memories', () => {
  it('adds, searches, edits, deletes individually and clears', async () => {
    const repos = createRepos(await Db.open(null));
    const a = repos.memories.add('I prefer dark roast coffee');
    repos.memories.add('My project is called Atlas');
    expect(repos.memories.list('coffee')).toHaveLength(1);
    expect(repos.memories.list('100%_')).toHaveLength(0); // LIKE wildcards escaped
    expect(repos.memories.update(a.id, 'I prefer light roast')).toBe(true);
    expect(repos.memories.list('light')).toHaveLength(1);
    expect(repos.memories.delete(a.id)).toBe(true);
    expect(repos.memories.list()).toHaveLength(1);
    repos.memories.clear();
    expect(repos.memories.list()).toHaveLength(0);
  });
});

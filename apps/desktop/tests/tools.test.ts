import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { setup } from './helpers';
import { ToolError, defineTool } from '../src/main/tools/types';
import { detectApps, findApp, matchWindow, validateAppTarget } from '../src/main/tools/apps';
import { ConfirmationBroker } from '../src/main/tools/confirmations';

describe('tool registry', () => {
  it('every tool has a name, schema, risk, timeout and description', async () => {
    const { registry } = await setup();
    const tools = registry.list();
    expect(tools.length).toBeGreaterThan(35);
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
      expect([1, 2, 3]).toContain(t.risk);
      expect(t.timeoutMs).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.input).toBeDefined();
    }
  });
  it('produces object JSON schemas for LLM tool calling', async () => {
    const { registry } = await setup();
    for (const t of registry.llmTools()) {
      expect(t.parameters.type).toBe('object');
      expect(t.name).not.toContain('.');
    }
  });
  it('has no shell or process-kill tool', async () => {
    const { registry } = await setup();
    expect(registry.list().filter((t) => /shell|exec|command|powershell|kill|terminate/i.test(t.name))).toHaveLength(0);
  });
});

describe('executor', () => {
  it('rejects malformed input before running', async () => {
    const s = await setup();
    await expect(s.executor.execute('audio.set_volume', { level: 250 }, s.ctx(), { origin: 'user_command' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(s.executor.execute('audio.set_volume', { level: 10, delta: 5 }, s.ctx(), { origin: 'user_command' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(s.executor.execute('audio.set_volume', { level: '1; rm -rf' }, s.ctx(), { origin: 'llm' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(s.bridge.calls).toHaveLength(0);
  });
  it('rejects unknown tools', async () => {
    const s = await setup();
    await expect(s.executor.execute('shell.run', { cmd: 'dir' }, s.ctx(), { origin: 'llm' })).rejects.toMatchObject({ code: 'unknown_tool' });
  });
  it('enforces disabled permissions', async () => {
    const s = await setup();
    await expect(s.executor.execute('files.list', {}, s.ctx(), { origin: 'user_command' })).rejects.toMatchObject({ code: 'permission' });
    await expect(s.executor.execute('power.action', { action: 'shutdown' }, s.ctx(), { origin: 'user_command' })).rejects.toMatchObject({ code: 'permission' });
  });
  it('runs low-risk tools without confirmation and verifies results', async () => {
    const s = await setup();
    const r = await s.executor.execute('audio.set_volume', { level: 30 }, s.ctx(), { origin: 'user_command' });
    expect(r).toMatchObject({ ok: true, message: 'Done. Volume is at 30 percent.' });
    expect(s.session.previousVolume).toBe(40);
    expect(s.confirmations).toHaveLength(0);
    expect(s.repos.audit.list()[0]).toMatchObject({ tool: 'audio.set_volume', outcome: 'completed' });
  });
  it('requires confirmation for destructive (level 3) actions and honors a decline', async () => {
    const s = await setup({ tools: { permissions: { power: true } } });
    s.autoConfirm(false);
    await expect(s.executor.execute('power.action', { action: 'shutdown' }, s.ctx(), { origin: 'user_command' })).rejects.toMatchObject({ code: 'denied' });
    expect(s.confirmations[0]).toMatchObject({ tool: 'power.action', risk: 3 });
    expect(s.confirmations[0].description).toMatch(/Shut down this PC in 30 seconds/);
    expect(s.platform.spawned).toHaveLength(0);
  });
  it('executes a destructive action only after explicit approval', async () => {
    const s = await setup({ tools: { permissions: { power: true } } });
    s.autoConfirm(true);
    await s.executor.execute('power.action', { action: 'restart' }, s.ctx(), { origin: 'user_command' });
    expect(s.platform.spawned[0].args).toEqual(['/r', '/t', '30']);
  });
  it('confirmations expire', async () => {
    const s = await setup({ tools: { permissions: { power: true } } });
    await expect(s.executor.execute('power.action', { action: 'signout' }, s.ctx(), { origin: 'user_command' })).rejects.toMatchObject({ code: 'denied' });
    expect(s.broker.respond(s.confirmations[0].id, true)).toBe(false);
  });
  it('always confirms sensitive tools proposed by a model', async () => {
    const s = await setup({ tools: { permissions: { files: true }, workspaceFolder: mkdtempSync(join(tmpdir(), 'ws-')) } });
    s.autoConfirm(false);
    await expect(s.executor.execute('files.create', { name: 'a.txt', content: 'x' }, s.ctx(), { origin: 'llm' })).rejects.toMatchObject({ code: 'denied' });
    expect(s.confirmations).toHaveLength(1);
  });
  it('times out slow tools', async () => {
    const s = await setup();
    s.registry.register(defineTool({ name: 'test.slow', title: 'Slow', description: 'A slow test tool.', category: 'Test', risk: 1, permission: null, input: z.object({}), confirm: 'never', timeoutMs: 50, offline: true, describe: () => 'slow', run: () => new Promise(() => {}) }));
    await expect(s.executor.execute('test.slow', {}, s.ctx(), { origin: 'user_command' })).rejects.toMatchObject({ code: 'timeout' });
  });
  it('cancels in-flight tools and pending confirmations', async () => {
    const s = await setup({ tools: { permissions: { power: true } } });
    const ac = new AbortController();
    const p = s.executor.execute('power.action', { action: 'shutdown' }, s.ctx(ac.signal), { origin: 'user_command' });
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
    expect(s.platform.spawned).toHaveLength(0);
  });
});

describe('confirmation broker', () => {
  it('approvals are single-use and bound to the exact action', async () => {
    const reqs: string[] = [];
    const b = new ConfirmationBroker((r) => reqs.push(r.id), () => {});
    const p = b.request('files.trash', 3, 'Trash', 'Trash a.txt', { path: 'a.txt' }, undefined, new AbortController().signal);
    expect(b.verifyBinding(reqs[0], 'files.trash', { path: 'a.txt' })).toBe(true);
    expect(b.verifyBinding(reqs[0], 'files.trash', { path: 'b.txt' })).toBe(false);
    expect(b.respond(reqs[0], true)).toBe(true);
    expect(b.respond(reqs[0], true)).toBe(false);
    await expect(p).resolves.toBe(true);
    expect(b.respond('nonexistent', true)).toBe(false);
  });
});

describe('application launching', () => {
  it('only accepts safe app targets', () => {
    expect(validateAppTarget('exe', 'C:\\Program Files\\App\\app.exe')).toBeNull();
    expect(validateAppTarget('exe', 'app.exe')).toMatch(/absolute/);
    expect(validateAppTarget('exe', 'C:\\x\\run.bat')).toMatch(/\.exe/);
    expect(validateAppTarget('uri', 'spotify:')).toBeNull();
    expect(validateAppTarget('uri', 'file:///C:/x.exe')).toMatch(/URI/);
    expect(validateAppTarget('uri', 'https://evil.com')).toMatch(/URI/);
    expect(validateAppTarget('uri', 'javascript:alert(1)')).toMatch(/URI/);
  });
  it('detects only installed apps', () => {
    const found = detectApps((p) => p.endsWith('notepad.exe'));
    expect(found.find((a) => a.name === 'Notepad')).toBeTruthy();
    expect(found.find((a) => a.name === 'Google Chrome')).toBeUndefined();
    expect(found.find((a) => a.name === 'Calculator')?.kind).toBe('uri');
  });
  it('launches approved apps and verifies the window', async () => {
    const s = await setup();
    s.repos.apps.upsert({ name: 'Notepad', aliases: ['notepad'], kind: 'exe', target: 'C:\\Windows\\System32\\notepad.exe', processName: 'Notepad', enabled: true });
    s.platform.existing.add('C:\\Windows\\System32\\notepad.exe');
    s.bridge.windows.push({ hwnd: 300, title: 'Untitled - Notepad', pid: 9, process: 'Notepad', minimized: false, maximized: false });
    const r = await s.executor.execute('apps.open', { app: 'notepad' }, s.ctx(), { origin: 'user_command' });
    expect(r).toMatchObject({ ok: true, message: 'Notepad is open.' });
    expect(s.platform.spawned[0]).toEqual({ file: 'C:\\Windows\\System32\\notepad.exe', args: [] });
    expect(s.session.lastApp?.name).toBe('Notepad');
  });
  it('refuses apps that are not in the registry', async () => {
    const s = await setup();
    const r = await s.executor.execute('apps.open', { app: 'cmd.exe /c del *' }, s.ctx(), { origin: 'llm' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/isn't in my approved apps/);
    expect(s.platform.spawned).toHaveLength(0);
  });
  it('reports a launched app whose window never appears', async () => {
    const s = await setup();
    s.repos.apps.upsert({ name: 'Ghost', aliases: [], kind: 'uri', target: 'spotify:', processName: 'Ghost', enabled: true });
    const r = await s.executor.execute('apps.open', { app: 'ghost' }, s.ctx(), { origin: 'user_command' });
    expect(r.message).toMatch(/can't see its window yet/);
  }, 15000);
  it('resolves app aliases and window categories', async () => {
    const apps = detectApps(() => true).map((a, i) => ({ ...a, id: String(i) }));
    expect(findApp(apps, 'vs code').match?.name).toBe('Visual Studio Code');
    expect(findApp(apps, 'my editor').match?.name).toBe('Visual Studio Code');
    const s = await setup();
    expect(matchWindow(s.bridge.windows, 'browser')[0].process).toBe('chrome');
    expect(matchWindow(s.bridge.windows, 'code editor')[0].process).toBe('Code');
  });
});

describe('windows, media and system tools', () => {
  it('focuses windows by category and records context', async () => {
    const s = await setup();
    const r = await s.executor.execute('windows.focus', { query: 'browser' }, s.ctx(), { origin: 'user_command' });
    expect(r.message).toBe('Switched to chrome.');
    expect(s.bridge.foreground).toBe(102);
    expect(s.session.lastWindow?.hwnd).toBe(102);
  });
  it('closing a window always needs confirmation', async () => {
    const s = await setup();
    s.autoConfirm(false);
    await expect(s.executor.execute('windows.close', {}, s.ctx(), { origin: 'user_command' })).rejects.toMatchObject({ code: 'denied' });
    expect(s.confirmations[0].description).toMatch(/Visual Studio Code/);
  });
  it('surfaces bridge failures as tool failures', async () => {
    const s = await setup();
    s.bridge.failOps.add('volume.get');
    await expect(s.executor.execute('audio.get_volume', {}, s.ctx(), { origin: 'user_command' })).rejects.toBeInstanceOf(ToolError);
    expect(s.records.at(-1)?.status).toBe('failed');
  });
  it('restores the previous volume', async () => {
    const s = await setup();
    await s.executor.execute('audio.set_volume', { level: 20 }, s.ctx(), { origin: 'user_command' });
    const r = await s.executor.execute('audio.restore_volume', {}, s.ctx(), { origin: 'user_command' });
    expect(r.message).toBe('Back to 40 percent.');
  });
  it('reports media control method honestly', async () => {
    const s = await setup();
    const r = await s.executor.execute('media.control', { action: 'pause' }, s.ctx(), { origin: 'user_command' });
    expect(r.message).toBe('Paused.');
  });
  it('opens websites only with validated URLs', async () => {
    const s = await setup();
    await s.executor.execute('web.open', { url: 'github.com' }, s.ctx(), { origin: 'llm' });
    expect(s.platform.opened).toEqual(['https://github.com/']);
    await expect(s.executor.execute('web.open', { url: 'file:///C:/Windows/notepad.exe' }, s.ctx(), { origin: 'llm' })).rejects.toThrow(/not allowed/);
  });
});

describe('file tools', () => {
  const root = mkdtempSync(join(tmpdir(), 'clickyy-files-'));
  const approved = join(root, 'docs');
  mkdirSync(approved);
  writeFileSync(join(approved, 'report-2026.md'), '# Report\nline 2');
  writeFileSync(join(root, 'outside.txt'), 'secret');

  it('lists, searches and reads inside approved folders', async () => {
    const s = await setup({ tools: { permissions: { files: true }, approvedFolders: [approved] } });
    expect((await s.executor.execute('files.list', {}, s.ctx(), { origin: 'user_command' })).message).toMatch(/has 1 item/);
    expect((await s.executor.execute('files.search', { name: 'report' }, s.ctx(), { origin: 'user_command' })).message).toMatch(/report-2026\.md/);
    const read = await s.executor.execute('files.read_text', { path: 'report-2026.md' }, s.ctx(), { origin: 'user_command' });
    expect(read.ok).toBe(true);
  });
  it('blocks traversal through every file tool', async () => {
    const s = await setup({ tools: { permissions: { files: true }, approvedFolders: [approved] } });
    for (const [tool, args] of [['files.read_text', { path: '..\\outside.txt' }], ['files.list', { folder: root }], ['files.open', { path: '../outside.txt' }]] as const) {
      await expect(s.executor.execute(tool, args, s.ctx(), { origin: 'llm' })).rejects.toThrow(/outside your approved folders/);
    }
  });
  it('creates files without overwriting', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'clickyy-ws-'));
    const s = await setup({ tools: { permissions: { files: true }, workspaceFolder: ws } });
    expect((await s.executor.execute('files.create', { name: 'notes', content: 'hi' }, s.ctx(), { origin: 'user_command' })).message).toBe('Created notes.txt.');
    expect(existsSync(join(ws, 'notes.txt'))).toBe(true);
    expect((await s.executor.execute('files.create', { name: 'notes.txt', content: 'x' }, s.ctx(), { origin: 'user_command' })).message).toMatch(/already exists/);
    await expect(s.executor.execute('files.create', { name: '..\\..\\evil.txt' }, s.ctx(), { origin: 'user_command' })).rejects.toThrow(/not a valid file name/);
  });
  it('moving and trashing always need confirmation', async () => {
    const s = await setup({ tools: { permissions: { files: true }, approvedFolders: [approved] } });
    s.autoConfirm(false);
    await expect(s.executor.execute('files.move', { from: 'report-2026.md', to: 'renamed.md' }, s.ctx(), { origin: 'user_command' })).rejects.toMatchObject({ code: 'denied' });
    await expect(s.executor.execute('files.trash', { path: 'report-2026.md' }, s.ctx(), { origin: 'user_command' })).rejects.toMatchObject({ code: 'denied' });
    expect(s.confirmations.map((c) => c.risk)).toEqual([2, 3]);
    expect(existsSync(join(approved, 'report-2026.md'))).toBe(true);
  });
});

describe('productivity tools', () => {
  it('schedules timers and reminders locally', async () => {
    const s = await setup();
    const r = await s.executor.execute('timers.create', { seconds: 600 }, s.ctx(), { origin: 'user_command' });
    expect(r.message).toBe('10 minutes timer, starting now.');
    expect(s.scheduled.size).toBe(1);
    await s.executor.execute('reminders.cancel', { target: 'last' }, s.ctx(), { origin: 'user_command' });
    expect(s.scheduled.size).toBe(0);
  });
  it('refuses to remember or type credentials', async () => {
    const s = await setup({ tools: { permissions: { automation: true } } });
    expect((await s.executor.execute('memory.save', { text: 'my password is hunter2' }, s.ctx(), { origin: 'user_command' })).ok).toBe(false);
    expect(s.repos.memories.list()).toHaveLength(0);
    s.autoConfirm(true);
    expect((await s.executor.execute('keyboard.type', { text: 'my password is hunter2' }, s.ctx(), { origin: 'user_command' })).ok).toBe(false);
    expect(s.bridge.calls.find((c) => c.op === 'keys.type')).toBeUndefined();
  });
  it('only allowlisted shortcuts exist', async () => {
    const s = await setup({ tools: { permissions: { automation: true } } });
    await expect(s.executor.execute('keyboard.shortcut', { combo: 'win+r' }, s.ctx(), { origin: 'llm' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

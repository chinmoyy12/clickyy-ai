import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/main/assistant/catalog';
import { route } from '../src/main/assistant/router';
import { normalize, parseClockTime, parseDuration, wordsToNumbers } from '../src/main/assistant/normalize';
import { detectApps } from '../src/main/tools/apps';
import { createRegistry } from '../src/main/tools';
import type { AppEntry } from '../src/shared/types';

const apps: AppEntry[] = detectApps(() => true).map((a, i) => ({ ...a, id: `a${i}` }));
const ctx = { session: {}, apps };
const first = (t: string) => {
  const r = route(t, ctx);
  return r.kind === 'commands' ? r.steps[0] : null;
};
const toolOf = (t: string) => {
  const s = first(t);
  return s?.resolution.kind === 'tool' ? { tool: s.resolution.tool, args: s.resolution.args } : null;
};

describe('normalization', () => {
  it('converts spoken numbers', () => {
    expect(wordsToNumbers('set volume to thirty percent')).toBe('set volume to 30 percent');
    expect(wordsToNumbers('twenty five minutes')).toBe('25 minutes');
    expect(wordsToNumbers('a hundred')).toBe('100');
    expect(wordsToNumbers('half an hour')).toBe('30 minutes');
    expect(wordsToNumbers('open a new tab')).toBe('open a new tab');
  });
  it('strips wake words, politeness and punctuation', () => {
    expect(normalize('Hey Clickyy, could you please open Chrome for me?')).toBe('open chrome');
    expect(normalize('Jarvis! Set the volume to 30%.')).toBe('set the volume to 30 percent');
    expect(normalize('hey click e open note pad')).toBe('open notepad');
  });
  it('parses durations and clock times', () => {
    expect(parseDuration('in 1 hour and 30 minutes')).toBe(5400);
    expect(parseDuration('nothing')).toBeNull();
    const base = new Date(2026, 10, 3, 10, 0, 0);
    expect(parseClockTime('tomorrow morning', base)?.toString()).toBe(new Date(2026, 10, 4, 9, 0, 0).toString());
    expect(parseClockTime('at 5 pm', base)?.getHours()).toBe(17);
    expect(parseClockTime('at 7:30 am', base)?.getDate()).toBe(4); // already past today
  });
});

describe('command catalog', () => {
  const registry = createRegistry();

  it('every command maps to a registered tool or a built-in', () => {
    for (const c of CATALOG) if (c.tool) expect(registry.get(c.tool), c.id).toBeDefined();
  });

  it('has unique ids and at least one example per command', () => {
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
    for (const c of CATALOG) expect(c.examples.length, c.id).toBeGreaterThan(0);
  });

  const cases = CATALOG.flatMap((c) => c.examples.map((e) => [c.id, e] as const));
  it.each(cases)('%s routes "%s"', (id, example) => {
    const r = route(example, ctx);
    expect(r.kind, example).toBe('commands');
    if (r.kind === 'commands') expect(r.steps[0].commandId).toBe(id);
  });

  it('resolves arguments correctly', () => {
    expect(toolOf('set volume to thirty percent')).toEqual({ tool: 'audio.set_volume', args: { level: 30 } });
    expect(toolOf('turn the volume down a little')).toEqual({ tool: 'audio.set_volume', args: { delta: -5 } });
    expect(toolOf('louder')).toEqual({ tool: 'audio.set_volume', args: { delta: 10 } });
    expect(toolOf('open bluetooth settings')).toEqual({ tool: 'system.open_settings', args: { page: 'bluetooth' } });
    expect(toolOf('open vs code')).toEqual({ tool: 'apps.open', args: { app: 'Visual Studio Code' } });
    expect(toolOf('open youtube')).toEqual({ tool: 'web.open', args: { url: 'https://www.youtube.com' } });
    expect(toolOf('show my downloads')).toEqual({ tool: 'system.open_folder', args: { folder: 'downloads' } });
    expect(toolOf('put the browser on the left')).toEqual({ tool: 'windows.arrange', args: { action: 'snap_left', query: 'browser' } });
    expect(toolOf('minimize the current window')).toEqual({ tool: 'windows.arrange', args: { action: 'minimize' } });
    expect(toolOf('set a timer for ten minutes')).toEqual({ tool: 'timers.create', args: { seconds: 600, label: 'Timer' } });
    expect(toolOf('start a twenty five minute focus session')).toEqual({ tool: 'timers.create', args: { seconds: 1500, label: 'Focus', focus: true } });
    expect(toolOf('remind me to call mom in 1 hour')).toEqual({ tool: 'reminders.create', args: { text: 'call mom', inSeconds: 3600 } });
    expect(toolOf('remember that my project is called Atlas')).toEqual({ tool: 'memory.save', args: { text: 'my project is called atlas' } });
    expect(toolOf('search for electron security checklist')).toEqual({ tool: 'web.search', args: { query: 'electron security checklist' } });
    expect(toolOf('restart the pc')).toEqual({ tool: 'power.action', args: { action: 'restart' } });
  });

  it('handles speech-recognition variants', () => {
    expect(toolOf('open note pad')?.args).toEqual({ app: 'Notepad' });
    expect(toolOf('open v s code')?.args).toEqual({ app: 'Visual Studio Code' });
    expect(toolOf('jarvis volume too fifty')).toEqual({ tool: 'audio.set_volume', args: { level: 50 } });
    expect(toolOf('what is the time')?.tool).toBe('system.time');
    expect(toolOf('is the wi fi connected')?.tool).toBe('system.network');
  });

  it('splits compound commands only when every part is a command', () => {
    const r = route('open spotify and set the volume to 30 percent', ctx);
    expect(r.kind === 'commands' && r.steps.map((s) => s.commandId)).toEqual(['apps.open', 'audio.set']);
    const kept = route('search for salt and pepper recipes', ctx);
    expect(kept.kind === 'commands' && kept.steps.map((s) => s.commandId)).toEqual(['web.search']);
    const mem = route('remember that I like rock and roll', ctx);
    expect(mem.kind === 'commands' && mem.steps[0].resolution).toMatchObject({ kind: 'tool', args: { text: 'i like rock and roll' } });
  });

  it('asks for missing details and fills them from the follow-up', () => {
    const r = route('set a timer', ctx);
    expect(r.kind === 'commands' && r.steps[0].resolution).toMatchObject({ kind: 'clarify', question: 'For how long?' });
    const pending = r.kind === 'commands' && r.steps[0].resolution.kind === 'clarify' ? r.steps[0].resolution.pending! : null;
    const follow = route('five minutes', ctx, [], pending);
    expect(follow.kind === 'commands' && follow.steps[0].resolution).toEqual({ kind: 'tool', tool: 'timers.create', args: { seconds: 300, label: 'Timer' } });
    const what = route('open', ctx);
    expect(what.kind === 'commands' && what.steps[0].resolution).toMatchObject({ kind: 'clarify' });
  });

  it('a new full command overrides a pending question', () => {
    const r = route('set a timer', ctx);
    const pending = r.kind === 'commands' && r.steps[0].resolution.kind === 'clarify' ? r.steps[0].resolution.pending! : null;
    const next = route('what time is it', ctx, [], pending);
    expect(next.kind === 'commands' && next.steps[0].commandId).toBe('system.time');
  });

  it('resolves pronouns from session context', () => {
    const c = { session: { lastApp: { id: 'x', name: 'Spotify' } }, apps };
    const r = route('open it again', c);
    expect(r.kind === 'commands' && r.steps[0].resolution).toEqual({ kind: 'tool', tool: 'apps.open', args: { app: 'Spotify' } });
    expect(toolOf('close it')).toEqual({ tool: 'windows.close', args: { query: 'it' } });
  });

  it('refuses shell-style and destructive requests deterministically', () => {
    for (const t of ['run powershell command to delete everything', 'open cmd and run del /s', 'execute this script', 'delete system32', 'format my c drive']) {
      expect(first(t)?.resolution, t).toEqual({ kind: 'builtin', builtin: 'refuse_shell', params: undefined });
    }
  });

  it('leaves open questions for the language model', () => {
    for (const t of ['tell me something interesting', 'explain quantum computing simply', 'why is the sky blue', 'write me a haiku about rain']) {
      expect(route(t, ctx).kind, t).toBe('none');
    }
  });

  it('matches user routines by phrase', () => {
    const routine = { id: 'r1', name: 'Coding mode', phrases: ['coding mode'], steps: [{ tool: 'apps.open', args: { app: 'vs code' } }], enabled: true, updatedAt: 0 };
    expect(route('Hey Clickyy, coding mode', ctx, [routine]).kind).toBe('routine');
    expect(route('coding mode', ctx, [{ ...routine, enabled: false }]).kind).not.toBe('routine');
  });

  it('reports catalog size', () => {
    const examples = CATALOG.reduce((n, c) => n + c.examples.length, 0);
    // Documented in docs/COMMANDS.md; keep the numbers honest.
    expect(CATALOG.length).toBeGreaterThanOrEqual(70);
    expect(examples).toBeGreaterThanOrEqual(180);
  });
});

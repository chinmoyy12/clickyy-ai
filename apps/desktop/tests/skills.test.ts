import { describe, expect, it } from 'vitest';
import { setup } from './helpers';
import { convert, evaluate, spokenToExpression, unitId } from '../src/main/tools/skills';
import { route } from '../src/main/assistant/router';
import { detectApps, editDistance, findApp } from '../src/main/tools/apps';
import { chunkForSpeech } from '../src/renderer/audio/tts';
import { selectTools } from '../src/main/assistant/toolSelect';
import { createRegistry } from '../src/main/tools';

describe('safe calculator', () => {
  it.each([
    ['2+3*4', 14], ['(2+3)*4', 20], ['2^10', 1024], ['-3+5', 2], ['10/4', 2.5], ['10%3', 1], ['sqrt(144)', 12], ['2^3^2', 512], ['pi*2', Math.PI * 2], ['sin(90)', 1],
  ])('%s = %s', (expr, want) => expect(evaluate(expr)).toBeCloseTo(want as number, 10));

  it('rejects anything that is not math (no eval)', () => {
    for (const bad of ['process.exit()', 'require("fs")', '1;2', 'alert(1)', '2**', '(1+2', 'constructor']) expect(() => evaluate(bad)).toThrow();
    expect(() => evaluate('1/0')).toThrow(/divide by zero/);
  });

  it('understands spoken math', () => {
    expect(evaluate(spokenToExpression("what's 15 percent of 240"))).toBe(36);
    expect(evaluate(spokenToExpression('12 times 7'))).toBe(84);
    expect(evaluate(spokenToExpression('square root of 81'))).toBe(9);
    expect(evaluate(spokenToExpression('2 to the power of 8'))).toBe(256);
    expect(evaluate(spokenToExpression('1250 divided by 5 plus 3'))).toBe(253);
  });
});

describe('unit conversion', () => {
  it('converts across dimensions correctly', () => {
    expect(convert(5, 'mi', 'km')).toBeCloseTo(8.04672, 5);
    expect(convert(100, 'f', 'c')).toBeCloseTo(37.7778, 3);
    expect(convert(0, 'c', 'k')).toBeCloseTo(273.15, 5);
    expect(convert(1, 'l', 'cup')).toBeCloseTo(4.2268, 3);
    expect(convert(2, 'gb', 'mb')).toBe(2000);
    expect(() => convert(1, 'kg', 'km')).toThrow(/can't convert/);
  });
  it('resolves spoken unit names', () => {
    expect(unitId('kilometers')).toBe('km');
    expect(unitId('degrees fahrenheit')).toBe('f');
    expect(unitId('cups')).toBe('cup');
    expect(unitId('parsecs')).toBeNull();
  });
});

describe('skill tools', () => {
  it('weather uses the network guard and speaks a natural summary', async () => {
    const s = await setup({ tools: { weatherLocation: 'London' } });
    const r = await s.executor.execute('weather.current', {}, s.ctx(), { origin: 'user_command' });
    expect(r.message).toBe("It's 14°C and light rain in London, feeling like 12°C. Today's high is 16°C and the low is 9°C, with wind around 18 kilometers per hour. There's a 70 percent chance of rain today.");
  });
  it('weather asks for a city when none is known, and handles unknown places', async () => {
    const s = await setup();
    expect((await s.executor.execute('weather.current', {}, s.ctx(), { origin: 'user_command' })).message).toMatch(/Which city/);
    expect((await s.executor.execute('weather.current', { location: 'Atlantis' }, s.ctx(), { origin: 'user_command' })).message).toMatch(/couldn't find/);
  });
  it('screen capture is off by default and always confirmed when enabled', async () => {
    const s = await setup();
    await expect(s.executor.execute('screen.capture', {}, s.ctx(), { origin: 'user_command' })).rejects.toMatchObject({ code: 'permission' });
    const on = await setup({ tools: { permissions: { screen: true } } });
    on.autoConfirm(false);
    await expect(on.executor.execute('screen.capture', {}, on.ctx(), { origin: 'user_command' })).rejects.toMatchObject({ code: 'denied' });
    expect(on.platform.screenshots).toBe(0);
    expect(on.confirmations[0].actionLabel).toBe('Capture the screen once');
  });
});

describe('advanced routing', () => {
  const apps = detectApps(() => true).map((a, i) => ({ ...a, id: `a${i}` }));
  const ctx = { session: {}, apps };
  const r = (t: string) => {
    const x = route(t, ctx);
    return x.kind === 'commands' ? x.steps[0].resolution : null;
  };
  it('routes Jarvis-style requests', () => {
    expect(r('good morning briefing')).toMatchObject({ kind: 'builtin', builtin: 'briefing' });
    expect(r("hey jarvis how's my computer doing")).toMatchObject({ kind: 'builtin', builtin: 'system_report' });
    expect(r('weather in new york today')).toEqual({ kind: 'tool', tool: 'weather.current', args: { location: 'new york' } });
    expect(r("what's 15% of 240")).toEqual({ kind: 'tool', tool: 'math.calculate', args: { expression: '15 percent of 240' } });
    expect(r('convert 5 miles to kilometers')).toEqual({ kind: 'tool', tool: 'units.convert', args: { value: 5, from: 'miles', to: 'kilometers' } });
    expect(r('how many cups in a liter')).toEqual({ kind: 'tool', tool: 'units.convert', args: { value: 1, from: 'liter', to: 'cups' } });
    expect(r('translate my clipboard to spanish')).toEqual({ kind: 'builtin', builtin: 'clipboard_ai', params: { instruction: 'translate to spanish' } });
    expect(r('look at my screen and explain this error')).toMatchObject({ kind: 'builtin', builtin: 'screen' });
  });
  it('does not mistake system questions for math', () => {
    expect(r("what's the volume")).toMatchObject({ kind: 'tool', tool: 'audio.get_volume' });
    expect(r('what time is it')).toMatchObject({ kind: 'tool', tool: 'system.time' });
  });
  it('fuzzy-matches misheard app names', () => {
    expect(editDistance('spotfy', 'spotify')).toBe(1);
    expect(findApp(apps, 'spotfy').match?.name).toBe('Spotify');
    expect(findApp(apps, 'crome').match?.name).toBe('Google Chrome');
    expect(findApp(apps, 'xyzzy').match).toBeUndefined();
    expect(r('open spotfy')).toEqual({ kind: 'tool', tool: 'apps.open', args: { app: 'Spotify' } });
  });
});

describe('tool selection for small local models', () => {
  const all = createRegistry().llmTools().map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  const names = (t: string) => selectTools(t, all).map((x) => x.name);
  it('offers no tools for plain questions', () => {
    expect(names('why is the sky blue')).toEqual([]);
    expect(names('explain how black holes form')).toEqual([]);
    expect(names('tell me a fun fact about octopuses')).toEqual([]);
  });
  it('offers a small relevant set for actions', () => {
    expect(names('my speakers are a bit much, make it quieter')).toContain('audio__set_volume');
    expect(names('my speakers are a bit much, make it quieter').length).toBeLessThanOrEqual(6);
    expect(names('could you put chrome on the left side')).toEqual(expect.arrayContaining(['windows__arrange']));
    expect(names('will I need a jacket, is it going to rain')).toEqual(['weather__current']);
  });
});

describe('speech chunking for the neural voice', () => {
  it('keeps the first chunk short so speech starts fast, merges fragments', () => {
    const chunks = chunkForSpeech('Done. The volume is at thirty percent, the editor is open on the left, the browser is on the right, and your focus timer is running for twenty-five minutes, so you are all set to start working now without distractions.');
    expect(chunks[0]).toBe('Done.');
    expect(chunks[1]).toMatch(/^The volume is at thirty percent,/);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(chunkForSpeech('Hi.')).toEqual(['Hi.']);
    expect(chunkForSpeech('   ')).toEqual([]);
  });
});

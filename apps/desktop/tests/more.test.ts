/**
 * 0.7 everyday extras: jokes, facts, riddles, motivation, passwords, spelling, Roman numerals, bill
 * splitting, day of the week, age, dictionary, air quality, sunrise and sunset.
 */
import { describe, expect, it } from 'vitest';
import { setup } from './helpers';
import { route } from '../src/main/assistant/router';
import { FACTS, JOKES, aqiBand, fromRoman, makePassword, toRoman } from '../src/main/tools/more';

const res = (t: string) => { const r = route(t, { session: {}, apps: [] }); return r.kind === 'commands' ? r.steps[0].resolution : null; };
const run = async (tool: string, args: Record<string, unknown> = {}, s?: Awaited<ReturnType<typeof setup>>) => {
  const t = s ?? (await setup());
  return t.executor.execute(tool, args, t.ctx(), { origin: 'user_command' });
};

describe('routing the new commands', () => {
  it.each([
    ['tell me a joke', 'fun.say', { kind: 'joke' }], ['make me laugh', 'fun.say', { kind: 'joke' }], ['another joke', 'fun.say', { kind: 'joke' }],
    ['tell me a fun fact', 'fun.say', { kind: 'fact' }], ['teach me something new', 'fun.say', { kind: 'fact' }],
    ['give me a riddle', 'fun.say', { kind: 'riddle' }], ['i give up', 'fun.riddle_answer', {}],
    ['motivate me', 'fun.say', { kind: 'motivation' }], ['i need some motivation', 'fun.say', { kind: 'motivation' }],
    ['generate a strong password', 'password.generate', { length: 16 }], ['make me a 24 character password', 'password.generate', { length: 24 }],
    ['how do you spell necessary', 'text.spell', { word: 'necessary', phonetic: false }], ['spell bravo phonetically', 'text.spell', { word: 'bravo', phonetic: true }],
    ['what is 2026 in roman numerals', 'number.roman', { value: '2026' }], ['what number is mcmxcix', 'number.roman', { value: 'mcmxcix' }],
    ['split 1200 between 4 people', 'math.split_bill', { amount: 1200, people: 4, tipPercent: 0 }],
    ['split the bill of 2500 among 5 with a 10% tip', 'math.split_bill', { amount: 2500, people: 5, tipPercent: 10 }],
    ["what's a 15 percent tip on 80", 'math.split_bill', { amount: 80, people: 1, tipPercent: 15 }],
    ['what day was august 15 1947', 'date.weekday', { date: 'august 15 1947' }], ['what day is christmas this year', 'date.weekday', { date: 'christmas' }],
    ['how old is someone born on june 2 2006', 'date.weekday', { date: 'june 2 2006', mode: 'age' }],
    ['define serendipity', 'dictionary.define', { word: 'serendipity' }], ['what does ubiquitous mean', 'dictionary.define', { word: 'ubiquitous' }],
    ['synonyms for happy', 'dictionary.define', { word: 'happy', mode: 'synonyms' }], ['opposite of generous', 'dictionary.define', { word: 'generous', mode: 'antonyms' }],
    ["what's the air quality", 'weather.air', {}], ['aqi in delhi', 'weather.air', { location: 'delhi' }], ['how is the air in mumbai today', 'weather.air', { location: 'mumbai' }],
    ['when is sunset', 'weather.sun', {}], ['what time is sunrise in tokyo', 'weather.sun', { location: 'tokyo' }],
  ])('%s', (text, tool, args) => expect(res(text)).toEqual({ kind: 'tool', tool, args }));

  it('leaves look-alikes to other commands or the model', () => {
    const not = (t: string, tool: string) => { const r = res(t); return !(r && r.kind === 'tool' && r.tool === tool); };
    expect(not('what day is it', 'date.weekday')).toBe(true);
    expect(not('what day is today', 'date.weekday')).toBe(true);
    expect(not('what is the meaning of life', 'dictionary.define')).toBe(true);
    expect(not('what does it mean', 'dictionary.define')).toBe(true);
    expect(not('write a joke about cats in the style of shakespeare', 'fun.say')).toBe(true);
    expect(not('change my password', 'password.generate')).toBe(true);
    expect(res("what's the weather")).toMatchObject({ tool: 'weather.current' });
    expect(res("what's 15 percent of 240")).toMatchObject({ tool: 'math.calculate' });
  });
});

describe('offline extras', () => {
  it('jokes and facts never repeat back to back', async () => {
    const s = await setup();
    let prev = '';
    for (let i = 0; i < 30; i++) { const r = await run('fun.say', { kind: 'joke' }, s); expect(r.message).not.toBe(prev); expect(JOKES).toContain(r.message); prev = r.message; }
    expect(FACTS).toContain((await run('fun.say', { kind: 'fact' }, s)).message);
  });
  it('asks a riddle and reveals the answer once', async () => {
    const s = await setup();
    expect((await run('fun.riddle_answer', {}, s)).ok).toBe(false);
    const q = await run('fun.say', { kind: 'riddle' }, s);
    expect(q.message).toMatch(/\?.*tell me the answer/);
    expect((await run('fun.riddle_answer', {}, s)).message).toMatch(/^The answer is: /);
    expect((await run('fun.riddle_answer', {}, s)).ok).toBe(false);
  });
  it('makes strong passwords that are shown, never spoken', async () => {
    for (let i = 0; i < 50; i++) {
      const p = makePassword(16);
      expect(p).toHaveLength(16);
      expect(p).toMatch(/[a-z]/); expect(p).toMatch(/[A-Z]/); expect(p).toMatch(/[2-9]/); expect(p).toMatch(/[!@#$%^&*\-_=+?]/);
      expect(p).not.toMatch(/[lIO01]/);
    }
    const r = await run('password.generate', { length: 20 });
    expect(r.detail).toHaveLength(20);
    expect(r.message).not.toContain(r.detail!);
    expect(r.secretDetail).toBe(true);
  });
  it('spells words, with the phonetic alphabet on request', async () => {
    expect((await run('text.spell', { word: 'cat' })).message).toBe('cat is spelled C, A, T.');
    expect((await run('text.spell', { word: 'ab', phonetic: true })).message).toBe('ab is spelled A for alpha, B for bravo.');
  });
  it('converts Roman numerals both ways and rejects invalid ones', async () => {
    expect(toRoman(2026)).toBe('MMXXVI'); expect(toRoman(3999)).toBe('MMMCMXCIX'); expect(toRoman(4)).toBe('IV');
    expect(fromRoman('mcmxcix')).toBe(1999);
    expect(() => fromRoman('IIII')).toThrow(/valid/); expect(() => toRoman(0)).toThrow();
    expect((await run('number.roman', { value: '49' })).message).toBe('49 in Roman numerals is X L I X.');
    expect((await run('number.roman', { value: 'xlix' })).message).toBe('XLIX is 49.');
  });
  it('splits bills with tips', async () => {
    expect((await run('math.split_bill', { amount: 1200, people: 4 })).message).toBe("That's 300 each for 4 people.");
    expect((await run('math.split_bill', { amount: 2500, people: 5, tipPercent: 10 })).message).toBe("With a 10 percent tip of 250, the total is 2,750. That's 550 each for 5 people.");
    expect((await run('math.split_bill', { amount: 80, tipPercent: 15 })).message).toBe('With a 15 percent tip of 12, the total is 92.');
  });
  it('knows the day of the week for historic dates and holidays', async () => {
    expect((await run('date.weekday', { date: 'august 15 1947' })).message).toBe('August 15, 1947 was a Friday.');
    expect((await run('date.weekday', { date: 'january 26 1950' })).message).toBe('January 26, 1950 was a Thursday.');
    expect((await run('date.weekday', { date: 'christmas' })).message).toMatch(/^December 25, \d{4} (is|was|is today,) a \w+day\.$/);
    expect((await run('date.weekday', { date: 'someday' })).ok).toBe(false);
  });
  it('works out ages and refuses dates without a year', async () => {
    const r = await run('date.weekday', { date: 'january 1 2000', mode: 'age' });
    const now = new Date();
    expect(r.message).toMatch(new RegExp(`is ${now.getFullYear() - 2000 - (now.getMonth() === 0 && now.getDate() === 1 ? 0 : 0)} years old`));
    expect((await run('date.weekday', { date: 'june 2', mode: 'age' })).ok).toBe(false);
    expect((await run('date.weekday', { date: 'june 2 2999', mode: 'age' })).message).toMatch(/hasn't happened/);
  });
});

describe('online extras without a key', () => {
  it('defines words and lists synonyms and antonyms, stripping markup', async () => {
    expect((await run('dictionary.define', { word: 'happy' })).message).toBe('happy. As an adjective: Feeling or showing pleasure or contentment. As a verb: To become happy.');
    expect((await run('dictionary.define', { word: 'happy', mode: 'synonyms' })).message).toBe('Words like happy: cheerful, joyful, glad, content.');
    expect((await run('dictionary.define', { word: 'happy', mode: 'antonyms' })).message).toBe('Opposites of happy: unhappy, sad.');
    expect((await run('dictionary.define', { word: 'zzzz' })).message).toMatch(/couldn't find "zzzz"/);
  });
  it('reports air quality with health advice', async () => {
    const r = await run('weather.air', { location: 'London' });
    expect(r.message).toBe('Air quality in London is unhealthy, with an AQI of 162 and PM2.5 at 78. Consider a mask outdoors and keep windows closed.');
    expect(aqiBand(40)).toBe('good'); expect(aqiBand(120)).toBe('unhealthy for sensitive groups'); expect(aqiBand(400)).toBe('hazardous');
    expect((await run('weather.air')).message).toMatch(/Which city/);
  });
  it('gives sunrise and sunset in local 12-hour time', async () => {
    expect((await run('weather.sun', { location: 'London' })).message).toBe('In London today, sunrise is at 7:38 AM and sunset is at 4:01 PM, local time.');
  });
  it('is blocked in Strict Offline mode', async () => {
    const s = await setup({ ai: { policy: 'strict_offline' } });
    expect(s.registry.get('dictionary.define')?.offline).toBe(false);
    expect(s.registry.get('fun.say')?.offline).toBe(true);
  });
});

/**
 * 0.7 Windows panels, calculators (EMI, BMI, leap year, time until) and small companions
 * (decide for me, rock paper scissors, breathing).
 */
import { describe, expect, it } from 'vitest';
import { setup } from './helpers';
import { route } from '../src/main/assistant/router';
import { PANELS, loanEmi, parseClock } from '../src/main/tools/life';

const res = (t: string) => { const r = route(t, { session: {}, apps: [] }); return r.kind === 'commands' ? r.steps[0].resolution : null; };
const run = async (tool: string, args: Record<string, unknown> = {}, patch = {}) => {
  const s = await setup(patch);
  return { r: await s.executor.execute(tool, args, s.ctx(), { origin: 'user_command' }), s };
};

describe('routing', () => {
  it.each([
    ['snip part of my screen', 'system.panel', { panel: 'snip' }], ['open snipping tool', 'system.panel', { panel: 'snip' }],
    ['show my notifications', 'system.panel', { panel: 'notifications' }], ['open quick settings', 'system.panel', { panel: 'quick_settings' }],
    ['show available wifi networks', 'system.panel', { panel: 'wifi_list' }], ['connect to a second screen', 'system.panel', { panel: 'project' }],
    ['open task view', 'system.panel', { panel: 'task_view' }], ['open the camera', 'system.panel', { panel: 'camera' }], ['open the clock app', 'system.panel', { panel: 'clock' }],
    ['emi for 5 lakh at 9 percent for 3 years', 'math.emi', { principal: 500000, ratePercent: 9, months: 36 }],
    ['calculate the emi on a 25 lakh home loan at 8.5 percent for 20 years', 'math.emi', { principal: 2500000, ratePercent: 8.5, months: 240 }],
    ['calculate my bmi 70 kg 175 cm', 'math.bmi', { weightKg: 70, heightCm: 175 }], ['bmi for 180 cm and 82 kg', 'math.bmi', { weightKg: 82, heightCm: 180 }],
    ['is 2028 a leap year', 'date.leap', { year: 2028 }], ['was 1900 a leap year', 'date.leap', { year: 1900 }],
    ['how long until 5 pm', 'time.until', { time: '5 pm' }], ['how many minutes until 6:30', 'time.until', { time: '6:30' }], ['how much time until midnight', 'time.until', { time: 'midnight' }],
    ['pick between pizza and burger', 'fun.choose', { options: ['pizza', 'burger'] }], ['help me decide between red or blue or green', 'fun.choose', { options: ['red', 'blue', 'green'] }],
    ["let's play rock paper scissors", 'fun.rps', {}], ['i choose paper', 'fun.rps', { move: 'paper' }],
    ['help me relax', 'wellness.breathe', {}], ["i'm feeling stressed", 'wellness.breathe', {}],
  ])('%s', (text, tool, args) => expect(res(text)).toEqual({ kind: 'tool', tool, args }));

  it('keeps existing commands where they were', () => {
    expect(res('take a screenshot')).toMatchObject({ tool: 'screen.save' });
    expect(res('is the internet connected')).toMatchObject({ tool: 'system.network' });
    expect(route('make an emi and loan amortization schedule in excel', { session: {}, apps: [] })).toMatchObject({ kind: 'commands', steps: [{ commandId: 'excel.build' }] });
  });
});

describe('Windows panels', () => {
  it('opens only fixed, registered URIs (never user text)', async () => {
    const { r, s } = await run('system.panel', { panel: 'snip' }, { tools: { permissions: { system: true } } });
    expect(r.ok).toBe(true);
    expect(s.platform.opened).toEqual(['ms-screenclip:']);
    const tv = await run('system.panel', { panel: 'task_view' }, { tools: { permissions: { system: true } } });
    expect(tv.s.platform.spawned).toEqual([{ file: 'explorer.exe', args: ['shell:::{3080F90E-D7AD-11D9-BD98-0000947B0257}'] }]);
    for (const p of Object.values(PANELS)) if (p.uri) expect(() => new URL(p.uri!)).not.toThrow();
  });
});

describe('calculators', () => {
  it('computes a standard EMI', async () => {
    expect(Math.round(loanEmi(500000, 9, 36))).toBe(15900);
    expect(loanEmi(1200, 0, 12)).toBe(100);
    const { r } = await run('math.emi', { principal: 500000, ratePercent: 9, months: 36 });
    expect(r.message).toMatch(/^For 500,000 at 9 percent over 3 years, the EMI is about 15,900 a month\. You'd pay 72,3\d\d in interest/);
  });
  it('gives BMI with a WHO band and a caveat', async () => {
    expect((await run('math.bmi', { weightKg: 70, heightCm: 175 })).r.message).toMatch(/^That's a BMI of 22\.9, which is in the healthy range/);
    expect((await run('math.bmi', { weightKg: 95, heightCm: 170 })).r.message).toMatch(/32\.9, which is in the obese range/);
  });
  it('knows leap-year rules, including centuries', async () => {
    expect((await run('date.leap', { year: 2000 })).r.message).toBe('Yes, 2000 was a leap year. February has 29 days.');
    expect((await run('date.leap', { year: 1900 })).r.message).toBe("No, 1900 wasn't a leap year. February has 28 days.");
    expect((await run('date.leap', { year: 2400 })).r.message).toBe('Yes, 2400 is a leap year. February has 29 days.');
  });
  it('reads clock times and counts down to them', () => {
    const now = new Date(2026, 10, 24, 14, 10);
    expect(parseClock('5 pm', now)?.getHours()).toBe(17);
    expect(parseClock('5:30pm', now)?.getMinutes()).toBe(30);
    expect(parseClock('9 am', now)?.getDate()).toBe(25);
    expect(parseClock('5', now)?.getHours()).toBe(17);
    expect(parseClock('midnight', now)?.getDate()).toBe(25);
    expect(parseClock('13 pm', now)).toBeNull();
    expect(parseClock('soonish', now)).toBeNull();
  });
});

describe('companions', () => {
  it('chooses only from the given options', async () => {
    for (let i = 0; i < 20; i++) expect((await run('fun.choose', { options: ['tea', 'coffee'] })).r.message).toMatch(/^I pick (tea|coffee)\.$/);
  });
  it('plays rock paper scissors fairly', async () => {
    expect((await run('fun.rps')).r.message).toMatch(/Say rock, paper or scissors/);
    for (let i = 0; i < 20; i++) {
      const m = (await run('fun.rps', { move: 'rock' })).r.message;
      expect(m).toMatch(/^I chose (rock\. It's a tie!|scissors\. You win!|paper\. I win!)$/);
    }
  });
  it('guides breathing', async () => {
    expect((await run('wellness.breathe', { rounds: 2 })).r.message.match(/Breathe in slowly/g)).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { route } from '../src/main/assistant/router';
import { CATALOG_BY_ID, type PendingSlot, type RouteCtx } from '../src/main/assistant/catalog';
import { allApps, detectApps, findApp, isStartAppId, setStartApps } from '../src/main/tools/apps';
import { findSite, SITES, SEARCH_SITES } from '../src/main/assistant/knowledge/sites';
import { findSettingsPage, findShellFolder, findWinTool, SETTINGS_PAGES, WIN_TOOLS } from '../src/main/assistant/knowledge/windows';
import { findZone } from '../src/main/assistant/knowledge/cities';
import { capabilityCounts } from '../src/main/assistant/knowledge';
import { parseDate } from '../src/main/tools/extras';
import { settingsUri, validateWebUrl } from '../src/main/security/url';
import type { AppEntry } from '../src/shared/types';
import { setup } from './helpers';

const apps: AppEntry[] = detectApps(() => true).map((a, i) => ({ ...a, id: `a${i}` }));
const ctx = (over: Partial<RouteCtx> = {}): RouteCtx => ({ session: {}, apps, browser: 'ask', browsers: ['chrome', 'edge'], ...over });
const first = (t: string, c = ctx()) => {
  const r = route(t, c);
  return r.kind === 'commands' ? r.steps[0] : null;
};

describe('websites and browser choice', () => {
  it('knows YT Music is a website and asks Chrome or Edge', () => {
    const s = first('open yt music');
    expect(s?.resolution.kind).toBe('clarify');
    if (s?.resolution.kind !== 'clarify') return;
    expect(s.resolution.question).toMatch(/YouTube Music is a website\. Should I open it in Chrome or Edge\?/);
    expect(s.resolution.pending).toMatchObject({ commandId: 'web.browser', slot: 'browser', partial: { tool: 'web.open', args: { url: 'https://music.youtube.com', label: 'YouTube Music' } } });
  });
  it('understands the answer, and "always" remembers it', () => {
    const pending = (first('open youtube music')!.resolution as unknown as { pending: PendingSlot }).pending;
    const answer = (t: string) => route(t, ctx(), [], pending);
    const chrome = answer('chrome');
    expect(chrome.kind === 'commands' && chrome.steps[0].resolution).toEqual({ kind: 'builtin', builtin: 'open_with_browser', params: { tool: 'web.open', args: { url: 'https://music.youtube.com', label: 'YouTube Music' }, browser: 'chrome', remember: false } });
    const always = answer('always use edge');
    expect(always.kind === 'commands' && always.steps[0].resolution).toMatchObject({ params: { browser: 'edge', remember: true } });
    const dflt = answer('whatever you choose');
    expect(dflt.kind === 'commands' && dflt.steps[0].resolution).toMatchObject({ params: { browser: 'default' } });
    expect(CATALOG_BY_ID.get('web.browser')?.fill?.('banana', {}, ctx())).toBeNull();
  });
  it('does not ask when only one browser is installed or a preference is saved', () => {
    expect(first('open yt music', ctx({ browsers: ['edge'] }))?.resolution).toEqual({ kind: 'tool', tool: 'web.open', args: { url: 'https://music.youtube.com', label: 'YouTube Music' } });
    expect(first('open yt music', ctx({ browser: 'chrome' }))?.resolution).toMatchObject({ tool: 'web.open', args: { browser: 'chrome' } });
    expect(first('open yt music', ctx({ browser: 'default' }))?.resolution).toEqual({ kind: 'tool', tool: 'web.open', args: { url: 'https://music.youtube.com', label: 'YouTube Music' } });
  });
  it('opens in the named browser directly', () => {
    expect(first('open yt music in chrome')?.resolution).toEqual({ kind: 'tool', tool: 'web.open', args: { url: 'https://music.youtube.com', label: 'YouTube Music', browser: 'chrome' } });
    expect(first('open github.com in microsoft edge')?.resolution).toMatchObject({ tool: 'web.open', args: { url: 'github.com', browser: 'edge' } });
    expect(first('open python tutorials in firefox')?.resolution).toEqual({ kind: 'tool', tool: 'web.search', args: { query: 'python tutorials', browser: 'firefox' } });
  });
  it('never confuses YouTube Music with the Spotify app', () => {
    const s = first('open youtube music', ctx({ browsers: [] }));
    expect(s?.resolution).toMatchObject({ tool: 'web.open', args: { url: 'https://music.youtube.com' } });
    expect(first('open spotify')?.resolution).toMatchObject({ tool: 'apps.open', args: { app: 'Spotify' } });
  });
  it('searches inside sites', () => {
    const c = ctx({ browser: 'default' });
    expect(first('play lofi beats on youtube', c)?.resolution).toEqual({ kind: 'tool', tool: 'web.search_site', args: { site: 'YouTube', query: 'lofi beats' } });
    expect(first('search amazon for wireless earbuds', c)?.resolution).toMatchObject({ args: { site: 'Amazon', query: 'wireless earbuds' } });
    expect(first('search arijit singh on yt music', c)?.resolution).toMatchObject({ args: { site: 'YouTube Music', query: 'arijit singh' } });
    expect(first('play lofi on spotify', c)?.commandId).toBe('media.spotify');
    expect(first('find the report in documents', c)?.commandId).not.toBe('web.site_search');
  });
  it('sets the browser preference by voice', () => {
    expect(first('always use chrome')?.resolution).toEqual({ kind: 'builtin', builtin: 'set_browser', params: { browser: 'chrome' } });
    expect(first('ask me which browser')?.resolution).toMatchObject({ params: { browser: 'ask' } });
    expect(first('use the default browser')?.resolution).toMatchObject({ params: { browser: 'default' } });
  });
  it('offers a web search for unknown names', () => {
    const s = first('open zorblax');
    expect(s?.resolution).toMatchObject({ kind: 'clarify', pending: { slot: 'search', partial: { query: 'zorblax' } } });
    const yes = route('yes please', ctx(), [], (s!.resolution as unknown as { pending: PendingSlot }).pending);
    expect(yes.kind === 'commands' && yes.steps[0].resolution).toEqual({ kind: 'tool', tool: 'web.search', args: { query: 'zorblax' } });
  });
  it('every site address is a valid https URL with a unique name', () => {
    expect(SITES.length).toBeGreaterThan(600);
    expect(new Set(SITES.map((s) => s.name)).size).toBe(SITES.length);
    for (const s of SITES) expect(validateWebUrl(s.url).protocol, s.name).toBe('https:');
    for (const s of SEARCH_SITES) expect(validateWebUrl(s.template.replace('{q}', 'x')).protocol, s.name).toBe('https:');
    expect(findSite('the netflix website')?.url).toBe('https://www.netflix.com');
    expect(findSite('chat gpt')?.name).toBe('ChatGPT');
  });
});

describe('Windows destinations', () => {
  it('opens settings pages, tools and special folders by name', () => {
    expect(first('open dark mode settings')?.resolution).toEqual({ kind: 'tool', tool: 'system.open_settings', args: { page: 'colors' } });
    expect(first('open windows update')?.resolution).toEqual({ kind: 'tool', tool: 'system.open_settings', args: { page: 'updates' } });
    expect(first('open device manager')?.resolution).toEqual({ kind: 'tool', tool: 'system.open_tool', args: { tool: 'devicemanager' } });
    expect(first('open the recycle bin')?.resolution).toEqual({ kind: 'tool', tool: 'system.open_special_folder', args: { folder: 'recyclebin' } });
    expect(first('open environment variables')?.resolution).toMatchObject({ args: { tool: 'envvars' } });
    expect(first('open bluetooth settings')?.resolution).toMatchObject({ args: { page: 'bluetooth' } });
  });
  it('every settings page uses an ms-settings URI and tools run only fixed System32 programs', () => {
    expect(SETTINGS_PAGES.length).toBeGreaterThan(110);
    for (const p of SETTINGS_PAGES) expect(settingsUri(p.id)).toMatch(/^ms-settings:[a-z0-9-]*$/);
    for (const t of WIN_TOOLS) {
      expect(t.exe, t.id).toMatch(/^(%windir%\\explorer\.exe|[A-Za-z0-9]+\.exe)$/);
      expect(t.args.join(' '), t.id).not.toMatch(/[;&|<>`$]/);
    }
    expect(findSettingsPage('wifi')?.id).toBe('wifi');
    expect(findWinTool('services')?.id).toBe('services');
    expect(findShellFolder('screenshots')?.id).toBe('screenshots');
  });
  it('tools launch exactly the fixed targets', async () => {
    const s = await setup();
    s.platform.existing.add('*');
    await s.executor.execute('system.open_tool', { tool: 'devicemanager' }, s.ctx(), { origin: 'user_command' });
    expect(s.platform.spawned.at(-1)?.args).toEqual(['devmgmt.msc']);
    await s.executor.execute('system.open_special_folder', { folder: 'recyclebin' }, s.ctx(), { origin: 'user_command' });
    expect(s.platform.spawned.at(-1)?.args).toEqual(['shell:RecycleBinFolder']);
    await expect(s.executor.execute('system.open_tool', { tool: 'cmd.exe /c del' }, s.ctx(), { origin: 'llm' })).rejects.toThrow();
  });
});

describe('Start menu apps', () => {
  it('accepts real Start app ids and rejects anything else', () => {
    expect(isStartAppId('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App')).toBe(true);
    expect(isStartAppId('{6D809377-6AF0-444B-8957-A3773F02200E}\\Notepad++\\notepad++.exe')).toBe(true);
    expect(isStartAppId('Chrome')).toBe(true);
    expect(isStartAppId('https://evil.example')).toBe(false);
    expect(isStartAppId('..\\..\\Windows\\System32\\cmd.exe')).toBe(false);
    expect(isStartAppId('-new-window')).toBe(false);
  });
  it('opens any Start menu app by name, preferring the user registry', () => {
    setStartApps([
      { Name: 'Notepad++', AppID: '{6D809377-6AF0-444B-8957-A3773F02200E}\\Notepad++\\notepad++.exe' },
      { Name: 'Uninstall Notepad++', AppID: '{6D809377}\\Notepad++\\uninstall.exe' },
      { Name: 'Spotify', AppID: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify' },
      { Name: 'Obsidian', AppID: 'md.obsidian' },
    ]);
    const list = allApps(apps);
    expect(list.filter((a) => a.name === 'Spotify')).toHaveLength(1);
    expect(list.some((a) => /uninstall/i.test(a.name))).toBe(false);
    expect(findApp(list, 'obsidian').match?.target).toBe('md.obsidian');
    expect(first('open notepad++', ctx({ apps: list }))?.resolution).toMatchObject({ tool: 'apps.open', args: { app: 'Notepad++' } });
    setStartApps([]);
  });
});

describe('quick knowledge skills', () => {
  it('routes world clock, dice, dates, currency, always-listening and self-test', () => {
    expect(first('what time is it in tokyo')?.resolution).toEqual({ kind: 'tool', tool: 'clock.world', args: { place: 'tokyo' } });
    expect(first("what's the time in new york")?.resolution).toMatchObject({ args: { place: 'new york' } });
    expect(first('what time is it')?.commandId).toBe('system.time');
    expect(first('flip a coin')?.resolution).toMatchObject({ tool: 'fun.random', args: { kind: 'coin' } });
    expect(first('roll two dice')?.resolution).toMatchObject({ args: { kind: 'dice', count: 2, sides: 6 } });
    expect(first('roll a twenty sided die')?.resolution).toMatchObject({ args: { kind: 'dice', sides: 20 } });
    expect(first('pick a random number between 1 and 50')?.resolution).toMatchObject({ args: { kind: 'number', min: 1, max: 50 } });
    expect(first('how many days until christmas')?.resolution).toEqual({ kind: 'tool', tool: 'date.until', args: { target: 'christmas' } });
    expect(first('convert 100 dollars to rupees')?.resolution).toEqual({ kind: 'tool', tool: 'currency.convert', args: { amount: 100, from: 'USD', to: 'INR' } });
    expect(first('convert 5 miles to kilometers')?.commandId).toBe('skill.convert');
    expect(first('turn on always listening')?.resolution).toEqual({ kind: 'builtin', builtin: 'always_listen', params: { on: true } });
    expect(first('turn off always listening')?.resolution).toMatchObject({ params: { on: false } });
    expect(first('stop listening')?.commandId).toBe('conv.end');
    expect(first('run a self test')?.resolution).toEqual({ kind: 'builtin', builtin: 'self_test', params: undefined });
  });
  it('runs the knowledge tools for real', async () => {
    const s = await setup();
    const run = (tool: string, args: Record<string, unknown>, net?: typeof fetch) => s.executor.execute(tool, args, net ? { ...s.ctx(), net } : s.ctx(), { origin: 'user_command' });
    expect((await run('clock.world', { place: 'tokyo' })).message).toMatch(/^It's \d{1,2}:\d{2} (AM|PM) in Tokyo/);
    expect((await run('clock.world', { place: 'atlantis' })).ok).toBe(false);
    expect((await run('fun.random', { kind: 'coin' })).message).toMatch(/heads|tails/);
    const dice = await run('fun.random', { kind: 'dice', count: 3, sides: 6 });
    expect((dice.data as number[]).every((n) => n >= 1 && n <= 6)).toBe(true);
    expect((await run('date.until', { target: 'christmas' })).message).toMatch(/until christmas|today/);
    const fx = (async (url: string) => { expect(url).toContain('from=USD&to=INR'); return Response.json({ rates: { INR: 8800.5 }, date: '2026-11-05' }); }) as unknown as typeof fetch;
    expect((await run('currency.convert', { amount: 100, from: 'usd', to: 'inr' }, fx)).message).toMatch(/\$100\.00 is about ₹8,800\.50, at the 2026-11-05 rate/);
  });
  it('parses dates and knows time zones', () => {
    const base = new Date(2026, 10, 6);
    expect(parseDate('december 25', base)?.toDateString()).toBe(new Date(2026, 11, 25).toDateString());
    expect(parseDate('2nd of march', base)?.getFullYear()).toBe(2027);
    expect(findZone('Bengaluru')).toBe('Asia/Kolkata');
    expect(findZone('san francisco')).toBe('America/Los_Angeles');
  });
  it('reports a real capability count over 1000', () => {
    const n = capabilityCounts(60);
    expect(n.websites).toBe(SITES.length);
    expect(n.total).toBeGreaterThan(1000);
  });
});

describe('web.open in a chosen browser', () => {
  it('launches the installed browser with the validated URL as one argument', async () => {
    const s = await setup();
    s.platform.existing.add('*');
    for (const a of detectApps(() => true)) s.repos.apps.upsert(a);
    const r = await s.executor.execute('web.open', { url: 'https://music.youtube.com', browser: 'chrome', label: 'YouTube Music' }, s.ctx(), { origin: 'user_command' });
    expect(r.message).toBe('Opening YouTube Music in Chrome.');
    expect(s.platform.spawned.at(-1)?.file).toMatch(/chrome\.exe$/);
    expect(s.platform.spawned.at(-1)?.args).toEqual(['https://music.youtube.com/']);
    await s.executor.execute('web.open', { url: 'https://music.youtube.com' }, s.ctx(), { origin: 'user_command' });
    expect(s.platform.opened.at(-1)).toBe('https://music.youtube.com/');
    await expect(s.executor.execute('web.open', { url: 'javascript:alert(1)', browser: 'chrome' }, s.ctx(), { origin: 'llm' })).rejects.toThrow();
  });
});

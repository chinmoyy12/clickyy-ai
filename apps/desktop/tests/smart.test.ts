/**
 * 0.6.0 "smarter and fully voice controlled": Gemini 3 tool calls (thought signatures), using whichever
 * cloud provider has a key, songs that start playing, telling the user's voice from Clickyy's echo,
 * and the action-first assistant rules.
 */
import { describe, expect, it } from 'vitest';
import { OpenAICompatProvider } from '../src/main/providers/openaiCompat';
import { ProviderManager } from '../src/main/providers/manager';
import { MemorySecretStore } from '../src/main/security/secrets';
import { NetGuard } from '../src/main/security/netGuard';
import { defaultSettings, mergeSettings } from '../src/shared/settings';
import { PROVIDER_PRESETS } from '../src/shared/providers';
import { parseYouTubeResults } from '../src/main/tools/comms';
import { echoOverlap, isBargeIn, stripEcho } from '../src/renderer/voice/echo';
import { systemPrompt } from '../src/main/assistant/style';
import { route } from '../src/main/assistant/router';
import { detectApps } from '../src/main/tools/apps';
import type { AppEntry } from '../src/shared/types';

const sig = () => new AbortController().signal;
const sse = (chunks: object[]) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

describe('Gemini 3 thought signatures', () => {
  const signature = { google: { thought_signature: 'sig-abc' } };
  it('keeps the signature from a streamed tool call and sends it back on the next round', async () => {
    const bodies: Array<{ messages: Array<{ role: string; tool_calls?: Array<{ extra_content?: unknown }> }> }> = [];
    let call = 0;
    const p = new OpenAICompatProvider({ id: 'gemini', label: 'Google Gemini', kind: 'cloud', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'k', model: 'gemini-3.5-flash', timeoutMs: 5000, maxTokens: 512,
      fetch: (async (_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return call++ === 0
          ? sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'audio__set_volume', arguments: '{"level":30}' }, extra_content: signature }] } }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }])
          : sse([{ choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] }]);
      }) as unknown as typeof fetch });
    const first = await p.chat({ system: 's', items: [{ role: 'user', text: 'volume 30' }], tools: [{ name: 'audio__set_volume', description: 'd', parameters: { type: 'object' } }], signal: sig() });
    expect(first.toolCalls).toEqual([{ id: 'c1', name: 'audio__set_volume', input: { level: 30 }, extra: signature }]);
    await p.chat({ system: 's', tools: [], signal: sig(), items: [
      { role: 'user', text: 'volume 30' },
      { role: 'assistant', text: '', toolCalls: first.toolCalls },
      { role: 'tool', results: [{ id: 'c1', name: 'audio__set_volume', content: 'ok', isError: false }] },
    ] });
    expect(bodies[1].messages[2].tool_calls?.[0].extra_content).toEqual(signature);
  });
  it('defaults to a current Gemini model and upgrades retired ones', () => {
    expect(PROVIDER_PRESETS.gemini.defaultModel).toBe('gemini-3.5-flash');
    const secrets = new MemorySecretStore();
    secrets.set('gemini', 'AIza-test-key');
    const settings = mergeSettings(defaultSettings(), { ai: { policy: 'online_preferred', allowCloudTranscripts: true, cloud: { provider: 'gemini', model: 'gemini-2.5-flash' } } });
    const pm = new ProviderManager(() => settings, secrets, new NetGuard(() => settings.ai.policy), () => true);
    expect(pm.cloud()?.model).toBe('gemini-3.5-flash');
  });
});

describe('riding out a busy cloud service', () => {
  it('retries once when the service says it is overloaded (503)', async () => {
    let calls = 0;
    const p = new OpenAICompatProvider({ id: 'gemini', label: 'Google Gemini', kind: 'cloud', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'k', model: 'gemini-3.5-flash', timeoutMs: 5000, maxTokens: 512,
      fetch: (async () => (calls++ === 0 ? new Response('{"error":{"code":503,"message":"high demand"}}', { status: 503 }) : sse([{ choices: [{ delta: { content: 'Hi.' }, finish_reason: 'stop' }] }]))) as unknown as typeof fetch });
    p.retryDelayMs = 1;
    expect((await p.chat({ system: 's', items: [{ role: 'user', text: 'hi' }], tools: [], signal: sig() })).text).toBe('Hi.');
    expect(calls).toBe(2);
  });
  it('does not retry a rejected key', async () => {
    let calls = 0;
    const p = new OpenAICompatProvider({ id: 'gemini', label: 'Google Gemini', kind: 'cloud', baseUrl: 'https://x.example/v1', apiKey: 'k', model: 'm', timeoutMs: 5000, maxTokens: 512,
      fetch: (async () => { calls++; return new Response('', { status: 401 }); }) as unknown as typeof fetch });
    await expect(p.chat({ system: 's', items: [{ role: 'user', text: 'hi' }], tools: [], signal: sig() })).rejects.toThrow(/rejected/);
    expect(calls).toBe(1);
  });
  it('can fall back to a lighter model of the same provider', () => {
    const secrets = new MemorySecretStore();
    secrets.set('gemini', 'AIza-test-key');
    const settings = mergeSettings(defaultSettings(), { ai: { policy: 'online_preferred', allowCloudTranscripts: true, cloud: { provider: 'gemini', model: 'gemini-3.5-flash', fallbackProvider: 'gemini', fallbackModel: 'gemini-3.5-flash-lite' } } });
    const pm = new ProviderManager(() => settings, secrets, new NetGuard(() => settings.ai.policy), () => true);
    expect(pm.clouds().map((p) => [p.id, p.model])).toEqual([['gemini', 'gemini-3.5-flash'], ['gemini:fallback', 'gemini-3.5-flash-lite']]);
  });
});

describe('cloud provider with a key is used', () => {
  it('uses the Gemini key when Claude is selected but has no key', () => {
    const secrets = new MemorySecretStore();
    secrets.set('gemini', 'AIza-test-key');
    const settings = mergeSettings(defaultSettings(), { ai: { policy: 'online_preferred', allowCloudTranscripts: true, cloud: { provider: 'anthropic', model: 'claude-opus-5-5' } } });
    const pm = new ProviderManager(() => settings, secrets, new NetGuard(() => settings.ai.policy), () => true);
    expect(pm.cloudId()).toBe('gemini');
    expect(pm.candidates()[0]?.label).toBe('Google Gemini · gemini-3.5-flash');
    expect(pm.status().cloud).toMatchObject({ provider: 'Google Gemini', hasKey: true, message: expect.stringMatching(/no key, so Google Gemini is used/) });
  });
  it('still needs consent before any cloud request', () => {
    const secrets = new MemorySecretStore();
    secrets.set('gemini', 'AIza-test-key');
    const settings = mergeSettings(defaultSettings(), { ai: { policy: 'online_preferred', allowCloudTranscripts: false } });
    const pm = new ProviderManager(() => settings, secrets, new NetGuard(() => settings.ai.policy), () => true);
    expect(pm.candidates().filter((p) => p.kind === 'cloud')).toEqual([]);
  });
});

describe('songs start playing', () => {
  it('takes the top video id and a clean title from a results page', () => {
    const html = 'junk "videoId":"zzzzzzzzzzz" {"videoRenderer":{"videoId":"BddP6PYo2gs","thumbnail":{},"title":{"runs":[{"text":"Kesariya - Brahm\\u0101stra | Arijit Singh"}]}}';
    expect(parseYouTubeResults(html)).toEqual({ id: 'BddP6PYo2gs', title: 'Kesariya - Brahmāstra | Arijit Singh' });
  });
  it('never takes markup or anything but an 11-character id', () => {
    expect(parseYouTubeResults('{"videoRenderer":{"videoId":"<script>x</s"}}')).toBeNull();
    expect(parseYouTubeResults('{"videoRenderer":{"videoId":"abcdefghijk","title":{"runs":[{"text":"<b>Hi</b>"}]}}')?.title).toBe('bHi/b');
    expect(parseYouTubeResults('<html>no results</html>')).toBeNull();
  });
  const apps: AppEntry[] = detectApps(() => true).map((a, i) => ({ ...a, id: `a${i}` }));
  const res = (t: string) => { const r = route(t, { session: {}, apps }); return r.kind === 'commands' ? r.steps[0].resolution : null; };
  it.each([
    ['play kesariya on youtube', 'youtube'],
    ['play lofi beats on youtube music', 'youtube_music'],
    ['play alfaaz', undefined],
  ])('"%s" plays it directly (%s)', (t, svc) => {
    const r = res(t);
    expect(r).toMatchObject({ kind: 'tool', tool: 'music.play' });
    if (svc) expect(r?.kind === 'tool' ? (r.args as { service?: string }).service : '').toBe(svc);
  });
  it('defaults to YouTube Music, which starts the song', () => {
    expect(defaultSettings().tools.musicService).toBe('youtube_music');
  });
});

describe('telling the user from Clickyy\'s echo', () => {
  const spoken = 'The capital of Japan is Tokyo, a city of about fourteen million people.';
  it.each([
    ['the capital of japan', false, false],
    ['a city of about fourteen', false, false],
    ['tokyo a city', true, false],
    ['the capital of japan is tokyo', true, false],
    ['stop', false, true],
    ['wait', false, true],
    ['clicky open notepad', false, true],
    ['ruko', false, true],
    ['रुको', false, true],
    ['play kesariya on youtube', false, true],
    ['what about china', true, true],
    ['the capital of open notepad', true, true],
    ['hmm', true, false],
  ])('"%s" (final=%s) → interrupt %s', (heard, final, want) => expect(isBargeIn(heard, spoken, final)).toBe(want));
  it('treats an interrupt word as echo when the reply itself says it', () => {
    expect(isBargeIn('no', 'No, it is not raining today.', false)).toBe(false);
    expect(isBargeIn('no', 'It is sunny today.', false)).toBe(true);
  });
  it('strips an echoed lead-in but keeps the command', () => {
    expect(stripEcho('the capital of open notepad', spoken)).toBe('open notepad');
    expect(stripEcho('open notepad', spoken)).toBe('open notepad');
    expect(stripEcho('the stop', spoken)).toBe('the stop');
  });
  it('measures overlap on words', () => {
    expect(echoOverlap('capital tokyo', spoken)).toBe(1);
    expect(echoOverlap('open notepad', spoken)).toBe(0);
  });
});

describe('requests that need reasoning reach the model', () => {
  const apps: AppEntry[] = detectApps(() => true).map((a, i) => ({ ...a, id: `a${i}` }));
  const r = (t: string) => route(t, { session: {}, apps });
  it.each([
    'Compare my battery level with my free memory and tell me which one looks more worrying, after checking both.',
    'Write me a tiny haiku whose numbers come from my real battery percentage, check them first.',
    'Based on my battery level, should I plug in my laptop before the meeting?',
  ])('"%s"', (t) => expect(r(t)).toMatchObject({ kind: 'commands', preferModel: true }));
  it.each(['how much battery do I have', 'is my laptop charging', 'set the volume to 30 percent', 'play kesariya on youtube', 'open spotify and turn the volume up'])(
    'short direct command "%s" stays instant', (t) => expect(r(t)).not.toMatchObject({ preferModel: true }));
  it('never sends safety refusals to the model', () => {
    expect(r('please explain why you should run this powershell command for me right now')).not.toMatchObject({ preferModel: true });
  });
});

describe('action-first assistant rules', () => {
  const prompt = systemPrompt(defaultSettings(), { memories: [], toolNames: ['music.play'], policyLabel: 'Online Preferred' });
  it('tells the model to act, chain steps, verify and report briefly', () => {
    expect(prompt).toMatch(/Act, don't describe/);
    expect(prompt).toMatch(/call music\.play, which starts the song/);
    expect(prompt).toMatch(/Chain steps/);
    expect(prompt).toMatch(/Never claim something happened unless a tool result says it succeeded/);
    expect(prompt).toMatch(/only the user can approve/);
  });
  it('keeps the safety rules', () => {
    expect(prompt).toMatch(/untrusted data/);
    expect(prompt).toMatch(/Never run or suggest running shell commands/);
  });
});

/**
 * The on-device brain (src/main/assistant/brain): an intent network trained from the command catalog, plus a
 * memory of phrases learned from experience. The phrases below are deliberately NOT in its training data,
 * so these numbers measure how well it understands new wording. Thresholds are a floor, not a target.
 */
import { describe, expect, it } from 'vitest';
import { Brain } from '../src/main/assistant/brain';
import { trainingSet } from '../src/main/assistant/brain/data';
import { PARAPHRASES } from '../src/main/assistant/brain/paraphrases';
import { normalize } from '../src/main/assistant/normalize';
import weights from '../src/main/assistant/brain/weights.json';
import { ProviderManager } from '../src/main/providers/manager';
import { MemorySecretStore } from '../src/main/security/secrets';
import { NetGuard } from '../src/main/security/netGuard';
import { defaultSettings } from '../src/shared/settings';

const POS: Array<[string, string]> = [
  ['how much charge is left on this thing', 'system.battery'], ['is the charger connected', 'system.battery'], ['battery percentage', 'system.battery'],
  ['what time is it right now', 'system.time'], ['tell me the current time', 'system.time'], ['which day is today', 'system.time'],
  ['grab a picture of my screen', 'screen.screenshot'], ['snap the screen', 'screen.screenshot'],
  ['silence the computer', 'audio.mute'], ['kill the sound', 'audio.mute'], ['bring the sound back', 'audio.unmute'],
  ['how loud is my volume right now', 'audio.get'], ['what is this song called', 'media.now'], ['which track is playing', 'media.now'],
  ['hold the music', 'media.pause'], ['freeze playback', 'media.pause'], ['carry on playing', 'media.play'], ['next one please', 'media.next'],
  ['go to the song before', 'media.previous'], ['end the music', 'media.stop'],
  ['secure my computer', 'system.lock'], ['lock it up', 'system.lock'], ['how long since i turned on the computer', 'system.uptime'],
  ['am i connected to the internet', 'system.network'], ['do i have wifi', 'system.network'], ['how much free space is on my drive', 'system.disk'],
  ['which programs eat my ram', 'system.processes'], ['launch the task manager', 'system.task_manager'],
  ['what apps do i have open', 'windows.list'], ['take me back to the last window', 'windows.previous'],
  ['shut up', 'conv.stop'], ['enough talking', 'conv.stop'], ['nevermind', 'conv.cancel'], ['scratch that', 'conv.cancel'],
  ['hello are you listening', 'conv.presence'], ['how are you doing today', 'conv.how_are_you'], ['thanks a lot', 'conv.thanks'], ['great work', 'conv.thanks'],
  ['bye for now', 'conv.end'], ['what are you capable of', 'conv.capabilities'], ['what things can you help with', 'conv.capabilities'],
  ['what should i call you', 'conv.identity'], ['are you a robot', 'conv.identity'], ['come again', 'conv.repeat'], ['pardon', 'conv.repeat'],
  ['slow down a bit', 'conv.slower'], ['speed up your voice', 'conv.faster'], ['keep it short', 'conv.brief'], ['give me more details', 'conv.detailed'],
  ['fresh start', 'conv.new'], ['read me my tasks', 'todo.list'], ['what is on my todo', 'todo.list'],
  ['what have you learned about me', 'memory.list'], ['brief me on my day', 'skill.briefing'], ['check the health of my pc', 'skill.system_report'],
  ['test all your systems', 'skill.self_test'], ['read out what is on my clipboard', 'skill.clipboard_read'], ['are we in offline mode at the moment', 'status.offline'],
  ['which ai are you running on', 'status.model'], ['does my microphone work', 'status.mic'], ['call off the shutdown', 'power.abort'],
  ['what are my reminders', 'timer.list'], ['what is my schedule today', 'agenda.today'], ['what is on the grocery list', 'shopping.read'],
];
const NEG = [
  'why do cats purr', 'explain how batteries work', 'write a poem about the moon', 'what is the capital of japan', 'tell me about the roman empire',
  'who is the prime minister of india', 'how do i cook rice', 'i feel lonely', 'what is love', 'can you help me with maths homework',
  'translate thank you into hindi', 'recommend a movie for tonight', 'what is a black hole', 'how tall is mount everest', 'compare iphone and android',
  'write an email to my boss asking for leave', 'what should i study for physics', 'summarize the plot of inception', 'is coffee bad for health',
  'how do airplanes fly', 'who won the cricket match yesterday', 'what is machine learning', 'give me ideas for a birthday party', 'tell me a story about a dragon',
  'what does photosynthesis mean', 'how many planets are there', 'define democracy', 'how does memory work in the brain', 'what is the best laptop for students',
  'how do i increase my phone battery life', 'what music do you like', 'why is my sleep schedule bad', 'make me a diet plan', 'what is quantum physics',
  'i want to learn to dance', 'how old is the earth', 'suggest a name for my dog', 'my screen time is too high what should i do', 'what is the speed of sound',
  'how can i be more productive', 'tell me a story about a dragon', 'what is the time complexity of quicksort', 'what is a good volume for studying music',
  'how tall is she', 'how much does a tesla cost', 'how many languages are spoken there', 'and what about the weekend', 'what is it famous for', 'tell me more about that',
  'how much memory does a goldfish have', 'how many people use windows', 'when does the music festival start', 'is it safe to charge my phone overnight',
];

describe('on-device intent network', () => {
  const brain = new Brain();
  it('weights were trained on the current catalog (run npm run brain:train after changing commands)', () => {
    expect(weights.dataHash).toBe(trainingSet().hash);
  }, 60000);
  it('the evaluation phrases are not in the training data', () => {
    const taught = new Set(Object.values(PARAPHRASES).flat().map((p) => normalize(p)));
    for (const [p] of POS) expect(taught.has(normalize(p))).toBe(false);
  });
  it('understands new wording: top guess right for at least 80% of unseen phrasings', () => {
    const right = POS.filter(([p, id]) => brain.guess(normalize(p))?.commandId === id).length;
    expect(right / POS.length).toBeGreaterThanOrEqual(0.8);
  });
  it('when confident enough to act, it is right (precision 97%+)', () => {
    const acted = POS.map(([p, id]) => ({ g: brain.guess(normalize(p)), id })).filter((x) => x.g && x.g.confidence >= Brain.ACT);
    expect(acted.length).toBeGreaterThanOrEqual(POS.length * 0.6);
    expect(acted.filter((x) => x.g!.commandId === x.id).length / acted.length).toBeGreaterThanOrEqual(0.97);
  });
  it.each(NEG)('never acts on a question or chat: "%s"', (q) => {
    const g = brain.guess(normalize(q));
    expect(g && g.confidence >= Brain.ACT ? g.commandId : null).toBeNull();
  });
  it('answers in well under a millisecond', () => {
    const t = performance.now();
    for (let i = 0; i < 200; i++) brain.guess('how much charge is left on this thing');
    expect((performance.now() - t) / 200).toBeLessThan(1);
  });
});

describe('experience memory', () => {
  it('recalls a learned phrase and close rewordings, not unrelated ones', () => {
    const b = new Brain();
    b.loadLearned([]);
    b.learn('crunch the product of seventeen and three', 'math.calculate', { expression: '17*3' });
    expect(b.recall('crunch the product of seventeen and three')?.tool).toBe('math.calculate');
    expect(b.recall('please crunch the product of seventeen and three')).not.toBeNull();
    expect(b.recall('crunch the product of nine and two')).toBeNull();
    expect(b.recall('open spotify')).toBeNull();
  });
  it('can forget everything it learned', () => {
    const b = new Brain();
    b.loadLearned([{ text: 'crunch the numbers', tool: 'math.calculate', args: { expression: '1+1' }, uses: 0, at: 1 }]);
    expect(b.forget()).toEqual([]);
    expect(b.recall('crunch the numbers')).toBeNull();
  });
});

describe('learned phrases match exactly, ignoring filler', () => {
  it('different numbers are never replayed', () => {
    const b = new Brain();
    b.loadLearned([]);
    b.learn('crunch the product of seventeen and three', 'math.calculate', { expression: '17*3' });
    expect(b.recall('crunch the product of seventeen and three for me please')).not.toBeNull();
    expect(b.recall('crunch the product of seventeen and four')).toBeNull();
  });
});

describe('downloading the offline model', () => {
  const nd = (lines: object[]) => new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
  const make = (pullReply: () => Response, installed: string[] = []) => {
    const settings = defaultSettings();
    let pulled = false;
    const impl = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) return Response.json({ models: (pulled ? [...installed, 'llama3.2:latest'] : installed).map((name) => ({ name })) });
      if (url.endsWith('/api/pull')) { pulled = true; return pullReply(); }
      return Response.json({});
    }) as unknown as typeof fetch;
    return new ProviderManager(() => settings, new MemorySecretStore(), new NetGuard(() => settings.ai.policy, () => {}, impl), () => false, () => false, 500);
  };
  it('streams progress and finishes with the model ready', async () => {
    const pm = make(() => nd([{ status: 'pulling manifest' }, { status: 'downloading', total: 100, completed: 40 }, { status: 'downloading', total: 100, completed: 100 }, { status: 'success' }]), ['nomic-embed-text:latest']);
    const seen: number[] = [];
    await pm.pullLocal('llama3.2', (p) => { if (p.total) seen.push(p.completed ?? 0); }, new AbortController().signal);
    expect(seen).toEqual([40, 100]);
    expect(pm.status().local.ready).toBe(true);
  });
  it('explains an unknown model name', async () => {
    const pm = make(() => nd([{ error: 'pull model manifest: file does not exist' }]), ['x:latest']);
    await expect(pm.pullLocal('nope-model', () => {}, new AbortController().signal)).rejects.toThrow(/no model called "nope-model"/);
  });
  it('says to install Ollama when it is not running', async () => {
    const settings = defaultSettings();
    const impl = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const pm = new ProviderManager(() => settings, new MemorySecretStore(), new NetGuard(() => settings.ai.policy, () => {}, impl), () => false, () => false, 300);
    await expect(pm.pullLocal('llama3.2', () => {}, new AbortController().signal)).rejects.toThrow(/Install it from ollama.com/);
  });
});

describe('definition questions are answers, not commands', () => {
  const b = new Brain();
  it.each(['what are computer processes', 'what is a battery', 'whats a screenshot', 'who are the beatles'])('%s', (q) => expect(b.guess(normalize(q))).toBeNull());
});

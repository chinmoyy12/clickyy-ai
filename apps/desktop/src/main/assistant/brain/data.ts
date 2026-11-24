/**
 * Training data for the on-device intent network, generated from the command catalog:
 * every example phrase, rewritten many ways (polite wrappers, synonyms, dropped words),
 * plus a large "none" class of questions and chat that must go to the language model.
 * Deterministic, so the same catalog always produces the same data (and the same hash).
 */
import { createHash } from 'node:crypto';
import { CATALOG } from '../catalog';
import { normalize } from '../normalize';
import { HARD_NEGATIVES, PARAPHRASES } from './paraphrases';

export const NONE = '__none__';

const PREFIXES = ['', '', '', 'please ', 'can you ', 'could you ', 'hey clicky ', 'clicky ', 'i want to ', 'i need you to ', 'would you ', 'kindly ', 'hey ', 'okay ', 'can you please ', 'i would like to ', 'just '];
const SUFFIXES = ['', '', '', ' please', ' for me', ' now', ' right now', ' quickly', ' thanks', ' real quick'];

/** Word-level paraphrases common in spoken requests. */
const SYNONYMS: Record<string, string[]> = {
  show: ['display', 'list', 'tell me', 'give me'],
  check: ['tell me', 'see', 'look at', 'find out'],
  open: ['launch', 'start', 'bring up', 'run'],
  close: ['quit', 'exit', 'shut'],
  stop: ['halt', 'end'],
  pause: ['hold', 'freeze'],
  play: ['start', 'put on'],
  skip: ['jump', 'go'],
  next: ['following'],
  previous: ['last', 'prior', 'earlier'],
  computer: ['pc', 'laptop', 'system', 'machine', 'device'],
  pc: ['computer', 'laptop', 'machine'],
  laptop: ['computer', 'pc', 'notebook'],
  song: ['track', 'tune', 'music'],
  track: ['song'],
  music: ['song', 'audio', 'playback'],
  quiet: ['silent', 'hush'],
  talking: ['speaking'],
  talk: ['speak'],
  speak: ['talk'],
  slower: ['more slowly', 'slowly'],
  faster: ['quicker', 'more quickly'],
  thanks: ['thank you', 'cheers', 'thx'],
  goodbye: ['bye', 'see you', 'good night'],
  help: ['assist me'],
  memory: ['ram'],
  storage: ['disk space', 'space'],
  internet: ['wifi', 'network', 'connection'],
  screenshot: ['screen shot', 'screen capture', 'snapshot of the screen'],
  remember: ['know', 'recall'],
  todo: ['to do', 'task'],
  tasks: ['to dos', 'todos'],
  what: ['which'],
  whats: ['what is'],
  "what's": ['what is'],
  my: ['the'],
  the: ['my', ''],
  is: [''],
  a: [''],
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function variants(phrase: string, n: number, r: () => number): string[] {
  const out = new Set<string>([phrase]);
  const words = phrase.split(/\s+/);
  for (let tries = 0; out.size < n && tries < n * 6; tries++) {
    let w = words.slice();
    // synonyms
    w = w.flatMap((x) => (SYNONYMS[x] && r() < 0.35 ? SYNONYMS[x][Math.floor(r() * SYNONYMS[x].length)].split(' ').filter(Boolean) : [x]));
    // drop one small word
    if (w.length > 3 && r() < 0.2) w.splice(Math.floor(r() * w.length), 1);
    const p = PREFIXES[Math.floor(r() * PREFIXES.length)];
    const s = SUFFIXES[Math.floor(r() * SUFFIXES.length)];
    out.add(`${p}${w.join(' ')}${s}`.trim());
  }
  return [...out];
}

/** Topics deliberately overlap command words (battery, memory, volume, screen, music…) so "explain X" isn't a command. */
const TOPICS = [
  'the roman empire', 'black holes', 'photosynthesis', 'quantum computing', 'cricket', 'the french revolution', 'machine learning', 'climate change',
  'gravity', 'the moon', 'elephants', 'bitcoin', 'chess', 'democracy', 'pizza', 'the human heart', 'python programming', 'mount everest',
  'the stock market', 'volcanoes', 'shakespeare', 'indian independence', 'electric cars', 'the internet', 'rainbows', 'dinosaurs', 'coffee', 'yoga',
  'sleep', 'music theory', 'batteries in electric cars', 'how computer memory works', 'the history of windows', 'the volume of a sphere',
  'screen time for kids', 'noise cancelling headphones', 'the speed of light', 'world war two', 'the taj mahal', 'artificial intelligence',
  'solar panels', 'the brain', 'vaccines', 'the olympics', 'bollywood movies', 'jazz music', 'the ocean', 'cloud computing', 'time zones',
  'lithium batteries', 'the history of music', 'how wifi works', 'keyboard layouts', 'productivity tips', 'meditation', 'healthy breakfast ideas',
  'the solar system', 'ancient egypt', 'how to learn guitar', 'interest rates', 'the water cycle', 'my exam tomorrow', 'job interviews',
];
const QUESTION_TEMPLATES = [
  'what is {t}', 'who invented {t}', 'tell me about {t}', 'explain {t}', 'explain {t} in simple words', 'how does {t} work', 'why is {t} important',
  'write a poem about {t}', 'write a short story about {t}', 'give me three facts about {t}', 'what do you think about {t}', 'summarize {t}',
  'how can i learn about {t}', 'what are the pros and cons of {t}', 'teach me {t}', 'i have a question about {t}', 'can you help me understand {t}',
  'compare {t} and something similar', 'what is the history of {t}', 'give me some advice on {t}', 'is {t} good or bad',
];
const CHAT = [
  "i'm feeling sad today", 'i had a long day at work', 'do you like movies', "you're funny", "that's interesting", 'my friend was rude to me',
  'what should i cook for dinner', 'i am bored', 'what is the meaning of life', 'do you have feelings', 'can you keep a secret',
  'what is two plus two', 'how many days are in a leap year', 'who won the last world cup', 'translate good morning into french',
  'help me write an email to my teacher', 'write a cover letter for a software job', 'give me a workout plan', 'recommend a good book',
  'what is the capital of australia', 'how far is the moon', 'can you help me with my homework', 'i need motivation', 'plan my weekend trip to goa',
  "what's the difference between a virus and bacteria", 'should i learn python or javascript', 'make a study plan for my exams', 'why is the sky blue',
  'how do i fix a flat tyre', 'what happened in 1947', 'tell me something interesting', 'i love you clicky', 'you are awesome', 'sing me a song',
  'how old is the universe', 'what language should i learn next', 'debug my code', 'what does api mean', 'how to make tea', 'is it going to be a good day',
  'what are you thinking about', 'describe a sunset', 'my laptop battery dies fast what should i do', 'which phone should i buy', 'how much ram do i need for gaming',
  'what is a good volume level for headphones', 'why does my computer get slow over time', 'how do screenshots work on a phone', 'what music genre is relaxing',
];

export function trainingSet(seed = 1234): { labels: string[]; samples: Array<{ text: string; label: string }>; hash: string } {
  const r = rng(seed);
  const samples: Array<{ text: string; label: string }> = [];
  const labels = [NONE, ...CATALOG.filter((c) => c.examples.length).map((c) => c.id)];
  for (const c of CATALOG) {
    for (const ex of c.examples) for (const v of variants(ex.toLowerCase(), 28, r)) samples.push({ text: normalize(v), label: c.id });
    for (const ex of PARAPHRASES[c.id] ?? []) for (const v of variants(ex, 10, r)) samples.push({ text: normalize(v), label: c.id });
  }
  const none: string[] = [...CHAT, ...HARD_NEGATIVES];
  for (const t of TOPICS) for (const q of QUESTION_TEMPLATES) if (r() < 0.45) none.push(q.replace('{t}', t));
  for (const s of none) for (const v of variants(s, 3, r)) samples.push({ text: normalize(v), label: NONE });
  const hash = createHash('sha256').update(JSON.stringify([labels, samples])).digest('hex').slice(0, 16);
  return { labels, samples, hash };
}

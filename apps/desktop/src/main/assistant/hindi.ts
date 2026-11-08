/**
 * Hindi and Hinglish understanding: turns a Hindi command (Devanagari or romanized,
 * as Whisper writes it) into the English phrasing the deterministic router knows.
 *
 *   "स्पॉटिफ़ाई खोलो"                 → "open spotify"
 *   "आवाज़ तीस प्रतिशत कर दो"         → "set the volume to 30 percent"
 *   "मुझे शाम सात बजे माँ को फ़ोन करने की याद दिलाना" → "remind me to maa ko phone karna at 7 pm"
 *
 * Anything it can't map is returned transliterated, so the language model (which reads
 * Hindi well) still gets the original words. Negations ("restart mat karna") are never
 * turned into actions.
 */

// ---------------------------------------------------------------- transliteration
const CONS: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n', ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n',
  त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n', प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh', ष: 'sh',
  स: 's', ह: 'h', 'क़': 'k', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f', 'य़': 'y',
};
const VOWELS: Record<string, string> = { अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'o', ऍ: 'e' };
const SIGNS: Record<string, string> = { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e' };
const isDeva = (c: string) => c >= 'ऀ' && c <= 'ॿ';
export const hasDevanagari = (s: string) => /[ऀ-ॿ]/.test(s);

/**
 * Devanagari → simple Latin, keeping everything else as is. Schwa deletion: the inherent
 * "a" is dropped at the end of a word and in the middle when a vowel comes before it and
 * the next consonant carries its own vowel sign (कितनी → kitnee, करने → karne, अगला → agla).
 */
export function transliterate(input: string): string {
  const s = input.normalize('NFC');
  const out: string[] = [];
  const ch = Array.from(s);
  const consAt = (j: number) => (CONS[ch[j]] ? (ch[j + 1] === '़' ? 2 : 1) : 0);
  let prevVowel = false; // was the previous sound a vowel (within this word)?
  for (let i = 0; i < ch.length; i++) {
    let c = ch[i];
    if (ch[i + 1] === '़' && CONS[c + '़']) { c += '़'; i++; }
    const next = ch[i + 1] ?? '';
    if (CONS[c]) {
      out.push(CONS[c]);
      if (SIGNS[next]) { out.push(SIGNS[next]); i++; prevVowel = true; }
      else if (next === '्') { i++; prevVowel = false; }
      else if (next === 'ं' || next === 'ँ') { out.push('a'); prevVowel = true; }
      else if (next && isDeva(next) && next !== 'ः') {
        // Medial schwa deletion.
        const n = consAt(i + 1);
        const after = ch[i + 1 + n] ?? '';
        const nextHasSign = n > 0 && !!SIGNS[after];
        if (prevVowel && nextHasSign) { prevVowel = false; }
        else { out.push('a'); prevVowel = true; }
      } else prevVowel = false;
      continue;
    } else if (VOWELS[c]) { out.push(VOWELS[c]); prevVowel = true; continue; }
    prevVowel = false;
    if (c === 'ं' || c === 'ँ') out.push('n');
    else if (c === 'ः') out.push('h');
    else if (c >= '०' && c <= '९') out.push(String(c.charCodeAt(0) - 0x0966));
    else if (c === '।' || c === '॥') out.push('. ');
    else if (c !== '़' && c !== '‌' && c !== '‍') out.push(c);
  }
  return out.join('');
}

// ---------------------------------------------------------------- vocabulary
/** English words people say in Hindi sentences, as Whisper spells them in Devanagari. */
const LOANWORDS: Record<string, string> = {
  क्रोम: 'chrome', 'स्पॉटिफ़ाई': 'spotify', स्पॉटिफाई: 'spotify', स्पोटिफाई: 'spotify', यूट्यूब: 'youtube', यूटूब: 'youtube', व्हाट्सएप: 'whatsapp', व्हाट्सऐप: 'whatsapp', वॉट्सऐप: 'whatsapp',
  नोटपैड: 'notepad', वॉल्यूम: 'volume', वॉल्युम: 'volume', वोल्यूम: 'volume', ब्लूटूथ: 'bluetooth', वाईफाई: 'wifi', 'वाई-फाई': 'wifi', लैपटॉप: 'laptop', लैपटोप: 'laptop',
  कंप्यूटर: 'computer', कम्प्यूटर: 'computer', स्क्रीनशॉट: 'screenshot', स्क्रीन: 'screen', टाइमर: 'timer', रिमाइंडर: 'reminder', मीटिंग: 'meeting', ईमेल: 'email', 'ई-मेल': 'email',
  मैसेज: 'message', मेसेज: 'message', एक्सेल: 'excel', शीट: 'sheet', फ़ोल्डर: 'folder', फोल्डर: 'folder', डाउनलोड: 'downloads', डाउनलोड्स: 'downloads', डेस्कटॉप: 'desktop',
  फ़ाइल: 'file', फाइल: 'file', फ़ाइलें: 'files', फाइलें: 'files', फाइल्स: 'files', पीडीएफ: 'pdf', ब्राइटनेस: 'brightness', इंटरनेट: 'internet', स्पीड: 'speed', डार्क: 'dark', मोड: 'mode',
  ज़ूम: 'zoom', जूम: 'zoom', पाइथन: 'python', पायथन: 'python', प्रोग्राम: 'program', कैलकुलेटर: 'calculator', सिस्टम: 'system', रीस्टार्ट: 'restart', सीपीयू: 'cpu', बैटरी: 'battery',
  गूगल: 'google', सर्च: 'search', चेक: 'check', सेट: 'set', ओपन: 'open', प्ले: 'play', पॉज़: 'pause', पॉज: 'pause', म्यूट: 'mute', अनम्यूट: 'unmute', लॉक: 'lock', स्लीप: 'sleep',
  नोट: 'note', नोट्स: 'notes', टेस्ट: 'test', ऐप: 'app', ऐप्स: 'apps', बैकग्राउंड: 'background', फ़ोन: 'phone', फोन: 'phone', वीडियो: 'video', बजट: 'budget', यूसेज: 'usage',
  स्लो: 'slow', जॉइन: 'join', ऑन: 'on', ऑफ: 'off', ऑफ़: 'off', हॉटस्पॉट: 'hotspot', ब्राउज़र: 'browser', एज: 'edge', वर्ड: 'word', पावरपॉइंट: 'powerpoint', कैमरा: 'camera',
  सेटिंग्स: 'settings', सेटिंग: 'settings', टास्क: 'task', मैनेजर: 'manager', लिस्ट: 'list', 'टू-डू': 'to-do', टूडू: 'to-do', कैलेंडर: 'calendar', मौसम: 'mausam', नाइट: 'night', लाइट: 'light',
  स्टार्ट: 'start', स्टॉप: 'stop', नेक्स्ट: 'next', प्रीवियस: 'previous', सॉन्ग: 'song', म्यूज़िक: 'music', म्यूजिक: 'music', प्लेलिस्ट: 'playlist', विंडो: 'window', टैब: 'tab',
  'क्लिकी': 'clicky', जार्विस: 'jarvis', शटडाउन: 'shutdown', 'शट डाउन': 'shut down', माइक: 'mic', माइक्रोफ़ोन: 'microphone', माइक्रोफोन: 'microphone', प्रतिशत: 'percent', परसेंट: 'percent', 'वाई फाई': 'wifi', 'वाई फ़ाई': 'wifi', सिंह: 'singh', मिनट: 'minat', मिनिट: 'minat',
};

/** English words kept exactly (never vowel-squashed): loanword targets plus common commands typed in Latin. */
const ENGLISH = new Set([
  ...Object.values(LOANWORDS).flatMap((v) => v.split(' ')),
  ...'open close play pause set check search start stop mute unmute volume sound percent timer reminder alarm laptop computer pc screen screenshot chrome spotify youtube whatsapp google excel sheet spreadsheet python javascript java typescript html program code script app file files folder desktop downloads download documents pictures videos music song songs video meeting email mail message msg note notes wifi bluetooth dark mode night light battery cpu ram memory disk usage internet net speed test zoom join apps background budget calculator system restart shutdown lock sleep list todo to-do brightness hotspot airplane aeroplane flight microphone mic settings edge word powerpoint calendar task manager next previous playlist window tab camera phone on off enable disable full update'.split(' '),
]);

/** Hindi words, spelled many ways ("gaana"/"gana", "kijiye"/"keejie"), compared in one squashed form. */
export const squash = (s: string) => s.replace(/aa/g, 'a').replace(/ee/g, 'i').replace(/ii/g, 'i').replace(/oo/g, 'u').replace(/w/g, 'v').replace(/(.)\1+/g, '$1').replace(/iye$/, 'ie');
const canon = (w: string) => (ENGLISH.has(w) || /^\d/.test(w) ? w : squash(w));

const NUMBER_WORDS: Record<string, number> = {};
for (const [k, v] of Object.entries({
  एक: 1, दो: 2, तीन: 3, चार: 4, पाँच: 5, पांच: 5, छह: 6, छः: 6, सात: 7, आठ: 8, नौ: 9, दस: 10, ग्यारह: 11, बारह: 12, तेरह: 13, चौदह: 14, पंद्रह: 15, सोलह: 16,
  सत्रह: 17, अठारह: 18, उन्नीस: 19, बीस: 20, पच्चीस: 25, तीस: 30, पैंतीस: 35, चालीस: 40, पैंतालीस: 45, पचास: 50, पचपन: 55, साठ: 60, पैंसठ: 65, सत्तर: 70, पचहत्तर: 75,
  अस्सी: 80, पचासी: 85, नब्बे: 90, सौ: 100, डेढ़: 1.5, ढाई: 2.5,
})) NUMBER_WORDS[squash(transliterate(k))] = v;
for (const [k, v] of Object.entries({
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, panch: 5, paanch: 5, chhah: 6, chhe: 6, saat: 7, sat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12, pandrah: 15,
  bees: 20, bis: 20, pachchees: 25, pachchis: 25, pachis: 25, tees: 30, tis: 30, paintees: 35, chalees: 40, chalis: 40, pachaas: 50, saath: 60, sattar: 70, assee: 80, assi: 80, nabbe: 90, sau: 100,
})) NUMBER_WORDS[squash(k)] = v;

const UNIT = '(?:minat|minute|minutes|mint|min|ghante|ghanta|hour|hours|second|seconds|sekand|baje|bje|percent|pratishat|parsent|%)';

/** Number words become digits only right before a unit ("do" is also "give"). */
function numbers(t: string): string {
  return t.replace(new RegExp(`\\b([a-z]+) (?=${UNIT}\\b)`, 'g'), (m, w: string) => (NUMBER_WORDS[w] !== undefined ? `${NUMBER_WORDS[w]} ` : m));
}

/** Loanwords first (exact Devanagari words), then transliterate, canonicalize spellings, repair and numbers. */
export function toCanonical(raw: string): string {
  let t = raw.normalize('NFC').replace(/[,!?.]/g, ' ').replace(/।/g, ' ');
  for (const [hi, en] of Object.entries(LOANWORDS).filter(([k]) => k.includes(' '))) t = t.split(hi).join(` ${en} `);
  t = t.replace(/[ऀ-ॿ़]+/g, (w) => (LOANWORDS[w] ? ` ${LOANWORDS[w]} ` : w));
  t = transliterate(t).toLowerCase().replace(/%/g, ' % ').replace(/[^a-z0-9%:+\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = fixTokens(t.split(' ').map(canon)).join(' ').replace(/(\d) %/g, '$1 percent').replace(/\bpratishat\b|\bparsent\b/g, 'percent');
  t = t
    .replace(/\b(likh|dekh|bhej|rok|bol|sun|khol|dhundh|dhund) h?o\b/g, '$1o') // "लिख हो" → likho
    .replace(/\b(kar|rok|bata|bana|laga|chala|baja|bhej|khol|dikha|suna|badha|barha|ghata|dal|de) to\b/g, '$1 do') // "कर तो" → kar do
    .replace(/\bsath (?=baje\b)/g, 'sat '); // साथ (with) is how Whisper often hears सात (7) before बजे
  return numbers(t);
}

// ---------------------------------------------------------------- spelling repair
/**
 * Whisper writes Hindi phonetically and inconsistently: आवास for आवाज़, मोसम for मौसम, यूट्यूम
 * for यूट्यूब, लेप्टाब for लैपटॉप, ब्लुटुत for ब्लूटूथ, or in Latin ("Spotify kolo"). Each
 * unknown word is snapped to the closest word the rules know, by a phonetic distance where
 * vowels and voiced/unvoiced pairs (b/p, d/t, g/k, j/ch, z/s) cost half an edit.
 */
const soft = (w: string) => squash(w).replace(/c(?!h)/g, 'k').replace(/ph/g, 'f').replace(/chh|ch/g, 'c').replace(/([kgjtdb])h/g, '$1').replace(/sh/g, 's')
  .replace(/au/g, 'o').replace(/ai/g, 'e').replace(/z/g, 'j').replace(/q/g, 'k').replace(/x/g, 'ks').replace(/ck/g, 'k').replace(/(.)\1+/g, '$1');
const HALF = new Set(['bp', 'dt', 'gk', 'jc', 'js', 'fp', 'vb', 'rd', 'nm', 'yi', 'vu', 'ck', 'kc']);
const isV = (c: string) => 'aeiou'.includes(c);
// Voicing slips (दीस for तीस, रोग for रोक) are Whisper's most common Hindi error, so they cost a bit
// less than a vowel change: "dis" repairs to "tis" (30), not "das" (10).
const subCost = (a: string, b: string) => (a === b ? 0 : HALF.has(a + b) || HALF.has(b + a) ? 0.4 : isV(a) && isV(b) ? 0.5 : 1);
const indel = (c: string) => (isV(c) || c === 'h' || c === 'y' ? 0.5 : 1);

function distance(a: string, b: string): number {
  const prev = [0];
  for (let j = 1; j <= b.length; j++) prev[j] = prev[j - 1] + indel(b[j - 1]);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] += indel(a[i - 1]);
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(up + indel(a[i - 1]), prev[j - 1] + indel(b[j - 1]), diag + subCost(a[i - 1], b[j - 1]));
      diag = up;
    }
  }
  return prev[b.length];
}

/** Everyday words that must never be "repaired" into something else (canonical, squashed spellings). */
const COMMON_HINDI = 'sham subah suba savere dopahar rat aj kal parson ko ki ka ke se par pe me men mein hai hain tha thi the kya kaise kaisa kab kahan kyon kyun mujhe mera meri mere tum tumhara ap apna apni yah vah ye vo aur ya bhi nahi nahin mat bahut thoda thora abhi phir karna karne kiya lie liye bare vala vali vale sab sabhi sari koi kuch ek naya nai purane purana din hafta mahina sal ghar kam bat log dost man maa papa bhai bahan';

/** Common English words, some spelled like Hindi ones; never evidence that a Latin-script sentence is Hindi. */
const COMMON_ENGLISH = new Set(('the a an and or but if of to in on at by for from with about into over after before up down out off is are was were be been am '
  + 'i me my you your he she it its we us our they them their this that these those what which who when where why how all any some no not '
  + 'do does did done have has had can could will would should may might must shall let get got go going come make take give show tell '
  + 'find open close play set turn start stop search look see read write send check put run new latest last next first best more less '
  + 'please now today tomorrow email mail file files report college school office meeting work home man mat rat bare lie din sal log bat '
  + 'so as than then there here very just also only too well good like want need time day week year').split(' '));

/** soft form → canonical word the rules use (Hindi words, loanword targets, number words). */
const VOCAB = new Map<string, string>();
/** Canonical words that are Hindi (not English loanwords): used to tell romanized Hindi from English. */
const HINDI_WORDS = new Set<string>();
function addWord(canonical: string, spelled = canonical, hindi = false) {
  const k = soft(spelled);
  if (k.length >= 2 && !VOCAB.has(k)) VOCAB.set(k, canonical);
  if (hindi) HINDI_WORDS.add(canonical);
}
function buildVocab() {
  for (const [hi, en] of Object.entries(LOANWORDS)) if (!en.includes(' ')) { addWord(en); addWord(en, squash(transliterate(hi))); }
  for (const w of ENGLISH) addWord(w);
  for (const k of Object.keys(NUMBER_WORDS)) addWord(k, k, true);
  for (const w of COMMON_HINDI.split(' ')) addWord(w, w, true);
  for (const w of Object.keys(TIME_OF_DAY)) addWord(w, w, true);
  const sources = [MARKERS.source, NEGATION.source, FEATURES, DO, VERB_OPEN, VERB_CLOSE, VERB_PLAY, VERB_FIND, AVAZ, IN, MORE, UP, DOWN, UNIT, ...RULES.map(([re]) => re.source)];
  for (const src of sources) for (const w of src.match(/[a-z]{2,}/g) ?? []) if (!ENGLISH.has(w)) addWord(w, w, true);
}

const commonPrefix = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };

/** Closest known word within the edit budget, or null. Ties go to the same-length, longest-shared-start word. */
function nearest(word: string): string | null {
  if (!VOCAB.size) buildVocab();
  const s = soft(word);
  const exact = VOCAB.get(s);
  if (exact) return exact;
  if (s.length < 3) return null;
  // A stray last letter (nasal "करों" → karon, "karoe", "low" → lov): drop it if that gives a known word.
  const trimmed = VOCAB.get(s.slice(0, -1));
  if (trimmed && s.length >= 3) return trimmed;
  const limit = s.length <= 5 ? 1 : 1.5; // tight on short words so names ("rahul", "priya") stay as they are
  let best: { w: string; d: number; same: boolean; pre: number } | null = null;
  let tie = false;
  for (const [k, w] of VOCAB) {
    if (Math.abs(k.length - s.length) > 2) continue;
    const d = distance(s, k);
    if (d > limit) continue;
    const cand = { w, d, same: k.length === s.length, pre: commonPrefix(s, k) };
    if (!best || d < best.d - 1e-9) { best = cand; tie = false; continue; }
    if (Math.abs(d - best.d) > 1e-9 || w === best.w) continue;
    // Tie: prefer the same length ("mined" → minat, not mint), then the longer shared start ("karon" → karo).
    const better = cand.same !== best.same ? cand.same : cand.pre !== best.pre ? cand.pre > best.pre : null;
    if (better === true) { best = cand; tie = false; } else if (better === null) tie = true;
  }
  return best && !tie ? best.w : null;
}

const known = (w: string) => w.length < 3 || /\d/.test(w) || ENGLISH.has(w) || VOCAB.get(soft(w)) === w;

/** Repair each word, then re-join words Whisper split ("das katop" → desktop) and split ones it ran together ("opencaro"). */
function fixTokens(tokens: string[]): string[] {
  if (!VOCAB.size) buildVocab();
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    if (known(w)) {
      // A known word followed by an unknown one may be a split word: "brait nesh" → brightness.
      const nx = tokens[i + 1];
      if (nx && !known(nx) && !nearest(nx) && !/\d/.test(w + nx)) {
        const joined = nearest(w + nx);
        if (joined && joined.length >= 5) { out.push(joined); i++; continue; }
      }
      out.push(w);
      continue;
    }
    const fixed = nearest(w);
    if (fixed) { out.push(fixed); continue; }
    const nx = tokens[i + 1];
    const joined = nx ? nearest(w + nx) : null;
    if (joined && joined.length >= 5) { out.push(joined); i++; continue; }
    const split = splitWord(w);
    out.push(...(split ?? [w]));
  }
  return out;
}

/** "opencaro" → open karo, "plekro" → play kro: two known words written together. */
function splitWord(w: string): string[] | null {
  if (w.length < 5) return null;
  for (let i = 2; i <= w.length - 2; i++) {
    const a = VOCAB.get(soft(w.slice(0, i)));
    const rest = soft(w.slice(i));
    const b = VOCAB.get(rest) ?? VOCAB.get(rest.slice(0, -1)) ?? (rest.length > 4 ? VOCAB.get(rest.slice(0, -2)) : undefined);
    if (a && b) return [a, b];
  }
  return null;
}

// Hinglish markers (canonical spellings): a Latin-only sentence without any of these is English and left alone.
const MARKERS = /\b(karo|kar do|kardo|karna|karie|kijie|dijie|kholo|khol|chalao|bajao|lagao|laga do|batao|bata do|dikhao|bhejo|likho|banao|bana do|dhundho|dhundo|khojo|roko|rok do|ruko|band|chalu|badhao|badha do|barhao|barha do|ghatao|hai|hain|kya|kitna|kitni|kitne|mujhe|mera|meri|mere|aj|abhi|men|mein|yad|samay|baje|mausam|gana|gane|avaz|thoda|thora|jaldi|sula|chup|suno|sunao|dilana|dila do|chahie|krdo|kro)\b/;

const NEGATION = /\b(mat|nahi|nahin|na karo)\b/;

const FEATURES = '(wifi|wi fi|wi-fi|vai fai|vai phai|wai fai|va[iy]e? (?:f|ph|bh|b|p)a[iy]e?|bluetooth|blututh|dark mode|night light|nait lait|hotspot|airplane mode|aeroplane mode|flight mode|mic|microphone)';
const DO = '(?:karo|kar do|kardo|kijie|kar dijie|karna|kro|krdo|kar dena|karie)';
const VERB_OPEN = `(?:kholo|khol do|kholie|khol dijie|kholna|open ${DO}|chalu ${DO}|start ${DO}|launch ${DO}|shuru ${DO})`;
const VERB_CLOSE = `(?:band ${DO}|close ${DO}|bandh ${DO})`;
const VERB_PLAY = `(?:chalao|chala do|bajao|baja do|play ${DO}|lagao|laga do|sunao|suna do|chalaie|bajaie)`;
const VERB_FIND = `(?:dhundho|dhundo|dhundh do|khojo|search ${DO}|google ${DO}|talash ${DO})`;
const AVAZ = '(?:avaz|avaj|volume|sound)';
const IN = '(?:me|men|mein|main)';
const MORE = '(?:thoda |thora |thodi |zara |aur |bahut )?';
const UP = `(?:badhao|badha do|barhao|barha do|badhaie|barhaie|badha|barha|tez ${DO}|zyada ${DO}|upar ${DO}|full ${DO})`;
const DOWN = `(?:kam ${DO}|ghatao|ghata do|dhimi ${DO}|niche ${DO}|halki ${DO})`;

const TIME_OF_DAY: Record<string, 'am' | 'pm'> = { subah: 'am', suba: 'am', savere: 'am', sham: 'pm', dopahar: 'pm', dopahr: 'pm', rat: 'pm' };

/** "kal sham 7 baje" → "tomorrow at 7 pm". */
function timePhrase(t: string): { text: string; when: string } {
  let when = '';
  const m = t.match(/\b(?:(aj|kal|parson)\s+)?(?:(subah|suba|savere|sham|dopahar|dopahr|rat)\s+(?:ko\s+)?)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:baje|bje)\b/);
  if (m) {
    const day = m[1] === 'kal' ? 'tomorrow ' : '';
    const h = parseInt(m[3], 10);
    let ampm = m[2] ? TIME_OF_DAY[m[2]] : h >= 7 && h <= 11 ? 'am' : 'pm';
    if (m[2] === 'rat' && h < 5) ampm = 'am';
    when = `${day}at ${h}${m[4] ? `:${m[4]}` : ''} ${ampm}`;
    t = t.replace(m[0], ' ').replace(/\s+/g, ' ').trim();
  } else if (/\bkal\b/.test(t)) {
    when = 'tomorrow';
    t = t.replace(/\bkal\b/, ' ').replace(/\s+/g, ' ').trim();
  }
  return { text: t, when };
}

function normFeature(f: string): string {
  if (/^(wi|va|wai)/.test(f)) return 'wi-fi';
  if (/^blu/.test(f)) return 'bluetooth';
  if (/^nait|night/.test(f)) return 'night light';
  if (/airplane|aeroplane|flight/.test(f)) return 'airplane mode';
  if (/^mic/.test(f)) return 'microphone';
  return f;
}
const unit = (u: string) => (/^gh|^hour/.test(u) ? 'hours' : /^se/.test(u) ? 'seconds' : 'minutes');

type Rule = [RegExp, string | ((...m: string[]) => string)];
const R = (s: string) => new RegExp(`^${s}$`);

// The catch-all "<anything> play/search" rules, which romanized English must never hit.
const GENERIC_PLAY = R(`(.+?) ${VERB_PLAY}`);
const GENERIC_FIND = R(`(.+?) ${VERB_FIND}`);

const RULES: Rule[] = [
  // Volume.
  [R(`${AVAZ}(?: ko)? (\\d+)(?: percent)?(?: par| pe)? (?:${DO}|set ${DO}|rakho|rakh do)`), (_, n) => `set the volume to ${n} percent`],
  [R(`${AVAZ}(?: ko)? ${MORE}${UP}`), 'turn the volume up'],
  [R(`${AVAZ}(?: ko)? ${MORE}${DOWN}`), 'turn the volume down'],
  [R(`(?:${AVAZ} (?:band|mute) ${DO}|mute ${DO}|chup (?:ho jao|karo))`), 'mute'],
  [R(`(?:${AVAZ} (?:vapas )?(?:chalu|unmute) ${DO}|unmute ${DO})`), 'unmute'],
  // Brightness.
  [R(`(?:brightness|roshni|screen ki roshni)(?: ko)? (\\d+)(?: percent)?(?: par| pe)? ${DO}`), (_, n) => `set brightness to ${n} percent`],
  [R(`(?:brightness|roshni|screen ki roshni)(?: ko)? ${MORE}${UP}`), 'increase the brightness'],
  [R(`(?:brightness|roshni|screen ki roshni)(?: ko)? ${MORE}${DOWN}`), 'decrease the brightness'],
  // Windows features.
  [R(`${FEATURES}(?: ko)? (?:chalu|on|enable|shuru) ${DO}`), (_, f) => `turn on ${normFeature(f)}`],
  [R(`${FEATURES}(?: ko)? (?:band|off|disable|bandh) ${DO}`), (_, f) => `turn off ${normFeature(f)}`],
  [R(`(?:kya )?${FEATURES} (?:chalu|on) hai(?: kya)?`), (_, f) => `check if ${normFeature(f)} is currently enabled`],
  // Music.
  [R(`(?:agla|agala|next) (?:gana|song|track)(?: ${VERB_PLAY})?`), 'next track'],
  [R(`(?:pichla|pichhla|pichala|previous|pehla vala) (?:gana|song|track)(?: ${VERB_PLAY})?`), 'previous track'],
  [R(`(?:gana|music|song|video)(?: ko)? (?:rok do|roko|ruko|rok dijie|pause ${DO}|band ${DO}|thamba do)`), 'pause'],
  [R(`(?:gana|music|song)(?: ko)? (?:phir se |vapas |dobara )?(?:chalao|chala do|bajao|play ${DO}|shuru ${DO}|resume ${DO})`), 'play music'],
  [R(`youtube (?:par|pe|${IN}) (.+?) ${VERB_PLAY}`), (_, q) => `play ${q} on youtube`],
  [R(`youtube (?:par|pe|${IN}) (.+?) ${VERB_FIND}`), (_, q) => `search youtube for ${q}`],
  [R(`spotify (?:par|pe|${IN}) (.+?) ${VERB_PLAY}`), (_, q) => `play ${q} on spotify`],
  [R(`(.+?) (?:ke|ki|ka) (?:gane|gana|songs|song) ${VERB_PLAY}`), (_, a) => `play songs by ${a}`],
  [R(`(?:koi )?(?:gana|music|song|gane)(?: koi)? ${VERB_PLAY}`), 'play music'],
  // Time, date, weather, battery.
  [R(`(?:abhi )?(?:kya (?:samay|samai|same|samen|time)|time kya|kitne baje|kitna baja|samay kya)(?: hua| hue)?(?: hai| he)?(?: abhi)?`), 'what time is it'],
  [R(`(?:aj )?(?:kya tarikh|tarikh kya|date kya|aj kya din)(?: hai)?`), "what's the date today"],
  [R(`(?:aj |kal )?(?:ka )?mausam(?: kaisa| kaise)?(?: hai| rahega)?`), (m) => (/\bkal\b/.test(m) ? "what's the weather tomorrow" : "what's the weather")],
  // "आज मौसम के साहे": the question words are often misheard, "mausam" alone is enough.
  [R(`(?:aj |kal )?(?:ka )?mausam(?: (?:ke|ka|ki|kaisa|kaise|hai|he|[a-z]{2,6})){1,3}`), (m) => (/\bkal\b/.test(m) ? "what's the weather tomorrow" : "what's the weather")],
  [R(`(.+?) (?:ka|${IN}) mausam(?: kaisa)?(?: hai)?`), (_, c) => `weather in ${c}`],
  [R(`(?:kya )?(?:aj |kal )?barish (?:hogi|hone vali hai)(?: kya)?`), 'will it rain today'],
  [R(`(?:meri |mere )?(?:battery|laptop ki battery)(?: kitni| kitna)(?: bachi| bacha| baki)?(?: hai| he)?`), 'how much battery do i have'],
  [R(`(?:kya )?(?:laptop|computer|battery) charge ho raha hai(?: kya)?`), 'is my laptop charging'],
  // Screen, lock, power.
  [R(`(?:ek )?screenshot (?:lo|le lo|lijie|le|lena|khincho|${DO})`), 'take a screenshot'],
  [R(`(?:computer|laptop|pc|screen|system)(?: ko)? (?:lock|lok|lag|laga|log|lak) ${DO}`), 'lock my computer'],
  [R(`(?:computer|laptop|pc|system)(?: ko)? (\\d+(?:\\.\\d+)?) (?:minat|minute|mint|min) (?:${IN}|bad) (?:sleep ${DO}|sula do)`), (_, n) => `put my laptop to sleep in ${n} minutes`],
  [R(`(?:computer|laptop|pc|system)(?: ko)? (?:sleep ${DO}|sula do|sula dijie)`), 'put my laptop to sleep'],
  [R(`(?:computer|laptop|pc|system)(?: ko)? (?:restart ${DO}|dobara chalu ${DO})`), 'restart my computer'],
  [R(`(?:computer|laptop|pc|system)(?: ko)? (?:shut down ${DO}|shutdown ${DO}|band ${DO})`), 'shut down my computer'],
  // Timers and reminders.
  [R(`(\\d+(?:\\.\\d+)?) (minat|minute|minutes|mint|min|ghante|ghanta|hour|second|sekand)(?: ka| ki)? (?:timer|alarm) (?:lagao|laga do|set ${DO}|lagaie|chalu ${DO}|start ${DO})`), (_, n, u) => `set a timer for ${n} ${unit(u)}`],
  [R(`(?:ek )?timer (?:lagao|laga do|set ${DO}) (\\d+(?:\\.\\d+)?) (minat|minute|mint|min|ghante|second)(?: ka)?`), (_, n, u) => `set a timer for ${n} ${unit(u)}`],
  [R(`(?:mujhe )?(.+?) (?:ki|ka|ke) (?:yad|yaj|aj) (?:dilana|dila dena|dila do|dilaie|dilao)`), (_, rest: string) => {
    const { text, when } = timePhrase(rest);
    const task = text.replace(/^(?:mujhe|ki|ko)\s+/, '').replace(/\bkarne$/, 'karna').trim();
    return `remind me to ${task}${when ? ` ${when}` : ''}`;
  }],
  [R(`(.+?) (?:ka |ki )?reminder (?:set ${DO}|lagao|laga do|bana do|banao)`), (_, rest: string) => {
    const { text, when } = timePhrase(rest);
    return `remind me about ${text.replace(/\s+(?:ka|ki)$/, '')}${when ? ` ${when}` : ''}`;
  }],
  // Search.
  [R(`google (?:par|pe|${IN}) (.+?) ${VERB_FIND}`), (_, q) => `search for ${q}`],
  [R(`(.+?) ke bare ${IN} ${VERB_FIND}`), (_, q) => `search for ${q}`],
  // Files and folders.
  [R(`(desktop|downloads|documents|pictures|music|videos)(?: folder)? (?:par|pe|${IN}) (?:sari |sabhi |sab )?(pdf|excel|word|images?|photos?|videos?)(?: files| file)? ${VERB_FIND}`), (_, f, ty) => `find all ${ty} files in my ${f} folder`],
  [R(`(desktop|downloads?|documents?|pictures?|music|videos?)(?: folder)? ${VERB_OPEN}`), (_, f) => `open my ${f.replace(/^(download|document|picture|video)$/, '$1s')}`],
  // Excel, code, notes, to-dos, messages.
  [R(`(.+?) (?:ke lie|ke liye|ka|ki) (?:ek )?(?:excel|spreadsheet)(?: sheet)? (?:banao|bana do|banaie|${DO})`), (_, x) => `create an excel sheet for ${x}`],
  [R(`(?:ek )?(?:excel|spreadsheet)(?: sheet)? (?:banao|bana do) (.+?) (?:ke lie|ke liye|ka)`), (_, x) => `create an excel sheet for ${x}`],
  [R(`(python|javascript|java|typescript|html)(?: ${IN})? (?:ek )?(.+?) (?:ka )?(?:program|code|script|app) (?:likho|likh do|banao|bana do|likhie)`), (_, l, x) => `write a ${l} program for a ${x}`],
  [R(`(?:notepad(?: ${IN})? )?(?:ek )?(?:naya )?(?:note|nut|not|net) (?:banao|bana do|likho|banaie)`), 'new note'],
  [R(`(.+?) (?:ko )?(?:meri |mere )?(?:to-do|todo|to do|kam ki|task) (?:list )?${IN} (?:dalo|jodo|add ${DO}|likho|dal do)`), (_, x) => `add ${x} to my to-do list`],
  [R(`(?:meri )?(?:to-do|todo|to do|kam ki) list (?:batao|dikhao|padho|sunao)`), "what's on my to-do list"],
  [R(`(.+?) ko (?:ek )?email (?:likho|bhejo|likh do|draft ${DO})(?: (.+?) (?:ke bare ${IN}|ke lie))?`), (_, n, t) => `draft an email to ${n} about ${t ?? 'a quick update'}`],
  [R(`(.+?) ke bare ${IN} (.+?) ko (?:ek )?email (?:likho|bhejo)`), (_, t, n) => `draft an email to ${n} about ${t}`],
  [R(`whatsapp (?:par|pe) (.+?) ko (?:ek )?(?:message|msg) (?:bhejo|bhej do|${DO})(?: ki (.+))?`), (_, n, t) => `send a whatsapp message to ${n} about ${t ?? 'a quick hello'}`],
  [R(`(.+?) ko whatsapp (?:par |pe )?(?:message |msg )?(?:${DO}|bhejo)(?: ki (.+))?`), (_, n, t) => `send a whatsapp message to ${n} about ${t ?? 'a quick hello'}`],
  // Diagnostics.
  [R(`(cpu|ram|memory|disk|battery)(?: ka| ki)?(?: [a-z]+)? (?:check ${DO}|batao|dikhao)`), (_, x) => `check my ${x} usage`],
  [R(`(?:mera |meri |mere )?(?:laptop|computer|pc|system) (?:slow|slo|dhima|dhire) (?:kyon|kyu|kyun|kyo) (?:chal raha|chal rahi|ho gaya)(?: hai)?`), 'troubleshoot slow performance by checking cpu usage and core temperatures'],
  [R(`(?:internet|net) (?:speed|ki speed)(?: test)? (?:${DO}|check ${DO}|batao)`), 'check my network bandwidth and download speed'],
  [R(`(?:internet|net|wifi) (?:chal raha hai|connected hai|chalu hai)(?: kya)?`), 'is the internet connected'],
  // Apps and generic verbs (most general: keep last).
  [R(`(.+?) (?:ko |${IN} )?${VERB_OPEN}`), (_, a) => `open ${a.replace(/\s+(?:app|application)$/, '')}`],
  [R(`(.+?) (?:ko )?${VERB_CLOSE}`), (_, a) => `close ${a.replace(/\s+(?:app|application)$/, '')}`],
  [R(`(.+?) (?:meeting )?join ${DO}`), (_, a) => `open ${a.replace(/\s+meeting$/, '')}`],
  [GENERIC_PLAY, (_, q) => `play ${q}`],
  [GENERIC_FIND, (_, q) => `search for ${q}`],
  [R(`(.+?) ke bare ${IN} (?:batao|bataie|samjhao|samjhaie)`), (_, q) => `tell me about ${q}`],
];

export interface HindiResult { text: string; hindi: boolean; mapped: boolean }

const WAKE = /^(?:hey |he |hi |ok |okay )?(?:clicky|clickyy|kliki|kliky|jarvis)\s*/;

/**
 * Hindi or Hinglish → English command text. `hindi` says the input was Hindi (so replies
 * can be in Hindi); `mapped` says a command rule matched. English input is returned as is.
 */
export function understandHindi(raw: string): HindiResult {
  const deva = hasDevanagari(raw);
  if (!deva && !MARKERS.test(raw.toLowerCase().split(/\s+/).map(squash).join(' '))) {
    // Romanized Hindi with Whisper's spelling ("Spotify kolo", "Screenshot low"): only taken
    // when the repaired sentence has a Hindi word and fully matches a rule; English is left alone.
    const t = toCanonical(raw).replace(WAKE, '').trim();
    // Evidence must be a word the user actually said that is Hindi and not also everyday English: "the" (थे),
    // "me" (में) and "do" (दो) appear in any English sentence, and repair can turn "from" into "chrome".
    const said = raw.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !COMMON_ENGLISH.has(w));
    if (!said.some((w) => toCanonical(w).split(' ').some((c) => HINDI_WORDS.has(c))) || NEGATION.test(t)) return { text: raw, hindi: false, mapped: false };
    for (const [re, rep] of RULES) {
      const m = t.match(re);
      if (m && re !== GENERIC_PLAY && re !== GENERIC_FIND) return { text: (typeof rep === 'string' ? rep : rep(...m)).trim(), hindi: true, mapped: true };
    }
    return { text: raw, hindi: false, mapped: false };
  }
  const t = toCanonical(raw).replace(WAKE, '').trim();
  if (!t) return { text: raw, hindi: deva, mapped: false };
  if (NEGATION.test(t)) return { text: t, hindi: true, mapped: false };
  for (const [re, rep] of RULES) {
    const m = t.match(re);
    if (m) return { text: (typeof rep === 'string' ? rep : rep(...m)).trim(), hindi: true, mapped: true };
  }
  return { text: t, hindi: true, mapped: false };
}

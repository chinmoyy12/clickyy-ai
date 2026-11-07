import { describe, expect, it } from 'vitest';
import { transliterate, understandHindi } from '../src/main/assistant/hindi';
import { route } from '../src/main/assistant/router';
import { detectApps } from '../src/main/tools/apps';
import type { AppEntry } from '../src/shared/types';

const apps: AppEntry[] = detectApps(() => true).map((a, i) => ({ ...a, id: `a${i}` }));
const ctx = { session: {}, apps, browser: 'default' as const, browsers: ['chrome', 'edge'] as ('chrome' | 'edge')[] };
const routed = (t: string) => {
  const r = route(t, ctx);
  return r.kind === 'commands' ? r.steps.map((s) => s.commandId).join(' + ') : 'none';
};
const args = (t: string) => {
  const r = route(t, ctx);
  return r.kind === 'commands' && r.steps[0].resolution.kind === 'tool' ? r.steps[0].resolution.args : undefined;
};

describe('transliteration', () => {
  it('romanizes Devanagari', () => {
    expect(transliterate('खोलो')).toBe('kholo');
    expect(transliterate('गाना')).toBe('gaanaa');
    expect(transliterate('मौसम')).toBe('mausam');
    expect(transliterate('बढ़ाओ')).toBe('barhaao');
    expect(transliterate('३०')).toBe('30');
  });
});

describe('Hindi and Hinglish commands', () => {
  const cases: Array<[string, string]> = [
    ['स्पॉटिफ़ाई खोलो', 'open spotify'],
    ['आवाज़ तीस प्रतिशत कर दो', 'set the volume to 30 percent'],
    ['आवाज़ 30% कर दो', 'set the volume to 30 percent'],
    ['वॉल्यूम थोड़ा बढ़ा दो', 'turn the volume up'],
    ['आवाज़ कम करो', 'turn the volume down'],
    ['आज मौसम कैसा है', "what's the weather"],
    ['स्क्रीनशॉट लो', 'take a screenshot'],
    ['ब्लूटूथ बंद करो', 'turn off bluetooth'],
    ['वाई फाई चालू करो', 'turn on wi-fi'],
    ['डार्क मोड चालू करो', 'turn on dark mode'],
    ['अगला गाना बजाओ', 'next track'],
    ['गाना रोक दो', 'pause'],
    ['अभी क्या समय हुआ है', 'what time is it'],
    ['मेरी बैटरी कितनी बची है', 'how much battery do i have'],
    ['पच्चीस मिनट का टाइमर लगाओ', 'set a timer for 25 minutes'],
    ['कंप्यूटर लॉक करो', 'lock my computer'],
    ['लैपटॉप को तीस मिनट में स्लीप कर दो', 'put my laptop to sleep in 30 minutes'],
    ['डाउनलोड फ़ोल्डर खोलो', 'open my downloads'],
    ['क्रोम ओपन करो', 'open chrome'],
    ['Chrome open karo', 'open chrome'],
    ['spotify kholo', 'open spotify'],
    ['volume 40 percent kar do', 'set the volume to 40 percent'],
    ['अरिजीत सिंह के गाने प्ले करो', 'play songs by arijit singh'],
    ['यूट्यूब पर पुराने गाने चलाओ', 'play purane gane on youtube'],
    ['बजट के लिए एक्सेल शीट बनाओ', 'create an excel sheet for budget'],
    ['पाइथन में एक कैलकुलेटर प्रोग्राम लिखो', 'write a python program for a calculator'],
    ['राहुल को ईमेल लिखो', 'draft an email to rahul about a quick update'],
    ['व्हाट्सएप पर प्रिया को मैसेज भेजो', 'send a whatsapp message to priya about a quick hello'],
    ['डेस्कटॉप पर सारी पीडीएफ फाइलें ढूंढो', 'find all pdf files in my desktop folder'],
    ['मेरा लैपटॉप स्लो क्यों चल रहा है', 'troubleshoot slow performance by checking cpu usage and core temperatures'],
    ['नोटपैड में नया नोट बनाओ', 'new note'],
    ['सीपीयू यूसेज चेक करो', 'check my cpu usage'],
    ['मुझे शाम सात बजे माँ को फ़ोन करने की याद दिलाना', 'remind me to man ko phone karna at 7 pm'],
    ['कल सुबह नौ बजे मीटिंग का रिमाइंडर सेट करो', 'remind me about meeting tomorrow at 9 am'],
    ['क्लिकी, स्पॉटिफ़ाई खोलो', 'open spotify'],
  ];
  it.each(cases)('%s → %s', (hi, en) => {
    expect(understandHindi(hi).text).toBe(en);
  });

  it('routes Hindi commands to real tools', () => {
    expect(routed('स्पॉटिफ़ाई खोलो')).toBe('apps.open');
    expect(args('आवाज़ तीस प्रतिशत कर दो')).toEqual({ level: 30 });
    expect(routed('ब्लूटूथ बंद करो')).toBe('system.feature');
    expect(routed('पच्चीस मिनट का टाइमर लगाओ')).toMatch(/timer/);
    expect(routed('स्क्रीनशॉट लो')).toMatch(/screenshot/);
    expect(routed('मेरी बैटरी कितनी बची है')).toBe('system.battery');
    expect(routed('अभी क्या समय हुआ है')).toMatch(/time/);
    expect(routed('मुझे शाम सात बजे माँ को फ़ोन करने की याद दिलाना')).toMatch(/remind/);
  });

  it('never turns a negation into an action', () => {
    expect(understandHindi('सिस्टम रीस्टार्ट मत करना').mapped).toBe(false);
    expect(routed('सिस्टम रीस्टार्ट मत करना')).toBe('none');
    expect(routed('laptop band mat karo')).toBe('none');
  });

  it('leaves English alone', () => {
    for (const t of ['open spotify', 'play my favorite band', 'set the volume to 30 percent', 'what is the capital of france']) {
      expect(understandHindi(t).mapped).toBe(false);
    }
    expect(routed('open spotify')).toBe('apps.open');
  });

  it('sends Hindi questions it cannot map to the language model', () => {
    expect(routed('भारत की राजधानी क्या है')).toBe('none');
    expect(understandHindi('भारत की राजधानी क्या है').hindi).toBe(true);
  });
});

describe("Whisper's phonetic Hindi spellings (taken from real transcripts)", () => {
  const cases: Array<[string, string]> = [
    ['आवास दीस प्रतिषट कर्डो', 'set the volume to 30 percent'], // आवाज़→आवास, तीस→दीस
    ['आज मोसम कैसा है?', "what's the weather"],
    ['लेब्टाब को तीस मिनत में स्लीप कर दो', 'put my laptop to sleep in 30 minutes'],
    ['ब्लुटुत बंद करों', 'turn off bluetooth'],
    ['यूट्यूम पर पुराने गानी चलाओ', 'play purane gani on youtube'],
    ['क्मपुटर लग करो', 'lock my computer'],
    ['गाना रोग तोई', 'pause'],
    ['वाई भाई चालू करो', 'turn on wi-fi'],
    ['पचीस मिनेद का ताइमर लगाओ।', 'set a timer for 25 minutes'],
    ['अभी क्या समें हुए है', 'what time is it'],
    ['मुझे शाम साथ, बजे मा को फोन करने की याज दिलाना', 'remind me to ma ko phone karna at 7 pm'],
    ['दास काटोप पर सारी पीडीएफ फाइलें ढूंढो', 'find all pdf files in my desktop folder'],
  ];
  for (const [hi, en] of cases) it(`${hi} → ${en}`, () => expect(understandHindi(hi).text).toBe(en));

  it('reads romanized Hindi from Whisper, but only when it is clearly a Hindi command', () => {
    expect(understandHindi('Spotify Kolo.').text).toBe('open spotify');
    expect(understandHindi('Screenshot low.').text).toBe('take a screenshot');
    expect(understandHindi('Chrome OpenCaro.').text).toBe('open chrome');
    for (const t of ['Screenshot this window', 'lock the computer', 'play some lo-fi', 'open the downloads folder', 'call mom', 'low battery warning']) {
      expect(understandHindi(t).mapped).toBe(false);
    }
  });

  it('keeps names and everyday words as they are', () => {
    expect(understandHindi('राहुल को ईमेल लिखो').text).toBe('draft an email to rahul about a quick update');
    expect(understandHindi('व्हाट्सएप पर प्रिया को मैसेज भेजो').text).toMatch(/^send a whatsapp message to priya/);
  });
});

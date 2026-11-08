/**
 * Regression tests for the 0.5.1 engineering audit (docs/AUDIT.md): the blueprint's example commands,
 * English never mistaken for Hinglish, Hindi replies reaching the neural voice, the cloud tool budget,
 * and a stopped cloud reply releasing the voice controller.
 */
import { describe, expect, it, vi } from 'vitest';
import { route } from '../src/main/assistant/router';
import { understandHindi } from '../src/main/assistant/hindi';
import { cloudTools, selectTools } from '../src/main/assistant/toolSelect';
import { createRegistry } from '../src/main/tools';
import { detectApps } from '../src/main/tools/apps';
import { chunkForSpeech, splitSentences, Speaker } from '../src/renderer/audio/tts';
import type { AppEntry, Routine } from '../src/shared/types';

const apps: AppEntry[] = detectApps(() => true).map((a, i) => ({ ...a, id: `a${i}` }));
const ctx = { session: {}, apps };
const idOf = (t: string, routines: Routine[] = []) => {
  const r = route(t, ctx, routines);
  return r.kind === 'commands' ? r.steps.map((s) => s.commandId).join('+') : r.kind;
};

describe('blueprint example commands', () => {
  // [phrase, expected command id] — 'none' means it goes to the language model (writing, research, explaining).
  const CASES: Array<[string, string]> = [
    ['Repeat that more slowly.', 'conv.repeat_slower'],
    ['Start a new topic.', 'conv.new'],
    ['Listen to this.', 'conv.listen'],
    ['Switch to the window I was using.', 'windows.previous_used'],
    ['Mute my laptop.', 'audio.mute'],
    ['Turn Bluetooth on.', 'system.feature'],
    ['Take a screenshot and show it to me.', 'screen.screenshot_show'],
    ['Close this app after saving my work.', 'windows.close_saved'],
    ['Search the web for the latest official documentation.', 'web.search'],
    ['Convert 5 feet 8 inches to centimetres.', 'units.feet_inches'],
    ['Find my latest project report.', 'files.find_mine'],
    ["Find duplicate files, but don't delete anything.", 'files.duplicates'],
    ['Organise these photos by date.', 'files.bulk'],
    ['Find the latest email from the college.', 'email.none'],
    ['Send this email to the selected recipient.', 'email.none'],
    ['Read my next calendar event.', 'calendar.none'],
    ['Schedule a meeting for Friday at 3 PM.', 'calendar.none'],
    ['Add milk to my shopping list.', 'shopping.add'],
    ['Play Alfaaz.', 'music.play_any'],
    ['Play something calm.', 'music.play_any'],
    ['Turn off the bedroom lights.', 'smarthome.none'],
    ['Set the desk lamp to 40 percent.', 'smarthome.none'],
    ['Turn on the fan.', 'smarthome.none'],
    ['Set the room temperature to 24 degrees.', 'smarthome.none'],
    ['Turn everything off in the living room.', 'smarthome.none'],
    ['Show the front door camera.', 'smarthome.none'],
    ['Is the front door locked?', 'smarthome.none'],
    ['Lock the front door.', 'smarthome.none'],
    ['Run my study routine.', 'routine.missing'],
    ['What do I have today?', 'agenda.today'],
    ['Start a 25-minute focus timer.', 'focus.start'],
    ['Stop the task.', 'conv.cancel'],
    ['Undo the last action if possible.', 'undo.none'],
    ['Explain this topic with examples.', 'none'],
    ['Translate this into Assamese.', 'none'],
  ];
  it.each(CASES)('"%s" → %s', (phrase, id) => expect(idOf(phrase)).toBe(id));

  it('says plainly that no smart-home device was touched', () => {
    const r = route('turn off the bedroom lights', ctx);
    const res = r.kind === 'commands' ? r.steps[0].resolution : null;
    expect(res).toMatchObject({ kind: 'builtin', builtin: 'say' });
    expect(res?.kind === 'builtin' ? String(res.params?.text) : '').toMatch(/not connected.*Nothing was changed/);
  });
  it('keeps Windows features and sound phrases on their own commands', () => {
    expect(idOf('turn on night light')).toBe('system.feature');
    expect(idOf('turn the sound off')).toBe('audio.mute');
    expect(idOf('turn wifi off')).toBe('system.feature');
  });
  it('converts feet and inches to the unit asked for', () => {
    const text = (t: string) => { const r = route(t, ctx); const res = r.kind === 'commands' ? r.steps[0].resolution : null; return res?.kind === 'builtin' ? String(res.params?.text) : ''; };
    expect(text('convert 5 feet 8 inches to centimetres')).toBe('5 feet 8 inches is 172.72 centimetres.');
    expect(text('convert 5 feet 8 inches to cm')).toBe('5 feet 8 inches is 172.72 centimetres.');
    expect(text('convert 6 feet 2 inches to metres')).toBe('6 feet 2 inches is 1.88 metres.');
  });
  it('runs a routine by its name', () => {
    const study: Routine = { id: 'r1', name: 'Study', phrases: ['study time'], steps: [{ tool: 'system.time', args: {} }], enabled: true, updatedAt: 0 };
    expect(route('run my study routine', ctx, [study]).kind).toBe('routine');
  });
  it('does not treat "repeat that" as a song', () => {
    expect(idOf('repeat that')).toBe('conv.repeat');
    expect(idOf('repeat that again please')).not.toBe('music.repeat');
  });
});

describe('English is never read as Hinglish', () => {
  const ENGLISH = [
    'Find the latest email from the college.', 'send the file to me', 'do the report for the meeting', 'what is the time in london',
    'open the downloads folder', 'set a timer for ten minutes', 'play the latest song by coldplay', 'turn off the lights in the hall',
  ];
  it.each(ENGLISH)('"%s"', (t) => expect(understandHindi(t)).toMatchObject({ hindi: false, mapped: false }));
  it('still understands romanized Hindi', () => {
    expect(understandHindi('spotify kholo').mapped).toBe(true);
    expect(understandHindi('volume badha do').mapped).toBe(true);
  });
});

describe('Hindi replies reach the neural voice', () => {
  it('keeps Devanagari sentences and splits on the danda', () => {
    const chunks = chunkForSpeech('अभी शाम के सात बजे हैं। बैटरी 80 प्रतिशत है।');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join(' ')).toContain('शाम');
    expect(splitSentences('पहला वाक्य। दूसरा वाक्य।')).toHaveLength(2);
  });
  it('still drops chunks with no words at all', () => {
    expect(chunkForSpeech('... !!!')).toEqual([]);
  });
});

describe('cloud tool budget', () => {
  const tools = createRegistry().llmTools(() => true);
  it('sends no tool definitions for plain questions', () => {
    expect(cloudTools('tell me about the roman empire', tools)).toEqual([]);
    expect(cloudTools('explain how vaccines work', tools)).toEqual([]);
  });
  it('sends a relevant handful for actions, far below the full registry', () => {
    const some = cloudTools('my speakers feel way too loud for this late hour', tools);
    expect(some.map((t) => t.name)).toContain('audio__set_volume');
    expect(JSON.stringify(some).length).toBeLessThan(JSON.stringify(tools).length / 4);
  });
  it('falls back to every tool when an action matches no topic', () => {
    expect(cloudTools('do the same thing again for the other one', tools)).toHaveLength(tools.length);
  });
  it('local models keep the short list', () => {
    expect(selectTools('turn it up a bit, the volume is low', tools).length).toBeLessThanOrEqual(6);
  });
});

describe('cloud voice stop', () => {
  it('stop() releases a reply that is still playing (pause fires no "ended")', async () => {
    class FakeAudio { volume = 1; onended: (() => void) | null = null; onerror: (() => void) | null = null; play() { return Promise.resolve(); } pause() {} }
    const analyser = { fftSize: 0, connect: vi.fn(), getByteTimeDomainData: vi.fn() };
    class FakeCtx { createAnalyser() { return analyser; } createMediaElementSource() { return { connect: vi.fn() }; } get destination() { return {}; } close() { return Promise.resolve(); } }
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('AudioContext', FakeCtx);
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('speechSynthesis', { cancel: () => {} });
    const urls = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
    vi.stubGlobal('URL', Object.assign(function () {}, urls));
    try {
      const sp = new Speaker();
      const playing = sp.playCloud(btoa('mp3'), 1);
      await Promise.resolve();
      expect(sp.isSpeaking).toBe(true);
      sp.stop();
      await expect(Promise.race([playing.then(() => 'done'), new Promise((r) => setTimeout(() => r('hung'), 200))])).resolves.toBe('done');
      expect(sp.isSpeaking).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

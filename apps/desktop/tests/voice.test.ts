import { describe, expect, it } from 'vitest';
import { VoiceController, type VoiceDeps } from '../src/renderer/voice/controller';
import { defaultSettings, mergeSettings, type DeepPartial, type Settings } from '../src/shared/settings';
import type { AssistantReply } from '../src/shared/types';

const tick = () => new Promise((r) => setTimeout(r, 5));

function harness(patch: DeepPartial<Settings> = {}, replyFor: (t: string) => Partial<AssistantReply> = () => ({}), opts: { sessionFailsWhileSpeaking?: boolean } = {}) {
  // Tests start from push-to-talk with wake off and opt in per test.
  const settings = mergeSettings(mergeSettings(defaultSettings(), { listening: { mode: 'push_to_talk', bargeIn: false }, wake: { enabled: false } }), patch);
  const log: string[] = [];
  let speaking = false;
  let micOn = false;
  let resolveSpeech: (() => void) | null = null;
  let failed = false;
  const deps: VoiceDeps = {
    settings: () => settings,
    startSession: async (m) => { if (opts.sessionFailsWhileSpeaking && m === 'command' && !failed) { failed = true; throw new Error('not ready'); } log.push(`start:${m}`); },
    stopSession: async () => { log.push('stop'); },
    cancelSession: async () => { log.push('cancel'); },
    micStart: async () => { micOn = true; },
    micStop: () => { micOn = false; },
    submit: async (text) => { log.push(`submit:${text}`); return { turnId: 't', text: 'ok', speech: 'ok', style: 'neutral', source: 'deterministic', expectFollowUp: false, ...replyFor(text) }; },
    speak: () => { speaking = true; log.push('speak'); return new Promise<void>((r) => { resolveSpeech = () => { speaking = false; r(); }; }); },
    stopSpeaking: () => { if (speaking) log.push('stopSpeaking'); speaking = false; resolveSpeech?.(); },
    isSpeaking: () => speaking,
    chime: (k) => log.push(`chime:${k}`),
    onListening: (s) => log.push(`listening:${s}`),
    onPartial: (t) => { if (t) log.push(`partial:${t}`); },
    onError: (m) => log.push(`error:${m}`),
  };
  const vc = new VoiceController(deps);
  return { vc, log, mic: () => micOn, finishSpeech: () => resolveSpeech?.(), settings };
}

describe('voice controller', () => {
  it('push-to-talk: listens only while active, submits the final transcript, then releases the mic', async () => {
    const h = harness();
    await h.vc.pressTalk();
    expect(h.mic()).toBe(true);
    expect(h.log).toContain('start:command');
    await h.vc.releaseTalk();
    const done = h.vc.handleSpeech({ type: 'final', text: 'open chrome', confidence: 0.9 });
    await tick();
    expect(h.log).toContain('submit:open chrome');
    h.finishSpeech();
    await done;
    expect(h.mic()).toBe(false);
    expect(h.vc.current).toBe('resting');
  });

  it('wake-word mode: wake → chime → command → submit → back to wake', async () => {
    const h = harness({ listening: { mode: 'wake_word' }, wake: { enabled: true } });
    await h.vc.refresh();
    expect(h.vc.current).toBe('wake');
    await h.vc.handleSpeech({ type: 'wake', phrase: 'jarvis', confidence: 0.9 });
    expect(h.log).toContain('chime:wake');
    expect(h.vc.current).toBe('command');
    const done = h.vc.handleSpeech({ type: 'final', text: 'what time is it', confidence: 0.9 });
    await tick();
    h.finishSpeech();
    await done;
    expect(h.vc.current).toBe('wake');
  });

  it('"Clicky, open Spotify" in one breath submits the command without a second listen', async () => {
    const h = harness({ listening: { mode: 'wake_word' }, wake: { enabled: true } });
    await h.vc.refresh();
    const done = h.vc.handleSpeech({ type: 'wake', phrase: 'clickyy', confidence: 0.9, verified: true, command: 'open Spotify', language: 'en' });
    await tick();
    expect(h.log).toContain('submit:open Spotify');
    expect(h.log.filter((l) => l === 'start:command')).toHaveLength(0);
    h.finishSpeech();
    await done;
    expect(h.vc.current).toBe('wake');
  });

  it('ignores wake events when not in wake state (no duplicate sessions)', async () => {
    const h = harness();
    await h.vc.handleSpeech({ type: 'wake', phrase: 'jarvis', confidence: 0.9 });
    expect(h.log.filter((l) => l === 'start:command')).toHaveLength(0);
  });

  it('wake word interrupts speech when the interruption policy is stop', async () => {
    const h = harness({ listening: { mode: 'wake_word', interruption: 'stop' }, wake: { enabled: true } });
    await h.vc.refresh();
    void h.vc.afterReply({ turnId: 't', text: 'long answer', speech: 'long answer', style: 'neutral', source: 'deterministic', expectFollowUp: false });
    await tick();
    expect(h.vc.current).toBe('speaking');
    await h.vc.handleSpeech({ type: 'wake', phrase: 'jarvis', confidence: 0.9 });
    expect(h.log).toContain('stopSpeaking');
    expect(h.vc.current).toBe('command');
  });

  it('follow-up listening after a question, and silence ends it', async () => {
    const h = harness({ listening: { mode: 'wake_word', followUpMs: 3000 }, wake: { enabled: true } }, () => ({ expectFollowUp: true }));
    await h.vc.refresh();
    await h.vc.handleSpeech({ type: 'wake', phrase: 'jarvis', confidence: 0.9 });
    const p = h.vc.handleSpeech({ type: 'final', text: 'set a timer', confidence: 0.9 });
    await tick();
    h.finishSpeech();
    await p;
    expect(h.vc.current).toBe('command');
    await h.vc.handleSpeech({ type: 'silence' });
    expect(h.vc.current).toBe('wake');
  });

  it('mute closes the microphone and blocks talking', async () => {
    const h = harness({ listening: { mode: 'wake_word' }, wake: { enabled: true } });
    await h.vc.refresh();
    expect(h.mic()).toBe(true);
    await h.vc.setMuted(true);
    expect(h.mic()).toBe(false);
    await h.vc.pressTalk();
    expect(h.log.some((l) => l.startsWith('error:The microphone is muted'))).toBe(true);
  });

  it('recovers to a resting state after a speech-engine error (e.g. disconnected mic)', async () => {
    const h = harness();
    await h.vc.pressTalk();
    await h.vc.handleSpeech({ type: 'error', code: 'disconnected', message: 'Speech service connection closed' });
    expect(h.vc.current).toBe('resting');
    expect(h.mic()).toBe(false);
  });

  it('stop cancels listening and speech', async () => {
    const h = harness();
    await h.vc.pressTalk();
    await h.vc.stop();
    expect(h.vc.current).toBe('resting');
    expect(h.log).toContain('cancel');
  });

  it('barge-in fallback: sustained voice interrupts when the speech session is unavailable', async () => {
    const h = harness({ listening: { bargeIn: true } }, undefined, { sessionFailsWhileSpeaking: true });
    void h.vc.afterReply({ turnId: 't', text: 'long answer', speech: 'long answer', style: 'neutral', source: 'deterministic', expectFollowUp: false });
    await tick();
    expect(h.vc.current).toBe('speaking');
    expect(h.mic()).toBe(true); // mic opened for barge-in
    h.vc.voiceLevel(0.1); // background noise: ignored
    h.vc.voiceLevel(0.5);
    h.vc.voiceLevel(0.5);
    expect(h.vc.current).toBe('speaking'); // two frames is not enough
    h.vc.voiceLevel(0.6);
    await h.vc['busy'];
    expect(h.log).toContain('stopSpeaking');
    expect(h.vc.current).toBe('command');
  });

  it('barge-in never fires when turned off', async () => {
    const h = harness();
    void h.vc.afterReply({ turnId: 't', text: 'x', speech: 'x', style: 'neutral', source: 'deterministic', expectFollowUp: false });
    await tick();
    for (let i = 0; i < 5; i++) h.vc.voiceLevel(0.9);
    expect(h.vc.current).toBe('speaking');
    expect(h.mic()).toBe(false);
  });

  describe('speech-aware barge-in', () => {
    const reply = (speech: string): AssistantReply => ({ turnId: 't', text: speech, speech, style: 'neutral', source: 'deterministic', expectFollowUp: false });

    it('is on by default', () => {
      expect(defaultSettings().listening.bargeIn).toBe(true);
    });

    it('keeps a recognition session running while speaking', async () => {
      const h = harness({ listening: { bargeIn: true } });
      void h.vc.afterReply(reply('The capital of Japan is Tokyo, a city of fourteen million people.'));
      await tick();
      expect(h.vc.current).toBe('speaking');
      expect(h.log).toContain('start:command');
      expect(h.mic()).toBe(true);
    });

    it('talking over the reply stops it and the same words become the command', async () => {
      const h = harness({ listening: { bargeIn: true } });
      void h.vc.afterReply(reply('Here is a long story about the history of the Roman empire and its emperors.'));
      await tick();
      void h.vc.handleSpeech({ type: 'partial', text: 'play kesariya on youtube' });
      expect(h.log).toContain('stopSpeaking');
      expect(h.vc.current).toBe('command');
      const done = h.vc.handleSpeech({ type: 'final', text: 'play kesariya on youtube', confidence: 0.9 });
      await tick();
      expect(h.log).toContain('submit:play kesariya on youtube');
      h.finishSpeech();
      await done;
    });

    it('"stop" interrupts at once', async () => {
      const h = harness({ listening: { bargeIn: true } });
      void h.vc.afterReply(reply('Here is a long story about the history of the Roman empire.'));
      await tick();
      void h.vc.handleSpeech({ type: 'partial', text: 'stop' });
      expect(h.log).toContain('stopSpeaking');
      expect(h.vc.current).toBe('command');
    });

    it('ignores its own voice leaking into the microphone and keeps listening', async () => {
      const h = harness({ listening: { bargeIn: true } });
      void h.vc.afterReply(reply('The capital of Japan is Tokyo, a city of fourteen million people.'));
      await tick();
      void h.vc.handleSpeech({ type: 'partial', text: 'the capital of japan is' });
      expect(h.vc.current).toBe('speaking');
      void h.vc.handleSpeech({ type: 'final', text: 'the capital of japan is tokyo', confidence: 0.8 });
      await tick();
      expect(h.vc.current).toBe('speaking');
      expect(h.log).not.toContain('stopSpeaking');
      expect(h.log.filter((l) => l === 'start:command').length).toBe(2); // restarted after the echo
      void h.vc.handleSpeech({ type: 'silence' });
      await tick();
      expect(h.log.filter((l) => l === 'start:command').length).toBe(3);
    });

    it('a final heard during speech is submitted without its echoed lead-in', async () => {
      const h = harness({ listening: { bargeIn: true } });
      void h.vc.afterReply(reply('The capital of Japan is Tokyo.'));
      await tick();
      const done = h.vc.handleSpeech({ type: 'final', text: 'the capital of open notepad', confidence: 0.8 });
      await tick();
      expect(h.log).toContain('submit:open notepad');
      h.finishSpeech();
      await done;
    });

    it('closes the barge-in session when the reply finishes uninterrupted', async () => {
      const h = harness({ listening: { bargeIn: true } });
      const p = h.vc.afterReply(reply('Done.'));
      await tick();
      h.finishSpeech();
      await p;
      expect(h.log).toContain('cancel');
      expect(h.vc.current).toBe('resting');
    });
  });

  it('command timeout flushes and returns to rest', async () => {
    const h = harness({ listening: { commandTimeoutMs: 2000 } });
    await h.vc.pressTalk();
    await new Promise((r) => setTimeout(r, 2100));
    await h.vc['busy'];
    expect(h.log).toContain('stop');
    await new Promise((r) => setTimeout(r, 1600));
    await h.vc['busy'];
    expect(h.vc.current).toBe('resting');
  }, 8000);
});

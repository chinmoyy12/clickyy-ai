import type { Settings } from '@shared/settings';
import type { AssistantReply, SpeechEvent } from '@shared/types';

export interface VoiceDeps {
  settings(): Settings;
  startSession(mode: 'wake' | 'command'): Promise<void>;
  stopSession(): Promise<void>;
  cancelSession(): Promise<void>;
  micStart(): Promise<void>;
  micStop(): void;
  submit(text: string): Promise<AssistantReply>;
  speak(reply: AssistantReply): Promise<void>;
  stopSpeaking(): void;
  isSpeaking(): boolean;
  chime(kind: 'wake' | 'done' | 'error'): void;
  onListening(state: 'off' | 'wake' | 'command'): void;
  onPartial(text: string): void;
  onError(message: string): void;
}

type State = 'resting' | 'wake' | 'command' | 'submitting' | 'speaking';

/**
 * Coordinates microphone, wake detection, command capture, assistant replies,
 * speech playback and follow-up listening. There is at most one recognition
 * session at a time, and the microphone is only open in 'wake' or 'command'.
 */
export class VoiceController {
  private state: State = 'resting';
  private muted = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private followUp = false;
  private conversation = false;
  private busy: Promise<void> = Promise.resolve();

  constructor(private d: VoiceDeps) {}

  get current() { return this.state; }
  get isMuted() { return this.muted; }
  get inConversation() { return this.conversation; }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Serializes transitions so rapid events can't spawn overlapping sessions. */
  private run(fn: () => Promise<void>) {
    this.busy = this.busy.then(fn).catch((e) => {
      this.d.onError((e as Error).message);
      this.toRestingNow();
    });
    return this.busy;
  }

  private wantsWake(): boolean {
    const s = this.d.settings();
    return !this.muted && s.listening.mode === 'wake_word' && s.wake.enabled && Object.values(s.wake.phrases).some(Boolean);
  }

  private toRestingNow() {
    this.clearTimer();
    this.state = 'resting';
    this.followUp = false;
    this.d.micStop();
    this.d.onListening('off');
    this.d.onPartial('');
  }

  private async rest() {
    this.clearTimer();
    this.followUp = false;
    this.d.onPartial('');
    if (this.wantsWake()) {
      await this.d.micStart();
      await this.d.startSession('wake');
      this.state = 'wake';
      this.d.onListening('wake');
    } else {
      await this.d.cancelSession();
      this.d.micStop();
      this.state = 'resting';
      this.d.onListening('off');
    }
  }

  private async listenForCommand(timeoutMs: number) {
    if (this.muted) return;
    await this.d.micStart();
    await this.d.startSession('command');
    this.state = 'command';
    this.d.onListening('command');
    this.clearTimer();
    this.timer = setTimeout(() => void this.run(async () => {
      if (this.state !== 'command') return;
      // Nothing heard in time: flush what we have; a 'silence' or 'final' event follows.
      await this.d.stopSession();
      this.timer = setTimeout(() => void this.run(async () => { if (this.state === 'command') { this.conversation = false; await this.rest(); } }), 1500);
    }), timeoutMs);
  }

  /** Re-evaluate after settings changes (mode, wake phrases, mute). */
  refresh() {
    return this.run(async () => { if (this.state === 'resting' || this.state === 'wake') await this.rest(); });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    return this.run(async () => {
      if (muted) {
        this.conversation = false;
        await this.d.cancelSession();
        this.toRestingNow();
      } else if (this.state === 'resting') {
        await this.rest();
      }
    });
  }

  /** Push-to-talk / mic button pressed. Interrupts speech (barge-in). */
  pressTalk() {
    return this.run(async () => {
      if (this.muted) throw new Error('The microphone is muted. Unmute it to talk.');
      if (this.d.isSpeaking()) this.d.stopSpeaking();
      if (this.state === 'command') return;
      if (this.state === 'wake') await this.d.cancelSession();
      await this.listenForCommand(this.d.settings().listening.commandTimeoutMs);
    });
  }

  /** Push-to-talk released: finish the utterance. */
  releaseTalk() {
    return this.run(async () => { if (this.state === 'command') await this.d.stopSession(); });
  }

  startConversation() {
    this.conversation = true;
    return this.pressTalk();
  }

  /** Stop button / Escape: stop speaking, cancel listening, end conversation. */
  stop() {
    this.conversation = false;
    this.d.stopSpeaking();
    return this.run(async () => {
      await this.d.cancelSession();
      await this.rest();
    });
  }

  handleSpeech(ev: SpeechEvent) {
    switch (ev.type) {
      case 'wake':
        return this.run(async () => {
          if (this.state !== 'wake' && !(this.state === 'speaking' && this.d.settings().listening.interruption === 'stop')) return;
          if (this.d.isSpeaking()) this.d.stopSpeaking();
          if (this.d.settings().wake.chime) this.d.chime('wake');
          await this.d.cancelSession();
          await this.listenForCommand(this.d.settings().listening.commandTimeoutMs);
        });
      case 'partial':
        if (this.state === 'command') this.d.onPartial(ev.text);
        return;
      case 'final':
        return this.run(async () => {
          if (this.state !== 'command') return;
          this.clearTimer();
          await this.d.cancelSession();
          this.d.onPartial('');
          this.state = 'submitting';
          this.d.onListening('off');
          if (!this.wantsWake()) this.d.micStop();
          const reply = await this.d.submit(ev.text);
          await this.afterReply(reply);
        });
      case 'silence':
        return this.run(async () => {
          if (this.state !== 'command') return;
          // An empty follow-up window ends the conversation quietly.
          if (this.followUp || this.conversation) this.conversation = false;
          await this.d.cancelSession();
          await this.rest();
        });
      case 'error':
        return this.run(async () => {
          this.d.onError(ev.message);
          this.conversation = false;
          if (this.state === 'command' || this.state === 'wake') await this.rest().catch(() => this.toRestingNow());
        });
      default:
        return;
    }
  }

  /** Text-typed replies also go through here so speech + follow-up behave the same. */
  async afterReply(reply: AssistantReply) {
    if (reply.speech && this.d.settings().speech.ttsEngine !== 'off') {
      this.state = 'speaking';
      if (this.wantsWake() && this.d.settings().listening.interruption === 'stop') {
        // Keep wake detection running during speech so "Jarvis…" can interrupt.
        await this.d.startSession('wake');
        this.d.onListening('wake');
      }
      await this.d.speak(reply);
      if (this.state !== 'speaking') return; // interrupted
    }
    const s = this.d.settings();
    const endConvo = /^(okay\. call me|talk soon|alright, i'll be here|okay\.$|standing by)/i.test(reply.text);
    if (endConvo) this.conversation = false;
    const listenAgain = !this.muted && (this.conversation || (reply.expectFollowUp && s.listening.mode !== 'push_to_talk')) && s.listening.followUpMs > 0;
    if (listenAgain) {
      this.followUp = true;
      await this.d.cancelSession();
      await this.listenForCommand(s.listening.followUpMs);
    } else {
      await this.rest();
    }
  }

  dispose() {
    this.clearTimer();
    this.d.stopSpeaking();
    void this.d.cancelSession();
    this.d.micStop();
  }
}

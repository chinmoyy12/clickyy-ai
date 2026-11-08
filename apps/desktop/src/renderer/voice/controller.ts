import type { Settings } from '@shared/settings';
import type { AssistantReply, SpeechEvent } from '@shared/types';
import { isBargeIn, stripEcho } from './echo';

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
  private loudFrames = 0;
  /** A recognition session is running during speech to catch interruptions (barge-in). */
  private bargeSession = false;
  /** What Clickyy is (or was just) saying, to filter its own echo out of what the mic hears. */
  private echoRef = '';

  /** Barge-in threshold on the normalized mic level (0..1) and frames (100 ms each) of sustained voice. */
  static readonly BARGE_LEVEL = 0.32;
  static readonly BARGE_FRAMES = 3;

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
    this.echoRef = '';
    this.bargeSession = false;
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
    this.armCommandTimer(timeoutMs);
  }

  private armCommandTimer(timeoutMs: number) {
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
          const said = ev.command?.trim();
          if (said && said.length > 1) {
            // "Clicky, open Spotify" in one breath: run it straight away, like a smart speaker.
            this.state = 'submitting';
            this.d.onListening('off');
            this.d.onPartial(said);
            if (!this.wantsWake()) this.d.micStop();
            const reply = await this.d.submit(said);
            this.d.onPartial('');
            await this.afterReply(reply);
            return;
          }
          await this.listenForCommand(this.d.settings().listening.commandTimeoutMs);
        });
      case 'partial':
        if (this.state === 'command') this.d.onPartial(this.echoRef ? stripEcho(ev.text, this.echoRef) : ev.text);
        else if (this.state === 'speaking' && this.bargeSession && isBargeIn(ev.text, this.echoRef, false)) {
          // The user started talking over the reply: stop speaking and keep this same session
          // running as their command, so the first words aren't lost.
          this.interruptSpeech();
          this.d.onPartial(stripEcho(ev.text, this.echoRef));
        }
        return;
      case 'final':
        if (this.state === 'speaking' && this.bargeSession) {
          if (isBargeIn(ev.text, this.echoRef, true)) {
            const text = stripEcho(ev.text, this.echoRef);
            this.interruptSpeech();
            return this.run(() => this.submitCommand(text));
          }
          this.restartBargeSession(); // only our own voice was heard: keep listening for the user
          return;
        }
        return this.run(async () => {
          if (this.state !== 'command') return;
          await this.submitCommand(this.echoRef ? stripEcho(ev.text, this.echoRef) : ev.text);
        });
      case 'silence':
        if (this.state === 'speaking' && this.bargeSession) { this.restartBargeSession(); return; }
        return this.run(async () => {
          if (this.state !== 'command') return;
          // An empty follow-up window ends the conversation quietly.
          if (this.followUp || this.conversation) this.conversation = false;
          await this.d.cancelSession();
          await this.rest();
        });
      case 'error':
        if (this.state === 'speaking' && this.bargeSession) { this.bargeSession = false; return; } // fall back to loudness barge-in
        return this.run(async () => {
          this.d.onError(ev.message);
          this.conversation = false;
          if (this.state === 'command' || this.state === 'wake') await this.rest().catch(() => this.toRestingNow());
        });
      default:
        return;
    }
  }

  private async submitCommand(text: string) {
    if (this.state !== 'command') return;
    this.clearTimer();
    this.echoRef = '';
    await this.d.cancelSession();
    this.d.onPartial('');
    this.state = 'submitting';
    this.d.onListening('off');
    if (!this.wantsWake()) this.d.micStop();
    const reply = await this.d.submit(text);
    await this.afterReply(reply);
  }

  /**
   * Synchronous on purpose: afterReply() is awaiting speak() inside the serialized chain, so
   * the state must change before speech stops for it to see the interruption.
   */
  private interruptSpeech() {
    this.bargeSession = false;
    this.loudFrames = 0;
    this.state = 'command';
    this.d.stopSpeaking();
    this.d.onListening('command');
    this.armCommandTimer(this.d.settings().listening.commandTimeoutMs);
  }

  private restartBargeSession() {
    void this.d.startSession('command').catch(() => { this.bargeSession = false; }).then(() => {
      // Speech may have ended (or been interrupted) while the session was restarting.
      if (this.state !== 'speaking' && this.state !== 'command') void this.d.cancelSession();
    });
  }

  /**
   * Mic level while Clickyy is speaking. Sustained voice (echo-cancelled) interrupts the
   * reply and starts listening. Only used when the speech-aware barge-in session couldn't start.
   */
  voiceLevel(level: number) {
    if (this.state !== 'speaking' || this.muted || this.bargeSession || !this.d.settings().listening.bargeIn) {
      this.loudFrames = 0;
      return;
    }
    this.loudFrames = level >= VoiceController.BARGE_LEVEL ? this.loudFrames + 1 : 0;
    if (this.loudFrames >= VoiceController.BARGE_FRAMES) {
      this.loudFrames = 0;
      this.d.stopSpeaking();
      void this.run(async () => {
        if (this.state !== 'speaking') return;
        await this.d.cancelSession();
        await this.listenForCommand(this.d.settings().listening.commandTimeoutMs);
      });
    }
  }

  /** Text-typed replies also go through here so speech + follow-up behave the same. */
  async afterReply(reply: AssistantReply) {
    if (reply.speech && this.d.settings().speech.ttsEngine !== 'off') {
      this.state = 'speaking';
      this.loudFrames = 0;
      this.echoRef = reply.speech;
      this.bargeSession = false;
      const ls = this.d.settings().listening;
      if (ls.bargeIn && !this.muted) {
        await this.d.micStart().catch(() => {});
        // Listen while speaking: the user can talk over the reply and be understood.
        this.bargeSession = await this.d.startSession('command').then(() => true, () => false);
        if (this.bargeSession) this.d.onListening('wake');
      }
      if (!this.bargeSession && this.wantsWake() && ls.interruption === 'stop') {
        // Keep wake detection running during speech so "Clicky…" can interrupt.
        await this.d.startSession('wake');
        this.d.onListening('wake');
      }
      await this.d.speak(reply);
      if (this.state !== 'speaking') return; // interrupted
      if (this.bargeSession) {
        this.bargeSession = false;
        await this.d.cancelSession();
      }
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

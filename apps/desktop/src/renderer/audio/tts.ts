import type { ExpressionStyle } from '@shared/types';

export interface VoiceInfo { name: string; lang: string; local: boolean; feminine: boolean; isDefault: boolean }

/** Names of Windows voices with a feminine presentation (used only to rank defaults; the user picks). */
const FEMININE = /(zira|aria|jenny|eva|hazel|susan|libby|sonia|natasha|clara|michelle|ana|emma|ava|sara|heera|catherine|linda|hedda|female|woman)/i;

export function listVoices(): VoiceInfo[] {
  return speechSynthesis.getVoices().map((v) => ({ name: v.name, lang: v.lang, local: v.localService, feminine: FEMININE.test(v.name), isDefault: v.default }));
}

export function waitForVoices(timeoutMs = 2000): Promise<VoiceInfo[]> {
  const now = listVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(listVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, timeoutMs);
  });
}

/** Preferred voice: the user's choice if installed, else a local en feminine voice, else any local voice. */
export function pickVoice(preferred: string): SpeechSynthesisVoice | null {
  const all = speechSynthesis.getVoices();
  return all.find((v) => v.name === preferred)
    ?? all.find((v) => v.localService && /^en/i.test(v.lang) && FEMININE.test(v.name))
    ?? all.find((v) => v.localService && /^en/i.test(v.lang))
    ?? all[0] ?? null;
}

export function splitSentences(text: string): string[] {
  // "।" (danda) ends Hindi sentences.
  return (text.match(/[^.!?…।]+[.!?…।]+["')\]]*|[^.!?…।]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/**
 * Speech-sized chunks: the first chunk is kept short so the voice starts quickly;
 * long sentences are split at commas; tiny fragments are merged.
 */
export function chunkForSpeech(text: string): string[] {
  const out: string[] = [];
  for (const s of splitSentences(text)) {
    if (s.length > 160) {
      let cur = '';
      for (const part of s.split(/(?<=[,;:])\s+/)) {
        if ((cur + ' ' + part).length > 140 && cur) { out.push(cur.trim()); cur = part; } else cur = `${cur} ${part}`;
      }
      if (cur.trim()) out.push(cur.trim());
    } else out.push(s);
  }
  const merged: string[] = [];
  for (const c of out) {
    const last = merged[merged.length - 1];
    if (last && last.length < 25 && merged.length > 1) merged[merged.length - 1] = `${last} ${c}`;
    else merged.push(c);
  }
  if (merged[0] && merged[0].length > 120) {
    const m = merged[0].match(/^(.{20,110}?[,;:])\s+(.*)$/);
    if (m) merged.splice(0, 1, m[1], m[2]);
  }
  // Any letter or digit in any script: a Latin-only test dropped every Hindi (Devanagari) sentence, so Hindi replies were silent.
  return merged.filter((c) => /[\p{L}\p{N}]/u.test(c));
}

export interface SpeakOptions { voiceName: string; rate: number; pitch: number; volume: number; style: ExpressionStyle }

type Listener = (speaking: boolean) => void;

/**
 * Sentence-by-sentence playback so speech starts quickly and can be stopped
 * between sentences instantly. Two engines: Windows voices through
 * speechSynthesis (offline), or cloud MP3 audio played through WebAudio with
 * a real amplitude meter.
 */
export class Speaker {
  private queue: string[] = [];
  private speaking = false;
  private generation = 0;
  private audio: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private raf = 0;
  private endCloud: (() => void) | null = null;
  onState: Listener = () => {};
  onLevel: (level: number) => void = () => {};

  get isSpeaking() { return this.speaking; }

  private setSpeaking(v: boolean) {
    if (this.speaking === v) return;
    this.speaking = v;
    this.onState(v);
  }

  async speakSystem(text: string, o: SpeakOptions): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    this.queue = splitSentences(text);
    // Chromium loads the voice list asynchronously; wait for it on first use.
    if (!speechSynthesis.getVoices().length) await waitForVoices(3000);
    if (gen !== this.generation) return;
    const voice = pickVoice(o.voiceName);
    if (!voice) throw new Error('No speech voices are installed on this PC.');
    this.setSpeaking(true);
    while (this.queue.length && gen === this.generation) {
      const sentence = this.queue.shift()!;
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(sentence);
        u.voice = voice;
        u.lang = voice.lang;
        u.rate = o.rate;
        u.pitch = o.pitch;
        u.volume = o.volume;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        speechSynthesis.speak(u);
      });
      // a natural micro-pause between sentences
      if (this.queue.length && gen === this.generation) await new Promise((r) => setTimeout(r, 60));
    }
    if (gen === this.generation) this.setSpeaking(false);
  }

  private neuralCtx: AudioContext | null = null;
  private neuralSource: AudioBufferSourceNode | null = null;

  /**
   * Neural voice: synthesize sentence N+1 while sentence N plays, so speech is
   * continuous. Drives the orb from the real output amplitude.
   */
  async speakNeural(text: string, synth: (sentence: string) => Promise<string>, volume: number): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    const chunks = chunkForSpeech(text);
    if (!chunks.length) return;
    const ctx = this.neuralCtx ?? (this.neuralCtx = new AudioContext());
    if (ctx.state === 'suspended') await ctx.resume();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    gain.connect(analyser).connect(ctx.destination);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (gen !== this.generation) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      this.onLevel(Math.min(1, Math.sqrt(sum / data.length) * 5));
      this.raf = requestAnimationFrame(tick);
    };
    this.setSpeaking(true);
    tick();
    // Prefetched sentences may fail after playback was stopped; mark them handled so nothing goes unhandled.
    const prefetch = (c: string) => { const p = synth(c); p.catch(() => {}); return p; };
    let next: Promise<string> = prefetch(chunks[0]);
    try {
      for (let i = 0; i < chunks.length && gen === this.generation; i++) {
        const b64 = await next;
        if (gen !== this.generation) break;
        if (i + 1 < chunks.length) next = prefetch(chunks[i + 1]);
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const buffer = await ctx.decodeAudioData(bytes.buffer);
        if (gen !== this.generation) break;
        await new Promise<void>((resolve) => {
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(gain);
          src.onended = () => resolve();
          this.neuralSource = src;
          src.start();
        });
      }
    } finally {
      if (gen === this.generation) this.stop();
      gain.disconnect();
    }
  }

  async playCloud(base64Mp3: string, volume: number): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    const blob = new Blob([Uint8Array.from(atob(base64Mp3), (c) => c.charCodeAt(0))], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = volume;
    this.audio = audio;
    const ctx = new AudioContext();
    this.audioCtx = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaElementSource(audio).connect(analyser);
    analyser.connect(ctx.destination);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      this.onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      this.raf = requestAnimationFrame(tick);
    };
    this.setSpeaking(true);
    tick();
    await new Promise<void>((resolve) => {
      // pause() fires no "ended" event: stop() calls this so a stopped reply doesn't hang the voice controller.
      this.endCloud = resolve;
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      void audio.play().catch(() => resolve());
    });
    this.endCloud = null;
    URL.revokeObjectURL(url);
    if (gen === this.generation) this.stop();
  }

  stop() {
    this.generation++;
    this.queue = [];
    try { this.neuralSource?.stop(); } catch { /* already stopped */ }
    this.neuralSource = null;
    speechSynthesis.cancel();
    cancelAnimationFrame(this.raf);
    this.audio?.pause();
    this.audio = null;
    const end = this.endCloud;
    this.endCloud = null;
    end?.();
    void this.audioCtx?.close();
    this.audioCtx = null;
    this.onLevel(0);
    this.setSpeaking(false);
  }
}

/** Short original chimes synthesized with WebAudio (no bundled audio assets). */
export function chime(kind: 'wake' | 'done' | 'error', volume = 0.25) {
  const ctx = new AudioContext();
  const notes = kind === 'wake' ? [660, 990] : kind === 'done' ? [880, 660] : [330, 247];
  notes.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const t = ctx.currentTime + i * 0.09;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.25);
  });
  setTimeout(() => void ctx.close(), 700);
}

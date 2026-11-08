/**
 * Microphone capture. The stream is opened only while Clickyy is listening and
 * fully released (tracks stopped) when listening stops, so the Windows
 * microphone-in-use indicator reflects reality.
 */
export class Mic {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  onFrame: (frame: ArrayBuffer) => void = () => {};
  onLevel: (level: number) => void = () => {};
  onLost: (reason: string) => void = () => {};

  private opening: Promise<void> | null = null;
  /** Bumped by stop(): a start() still waiting for the device sees it and releases what it opened. */
  private epoch = 0;

  get active() { return !!this.stream; }

  start(): Promise<void> {
    if (this.stream) return Promise.resolve();
    // Concurrent starts share one open (two streams would leave one running with the mic light on). An open
    // that a stop() overtook releases its device, so a start after that stop queues a fresh open behind it.
    if (!this.opening || this.openingEpoch !== this.epoch) {
      this.openingEpoch = this.epoch;
      const p: Promise<void> = (this.opening ?? Promise.resolve()).catch(() => {}).then(() => (this.stream ? undefined : this.open()))
        .finally(() => { if (this.opening === p) this.opening = null; });
      this.opening = p;
    }
    return this.opening;
  }
  private openingEpoch = -1;

  private async open(): Promise<void> {
    const epoch = this.epoch;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const name = (e as DOMException).name;
      throw new Error(
        name === 'NotAllowedError' ? 'Microphone access was denied. Check Windows Settings > Privacy > Microphone ("Let desktop apps access your microphone").'
          : name === 'NotFoundError' ? 'No microphone was found. Connect one and try again.'
            : `Could not open the microphone: ${(e as Error).message}`,
      );
    }
    const release = () => { stream.getTracks().forEach((t) => t.stop()); void ctx.close(); };
    const ctx = new AudioContext();
    try {
      await ctx.audioWorklet.addModule('./pcm-worklet.js');
    } catch (e) {
      release();
      throw new Error(`Could not start audio capture: ${(e as Error).message}`);
    }
    // stop() was called while the device was opening: don't keep a microphone nobody wants.
    if (epoch !== this.epoch) { release(); return; }
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-capture');
    node.port.onmessage = (e: MessageEvent<{ frame: ArrayBuffer; level: number }>) => {
      this.onFrame(e.data.frame);
      this.onLevel(Math.min(1, e.data.level * 6));
    };
    src.connect(node);
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => { this.stop(); this.onLost('The microphone was disconnected.'); }));
    this.ctx = ctx;
    this.stream = stream;
    this.node = node;
  }

  stop() {
    this.epoch++;
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.node = null;
    this.stream = null;
    this.ctx = null;
    this.onLevel(0);
  }
}

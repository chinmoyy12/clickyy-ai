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

  get active() { return !!this.stream; }

  async start(): Promise<void> {
    if (this.stream) return;
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
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule('./pcm-worklet.js');
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

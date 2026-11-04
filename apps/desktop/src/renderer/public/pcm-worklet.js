// AudioWorklet: converts the microphone stream to 16 kHz mono PCM16 frames (100 ms)
// and reports RMS level. Runs only while Clickyy is actively capturing.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0;
    this.sum = 0;
    this.count = 0;
    this.out = new Int16Array(1600);
    this.pos = 0;
    this.levelSum = 0;
    this.levelN = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      this.levelSum += v * v;
      this.levelN++;
      // Box-filter decimation to 16 kHz.
      this.sum += v;
      this.count++;
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        const s = Math.max(-1, Math.min(1, this.sum / this.count));
        this.out[this.pos++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        this.sum = 0;
        this.count = 0;
        if (this.pos === this.out.length) {
          const frame = this.out.buffer.slice(0);
          const level = Math.sqrt(this.levelSum / Math.max(1, this.levelN));
          this.port.postMessage({ frame, level }, [frame]);
          this.pos = 0;
          this.levelSum = 0;
          this.levelN = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);

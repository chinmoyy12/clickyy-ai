import { DIM, type Sparse } from './features';

/**
 * A small feed-forward neural network: sparse features → hidden layer (ReLU) → softmax over intents.
 * Trained offline from Clickyy's own command catalog (scripts/train-brain.mjs) and shipped as
 * int8-quantized weights, so it runs in well under a millisecond with no internet and no API key.
 */
export interface NetWeights {
  labels: string[];
  hidden: number;
  dataHash: string;
  /** base64 int8 matrices with a per-matrix scale. */
  w1: string; s1: number; b1: number[];
  w2: string; s2: number; b2: number[];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class IntentNet {
  readonly labels: string[];
  readonly hidden: number;
  /** W1 is DIM × hidden (row per feature bucket), W2 is hidden × classes. */
  private w1: Float32Array;
  private b1: Float32Array;
  private w2: Float32Array;
  private b2: Float32Array;

  constructor(labels: string[], hidden: number, w1?: Float32Array, b1?: Float32Array, w2?: Float32Array, b2?: Float32Array, seed = 7) {
    this.labels = labels;
    this.hidden = hidden;
    const K = labels.length;
    const r = rng(seed);
    const init = (n: number, scale: number) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = (r() * 2 - 1) * scale; return a; };
    this.w1 = w1 ?? init(DIM * hidden, Math.sqrt(6 / (64 + hidden)));
    this.b1 = b1 ?? new Float32Array(hidden);
    this.w2 = w2 ?? init(hidden * K, Math.sqrt(6 / (hidden + K)));
    this.b2 = b2 ?? new Float32Array(K);
  }

  private forward(x: Sparse) {
    const H = this.hidden;
    const K = this.labels.length;
    const h = new Float32Array(H);
    h.set(this.b1);
    for (let i = 0; i < x.idx.length; i++) {
      const row = x.idx[i] * H;
      const v = x.val[i];
      for (let j = 0; j < H; j++) h[j] += this.w1[row + j] * v;
    }
    for (let j = 0; j < H; j++) if (h[j] < 0) h[j] = 0;
    const z = new Float32Array(K);
    z.set(this.b2);
    for (let j = 0; j < H; j++) {
      const hj = h[j];
      if (!hj) continue;
      const row = j * K;
      for (let k = 0; k < K; k++) z[k] += this.w2[row + k] * hj;
    }
    let max = -Infinity;
    for (let k = 0; k < K; k++) if (z[k] > max) max = z[k];
    let sum = 0;
    for (let k = 0; k < K; k++) { z[k] = Math.exp(z[k] - max); sum += z[k]; }
    for (let k = 0; k < K; k++) z[k] /= sum;
    return { h, p: z };
  }

  /** Class probabilities, highest first. */
  predict(x: Sparse, top = 3): Array<{ label: string; p: number }> {
    const { p } = this.forward(x);
    return [...p].map((v, i) => ({ label: this.labels[i], p: v })).sort((a, b) => b.p - a.p).slice(0, top);
  }

  /** Mini-batch-free SGD with momentum, cross-entropy loss and light weight decay. Deterministic for a given seed. */
  train(data: Array<{ x: Sparse; y: number }>, opts: { epochs: number; lr: number; seed?: number; onEpoch?: (e: number, loss: number, acc: number) => void }) {
    const H = this.hidden;
    const K = this.labels.length;
    const r = rng(opts.seed ?? 11);
    const order = data.map((_, i) => i);
    const decay = 1e-5;
    for (let e = 0; e < opts.epochs; e++) {
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const lr = opts.lr * (1 - e / opts.epochs) + opts.lr * 0.05;
      let loss = 0;
      let correct = 0;
      for (const n of order) {
        const { x, y } = data[n];
        const { h, p } = this.forward(x);
        loss -= Math.log(p[y] + 1e-9);
        let best = 0;
        for (let k = 1; k < K; k++) if (p[k] > p[best]) best = k;
        if (best === y) correct++;
        // dz = p - onehot(y)
        const dz = p;
        dz[y] -= 1;
        // hidden gradient (before updating W2)
        const dh = new Float32Array(H);
        for (let j = 0; j < H; j++) {
          if (!h[j]) continue;
          const row = j * K;
          let s = 0;
          for (let k = 0; k < K; k++) s += this.w2[row + k] * dz[k];
          dh[j] = s;
        }
        for (let j = 0; j < H; j++) {
          const hj = h[j];
          if (!hj) continue;
          const row = j * K;
          for (let k = 0; k < K; k++) this.w2[row + k] -= lr * (dz[k] * hj + decay * this.w2[row + k]);
        }
        for (let k = 0; k < K; k++) this.b2[k] -= lr * dz[k];
        for (let i = 0; i < x.idx.length; i++) {
          const row = x.idx[i] * H;
          const v = x.val[i];
          for (let j = 0; j < H; j++) if (dh[j]) this.w1[row + j] -= lr * dh[j] * v;
        }
        for (let j = 0; j < H; j++) this.b1[j] -= lr * dh[j];
      }
      opts.onEpoch?.(e, loss / data.length, correct / data.length);
    }
  }

  toWeights(dataHash: string): NetWeights {
    const q = (a: Float32Array) => {
      let m = 0;
      for (const v of a) m = Math.max(m, Math.abs(v));
      const s = m / 127 || 1;
      const b = Buffer.alloc(a.length);
      for (let i = 0; i < a.length; i++) b.writeInt8(Math.max(-127, Math.min(127, Math.round(a[i] / s))), i);
      return { data: b.toString('base64'), scale: s };
    };
    const w1 = q(this.w1);
    const w2 = q(this.w2);
    const r4 = (a: Float32Array) => [...a].map((v) => Math.round(v * 1e4) / 1e4);
    return { labels: this.labels, hidden: this.hidden, dataHash, w1: w1.data, s1: w1.scale, b1: r4(this.b1), w2: w2.data, s2: w2.scale, b2: r4(this.b2) };
  }

  static fromWeights(w: NetWeights): IntentNet {
    const dq = (b64: string, s: number) => { const b = Buffer.from(b64, 'base64'); const a = new Float32Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.readInt8(i) * s; return a; };
    return new IntentNet(w.labels, w.hidden, dq(w.w1, w.s1), Float32Array.from(w.b1), dq(w.w2, w.s2), Float32Array.from(w.b2));
  }
}

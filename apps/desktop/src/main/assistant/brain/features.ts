/**
 * Turns a sentence into a sparse feature vector for the on-device intent network:
 * words, word pairs and character trigrams, hashed into a fixed number of buckets
 * (the "hashing trick"), so unseen words still share signal with known ones
 * ("screenshots" overlaps "screenshot"; misheard "batery" overlaps "battery").
 */
export const DIM = 4096;

export type Sparse = { idx: Int32Array; val: Float32Array };

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function tokens(text: string): string[] {
  return text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}' ]+/gu, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
}

export function featurize(text: string): Sparse {
  const w = tokens(text);
  const acc = new Map<number, number>();
  const add = (f: string, v: number) => { const k = fnv1a(f) % DIM; acc.set(k, (acc.get(k) ?? 0) + v); };
  for (let i = 0; i < w.length; i++) {
    add(`w:${w[i]}`, 1);
    if (i + 1 < w.length) add(`b:${w[i]}_${w[i + 1]}`, 0.8);
    const padded = `#${w[i]}#`;
    for (let j = 0; j + 3 <= padded.length; j++) add(`c:${padded.slice(j, j + 3)}`, 0.35);
  }
  if (!w.length) add('empty', 1);
  add(`len:${Math.min(w.length, 12)}`, 0.5); // short commands vs long questions
  let norm = 0;
  for (const v of acc.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  const idx = new Int32Array(acc.size);
  const val = new Float32Array(acc.size);
  let i = 0;
  for (const [k, v] of acc) { idx[i] = k; val[i] = v / norm; i++; }
  return { idx, val };
}

/** Cosine similarity of two normalized sparse vectors. */
export function cosine(a: Sparse, b: Sparse): number {
  const m = new Map<number, number>();
  for (let i = 0; i < a.idx.length; i++) m.set(a.idx[i], a.val[i]);
  let s = 0;
  for (let i = 0; i < b.idx.length; i++) s += (m.get(b.idx[i]) ?? 0) * b.val[i];
  return s;
}

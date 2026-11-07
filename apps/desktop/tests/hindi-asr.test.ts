import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { route } from '../src/main/assistant/router';
import { detectApps } from '../src/main/tools/apps';
import type { AppEntry } from '../src/shared/types';

/**
 * End-to-end Hindi understanding on REAL recognizer output: each row is what Whisper actually
 * wrote for a synthetic Hindi/Hinglish clip (clean, noisy, babble, room, quiet, far), exported
 * by services/assistant/eval/export_hindi_hyps.py. The transcript must reach the same command
 * as the clean reference sentence.
 */
const fixture = join(__dirname, 'fixtures', 'hindi-asr.json');
const apps: AppEntry[] = detectApps(() => true).map((a, i) => ({ ...a, id: `a${i}` }));
const ctx = { session: {}, apps, browser: 'default' as const, browsers: ['chrome', 'edge'] as ('chrome' | 'edge')[] };
const routed = (t: string) => {
  const r = route(t, ctx);
  return r.kind === 'commands' ? r.steps.map((s) => s.commandId).join(' + ') : 'none';
};

describe.skipIf(!existsSync(fixture))('Hindi understanding on real Whisper transcripts', () => {
  const { model, rows } = JSON.parse(readFileSync(fixture, 'utf8')) as { model: string; rows: Array<{ text: string; hyp: string; lang: string; condition: string; voice: string }> };

  it(`routes ${model} transcripts like the reference sentences`, () => {
    const scored = rows.map((r) => ({ ...r, want: routed(r.text), got: routed(r.hyp) }));
    const comparable = scored.filter((r) => r.want !== 'none');
    const ok = comparable.filter((r) => r.got === r.want);
    const rate = ok.length / comparable.length;
    const misses = comparable.filter((r) => r.got !== r.want).map((r) => `[${r.condition}] ${r.text} -> "${r.hyp}" => ${r.got} (want ${r.want})`);
    console.log(`Hindi end-to-end: ${ok.length}/${comparable.length} (${(rate * 100).toFixed(1)}%)\n  ${misses.slice(0, 25).join('\n  ')}`);
    expect(rate).toBeGreaterThanOrEqual(FLOOR);
  });

  it('never turns a negated Hindi command into an action', () => {
    for (const r of rows.filter((x) => /मत|नहीं/.test(x.hyp))) expect(routed(r.hyp)).not.toMatch(/restart|shutdown/);
  });
});

/** Regression floor: the measured rate when this fixture was exported (see TEST_PLAN.md). */
const FLOOR = 0.72;

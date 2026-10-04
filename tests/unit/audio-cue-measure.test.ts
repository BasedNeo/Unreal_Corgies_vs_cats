// W15 A-HOOK: the six shared cues measured (tools/audio/measure-cues.mjs), and the guard on the one confusable pair.
// HUD_CONTRACT §3: your slab tick and the enemy's must differ in length or pitch. The guard fails when the spectral
// centroid gap (power-weighted) is under 150 Hz AND the audible-length gap (onset to -40 dB) is under 20 ms; either gap
// alone is enough to pass. W15 C: the centroid weights |X|^2, the length starts at the onset, and a near copy (the
// own tick plus -70 dBFS noise) must read as alike. Numbers only: no claim about how the cues sound (LISTEN.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CUE_NAMES, TICK_GAP, cueFile, measure, measureFile, parseWav, ticksDiffer } from '../../tools/audio/measure-cues.mjs';

const dir = join(fileURLToPath(new URL('../../', import.meta.url)), 'public/assets/audio');
const m = Object.fromEntries(CUE_NAMES.map((c) => [c, measureFile(join(dir, cueFile(c)))]));

/** A sine burst with a 1 ms rise and an exponential fall (time constant `tau` s), for checking the measures. */
function burst(hz: number, seconds: number, tau: number, rate = 44100): Float64Array {
  const x = new Float64Array(Math.round(seconds * rate));
  for (let i = 0; i < x.length; i++) {
    const t = i / rate;
    x[i] = 0.5 * Math.sin(2 * Math.PI * hz * t) * Math.min(1, t / 0.001) * Math.exp(-t / tau);
  }
  return x;
}

describe('cue measures (tools/audio/measure-cues.mjs)', () => {
  it('measures what it says on known signals', () => {
    const a = measure(burst(1000, 0.2, 0.02), 44100);
    expect(a.durationMs).toBeCloseTo(200, 1);
    // the first full crest, 1.25 ms in: 0.5 * exp(-1.25 / 20) = -6.56 dBFS
    expect(Math.abs(a.peakDb - 20 * Math.log10(0.5 * Math.exp(-1.25 / 20)))).toBeLessThan(0.05);
    expect(Math.abs(a.dominantHz - 1000)).toBeLessThan(3);
    expect(Math.abs(a.centroidHz - 1000)).toBeLessThan(5); // a pure tone's power centroid sits on the tone
    expect(a.attackMs).toBeLessThan(3); // the 1 ms rise
    // -40 dB of a 20 ms exponential: 20 ms * ln(100) = 92 ms, after its loudest window (1-2 ms in)
    expect(Math.abs(a.audibleMs - 93.5)).toBeLessThan(3);
    const b = measure(burst(500, 0.2, 0.02), 44100);
    expect(Math.abs(b.dominantHz - 500)).toBeLessThan(3);
    expect(Math.abs(b.centroidHz - 500)).toBeLessThan(5);
    // the length starts at the onset: 50 ms of silence first changes the duration, not the audible length
    const late = measure(Float64Array.from([...new Float64Array(2205), ...burst(1000, 0.2, 0.02)]), 44100);
    expect(late.durationMs - a.durationMs).toBeCloseTo(50, 1);
    expect(Math.abs(late.audibleMs - a.audibleMs)).toBeLessThan(1.5);
    expect(ticksDiffer(a, b).differ).toBe(true); // 1 kHz against 500 Hz, the same length: told apart by pitch
  });

  it('reads all six cue files: 16-bit mono 44.1 kHz, peak under 0 dBFS, not silent', () => {
    for (const c of CUE_NAMES) {
      const { rate } = parseWav(readFileSync(join(dir, cueFile(c))));
      expect(rate, c).toBe(44100);
      expect(m[c].peakDb, c).toBeLessThan(0);
      expect(m[c].rmsDb, c).toBeGreaterThan(-40);
      expect(m[c].durationMs, c).toBeGreaterThan(20);
    }
  });
});

describe('your slab tick and the enemy\'s stay apart', () => {
  it('differ in pitch (centroid gap >= 150 Hz) or in length (audible gap >= 20 ms)', () => {
    const own = m.slab_tick, enemy = m.slab_tick_enemy;
    const t = ticksDiffer(own, enemy);
    expect(t.differ, `slab_tick ${own.centroidHz.toFixed(0)} Hz / ${own.audibleMs.toFixed(0)} ms vs slab_tick_enemy `
      + `${enemy.centroidHz.toFixed(0)} Hz / ${enemy.audibleMs.toFixed(0)} ms: centroid gap ${t.centroidGap.toFixed(0)} Hz `
      + `(min ${TICK_GAP.minCentroidHz}), length gap ${t.lengthGap.toFixed(0)} ms (min ${TICK_GAP.minLengthMs})`).toBe(true);
  });

  it('the guard can fail: a tick against itself, or a near copy, does not count as different', () => {
    expect(ticksDiffer(m.slab_tick, m.slab_tick).differ).toBe(false);
    expect(ticksDiffer(m.slab_tick_enemy, m.slab_tick_enemy).differ).toBe(false);
    // a near copy: the own tick's own samples plus seeded white noise at -70 dBFS RMS
    const own = parseWav(readFileSync(join(dir, cueFile('slab_tick'))));
    let seed = 0x9e3779b9;
    const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const amp = 10 ** (-70 / 20) * Math.sqrt(3); // uniform noise in [-a, a] has RMS a / sqrt(3)
    const copy = measure(own.samples.map((v) => v + (rnd() * 2 - 1) * amp), own.rate);
    expect(Math.abs(copy.centroidHz - m.slab_tick.centroidHz)).toBeLessThan(5);
    expect(Math.abs(copy.audibleMs - m.slab_tick.audibleMs)).toBeLessThan(2);
    expect(ticksDiffer(m.slab_tick, copy).differ).toBe(false);
    const near = { ...m.slab_tick, centroidHz: m.slab_tick.centroidHz + 149, audibleMs: m.slab_tick.audibleMs + 19 };
    expect(ticksDiffer(m.slab_tick, near).differ).toBe(false);
    expect(ticksDiffer(m.slab_tick, { ...near, audibleMs: m.slab_tick.audibleMs + 20 }).differ).toBe(true); // length alone
    expect(ticksDiffer(m.slab_tick, { ...near, centroidHz: m.slab_tick.centroidHz + 150 }).differ).toBe(true); // pitch alone
  });
});

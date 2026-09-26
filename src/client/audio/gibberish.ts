// OWNER: L5 (juice). Procedural gibberish voices for `bark` lines: one sawtooth "vocal cord" per line, pitched
// syllables with per-species contours, and two formant band-passes that jump per vowel — reads as chatter,
// never as words (no VO, no copied voice language). Seeded by the line text so a line always sounds the same.
import { Species } from '../../shared/types';
import { filter, gain, type Voice } from './synth';

/** Vowel formants (F1, F2) in Hz. */
const FORMANTS: Record<string, [number, number]> = {
  a: [800, 1250], e: [500, 1900], i: [320, 2300], o: [520, 900], u: [360, 780], y: [400, 2000],
};

export interface VoiceProfile { base: number; spread: number; syll: number; glide: number; bright: number }

export const SPECIES_VOICE: Record<number, VoiceProfile> = {
  // Earnest corgi: lower, bouncy, clipped syllables.
  [Species.Corgi]: { base: 300, spread: 0.35, syll: 0.085, glide: 0.25, bright: 1 },
  // Smug cat: higher, sliding, drawn-out syllables.
  [Species.Cat]: { base: 470, spread: 0.45, syll: 0.11, glide: 0.6, bright: 1.25 },
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Vowel sequence of a line (each vowel group = one syllable), capped for brevity. */
export function syllables(line: string, max = 9): string[] {
  const m = line.toLowerCase().match(/[aeiouy]+/g) ?? ['a'];
  const out = m.slice(0, max).map((g) => g[0]);
  return out.length ? out : ['a'];
}

/** Schedules a gibberish line into the voice; returns its duration. */
export function speak(v: Voice, species: number, line: string, pitchScale = 1): number {
  const prof = SPECIES_VOICE[species] ?? SPECIES_VOICE[Species.Corgi];
  const syl = syllables(line);
  let h = hash(line);
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
  const t0 = v.t;
  const out = gain(v, 0.0001);
  const f1 = filter(v, 'bandpass', 700, 6, out), f2 = filter(v, 'bandpass', 1500, 9, out);
  const src = v.ctx.createOscillator();
  src.type = 'sawtooth';
  const pre = gain(v, 0.6, f1);
  pre.connect(f2);
  src.connect(pre);
  const excited = line.includes('!');
  const base = prof.base * pitchScale * (excited ? 1.12 : 1);
  let t = t0;
  src.frequency.setValueAtTime(base, t);
  out.gain.setValueAtTime(0.0001, t);
  syl.forEach((vow, i) => {
    const d = prof.syll * (0.75 + rnd() * 0.6) * (i === syl.length - 1 ? 1.6 : 1);
    const p = base * (1 + (rnd() * 2 - 1) * prof.spread);
    const [a, b] = FORMANTS[vow] ?? FORMANTS.a;
    // Pitch: glide into the syllable (cats slide more), formants hop to the vowel.
    src.frequency.setTargetAtTime(p, t, d * prof.glide * 0.5 + 0.005);
    f1.frequency.setTargetAtTime(a, t, 0.012);
    f2.frequency.setTargetAtTime(b * prof.bright, t, 0.012);
    // Syllable envelope: quick rise, dip at the end (never hard zero → no clicks).
    out.gain.setTargetAtTime(0.55, t, 0.008);
    out.gain.setTargetAtTime(0.06, t + d * 0.72, 0.012);
    t += d + 0.018;
  });
  // Question/exclaim contour on the last syllable.
  if (line.trim().endsWith('?')) src.frequency.setTargetAtTime(base * 1.5, t - 0.08, 0.04);
  out.gain.setTargetAtTime(0.0001, t, 0.02);
  src.start(t0);
  src.stop(t + 0.15);
  return t - t0 + 0.15;
}

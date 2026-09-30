// W9 X4 (arms-2): throwable voices (MASTER_PLAN §12 theme data), procedural like every other sound, and a small
// director that plays the ordnance view's cues (fx/ordnance-view.ts OrdnanceCue) through the shared AudioEngine.
//   throw     the pin's ping + a spoon "sprang" (squeaker) / a wet "shlup" off the paw (hairball), then a whoosh
//   bounce    a rubber-toy squeak per bounce, higher and louder the harder it lands / a wet thup and squelch
//   tick      the fuse telegraph, one per blink: a tiny squeaker peep rising with urgency / the wick's crackle
//   blast     on top of the generic `explode` boom (audio/index.ts): a real concussive thump for both (sub drop,
//             chest punch, air crack) + the faction's layer: a squeal snapping into a rubber POP / a gloopy SPLAT
//             with drips after
// The pet joke stays a layer; the thump underneath is a weapon (HARDENED: the humour is in the soldiering).
// W10 AU2 (audio-2), the mix: rendered in a storm firefight (tests/unit/audio-w10-mix.test.ts) the peeps sat ~24 dB
// under the rain + guns in their own band. A tick now knows whom it threatens: an enemy throwable (or your own) near
// the local CHARACTER (engine.focus, not the camera) plays up to FUSE_THREAT.boost louder, at priority 3 in its own
// limiter category ('fuse', so gunfire can never steal it), and raises the engine's danger duck: the weather and site
// ambience beds dip while it ticks. A teammate's throwable, or one far away, sounds exactly as before.
import { ad, ahr, filter, gain, glide, noiseSrc, osc, softClip, type Voice } from './synth';
import type { AudioEngine, PlayOptions } from './engine';
import type { OrdnanceCue } from '../fx/ordnance-view';

type Recipe = (v: Voice, k: number) => number;
const vary = (v: Voice, amt: number) => 1 + (v.rand() * 2 - 1) * amt;

/** The pin: a bright metal tink and the spoon springing off. */
export const pinPing: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.05);
  const g = gain(v);
  ad(g.gain, t, 0.001, 0.32, 0.12);
  osc(v, 'sine', 3150 * p, g, 0.15);
  osc(v, 'triangle', 4720 * p, filter(v, 'bandpass', 4700, 6, g), 0.1);
  const s = gain(v);
  ad(s.gain, t + 0.05, 0.002, 0.16, 0.09);
  const o = osc(v, 'square', 820 * p, filter(v, 'bandpass', 1400, 3, s), 0.12, t + 0.05);
  glide(o.frequency, t + 0.05, 820 * p, 1650 * p, 0.07);
  return 0.2;
};

/** The throw's whoosh (k = 1: the hairball's wet shlup off the paw first). */
export const throwWhoosh: Recipe = (v, k) => {
  const t = v.t, p = vary(v, 0.08);
  const g = gain(v);
  ahr(g.gain, t, 0.03, 0.34, 0.05, 0.16);
  const bp = filter(v, 'bandpass', 700 * p, 1.4, g);
  bp.frequency.setValueAtTime(700 * p, t);
  bp.frequency.exponentialRampToValueAtTime(2300 * p, t + 0.2);
  noiseSrc(v, bp, 0.3, 'pink');
  if (k >= 1) {
    const w = gain(v);
    ad(w.gain, t, 0.004, 0.28, 0.07);
    const o = osc(v, 'sine', 420 * p, filter(v, 'lowpass', 900, 2, w), 0.1);
    glide(o.frequency, t, 420 * p, 180 * p, 0.07);
  }
  return 0.28;
};

/** A rubber squeak toy hitting the ground (k = impact 0..1): pitch jumps up then sags, through a squeaky formant. */
export const squeak: Recipe = (v, k) => {
  const t = v.t, s = Math.max(0.2, Math.min(1, k)), p = vary(v, 0.06) * (0.9 + 0.25 * s);
  const d = 0.09 + 0.1 * s;
  const g = gain(v);
  ahr(g.gain, t, 0.006, 0.18 + 0.3 * s, d * 0.5, d * 0.5);
  const f = filter(v, 'bandpass', 2300 * p, 4, g);
  const o = osc(v, 'sawtooth', 1250 * p, f, d + 0.05);
  o.frequency.setValueAtTime(1250 * p, t);
  o.frequency.exponentialRampToValueAtTime(2100 * p, t + d * 0.3);
  o.frequency.exponentialRampToValueAtTime(1500 * p, t + d);
  const vib = v.ctx.createOscillator(); vib.frequency.value = 38; const vg = v.ctx.createGain(); vg.gain.value = 60 * s;
  vib.connect(vg); vg.connect(o.frequency); vib.start(t); vib.stop(t + d + 0.05);
  // the rubber body's thock under it
  const th = gain(v);
  ad(th.gain, t, 0.002, 0.25 * s, 0.05);
  osc(v, 'sine', 210, th, 0.08);
  return d + 0.06;
};

/** A wet hairball landing (k = impact): a soft thup and a squelch. */
export const wetThup: Recipe = (v, k) => {
  const t = v.t, s = Math.max(0.2, Math.min(1, k)), p = vary(v, 0.08);
  const b = gain(v);
  ad(b.gain, t, 0.003, 0.45 * s, 0.09);
  const o = osc(v, 'sine', 150 * p, b, 0.12);
  glide(o.frequency, t, 150 * p, 70, 0.08);
  const n = gain(v);
  ahr(n.gain, t + 0.01, 0.01, 0.22 * s, 0.03, 0.08);
  const bp = filter(v, 'bandpass', 950 * p, 2.2, n);
  bp.frequency.setValueAtTime(1300 * p, t + 0.01);
  bp.frequency.exponentialRampToValueAtTime(520 * p, t + 0.13);
  noiseSrc(v, bp, 0.16, 'pink');
  return 0.16;
};

/** The squeaker's fuse peep (k = urgency 0..1: higher and sharper as it runs out). */
export const fusePeep: Recipe = (v, k) => {
  const t = v.t, u = Math.max(0, Math.min(1, k));
  const g = gain(v);
  ad(g.gain, t, 0.002, 0.14 + 0.1 * u, 0.045);
  osc(v, 'square', 1900 + 1300 * u, filter(v, 'bandpass', 2600 + 1200 * u, 5, g), 0.06);
  return 0.06;
};

/** W10 AU2: the squeaker's peep for the player it threatens (k = urgency): X4's peep with a shrill upper partial at
 *  4.6-5.6 kHz, the band where rain and gunfire leave the most room, so the warning reads in a storm firefight. */
export const fuseAlarm: Recipe = (v, k) => {
  const t = v.t, u = Math.max(0, Math.min(1, k));
  fusePeep(v, u);
  const g = gain(v);
  ad(g.gain, t, 0.002, 0.12 + 0.08 * u, 0.045);
  osc(v, 'triangle', 4600 + 1000 * u, filter(v, 'bandpass', 4600 + 1000 * u, 4, g), 0.06);
  return 0.06;
};

/** The hairball's wick spitting (k = urgency): a short crackle of filtered noise. */
export const wickCrackle: Recipe = (v, k) => {
  const t = v.t, u = Math.max(0, Math.min(1, k));
  const g = gain(v);
  ahr(g.gain, t, 0.003, 0.12 + 0.12 * u, 0.02, 0.05);
  noiseSrc(v, filter(v, 'highpass', 3200 + 1500 * u, 0.9, g), 0.09, 'white', t, 1.6);
  return 0.09;
};

/** The concussive thump under both blasts (k = radius scale): a sub drop, a chest punch and an air crack. */
export const concussion: Recipe = (v, k) => {
  const t = v.t, s = Math.max(0.7, Math.min(1.3, k || 1));
  const ws = v.ctx.createWaveShaper();
  ws.curve = softClip(2.2);
  ws.connect(v.out);
  const sub = gain(v, 0.0001, ws);
  ad(sub.gain, t, 0.004, 0.9 * s, 0.42 * s);
  const o = osc(v, 'sine', 62, sub, 0.5 * s);
  glide(o.frequency, t, 62, 29, 0.38 * s);
  const punch = gain(v, 0.0001, ws);
  ad(punch.gain, t, 0.002, 0.7 * s, 0.1);
  noiseSrc(v, filter(v, 'lowpass', 420, 0.8, punch), 0.14, 'brown');
  const crack = gain(v, 0.0001, v.out);
  ad(crack.gain, t, 0.001, 0.35, 0.04);
  noiseSrc(v, filter(v, 'highpass', 2400, 0.7, crack), 0.06);
  return 0.55 * s;
};

/** The squeaker's faction layer: a squeal snapping up into a rubber POP, then flapping shreds. */
export const squeakPop: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.05);
  const sq = gain(v);
  ahr(sq.gain, t, 0.004, 0.3, 0.05, 0.05);
  const o = osc(v, 'sawtooth', 1400 * p, filter(v, 'bandpass', 2800 * p, 3, sq), 0.12);
  glide(o.frequency, t, 1400 * p, 3600 * p, 0.09);
  const pop = gain(v);
  ad(pop.gain, t + 0.07, 0.001, 0.55, 0.07);
  noiseSrc(v, filter(v, 'bandpass', 1500 * p, 0.9, pop), 0.1, 'white', t + 0.07);
  const flap = gain(v);
  ahr(flap.gain, t + 0.12, 0.02, 0.1, 0.12, 0.2);
  noiseSrc(v, filter(v, 'bandpass', 700, 1.5, flap), 0.45, 'pink', t + 0.12, 0.6);
  return 0.5;
};

/** The hairball's faction layer: a gloopy SPLAT (a falling wet formant) and a few drips after. */
export const wetSplat: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.06);
  const g = gain(v);
  ahr(g.gain, t, 0.006, 0.55, 0.05, 0.22);
  const bp = filter(v, 'bandpass', 900 * p, 1.6, g);
  bp.frequency.setValueAtTime(1400 * p, t);
  bp.frequency.exponentialRampToValueAtTime(260 * p, t + 0.3);
  noiseSrc(v, bp, 0.36, 'pink');
  const lo = gain(v);
  ad(lo.gain, t, 0.004, 0.4, 0.2);
  const o = osc(v, 'sine', 190 * p, filter(v, 'lowpass', 500, 3, lo), 0.25);
  glide(o.frequency, t, 190 * p, 60, 0.2);
  for (let i = 0; i < 3; i++) {
    const at = t + 0.32 + i * (0.13 + v.rand() * 0.1);
    const d = gain(v);
    ad(d.gain, at, 0.002, 0.08, 0.05);
    const dr = osc(v, 'sine', (700 + v.rand() * 400) * p, d, 0.08, at);
    glide(dr.frequency, at, (700 + v.rand() * 300) * p, 1100 * p, 0.04);
  }
  return 0.8;
};

/** Every recipe (tests schedule them all on the strict fake context). */
export const ORDNANCE_SFX = { pinPing, throwWhoosh, squeak, wetThup, fusePeep, wickCrackle, concussion, squeakPop, wetSplat, fuseAlarm } as const;

// ------------------------------------------------------------------------------------------------ director

export interface OrdnanceAudio {
  /** Play one view cue (pass it as the ordnance view's onCue). */
  cue(c: OrdnanceCue): void;
  /** Telemetry: plays asked for, by cue type. */
  readonly counts: Record<OrdnanceCue['type'], number>;
}

/**
 * Gains follow X3's offline renders (docs/handoff/X3.md §5, a local Squeaker shot ≈ −26): a squeak sits under a rifle
 * shot, the peeps are texture, the thump + faction layer land 2–4 dB over a mortar shot, still under the boom.
 */
/** W10 AU2: how a fuse tick treats the player it threatens (distances from the local character, m). */
export const FUSE_THREAT = {
  /** Full threat within `near` (the 4 m blast falloff + a step), none beyond `far`. */
  near: 4.5, far: 10,
  /** Tick gain × (1 + boost × threat), per faction (the hairball's crackle sits high, where little masks it). */
  boost: [9, 4.5] as readonly [number, number],
  /** Above this threat the squeaker peeps its alarm voice (fuseAlarm) and the tick takes priority 3. */
  alarm: 0.25,
  /** Danger duck = threat × (floor + (1 − floor) × urgency), held this long after each tick (s). */
  duckFloor: 0.7, hold: 0.5,
} as const;

/** 0..1: how much a live throwable at distance `d` from the local character threatens it. */
export function fuseThreat(d: number): number {
  return Math.max(0, Math.min(1, (FUSE_THREAT.far - d) / (FUSE_THREAT.far - FUSE_THREAT.near)));
}

/** What the director needs: `play`, and (for the threat-aware ticks) the engine's focus and danger duck. */
export type OrdnanceEngine = Pick<AudioEngine, 'play'> & Partial<Pick<AudioEngine, 'focus' | 'focusDistance' | 'raiseDanger'>>;

export function createOrdnanceAudio(engine: OrdnanceEngine): OrdnanceAudio {
  const counts = { throw: 0, bounce: 0, tick: 0, blast: 0 };
  /** A throwable that can hurt the local character: an enemy's, or its own (self damage 35 %; friendly fire off). */
  const hostile = (c: OrdnanceCue) => c.local || !engine.focus || c.kind !== (engine.focus.species === 1 ? 1 : 0);
  const threatOf = (c: OrdnanceCue) => (engine.focusDistance && hostile(c) ? fuseThreat(engine.focusDistance(c.x, c.y, c.z)) : 0);
  const o: PlayOptions = {};
  const set = (c: OrdnanceCue, gainV: number, priority: number, category: string, refDist: number, maxDist: number, k: number) => {
    o.gain = gainV; o.priority = priority; o.category = category; o.refDist = refDist; o.maxDist = maxDist; o.k = k; o.bus = 'sfx';
    if (c.local && c.type === 'throw') { o.x = undefined; o.y = undefined; o.z = undefined; } else { o.x = c.x; o.y = c.y; o.z = c.z; }
    return o;
  };
  return {
    counts,
    cue(c) {
      counts[c.type]++;
      switch (c.type) {
        case 'throw':
          if (c.kind === 0) engine.play(pinPing, set(c, 0.6, 2, 'fx', 3, 30, 0));
          engine.play(throwWhoosh, set(c, 0.55, 1, 'fx', 3, 30, c.kind));
          break;
        case 'bounce':
          engine.play(c.kind === 0 ? squeak : wetThup, set(c, 0.55 + 0.3 * c.k, 1, 'impact', 4, 40, c.k));
          break;
        case 'tick': {
          const threat = threatOf(c), alarm = threat > FUSE_THREAT.alarm;
          const g = (0.35 + 0.35 * c.k) * (1 + FUSE_THREAT.boost[c.kind] * threat);
          engine.play(c.kind === 0 ? (alarm ? fuseAlarm : fusePeep) : wickCrackle, set(c, g, alarm ? 3 : c.k > 0.6 ? 2 : 1, 'fuse', 3, 28, c.k));
          if (threat > 0) engine.raiseDanger?.(threat * (FUSE_THREAT.duckFloor + (1 - FUSE_THREAT.duckFloor) * c.k), FUSE_THREAT.hold);
          break;
        }
        case 'blast':
          engine.play(concussion, set(c, 0.85, 3, 'impact', 8, 120, c.k));
          engine.play(c.kind === 0 ? squeakPop : wetSplat, set(c, 0.6, 2, 'impact', 6, 70, c.k));
          break;
      }
    },
  };
}

// W10 AU2 (audio-2): the construction site's voices (site-ambience.ts places and drives them), procedural, no files.
//   loops (positional, built once, gains driven per update)
//     rain on steel   sparse "dust" (white noise through a threshold waveshaper: single-sample clicks whose rate follows
//                     the input gain) ringing three steel-panel modes, a hollow box drum under them, and a dense
//                     patter layer for a downpour. `inside` opens the drum: standing in a container, it roars overhead
//     rain on tarp    softer, lower dust through a fabric "thup" band; a wind flutter (an LFO-chopped low band) in gusts
//     floodlight hum  the ballast's 100 Hz hum and harmonics, a thin buzz, and rain sizzling on the hot lens
//     ditch           a slow gurgle of the drainage ditch running after rain, and drops plopping into it
//     site bed        (2D) a far-off generator and traffic rumble beyond the hoarding
//   one-shots (engine.play, limiter category 'amb', priority 0)
//     drip            a drop off an eave (k 0) or inside a concrete pipe with its echo (k 1)
//     craneCreak      the tower crane in the wind: a stick-slip groan of steel, a cable slap when it's strong (k)
//     siteDistant     far site noise, low-passed with a hoarding slap-back: k 0 a dropped pipe, 1 a reversing beeper,
//                     2 a chain rattle, 3 an air-line hiss
import { ad, ahr, filter, gain, glide, noise, noiseSrc, osc, type Voice } from './synth';

type Recipe = (v: Voice, k: number) => number;
const vary = (v: Voice, amt: number) => 1 + (v.rand() * 2 - 1) * amt;

// ------------------------------------------------------------------------------------------------ dust

/** Threshold of the dust shaper: |x| above it becomes a click (white noise is uniform in [-1, 1]). */
export const DUST_TH = 0.985;
const dustCurves = new WeakMap<BaseAudioContext, Float32Array<ArrayBuffer>>();
/** The dust curve: silence below DUST_TH, a signed ramp to ±1 above it (4096 points: 12 of them past the threshold). */
export function dustCurve(ctx: BaseAudioContext): Float32Array<ArrayBuffer> {
  let c = dustCurves.get(ctx);
  if (!c) {
    const n = 4096;
    c = new Float32Array(new ArrayBuffer(n * 4));
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x); c[i] = a <= DUST_TH ? 0 : Math.sign(x) * (a - DUST_TH) / (1 - DUST_TH); }
    dustCurves.set(ctx, c);
  }
  return c;
}

/** Pre-gain into the dust shaper for `perSec` clicks a second at this sample rate: P(|g·x| > th) = 1 − th / g. */
export function dustDrive(perSec: number, sampleRate: number): number {
  const p = Math.max(0, Math.min(0.2, perSec / sampleRate));
  return p <= 0 ? DUST_TH * 0.9 : DUST_TH / (1 - p);
}

// ------------------------------------------------------------------------------------------------ loops

/** A running loop voice: `out` (connect to a panner or a bus), its knobs, and every node for teardown. */
export interface LoopVoice {
  out: GainNode;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
}

interface Kit { ctx: BaseAudioContext; nodes: AudioNode[]; sources: AudioScheduledSourceNode[]; t: number; off: number }
function kit(ctx: BaseAudioContext, off: number): Kit { return { ctx, nodes: [], sources: [], t: ctx.currentTime + 0.02, off }; }
/** A gain node (connected to `to` when given). */
function g0(k: Kit, v: number, to?: AudioNode): GainNode {
  const g = k.ctx.createGain(); g.gain.value = v; if (to) g.connect(to); k.nodes.push(g); return g;
}
function bq(k: Kit, type: BiquadFilterType, f: number, q: number, to: AudioNode, gainDb = 0): BiquadFilterNode {
  const b = k.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gainDb; b.connect(to); k.nodes.push(b); return b;
}
function loopSrc(k: Kit, kind: 'white' | 'pink' | 'brown', rate: number, to: AudioNode): AudioBufferSourceNode {
  const s = k.ctx.createBufferSource();
  s.buffer = noise(k.ctx, kind); s.loop = true; s.playbackRate.value = rate;
  s.connect(to); s.start(k.t, k.off % 1.9);
  k.nodes.push(s); k.sources.push(s);
  return s;
}
function tone(k: Kit, type: OscillatorType, f: number, to: AudioNode): OscillatorNode {
  const o = k.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(to); o.start(k.t);
  k.nodes.push(o); k.sources.push(o);
  return o;
}
/** A wave of harmonics 1..n at exactly these amplitudes (sine phase, not normalised): one oscillator instead of n. */
function harmonics(ctx: BaseAudioContext, amps: readonly number[]): PeriodicWave {
  const re = new Float32Array(amps.length + 1), im = new Float32Array(amps.length + 1);
  amps.forEach((a, i) => { im[i + 1] = a; });
  return ctx.createPeriodicWave(re, im, { disableNormalization: true });
}
/** An LFO: `depth` × an oscillator, added to `to`. */
function lfo(k: Kit, type: OscillatorType, f: number, depth: number, to: AudioParam): void {
  const d = g0(k, depth);
  d.connect(to);
  tone(k, type, f, d);
}
/** Dust: a white-noise loop → `drive` (the click rate, see dustDrive) → the threshold shaper (connect it onward). */
function dust(k: Kit, rate: number): { drive: GainNode; clicks: WaveShaperNode } {
  const clicks = k.ctx.createWaveShaper(); clicks.curve = dustCurve(k.ctx); k.nodes.push(clicks);
  const drive = g0(k, DUST_TH * 0.9, clicks);
  loopSrc(k, 'white', rate, drive);
  return { drive, clicks };
}

/** Rain on a steel container. Knobs: ping (dust drive = drop rate), pingLvl, drum (the box resonance: low outside,
 *  full inside), dense (a downpour's patter). */
export interface SteelRain extends LoopVoice { ping: GainNode; pingLvl: GainNode; drum: GainNode; dense: GainNode }
export function steelRain(ctx: BaseAudioContext, offset = 0): SteelRain {
  const k = kit(ctx, offset);
  const out = g0(k, 1);
  const pingLvl = g0(k, 0, out);
  const d = dust(k, 0.97 + 0.05 * Math.sin(offset * 3));
  // three steel-panel modes (a little detuned per container)
  for (const [f, q, lv] of [[870, 14, 1.05], [1690, 16, 0.85], [2950, 18, 0.62]] as const) {
    d.clicks.connect(bq(k, 'bandpass', f * (1 + 0.03 * Math.sin(offset * 7 + f)), q, g0(k, lv * 90, pingLvl)));
  }
  // the box drum: the same drops through the container's hollow low band
  const drum = g0(k, 0, out);
  d.clicks.connect(bq(k, 'bandpass', 175, 1.2, g0(k, 40, drum)));
  const dense = g0(k, 0, out);
  loopSrc(k, 'pink', 1.05, bq(k, 'peaking', 900, 2, bq(k, 'bandpass', 1900, 0.7, dense), 5));
  return { out, nodes: k.nodes, sources: k.sources, ping: d.drive, pingLvl, drum, dense };
}

/** Rain on a tarp. Knobs: ping (dust drive), pingLvl, flap (a wind flutter). */
export interface TarpRain extends LoopVoice { ping: GainNode; pingLvl: GainNode; flap: GainNode }
export function tarpRain(ctx: BaseAudioContext, offset = 0): TarpRain {
  const k = kit(ctx, offset);
  const out = g0(k, 1);
  const pingLvl = g0(k, 0, out);
  const d = dust(k, 1.03);
  d.clicks.connect(bq(k, 'bandpass', 300, 1.6, g0(k, 20, pingLvl)));
  d.clicks.connect(bq(k, 'lowpass', 1100, 0.7, g0(k, 5, pingLvl)));
  const flap = g0(k, 0, out);
  const am = g0(k, 0.5, flap);
  lfo(k, 'triangle', 7.5, 0.5, am.gain);
  loopSrc(k, 'brown', 1.2, bq(k, 'bandpass', 190, 1.8, am));
  return { out, nodes: k.nodes, sources: k.sources, ping: d.drive, pingLvl, flap };
}

/** A floodlight head. Knobs: hum (ballast hum + buzz level), sizzle (dust drive), sizzleLvl. */
export interface FloodHum extends LoopVoice { hum: GainNode; sizzle: GainNode; sizzleLvl: GainNode }
export function floodHum(ctx: BaseAudioContext, offset = 0): FloodHum {
  const k = kit(ctx, offset);
  const out = g0(k, 1);
  const hum = g0(k, 0, out);
  // the ballast hum: 100 Hz and its first harmonics in one oscillator (0.5, 0.22, 0.12, 0.05)
  const h = tone(k, 'sine', 100 * (1 + 0.0015 * Math.sin(offset * 5)), hum);
  h.setPeriodicWave(harmonics(k.ctx, [0.5, 0.22, 0.12, 0.05]));
  tone(k, 'sawtooth', 100, bq(k, 'bandpass', 2300, 4, g0(k, 0.035, hum)));
  const sizzleLvl = g0(k, 0, out);
  const d = dust(k, 1.11);
  d.clicks.connect(bq(k, 'highpass', 3800, 0.7, g0(k, 1.4, sizzleLvl)));
  return { out, nodes: k.nodes, sources: k.sources, hum, sizzle: d.drive, sizzleLvl };
}

/** The drainage ditch. Knobs: gurgle (running water), plop (dust drive = drops), plopLvl. */
export interface DitchWater extends LoopVoice { gurgle: GainNode; plop: GainNode; plopLvl: GainNode }
export function ditchWater(ctx: BaseAudioContext, offset = 0): DitchWater {
  const k = kit(ctx, offset);
  const out = g0(k, 1);
  const gurgle = g0(k, 0, out);
  const bp = bq(k, 'bandpass', 520, 3.2, g0(k, 2.2, gurgle));
  lfo(k, 'sine', 0.9, 160, bp.frequency);
  lfo(k, 'triangle', 2.3, 90, bp.frequency);
  loopSrc(k, 'pink', 0.8, bp);
  const plopLvl = g0(k, 0, out);
  const d = dust(k, 0.93);
  d.clicks.connect(bq(k, 'bandpass', 950, 7, g0(k, 18, plopLvl)));
  d.clicks.connect(bq(k, 'bandpass', 420, 5, g0(k, 10, plopLvl)));
  return { out, nodes: k.nodes, sources: k.sources, gurgle, plop: d.drive, plopLvl };
}

/** The far site bed (2D): a generator's 50 Hz drone and a traffic rumble beyond the hoarding. Knob: level. */
export interface SiteBed extends LoopVoice { level: GainNode }
export function siteBed(ctx: BaseAudioContext, offset = 0): SiteBed {
  const k = kit(ctx, offset);
  const out = g0(k, 1);
  const level = g0(k, 0, out);
  const rum = g0(k, 0.8, level);
  lfo(k, 'sine', 0.05, 0.3, rum.gain);
  loopSrc(k, 'brown', 0.7, bq(k, 'lowpass', 150, 0.6, g0(k, 0.06, rum)));
  tone(k, 'sine', 50, level).setPeriodicWave(harmonics(k.ctx, [0.0025, 0.0015, 0.0006]));
  return { out, nodes: k.nodes, sources: k.sources, level };
}

// ------------------------------------------------------------------------------------------------ one-shots

/** A water drop (k 0: off an eave onto steel/mud · 1: inside a concrete pipe, with its echo). */
export const drip: Recipe = (v, k) => {
  const t = v.t, p = vary(v, 0.2);
  const one = (at: number, peak: number, lp: number) => {
    const g = gain(v);
    ad(g.gain, at, 0.001, peak, 0.07);
    const o = osc(v, 'sine', 900 * p, filter(v, 'lowpass', lp, 0.7, g, at), 0.1, at);
    glide(o.frequency, at, 900 * p, 2300 * p, 0.035);
  };
  one(t, 0.32, 8000);
  if (k >= 1) { one(t + 0.075, 0.13, 2600); one(t + 0.15, 0.06, 1800); }
  return k >= 1 ? 0.28 : 0.12;
};

/** The tower crane in the wind (k = wind strength 0..1): stick-slip steel, a low groan, a cable slap when strong. */
export const craneCreak: Recipe = (v, k) => {
  const t = v.t, s = Math.max(0, Math.min(1, k)), p = vary(v, 0.12);
  const d = 1.1 + 1.3 * s + 0.6 * v.rand();
  // stick-slip: a buzzy saw, amplitude-chopped at a wandering 16-30 Hz, through a sweeping resonant band
  const g = gain(v);
  ahr(g.gain, t, 0.25, 0.26 + 0.18 * s, d * 0.5, d * 0.5);
  const bp = filter(v, 'bandpass', 520 * p, 9, g);
  bp.frequency.setValueAtTime(420 * p, t);
  bp.frequency.linearRampToValueAtTime(900 * p, t + d * 0.6);
  bp.frequency.linearRampToValueAtTime(610 * p, t + d);
  const chop = gain(v, 0.5, bp);
  const src = osc(v, 'sawtooth', 78 * p, chop, d + 0.1);
  glide(src.frequency, t, 78 * p, 96 * p, d);
  const am = v.ctx.createOscillator(); am.type = 'square'; am.frequency.setValueAtTime(18 + 10 * v.rand(), t);
  am.frequency.linearRampToValueAtTime(26 + 6 * v.rand(), t + d);
  const amd = v.ctx.createGain(); amd.gain.value = 0.5;
  am.connect(amd); amd.connect(chop.gain); am.start(t); am.stop(t + d + 0.1);
  // the groan underneath
  const lo = gain(v);
  ahr(lo.gain, t, 0.4, 0.12 * (0.5 + s), d * 0.4, d * 0.6);
  const o = osc(v, 'sine', 52 * p, lo, d + 0.1);
  glide(o.frequency, t, 52 * p, 44 * p, d);
  let end = d;
  if (s > 0.6) {
    const at = t + d * 0.85;
    for (const [f, pk, dd] of [[520, 0.16, 0.5], [1370, 0.1, 0.35], [2240, 0.06, 0.25]] as const) {
      const c = gain(v);
      ad(c.gain, at, 0.002, pk, dd);
      osc(v, 'triangle', f * p, c, dd + 0.05, at);
    }
    end = d * 0.85 + 0.55;
  }
  return end;
};

/** Far site noise beyond the hoarding (k: 0 a dropped pipe, 1 a reversing beeper, 2 a chain rattle, 3 an air-line
 *  hiss): all through a low-pass (distance) with a slap-back off the hoarding 0.18 s later. */
export const siteDistant: Recipe = (v, k) => {
  const t = v.t, p = vary(v, 0.06);
  const trim = gain(v, [0.15, 0.1, 1.3, 1][k | 0] ?? 1);
  const far = filter(v, 'lowpass', 1500, 0.7, trim);
  const slap = gain(v, 0.3, filter(v, 'lowpass', 900, 0.7, trim));
  const both = (fn: (dest: AudioNode, at: number) => void) => { fn(far, t); fn(slap, t + 0.18); };
  switch (k | 0) {
    case 0:
      both((dst, at) => {
        for (const [f, pk, dd] of [[310, 0.5, 0.9], [760, 0.3, 0.7], [1210, 0.18, 0.5]] as const) {
          const g = gain(v, 0.0001, dst); ad(g.gain, at, 0.002, pk, dd); osc(v, 'triangle', f * p, g, dd + 0.05, at);
        }
      });
      return 1.2;
    case 1:
      both((dst, at) => {
        for (let i = 0; i < 3; i++) { const g = gain(v, 0.0001, dst); ahr(g.gain, at + i * 0.9, 0.01, 0.3, 0.42, 0.03); osc(v, 'square', 1030, filter(v, 'bandpass', 1030, 4, g, at), 0.5, at + i * 0.9); }
      });
      return 2.5;
    case 2:
      both((dst, at) => {
        for (let i = 0; i < 9; i++) {
          const a = at + i * (0.06 + 0.03 * v.rand());
          const g = gain(v, 0.0001, dst); ad(g.gain, a, 0.001, 0.22 * (1 - i / 12), 0.08);
          osc(v, 'triangle', (1800 + 900 * v.rand()) * p, g, 0.1, a);
        }
      });
      return 0.9;
    default:
      both((dst, at) => { const g = gain(v, 0.0001, dst); ahr(g.gain, at, 0.05, 0.3, 0.5, 0.4); noiseSrc(v, filter(v, 'bandpass', 2400, 0.8, g, at), 1.0, 'white', at); });
      return 1.2;
  }
};

/** Every one-shot (tests render them all). */
export const SITE_SFX = { drip, craneCreak, siteDistant } as const;

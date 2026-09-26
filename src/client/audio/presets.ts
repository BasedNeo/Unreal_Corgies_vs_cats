// OWNER: L5 (juice). Procedural SFX recipes (MASTER_PLAN §12 theme data: swap this file to re-theme the sound).
// Each recipe schedules nodes into a Voice starting at v.t and returns its duration in seconds. `k` is a
// per-call strength/variant parameter (e.g. landing impact, crit). No audio files anywhere.
import { ad, ahr, filter, gain, glide, noiseSrc, osc, softClip, type Voice } from './synth';

export type Recipe = (v: Voice, k: number) => number;

const vary = (v: Voice, amt: number) => 1 + (v.rand() * 2 - 1) * amt;

/** Corgi bark: throaty "rrWUF" — saw source through two formants with a pitch drop + breath noise. */
export const bark: Recipe = (v, k) => {
  const p = vary(v, 0.08) * (k > 0 ? k : 1);
  const t = v.t;
  const out = gain(v);
  ad(out.gain, t, 0.008, 0.9, 0.2);
  const f1 = filter(v, 'bandpass', 720, 5, out), f2 = filter(v, 'bandpass', 1350, 7, out);
  const src = gain(v, 1, f1); src.connect(f2);
  const o = osc(v, 'sawtooth', 560 * p, src, 0.25);
  glide(o.frequency, t, 560 * p, 260 * p, 0.16);
  const n = gain(v, 0.0001, out);
  ad(n.gain, t, 0.004, 0.35, 0.08);
  noiseSrc(v, filter(v, 'bandpass', 1800, 1.2, n), 0.12);
  // Second, shorter "wuf" tail.
  const g2 = gain(v, 0.0001, f1);
  ad(g2.gain, t + 0.11, 0.006, 0.5, 0.1);
  const o2 = osc(v, 'sawtooth', 440 * p, g2, 0.2, t + 0.11);
  glide(o2.frequency, t + 0.11, 440 * p, 230 * p, 0.1);
  return 0.32;
};

/** Cat hiss: band-passed noise with a breathy swell and flutter. */
export const hiss: Recipe = (v) => {
  const t = v.t;
  const out = gain(v);
  ahr(out.gain, t, 0.04, 0.55, 0.25, 0.18);
  const bp = filter(v, 'bandpass', 4200 * vary(v, 0.1), 1.4, out);
  const hp = filter(v, 'highpass', 2200, 0.7, bp);
  noiseSrc(v, hp, 0.5);
  const lfo = v.ctx.createOscillator(); lfo.frequency.value = 23; const lg = v.ctx.createGain(); lg.gain.value = 0.15;
  lfo.connect(lg); lg.connect(out.gain); lfo.start(t); lfo.stop(t + 0.5);
  return 0.5;
};

/** Meow: pitch glide up then down through moving "ee-ow" formants. k = 1 normal, 2 = long yowl. */
export const meow: Recipe = (v, k) => {
  const long = k >= 2;
  const d = long ? 0.75 : 0.36;
  const t = v.t, p = vary(v, 0.1);
  const out = gain(v);
  ahr(out.gain, t, 0.03, 0.55, d * 0.6, d * 0.35);
  const f1 = filter(v, 'bandpass', 900, 4, out), f2 = filter(v, 'bandpass', 2400, 6, out);
  f1.frequency.setValueAtTime(700, t); f1.frequency.linearRampToValueAtTime(1100, t + d * 0.4); f1.frequency.linearRampToValueAtTime(650, t + d);
  f2.frequency.setValueAtTime(2600, t); f2.frequency.linearRampToValueAtTime(1500, t + d);
  const src = gain(v, 1, f1); src.connect(f2);
  const o = osc(v, 'sawtooth', 520 * p, src, d);
  o.frequency.setValueAtTime(480 * p, t);
  o.frequency.exponentialRampToValueAtTime((long ? 1050 : 820) * p, t + d * 0.35);
  o.frequency.exponentialRampToValueAtTime((long ? 560 : 430) * p, t + d);
  const vib = v.ctx.createOscillator(); vib.frequency.value = long ? 7 : 5.5; const vg = v.ctx.createGain(); vg.gain.value = long ? 28 : 12;
  vib.connect(vg); vg.connect(o.frequency); vib.start(t); vib.stop(t + d + 0.05);
  return d + 0.05;
};

/** Squeaker rifle: rubber-toy squeak + a laser-ish "pew". Pitch varies every shot. */
export const squeakPew: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.09);
  const out = gain(v);
  ad(out.gain, t, 0.003, 0.55, 0.14);
  const sq = gain(v, 1, filter(v, 'bandpass', 2400 * p, 2, out));
  const o = osc(v, 'triangle', 1300 * p, sq, 0.08);
  glide(o.frequency, t, 1300 * p, 2700 * p, 0.045);
  const pew = gain(v, 0.0001, out);
  ad(pew.gain, t + 0.02, 0.003, 0.4, 0.11);
  const o2 = osc(v, 'square', 1700 * p, filter(v, 'lowpass', 3500, 1, pew), 0.14, t + 0.02);
  glide(o2.frequency, t + 0.02, 1700 * p, 260 * p, 0.11);
  const click = gain(v, 0.0001, out);
  ad(click.gain, t, 0.001, 0.35, 0.02);
  noiseSrc(v, filter(v, 'highpass', 3000, 0.7, click), 0.03);
  return 0.18;
};

/** Snap pistol: a tight snap (high noise crack) over a small thump. */
export const snap: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.06);
  const out = gain(v);
  ad(out.gain, t, 0.001, 0.8, 0.09);
  noiseSrc(v, filter(v, 'highpass', 2500 * p, 0.9, out), 0.1);
  const th = gain(v, 0.0001, out);
  ad(th.gain, t, 0.002, 0.7, 0.07);
  const o = osc(v, 'sine', 190 * p, th, 0.1);
  glide(o.frequency, t, 190 * p, 60, 0.07);
  return 0.12;
};

/** Laser pointer longshot: descending saw zap with a sizzling top. */
export const laserZap: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.05);
  const out = gain(v);
  ad(out.gain, t, 0.004, 0.5, 0.26);
  const o = osc(v, 'sawtooth', 2400 * p, filter(v, 'lowpass', 5000, 2, out), 0.3);
  glide(o.frequency, t, 2400 * p, 140, 0.24);
  const s = gain(v, 0.0001, out);
  ad(s.gain, t, 0.002, 0.18, 0.2);
  const o2 = osc(v, 'square', 3100 * p, s, 0.22);
  glide(o2.frequency, t, 3100 * p, 900, 0.2);
  return 0.32;
};

/** Tennis mortar launch: hollow "thunk" + tube pop. */
export const mortarThunk: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.06);
  const out = gain(v);
  ad(out.gain, t, 0.003, 1, 0.22);
  const o = osc(v, 'sine', 150 * p, out, 0.25);
  glide(o.frequency, t, 150 * p, 48, 0.2);
  const pop = gain(v, 0.0001, out);
  ad(pop.gain, t, 0.002, 0.6, 0.06);
  noiseSrc(v, filter(v, 'bandpass', 900, 1.5, pop), 0.08, 'pink');
  return 0.28;
};

/** Explosion: filtered noise swept down, sub-bass drop, and crackle. k = radius scale. */
export const boom: Recipe = (v, k) => {
  const t = v.t, s = Math.max(0.6, Math.min(1.6, k || 1));
  const out = gain(v);
  ad(out.gain, t, 0.006, 1, 1.3 * s);
  const lp = filter(v, 'lowpass', 1400, 0.8, out);
  lp.frequency.setValueAtTime(2200, t);
  lp.frequency.exponentialRampToValueAtTime(110, t + 1.1 * s);
  noiseSrc(v, lp, 1.5 * s, 'brown');
  noiseSrc(v, filter(v, 'lowpass', 900, 0.7, gain(v, 0.5, lp)), 0.5, 'white');
  const sub = gain(v, 0.0001, out);
  ad(sub.gain, t, 0.01, 1, 0.9 * s);
  const o = osc(v, 'sine', 70, sub, 1 * s);
  glide(o.frequency, t, 70, 28, 0.8 * s);
  const cr = gain(v, 0.0001, out);
  ahr(cr.gain, t + 0.05, 0.02, 0.18, 0.4, 0.3);
  noiseSrc(v, filter(v, 'highpass', 4000, 1, cr), 0.8, 'white', t + 0.05, 0.25);
  return 1.5 * s;
};

/** Sprinkler cannon: "tsk-tsk-tsk" pulses + wet spray. */
export const sprinkler: Recipe = (v) => {
  const t = v.t;
  const out = gain(v, 1);
  for (let i = 0; i < 4; i++) {
    const g = gain(v, 0.0001, out);
    ad(g.gain, t + i * 0.07, 0.003, 0.4 - i * 0.06, 0.05);
    noiseSrc(v, filter(v, 'highpass', 5200, 0.8, g), 0.07, 'white', t + i * 0.07);
  }
  const w = gain(v, 0.0001, out);
  ahr(w.gain, t, 0.03, 0.2, 0.15, 0.15);
  noiseSrc(v, filter(v, 'bandpass', 2600, 0.6, w), 0.35, 'pink');
  return 0.36;
};

/** Frisbee launcher: band sweep whoosh. */
export const whoosh: Recipe = (v) => {
  const t = v.t;
  const out = gain(v);
  ahr(out.gain, t, 0.06, 0.5, 0.12, 0.25);
  const bp = filter(v, 'bandpass', 500, 2.2, out);
  bp.frequency.setValueAtTime(450, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.16); bp.frequency.exponentialRampToValueAtTime(600, t + 0.42);
  noiseSrc(v, bp, 0.45, 'pink');
  return 0.45;
};

/** Hit thwack (cartoon punch into fluff). k ≥ 1 = crit → an extra bright "ding". */
export const thwack: Recipe = (v, k) => {
  const t = v.t, p = vary(v, 0.07);
  const out = gain(v);
  ad(out.gain, t, 0.002, 0.9, 0.12);
  noiseSrc(v, filter(v, 'lowpass', 2200 * p, 0.8, out), 0.14, 'pink');
  const th = gain(v, 0.0001, out);
  ad(th.gain, t, 0.002, 0.9, 0.1);
  const o = osc(v, 'sine', 240 * p, th, 0.13);
  glide(o.frequency, t, 240 * p, 85, 0.09);
  if (k >= 1) {
    const d = gain(v, 0.0001, out);
    ad(d.gain, t + 0.015, 0.002, 0.35, 0.45);
    osc(v, 'sine', 1760, d, 0.5, t + 0.015);
    osc(v, 'sine', 2637, gain(v, 0.5, d), 0.5, t + 0.015);
    return 0.5;
  }
  return 0.15;
};

/** Death: soft "poof" + a comedy squeaky-toy wheeze. */
export const poof: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.08);
  const out = gain(v);
  ad(out.gain, t, 0.01, 0.8, 0.35);
  const bp = filter(v, 'bandpass', 1400, 0.9, out);
  bp.frequency.setValueAtTime(1600, t); bp.frequency.exponentialRampToValueAtTime(300, t + 0.3);
  noiseSrc(v, bp, 0.4, 'pink');
  const sq = gain(v, 0.0001, out);
  ahr(sq.gain, t + 0.12, 0.01, 0.3, 0.14, 0.12);
  const o = osc(v, 'triangle', 1500 * p, filter(v, 'bandpass', 1800, 1.5, sq), 0.42, t + 0.12);
  o.frequency.setValueAtTime(1500 * p, t + 0.12);
  o.frequency.exponentialRampToValueAtTime(2300 * p, t + 0.2);
  o.frequency.exponentialRampToValueAtTime(820 * p, t + 0.38);
  return 0.55;
};

/** Corgi yelp (death flavor): short high "arf" falling off. */
export const yelp: Recipe = (v) => bark(v, 1.45);

/** Jump boing: spring pitch rise with wobble. k = 1 → double jump (higher, with sparkle). */
export const boing: Recipe = (v, k) => {
  const t = v.t, hi = k >= 1, p = vary(v, 0.05);
  const out = gain(v);
  ad(out.gain, t, 0.004, hi ? 0.35 : 0.3, hi ? 0.32 : 0.26);
  const o = osc(v, 'triangle', (hi ? 300 : 170) * p, out, 0.35);
  glide(o.frequency, t, (hi ? 300 : 170) * p, (hi ? 950 : 560) * p, 0.16);
  const w = v.ctx.createOscillator(); w.frequency.value = 26; const wg = v.ctx.createGain();
  wg.gain.setValueAtTime(60, t); wg.gain.exponentialRampToValueAtTime(1, t + 0.3);
  w.connect(wg); wg.connect(o.frequency); w.start(t); w.stop(t + 0.35);
  if (hi) {
    const s = gain(v, 0.0001, out);
    ad(s.gain, t + 0.05, 0.002, 0.2, 0.2);
    osc(v, 'sine', 2093, s, 0.25, t + 0.05);
  }
  return 0.36;
};

/** Land thud; k = impact speed (m/s) scales weight and loudness. */
export const thud: Recipe = (v, k) => {
  const t = v.t, s = Math.min(1.4, Math.max(0.3, (k || 8) / 12));
  const out = gain(v);
  ad(out.gain, t, 0.003, 0.8 * s, 0.14 + 0.08 * s);
  const o = osc(v, 'sine', 120, out, 0.3);
  glide(o.frequency, t, 120, 42, 0.12 + 0.05 * s);
  const n = gain(v, 0.0001, out);
  ad(n.gain, t, 0.002, 0.5 * s, 0.1);
  noiseSrc(v, filter(v, 'lowpass', 700 + 500 * s, 0.7, n), 0.14, 'brown');
  return 0.3;
};

/** Grass footstep. k: 0 corgi paw · 1 cat (softer, padded) · 2 corgi sprint scuff · 3 cat sprint. */
export const footstep: Recipe = (v, k) => {
  const t = v.t, cat = k === 1 || k === 3, sprint = k >= 2;
  const out = gain(v);
  ad(out.gain, t, 0.004, (cat ? 0.22 : 0.3) * (sprint ? 1.2 : 1), 0.06);
  noiseSrc(v, filter(v, 'bandpass', (cat ? 1900 : 2600) * vary(v, 0.2), 1.1, out), 0.08, 'white');
  const th = gain(v, 0.0001, out);
  ad(th.gain, t, 0.003, cat ? 0.15 : 0.25, 0.05);
  osc(v, 'sine', cat ? 150 : 110, th, 0.07);
  return 0.09;
};

/** Reload: three mechanical-ish clicks (click, slide, clack). */
export const reloadClicks: Recipe = (v) => {
  const t = v.t;
  const out = gain(v, 1);
  const at = [0, 0.18, 0.42];
  at.forEach((dt, i) => {
    const g = gain(v, 0.0001, out);
    ad(g.gain, t + dt, 0.001, i === 2 ? 0.5 : 0.35, 0.035);
    noiseSrc(v, filter(v, 'bandpass', i === 1 ? 1800 : 3200, 2, g), 0.05, 'white', t + dt);
    const o = osc(v, 'square', i === 2 ? 900 : 1500, filter(v, 'lowpass', 2500, 1, gain(v, 0.12, g)), 0.03, t + dt);
    void o;
  });
  return 0.5;
};

/** UI: k 0 click, 1 hover tick, 2 back, 3 open. */
export const uiBlip: Recipe = (v, k) => {
  const t = v.t;
  const out = gain(v);
  const f = [880, 1320, 520, 660][k | 0] ?? 880;
  ad(out.gain, t, 0.002, k === 1 ? 0.12 : 0.28, k === 1 ? 0.03 : 0.08);
  const o = osc(v, k === 1 ? 'sine' : 'triangle', f, out, 0.12);
  glide(o.frequency, t, f, k === 2 ? f * 0.7 : f * 1.35, 0.05);
  return 0.12;
};

/** Pickup chime: bright rising arpeggio. */
export const chime: Recipe = (v) => {
  const t = v.t;
  const out = gain(v, 1);
  [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
    const g = gain(v, 0.0001, out);
    ad(g.gain, t + i * 0.06, 0.003, 0.22, 0.28);
    osc(v, 'sine', f, g, 0.35, t + i * 0.06);
  });
  return 0.55;
};

/** Hit confirm for the local shooter: crisp tick (k ≥ 1 = crit: tick + ding). */
export const hitTick: Recipe = (v, k) => {
  const t = v.t;
  const out = gain(v);
  ad(out.gain, t, 0.001, 0.35, 0.04);
  osc(v, 'square', k >= 1 ? 2600 : 2100, filter(v, 'bandpass', 2400, 3, out), 0.05);
  if (k >= 1) { const d = gain(v, 0.0001, v.out); ad(d.gain, t + 0.02, 0.002, 0.25, 0.3); osc(v, 'sine', 2637, d, 0.35, t + 0.02); }
  return k >= 1 ? 0.35 : 0.06;
};

/** Stings: k 0 = kill confirm (ding-ding), 1 = our team scored, 2 = their team scored, 3 = we got KO'd (wah-wah). */
export const sting: Recipe = (v, k) => {
  const t = v.t;
  const out = gain(v, 1);
  const notes: Array<[number, number, number]> =
    k === 0 ? [[1568, 0, 0.18], [2093, 0.09, 0.3]] :
    k === 1 ? [[523.25, 0, 0.16], [659.25, 0.1, 0.16], [783.99, 0.2, 0.16], [1046.5, 0.3, 0.5]] :
    k === 2 ? [[392, 0, 0.2], [370, 0.16, 0.2], [311.1, 0.32, 0.45]] :
    [[392, 0, 0.3], [370, 0.32, 0.3], [349.2, 0.64, 0.3], [329.6, 0.96, 0.7]];
  const brass = k === 3 || k === 2;
  for (const [f, dt, d] of notes) {
    const g = gain(v, 0.0001, out);
    ahr(g.gain, t + dt, 0.012, brass ? 0.2 : 0.22, d * 0.5, d * 0.5);
    const lp = filter(v, 'lowpass', brass ? 1400 : 5000, 1, g);
    const o = osc(v, brass ? 'sawtooth' : 'triangle', f, lp, d + 0.1, t + dt);
    if (k === 3) { const w = v.ctx.createOscillator(); w.frequency.value = 6; const wg = v.ctx.createGain(); wg.gain.value = 9; w.connect(wg); wg.connect(o.frequency); w.start(t + dt); w.stop(t + dt + d + 0.1); }
  }
  const last = notes[notes.length - 1];
  return last[1] + last[2] + 0.1;
};

/** Respawn: shimmering upward glissando. */
export const sparkle: Recipe = (v) => {
  const t = v.t;
  const out = gain(v);
  ahr(out.gain, t, 0.05, 0.16, 0.2, 0.35);
  const o = osc(v, 'sine', 700, out, 0.65);
  glide(o.frequency, t, 700, 2400, 0.45);
  const o2 = osc(v, 'sine', 1050, gain(v, 0.5, out), 0.65);
  glide(o2.frequency, t, 1050, 3600, 0.45);
  return 0.65;
};

/** Ability whoomp (bark blast adds a big bark on top). */
export const whoomp: Recipe = (v) => {
  const t = v.t;
  const out = gain(v);
  ad(out.gain, t, 0.01, 0.9, 0.45);
  const o = osc(v, 'sine', 90, out, 0.5);
  glide(o.frequency, t, 90, 40, 0.35);
  const n = gain(v, 0.0001, out);
  ad(n.gain, t, 0.01, 0.4, 0.3);
  const lp = filter(v, 'lowpass', 1800, 0.8, n);
  lp.frequency.exponentialRampToValueAtTime(200, t + 0.3);
  noiseSrc(v, lp, 0.35, 'pink');
  return 0.5;
};

/** Grit for music bass/stabs (exported for music.ts). */
export function drive(ctx: BaseAudioContext, amount: number): WaveShaperNode {
  const w = ctx.createWaveShaper();
  w.curve = softClip(amount);
  w.oversample = '2x';
  return w;
}

/** Spotter Drone launch: a toy propeller whirring up (buzzy saw with a wobble) and a little radio chirp. */
export const droneWhir: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.04);
  const out = gain(v);
  ahr(out.gain, t, 0.05, 0.32, 0.35, 0.25);
  const o = osc(v, 'sawtooth', 140 * p, filter(v, 'bandpass', 900, 1.4, out), 0.7);
  glide(o.frequency, t, 140 * p, 320 * p, 0.45);
  const w = v.ctx.createOscillator(); w.frequency.value = 38; const wg = v.ctx.createGain();
  wg.gain.value = 18; w.connect(wg); wg.connect(o.frequency); w.start(t); w.stop(t + 0.7);
  const chirp = gain(v, 0.0001, out);
  ad(chirp.gain, t + 0.42, 0.003, 0.22, 0.07);
  const c = osc(v, 'square', 1800 * p, filter(v, 'lowpass', 3000, 1, chirp), 0.1, t + 0.42);
  glide(c.frequency, t + 0.42, 1800 * p, 2600 * p, 0.06);
  return 0.72;
};

/** Dig Charge: a shovel thunk into dirt, then two arming beeps. */
export const chargeArm: Recipe = (v) => {
  const t = v.t;
  const out = gain(v, 1);
  const th = gain(v, 0.0001, out);
  ad(th.gain, t, 0.002, 0.8, 0.12);
  const o = osc(v, 'sine', 170, th, 0.15);
  glide(o.frequency, t, 170, 55, 0.12);
  const dirt = gain(v, 0.0001, out);
  ad(dirt.gain, t, 0.003, 0.35, 0.12);
  noiseSrc(v, filter(v, 'lowpass', 1200, 0.8, dirt), 0.14, 'brown');
  for (const dt of [0.55, 0.8]) {
    const b = gain(v, 0.0001, out);
    ad(b.gain, t + dt, 0.002, 0.18, 0.06);
    osc(v, 'square', 1320, filter(v, 'lowpass', 2600, 1, b), 0.07, t + dt);
  }
  return 0.9;
};

/** Squeak Barrier: a giant rubber-toy squeak (rise and fall) over a soft thump as the wall pops up. */
export const squeakWall: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.05);
  const out = gain(v);
  ad(out.gain, t, 0.004, 0.45, 0.4);
  const o = osc(v, 'triangle', 520 * p, filter(v, 'bandpass', 1400, 2.2, out), 0.45);
  glide(o.frequency, t, 520 * p, 1250 * p, 0.12);
  glide(o.frequency, t + 0.14, 1250 * p, 700 * p, 0.22);
  const th = gain(v, 0.0001, out);
  ad(th.gain, t, 0.003, 0.6, 0.16);
  const s = osc(v, 'sine', 110, th, 0.2);
  glide(s.frequency, t, 110, 50, 0.15);
  return 0.45;
};

// ---- E1: Madame Pointillé, the sniper elite (keyed by her `ability` event names) ----

/** dot_paint: the laser dot lands on someone — a soft rising sine "ping" (a warning, not a threat yet). */
export const dotPing: Recipe = (v) => {
  const t = v.t;
  const out = gain(v);
  ad(out.gain, t, 0.004, 0.22, 0.26);
  const o = osc(v, 'sine', 1150, out, 0.3);
  glide(o.frequency, t, 1150, 1760, 0.18);
  return 0.3;
};

/** dot_glint: the lens glints, the shot is 0.45 s away — a bright, glassy "tink" with a shimmer. */
export const glintTink: Recipe = (v) => {
  const t = v.t;
  const out = gain(v, 1);
  const a = gain(v, 0.0001, out);
  ad(a.gain, t, 0.001, 0.3, 0.22);
  osc(v, 'triangle', 3520, filter(v, 'highpass', 1800, 0.7, a), 0.25);
  const b = gain(v, 0.0001, out);
  ad(b.gain, t + 0.035, 0.002, 0.14, 0.2);
  osc(v, 'sine', 5274, b, 0.25, t + 0.035);
  return 0.26;
};

/** dot_lost: the lock is broken — the ping falling away, quietly. */
export const dotLost: Recipe = (v) => {
  const t = v.t;
  const out = gain(v);
  ad(out.gain, t, 0.004, 0.12, 0.22);
  const o = osc(v, 'sine', 1500, out, 0.25);
  glide(o.frequency, t, 1500, 700, 0.2);
  return 0.25;
};

/** shot_spoiled: a weak-point hit spoils her shot — a comic "clonk" and a little ricochet whistle. */
export const clonk: Recipe = (v) => {
  const t = v.t;
  const out = gain(v, 1);
  const c = gain(v, 0.0001, out);
  ad(c.gain, t, 0.001, 0.7, 0.16);
  const o = osc(v, 'square', 420, filter(v, 'bandpass', 900, 2.5, c), 0.18);
  glide(o.frequency, t, 420, 260, 0.1);
  const r = gain(v, 0.0001, out);
  ad(r.gain, t + 0.06, 0.004, 0.16, 0.3);
  const w = osc(v, 'sine', 2400, r, 0.36, t + 0.06);
  glide(w.frequency, t + 0.06, 2400, 1100, 0.3);
  return 0.4;
};

/** beret_off: phase 2 — the beret flies off with a cartoon "pop". */
export const pop: Recipe = (v) => {
  const t = v.t;
  const out = gain(v);
  ad(out.gain, t, 0.001, 0.55, 0.09);
  const o = osc(v, 'sine', 380, out, 0.12);
  glide(o.frequency, t, 380, 980, 0.05);
  return 0.12;
};

// ---- S2: vehicle, destructible and adventure voices ----

/** mount / dismount: a plastic seat clunk with a latch click and a little seat-spring squeak. k 0 = hop on (the
 *  spring rises), 1 = hop off (lighter, the spring falls). */
export const seatClunk: Recipe = (v, k) => {
  const t = v.t, off = k >= 1, p = vary(v, 0.05);
  const out = gain(v, 1);
  const th = gain(v, 0.0001, out);
  ad(th.gain, t, 0.002, off ? 0.5 : 0.65, 0.09);
  const o = osc(v, 'sine', (off ? 150 : 185) * p, th, 0.12);
  glide(o.frequency, t, (off ? 150 : 185) * p, 70, 0.08);
  const lt = t + (off ? 0 : 0.045);
  const c = gain(v, 0.0001, out);
  ad(c.gain, lt, 0.001, 0.32, 0.035);
  noiseSrc(v, filter(v, 'bandpass', 1500 * p, 3, c), 0.05, 'white', lt);
  osc(v, 'square', 620 * p, filter(v, 'lowpass', 1800, 1, gain(v, 0.25, c)), 0.05, lt);
  const s = gain(v, 0.0001, out);
  ad(s.gain, t + 0.02, 0.004, 0.12, 0.16);
  const sp = osc(v, 'triangle', (off ? 900 : 600) * p, s, 0.2, t + 0.02);
  glide(sp.frequency, t + 0.02, (off ? 900 : 600) * p, (off ? 520 : 1050) * p, 0.12);
  return 0.24;
};

/** bail: out of the plane in mid-air — a rising whoosh with a cartoon cork "pop" at its top. */
export const bailPop: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.05);
  const out = gain(v, 1);
  const w = gain(v, 0.0001, out);
  ahr(w.gain, t, 0.03, 0.5, 0.08, 0.28);
  const bp = filter(v, 'bandpass', 380, 2.4, w);
  bp.frequency.setValueAtTime(380, t);
  bp.frequency.exponentialRampToValueAtTime(3000, t + 0.2);
  bp.frequency.exponentialRampToValueAtTime(900, t + 0.4);
  noiseSrc(v, bp, 0.42, 'pink');
  const tp = t + 0.12;
  const pg = gain(v, 0.0001, out);
  ad(pg.gain, tp, 0.001, 0.6, 0.08);
  const o = osc(v, 'sine', 420 * p, pg, 0.1, tp);
  glide(o.frequency, tp, 420 * p, 1100 * p, 0.04);
  const ck = gain(v, 0.0001, out);
  ad(ck.gain, tp, 0.001, 0.3, 0.02);
  noiseSrc(v, filter(v, 'highpass', 2500, 0.7, ck), 0.03, 'white', tp);
  return 0.45;
};

/** boost: a rocket-can "FWOOSH" — ignition whump, a rising band of rushing air, a low roar and a sizzle. */
export const rocketFwoosh: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.06);
  const out = gain(v, 1);
  const wh = gain(v, 0.0001, out);
  ad(wh.gain, t, 0.004, 0.5, 0.18);
  const o = osc(v, 'sine', 110 * p, wh, 0.22);
  glide(o.frequency, t, 110 * p, 45, 0.16);
  const fw = gain(v, 0.0001, out);
  ahr(fw.gain, t, 0.02, 0.5, 0.12, 0.45);
  const bp = filter(v, 'bandpass', 350, 1.3, fw);
  glide(bp.frequency, t, 350 * p, 2200 * p, 0.25);
  bp.frequency.exponentialRampToValueAtTime(1200, t + 0.6);
  noiseSrc(v, bp, 0.62, 'pink');
  const r = gain(v, 0.0001, out);
  ahr(r.gain, t + 0.01, 0.03, 0.4, 0.15, 0.4);
  noiseSrc(v, filter(v, 'lowpass', 600, 0.8, r), 0.62, 'brown', t + 0.01);
  const cr = gain(v, 0.0001, out);
  ahr(cr.gain, t + 0.04, 0.02, 0.12, 0.2, 0.25);
  noiseSrc(v, filter(v, 'highpass', 3500, 0.8, cr), 0.52, 'white', t + 0.04, 0.3);
  return 0.66;
};

/** horn (kart, Fire/Ability while seated): a toy "beep-beep" — two square-wave major-third dyads through a tiny
 *  speaker band. */
export const honk: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.02);
  const out = gain(v, 1);
  const spk = filter(v, 'bandpass', 1300, 1.1, out);
  for (const dt of [0, 0.16]) {
    const g = gain(v, 0.0001, spk);
    ahr(g.gain, t + dt, 0.006, 0.3, 0.08, 0.04);
    osc(v, 'square', 587.3 * p, g, 0.14, t + dt);
    osc(v, 'square', 740 * p, g, 0.14, t + dt);
  }
  return 0.34;
};

/** destruct:wall_boards — the Garage wall gives: a heavy thump, sharp splinter cracks, tumbling planks knocking,
 *  and a dusty rubble tail. */
export const woodCrash: Recipe = (v) => {
  const t = v.t;
  const out = gain(v, 1);
  const th = gain(v, 0.0001, out);
  ad(th.gain, t, 0.003, 0.65, 0.22);
  const o = osc(v, 'sine', 120, th, 0.28);
  glide(o.frequency, t, 120, 45, 0.2);
  const cracks = [0, 0.025, 0.06, 0.11, 0.19, 0.3];
  for (let i = 0; i < cracks.length; i++) {
    const dt = cracks[i] + v.rand() * 0.015;
    const g = gain(v, 0.0001, out);
    ad(g.gain, t + dt, 0.001, 0.42 - i * 0.05, 0.04 + 0.03 * v.rand());
    noiseSrc(v, filter(v, 'bandpass', 1800 + 1600 * v.rand(), 3.5, g), 0.1, 'white', t + dt);
  }
  const knocks: Array<[number, number]> = [[0.05, 240], [0.16, 310], [0.28, 200], [0.42, 270]];
  for (const [dt, f0] of knocks) {
    const f = f0 * vary(v, 0.08);
    const g = gain(v, 0.0001, out);
    ad(g.gain, t + dt, 0.002, 0.28, 0.09);
    const k = osc(v, 'triangle', f, g, 0.12, t + dt);
    glide(k.frequency, t + dt, f, f * 0.82, 0.06);
  }
  const d = gain(v, 0.0001, out);
  ahr(d.gain, t + 0.03, 0.03, 0.2, 0.15, 0.45);
  noiseSrc(v, filter(v, 'lowpass', 1400, 0.7, d), 0.7, 'pink', t + 0.03);
  return 0.75;
};

/** destruct:tuna_stack — tin cans everywhere: a bright crash, then cans pinging (two inharmonic partials each) as
 *  they bounce, denser at first and quieter as they settle, over a rolling rattle. */
export const canClatter: Recipe = (v) => {
  const t = v.t;
  const out = gain(v, 1);
  const h = gain(v, 0.0001, out);
  ad(h.gain, t, 0.001, 0.4, 0.12);
  noiseSrc(v, filter(v, 'highpass', 2500, 0.8, h), 0.15);
  let dt = 0;
  for (let i = 0; i < 8; i++) {
    dt += 0.03 + 0.06 * v.rand() + i * 0.012;
    const f = 1150 + 1500 * v.rand();
    const g = gain(v, 0.0001, out);
    ad(g.gain, t + dt, 0.001, 0.26 * (1 - i / 10), 0.07 + 0.08 * v.rand());
    osc(v, 'triangle', f, g, 0.18, t + dt);
    osc(v, 'sine', f * 2.76, gain(v, 0.5, g), 0.18, t + dt);
  }
  const r = gain(v, 0.0001, out);
  ahr(r.gain, t + 0.1, 0.05, 0.08, 0.3, 0.3);
  noiseSrc(v, filter(v, 'bandpass', 3200, 2, r), 0.8, 'white', t + 0.1, 0.5);
  return Math.max(dt + 0.22, 0.8);
};

/** destruct:crate_stack — a crate stack caves in: a dull heavy thump, a grainy "krrk" crunch (noise chopped by a
 *  fast square), a few board snaps and hollow box knocks. Lower and duller than the wall's splinters. */
export const crateCrunch: Recipe = (v) => {
  const t = v.t;
  const out = gain(v, 1);
  const th = gain(v, 0.0001, out);
  ad(th.gain, t, 0.003, 0.7, 0.25);
  const o = osc(v, 'sine', 95, th, 0.3);
  glide(o.frequency, t, 95, 38, 0.22);
  const cr = gain(v, 0.0001, out);
  ahr(cr.gain, t, 0.004, 0.5, 0.08, 0.22);
  const bp = filter(v, 'bandpass', 1100, 0.9, cr);
  glide(bp.frequency, t, 1100, 380, 0.3);
  const am = gain(v, 0.6, bp);
  noiseSrc(v, am, 0.4, 'pink');
  const lfo = v.ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 38;
  const lg = v.ctx.createGain(); lg.gain.value = 0.4;
  lfo.connect(lg); lg.connect(am.gain); lfo.start(t); lfo.stop(t + 0.45);
  for (const dt of [0.02, 0.09, 0.2]) {
    const g = gain(v, 0.0001, out);
    ad(g.gain, t + dt, 0.001, 0.26, 0.05);
    noiseSrc(v, filter(v, 'bandpass', 1100 + 500 * v.rand(), 2.5, g), 0.08, 'white', t + dt);
  }
  const knocks: Array<[number, number]> = [[0.12, 160], [0.3, 130], [0.46, 180]];
  for (const [dt, f] of knocks) {
    const g = gain(v, 0.0001, out);
    ad(g.gain, t + dt, 0.002, 0.3, 0.1);
    const k = osc(v, 'sine', f, g, 0.13, t + dt);
    glide(k.frequency, t + dt, f, f * 0.75, 0.08);
  }
  return 0.62;
};

/** Adventure step complete (score reason 'step'): a quick rising marimba "ta-da" in the music's key (A5 C6 F6) with
 *  a glassy ding on the last note. Short, so it never talks over the next step's barks. */
export const stepJingle: Recipe = (v) => {
  const t = v.t;
  const out = gain(v, 1);
  const notes: Array<[number, number, number]> = [[880, 0, 0.14], [1046.5, 0.075, 0.14], [1396.9, 0.15, 0.42]];
  for (const [f, dt, d] of notes) {
    const g = gain(v, 0.0001, out);
    ad(g.gain, t + dt, 0.003, 0.24, d);
    osc(v, 'sine', f, g, d + 0.05, t + dt);
    const h = gain(v, 0.0001, out);
    ad(h.gain, t + dt, 0.002, 0.07, 0.06);
    osc(v, 'sine', f * 4, h, 0.1, t + dt);
  }
  const b = gain(v, 0.0001, out);
  ad(b.gain, t + 0.15, 0.002, 0.09, 0.5);
  osc(v, 'triangle', 2793.8, b, 0.55, t + 0.15);
  return 0.7;
};

/** Adventure chapter complete (score reason 'chapter'): a toy-brass fanfare in F — a triplet pickup, a held F, a
 *  climb, then a full F-major chord with delayed vibrato over timpani thumps, a cymbal swell and a glockenspiel
 *  sparkle. ~2.4 s. */
export const chapterFanfare: Recipe = (v) => {
  const t = v.t;
  const out = gain(v, 1);
  const brass = (f: number, at: number, d: number, peak: number): OscillatorNode => {
    const g = gain(v, 0.0001, out);
    ahr(g.gain, t + at, 0.015, peak, d * 0.6, d * 0.4 + 0.05);
    const lp = filter(v, 'lowpass', 700, 1.2, g, t + at);
    lp.frequency.exponentialRampToValueAtTime(2600, t + at + 0.05);
    lp.frequency.exponentialRampToValueAtTime(1300, t + at + d);
    return osc(v, 'sawtooth', f, lp, d + 0.1, t + at);
  };
  // melody: C C C | F — | A C | (chord)
  brass(523.25, 0, 0.08, 0.16); brass(523.25, 0.11, 0.08, 0.16); brass(523.25, 0.22, 0.08, 0.16);
  brass(698.46, 0.33, 0.42, 0.2);
  brass(880, 0.8, 0.16, 0.18); brass(1046.5, 1.0, 0.16, 0.18);
  // final chord (F4 F5 A5 C6) with vibrato that swells in after 0.3 s
  const vib = v.ctx.createOscillator(); vib.frequency.value = 5.5;
  const vd = v.ctx.createGain(); vd.gain.setValueAtTime(0, t + 1.22); vd.gain.linearRampToValueAtTime(14, t + 1.6);
  vib.connect(vd); vib.start(t + 1.22); vib.stop(t + 2.45);
  for (const f of [349.23, 698.46, 880, 1046.5]) vd.connect(brass(f, 1.22, 1.0, 0.085).detune);
  // timpani on the held F and the chord
  for (const at of [0.33, 1.22]) {
    const g = gain(v, 0.0001, out);
    ad(g.gain, t + at, 0.004, 0.4, 0.35);
    const o = osc(v, 'sine', 98, g, 0.4, t + at);
    glide(o.frequency, t + at, 98, 70, 0.3);
  }
  // cymbal swell under the chord
  const cy = gain(v, 0.0001, out);
  ahr(cy.gain, t + 1.1, 0.12, 0.07, 0.3, 0.8);
  noiseSrc(v, filter(v, 'highpass', 5500, 0.7, cy), 1.3, 'white', t + 1.1);
  // glockenspiel sparkle (F6 A6 C7)
  [1396.9, 1760, 2093].forEach((f, i) => {
    const g = gain(v, 0.0001, out);
    ad(g.gain, t + 1.22 + i * 0.07, 0.002, 0.08, 0.5);
    osc(v, 'sine', f, g, 0.55, t + 1.22 + i * 0.07);
  });
  return 2.45;
};

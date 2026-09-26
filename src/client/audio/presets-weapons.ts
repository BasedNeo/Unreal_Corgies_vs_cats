// OWNER: X3 (weapons + combat feedback). HARDENED weapon voices (MASTER_PLAN §12 theme data): every shot is layered
// like a real report — a noise crack (transient), a sine thump (body), a band-passed blast, a filtered tail (the yard
// answering back) and the gun's own mechanism — with the pet joke kept to a whisper (the Squeaker's tiny squeak on
// the bolt, the snap bar's click). Plus impacts by surface, the local shooter's hit thud and kill thump, and brass
// tinkling onto the ground. Re-exported from presets.ts, so the strict recipe test schedules all of them.
import { ad, ahr, filter, gain, glide, noiseSrc, osc, softClip, type Voice } from './synth';

type Recipe = (v: Voice, k: number) => number;
const vary = (v: Voice, amt: number) => 1 + (v.rand() * 2 - 1) * amt;

/** Grit bus: a soft-clipping waveshaper into the voice output (shots only; per-voice node, cached curve). */
function grit(v: Voice, amount: number, to: AudioNode = v.out): AudioNode {
  const ws = v.ctx.createWaveShaper();
  ws.curve = softClip(amount);
  ws.connect(to);
  return ws;
}

/** Shared report layers. `s` scales the whole report (weight class), `p` the pitch. */
function report(v: Voice, t: number, s: number, p: number, crackHz: number, bodyHz: number, blastHz: number, tail: number, out: AudioNode): void {
  // crack
  const c = gain(v, 0.0001, out);
  ad(c.gain, t, 0.001, 0.42 * s, 0.028);
  noiseSrc(v, filter(v, 'highpass', crackHz * p, 0.7, c), 0.06);
  // body thump
  const b = gain(v, 0.0001, out);
  ad(b.gain, t, 0.002, 0.45 * s, 0.09 + 0.05 * s);
  const o = osc(v, 'sine', bodyHz * p, b, 0.2 + 0.1 * s);
  glide(o.frequency, t, bodyHz * p, bodyHz * 0.42 * p, 0.07 + 0.04 * s);
  // blast (the muzzle's bark)
  const m = gain(v, 0.0001, out);
  ad(m.gain, t + 0.002, 0.003, 0.3 * s, 0.1 + 0.05 * s);
  noiseSrc(v, filter(v, 'bandpass', blastHz * p, 1.1, m), 0.2, 'pink');
  // tail: the yard answering back
  if (tail > 0) {
    const e = gain(v, 0.0001, out);
    ahr(e.gain, t + 0.02, 0.02, 0.14 * s, 0.03, tail);
    const lp = filter(v, 'lowpass', 1100, 0.6, e);
    lp.frequency.setValueAtTime(1100, t + 0.02);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.05 + tail);
    noiseSrc(v, lp, tail + 0.1, 'brown', t + 0.02);
  }
}

/** A metal click (bolt, slide, pump): a short square blip through a band-pass. */
function click(v: Voice, t: number, hz: number, level: number, out: AudioNode): void {
  const g = gain(v, 0.0001, out);
  ad(g.gain, t, 0.001, level, 0.018);
  osc(v, 'square', hz, filter(v, 'bandpass', hz, 4, g), 0.03, t);
  const n = gain(v, 0.0001, out);
  ad(n.gain, t, 0.001, level * 0.6, 0.012);
  noiseSrc(v, filter(v, 'highpass', 4000, 0.7, n), 0.03, 'white', t);
}

/** Squeaker Rifle: a hard rifle report with a bolt clack and the faintest rubber squeak riding the bolt. */
export const rifleShot: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.06);
  const out = grit(v, 1.8);
  report(v, t, 1, p, 1900, 125, 780, 0.22, out);
  click(v, t + 0.018, 3300 * p, 0.14, v.out);
  const sq = gain(v, 0.0001, v.out);
  ad(sq.gain, t + 0.03, 0.004, 0.035, 0.03);
  const o = osc(v, 'triangle', 2500 * p, filter(v, 'bandpass', 2900, 3, sq), 0.06, t + 0.03);
  glide(o.frequency, t + 0.03, 2500 * p, 3300 * p, 0.03);
  return 0.34;
};

/** Snap Pistol (suppressed): a heavy "thup", the slide cycling, the snap bar's bright click. */
export const pistolShot: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.05);
  const out = grit(v, 1.4);
  const th = gain(v, 0.0001, out);
  ad(th.gain, t, 0.002, 0.7, 0.07);
  noiseSrc(v, filter(v, 'bandpass', 1100 * p, 1, th), 0.1, 'pink');
  const b = gain(v, 0.0001, out);
  ad(b.gain, t, 0.002, 0.75, 0.08);
  const o = osc(v, 'sine', 170 * p, b, 0.12);
  glide(o.frequency, t, 170 * p, 70, 0.07);
  const air = gain(v, 0.0001, out);
  ad(air.gain, t, 0.001, 0.25, 0.05);
  noiseSrc(v, filter(v, 'highpass', 5200, 0.7, air), 0.07);
  click(v, t + 0.035, 2600 * p, 0.16, v.out);
  click(v, t + 0.065, 3900 * p, 0.12, v.out);
  return 0.16;
};

/** Laser Longshot: the laser's zap snaps into a heavy crack and a long rolling boom, then the bolt cycles. */
export const sniperShot: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.04);
  const out = grit(v, 2.2);
  const z = gain(v, 0.0001, out);
  ad(z.gain, t, 0.002, 0.28, 0.12);
  const zo = osc(v, 'sawtooth', 2600 * p, filter(v, 'lowpass', 5200, 1.5, z), 0.15);
  glide(zo.frequency, t, 2600 * p, 180, 0.12);
  report(v, t + 0.004, 1.35, p, 2200, 95, 560, 0.75, out);
  click(v, t + 0.42, 1900 * p, 0.12, v.out);
  click(v, t + 0.56, 2600 * p, 0.14, v.out);
  return 1.0;
};

/** Tennis Mortar: a deep tube THWUMP with a hollow ring and a puff of air. */
export const mortarShot: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.05);
  const out = grit(v, 1.6);
  const b = gain(v, 0.0001, out);
  ad(b.gain, t, 0.003, 1, 0.26);
  const o = osc(v, 'sine', 105 * p, b, 0.32);
  glide(o.frequency, t, 105 * p, 36, 0.24);
  const pop = gain(v, 0.0001, out);
  ad(pop.gain, t, 0.002, 0.55, 0.07);
  noiseSrc(v, filter(v, 'bandpass', 620 * p, 1.4, pop), 0.1, 'pink');
  const ring = gain(v, 0.0001, v.out);
  ad(ring.gain, t + 0.01, 0.004, 0.12, 0.18);
  osc(v, 'sine', 390 * p, ring, 0.22, t + 0.01);
  osc(v, 'sine', 610 * p, gain(v, 0.5, ring), 0.22, t + 0.01);
  const air = gain(v, 0.0001, v.out);
  ahr(air.gain, t + 0.02, 0.03, 0.16, 0.05, 0.25);
  noiseSrc(v, filter(v, 'bandpass', 1500, 0.8, air), 0.4, 'pink', t + 0.02);
  return 0.42;
};

/** Sprinkler Cannon: a wet blast (body + band noise), pressurised hiss, then the pump racks. */
export const shotgunBlast: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.05);
  const out = grit(v, 1.9);
  report(v, t, 1.2, p, 1500, 88, 480, 0.3, out);
  const h = gain(v, 0.0001, v.out);
  ahr(h.gain, t + 0.01, 0.01, 0.2, 0.06, 0.28);
  noiseSrc(v, filter(v, 'highpass', 3200 * p, 0.8, h), 0.45, 'white', t + 0.01);
  click(v, t + 0.3, 1500 * p, 0.14, v.out);
  click(v, t + 0.43, 1900 * p, 0.16, v.out);
  return 0.55;
};

/** Frisbee Launcher: flywheels spin up and fling — a rising whine, a whoosh and a clack. */
export const discLaunch: Recipe = (v) => {
  const t = v.t, p = vary(v, 0.05);
  const w = gain(v, 0.0001, v.out);
  ad(w.gain, t, 0.01, 0.2, 0.14);
  const o = osc(v, 'sawtooth', 380 * p, filter(v, 'lowpass', 2600, 1, w), 0.18);
  glide(o.frequency, t, 380 * p, 980 * p, 0.12);
  const wh = gain(v, 0.0001, v.out);
  ahr(wh.gain, t + 0.02, 0.02, 0.35, 0.04, 0.16);
  const bp = filter(v, 'bandpass', 900, 1, wh);
  bp.frequency.setValueAtTime(900, t + 0.02);
  bp.frequency.exponentialRampToValueAtTime(2600, t + 0.2);
  noiseSrc(v, bp, 0.3, 'pink', t + 0.02);
  click(v, t, 1300 * p, 0.2, v.out);
  return 0.3;
};

/**
 * Impact by surface (k = the fx/surfaces.ts kind): 0 dirt · 1 grass · 2 sand · 3 stone · 4 metal (ricochet ping)
 * · 5 wood (thock) · 6 water (splash) · 7 soft (thump). Short and quiet: these are texture under the shots.
 */
export const impactSfx: Recipe = (v, k) => {
  const t = v.t, p = vary(v, 0.12);
  const out = gain(v, 1);
  switch (Math.round(k)) {
    case 4: { // metal: a ricochet ping + tink
      const g = gain(v, 0.0001, out);
      ad(g.gain, t, 0.001, 0.24, 0.22);
      const o = osc(v, 'sine', 2900 * p, g, 0.3);
      glide(o.frequency, t, 2900 * p, 2100 * p, 0.25);
      osc(v, 'sine', 4370 * p, gain(v, 0.35, g), 0.2);
      const n = gain(v, 0.0001, out);
      ad(n.gain, t, 0.001, 0.3, 0.02);
      noiseSrc(v, filter(v, 'highpass', 5000, 0.8, n), 0.04);
      return 0.32;
    }
    case 5: { // wood: thock
      const g = gain(v, 0.0001, out);
      ad(g.gain, t, 0.001, 0.45, 0.06);
      noiseSrc(v, filter(v, 'bandpass', 950 * p, 2.2, g), 0.09, 'pink');
      const b = gain(v, 0.0001, out);
      ad(b.gain, t, 0.002, 0.35, 0.07);
      osc(v, 'triangle', 280 * p, b, 0.1);
      return 0.12;
    }
    case 6: { // water: splash
      const g = gain(v, 0.0001, out);
      ahr(g.gain, t, 0.006, 0.4, 0.03, 0.2);
      const bp = filter(v, 'bandpass', 2400 * p, 0.9, g);
      bp.frequency.setValueAtTime(2400 * p, t);
      bp.frequency.exponentialRampToValueAtTime(700, t + 0.22);
      noiseSrc(v, bp, 0.3, 'white');
      return 0.3;
    }
    case 3: { // stone: chip
      const g = gain(v, 0.0001, out);
      ad(g.gain, t, 0.001, 0.4, 0.035);
      noiseSrc(v, filter(v, 'highpass', 2600 * p, 0.8, g), 0.06);
      click(v, t, 3400 * p, 0.12, out);
      return 0.08;
    }
    case 7: { // soft: thump
      const g = gain(v, 0.0001, out);
      ad(g.gain, t, 0.002, 0.4, 0.08);
      noiseSrc(v, filter(v, 'lowpass', 380 * p, 0.8, g), 0.12, 'brown');
      return 0.12;
    }
    default: { // dirt, grass, sand: a dull thud with a spray of grit
      const g = gain(v, 0.0001, out);
      ad(g.gain, t, 0.002, 0.45, 0.07);
      noiseSrc(v, filter(v, 'lowpass', 560 * p, 0.8, g), 0.1, 'brown');
      const s = gain(v, 0.0001, out);
      ad(s.gain, t + 0.01, 0.004, 0.12, 0.08);
      noiseSrc(v, filter(v, 'highpass', 3000, 0.7, s), 0.12, 'white', t + 0.01);
      return 0.14;
    }
  }
};

/**
 * The local shooter's hit confirmation: a body THUD under a bright tick (2D, UI bus). k: 0 hit · 1 crit (adds a
 * high "tink") · 2 kill (a heavier double thump).
 */
export const hitThud: Recipe = (v, k) => {
  const t = v.t;
  const out = gain(v, 1);
  const kill = k >= 2, crit = k >= 1 && !kill;
  const b = gain(v, 0.0001, out);
  ad(b.gain, t, 0.002, kill ? 0.75 : 0.55, kill ? 0.12 : 0.07);
  const o = osc(v, 'sine', kill ? 130 : 165, b, 0.16);
  glide(o.frequency, t, kill ? 130 : 165, kill ? 55 : 80, kill ? 0.1 : 0.06);
  const n = gain(v, 0.0001, out);
  ad(n.gain, t, 0.001, 0.3, 0.04);
  noiseSrc(v, filter(v, 'lowpass', 1400, 0.8, n), 0.06, 'pink');
  const tick = gain(v, 0.0001, out);
  ad(tick.gain, t, 0.001, 0.22, 0.03);
  osc(v, 'square', crit ? 2700 : 2150, filter(v, 'bandpass', 2400, 3, tick), 0.04);
  if (crit) { const d = gain(v, 0.0001, out); ad(d.gain, t + 0.015, 0.002, 0.22, 0.28); osc(v, 'sine', 2637, d, 0.32, t + 0.015); }
  if (kill) {
    const b2 = gain(v, 0.0001, out);
    ad(b2.gain, t + 0.09, 0.002, 0.6, 0.14);
    const o2 = osc(v, 'sine', 110, b2, 0.18, t + 0.09);
    glide(o2.frequency, t + 0.09, 110, 45, 0.12);
    return 0.36;
  }
  return crit ? 0.34 : 0.1;
};

/** Brass hitting the ground (local shooter only): k 0 = brass (inharmonic pings), 1 = a plastic shotgun hull tock. */
export const brassTinkle: Recipe = (v, k) => {
  const t = v.t + 0.35 + v.rand() * 0.12, p = vary(v, 0.08);
  const out = gain(v, 1);
  if (k >= 1) {
    const g = gain(v, 0.0001, out);
    ad(g.gain, t, 0.001, 0.16, 0.04);
    noiseSrc(v, filter(v, 'bandpass', 1200 * p, 2, g), 0.06, 'pink', t);
    return 0.5;
  }
  for (let i = 0; i < 2; i++) {
    const g = gain(v, 0.0001, out);
    const ti = t + i * (0.07 + v.rand() * 0.05);
    ad(g.gain, ti, 0.001, i === 0 ? 0.12 : 0.07, 0.05);
    osc(v, 'sine', (i === 0 ? 4300 : 5200) * p, g, 0.07, ti);
    osc(v, 'sine', (i === 0 ? 6650 : 7400) * p, gain(v, 0.4, g), 0.07, ti);
  }
  return 0.75;
};

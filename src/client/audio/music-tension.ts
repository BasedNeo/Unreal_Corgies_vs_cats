// W10 AU2 (audio-2): the carrier tension layer of the adaptive music (music.ts calls it on every 16th step, on the
// music's own audio-clock schedule, so it is always in time and in key). Driven by presets-objective.ts
// `objectiveTension`: while your team's carrier runs, while you carry, or while an enemy runs with your ball.
//   heartbeat   a low "lub-dub" (two sine thumps and a felt knock): on beats 1 and 3 from level 0.2, on every beat
//               (108 bpm: a racing heart) from 0.55
//   pulse       from level 0.7, 8th notes on the chord root: a filtered saw whose filter opens as the carrier nears
//               the ring (the pulse "rises"). `hunted` (you carry, or they have your ball): root and minor second
//               alternate, the old shorthand for something closing in; otherwise root and fifth (a drive home)
// It plays through its own layer gain (music bus), which music.ts ducks with the groove the way the bed ducks, so a
// firefight takes the lead and the heartbeat stays underneath.
import { midiHz } from './synth';

export const PULSE = {
  /** Level thresholds: half-time heart, full-time heart, the 8th-note pulse. */
  slow: 0.2, fast: 0.55, pulse: 0.7,
  /** Layer gain at full tension, and its duck under the groove (the bed's 0.35). */
  gain: 0.9, duck: 0.35,
  /** Heartbeat thump peaks (lub, dub), pulse peak. */
  lub: 0.5, dub: 0.34, pulsePeak: 0.07,
} as const;

/** The layer's target gain for a tension level and the groove layer's gain. */
export function pulseGain(level: number, groove: number): number {
  if (level < PULSE.slow * 0.5) return 0.0001;
  const x = Math.min(1, level);
  return Math.max(0.0001, PULSE.gain * (0.55 + 0.45 * x) * (1 - PULSE.duck * Math.min(1, Math.max(0, groove))));
}

/** Which heart beats land on 16th step `s` (0..15) at this level: 'lub', 'dub' or null. */
export function heartAt(s: number, level: number): 'lub' | 'dub' | null {
  if (level < PULSE.slow) return null;
  const every = level >= PULSE.fast ? 4 : 8;
  const r = s % every;
  return r === 0 ? 'lub' : r === 1 ? 'dub' : null;
}

/** Schedules this step's tension notes into `dest` at time t. `root` = the bar's chord root (MIDI). */
export function scheduleTension(ctx: BaseAudioContext, dest: AudioNode, s: number, t: number, root: number, level: number, hunted: boolean): void {
  const beat = heartAt(s, level);
  if (beat) thump(ctx, dest, t, beat === 'lub' ? 56 : 47, beat === 'lub' ? PULSE.lub : PULSE.dub);
  if (level >= PULSE.pulse && s % 2 === 0) {
    const rise = Math.min(1, (level - PULSE.pulse) / (1 - PULSE.pulse));
    const step = (s / 2) % 2;
    const m = root + 12 + (step === 0 ? 0 : hunted ? 1 : 7);
    pulseNote(ctx, dest, t, midiHz(m), 280 + 1500 * rise, PULSE.pulsePeak * (0.7 + 0.3 * rise));
  }
}

/** One heart thump: a falling sine and a soft low knock. */
function thump(ctx: BaseAudioContext, dest: AudioNode, t: number, f: number, peak: number): void {
  const g = ctx.createGain(); g.connect(dest);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.68, t + 0.12);
  o.connect(g); o.start(t); o.stop(t + 0.2);
  const k = ctx.createGain(); k.connect(dest);
  k.gain.setValueAtTime(0.0001, t);
  k.gain.linearRampToValueAtTime(peak * 0.35, t + 0.003);
  k.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.connect(k);
  const ko = ctx.createOscillator(); ko.type = 'triangle'; ko.frequency.setValueAtTime(f * 2.4, t);
  ko.connect(lp); ko.start(t); ko.stop(t + 0.07);
}

/** One pulse note: a short saw through a low-pass at `cut` Hz. */
function pulseNote(ctx: BaseAudioContext, dest: AudioNode, t: number, f: number, cut: number, peak: number): void {
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
  lp.frequency.setValueAtTime(cut * 1.6, t); lp.frequency.exponentialRampToValueAtTime(cut, t + 0.1);
  lp.connect(dest);
  const g = ctx.createGain(); g.connect(lp);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
  o.connect(g); o.start(t); o.stop(t + 0.24);
}

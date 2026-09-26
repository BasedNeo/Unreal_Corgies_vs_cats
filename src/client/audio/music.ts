// OWNER: L5 (juice). Procedural adaptive music: a cheeky "backyard caper" loop in F major (I–vi–IV–V) at 108 BPM,
// three layers crossfaded by combat intensity:
//   bed    — soft pad chords + marimba-ish plucks + walking bass (always on, ducks a little in combat)
//   groove — kick/snare/hats + driving gritty bass (fades in as fights start)
//   stabs  — brass-ish chord stabs + tom fills (only when things get hot)
// Notes are scheduled ahead on the audio clock with a lookahead timer (no drift, no main-thread timing jitter).
import { layerGains } from './intensity';
import { drive } from './presets';
import { midiHz, noise } from './synth';

const BPM = 108;
const STEP = 60 / BPM / 4; // 16th note
const LOOKAHEAD = 0.14;
/** Chords as MIDI roots + triad (F, Dm, Bb, C). */
const PROGRESSION: Array<{ root: number; tones: [number, number, number] }> = [
  { root: 41, tones: [53, 57, 60] }, // F
  { root: 38, tones: [50, 53, 57] }, // Dm
  { root: 46, tones: [50, 53, 58] }, // Bb
  { root: 36, tones: [52, 55, 60] }, // C
];
/** Two pluck patterns (step → chord-tone index, −1 rest), alternating every 4 bars for variety. */
const PLUCK: number[][] = [
  [0, -1, 2, -1, 1, -1, 2, 0, -1, 2, -1, 1, 3, -1, 2, -1],
  [2, -1, 1, 0, -1, 2, -1, 3, 2, -1, 1, -1, 0, 1, -1, 2],
];

export class Music {
  private ctx: AudioContext;
  private out: GainNode;
  private bed: GainNode; private groove: GainNode; private stabs: GainNode;
  private grit: WaveShaperNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private level = 0;
  private gains = { bed: 1, groove: 0, stabs: 0 };

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.0001;
    this.out.connect(dest);
    const mk = (v: number) => { const g = ctx.createGain(); g.gain.value = v; g.connect(this.out); return g; };
    this.bed = mk(1); this.groove = mk(0.0001); this.stabs = mk(0.0001);
    this.grit = drive(ctx, 2.2);
    this.grit.connect(this.groove);
  }

  get running(): boolean { return this.timer !== null; }

  start(): void {
    if (this.timer) return;
    const t = this.ctx.currentTime + 0.1;
    this.nextTime = t;
    this.step = 0;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.exponentialRampToValueAtTime(0.9, t + 2.5);
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0.0001, t, 0.3);
  }

  /** Combat intensity 0..1 → layer crossfade (smoothed on the audio clock). */
  setIntensity(level: number): void {
    this.level = level;
    const g = layerGains(level);
    const t = this.ctx.currentTime;
    const set = (node: GainNode, v: number, tc: number) => node.gain.setTargetAtTime(Math.max(0.0001, v), t, tc);
    // Fade combat in quickly (0.6 s), out slowly (2.5 s) so fights don't "pump".
    set(this.groove, g.groove, g.groove > this.gains.groove ? 0.6 : 2.5);
    set(this.stabs, g.stabs, g.stabs > this.gains.stabs ? 0.4 : 2);
    set(this.bed, g.bed, 1.5);
    this.gains = g;
  }

  get intensity(): number { return this.level; }

  private schedule(): void {
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    // After a stall (tab hidden), skip ahead instead of machine-gunning missed notes.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step++;
    }
  }

  private playStep(step: number, t: number): void {
    const s = step % 16, bar = Math.floor(step / 16);
    const chord = PROGRESSION[bar % 4];
    const phrase = Math.floor(bar / 4) % 2;
    const grooveOn = this.gains.groove > 0.02, stabsOn = this.gains.stabs > 0.02;
    // --- bed ---
    if (s === 0) this.pad(chord.tones, t, STEP * 16);
    const pi = PLUCK[phrase][s];
    if (pi >= 0) this.pluck(midiHz((pi === 3 ? chord.tones[0] + 12 : chord.tones[pi]) + 12), t, s % 4 === 0 ? 0.13 : 0.09);
    if (!grooveOn && (s === 0 || s === 8 || (s === 14 && bar % 2 === 1))) this.bass(midiHz(chord.root + (s === 14 ? 7 : 0)), t, STEP * 3, this.bed, 'triangle', 0.3);
    // --- groove ---
    if (grooveOn) {
      if (s === 0 || s === 8 || s === 10) this.kick(t);
      if (s === 4 || s === 12) this.snare(t, 1);
      if (s === 15 && bar % 4 === 3) this.snare(t, 0.5);
      if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.09 : 0.05, 0.035);
      if (s === 14) this.hat(t, 0.06, 0.16);
      if (s % 2 === 0) this.bass(midiHz(chord.root + (s === 6 || s === 14 ? 12 : 0)), t, STEP * 1.6, this.grit, 'sawtooth', 0.22);
    }
    // --- stabs ---
    if (stabsOn) {
      if (s === 6 || s === 14 || (s === 3 && bar % 2 === 1)) this.stab(chord.tones, t);
      if (bar % 4 === 3 && s >= 12) this.tom(t, 180 - (s - 12) * 25);
    }
  }

  // ---- instruments (every note: envelope from ~0, scheduled stop) ----
  private env(g: AudioParam, t: number, a: number, peak: number, d: number): void {
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private pad(tones: number[], t: number, dur: number): void {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 850; lp.Q.value = 0.4; lp.connect(this.bed);
    const g = ctx.createGain(); g.connect(lp);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.5);
    g.gain.setValueAtTime(0.045, t + dur - 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.2);
    for (const m of tones) for (const det of [-6, 6]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = midiHz(m); o.detune.value = det;
      o.connect(g); o.start(t); o.stop(t + dur + 0.3);
    }
  }

  private pluck(f: number, t: number, peak: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.connect(this.bed);
    this.env(g.gain, t, 0.004, peak, 0.28);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + 0.35);
    const h = ctx.createGain(); h.gain.value = 0.25; h.connect(g);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 4; o2.connect(h); o2.start(t); o2.stop(t + 0.1);
  }

  private bass(f: number, t: number, d: number, dest: AudioNode, type: OscillatorType, peak: number): void {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(type === 'sawtooth' ? 900 : 600, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + d); lp.connect(dest);
    const g = ctx.createGain(); g.connect(lp);
    this.env(g.gain, t, 0.006, peak, d);
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + d + 0.05);
  }

  private kick(t: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.connect(this.groove);
    this.env(g.gain, t, 0.002, 0.8, 0.28);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    o.connect(g); o.start(t); o.stop(t + 0.35);
  }

  private snare(t: number, k: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.connect(this.groove);
    this.env(g.gain, t, 0.002, 0.32 * k, 0.16);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8; bp.connect(g);
    const n = ctx.createBufferSource(); n.buffer = noise(ctx, 'white'); n.connect(bp); n.start(t, (t * 7.3) % 1.5); n.stop(t + 0.2);
    const tg = ctx.createGain(); tg.connect(this.groove);
    this.env(tg.gain, t, 0.002, 0.22 * k, 0.08);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    o.connect(tg); o.start(t); o.stop(t + 0.12);
  }

  private hat(t: number, peak: number, d: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.connect(this.groove);
    this.env(g.gain, t, 0.001, peak, d);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000; hp.connect(g);
    const n = ctx.createBufferSource(); n.buffer = noise(ctx, 'white'); n.connect(hp); n.start(t, (t * 3.1) % 1.5); n.stop(t + d + 0.05);
  }

  private stab(tones: number[], t: number): void {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.18); lp.connect(this.stabs);
    const g = ctx.createGain(); g.connect(lp);
    this.env(g.gain, t, 0.008, 0.07, 0.2);
    for (const m of tones) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midiHz(m + 12); o.connect(g); o.start(t); o.stop(t + 0.3); }
  }

  private tom(t: number, f: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.connect(this.stabs);
    this.env(g.gain, t, 0.002, 0.45, 0.2);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.18);
    o.connect(g); o.start(t); o.stop(t + 0.25);
  }
}

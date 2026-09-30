// W10 AU2 (audio-2): a small offline Web Audio renderer for Node, so the unit suite can RENDER the game's procedural
// audio and measure it (levels, clipping, masking) instead of only checking the scheduling. Node has no Web Audio;
// this implements the subset the game uses, following the Web Audio 1.0 spec formulas:
//   AudioParam      setValueAtTime · linear / exponential ramps · setTargetAtTime · cancelScheduledValues · `.value`
//                   (read = the timeline at currentTime) · node inputs (LFOs) summed in · a-rate gain / osc frequency
//   Oscillator      sine · square · sawtooth (PolyBLEP, so a 3 kHz square does not alias into the band it is judged
//                   in; scaled like Chromium's peak-normalised tables) · triangle · custom (PeriodicWave, normalised like
//                   the spec), all in the spec's phase (a saw and a square at one pitch add). Its frequency/detune automation is
//                   read once per 128-frame block, at the block's start (so an oscillator started mid-block plays the
//                   param's earlier value until the next block), and LFO inputs add per sample. That is what Chromium
//                   renders: a 165 → 80 Hz glide under a 2 ms / 70 ms envelope matches its render within 0.8 dB in every
//                   band this way; evaluated per sample it showed 10-14 dB less splatter at 500-1250 Hz
//   BufferSource    loop, loopStart/End, playbackRate (k-rate), start(when, offset), stop(when), linear interpolation
//   BiquadFilter    all eight types with the spec's coefficients (lowpass/highpass Q in dB), k-rate per 128-frame block
//   WaveShaper      the spec's curve mapping (no oversampling)
//   Panner          equal-power panning of a mono input (HRTF renders as equal-power) + inverse/linear/exponential
//                   distance, positions k-rate per block · the listener's position/orientation params
//   Compressor      a MODEL of the spec's DynamicsCompressor (static curve with knee and ratio, 6 ms look-ahead with a
//                   peak detector over that window, attack/release smoothing in dB, makeup gain (1 / curve(0 dBFS))^0.6);
//                   Chromium's detector differs
//                   in detail, so peak claims are cross-checked against a real OfflineAudioContext (docs/handoff/AU2.md)
// Channel rules: a node's output has max(inputs) channels (mono up-mixes to L = R), a panner outputs stereo, param
// inputs are mixed to mono. Rendering is pull-based per 128-frame block; silent subgraphs short-circuit, so thousands
// of finished voices cost almost nothing. Scheduling happens first (the caller moves `currentTime` forward the way a
// real-time context would), then render() plays the whole timeline.
export const BLOCK = 128;

const SET = 0, LIN = 1, EXP = 2, TARGET = 3;
interface Ev { kind: number; time: number; value: number; tau: number }
const finite = (...xs: number[]) => { for (const x of xs) if (!Number.isFinite(x)) throw new TypeError(`non-finite ${x}`); };

export class RParam {
  private ev: Ev[] = [];
  readonly inputs: Edge[] = [];
  // incremental playback state (render time only moves forward)
  private idx = 0; private v = 0; private tPrev = 0; private tgt = false; private tv = 0; private tau = 1; private tT0 = 0; private tv0 = 0;
  /** `aRate`: per-sample values. `blockTimeline`: the automation timeline is held per 128-frame block while connected
   *  inputs (LFOs) still add per sample: Chromium's OscillatorNode frequency/detune (measured, see the header). */
  constructor(private readonly ctx: RenderContext, public defaultValue: number, readonly aRate = true, readonly blockTimeline = false) { this.v = defaultValue; }

  get value(): number { return this.at(this.ctx.currentTime); }
  set value(x: number) { finite(x); if (this.ev.length === 0) { this.defaultValue = x; this.v = x; } else this.insert(SET, this.ctx.currentTime, x, 0); }
  setValueAtTime(x: number, t: number): this { finite(x, t); this.insert(SET, t, x, 0); return this; }
  linearRampToValueAtTime(x: number, t: number): this { finite(x, t); this.insert(LIN, t, x, 0); return this; }
  exponentialRampToValueAtTime(x: number, t: number): this { finite(x, t); if (x === 0) throw new RangeError('expRamp to 0'); this.insert(EXP, t, x, 0); return this; }
  setTargetAtTime(x: number, t: number, tau: number): this { finite(x, t, tau); if (tau < 0) throw new RangeError('tau < 0'); this.insert(TARGET, t, x, tau); return this; }
  cancelScheduledValues(t: number): this { finite(t); this.ev = this.ev.filter((e) => e.time < t); return this; }
  get events(): number { return this.ev.length; }

  private insert(kind: number, time: number, value: number, tau: number): void {
    const e: Ev = { kind, time, value, tau };
    let i = this.ev.length;
    while (i > 0 && this.ev[i - 1].time > time) i--;
    this.ev.splice(i, 0, e);
  }

  /** The timeline's value at t (a fresh scan; used while scheduling). */
  at(t: number): number {
    const s = { v: this.defaultValue, tPrev: 0, tgt: false, tv: 0, tau: 1, tT0: 0, tv0: 0 };
    let i = 0;
    for (; i < this.ev.length && this.ev[i].time <= t; i++) this.applyTo(s, this.ev[i]);
    return this.valueOf(s, i < this.ev.length ? this.ev[i] : null, t);
  }

  private curve(s: { v: number; tgt: boolean; tv: number; tau: number; tT0: number; tv0: number }, t: number): number {
    if (!s.tgt) return s.v;
    if (s.tau <= 0) return s.tv;
    return s.tv + (s.tv0 - s.tv) * Math.exp(-(t - s.tT0) / s.tau);
  }

  private applyTo(s: { v: number; tPrev: number; tgt: boolean; tv: number; tau: number; tT0: number; tv0: number }, e: Ev): void {
    if (e.kind === TARGET) {
      const now = this.curve(s, e.time);
      s.tgt = true; s.tv = e.value; s.tau = e.tau; s.tT0 = e.time; s.tv0 = now; s.v = now; s.tPrev = e.time;
    } else { s.tgt = false; s.v = e.value; s.tPrev = e.time; }
  }

  private valueOf(s: { v: number; tPrev: number; tgt: boolean; tv: number; tau: number; tT0: number; tv0: number }, next: Ev | null, t: number): number {
    if (next && (next.kind === LIN || next.kind === EXP)) {
      const v0 = this.curve(s, s.tPrev), span = next.time - s.tPrev;
      if (span <= 0) return next.value;
      const f = (t - s.tPrev) / span;
      if (next.kind === LIN) return v0 + (next.value - v0) * f;
      if (v0 === 0 || v0 * next.value < 0) return v0;
      return v0 * Math.pow(next.value / v0, f);
    }
    return this.curve(s, t);
  }

  /** Render-time fill (monotonic): writes n values from t0 at 1/sr; returns true when the block is constant. */
  fill(t0: number, sr: number, n: number, out: Float32Array, block: number): boolean {
    const ev = this.ev;
    const self = this as unknown as { v: number; tPrev: number; tgt: boolean; tv: number; tau: number; tT0: number; tv0: number };
    let constant = true;
    if (ev.length === 0) { out[0] = this.defaultValue; }
    else {
      while (this.idx < ev.length && ev[this.idx].time <= t0) this.applyTo(self, ev[this.idx++]);
      const next = this.idx < ev.length ? ev[this.idx] : null;
      if (!this.tgt && (!next || next.time >= t0 + n / sr) && (!next || next.kind === SET || next.kind === TARGET)) out[0] = this.v;
      else if (!this.aRate || this.blockTimeline) out[0] = this.valueOf(self, next, t0);
      else {
        constant = false;
        for (let i = 0; i < n; i++) {
          const t = t0 + i / sr;
          while (this.idx < ev.length && ev[this.idx].time <= t) this.applyTo(self, ev[this.idx++]);
          out[i] = this.valueOf(self, this.idx < ev.length ? ev[this.idx] : null, t);
        }
      }
    }
    if (this.inputs.length) {
      let any = false;
      const bt = this.ctx.blockTime(block);
      for (const e of this.inputs) {
        if (e.from >= bt + BLOCK / this.ctx.sampleRate || e.until <= bt) continue;
        const src = e.node;
        src.pull(block);
        if (src.silent) continue;
        if (!any) { if (constant) out.fill(out[0], 1, n); constant = false; any = true; }
        const d = src.out[0];
        if (src.chans === 2) { const r = src.out[1]; for (let i = 0; i < n; i++) out[i] += 0.5 * (d[i] + r[i]); }
        else for (let i = 0; i < n; i++) out[i] += d[i];
      }
      if (!this.aRate && !constant) { out[0] = out[0]; constant = true; }
    }
    return constant;
  }
}

type Dest = RNode | RParam;
/** A connection, live on the audio clock from `from` (when connect() ran) until `until` (when disconnect() ran):
 *  the renderer plays the timeline after scheduling, so graph changes are stamped with the time they happened. */
interface Edge { node: RNode; from: number; until: number }

export class RNode {
  readonly ins: Edge[] = [];
  readonly outs: { dest: Dest; edge: Edge }[] = [];
  out: Float32Array[] = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  chans = 1;
  silent = true;
  private memo = -1;
  channelCount = 2;
  [k: string]: unknown;
  constructor(readonly ctx: RenderContext, readonly kind: string) { ctx.nodeCount++; }
  connect<T extends Dest>(d: T): T {
    const edge: Edge = { node: this, from: this.ctx.currentTime, until: Infinity };
    if (d instanceof RParam) d.inputs.push(edge); else (d as RNode).ins.push(edge);
    this.outs.push({ dest: d, edge });
    return d;
  }
  disconnect(d?: Dest): void {
    const now = this.ctx.currentTime;
    for (let i = this.outs.length - 1; i >= 0; i--) {
      const o = this.outs[i];
      if (d && o.dest !== d) continue;
      o.edge.until = Math.min(o.edge.until, now);
      this.outs.splice(i, 1);
    }
  }
  pull(block: number): void {
    if (this.memo === block) return;
    this.memo = block;
    this.process(block);
  }
  /** Sum of the inputs into `buf` (channel count = max of inputs); false when all are silent. */
  protected mix(block: number, buf: Float32Array[]): number {
    let chans = 0;
    const bt = this.ctx.blockTime(block);
    for (const e of this.ins) { if (e.from >= bt + BLOCK / this.ctx.sampleRate || e.until <= bt) continue; const s = e.node; s.pull(block); if (!s.silent && s.chans > chans) chans = s.chans; }
    if (chans === 0) return 0;
    buf[0].fill(0); if (chans === 2) buf[1].fill(0);
    for (const e of this.ins) {
      if (e.from >= bt + BLOCK / this.ctx.sampleRate || e.until <= bt) continue;
      const s = e.node;
      if (s.silent) continue;
      const a = s.out[0], b = s.chans === 2 ? s.out[1] : a;
      const l = buf[0];
      for (let i = 0; i < BLOCK; i++) l[i] += a[i];
      if (chans === 2) { const r = buf[1]; for (let i = 0; i < BLOCK; i++) r[i] += b[i]; }
    }
    return chans;
  }
  protected process(block: number): void {
    const c = this.mix(block, this.out);
    this.silent = c === 0; this.chans = c || 1;
  }
}

class RGain extends RNode {
  readonly gain: RParam;
  private g = new Float32Array(BLOCK);
  constructor(ctx: RenderContext) { super(ctx, 'gain'); this.gain = new RParam(ctx, 1); }
  protected override process(block: number): void {
    const c = this.mix(block, this.out);
    if (c === 0) { this.silent = true; return; }
    this.silent = false; this.chans = c;
    const k = this.gain.fill(this.ctx.blockTime(block), this.ctx.sampleRate, BLOCK, this.g, block);
    for (let ch = 0; ch < c; ch++) {
      const d = this.out[ch];
      if (k) { const g = this.g[0]; for (let i = 0; i < BLOCK; i++) d[i] *= g; } else { const g = this.g; for (let i = 0; i < BLOCK; i++) d[i] *= g[i]; }
    }
  }
}

abstract class RSource extends RNode {
  startT = -1; stopT = Infinity; offset = 0;
  private stops = 0;
  onended: (() => void) | null = null;
  start(t = 0, offset = 0): void { finite(t, offset); if (this.startT >= 0) throw new Error('start twice'); this.startT = t; this.offset = offset; }
  stop(t = 0): void { finite(t); if (this.startT < 0) throw new Error('stop before start'); if (this.stops++ > 0) throw new Error('stop twice'); this.stopT = Math.max(t, this.startT); }
  /** First/last+1 frame of this block the source plays (both 0 when it does not). */
  protected span(block: number): [number, number] {
    if (this.startT < 0) return [0, 0];
    const sr = this.ctx.sampleRate, b0 = block * BLOCK;
    const s = Math.ceil(this.startT * sr - 1e-9) - b0, e = Math.ceil(this.stopT * sr - 1e-9) - b0;
    const a = Math.max(0, s), z = Math.min(BLOCK, e);
    return z > a ? [a, z] : [0, 0];
  }
}

class ROsc extends RSource {
  type: OscillatorType = 'sine';
  readonly frequency: RParam; readonly detune: RParam;
  private phase = 0;
  private f = new Float32Array(BLOCK); private dt = new Float32Array(BLOCK);
  private table: Float32Array | null = null;
  constructor(ctx: RenderContext) { super(ctx, 'osc'); this.frequency = new RParam(ctx, 440, true, true); this.detune = new RParam(ctx, 0, true, true); }
  setPeriodicWave(w: { table: Float32Array }): void { this.type = 'custom'; this.table = w.table; }
  protected override process(block: number): void {
    const [a, z] = this.span(block);
    if (z === 0) { this.silent = true; return; }
    this.silent = false; this.chans = 1;
    const sr = this.ctx.sampleRate, t0 = this.ctx.blockTime(block);
    const fk = this.frequency.fill(t0, sr, BLOCK, this.f, block), dk = this.detune.fill(t0, sr, BLOCK, this.dt, block);
    const d = this.out[0];
    d.fill(0);
    const nyq = sr / 2;
    for (let i = a; i < z; i++) {
      let f = (fk ? this.f[0] : this.f[i]) * Math.pow(2, (dk ? this.dt[0] : this.dt[i]) / 1200);
      if (f > nyq) f = nyq; else if (f < -nyq) f = -nyq;
      const inc = f / sr, p = this.phase;
      let y: number;
      // the spec's phases (every built-in wave's fundamental is +sin: a saw and a square at one pitch ADD) and
      // Chromium's normalisation of the band-limited saw and square (peak 1 including the Gibbs overshoot: × 0.848)
      switch (this.type) {
        case 'sine': y = Math.sin(2 * Math.PI * p); break;
        case 'square': y = WAVE_NORM * ((p < 0.5 ? 1 : -1) + blep(p, inc) - blep((p + 0.5) % 1, inc)); break;
        case 'sawtooth': { const q = (p + 0.5) % 1; y = WAVE_NORM * (2 * q - 1 - blep(q, inc)); break; }
        case 'triangle': y = p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4; break;
        default: { const tb = this.table!; const x = p * tb.length; const k = Math.floor(x), fr = x - k; y = tb[k % tb.length] * (1 - fr) + tb[(k + 1) % tb.length] * fr; }
      }
      d[i] = y;
      let np = p + inc; np -= Math.floor(np); this.phase = np;
    }
  }
}
/** Chromium normalises its band-limited square and sawtooth tables to a peak of 1, Gibbs overshoot included. */
const WAVE_NORM = 0.848;
/** PolyBLEP residual for a discontinuity at phase 0 (dt = phase increment). */
function blep(p: number, dt: number): number {
  const d = Math.abs(dt);
  if (d <= 0) return 0;
  if (p < d) { const x = p / d; return x + x - x * x - 1; }
  if (p > 1 - d) { const x = (p - 1) / d; return x * x + x + x + 1; }
  return 0;
}

export class RBuffer {
  readonly numberOfChannels: number; readonly length: number; readonly sampleRate: number;
  private data: Float32Array[];
  constructor(ch: number, len: number, sr: number) { this.numberOfChannels = ch; this.length = len; this.sampleRate = sr; this.data = Array.from({ length: ch }, () => new Float32Array(len)); }
  get duration(): number { return this.length / this.sampleRate; }
  getChannelData(c: number): Float32Array { return this.data[c]; }
}

class RBufSrc extends RSource {
  buffer: RBuffer | null = null;
  loop = false; loopStart = 0; loopEnd = 0;
  readonly playbackRate: RParam; readonly detune: RParam;
  private pos = -1;
  private r = new Float32Array(BLOCK);
  constructor(ctx: RenderContext) { super(ctx, 'src'); this.playbackRate = new RParam(ctx, 1, false); this.detune = new RParam(ctx, 0, false); }
  protected override process(block: number): void {
    const [a, z] = this.span(block);
    const b = this.buffer;
    if (z === 0 || !b) { this.silent = true; return; }
    this.silent = false; this.chans = 1;
    const sr = this.ctx.sampleRate;
    this.playbackRate.fill(this.ctx.blockTime(block), sr, BLOCK, this.r, block);
    const rate = this.r[0] * (b.sampleRate / sr);
    const data = b.getChannelData(0), n = b.length;
    const ls = this.loop ? Math.max(0, Math.floor(this.loopStart * b.sampleRate)) : 0;
    const le = this.loop ? (this.loopEnd > 0 ? Math.min(n, Math.floor(this.loopEnd * b.sampleRate)) : n) : n;
    if (this.pos < 0) this.pos = this.offset * b.sampleRate;
    const d = this.out[0];
    d.fill(0);
    for (let i = a; i < z; i++) {
      let p = this.pos;
      if (this.loop) { const span = le - ls; if (span > 0) while (p >= le) p -= span; }
      else if (p >= n) break;
      const k = Math.floor(p), f = p - k;
      const k1 = k + 1 < (this.loop ? le : n) ? k + 1 : (this.loop ? ls : k);
      d[i] = data[k] * (1 - f) + data[k1] * f;
      this.pos = p + rate;
    }
  }
}

class RBiquad extends RNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency: RParam; readonly Q: RParam; readonly gain: RParam; readonly detune: RParam;
  private st = [new Float64Array(4), new Float64Array(4)];
  private tmp = new Float32Array(BLOCK);
  constructor(ctx: RenderContext) {
    super(ctx, 'biquad');
    this.frequency = new RParam(ctx, 350, false); this.Q = new RParam(ctx, 1, false); this.gain = new RParam(ctx, 0, false); this.detune = new RParam(ctx, 0, false);
  }
  private coeffs(block: number): [number, number, number, number, number] {
    const sr = this.ctx.sampleRate, t0 = this.ctx.blockTime(block);
    this.frequency.fill(t0, sr, BLOCK, this.tmp, block); let f0 = this.tmp[0];
    this.detune.fill(t0, sr, BLOCK, this.tmp, block); f0 *= Math.pow(2, this.tmp[0] / 1200);
    this.Q.fill(t0, sr, BLOCK, this.tmp, block); const Q = this.tmp[0];
    this.gain.fill(t0, sr, BLOCK, this.tmp, block); const G = this.tmp[0];
    const nyq = sr / 2;
    f0 = Math.max(0, Math.min(nyq, f0));
    const A = Math.pow(10, G / 40), w0 = 2 * Math.PI * f0 / sr, cw = Math.cos(w0), sw = Math.sin(w0);
    const aQ = sw / (2 * Math.max(1e-4, Q)), aQdB = sw / (2 * Math.pow(10, Q / 20)), aS = (sw / 2) * Math.SQRT2;
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    switch (this.type) {
      case 'lowpass': if (f0 >= nyq) return [1, 0, 0, 0, 0]; if (f0 <= 0) return [0, 0, 0, 0, 0];
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + aQdB; a1 = -2 * cw; a2 = 1 - aQdB; break;
      case 'highpass': if (f0 >= nyq) return [0, 0, 0, 0, 0]; if (f0 <= 0) return [1, 0, 0, 0, 0];
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + aQdB; a1 = -2 * cw; a2 = 1 - aQdB; break;
      case 'bandpass': if (f0 <= 0 || f0 >= nyq) return [0, 0, 0, 0, 0];
        b0 = aQ; b1 = 0; b2 = -aQ; a0 = 1 + aQ; a1 = -2 * cw; a2 = 1 - aQ; break;
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + aQ; a1 = -2 * cw; a2 = 1 - aQ; break;
      case 'allpass': b0 = 1 - aQ; b1 = -2 * cw; b2 = 1 + aQ; a0 = 1 + aQ; a1 = -2 * cw; a2 = 1 - aQ; break;
      case 'peaking': b0 = 1 + aQ * A; b1 = -2 * cw; b2 = 1 - aQ * A; a0 = 1 + aQ / A; a1 = -2 * cw; a2 = 1 - aQ / A; break;
      case 'lowshelf': { const s = 2 * aS * Math.sqrt(A);
        b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
        a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
      case 'highshelf': { const s = 2 * aS * Math.sqrt(A);
        b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
        a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break; }
    }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  protected override process(block: number): void {
    const c = this.mix(block, this.out);
    const quiet = (s: Float64Array) => Math.abs(s[0]) + Math.abs(s[1]) + Math.abs(s[2]) + Math.abs(s[3]) < 1e-9;
    if (c === 0 && quiet(this.st[0]) && quiet(this.st[1])) { this.silent = true; return; }
    const chans = c === 0 ? this.chans : c;
    if (c === 0) { this.out[0].fill(0); this.out[1].fill(0); }
    else if (c === 1 && chans === 1) this.out[1].fill(0);
    this.silent = false; this.chans = chans;
    const [b0, b1, b2, a1, a2] = this.coeffs(block);
    for (let ch = 0; ch < chans; ch++) {
      const d = this.out[ch], s = this.st[ch];
      let x1 = s[0], x2 = s[1], y1 = s[2], y2 = s[3];
      for (let i = 0; i < BLOCK; i++) {
        const x = d[i];
        let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        if (Math.abs(y) < 1e-30) y = 0;
        x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y;
      }
      s[0] = x1; s[1] = x2; s[2] = y1; s[3] = y2;
    }
  }
}

class RShaper extends RNode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = 'none';
  constructor(ctx: RenderContext) { super(ctx, 'shaper'); }
  protected override process(block: number): void {
    const c = this.mix(block, this.out);
    const cv = this.curve;
    const mid = cv ? shape(cv, 0) : 0;
    if (c === 0 && Math.abs(mid) < 1e-12) { this.silent = true; return; }
    if (c === 0) { this.out[0].fill(0); }
    this.silent = false; this.chans = c || 1;
    if (!cv) return;
    for (let ch = 0; ch < this.chans; ch++) { const d = this.out[ch]; for (let i = 0; i < BLOCK; i++) d[i] = shape(cv, d[i]); }
  }
}
function shape(cv: Float32Array, x: number): number {
  const n = cv.length, v = (n - 1) / 2 * (x + 1);
  if (v <= 0) return cv[0];
  if (v >= n - 1) return cv[n - 1];
  const k = Math.floor(v), f = v - k;
  return cv[k] * (1 - f) + cv[k + 1] * f;
}

class RListener {
  readonly positionX: RParam; readonly positionY: RParam; readonly positionZ: RParam;
  readonly forwardX: RParam; readonly forwardY: RParam; readonly forwardZ: RParam;
  readonly upX: RParam; readonly upY: RParam; readonly upZ: RParam;
  constructor(ctx: RenderContext) {
    const p = (v: number) => new RParam(ctx, v, false);
    this.positionX = p(0); this.positionY = p(0); this.positionZ = p(0);
    this.forwardX = p(0); this.forwardY = p(0); this.forwardZ = p(-1);
    this.upX = p(0); this.upY = p(1); this.upZ = p(0);
  }
  setPosition(x: number, y: number, z: number): void { this.positionX.value = x; this.positionY.value = y; this.positionZ.value = z; }
  setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    this.forwardX.value = fx; this.forwardY.value = fy; this.forwardZ.value = fz; this.upX.value = ux; this.upY.value = uy; this.upZ.value = uz;
  }
}

class RPanner extends RNode {
  panningModel: PanningModelType = 'equalpower';
  distanceModel: DistanceModelType = 'inverse';
  refDistance = 1; maxDistance = 10000; rolloffFactor = 1;
  coneInnerAngle = 360; coneOuterAngle = 360; coneOuterGain = 0;
  readonly positionX: RParam; readonly positionY: RParam; readonly positionZ: RParam;
  readonly orientationX: RParam; readonly orientationY: RParam; readonly orientationZ: RParam;
  private tmp = new Float32Array(BLOCK);
  private mono = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  constructor(ctx: RenderContext) {
    super(ctx, 'panner');
    const p = (v: number) => new RParam(ctx, v, false);
    this.positionX = p(0); this.positionY = p(0); this.positionZ = p(0);
    this.orientationX = p(1); this.orientationY = p(0); this.orientationZ = p(0);
  }
  setPosition(x: number, y: number, z: number): void { this.positionX.value = x; this.positionY.value = y; this.positionZ.value = z; }
  private k(p: RParam, block: number): number { p.fill(this.ctx.blockTime(block), this.ctx.sampleRate, BLOCK, this.tmp, block); return this.tmp[0]; }
  /** [gainL, gainR] for this block (equal-power azimuth × distance gain). */
  gains(block: number): [number, number] {
    const L = this.ctx.listener;
    const sx = this.k(this.positionX, block), sy = this.k(this.positionY, block), sz = this.k(this.positionZ, block);
    const lx = this.k(L.positionX, block), ly = this.k(L.positionY, block), lz = this.k(L.positionZ, block);
    let fx = this.k(L.forwardX, block), fy = this.k(L.forwardY, block), fz = this.k(L.forwardZ, block);
    const ux = this.k(L.upX, block), uy = this.k(L.upY, block), uz = this.k(L.upZ, block);
    let dx = sx - lx, dy = sy - ly, dz = sz - lz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let az = 0;
    if (dist > 1e-6) {
      dx /= dist; dy /= dist; dz /= dist;
      const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      // right = forward × up; up' = right × forward
      let rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux;
      const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
      const upx = ry * fz - rz * fy, upy = rz * fx - rx * fz, upz = rx * fy - ry * fx;
      const up = dx * upx + dy * upy + dz * upz;
      let px = dx - up * upx, py = dy - up * upy, pz = dz - up * upz;
      const pl = Math.hypot(px, py, pz);
      if (pl > 1e-9) {
        px /= pl; py /= pl; pz /= pl;
        az = (180 / Math.PI) * Math.acos(Math.max(-1, Math.min(1, px * rx + py * ry + pz * rz)));
        if (px * fx + py * fy + pz * fz < 0) az = 360 - az;
        az = az >= 0 && az <= 270 ? 90 - az : 450 - az;
      }
    }
    if (az < -90) az = -180 - az; else if (az > 90) az = 180 - az;
    const x = (az + 90) / 180;
    const ref = this.refDistance, max = this.maxDistance, roll = this.rolloffFactor;
    let dg = 1;
    if (this.distanceModel === 'inverse') dg = ref / (ref + roll * (Math.max(dist, ref) - ref));
    else if (this.distanceModel === 'linear') dg = 1 - Math.min(1, roll) * (Math.max(ref, Math.min(dist, max)) - ref) / Math.max(1e-9, max - ref);
    else dg = Math.pow(Math.max(dist, ref) / ref, -roll);
    return [Math.cos(x * Math.PI / 2) * dg, Math.sin(x * Math.PI / 2) * dg];
  }
  protected override process(block: number): void {
    const c = this.mix(block, this.mono);
    if (c === 0) { this.silent = true; return; }
    this.silent = false; this.chans = 2;
    const m = this.mono[0];
    if (c === 2) { const r = this.mono[1]; for (let i = 0; i < BLOCK; i++) m[i] = 0.5 * (m[i] + r[i]); }
    const [gl, gr] = this.gains(block);
    const l = this.out[0], r = this.out[1];
    for (let i = 0; i < BLOCK; i++) { l[i] = m[i] * gl; r[i] = m[i] * gr; }
  }
}

class RComp extends RNode {
  readonly threshold: RParam; readonly knee: RParam; readonly ratio: RParam; readonly attack: RParam; readonly release: RParam;
  reduction = 0;
  private line: Float32Array[] = [];
  private w = 0;
  private env = 0;
  private seen = 0;
  private qv = new Float32Array(1); private qi = new Float64Array(1); private qh = 0; private qn = 0;
  private tmp = new Float32Array(BLOCK);
  constructor(ctx: RenderContext) {
    super(ctx, 'comp');
    const p = (v: number) => new RParam(ctx, v, false);
    this.threshold = p(-24); this.knee = p(30); this.ratio = p(12); this.attack = p(0.003); this.release = p(0.25);
  }
  private k(p: RParam, block: number): number { p.fill(this.ctx.blockTime(block), this.ctx.sampleRate, BLOCK, this.tmp, block); return this.tmp[0]; }
  protected override process(block: number): void {
    const sr = this.ctx.sampleRate;
    if (this.line.length === 0) {
      const n = Math.round(0.006 * sr);
      this.line = [new Float32Array(n), new Float32Array(n)];
      this.qv = new Float32Array(n); this.qi = new Float64Array(n);
    }
    const c = this.mix(block, this.out);
    if (c === 0) { this.out[0].fill(0); this.out[1].fill(0); }
    this.chans = 2; this.silent = false;
    if (c === 1) this.out[1].set(this.out[0]);
    const T = this.k(this.threshold, block), W = Math.max(0, this.k(this.knee, block)), R = Math.max(1, this.k(this.ratio, block));
    const att = Math.exp(-1 / (Math.max(1e-4, this.k(this.attack, block)) * sr)), rel = Math.exp(-1 / (Math.max(1e-3, this.k(this.release, block)) * sr));
    const curve = (xdb: number) => {
      if (xdb <= T) return xdb;
      if (W > 0 && xdb < T + W) { const d = xdb - T; return xdb + (1 / R - 1) * d * d / (2 * W); }
      return T + (W > 0 ? W * (1 + 1 / R) / 2 + (xdb - T - W) / R : (xdb - T) / R);
    };
    const makeup = Math.pow(1 / Math.pow(10, curve(0) / 20), 0.6);
    const L = this.out[0], Rr = this.out[1], dl = this.line[0], dr = this.line[1], n = dl.length;
    let peakRed = 0;
    for (let i = 0; i < BLOCK; i++) {
      // detector: the peak over the look-ahead window (a monotonic deque of the last n samples' levels), so the gain
      // has the whole pre-delay to reach a transient before that transient leaves the delay line
      const x = Math.max(Math.abs(L[i]), Math.abs(Rr[i]));
      const at = this.seen++;
      while (this.qn > 0 && this.qv[(this.qh + this.qn - 1) % n] <= x) this.qn--;
      this.qv[(this.qh + this.qn) % n] = x; this.qi[(this.qh + this.qn) % n] = at; this.qn++;
      while (this.qi[this.qh] <= at - n) { this.qh = (this.qh + 1) % n; this.qn--; }
      const pk = this.qv[this.qh];
      const xdb = pk > 1e-9 ? 20 * Math.log10(pk) : -180;
      const want = Math.min(0, curve(xdb) - xdb); // dB of gain (≤ 0)
      this.env = want < this.env ? att * this.env + (1 - att) * want : rel * this.env + (1 - rel) * want;
      const g = Math.pow(10, this.env / 20) * makeup;
      const ol = dl[this.w], or = dr[this.w];
      dl[this.w] = L[i]; dr[this.w] = Rr[i];
      this.w = (this.w + 1) % n;
      L[i] = ol * g; Rr[i] = or * g;
      if (-this.env > peakRed) peakRed = -this.env;
    }
    this.reduction = -peakRed;
  }
}

export interface Tap { node: RNode; data: [Float32Array, Float32Array] }

/** The context: create* factories like BaseAudioContext, a settable currentTime for scheduling, render() to play. */
export class RenderContext {
  currentTime = 0;
  readonly state = 'running';
  nodeCount = 0;
  readonly destination: RNode;
  readonly listener: RListener;
  private taps: Tap[] = [];
  constructor(readonly sampleRate = 32000) {
    this.destination = new RNode(this, 'destination');
    this.listener = new RListener(this);
  }
  blockTime(block: number): number { return (block * BLOCK) / this.sampleRate; }
  createGain(): GainNode { return new RGain(this) as unknown as GainNode; }
  createOscillator(): OscillatorNode { return new ROsc(this) as unknown as OscillatorNode; }
  createBufferSource(): AudioBufferSourceNode { return new RBufSrc(this) as unknown as AudioBufferSourceNode; }
  createBiquadFilter(): BiquadFilterNode { return new RBiquad(this) as unknown as BiquadFilterNode; }
  createWaveShaper(): WaveShaperNode { return new RShaper(this) as unknown as WaveShaperNode; }
  createPanner(): PannerNode { return new RPanner(this) as unknown as PannerNode; }
  createDynamicsCompressor(): DynamicsCompressorNode { return new RComp(this) as unknown as DynamicsCompressorNode; }
  createBuffer(ch: number, len: number, sr: number): AudioBuffer { return new RBuffer(ch, len, sr) as unknown as AudioBuffer; }
  createPeriodicWave(re: Float32Array | number[], im: Float32Array | number[], o?: { disableNormalization?: boolean }): PeriodicWave {
    const N = 2048, table = new Float32Array(N);
    for (let i = 0; i < N; i++) { let s = 0; for (let k = 1; k < re.length; k++) s += re[k] * Math.cos(2 * Math.PI * k * i / N) + im[k] * Math.sin(2 * Math.PI * k * i / N); table[i] = s; }
    if (!o?.disableNormalization) { let m = 0; for (const x of table) m = Math.max(m, Math.abs(x)); if (m > 0) for (let i = 0; i < N; i++) table[i] /= m; }
    return { table } as unknown as PeriodicWave;
  }
  addEventListener(): void { /* statechange */ }
  removeEventListener(): void { /* statechange */ }
  async resume(): Promise<void> { /* always running */ }
  async close(): Promise<void> { /* nothing to free */ }
  /** Record a node's output during render (e.g. the master gain = the mix before the dynamics chain). */
  tap(node: AudioNode, seconds: number): Tap {
    const n = Math.ceil(seconds * this.sampleRate);
    const t: Tap = { node: node as unknown as RNode, data: [new Float32Array(n), new Float32Array(n)] };
    this.taps.push(t);
    return t;
  }
  /** Plays the scheduled timeline from 0 for `seconds`: the destination's stereo output. */
  render(seconds: number): [Float32Array, Float32Array] {
    const n = Math.ceil(seconds * this.sampleRate), blocks = Math.ceil(n / BLOCK);
    const L = new Float32Array(n), R = new Float32Array(n);
    const dst = this.destination;
    for (let b = 0; b < blocks; b++) {
      const at = b * BLOCK, m = Math.min(BLOCK, n - at);
      dst.pull(b);
      if (!dst.silent) {
        const l = dst.out[0], r = dst.chans === 2 ? dst.out[1] : l;
        for (let i = 0; i < m; i++) { L[at + i] = l[i]; R[at + i] = r[i]; }
      }
      for (const t of this.taps) {
        t.node.pull(b);
        if (t.node.silent) continue;
        const l = t.node.out[0], r = t.node.chans === 2 ? t.node.out[1] : l;
        for (let i = 0; i < m; i++) { t.data[0][at + i] = l[i]; t.data[1][at + i] = r[i]; }
      }
    }
    return [L, R];
  }
  asContext(): AudioContext { return this as unknown as AudioContext; }
}

// ------------------------------------------------------------------------------------------------ measurement

/** Peak |sample| over both channels (optionally a window in seconds). */
export function peak(ch: Float32Array[], sr: number, from = 0, to = Infinity): number {
  let p = 0;
  const a = Math.max(0, Math.floor(from * sr)), z = Math.min(ch[0].length, Math.floor(to * sr));
  for (const d of ch) for (let i = a; i < z; i++) { const x = Math.abs(d[i]); if (x > p) p = x; }
  return p;
}

/** RMS in dBFS over a window (both channels pooled). */
export function rmsDb(ch: Float32Array[], sr: number, from = 0, to = Infinity): number {
  let s = 0, n = 0;
  const a = Math.max(0, Math.floor(from * sr)), z = Math.min(ch[0].length, Math.floor(to * sr));
  for (const d of ch) for (let i = a; i < z; i++) { s += d[i] * d[i]; n++; }
  return n ? 10 * Math.log10(s / n + 1e-20) : -200;
}

/** The loudest `win`-second RMS window (dBFS): X3's "max 100 ms RMS" level. */
export function maxWindowDb(ch: Float32Array[], sr: number, win = 0.1, from = 0, to = Infinity): number {
  const w = Math.max(1, Math.floor(win * sr));
  const a = Math.max(0, Math.floor(from * sr)), z = Math.min(ch[0].length, Math.floor(to * sr));
  let best = -200;
  for (let s = a; s + w <= z; s += Math.floor(w / 2)) best = Math.max(best, rmsDb(ch, sr, s / sr, (s + w) / sr));
  return best;
}

/** A band-passed copy (a 4th-order band: two cascaded RBJ band-passes, constant 0 dB peak) for per-band levels. */
export function band(ch: Float32Array[], sr: number, lo: number, hi: number): Float32Array[] {
  const f0 = Math.sqrt(lo * hi), bw = Math.log2(hi / lo);
  const w0 = 2 * Math.PI * f0 / sr, cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw * Math.sinh((Math.LN2 / 2) * bw * w0 / sw);
  const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  return ch.map((d) => {
    let o = d;
    for (let pass = 0; pass < 2; pass++) {
      const y = new Float32Array(o.length);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < o.length; i++) { const x = o[i]; const v = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = v; y[i] = v; }
      o = y;
    }
    return o;
  });
}

/** Sample-wise difference a − b (the contribution of whatever `a` has and `b` lacks). */
export function diff(a: Float32Array[], b: Float32Array[]): Float32Array[] {
  return a.map((d, c) => { const o = new Float32Array(d.length); const e = b[c]; for (let i = 0; i < d.length; i++) o[i] = d[i] - e[i]; return o; });
}

/** A seeded Math.random stand-in (weather.ts jitters its loop offsets with Math.random). */
export function seededRandom(seed = 0x9e3779b9): () => number {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

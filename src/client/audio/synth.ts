// OWNER: L5 (juice). Web Audio building blocks for procedural SFX: shared noise buffers, click-free envelopes,
// oscillator/noise/filter helpers. Every node a recipe creates is started and stopped on the audio clock, and
// every gain starts from ~0 and ramps — never a hard step — so nothing clicks or pops.

/** What a recipe draws into: a context, an output node (the voice gain) and a start time. */
export interface Voice {
  ctx: BaseAudioContext;
  out: AudioNode;
  t: number;
  /** Presentation randomness in [0,1). */
  rand(): number;
}

const noiseCache = new WeakMap<BaseAudioContext, { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer }>();

/** 2-second white/pink/brown noise buffers, generated once per context. */
export function noise(ctx: BaseAudioContext, kind: 'white' | 'pink' | 'brown' = 'white'): AudioBuffer {
  let c = noiseCache.get(ctx);
  if (!c) {
    const len = Math.floor(ctx.sampleRate * 2);
    const mk = () => ctx.createBuffer(1, len, ctx.sampleRate);
    const white = mk(), pink = mk(), brown = mk();
    const w = white.getChannelData(0), p = pink.getChannelData(0), b = brown.getChannelData(0);
    let s = 0x1234567, b0 = 0, b1 = 0, b2 = 0, br = 0;
    for (let i = 0; i < len; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      const r = ((s >>> 0) / 4294967296) * 2 - 1;
      w[i] = r;
      b0 = 0.99765 * b0 + r * 0.099046; b1 = 0.963 * b1 + r * 0.2965164; b2 = 0.57 * b2 + r * 1.0526913;
      p[i] = (b0 + b1 + b2 + r * 0.1848) * 0.18;
      br = (br + 0.02 * r) / 1.02; b[i] = br * 3.5;
    }
    // Fade the loop seam so looping sources never click.
    for (const d of [w, p, b]) for (let i = 0; i < 256; i++) { const k = i / 256; d[i] *= k; d[len - 1 - i] *= k; }
    c = { white, pink, brown };
    noiseCache.set(ctx, c);
  }
  return c[kind];
}

/** Attack–decay envelope on a gain param: 0 → peak in `a`, exponential fall to silence over `d`. */
export function ad(g: AudioParam, t: number, a: number, peak: number, d: number): number {
  g.cancelScheduledValues(t);
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(peak, t + Math.max(0.002, a));
  g.exponentialRampToValueAtTime(0.0001, t + a + Math.max(0.01, d));
  return a + d;
}

/** Attack–hold–release envelope. */
export function ahr(g: AudioParam, t: number, a: number, peak: number, hold: number, r: number): number {
  g.cancelScheduledValues(t);
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(peak, t + Math.max(0.002, a));
  g.setValueAtTime(peak, t + a + hold);
  g.exponentialRampToValueAtTime(0.0001, t + a + hold + Math.max(0.01, r));
  return a + hold + r;
}

export function gain(v: Voice, value = 0.0001, to: AudioNode = v.out): GainNode {
  const g = v.ctx.createGain();
  g.gain.value = value;
  g.connect(to);
  return g;
}

export function osc(v: Voice, type: OscillatorType, freq: number, dest: AudioNode, dur: number, t = v.t): OscillatorNode {
  const o = v.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

export function noiseSrc(v: Voice, dest: AudioNode, dur: number, kind: 'white' | 'pink' | 'brown' = 'white', t = v.t, rate = 1): AudioBufferSourceNode {
  const s = v.ctx.createBufferSource();
  s.buffer = noise(v.ctx, kind);
  s.loop = true;
  s.loopStart = 0;
  s.playbackRate.value = rate;
  s.connect(dest);
  // Random offset so repeated sounds are not identical.
  s.start(t, v.rand() * 1.5);
  s.stop(t + dur + 0.05);
  return s;
}

export function filter(v: Voice, type: BiquadFilterType, freq: number, q: number, dest: AudioNode, t = v.t): BiquadFilterNode {
  const f = v.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  f.Q.setValueAtTime(q, t);
  f.connect(dest);
  return f;
}

/** Exponential glide (frequency params must stay > 0). */
export function glide(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(Math.max(1, from), t);
  p.exponentialRampToValueAtTime(Math.max(1, to), t + Math.max(0.005, dur));
}

/** Soft-clip waveshaper curve (cached per amount) for grit on bass/stabs. */
const curves = new Map<number, Float32Array<ArrayBuffer>>();
export function softClip(amount: number): Float32Array<ArrayBuffer> {
  let c = curves.get(amount);
  if (!c) {
    c = new Float32Array(new ArrayBuffer(1024 * 4));
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = Math.tanh(x * amount) / Math.tanh(amount); }
    curves.set(amount, c);
  }
  return c;
}

export function midiHz(m: number): number { return 440 * Math.pow(2, (m - 69) / 12); }

// OWNER: S2 (sound). Vehicle engine loop voices — theme data like presets.ts (MASTER_PLAN §12: swap this file to
// re-theme the engines). Each builder creates one small, persistent Web Audio graph for one vehicle and returns a
// handle that vehicle-loops.ts steers at ≤ 30 Hz. Every change goes through setTargetAtTime (no clicks), and a
// parameter is only touched when its target moved by more than ~1 % (few automation events).
//
//   Mower kart  "putt-putt" two-stroke: a narrow-pulse oscillator at the firing rate (10.5 Hz idle → 36 Hz flat
//               out → 44 Hz boosting) rings an exhaust band-pass and a low thump; the same pulse chops a noise
//               "chuff". A slow wobble keeps the idle lumpy. A 70 Hz high-pass drops the (inaudible) firing
//               fundamental so it can't pump the master compressor, and a 1.1–2 kHz low-pass keeps the loop out of
//               the footstep band (~2–3.5 kHz) and the shots' crack.
//   RC plane    buzzy toy prop: a sawtooth at 92 → 250 Hz with throttle (+ airspeed), amplitude-chopped at the
//               blade rate and brightened by a throttle/airspeed low-pass (450 Hz → 1.3 kHz, then a fixed 1.3 kHz
//               one for a 24 dB/oct top, again clear of the footstep band); rushing air grows with airspeed; a
//               boost roar layer (brown noise + a sub square an octave down); a stall sputter (square-wave cough
//               on the gain, pitch sagging).
//
// No per-update allocations: set() writes its targets into a Float64Array and one flush loop applies the ones that
// moved. Doubles never cross a non-inlined JS call as arguments (V8 would box each one into a HeapNumber); the only
// boxing left is inside the Web Audio setTargetAtTime binding itself, which every automated param pays.
import { VEHICLES } from '../../shared/content/vehicles';
import { noise } from './synth';

/** What the manager feeds a voice each update (one shared object, reused; fields mutate in place). */
export interface EngineParams {
  /** Audio-clock time of this update. */
  now: number;
  /** Kart: ground speed; plane: airspeed (m/s). */
  speed: number;
  /** Plane throttle 0..1 (karts ignore it). */
  throttle: number;
  /** EFlag.Sprinting: kart boost/mini-turbo, plane boost. */
  boost: boolean;
  /** EFlag.Crouching: kart drift (handbrake), plane stall. */
  crouch: boolean;
  grounded: boolean;
  /** Pitch factor from the manager's radial-speed "doppler" (1 = none). */
  doppler: number;
}

export interface EngineVoice {
  /** Every node the voice created (disconnected on teardown). */
  readonly nodes: AudioNode[];
  /** The running sources (stopped on release/dispose). */
  readonly sources: AudioScheduledSourceNode[];
  /** Connect this to the slot's level gain. */
  readonly out: AudioNode;
  set(p: EngineParams): void;
  /** Spool down at p.now: the pitch sags while the manager fades the level out. */
  release(p: EngineParams): void;
}

/** A voice's smoothed AudioParams: write `target[i]` (and optionally `tc[i]`), then flush(now). A param is only
 *  scheduled when its target moved by more than eps (relative). */
class KnobBank {
  readonly target: Float64Array;
  readonly tc: Float64Array;
  private readonly last: Float64Array;
  private readonly eps: Float64Array;
  now = 0;
  constructor(private readonly params: AudioParam[], tcs: number[], eps: number[]) {
    const n = params.length;
    this.target = new Float64Array(n); this.tc = new Float64Array(tcs); this.eps = new Float64Array(eps);
    this.last = new Float64Array(n).fill(Number.NaN);
  }
  flush(): void {
    const T = this.target, last = this.last, eps = this.eps, tc = this.tc, ps = this.params, now = this.now;
    for (let i = 0; i < T.length; i++) {
      const v = T[i];
      if (Math.abs(v - last[i]) <= eps[i] * Math.max(1e-3, Math.abs(v))) continue;
      last[i] = v;
      ps[i].setTargetAtTime(v, now, tc[i]);
    }
  }
}

/** Node factory for one voice (records every node and source for teardown). */
function kit(ctx: BaseAudioContext) {
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  /** Destinations may be AudioParams (LFO → frequency/gain): connect() takes both at runtime. */
  const g = (value: number, to?: AudioNode | AudioParam): GainNode => {
    const n = ctx.createGain(); n.gain.value = value; if (to) n.connect(to as AudioNode); nodes.push(n); return n;
  };
  const f = (type: BiquadFilterType, freq: number, q: number, to: AudioNode): BiquadFilterNode => {
    const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = freq; n.Q.value = q; n.connect(to); nodes.push(n); return n;
  };
  const o = (type: OscillatorType, freq: number, to: AudioNode, at: number): OscillatorNode => {
    const n = ctx.createOscillator(); n.type = type; n.frequency.value = freq;
    n.connect(to); n.start(at); nodes.push(n); sources.push(n); return n;
  };
  const nz = (kind: 'white' | 'pink' | 'brown', to: AudioNode, at: number, offset: number, rate = 1): AudioBufferSourceNode => {
    const n = ctx.createBufferSource(); n.buffer = noise(ctx, kind); n.loop = true; n.playbackRate.value = rate;
    n.connect(to); n.start(at, offset); nodes.push(n); sources.push(n); return n;
  };
  return { nodes, sources, g, f, o, nz };
}

// ---------------------------------------------------------------------------------------------- mower kart

export const KART_ENGINE = {
  idleHz: 10.5, topHz: 36, boostMult: 1.22, driftMult: 1.1, airMult: 1.18,
  topSpeed: VEHICLES.mower_kart.topSpeed,
  /** Voice output: idle → flat out. Calibrated in the S2 offline renders: the local rider's kart (× LOOPS.localGain)
   *  sits ~7 dB (K-weighted) under a local Squeaker Rifle shot at top speed and ~13 dB under at idle. */
  idleLevel: 0.12, fullLevel: 0.18,
  toneIdle: 1100, toneTop: 1700, toneBoost: 300,
  highpass: 70,
} as const;

const pulseWaves = new WeakMap<BaseAudioContext, PeriodicWave>();
/** A narrow pulse (duty 8 %) as a PeriodicWave: one sharp "pop" per cycle — the two-stroke firing. */
function pulseWave(ctx: BaseAudioContext): PeriodicWave {
  let w = pulseWaves.get(ctx);
  if (!w) {
    const N = 128, d = 0.08;
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) re[n] = (2 * Math.sin(Math.PI * n * d)) / (Math.PI * n);
    w = ctx.createPeriodicWave(re, im);
    pulseWaves.set(ctx, w);
  }
  return w;
}

const K_RATE = 0, K_WOB = 1, K_TONE = 2, K_LEVEL = 3;

export function kartEngine(ctx: BaseAudioContext, at: number, jitter: number): EngineVoice {
  const K = KART_ENGINE;
  const { nodes, sources, g, f, o, nz } = kit(ctx);
  const out = g(K.idleLevel);
  const tone = f('lowpass', K.toneIdle, 0.7, f('highpass', K.highpass, 0.7, out));
  const mix = g(1, tone);
  // firing pulses → exhaust "putt" resonance + a low thump
  const fire = o('sine', K.idleHz, f('bandpass', 240, 2.2, g(1, mix)), at);
  fire.setPeriodicWave(pulseWave(ctx));
  fire.connect(f('lowpass', 160, 0.9, g(1.2, mix)));
  // the pulse chops a noise "chuff" (between pops the noise is ~−20 dB)
  const chuff = g(0, f('bandpass', 900, 0.9, g(0.55, mix)));
  fire.connect(g(0.6, chuff.gain));
  nz('pink', chuff, at, jitter * 1.5);
  // lumpy idle: a slow wobble on the firing rate
  const wob = g(K.idleHz * 0.05, fire.frequency);
  o('sine', 3.3 + jitter, wob, at);

  const b = new KnobBank([fire.frequency, wob.gain, tone.frequency, out.gain], [0.09, 0.2, 0.12, 0.15], [0.01, 0.05, 0.01, 0.01]);
  const T = b.target;
  return {
    nodes, sources, out,
    set(p) {
      const n = Math.min(1.25, Math.max(0, p.speed / K.topSpeed)), n1 = Math.min(1, n);
      let hz = K.idleHz + (K.topHz - K.idleHz) * Math.pow(n, 0.8);
      if (p.boost) hz *= K.boostMult;
      if (p.crouch) hz *= K.driftMult;
      if (!p.grounded) hz *= K.airMult; // wheels spin free in the air
      T[K_RATE] = hz * p.doppler;
      T[K_WOB] = hz * (0.06 - 0.04 * n1);
      T[K_TONE] = K.toneIdle + (K.toneTop - K.toneIdle) * n1 + (p.boost ? K.toneBoost : 0);
      T[K_LEVEL] = K.idleLevel + (K.fullLevel - K.idleLevel) * (p.boost ? 1 : n1);
      b.now = p.now;
      b.flush();
    },
    release(p) {
      T[K_RATE] = K.idleHz * 0.55; b.tc[K_RATE] = 0.2;
      b.now = p.now;
      b.flush();
    },
  };
}

// ---------------------------------------------------------------------------------------------- RC plane

export const PLANE_ENGINE = {
  idleHz: 92, fullHz: 250, airHz: 2.2, boostMult: 1.12, stallMult: 0.8,
  topSpeed: VEHICLES.rc_plane.topSpeed,
  /** Calibrated like the kart: local cruise ~7 dB (K-weighted) under a local Squeaker shot, boost ~3 dB under. */
  buzzLevel: 0.15, airLevel: 0.07, roarLevel: 0.16,
  /** Buzz level at zero throttle (fraction of full). */
  idleLevel: 0.5,
  toneBase: 450, toneThrottle: 700, toneAir: 10, toneBoost: 150, toneMax: 1300, toneTop: 1300,
  /** Blade-pass chop rate as a fraction of the buzz pitch. */
  chop: 0.2,
  sputterHz: 6.3,
} as const;

const P_PITCH = 0, P_SUB = 1, P_CHOP = 2, P_TONE = 3, P_SPUT = 4, P_SPUT_DEPTH = 5, P_AIR = 6, P_AIR_F = 7, P_ROAR = 8, P_BUZZ = 9;

export function planeEngine(ctx: BaseAudioContext, at: number, jitter: number): EngineVoice {
  const P = PLANE_ENGINE;
  const { nodes, sources, g, f, o, nz } = kit(ctx);
  const out = g(1);
  // buzz → blade chop → stall sputter → brightness
  const buzzOut = g(P.buzzLevel * P.idleLevel, out);
  const tone = f('lowpass', P.toneBase, 0.9, f('lowpass', P.toneTop, 0.5, buzzOut));
  const sput = g(1, tone);
  const sputDepth = g(0, sput.gain);
  o('square', P.sputterHz + jitter, sputDepth, at);
  const chop = g(0.75, sput);
  const chopLfo = o('sine', P.idleHz * P.chop, g(0.25, chop.gain), at);
  const buzz = o('sawtooth', P.idleHz, chop, at);
  // rushing air
  const air = g(0, out);
  const airBp = f('bandpass', 700, 0.9, f('lowpass', 1200, 0.5, air));
  nz('pink', airBp, at, jitter * 1.5);
  // boost roar
  const roar = g(0, out);
  nz('brown', f('lowpass', 650, 0.7, roar), at, 0.75 - jitter * 0.5, 0.9);
  const sub = o('square', P.idleHz / 2, f('lowpass', 420, 0.8, g(0.5, roar)), at);

  const b = new KnobBank(
    [buzz.frequency, sub.frequency, chopLfo.frequency, tone.frequency, sput.gain, sputDepth.gain, air.gain, airBp.frequency, roar.gain, buzzOut.gain],
    [0.12, 0.12, 0.12, 0.1, 0.05, 0.05, 0.2, 0.2, 0.1, 0.15],
    [0.01, 0.01, 0.01, 0.01, 0.02, 0.02, 0.02, 0.01, 0.02, 0.01],
  );
  const T = b.target;
  return {
    nodes, sources, out,
    set(p) {
      const th = Math.min(1, Math.max(0, p.throttle));
      const as = Math.max(0, p.speed);
      let hz = P.idleHz + (P.fullHz - P.idleHz) * th + P.airHz * Math.max(0, as - 8);
      if (p.boost) hz *= P.boostMult;
      if (p.crouch) hz *= P.stallMult;
      hz *= p.doppler;
      T[P_PITCH] = hz;
      T[P_SUB] = hz / 2;
      T[P_CHOP] = hz * P.chop;
      T[P_TONE] = Math.min(P.toneMax, P.toneBase + P.toneThrottle * th + P.toneAir * as + (p.boost ? P.toneBoost : 0));
      // stall: the gain coughs between 0.1 and 1 (base 0.55 ± 0.45); running: steady 1
      T[P_SPUT] = p.crouch ? 0.55 : 1;
      T[P_SPUT_DEPTH] = p.crouch ? 0.45 : 0;
      const a = Math.min(1.3, as / P.topSpeed);
      T[P_AIR] = P.airLevel * a * a * (p.grounded ? 0.4 : 1);
      T[P_AIR_F] = 550 + 450 * a;
      T[P_ROAR] = p.boost ? P.roarLevel : 0;
      T[P_BUZZ] = P.buzzLevel * (P.idleLevel + (1 - P.idleLevel) * th);
      b.tc[P_ROAR] = p.boost ? 0.05 : 0.25; // the roar kicks in fast and trails off
      b.now = p.now;
      b.flush();
    },
    release(p) {
      T[P_PITCH] = P.idleHz * 0.5; T[P_SUB] = P.idleHz * 0.25; T[P_ROAR] = 0;
      b.tc[P_PITCH] = 0.25; b.tc[P_SUB] = 0.25; b.tc[P_ROAR] = 0.08;
      b.now = p.now;
      b.flush();
    },
  };
}

// Weather, time of day and sprinkler bursts as PURE functions of (world seed, server tick). OWNER: G1.
//
// The authority and every client evaluate the same functions from the same tick, so weather is
// authoritative and deterministic without any protocol change: the sim reads sim.tick, clients read
// net.renderTime()*tickHz (or serverNow()*tickHz). Fractional ticks are fine (smooth visuals).
//
// State machine (one 13-minute cycle per index k, durations seeded by hash(seed, k)):
//   clear (2-3.5 min; cycle 0: 3-3.8 min) -> overcast (1-2) -> rain (1.5-2.7) -> [storm (1.2-2.2), 65 %,
//   always in cycle 0] -> clearing (1-1.5) -> clear (rest of the cycle, then the next cycle's clear).
// Every boundary blends over 20 s (smoothstep, +-10 s), so no parameter moves faster than
// 1.5 * delta / 20 s (<= 0.075 per second for the table below). The first 3 minutes of every seed are
// clear and sprinklers stay off for the first 75 s: short tests and soaks see the L2 world unchanged.
//
// Cross-machine determinism: everything that feeds gameplay (wetness -> slippery grass, sprinkler jet
// direction, burst schedule, lightning schedule) uses integer hashing and + - * / floor sqrt only.
// Math.sin/cos/exp are not guaranteed bit-identical across JS engines, so the jet direction uses the
// polynomial dsin/dcos below; transcendental functions appear only in visual-only values (flash).
import { hash2, hashSeed } from './noise';
import { TICK_HZ } from '../constants';
import type { Sprinkler } from './world-types';

export type WeatherKind = 'clear' | 'overcast' | 'rain' | 'storm' | 'clearing';
export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'overcast', 'rain', 'storm', 'clearing'];

/** Continuous weather parameters (all 0..1 except sight, a multiplier). */
export interface WeatherParams {
  /** Sky cover. */
  cloud: number;
  /** Rain intensity (streaks, ripples, audio). */
  rain: number;
  /** Storm strength (lightning chance, gusts). */
  storm: number;
  wind: number;
  /** Ground wetness: slippery grass (sim) and puddle darkening (visual). */
  wet: number;
  /** Extra haze. */
  fog: number;
  /** Light dimming / desaturation. */
  dark: number;
  /** AI sight-range multiplier (1 in clear weather, 0.6 in a full storm). */
  sight: number;
}

export const WEATHER_PARAMS: Record<WeatherKind, Readonly<WeatherParams>> = {
  clear: { cloud: 0.18, rain: 0, storm: 0, wind: 0.22, wet: 0, fog: 0, dark: 0, sight: 1 },
  overcast: { cloud: 0.74, rain: 0, storm: 0, wind: 0.42, wet: 0, fog: 0.3, dark: 0.28, sight: 0.96 },
  rain: { cloud: 0.9, rain: 0.72, storm: 0, wind: 0.55, wet: 1, fog: 0.55, dark: 0.42, sight: 0.85 },
  storm: { cloud: 1, rain: 1, storm: 1, wind: 1, wet: 1, fog: 0.8, dark: 0.7, sight: 0.6 },
  clearing: { cloud: 0.45, rain: 0.08, storm: 0, wind: 0.3, wet: 0.55, fog: 0.22, dark: 0.12, sight: 0.95 },
};

const PARAM_KEYS = ['cloud', 'rain', 'storm', 'wind', 'wet', 'fog', 'dark', 'sight'] as const;

export interface Strike {
  /** Unique per seed (the second it happened in). */
  id: number;
  /** Tick of the flash. */
  tick: number;
  /** Direction from the yard center (math angle in XZ: (cos, sin)). */
  bearing: number;
  /** Distance in "real" meters (drives brightness and thunder delay). */
  dist: number;
  /** 0..1 brightness (near strikes are brighter). */
  power: number;
  /** Seconds between flash and thunder (dist / 343). */
  thunderDelay: number;
}

export interface WeatherSample extends WeatherParams {
  tick: number;
  /** Dominant state (the transition's target once past halfway). */
  kind: WeatherKind;
  from: WeatherKind;
  to: WeatherKind;
  /** 0 = fully `from`, 1 = fully `to` (0 outside transitions). */
  blend: number;
  /** Lightning flash brightness at this tick (0..1, visual only). */
  flash: number;
  /** The most recent strike within the last 8 s, or null. */
  strike: Strike | null;
}

export const WEATHER_CYCLE_S = 13 * 60;
/** Half of the 20 s transition. */
export const WEATHER_BLEND_S = 10;
const CYCLE = WEATHER_CYCLE_S * TICK_HZ;
const H = WEATHER_BLEND_S * TICK_HZ;
const MIN = 60 * TICK_HZ;

interface Segment { kind: WeatherKind; start: number; end: number }

const segCache = new Map<string, Segment[]>();
let lastSeed = NaN, lastK = NaN, lastSegs: Segment[] = [];

/** The weather segments of cycle k (ticks, absolute). The last one is always 'clear'. */
export function weatherCycle(seed: number, k: number): Segment[] {
  if (seed === lastSeed && k === lastK) return lastSegs;      // hot path: no key string per call
  const key = `${seed}:${k}`;
  let segs = segCache.get(key);
  if (segs) { lastSeed = seed; lastK = k; lastSegs = segs; return segs; }
  const s = hashSeed(`weather:${seed}`) | 0;
  const r = (i: number) => hash2(k, i, s);
  const q = (mins: number) => Math.floor(mins * MIN);
  const list: [WeatherKind, number][] = [
    ['clear', k === 0 ? q(3 + 0.8 * r(1)) : q(2 + 1.5 * r(1))],
    ['overcast', q(1 + 1.0 * r(2))],
    ['rain', q(1.5 + 1.2 * r(3))],
  ];
  if (k === 0 || r(4) < 0.65) list.push(['storm', q(1.2 + 1.0 * r(5))]);
  list.push(['clearing', q(1 + 0.5 * r(6))]);
  segs = [];
  let t = k * CYCLE;
  for (const [kind, len] of list) { segs.push({ kind, start: t, end: t + len }); t += len; }
  segs.push({ kind: 'clear', start: t, end: (k + 1) * CYCLE });
  if (segCache.size > 64) segCache.clear();
  segCache.set(key, segs);
  lastSeed = seed; lastK = k; lastSegs = segs;
  return segs;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

interface Blend { from: WeatherKind; to: WeatherKind; w: number }
const blendScratch: Blend = { from: 'clear', to: 'clear', w: 0 };

function blendAt(seed: number, tick: number, out: Blend): Blend {
  const t = tick < 0 ? 0 : tick;
  const k = Math.floor(t / CYCLE);
  const segs = weatherCycle(seed, k);
  let i = 0;
  while (i < segs.length - 1 && t >= segs[i].end) i++;
  const seg = segs[i];
  out.from = seg.kind; out.to = seg.kind; out.w = 0;
  if (t < seg.start + H) {
    // entering this segment: blend from the previous one (previous cycle ends 'clear')
    const prev = i > 0 ? segs[i - 1].kind : 'clear';
    if (prev !== seg.kind) { out.from = prev; out.to = seg.kind; out.w = smooth(seg.start - H, seg.start + H, t); }
  } else if (t > seg.end - H) {
    const next = i < segs.length - 1 ? segs[i + 1].kind : 'clear';
    if (next !== seg.kind) { out.from = seg.kind; out.to = next; out.w = smooth(seg.end - H, seg.end + H, t); }
  }
  return out;
}

/** Blended weather parameters only (no lightning), for hot paths (sim wetness, AI sight). */
export function weatherParamsAt(seed: number, tick: number, out: WeatherParams = { ...WEATHER_PARAMS.clear }): WeatherParams {
  const b = blendAt(seed, tick, blendScratch);
  const A = WEATHER_PARAMS[b.from], B = WEATHER_PARAMS[b.to];
  for (const key of PARAM_KEYS) out[key] = A[key] + (B[key] - A[key]) * b.w;
  return out;
}

// ------------------------------------------------------------------ lightning
/** Strikes per second at full storm strength. */
const STRIKE_RATE = 0.16;
const stormScratch: WeatherParams = { ...WEATHER_PARAMS.clear };

/** The strike that happens in second-bin j (ticks [j*60, j*60+60)), or null. */
export function strikeInSecond(seed: number, j: number): Strike | null {
  if (j < 0) return null;
  const s = hashSeed(`strike:${seed}`) | 0;
  const storm = weatherParamsAt(seed, j * TICK_HZ, stormScratch).storm;
  if (storm < 0.25 || hash2(j, 1, s) >= STRIKE_RATE * storm) return null;
  const dist = 150 + 1150 * hash2(j, 4, s) * hash2(j, 5, s);
  return {
    id: j,
    tick: j * TICK_HZ + Math.floor(hash2(j, 2, s) * (TICK_HZ - 6)),
    bearing: hash2(j, 3, s) * 6.283185307179586,
    dist,
    power: 1 - 0.65 * (dist - 150) / 1150,
    thunderDelay: dist / 343,
  };
}

/** Calls `fn` for every strike whose flash tick is in [t0, t1). */
export function forEachStrike(seed: number, t0: number, t1: number, fn: (s: Strike) => void): void {
  if (t1 <= t0) return;
  const j0 = Math.floor(Math.max(0, t0) / TICK_HZ), j1 = Math.floor(t1 / TICK_HZ);
  for (let j = j0; j <= j1; j++) {
    const st = strikeInSecond(seed, j);
    if (st && st.tick >= t0 && st.tick < t1) fn(st);
  }
}

/** Most recent strike at or before `tick` within `lookbackS` seconds. */
export function lastStrike(seed: number, tick: number, lookbackS = 8): Strike | null {
  const j1 = Math.floor(tick / TICK_HZ);
  for (let j = j1; j >= Math.max(0, j1 - lookbackS); j--) {
    const st = strikeInSecond(seed, j);
    if (st && st.tick <= tick) return st;
  }
  return null;
}

/** Comic double-flicker envelope (seconds since the strike) -> 0..1. Visual only. */
export function flashEnvelope(dt: number): number {
  if (dt < 0) return 0;
  if (dt < 0.05) return 1;
  if (dt < 0.1) return 0.3;
  if (dt < 0.17) return 0.85;
  return 0.85 * Math.exp(-(dt - 0.17) / 0.11);
}

/** Full weather sample: blended parameters + state names + lightning flash and last strike. */
export function weatherAt(seed: number, tick: number, out?: WeatherSample): WeatherSample {
  const o = out ?? ({ ...WEATHER_PARAMS.clear, tick: 0, kind: 'clear', from: 'clear', to: 'clear', blend: 0, flash: 0, strike: null } as WeatherSample);
  weatherParamsAt(seed, tick, o);
  const b = blendAt(seed, tick, blendScratch);
  o.tick = tick;
  o.from = b.from; o.to = b.to; o.blend = b.w;
  o.kind = b.w < 0.5 ? b.from : b.to;
  const st = lastStrike(seed, tick);
  o.strike = st;
  o.flash = st ? flashEnvelope((tick - st.tick) / TICK_HZ) * st.power : 0;
  if (o.flash < 0.002) o.flash = 0;
  return o;
}

/** First tick >= fromTick whose dominant state is `kind` and that sits mid-segment (for labs/tests). */
export function findWeather(seed: number, kind: WeatherKind, fromTick = 0, maxCycles = 12): number {
  const k0 = Math.floor(Math.max(0, fromTick) / CYCLE);
  for (let k = k0; k < k0 + maxCycles; k++) {
    for (const s of weatherCycle(seed, k)) {
      const mid = Math.floor((s.start + s.end) / 2);
      if (s.kind === kind && mid >= fromTick) return mid;
    }
  }
  return -1;
}

// ------------------------------------------------------------------ time of day
/** Real minutes per in-game day (daylight takes 72 % of it). */
export const DAY_MINUTES = 24;
const DAY = DAY_MINUTES * MIN;
const DAY_FRAC = 0.72;
const DAWN = 0.23, DUSK = 0.77;

/**
 * Time of day (0 midnight, .25 sunrise, .5 noon, .75 sunset) at a tick. Starts late morning
 * (0.40-0.46 by seed), so an 8-minute match ends in the golden hour; dusk -> dawn takes ~6.7 minutes.
 */
export function timeOfDayAt(seed: number, tick: number): number {
  const s = hashSeed(`tod:${seed}`) | 0;
  const tod0 = 0.40 + 0.06 * hash2(1, 2, s);
  const p0 = ((tod0 - DAWN) / (DUSK - DAWN)) * DAY_FRAC;
  let p = p0 + (tick < 0 ? 0 : tick) / DAY;
  p -= Math.floor(p);
  const t = p < DAY_FRAC ? DAWN + (DUSK - DAWN) * (p / DAY_FRAC) : DUSK + (1 + DAWN - DUSK) * ((p - DAY_FRAC) / (1 - DAY_FRAC));
  return t - Math.floor(t);
}

// ------------------------------------------------------------------ deterministic trig
const PI = 3.141592653589793, HALF_PI = 1.5707963267948966, TWO_PI = 6.283185307179586;

/** sin(a) from + - * / floor only (Taylor to x^11 after range reduction; |error| < 6e-8). */
export function dsin(a: number): number {
  let x = a - TWO_PI * Math.floor((a + PI) / TWO_PI);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (1 - (x2 / 6) * (1 - (x2 / 20) * (1 - (x2 / 42) * (1 - (x2 / 72) * (1 - x2 / 110)))));
}
export const dcos = (a: number): number => dsin(a + HALF_PI);

// ------------------------------------------------------------------ sprinklers
export interface SprinklerState {
  /** Pressure 0..1 (ramps over 1.5 s at both ends of a burst); 0 = off. */
  on: number;
  /** Jet angle (math angle in XZ) and its unit direction. */
  angle: number;
  dirX: number;
  dirZ: number;
  /** Seconds into the current burst (-1 when off). */
  t: number;
}

const RAMP = 1.5 * TICK_HZ;

/** Burst + sweep state of a sprinkler at a tick. Pure; + - * / floor only. */
export function sprinklerAt(seed: number, sp: Sprinkler, tick: number, out?: SprinklerState): SprinklerState {
  const o = out ?? { on: 0, angle: sp.a0, dirX: 1, dirZ: 0, t: -1 };
  o.on = 0; o.t = -1; o.angle = sp.a0;
  const first = sp.first * TICK_HZ, period = sp.period * TICK_HZ, burst = sp.burst * TICK_HZ;
  const t = tick;
  if (t >= first) {
    const m = Math.floor((t - first) / period);
    const s = hashSeed(`sprinkler:${sp.id}:${seed}`) | 0;
    const slack = Math.max(0, period - burst - 4 * TICK_HZ);
    const start = first + m * period + Math.floor(hash2(m, 7, s) * slack);
    const local = t - start;
    if (local >= 0 && local <= burst) {
      o.on = smooth(0, RAMP, local) * (1 - smooth(burst - RAMP, burst, local));
      o.t = local / TICK_HZ;
      let u = local / (sp.sweep * TICK_HZ);
      u -= Math.floor(u);
      const tri = u < 0.5 ? 2 * u : 2 - 2 * u;
      o.angle = sp.a0 + (sp.a1 - sp.a0) * (tri * tri * (3 - 2 * tri));
    }
  }
  o.dirX = dcos(o.angle); o.dirZ = dsin(o.angle);
  return o;
}

/** cos(9 deg): half-width of the jet cone (literal: Math.cos may differ across engines in the last bit). */
export const SPRINKLER_JET_COS = 0.98768834059513777;
/** Within this distance of the jet's center line (m) a character is also in the jet (near the nozzle). */
export const SPRINKLER_JET_HALF_WIDTH = 0.65;

/**
 * Is (x, z) inside the jet of a sprinkler whose state is `st`? Returns the horizontal distance from the
 * nozzle when inside, or -1. Only + - * / sqrt.
 */
export function inSprinklerJet(sp: Sprinkler, st: SprinklerState, x: number, z: number): number {
  if (st.on <= 0) return -1;
  const dx = x - sp.x, dz = z - sp.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > sp.reach * sp.reach || d2 < 0.36) return -1;
  const along = dx * st.dirX + dz * st.dirZ;
  if (along <= 0) return -1;
  const d = Math.sqrt(d2);
  const across = dx * st.dirZ - dz * st.dirX;
  if (along / d >= SPRINKLER_JET_COS || (across < SPRINKLER_JET_HALF_WIDTH && across > -SPRINKLER_JET_HALF_WIDTH)) return d;
  return -1;
}

/** Is (x, z) inside the area a sprinkler sweeps (wet grass while it runs)? */
export function inSprinklerSweep(sp: Sprinkler, x: number, z: number): boolean {
  const dx = x - sp.x, dz = z - sp.z;
  const r = sp.reach + 1;
  if (dx * dx + dz * dz > r * r) return false;
  if (sp.a1 - sp.a0 >= TWO_PI - 1e-6) return true;
  // angle of the point relative to a0, via the sweep's mid direction: inside when the angular offset
  // from the mid angle is below half the arc (compare cosines; dcos of constants only).
  const mid = (sp.a0 + sp.a1) / 2, half = (sp.a1 - sp.a0) / 2 + 0.2;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-6) return true;
  const c = (dx * dcos(mid) + dz * dsin(mid)) / d;
  return half >= PI || c >= dcos(half);
}

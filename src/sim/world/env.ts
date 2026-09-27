// World environment for the authority (G1): weather per tick, the concealment component, and the
// constants the AI's perception uses. OWNER: G1 (world lane).
//
//  - simWeather(sim): the blended weather parameters at sim.tick (cached per tick per Sim).
//  - e.conceal: per-character concealment written by the conceal system (order 620, systems.ts) and
//    read by the AI (sim/ai/brain.ts perceive): level 0..1 = zone value (queries.concealmentAt) x
//    stance (still 1 · sneaking 0.7-0.85 · running 0.3 · sprinting 0), forced to 0 for 2 s after the
//    character fires and 0.5 s after it is hit. Level >= 0.5 also sets EFlag.Stealthed in snapshots, so
//    clients hide the nameplate and soften footsteps of hidden enemies without any protocol change.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { weatherParamsAt, WEATHER_PARAMS, type WeatherParams } from '../../shared/world/weather';

export interface ConcealState {
  /** Effective concealment 0..1 (what enemies' perception uses). */
  level: number;
  /** Raw zone value at the character's feet (before stance/firing). */
  zone: number;
  /** Tick until which the character is revealed (fired / got hit). */
  revealUntil: number;
}

declare module '../entity' {
  interface SimEntity {
    conceal?: ConcealState;
  }
}

/** Fully concealed characters are seen only within this distance (m). */
export const CONCEAL_REVEAL = 5;
/** Enemies already tracking the target see through concealment this much farther. */
export const CONCEAL_TRACK_MULT = 2;
/** Seconds a shot keeps the shooter revealed. */
export const CONCEAL_FIRE_REVEAL_S = 2;
/** Concealment level from which the Stealthed flag is shown to clients. */
export const CONCEAL_FLAG_LEVEL = 0.5;

const cache = new WeakMap<Sim, { tick: number; w: WeatherParams }>();

/** Weather parameters at the sim's current tick (the world's schedule: its seed and W9 weather bias). */
export function simWeather(sim: Sim): WeatherParams {
  let c = cache.get(sim);
  if (!c) { c = { tick: -1, w: { ...WEATHER_PARAMS.clear } }; cache.set(sim, c); }
  if (c.tick !== sim.tick) { weatherParamsAt(sim.worldData, sim.tick, c.w); c.tick = sim.tick; }
  return c.w;
}

/** AI sight-range multiplier from the weather (storm 0.6 ... clear 1). */
export function weatherSightMult(sim: Sim): number {
  return simWeather(sim).sight;
}

/** Effective concealment of a character as seen by enemies (0 = in the open). */
export function concealLevel(e: SimEntity): number {
  return e.conceal?.level ?? 0;
}

/**
 * Distance (m) within which an observer spots a target of concealment `level`: the full sight range
 * in the open, CONCEAL_REVEAL (5 m) when fully hidden; x2 when the observer was already tracking it.
 */
export function concealRevealRange(level: number, sightRange: number, tracking: boolean): number {
  const r = sightRange - (sightRange - CONCEAL_REVEAL) * Math.min(1, Math.max(0, level));
  return tracking ? r * CONCEAL_TRACK_MULT : r;
}

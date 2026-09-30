// W10 AU2 (audio-2): scene builders for the rendered audio tests (pure: no vitest, no renderer), shared by the Node
// driver (audio-w10-driver.ts, the offline renderer) and the Chromium cross-check (a real OfflineAudioContext, see
// docs/handoff/AU2.md). A scene is a scripted moment played frame by frame the way main.ts drives the audio (60 Hz:
// listener, snapshot states, game events, ordnance cues, weather sample).
import type { EntityState, GameEvent } from '../../src/shared/protocol';
import { EFlag, EntityKind, Species } from '../../src/shared/types';
import type { OrdnanceCue } from '../../src/client/fx/ordnance-view';
import { WEATHER_PARAMS, type WeatherKind, type WeatherSample } from '../../src/shared/world/weather';
import type { WorldData } from '../../src/shared/world/world-types';
import { FUSE_TICKS } from '../../src/shared/content/ordnance';
import { TICK_DT } from '../../src/shared/constants';
import { BA_BALL_SEED, BA_GOAL_SEED, BA_STAND_SEED, BallState } from '../../src/shared/content/modes';
import type { GameAudio } from '../../src/client/audio';
import type { OrdnanceAudio } from '../../src/client/audio/presets-ordnance';
import type { WeatherAudio } from '../../src/client/audio/weather';
import type { SiteAmbience } from '../../src/client/audio/site-ambience';

export const SR = 32000;
export const FPS = 60;
/** A camera stand-in (engine/weather read matrixWorld: position, local -Z forward, local +Y up). */
export function camera(x: number, y: number, z: number, yaw = 0): { matrixWorld: { elements: number[] } } {
  // yaw 0 looks down -z; yaw rotates about +y (right-handed)
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { matrixWorld: { elements: [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1] } };
}

export function weatherSample(kind: WeatherKind, tick = 0): WeatherSample {
  return { ...WEATHER_PARAMS[kind], tick, kind, from: kind, to: kind, blend: 0, flash: 0, strike: null };
}

export function pet(id: number, o: Partial<EntityState> = {}): EntityState {
  return {
    id, kind: EntityKind.Player, team: 0, species: Species.Corgi, cls: 0, seed: id, x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    vx: 0, vy: 0, vz: 0, hp: 100, maxHp: 100, anim: 0, flags: EFlag.Grounded, weapon: 0, ammo: 10, ...o,
  };
}


/** What a frame hook sees of the mounted stack. */
export interface Stack {
  audio: GameAudio;
  ord: OrdnanceAudio;
  weather: WeatherAudio | null;
  ambience: SiteAmbience | null;
}

export interface MountOptions {
  seconds: number;
  /** Play these recipes at gain 0 (still through the limiter, the danger duck and the voice seed): a render with and
   *  one without them muted differ by exactly their sound (the master tap is a linear sum). */
  mute?: ReadonlySet<unknown>;
  music?: boolean;
  world?: WorldData | null;
  weather?: boolean;
  ambience?: boolean;
  seed?: number;
}

export interface Timed<T> { at: number; v: T }

export interface Scene extends MountOptions {
  localId: number;
  /** The camera (listener) over time. */
  listener(t: number): ReturnType<typeof camera>;
  /** Snapshot states over time (footsteps, positions for events). */
  states(t: number): Map<number, EntityState>;
  events?: Timed<GameEvent>[];
  cues?: Timed<OrdnanceCue>[];
  /** Weather over time (needs `world`). */
  sky?(t: number): WeatherSample;
  /** The world tick for the weather audio (thunder, sprinklers); absent = NaN (both paused). */
  tick?(t: number): number;
  /** Extra per-frame work (e.g. a direct engine.play). */
  frame?(m: Stack, t: number): void;
}

/** One frame of a scene (the driver moves the clock first). */
export function stepScene(s: Scene, m: Stack, t: number, dt: number, cursor: { e: number; c: number }, events: Timed<GameEvent>[], cues: Timed<OrdnanceCue>[]): void {
  const cam = s.listener(t);
  const st = s.states(t);
  const obj = cam as unknown as import('three/webgpu').Object3D;
  if (m.weather && s.sky) m.weather.update(s.sky(t), s.tick ? s.tick(t) : Number.NaN, obj, dt);
  if (m.ambience && s.sky) m.ambience.update(s.sky(t), obj, dt);
  m.audio.update(obj, st, s.localId, dt);
  while (cursor.e < events.length && events[cursor.e].at <= t) m.audio.onGameEvent(events[cursor.e++].v);
  while (cursor.c < cues.length && cues[cursor.c].at <= t) m.ord.cue(cues[cursor.c++].v);
  s.frame?.(m, t);
}

// ------------------------------------------------------------------------------------------------ the fuse

/** The ordnance view's tick schedule for a throwable released at `t0` (fx/ordnance-view.ts: a blink every
 *  0.07 + 0.38 × fuse-left seconds, urgency = 1 − fuse-left), sampled at 60 Hz like the view. */
export function fuseTicks(t0: number, kind: 0 | 1, x: number, y: number, z: number, local = false): Timed<OrdnanceCue>[] {
  const out: Timed<OrdnanceCue>[] = [];
  const fuse = FUSE_TICKS * TICK_DT;
  let acc = 0;
  for (let t = 0; t < fuse; t += 1 / FPS) {
    const left = Math.max(0, fuse - t) / fuse;
    const period = 0.07 + 0.38 * left;
    acc += 1 / FPS;
    if (acc >= period) { acc = 0; out.push({ at: t0 + t, v: { type: 'tick', kind, x, y, z, k: 1 - left, local } }); }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the busy moment

/** Weapon wire order for the scenes (GameAudio.setWeaponIds). */
export const WEAPON_IDS = ['squeaker_rifle', 'snap_pistol', 'laser_longshot', 'tennis_mortar', 'sprinkler_cannon', 'frisbee_launcher'] as const;

export interface BusyOptions {
  world: WorldData;
  /** The local player's species = team (0 corgis, 1 cats). */
  local: 0 | 1;
  /** The throwable: 0 squeaker (corgis'), 1 hairball (cats'), released at `fuseFrom` s, resting at `fuseAt`. */
  fuseKind: 0 | 1;
  fuseAt: [number, number, number];
  fuseFrom?: number;
  /** Include the fuse ticks (the blast always happens). */
  ticks?: boolean;
  /** The firefight (4 guns + hits + a mortar), the Base Assault run + capture, music, weather + site ambience. */
  fight?: boolean; capture?: boolean; music?: boolean; sky?: WeatherKind; ambience?: boolean;
  seconds?: number;
  mute?: ReadonlySet<unknown>;
}

/**
 * A busy Base Assault moment (4 s): the local player (id 1) at the origin, camera 3.8 m behind; a teammate (2) carries
 * the enemy ball home and captures at 2.4 s; three enemies (11-13) and the two friends trade fire at 5-20 m; hits both
 * ways; a mortar at 1.6 s; a storm; a throwable released at 1.0 s ticks to its blast at 3.2 s at `fuseAt`.
 */
export function busyMoment(o: BusyOptions): Scene {
  const L = o.local, F = (1 - L) as 0 | 1;
  const spL = L === 0 ? Species.Corgi : Species.Cat, spF = F === 0 ? Species.Corgi : Species.Cat;
  const ev: Timed<GameEvent>[] = [];
  const fire = (at: number, id: number, wpn: number, x: number, z: number, hx: number, hz: number) =>
    ev.push({ at, v: { e: 'fire', id, wpn, x, y: 1, z, dx: 0, dy: 0, dz: -1, hx, hy: 0.2, hz, hit: -1 } as GameEvent });
  const seconds = o.seconds ?? 4;
  if (o.fight !== false) {
    for (let t = 0.2; t < seconds - 0.1; t += 0.11) if (t % 1.1 < 0.8) fire(t, 1, 0, 0, 0, 2, -30);
    for (let t = 0.3; t < seconds - 0.1; t += 0.12) if (t % 0.9 < 0.6) fire(t, 11, 0, 7, -12, 1 + (t * 7) % 3, 2 - (t * 5) % 4);
    for (let t = 0.5; t < seconds - 0.1; t += 0.7) fire(t, 12, 4, -9, -7, -2, 1);
    for (let t = 0.4; t < seconds - 0.1; t += 0.26) fire(t, 13, 1, 3, -18, 3, -2);
    for (let t = 0.25; t < seconds - 0.1; t += 0.13) if (t % 1.3 < 0.9) fire(t, 2, 0, -2, 1, -8, -14);
    for (let t = 0.6; t < seconds - 0.1; t += 0.55) ev.push({ at: t, v: { e: 'hit', src: 11, dst: 1, dmg: 8, x: 0, y: 1, z: 0, crit: false } as GameEvent });
    for (let t = 0.45; t < seconds - 0.1; t += 0.4) ev.push({ at: t, v: { e: 'hit', src: 1, dst: 11, dmg: 12, x: 7, y: 1, z: -12, crit: t > 2 } as GameEvent });
    ev.push({ at: 1.6, v: { e: 'explode', x: 6, y: 0, z: -9, r: 3, by: 12 } as GameEvent });
  }
  const captureAt = 2.4;
  if (o.capture !== false) ev.push({ at: captureAt, v: { e: 'score', team: L, pts: 1, reason: 'captured' } as GameEvent });
  const cues: Timed<OrdnanceCue>[] = [];
  const t0 = o.fuseFrom ?? 1.0, fuse = FUSE_TICKS * TICK_DT, [fx, fy, fz] = o.fuseAt;
  if (o.ticks !== false) cues.push(...fuseTicks(t0, o.fuseKind, fx, fy, fz));
  cues.push({ at: t0 + fuse, v: { type: 'blast', kind: o.fuseKind, x: fx, y: fy, z: fz, k: 1, local: false } });
  ev.push({ at: t0 + fuse, v: { e: 'explode', x: fx, y: fy, z: fz, r: 4, by: 11 } as GameEvent });
  const carrier = pet(2, { team: L, species: spL, x: -2, z: 1, vx: 2.5, flags: EFlag.Grounded | EFlag.Carrier });
  const prop = (id: number, seed: number, team: 0 | 1, x: number, z: number, o2: Partial<EntityState> = {}) =>
    pet(id, { kind: EntityKind.Prop, cls: -1, seed, team, species: team, x, z, weapon: 0, ammo: 0, flags: 0, ...o2 });
  const before = new Map<number, EntityState>([
    [1, pet(1, { team: L, species: spL, vx: 2 })], [2, carrier],
    [11, pet(11, { team: F, species: spF, x: 7, z: -12, vx: 3 })], [12, pet(12, { team: F, species: spF, x: -9, z: -7, vz: 3 })],
    [13, pet(13, { team: F, species: spF, x: 3, z: -18, vx: -3 })],
    [90, prop(90, BA_STAND_SEED, L, -10, 14)], [91, prop(91, BA_STAND_SEED, F, 40, -60)],
    [92, prop(92, BA_GOAL_SEED, L, -8, 12)], [93, prop(93, BA_GOAL_SEED, F, 38, -58)],
    [94, prop(94, BA_BALL_SEED, L, -10, 14)],
  ]);
  const after = new Map(before);
  if (o.capture !== false) before.set(95, prop(95, BA_BALL_SEED, F, -2, 1, { weapon: BallState.Carried, ammo: 2, flags: EFlag.Busy }));
  else before.set(95, prop(95, BA_BALL_SEED, F, 40, -60));
  after.set(95, prop(95, BA_BALL_SEED, F, 40, -60));
  after.set(2, { ...carrier, flags: EFlag.Grounded });
  return {
    seconds, music: o.music ?? true, world: o.world, weather: true, ambience: o.ambience ?? true, localId: 1, mute: o.mute,
    events: ev, cues,
    listener: () => camera(0, 2.2, 3.8),
    states: (t) => (t < captureAt ? before : after),
    sky: () => weatherSample(o.sky ?? 'storm'),
    frame: (m, t) => { if (t === 0) m.audio.setWeaponIds(WEAPON_IDS); },
  };
}

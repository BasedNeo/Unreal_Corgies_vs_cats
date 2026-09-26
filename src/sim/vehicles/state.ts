// Vehicle components (module augmentation on SimEntity), collision groups and the per-Sim runtime
// (Rapier objects the vehicle systems own). No Three.js, no DOM, no Math.random().
import type { KinematicCharacterController, Shape, World } from '@dimforge/rapier3d-compat';
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import type { EntityId, TeamId } from '../../shared/types';
import type { GameEvent } from '../../shared/protocol';
import { groups, Layer } from '../rapier';
import { VEHICLES, type KartExplosionDef, type TerminalId, type VehicleDef, type VehicleId } from '../../shared/content/vehicles';

/** Kart runtime state. Plain data (the kart's pose/velocity live on the entity: pos, vel, yaw, pitch). */
export interface KartState {
  id: VehicleId;
  /** Terminal that vended this kart (-1 = none, e.g. placed by a test). */
  terminal: EntityId;
  /** Seated driver (-1 = empty). */
  rider: EntityId;
  /** Current yaw rate (rad/s, + = turning left). */
  yawRate: number;
  grounded: boolean;
  /** Seconds since last grounded. */
  airTime: number;
  /** Terrain pitch under the kart (rad, + = nose up); drives slope gravity. */
  groundPitch: number;
  /** Boost meter 0..1. */
  boost: number;
  /** Seconds before the meter starts refilling. */
  boostDelay: number;
  boosting: boolean;
  /** Seconds of mini-turbo left. */
  turbo: number;
  drifting: boolean;
  /** Drift direction (-1 right, +1 left, 0 = not chosen yet). */
  driftDir: number;
  /** Seconds of committed drifting (for the mini-turbo). */
  driftCharge: number;
  /** Seconds without a rider (abandon despawn). */
  idle: number;
  hornCd: number;
  /** Character id -> tick until which this kart cannot ram it again. */
  ramUntil: Record<number, number>;
}

export interface TerminalState {
  id: TerminalId;
  /** Kart currently out (-1 = none). */
  kart: EntityId;
  /** Seconds until the terminal can vend again. */
  cooldown: number;
  /** Cooldown length used for the progress display. */
  cooldownTotal: number;
  /** Kart spawn pad (ground point) and heading. */
  padX: number; padY: number; padZ: number; padYaw: number;
}

/** Rider-side mount record (mirrors EFlag.Mounted). */
export interface SeatState {
  vehicle: EntityId;
  /** This tick's raw buttons (before the vehicle system masks the rider's combat buttons). */
  raw: number;
  /** Raw buttons of the previous tick, for horn edge detection. */
  prevRaw: number;
}

declare module '../entity' {
  interface SimEntity {
    kart?: KartState;
    terminal?: TerminalState;
    seat?: SeatState;
  }
}

/** Kart body membership: hit by world rays/projectiles, blocks characters, collides with world + karts. */
export const VEHICLE_GROUPS = groups(Layer.Vehicle, Layer.World | Layer.Character | Layer.Projectile | Layer.Vehicle);
/** What a kart's own movement collides with (characters are handled analytically: shove / ram). */
export const KART_MOVE_FILTER = groups(Layer.Vehicle, Layer.World | Layer.Vehicle);
/** Solid kiosk: a piece of world geometry. */
export const TERMINAL_GROUPS = groups(Layer.World, 0xffff);
/** Clearance test for a character capsule (dismount / spawn): world + vehicles + other characters. */
export const CAPSULE_CLEAR_FILTER = groups(Layer.Character, Layer.World | Layer.Vehicle);
/** Static-geometry-only rays (no vehicles) for line-of-exit checks. */
export const STATIC_RAY_FILTER = groups(Layer.Projectile, Layer.World);
/** Character shove movement: world only (the kart doing the shoving must not block its own push). */
export const SHOVE_FILTER = groups(Layer.Character, Layer.World);

/** Damage-relevant events seen this tick (tapped from sim.emit), resolved by the vehicle damage system. */
export interface PendingBlast { ev: Extract<GameEvent, { e: 'explode' }>; def: KartExplosionDef | null }
export interface VehicleRuntime {
  kcc: KinematicCharacterController;
  /** Collider handle -> entity id for karts and terminals. */
  byHandle: Map<number, EntityId>;
  shots: Extract<GameEvent, { e: 'fire' }>[];
  blasts: PendingBlast[];
  /** Set while the vehicle code emits its own kart explosion, so the tap records the right damage. */
  ownBlast: KartExplosionDef | null;
  capsules: Map<string, Shape>;
  sitesPlaced: boolean;
}

const runtimes = new WeakMap<Sim, VehicleRuntime>();

/** Kart-tuned kinematic controller: lower steps, firmer ground snap, 40° climb limit. */
export function createKartController(world: World): KinematicCharacterController {
  const kcc = world.createCharacterController(0.03);
  kcc.setUp({ x: 0, y: 1, z: 0 });
  kcc.enableAutostep(0.3, 0.25, false);
  kcc.enableSnapToGround(0.3);
  kcc.setMaxSlopeClimbAngle((40 * Math.PI) / 180);
  kcc.setMinSlopeSlideAngle((50 * Math.PI) / 180);
  kcc.setApplyImpulsesToDynamicBodies(false);
  kcc.setSlideEnabled(true);
  return kcc;
}

export function vehicleRuntime(sim: Sim): VehicleRuntime {
  let rt = runtimes.get(sim);
  if (!rt) {
    rt = { kcc: createKartController(sim.world), byHandle: new Map(), shots: [], blasts: [], ownBlast: null, capsules: new Map(), sitesPlaced: false };
    runtimes.set(sim, rt);
  }
  return rt;
}

/** Capsule shape matching a character's collider (cached per size). */
export function capsuleShape(sim: Sim, e: SimEntity): Shape {
  const m = e.char!.move;
  const key = `${m.capsuleHalfHeight}:${m.capsuleRadius}`;
  const rt = vehicleRuntime(sim);
  let s = rt.capsules.get(key);
  if (!s) { s = new sim.R.Capsule(m.capsuleHalfHeight, m.capsuleRadius); rt.capsules.set(key, s); }
  return s;
}

/** The team a kart currently fights for: its driver's, else the team that vended it. */
export function kartTeam(sim: Sim, kart: SimEntity): TeamId {
  const r = kart.kart && kart.kart.rider >= 0 ? sim.entities.get(kart.kart.rider) : undefined;
  return r ? r.team : kart.team;
}

const hulls = new Map<string, Float32Array>();
/**
 * Kart collision body: a 16-sided prism (radius, 2×halfHeight tall) with a chamfered bottom edge so
 * it rides over seams and lips. A convex hull rather than Rapier's rounded cylinder: the controller's
 * shape casts stay exact against very large boxes, where GJK on rounded/curved shapes let bodies
 * sink (measured: see LEARNINGS.jsonl). Points are relative to the collider center.
 */
export function kartHullPoints(def: VehicleDef, sides = 16): Float32Array {
  const key = `${def.id}:${sides}`;
  let pts = hulls.get(key);
  if (pts) return pts;
  const r = def.radius, hh = def.halfHeight, ch = def.border;
  const out: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = ((i + 0.5) / sides) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    out.push(c * r, hh, s * r, c * r, -hh + ch, s * r, c * (r - ch), -hh, s * (r - ch));
  }
  pts = new Float32Array(out);
  hulls.set(key, pts);
  return pts;
}

export function kartDef(kart: SimEntity): VehicleDef {
  return VEHICLES[kart.kart!.id];
}

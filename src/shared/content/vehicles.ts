// Vehicles and vehicle terminals as data (theme content). The authoritative vehicle systems in
// src/sim/vehicles read these tables; clients read them for names, chase-camera numbers and the
// kart / plane silhouettes. Units: meters, seconds, radians, hit points, m/s, m/s².
//
// Snapshot conventions (EntityState, see docs/handoff/V1.md and docs/handoff/R1.md):
//   Vehicle  (EntityKind.Vehicle):  cls = index into VEHICLE_IDS (karts go out as -1 = index 0; planes as 1) ·
//            pitch = body pitch (+ = nose up) · weapon = rider entity id (-1 = empty) · hp/maxHp = armor.
//     kart:  x,y,z = wheels' ground point · ammo = boost meter 0..100 · flags: Busy = seat taken, Grounded,
//            Sprinting = boosting (meter or mini-turbo), Crouching = drifting (handbrake).
//     plane: x,y,z = the landing gear's ground point (fuselage center = y + gearHeight) · yaw = heading ·
//            ammo = packPlaneAux(throttle, roll) (bank angle + engine throttle, see below) · flags: Busy = seat
//            taken, Grounded = rolling on its wheels, Sprinting = boosting, Crouching = stalled, Reloading = boost
//            recharging, Aiming = gun overheated, Firing = gun fired in the last 0.15 s.
//   Terminal (EntityKind.Terminal): cls = index into TERMINAL_IDS (terminals.ts) · weapon = its active vehicle id
//            (-1 none) · ammo = whole seconds of cooldown left · hp/maxHp = cooldown progress (maxHp = cooldown s) ·
//            flags: Busy = unavailable (vehicle out or cooling down).
//
// The terminal table moved to ./terminals.ts (S1 added the Ordnance Terminal); it is re-exported here so
// existing imports from vehicles.ts keep working.

import type { ClassId } from '../types';

export {
  TERMINALS, TERMINAL_IDS, VEHICLE_TERMINAL_IDS, terminalIndex, terminalByIndex, anyTerminalByIndex, terminalKindAt,
  type TerminalDef, type TerminalId, type OrdnanceTerminalDef, type AnyTerminalDef, type AnyTerminalId,
} from './terminals';

export interface KartExplosionDef {
  /** Blast radius (m), damage at the center, full-damage inner radius, damage fraction at the edge. */
  radius: number;
  damage: number;
  inner: number;
  edgeFrac: number;
  /** Outward knockback at the center (m/s), scaled by falloff. */
  knockback: number;
}

/** A kart (V1's Mower Kart). The interface keeps its V1 name; `kind` tells it apart from planes. */
export interface VehicleDef {
  id: string;
  kind: 'kart';
  /** Corgi-side and cat-side display names (same machine, different flavor). */
  name: string;
  catName: string;
  // ---- body ----
  /** Collision body: an upright 16-sided prism (≈ rotation-invariant, so turning never clips walls). */
  radius: number;
  halfHeight: number;
  /** Bottom-edge chamfer (m). Helps the body ride over seams and small lips. */
  border: number;
  /** Rider feet position in kart space (x right, y up from the kart's ground point, z toward the back). */
  seat: { x: number; y: number; z: number };
  maxHp: number;
  // ---- engine ----
  topSpeed: number;
  /** Top speed while boosting (meter) or during a drift mini-turbo. */
  boostSpeed: number;
  reverseSpeed: number;
  accel: number;
  boostAccel: number;
  reverseAccel: number;
  /** Deceleration when pressing against the direction of travel. */
  brakeDecel: number;
  /** Rolling resistance with no throttle. */
  coastDecel: number;
  /** Extra deceleration while the handbrake (drift) is held. */
  handbrakeDecel: number;
  /** Pull back toward the current top speed when above it (after a boost / downhill). */
  overspeedDecel: number;
  /** Fraction of gravity applied along the slope (uphill slows, downhill speeds up). */
  slopeGravity: number;
  // ---- steering ----
  /** Yaw rate at full lock (rad/s). */
  maxYawRate: number;
  /** How fast the yaw rate follows the stick (rad/s²) — a little weight, no twitch. */
  yawAccel: number;
  /** Speed (m/s) at which steering reaches full authority (karts cannot turn standing still). */
  steerFullSpeed: number;
  /** Steering authority lost at boost speed (0..1): a little understeer when flat out. */
  understeer: number;
  // ---- grip & drift ----
  /** Grip (1/s): how fast the velocity swings onto the heading. Steady slip angle ≈ yaw rate / grip. */
  grip: number;
  /** Grip while drifting (handbrake held): lower = wider slide. */
  driftGrip: number;
  /** Speed lost per second while drifting (m/s²). */
  driftDrag: number;
  /** Beyond this slip angle (rad) grip stops steering the velocity and plain sideways friction takes over. */
  maxGripSlip: number;
  /** Sideways friction (1/s) for big slides, knockbacks and crawling speeds. */
  skidFriction: number;
  /** Minimum forward speed to start or hold a drift. */
  driftMinSpeed: number;
  /** Yaw-rate multiplier while drifting (tighter line). */
  driftYawMult: number;
  /** Seconds of committed drifting needed for a mini-turbo on release. */
  turboCharge: number;
  /** Mini-turbo duration (s) at boostSpeed. */
  turboTime: number;
  // ---- boost meter (Sprint) ----
  /** Seconds of boost in a full meter. */
  boostDuration: number;
  /** Seconds to refill an empty meter. */
  boostRecharge: number;
  /** Seconds after boosting before the meter refills. */
  boostRechargeDelay: number;
  // ---- air ----
  gravityScale: number;
  /** Share of steering available in the air. */
  airYawControl: number;
  /** Horizontal speed lost per second in the air (fraction). */
  airDrag: number;
  /** Jump pads launch karts at pad.vy × this (karts are heavier than pets). */
  jumpPadMult: number;
  /** Horizontal speed kept per 60 Hz tick in wading water (slows karts hard). */
  waterDrag: number;
  // ---- collisions ----
  /** Speed kept (bounce) off walls, as a fraction of the impact speed. */
  wallRestitution: number;
  /** Tangential speed lost on a hard wall hit (fraction at >= 10 m/s impacts). */
  wallScrub: number;
  /** Wall impacts faster than this (m/s, normal component) damage the kart. */
  crashDamageSpeed: number;
  crashDamagePerMs: number;
  /** Landings faster than this (m/s) damage the kart. */
  fallDamageSpeed: number;
  fallDamagePerMs: number;
  // ---- ramming characters (authoritative, through the combat lane's applyDamage/knockback) ----
  /** Closing speed (m/s) above which a character is hit (damage + launch). Below it they are shoved. */
  ramMinSpeed: number;
  ramDamageBase: number;
  /** Extra damage per m/s above ramMinSpeed. */
  ramDamagePerMs: number;
  /** Launch speed = closing speed × ramKnockback + 2, upward ramLift + 0.2 × closing speed. */
  ramKnockback: number;
  ramLift: number;
  /** Seconds before the same kart can hit the same character again. */
  ramCooldown: number;
  /** Kart speed lost per character hit (fraction). */
  ramKartSlow: number;
  // ---- damage taken ----
  /** Hitscan damage against the kart body (armor). Riders above the hood take full damage. */
  bulletDamageMult: number;
  blastDamageMult: number;
  explosion: KartExplosionDef;
  // ---- rider ----
  /** Interact within this distance (m, from the kart center) mounts. */
  mountRange: number;
  /** Karts faster than this cannot be mounted. */
  mountMaxSpeed: number;
  hornCooldown: number;
  /** How far (m) bots hear the horn. */
  hornNoise: number;
  /** An empty kart despawns after this many seconds (its terminal re-arms quickly). */
  abandonTime: number;
}

// ---------------------------------------------------------------------------------------------
// RC plane (R1)
// ---------------------------------------------------------------------------------------------

/** Per-class pilot multipliers (the Skyraider "flies it best"). */
export interface PlanePilotMods {
  /** Top, glide and boost speed multiplier. */
  speed: number;
  /** Turn, pitch and roll rate multiplier (tighter circles, snappier climbs). */
  handling: number;
  /** Boost cooldown multiplier (< 1 = more boosts). */
  boostCooldown: number;
}

export interface PlaneGunDef {
  /** Damage per hit at close range (hitscan, lag-compensated like the rifles). */
  damage: number;
  /** Shots per second while Fire is held. */
  fireRate: number;
  /** Cone half-angle (rad) of the deterministic spread pattern. */
  spread: number;
  range: number;
  falloffStart: number;
  falloffEnd: number;
  /** Damage fraction at and beyond falloffEnd. */
  falloffMin: number;
  /** Heat per shot (0..1); at 1 the gun locks until it cools below `overheatResume`. */
  heatPerShot: number;
  /** Heat lost per second while not firing. */
  coolRate: number;
  overheatResume: number;
  /** Muzzle in plane space (x right, y up from the ground point, z toward the back). */
  muzzle: { x: number; y: number; z: number };
  /**
   * Toy gimbal: bullets leave along the nose, turned up to `gimbal` rad toward the pilot's aim point — the camera
   * ray through the aim pivot (aimPivotY above the plane's ground point, the chase camera's pivot) at
   * `convergence` m — so the crosshair tells the truth while the plane is still swinging onto the aim.
   */
  gimbal: number;
  convergence: number;
  aimPivotY: number;
  /** Weapon whose tracer/sound the clients use for `fire` events (content id in WEAPONS). */
  fxWeapon: string;
}

/** The RC plane: a toy radio-control plane a pet rides on top of. Arcade flight, mouse-aim steering. */
export interface PlaneDef {
  id: string;
  kind: 'plane';
  name: string;
  catName: string;
  // ---- body ----
  /** Collision sphere radius (world sweeps; a convex hull in the sim, so it never sinks into big boxes). */
  radius: number;
  /** Sphere center above the landing gear's ground point (EntityState y). */
  gearHeight: number;
  /** Visual wingspan (m) — informative; the hit radius covers it. */
  wingspan: number;
  /** Shots and blasts count within this distance of the fuselage center (a readable, shootable target). */
  hitRadius: number;
  /**
   * Flying into a pet (lead): closing speed above ramMinSpeed (m/s) rams it: ramDamageBase + ramDamagePerMs per m/s
   * above that (enemies only), a launch (ramKnockback × closing, ramLift up), once per target per ramCooldown s. The
   * plane loses ramSlow of its speed and takes ramSelfDamage. Pets never block a plane.
   */
  ram: { minSpeed: number; damageBase: number; damagePerMs: number; knockback: number; lift: number; cooldown: number; slow: number; selfDamage: number };
  /** Rider feet in plane space (x right, y up from the ground point, z toward the back). Like the kart's seat this is
   *  the Drive pose's feet: the pet straddles the fuselage with its rump on the saddle ~0.3 m higher. */
  seat: { x: number; y: number; z: number };
  /** Roll/pitch pivot in plane space (the view rotates the model about it; the seat rides with it). */
  pivotY: number;
  maxHp: number;
  // ---- engine & airspeed (m/s) ----
  /** Throttle spool rate (per second): the engine follows W with a little lag (the prop spins up). */
  throttleRate: number;
  /** Level airspeed at full throttle; with no throttle the plane slows to glideSpeed and sinks. */
  topSpeed: number;
  glideSpeed: number;
  /** Airspeed the air brake (S) slows to. */
  brakeSpeed: number;
  boostSpeed: number;
  /** Dive speed cap. */
  maxSpeed: number;
  /** A flying plane never goes slower than this (it stalls and falls instead of hanging in the air). */
  minAirSpeed: number;
  /** First-order airspeed response (1/s) toward the throttle's target: speeding up, slowing down, braking, boosting. */
  accelRate: number;
  decelRate: number;
  brakeRate: number;
  boostRate: number;
  /** Fraction of gravity along the flight path: climbing costs speed, diving builds it. */
  climbCost: number;
  /** Airspeed lost per second per (rad/s of turn × m/s): tight turns bleed energy. */
  turnDrag: number;
  // ---- lift & stall ----
  /** Sink rate (m/s) with no throttle at glide speed (glide ratio ≈ glideSpeed / glideSink). */
  glideSink: number;
  /** Below stallSpeed lift is gone (full stallSink); full lift from flySpeed up. */
  stallSpeed: number;
  flySpeed: number;
  stallSink: number;
  /** How fast the sink rate follows its target (m/s²). */
  sinkRate: number;
  /** Nose-down pitch a stalled plane falls into until it has flying speed again. */
  stallPitch: number;
  // ---- attitude (rad, rad/s) ----
  maxPitch: number;
  minPitch: number;
  pitchRate: number;
  /** Heading error → yaw rate gain (1/s): the plane chases the camera aim. */
  aimGain: number;
  /** Max yaw rate at full bank. */
  turnRate: number;
  yawAccel: number;
  maxBank: number;
  rollRate: number;
  /** A/D: extra yaw rate and extra bank on top of the aim steering (keyboard/gamepad players). */
  rudderYaw: number;
  rudderRoll: number;
  // ---- boost (Sprint) ----
  boostTime: number;
  /** Seconds from the end of a boost until the next one. */
  boostCooldown: number;
  // ---- ground ----
  groundAccel: number;
  rollFriction: number;
  groundBrake: number;
  taxiTurnRate: number;
  /** Rotate (lift off) at this ground speed unless the pilot aims down; always at autoLiftoff. */
  liftoffSpeed: number;
  autoLiftoff: number;
  /** Climb-out: the nose holds at least this pitch for takeoffAssist seconds after lifting off. */
  takeoffPitch: number;
  takeoffAssist: number;
  /** Rolling over lips up to this height; ground snap distance; steepest surface to roll/land on (rad). */
  stepHeight: number;
  groundSnap: number;
  maxGroundSlope: number;
  // ---- landing & impacts ----
  /** Touchdown slower than this (m/s into the surface), wings nearly level, nose not diving = a landing. */
  landMaxSink: number;
  landMaxRoll: number;
  landMinPitch: number;
  /** Any impact faster than this (m/s into the surface) destroys the plane. */
  crashSpeed: number;
  /** Softer impacts above bumpSpeed cost bumpDamagePerMs hp per m/s and bounce. */
  bumpSpeed: number;
  bumpDamagePerMs: number;
  restitution: number;
  // ---- flight envelope ----
  /** Hard ceiling (world y of the fuselage center); the nose is pushed down over the last `ceilingSoft` m. */
  ceiling: number;
  ceilingSoft: number;
  /** The flight box is the yard (bounds ∩ halfExtent) shrunk by boundsMargin; planes turn home within boundsTurn of it. */
  boundsMargin: number;
  boundsTurn: number;
  // ---- weapon ----
  gun: PlaneGunDef;
  // ---- pilots (content: the Skyraider flies it best) ----
  pilots: Partial<Record<ClassId, PlanePilotMods>>;
  // ---- damage taken ----
  bulletDamageMult: number;
  blastDamageMult: number;
  explosion: KartExplosionDef;
  // ---- rider ----
  mountRange: number;
  mountMaxSpeed: number;
  /** An empty plane despawns after this many seconds. */
  abandonTime: number;
  /** Seconds a rider thrown out of a crashing plane cannot move or act. */
  ejectStun: number;
  /** Launch (m/s up) of a rider thrown out by a crash. */
  ejectLaunch: number;
  /** Voluntary bail-out (E in the air): extra upward speed, share of the plane's velocity kept. */
  bailUp: number;
  bailCarry: number;
}

export type AnyVehicleDef = VehicleDef | PlaneDef;

export const VEHICLE_IDS = ['mower_kart', 'rc_plane'] as const;
export type VehicleId = (typeof VEHICLE_IDS)[number];
export type KartId = 'mower_kart';
export type PlaneId = 'rc_plane';

const NO_PILOT: PlanePilotMods = Object.freeze({ speed: 1, handling: 1, boostCooldown: 1 });

export const VEHICLES: { mower_kart: VehicleDef; rc_plane: PlaneDef } = {
  mower_kart: {
    id: 'mower_kart', kind: 'kart', name: 'Mower Kart', catName: 'Purrmower',
    radius: 0.72, halfHeight: 0.3, border: 0.1,
    seat: { x: 0, y: 0.3, z: 0.18 },
    maxHp: 260,
    topSpeed: 15, boostSpeed: 18, reverseSpeed: 6,
    accel: 12, boostAccel: 20, reverseAccel: 9,
    brakeDecel: 28, coastDecel: 3.2, handbrakeDecel: 2.5, overspeedDecel: 6,
    slopeGravity: 0.55,
    maxYawRate: 2.5, yawAccel: 18, steerFullSpeed: 4.5, understeer: 0.45,
    grip: 14, driftGrip: 5.5, driftDrag: 2, maxGripSlip: 1.2, skidFriction: 7, driftMinSpeed: 7,
    driftYawMult: 1.35, turboCharge: 0.9, turboTime: 0.6,
    boostDuration: 2.6, boostRecharge: 7, boostRechargeDelay: 1.2,
    gravityScale: 1.35, airYawControl: 0.4, airDrag: 0.04, jumpPadMult: 0.85, waterDrag: 0.93,
    wallRestitution: 0.3, wallScrub: 0.3,
    crashDamageSpeed: 11, crashDamagePerMs: 4, fallDamageSpeed: 19, fallDamagePerMs: 3,
    ramMinSpeed: 6, ramDamageBase: 22, ramDamagePerMs: 6, ramKnockback: 0.9, ramLift: 5.5,
    ramCooldown: 0.6, ramKartSlow: 0.15,
    bulletDamageMult: 0.6, blastDamageMult: 1,
    explosion: { radius: 4.5, damage: 45, inner: 1.2, edgeFrac: 0.25, knockback: 11 },
    mountRange: 2.5, mountMaxSpeed: 4, hornCooldown: 0.6, hornNoise: 30, abandonTime: 40,
  },
  // A foam-winged toy RC plane (1.6 m wingspan at pet scale) with a seat on top. Numbers were tuned by flying
  // the lab and the unit-test circuits (docs/handoff/R1.md): cruise 20 m/s (≈ 2× a sprinting corgi), 12.5 m
  // turning circle radius at cruise (≈ 3.9 s per 360°), glide ratio ≈ 6:1 with the engine off, max sustained
  // climb ≈ 7 m/s, stall below 7 m/s.
  rc_plane: {
    id: 'rc_plane', kind: 'plane', name: 'Fetch Flyer', catName: 'Pounce Plane',
    radius: 0.42, gearHeight: 0.42, wingspan: 1.6, hitRadius: 1.0,
    // a cruise-speed (20 m/s) buzz does 48; a boosted dive (30 m/s) 73 — a full-hp Assault survives one
    ram: { minSpeed: 8, damageBase: 18, damagePerMs: 2.5, knockback: 0.45, lift: 6, cooldown: 0.8, slow: 0.3, selfDamage: 12 },
    seat: { x: 0, y: 0.38, z: 0.12 }, pivotY: 0.5,
    maxHp: 140,
    throttleRate: 2.5,
    topSpeed: 20, glideSpeed: 11, brakeSpeed: 8.5, boostSpeed: 27, maxSpeed: 32, minAirSpeed: 5,
    accelRate: 0.9, decelRate: 0.45, brakeRate: 1.4, boostRate: 2.2,
    climbCost: 0.42, turnDrag: 0.06,
    glideSink: 1.8, stallSpeed: 7, flySpeed: 9, stallSink: 8, sinkRate: 7, stallPitch: -0.45,
    maxPitch: 0.6, minPitch: -0.8, pitchRate: 1.5, aimGain: 2.4, turnRate: 1.6, yawAccel: 5,
    maxBank: 1.05, rollRate: 3.5, rudderYaw: 0.8, rudderRoll: 0.4,
    boostTime: 1.3, boostCooldown: 4.5,
    groundAccel: 7.5, rollFriction: 2.5, groundBrake: 10, taxiTurnRate: 1.4,
    liftoffSpeed: 10, autoLiftoff: 13, takeoffPitch: 0.22, takeoffAssist: 1.0,
    stepHeight: 0.22, groundSnap: 0.35, maxGroundSlope: 0.45,
    landMaxSink: 4.5, landMaxRoll: 0.7, landMinPitch: -0.4,
    crashSpeed: 9, bumpSpeed: 3, bumpDamagePerMs: 8, restitution: 0.25,
    ceiling: 34, ceilingSoft: 5, boundsMargin: 5, boundsTurn: 18,
    gun: {
      damage: 6, fireRate: 9, spread: 0.025, range: 65, falloffStart: 20, falloffEnd: 45, falloffMin: 0.5,
      heatPerShot: 0.055, coolRate: 0.45, overheatResume: 0.3, muzzle: { x: 0, y: 0.42, z: -0.8 }, fxWeapon: 'squeaker_rifle',
      gimbal: 0.14, convergence: 40, aimPivotY: 2.4,
    },
    pilots: { skyraider: { speed: 1.15, handling: 1.25, boostCooldown: 0.7 } },
    bulletDamageMult: 0.8, blastDamageMult: 1,
    explosion: { radius: 4.2, damage: 50, inner: 1.2, edgeFrac: 0.25, knockback: 12 },
    mountRange: 2.4, mountMaxSpeed: 2.5, abandonTime: 45,
    ejectStun: 0.8, ejectLaunch: 8, bailUp: 3, bailCarry: 0.6,
  },
};

/** Pilot multipliers for a rider's class (1s for everyone but the specialists). */
export function planePilotMods(def: PlaneDef, cls: ClassId | null | undefined): PlanePilotMods {
  return (cls && def.pilots[cls]) || NO_PILOT;
}

/** Index of a vehicle id in VEHICLE_IDS (the value carried in a vehicle's `EntityState.cls`), -1 if unknown. */
export function vehicleIndex(id: string): number {
  return (VEHICLE_IDS as readonly string[]).indexOf(id);
}

/** Any vehicle definition at a wire index (karts go out as -1: callers fall back to the Mower Kart). */
export function vehicleByIndex(i: number): AnyVehicleDef | null {
  const id = VEHICLE_IDS[i];
  return id ? VEHICLES[id] : null;
}

/** The kart definition at a wire index (-1 / unknown / a plane → null). */
export function kartByIndex(i: number): VehicleDef | null {
  const d = vehicleByIndex(i);
  return d && d.kind === 'kart' ? d : null;
}

/** The plane definition at a wire index, or null. */
export function planeByIndex(i: number): PlaneDef | null {
  const d = vehicleByIndex(i);
  return d && d.kind === 'plane' ? d : null;
}

// ---- plane snapshot aux field (EntityState.ammo): throttle 0..100 % and bank angle in centiradians ----
const ROLL_MAX_CENTI = 499;
/** Pack a plane's throttle (0..1) and roll (rad, + = banked left) into one small integer for `ammo`. */
export function packPlaneAux(throttle: number, roll: number): number {
  const t = Math.round(Math.min(1, Math.max(0, throttle)) * 100);
  const r = Math.round(Math.min(ROLL_MAX_CENTI, Math.max(-ROLL_MAX_CENTI, roll * 100)));
  return t * 1000 + (r + 500);
}
export function unpackPlaneAux(ammo: number): { throttle: number; roll: number } {
  const a = Number.isFinite(ammo) ? Math.max(0, Math.round(ammo)) : 500;
  const t = Math.floor(a / 1000), r = (a % 1000) - 500;
  return { throttle: Math.min(100, t) / 100, roll: r / 100 };
}

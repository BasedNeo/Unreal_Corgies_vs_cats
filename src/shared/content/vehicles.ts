// Vehicles and vehicle terminals as data (theme content). The authoritative vehicle systems in
// src/sim/vehicles read these tables; clients read them for names, chase-camera numbers and the
// kart silhouette size. Units: meters, seconds, radians, hit points, m/s, m/s².
//
// Snapshot conventions (EntityState, see docs/handoff/V1.md):
//   Vehicle  (EntityKind.Vehicle):  cls = index into VEHICLE_IDS · pitch = body pitch (+ = nose up) ·
//            weapon = rider entity id (-1 = empty) · ammo = boost meter 0..100 · hp/maxHp = armor ·
//            flags: Busy = seat taken, Grounded, Sprinting = boosting (meter or mini-turbo),
//            Crouching = drifting (handbrake).
//   Terminal (EntityKind.Terminal): cls = index into TERMINAL_IDS (terminals.ts) · weapon = its active kart id (-1 none) ·
//            ammo = whole seconds of cooldown left · hp/maxHp = cooldown progress (maxHp = cooldown s) ·
//            flags: Busy = unavailable (kart out or cooling down).
//
// The terminal table moved to ./terminals.ts (S1 added the Ordnance Terminal); it is re-exported here so
// existing imports from vehicles.ts keep working.

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

export interface VehicleDef {
  id: string;
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

export const VEHICLE_IDS = ['mower_kart'] as const;
export type VehicleId = (typeof VEHICLE_IDS)[number];

export const VEHICLES: Record<VehicleId, VehicleDef> = {
  mower_kart: {
    id: 'mower_kart', name: 'Mower Kart', catName: 'Purrmower',
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
};

/** Index of a vehicle id in VEHICLE_IDS (the value carried in a vehicle's `EntityState.cls`), -1 if unknown. */
export function vehicleIndex(id: string): number {
  return (VEHICLE_IDS as readonly string[]).indexOf(id);
}

export function vehicleByIndex(i: number): VehicleDef | null {
  const id = VEHICLE_IDS[i];
  return id ? VEHICLES[id] : null;
}

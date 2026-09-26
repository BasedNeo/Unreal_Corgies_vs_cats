// A scripted pilot for the RC plane: produces the same InputCmd a human pilot sends (throttle on W, the
// aim yaw/pitch the plane chases), so it goes through the one authority path. Used by the unit tests, the
// lab's fly-through, and available to bots (e.g. the adventure's chapter 6 squad: Rooftops → shed roof).
//
// Phases: takeoff (full power along the runway heading, nose up) → cruise (toward the goal at a safe height
// over whatever is ahead: WorldData surfaces sampled along the path) → approach (flyover: arrive at the goal
// height; land: a ~7° glide slope with the engine idling) → flare (level the nose just above the ground) →
// rollout (brakes).
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import type { InputCmd } from '../../shared/input';
import { surfaceAt, yawToward } from '../../shared/world/queries';
import { VEHICLES } from '../../shared/content/vehicles';

export interface AutopilotGoal {
  x: number; z: number;
  /** Flyover: the plane's ground-point height over the goal. Land: the touchdown surface height. */
  y: number;
  mode?: 'flyover' | 'land';
  /** Clearance kept over surfaces ahead while cruising (m, default 5). */
  clearance?: number;
  /** Land: the heading to arrive on (a clear strip), else straight in. */
  landYaw?: number;
}

export type AutopilotPhase = 'takeoff' | 'cruise' | 'approach' | 'flare' | 'rollout';
export interface AutopilotState { phase: AutopilotPhase; distance: number; targetY: number }

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

/** Highest surface (props included) along a straight line ahead, sampled every `step` m. */
function highestAhead(sim: Sim, x: number, z: number, tx: number, tz: number, len: number, step = 2.5): number {
  const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz) || 1;
  const n = Math.ceil(Math.min(len, d) / step);
  let hi = -Infinity;
  for (let i = 0; i <= n; i++) {
    const t = (i * step) / d;
    const px = x + dx * t, pz = z + dz * t;
    for (const [ox, oz] of [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) hi = Math.max(hi, surfaceAt(sim.worldData, px + ox, pz + oz).y);
  }
  return hi;
}

/**
 * The next input for a pilot flying `plane` toward `goal`. `seq`/`rt` are left 0 (the caller fills seq).
 * Returns the command and the phase it is in (for tests/labs).
 */
export function planeAutopilot(sim: Sim, plane: SimEntity, goal: AutopilotGoal, out: InputCmd = { seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }): { cmd: InputCmd; state: AutopilotState } {
  const p = plane.plane!;
  const d = VEHICLES[p.id];
  const mode = goal.mode ?? 'flyover';
  const clear = goal.clearance ?? 5;
  const x = plane.pos.x, y = plane.pos.y, z = plane.pos.z;
  const dist = Math.hypot(goal.x - x, goal.z - z);
  out.mx = 0; out.buttons = 0; out.rt = 0;
  let phase: AutopilotPhase;
  let targetY = goal.y;
  if (p.grounded) {
    const landed = mode === 'land' && dist < 60;
    phase = landed ? 'rollout' : 'takeoff';
    out.mz = landed ? -1 : 1;
    out.yaw = wrap(plane.yaw); // hold the runway heading until airborne
    out.pitch = landed ? 0 : 0.3;
    return { cmd: out, state: { phase, distance: dist, targetY } };
  }
  const hdg = yawToward(x, z, goal.x, goal.z);
  // Safe height over what lies ahead (60 m of the path), then the goal's own profile.
  const ahead = highestAhead(sim, x, z, goal.x, goal.z, Math.min(60, dist));
  const cruiseY = Math.max(goal.y, ahead + clear);
  if (mode === 'flyover') {
    phase = dist > 35 ? 'cruise' : 'approach';
    targetY = dist > 35 ? Math.max(cruiseY, goal.y) : Math.max(goal.y, ahead + 1.5);
    out.mz = 1;
    out.yaw = wrap(hdg);
  } else {
    const slope = Math.tan(0.12);
    const glideY = goal.y + dist * slope;
    const agl = y - surfaceAt(sim.worldData, x, z, y + 0.5).y;
    if (dist > 70) { phase = 'cruise'; targetY = Math.max(cruiseY, Math.min(glideY, goal.y + 14)); out.mz = 1; }
    else if (agl > 1.2) { phase = 'approach'; targetY = Math.max(glideY, ahead + 1.0); out.mz = p.speed > d.glideSpeed + 3 ? 0 : 0.35; }
    else { phase = 'flare'; targetY = y; out.mz = 0; }
    out.yaw = wrap(dist > 35 || goal.landYaw === undefined ? hdg : goal.landYaw);
  }
  const err = targetY - y;
  out.pitch = phase === 'flare' ? 0.02 : clamp(Math.atan2(err, 18), -0.45, 0.5);
  return { cmd: out, state: { phase, distance: dist, targetY } };
}

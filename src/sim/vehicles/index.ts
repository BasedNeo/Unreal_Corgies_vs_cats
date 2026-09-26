// OWNER: vehicles lane (V1 kart, R1 RC plane). Vehicle terminals, the Mower Kart and the RC plane, as ordered
// sim systems:
//   150 vehicle-interact · 190 kart-step · 191 plane-step (before character movement at 200) · 560 vehicle-damage
// See docs/handoff/V1.md and docs/handoff/R1.md for the snapshot conventions, events and client wiring.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { unseat } from './common';
import { vehicleRuntime } from './state';

export { vehicleSystems, vehicleInteractSystem, kartStepSystem, vehicleDamageSystem } from './systems';
export {
  spawnKart, spawnTerminal, placeTerminals, placeHangar, mountKart, dismountKart, useTerminal, damageKart, destroyKart,
  findExitSpot, capsuleClear, seatPosition, autoTerminalsFor, autoHangarFor, type KartDamageSource, type VehicleConfig,
} from './systems';
export {
  stepKart, kartInputFrom, newKartState, newKartStepResult, kartForwardSpeed, NO_KART_INPUT,
  type KartInput, type KartContext, type KartStepResult,
} from './kart';
export { findTerminalSite, hangarSite, type TerminalSite } from './sites';
export {
  createKartController, vehicleRuntime, kartTeam, vehicleTeam, kartDef, planeDef, planeShape, VEHICLE_GROUPS, KART_MOVE_FILTER,
  PLANE_GROUPS, PLANE_MOVE_FILTER, type KartState, type TerminalState, type SeatState,
} from './state';
export {
  stepPlane, planeInputFrom, planeHoldInput, newPlaneState, newPlaneStepResult, planeHullPoints, planeFlightBox, planeCenterAt,
  type PlaneState, type PlaneInput, type PlaneContext, type PlaneStepResult,
} from './plane';
export {
  planeStepSystem, spawnPlane, mountPlane, dismountPlane, damagePlane, destroyPlane, planeSeatPosition, planeLocalToWorld,
  planeCenterOf, planeExitSpot, nearestPlane, type PlaneDamageSource,
} from './plane-systems';
export { isStunned, stunCharacter, stunnedUntil } from './common';
export { planeAutopilot, type AutopilotGoal, type AutopilotState } from './pilot';

/**
 * Match restart (Q3 P2-2): every kart and plane leaves quietly (no blast, no credit), riders are unseated where they
 * sit (the restart respawns them), and every terminal is ready at once, so a fresh match starts with a clear yard and
 * nothing from the last one can fly or blow up into it.
 */
export function clearVehicles(sim: Sim): void {
  const rt = vehicleRuntime(sim);
  const gone: SimEntity[] = [];
  for (const v of sim.entities.values()) {
    if (v.terminal) { v.terminal.kart = -1; v.terminal.cooldown = 0; v.terminal.cooldownTotal = 0; }
    if ((v.kart || v.plane) && !v.removed) gone.push(v);
  }
  for (const v of gone) {
    const slot = v.kart ?? v.plane!;
    const rider = slot.rider >= 0 ? sim.entities.get(slot.rider) : undefined;
    unseat(v, rider, sim.tick);
    if (v.collider) rt.byHandle.delete(v.collider.handle);
    sim.removeEntity(v.id);
  }
}

/**
 * The vehicle a character is riding (kart or plane), or null. For objective triggers, e.g. the adventure's
 * `reach` step with `vehicle: true` (docs/handoff/R1.md, "A2 hook").
 */
export function riderVehicle(sim: Sim, e: SimEntity): SimEntity | null {
  if (!e.seat) return null;
  const v = sim.entities.get(e.seat.vehicle);
  return v && (v.kart || v.plane) && !v.removed ? v : null;
}

/** 'kart' | 'plane' for a vehicle entity (null for anything else). */
export function vehicleKindOf(v: SimEntity | null | undefined): 'kart' | 'plane' | null {
  return v?.kart ? 'kart' : v?.plane ? 'plane' : null;
}

/** Is this character piloting a plane that is in the air right now? */
export function isFlyingPlane(sim: Sim, e: SimEntity): boolean {
  const v = riderVehicle(sim, e);
  return !!v?.plane && !v.plane.grounded;
}

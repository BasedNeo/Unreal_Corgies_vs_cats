// OWNER: vehicles lane (V1). Vehicle terminals + the Mower Kart, as ordered sim systems:
//   150 vehicle-interact · 190 kart-step (before character movement at 200) · 560 vehicle-damage
// See docs/handoff/V1.md for the snapshot conventions, events and client wiring.
export { vehicleSystems, vehicleInteractSystem, kartStepSystem, vehicleDamageSystem } from './systems';
export {
  spawnKart, spawnTerminal, placeTerminals, mountKart, dismountKart, useTerminal, damageKart, destroyKart,
  findExitSpot, capsuleClear, seatPosition, type KartDamageSource, type VehicleConfig,
} from './systems';
export {
  stepKart, kartInputFrom, newKartState, newKartStepResult, kartForwardSpeed, NO_KART_INPUT,
  type KartInput, type KartContext, type KartStepResult,
} from './kart';
export { findTerminalSite, type TerminalSite } from './sites';
export {
  createKartController, vehicleRuntime, kartTeam, kartDef, VEHICLE_GROUPS, KART_MOVE_FILTER,
  type KartState, type TerminalState, type SeatState,
} from './state';

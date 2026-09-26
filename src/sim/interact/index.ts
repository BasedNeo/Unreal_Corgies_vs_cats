// OWNER: interaction lane (S1). Ordnance Terminals (in-place kit swaps), Upgrade Cores (timed buffs),
// Golden Kibble collectibles and the objective chain, as one ordered sim system (150). Content:
// src/shared/content/{terminals,pickups,objectives}.ts. Handoff: docs/handoff/S1.md.
export { interactSystems, interactSystem, interactEnabledFor } from './systems';
export { trySwapKit, swapKit, ordnanceTerminalFor, placeOrdnanceTerminals, spawnOrdnanceTerminal, type KitSwapResult } from './ordnance';
export { findOrdnanceSite, kartKeepOut, type OrdnanceSite, type KeepOut } from './sites';
export {
  touchesPickup, canCollect, collectPickup, spawnPickupSpot, placePickups, stepPickups, scheduleCores, resetPickups, rollCore,
} from './pickups';
export { grantBuff, clearBuffs, suspendBuffs, resumeBuffs, stepBuffs, buffMultiplier, buffTimeLeft } from './buffs';
export {
  objectiveState, takeObjectiveScore, foldObjectiveText, initObjectives, resetObjectives, stepObjectives, type ObjectiveState,
} from './objectives';
export {
  interactRuntime, interactConfig, creditRoster, drainRosterCredits,
  type InteractConfig, type InteractRuntime, type PickupState, type ActiveBuff, type RosterCredit,
} from './state';

// Default ordered system list for a game simulation.
import type { SimSystem } from '../sim';
import { movementSystem } from './movement';
import { physicsStepSystem, killPlaneSystem } from './core';
import { combatSystems } from '../combat';
import { aiSystems } from '../ai';
import { matchSystems } from '../match';
import { worldSystems } from '../world/systems';
import { bossSystems } from '../boss';
import { vehicleSystems } from '../vehicles';
import { interactSystems } from '../interact';
import { emoteSystem } from './emote';
import { destructSnapshot, destructSystems, restoreDestructSnapshot } from '../destruct';
import { adventureSystems, registerCheckpointHook } from '../adventure';

// A1 × X1: an adventure checkpoint also stores which props were broken; a squad wipe stands the later ones back up.
registerCheckpointHook('destruct', { save: destructSnapshot, restore: (sim, ids) => restoreDestructSnapshot(sim, ids as string[]) });

export function createDefaultSystems(): SimSystem[] {
  return [...aiSystems(), movementSystem, ...worldSystems(), physicsStepSystem, ...combatSystems(), ...destructSystems(), killPlaneSystem, ...matchSystems(), ...bossSystems(), ...vehicleSystems(), ...interactSystems(), emoteSystem, ...adventureSystems()];
}

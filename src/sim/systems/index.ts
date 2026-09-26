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

export function createDefaultSystems(): SimSystem[] {
  return [...aiSystems(), movementSystem, ...worldSystems(), physicsStepSystem, ...combatSystems(), killPlaneSystem, ...matchSystems(), ...bossSystems(), ...vehicleSystems(), ...interactSystems(), emoteSystem];
}

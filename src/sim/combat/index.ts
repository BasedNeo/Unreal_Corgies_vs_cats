// OWNER: combat lane. Weapons, abilities, projectiles, damage/death/respawn and lag-compensation
// history, as ordered sim systems:
//   400 weapons · 450 abilities · 500 projectiles · 600 status (corpses, timers) · 700 respawn/regen
//   850 lag-comp history record (after match placement at 800, so it stores what snapshots carry)
//   455 ordnance (W9 X4: throws, flight, kiosk restock) · 805 ordnance-life (spawn with one, death, restart, flag)
import type { SimSystem } from '../sim';
import { weaponSystem } from './weapon-system';
import { abilitySystem } from './abilities';
import { projectileSystem } from './projectiles';
import { statusSystem, respawnSystem } from './lifecycle';
import { lagRecordSystem } from './lagcomp';
import { ordnanceSystem, ordnanceLifecycleSystem } from './ordnance';

export { applyDamage, kill, respawnNow, knockback } from './damage';
export { equipWeapon, ensureCombat, eyeHeight, characterHeight, capsuleOf, combatBus, combatLive, isStealthed, isInvulnerable } from './state';
export type { MatchRules, CombatBus, KillRecord, NoiseRecord, WeaponState } from './state';
export { rayCapsule, worldRay, worldLineClear } from './geometry';
export { spawnProjectile, explode } from './projectiles';
export { tryThrow, liveOrdnance, ordnanceStats, ordnanceBlastOf, ordnanceEnabled, ordnanceEligible, ordnanceArcWorld, type OrdnanceCarry, type OrdnanceProj, type OrdnanceConfig, type ThrowResult } from './ordnance';

export function combatSystems(): SimSystem[] {
  return [weaponSystem, abilitySystem, ordnanceSystem, projectileSystem, statusSystem, respawnSystem, ordnanceLifecycleSystem, lagRecordSystem];
}

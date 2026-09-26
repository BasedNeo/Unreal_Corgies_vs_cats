// Ordnance Terminals: a solid kiosk per team base that swaps a character's class kit IN PLACE.
// The client opens a class picker when its player presses Interact next to its own team's kiosk and sends
// a normal `{t:'class'}` message; the Room calls `trySwapKit()` and only falls back to the old respawn
// path when the player is not at a kiosk. The swap keeps position, velocity and the health FRACTION, and
// swaps weapon (fresh magazine), ability, move stats and max hp; buffs are re-applied on top.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, CLASS_IDS, EFlag, EntityKind, Team, type ClassId, type TeamId } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import { hash2 } from '../../shared/rng';
import { quatYXZ } from '../../shared/world/queries';
import { TERMINALS, terminalIndex } from '../../shared/content/terminals';
import { CLASSES, moveStatsFor } from '../../shared/content/classes';
import { WEAPONS, type WeaponId } from '../../shared/content/weapons';
import { abilityDef } from '../../shared/content/abilities';
import { WORLD_GROUPS } from '../rapier';
import { ensureCombat, equipWeapon } from '../combat';
import { setNavFixture } from '../ai/nav';
import { resumeBuffs, suspendBuffs } from './buffs';
import { findOrdnanceSite, kartKeepOut, type KeepOut, type OrdnanceSite } from './sites';
import { ticksOf } from './state';

const DEF = TERMINALS.ordnance_terminal;

/** Place a solid Ordnance Terminal kiosk (a world fixture: never removed). */
export function spawnOrdnanceTerminal(sim: Sim, site: OrdnanceSite): SimEntity {
  const id = sim.allocId();
  const e: SimEntity = {
    id, kind: EntityKind.Terminal, team: site.team, species: 0,
    // Sim.toState() writes CLASS_IDS.indexOf(cls) into EntityState.cls: this makes it the TERMINAL_IDS index.
    cls: CLASS_IDS[terminalIndex('ordnance_terminal')] ?? null,
    seed: Math.floor(hash2(id, site.team, sim.seed) * 1e9), name: DEF.name,
    pos: { x: site.x, y: site.y, z: site.z }, vel: { x: 0, y: 0, z: 0 }, yaw: site.yaw, pitch: 0, collider: null,
    input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null, health: null,
    anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
    ownerPid: null, removed: false, data: {}, ordnance: { id: 'ordnance_terminal' },
  };
  const q = quatYXZ(0, site.yaw, 0);
  e.collider = sim.world.createCollider(
    sim.R.ColliderDesc.cuboid(DEF.hx, DEF.hy, DEF.hz).setTranslation(site.x, site.y + DEF.hy, site.z).setRotation(q).setCollisionGroups(WORLD_GROUPS),
  );
  (e.collider as unknown as { __entityId: number }).__entityId = id;
  sim.entities.set(id, e);
  // bots walk around it: this sim's nav only (the shared grid is the static world, D1)
  setNavFixture(sim, `terminal:${id}`, [{ type: 'terminal', x: site.x, y: site.y + DEF.hy, z: site.z, hx: DEF.hx, hy: DEF.hy, hz: DEF.hz, rotY: site.yaw }]);
  return e;
}

/** Place both teams' kiosks from the world data (clear of the Kart-O-Matics and of `avoid`). */
export function placeOrdnanceTerminals(sim: Sim, avoid: readonly KeepOut[] = []): SimEntity[] {
  const out: SimEntity[] = [];
  for (const team of [Team.Corgis, Team.Cats] as TeamId[]) {
    const site = findOrdnanceSite(sim.worldData, team, [...avoid, ...kartKeepOut(sim.worldData, team)]);
    if (site) out.push(spawnOrdnanceTerminal(sim, site));
  }
  return out;
}

/** Is this character standing at one of its own team's Ordnance Terminals? Returns the kiosk. */
export function ordnanceTerminalFor(sim: Sim, c: SimEntity): SimEntity | null {
  let best: SimEntity | null = null, bd = Infinity;
  for (const t of sim.entities.values()) {
    if (!t.ordnance || t.team !== c.team) continue;
    if (Math.abs(c.pos.y - t.pos.y) > DEF.maxDy) continue;
    const d = Math.hypot(c.pos.x - t.pos.x, c.pos.z - t.pos.z);
    if (d <= DEF.useRange && d < bd) { bd = d; best = t; }
  }
  return best;
}

export type KitSwapResult = 'swapped' | 'cooldown' | 'out_of_range';

/**
 * Authority: swap `c`'s kit to `cls` in place when it stands at its own team's Ordnance Terminal.
 * 'out_of_range' (not at a kiosk, dead, seated in a vehicle, not a character) → the caller uses its normal
 * path (the Room respawns the player as the new class). 'cooldown' → ignore (swapped < 1 s ago).
 */
export function trySwapKit(sim: Sim, c: SimEntity, cls: ClassId): KitSwapResult {
  if (!c.char || !c.health || c.dead || c.removed || c.flags & EFlag.Mounted || !(CLASS_IDS as readonly string[]).includes(cls)) return 'out_of_range';
  if (!DEF.kits.includes(cls)) return 'out_of_range';
  const term = ordnanceTerminalFor(sim, c);
  if (!term) return 'out_of_range';
  if ((c.kitSwapReady ?? -Infinity) > sim.tick) return 'cooldown';
  swapKit(c, cls);
  c.kitSwapReady = sim.tick + ticksOf(DEF.swapCooldown);
  // Presentation: the kiosk "vends" (ability event on the TERMINAL's id, so the HUD's class-ability
  // cooldown ring — which watches ability events with id === local player — is not triggered).
  sim.emit({ e: 'ability', id: term.id, ability: 'kit_swap', x: c.pos.x, y: c.pos.y, z: c.pos.z });
  return 'swapped';
}

/** Rebuild a character's kit for a class, keeping pose, velocity, health fraction and buffs. */
export function swapKit(c: SimEntity, cls: ClassId): void {
  ensureCombat(c);
  const h = c.health!;
  const frac = h.max > 0 ? h.hp / h.max : 1;
  suspendBuffs(c);
  const def = CLASSES[cls];
  c.cls = cls;
  const oldMove = c.char!.move;
  const move = moveStatsFor(c.species, cls);
  // The capsule depends on the species only; keep the live collider as is.
  move.capsuleRadius = oldMove.capsuleRadius;
  move.capsuleHalfHeight = oldMove.capsuleHalfHeight;
  c.char!.move = move;
  h.max = def.maxHp;
  equipWeapon(c, (def.primary in WEAPONS ? def.primary : 'squeaker_rifle') as WeaponId);
  // Ability: carry the remaining cooldown over (capped at the new ability's), so swapping is never a reset.
  const prevCd = c.abil?.cooldown ?? 0;
  const nd = abilityDef(def.ability);
  c.abil = { id: def.ability, cooldown: Math.min(prevCd, nd?.cooldown ?? prevCd) };
  c.flags &= ~EFlag.Reloading;
  resumeBuffs(c);
  h.hp = Math.max(1, Math.min(h.max, Math.round(frac * h.max)));
}

// A2: the chapter's world pieces beyond cats and items — the squad pups' kits (ChapterDef.pups), vehicles parked for a
// step (ChapterStep.vehicles: the Garage Job's getaway Mower Kart) and barricades raised when a step completes
// (ChapterStep.raise: the Porch Siege). Everything goes through existing entities and snapshot fields:
//   · a barricade IS a Squeak Barrier (EntityKind.Ability, cls = the squeak_barrier index, hp, yaw): C2's collider
//     groups (both teams walk into it, the other team's shots stop on it, the squad shoots through it), C2's view and
//     the predictor's barrier mirror, just with BARRICADE_HP and a lifetime that outlasts the chapter (combat going
//     un-live at the chapter's end clears it, like every ability entity);
//   · a vehicle is V1's kart (spawnKart), team Corgis.
// Deterministic: no randomness here; spots are chapter data.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { EntityKind, Team, type ClassId, type EntityId } from '../../shared/types';
import { ABILITIES } from '../../shared/content/abilities';
import { BARRICADE_HP, VEHICLE_REPARK_SECONDS, type ChapterBarricade, type ChapterDef, type ChapterVehicle } from '../../shared/content/chapters';
import { TICK_HZ } from '../../shared/constants';
import { surfaceAt } from '../../shared/world/queries';
import { attachCollider, barrierExtents, BARRIER_GROUPS, removeAbilityEntity, spawnAbilityEntity } from '../combat/ability-core';
import { swapKit } from '../interact';
import { spawnKart, dismountKart, vehicleRuntime } from '../vehicles';
import { isSquad, type AdventureRuntime, type AdventureState } from './state';

// ---------------------------------------------------------------------------------------------- pups' kits
/** Squad pups (room bots) by id: their rank picks the kit in ChapterDef.pups. */
function pupRank(sim: Sim, e: SimEntity): number {
  let k = 0;
  for (const o of sim.entities.values()) if (isSquad(o) && o.kind === EntityKind.Bot && o.id < e.id) k++;
  return k;
}

/** Give a squad pup the chapter's kit for its rank (ChapterDef.pups; no-op without it). Its brain restarts for the kit. */
export function kitPup(sim: Sim, rt: AdventureRuntime, def: ChapterDef, e: SimEntity): void {
  if (!def.pups?.length || e.kind !== EntityKind.Bot || !isSquad(e) || rt.kitted.has(e.id)) return;
  rt.kitted.add(e.id);
  const cls: ClassId = def.pups[pupRank(sim, e) % def.pups.length];
  if (e.cls === cls) return;
  swapKit(e, cls);
  if (e.health) e.health.hp = e.health.max;
  e.ai = undefined; // ensureBrain builds the kit's profile (archetypeForClass) on the AI's next tick
}

/** Every squad pup gets its kit (a chapter load). */
export function kitPups(sim: Sim, rt: AdventureRuntime, def: ChapterDef): void {
  rt.kitted.clear();
  if (!def.pups?.length) return;
  const pups = [...sim.entities.values()].filter((e) => e.kind === EntityKind.Bot && isSquad(e)).sort((a, b) => a.id - b.id);
  for (const e of pups) kitPup(sim, rt, def, e);
}

// ---------------------------------------------------------------------------------------------- vehicles
function parkVehicle(sim: Sim, spec: ChapterVehicle): SimEntity {
  const y = surfaceAt(sim.worldData, spec.x, spec.z, sim.worldData.height(spec.x, spec.z) + 1.5).y;
  return spawnKart(sim, spec.vehicle, Team.Corgis, spec.x, y + 0.02, spec.z, spec.yaw);
}

/** Remove a chapter vehicle (its rider hops out first, or is unseated by the vehicle system next tick). */
function removeVehicle(sim: Sim, id: EntityId): void {
  const v = sim.entities.get(id);
  if (!v) return;
  const rider = v.kart && v.kart.rider >= 0 ? sim.entities.get(v.kart.rider) : undefined;
  if (rider && v.kart) dismountKart(sim, v, rider);
  if (v.collider) vehicleRuntime(sim).byHandle.delete(v.collider.handle);
  sim.removeEntity(id);
}

/** Park the vehicles a step brings (its `vehicles`). */
export function parkStepVehicles(sim: Sim, rt: AdventureRuntime, step: number, specs: readonly ChapterVehicle[] | undefined): void {
  for (const spec of specs ?? []) rt.vehicles.push({ step, spec, id: parkVehicle(sim, spec).id, goneTick: -1 });
}

/** Remove every chapter vehicle (chapter load, checkpoint restart). */
export function clearVehicles(sim: Sim, rt: AdventureRuntime): void {
  for (const v of rt.vehicles) removeVehicle(sim, v.id);
  rt.vehicles.length = 0;
}

/** A vehicle a live step still needs came to grief (wrecked, abandoned): park a fresh one after a short beat. */
export function reparkVehicles(sim: Sim, rt: AdventureRuntime, st: AdventureState): void {
  for (const v of rt.vehicles) {
    if (v.step > st.step) continue;
    const e = sim.entities.get(v.id);
    if (e && !e.removed) { v.goneTick = -1; continue; }
    if (v.goneTick < 0) { v.goneTick = sim.tick; continue; }
    if (sim.tick - v.goneTick < VEHICLE_REPARK_SECONDS * TICK_HZ) continue;
    let blocked = false;
    for (const o of sim.entities.values()) {
      if ((o.char || o.kind === EntityKind.Vehicle) && !o.removed && Math.hypot(o.pos.x - v.spec.x, o.pos.z - v.spec.z) < (o.char ? 2 : 3.2)) { blocked = true; break; }
    }
    if (blocked) continue;
    v.id = parkVehicle(sim, v.spec).id;
    v.goneTick = -1;
  }
}

// ---------------------------------------------------------------------------------------------- barricades
/** Push characters out of a new wall's box, to the side they are on (its back, the squad's side, when centered). */
function pushOut(sim: Sim, x: number, y: number, z: number, yaw: number, hw: number, ht: number): void {
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  for (const c of sim.entities.values()) {
    if (!c.char || c.dead || c.removed || c.pos.y > y + 3 || c.pos.y < y - 2) continue;
    const r = c.char.move.capsuleRadius + 0.08;
    const dx = c.pos.x - x, dz = c.pos.z - z;
    const lx = dx * rx + dz * rz, lz = dx * fx + dz * fz;
    if (Math.abs(lx) >= hw + r || Math.abs(lz) >= ht + r) continue;
    const side = lz > 0.05 ? 1 : -1; // in front stays in front; on the line or behind goes behind
    const d = side * (ht + r + 0.12);
    sim.placeCharacter(c, x + rx * lx + fx * d, c.pos.y + 0.02, z + rz * lx + fz * d);
  }
}

/** Raise one barricade wall at a spot: a Squeak Barrier that stays up (BARRICADE_HP) owned by `owner`. */
export function raiseBarricade(sim: Sim, rt: AdventureRuntime, owner: SimEntity, spot: ChapterBarricade): SimEntity {
  const def = ABILITIES.squeak_barrier;
  const y = surfaceAt(sim.worldData, spot.x, spot.z, sim.worldData.height(spot.x, spot.z) + 1.2).y;
  const ext = barrierExtents(def.range);
  pushOut(sim, spot.x, y, spot.z, spot.yaw, ext.hw, ext.ht);
  const e = spawnAbilityEntity(sim, owner, def, 'barrier', spot.x, y, spot.z, spot.yaw, BARRICADE_HP);
  const a = e.abx!;
  a.team = Team.Corgis; e.team = Team.Corgis;
  a.until = sim.tick + 3600 * TICK_HZ; // outlasts any chapter (the chapter's end clears it)
  a.hw = ext.hw; a.hh = ext.hh; a.ht = ext.ht; a.cy = y + ext.lift;
  attachCollider(sim, e, sim.R.ColliderDesc.cuboid(ext.hw, ext.hh, ext.ht)
    .setTranslation(spot.x, a.cy, spot.z)
    .setRotation({ x: 0, y: Math.sin(spot.yaw / 2), z: 0, w: Math.cos(spot.yaw / 2) })
    .setCollisionGroups(BARRIER_GROUPS));
  e.ammo = Math.ceil((a.until - sim.tick) / TICK_HZ);
  // presentation: the wall pops up (FX, squeak) — on the WALL's id, like X1's kiosk vend, so the owner's HUD doesn't
  // start its own Squeak Barrier cooldown ring and its avatar doesn't voice an ability it didn't use
  sim.emit({ e: 'ability', id: e.id, ability: def.id, x: spot.x, y, z: spot.z });
  rt.barricades.push({ spot, id: e.id });
  return e;
}

/** Barricades still standing (their spots, for a checkpoint). */
export function standingBarricades(sim: Sim, rt: AdventureRuntime): ChapterBarricade[] {
  return rt.barricades.filter((b) => { const e = sim.entities.get(b.id); return !!e && !e.removed; }).map((b) => b.spot);
}

/** Remove every barricade (silently: a restart or a new chapter). */
export function clearBarricades(sim: Sim, rt: AdventureRuntime): void {
  for (const b of rt.barricades) {
    const e = sim.entities.get(b.id);
    if (e && !e.removed) removeAbilityEntity(sim, e, null);
  }
  rt.barricades.length = 0;
}

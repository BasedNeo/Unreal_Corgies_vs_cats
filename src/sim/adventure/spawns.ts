// Chapter spawns: cats (AI archetypes, bosses or lane-registered spawners), stealth sentries with their pacing loop,
// and collect items. Deterministic: positions jitter from the adventure's private stream, snapped to the nav grid.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, EntityKind, Species, Team, type EntityId } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import { ADVENTURE_ITEM_SEED, adventureItemIndex } from '../../shared/content/chapters';
import { bossIndex } from '../../shared/content/bosses';
import { surfaceAt } from '../../shared/world/queries';
import { yawToward } from '../../shared/world/queries';
import { ensureCombat } from '../combat/state';
import { applyArchetype, simNavGrid } from '../ai';
import { ARCHETYPES, type ArchetypeId } from '../ai/archetypes';
import { cellX, cellZ, lineWalkable, nearestWalkable, type NavGrid } from '../ai/nav';
import { spawnBoss, isBoss, bossDef } from '../boss';
import type { AdventureRuntime } from './state';

/** A lane-provided spawner (e.g. E1's sniper elite): returns the spawned entity (it becomes a chapter cat). */
export type AdventureSpawner = (sim: Sim, at: { x: number; y: number; z: number; yaw: number }, n: number) => SimEntity | null;
const spawners = new Map<string, AdventureSpawner>();

/** Let a chapter spawn `id` through `fn` (checked before AI archetypes and BOSSES ids). */
export function registerAdventureSpawner(id: string, fn: AdventureSpawner): void {
  spawners.set(id, fn);
}

/** Can a chapter spawn this archetype string? (data validation) */
export function knownAdventureArchetype(id: string): boolean {
  return spawners.has(id) || id in ARCHETYPES || bossIndex(id) >= 0;
}

/** Sentry pacing: loop waypoints this far from the post (m); the dwell at each is SENTRY_DWELL (state.ts). */
export const SENTRY_REACH = 5;

function snap(g: NavGrid | null, x: number, z: number, r: number): { x: number; z: number } | null {
  if (!g) return { x, z };
  const c = nearestWalkable(g, x, z, r);
  return c >= 0 ? { x: cellX(g, c), z: cellZ(g, c) } : null;
}

/** A small loop around a sentry post: the post plus up to two walkable points ~5 m out (straight-line walkable). */
export function sentryRoute(sim: Sim, rng: () => number, x: number, z: number): number[] {
  const g = simNavGrid(sim);
  const route = [x, z];
  if (!g) return route;
  const a0 = rng() * Math.PI * 2;
  for (const k of [0, 1]) {
    const a = a0 + k * 2.3;
    const c = nearestWalkable(g, x + Math.cos(a) * SENTRY_REACH, z + Math.sin(a) * SENTRY_REACH, 2);
    if (c < 0) continue;
    const wx = cellX(g, c), wz = cellZ(g, c);
    if (Math.hypot(wx - x, wz - z) > 2 && lineWalkable(g, x, z, wx, wz)) route.push(wx, wz);
  }
  return route;
}

export interface SpawnSpec {
  arch: string;
  x: number; z: number;
  tag: string;
  step: number;
  /** Jitter radius (m) around (x, z); 0 = exactly there (checkpoint restores). */
  jitter: number;
  /** Sentry: pace this route (null = derive one around the spawn point). */
  sentry?: boolean;
  route?: number[];
  /** Face this point (default: the squad's rally point). */
  faceX?: number; faceZ?: number;
  yaw?: number;
  y?: number;
  /** A boss at its own default spot (spawnBoss without a position). */
  auto?: boolean;
}

/** Spawn one chapter cat; registers it in the runtime. Null when the archetype is unknown or there is no ground. */
export function spawnChapterCat(sim: Sim, rt: AdventureRuntime, s: SpawnSpec, n: number): SimEntity | null {
  const g = simNavGrid(sim);
  let x = s.x, z = s.z;
  if (s.jitter > 0) {
    const p = snap(g, s.x + (rt.rng() - 0.5) * 2 * s.jitter, s.z + (rt.rng() - 0.5) * 2 * s.jitter, 4) ?? snap(g, s.x, s.z, 6);
    if (!p) return null;
    x = p.x; z = p.z;
  }
  const y = s.y ?? surfaceAt(sim.worldData, x, z, sim.worldData.height(x, z) + 2).y + 0.05;
  const yaw = s.yaw ?? (s.sentry ? rt.rng() * Math.PI * 2 - Math.PI : yawToward(x, z, s.faceX ?? x, s.faceZ ?? z - 1));
  let e: SimEntity | null = null;
  let boss: string | undefined;
  const custom = spawners.get(s.arch);
  if (custom) e = custom(sim, { x, y, z, yaw }, n);
  else if (s.arch in ARCHETYPES) {
    const A = ARCHETYPES[s.arch as ArchetypeId];
    e = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Cats, species: Species.Cat, cls: A.cls, name: `${A.label} ${n}`, x, y, z, yaw });
    ensureCombat(e);
    e.combat!.pve = true;
    applyArchetype(e, s.arch as ArchetypeId);
  } else if (bossIndex(s.arch) >= 0) {
    e = spawnBoss(sim, s.auto ? undefined : { x, z, yaw }, { boss: s.arch });
    boss = s.arch;
  }
  if (!e) return null;
  if (!boss && isBoss(e)) boss = bossDef(e.boss).id;
  ensureCombat(e);
  e.combat!.pve = true; // chapter cats never respawn; the combat lane removes their corpses
  e.adv = { tag: s.tag, step: s.step };
  if (s.sentry) e.adv.sentry = { route: s.route ?? sentryRoute(sim, rt.rng, x, z), i: 0, until: 0 };
  rt.enemies.set(e.id, { arch: s.arch, tag: s.tag, step: s.step, counted: false, boss });
  return e;
}

/**
 * A collect item at a spot (EntityKind.Prop snapshot convention: src/shared/content/chapters.ts), on the highest
 * surface up to `top` (default: 2 m over the ground; A2 passes a roof's height for the last tennis ball).
 */
export function spawnItem(sim: Sim, rt: AdventureRuntime, item: string, spot: number, x: number, z: number, top?: number): SimEntity {
  const id: EntityId = sim.allocId();
  const y = surfaceAt(sim.worldData, x, z, top ?? sim.worldData.height(x, z) + 2).y + 0.45;
  const e: SimEntity = {
    id, kind: EntityKind.Prop, team: Team.Neutral, species: 0, cls: null, seed: ADVENTURE_ITEM_SEED, name: item,
    pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, yaw: rt.rng() * Math.PI * 2, pitch: 0, collider: null,
    input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null, health: null,
    anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: adventureItemIndex(item), ammo: 0,
    ownerPid: null, removed: false, data: {}, advItem: { item, spot },
  };
  sim.entities.set(id, e);
  rt.items.push(id);
  return e;
}

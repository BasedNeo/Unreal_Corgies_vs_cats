// X1 destructibles on the real West Yard: the Garage breach wall (Dig Charge -> a doorway a corgi walks through, and
// nav paths through), tuna-can and crate stacks (mortar blasts and rifle fire), walls shrug off rifles, resets
// (API + match restart, characters pushed out), the client-prediction mirror, determinism, and the data placement
// (clear of props, pickups, spawns, routes). Systems are listed explicitly (the parts X1 touches) so other lanes'
// in-flight AI/boss/adventure edits cannot make these flaky; createDefaultSystems() adds the same system.
import { describe, it, expect, beforeAll } from 'vitest';
import type { Collider } from '@dimforge/rapier3d-compat';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { movementSystem, stepCharacter } from '../../src/sim/systems/movement';
import { physicsStepSystem, killPlaneSystem } from '../../src/sim/systems/core';
import { combatSystems, eyeHeight, explode, worldLineClear } from '../../src/sim/combat';
import { worldSystems } from '../../src/sim/world/systems';
import {
  breakDestructibles, destructibleCount, destructibles, destructiblesByTag, destructSnapshot, destructSystems, drainBreaks,
  mirrorDestructibles, resetDestructibles, restoreDestructSnapshot,
} from '../../src/sim/destruct';
import { findPath, isWalkable, lineWalkable, navBlockerStats, navGridFor, setNavBlocker, type NavGrid } from '../../src/sim/ai/nav';
import { Btn } from '../../src/shared/input';
import { EFlag, EntityKind, Species, Team, type ClassId, type TeamId } from '../../src/shared/types';
import { packEntity, unpackEntity, type EntityState, type GameEvent, type MatchState } from '../../src/shared/protocol';
import { WEAPONS, weaponIndex } from '../../src/shared/content/weapons';
import { PICKUP_LAYOUTS } from '../../src/shared/content/pickups';
import { createWorldData, type WorldData } from '../../src/shared/world/world-data';
import { occupiedAt, surfaceAt, districtAt } from '../../src/shared/world/queries';
import { DESTRUCT_KINDS, boxAabb, crateStack, destructDistance } from '../../src/shared/world/destructibles';
import { GARAGE, GARAGE_BREACH, GARAGE_DOORS, ROOF_ROUTES } from '../../src/shared/world/garage';
import { mountKart, spawnKart, vehicleSystems } from '../../src/sim/vehicles';
import { TICK_HZ } from '../../src/shared/constants';

const systems = () => [movementSystem, ...worldSystems(), physicsStepSystem, ...combatSystems(), killPlaneSystem, ...destructSystems()];
const BREACH_Z = (GARAGE_BREACH.z0 + GARAGE_BREACH.z1) / 2;      // -65.5
const ALLEY_X = 97, INSIDE_X = 89;

let data: WorldData;
beforeAll(() => { data = createWorldData(1); });

async function yard(): Promise<Sim> {
  const sim = await Sim.create({ seed: 1, systems: systems() });
  sim.step();
  sim.drainEvents();
  return sim;
}

function spawn(sim: Sim, team: TeamId, cls: ClassId, x: number, z: number, yaw = 0): SimEntity {
  const y = surfaceAt(sim.worldData, x, z, 3).y + 0.05;
  return sim.spawnCharacter({ team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: `t${sim.entities.size}`, x, y, z, yaw });
}

let seq = 1;
type Ev = GameEvent & { tick: number };
/** Hold an input for `seconds` (buttons pressed every tick unless `tap`). Returns the events. */
function hold(sim: Sim, e: SimEntity, seconds: number, o: { mz?: number; yaw?: number; pitch?: number; buttons?: number; tap?: boolean } = {}, out: Ev[] = []): Ev[] {
  const n = Math.round(seconds * TICK_HZ);
  for (let i = 0; i < n; i++) {
    const buttons = o.tap && i > 0 ? 0 : o.buttons ?? 0;
    sim.setInput(e.id, { seq: seq++, mx: 0, mz: o.mz ?? 0, yaw: o.yaw ?? e.yaw, pitch: o.pitch ?? 0, buttons, rt: 0 });
    sim.step();
    for (const ev of sim.drainEvents()) out.push({ ...ev, tick: sim.tick } as Ev);
  }
  return out;
}

function aimAt(e: SimEntity, x: number, y: number, z: number): { yaw: number; pitch: number } {
  const ex = e.pos.x, ey = e.pos.y + eyeHeight(e), ez = e.pos.z;
  const dx = x - ex, dy = y - ey, dz = z - ez;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

const wallOf = (sim: Sim) => destructiblesByTag(sim, 'garage_breach_wall')[0];
const byId = (sim: Sim, id: string) => destructibles(sim).find((e) => e.dsx!.def.id === id)!;
const WEST = Math.PI / 2, EAST = -Math.PI / 2;
const breaks = (evs: Ev[]) => evs.filter((e): e is Extract<GameEvent, { e: 'ability' }> & { tick: number } => e.e === 'ability' && e.ability.startsWith('destruct:'));

describe('X1 destructibles: data', () => {
  it('the breach wall fills the gap in the garage east wall; 4 tuna stacks inside, 3 crate stacks in the yard', () => {
    const ds = data.destructibles!;
    expect(ds.map((d) => d.tag)).toEqual(['garage_breach_wall', 'tuna_stack', 'tuna_stack', 'tuna_stack', 'tuna_stack', 'crate_stack', 'crate_stack', 'crate_stack']);
    expect(new Set(ds.map((d) => d.id)).size).toBe(ds.length);
    const wall = ds[0];
    expect(wall.kind).toBe('wall_boards');
    expect(wall.boxes).toHaveLength(1);
    const a = boxAabb(wall.boxes[0]);
    expect(a.x0).toBeCloseTo(GARAGE_BREACH.x0, 3); expect(a.x1).toBeCloseTo(GARAGE_BREACH.x1, 3);
    expect(a.z0).toBeCloseTo(GARAGE_BREACH.z0, 3); expect(a.z1).toBeCloseTo(GARAGE_BREACH.z1, 3);
    expect(a.y1).toBeCloseTo(GARAGE_BREACH.top, 3);
    // the static wall has a real gap there (only the lintel above it) and closes right beside it
    for (const y of [0.6, 2, 4]) for (const z of [BREACH_Z - 2.5, BREACH_Z, BREACH_Z + 2.5]) expect(occupiedAt(data, 93.7, y, z), `gap ${y},${z}`).toBe(false);
    expect(occupiedAt(data, 93.7, 5, BREACH_Z)).toBe(true);                    // lintel
    expect(occupiedAt(data, 93.7, 2, GARAGE_BREACH.z0 - 0.3)).toBe(true);      // wall beside it
    expect(occupiedAt(data, 93.7, 2, GARAGE_BREACH.z1 + 0.3)).toBe(true);
    for (const d of ds) {
      expect(d.prims.length).toBeGreaterThan(10);
      expect(d.rubble.length).toBeGreaterThan(5);
      expect(d.hp).toBe(DESTRUCT_KINDS[d.kind].hp);
      if (d.kind === 'tuna_stack') expect(districtAt(data, d.x, d.z, d.y)?.id, `${d.id} in the garage`).toBe('garage');
      // stands on its surface, overlaps no static collider (inner samples)
      for (const b of d.boxes) {
        const bb = boxAabb(b);
        if (d.kind !== 'wall_boards' && bb.y0 < d.y + 0.01) expect(Math.abs(surfaceAt(data, b.x, b.z, bb.y0 + 0.05).y - bb.y0), `${d.id} on the ground`).toBeLessThan(0.03);
        for (let i = 1; i < 6; i++) for (let k = 1; k < 6; k++) for (const fy of [0.3, 0.6, 0.9]) {
          const x = bb.x0 + ((bb.x1 - bb.x0) * i) / 6, z = bb.z0 + ((bb.z1 - bb.z0) * k) / 6, y = Math.max(bb.y0 + 0.25, bb.y0 + (bb.y1 - bb.y0) * fy);
          if (destructDistance(d, x, y, z) > 0) continue;                       // outside a yawed box
          expect(occupiedAt(data, x, y, z), `${d.id} overlaps a prop at ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`).toBe(false);
        }
      }
    }
  });

  it('clear of spawns, pickups and their proof routes, the roof routes, jump pads and objective points', () => {
    const L = PICKUP_LAYOUTS['West Yard'];
    // standing points (feet) of pickups, their proof routes and the roof routes: a body (feet +0.6 m) keeps its room
    const pts: [number, number, number, string][] = [];
    for (const s of [...L.cores, ...L.kibble]) { pts.push([s.x, s.y, s.z, s.id]); for (const r of s.route ?? []) pts.push([r[0], r[1], r[2], `${s.id} route`]); }
    for (const r of [...ROOF_ROUTES.west, ...ROOF_ROUTES.east]) pts.push([r[0], r[1], r[2], 'roof route']);
    for (const d of data.destructibles!) {
      for (const [x, y, z, what] of pts) {
        // e.g. the car-roof kibble and its route inside the garage: stacks keep 2 m of floor to them
        expect(destructDistance(d, x, y + 0.6, z), `${d.id} vs ${what}`).toBeGreaterThan(d.kind === 'wall_boards' ? 1 : 2);
      }
      for (const s of data.spawns) expect(Math.hypot(s.x - d.cx, s.z - d.cz), `${d.id} vs spawn`).toBeGreaterThan(15);
      for (const p of data.jumpPads ?? []) expect(Math.hypot(p.x - d.cx, p.z - d.cz), `${d.id} vs pad`).toBeGreaterThan(p.r + 4);
      expect(Math.hypot(d.cx, d.cz), `${d.id} vs the trampoline hold zone`).toBeGreaterThan(15);
    }
  });
});

describe('X1 destructibles: nav with everything standing', () => {
  it('keeps every D3 garage nav probe walkable: interior points, each door straight through', async () => {
    const sim = await yard();
    const g = navGridFor(sim);
    expect(navBlockerStats(sim).closed).toBeGreaterThan(40);                         // the stacks do close cells
    const L = (lx: number, lz: number): [number, number] => [GARAGE.x + lx, GARAGE.z + lz];
    for (const [lx, lz] of [[-2, 6], [-1, -3], [10, -2], [10, 8], [-9, -6.5]]) {
      const [x, z] = L(lx, lz);
      expect(isWalkable(g, x, z), `interior ${lx},${lz}`).toBe(true);
      expect(g.region[cellIndex(g, x, z)], `interior ${lx},${lz} in the main region`).toBe(g.mainRegion);
    }
    for (const d of GARAGE_DOORS) {
      const ox = d.x + d.nx * 3, oz = d.z + d.nz * 3, ix = d.x - d.nx * 3, iz = d.z - d.nz * 3;
      expect(lineWalkable(g, ox, oz, ix, iz), `${d.id} straight through`).toBe(true);
    }
    sim.dispose();
  });
});

describe('X1 destructibles: the breach', () => {
  it('a Dig Charge planted at the breach wall blows it open; a corgi walks through after, never before', async () => {
    const sim = await yard();
    const wall = wallOf(sim);
    const snap = sim.toState(wall);
    expect(snap).toMatchObject({ kind: EntityKind.Destructible, team: Team.Neutral, seed: 0, hp: 150, maxHp: 150, flags: 0, cls: -1 });
    // before: a corgi running at the wall from the alley stays outside
    const runner = spawn(sim, Team.Corgis, 'assault', ALLEY_X, BREACH_Z, WEST);
    hold(sim, runner, 2.5, { mz: 1, yaw: WEST });
    expect(runner.pos.x).toBeGreaterThan(GARAGE_BREACH.x1 - 0.05);
    // the Breacher plants a charge on the ground at the foot of the wall (Q under the crosshair)
    const b = spawn(sim, Team.Corgis, 'breacher', 96.2, BREACH_Z - 1.5, WEST);
    hold(sim, b, 0.3);
    const aim = aimAt(b, 94.4, 0, BREACH_Z - 1.5);
    const evs = hold(sim, b, 1 / TICK_HZ, { ...aim, buttons: Btn.Ability });
    expect(evs.some((e) => e.e === 'ability' && e.ability === 'dig_charge')).toBe(true);
    // back off; the breaching fuse blows it 2.5 s after planting (1 s to arm + 1.5 s) - no enemy needed
    hold(sim, runner, 0.5, { mz: 1, yaw: EAST });
    const later = hold(sim, b, 3, { mz: 1, yaw: EAST });
    const boom = later.find((e) => e.e === 'explode');
    const brk = breaks(later);
    expect(boom, 'the charge blew').toBeTruthy();
    expect(boom!.tick - evs[0].tick).toBeLessThanOrEqual(Math.round(2.6 * TICK_HZ));
    expect(brk).toHaveLength(1);
    expect(brk[0]).toMatchObject({ id: wall.id, ability: 'destruct:wall_boards' });
    expect(brk[0].tick).toBe(boom!.tick);
    expect(wall.dsx!.broken).toBe(true);
    expect(sim.toState(wall)).toMatchObject({ hp: 0, flags: EFlag.Busy, ammo: 1 });
    expect(destructibleCount(sim, 'garage_breach_wall')).toBe(1);
    expect(drainBreaks(sim)).toEqual([expect.objectContaining({ defId: 'garage_breach_wall', tag: 'garage_breach_wall', by: b.id, byTeam: Team.Corgis, scripted: false })]);
    // the runner now walks straight through the gap into the garage
    hold(sim, runner, 0.2, { yaw: WEST });
    const x0 = runner.pos.x;
    hold(sim, runner, 3, { mz: 1, yaw: WEST });
    expect(x0).toBeGreaterThan(GARAGE_BREACH.x1);
    expect(runner.pos.x).toBeLessThan(INSIDE_X);
    expect(Math.abs(runner.pos.z - BREACH_Z)).toBeLessThan(1.5);
    sim.dispose();
  });

  it('nav: the breach cells open in place on the break and A* goes through the hole (not before)', async () => {
    const sim = await yard();
    const g = navGridFor(sim);
    const out: number[] = [];
    // before: sealed; the only way in from the alley is round the corner through the pet door
    for (let z = GARAGE_BREACH.z0 + 1; z < GARAGE_BREACH.z1 - 0.5; z += 1) expect(isWalkable(g, 93.7, z), `closed ${z}`).toBe(false);
    expect(lineWalkable(g, ALLEY_X, BREACH_Z, INSIDE_X, BREACH_Z)).toBe(false);
    expect(findPath(g, ALLEY_X, BREACH_Z, INSIDE_X, BREACH_Z, out)).toBe(true);
    expect(pathLen(ALLEY_X, BREACH_Z, out)).toBeGreaterThan(12);
    expect(Math.min(...out.filter((_, k) => k % 2 === 1))).toBeLessThan(-69.5);            // out past the north wall
    breakDestructibles(sim, 'garage_breach_wall');
    expect(navGridFor(sim)).toBe(g);                                                       // same grid object, updated in place
    for (let z = GARAGE_BREACH.z0 + 1; z < GARAGE_BREACH.z1 - 0.5; z += 1) expect(isWalkable(g, 93.7, z), `open ${z}`).toBe(true);
    expect(lineWalkable(g, ALLEY_X, BREACH_Z, INSIDE_X, BREACH_Z)).toBe(true);
    expect(findPath(g, ALLEY_X, BREACH_Z, INSIDE_X, BREACH_Z, out)).toBe(true);
    expect(pathLen(ALLEY_X, BREACH_Z, out)).toBeLessThan(8.5);
    const i = cellIndex(g, 93.7, BREACH_Z);
    expect(g.region[i]).toBe(g.mainRegion);
    // the incremental merge equals a full relabel (a blocker that closes nothing forces one)
    const inc = new Int32Array(g.region);
    setNavBlocker(sim, 'test:sky', [{ type: 'x', x: 0, y: 200, z: 0, hx: 1, hy: 1, hz: 1, rotY: 0 }]);
    expect(samePartition(g, inc, g.region)).toBe(true);
    setNavBlocker(sim, 'test:sky', null);
    console.log(`[x1] nav: ${navBlockerStats(sim).closed} cells closed by standing destructibles; break update ${navBlockerStats(sim).applyMs.toFixed(2)} ms`);
    sim.dispose();
  });

  it('rifle fire never breaks the wall (shots stop on it); the same rifle chews through a crate stack', async () => {
    const sim = await yard();
    const wall = wallOf(sim);
    const a = spawn(sim, Team.Corgis, 'assault', 99.2, BREACH_Z, WEST);
    hold(sim, a, 0.3);
    const aim = aimAt(a, 93.9, 2, BREACH_Z);
    const evs = hold(sim, a, 4, { ...aim, buttons: Btn.Fire });
    const shots = evs.filter((e) => e.e === 'fire');
    expect(shots.length).toBeGreaterThan(20);
    for (const s of shots) if (s.e === 'fire') expect(s.hx).toBeGreaterThan(GARAGE_BREACH.x1 - 0.2);   // stopped on the boards
    expect(wall.health!.hp).toBe(150);
    expect(wall.dsx!.broken).toBe(false);
    // a crate stack takes rifle damage and breaks (60 hp, 15 per shot)
    const crate = byId(sim, 'crate_stack_1');
    const c = spawn(sim, Team.Corgis, 'assault', 50, -66, Math.PI);
    hold(sim, c, 0.3);
    const ev2 = hold(sim, c, 2.5, { ...aimAt(c, crate.dsx!.def.cx, 0.8, crate.dsx!.def.cz), buttons: Btn.Fire });
    expect(crate.dsx!.broken).toBe(true);
    expect(breaks(ev2)).toEqual([expect.objectContaining({ id: crate.id, ability: 'destruct:crate_stack' })]);
    expect(crate.dsx!.brokeBy).toBe(c.id);
    sim.dispose();
  });

  it('a kart rammed hard into a crate stack flattens it (credited to the driver); a gentle bump does nothing', async () => {
    const run = async (throttle: number, runUp: number, boost: boolean) => {
      const sim = await Sim.create({ seed: 1, systems: [...systems(), ...vehicleSystems()] });
      sim.state.vehicleConfig = { autoTerminals: false };
      sim.step();
      const crate = byId(sim, 'crate_stack_2');
      const cx = crate.dsx!.def.cx, cz = crate.dsx!.def.cz;
      // a straight, clear run-up toward the stack's center
      let start: { x: number; z: number } | null = null;
      for (let k = 0; k < 16 && !start; k++) {
        const a = (k / 16) * Math.PI * 2, x = cx + Math.cos(a) * runUp, z = cz + Math.sin(a) * runUp;
        const y = surfaceAt(sim.worldData, x, z).y;
        if (Math.abs(y - sim.worldData.height(x, z)) > 0.05) continue; // on the lawn, not on a prop
        const sx = cx + Math.cos(a) * 2.2, sz = cz + Math.sin(a) * 2.2;
        if (worldLineClear(sim, x, y + 0.5, z, sx, sim.worldData.height(sx, sz) + 0.5, sz)) start = { x, z };
      }
      expect(start).toBeTruthy();
      const yaw = Math.atan2(-(cx - start!.x), -(cz - start!.z));
      const kart = spawnKart(sim, 'mower_kart', Team.Corgis, start!.x, surfaceAt(sim.worldData, start!.x, start!.z).y, start!.z, yaw);
      const driver = spawn(sim, Team.Corgis, 'assault', start!.x + 1.5, start!.z);
      hold(sim, driver, 0.1);
      expect(mountKart(sim, kart, driver)).toBe(true);
      const evs = hold(sim, driver, 3.5, { mz: throttle, yaw, buttons: boost ? Btn.Sprint : 0 });
      const out = { broken: crate.dsx!.broken, by: crate.dsx!.brokeBy, driver: driver.id, events: breaks(evs).length, hp: crate.health!.hp };
      sim.dispose();
      return out;
    };
    const hard = await run(1, 18, true);
    expect(hard.broken).toBe(true);
    expect(hard.by).toBe(hard.driver);
    expect(hard.events).toBe(1);
    const soft = await run(0.3, 4, false);
    expect(soft.broken).toBe(false);
    expect(soft.hp).toBe(DESTRUCT_KINDS.crate_stack.hp);
  });

  it('a tennis-mortar blast breaks tuna and crate stacks; it only scratches the wall', async () => {
    const sim = await yard();
    const mortar = WEAPONS.tennis_mortar.projectile!, wi = weaponIndex('tennis_mortar');
    const b = spawn(sim, Team.Corgis, 'breacher', 68, -36, Math.PI);
    // a real mortar shot at the east-lawn crate stack (12 m, a flat lob)
    hold(sim, b, 0.3, { pitch: 0.1, yaw: Math.PI });
    const evs = hold(sim, b, 2, { pitch: 0.1, yaw: Math.PI, buttons: Btn.Fire, tap: true });
    expect(evs.some((e) => e.e === 'explode')).toBe(true);
    expect(byId(sim, 'crate_stack_2').dsx!.broken).toBe(true);
    // a blast 1 m from a tuna stack inside the garage breaks it; the neighbour 7.8 m away is untouched
    const t2 = byId(sim, 'tuna_stack_2'), t1 = byId(sim, 'tuna_stack_1');
    const d = t2.dsx!.def;
    explode(sim, d.cx + 2.3, 0.5, d.cz, mortar, b.id, b.team, wi);
    expect(t2.dsx!.broken).toBe(true);
    expect(t1.dsx!.broken).toBe(false);
    expect(t1.health!.hp).toBe(80);
    // the wall: a point-blank mortar blast does 85 x 0.4 = 34; the fifth breaks it
    const wall = wallOf(sim);
    const hp0 = wall.health!.hp;
    expect(hp0).toBe(150);
    let k = 0;
    while (!wall.dsx!.broken && k < 10) {
      explode(sim, 94.15, 2, BREACH_Z, mortar, b.id, b.team, wi);
      k++;
      if (!wall.dsx!.broken) expect(wall.health!.hp).toBeCloseTo(hp0 - 34 * k, 3);
    }
    expect(k).toBe(Math.ceil(hp0 / 34));                                                   // 5 point-blank mortars
    sim.dispose();
  });

  it('cover blocks blasts: a crate stack behind a wall shrugs off a mortar the open side takes', async () => {
    const n = 33, cell = 2;
    const crates = crateStack('crate_test', 0, 0, 0, 0, 1);
    const flat = {
      seed: 1, name: 'x1 cover', height: () => 0, halfExtent: 30, killY: -30,
      terrain: { x0: -32, z0: -32, cell, n, heights: new Float32Array(n * n) },
      props: [{ type: 'fence', x: 2.2, y: 2, z: 0, hx: 0.15, hy: 2, hz: 4, rotY: 0 }],
      spawns: [{ x: 0, y: 0, z: 20, yaw: 0, team: 0 }, { x: 0, y: 0, z: -20, yaw: 0, team: 1 }],
      destructibles: [crates],
    } as WorldData;
    const sim = await Sim.create({ seed: 1, world: flat, systems: systems() });
    sim.step();
    const [c] = destructibles(sim);
    const b = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'breacher', name: 'b', x: 0, y: 0.02, z: 15 });
    const mortar = WEAPONS.tennis_mortar.projectile!, wi = weaponIndex('tennis_mortar');
    explode(sim, 2.9, 1.0, 0, mortar, b.id, b.team, wi);                                    // 1.55 m away, behind the wall
    expect(c.health!.hp).toBe(60);
    explode(sim, -2.9, 1.0, 0, mortar, b.id, b.team, wi);                                   // same distance, open side
    expect(c.dsx!.broken).toBe(true);
    sim.dispose();
  });
});

describe('X1 destructibles: reset, prediction, determinism', () => {
  it('resetDestructibles() and a match restart stand everything back up (colliders, nav, hp) and push people out', async () => {
    const sim = await yard();
    const g = navGridFor(sim);
    breakDestructibles(sim, 'garage_breach_wall');
    breakDestructibles(sim, 'tuna_stack');
    breakDestructibles(sim, 'crate_stack_3');
    expect(destructibleCount(sim, 'tuna_stack')).toBe(4);
    expect(destructibleCount(sim, 'crate_stack', 'standing')).toBe(2);
    // someone stands in the doorway
    const c = spawn(sim, Team.Cats, 'assault', 93.75, BREACH_Z);
    hold(sim, c, 0.2);
    const n = resetDestructibles(sim, ['garage_breach_wall']);
    expect(n).toBe(1);
    expect(wallOf(sim).dsx!.broken).toBe(false);
    expect(destructibleCount(sim, 'tuna_stack')).toBe(4);                                // untouched: only the tag asked for
    const capR = 0.36;
    expect(c.pos.x < GARAGE_BREACH.x0 - capR + 0.1 || c.pos.x > GARAGE_BREACH.x1 + capR - 0.1, `pushed out (x ${c.pos.x.toFixed(2)})`).toBe(true);
    expect(isWalkable(g, 93.7, BREACH_Z)).toBe(false);
    hold(sim, c, 0.1);                                                                    // a physics step: queries see it
    expect(worldLineClear(sim, 96, 2, BREACH_Z, 91, 2, BREACH_Z)).toBe(false);
    // a match restart (ended -> warmup) stands the rest back up
    const ms: MatchState = { mode: 'yard-skirmish', phase: 'ended', timeLeft: 0, score: [0, 0], objective: '', wave: 0, winner: -1 };
    sim.state.match = ms;
    hold(sim, c, 0.1);
    expect(destructibleCount(sim, 'tuna_stack')).toBe(4);
    ms.phase = 'warmup';
    hold(sim, c, 0.1);
    expect(destructibleCount(sim, 'tuna_stack')).toBe(0);
    expect(destructibleCount(sim, 'crate_stack')).toBe(0);
    for (const e of destructibles(sim)) expect(sim.toState(e)).toMatchObject({ hp: e.dsx!.def.hp, flags: 0 });
    expect(navBlockerStats(sim).blockers).toBe(8);
    // an adventure checkpoint: remember what was blown, restore exactly that later (silently)
    breakDestructibles(sim, 'garage_breach_wall');
    breakDestructibles(sim, 'tuna_stack_1');
    const snap = destructSnapshot(sim);
    expect(snap).toEqual(['garage_breach_wall', 'tuna_stack_1']);
    breakDestructibles(sim, 'tuna_stack');
    resetDestructibles(sim, ['garage_breach_wall']);
    sim.drainEvents();
    restoreDestructSnapshot(sim, snap);
    expect(sim.drainEvents().filter((e) => e.e === 'ability')).toEqual([]);
    expect(destructSnapshot(sim)).toEqual(snap);
    expect(isWalkable(g, 93.7, BREACH_Z)).toBe(true);
    sim.dispose();
  });

  it('the prediction mirror keeps standing walls solid for the predicted player and drops broken ones', async () => {
    const auth = await yard();
    const snapOf = () => [...auth.entities.values()].map((e) => unpackEntity(packEntity(auth.toState(e))));  // wire precision
    const pred = await Sim.create({ seed: 1, systems: [] });
    pred.world.step();
    const cache = new Map<number, Collider[]>();
    expect(mirrorDestructibles(pred, snapOf(), cache)).toBe(true);
    expect(cache.size).toBe(8);
    expect(mirrorDestructibles(pred, snapOf(), cache)).toBe(false);                          // idempotent
    const runner = pred.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'r', x: ALLEY_X, y: 0.05, z: BREACH_Z, yaw: WEST });
    const ctx = { world: pred.world, kcc: pred.kcc };
    const run = (s: number) => {
      for (let i = 0; i < s * TICK_HZ; i++) {
        runner.input = { seq: seq++, mx: 0, mz: 1, yaw: WEST, pitch: 0, buttons: 0, rt: 0 };
        stepCharacter(ctx, runner, 1 / TICK_HZ);
        runner.prevButtons = 0;
      }
    };
    run(2);
    expect(runner.pos.x).toBeGreaterThan(GARAGE_BREACH.x1 - 0.05);                          // stopped at the wall
    breakDestructibles(auth, 'garage_breach_wall');
    expect(mirrorDestructibles(pred, snapOf(), cache)).toBe(true);
    expect(cache.size).toBe(7);
    run(2.5);
    expect(runner.pos.x).toBeLessThan(INSIDE_X);                                             // through the hole
    resetDestructibles(auth);
    expect(mirrorDestructibles(pred, snapOf(), cache)).toBe(true);
    expect(cache.size).toBe(8);
    expect(mirrorDestructibles(pred, [] as EntityState[], cache)).toBe(true);                // gone from the snapshot
    expect(cache.size).toBe(0);
    auth.dispose(); pred.dispose();
  });

  it('is deterministic: the same fight twice gives identical breaks, hp and events', async () => {
    const script = async () => {
      const sim = await yard();
      const b = spawn(sim, Team.Corgis, 'breacher', 96.2, BREACH_Z, WEST);
      const r = spawn(sim, Team.Cats, 'assault', 50, -66, Math.PI);
      hold(sim, b, 0.3);
      const log: string[] = [];
      const note = (evs: Ev[]) => { for (const e of evs) if (e.e === 'explode' || e.e === 'ability') log.push(JSON.stringify(e)); };
      note(hold(sim, b, 1 / TICK_HZ, { ...aimAt(b, 94.4, 0, BREACH_Z), buttons: Btn.Ability }));
      note(hold(sim, r, 2.5, { ...aimAt(r, 50, 0.8, -58), buttons: Btn.Fire }));
      note(hold(sim, b, 1, { mz: 1, yaw: EAST }));
      explode(sim, 72.4, 0.5, -53.7, WEAPONS.tennis_mortar.projectile!, b.id, b.team, weaponIndex('tennis_mortar'));
      note(hold(sim, b, 0.5));
      const state = destructibles(sim).map((e) => [e.id, e.health!.hp, e.flags, e.dsx!.brokeTick, e.dsx!.brokeBy].join(':'));
      sim.dispose();
      return { log, state };
    };
    const a = await script(), b = await script();
    expect(a.state.filter((s) => s.includes(':2048:')).length).toBeGreaterThanOrEqual(3);    // wall, crate, tuna broke
    expect(b).toEqual(a);
  });
});

// ------------------------------------------------------------------------------------------------ helpers

function pathLen(x: number, z: number, out: number[]): number {
  let len = 0, px = x, pz = z;
  for (let k = 0; k + 1 < out.length; k += 2) { len += Math.hypot(out[k] - px, out[k + 1] - pz); px = out[k]; pz = out[k + 1]; }
  return len;
}

function cellIndex(g: NavGrid, x: number, z: number): number {
  return Math.floor((z - g.oz) / g.cell) * g.w + Math.floor((x - g.ox) / g.cell);
}

/** Same connected components (ids may differ): a consistent bijection between the two labelings. */
function samePartition(g: NavGrid, a: Int32Array, b: Int32Array): boolean {
  const ab = new Map<number, number>(), ba = new Map<number, number>();
  for (let i = 0; i < a.length; i++) {
    if (!g.walk[i]) continue;
    const x = a[i], y = b[i];
    if (x < 0 || y < 0) return false;
    if ((ab.has(x) && ab.get(x) !== y) || (ba.has(y) && ba.get(y) !== x)) return false;
    ab.set(x, y); ba.set(y, x);
  }
  return true;
}

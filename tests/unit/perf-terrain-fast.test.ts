// Perf lane P1: the terrain fast path (src/sim/world/build.ts) is the exact analytic twin of the terrain trimesh and
// of Rapier's character controller for grounded moves over open terrain. These tests pin it to Rapier itself.
import { describe, it, expect, beforeAll } from 'vitest';
import type { Collider } from '@dimforge/rapier3d-compat';
import { Sim } from '../../src/sim/sim';
import { createFlatWorldData, createWorldData } from '../../src/shared/world/world-data';
import { nearestPropDist } from '../../src/shared/world/queries';
import { sphereRestOnGrid, terrainFastMove, terrainFastPath, isTerrainCollider, type TerrainRest } from '../../src/sim/world/build';
import { CHARACTER_GROUPS, CHARACTER_MOVE_FILTER, WORLD_GROUPS } from '../../src/sim/rapier';
import { mulberry32 } from '../../src/shared/rng';

let sim: Sim;
beforeAll(async () => {
  sim = await Sim.create({ seed: 1, systems: [] });
  sim.world.step();
});

const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };

/** Open lawn points: >= 3 m from any prop collider, gentle slope, inside the yard. */
function openPoints(count: number, seed: number): [number, number][] {
  const rnd = mulberry32(seed), out: [number, number][] = [];
  while (out.length < count) {
    const x = -85 + rnd() * 170, z = -85 + rnd() * 170;
    if (nearestPropDist(sim.worldData, x, z) < 3) continue;
    out.push([x, z]);
  }
  return out;
}

describe('sphereRestOnGrid (analytic terrain)', () => {
  it('equals a Rapier ball cast onto the terrain trimesh (p99 < 0.1 mm; Rapier GJK tolerance ~1 mm)', () => {
    const g = sim.worldData.terrain!;
    let terrain: Collider | undefined;
    sim.world.forEachCollider((c) => { if (isTerrainCollider(c)) terrain = c; });
    const rnd = mulberry32(11), out: TerrainRest = { y: 0, nx: 0, ny: 1, nz: 0 };
    const errs: number[] = [];
    for (const R of [0.35, 0.38]) {
      const ball = new sim.R.Ball(R);
      for (let k = 0; k < 1500; k++) {
        const x = -99 + rnd() * 198, z = -99 + rnd() * 198;
        const hit = sim.world.castShape({ x, y: 30, z }, { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: -1, z: 0 }, ball, 0, 60, true,
          undefined, undefined, undefined, undefined, (c) => c.handle === terrain!.handle);
        expect(hit).not.toBeNull();
        expect(sphereRestOnGrid(g, x, z, R, out)).toBe(true);
        errs.push(Math.abs(30 - hit!.time_of_impact - out.y));
        expect(Math.hypot(out.nx, out.ny, out.nz)).toBeCloseTo(1, 9);
      }
    }
    expect(pct(errs, 0.99)).toBeLessThan(1e-4);
    expect(Math.max(...errs)).toBeLessThan(1.5e-3);
  });

  it('is exact on flat ground and refuses points whose footprint leaves the grid', () => {
    const g = sim.worldData.terrain!, out: TerrainRest = { y: 0, nx: 0, ny: 0, nz: 0 };
    expect(sphereRestOnGrid(g, 110.3, 110.6, 0.38, out)).toBe(true);   // the flat ring outside the fence
    expect(out.y).toBe(0.38);
    expect(out.ny).toBe(1);
    expect(sphereRestOnGrid(g, g.x0 + 0.1, 0, 0.38, out)).toBe(false);
  });
});

describe('terrainFastMove vs Rapier character controller (same start, same input)', () => {
  it('matches the controller on open lawn: horizontal p99 < 1 mm, vertical p90 < 1 mm, always grounded', () => {
    const cap = sim.R.ColliderDesc.capsule(0.24, 0.36).setCollisionGroups(CHARACTER_GROUPS);
    const dh: number[] = [], dv: number[] = [];
    let tried = 0, fast = 0;
    const out = { x: 0, y: 0, z: 0 };
    for (const [x, z] of openPoints(40, 5)) {
      const c = sim.world.createCollider(cap.setTranslation(x, sim.worldData.height(x, z) + 0.7, z));
      // settle onto the ground with the controller, then refresh the broad phase like the physics-step system does
      for (let k = 0; k < 40; k++) {
        sim.kcc.computeColliderMovement(c, { x: 0, y: -0.02, z: 0 }, undefined, CHARACTER_MOVE_FILTER);
        const m = sim.kcc.computedMovement(), t = c.translation();
        c.setTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
      }
      sim.world.step();
      for (let a = 0; a < 16; a++) for (const speed of [3.6, 6.4, 9.6]) {
        const yaw = (a / 16) * Math.PI * 2;
        const d = { x: (Math.cos(yaw) * speed) / 60, y: -24 / 60 / 60, z: (Math.sin(yaw) * speed) / 60 };
        tried++;
        if (!terrainFastMove(sim.world, sim.kcc, c, CHARACTER_MOVE_FILTER, d, out)) continue;
        fast++;
        sim.kcc.computeColliderMovement(c, d, undefined, CHARACTER_MOVE_FILTER);
        const m = sim.kcc.computedMovement();
        expect(sim.kcc.computedGrounded()).toBe(true);
        dh.push(Math.hypot(m.x - out.x, m.z - out.z));
        dv.push(Math.abs(m.y - out.y));
      }
      sim.world.removeCollider(c, false);
    }
    sim.world.step();
    expect(fast / tried).toBeGreaterThan(0.95);                         // open lawn is the fast path's home
    expect(pct(dh, 0.99)).toBeLessThan(1e-3);
    expect(pct(dv, 0.9)).toBeLessThan(1e-3);
    expect(Math.max(...dv)).toBeLessThan(0.03);                          // the controller's own edge hops are <= ~2 cm
  });

  it('hands every other case to the controller', () => {
    const out = { x: 0, y: 0, z: 0 };
    const run = { x: 0.107, y: -0.0067, z: 0 };
    const [x, z] = openPoints(1, 9)[0];
    const rest: TerrainRest = { y: 0, nx: 0, ny: 1, nz: 0 };
    // capsule (r 0.36, half 0.24) resting 1 mm outside the controller's 0.02 m offset shell, plus `lift`
    const place = (px: number, pz: number, lift: number) => {
      sphereRestOnGrid(sim.worldData.terrain!, px, pz, 0.36 + 0.02, rest);
      return sim.world.createCollider(sim.R.ColliderDesc.capsule(0.24, 0.36).setTranslation(px, rest.y + 0.24 + 0.001 + lift, pz).setCollisionGroups(CHARACTER_GROUPS));
    };
    const onLawn = place(x, z, 0);
    const floating = place(x + 3, z, 0.2);
    const inShell = place(x - 3, z, -0.012);          // inside the offset shell: the controller keeps it there
    // a crate 0.3 m beside a character (anything the controller could touch sends the move to it)
    const nearProp = place(x, z + 4, 0);
    const crate = sim.world.createCollider(sim.R.ColliderDesc.cuboid(0.5, 0.5, 0.5)
      .setTranslation(x + 0.36 + 0.3 + 0.5, sim.worldData.height(x, z + 4) + 0.5, z + 4).setCollisionGroups(WORLD_GROUPS));
    sim.world.step();
    expect(terrainFastMove(sim.world, sim.kcc, onLawn, CHARACTER_MOVE_FILTER, run, out)).toBe(true);
    expect(terrainFastMove(sim.world, sim.kcc, onLawn, CHARACTER_MOVE_FILTER, { x: 0.1, y: 0.14, z: 0 }, out)).toBe(false); // jumping
    expect(terrainFastMove(sim.world, sim.kcc, floating, CHARACTER_MOVE_FILTER, run, out)).toBe(false);                     // not resting
    expect(terrainFastMove(sim.world, sim.kcc, inShell, CHARACTER_MOVE_FILTER, run, out)).toBe(false);                      // inside the skin
    expect(terrainFastMove(sim.world, sim.kcc, nearProp, CHARACTER_MOVE_FILTER, run, out)).toBe(false);                     // prop in reach
    terrainFastPath.enabled = false;
    try { expect(terrainFastMove(sim.world, sim.kcc, onLawn, CHARACTER_MOVE_FILTER, run, out)).toBe(false); }
    finally { terrainFastPath.enabled = true; }
    for (const c of [onLawn, floating, inShell, nearProp, crate]) sim.world.removeCollider(c, false);
    sim.world.step();
  });

  it('only worlds with a trimesh terrain grid use it (flat test worlds keep the controller)', async () => {
    const flat = await Sim.create({ seed: 1, systems: [], world: createFlatWorldData() });
    const c = flat.world.createCollider(flat.R.ColliderDesc.capsule(0.24, 0.36).setTranslation(0, 0.62, 0).setCollisionGroups(CHARACTER_GROUPS));
    flat.world.step();
    expect(terrainFastMove(flat.world, flat.kcc, c, CHARACTER_MOVE_FILTER, { x: 0.1, y: -0.0067, z: 0 }, { x: 0, y: 0, z: 0 })).toBe(false);
    // a second sim of the same seed (client prediction) gets its own registration and identical answers
    const twin = await Sim.create({ seed: 1, systems: [], world: createWorldData(1) });
    const [x, z] = openPoints(1, 21)[0];
    const rest: TerrainRest = { y: 0, nx: 0, ny: 1, nz: 0 };
    sphereRestOnGrid(sim.worldData.terrain!, x, z, 0.38, rest);
    const mk = (s: Sim) => s.world.createCollider(s.R.ColliderDesc.capsule(0.24, 0.36).setTranslation(x, rest.y + 0.24 + 0.001, z).setCollisionGroups(CHARACTER_GROUPS));
    const a = mk(sim), b = mk(twin);
    sim.world.step(); twin.world.step();
    const oa = { x: 0, y: 0, z: 0 }, ob = { x: 0, y: 0, z: 0 };
    const d = { x: 0.09, y: -0.0067, z: -0.05 };
    expect(terrainFastMove(sim.world, sim.kcc, a, CHARACTER_MOVE_FILTER, d, oa)).toBe(true);
    expect(terrainFastMove(twin.world, twin.kcc, b, CHARACTER_MOVE_FILTER, d, ob)).toBe(true);
    expect(ob).toEqual(oa);
    sim.world.removeCollider(a, false); sim.world.step();
  });
});

describe('terrainFastMove scope', () => {
  it('never runs for a non-capsule collider (the ball-shaped Vac-Tank sank and became unhittable)', () => {
    const [x, z] = openPoints(1, 5)[0];
    const r = 1.2;
    const y = sim.worldData.height(x, z) + r + 0.02;
    const ball = sim.world.createCollider(sim.R.ColliderDesc.ball(r).setTranslation(x, y, z).setCollisionGroups(CHARACTER_GROUPS));
    const out = { x: 0, y: 0, z: 0 };
    expect(terrainFastMove(sim.world, sim.kcc, ball, CHARACTER_MOVE_FILTER, { x: 0.05, y: -0.01, z: 0 }, out)).toBe(false);
    sim.world.removeCollider(ball, false);
  });
});

// West Yard world lane proofs: determinism, collider == height() == rendered triangles, spawns,
// settling, jump pads, water, out-of-bounds, traversal (deck stairs), budgets & palette.
import { describe, it, expect, beforeAll } from 'vitest';
import type { Collider, World } from '@dimforge/rapier3d-compat';
import { buildWestYard } from '../../src/shared/world/west-yard';
import { createWorldData, createFlatWorldData, type WorldData } from '../../src/shared/world/world-data';
import { buildTerrainChunkArrays, gridSlopeDeg } from '../../src/shared/world/terrain';
import { nearestPropDist, surfaceAt, waterAt } from '../../src/shared/world/queries';
import { loadRapier, type Rapier } from '../../src/sim/rapier';
import { buildStaticWorld } from '../../src/sim/world/build';
import { worldSystems } from '../../src/sim/world/systems';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem, killPlaneSystem } from '../../src/sim/systems/core';
import { Sim } from '../../src/sim/sim';
import { mulberry32 } from '../../src/shared/rng';
import { Species, Team } from '../../src/shared/types';
import { Btn } from '../../src/shared/input';
import { worldHex } from '../../src/client/world/world-palette';

const coreSystems = () => [movementSystem, ...worldSystems(), physicsStepSystem, killPlaneSystem];
let data: WorldData;
let R: Rapier;

beforeAll(async () => {
  data = createWorldData(1);
  R = await loadRapier();
});

describe('world data', () => {
  it('is deterministic for a seed (heights, props, spawns, prims)', () => {
    const a = buildWestYard(7), b = buildWestYard(7);
    for (let z = -118; z <= 118; z += 5.9) for (let x = -118; x <= 118; x += 5.9) expect(a.height(x, z)).toBe(b.height(x, z));
    expect(Buffer.from(a.terrain!.heights.buffer).equals(Buffer.from(b.terrain!.heights.buffer))).toBe(true);
    expect(JSON.stringify(a.props)).toBe(JSON.stringify(b.props));
    expect(JSON.stringify(a.cylinders)).toBe(JSON.stringify(b.cylinders));
    expect(JSON.stringify(a.spawns)).toBe(JSON.stringify(b.spawns));
    expect(JSON.stringify(a.prims)).toBe(JSON.stringify(b.prims));
    // a different seed changes the lawn but keeps the layout valid
    const c = buildWestYard(8);
    let diff = 0;
    for (let x = -90; x <= 90; x += 10) diff += Math.abs(a.height(x, 13) - c.height(x, 13));
    expect(diff).toBeGreaterThan(0.01);
    expect(c.spawns.length).toBe(a.spawns.length);
  });

  it('has finite, pet-scale terrain and a walkable play area', () => {
    const g = data.terrain!;
    let lo = Infinity, hi = -Infinity;
    for (const h of g.heights) { expect(Number.isFinite(h)).toBe(true); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    expect(lo).toBeGreaterThan(-3);   // pond ~ -1.5
    expect(hi).toBeLessThan(6);       // mound ~ 4.3
    let walk = 0, n = 0;
    for (let z = -98; z <= 98; z += 2) for (let x = -98; x <= 98; x += 2) {
      n++;
      if (gridSlopeDeg(g, x, z) < 30 && surfaceAt(data, x, z).kind === 'terrain') walk++;
    }
    expect(walk / n).toBeGreaterThan(0.8);
    expect(data.halfExtent).toBe(100);
  });

  it('uses only palette colors that exist (style tokens + world palette)', () => {
    const keys = new Set((data.prims ?? []).map((p) => p.col));
    for (const k of keys) expect(() => worldHex(k), k).not.toThrow();
    expect((data.prims ?? []).length).toBeGreaterThan(800);
  });
});

describe('colliders match height() and the rendered triangles', () => {
  let world: World;
  let hf: Collider;
  beforeAll(() => {
    world = new R.World({ x: 0, y: -24, z: 0 });
    buildStaticWorld(R, world, data);
    world.forEachCollider((c) => { if (c.shape.type === R.ShapeType.HeightField) hf = c; });
    world.step();
  });

  it('heightfield raycasts agree with height() within 1 cm at 200 random points', () => {
    expect(hf).toBeTruthy();
    const rnd = mulberry32(123);
    let worst = 0;
    for (let k = 0; k < 200; k++) {
      const x = -99 + rnd() * 198, z = -99 + rnd() * 198;
      const ray = new R.Ray({ x, y: 60, z }, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, 120, true, undefined, undefined, undefined, undefined, (c) => c.handle === hf.handle);
      expect(hit, `no hit at ${x},${z}`).not.toBeNull();
      const y = 60 - hit!.timeOfImpact;
      worst = Math.max(worst, Math.abs(y - data.height(x, z)));
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('rendered terrain triangles (client chunk arrays) equal height() at 200 random points', () => {
    const g = data.terrain!, n = g.n;
    const a = buildTerrainChunkArrays(g, 0, 0, n - 1, n - 1, 1);
    const rnd = mulberry32(99);
    let worst = 0;
    for (let k = 0; k < 200; k++) {
      const x = -99 + rnd() * 198, z = -99 + rnd() * 198;
      const i = Math.floor((x - g.x0) / g.cell), j = Math.floor((z - g.z0) / g.cell);
      const base = (j * (n - 1) + i) * 6;
      let y: number | null = null;
      for (const t of [0, 3]) {
        const ids = [a.index[base + t], a.index[base + t + 1], a.index[base + t + 2]];
        const P = ids.map((v) => [a.position[v * 3], a.position[v * 3 + 1], a.position[v * 3 + 2]]);
        const d = (P[1][2] - P[2][2]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][2] - P[2][2]);
        const l0 = ((P[1][2] - P[2][2]) * (x - P[2][0]) + (P[2][0] - P[1][0]) * (z - P[2][2])) / d;
        const l1 = ((P[2][2] - P[0][2]) * (x - P[2][0]) + (P[0][0] - P[2][0]) * (z - P[2][2])) / d;
        const l2 = 1 - l0 - l1;
        if (l0 >= -1e-6 && l1 >= -1e-6 && l2 >= -1e-6) { y = l0 * P[0][1] + l1 * P[1][1] + l2 * P[2][1]; break; }
      }
      expect(y, `point not in cell triangles ${x},${z}`).not.toBeNull();
      worst = Math.max(worst, Math.abs(y! - data.height(x, z)));
    }
    expect(worst).toBeLessThan(0.001);
  });

  it('every prop collider is inside the outer bounds', () => {
    const b = data.bounds!;
    for (const p of data.props) {
      expect(p.x).toBeGreaterThan(b.minX - 5); expect(p.x).toBeLessThan(b.maxX + 5);
      expect(p.z).toBeGreaterThan(b.minZ - 12); expect(p.z).toBeLessThan(b.maxZ + 12);
    }
  });
});

describe('spawns', () => {
  it('both teams have spawns far apart, on walkable dry ground, >= 1.5 m from any prop', () => {
    const t0 = data.spawns.filter((s) => s.team === Team.Corgis), t1 = data.spawns.filter((s) => s.team === Team.Cats);
    expect(t0.length).toBeGreaterThanOrEqual(4);
    expect(t1.length).toBeGreaterThanOrEqual(4);
    for (const a of t0) for (const b of t1) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(100);
    for (const s of data.spawns) {
      const top = surfaceAt(data, s.x, s.z);
      expect(top.kind, `spawn ${s.x},${s.z} is on a prop`).toBe('terrain');
      expect(Math.abs(s.y - data.height(s.x, s.z))).toBeLessThan(0.1);
      expect(gridSlopeDeg(data.terrain!, s.x, s.z)).toBeLessThan(20);
      const w = waterAt(data, s.x, s.z);
      expect(!w || data.height(s.x, s.z) > w.surfaceY).toBe(true);
      expect(nearestPropDist(data, s.x, s.z), `spawn ${s.x},${s.z} too close to a prop`).toBeGreaterThanOrEqual(1.5);
      // faces into the map (toward the other half)
      const fz = -Math.cos(s.yaw);
      expect(s.team === Team.Corgis ? fz > 0 : fz < 0).toBe(true);
    }
  });

  it('a character spawned at every spawn settles grounded within 60 ticks', async () => {
    const sim = await Sim.create({ seed: 1, systems: coreSystems() });
    const ents = data.spawns.map((s, i) => sim.spawnCharacter({
      team: s.team, species: s.team === Team.Cats ? Species.Cat : Species.Corgi, cls: 'assault', name: `S${i}`, x: s.x, y: s.y, z: s.z, yaw: s.yaw,
    }));
    for (let i = 0; i < 60; i++) sim.step();
    ents.forEach((e, i) => {
      const s = data.spawns[i];
      expect(e.char!.grounded, `spawn ${i} not grounded`).toBe(true);
      expect(Math.abs(e.pos.y - data.height(s.x, s.z))).toBeLessThan(0.12);
      expect(Math.hypot(e.pos.x - s.x, e.pos.z - s.z)).toBeLessThan(0.3);
    });
    sim.dispose();
  });
});

describe('world systems', () => {
  it('the center trampoline launches a character (jump event, big air) and is single-jump reachable', async () => {
    const pad = data.jumpPads!.find((p) => p.id === 'center')!;
    expect(pad.y).toBeLessThan(1.45);   // corgi single jump ~1.47 m
    const sim = await Sim.create({ seed: 1, systems: coreSystems() });
    const e = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'Bouncy', x: pad.x + 1, y: pad.y + 1.2, z: pad.z, yaw: 0 });
    let peak = -Infinity, jumps = 0;
    for (let i = 0; i < 150; i++) {
      sim.step();
      peak = Math.max(peak, e.pos.y);
      for (const ev of sim.drainEvents()) if (ev.e === 'jump' && ev.id === e.id) jumps++;
    }
    expect(jumps).toBeGreaterThanOrEqual(1);
    expect(peak).toBeGreaterThan(pad.y + 4.5);
    sim.dispose();
  });

  it('water slows movement (pond wading < 60% of dry running distance)', async () => {
    const pond = data.water!.find((w) => w.id === 'pond')!;
    const sim = await Sim.create({ seed: 1, systems: coreSystems() });
    const wet = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'Wet', x: pond.x - 3, y: data.height(pond.x - 3, pond.z) + 0.1, z: pond.z, yaw: 0 });
    const dry = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'Dry', x: 0, y: data.height(0, -20) + 0.1, z: -20, yaw: 0 });
    for (let i = 0; i < 20; i++) sim.step();
    const w0 = { ...wet.pos }, d0 = { ...dry.pos };
    for (let i = 0; i < 60; i++) {
      for (const e of [wet, dry]) sim.setInput(e.id, { seq: i + 1, mx: 0, mz: 1, yaw: -Math.PI / 2, pitch: 0, buttons: Btn.Sprint, rt: 0 });
      sim.step();
    }
    const dw = Math.hypot(wet.pos.x - w0.x, wet.pos.z - w0.z), dd = Math.hypot(dry.pos.x - d0.x, dry.pos.z - d0.z);
    expect(dd).toBeGreaterThan(6);
    expect(dw).toBeGreaterThan(0.5);          // slowed, not stuck
    expect(dw / dd).toBeLessThan(0.6);
    expect(wet.pos.y).toBeLessThan(pond.surfaceY);
    sim.dispose();
  });

  it('out-of-bounds characters are returned to a spawn', async () => {
    const sim = await Sim.create({ seed: 1, systems: coreSystems() });
    const e = sim.spawnCharacter({ team: Team.Cats, species: Species.Cat, cls: 'assault', name: 'Lost', x: 140, y: 5, z: 0, yaw: 0 });
    sim.step();
    expect(Math.abs(e.pos.x)).toBeLessThan(100);
    expect(data.spawns.some((s) => Math.hypot(s.x - e.pos.x, s.z - e.pos.z) < 0.5 && s.team === Team.Cats)).toBe(true);
    sim.dispose();
  });

  it('a corgi can run up the deck stairs onto the deck (Corgi base verticality)', async () => {
    const sim = await Sim.create({ seed: 1, systems: coreSystems() });
    const e = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'Stairs', x: -53, y: data.height(-53, -72) + 0.1, z: -72, yaw: 0 });
    for (let i = 0; i < 20; i++) sim.step();
    for (let i = 0; i < 200; i++) { sim.setInput(e.id, { seq: i + 1, mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: 0, rt: 0 }); sim.step(); }
    expect(e.pos.z).toBeLessThan(-88);
    expect(e.pos.y).toBeGreaterThan(2.9);
    expect(e.pos.y).toBeLessThan(3.2);
    expect(e.char!.grounded).toBe(true);
    sim.dispose();
  });

  it('keeps a flat test world for other lanes', () => {
    const f = createFlatWorldData(3);
    expect(f.height(10, -4)).toBe(0);
    expect(f.props.length).toBe(6);
  });
});

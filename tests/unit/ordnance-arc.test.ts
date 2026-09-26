// W9 X4: an honest preview. The client's arc (throwLaunch + predictArc over the ArcWorld: the terrain collider's exact
// triangles + prop boxes/cylinders, no physics engine) against the authority's real flight (the same stepBody against
// Rapier), throw by throw: the first landing must agree within 5 cm on flat ground and on a slope (the card), and on
// bumpy terrain with rotated props and on both real maps too. The blast point (after the bounces) is reported and
// held to a looser bound (bounces amplify float noise). Also: solveThrow lands where it says.
import { describe, it, expect } from 'vitest';
import { Sim, type SimSystem } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Btn } from '../../src/shared/input';
import { Species, Team, type SpeciesId } from '../../src/shared/types';
import type { PropBox, PropCylinder, WorldData } from '../../src/shared/world/world-data';
import { createWorldData } from '../../src/shared/world/world-data';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem } from '../../src/sim/systems/core';
import { worldSystems } from '../../src/sim/world/systems';
import { combatSystems, liveOrdnance, ordnanceStats } from '../../src/sim/combat';
import {
  arcWorldOf, clampLaunch, makeArcResult, makeLaunch, makeSolve, ordnanceFor, predictArc, solveThrow, throwLaunch,
} from '../../src/shared/content/ordnance';

function gridWorld(name: string, h: (x: number, z: number) => number, props: PropBox[] = [], cylinders: PropCylinder[] = []): WorldData {
  const n = 101, cell = 1.2, x0 = -60;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = h(x0 + i * cell, x0 + j * cell);
  return {
    seed: 1, name, height: h, halfExtent: 58, killY: -40, props, cylinders,
    terrain: { x0, z0: x0, cell, n, heights },
    spawns: [{ x: 0, y: h(0, 0), z: 0, yaw: 0, team: Team.Corgis }, { x: 20, y: h(20, 0), z: 0, yaw: 0, team: Team.Cats }],
  };
}

const SYSTEMS = (): SimSystem[] => [movementSystem, ...worldSystems(), physicsStepSystem, ...combatSystems()];

interface Sample { land: number; blast: number; landed: boolean; onProp: boolean }

let seq = 1;
/** Throw from (x, z) with (yaw, pitch); returns |sim landing − predicted landing| and the same for the blast point. */
async function compare(sim: Sim, e: SimEntity, x: number, z: number, yaw: number, pitch: number): Promise<Sample> {
  const ground = sim.worldData.height(x, z);
  sim.placeCharacter(e, x, ground + 0.05, z);
  for (let i = 0; i < 20; i++) { sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw, pitch, buttons: 0, rt: 0 }); sim.step(); }
  e.ordCarry!.carry = true; e.ordCarry!.nextThrow = 0;
  sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw, pitch, buttons: Btn.Throw, rt: 0 }); sim.step();
  sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw, pitch, buttons: 0, rt: 0 });
  const before = ordnanceStats(sim).throws;
  sim.step(); // the release tick: the authority throws from e's state now
  expect(ordnanceStats(sim).throws).toBe(before + 1);
  // what the client computes from the same state (its predicted feet + its own view angles)
  const L = throwLaunch(e.pos.x, e.pos.y, e.pos.z, yaw, pitch, e.species as SpeciesId, makeLaunch());
  clampLaunch(arcWorldOf(sim.worldData), e.pos.x, e.pos.y, e.pos.z, e.species as SpeciesId, L); // a hand in a wall
  const pred = predictArc(arcWorldOf(sim.worldData), L, ordnanceFor(e.species as SpeciesId), makeArcResult());
  const g = liveOrdnance(sim)[liveOrdnance(sim).length - 1];
  const b = g.ordProj!.body;
  let bx = 0, by = 0, bz = 0;
  while (!g.removed) { bx = b.x; by = b.y; bz = b.z; sim.step(); }
  sim.drainEvents(); sim.removedIds.length = 0;
  if (!b.landed || !pred.landed) return { land: b.landed === pred.landed ? 0 : Infinity, blast: 0, landed: false, onProp: false };
  return {
    onProp: b.ly > sim.worldData.height(b.lx, b.lz) + 0.05 || b.lny < 0.5,
    land: Math.hypot(b.lx - pred.lx, b.ly - pred.ly, b.lz - pred.lz),
    blast: Math.hypot(bx - pred.bx, by - pred.by, bz - pred.bz),
    landed: true,
  };
}

async function sweep(world: WorldData, spots: [number, number][], species: SpeciesId = Species.Corgi): Promise<{ land: number[]; blast: number[]; props: number }> {
  const sim = await Sim.create({ seed: 3, world, systems: SYSTEMS() });
  sim.state.ordnanceConfig = { enabled: true };
  const e = sim.spawnCharacter({ team: species === Species.Cat ? Team.Cats : Team.Corgis, species, cls: 'assault', name: 'thrower', x: 0, y: world.height(0, 0) + 0.05, z: 0, ownerPid: 'p' });
  sim.step();
  const land: number[] = [], blast: number[] = [];
  let props = 0;
  for (const [x, z] of spots) {
    for (let yi = 0; yi < 6; yi++) for (const pitch of [-0.35, 0.05, 0.45, 0.9]) {
      const r = await compare(sim, e, x, z, (yi / 6) * Math.PI * 2 + 0.3, pitch);
      if (r.landed) { land.push(r.land); blast.push(r.blast); if (r.onProp) props++; }
      else expect(r.land).toBe(0); // both agree it never landed
    }
  }
  return { land, blast, props };
}
const max = (a: number[]) => a.reduce((m, v) => Math.max(m, v), 0);

describe('X4 arc preview vs the authority', () => {
  it('flat ground: every landing within 5 cm', async () => {
    const r = await sweep(gridWorld('flat', () => 0), [[0, 0], [7, -5]]);
    expect(r.land.length).toBeGreaterThan(30);
    expect(max(r.land)).toBeLessThan(0.05);
    expect(max(r.blast)).toBeLessThan(0.3);
    console.log(`[X4 arc] flat: ${r.land.length} throws, landing max ${(max(r.land) * 100).toFixed(2)} cm, blast max ${(max(r.blast) * 100).toFixed(1)} cm`);
  });

  it('a 14° slope (both factions): every landing within 5 cm', async () => {
    const slope = (x: number, z: number) => 0.25 * x + 0.05 * z;
    for (const sp of [Species.Corgi, Species.Cat] as SpeciesId[]) {
      const r = await sweep(gridWorld('slope', slope), [[0, 0], [-6, 8]], sp);
      expect(r.land.length).toBeGreaterThan(30);
      expect(max(r.land)).toBeLessThan(0.05);
      expect(max(r.blast)).toBeLessThan(0.3);
      console.log(`[X4 arc] slope ${sp ? 'hairball' : 'squeaker'}: ${r.land.length} throws, landing max ${(max(r.land) * 100).toFixed(2)} cm, blast max ${(max(r.blast) * 100).toFixed(1)} cm`);
    }
  });

  it('bumpy terrain with a rotated wall, a pitched ramp and a drum: landings within 5 cm', async () => {
    const bumps = (x: number, z: number) => 1.4 * Math.sin(x / 7) * Math.cos(z / 6) + 0.1 * x;
    const props: PropBox[] = [
      { type: 'wall', x: 9, y: bumps(9, -2) + 1.2, z: -2, hx: 0.3, hy: 1.6, hz: 3, rotY: 0.5 },
      { type: 'ramp', x: -8, y: bumps(-8, -6) + 0.6, z: -6, hx: 2, hy: 0.2, hz: 3, rotY: -0.3, pitch: 0.35 },
      { type: 'crate', x: 3, y: bumps(3, 9) + 0.7, z: 9, hx: 0.8, hy: 0.8, hz: 0.8, rotY: 0.8, roll: 0.2 },
    ];
    const cyl: PropCylinder[] = [{ type: 'drum', x: -4, y: bumps(-4, 7) + 0.9, z: 7, r: 0.7, hh: 1.1 }];
    const r = await sweep(gridWorld('bumpy', bumps, props, cyl), [[0, 0], [2, 3], [6, -1], [-5, 4], [-6, -3]]);
    expect(r.land.length).toBeGreaterThan(30);
    expect(max(r.land)).toBeLessThan(0.05);
    expect(r.props).toBeGreaterThan(3);
    console.log(`[X4 arc] bumpy + props: ${r.land.length} throws (${r.props} first touch a prop), landing max ${(max(r.land) * 100).toFixed(2)} cm, blast max ${(max(r.blast) * 100).toFixed(1)} cm`);
  });

  it('the real maps (West Yard, The Lot, props and all): every landing within 5 cm', async () => {
    for (const map of ['west_yard', 'the_lot']) {
      const w = createWorldData(1, map);
      const s = w.spawns;
      const spots: [number, number][] = [[s[0].x, s[0].z], [s[s.length - 1].x, s[s.length - 1].z], [0, 0], [12, -20]];
      const r = await sweep(w, spots);
      const ok = r.land.filter((d) => d < 0.05).length;
      expect(r.props).toBeGreaterThan(3);
      console.log(`[X4 arc] ${map}: ${r.land.length} throws (${r.props} first touch a prop), ${ok} within 5 cm, median ${(r.land.slice().sort((a, b) => a - b)[r.land.length >> 1] * 100).toFixed(2)} cm, max ${(max(r.land) * 100).toFixed(1)} cm`);
      expect(r.land.length).toBeGreaterThan(50);
      expect(ok).toBe(r.land.length);
    }
  }, 120_000);

  it('solveThrow lands where it says, low arc first, and finds the lob over a wall', () => {
    const w = gridWorld('solve', (x) => 0.08 * x, [{ type: 'wall', x: 0, y: 1.8, z: -8, hx: 6, hy: 1.8, hz: 0.3, rotY: 0 }]);
    const aw = arcWorldOf(w);
    const s = makeSolve(), arc = makeArcResult(), L = makeLaunch();
    for (const [tx, tz] of [[4, 12], [-9, 15], [14, 3], [0, 21]] as [number, number][]) {
      expect(solveThrow(aw, 0, 0, 0, Species.Corgi, tx, w.height(tx, tz), tz, s)).toBe(true);
      predictArc(aw, throwLaunch(0, 0, 0, s.yaw, s.pitch, Species.Corgi, L), ordnanceFor(Species.Corgi), arc);
      expect(Math.hypot(arc.lx - tx, arc.lz - tz)).toBeLessThan(0.3);
      expect(s.pitch + ordnanceFor(Species.Corgi).lob).toBeLessThan(Math.PI / 4 + 0.05); // the low arc
    }
    // 20 m out behind the 3.6 m wall at z = -8: the low arc clips it, the lob gets there
    expect(solveThrow(aw, 0, 0, 0, Species.Corgi, 0, w.height(0, -20), -20, s)).toBe(true);
    expect(s.pitch + ordnanceFor(Species.Corgi).lob).toBeGreaterThan(Math.PI / 4);
    predictArc(aw, throwLaunch(0, 0, 0, s.yaw, s.pitch, Species.Corgi, L), ordnanceFor(Species.Corgi), arc);
    expect(Math.hypot(arc.lx, arc.lz + 20)).toBeLessThan(0.3);
    // 13 m behind it can't be reached inside the fuse (a steeper lob stays up longer than 2.2 s): no throw
    expect(solveThrow(aw, 0, 0, 0, Species.Corgi, 0, w.height(0, -13), -13, s)).toBe(false);
    // out of reach
    expect(solveThrow(aw, 0, 0, 0, Species.Corgi, 0, 0, 40, s)).toBe(false);
  });
});

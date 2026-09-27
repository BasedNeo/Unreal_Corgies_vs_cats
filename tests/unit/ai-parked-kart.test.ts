// W9 F2 (mode-1, Q4 P2-2): a parked kart is a nav fixture (src/sim/vehicles/parked.ts), so bots route round it
// instead of pressing into it. Q4's case: two bots pinned 8 and 11 s between an FOB box and a kart left in a capture
// ring, because the grid still showed the gap the kart had closed. The test is the finding's own: a kart parked in the
// only opening of a wall across a bot's route.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Team, Species, EntityKind } from '../../src/shared/types';
import type { WorldData } from '../../src/shared/world/world-data';
import type { PropBox } from '../../src/shared/world/world-types';
import { TICK_HZ } from '../../src/shared/constants';
import { spawnKart, mountKart, destroyKart } from '../../src/sim/vehicles';
import { parkedKarts } from '../../src/sim/vehicles/parked';
import { cellIndex, navGridFor } from '../../src/sim/ai/nav';
import { ensureBrain } from '../../src/sim/ai/brain';

/** A flat yard with a 40 m wall across z = 0 and one 2.4 m opening at x = 0. */
function yard(): WorldData {
  const n = 81, cell = 2;
  const wall = (x0: number, x1: number): PropBox => ({ type: 'wall', x: (x0 + x1) / 2, y: 1, z: 0, hx: (x1 - x0) / 2, hy: 1, hz: 0.3, rotY: 0 });
  return {
    seed: 1, name: 'parked kart test yard', height: () => 0, halfExtent: 80, killY: -30, props: [wall(-20, -1.2), wall(1.2, 20)],
    terrain: { x0: -80, z0: -80, cell, n, heights: new Float32Array(n * n) },
    spawns: [{ x: 0, y: 0, z: 40, yaw: 0, team: Team.Corgis }, { x: 0, y: 0, z: -40, yaw: Math.PI, team: Team.Cats }],
  } as WorldData;
}

/** The soak's stuck rule: wants to move (|input| > 0.5 for 90 % of a 0.5 s window) but moves < 0.25 m. */
function stuckMeter(e: SimEntity) {
  let px = e.pos.x, pz = e.pos.z, odo = 0, want = 0, n = 0, stuck = 0, max = 0;
  return {
    tick() {
      odo += Math.hypot(e.pos.x - px, e.pos.z - pz); px = e.pos.x; pz = e.pos.z;
      if (!e.dead && Math.hypot(e.input.mx, e.input.mz) > 0.5) want++;
      if (++n >= 30) { stuck = !e.dead && want >= 27 && odo < 0.25 ? stuck + 0.5 : 0; max = Math.max(max, stuck); odo = 0; want = 0; n = 0; }
    },
    get max() { return max; },
  };
}

const step = (sim: Sim, seconds: number, each?: () => void) => {
  for (let i = 0; i < Math.round(seconds * TICK_HZ); i++) { each?.(); sim.step(); sim.drainEvents(); }
};

describe('F2 parked karts are nav fixtures (Q4 P2-2)', () => {
  it('a kart parked in the only opening: the bot walks round the wall instead of pinning itself on the kart', async () => {
    const sim = await Sim.create({ seed: 2, world: yard() });
    sim.state.aiConfig = { vehicles: false };
    sim.step();
    const kart = spawnKart(sim, 'mower_kart', Team.Cats, 0, 0, 0, 0);
    step(sim, 0.5);
    expect(parkedKarts(sim)).toEqual([]); // not yet: a kart counts as parked after 1 s at rest
    step(sim, 0.7);
    expect(parkedKarts(sim)).toEqual([kart.id]);
    const g = navGridFor(sim);
    expect(g.walk[cellIndex(g, 0, 0)]).toBe(0); // the opening is closed on this sim's grid
    // a corgi bot 12 m north of the opening wants to go 12 m south of it
    const b = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'runner', x: 0, y: 0.02, z: 12, yaw: 0 });
    const ai = ensureBrain(b);
    const meter = stuckMeter(b);
    let arrived = -1, closest = Infinity;
    step(sim, 30, () => {
      ai.hasGoal = true; ai.goalX = 0; ai.goalZ = -12; ai.waitUntil = sim.tick + 999; // (keep this goal)
      meter.tick();
      closest = Math.min(closest, Math.hypot(b.pos.x - kart.pos.x, b.pos.z - kart.pos.z));
      if (arrived < 0 && Math.hypot(b.pos.x, b.pos.z + 12) < 2) arrived = sim.time;
    });
    expect(arrived).toBeGreaterThan(0);
    expect(meter.max).toBeLessThanOrEqual(1);
    // it routed round the wall's ends: never pressed into the kart, never hopped over it (without the fixture: 0.04 m,
    // on top of it, after a stuck second and a jump)
    expect(closest).toBeGreaterThan(2);
    expect(Math.abs(kart.pos.x) + Math.abs(kart.pos.z)).toBeLessThan(0.2); // it went round, it didn't shove the kart
  });

  it('a ridden kart is never parked; the footprint goes when the kart is destroyed', async () => {
    const sim = await Sim.create({ seed: 2, world: yard() });
    sim.state.aiConfig = { vehicles: false };
    sim.step();
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, 10, 0, 10, 0);
    const rider = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'rider', x: 11.5, y: 0.02, z: 10, yaw: 0 });
    step(sim, 0.3);
    expect(mountKart(sim, kart, rider)).toBe(true);
    step(sim, 2);
    expect(parkedKarts(sim)).toEqual([]); // ridden: never parked
    const k2 = spawnKart(sim, 'mower_kart', Team.Corgis, -10, 0, 10, 0);
    step(sim, 1.2);
    expect(parkedKarts(sim)).toEqual([k2.id]);
    const g = navGridFor(sim); // (this sim's own grid: it exists once a fixture does)
    expect(g.walk[cellIndex(g, -10, 10)]).toBe(0);
    destroyKart(sim, k2);
    step(sim, 1 / 60);
    expect(parkedKarts(sim)).toEqual([]);
    expect(navGridFor(sim).walk[cellIndex(g, -10, 10)]).toBe(1);
  });
});

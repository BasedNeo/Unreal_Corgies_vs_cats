// W9 F2 (mode-1): a bot pressed against something the nav grid keeps in the next cell steps straight away from it
// before re-planning (brain.ts unhug). Q4's lanes run found a cat pinned 6.5 s on The Lot's heap top: the scaffold's
// diagonal facade brace dips to the heap beside a one-cell walkway (a steep drop on the other side); the probe at the
// cell centre clears the brace, the pet's body at the cell edge does not, and the brace's underside is a ceiling the
// character controller cannot slide along. The random detour kept picking cells along the same row. The test is that
// walkway: a wall on one side, a rolled brace on the other, a bot sent along the brace side.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Team, Species, EntityKind } from '../../src/shared/types';
import type { WorldData } from '../../src/shared/world/world-data';
import type { PropBox } from '../../src/shared/world/world-types';
import { TICK_HZ } from '../../src/shared/constants';
import { cellIndex, navGridFor } from '../../src/sim/ai/nav';
import { ensureBrain } from '../../src/sim/ai/brain';

/** Flat ground; a wall along z = -0.5 (row z -1..0 closed) and a brace from the ground at x = -5 to 4 m up at x = +5,
 *  z = 1.15 (its low half closes row z 1..2). Row z 0..1 is the walkway: open, 1 m wide. */
function walkway(): WorldData {
  const n = 81, cell = 1;
  const len = Math.hypot(10, 4);
  const props: PropBox[] = [
    { type: 'wall', x: 0, y: 1, z: -0.5, hx: 20, hy: 1, hz: 0.3, rotY: 0 },
    { type: 'brace', x: 0, y: 2, z: 1.15, hx: len / 2, hy: 0.1, hz: 0.1, rotY: 0, roll: Math.atan2(4, 10) },
  ];
  return {
    seed: 1, name: 'unhug test walkway', height: () => 0, halfExtent: 40, killY: -30, props,
    terrain: { x0: -40, z0: -40, cell, n, heights: new Float32Array(n * n) },
    spawns: [{ x: 0, y: 0, z: 20, yaw: 0, team: Team.Corgis }, { x: 0, y: 0, z: -20, yaw: Math.PI, team: Team.Cats }],
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

describe('F2 a bot pinned by an obstacle beside its row steps away from it (brain unhug)', () => {
  it('walking the walkway along the brace side: the first detour steps straight off the brace, and the bot is through in 5 s (3 seeds)', async () => {
    for (const seed of [1, 2, 3]) {
      const sim = await Sim.create({ seed, world: walkway() });
      sim.state.aiConfig = { vehicles: false };
      sim.step();
      const g = navGridFor(sim);
      // the premise: the walkway row is open under the brace's low half, the rows either side of it closed
      expect(g.walk[cellIndex(g, -3, 0.5)]).toBe(1);
      expect(g.walk[cellIndex(g, -3, 1.5)]).toBe(0);
      expect(g.walk[cellIndex(g, -3, -0.5)]).toBe(0);
      // a corgi bot on the walkway's brace-side edge (a path line from elsewhere put it there), sent west along it
      const b = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'walker', x: 2, y: 0.02, z: 0.97, yaw: 0 });
      const ai = ensureBrain(b);
      const meter = stuckMeter(b);
      let arrived = -1, first: { x: number; z: number; dx: number; dz: number } | null = null;
      for (let i = 0; i < 20 * TICK_HZ && arrived < 0; i++) {
        ai.hasGoal = true; ai.goalX = -12; ai.goalZ = 0.97; ai.waitUntil = sim.tick + 999; // (keep this goal)
        const was = ai.detourUntil;
        sim.step(); sim.drainEvents();
        meter.tick();
        if (!first && ai.detourUntil !== was && ai.detourUntil > sim.tick) first = { x: b.pos.x, z: b.pos.z, dx: ai.detourX, dz: ai.detourZ };
        if (Math.hypot(b.pos.x + 12, b.pos.z - 0.97) < 1.5) arrived = sim.time;
      }
      // pinned under the brace's low half (it cannot slide along the underside), then one step straight off it
      expect(first, `seed ${seed}`).not.toBeNull();
      expect(first!.x, `seed ${seed}`).toBeLessThan(-1);
      expect(Math.abs(first!.dx - first!.x), `seed ${seed}`).toBeLessThan(0.1);
      expect(first!.dz, `seed ${seed}`).toBeLessThan(first!.z - 0.9);
      // through in 5 s (without the step-away: random detours, back into the brace, 9.7 / 5.7 / 9.5 s)
      expect(meter.max, `seed ${seed}`).toBeLessThanOrEqual(2);
      expect(arrived, `seed ${seed}`).toBeGreaterThan(0);
      expect(arrived, `seed ${seed}`).toBeLessThan(5);
      sim.dispose();
    }
  });
});

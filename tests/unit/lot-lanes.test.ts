// W9 L3 (M5) on The Lot: bots use all three lanes (src/sim/ai/lanes.ts, lot/layout.ts LOT_LANES).
//   - the pick is a pure, deterministic function of (world seed, bot, life) and follows the weights;
//   - every waypoint stands on walkable ground in the main nav region and each leg is a grid path (both directions);
//   - who walks lanes: TDM room bots, not marksmen (they take the perches), not PvE waves; the West Yard has no lanes;
//   - a 14v14 TDM, pooled over 4 seeds (bot statistics are chaotic: KNOWLEDGE.md §8): bot-seconds in Container Canyon
//     and in the Pipeworks are each >= 25 % of the Mud's (W8 without lanes: 26 and 31 against 599), bots that reach the
//     far end sweep back along another lane, marksmen hold all four perches (autoPerch, N1 links), kills happen and
//     nobody is stuck > 5 s.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { navGridFor, findPath, nearestWalkable, cellX, cellZ, type NavGrid } from '../../src/sim/ai/nav';
import { LANES_BY_MAP, LANE_MODES, laneRunOf, lanesFor, pickLane } from '../../src/sim/ai/lanes';
import { LOT_LANES, LOT_NAME } from '../../src/shared/world/lot/layout';
import { districtAt } from '../../src/shared/world/queries';
import { EntityKind } from '../../src/shared/types';
import type { SimEntity } from '../../src/sim/entity';

describe('lanes: the pick', () => {
  it('is deterministic per (seed, bot, life) and follows the weights', () => {
    // F2 (Q4 P2-5): the paths are LOT_LANES', the weights lanes.ts's tuned set
    const LANES = LANES_BY_MAP[LOT_NAME];
    expect(LANES.map((l) => [l.id, l.pts])).toEqual(LOT_LANES.map((l) => [l.id, l.pts]));
    expect([...LANE_MODES]).toEqual(['team-deathmatch']);
    const total = LANES.reduce((a, l) => a + l.weight, 0);
    expect(total).toBeCloseTo(1, 6);
    const n = new Array<number>(LANES.length).fill(0);
    for (let id = 0; id < 400; id++) for (let life = 0; life < 20; life++) {
      const k = pickLane(LANES, 1, id, life * 317);
      expect(pickLane(LANES, 1, id, life * 317)).toBe(k);
      n[k]++;
    }
    for (const [i, l] of LANES.entries()) expect(Math.abs(n[i] / 8000 - l.weight), l.id).toBeLessThan(0.03);
    // another seed deals other lanes
    let same = 0;
    for (let id = 0; id < 200; id++) if (pickLane(LANES, 1, id, 0) === pickLane(LANES, 2, id, 0)) same++;
    expect(same).toBeLessThan(120);
  });
});

describe('lanes: The Lot geometry', () => {
  let sim: Sim;
  let g: NavGrid;
  beforeAll(async () => {
    sim = await Sim.create({ seed: 1, map: 'the_lot' });
    sim.step();
    g = navGridFor(sim);
  }, 120_000);
  afterAll(() => sim.dispose());

  it('every waypoint is walkable ground in the main region; every leg is a grid path, both ways', () => {
    expect(lanesFor(sim)).toBe(LANES_BY_MAP[LOT_NAME]);
    const out: number[] = [];
    for (const l of LOT_LANES) {
      for (const [x, z] of l.pts) {
        const c = nearestWalkable(g, x, z, 1);
        expect(c, `${l.id} ${x},${z}`).toBeGreaterThanOrEqual(0);
        expect(g.region[c], `${l.id} ${x},${z}`).toBe(g.mainRegion);
        expect(Math.hypot(cellX(g, c) - x, cellZ(g, c) - z)).toBeLessThan(1.2);
      }
      for (let i = 1; i < l.pts.length; i++) {
        const [ax, az] = l.pts[i - 1], [bx, bz] = l.pts[i];
        expect(findPath(g, ax, az, bx, bz, out), `${l.id} leg ${i}`).toBe(true);
        expect(findPath(g, bx, bz, ax, az, out), `${l.id} leg ${i} back`).toBe(true);
      }
    }
    // the lanes cross the lanes' districts
    const seen = new Set<string>();
    for (const l of LOT_LANES) for (const [x, z] of l.pts) seen.add(districtAt(sim.worldData, x, z)?.id ?? '');
    for (const d of ['lot_canyon', 'lot_mud', 'lot_pipeworks']) expect(seen.has(d), d).toBe(true);
  });
});

describe('lanes: who walks them', () => {
  it('TDM room bots on The Lot, never marksmen or wave cats; no lanes on the West Yard or outside TDM', async () => {
    for (const [map, mode, expectLanes] of [['the_lot', 'team-deathmatch', true], ['the_lot', 'core-rush', false], ['west_yard', 'team-deathmatch', false]] as const) {
      const sim = await Sim.create({ seed: 3, map });
      const room = new Room(sim, { mode, botsPerTeam: [6, 6] });
      for (let i = 0; i < 60 * 8; i++) room.tick();
      let walkers = 0;
      for (const e of sim.entities.values()) {
        if (e.kind !== EntityKind.Bot || !e.char) continue;
        const r = laneRunOf(e), arch = (e.ai as { arch?: string } | undefined)?.arch;
        if (r) walkers++;
        if (arch === 'marksman') expect(r, `${map} ${mode} marksman`).toBeNull();
      }
      if (expectLanes) expect(walkers, `${map} ${mode}`).toBeGreaterThanOrEqual(8); else expect(walkers, `${map} ${mode}`).toBe(0);
      room.dispose();
    }
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------ the 14v14 statistic

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

describe('lanes: a 14v14 TDM on The Lot uses all three lanes', () => {
  it('canyon and pipeworks bot-seconds each >= 25 % of the Mud\'s (4 seeds pooled); marksmen hold all four perches', async () => {
    const WARM = 5 * 60, LIVE = 90 * 60;
    const pool = new Map<string, number>(), perched = new Map<string, number>();
    const rows: string[] = [];
    let deaths = 0, stuckMax = 0, sweeps = 0;
    for (const seed of [1, 2, 3, 4]) {
      const sim = await Sim.create({ seed, map: 'the_lot' });
      const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [14, 14] });
      const drain = sim.drainEvents.bind(sim);
      let d = 0;
      sim.drainEvents = () => { const ev = drain(); for (const x of ev) if (x.e === 'death') d++; return ev; };
      const per = new Map<string, number>();
      const meters = new Map<number, ReturnType<typeof stuckMeter>>();
      for (let i = 0; i < WARM + LIVE; i++) {
        room.tick();
        for (const e of sim.entities.values()) {
          if (!e.char || e.kind !== EntityKind.Bot) continue;
          let m = meters.get(e.id);
          if (!m) { m = stuckMeter(e); meters.set(e.id, m); }
          m.tick();
          if (i < WARM || i % 30 || e.dead) continue;
          const k = districtAt(sim.worldData, e.pos.x, e.pos.z)?.name ?? 'open ground';
          per.set(k, (per.get(k) ?? 0) + 0.5);
          const p = (e.ai as { perch?: { id: string; reachedAt: number } | null } | undefined)?.perch;
          if (p && p.reachedAt >= 0) perched.set(p.id, (perched.get(p.id) ?? 0) + 0.5);
        }
      }
      for (const m of meters.values()) stuckMax = Math.max(stuckMax, m.max);
      for (const e of sim.entities.values()) if ((laneRunOf(e)?.leg ?? 0) > 0) sweeps++;
      for (const [k, v] of per) pool.set(k, (pool.get(k) ?? 0) + v);
      deaths += d;
      const g = (k: string) => per.get(k) ?? 0;
      rows.push(`seed ${seed}: deaths ${d}, Mud ${g('The Mud')}, Canyon ${g('Container Canyon')}, Pipeworks ${g('The Pipeworks')}`);
      room.dispose();
    }
    const g = (k: string) => pool.get(k) ?? 0;
    const mud = g('The Mud'), canyon = g('Container Canyon'), pipes = g('The Pipeworks');
    console.log(`[l3-lanes] ${rows.join(' · ')}\n[l3-lanes] pooled: Mud ${mud} · Canyon ${canyon} (${(canyon / mud).toFixed(2)}) · Pipeworks ${pipes} (${(pipes / mud).toFixed(2)}) · all: ${[...pool].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}\n[l3-lanes] perched bot-s: ${[...perched].map(([k, v]) => `${k} ${v}`).join(' · ')} · deaths ${deaths} · stuck max ${stuckMax} s · bots on a sweep-back leg at the end ${sweeps}`);
    expect(canyon / mud).toBeGreaterThanOrEqual(0.25);
    expect(pipes / mud).toBeGreaterThanOrEqual(0.25);
    for (const id of ['lot_container_roof', 'lot_scaffold_deck', 'lot_scaffold_nest', 'lot_pipe_crown']) expect(perched.get(id) ?? 0, id).toBeGreaterThan(0);
    expect(sweeps, 'bots sweeping back along a second lane').toBeGreaterThan(0);
    expect(deaths).toBeGreaterThan(40);
    expect(stuckMax).toBeLessThanOrEqual(5);
  }, 900_000);
});

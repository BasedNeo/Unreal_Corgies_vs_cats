// W10 N3 (ai-3): thin obstacles in the nav grid (src/sim/ai/nav.ts thinObstacleCells). The grid's probe is a capsule at
// the cell CENTRE from 0.45 m up; it missed the West Yard hedgehogs' 0.2 m beams wherever they crossed a cell away from
// its centre or low under its floor (F1 §7: 1-3 of a hedgehog's 7-9 beam cells were closed), so bots pathed into a
// hedgehog's reach and pinned there 1-4 s. Beams, posts and poles are now rasterized: every cell whose body column they
// cross closes. The tests:
//   - the West Yard: every cell a hedgehog beam crosses at body height is closed (an independent oracle: points sampled
//     inside the beams), and the thin pass closes nothing a thin prop does not reach (no inflation);
//   - the semantics on a flat yard: a pole on a cell corner, a knee-high beam, a beam beside a row, thick props untouched;
//   - behaviour: a bot sent straight through the West Yard's own hedgehog walks round it (4 placements x 8 headings x both
//     species: HEAD c783329 took up to 12.6 s, 14 of 64 over 4 s, 6 touching a beam; now all within 2.5 s, none touching);
//   - karts still drive out through both kart gates past the hedgehog that frames them;
//   - cost: the pass is a small fraction of a grid build (the build runs once per world; nothing runs per tick).
// Mutation-checked: with buildNavGrid's thin loop removed the oracle, pole, knee-beam and walk-round tests fail.
import os from 'node:os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Team, Species, EntityKind, type SpeciesId } from '../../src/shared/types';
import type { WorldData } from '../../src/shared/world/world-data';
import type { PropBox, PropCylinder } from '../../src/shared/world/world-types';
import { TICK_HZ } from '../../src/shared/constants';
import { MAPS } from '../../src/shared/world/maps';
import { moveStatsFor } from '../../src/shared/content/classes';
import {
  buildNavGrid, cellIndex, isThinBox, isThinCylinder, navGridFor, thinObstacleCells, THIN_FLOOR, type NavGrid,
} from '../../src/sim/ai/nav';
import { findDrivePath, kartNavFor } from '../../src/sim/ai/drive';
import { findTerminalSite } from '../../src/sim/vehicles/sites';
import { ensureBrain } from '../../src/sim/ai/brain';
import { WORLD_RAY_FILTER } from '../../src/sim/combat/geometry';
import { isStaticWorldCollider, isTerrainCollider } from '../../src/sim/world/build';

/** The probe's top over the ground (nav.ts: CLEARANCE + the capsule's height). */
const PROBE_TOP = 0.45 + 2 * (0.42 + 0.12);

/** World point of a box's local point (rotation YXZ: yaw, then pitch about local x, then roll about local z). */
function boxPoint(p: PropBox, u: number, v: number, w: number): [number, number, number] {
  const cy = Math.cos(p.rotY), sy = Math.sin(p.rotY), cp = Math.cos(p.pitch ?? 0), sp = Math.sin(p.pitch ?? 0), cr = Math.cos(p.roll ?? 0), sr = Math.sin(p.roll ?? 0);
  // Rz(roll)
  const x1 = u * cr - v * sr, y1 = u * sr + v * cr, z1 = w;
  // Rx(pitch)
  const x2 = x1, y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
  // Ry(yaw)
  return [p.x + x2 * cy + z2 * sy, p.y + y2, p.z - x2 * sy + z2 * cy];
}

/** The oracle: cells holding a point sampled inside the box (a ~4 cm lattice) at body height over that cell's ground. */
function sampledCells(g: NavGrid, p: PropBox): Set<number> {
  const out = new Set<number>();
  const n = (h: number) => Math.max(2, Math.ceil((2 * h) / 0.04));
  const nu = n(p.hx), nv = n(p.hy), nw = n(p.hz);
  for (let a = 0; a <= nu; a++) for (let b = 0; b <= nv; b++) for (let c = 0; c <= nw; c++) {
    const [x, y, z] = boxPoint(p, -p.hx + (2 * p.hx * a) / nu, -p.hy + (2 * p.hy * b) / nv, -p.hz + (2 * p.hz * c) / nw);
    const i = cellIndex(g, x, z);
    if (i < 0) continue;
    const dy = y - g.ground[i];
    if (dy >= THIN_FLOOR && dy <= PROBE_TOP) out.add(i);
  }
  return out;
}

/** Hedgehogs of a world: their beams grouped by centre. */
function hedgehogs(d: WorldData): { x: number; z: number; beams: PropBox[] }[] {
  const out: { x: number; z: number; beams: PropBox[] }[] = [];
  for (const p of d.props) {
    if (p.type !== 'fob_hedgehog') continue;
    let h = out.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1);
    if (!h) { h = { x: p.x, z: p.z, beams: [] }; out.push(h); }
    h.beams.push(p);
  }
  return out;
}

/** A flat test yard (1 m terrain cells at height 0) with these props. */
function flat(props: PropBox[], cylinders: PropCylinder[] = [], name = 'n3 flat yard'): WorldData {
  const n = 81;
  return {
    seed: 1, name, height: () => 0, halfExtent: 40, killY: -30, props, cylinders,
    terrain: { x0: -40, z0: -40, cell: 1, n, heights: new Float32Array(n * n) },
    spawns: [{ x: 0, y: 0, z: 30, yaw: 0, team: Team.Corgis }, { x: 0, y: 0, z: -30, yaw: Math.PI, team: Team.Cats }],
  } as WorldData;
}

async function gridOf(world: WorldData): Promise<{ sim: Sim; g: NavGrid }> {
  const sim = await Sim.create({ seed: 1, world });
  sim.state.aiConfig = { vehicles: false };
  sim.step();
  return { sim, g: navGridFor(sim) };
}

const walkAt = (g: NavGrid, x: number, z: number) => g.walk[cellIndex(g, x, z)];

// ------------------------------------------------------------------------------------------------ the West Yard

describe('N3 the West Yard: hedgehog beams close the cells they cross', () => {
  let sim: Sim;
  let g: NavGrid;
  beforeAll(async () => {
    sim = await Sim.create({ seed: 1, map: 'west_yard' });
    sim.step();
    g = navGridFor(sim);
  }, 120_000);
  afterAll(() => sim.dispose());

  it('every cell a beam of the six hedgehogs crosses at body height is closed (sampled oracle)', () => {
    const hogs = hedgehogs(sim.worldData);
    expect(hogs.length).toBe(6);
    const rows: string[] = [];
    for (const h of hogs) {
      expect(h.beams.length).toBe(3);
      const cells = new Set<number>();
      for (const b of h.beams) for (const i of sampledCells(g, b)) cells.add(i);
      // a hedgehog's beams cross 5-9 cells at body height (the probe alone closed 1-3 of them)
      expect(cells.size, `hedgehog at ${h.x.toFixed(1)}, ${h.z.toFixed(1)}`).toBeGreaterThanOrEqual(5);
      const open = [...cells].filter((i) => g.walk[i]);
      rows.push(`(${h.x.toFixed(1)}, ${h.z.toFixed(1)}) ${cells.size} cells`);
      expect(open.length, `hedgehog at ${h.x.toFixed(1)}, ${h.z.toFixed(1)}: beam cells left open`).toBe(0);
    }
    console.log(`[n3] hedgehog beam cells: ${rows.join(' · ')} · thin pass closed ${g.thin} cells on the West Yard`);
  });

  it('the thin pass closes only cells a thin prop reaches (no inflation): each is within 5 cm of a sampled point', () => {
    const cells = thinObstacleCells(sim.worldData, g);
    expect(cells.length).toBeGreaterThan(0);
    // the oracle over every thin prop, with the cell grown by the lattice step (a sample can miss a sliver)
    const near = new Set<number>();
    const grow = 0.05;
    for (const p of sim.worldData.props) {
      if (!isThinBox(p)) continue;
      const n = (h: number) => Math.max(2, Math.ceil((2 * h) / 0.04));
      const nu = n(p.hx), nv = n(p.hy), nw = n(p.hz);
      for (let a = 0; a <= nu; a++) for (let b = 0; b <= nv; b++) for (let c = 0; c <= nw; c++) {
        const [x, y, z] = boxPoint(p, -p.hx + (2 * p.hx * a) / nu, -p.hy + (2 * p.hy * b) / nv, -p.hz + (2 * p.hz * c) / nw);
        for (const dx of [-grow, 0, grow]) for (const dz of [-grow, 0, grow]) {
          const i = cellIndex(g, x + dx, z + dz);
          if (i < 0) continue;
          const dy = y - g.ground[i];
          if (dy >= THIN_FLOOR - grow && dy <= PROBE_TOP + grow) near.add(i);
        }
      }
    }
    for (const c of sim.worldData.cylinders ?? []) {
      if (!isThinCylinder(c)) continue;
      for (let k = 0; k < 32; k++) for (const rr of [0, 0.5, 1]) {
        const x = c.x + Math.cos((k / 32) * 2 * Math.PI) * (c.r + grow) * rr, z = c.z + Math.sin((k / 32) * 2 * Math.PI) * (c.r + grow) * rr;
        const i = cellIndex(g, x, z);
        if (i >= 0 && c.y - c.hh <= g.ground[i] + PROBE_TOP && c.y + c.hh >= g.ground[i] + THIN_FLOOR) near.add(i);
      }
    }
    const far = [...cells].filter((i) => !near.has(i));
    expect(far.length, `cells closed with no thin prop within ${grow} m`).toBe(0);
  });

  it('karts still drive out of both bases past the hedgehog by the kart gate, without a detour', () => {
    const nav = kartNavFor(g, sim.worldData);
    const out: number[] = [];
    for (const team of [Team.Corgis, Team.Cats]) {
      // from the Kart-O-Matic's pad to open ground 25 m out toward the enemy, 8 m toward the kart gate's side
      const site = findTerminalSite(sim.worldData, team)!;
      const s = team === Team.Corgis ? 1 : -1;
      const gx = site.padX + 8 * s, gz = site.padZ + 25 * s;
      expect(findDrivePath(g, nav, site.padX, site.padZ, gx, gz, out, 3), `team ${team}`).toBe(true);
      let len = 0, px = site.padX, pz = site.padZ, near = Infinity;
      const hog = hedgehogs(sim.worldData).find((h) => Math.hypot(h.x - (s > 0 ? -24.4 : 25.2), h.z - (s > 0 ? -49.4 : 51.2)) < 1)!;
      for (let k = 0; k + 1 < out.length; k += 2) {
        len += Math.hypot(out[k] - px, out[k + 1] - pz); px = out[k]; pz = out[k + 1];
        near = Math.min(near, Math.hypot(px - hog.x, pz - hog.z));
      }
      expect(Math.hypot(px - gx, pz - gz), `team ${team}: arrives`).toBeLessThan(3.5);
      expect(len, `team ${team}: no detour round the base`).toBeLessThan(Math.hypot(gx - site.padX, gz - site.padZ) * 1.3 + 6);
      // the drive passes the gate hedgehog (within 12 m of it), never through it
      expect(near, `team ${team}: by the kart gate`).toBeLessThan(12);
    }
  });

  it('costs a small fraction of a build (the build runs once per world; nothing runs per tick)', async () => {
    const lot = await Sim.create({ seed: 1, map: 'the_lot' });
    lot.step();
    const rows: string[] = [];
    for (const s of [sim, lot]) {
      const gg = navGridFor(s);
      let pass = Infinity, build = Infinity;
      for (let r = 0; r < 30; r++) {                  // warm (the JIT), then the fastest run: vitest forks share the box
        const t0 = performance.now();
        thinObstacleCells(s.worldData, gg);
        pass = Math.min(pass, performance.now() - t0);
      }
      for (let r = 0; r < 3; r++) build = Math.min(build, buildNavGrid(s).buildMs);
      rows.push(`${s.worldData.name}: pass ${pass.toFixed(2)} ms of a ${build.toFixed(1)} ms build`);
      expect(pass / build, s.worldData.name).toBeLessThan(0.05);
    }
    console.log(`[n3] thin pass cost: ${rows.join(' · ')} · load ${os.loadavg()[0].toFixed(1)}`);
    lot.dispose();
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------ the semantics

describe('N3 thin obstacles on a flat yard', () => {
  it('a 9 cm pole on a cell corner closes the four cells round it (the probe, 0.62 m from each centre, closed none)', async () => {
    const { sim, g } = await gridOf(flat([], [{ type: 'pole', x: 0, y: 1.5, z: 0, r: 0.09, hh: 1.5 }]));
    for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) expect(walkAt(g, x, z), `${x},${z}`).toBe(0);
    for (const [x, z] of [[-1.5, 0.5], [1.5, -0.5], [0.5, 1.5], [-0.5, -1.5]]) expect(walkAt(g, x, z), `${x},${z}`).toBe(1);
    expect(g.thin).toBe(4);
    sim.dispose();
  });

  it('a knee-high beam (0.2-0.4 m, under the probe\'s 0.45 m floor) closes every cell it crosses', async () => {
    const beam: PropBox = { type: 'beam', x: 0.3, y: 0.3, z: 0.5, hx: 3.2, hy: 0.1, hz: 0.1, rotY: 0.4 };
    const { sim, g } = await gridOf(flat([beam]));
    const cells = sampledCells(g, beam);
    expect(cells.size).toBeGreaterThanOrEqual(7);
    for (const i of cells) expect(g.walk[i], `cell ${i}`).toBe(0);
    expect(g.thin).toBe(cells.size);
    sim.dispose();
  });

  it('a beam beside a row leaves the row open (F2\'s one-cell walkway under the Lot\'s brace)', async () => {
    const len = Math.hypot(10, 4);
    const brace: PropBox = { type: 'brace', x: 0, y: 2, z: 1.15, hx: len / 2, hy: 0.1, hz: 0.1, rotY: 0, roll: Math.atan2(4, 10) };
    const { sim, g } = await gridOf(flat([brace]));
    for (let x = -4.5; x <= 4.5; x += 1) expect(walkAt(g, x, 0.5), `walkway ${x}`).toBe(1);
    expect(walkAt(g, -3, 1.5), 'under the brace\'s low half').toBe(0);
    sim.dispose();
  });

  it('thick props are left to the probe: walls, a fence board, a trunk, a slab ramp add no thin cells', async () => {
    const props: PropBox[] = [
      { type: 'wall', x: 0, y: 0.6, z: -6, hx: 4, hy: 0.6, hz: 0.3, rotY: 0.3 },
      { type: 'fence', x: 6, y: 1, z: 0, hx: 0.05, hy: 1, hz: 5, rotY: 0 },
      { type: 'ramp', x: -6, y: 0.5, z: 4, hx: 1.5, hy: 0.1, hz: 3, rotY: 0, pitch: -0.25 },
    ];
    for (const p of props) expect(isThinBox(p), p.type).toBe(false);
    const trunk: PropCylinder = { type: 'trunk', x: 5, y: 2, z: 6, r: 0.5, hh: 2 };
    expect(isThinCylinder(trunk)).toBe(false);
    const { sim, g } = await gridOf(flat(props, [trunk]));
    expect(thinObstacleCells(sim.worldData, g).length).toBe(0);
    expect(g.thin).toBe(0);
    sim.dispose();
  });
});

// ------------------------------------------------------------------------------------------------ behaviour

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

describe('N3 bots walk round a hedgehog instead of into it', () => {
  it('a bot sent straight through the West Yard\'s own hedgehog (4 placements x 8 headings x both species) goes round: within 4 s, never stuck, never touching a beam', async () => {
    // the corgi kart gate's hedgehog (hog_kw), beams copied onto the flat yard at sub-cell offsets
    const wy = MAPS.west_yard.build(1);
    const hog = hedgehogs(wy).find((h) => Math.hypot(h.x + 24.4, h.z + 49.4) < 1)!;
    const g0 = wy.height(hog.x, hog.z);
    const rows: { case: string; stuck: number; arrived: number; touched: boolean }[] = [];
    for (const [hx, hz] of [[0.5, 0.5], [0.2, 0.8], [0, 0], [0.7, 0.3]]) {
      const props = hog.beams.map((p) => ({ ...p, x: p.x - hog.x + hx, z: p.z - hog.z + hz, y: p.y - g0 }));
      const world = flat(props, [], 'n3 hedgehog yard');
      for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
        for (const sp of [Species.Corgi, Species.Cat] as SpeciesId[]) {
          const sim = await Sim.create({ seed: 1, world });
          sim.state.aiConfig = { vehicles: false };
          sim.step();
          const a = (deg * Math.PI) / 180;
          const sx = hx + Math.sin(a) * 8, sz = hz + Math.cos(a) * 8, gx = hx - Math.sin(a) * 8, gz = hz - Math.cos(a) * 8;
          const b = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Corgis, species: sp, cls: 'assault', name: `w${deg}.${sp}`, x: sx, y: 0.02, z: sz, yaw: 0 });
          const ai = ensureBrain(b);
          const meter = stuckMeter(b);
          const mv = moveStatsFor(sp, 'assault');
          // contact: the pet's own capsule grown by 3 cm overlaps a beam (the yard's only static props besides its ground)
          const shape = new sim.R.Capsule(mv.capsuleHalfHeight, mv.capsuleRadius + 0.03);
          const rot = { x: 0, y: 0, z: 0, w: 1 }, pos = { x: 0, y: 0, z: 0 };
          const beam = (c: Parameters<typeof isTerrainCollider>[0]) => isStaticWorldCollider(c) && !isTerrainCollider(c);
          let arrived = -1, touched = false;
          const t0 = sim.time;
          for (let i = 0; i < 12 * TICK_HZ && arrived < 0; i++) {
            ai.hasGoal = true; ai.goalX = gx; ai.goalZ = gz; ai.waitUntil = sim.tick + 999;
            sim.step(); sim.drainEvents();
            meter.tick();
            pos.x = b.pos.x; pos.y = b.pos.y + mv.capsuleHalfHeight + mv.capsuleRadius; pos.z = b.pos.z;
            if (!touched && sim.world.intersectionWithShape(pos, rot, shape, undefined, WORLD_RAY_FILTER, undefined, undefined, beam)) touched = true;
            if (Math.hypot(b.pos.x - gx, b.pos.z - gz) < 1.2) arrived = sim.time - t0;
          }
          rows.push({ case: `(${hx}, ${hz}) ${deg}° ${sp ? 'cat' : 'corgi'}`, stuck: meter.max, arrived, touched });
          sim.dispose();
        }
      }
    }
    const slow = rows.filter((r) => r.arrived < 0 || r.arrived > 4);
    console.log(`[n3] hedgehog crossings: ${rows.length}, arrival max ${Math.max(...rows.map((r) => (r.arrived < 0 ? 99 : r.arrived))).toFixed(2)} s, stuck max ${Math.max(...rows.map((r) => r.stuck))} s, touching ${rows.filter((r) => r.touched).length}`);
    expect(slow.map((r) => `${r.case} ${r.arrived.toFixed(2)} s`)).toEqual([]);
    expect(Math.max(...rows.map((r) => r.stuck))).toBeLessThanOrEqual(0.5);
    expect(rows.filter((r) => r.touched).map((r) => r.case)).toEqual([]);
  }, 180_000);
});

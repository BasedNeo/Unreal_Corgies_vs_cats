// Wave 8 M2 "The Lot" in a real Sim (Rapier + the 1 m nav grid): every spawn settles, every lane is reachable on the
// nav grid from both bases, the runtime terminal / kiosk / core-pad searches find room, and the climbables are
// climbable with the real character controller (pipe tunnels, containers, the gangway, the scaffold and its nest,
// the pallet stair onto a pipe crown).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { createWorldData, type WorldData } from '../../src/shared/world/world-data';
import { worldSystems } from '../../src/sim/world/systems';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem, killPlaneSystem } from '../../src/sim/systems/core';
import { navGridFor, findPath, cellX, cellZ, nearestWalkable, kartNavFor, findDrivePath, type NavGrid } from '../../src/sim/ai';
import { findTerminalSite } from '../../src/sim/vehicles/sites';
import { findOrdnanceSite, kartKeepOut } from '../../src/sim/interact/sites';
import { corePadSpots } from '../../src/sim/match/core-rush';
import { Btn } from '../../src/shared/input';
import { Species, Team, type TeamId } from '../../src/shared/types';
import { CONTAINER, GANGWAY, HEAP, PIPE, SCAFFOLD, TUNNELS } from '../../src/shared/world/lot/layout';

const coreSystems = () => [movementSystem, ...worldSystems(), physicsStepSystem, killPlaneSystem];
let data: WorldData;
beforeAll(() => { data = createWorldData(1, 'the_lot'); });

/** The places every lane is made of (ground-level standing points). */
const LANE_POINTS: Record<string, [number, number]> = {
  'pit floor (spawns)': [-60, -110], 'pit floor (footings)': [-20, -114], 'pit vehicle ramp': [6, -109], 'pit foot ramp': [-63, -90],
  'trench T1': [-67, -75], 'trench T2': [-14, -71.5], 'trench T3': [-37, -80],
  'canyon lane': [-85, -32], 'container west (inside)': [-95.5, -28], 'container east (inside)': [-74.5, -38],
  'canyon causeway': [-87, 0], 'middle causeway': [0, 0], 'pipes causeway': [87, 0],
  'tunnel west (inside)': [79.5, 18.2], 'tunnel west (gap)': [79.5, 23.6], 'tunnel east (inside)': [91.5, 29], 'between the tunnels': [85.5, 29],
  'mud N': [20, -40], 'mud S': [-20, 40], 'loose pipe W (inside)': [-44, -29.5], 'loose pipe E (inside)': [44, 29.5],
  'heap north ramp': [63, 88], 'heap west side': [-8, 110], 'heap top': [40, 112], 'under the scaffold': [26, 99],
};

function centroid(team: TeamId): [number, number] {
  const s = data.spawns.filter((p) => p.team === team);
  return [s.reduce((a, p) => a + p.x, 0) / s.length, s.reduce((a, p) => a + p.z, 0) / s.length];
}

/** Walk the grid from (sx, sz) to (gx, gz) in up to 8 findPath legs (a leg stops after 9000 expansions). */
function reach(g: NavGrid, sx: number, sz: number, gx: number, gz: number): { ok: boolean; legs: number; len: number } {
  const goal = nearestWalkable(g, gx, gz, 2);
  let x = sx, z = sz, len = 0;
  const out: number[] = [];
  for (let leg = 1; leg <= 8; leg++) {
    if (!findPath(g, x, z, gx, gz, out)) return { ok: false, legs: leg, len };
    for (let i = 0; i < out.length; i += 2) { len += Math.hypot(out[i] - x, out[i + 1] - z); x = out[i]; z = out[i + 1]; }
    if (Math.hypot(x - cellX(g, goal), z - cellZ(g, goal)) < 1.6 || Math.hypot(x - gx, z - gz) < 1.6) return { ok: true, legs: leg, len };
  }
  return { ok: false, legs: 8, len };
}

describe('The Lot: sim', () => {
  let sim: Sim;
  let g: NavGrid;
  beforeAll(async () => {
    sim = await Sim.create({ seed: 1, map: 'the_lot' });
    sim.step(); sim.step();
    g = navGridFor(sim);
  }, 120_000);
  afterAll(() => sim.dispose());

  it('builds the nav grid over the whole lot (both bases in the main region)', () => {
    console.log(`[lot] nav grid ${g.w}x${g.h}: ${g.walkable} walkable cells, ${g.queries} probe queries, built in ${g.buildMs.toFixed(0)} ms; regions ${g.regionSize.filter((n) => n > 0).length}, main ${g.regionSize[g.mainRegion]}`);
    expect(g.w).toBe(2 * data.halfExtent);
    for (const s of data.spawns) {
      const c = nearestWalkable(g, s.x, s.z, 0);
      expect(c, `spawn ${s.x},${s.z}`).toBeGreaterThanOrEqual(0);
      expect(g.region[c], `spawn ${s.x},${s.z} region`).toBe(g.mainRegion);
    }
    expect(g.regionSize[g.mainRegion] / g.walkable).toBeGreaterThan(0.97);
  });

  it('every lane point is walkable in the main region and reachable from both bases', () => {
    const rows: string[] = [];
    for (const [name, [x, z]] of Object.entries(LANE_POINTS)) {
      const c = nearestWalkable(g, x, z, 0);
      expect(c, `${name} walkable`).toBeGreaterThanOrEqual(0);
      expect(g.region[c], `${name} main region`).toBe(g.mainRegion);
      for (const team of [Team.Corgis, Team.Cats] as const) {
        const [sx, sz] = centroid(team);
        const r = reach(g, sx, sz, x, z);
        expect(r.ok, `${name} from ${team ? 'cats' : 'corgis'}`).toBe(true);
        rows.push(`${name} <- ${team ? 'cat' : 'corgi'} base: ${r.len.toFixed(0)} m (${r.legs} leg${r.legs > 1 ? 's' : ''})`);
      }
    }
    console.log(`[lot] routes:\n  ${rows.join('\n  ')}`);
  });

  it('the base-to-base route crosses the ditch dry on a causeway (water cells cost 3x)', () => {
    const [ax, az] = centroid(Team.Corgis), [bx, bz] = centroid(Team.Cats);
    const out: number[] = [];
    let x = ax, z = az, wet = 0;
    for (let leg = 0; leg < 8 && Math.hypot(x - bx, z - bz) > 2; leg++) {
      expect(findPath(g, x, z, bx, bz, out)).toBe(true);
      for (let i = 0; i < out.length; i += 2) {
        const steps = Math.ceil(Math.hypot(out[i] - x, out[i + 1] - z) / 0.5);
        for (let k = 1; k <= steps; k++) {
          const px = x + ((out[i] - x) * k) / steps, pz = z + ((out[i + 1] - z) * k) / steps;
          if (Math.abs(pz) < 3.3 && (data.water ?? []).some((w) => Math.abs(px - w.x) <= w.hx! && Math.abs(pz - w.z) <= w.hz!)) wet++;
        }
        x = out[i]; z = out[i + 1];
      }
    }
    expect(Math.hypot(x - bx, z - bz)).toBeLessThan(2);
    expect(wet).toBe(0);
  });

  it('runtime sites: kart terminals, ordnance kiosks and three core-rush pads find room', () => {
    for (const team of [Team.Corgis, Team.Cats] as const) {
      const k = findTerminalSite(data, team);
      expect(k, `kart terminal ${team}`).not.toBeNull();
      const o = findOrdnanceSite(data, team, kartKeepOut(data, team));
      expect(o, `ordnance kiosk ${team}`).not.toBeNull();
      const [cx, cz] = centroid(team);
      expect(Math.hypot(k!.x - cx, k!.z - cz)).toBeLessThan(31);
      expect(Math.hypot(o!.x - cx, o!.z - cz)).toBeLessThan(26);
      console.log(`[lot] team ${team}: kart terminal (${k!.x.toFixed(1)}, ${k!.z.toFixed(1)}) pad (${k!.padX.toFixed(1)}, ${k!.padZ.toFixed(1)}) · kiosk (${o!.x.toFixed(1)}, ${o!.z.toFixed(1)})`);
    }
    // karts drive out of both bases (the pit's vehicle ramp, the heap's west side), across the middle causeway and on
    // to the other base
    const kn = kartNavFor(g, data);
    for (const team of [Team.Corgis, Team.Cats] as const) {
      const k = findTerminalSite(data, team)!;
      const [ox, oz] = centroid(team === Team.Corgis ? Team.Cats : Team.Corgis);
      for (const [gx, gz, what] of [[0, 0, 'middle causeway'], [ox, oz, 'the other base']] as const) {
        const out: number[] = [];
        let x = k.padX, z = k.padZ, ok = false, len = 0;
        for (let leg = 0; leg < 8 && !ok; leg++) {
          expect(findDrivePath(g, kn, x, z, gx, gz, out, 12), `kart ${team} -> ${what}`).toBe(true);
          for (let i = 0; i < out.length; i += 2) { len += Math.hypot(out[i] - x, out[i + 1] - z); x = out[i]; z = out[i + 1]; }
          ok = Math.hypot(x - gx, z - gz) < 13;
        }
        expect(ok, `kart ${team} -> ${what}`).toBe(true);
        console.log(`[lot] kart route team ${team} -> ${what}: ${len.toFixed(0)} m`);
      }
    }
    const pads = corePadSpots(sim);
    expect(pads.length).toBe(3);
    console.log(`[lot] core-rush pads: ${pads.map((p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)})`).join(' ')}`);
  });
});

// ------------------------------------------------------------------------------------------------ traversal
describe('The Lot: the climbables are climbable (real character controller)', () => {
  let sim: Sim;
  beforeAll(async () => { sim = await Sim.create({ seed: 1, map: 'the_lot', systems: coreSystems() }); }, 60_000);
  afterAll(() => sim.dispose());
  let seq = 1;
  const spawn = (x: number, y: number, z: number, cat = false) => sim.spawnCharacter({
    team: cat ? Team.Cats : Team.Corgis, species: cat ? Species.Cat : Species.Corgi, cls: 'assault', name: `T${seq}`, x, y, z, yaw: 0,
  });
  /** Hold a heading (world yaw) for `secs`; optional jump every `jumpEvery` ticks. Returns the lowest y seen. */
  const run = (e: SimEntity, yaw: number, secs: number, jumpEvery = 0, until?: () => boolean): number => {
    let lo = Infinity;
    for (let i = 0; i < secs * 60; i++) {
      const jump = jumpEvery && i % jumpEvery < 16 ? Btn.Jump : 0;          // held: a full-height jump
      sim.setInput(e.id, { seq: seq++, mx: 0, mz: 1, yaw, pitch: 0, buttons: jump, rt: 0 });
      sim.step();
      lo = Math.min(lo, e.pos.y);
      if (until?.()) break;
    }
    return lo;
  };
  const SOUTH = Math.PI, EAST = -Math.PI / 2, WEST = Math.PI / 2;
  const settle = (e: SimEntity) => { for (let i = 0; i < 20; i++) { sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }); sim.step(); } expect(e.char!.grounded).toBe(true); };

  it('both pipe tunnels: in the north mouth, out of the south mouth (a corgi and a cat)', () => {
    for (const [i, t] of TUNNELS.entries()) {
      const e = spawn(t.x, data.height(t.x, t.z0 - 4) + 0.05, t.z0 - 4, i === 1);
      settle(e);
      run(e, SOUTH, 9, 0, () => e.pos.z > t.z0 + 3 * PIPE.len + 2 * PIPE.gap + 2);
      expect(e.pos.z, t.id).toBeGreaterThan(t.z0 + 3 * PIPE.len + 2 * PIPE.gap + 2);
      expect(Math.abs(e.pos.x - t.x), t.id).toBeLessThan(0.9);
      sim.removeEntity(e.id);
    }
  });

  it('the containers are walk-through bunkers; the side doors open onto the canyon', () => {
    const e = spawn(-93, 0.05, -50);
    settle(e);
    run(e, SOUTH, 8, 0, () => e.pos.z > -16);
    expect(e.pos.z).toBeGreaterThan(-16);
    expect(Math.abs(e.pos.x + 93)).toBeLessThan(1);
    // the east container's west door: from the canyon straight in through the door
    const d = spawn(-85, 0.05, -39);
    settle(d);
    run(d, EAST, 3, 0, () => d.pos.x > -76);
    expect(d.pos.x).toBeGreaterThan(-76);
    expect(d.pos.y).toBeLessThan(0.5);
  });

  it('the gangway climbs to the east container roof', () => {
    const e = spawn(GANGWAY.x, 0.05, GANGWAY.zLow - 3);
    settle(e);
    run(e, SOUTH, 7, 0, () => e.pos.z > GANGWAY.landing[0] + 1.5);
    expect(e.pos.y).toBeGreaterThan(CONTAINER.H - 0.1);
    run(e, WEST, 3, 0, () => e.pos.x < -72);
    expect(e.pos.x).toBeLessThan(-72);
    expect(Math.abs(e.pos.y - CONTAINER.H)).toBeLessThan(0.1);
  });

  it('the scaffold: heap top -> ramp -> deck 1 -> nest ramp -> crow\'s nest (a cat)', () => {
    const zc = (SCAFFOLD.z0 + SCAFFOLD.z1) / 2;
    const e = spawn(1, HEAP.top + 0.05, zc, true);
    settle(e);
    run(e, EAST, 5, 0, () => e.pos.x > 20);
    expect(e.pos.y).toBeCloseTo(HEAP.top + SCAFFOLD.deck, 1);
    // onto the south half of bay 3 and up the nest ramp
    const n = spawn(26, HEAP.top + SCAFFOLD.deck + 0.05, SCAFFOLD.z1 - 1.35, true);
    settle(n);
    run(n, EAST, 5, 0, () => n.pos.x > SCAFFOLD.x0 + 3 * SCAFFOLD.bay + 1.5);
    expect(n.pos.y).toBeCloseTo(HEAP.top + SCAFFOLD.nest, 1);
  });

  it('the pallet stair onto the west tunnel\'s crown (a corgi, jumping)', () => {
    const e = spawn(57, data.height(57, 39) + 0.05, 39);
    settle(e);
    run(e, EAST, 10, 30, () => e.char!.grounded && e.pos.x > 78 && e.pos.y > 5.4);
    expect(e.pos.y, `ended at ${e.pos.x.toFixed(1)}, ${e.pos.y.toFixed(2)}`).toBeGreaterThan(5.4);
    expect(e.pos.x).toBeGreaterThan(77.5);
  });
});

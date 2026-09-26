// D3 The Garage + The Rooftops on the real West Yard (createWorldData): layout + districts with height bands,
// collider == visual on every standing surface of the district, rooftop perches reachable by BOTH species
// over BOTH climb routes (brute-force hop search in one sim, like S1's interact-yard proof), perch cover vs
// exposure and lane sightlines (Rapier rays = the real hitscan geometry), the one-way roof-hatch drop, and
// bot navigation (1 m nav grid) through every garage door.
import { describe, it, expect, beforeAll } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { createWorldData, type WorldData, type PropBox, type VisualPrim } from '../../src/shared/world/world-data';
import { boxTopAt, districtAt, occupiedAt, surfaceAt } from '../../src/shared/world/queries';
import {
  GARAGE, GARAGE_DOORS, GARAGE_FLOOR, GARAGE_ROOF, GARAGE_WALL, ROOF_PERCHES, ROOF_ROUTES, rectMinusHoles,
} from '../../src/shared/world/garage';
import { worldSystems } from '../../src/sim/world/systems';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem, killPlaneSystem } from '../../src/sim/systems/core';
import { worldLineClear } from '../../src/sim/combat';
import { navGridFor, findPath, lineWalkable, isWalkable, cellX, cellZ, type NavGrid } from '../../src/sim/ai';
import { Btn } from '../../src/shared/input';
import { Species, Team, type SpeciesId } from '../../src/shared/types';
import { PICKUP_LAYOUTS } from '../../src/shared/content/pickups';

type P3 = readonly [number, number, number];
let data: WorldData;
beforeAll(() => { data = createWorldData(1); });

const coreSystems = () => [movementSystem, ...worldSystems(), physicsStepSystem, killPlaneSystem];
/** The district block (building, lean-to, crates, alley, apron, bins). */
const BLOCK = { minX: GARAGE.x - 25, maxX: GARAGE.x + 19.5, minZ: GARAGE.z - 17, maxZ: GARAGE.z + 17 };
const inBlock = (x: number, z: number) => x >= BLOCK.minX && x <= BLOCK.maxX && z >= BLOCK.minZ && z <= BLOCK.maxZ;
const perch = (id: string) => ROOF_PERCHES.find((p) => p.id === id)!;
/** No collider at the point or on a horizontal circle of radius r around it (a character's body). */
function clearAround(x: number, y: number, z: number, r: number): boolean {
  if (occupiedAt(data, x, y, z)) return false;
  for (let i = 0; i < 8; i++) if (occupiedAt(data, x + Math.cos(i * Math.PI / 4) * r, y, z + Math.sin(i * Math.PI / 4) * r)) return false;
  return true;
}

describe('The Garage + The Rooftops: layout', () => {
  it('two districts share the footprint by height; perches, lamps, bookmarks and landmark props exist', () => {
    const g = data.districts!.find((d) => d.id === 'garage')!, r = data.districts!.find((d) => d.id === 'rooftops')!;
    expect(g.name).toBe('The Garage');
    expect(r.name).toBe('The Rooftops');
    expect(districtAt(data, GARAGE.x, GARAGE.z, GARAGE_FLOOR)?.id).toBe('garage');
    expect(districtAt(data, GARAGE.x, GARAGE.z, GARAGE_ROOF)?.id).toBe('rooftops');
    expect(districtAt(data, GARAGE.x - 17, GARAGE.z - 6, 5.3)?.id).toBe('rooftops');   // lean-to roof
    expect(districtAt(data, GARAGE.x - 17, GARAGE.z - 6, 0)).toBeNull();               // beside the lean-to, on the lawn
    expect(districtAt(data, GARAGE.x, GARAGE.z)?.id).toBe('garage');                   // no y: footprint only (old callers)
    expect(districtAt(data, -85, -14, 0)?.id).toBe('garden');
    expect(data.perches!.map((p) => p.id)).toEqual(ROOF_PERCHES.map((p) => p.id));
    for (const p of data.perches!) {
      expect(Math.abs(surfaceAt(data, p.x, p.z, p.y + 0.5).y - p.y), `${p.id} stands on a surface`).toBeLessThan(0.02);
      for (const dy of [0.3, 0.7, 1.1]) expect(clearAround(p.x, p.y + dy, p.z, 0.36), `${p.id} clear at +${dy}`).toBe(true);
      expect(districtAt(data, p.x, p.z, p.y)?.id).toBe('rooftops');
    }
    expect(data.lamps!.length).toBeGreaterThanOrEqual(3);
    for (const l of data.lamps!) {
      expect(districtAt(data, l.x, l.z, l.y)?.id, 'lamp inside the garage').toBe('garage');
      expect(l.y).toBeLessThan(GARAGE_WALL);
      expect(l.y).toBeGreaterThan(GARAGE_FLOOR + 4.5);                                  // above any jump
    }
    for (const n of ['garage', 'garage_door', 'garage_side', 'garage_pet', 'garage_breach', 'rooftops', 'roof_west', 'roof_alley', 'roof_top', 'roof_nest', 'roof_parapet', 'roof_gutter', 'perch_parapet_seen', 'perch_nest_seen', 'perch_gutter_seen']) {
      expect(data.bookmarks!.some((b) => b.name === n), n).toBe(true);
    }
    const types = new Set(data.props.map((p) => p.type).concat((data.cylinders ?? []).map((c) => c.type)));
    for (const t of ['garage', 'garage_floor', 'garage_door', 'roof_slab', 'parapet', 'hatch', 'skylight', 'roof_ac', 'roof_nest', 'roof_dish', 'roof_vent', 'car', 'bench', 'shelf', 'toolchest', 'paint', 'freezer', 'box', 'mower', 'leanto', 'leanto_roof', 'crate', 'scaffold', 'bin']) {
      expect(types.has(t), t).toBe(true);
    }
    // every door is at least 2 m wide and taller than a cat (1.26 m)
    for (const d of GARAGE_DOORS) { expect(d.width, d.id).toBeGreaterThanOrEqual(2); expect(d.height, d.id).toBeGreaterThan(1.9); }
  });

  it('rectMinusHoles tiles the roof exactly (area) and never covers a hole', () => {
    const holes: [number, number, number, number][] = [[3.8, 6.6, -2.4, 0.4], [-7, -3.4, -6.2, -2.8], [-1.8, 1.8, 3.4, 6.8]];
    const rects = rectMinusHoles([-13, 13, -11, 11], holes);
    const area = rects.reduce((a, r) => a + (r[1] - r[0]) * (r[3] - r[2]), 0);
    const holeArea = holes.reduce((a, h) => a + (h[1] - h[0]) * (h[3] - h[2]), 0);
    expect(area).toBeCloseTo(26 * 22 - holeArea, 6);
    for (const r of rects) for (const h of holes) {
      const overlap = Math.max(0, Math.min(r[1], h[1]) - Math.max(r[0], h[0])) * Math.max(0, Math.min(r[3], h[3]) - Math.max(r[2], h[2]));
      expect(overlap).toBe(0);
    }
    expect(rects.length).toBeLessThan(14);
  });
});

describe('The Garage + The Rooftops: collider == visual', () => {
  /** Visual top of the district's box/cylinder prims along the vertical line (x, z), at or below yMax. */
  function visualTop(prims: VisualPrim[], x: number, z: number, yMax: number): number {
    let best = -Infinity;
    for (const p of prims) {
      let t = -Infinity;
      if (p.s === 'box') t = boxTopAt({ type: 'v', x: p.x, y: p.y, z: p.z, hx: p.a / 2, hy: p.b / 2, hz: p.c / 2, rotY: p.yaw ?? 0, pitch: p.pitch, roll: p.roll }, x, z);
      else if (p.s === 'cyl' && !p.pitch && !p.roll && Math.hypot(x - p.x, z - p.z) <= Math.max(p.a, p.c)) t = p.y + p.b / 2;
      if (t <= yMax && t > best) best = t;
    }
    return best;
  }

  it('every standing surface (collider top, 3x3 samples) has a visual top within 1 cm', () => {
    const prims = (data.prims ?? []).filter((p) => inBlock(p.x, p.z) && p.g !== 'noink');
    const boxes = data.props.filter((b) => inBlock(b.x, b.z) && b.type !== 'fence' && b.type !== 'boundary' && b.type !== 'leanto_roof');
    expect(boxes.length).toBeGreaterThan(80);
    let worst = 0, where = '';
    for (const b of boxes) {
      for (const u of [-0.8, 0, 0.8]) for (const v of [-0.8, 0, 0.8]) {
        // a point on the box's top face (local +y face), mapped to world XZ through the yaw only (tilted
        // boxes: sample the local grid and let boxTopAt find the true top along that vertical line)
        const c = Math.cos(b.rotY), s = Math.sin(b.rotY), lx = u * b.hx, lz = v * b.hz;
        const x = b.x + lx * c + lz * s, z = b.z - lx * s + lz * c;
        const top = boxTopAt(b, x, z);
        if (!Number.isFinite(top)) continue;
        const vis = visualTop(prims, x, z, top + 0.05);
        const err = Math.abs(vis - top);
        if (err > worst) { worst = err; where = `${b.type} @ ${x.toFixed(2)},${z.toFixed(2)} collider ${top.toFixed(3)} visual ${vis.toFixed(3)}`; }
      }
    }
    expect(worst, where).toBeLessThanOrEqual(0.01);
  });

  it('the lean-to roof: walkable top face == the visual corrugated slab (sloped, <= 12 deg)', () => {
    const prims = (data.prims ?? []).filter((p) => inBlock(p.x, p.z) && p.s === 'box' && p.col === 'metal' && p.roll);
    const roofBox = data.props.find((b) => b.type === 'leanto_roof')!;
    for (const [lx, lz] of [[-19.9, -10.5], [-16.5, -6], [-13.3, -1.5], [-18, -3]]) {
      const x = GARAGE.x + lx, z = GARAGE.z + lz;
      const col = boxTopAt(roofBox, x, z);
      const vis = Math.max(...prims.map((p) => boxTopAt({ type: 'v', x: p.x, y: p.y, z: p.z, hx: p.a / 2, hy: p.b / 2, hz: p.c / 2, rotY: p.yaw ?? 0, pitch: p.pitch, roll: p.roll }, x, z)));
      expect(Math.abs(col - vis)).toBeLessThan(0.01);
    }
    expect((roofBox.roll ?? 0) * 180 / Math.PI).toBeLessThan(12);
  });
});

// ------------------------------------------------------------------------------------------------ hop search
interface Leg { key: string; from: P3; to: P3 }
interface Variant { move: number; jump: number; dbl: boolean; sprint: boolean; walk?: boolean }
const VARIANTS: Variant[] = [{ move: 0, jump: -1, dbl: false, sprint: false, walk: true }];
for (const sprint of [false, true]) for (const dbl of [false, true]) {
  for (const move of [0, 6, 12, 18]) VARIANTS.push({ move, jump: 0, dbl, sprint });
  for (const jump of [6, 12, 20]) VARIANTS.push({ move: 0, jump, dbl, sprint });
}
function buttons(v: Variant, i: number): number {
  let b = v.sprint ? Btn.Sprint : 0;
  if (v.walk) return b;
  const t = i - v.jump;
  if (t >= 0 && t < 20) b |= Btn.Jump;
  if (v.dbl && t >= 22 && t < 46) b |= Btn.Jump;
  return b;
}

/**
 * Every leg is tried by many characters of one species at once in one sim (characters never collide with
 * each other), each steering at its target with one input timing; a leg passes when a character lands on
 * the target (grounded, |dy| < 0.3, within 1.2 m). Timings are tried in batches until all legs pass.
 */
async function hopSearch(legs: Leg[], species: SpeciesId): Promise<Map<string, boolean>> {
  const ok = new Set<string>();
  const BATCH = 10;
  let pending = legs;
  for (let b = 0; b * BATCH < VARIANTS.length && pending.length; b++) {
    const sim = await Sim.create({ seed: 1, world: data, systems: coreSystems() });
    const runs: { leg: Leg; v: Variant; e: SimEntity }[] = [];
    let ticks = 0;
    for (const leg of pending) for (const v of VARIANTS.slice(b * BATCH, b * BATCH + BATCH)) {
      const e = sim.spawnCharacter({ team: species === Species.Cat ? Team.Cats : Team.Corgis, species, cls: 'assault', name: 'hop', x: leg.from[0], y: leg.from[1] + 0.05, z: leg.from[2], yaw: 0 });
      runs.push({ leg, v, e });
      ticks = Math.max(ticks, Math.round(90 + (Math.hypot(leg.to[0] - leg.from[0], leg.to[2] - leg.from[2]) / 5) * 60));
    }
    for (let i = 0; i < 20; i++) sim.step();
    let seq = 1;
    for (let i = 0; i < ticks; i++) {
      for (const r of runs) {
        if (ok.has(r.leg.key)) continue;
        const dx = r.leg.to[0] - r.e.pos.x, dz = r.leg.to[2] - r.e.pos.z;
        sim.setInput(r.e.id, { seq: seq++, mx: 0, mz: i >= r.v.move && Math.hypot(dx, dz) > 0.4 ? 1 : 0, yaw: Math.atan2(-dx, -dz), pitch: 0, buttons: buttons(r.v, i), rt: 0 });
      }
      sim.step();
      for (const r of runs) {
        if (ok.has(r.leg.key)) continue;
        const e = r.e, to = r.leg.to;
        if (e.char!.grounded && Math.abs(e.pos.y - to[1]) < 0.3 && Math.hypot(e.pos.x - to[0], e.pos.z - to[2]) < 1.2) ok.add(r.leg.key);
      }
    }
    sim.dispose();
    pending = pending.filter((l) => !ok.has(l.key));
  }
  return new Map(legs.map((l) => [l.key, ok.has(l.key)]));
}

function allLegs(): Leg[] {
  const legs: Leg[] = [];
  for (const [name, pts] of Object.entries(ROOF_ROUTES)) for (let i = 0; i + 1 < pts.length; i++) legs.push({ key: `${name}#${i}`, from: pts[i], to: pts[i + 1] });
  const west = ROOF_ROUTES.west[ROOF_ROUTES.west.length - 1], east = ROOF_ROUTES.east[ROOF_ROUTES.east.length - 1];
  const nest = perch('roof_nest'), par = perch('roof_parapet'), gut = perch('roof_gutter');
  const acTop: P3 = [GARAGE.x - 10.4, 8.4, GARAGE.z - 2.2];
  legs.push(
    { key: 'west->parapet nest', from: west, to: [par.x, par.y, par.z] },
    { key: 'west->AC unit', from: west, to: acTop },
    { key: 'AC unit->crow\'s nest', from: acTop, to: [nest.x, nest.y, nest.z] },
    { key: 'east->gutter corner', from: east, to: [gut.x, gut.y, gut.z] },
    // across the roof from the east route, around the open hatch (walking straight at it drops you inside)
    { key: 'east->north of the hatch', from: east, to: [GARAGE.x + 0.5, GARAGE_ROOF, GARAGE.z - 7] },
    { key: 'north of the hatch->AC unit', from: [GARAGE.x + 0.5, GARAGE_ROOF, GARAGE.z - 7], to: acTop },
    { key: 'gutter corner->parapet nest (across the roof)', from: [gut.x, gut.y, gut.z], to: [par.x, par.y, par.z] },
    // inside: the parked car is a climbable close-quarters high point (floor -> hood 2.4 -> cabin roof 4.1)
    { key: 'garage floor->car hood', from: [GARAGE.x + 0.5, GARAGE_FLOOR, GARAGE.z + 4.5], to: CAR_HOOD },
    { key: 'car hood->cabin roof', from: CAR_HOOD, to: CAR_ROOF },
  );
  return legs;
}
const CAR_HOOD: P3 = [GARAGE.x + 5.2, 2.4, GARAGE.z + 4.2];
const CAR_ROOF: P3 = [GARAGE.x + 5.2, 4.1, GARAGE.z + 1.4];

/** D3 -> S1 proposal (docs/handoff/D3.md): two new Golden Kibble spots; the last standing point of each
 *  route is proven by the legs above (crow's nest via the AC unit, car roof via the hood). */
const KIBBLE_PROPOSALS = [
  { id: 'crows_nest', x: GARAGE.x - 11.3, y: 10.15, z: GARAGE.z + 2.5, stand: () => { const n = perch('roof_nest'); return [n.x, n.y, n.z] as P3; } },
  { id: 'garage_car_roof', x: GARAGE.x + 5.2, y: 4.65, z: GARAGE.z - 0.6, stand: () => CAR_ROOF },
];

describe('The Rooftops: every perch is reachable by both teams over both routes', () => {
  it('route standing points sit on real surfaces and start on open ground', () => {
    for (const [name, pts] of Object.entries(ROOF_ROUTES)) {
      expect(surfaceAt(data, pts[0][0], pts[0][2], pts[0][1] + 0.5).kind, `${name} starts on the lawn`).toBe('terrain');
      for (const p of pts) {
        expect(Math.abs(surfaceAt(data, p[0], p[2], p[1] + 0.5).y - p[1]), `${name} ${p}`).toBeLessThan(0.15);
        expect(clearAround(p[0], p[1] + 0.7, p[2], 0.3), `${name} ${p} clear`).toBe(true);
      }
      // every step up is <= 1.3 m (corgi single jump 1.47 m)
      for (let i = 0; i + 1 < pts.length; i++) expect(pts[i + 1][1] - pts[i][1], `${name} step ${i}`).toBeLessThanOrEqual(1.3);
    }
  });

  it('corgi (the weakest jumper): every leg of both routes and every roof leg', async () => {
    const res = await hopSearch(allLegs(), Species.Corgi);
    expect([...res].filter(([, v]) => !v).map(([k]) => k)).toEqual([]);
  }, 300000);

  it('cat: every leg of both routes and every roof leg', async () => {
    const res = await hopSearch(allLegs(), Species.Cat);
    expect([...res].filter(([, v]) => !v).map(([k]) => k)).toEqual([]);
  }, 300000);

  it('D3 kibble proposals: clear of colliders, >= 2.5 m from every S1 pickup, next to a proven standing point', () => {
    for (const k of KIBBLE_PROPOSALS) {
      expect(occupiedAt(data, k.x, k.y, k.z), k.id).toBe(false);
      // (the lead adopted these proposals into S1's layout: skip the spot's own entry)
      for (const s of [...PICKUP_LAYOUTS['West Yard'].kibble, ...PICKUP_LAYOUTS['West Yard'].cores].filter((p) => p.id !== k.id)) expect(Math.hypot(s.x - k.x, s.y - k.y, s.z - k.z), `${k.id} vs ${s.id}`).toBeGreaterThan(2.5);
      const [sx, sy, sz] = k.stand();
      expect(Math.abs(surfaceAt(data, k.x, k.z, k.y).y + 0.55 - k.y), `${k.id} floats 0.55 m over its surface`).toBeLessThan(0.02);
      expect(Math.hypot(sx - k.x, sz - k.z), `${k.id} within a step of its route end`).toBeLessThan(2.5);
      expect(Math.abs(sy - (k.y - 0.55))).toBeLessThan(0.02);
    }
  });

  it('the roof hatch is a one-way drop onto the parked car (and out of the garage through a door)', async () => {
    const sim = await Sim.create({ seed: 1, world: data, systems: coreSystems() });
    const hx = GARAGE.x + 5.2, hz = GARAGE.z - 1.0;
    const e = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'drop', x: hx, y: GARAGE_ROOF + 1.5, z: hz, yaw: 0 });
    for (let i = 0; i < 90; i++) sim.step();
    expect(e.char!.grounded).toBe(true);
    expect(e.pos.y).toBeLessThan(GARAGE_WALL - 1.2);                // fell through: inside, on the car's cabin roof
    expect(e.pos.y).toBeGreaterThan(3.5);
    expect(districtAt(data, e.pos.x, e.pos.z, e.pos.y)?.id).toBe('garage');
    // the car roof is > 2.55 m (corgi double jump) below the roof surface: no way back up through the hatch
    expect(GARAGE_ROOF - e.pos.y).toBeGreaterThan(2.9);
    sim.dispose();
  });
});

describe('The Rooftops: perches have partial cover, an exposed side and overlook the main lanes', () => {
  let sim: Sim;
  beforeAll(async () => {
    sim = await Sim.create({ seed: 1, world: data, systems: coreSystems() });
    sim.step();
  });
  const g = (x: number, z: number) => data.height(x, z);
  /** Lane points (ground) each perch should cover. */
  const LANES: Record<string, [number, number][]> = {
    roof_parapet: [[34, -50], [48, -42], [60, -36], [28, -60], [-10, -14], [4, 6], [20, -30], [40, -65]],
    roof_nest: [[34, -50], [48, -42], [28, -60], [40, -65], [79.4, -21.5], [4, 6], [16, 24], [58, 5], [-10, -14]],
    roof_gutter: [[79.4, -21.5], [88, -30], [96, -20], [86, -5], [95, 20], [80, 55], [64, -28]],
  };
  /** Can a sniper at perch p (stepping up to 1 m toward the target) hit chest height at ground (x, z)? */
  function sees(p: { x: number; y: number; z: number }, x: number, z: number): boolean {
    const d = Math.hypot(x - p.x, z - p.z), ux = (x - p.x) / d, uz = (z - p.z) / d;
    for (const step of [0, 0.5, 1.0]) {
      const ox = p.x + ux * step, oz = p.z + uz * step;
      if (occupiedAt(data, ox, p.y + 0.6, oz, 0.35)) break;
      if (worldLineClear(sim, ox, p.y + 1.25, oz, x, g(x, z) + 0.7, z)) return true;
    }
    return false;
  }

  it('together the perches cover most of the yard; each one has its own field (share of open ground in range)', () => {
    const seenBy = ROOF_PERCHES.map(() => 0);
    let any = 0, n = 0;
    for (let z = -97; z <= 97; z += 6) for (let x = -97; x <= 97; x += 6) {
      if (occupiedAt(data, x, g(x, z) + 0.7, z) || districtAt(data, x, z)?.id === 'garage') continue;
      n++;
      let hit = false;
      ROOF_PERCHES.forEach((p, i) => { if (Math.hypot(x - p.x, z - p.z) <= 160 && sees(p, x, z)) { seenBy[i]++; hit = true; } });
      if (hit) any++;
    }
    console.log(`[perches] yard coverage: ${ROOF_PERCHES.map((p, i) => `${p.id} ${(100 * seenBy[i] / n).toFixed(0)}%`).join(' · ')} · union ${(100 * any / n).toFixed(0)}%`);
    for (let i = 0; i < ROOF_PERCHES.length; i++) expect(seenBy[i] / n, ROOF_PERCHES[i].id).toBeGreaterThan(0.25);
    expect(any / n).toBeGreaterThan(0.65);
  });

  it('each perch sees most of its lanes (aim ray from the perch -> chest height on the lane)', () => {
    for (const p of ROOF_PERCHES) {
      const lanes = LANES[p.id];
      // stand at the parapet / platform edge facing the lane (the aim pivot is 1.25 m above the feet)
      const seen = lanes.filter(([x, z]) => sees(p, x, z));
      console.log(`[perch ${p.id}] sees ${seen.length}/${lanes.length} lane points; blocked: ${JSON.stringify(lanes.filter((l) => !seen.includes(l)))}`);
      expect(seen.length / lanes.length, p.id).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('partial cover (chest hidden from part of the yard) and an exposed side (chest visible from elsewhere)', () => {
    const arrivals = [ROOF_ROUTES.west[ROOF_ROUTES.west.length - 1], ROOF_ROUTES.east[ROOF_ROUTES.east.length - 1]];
    for (const p of ROOF_PERCHES) {
      let hidden = 0, open = 0, headOpen = 0, n = 0;
      for (const r of [30, 55]) for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        if (Math.abs(x) > 99 || Math.abs(z) > 99 || occupiedAt(data, x, g(x, z) + 1, z)) continue;
        n++;
        const ey = g(x, z) + 1.05;                                         // an enemy's eye on the ground
        const chest = worldLineClear(sim, x, ey, z, p.x, p.y + 0.6, p.z);
        if (chest) open++; else hidden++;
        if (worldLineClear(sim, x, ey, z, p.x, p.y + 1.05, p.z)) headOpen++;
      }
      const fromRoof = arrivals.filter((q) => worldLineClear(sim, q[0], q[1] + 1.05, q[2], p.x, p.y + 0.6, p.z)).length;
      console.log(`[perch ${p.id}] ground vantages ${n}: chest hidden ${hidden}, chest open ${open}, head open ${headOpen}; route arrivals that see the chest ${fromRoof}/2`);
      expect(hidden / n, `${p.id} has cover`).toBeGreaterThanOrEqual(0.2);
      expect(open + fromRoof, `${p.id} has an exposed side`).toBeGreaterThanOrEqual(1);
      expect(headOpen, `${p.id} a sniper's head shows over its cover`).toBeGreaterThan(open);
    }
  });
});

describe('The Garage: bots can navigate it (1 m nav grid)', () => {
  let grid: NavGrid;
  beforeAll(async () => {
    const sim = await Sim.create({ seed: 1, world: data });
    sim.step();
    grid = navGridFor(sim);
    sim.dispose();
  });
  const L = (lx: number, lz: number): [number, number] => [GARAGE.x + lx, GARAGE.z + lz];

  it('the interior is walkable and connected to the main yard', () => {
    let walk = 0, n = 0;
    for (let lz = -9.5; lz <= 9.5; lz += 1) for (let lx = -11.5; lx <= 11.5; lx += 1) {
      n++;
      const [x, z] = L(lx, lz);
      if (isWalkable(grid, x, z)) walk++;
    }
    console.log(`[nav] garage interior walkable ${walk}/${n} cells`);
    expect(walk / n).toBeGreaterThan(0.4);
    for (const [lx, lz] of [[-2, 6], [-1, -3], [10, -2], [10, 8], [-9, -6.5]]) {
      const [x, z] = L(lx, lz);
      expect(isWalkable(grid, x, z), `interior ${lx},${lz}`).toBe(true);
      const i = Math.floor((z - grid.oz) / grid.cell) * grid.w + Math.floor((x - grid.ox) / grid.cell);
      expect(grid.region[i], `interior ${lx},${lz} in the main region`).toBe(grid.mainRegion);
    }
  });

  it('every door is found by the grid: straight walkable line outside -> inside, and A* paths through it', () => {
    const out: number[] = [];
    for (const d of GARAGE_DOORS) {
      const ox = d.x + d.nx * 3, oz = d.z + d.nz * 3, ix = d.x - d.nx * 3, iz = d.z - d.nz * 3;
      expect(isWalkable(grid, ox, oz), `${d.id} outside`).toBe(true);
      expect(isWalkable(grid, ix, iz), `${d.id} inside`).toBe(true);
      expect(lineWalkable(grid, ox, oz, ix, iz), `${d.id} straight through`).toBe(true);
      expect(findPath(grid, ox, oz, ix, iz, out), `${d.id} path`).toBe(true);
      // the path goes through the doorway (every point stays within 6 m of the door center)
      let far = 0;
      for (let k = 0; k + 1 < out.length; k += 2) far = Math.max(far, Math.hypot(out[k] - d.x, out[k + 1] - d.z));
      expect(far, `${d.id} path stays at the door`).toBeLessThan(6);
    }
    // cross-building paths: pet door -> roll-up door, side door -> back alley
    const pet = GARAGE_DOORS.find((d) => d.id === 'pet')!, roll = GARAGE_DOORS.find((d) => d.id === 'rollup')!;
    expect(findPath(grid, pet.x, pet.z - 4, roll.x, roll.z + 4, out)).toBe(true);
    const [ax, az] = L(17, -6);
    expect(isWalkable(grid, ax, az), 'back alley').toBe(true);
    expect(findPath(grid, GARAGE.x - 20, GARAGE.z + 8, ax, az, out)).toBe(true);
    void cellX; void cellZ;
  });
});

// Unused-type guard for PropBox (documents the collider type the checks above consume).
export type _Collider = PropBox;

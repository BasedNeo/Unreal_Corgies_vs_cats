// Wave 8 M2 "The Lot" (docs/design/EXPANSION_VISION.md, docs/handoff/W8-LOT.md): the map registry entry, determinism,
// build time, terrain (collider == height() == render), colliders == visuals (box and cylinder tops on the D3 3x3
// lattice, the pipes' lathe facets against their facet boxes, the cones' inscribed cylinders), palette keys, spawns,
// lamps, perches, districts and bookmarks. Pure data + Rapier; no sim.
import os from 'node:os';
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three/webgpu';
import type { Collider, World } from '@dimforge/rapier3d-compat';
import { buildTheLot, LOT_PIPES, lotFloodlights } from '../../src/shared/world/the-lot';
import { buildWestYard } from '../../src/shared/world/west-yard';
import { createWorldData, type PropBox, type VisualPrim, type WorldData } from '../../src/shared/world/world-data';
import { DEFAULT_MAP, MAPS, mapForMode, mapsForMode } from '../../src/shared/world/maps';
import { boxTopAt, districtAt, nearestPropDist, occupiedAt, surfaceAt, waterAt } from '../../src/shared/world/queries';
import { gridSlopeDeg } from '../../src/shared/world/terrain';
import { CONTAINER, LOT_EDGE, PIPE, PIT, HEAP } from '../../src/shared/world/lot/layout';
import { pipeFacets } from '../../src/shared/world/lot/pipes';
import { loadRapier, type Rapier } from '../../src/sim/rapier';
import { buildStaticWorld } from '../../src/sim/world/build';
import { mulberry32 } from '../../src/shared/rng';
import { Team } from '../../src/shared/types';
import { worldHex } from '../../src/client/world/world-palette';
import { primGeometry } from '../../src/client/world/prim-mesh';

let data: WorldData;
let R: Rapier;
const load = () => Math.max(1, os.loadavg()[0] / Math.max(1, os.cpus().length));

beforeAll(async () => {
  data = createWorldData(1, 'the_lot');
  R = await loadRapier();
});

describe('The Lot: registry', () => {
  it('is registered for the PvP modes; adventure and boss-rush fall back to the West Yard', () => {
    expect(MAPS.the_lot).toMatchObject({ id: 'the_lot', title: 'The Lot' });
    expect([...MAPS.the_lot.modes].sort()).toEqual(['core-rush', 'team-deathmatch', 'yard-skirmish']);
    expect(data.name).toBe('The Lot');
    expect(data.map).toBe('the_lot');
    for (const m of ['team-deathmatch', 'core-rush', 'yard-skirmish']) {
      expect(mapForMode('the_lot', m)).toBe('the_lot');
      expect(mapsForMode(m)).toEqual(['west_yard', 'the_lot']);
    }
    expect(mapForMode('the_lot', 'adventure')).toBe(DEFAULT_MAP);
    expect(mapForMode('the_lot', 'boss-rush')).toBe(DEFAULT_MAP);
    expect(mapsForMode('adventure')).toEqual(['west_yard']);
    expect(createWorldData(1).name).toBe('West Yard');
    expect(data.halfExtent).toBeGreaterThanOrEqual(150);
    expect(data.halfExtent).toBeLessThanOrEqual(170);
    expect(data.timeOfDay).toBeCloseTo(0.74, 2);
  });
});

describe('The Lot: determinism and build time', () => {
  it('is a pure function of the seed; another seed moves the mud and the clutter, never the layout', () => {
    const a = buildTheLot(7), b = buildTheLot(7), c = buildTheLot(8);
    expect(Buffer.from(a.terrain!.heights.buffer).equals(Buffer.from(b.terrain!.heights.buffer))).toBe(true);
    for (const k of ['props', 'cylinders', 'spawns', 'prims', 'water', 'lamps', 'bookmarks', 'fences'] as const) expect(JSON.stringify(a[k]), k).toBe(JSON.stringify(b[k]));
    for (let z = -150; z <= 150; z += 7.3) for (let x = -150; x <= 150; x += 7.3) expect(a.height(x, z)).toBe(b.height(x, z));
    let diff = 0;
    for (let x = -60; x <= 60; x += 6) diff += Math.abs(a.height(x, 31) - c.height(x, 31));
    expect(diff).toBeGreaterThan(0.01);
    expect(c.props.length).toBe(a.props.length);
    expect(c.spawns.map((s) => [s.x, s.z])).toEqual(a.spawns.map((s) => [s.x, s.z]));
    expect(c.height(PIT.x, PIT.z)).toBe(Math.fround(PIT.floor));       // floors and tops are exact on every seed
    expect(c.height(HEAP.x, HEAP.z)).toBe(Math.fround(HEAP.top));
  });

  it('builds in a few hundred ms (a fresh seed; the West Yard for scale)', () => {
    const time = (f: () => void) => { const c0 = process.cpuUsage(), t0 = performance.now(); f(); const c = process.cpuUsage(c0); return { wall: performance.now() - t0, cpu: (c.user + c.system) / 1000 }; };
    const lot = time(() => buildTheLot(4242)), wy = time(() => buildWestYard(4242));
    console.log(`[lot] build: The Lot ${lot.wall.toFixed(0)} ms wall / ${lot.cpu.toFixed(0)} ms cpu · West Yard ${wy.wall.toFixed(0)} / ${wy.cpu.toFixed(0)} · load ${os.loadavg()[0].toFixed(1)} on ${os.cpus().length} cores`);
    expect(Math.min(lot.wall, lot.cpu)).toBeLessThan(400 * load());
  });
});

describe('The Lot: terrain', () => {
  it('finite, pet-scale relief: the pit floor, the ditch and the heap top are exact; most of the lot is walkable', () => {
    const g = data.terrain!;
    let lo = Infinity, hi = -Infinity;
    for (const h of g.heights) { expect(Number.isFinite(h)).toBe(true); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    expect(lo).toBeCloseTo(PIT.floor, 5);
    expect(hi).toBeLessThan(HEAP.top + 1.2);
    expect(data.height(-60, -110)).toBe(Math.fround(PIT.floor));
    expect(data.height(30, 0)).toBeCloseTo(-1.9, 5);
    let walk = 0, n = 0;
    for (let z = -150; z <= 150; z += 2) for (let x = -150; x <= 150; x += 2) { n++; if (gridSlopeDeg(g, x, z) < 30) walk++; }
    expect(walk / n).toBeGreaterThan(0.85);
    // the perimeter stands on flat ground at y = 0
    for (let t = -150; t <= 150; t += 10) for (const [x, z] of [[t, -LOT_EDGE], [t, LOT_EDGE], [LOT_EDGE, t], [-LOT_EDGE, t]]) expect(Math.abs(data.height(x, z))).toBeLessThan(1e-6);
  });

  it('the terrain collider agrees with height() within 1 cm (random points + a 0.5 m lattice over the carves and the heap)', () => {
    const world: World = new R.World({ x: 0, y: -24, z: 0 });
    buildStaticWorld(R, world, data);
    let hf: Collider | undefined;
    world.forEachCollider((c) => { if (c.shape.type === R.ShapeType.TriMesh) hf = c; });
    world.step();
    const down = (x: number, z: number) => {
      const hit = world.castRay(new R.Ray({ x, y: 60, z }, { x: 0, y: -1, z: 0 }), 120, true, undefined, undefined, undefined, undefined, (c) => c.handle === hf!.handle);
      return hit ? 60 - hit.timeOfImpact : NaN;
    };
    const rnd = mulberry32(5);
    let worst = 0;
    for (let k = 0; k < 400; k++) {
      const x = -158 + rnd() * 316, z = -158 + rnd() * 316;
      worst = Math.max(worst, Math.abs(down(x, z) - data.height(x, z)));
    }
    expect(worst).toBeLessThan(0.01);
    let miss = 0, n = 0;
    const windows: [number, number, number, number][] = [[-82, -126, 14, -43], [-150, -6, 150, 6], [-18, 80, 92, 128]];
    for (const [x0, z0, x1, z1] of windows) for (let z = z0; z <= z1; z += 0.5) for (let x = x0; x <= x1; x += 0.5) {
      n++;
      if (!(Math.abs(down(x, z) - data.height(x, z)) <= 0.01)) miss++;
    }
    expect(n).toBeGreaterThan(20000);
    expect(miss).toBe(0);
    world.free();
  });
});

// ------------------------------------------------------------------------------------------------ colliders == visuals
/** Visual top of box / upright-cylinder prims along the vertical line (x, z), at or below yMax (D3's method). */
function visualTop(prims: readonly VisualPrim[], x: number, z: number, yMax: number): number {
  let best = -Infinity;
  for (const p of prims) {
    if (Math.abs(p.x - x) > 30 || Math.abs(p.z - z) > 30) continue;
    let t = -Infinity;
    if (p.s === 'box') t = boxTopAt({ type: 'v', x: p.x, y: p.y, z: p.z, hx: p.a / 2, hy: p.b / 2, hz: p.c / 2, rotY: p.yaw ?? 0, pitch: p.pitch, roll: p.roll }, x, z);
    else if (p.s === 'cyl' && !p.pitch && !p.roll && Math.hypot(x - p.x, z - p.z) <= Math.max(p.a, p.c)) t = p.y + p.b / 2;
    if (t <= yMax && t > best) best = t;
  }
  return best;
}

/** Colliders whose visual is not a box/cylinder top: pipe facets (lathe, checked below), perimeter walls (fence
 *  boards / hoarding panels, checked below), invisible blockers. */
const OTHER = new Set(['boundary', 'pipe', 'hoarding', 'fence']);

describe('The Lot: colliders == visuals', () => {
  let solid: VisualPrim[];
  beforeAll(() => { solid = (data.prims ?? []).filter((p) => p.g !== 'noink' && Math.max(Math.abs(p.x), Math.abs(p.z)) < LOT_EDGE + 2); });

  it('every box collider: its standing surface (3x3 lattice) has a visual top within 1 cm', () => {
    const boxes = data.props.filter((b) => !OTHER.has(b.type));
    expect(boxes.length).toBeGreaterThan(120);
    let worst = 0, where = '';
    for (const b of boxes) {
      for (const u of [-0.8, 0, 0.8]) for (const v of [-0.8, 0, 0.8]) {
        const c = Math.cos(b.rotY), s = Math.sin(b.rotY), lx = u * b.hx, lz = v * b.hz;
        const x = b.x + lx * c + lz * s, z = b.z - lx * s + lz * c;
        const top = boxTopAt(b, x, z);
        if (!Number.isFinite(top)) continue;
        const err = Math.abs(visualTop(solid, x, z, top + 0.05) - top);
        if (err > worst) { worst = err; where = `${b.type} @ ${x.toFixed(2)},${z.toFixed(2)} collider ${top.toFixed(3)}`; }
      }
    }
    expect(worst, where).toBeLessThanOrEqual(0.01);
  });

  it('every upright cylinder collider (but the cones): its top disc has a visual top within 1 cm', () => {
    const cyls = (data.cylinders ?? []).filter((c) => c.type !== 'cone');
    expect(cyls.length).toBeGreaterThan(20);
    let worst = 0, where = '';
    for (const c of cyls) {
      const top = c.y + c.hh;
      for (const [dx, dz] of [[0, 0], [c.r * 0.6, 0], [0, -c.r * 0.6]]) {
        const err = Math.abs(visualTop(solid, c.x + dx, c.z + dz, top + 0.05) - top);
        if (err > worst) { worst = err; where = `${c.type} @ ${c.x.toFixed(1)},${c.z.toFixed(1)}`; }
      }
    }
    expect(worst, where).toBeLessThanOrEqual(0.01);
  });

  it('the pipes: every rendered lathe vertex lies on a facet collider face (1 cm), every facet face is rendered', () => {
    const pipes = LOT_PIPES.get(data)!;
    expect(pipes.length).toBe(8);
    const rings = (data.prims ?? []).filter((p) => p.s === 'ring');
    expect(rings.length).toBe(8);
    const boxes = data.props.filter((b) => b.type === 'pipe');
    expect(boxes.length).toBe(8 * PIPE.seg);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3();
    /** Distance from a point to the surface of the nearest facet box. */
    const toBoxes = (x: number, y: number, z: number, list: PropBox[]) => {
      let best = Infinity;
      for (const b of list) {
        e.set(b.pitch ?? 0, b.rotY, b.roll ?? 0, 'YXZ');
        const inv = new THREE.Quaternion().setFromEuler(e).invert();
        const l = new THREE.Vector3(x - b.x, y - b.y, z - b.z).applyQuaternion(inv);
        const dx = Math.abs(l.x) - b.hx, dy = Math.abs(l.y) - b.hy, dz = Math.abs(l.z) - b.hz;
        const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
        best = Math.min(best, outside > 0 ? outside : -Math.max(dx, dy, dz));
      }
      return best;
    };
    let worst = 0, checked = 0;
    for (const p of pipes) {
      const ring = rings.find((r) => Math.hypot(r.x - p.x, r.y - p.y, r.z - p.z) < 1e-6)!;
      expect(ring).toBeTruthy();
      const mine = boxes.filter((b) => Math.hypot(b.x - p.x, b.z - p.z) < PIPE.len);
      const geo = primGeometry(ring, true);
      e.set(ring.pitch ?? 0, ring.yaw ?? 0, ring.roll ?? 0, 'YXZ');
      m.compose(new THREE.Vector3(ring.x, ring.y, ring.z), q.setFromEuler(e), new THREE.Vector3(1, 1, 1));
      const pos = geo.getAttribute('position');
      const axis = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        const along = Math.abs(new THREE.Vector3(v.x - p.x, v.y - p.y, v.z - p.z).dot(axis));
        if (along > PIPE.len / 2 - 0.12 + 1e-3) continue;                 // the mouths' 0.12 m chamfers
        worst = Math.max(worst, Math.abs(toBoxes(v.x, v.y, v.z, mine)));
        checked++;
      }
      // the other way: each facet box's outer and inner face centres lie on the rendered lathe polygon (flat facets)
      for (const f of pipeFacets(p, PIPE)) {
        for (const r of [f.outer, f.inner]) {
          const px = p.x + f.n[0] * r, py = p.y + f.n[1] * r, pz = p.z + f.n[2] * r;
          expect(Math.abs(toBoxes(px, py, pz, mine))).toBeLessThan(0.01);
        }
      }
      // a flat, walkable floor facet (the tunnel floor) and a flat crown
      expect(p.floorY - (data.height(p.x, p.z) - PIPE.sink)).toBeCloseTo((PIPE.ro - PIPE.ri) * Math.cos(Math.PI / PIPE.seg), 5);
    }
    expect(checked).toBeGreaterThan(8 * 30);
    expect(worst).toBeLessThan(0.01);
  });

  it('the cones: the collider cylinder is inside the visual cone (no invisible walls around a cone)', () => {
    const cones = (data.cylinders ?? []).filter((c) => c.type === 'cone');
    expect(cones.length).toBe(8);
    for (const c of cones) {
      const vis = (data.prims ?? []).find((p) => p.s === 'cone' && Math.hypot(p.x - c.x, p.z - c.z) < 0.01)!;
      const base = vis.y - vis.b / 2, rAt = (y: number) => vis.a * (1 - (y - base) / vis.b);
      expect(c.y - c.hh).toBeGreaterThanOrEqual(base - 1e-6);
      expect(c.r).toBeLessThanOrEqual(rAt(c.y + c.hh) + 1e-6);
    }
  });

  it('the perimeter: hoarding and fence colliders face the lot where the panels and boards do (1 cm)', () => {
    const walls = data.props.filter((b) => b.type === 'hoarding' || b.type === 'fence');
    expect(walls.length).toBe(4);
    for (const b of walls) {
      // the inner face of every wall is the LOT_EDGE line
      const inner = Math.min(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([nx, nz]) => {
        const c = Math.cos(b.rotY), s = Math.sin(b.rotY);
        const ext = Math.abs(nx * c - nz * s) * b.hx + Math.abs(nx * s + nz * c) * b.hz;
        return LOT_EDGE - Math.abs(nx * b.x + nz * b.z) + (Math.abs(nx * b.x + nz * b.z) > 100 ? ext : Infinity);
      }).map(Math.abs));
      if (b.type === 'hoarding') expect(inner).toBeLessThan(0.01);
    }
    const panels = (data.prims ?? []).filter((p) => p.s === 'box' && Math.abs(p.b - 9.8) < 1e-6);
    expect(panels.length).toBeGreaterThan(150);
    for (const p of panels) {
      const inner = LOT_EDGE - (Math.max(Math.abs(p.x), Math.abs(p.z)) - p.a / 2);
      expect(Math.abs(inner)).toBeLessThan(0.01);
    }
  });

  it('uses only palette colors that exist (style tokens + world palette)', () => {
    const keys = new Set((data.prims ?? []).map((p) => p.col).concat((data.lamps ?? []).map((l) => l.col ?? 'lampTube')));
    for (const k of keys) expect(() => worldHex(k), k).not.toThrow();
  });
});

// ------------------------------------------------------------------------------------------------ layout
describe('The Lot: spawns, lamps, perches, districts, bookmarks', () => {
  it('16 spawns per team, 6 m apart, on flat dry terrain >= 1.5 m from props, facing the other base', () => {
    const t0 = data.spawns.filter((s) => s.team === Team.Corgis), t1 = data.spawns.filter((s) => s.team === Team.Cats);
    expect(t0.length).toBe(16);
    expect(t1.length).toBe(16);
    for (const team of [t0, t1]) for (const a of team) for (const b of team) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(5.9);
    for (const a of t0) for (const b of t1) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(180);
    for (const s of data.spawns) {
      expect(surfaceAt(data, s.x, s.z).kind, `spawn ${s.x},${s.z}`).toBe('terrain');
      expect(Math.abs(s.y - data.height(s.x, s.z))).toBeLessThan(0.1);
      expect(gridSlopeDeg(data.terrain!, s.x, s.z)).toBeLessThan(5);
      expect(waterAt(data, s.x, s.z)).toBeNull();
      expect(nearestPropDist(data, s.x, s.z), `spawn ${s.x},${s.z} too close to a prop`).toBeGreaterThanOrEqual(1.5);
      const fz = -Math.cos(s.yaw);
      expect(s.team === Team.Corgis ? fz > 0.5 : fz < -0.5).toBe(true);
      const b = data.bounds!;
      expect(s.x > b.minX + 10 && s.x < b.maxX - 10 && s.z > b.minZ + 10 && s.z < b.maxZ - 10).toBe(true);
    }
  });

  it('floodlights: 4 towers x 4 sodium heads, two per base, aimed at open ground; the container tubes', () => {
    const lamps = data.lamps ?? [];
    expect(lamps.filter((l) => l.col === 'sodium').length).toBe(16);
    expect(lamps.filter((l) => l.col === 'lampTube').length).toBe(4);
    const floods = lotFloodlights(data);
    expect(floods.length).toBe(4);
    expect(floods.filter((f) => f.team === 0).length).toBe(2);
    for (const f of floods) {
      expect(f.pos[1] - f.target[1]).toBeGreaterThan(18);
      expect(Math.hypot(f.pos[0] - f.target[0], f.pos[2] - f.target[2])).toBeGreaterThan(8);
      expect(occupiedAt(data, f.target[0], f.target[1] + 0.5, f.target[2])).toBe(false);
    }
  });

  it('perches stand on real surfaces with room for a character; districts name the lanes', () => {
    for (const p of data.perches ?? []) {
      expect(Math.abs(surfaceAt(data, p.x, p.z, p.y + 0.5).y - p.y), p.id).toBeLessThan(0.02);
      for (const dy of [0.3, 0.8, 1.2]) expect(occupiedAt(data, p.x, p.y + dy, p.z), `${p.id} +${dy}`).toBe(false);
    }
    const at = (x: number, z: number) => districtAt(data, x, z)?.id;
    expect(at(-60, -110)).toBe('lot_foundation');
    expect(at(-40, -80)).toBe('lot_trenches');
    expect(at(-85, -32)).toBe('lot_canyon');
    expect(at(85, 29)).toBe('lot_pipeworks');
    expect(at(60, 110)).toBe('lot_scaffolds');
    expect(at(30, 0)).toBe('lot_ditch');
    expect(at(10, 30)).toBe('lot_mud');
  });

  it('the hero bookmarks exist, and no camera starts inside a prop or under the ground', () => {
    const names = (data.bookmarks ?? []).map((b) => b.name);
    for (const n of ['lot_corgi_base', 'lot_container_canyon', 'lot_pipe_mouth', 'lot_cat_scaffold', 'lot_overview']) expect(names, n).toContain(n);
    for (const b of data.bookmarks ?? []) {
      const [x, y, z] = b.pos;
      expect(occupiedAt(data, x, y, z, 0.3), b.name).toBe(false);
      expect(y - data.height(x, z), b.name).toBeGreaterThan(0.8);
    }
    const over = data.bookmarks!.find((b) => b.name === 'lot_overview')!;
    expect(over.pos[1]).toBeGreaterThan(90);                                  // on the crane jib
    expect(CONTAINER.H).toBeCloseTo(10.4, 5);
  });
});

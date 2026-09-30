// W11 P-GLB1b: the bag-wall kit's COL_ box, tiled the way ?kit=glb draws it, equals the sim's bag-wall colliders. The
// authority never reads a GLB: The Lot's bag walls collide through src/shared world data (props.ts bagWall(): one
// 'bags' box per wall); ?kit=glb draws each wall as m = round(len / 4.8) Kit_Lot_BagWall_01 modules stretched along z.
// This proves the modules' COL_ boxes, placed exactly as the client places them, tile every wall's box within 1 cm
// (end to end, no gap, no overlap), for seeds 1 and 7, on the master and on the web variant (quantized).
import { describe, expect, it } from 'vitest';
import { createWorldData } from '../../src/shared/world/world-data';
import { KIT_BAGWALL, KIT_BAGWALL_LEN, bagWallModules, lotBagWalls, splitBagWallPrims, splitLotKitPrims } from '../../src/client/assets/kit-glb';
import { colliderBoxes, createIO } from '../../tools/assets/validate-glb.mjs';

const MASTER = `assets/masters/${KIT_BAGWALL}.glb`;
const WEB = `public/assets/kits/${KIT_BAGWALL}.glb`;
const TOL = 0.01;

interface Box { center: number[]; half: number[] }

async function glbBoxes(path: string): Promise<Box[]> {
  const io = await createIO();
  return colliderBoxes(await io.read(path));
}

describe('P-GLB1b Kit_Lot_BagWall_01 COL_ = sim bag-wall colliders', () => {
  for (const seed of [1, 7]) {
    const data = createWorldData(seed, 'the_lot');
    const walls = lotBagWalls(data);

    it(`seed ${seed}: 8 walls, all two rows high, modules stretched 0.85-1.2`, () => {
      expect(walls.length).toBe(8);
      for (const w of walls) {
        const mods = bagWallModules(w);
        expect(mods.length).toBe(Math.max(1, Math.round(w.len / KIT_BAGWALL_LEN)));
        for (const m of mods) {
          expect(m.sz!).toBeGreaterThan(0.85);
          expect(m.sz!).toBeLessThan(1.2);
        }
      }
    });

    for (const [label, path] of [['master', MASTER], ['web', WEB]] as const) {
      it(`seed ${seed}: ${label} GLB box, tiled along every wall, equals its collider within 1 cm`, async () => {
        const boxes = await glbBoxes(path);
        expect(boxes.length).toBe(1);
        const [b] = boxes;
        const sims = data.props.filter((p) => p.type === 'bags');
        expect(sims.length).toBe(walls.length);
        for (const sim of sims) {
          const w = walls.find((q) => Math.abs(q.x - sim.x) < 1e-9 && Math.abs(q.z - sim.z) < 1e-9)!;
          // each module's box in the wall's own frame (local z along the wall): the instance matrix T(x, y, z) R(yaw)
          // S(1, 1, sz) applied to the kit box, then taken back into the wall frame
          const s = Math.sin(w.yaw), c = Math.cos(w.yaw);
          const spans: [number, number][] = [];
          for (const m of bagWallModules(w)) {
            const sz = m.sz!;
            const lz = (m.x - w.x) * s + (m.z - w.z) * c;           // the module's centre along the wall
            const lx = (m.x - w.x) * c - (m.z - w.z) * s;
            expect(Math.abs(lx)).toBeLessThan(1e-9);
            const zc = lz + b.center[2] * sz, hz = b.half[2] * sz;
            // across the wall and up: unscaled
            expect(Math.abs(b.center[0] - 0)).toBeLessThanOrEqual(TOL);
            expect(Math.abs(b.half[0] - sim.hx)).toBeLessThanOrEqual(TOL);
            expect(Math.abs(m.y + b.center[1] - sim.y)).toBeLessThanOrEqual(TOL);
            expect(Math.abs(b.half[1] - sim.hy)).toBeLessThanOrEqual(TOL);
            spans.push([zc - hz, zc + hz]);
          }
          spans.sort((a, q) => a[0] - q[0]);
          // end to end: the union is [-hz, hz] of the sim box, consecutive modules touch (no gap, no overlap)
          expect(Math.abs(spans[0][0] + sim.hz)).toBeLessThanOrEqual(TOL);
          expect(Math.abs(spans[spans.length - 1][1] - sim.hz)).toBeLessThanOrEqual(TOL);
          for (let k = 1; k < spans.length; k++) expect(Math.abs(spans[k][0] - spans[k - 1][1])).toBeLessThanOrEqual(TOL);
          expect(Math.abs((sim.rotY ?? 0) - w.yaw)).toBeLessThan(1e-12);
        }
      });
    }
  }
});

describe('P-GLB1b ?kit=glb bag-wall split', () => {
  it('splitBagWallPrims removes exactly the procedural bag walls (every rebuilt prim found)', () => {
    const data = createWorldData(1, 'the_lot');
    const split = splitBagWallPrims(data);
    expect(split.missing).toBe(0);
    expect(split.walls.length).toBeGreaterThan(40);
    expect(split.rest.length + split.walls.length).toBe(data.prims!.length);
    expect(split.placements.length).toBe(lotBagWalls(data).reduce((n, w) => n + Math.max(1, Math.round(w.len / KIT_BAGWALL_LEN)), 0));
  });

  it('the Lot split takes containers and bag walls apart, nothing twice', () => {
    const data = createWorldData(7, 'the_lot');
    const s = splitLotKitPrims(data);
    expect(s.containers.missing).toBe(0);
    expect(s.bags.missing).toBe(0);
    // (P-GLB3: the LOT_KIT table splits more pieces after these two; they are counted in glb-lot-batch1.test.ts)
    const later = s.pieces.slice(2).reduce((n, p) => n + p.matched.length, 0);
    expect(s.rest.length + s.containers.containers.length + s.bags.walls.length + later).toBe(data.prims!.length);
  });

  it('the West Yard has no bag walls (only props.ts bagWall() emits "bags"): nothing to split', () => {
    const data = createWorldData(1, 'west_yard');
    expect(lotBagWalls(data).length).toBe(0);
    const split = splitBagWallPrims(data);
    expect(split.placements.length).toBe(0);
    expect(split.walls.length).toBe(0);
  });
});

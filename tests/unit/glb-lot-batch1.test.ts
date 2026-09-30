// W11 P-GLB3: batch 1 of The Lot's kit (Kit_Lot_Pipe_01, Kit_Lot_Footing_01, Kit_Lot_FloodMast_01, Kit_Lot_FloodLamp_01)
// against the world data the authority uses. The authority never reads a GLB: The Lot collides through src/shared
// (pipes.ts addPipe()'s facet boxes, props.ts footing() and floodTower()). This proves, for seeds 1 and 7, on the master
// and on the web variant (quantized), that each piece's COL_ boxes, placed exactly as ?kit=glb places the piece
// (T(x, y, z) Ry(yaw) Rx(pitch)), equal the sim's colliders corner for corner within 1 cm; that the pipe's bore lies in
// lotInteriors()'s box (W10 P5: where the sky fill is shut out) with its floor, crown and sides on the box's faces; and
// that the split finds every procedural prim it replaces (missing = 0) and takes nothing twice.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createWorldData } from '../../src/shared/world/world-data';
import { PIPE } from '../../src/shared/world/lot/layout';
import type { WorldData } from '../../src/shared/world/world-types';
import {
  KIT_FLOODLAMP, KIT_FLOODMAST, KIT_FOOTING, KIT_PIPE, LOT_KIT, splitFloodLampPrims, splitFloodMastPrims, splitFootingPrims,
  splitLotKitPrims, splitPipePrims, type KitPlacement,
} from '../../src/client/assets/kit-glb';
import { colliderObbs, createIO } from '../../tools/assets/validate-glb.mjs';

const TOL = 0.01;
type V3 = [number, number, number];
const files = (name: string) => [['master', `assets/masters/${name}.glb`], ['web', `public/assets/kits/${name}.glb`]] as const;

async function readDoc(path: string) {
  const io = await createIO();
  return io.read(path);
}

/** 8 corners of a box: centre, half extents along its own axes, rotation (Euler YXZ: yaw, pitch, roll as the sim). */
function simCorners(b: { x: number; y: number; z: number; hx: number; hy: number; hz: number; rotY?: number; pitch?: number; roll?: number }): V3[] {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.pitch ?? 0, b.rotY ?? 0, b.roll ?? 0, 'YXZ'));
  const out: V3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const v = new THREE.Vector3(sx * b.hx, sy * b.hy, sz * b.hz).applyQuaternion(q);
    out.push([b.x + v.x, b.y + v.y, b.z + v.z]);
  }
  return out;
}

const placeMatrix = (p: KitPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(p.pitch ?? 0, p.yaw, 0, 'YXZ')), new THREE.Vector3(1, 1, p.sz ?? 1));
const apply = (m: THREE.Matrix4, v: number[]): V3 => { const w = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(m); return [w.x, w.y, w.z]; };
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Largest distance from a corner of `a` to the nearest corner of `b` (0 when the boxes are the same). */
const cornerGap = (a: V3[], b: V3[]) => Math.max(...a.map((p) => Math.min(...b.map((q) => dist(p, q)))));

/** Every sim box has exactly one kit box (placed) with the same 8 corners within TOL, and nothing is left over. */
function expectSameBoxes(sims: V3[][], kits: V3[][], what: string) {
  expect(kits.length, `${what}: kit boxes`).toBe(sims.length);
  const used = new Set<number>();
  for (const [i, s] of sims.entries()) {
    let best = -1, gap = Infinity;
    kits.forEach((k, j) => { if (!used.has(j)) { const g = Math.max(cornerGap(s, k), cornerGap(k, s)); if (g < gap) { gap = g; best = j; } } });
    expect(gap, `${what}: sim box ${i} vs its nearest kit box`).toBeLessThanOrEqual(TOL);
    used.add(best);
  }
}

async function placedColliders(path: string, placements: KitPlacement[], filter?: (b: { sim_type?: string }) => boolean) {
  const boxes = colliderObbs(await readDoc(path)).filter((b: { sim_type?: string }) => !filter || filter(b));
  const out: V3[][] = [];
  for (const p of placements) { const m = placeMatrix(p); for (const b of boxes) out.push(b.corners.map((c: number[]) => apply(m, c))); }
  return { boxes, placed: out };
}

/** World positions of a kit's LOD0 vertices (the node's matrix applied: the web variant's quantization lives there). */
async function lod0Positions(path: string, name: string): Promise<V3[]> {
  const doc = await readDoc(path);
  const node = doc.getRoot().listNodes().find((n) => n.getName() === `${name}_LOD0`)!;
  const m = new THREE.Matrix4().fromArray(node.getWorldMatrix() as number[]);
  const out: V3[] = [];
  for (const p of node.getMesh()!.listPrimitives()) {
    const pos = p.getAttribute('POSITION')!;
    for (let i = 0; i < pos.getCount(); i++) out.push(apply(m, pos.getElement(i, [0, 0, 0])));
  }
  return out;
}

const seeds = [1, 7];
const worlds = new Map<number, WorldData>(seeds.map((s) => [s, createWorldData(s, 'the_lot')]));

describe('P-GLB3 Kit_Lot_Pipe_01: COL_ = the sim pipe facets, the bore = lotInteriors()', () => {
  for (const seed of seeds) {
    const data = worlds.get(seed)!;
    const split = splitPipePrims(data);
    it(`seed ${seed}: 8 pipes (6 tunnel segments + 2 loose), every ring prim found`, () => {
      expect(split.placements.length).toBe(8);
      expect(split.matched.length).toBe(8);
      expect(split.missing).toBe(0);
    });
    for (const [label, path] of files(KIT_PIPE)) {
      it(`seed ${seed}: ${label} COL_ (12 per pipe: 4 box + 8 obb) placed at every pipe = the sim's 96 facet boxes within 1 cm`, async () => {
        const { boxes, placed } = await placedColliders(path, split.placements);
        expect(boxes.length).toBe(PIPE.seg);
        expect(boxes.filter((b: { collider: string }) => b.collider === 'obb').length).toBe(8);
        const sims = data.props.filter((p) => p.type === 'pipe');
        expect(sims.length).toBe(8 * PIPE.seg);
        expectSameBoxes(sims.map(simCorners), placed, `${label} pipes`);
      });
      it(`seed ${seed}: ${label} bore lies in its interior box, floor / crown / sides on the box faces, mouth to mouth`, async () => {
        const pts = await lod0Positions(path, KIT_PIPE);
        const yc = PIPE.ro * Math.cos(Math.PI / PIPE.seg);
        // the bore: LOD0 vertices within ri (+1 mm) of the axis (the outer facets and rims are >= 2.88 m out)
        const bore = pts.filter((p) => Math.hypot(p[0], p[1] - yc) < PIPE.ri + 0.001);
        expect(bore.length).toBeGreaterThanOrEqual(2 * PIPE.seg);
        const boxes = data.interiors ?? [];
        for (const p of split.placements) {
          const m = placeMatrix(p);
          const w = bore.map((v) => apply(m, v));
          const axis = apply(m, [0, yc, 0]);
          const box = boxes.filter((b) => dist([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2], axis) < TOL);
          expect(box.length, `interior box of the pipe at ${p.x}, ${p.z}`).toBe(1);
          const [b] = box;
          for (const v of w) for (let k = 0; k < 3; k++) {
            expect(v[k]).toBeGreaterThanOrEqual(b.min[k] - TOL);
            expect(v[k]).toBeLessThanOrEqual(b.max[k] + TOL);
          }
          // tight: the bore's extent on every axis is the box's (the flat floor, crown and sides lie on its faces;
          // along the axis, the mouths are its ends)
          for (let k = 0; k < 3; k++) {
            expect(Math.abs(Math.min(...w.map((v) => v[k])) - b.min[k])).toBeLessThanOrEqual(TOL);
            expect(Math.abs(Math.max(...w.map((v) => v[k])) - b.max[k])).toBeLessThanOrEqual(TOL);
          }
          // and the bore holds the box's inscribed cylinder: every inner facet's midline is at least the box's half
          // width from the axis (the box's four long edges, beyond that circle, lie in the pipe wall by P5's design)
          const half = Math.min(...[0, 1, 2].map((k) => (b.max[k] - b.min[k]) / 2));
          const uniq = [...new Map(bore.filter((v) => Math.abs(v[2] - bore[0][2]) < 1e-3).map((v) => [v.map((c) => c.toFixed(3)).join(','), v])).values()];
          const ring = uniq.sort((a, q) => Math.atan2(a[1] - yc, a[0]) - Math.atan2(q[1] - yc, q[0]));
          expect(ring.length).toBe(PIPE.seg);
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i], c = ring[(i + 1) % ring.length];
            expect(Math.hypot((a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - yc)).toBeGreaterThanOrEqual(half - TOL);
          }
        }
      });
    }
  }
});

describe('P-GLB3 Kit_Lot_Footing_01 and the floodlight pieces: COL_ = the sim', () => {
  for (const seed of seeds) {
    const data = worlds.get(seed)!;
    const foot = splitFootingPrims(data);
    const mast = splitFloodMastPrims(data);
    const lamp = splitFloodLampPrims(data);
    it(`seed ${seed}: 6 footings, 4 masts, 16 lamps; every procedural prim found`, () => {
      expect([foot.placements.length, mast.placements.length, lamp.placements.length]).toEqual([6, 4, 16]);
      expect([foot.missing, mast.missing, lamp.missing]).toEqual([0, 0, 0]);
      expect(foot.matched.length).toBe(6 * 4);            // block, 2 panels, the oil stain
      expect(mast.matched.length).toBe(4 * 5);            // base, plate, 2 pocket plates, mast
      expect(lamp.matched.length).toBe(16);
    });
    for (const [label, path] of files(KIT_FOOTING)) {
      it(`seed ${seed}: ${label} footing COL_ at the 6 blocks (with their yaw) = the sim within 1 cm`, async () => {
        const { placed } = await placedColliders(path, foot.placements);
        expectSameBoxes(data.props.filter((p) => p.type === 'footing').map(simCorners), placed, `${label} footings`);
      });
    }
    for (const [label, path] of files(KIT_FLOODMAST)) {
      it(`seed ${seed}: ${label} mast COL_ = flood_base boxes and the flood_mast cylinders' bounding boxes`, async () => {
        const base = await placedColliders(path, mast.placements, (b) => b.sim_type === 'flood_base');
        expectSameBoxes(data.props.filter((p) => p.type === 'flood_base').map(simCorners), base.placed, `${label} bases`);
        const cyl = await placedColliders(path, mast.placements, (b) => b.sim_type === 'flood_mast');
        const sims = (data.cylinders ?? []).filter((c) => c.type === 'flood_mast').map((c) => simCorners({ x: c.x, y: c.y, z: c.z, hx: c.r, hy: c.hh, hz: c.r }));
        expectSameBoxes(sims, cyl.placed, `${label} masts`);
      });
    }
    for (const [label, path] of files(KIT_FLOODLAMP)) {
      it(`seed ${seed}: ${label} lamp COL_ turned by yaw and pitch at the 16 heads = the sim within 1 cm`, async () => {
        const { placed } = await placedColliders(path, lamp.placements);
        expectSameBoxes(data.props.filter((p) => p.type === 'flood_head').map(simCorners), placed, `${label} lamps`);
      });
    }
    it(`seed ${seed}: every sodium lens (lamps-view, the world's) sits 1 cm proud of a GLB housing's +z face, on its centre`, () => {
      const lens = (data.lamps ?? []).filter((l) => l.col === 'sodium');
      expect(lens.length).toBe(16);
      for (const l of lens) {
        const local = lamp.placements.map((p) => apply(placeMatrix(p).invert(), [l.x, l.y, l.z]));
        const best = local.reduce((a, q) => (Math.hypot(q[0], q[1] - 0.475) < Math.hypot(a[0], a[1] - 0.475) ? q : a));
        expect(Math.abs(best[0])).toBeLessThan(TOL);
        expect(Math.abs(best[1] - 0.475)).toBeLessThan(TOL);
        expect(Math.abs(best[2] - 0.36)).toBeLessThan(TOL);      // the housing's face is at 0.35
      }
    });
  }
});

describe('P-GLB3 the LOT_KIT table', () => {
  it('splits every piece once: rest + every piece = all prims; the four lamp bars stay procedural', () => {
    const data = worlds.get(7)!;
    const s = splitLotKitPrims(data);
    expect(s.pieces.map((p) => p.piece.name)).toEqual(LOT_KIT.map((e) => e.piece.name));
    for (const p of s.pieces) expect(p.missing, p.piece.name).toBe(0);
    expect(s.rest.length + s.pieces.reduce((n, p) => n + p.matched.length, 0)).toBe(data.prims!.length);
    const bars = data.props.filter((p) => p.type === 'flood_bar');
    for (const b of bars) expect(s.rest.some((q) => q.s === 'box' && Math.abs(q.x - b.x) < 1e-6 && Math.abs(q.y - b.y) < 1e-6 && Math.abs(q.z - b.z) < 1e-6)).toBe(true);
  });
  it('the West Yard has none of the batch-1 pieces: nothing to split', () => {
    const data = createWorldData(1, 'west_yard');
    for (const f of [splitPipePrims, splitFootingPrims, splitFloodMastPrims, splitFloodLampPrims]) {
      const r = f(data);
      expect(r.placements.length).toBe(0);
      expect(r.matched.length).toBe(0);
    }
  });
});

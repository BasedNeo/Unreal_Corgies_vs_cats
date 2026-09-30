// W11 P-GLB4: real distance LODs for The Lot's kit at one draw per piece. Every piece is ONE mesh (buildKitBatch) that
// holds every LOD of every placement baked in world space; its index holds each placement's chosen LOD
// (kitLodSelect: by camera distance, with hysteresis). This proves the selection (switch distances, the hysteresis
// band, no flicker, ?kitlod=), that the batch is exact (each placement's vertices = placement x LOD node matrix x source,
// normals and tangents turned with it, the index picking exactly the chosen LODs), and, on the six web GLBs as
// GLTFLoader hands them over (quantized, normalized), that the batch reproduces what the per-LOD InstancedMeshes drew.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createWorldData } from '../../src/shared/world/world-data';
import {
  KIT_LOD_HYST, KIT_SHADOW_LAYER, LOT_KIT, buildKitBatch, createKitShadowCaster, kitForcedLod, kitLodAt, kitLodFor,
  kitLodSelect, kitPlacementMatrix, kitTint, splitLotKitPrims, type KitPlacement,
} from '../../src/client/assets/kit-glb';
import { PBR_PAINT_TINT } from '../../src/client/style/style-webgpu.js';
import { createIO } from '../../tools/assets/validate-glb.mjs';

describe('P-GLB4 kitLodSelect: LOD by camera distance, with hysteresis', () => {
  const D = [30, 80] as const;

  it('with no previous LOD it is the plain switch (kitLodAt), at and around both distances', () => {
    for (const d of [0, 10, 29.99, 30, 30.01, 79.99, 80, 500]) expect(kitLodSelect(d, D), `d ${d}`).toBe(kitLodAt(d, D));
    expect([10, 69.9, 70, 159.9, 160, 400].map(kitLodFor)).toEqual([0, 0, 1, 1, 2, 2]);   // the container's, unchanged
  });

  it('goes coarser only beyond dist x (1 + h), finer only inside dist x (1 - h)', () => {
    const h = KIT_LOD_HYST;
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(0.2);
    // 0 -> 1 at 30 (1 + h), not before
    expect(kitLodSelect(30 * (1 + h) - 0.01, D, 0)).toBe(0);
    expect(kitLodSelect(30 * (1 + h), D, 0)).toBe(1);
    // 1 -> 0 at 30 (1 - h), not before
    expect(kitLodSelect(30 * (1 - h) + 0.01, D, 1)).toBe(1);
    expect(kitLodSelect(30 * (1 - h) - 0.01, D, 1)).toBe(0);
    // 1 -> 2 and 2 -> 1 around 80
    expect(kitLodSelect(80 * (1 + h) - 0.01, D, 1)).toBe(1);
    expect(kitLodSelect(80 * (1 + h), D, 1)).toBe(2);
    expect(kitLodSelect(80 * (1 - h) + 0.01, D, 2)).toBe(2);
    expect(kitLodSelect(80 * (1 - h) - 0.01, D, 2)).toBe(1);
    // a jump skips a level both ways
    expect(kitLodSelect(200, D, 0)).toBe(2);
    expect(kitLodSelect(5, D, 2)).toBe(0);
    // inside the band either neighbour is kept; well inside a LOD's range the previous LOD does not matter
    expect(kitLodSelect(30, D, 0)).toBe(0);
    expect(kitLodSelect(30, D, 1)).toBe(1);
    for (const prev of [0, 1, 2]) {
      expect(kitLodSelect(10, D, prev)).toBe(0);
      expect(kitLodSelect(55, D, prev)).toBe(1);
      expect(kitLodSelect(300, D, prev)).toBe(2);
    }
    // h = 0 is the plain switch whatever the previous LOD
    for (const d of [10, 30, 55, 80, 300]) for (const prev of [0, 1, 2]) expect(kitLodSelect(d, D, prev, 0)).toBe(kitLodAt(d, D));
  });

  it('a camera jittering on a switch distance never flickers; a sweep out and back switches exactly once each way', () => {
    const h = KIT_LOD_HYST;
    let lod = kitLodSelect(29, D);
    let switches = 0;
    for (let i = 0; i < 400; i++) {
      const d = 30 + Math.sin(i * 1.7) * 30 * h * 0.9;                      // within the band around 30 m
      const next = kitLodSelect(d, D, lod);
      if (next !== lod) switches++;
      lod = next;
    }
    expect(switches).toBe(0);
    const path = [...Array.from({ length: 200 }, (_, i) => i), ...Array.from({ length: 200 }, (_, i) => 199 - i)];
    const seen: number[] = [];
    lod = -1;
    for (const d of path) { const next = kitLodSelect(d, D, lod); if (next !== lod) seen.push(next); lod = next; }
    expect(seen).toEqual([0, 1, 2, 1, 0]);
  });

  it('every LOT_KIT piece has real LOD distances (finite, increasing); ?kitlod= pins a LOD, anything else is off', () => {
    for (const { piece } of LOT_KIT) {
      expect(Number.isFinite(piece.lodDist[1]), piece.name).toBe(true);
      expect(piece.lodDist[0], piece.name).toBeGreaterThan(0);
      expect(piece.lodDist[1], piece.name).toBeGreaterThan(piece.lodDist[0] * (1 + KIT_LOD_HYST) / (1 - KIT_LOD_HYST));
    }
    expect(kitForcedLod('')).toBeNull();
    expect(kitForcedLod('?kit=glb')).toBeNull();
    expect(kitForcedLod('?kit=glb&kitlod=0')).toBe(0);
    expect(kitForcedLod('?kitlod=2')).toBe(2);
    expect(kitForcedLod('?kitlod=3')).toBeNull();
    expect(kitForcedLod('?kitlod=x')).toBeNull();
  });
});

type V3 = [number, number, number];
const near = (a: ArrayLike<number>, b: ArrayLike<number>, tol: number) => {
  for (let i = 0; i < a.length; i++) if (!(Math.abs(a[i] - b[i]) <= tol)) return false;
  return a.length === b.length;
};

/** The vertex ids the index draws for placement k (the index is packed in placement order). */
function drawnRuns(g: THREE.BufferGeometry, sel: number[], tris: readonly number[]) {
  const idx = g.index!.array as Uint32Array;
  const runs: number[][] = [];
  let o = 0;
  for (const l of sel) { runs.push(Array.from(idx.subarray(o, o + tris[l] * 3))); o += tris[l] * 3; }
  expect(g.drawRange.start).toBe(0);
  expect(g.drawRange.count).toBe(o);
  return runs;
}

describe('P-GLB4 buildKitBatch: one mesh, every LOD baked, the index picks one LOD per placement', () => {
  // three LODs that differ in size and topology, with uv, normal and tangent (as the kit GLBs)
  // (a sphere: oblique normals, which a non-uniform scale turns differently from the surface)
  const lods = [new THREE.SphereGeometry(1, 10, 8), new THREE.BoxGeometry(2, 1, 3), new THREE.PlaneGeometry(2, 3).rotateX(-Math.PI / 2)];
  for (const g of lods) g.computeTangents();
  // a different node matrix per LOD (as the web variant's dequantization), placements with yaw, pitch and a stretch
  const nodes = [new THREE.Matrix4().makeScale(1.5, 0.4, 0.8), new THREE.Matrix4().compose(new THREE.Vector3(0, 0.5, 0), new THREE.Quaternion(), new THREE.Vector3(0.5, 2, 1)), new THREE.Matrix4().makeTranslation(0, 1, 0)];
  const placements: KitPlacement[] = [
    { id: 'a', x: 10, y: 0, z: -4, yaw: 0, col: 'hull' },
    { id: 'b', x: -30, y: 2, z: 7, yaw: 1.2, col: 'hull', sz: 1.15 },
    { id: 'c', x: 5, y: 22, z: 60, yaw: -2.1, pitch: 0.8, col: 'hull' },
  ];
  const mats = nodes.map((nm) => placements.map((p) => kitPlacementMatrix(p).multiply(nm)));
  const tint = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const b = buildKitBatch(lods, mats, [{ name: 'tint', itemSize: 3, values: tint }]);
  const perV = lods.reduce((s, g) => s + g.getAttribute('position').count, 0);

  it('holds every LOD of every placement once; the triangle counts per LOD are the sources\'', () => {
    expect(b.geometry.getAttribute('position').count).toBe(placements.length * perV);
    expect(b.tris).toEqual(lods.map((g) => g.index!.count / 3));
    for (const a of ['position', 'normal', 'uv', 'tangent', 'tint']) expect(b.geometry.getAttribute(a), a).toBeTruthy();
    expect(b.geometry.index!.array).toBeInstanceOf(Uint32Array);
  });

  it('select() draws exactly the chosen LOD of each placement, baked by placement x node matrix (normals, tangents too)', () => {
    for (const sel of [[0, 0, 0], [2, 1, 0], [1, 2, 2], [2, 2, 2]]) {
      const drawn = b.select(sel);
      expect(drawn).toBe(sel.reduce((s, l) => s + b.tris[l], 0));
      const runs = drawnRuns(b.geometry, sel, b.tris);
      const pos = b.geometry.getAttribute('position'), nor = b.geometry.getAttribute('normal'), tan = b.geometry.getAttribute('tangent');
      const uv = b.geometry.getAttribute('uv'), tn = b.geometry.getAttribute('tint');
      sel.forEach((l, k) => {
        const g = lods[l], M = mats[l][k], N = new THREE.Matrix3().getNormalMatrix(M), R = new THREE.Matrix3().setFromMatrix4(M);
        const srcIdx = Array.from(g.index!.array as ArrayLike<number>);
        const run = runs[k];
        expect(run.length).toBe(srcIdx.length);
        // the run is the source index rebased onto one block of this placement's vertices
        const base = run[0] - srcIdx[0];
        expect(base).toBeGreaterThanOrEqual(k * perV);
        expect(base + g.getAttribute('position').count).toBeLessThanOrEqual((k + 1) * perV);
        run.forEach((v, j) => expect(v - base).toBe(srcIdx[j]));
        for (let j = 0; j < g.getAttribute('position').count; j++) {
          const v = base + j;
          const p = new THREE.Vector3().fromBufferAttribute(g.getAttribute('position'), j).applyMatrix4(M);
          const n = new THREE.Vector3().fromBufferAttribute(g.getAttribute('normal'), j).applyMatrix3(N).normalize();
          const t = new THREE.Vector3().fromBufferAttribute(g.getAttribute('tangent'), j).applyMatrix3(R).normalize();
          expect(near([pos.getX(v), pos.getY(v), pos.getZ(v)], p.toArray(), 1e-4)).toBe(true);
          expect(near([nor.getX(v), nor.getY(v), nor.getZ(v)], n.toArray(), 1e-5)).toBe(true);
          expect(near([tan.getX(v), tan.getY(v), tan.getZ(v), tan.getW(v)], [...t.toArray(), g.getAttribute('tangent').getW(j)], 1e-5)).toBe(true);
          expect(near([uv.getX(v), uv.getY(v)], [g.getAttribute('uv').getX(j), g.getAttribute('uv').getY(j)], 0)).toBe(true);
          expect(near([tn.getX(v), tn.getY(v), tn.getZ(v)], tint.subarray(k * 3, k * 3 + 3), 0)).toBe(true);
        }
      });
    }
  });

  it('the bounds hold every LOD of every placement (culling never depends on the selection)', () => {
    const pos = b.geometry.getAttribute('position');
    const s = b.geometry.boundingSphere!;
    for (let v = 0; v < pos.count; v++) expect(new THREE.Vector3().fromBufferAttribute(pos, v).distanceTo(s.center)).toBeLessThanOrEqual(s.radius + 1e-4);
    b.select([2, 2, 2]);
    expect(b.geometry.boundingSphere).toBe(s);
  });

  it('refuses mismatched inputs (one matrix list per LOD, one matrix per placement)', () => {
    expect(() => buildKitBatch(lods, mats.slice(0, 2))).toThrow();
    expect(() => buildKitBatch(lods, [[], [], []])).toThrow();
  });
});

describe('P-GLB4 createKitShadowCaster: one shadow draw that follows every piece\'s LOD selection', () => {
  const mk = (w: number, n: number) => {
    const lods = [new THREE.BoxGeometry(w, 1, 1, 3, 1, 1), new THREE.BoxGeometry(w, 1, 1), new THREE.PlaneGeometry(w, 1)];
    const mats = lods.map(() => Array.from({ length: n }, (_, k) => new THREE.Matrix4().makeTranslation(k * 10, 0, w)));
    return buildKitBatch(lods, mats);
  };
  const a = mk(2, 3), b = mk(5, 2);
  const double = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const ma = new THREE.Mesh(a.geometry, double), mb = new THREE.Mesh(b.geometry, double);
  let va = 0, vb = 0;
  a.select([0, 1, 2]); b.select([2, 2]);
  const c = createKitShadowCaster([{ mesh: ma, version: () => va }, { mesh: mb, version: () => vb }]);
  const mesh = c.group.children[0] as THREE.Mesh;
  /** The caster's drawn triangles as world-space vertex triples, and the same from the pieces' own indices. */
  const tris = (g: THREE.BufferGeometry) => {
    const pos = g.getAttribute('position'), idx = g.index!.array, out: string[] = [];
    for (let i = 0; i < g.drawRange.count; i++) out.push([pos.getX(idx[i]), pos.getY(idx[i]), pos.getZ(idx[i])].map((x) => x.toFixed(5)).join(','));
    return out;
  };

  it('one caster (same side), on KIT_SHADOW_LAYER only, casting and not receiving; its bounds hold both pieces', () => {
    expect(c.casters).toBe(1);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.layers.mask).toBe(1 << KIT_SHADOW_LAYER);
    expect(new THREE.Layers().test(mesh.layers)).toBe(false);            // a default (layer 0) camera never draws it
    expect((mesh.material as THREE.Material).side).toBe(THREE.DoubleSide);
    const box = mesh.geometry.boundingBox!;
    for (const g of [a.geometry, b.geometry]) expect(box.containsBox(g.boundingBox!)).toBe(true);
  });

  it('draws exactly the triangles the pieces draw, and follows a selection change once its version moves', () => {
    expect(tris(mesh.geometry)).toEqual([...tris(a.geometry), ...tris(b.geometry)]);
    expect(c.refresh()).toBe(false);                                     // nothing moved
    a.select([2, 2, 0]);
    expect(c.refresh()).toBe(false);                                     // the version did not move: not seen yet
    va++;
    expect(c.refresh()).toBe(true);
    expect(tris(mesh.geometry)).toEqual([...tris(a.geometry), ...tris(b.geometry)]);
    b.select([0, 1]); vb++;
    expect(c.refresh()).toBe(true);
    expect(mesh.geometry.drawRange.count).toBe(a.geometry.drawRange.count + b.geometry.drawRange.count);
    expect(tris(mesh.geometry)).toEqual([...tris(a.geometry), ...tris(b.geometry)]);
  });

  it('a piece with another side (the toon side is front-sided) gets its own caster; dispose empties the group', () => {
    const front = new THREE.Mesh(b.geometry, new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide }));
    const c2 = createKitShadowCaster([{ mesh: ma, version: () => va }, { mesh: front, version: () => vb }]);
    expect(c2.casters).toBe(2);
    expect((c2.group.children as THREE.Mesh[]).map((m) => (m.material as THREE.Material).side).sort()).toEqual([THREE.FrontSide, THREE.DoubleSide].sort());
    c2.dispose();
    expect(c2.group.children.length).toBe(0);
  });
});

/** A web GLB's LOD meshes as GLTFLoader hands them over: raw (quantized, normalized) arrays and the node's world matrix. */
async function webLods(name: string) {
  const io = await createIO();
  const doc = await io.read(`public/assets/kits/${name}.glb`);
  const out: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; decoded: V3[] }[] = [];
  for (let i = 0; i < 3; i++) {
    const node = doc.getRoot().listNodes().find((n) => n.getName() === `${name}_LOD${i}`)!;
    const prim = node.getMesh()!.listPrimitives()[0];
    const g = new THREE.BufferGeometry();
    for (const [sem, attr] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv'], ['TANGENT', 'tangent']] as const) {
      const a = prim.getAttribute(sem)!;
      g.setAttribute(attr, new THREE.BufferAttribute(a.getArray()!, a.getElementSize(), a.getNormalized()));
    }
    g.setIndex(new THREE.BufferAttribute(prim.getIndices()!.getArray()!, 1));
    const pos = prim.getAttribute('POSITION')!;
    const decoded: V3[] = Array.from({ length: pos.getCount() }, (_, j) => pos.getElement(j, [0, 0, 0]) as V3);
    out.push({ geometry: g, matrix: new THREE.Matrix4().fromArray(node.getWorldMatrix() as number[]), decoded });
  }
  return out;
}

describe('P-GLB4 the six web GLBs batched at their Lot placements = what the per-LOD InstancedMeshes drew', () => {
  const split = splitLotKitPrims(createWorldData(1, 'the_lot'));
  for (const { piece, placements } of split.pieces) {
    it(`${piece.name}: ${placements.length} placements, every LOD within 1 mm of placement x node x decoded position`, async () => {
      expect(placements.length).toBeGreaterThan(0);
      const src = await webLods(piece.name);
      const mats = src.map((s) => placements.map((p) => kitPlacementMatrix(p).multiply(s.matrix)));
      const values = new Float32Array(placements.length * 3);
      placements.forEach((p, k) => { const c = kitTint(p.col); values.set([c.r, c.g, c.b], k * 3); });
      const b = buildKitBatch(src.map((s) => s.geometry), mats, piece.paintTint ? [{ name: PBR_PAINT_TINT, itemSize: 3, values }] : []);
      expect(b.tris).toEqual(src.map((s) => s.geometry.index!.count / 3));
      expect(b.tris[0]).toBeGreaterThan(b.tris[1]);
      expect(b.tris[1]).toBeGreaterThan(b.tris[2]);
      const pos = b.geometry.getAttribute('position');
      for (const l of [0, 1, 2]) {
        const sel = placements.map(() => l);
        expect(b.select(sel)).toBe(placements.length * b.tris[l]);
        const runs = drawnRuns(b.geometry, sel, b.tris);
        let worst = 0;
        runs.forEach((run, k) => {
          const srcIdx = src[l].geometry.index!.array as ArrayLike<number>;
          const base = run[0] - srcIdx[0];
          for (let j = 0; j < src[l].decoded.length; j++) {
            const want = new THREE.Vector3(...src[l].decoded[j]).applyMatrix4(mats[l][k]);
            worst = Math.max(worst, want.distanceTo(new THREE.Vector3().fromBufferAttribute(pos, base + j)));
          }
        });
        expect(worst, `LOD${l}`).toBeLessThanOrEqual(1e-3);
      }
      if (piece.paintTint) {
        const t = b.geometry.getAttribute(PBR_PAINT_TINT);
        const perV = src.reduce((s, x) => s + x.geometry.getAttribute('position').count, 0);
        placements.forEach((_, k) => expect(near([t.getX(k * perV), t.getY(k * perV), t.getZ(k * perV)], values.subarray(k * 3, k * 3 + 3), 0)).toBe(true));
      }
    });
  }
});

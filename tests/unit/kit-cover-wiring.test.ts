// W17 item 11b (TW-LOOK; PARITY P2a, P2c): the cover read's per-world data reaches the kit materials.
// kit-cover.test.ts builds each material from kitPbrOpts() by hand, so it cannot see the wiring. Here the Lot's kit
// view itself is built (createLotKitView, as world-view does, with a stand-in GLB per piece), and the materials and
// batches it makes are checked:
// - the floods: every cover material carries one cone per flood at a tier whose floods have real lights (high, med),
//   and none at low (no flood light: STYLE.floodlight.budget low 0), so the fill never fades where nothing lights it;
// - the per-piece fill scale: each material's scale uniform is its tier's row (kitCoverScale: KIT_COVER_SCALE, with
//   KIT_COVER_SCALE_LOW over it at low);
// - the cover base: the FloodMast batch carries each placement's foot height per vertex, and its material reads it;
// - world-view passes its tier to createLotKitView (the same `q` the lamps' flood budget takes): the world view is built
//   at each tier and its kit's materials checked (a behaviour check: a world-view that hands the kit another tier fails
//   it), plus a source pin, so a silent default cannot stand in for the explicit pass.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { createWorldData } from '../../src/shared/world/world-data';
import {
  KIT_COVER_SCALE, KIT_COVER_SCALE_LOW, KIT_FLOODMAST, createLotKitView, kitCoverFloods, kitLitFloods, splitLotKitPrims,
  type KitLoad, type KitQuality,
} from '../../src/client/assets/kit-glb';
import { PBR_COVER_BASE } from '../../src/client/style/style-webgpu.js';
import { STYLE } from '../../src/client/style/style-tokens.js';
import { createWorldView } from '../../src/client/world/world-view';

/** What world-view hands createLotKitView, and the views it gets back (the module is wrapped below). */
const seen = vi.hoisted(() => ({ calls: [] as Array<{ quality?: string }>, views: [] as Array<{ ready: Promise<void> }> }));
/** A stand-in GLB per piece: three LOD meshes (unit boxes) sharing one material, named as the masters' are. */
const fakeLoad = vi.hoisted(() => async (url: string) => {
  const T = await import('three/webgpu');
  const name = /(Kit_Lot_\w+?)\.glb/.exec(url)![1];
  const scene = new T.Group();
  const mat = new T.MeshStandardMaterial({ color: 0x808080 });
  for (let i = 0; i < 3; i++) {
    const mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1), mat);
    mesh.name = `${name}_LOD${i}`;
    scene.add(mesh);
  }
  return { scene };
});
// world-view draws the kit as ?kit=glb does (kitFlag 'pbr'), from the stand-in GLBs; every createLotKitView call is
// recorded and otherwise runs as built
vi.mock('../../src/client/assets/kit-glb', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/client/assets/kit-glb')>();
  return {
    ...real,
    kitFlag: () => 'pbr' as const,
    createLotKitView: (...[split, look, opts = {}]: Parameters<typeof real.createLotKitView>) => {
      seen.calls.push({ ...opts });
      const v = real.createLotKitView(split, look, { load: fakeLoad, ...opts });
      seen.views.push(v);
      return v;
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL nodes are untyped here
type N = any;
const kind = (n: N): string => n?.constructor?.type ?? '';
function all(root: N): N[] {
  const seen = new Set<N>(), out: N[] = [];
  const walk = (n: N) => { if (!n || seen.has(n)) return; seen.add(n); out.push(n); for (const c of n.getChildren()) walk(c); };
  walk(root);
  return out;
}
const constOf = (n: N): unknown => {
  while (n && (kind(n) === 'VarNode' || kind(n) === 'ConvertNode')) n = n.node;
  return kind(n) === 'ConstNode' ? n.value : undefined;
};
/** The flood cones in a material's emission: smoothstep(cone, ...) nodes [kit-cover.test.ts checks their form]. */
const cones = (m: THREE.Material) => all((m as THREE.MeshStandardNodeMaterial).emissiveNode)
  .filter((n) => kind(n) === 'MathNode' && n.method === 'smoothstep' && constOf(n.aNode) === STYLE.cover.cone[0] && constOf(n.bNode) === STYLE.cover.cone[1]);

/** The Lot's kit view at a tier, loaded: piece name -> its batched mesh. */
async function lotKit(quality: KitQuality) {
  const data = createWorldData(1, 'the_lot');
  const split = splitLotKitPrims(data);
  const view = createLotKitView(split, 'pbr', { quality, load: fakeLoad as KitLoad, forceLod: 0 });
  await view.ready;
  const meshes = new Map<string, THREE.Mesh>();
  view.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name.endsWith('_batch')) meshes.set(o.name.replace(/_batch$/, ''), o as THREE.Mesh); });
  return { data, split, view, meshes };
}

describe('the cover read reaches the kit materials (W17 item 11b)', () => {
  it('the floods follow the tier: all of them where the floods have real lights, none at low', () => {
    const floods = kitCoverFloods(createWorldData(1, 'the_lot'));
    expect(floods.length).toBe(4);
    expect(STYLE.floodlight.budget).toEqual({ high: 4, medium: 2, low: 0 });
    expect(kitLitFloods(floods, 'high')).toEqual(floods);
    expect(kitLitFloods(floods, 'med')).toEqual(floods);
    expect(kitLitFloods(floods, 'medium')).toEqual(floods);
    expect(kitLitFloods(floods, 'low')).toEqual([]);
  });

  it.each([['high', 4], ['med', 4], ['low', 0]] as const)('createLotKitView at %s: every cover material has %i flood cones', async (q, n) => {
    const { split, meshes, view } = await lotKit(q);
    expect(split.floods.length).toBe(4);
    const cover = split.pieces.filter((p) => p.placements.length && p.piece.cover > 0);
    expect(cover.length).toBe(5);
    for (const p of cover) {
      const m = meshes.get(p.piece.name);
      expect(m, `${p.piece.name}: drawn`).toBeTruthy();
      expect(cones(m!.material as THREE.Material).length, `${p.piece.name} at ${q}: flood cones in its material`).toBe(n);
      // its fill scale: the tier's row
      const row = q === 'low' ? { ...KIT_COVER_SCALE, ...KIT_COVER_SCALE_LOW } : KIT_COVER_SCALE;
      const k = ((m!.material as THREE.Material).userData as { coverScale?: { fill: { value: number } } }).coverScale;
      expect(k?.fill.value, `${p.piece.name} at ${q}: its fill scale`).toBe(row[p.piece.name]?.fill);
    }
    view.dispose();
  });

  it('the FloodMast batch carries each placement\'s foot height, and its material reads it', async () => {
    const { split, meshes, view } = await lotKit('high');
    const mast = split.pieces.find((p) => p.piece.name === KIT_FLOODMAST)!;
    const mesh = meshes.get(KIT_FLOODMAST)!;
    const base = mesh.geometry.getAttribute(PBR_COVER_BASE) as THREE.BufferAttribute;
    expect(base, 'the coverBase attribute').toBeTruthy();
    // the batch holds every LOD of every placement in order: 3 stand-in boxes (24 vertices each) per placement
    const perPlacement = base.count / mast.placements.length;
    expect(perPlacement).toBe(72);
    mast.placements.forEach((pl, k) => {
      for (const j of [0, perPlacement - 1]) expect(base.getX(k * perPlacement + j), `placement ${k}: its foot`).toBeCloseTo(pl.y, 5);
    });
    expect(new Set(mast.placements.map((p) => p.y)).has(0), 'the Lot\'s mast feet are not at 0 (so a zeroed base shows)').toBe(false);
    const attrs = all((mesh.material as THREE.MeshStandardNodeMaterial).emissiveNode).filter((n) => kind(n) === 'AttributeNode').map((n) => n._attributeName);
    expect(attrs, 'the material reads coverBase').toContain(PBR_COVER_BASE);
    // and no other piece carries one
    for (const [name, m] of meshes) if (name !== KIT_FLOODMAST) expect(m.geometry.getAttribute(PBR_COVER_BASE), name).toBeUndefined();
    view.dispose();
  });

  it.each([['high', 4], ['med', 4], ['low', 0]] as const)('createWorldView at %s builds its kit at that tier: %i flood cones, the tier\'s scale row', async (q, n) => {
    const data = createWorldData(1, 'the_lot');
    const cover = splitLotKitPrims(data).pieces.filter((p) => p.placements.length && p.piece.cover > 0).map((p) => p.piece.name);
    expect(cover.length).toBe(5);
    const scene = new THREE.Scene();
    const before = seen.calls.length;
    const world = createWorldView(scene, data, { quality: q });
    expect(seen.calls.length, 'one kit view').toBe(before + 1);
    expect(seen.calls.at(-1)!.quality, 'the tier world-view hands the kit').toBe(q);
    await seen.views.at(-1)!.ready;
    const row = q === 'low' ? { ...KIT_COVER_SCALE, ...KIT_COVER_SCALE_LOW } : KIT_COVER_SCALE;
    for (const name of cover) {
      const mesh = scene.getObjectByName(`${name}_batch`) as THREE.Mesh | undefined;
      expect(mesh, `${name}: drawn in the world`).toBeTruthy();
      const m = mesh!.material as THREE.Material;
      expect(cones(m).length, `${name} at ${q}: flood cones`).toBe(n);
      const k = (m.userData as { coverScale?: { fill: { value: number } } }).coverScale;
      expect(k?.fill.value, `${name} at ${q}: its fill scale`).toBe(row[name]?.fill);
    }
    world.dispose();
  });

  it('world-view passes its tier to the kit view: the same q the lamps\' flood budget takes', () => {
    const src = readFileSync('src/client/world/world-view.ts', 'utf8');
    expect(src, 'createLotKitView(..., { ..., quality: q })').toMatch(/createLotKitView\(kitSplit, kitLook, \{[^}]*\bquality: q\b[^}]*\}\)/);
    expect(src, 'createLampsView(data, { quality: q, ... })').toMatch(/createLampsView\(data, \{[^}]*\bquality: q\b/);
  });
});

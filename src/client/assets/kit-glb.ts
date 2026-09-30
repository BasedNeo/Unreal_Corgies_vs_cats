// OWNER: P-GLB1 (W11). Shared-GLB kit pieces in the browser client (docs/design/ASSET_PIPELINE.md, stage 5): the web
// variant of a master GLB is loaded with GLTFLoader (+ the meshopt decoder), its <name>_LOD0|1|2 meshes become one
// batched mesh (P-GLB4; P-GLB1: one InstancedMesh each), and its materials go through the style factory: pbr()
// (default) or stylize() (?kitlook=stylize, the toon side of the A/B). The COL_ boxes are never rendered; gameplay
// collision stays in the world data (the authority never reads a GLB; tests/unit/glb-container-colliders.test.ts
// proves the two agree).
//
// The flag: ?kit=glb draws The Lot's site-office containers from Kit_Lot_Container20_01 where the procedural ones
// stand (default off: without it nothing here runs). Until the GLB is ready (or if it fails to load) the procedural
// container prims are drawn instead, so there is never a hole in the world.
//
// LOD per instance (W11 P-GLB4): a piece is ONE mesh (buildKitBatch) that holds every LOD of every placement baked in
// world space; its index is rewritten, when an instance crosses a switch distance (kitLodSelect, with hysteresis), to
// hold each instance's chosen LOD, so a piece costs one draw per pass whatever LODs are in use (P-GLB1's one
// InstancedMesh per LOD cost a draw, plus a shadow draw, per LOD in use). Tint per instance: the kit is painted a
// neutral light grey (KIT_PAINT_SRGB, the bake's PAINT) and each container takes its world palette colour
// (CONTAINERS[].col) as a linear-space ratio. W11 P-GLB1b: under pbr() the tint is a `paintTint` attribute that
// pbr({ paintTint: true }) applies only through the paint mask (the baseColor alpha), so rust, grime and the frame keep
// their colour; the toon side tints the whole albedo (P-GLB4: both are per-vertex attributes, constant over each
// instance, since the batch has no instances). P-GLB4 shadows: after world-view's shadowFrom(sun), the loaded pieces
// stop casting one by one and cast through one shared mesh on KIT_SHADOW_LAYER (createKitShadowCaster).
//
// W11 P-GLB1b: a second piece, Kit_Lot_BagWall_01 (one 4.8 m module of props.ts bagWall()), goes through the same
// view: KitPiece describes a piece (url, LOD distances, look options), createKitView draws any piece at its placements,
// and createLotKitView bundles The Lot's two (containers + bag walls) for world-view's ?kit=glb branch. A bag wall of
// length len is m = round(len / 4.8) modules, each stretched along its z by len / (m x 4.8).
//
// W11 P-GLB3: batch 1 of the Lot kit. LOT_KIT is the table of pieces world-view draws (containers, bag walls, the
// Pipeworks pipe, the footing block, the floodlight mast and its lamp housings); each entry has a split that finds its
// procedural prims (rebuilt with the same props.ts / pipes.ts builder and matched one for one) and its placements, from
// what the entries before it left. KitPlacement gains `pitch` (Euler YXZ after yaw, as the prims and colliders turn),
// for the lamp housings that the world data aims down at each tower's target. Every piece keeps its procedural stand-in
// until its GLB is drawn, and for good if the load fails.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { PBR_PAINT_TINT, pbr, stylize, toon } from '../style/style-webgpu.js';
import { smoothNormalsByPosition } from '../style/style-utils.js';
import { worldColor } from '../world/world-palette';
import { buildPrimMeshes, disposePrimMeshes } from '../world/prim-mesh';
import type { VisualPrim, WorldData } from '../../shared/world/world-types';
import { Kit } from '../../shared/world/kit';
import { bagWall, container, floodTower, footing } from '../../shared/world/lot/props';
import { addPipe } from '../../shared/world/lot/pipes';
import { CONTAINER, CONTAINERS, FLOOD, FLOOD_TOWERS, PIPE } from '../../shared/world/lot/layout';

export type KitLook = 'pbr' | 'stylize';

export const KIT_CONTAINER = 'Kit_Lot_Container20_01';
/** The web variant (public/assets/kits/, made by tools/assets/make-web-variant.mjs). */
export const KIT_CONTAINER_URL = `${import.meta.env?.BASE_URL ?? '/'}assets/kits/${KIT_CONTAINER}.glb`;
/** The kit's neutral paint (sRGB), = PAINT in tools/assets/build-container.py. */
export const KIT_PAINT_SRGB = [0.74, 0.72, 0.69] as const;
/** LOD switch distances (m, camera to the container's centre): LOD0 below the first, LOD1 below the second, else LOD2. */
export const KIT_LOD_DIST = [70, 160] as const;

/** ?kit=glb -> the look ('pbr' unless ?kitlook=stylize); null when the flag is off (the default). */
export function kitFlag(search: string = typeof location !== 'undefined' ? location.search : ''): KitLook | null {
  const q = new URLSearchParams(search);
  if (q.get('kit') !== 'glb') return null;
  return q.get('kitlook') === 'stylize' ? 'stylize' : 'pbr';
}

/**
 * Where one instance of a kit piece stands: base centre (x, y, z), turn about +Y, palette colour, stretch along z, and
 * (P-GLB3) a pitch about the turned x axis (Euler 'YXZ': R = Ry(yaw) Rx(pitch), about the base centre).
 */
export interface KitPlacement { id: string; x: number; y: number; z: number; yaw: number; col: string; sz?: number; pitch?: number }

/** One shared-GLB kit piece as the client draws it. */
export interface KitPiece {
  /** The GLB's root name (Kit_<Set>_<Thing>_<NN>); its LOD nodes are <name>_LOD0|1|2. */
  name: string;
  url: string;
  /** LOD switch distances (m, camera to the instance's centre). */
  lodDist: readonly [number, number];
  /** Height (m) of the point the LOD distance is measured to, above the base. */
  centreY: number;
  /** pbr() tints the paint mask per instance (the placement's `col`); false = the GLB's own colours. */
  paintTint: boolean;
  /** pbr() overrides (STYLE.pbr keys) for this piece's material. */
  pbrOpts?: Record<string, unknown>;
  /** The toon side's SURFACES preset (stylize remap). */
  toonSurface: string;
}

/**
 * The Lot's containers as kit placements, from the world data's own colliders: the floor slab gives the base centre
 * (x, its bottom, z); the door leaf's side gives the turn (the kit's door is on +x: c_west yaw 0, c_east yaw pi).
 */
export function lotContainerPlacements(data: WorldData): KitPlacement[] {
  const out: KitPlacement[] = [];
  for (const f of data.props.filter((p) => p.type === 'container_floor')) {
    const door = data.props.find((p) => p.type === 'container_door' && Math.abs(p.z - f.z) < CONTAINER.L / 2 && Math.abs(p.x - f.x) < CONTAINER.W);
    const src = CONTAINERS.find((c) => Math.abs(c.x - f.x) < 0.01 && Math.abs(c.z - f.z) < 0.01);
    out.push({ id: src?.id ?? `container_${out.length}`, x: f.x, y: f.y - f.hy, z: f.z, yaw: door && door.x < f.x ? Math.PI : 0, col: src?.col ?? 'hull' });
  }
  return out;
}

const primKey = (q: VisualPrim) => `${q.s}|` + [q.x, q.y, q.z, q.a, q.b, q.c, q.yaw ?? 0, q.pitch ?? 0, q.roll ?? 0].map((v) => v.toFixed(4)).join('|') + `|${q.col}|${q.g ?? ''}`;

/**
 * Splits data.prims into the procedural containers' prims (props.ts container(), rebuilt at the same placements and
 * matched exactly) and the rest. `missing` counts rebuilt prims that were not found (0 when the data is consistent).
 */
export function splitContainerPrims(data: WorldData, prims: readonly VisualPrim[] = data.prims ?? []): { rest: VisualPrim[]; containers: VisualPrim[]; placements: KitPlacement[]; missing: number } {
  const placements = lotContainerPlacements(data);
  const kit = new Kit();
  for (const p of placements) {
    const c = CONTAINERS.find((k) => k.id === p.id);
    if (c) container(kit, c.x, p.y, c.z, c.col, c.stripe, c.door, []);
  }
  const r = matchPrims(prims, kit.prims);
  return { rest: r.rest, containers: r.matched, placements, missing: r.missing };
}

/** Linear-space instance tint that turns the kit's neutral paint into the palette colour `col`. */
export function kitTint(col: string, out = new THREE.Color()): THREE.Color {
  const paint = new THREE.Color().setRGB(KIT_PAINT_SRGB[0], KIT_PAINT_SRGB[1], KIT_PAINT_SRGB[2], THREE.SRGBColorSpace);
  const c = worldColor(col);
  return out.setRGB(c.r / paint.r, c.g / paint.g, c.b / paint.b);
}

/** LOD index for a camera distance (m) with switch distances `dist`. */
export const kitLodAt = (d: number, dist: readonly [number, number]): number => (d < dist[0] ? 0 : d < dist[1] ? 1 : 2);
/** LOD index for a camera distance (m) to a container. */
export const kitLodFor = (d: number): number => kitLodAt(d, KIT_LOD_DIST);

export const KIT_CONTAINER_PIECE: KitPiece = {
  name: KIT_CONTAINER, url: KIT_CONTAINER_URL, lodDist: KIT_LOD_DIST, centreY: CONTAINER.H / 2, paintTint: true,
  pbrOpts: { paintTint: true }, toonSurface: 'metal',
};

// ------------------------------------------------------------------------------------------------ bag walls (P-GLB1b)
export const KIT_BAGWALL = 'Kit_Lot_BagWall_01';
export const KIT_BAGWALL_URL = `${import.meta.env?.BASE_URL ?? '/'}assets/kits/${KIT_BAGWALL}.glb`;
/** The module's length (m): two nominal 2.4 m sacks (props.ts bagWall(): n = round(len / 2.4)). */
export const KIT_BAGWALL_LEN = 4.8;
/** Bag walls are small: LOD0 within 30 m, LOD1 within 80 m. */
export const KIT_BAGWALL_LOD_DIST = [30, 80] as const;
export const KIT_BAGWALL_PIECE: KitPiece = {
  name: KIT_BAGWALL, url: KIT_BAGWALL_URL, lodDist: KIT_BAGWALL_LOD_DIST, centreY: 0.55, paintTint: false,
  // cloth: no metal scratches, no rivulets, no puddles; a deeper weave bump
  pbrOpts: { scratch: 0, rivulets: 0, puddle: 0, detailBump: [0.006, 0.001], detailRough: 0.05 }, toonSurface: 'cloth',
};

/** A bag wall from its world-data collider ('bags'): base centre, turn, length. */
export interface BagWall { x: number; y: number; z: number; yaw: number; len: number }

export function lotBagWalls(data: WorldData): BagWall[] {
  return data.props.filter((p) => p.type === 'bags').map((b) => ({ x: b.x, y: b.y - b.hy, z: b.z, yaw: b.rotY ?? 0, len: 2 * b.hz }));
}

/** Module placements of one wall: m = max(1, round(len / 4.8)) modules along its local z, each stretched by len / (m x 4.8). */
export function bagWallModules(w: BagWall, id = 'bags'): KitPlacement[] {
  const m = Math.max(1, Math.round(w.len / KIT_BAGWALL_LEN));
  const step = w.len / m, s = Math.sin(w.yaw), c = Math.cos(w.yaw);
  return Array.from({ length: m }, (_, k) => {
    const lz = -w.len / 2 + (k + 0.5) * step;
    return { id: `${id}_${k}`, x: w.x + lz * s, y: w.y, z: w.z + lz * c, yaw: w.yaw, col: 'canvas', sz: step / KIT_BAGWALL_LEN };
  });
}

const primKeyCount = (prims: readonly VisualPrim[]) => {
  const want = new Map<string, number>();
  for (const q of prims) want.set(primKey(q), (want.get(primKey(q)) ?? 0) + 1);
  return want;
};

/** Splits `prims` into those equal to `rebuilt` (one for one) and the rest; `missing` = rebuilt prims not found. */
export function matchPrims(prims: readonly VisualPrim[], rebuilt: readonly VisualPrim[]): { rest: VisualPrim[]; matched: VisualPrim[]; missing: number } {
  const want = primKeyCount(rebuilt);
  const rest: VisualPrim[] = [], matched: VisualPrim[] = [];
  for (const q of prims) {
    const k = primKey(q), n = want.get(k) ?? 0;
    if (n > 0) { want.set(k, n - 1); matched.push(q); } else rest.push(q);
  }
  let missing = 0;
  for (const n of want.values()) missing += n;
  return { rest, matched, missing };
}

/**
 * Splits `prims` (default data.prims) into the procedural bag walls' prims (props.ts bagWall() rebuilt from each 'bags'
 * collider: its ends from the centre, length and turn, the ground from its base) and the rest, plus the module placements.
 */
export function splitBagWallPrims(data: WorldData, prims: readonly VisualPrim[] = data.prims ?? []): { rest: VisualPrim[]; walls: VisualPrim[]; placements: KitPlacement[]; missing: number } {
  const kit = new Kit();
  const placements: KitPlacement[] = [];
  lotBagWalls(data).forEach((w, i) => {
    const hx = (w.len / 2) * Math.sin(w.yaw), hz = (w.len / 2) * Math.cos(w.yaw);
    bagWall(kit, () => w.y + 0.04, w.x - hx, w.z - hz, w.x + hx, w.z + hz);
    placements.push(...bagWallModules(w, `bags${i}`));
  });
  const r = matchPrims(prims, kit.prims);
  return { rest: r.rest, walls: r.matched, placements, missing: r.missing };
}

let loader: GLTFLoader | null = null;
function gltfLoader(): GLTFLoader {
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  return loader;
}

export interface KitView {
  group: THREE.Group;
  /** Resolves when the GLB is drawn (rejects if it failed; the procedural fallback then stays). */
  ready: Promise<void>;
  update(camera: THREE.Camera): void;
  stats(): Record<string, number>;
  dispose(): void;
}

// ------------------------------------------------------------------------------------------------ LOD batches (P-GLB4)
/**
 * Distance-LOD hysteresis, as a fraction of each switch distance: an instance goes coarser only beyond dist x (1 + h)
 * and finer only inside dist x (1 - h), so a camera that hovers on a switch distance does not make a piece pop back and
 * forth (a switch also rewrites the piece's index, kitLodSelect / KitBatch.select).
 */
export const KIT_LOD_HYST = 0.05;

/**
 * The LOD an instance draws at camera distance `d` (m), with switch distances `dist`, given the LOD it drew last
 * (`prev`, -1 = none yet: then plain kitLodAt). See KIT_LOD_HYST.
 */
export function kitLodSelect(d: number, dist: readonly [number, number], prev = -1, h = KIT_LOD_HYST): number {
  if (!(prev >= 0 && prev <= 2)) return kitLodAt(d, dist);
  const coarsest = d < dist[0] * (1 + h) ? 0 : d < dist[1] * (1 + h) ? 1 : 2;   // beyond the outer edge: must go coarser
  const finest = d < dist[0] * (1 - h) ? 0 : d < dist[1] * (1 - h) ? 1 : 2;     // inside the inner edge: must go finer
  return Math.min(Math.max(prev, coarsest), finest);
}

/** ?kitlod=0|1|2 pins every kit instance to one LOD (a debug view for A/B shots); null = by distance (the default). */
export function kitForcedLod(search: string = typeof location !== 'undefined' ? location.search : ''): number | null {
  const v = new URLSearchParams(search).get('kitlod');
  return v === '0' || v === '1' || v === '2' ? Number(v) : null;
}

/** A per-vertex attribute that is constant over each placement (a tint): values[k x itemSize + c] for placement k. */
export interface KitBatchExtra { name: string; itemSize: number; values: Float32Array }

export interface KitBatch {
  /** Every LOD of every placement, baked in world space; the index holds the selected LOD of each placement. */
  geometry: THREE.BufferGeometry;
  /** Triangles of one instance at LOD 0, 1, 2. */
  tris: readonly number[];
  /** Points the index at LOD lods[k] (0-2) of every placement k, in placement order; returns the triangles drawn. */
  select(lods: ArrayLike<number>): number;
}

/**
 * One kit piece at all its placements as ONE indexed mesh: one draw per pass (colour, shadow, ink hull) whatever mix of
 * LODs is in use. The vertices of LOD i at placement k are that LOD's source geometry baked by mats[i][k] (the placement
 * x the LOD node's own matrix, which carries the web variant's dequantization): positions by the matrix, normals by its
 * normal matrix, tangents by its linear part (w kept), and every other attribute (the uv) copied as floats. `extras` add
 * per-placement constants. Kit pieces never move, so nothing is left for a per-instance transform. select() rewrites the
 * index (Uint32: 4-byte aligned partial uploads on WebGPU) with each placement's chosen LOD, packed from the start, and
 * the draw range covers exactly those, so an unused LOD costs no triangles and no draw. The bounds cover every LOD.
 */
export function buildKitBatch(lods: readonly THREE.BufferGeometry[], mats: readonly (readonly THREE.Matrix4[])[], extras: readonly KitBatchExtra[] = []): KitBatch {
  const L = lods.length, n = mats[0]?.length ?? 0;
  if (!L || !n || mats.length !== L) throw new Error('buildKitBatch: one matrix list per LOD, one matrix per placement');
  const names = Object.keys(lods[0].attributes).filter((a) => lods.every((g) => g.getAttribute(a)));
  const vcount = lods.map((g) => g.getAttribute('position').count);
  const icount = lods.map((g) => (g.index ? g.index.count : g.getAttribute('position').count));
  const perV = vcount.reduce((s, c) => s + c, 0), perI = icount.reduce((s, c) => s + c, 0);
  const V = n * perV;
  const src = new Uint32Array(n * perI);                 // every LOD of every placement, rebased to the merged vertices
  const live = new Uint32Array(n * Math.max(...icount)); // the selection
  const ranges = new Uint32Array(n * L * 2);             // (start, count) in src of LOD i at placement k
  const out = new Map(names.map((a) => [a, new Float32Array(V * lods[0].getAttribute(a).itemSize)]));
  const v = new THREE.Vector3(), nm = new THREE.Matrix3(), lm = new THREE.Matrix3();
  let vo = 0, io = 0;
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < L; i++) {
      const g = lods[i], M = mats[i][k];
      nm.getNormalMatrix(M);
      lm.setFromMatrix4(M);
      const flip = lm.determinant() < 0 ? -1 : 1;
      for (const a of names) {
        const s = g.getAttribute(a) as THREE.BufferAttribute, sz = s.itemSize, o = out.get(a)!;
        for (let j = 0; j < s.count; j++) {
          const w = (vo + j) * sz;
          if (a === 'position') v.fromBufferAttribute(s, j).applyMatrix4(M);
          else if (a === 'normal') v.fromBufferAttribute(s, j).applyMatrix3(nm).normalize();
          else if (a === 'tangent') { v.set(s.getX(j), s.getY(j), s.getZ(j)).applyMatrix3(lm).normalize(); o[w + 3] = s.getW(j) * flip; }
          else { for (let c = 0; c < sz; c++) o[w + c] = s.getComponent(j, c); continue; }
          o[w] = v.x; o[w + 1] = v.y; o[w + 2] = v.z;
        }
      }
      const idx = g.index;
      ranges[(k * L + i) * 2] = io;
      ranges[(k * L + i) * 2 + 1] = icount[i];
      for (let j = 0; j < icount[i]; j++) src[io + j] = vo + (idx ? idx.getX(j) : j);
      io += icount[i];
      vo += vcount[i];
    }
  }
  const geometry = new THREE.BufferGeometry();
  for (const a of names) geometry.setAttribute(a, new THREE.BufferAttribute(out.get(a)!, lods[0].getAttribute(a).itemSize));
  for (const e of extras) {
    const o = new Float32Array(V * e.itemSize);
    for (let k = 0; k < n; k++) {
      const val = e.values.subarray(k * e.itemSize, (k + 1) * e.itemSize);
      for (let j = k * perV; j < (k + 1) * perV; j++) o.set(val, j * e.itemSize);
    }
    geometry.setAttribute(e.name, new THREE.BufferAttribute(o, e.itemSize));
  }
  const index = new THREE.BufferAttribute(live, 1);
  index.setUsage(THREE.DynamicDrawUsage);
  geometry.setIndex(index);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return {
    geometry,
    tris: icount.map((c) => c / 3),
    select(sel) {
      let o = 0;
      for (let k = 0; k < n; k++) {
        const r = (k * L + Math.max(0, Math.min(L - 1, sel[k] | 0))) * 2;
        live.set(src.subarray(ranges[r], ranges[r] + ranges[r + 1]), o);
        o += ranges[r + 1];
      }
      geometry.setDrawRange(0, o);
      index.clearUpdateRanges();
      index.addUpdateRange(0, o);
      index.needsUpdate = true;
      return o / 3;
    },
  };
}

/**
 * A piece view plus what the Lot view's shared shadow caster reads: the batched mesh (null while the stand-in shows)
 * and a version that bumps whenever its index changes.
 */
export interface KitPieceView extends KitView { mesh(): THREE.Mesh | null; version(): number }

/**
 * The layer of the kit's shared shadow caster (P-GLB4): no camera draws it but the sun's shadow camera, which
 * createLotKitView's shadowFrom() gives this layer (three's shadow pass then uses that camera's own mask, layers 0 + 30,
 * instead of the view camera's: the same set for every other object; layer 31 is destruct-view's hidden proxies).
 */
export const KIT_SHADOW_LAYER = 30;

/** One piece's part in the shared shadow caster: its batched mesh and its index version. */
export interface KitShadowPart { mesh: THREE.Mesh; version(): number }

/**
 * P-GLB4: ONE shadow draw for every loaded kit piece. The pieces' own meshes stop casting (castShadow = false: one
 * draw per piece in the colour pass only), and this mesh, on KIT_SHADOW_LAYER, holds their baked positions end to end
 * with an index that repeats each piece's current selection (rebased), so the sun's shadow map sees exactly the
 * triangles the view draws, LOD for LOD. The shadow pass renders every caster with its own depth material and only takes
 * the side (shadowSide, else the flipped side) from the object's material, so one caster serves every piece whose
 * material has the same side and shadowSide (all six under pbr(): the GLBs are double-sided; all six under toon():
 * front). Pieces with another side get their own caster. refresh() re-copies the indices when a piece's version moves.
 */
export function createKitShadowCaster(parts: readonly KitShadowPart[]): { group: THREE.Group; refresh(): boolean; casters: number; dispose(): void } {
  const group = new THREE.Group();
  group.name = 'kit_glb_shadow';
  const bySide = new Map<string, KitShadowPart[]>();
  for (const p of parts) {
    const m = p.mesh.material as THREE.Material, key = `${m.side}|${m.shadowSide}`;
    bySide.set(key, [...(bySide.get(key) ?? []), p]);
  }
  const casters = [...bySide.values()].map((list) => {
    const geos = list.map((p) => p.mesh.geometry);
    const bases: number[] = [];
    let V = 0, I = 0;
    for (const g of geos) { bases.push(V); V += g.getAttribute('position').count; I += g.index!.count; }
    const pos = new Float32Array(V * 3);
    geos.forEach((g, i) => pos.set(g.getAttribute('position').array as Float32Array, bases[i] * 3));
    const idx = new Uint32Array(I);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const index = new THREE.BufferAttribute(idx, 1);
    index.setUsage(THREE.DynamicDrawUsage);
    geometry.setIndex(index);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const src = list[0].mesh.material as THREE.Material;
    const material = new THREE.MeshBasicNodeMaterial({ side: src.side });
    material.shadowSide = src.shadowSide;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'kit_glb_shadow';
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.layers.set(KIT_SHADOW_LAYER);
    group.add(mesh);
    const seen = list.map(() => -1);
    const refresh = () => {
      if (list.every((p, i) => p.version() === seen[i])) return false;
      let o = 0;
      list.forEach((p, i) => {
        seen[i] = p.version();
        const g = geos[i], n = g.drawRange.count, a = g.index!.array;
        for (let j = 0; j < n; j++) idx[o + j] = a[j] + bases[i];
        o += n;
      });
      geometry.setDrawRange(0, o);
      index.clearUpdateRanges();
      index.addUpdateRange(0, o);
      index.needsUpdate = true;
      return true;
    };
    refresh();
    return { mesh, refresh };
  });
  return {
    group,
    casters: casters.length,
    refresh() { let any = false; for (const c of casters) any = c.refresh() || any; return any; },
    dispose() { for (const c of casters) { c.mesh.geometry.dispose(); (c.mesh.material as THREE.Material).dispose(); } group.clear(); },
  };
}

const UP = new THREE.Vector3(0, 1, 0);
/** A placement's turn: Ry(yaw) Rx(pitch) (Euler 'YXZ'), about its base centre. */
export const kitPlacementTurn = (p: KitPlacement): THREE.Quaternion => (p.pitch ? new THREE.Quaternion().setFromEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ')) : new THREE.Quaternion().setFromAxisAngle(UP, p.yaw));
/** A placement's matrix: T(x, y, z) Ry(yaw) Rx(pitch) S(1, 1, sz). */
export const kitPlacementMatrix = (p: KitPlacement): THREE.Matrix4 => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), kitPlacementTurn(p), new THREE.Vector3(1, 1, p.sz ?? 1));

/**
 * One kit piece from its shared GLB, in `look`, at `split.placements`, as one batched mesh (buildKitBatch): each
 * placement draws the LOD its camera distance picks (kitLodSelect; `opts.forceLod` pins one), and the whole piece is one
 * draw per pass. `split.prims` (the procedural stand-in) are drawn until the GLB is ready, and for good if it fails.
 * `far`: buildPrimMeshes' far-scenery distance for that stand-in.
 */
export function createKitView(piece: KitPiece, split: { prims: VisualPrim[]; placements: KitPlacement[] }, look: KitLook, opts: { url?: string; far?: number; forceLod?: number | null } = {}): KitPieceView {
  const group = new THREE.Group();
  group.name = `kit_glb_${piece.name}`;
  const placements = split.placements;
  const fallback = split.prims.length ? buildPrimMeshes(split.prims, { far: opts.far }) : null;
  if (fallback) group.add(fallback.group);
  const mats = placements.map((p) => kitPlacementMatrix(p));
  const centres = placements.map((p) => new THREE.Vector3(0, piece.centreY, 0).applyQuaternion(kitPlacementTurn(p)).add(new THREE.Vector3(p.x, p.y, p.z)));
  const force = opts.forceLod ?? null;
  const cur = new Int8Array(placements.length).fill(-1);
  const cam = new THREE.Vector3();
  let batch: KitBatch | null = null;
  let mesh: THREE.Mesh | null = null;
  let drawn = 0;
  let version = 0;                                                 // bumps when the index changes (the shadow caster follows)
  let disposed = false;

  const ready = gltfLoader().loadAsync(opts.url ?? piece.url).then((gltf) => {
    if (disposed) return;
    gltf.scene.updateMatrixWorld(true);
    const src = [0, 1, 2].map((i) => {
      const m = gltf.scene.getObjectByName(`${piece.name}_LOD${i}`) as THREE.Mesh | undefined;
      if (!m?.isMesh) throw new Error(`${piece.name}: LOD${i} missing`);
      return m;
    });
    const material = src[0].material as THREE.Material;
    if (src.some((m) => m.material !== material)) throw new Error(`${piece.name}: the LODs do not share one material`);
    const extras: KitBatchExtra[] = [];
    if (piece.paintTint) {
      const tint = new THREE.Color(), values = new Float32Array(placements.length * 3);
      placements.forEach((p, k) => { kitTint(p.col, tint); values.set([tint.r, tint.g, tint.b], k * 3); });
      // pbr(): the paint-mask tint (PBR_PAINT_TINT); the toon side: the whole albedo, as a vertex colour (was instanceColor)
      extras.push({ name: look === 'pbr' ? PBR_PAINT_TINT : 'color', itemSize: 3, values });
    }
    // the toon side's outline normals: stylize() smooths a geometry's normals by position once; do it on each source LOD
    // (as it did on the instanced LOD meshes), then bake
    if (look === 'stylize') for (const m of src) smoothNormalsByPosition(THREE, m.geometry);
    const b = buildKitBatch(src.map((m) => m.geometry), src.map((m) => mats.map((pm) => pm.clone().multiply(m.matrixWorld))), extras);
    if (look === 'stylize') b.geometry.userData.outlineReady = true;
    for (const m of src) m.geometry.dispose();                     // never uploaded; the batch holds its own copy
    const bm = new THREE.Mesh(b.geometry, material);
    bm.name = `${piece.name}_batch`;
    bm.castShadow = true;
    bm.receiveShadow = true;
    const batchGroup = new THREE.Group();
    batchGroup.name = `${piece.name}_instances`;
    batchGroup.add(bm);
    if (look === 'pbr') bm.material = pbr(material, piece.pbrOpts ?? {});
    // the toon side: toon() keeps the colour map; the ORM/normal maps have no place in the toon model (surface preset)
    else stylize(batchGroup, { creases: false, remap: (m: THREE.MeshStandardMaterial) => toon({ color: m.color?.getHex() ?? 0xffffff, map: m.map ?? null, surface: piece.toonSurface, vertexColors: piece.paintTint, ...(piece.toonSurface === 'metal' ? { rough: 0.55, metal: 0.2 } : {}) }) });
    drawn = b.select(placements.map(() => force ?? 0));          // drawn before the first update() picks by distance
    version++;
    batch = b;
    mesh = bm;
    cur.fill(-1);
    group.add(batchGroup);
    if (fallback) { group.remove(fallback.group); disposePrimMeshes(fallback); }
  });
  ready.catch((e: unknown) => console.warn(`[kit-glb] ${piece.name} not loaded, procedural stand-in kept: ${String((e as Error)?.message ?? e)}`));
  // still rejects for a caller that awaits it; handled here so an unawaited failure is only the warning above (P-GLB4:
  // it was also an unhandled rejection, a page error)
  const done = ready.then(() => undefined);
  done.catch(() => {});

  return {
    group,
    ready: done,
    update(camera) {
      if (!batch) return;
      camera.getWorldPosition(cam);
      let changed = false;
      for (let k = 0; k < placements.length; k++) {
        const lod = force ?? kitLodSelect(cam.distanceTo(centres[k]), piece.lodDist, cur[k]);
        if (lod !== cur[k]) { cur[k] = lod; changed = true; }
      }
      if (changed) { drawn = batch.select(cur); version++; }
    },
    stats() {
      const vis = [0, 0, 0];
      for (const c of cur) if (c >= 0) vis[c]++;
      return {
        kitLoaded: batch ? 1 : 0,
        kitInstances: placements.length,
        kitLod0: vis[0], kitLod1: vis[1], kitLod2: vis[2],
        kitTriangles: batch ? drawn : 0,
        kitMeshes: batch ? 1 : 0,
      };
    },
    dispose() {
      disposed = true;
      if (fallback) disposePrimMeshes(fallback);
      if (mesh) { mesh.geometry.dispose(); mesh.removeFromParent(); }
      batch = null;
      mesh = null;
    },
    mesh: () => mesh,
    version: () => version,
  };
}

/** The Lot's containers from the shared GLB (P-GLB1's entry point, kept): createKitView with KIT_CONTAINER_PIECE. */
export function createContainerKitView(split: { containers: VisualPrim[]; placements: KitPlacement[] }, look: KitLook, opts: { url?: string; far?: number } = {}): KitView {
  return createKitView(KIT_CONTAINER_PIECE, { prims: split.containers, placements: split.placements }, look, opts);
}

// ------------------------------------------------------------------------------------------------ batch 1 (P-GLB3)
const kitUrl = (name: string) => `${import.meta.env?.BASE_URL ?? '/'}assets/kits/${name}.glb`;

/** A piece's split: the procedural prims it replaces (matched), what is left (rest), its placements, and `missing` (rebuilt prims not found: 0 when the data is consistent). */
export interface KitSplit { rest: VisualPrim[]; matched: VisualPrim[]; placements: KitPlacement[]; missing: number }

/**
 * Batch 1's LOD distances (P-GLB4; P-GLB3 drew LOD0 everywhere, because one InstancedMesh per LOD cost a draw per LOD
 * in use). A piece switches where the detail the next LOD drops falls to about 1-2 px at 1280 x 720 and a 60 degree FOV
 * (about 620 / d px per metre at d m): the pipe's 12 cm rim chamfers (LOD1) at 70 m, like the container; the footing's
 * 6 cm arrises and form panels, the lamp housing's fins and visor, like the bag wall at 30-35 m; the mast's step bolts
 * and gussets at 50 m. LOD2 is a silhouette (the pipe's mouths capped dark, the footing a box, the mast a prism).
 */
export const KIT_PIPE_LOD_DIST = [70, 160] as const;
export const KIT_FOOTING_LOD_DIST = [30, 80] as const;
export const KIT_FLOODMAST_LOD_DIST = [50, 120] as const;
export const KIT_FLOODLAMP_LOD_DIST = [35, 90] as const;

export const KIT_PIPE = 'Kit_Lot_Pipe_01';
const PIPE_COS = Math.cos(Math.PI / PIPE.seg);
export const KIT_PIPE_PIECE: KitPiece = {
  name: KIT_PIPE, url: kitUrl(KIT_PIPE), lodDist: KIT_PIPE_LOD_DIST, centreY: PIPE.ro * PIPE_COS, paintTint: false,
  // concrete: no metal scratches; a finer, shallower bump
  pbrOpts: { scratch: 0, detailBump: [0.003, 0.0006] }, toonSurface: 'world',
};

/** Is `q` a Lot drainage pipe's ring (pipes.ts addPipe() with layout.ts PIPE)? */
const isPipeRing = (q: VisualPrim) => q.s === 'ring' && q.seg === PIPE.seg && Math.abs(q.a - PIPE.ro) < 1e-6 && Math.abs(q.b - PIPE.len) < 1e-6 && Math.abs(q.c - (PIPE.ro - PIPE.ri)) < 1e-6;

/**
 * The Lot's drainage pipes: placements from their ring prims (the base centre is the outer floor facet, ro cos(pi/N)
 * under the axis; the kit's axis runs along its z, so the turn is the pipe's heading + pi/2), and the ring prims rebuilt
 * with addPipe() at those placements and matched one for one.
 */
export function splitPipePrims(data: WorldData, prims: readonly VisualPrim[] = data.prims ?? []): KitSplit {
  const placements = prims.filter(isPipeRing).map((q, i) => ({ id: `pipe_${i}`, x: q.x, y: q.y - PIPE.ro * PIPE_COS, z: q.z, yaw: (q.yaw ?? 0) + Math.PI / 2, col: q.col }));
  const kit = new Kit();
  for (const p of placements) addPipe(kit, PIPE, p.x, p.y, p.z, p.yaw - Math.PI / 2, p.col);
  const r = matchPrims(prims, kit.prims);
  return { rest: r.rest, matched: r.matched, placements, missing: r.missing };
}

export const KIT_FOOTING = 'Kit_Lot_Footing_01';
export const KIT_FOOTING_PIECE: KitPiece = {
  name: KIT_FOOTING, url: kitUrl(KIT_FOOTING), lodDist: KIT_FOOTING_LOD_DIST, centreY: 0.7, paintTint: false,
  pbrOpts: { scratch: 0, detailBump: [0.003, 0.0006] }, toonSurface: 'world',
};

/** Footing blocks from their 'footing' colliders (base centre, turn), rebuilt with props.ts footing() and matched. */
export function splitFootingPrims(data: WorldData, prims: readonly VisualPrim[] = data.prims ?? []): KitSplit {
  const kit = new Kit();
  const placements = data.props.filter((p) => p.type === 'footing').map((f, i) => {
    const base = f.y - f.hy;
    footing(kit, () => base + 0.04, f.x, f.z, f.rotY ?? 0);          // footing() sinks its block 0.04 under the ground
    return { id: `footing_${i}`, x: f.x, y: base, z: f.z, yaw: f.rotY ?? 0, col: 'concrete' };
  });
  const r = matchPrims(prims, kit.prims);
  return { rest: r.rest, matched: r.matched, placements, missing: r.missing };
}

export const KIT_FLOODMAST = 'Kit_Lot_FloodMast_01';
export const KIT_FLOODLAMP = 'Kit_Lot_FloodLamp_01';
export const KIT_FLOODMAST_PIECE: KitPiece = {
  name: KIT_FLOODMAST, url: kitUrl(KIT_FLOODMAST), lodDist: KIT_FLOODMAST_LOD_DIST, centreY: 11, paintTint: false,
  pbrOpts: {}, toonSurface: 'metal',
};
export const KIT_FLOODLAMP_PIECE: KitPiece = {
  name: KIT_FLOODLAMP, url: kitUrl(KIT_FLOODLAMP), lodDist: KIT_FLOODLAMP_LOD_DIST, centreY: 0.475, paintTint: false,
  pbrOpts: {}, toonSurface: 'metal',
};

/**
 * The Lot's floodlight towers rebuilt with props.ts floodTower() from their colliders (the base's bottom, and the
 * ground height at the aim that gives the housings' pitch), split into the mast half (base, plates, mast), the lamp
 * bar (stays procedural) and the housings. Placements: the mast at the flood_base collider (yaw 0), each housing at its
 * flood_head collider turned by its yaw and pitch, the kit's base centre T(0, -hy, 0) under the box centre.
 */
function lotFloodTowers(data: WorldData) {
  const bases = data.props.filter((p) => p.type === 'flood_base');
  const heads = data.props.filter((p) => p.type === 'flood_head');
  const bars = data.props.filter((p) => p.type === 'flood_bar');
  const mast = new Kit(), lamp = new Kit();
  const masts: KitPlacement[] = [], lamps: KitPlacement[] = [];
  for (const b of bases) {
    const t = FLOOD_TOWERS.find((f) => Math.abs(f.x - b.x) < 1e-6 && Math.abs(f.z - b.z) < 1e-6);
    const mine = heads.filter((h) => Math.hypot(h.x - b.x, h.z - b.z) < 4);
    const bar = bars.find((h) => Math.hypot(h.x - b.x, h.z - b.z) < 1e-6);
    if (!t || !mine.length || !bar) continue;
    const y0 = b.y - b.hy;                                         // floodTower(): y0 = groundMin(...) - 0.05
    const gy = y0 + FLOOD.mast - Math.hypot(t.aim[0] - t.x, t.aim[1] - t.z) * Math.tan(mine[0].pitch ?? 0);
    const k = new Kit();
    floodTower(k, (x, z) => (Math.hypot(x - t.x, z - t.z) < 5 ? y0 + 0.05 : gy), t.x, t.z, t.aim, []);
    for (const q of k.prims) {
      if (q.pitch) lamp.prims.push(q);
      else if (!(q.s === 'box' && Math.abs(q.x - bar.x) < 1e-6 && Math.abs(q.y - bar.y) < 1e-6 && Math.abs(q.z - bar.z) < 1e-6)) mast.prims.push(q);   // the lamp bar stays procedural
    }
    masts.push({ id: `${t.id}_mast`, x: b.x, y: y0, z: b.z, yaw: 0, col: 'hazardOchre' });
    mine.forEach((h, j) => {
      const o = new THREE.Vector3(0, -h.hy, 0).applyEuler(new THREE.Euler(h.pitch ?? 0, h.rotY ?? 0, 0, 'YXZ'));
      lamps.push({ id: `${t.id}_lamp${j}`, x: h.x + o.x, y: h.y + o.y, z: h.z + o.z, yaw: h.rotY ?? 0, pitch: h.pitch ?? 0, col: 'camoBlack' });
    });
  }
  return { mast: mast.prims, lamp: lamp.prims, masts, lamps };
}

export function splitFloodMastPrims(data: WorldData, prims: readonly VisualPrim[] = data.prims ?? []): KitSplit {
  const t = lotFloodTowers(data);
  const r = matchPrims(prims, t.mast);
  return { rest: r.rest, matched: r.matched, placements: t.masts, missing: r.missing };
}

export function splitFloodLampPrims(data: WorldData, prims: readonly VisualPrim[] = data.prims ?? []): KitSplit {
  const t = lotFloodTowers(data);
  const r = matchPrims(prims, t.lamp);
  return { rest: r.rest, matched: r.matched, placements: t.lamps, missing: r.missing };
}

/** One row of the kit table: a piece and how to find it in the world data. */
export interface KitEntry { piece: KitPiece; split(data: WorldData, prims: readonly VisualPrim[]): KitSplit }

/** The Lot's kit, in split order (each entry splits what the ones before it left). */
export const LOT_KIT: readonly KitEntry[] = [
  { piece: KIT_CONTAINER_PIECE, split: (d, p) => { const r = splitContainerPrims(d, p); return { rest: r.rest, matched: r.containers, placements: r.placements, missing: r.missing }; } },
  { piece: KIT_BAGWALL_PIECE, split: (d, p) => { const r = splitBagWallPrims(d, p); return { rest: r.rest, matched: r.walls, placements: r.placements, missing: r.missing }; } },
  { piece: KIT_PIPE_PIECE, split: splitPipePrims },
  { piece: KIT_FOOTING_PIECE, split: splitFootingPrims },
  { piece: KIT_FLOODMAST_PIECE, split: splitFloodMastPrims },
  { piece: KIT_FLOODLAMP_PIECE, split: splitFloodLampPrims },
];

/**
 * The Lot's kit split: every LOT_KIT entry in order; `rest` is everything no piece took. `containers` and `bags` keep
 * P-GLB1b's shape (world-view and its tests read them).
 */
export function splitLotKitPrims(data: WorldData, table: readonly KitEntry[] = LOT_KIT) {
  let rest: VisualPrim[] = [...(data.prims ?? [])];
  const pieces = table.map((e) => {
    const s = e.split(data, rest);
    rest = s.rest;
    return { piece: e.piece, ...s };
  });
  const at = (name: string) => pieces.find((p) => p.piece.name === name);
  const c = at(KIT_CONTAINER), b = at(KIT_BAGWALL);
  return {
    rest, pieces,
    containers: { containers: c?.matched ?? [], placements: c?.placements ?? [], missing: c?.missing ?? 0 },
    bags: { walls: b?.matched ?? [], placements: b?.placements ?? [], missing: b?.missing ?? 0 },
  };
}

/** The Lot's kit view: + shadowFrom(), which moves every loaded piece's shadow into one shared caster. */
export interface LotKitView extends KitView {
  /**
   * The light whose shadow map the kit casts into (world-view: the sky's sun). Its shadow camera gets KIT_SHADOW_LAYER
   * and, once every piece has loaded or failed, the loaded ones cast through one createKitShadowCaster() draw instead
   * of one draw each. Without it each piece casts its own shadow.
   */
  shadowFrom(light: THREE.DirectionalLight): void;
}

/**
 * Every Lot kit piece that has placements, in one view (world-view's ?kit=glb branch): one batched mesh per piece in
 * the colour pass and (after shadowFrom) one shared shadow draw. stats() sums the pieces (kitLoaded = pieces drawn
 * from their GLB), adds per-piece kitTriangles_<name> and kitLod0|1|2_<name> (instances at each LOD), and
 * kitShadowCasters. `forceLod` (default ?kitlod=) pins every instance to one LOD.
 */
export function createLotKitView(split: ReturnType<typeof splitLotKitPrims>, look: KitLook, opts: { far?: number; forceLod?: number | null } = {}): LotKitView {
  const o = { far: opts.far, forceLod: opts.forceLod === undefined ? kitForcedLod() : opts.forceLod };
  const views: [KitPiece, KitPieceView][] = split.pieces.filter((p) => p.placements.length).map((p) => [p.piece, createKitView(p.piece, { prims: p.matched, placements: p.placements }, look, o)]);
  const group = new THREE.Group();
  group.name = 'kit_glb';
  for (const [, v] of views) group.add(v.group);
  const ready = Promise.all(views.map(([, v]) => v.ready)).then(() => undefined);
  ready.catch(() => {});                                            // each piece warns for itself
  let light: THREE.DirectionalLight | null = null;
  let settled = false, disposed = false;
  let caster: ReturnType<typeof createKitShadowCaster> | null = null;
  let casting: THREE.Mesh[] = [];
  const build = () => {
    if (!light || !settled || caster || disposed) return;
    casting = views.map(([, v]) => v.mesh()).filter((m): m is THREE.Mesh => !!m);
    if (!casting.length) return;
    caster = createKitShadowCaster(views.filter(([, v]) => v.mesh()).map(([, v]) => ({ mesh: v.mesh()!, version: v.version })));
    for (const m of casting) m.castShadow = false;
    group.add(caster.group);
  };
  void Promise.allSettled(views.map(([, v]) => v.ready)).then(() => { settled = true; build(); });
  return {
    group,
    ready,
    shadowFrom(l) {
      light = l;
      l.shadow.camera.layers.enable(KIT_SHADOW_LAYER);
      build();
    },
    update(camera) {
      for (const [, v] of views) v.update(camera);
      caster?.refresh();
    },
    stats() {
      const out: Record<string, number> = {};
      for (const [piece, v] of views) {
        const st = v.stats();
        for (const [k, n] of Object.entries(st)) out[k] = (out[k] ?? 0) + n;
        out[`kitTriangles_${piece.name}`] = st.kitTriangles;
        for (let i = 0; i < 3; i++) out[`kitLod${i}_${piece.name}`] = st[`kitLod${i}`];
      }
      out.kitShadowCasters = caster?.casters ?? 0;
      return out;
    },
    dispose() {
      disposed = true;
      light?.shadow.camera.layers.disable(KIT_SHADOW_LAYER);
      caster?.dispose();
      caster = null;
      for (const [, v] of views) v.dispose();
    },
  };
}

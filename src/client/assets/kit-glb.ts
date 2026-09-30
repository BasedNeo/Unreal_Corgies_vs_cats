// OWNER: P-GLB1 (W11). Shared-GLB kit pieces in the browser client (docs/design/ASSET_PIPELINE.md, stage 5): the web
// variant of a master GLB is loaded with GLTFLoader (+ the meshopt decoder), its <name>_LOD0|1|2 meshes become one
// InstancedMesh each, and its materials go through the style factory: pbr() (default) or stylize() (?kitlook=stylize,
// the toon side of the A/B). The COL_ boxes are never rendered; gameplay collision stays in the world data (the
// authority never reads a GLB; tests/unit/glb-container-colliders.test.ts proves the two agree).
//
// The flag: ?kit=glb draws The Lot's site-office containers from Kit_Lot_Container20_01 where the procedural ones
// stand (default off: without it nothing here runs). Until the GLB is ready (or if it fails to load) the procedural
// container prims are drawn instead, so there is never a hole in the world.
//
// LOD per instance: every LOD mesh holds all placements in the same order; each frame an instance keeps its matrix in
// the LOD its camera distance picks and a zero-scale matrix in the others; a LOD mesh with no instance is hidden (no
// draw). Tint per instance: the kit is painted a neutral light grey (KIT_PAINT_SRGB, the bake's PAINT) and each
// container takes its world palette colour (CONTAINERS[].col) as a linear-space ratio. W11 P-GLB1b: under pbr() the
// tint is a per-instance `paintTint` attribute that pbr({ paintTint: true }) applies only through the paint mask (the
// baseColor alpha), so rust, grime and the frame keep their colour; the toon side keeps instanceColor (whole albedo).
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

/**
 * One kit piece from its shared GLB (instanced), in `look`, at `split.placements`. `split.prims` (the procedural stand-in)
 * are drawn until the GLB is ready. `far`: buildPrimMeshes' far-scenery distance for that stand-in.
 */
export function createKitView(piece: KitPiece, split: { prims: VisualPrim[]; placements: KitPlacement[] }, look: KitLook, opts: { url?: string; far?: number } = {}): KitView {
  const group = new THREE.Group();
  group.name = `kit_glb_${piece.name}`;
  const placements = split.placements;
  const fallback = split.prims.length ? buildPrimMeshes(split.prims, { far: opts.far }) : null;
  if (fallback) group.add(fallback.group);
  const meshes: THREE.InstancedMesh[] = [];
  const tris: number[] = [];
  const cur = placements.map(() => -1);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const turn = (p: KitPlacement) => (p.pitch ? new THREE.Quaternion().setFromEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ')) : new THREE.Quaternion().setFromAxisAngle(up, p.yaw));
  const mats = placements.map((p) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), turn(p), new THREE.Vector3(1, 1, p.sz ?? 1)));
  const centres = placements.map((p) => new THREE.Vector3(0, piece.centreY, 0).applyQuaternion(turn(p)).add(new THREE.Vector3(p.x, p.y, p.z)));
  const cam = new THREE.Vector3();
  let disposed = false;

  // per LOD, per placement: placement x the LOD node's own matrix (the web variant's KHR_mesh_quantization puts the
  // dequantization scale/offset on the node)
  const lodMats: THREE.Matrix4[][] = [];
  const ready = gltfLoader().loadAsync(opts.url ?? piece.url).then((gltf) => {
    if (disposed) return;
    const tint = new THREE.Color();
    // pbr paint tint: one per-instance attribute shared by the LOD geometries (same placements, same order)
    const paint = look === 'pbr' && piece.paintTint ? new THREE.InstancedBufferAttribute(new Float32Array(placements.length * 3), 3) : null;
    if (paint) placements.forEach((p, k) => { kitTint(p.col, tint); paint.setXYZ(k, tint.r, tint.g, tint.b); });
    gltf.scene.updateMatrixWorld(true);
    for (let i = 0; i < 3; i++) {
      const src = gltf.scene.getObjectByName(`${piece.name}_LOD${i}`) as THREE.Mesh | undefined;
      if (!src?.isMesh) throw new Error(`${piece.name}: LOD${i} missing`);
      if (paint) src.geometry.setAttribute(PBR_PAINT_TINT, paint);
      const im = new THREE.InstancedMesh(src.geometry, src.material, placements.length);
      im.name = `${piece.name}_LOD${i}`;
      im.castShadow = true;
      im.receiveShadow = true;
      lodMats.push(mats.map((m) => m.clone().multiply(src.matrixWorld)));
      placements.forEach((p, k) => {
        im.setMatrixAt(k, lodMats[i][k]);
        if (look === 'stylize' && piece.paintTint) im.setColorAt(k, kitTint(p.col, tint));
      });
      im.computeBoundingSphere();                     // over every placement, kept when instances switch LOD
      im.computeBoundingBox();
      meshes.push(im);
      const idx = src.geometry.getIndex();
      tris.push((idx ? idx.count : src.geometry.getAttribute('position').count) / 3);
    }
    const lodGroup = new THREE.Group();
    lodGroup.name = `${piece.name}_instances`;
    lodGroup.add(...meshes);
    if (look === 'pbr') for (const m of meshes) m.material = pbr(m.material as THREE.Material, piece.pbrOpts ?? {});
    // the toon side: toon() keeps the colour map; the ORM/normal maps have no place in the toon model (surface preset)
    else stylize(lodGroup, { creases: false, remap: (m: THREE.MeshStandardMaterial) => toon({ color: m.color?.getHex() ?? 0xffffff, map: m.map ?? null, surface: piece.toonSurface, ...(piece.toonSurface === 'metal' ? { rough: 0.55, metal: 0.2 } : {}) }) });
    group.add(lodGroup);
    for (let k = 0; k < placements.length; k++) cur[k] = -1;
    if (fallback) { group.remove(fallback.group); disposePrimMeshes(fallback); }
  });
  ready.catch((e: unknown) => console.warn(`[kit-glb] ${piece.name} not loaded, procedural stand-in kept: ${String((e as Error)?.message ?? e)}`));

  return {
    group,
    ready: ready.then(() => undefined),
    update(camera) {
      if (!meshes.length) return;
      camera.getWorldPosition(cam);
      let changed = false;
      for (let k = 0; k < placements.length; k++) {
        const lod = kitLodAt(cam.distanceTo(centres[k]), piece.lodDist);
        if (lod === cur[k]) continue;
        cur[k] = lod;
        changed = true;
        for (let i = 0; i < 3; i++) meshes[i].setMatrixAt(k, i === lod ? lodMats[i][k] : zero);
      }
      if (!changed) return;
      for (let i = 0; i < 3; i++) {
        meshes[i].instanceMatrix.needsUpdate = true;
        meshes[i].visible = cur.includes(i);
      }
    },
    stats() {
      const vis = [0, 1, 2].map((i) => cur.filter((c) => c === i).length);
      return {
        kitLoaded: meshes.length ? 1 : 0,
        kitInstances: placements.length,
        kitLod0: vis[0], kitLod1: vis[1], kitLod2: vis[2],
        kitTriangles: meshes.length ? vis.reduce((s, n, i) => s + n * tris[i], 0) : 0,
        kitMeshes: meshes.filter((m) => m.visible).length,
      };
    },
    dispose() {
      disposed = true;
      if (fallback) disposePrimMeshes(fallback);
      for (const m of meshes) { m.geometry.dispose(); m.dispose(); }
      meshes.length = 0;
    },
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
 * Batch 1's LOD distances: LOD0 at every distance. The four pieces are cheap (144-484 triangles; all 34 instances of LOD0
 * cost about 6.5 k triangles) and a LOD mesh is one instanced draw plus its shadow draw, so switching LODs would add up to
 * four draws per piece to save a few thousand triangles (measured, Lot 4v4 high: 222 draws with the flag off, 248-250
 * with per-instance LODs on these four, 232-234 with LOD0 only). The GLBs keep LOD1 / LOD2 (the standard; Godot and a later far tier use them).
 */
export const KIT_LOD0_ONLY = [Infinity, Infinity] as const;

export const KIT_PIPE = 'Kit_Lot_Pipe_01';
const PIPE_COS = Math.cos(Math.PI / PIPE.seg);
export const KIT_PIPE_PIECE: KitPiece = {
  name: KIT_PIPE, url: kitUrl(KIT_PIPE), lodDist: KIT_LOD0_ONLY, centreY: PIPE.ro * PIPE_COS, paintTint: false,
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
  name: KIT_FOOTING, url: kitUrl(KIT_FOOTING), lodDist: KIT_LOD0_ONLY, centreY: 0.7, paintTint: false,
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
  name: KIT_FLOODMAST, url: kitUrl(KIT_FLOODMAST), lodDist: KIT_LOD0_ONLY, centreY: 11, paintTint: false,
  pbrOpts: {}, toonSurface: 'metal',
};
export const KIT_FLOODLAMP_PIECE: KitPiece = {
  name: KIT_FLOODLAMP, url: kitUrl(KIT_FLOODLAMP), lodDist: KIT_LOD0_ONLY, centreY: 0.475, paintTint: false,
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

/**
 * Every Lot kit piece that has placements, in one view (world-view's ?kit=glb branch). stats() sums the pieces
 * (kitLoaded = pieces drawn from their GLB) and adds per-piece kitTriangles_<name>.
 */
export function createLotKitView(split: ReturnType<typeof splitLotKitPrims>, look: KitLook, opts: { far?: number } = {}): KitView {
  const views: [KitPiece, KitView][] = split.pieces.filter((p) => p.placements.length).map((p) => [p.piece, createKitView(p.piece, { prims: p.matched, placements: p.placements }, look, opts)]);
  const group = new THREE.Group();
  group.name = 'kit_glb';
  for (const [, v] of views) group.add(v.group);
  return {
    group,
    ready: Promise.all(views.map(([, v]) => v.ready)).then(() => undefined),
    update(camera) { for (const [, v] of views) v.update(camera); },
    stats() {
      const out: Record<string, number> = {};
      for (const [piece, v] of views) {
        const st = v.stats();
        for (const [k, n] of Object.entries(st)) out[k] = (out[k] ?? 0) + n;
        out[`kitTriangles_${piece.name}`] = st.kitTriangles;
      }
      return out;
    },
    dispose() { for (const [, v] of views) v.dispose(); },
  };
}

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
// draw). Tint per instance (instanceColor): the kit is painted a neutral light grey (KIT_PAINT_SRGB, the bake's PAINT)
// and each container takes its world palette colour (CONTAINERS[].col) as a linear-space ratio.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { pbr, stylize, toon } from '../style/style-webgpu.js';
import { worldColor } from '../world/world-palette';
import { buildPrimMeshes, disposePrimMeshes } from '../world/prim-mesh';
import type { VisualPrim, WorldData } from '../../shared/world/world-types';
import { Kit } from '../../shared/world/kit';
import { container } from '../../shared/world/lot/props';
import { CONTAINER, CONTAINERS } from '../../shared/world/lot/layout';

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

export interface KitPlacement { id: string; x: number; y: number; z: number; yaw: number; col: string }

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
export function splitContainerPrims(data: WorldData): { rest: VisualPrim[]; containers: VisualPrim[]; placements: KitPlacement[]; missing: number } {
  const placements = lotContainerPlacements(data);
  const kit = new Kit();
  for (const p of placements) {
    const c = CONTAINERS.find((k) => k.id === p.id);
    if (c) container(kit, c.x, p.y, c.z, c.col, c.stripe, c.door, []);
  }
  const want = new Map<string, number>();
  for (const q of kit.prims) want.set(primKey(q), (want.get(primKey(q)) ?? 0) + 1);
  const rest: VisualPrim[] = [], containers: VisualPrim[] = [];
  for (const q of data.prims ?? []) {
    const k = primKey(q), n = want.get(k) ?? 0;
    if (n > 0) { want.set(k, n - 1); containers.push(q); } else rest.push(q);
  }
  let missing = 0;
  for (const n of want.values()) missing += n;
  return { rest, containers, placements, missing };
}

/** Linear-space instance tint that turns the kit's neutral paint into the palette colour `col`. */
export function kitTint(col: string, out = new THREE.Color()): THREE.Color {
  const paint = new THREE.Color().setRGB(KIT_PAINT_SRGB[0], KIT_PAINT_SRGB[1], KIT_PAINT_SRGB[2], THREE.SRGBColorSpace);
  const c = worldColor(col);
  return out.setRGB(c.r / paint.r, c.g / paint.g, c.b / paint.b);
}

/** LOD index for a camera distance (m). */
export const kitLodFor = (d: number): number => (d < KIT_LOD_DIST[0] ? 0 : d < KIT_LOD_DIST[1] ? 1 : 2);

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
 * The Lot's containers from the shared GLB (instanced), in `look`. `fallback` prims (the procedural containers) are
 * drawn until the GLB is ready. `far`: buildPrimMeshes' far-scenery distance for the fallback.
 */
export function createContainerKitView(split: { containers: VisualPrim[]; placements: KitPlacement[] }, look: KitLook, opts: { url?: string; far?: number } = {}): KitView {
  const group = new THREE.Group();
  group.name = 'kit_glb';
  const placements = split.placements;
  const fallback = split.containers.length ? buildPrimMeshes(split.containers, { far: opts.far }) : null;
  if (fallback) group.add(fallback.group);
  const meshes: THREE.InstancedMesh[] = [];
  const tris: number[] = [];
  const cur = placements.map(() => -1);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const mats = placements.map((p) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(up, p.yaw), new THREE.Vector3(1, 1, 1)));
  const centres = placements.map((p) => new THREE.Vector3(p.x, p.y + CONTAINER.H / 2, p.z));
  const cam = new THREE.Vector3();
  let disposed = false;

  // per LOD, per placement: placement x the LOD node's own matrix (the web variant's KHR_mesh_quantization puts the
  // dequantization scale/offset on the node)
  const lodMats: THREE.Matrix4[][] = [];
  const ready = gltfLoader().loadAsync(opts.url ?? KIT_CONTAINER_URL).then((gltf) => {
    if (disposed) return;
    const tint = new THREE.Color();
    gltf.scene.updateMatrixWorld(true);
    for (let i = 0; i < 3; i++) {
      const src = gltf.scene.getObjectByName(`${KIT_CONTAINER}_LOD${i}`) as THREE.Mesh | undefined;
      if (!src?.isMesh) throw new Error(`${KIT_CONTAINER}: LOD${i} missing`);
      const im = new THREE.InstancedMesh(src.geometry, src.material, placements.length);
      im.name = `${KIT_CONTAINER}_LOD${i}`;
      im.castShadow = true;
      im.receiveShadow = true;
      lodMats.push(mats.map((m) => m.clone().multiply(src.matrixWorld)));
      placements.forEach((p, k) => { im.setMatrixAt(k, lodMats[i][k]); im.setColorAt(k, kitTint(p.col, tint)); });
      im.computeBoundingSphere();                     // over every placement, kept when instances switch LOD
      im.computeBoundingBox();
      meshes.push(im);
      const idx = src.geometry.getIndex();
      tris.push((idx ? idx.count : src.geometry.getAttribute('position').count) / 3);
    }
    const lodGroup = new THREE.Group();
    lodGroup.name = `${KIT_CONTAINER}_instances`;
    lodGroup.add(...meshes);
    if (look === 'pbr') for (const m of meshes) m.material = pbr(m.material as THREE.Material);
    // the toon side: toon() keeps the colour map; the ORM/normal maps have no place in the toon model (surface preset)
    else stylize(lodGroup, { creases: false, remap: (m: THREE.MeshStandardMaterial) => toon({ color: m.color?.getHex() ?? 0xffffff, map: m.map ?? null, surface: 'metal', rough: 0.55, metal: 0.2 }) });
    group.add(lodGroup);
    for (let k = 0; k < placements.length; k++) cur[k] = -1;
    if (fallback) { group.remove(fallback.group); disposePrimMeshes(fallback); }
  });
  ready.catch((e: unknown) => console.warn(`[kit-glb] ${KIT_CONTAINER} not loaded, procedural containers kept: ${String((e as Error)?.message ?? e)}`));

  return {
    group,
    ready: ready.then(() => undefined),
    update(camera) {
      if (!meshes.length) return;
      camera.getWorldPosition(cam);
      let changed = false;
      for (let k = 0; k < placements.length; k++) {
        const lod = kitLodFor(cam.distanceTo(centres[k]));
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

// OWNER: world lane (L2). Builds the visible West Yard from WorldData:
//   terrain (grid-exact toon ground) · props (merged VisualPrims, ink + creases) · board fences ·
//   water · near-field foliage with wind · stylized sky + time of day + fog + camera-following sun shadow.
// cameraColliders are invisible low-poly proxies (collider boxes/cylinders + a coarse terrain) so the
// third-person camera raycasts stay cheap. Budget target: <= 250 world draw calls, <= 1 M visible tris.
import * as THREE from 'three/webgpu';
import type { Bookmark, WorldData } from '../../shared/world/world-data';
import { createTerrainMaterial } from './materials';
import { createTerrainView, createColliderProxy } from './terrain-view';
import { buildPrimMeshes, disposePrimMeshes } from './prim-mesh';
import { createFenceView } from './fence-view';
import { createWaterView } from './water-view';
import { createFoliage } from './foliage';
import { createYardSky } from './sky';

export interface WorldViewOptions {
  /** Quality tier. low: no foliage, 1024 shadow map, cloudless sky, flat ground shading (headless /
   *  SwiftShader / integrated GPUs); med: 60% foliage, 1536 shadows; high (default): everything. */
  quality?: 'low' | 'med' | 'high';
  /** 0..1 time of day (0 midnight, .25 sunrise, .5 noon, .75 sunset). Default: WorldData.timeOfDay or 0.68. */
  timeOfDay?: number;
  /** Game-time day speed in days per real second (0 = frozen, the default). */
  daySpeed?: number;
  /** Foliage density multiplier; overrides the tier (low 0, med 0.6, high 1). */
  foliageDensity?: number;
  shadowMapSize?: number;
  /** Ink hull on the terrain (silhouette lines on hills). */
  terrainInk?: boolean;
}

export interface WorldView {
  root: THREE.Group;
  /** Meshes the camera should collide with. */
  cameraColliders: THREE.Object3D[];
  update(dt: number, camera: THREE.Camera): void;
  dispose(): void;
  // ---- L2 additions ----
  setTimeOfDay(t: number): void;
  readonly timeOfDay: number;
  bookmarks: Bookmark[];
  stats(): Record<string, number>;
}

export function createWorldView(scene: THREE.Scene, data: WorldData, opts: WorldViewOptions = {}): WorldView {
  const root = new THREE.Group();
  root.name = 'world';

  const q = opts.quality ?? 'high';
  const terrainMat = createTerrainMaterial({ ink: opts.terrainInk ?? false, detail: q !== 'low' });
  const terrain = createTerrainView(data, terrainMat.material);
  root.add(terrain.group);

  const fence = data.fences?.length ? createFenceView(data.fences, data.height) : null;
  if (fence) root.add(fence.boards);
  const props = buildPrimMeshes([...(data.prims ?? []), ...(fence?.prims ?? [])]);
  root.add(props.group);

  const water = createWaterView(data);
  root.add(water.group);

  const density = opts.foliageDensity ?? (q === 'low' ? 0 : q === 'med' ? 0.6 : 1);
  const foliage = data.surface && density > 0 ? createFoliage(data, { density }) : null;
  if (foliage) root.add(foliage.group);

  const proxy = createColliderProxy(data);
  root.add(terrain.proxy, proxy.group);

  const sky = createYardSky(scene, {
    timeOfDay: opts.timeOfDay ?? data.timeOfDay ?? 0.68,
    shadowMap: opts.shadowMapSize ?? (q === 'low' ? 1024 : q === 'med' ? 1536 : 2048),
    clouds: q !== 'low',
  });
  scene.add(root);

  let daySpeed = opts.daySpeed ?? 0;
  return {
    root,
    cameraColliders: [terrain.proxy, proxy.group],
    bookmarks: data.bookmarks ?? [],
    get timeOfDay() { return sky.timeOfDay; },
    setTimeOfDay(t: number) { sky.setTimeOfDay(t); },
    update(dt, camera) {
      if (daySpeed) sky.setTimeOfDay(sky.timeOfDay + dt * daySpeed);
      sky.update(camera);
      foliage?.update(camera);
    },
    stats() {
      return {
        terrainTriangles: terrain.triangles,
        propTriangles: props.stats.triangles,
        propMeshes: props.stats.meshes,
        prims: props.stats.prims,
        fenceBoards: fence?.boards.count ?? 0,
        ...(foliage?.stats() ?? {}),
      };
    },
    dispose() {
      daySpeed = 0;
      scene.remove(root);
      terrain.dispose();
      terrainMat.material.dispose();
      disposePrimMeshes(props);
      fence?.dispose();
      water.dispose();
      foliage?.dispose();
      proxy.dispose();
      sky.dispose();
    },
  };
}

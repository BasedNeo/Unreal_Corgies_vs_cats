// WebGPU renderer (auto-falls back to WebGL2) + the comic post pipeline + adaptive resolution + quality tiers.
// W7 S4: the tier also fixes the style's material detail (setStyleDetail: weathering masks, per-light specular) at
// build time — like the world knobs it needs a reload to change; engine knobs (resolution, shadows, bloom) stay live.
// W7 P3 (render budget): the ink LOD. The toon outline pass draws every toon mesh twice (the ink hull, then the
// mesh). Beyond the style's far cap the hull thins with distance, and past `inkCutDistance` it is narrower than
// INK_MIN_PX device pixels: it only speckles a few silhouette pixels, so the pass skips it. The same scene-pass hook
// honours `userData.drawDistance` (m, camera to the object's bounds): the world's crease-ink tiles use it.
// `userData.keepInk` opts a mesh out of the hull cut: sub-pixel-thin parts (a whip mast, a barrel) rasterize mostly
// through their hull at range, so characters keep theirs (their class reads at 35 m, K1/K2).
import * as THREE from 'three/webgpu';
import { renderOutput } from 'three/tsl';
import { createComicPipeline, createStyleLights, setStyleDetail, DETAIL_BY_TIER } from '../style/style-webgpu.js';
import { STYLE } from '../style/style-tokens.js';
import { createAdaptiveQuality, type AdaptiveQuality } from './adaptive-quality';
import { QUALITY, type QualityTier, type QualityProfile } from './quality';

export interface RenderContext {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  pipeline: ReturnType<typeof createComicPipeline>;
  backend: 'webgpu' | 'webgl';
  /** Adaptive resolution, bounded by the current tier (call adaptive.update(frameMs) once per frame). */
  adaptive: AdaptiveQuality;
  /** The tier whose engine knobs are applied. */
  readonly quality: QualityTier;
  /** Style material detail fixed at creation (0 low, 1 medium, 2 high; see style-webgpu.js). */
  readonly styleDetail: number;
  /** P3 ink LOD of the scene pass: the current hull cut distance and last frame's counts (probes, labs). */
  readonly inkLod: InkLodStats;
  /** Applies a tier's engine knobs live: pixel-ratio bounds, the shadow pass, bloom (see engine/quality.ts). World
   *  knobs (foliage, garden density, shadow-map size...) are read when the world view is built. */
  setQuality(tier: QualityTier): void;
  render(): void;
}

/** What applyEngineQuality() touches (a structural subset of RenderContext, so it is testable without a GPU). */
export interface QualityTarget {
  renderer: { shadowMap: { enabled: boolean } };
  pipeline: { pipeline: { outputNode: unknown; needsUpdate: boolean } };
  adaptive: Pick<AdaptiveQuality, 'setBounds'>;
}

/** Output graphs with and without bloom, built once from the comic pipeline's own passes. */
export interface OutputNodes { withBloom: unknown; withoutBloom: unknown }

export function outputNodesOf(p: { outputNode: unknown; scenePass: unknown; grade: { node: (c: unknown) => unknown } }): OutputNodes {
  return { withBloom: p.outputNode, withoutBloom: p.grade.node(renderOutput(p.scenePass as never)) };
}

/** Sets the engine knobs of `profile` on `t`. Returns what changed (for logs/tests). */
export function applyEngineQuality(t: QualityTarget, profile: QualityProfile, nodes: OutputNodes,
  dpr = globalThis.devicePixelRatio ?? 1): { shadows: boolean; bloom: boolean; maxRatio: number } {
  const maxRatio = Math.max(0.25, Math.min(dpr, profile.maxPixelRatio));
  t.adaptive.setBounds(Math.min(profile.minPixelRatio, maxRatio), maxRatio);
  // three.js keys render objects on shadowMap.enabled, so flipping it live rebuilds the affected pipelines once.
  t.renderer.shadowMap.enabled = profile.shadows;
  const out = profile.bloom ? nodes.withBloom : nodes.withoutBloom;
  if (t.pipeline.pipeline.outputNode !== out) {
    t.pipeline.pipeline.outputNode = out;           // an unreferenced bloom node is never rendered
    t.pipeline.pipeline.needsUpdate = true;
  }
  return { shadows: profile.shadows, bloom: profile.bloom, maxRatio };
}

// ---------------------------------------------------------------------------------------------------------------------
// P3 ink LOD (see the header). Pure helpers first (unit-tested without a GPU), then the scene-pass hook.

/**
 * Narrowest ink hull worth drawing, in device pixels. Unantialiased, a hull p px wide covers about p of the pixel
 * centres along a silhouette. Below 0.3 px it is a broken speckle, not a line, and the object reads by colour.
 */
export const INK_MIN_PX = 0.3;

/** Ink hull width in device px at `dist` m: the style extrudes thickness × min(clip w, farCap) (capInkDistance). */
export function inkWidthPx(dist: number, thickness: number, farCap: number, bufferHeight: number): number {
  return thickness * (dist > farCap ? farCap / dist : 1) * bufferHeight * 0.5;
}

/** Distance (m) beyond which the hull is narrower than `minPx` (0: the hull is never that wide at this height). */
export function inkCutDistance(thickness: number, farCap: number, bufferHeight: number, minPx = INK_MIN_PX): number {
  const near = thickness * bufferHeight * 0.5;
  return near < minPx ? 0 : Math.max(farCap, (farCap * near) / minPx);
}

const _bc = new THREE.Vector3();
/** World bounding sphere radius and centre (into `_bc`) of a drawable, or -1 when it has none. */
function boundsOf(o: THREE.Object3D): number {
  const any = o as unknown as { boundingSphere?: THREE.Sphere | null; computeBoundingSphere?: () => void; geometry?: THREE.BufferGeometry };
  let s: THREE.Sphere | null | undefined = null;
  if (any.boundingSphere !== undefined) {               // instanced / skinned / batched meshes keep their own bounds
    if (any.boundingSphere === null) any.computeBoundingSphere?.();
    s = any.boundingSphere;
  } else if (any.geometry) {
    if (any.geometry.boundingSphere === null) any.geometry.computeBoundingSphere();
    s = any.geometry.boundingSphere;
  }
  if (!s) return -1;
  _bc.copy(s.center).applyMatrix4(o.matrixWorld);
  return s.radius * o.matrixWorld.getMaxScaleOnAxis();
}

/** Distance (m) from `eye` to the nearest point of the object's bounding sphere (0 inside it or without bounds). */
export function distanceToBounds(o: THREE.Object3D, eye: THREE.Vector3): number {
  const r = boundsOf(o);
  return r < 0 ? 0 : Math.max(0, _bc.distanceTo(eye) - r);
}

/** What the ink LOD did last frame (scene pass only). */
export interface InkLodStats {
  /** Hull cut distance (m) at the current drawing-buffer height. */
  cut: number;
  hullsDrawn: number;
  hullsSkipped: number;
  /** Objects skipped by their `userData.drawDistance`. */
  distanceCulled: number;
}

type RenderObjectFn = (object: THREE.Object3D, scene: THREE.Scene, camera: THREE.Camera, geometry: THREE.BufferGeometry,
  material: THREE.Material, group: unknown, lightsNode: unknown, clippingContext: unknown) => void;
interface OutlinePassLike {
  camera: THREE.Camera;
  updateBefore(frame: { renderer: THREE.WebGPURenderer }): void;
  _getOutlineMaterial(m: THREE.Material): THREE.Material;
}

/**
 * Replaces the toon outline pass's per-object render function with the same one plus the ink LOD: the hull is
 * skipped where it would be under `minPx` wide (never for `userData.keepInk` meshes, nor for objects with
 * frustumCulled = false: their bounds may be stale), and objects with `userData.drawDistance` beyond it are skipped (an
 * opt-in that vouches for the bounds).
 * Everything else (the hull material, its thickness and far cap, the order hull → mesh) is three's
 * ToonOutlinePassNode.updateBefore (r186) unchanged. `ink` holds the pipeline's thickness / far-cap uniforms.
 */
export function installInkLod(scenePass: unknown, ink: { thickness: { value: number }; inkFar: { value: number } },
  minPx = INK_MIN_PX): InkLodStats {
  const pass = scenePass as OutlinePassLike;
  const passUpdate = (Object.getPrototypeOf(Object.getPrototypeOf(pass)) as OutlinePassLike).updateBefore; // PassNode's
  const stats: InkLodStats = { cut: Infinity, hullsDrawn: 0, hullsSkipped: 0, distanceCulled: 0 };
  const size = new THREE.Vector2(), eye = new THREE.Vector3();
  let cut = Infinity;
  let renderer: THREE.WebGPURenderer | null = null;
  const draw: RenderObjectFn = (object, scene, camera, geometry, material, group, lightsNode, clippingContext) => {
    const r = renderer as unknown as { renderObject: RenderObjectFn };
    const far = object.userData.drawDistance as number | undefined;
    let d = -1;
    if (far !== undefined) {
      d = distanceToBounds(object, eye);
      if (d > far) { stats.distanceCulled++; return; }
    }
    const toon = material as THREE.Material & { isMeshToonMaterial?: boolean; isMeshToonNodeMaterial?: boolean; wireframe?: boolean };
    if ((toon.isMeshToonMaterial || toon.isMeshToonNodeMaterial) && toon.wireframe === false) {
      // always inked: `userData.keepInk` (characters: on a thin mast or barrel at range the hull IS the silhouette) and
      // objects that opt out of frustum culling (flying debris, wheels, pooled FX): their bounds may be stale
      if (object.userData.keepInk || !object.frustumCulled) d = 0;
      else if (d < 0) d = distanceToBounds(object, eye);
      if (d <= cut) {
        r.renderObject(object, scene, camera, geometry, pass._getOutlineMaterial(material), group, lightsNode, clippingContext);
        stats.hullsDrawn++;
      } else stats.hullsSkipped++;
    }
    r.renderObject(object, scene, camera, geometry, material, group, lightsNode, clippingContext);
  };
  pass.updateBefore = function (frame) {
    renderer = frame.renderer;
    renderer.getDrawingBufferSize(size);
    cut = inkCutDistance(ink.thickness.value, ink.inkFar.value, size.y, minPx);
    stats.cut = cut; stats.hullsDrawn = 0; stats.hullsSkipped = 0; stats.distanceCulled = 0;
    pass.camera.updateMatrixWorld();
    eye.setFromMatrixPosition(pass.camera.matrixWorld);
    const current = renderer.getRenderObjectFunction();
    renderer.setRenderObjectFunction(draw as never);
    try { passUpdate.call(pass, frame); } finally { renderer.setRenderObjectFunction(current); }
  };
  return stats;
}

/** `inkMinPx` (labs, A/B): the ink LOD's narrowest drawn hull in device px (default INK_MIN_PX; 0 = every hull). */
export async function createRenderContext(container: HTMLElement, opts: { forceWebGL?: boolean; quality?: QualityTier; inkMinPx?: number } = {}): Promise<RenderContext> {
  // before any toon() material exists: the world, characters and props built after this share the tier's detail
  const styleDetail = DETAIL_BY_TIER[opts.quality ?? 'high'];
  setStyleDetail(styleDetail);
  const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL: !!opts.forceWebGL, powerPreference: 'high-performance' });
  await renderer.init();
  renderer.setSize(container.clientWidth || innerWidth, container.clientHeight || innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2500);
  const lights = createStyleLights();
  scene.add(lights);
  const pipeline = createComicPipeline(renderer, scene, camera, { maxPixelRatio: STYLE.maxPixelRatio });
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl';
  const adaptive = createAdaptiveQuality(renderer);
  const nodes = outputNodesOf(pipeline);
  const inkLod = installInkLod(pipeline.scenePass, pipeline.uniforms, opts.inkMinPx ?? INK_MIN_PX);

  const onResize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    pipeline.setSize(innerWidth, innerHeight);
  };
  window.addEventListener('resize', onResize);
  let tier: QualityTier = opts.quality ?? 'high';
  const ctx: RenderContext = {
    renderer, scene, camera, pipeline, backend, adaptive, styleDetail, inkLod,
    get quality() { return tier; },
    setQuality(next: QualityTier) {
      tier = next;
      applyEngineQuality(ctx, QUALITY[next], nodes);
    },
    render: () => pipeline.render(),
  };
  ctx.setQuality(tier);
  return ctx;
}

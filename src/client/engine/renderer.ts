// WebGPU renderer (auto-falls back to WebGL2) + the comic post pipeline + adaptive resolution + quality tiers.
import * as THREE from 'three/webgpu';
import { renderOutput } from 'three/tsl';
import { createComicPipeline, createStyleLights } from '../style/style-webgpu.js';
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

export async function createRenderContext(container: HTMLElement, opts: { forceWebGL?: boolean; quality?: QualityTier } = {}): Promise<RenderContext> {
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

  const onResize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    pipeline.setSize(innerWidth, innerHeight);
  };
  window.addEventListener('resize', onResize);
  let tier: QualityTier = opts.quality ?? 'high';
  const ctx: RenderContext = {
    renderer, scene, camera, pipeline, backend, adaptive,
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

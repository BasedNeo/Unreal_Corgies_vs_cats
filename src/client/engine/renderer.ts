// WebGPU renderer (auto-falls back to WebGL2) + the comic post pipeline + adaptive resolution.
import * as THREE from 'three/webgpu';
import { createComicPipeline, createStyleLights } from '../style/style-webgpu.js';
import { STYLE } from '../style/style-tokens.js';

export interface RenderContext {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  pipeline: ReturnType<typeof createComicPipeline>;
  backend: 'webgpu' | 'webgl';
  render(): void;
}

export async function createRenderContext(container: HTMLElement, opts: { forceWebGL?: boolean } = {}): Promise<RenderContext> {
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

  const onResize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    pipeline.setSize(innerWidth, innerHeight);
  };
  window.addEventListener('resize', onResize);
  return { renderer, scene, camera, pipeline, backend, render: () => pipeline.render() };
}

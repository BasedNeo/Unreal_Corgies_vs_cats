// Adaptive pixel ratio (from threejs-stylized-game-director's game-runtime): the biggest single lever
// for fill-rate-bound toon/outline/post pipelines.
import type * as THREE from 'three/webgpu';

export function createAdaptiveQuality(renderer: THREE.WebGPURenderer, {
  targetMs = 16.7, min = 0.6, max = Math.min(globalThis.devicePixelRatio ?? 1, 1.5), step = 0.1, sampleFrames = 30,
  onChange,
}: { targetMs?: number; min?: number; max?: number; step?: number; sampleFrames?: number; onChange?: (r: number, avg: number) => void } = {}) {
  let ratio = Math.min(max, renderer.getPixelRatio());
  let acc = 0, n = 0, cooldown = 0;
  return {
    get ratio() { return ratio; },
    update(frameMs: number) {
      acc += frameMs; n++;
      if (cooldown > 0) { cooldown--; return; }
      if (n < sampleFrames) return;
      const avg = acc / n; acc = 0; n = 0;
      let next = ratio;
      if (avg > targetMs * 1.15) next = Math.max(min, ratio - step);
      else if (avg < targetMs * 0.75) next = Math.min(max, ratio + step);
      if (Math.abs(next - ratio) > 1e-3) {
        ratio = +next.toFixed(2);
        renderer.setPixelRatio(ratio);
        cooldown = sampleFrames;
        onChange?.(ratio, avg);
      }
    },
  };
}

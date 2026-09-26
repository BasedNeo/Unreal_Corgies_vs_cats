// Adaptive pixel ratio (from threejs-stylized-game-director's game-runtime): the biggest single lever
// for fill-rate-bound toon/outline/post pipelines. Bounds come from the quality tier (setBounds, live).
export interface PixelRatioTarget { getPixelRatio(): number; setPixelRatio(r: number): void }

export interface AdaptiveQuality {
  readonly ratio: number;
  readonly min: number;
  readonly max: number;
  update(frameMs: number): void;
  /** New bounds (e.g. a quality-tier change): clamps and applies the current ratio immediately. */
  setBounds(min: number, max: number): void;
}

export function createAdaptiveQuality(renderer: PixelRatioTarget, {
  targetMs = 16.7, min = 0.6, max = Math.min(globalThis.devicePixelRatio ?? 1, 1.5), step = 0.1, sampleFrames = 30,
  onChange,
}: { targetMs?: number; min?: number; max?: number; step?: number; sampleFrames?: number; onChange?: (r: number, avg: number) => void } = {}): AdaptiveQuality {
  let lo = Math.min(min, max), hi = max;
  let ratio = Math.min(hi, Math.max(lo, renderer.getPixelRatio()));
  if (Math.abs(ratio - renderer.getPixelRatio()) > 1e-3) renderer.setPixelRatio(ratio);
  let acc = 0, n = 0, cooldown = 0;
  return {
    get ratio() { return ratio; },
    get min() { return lo; },
    get max() { return hi; },
    update(frameMs: number) {
      acc += frameMs; n++;
      if (cooldown > 0) { cooldown--; return; }
      if (n < sampleFrames) return;
      const avg = acc / n; acc = 0; n = 0;
      let next = ratio;
      if (avg > targetMs * 1.15) next = Math.max(lo, ratio - step);
      else if (avg < targetMs * 0.75) next = Math.min(hi, ratio + step);
      if (Math.abs(next - ratio) > 1e-3) {
        ratio = +next.toFixed(2);
        renderer.setPixelRatio(ratio);
        cooldown = sampleFrames;
        onChange?.(ratio, avg);
      }
    },
    setBounds(nextMin: number, nextMax: number) {
      hi = nextMax; lo = Math.min(nextMin, nextMax);
      const next = +Math.min(hi, Math.max(lo, ratio)).toFixed(2);
      acc = 0; n = 0; cooldown = sampleFrames;
      if (Math.abs(next - ratio) > 1e-3) { ratio = next; renderer.setPixelRatio(ratio); onChange?.(ratio, 0); }
    },
  };
}

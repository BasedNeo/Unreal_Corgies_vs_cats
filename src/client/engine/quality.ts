// Quality tiers as data (game-worlds-polish-perf): picked by setting or by a short benchmark.
export type QualityTier = 'low' | 'medium' | 'high';

export interface QualityProfile {
  maxPixelRatio: number;
  minPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  outlines: boolean;
  foliageDensity: number;
  drawDistance: number;
}

export const QUALITY: Record<QualityTier, QualityProfile> = {
  low: { maxPixelRatio: 0.85, minPixelRatio: 0.5, shadows: false, shadowMapSize: 512, bloom: false, outlines: true, foliageDensity: 0.35, drawDistance: 140 },
  medium: { maxPixelRatio: 1.15, minPixelRatio: 0.6, shadows: true, shadowMapSize: 1024, bloom: true, outlines: true, foliageDensity: 0.7, drawDistance: 220 },
  high: { maxPixelRatio: 1.5, minPixelRatio: 0.75, shadows: true, shadowMapSize: 2048, bloom: true, outlines: true, foliageDensity: 1, drawDistance: 320 },
};

/** Heuristic first guess before any benchmark: low on software renderers, medium on small screens. */
export function guessTier(backend: string, renderer: string): QualityTier {
  if (/swiftshader|llvmpipe|software/i.test(renderer)) return 'low';
  if (backend === 'webgl') return 'medium';
  return innerWidth * devicePixelRatio > 2600 ? 'medium' : 'high';
}

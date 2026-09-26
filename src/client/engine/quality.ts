// Quality tiers as data (game-worlds-polish-perf): picked by setting or by a short benchmark.
// Two kinds of knobs (perf lane P2):
//  - ENGINE knobs apply live through RenderContext.setQuality(): pixel-ratio bounds (adaptive resolution), the shadow
//    pass, bloom. Outlines (the ink hull) stay on in every tier: they are the look.
//  - WORLD knobs are read when the world view is built (src/client/world/world-view.ts). Shadow-map size, foliage
//    density, clouds, terrain detail shading and rain capacity need a reload; garden density and prop creases switch
//    live (WorldView.setQuality).
// Measured at 1280x720, same view (tools/perf-render.mjs): the shadow pass is ~17 % of draw calls and ~20 % of
// triangles on high, bloom 12 fullscreen draws, prop crease ink ~13 % of triangles; low drops all three.
export type QualityTier = 'low' | 'medium' | 'high';

export interface QualityProfile {
  // ---- engine (live) ----
  /** Adaptive-resolution bounds (device pixels per CSS pixel, also capped by devicePixelRatio). */
  maxPixelRatio: number;
  minPixelRatio: number;
  /** Sun shadow pass (renderer.shadowMap.enabled). */
  shadows: boolean;
  /** Bloom post pass (glow() materials still read bright without it). */
  bloom: boolean;
  /** Ink hull outlines — on in every tier (W7 P3: the renderer skips a hull only where it would be under 0.3 px). */
  outlines: boolean;
  // ---- world (at build; reload to change) ----
  shadowMapSize: number;
  /** Grass/flower/stone scatter density (0 = none). */
  foliageDensity: number;
  /** Tall-grass and flower density of the garden's concealment zones (visual only; concealment is sim data). */
  gardenDensity: number;
  /** Crease-ink lines inside world props (~13 % of a frame's triangles, 15 draws). The silhouette ink hull and the
   *  characters' creases stay in every tier. Live: the world view toggles them without a rebuild. */
  propCreases: boolean;
  clouds: boolean;
  terrainDetail: boolean;
  rainDrops: number;
}

export const QUALITY: Record<QualityTier, QualityProfile> = {
  low: {
    maxPixelRatio: 0.85, minPixelRatio: 0.5, shadows: false, bloom: false, outlines: true,
    shadowMapSize: 1024, foliageDensity: 0, gardenDensity: 0.45, propCreases: false, clouds: false, terrainDetail: false, rainDrops: 2000,
  },
  medium: {
    maxPixelRatio: 1.15, minPixelRatio: 0.6, shadows: true, bloom: true, outlines: true,
    shadowMapSize: 1536, foliageDensity: 0.6, gardenDensity: 0.75, propCreases: true, clouds: true, terrainDetail: true, rainDrops: 3500,
  },
  high: {
    maxPixelRatio: 1.5, minPixelRatio: 0.75, shadows: true, bloom: true, outlines: true,
    shadowMapSize: 2048, foliageDensity: 1, gardenDensity: 1, propCreases: true, clouds: true, terrainDetail: true, rainDrops: 6000,
  },
};

/** Normalizes the tier spellings in use: settings/URL say 'medium', the world view says 'med'. */
export function toQualityTier(q: string | null | undefined): QualityTier {
  return q === 'low' ? 'low' : q === 'medium' || q === 'med' ? 'medium' : 'high';
}

/** Heuristic first guess before any benchmark: low on software renderers, medium on small screens. */
export function guessTier(backend: string, renderer: string): QualityTier {
  if (/swiftshader|llvmpipe|software/i.test(renderer)) return 'low';
  if (backend === 'webgl') return 'medium';
  return innerWidth * devicePixelRatio > 2600 ? 'medium' : 'high';
}

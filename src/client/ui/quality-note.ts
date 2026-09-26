// OWNER: U1 (ux). What changing Settings › Quality does right now, said plainly in the settings panel.
//
// Measured against the code (2026-09-26):
//   live   fx.setQuality (particle density) and audio.setQuality (HRTF ↔ equal-power panning), via main.ts applySettings
//   reload the world view is built once at boot from the saved setting or ?quality= (src/client/world/world-view.ts:
//          foliage density, shadow-map size, clouds, terrain detail shading, rain capacity)
//   none   engine/quality.ts QUALITY profiles (pixel ratio, bloom, draw distance) are not applied anywhere yet;
//          adaptive-quality.ts scales the pixel ratio from frame time regardless of the setting
// So the panel shows "applies after reload" + a Reload button whenever the chosen tier differs from the tier the
// world was built with. When the perf lane makes world quality live, pass HudOptions.qualityLive = true.
import type { QualitySetting } from './settings';
import { QUALITY_STRINGS } from './strings';

/** The tier the world view was built with: the page's ?quality= (as main.ts reads it) or the saved setting. */
export function bootQuality(search: string, saved: QualitySetting): QualitySetting {
  const q = new URLSearchParams(search).get('quality');
  if (q === null) return saved;
  if (q === 'low') return 'low';
  return q === 'med' || q === 'medium' ? 'medium' : 'high'; // world-view treats anything else like high
}

/** The notice under the Quality row, or null when nothing is waiting for a reload. */
export function qualityNote(applied: QualitySetting, selected: QualitySetting, live: boolean, inSession: boolean): string | null {
  if (live || applied === selected) return null;
  return inSession ? `${QUALITY_STRINGS.reload} ${QUALITY_STRINGS.reloadInMatch}` : QUALITY_STRINGS.reload;
}

/** Reload target: the same page without ?quality= (it would override the saved choice again). */
export function reloadUrl(href: string): string {
  try {
    const u = new URL(href);
    u.searchParams.delete('quality');
    return u.toString();
  } catch { return href; }
}

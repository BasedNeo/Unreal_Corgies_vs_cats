// OWNER: L5 (juice). Display fonts for the comic HUD and the onomatopoeia atlas.
//
// Both are SIL Open Font License 1.1 fonts, self-hosted (latin subset, woff2 as served by Google Fonts):
//   - Lilita One — Juan Montoreano, 2011, Google Fonts v17 — chunky rounded display face for HUD/menus.
//   - Bangers    — Vernon Adams / The Bangers Project Authors, 2010, Google Fonts v25 — comic lettering for
//                  onomatopoeia billboards.
// License texts ship next to the files (fonts/OFL-*.txt). Self-hosted instead of a Google Fonts <link>
// because (1) offline play must look the same, (2) headless Chromium in CI cannot reach Google Fonts
// (ERR_CERT_AUTHORITY_INVALID behind the agent proxy) and the e2e smoke test fails on any console error,
// (3) no third-party request from the game page. Fallback stacks below keep the look chunky if loading fails.
import lilitaUrl from './fonts/lilita-one-latin.woff2?url';
import bangersUrl from './fonts/bangers-latin.woff2?url';

export const FONT_DISPLAY = `'Lilita One', 'Arial Rounded MT Bold', 'Helvetica Rounded', 'Trebuchet MS', 'DejaVu Sans', system-ui, sans-serif`;
export const FONT_COMIC = `'Bangers', 'Impact', 'Arial Black', 'DejaVu Sans Condensed', 'DejaVu Sans', sans-serif`;
export const FONT_BODY = `system-ui, -apple-system, 'Segoe UI', 'DejaVu Sans', sans-serif`;

let loading: Promise<boolean> | null = null;

/** Loads both faces once. Resolves true when both are usable (false = fallbacks in use). Never rejects. */
export function ensureFonts(): Promise<boolean> {
  if (loading) return loading;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return (loading = Promise.resolve(false));
  const faces = [
    new FontFace('Lilita One', `url(${lilitaUrl}) format('woff2')`, { display: 'swap' }),
    new FontFace('Bangers', `url(${bangersUrl}) format('woff2')`, { display: 'swap' }),
  ];
  loading = Promise.all(faces.map((f) => f.load().then((ff) => { document.fonts.add(ff); return true; }, () => false)))
    .then((ok) => ok.every(Boolean));
  return loading;
}

// The page builds its world view before it knows which world the authority runs (the view is ready behind the menu,
// and a server room may have been created by someone else with another ?map= / SEED). The welcome says which one it
// is; on a mismatch the page reloads straight into that world (Wave 8 M1, docs/design/EXPANSION_VISION.md).

/**
 * The page search to reload into when the authority runs another world than the page built, else null. Never loops:
 * a page that already asked for exactly that world (its URL carries the same map and seed) is not reloaded again.
 */
export function worldReloadSearch(search: string, built: { map: string; seed: number }, runs: { map: string; mapSeed: number }): string | null {
  if (!Number.isFinite(runs.mapSeed)) return null;
  if (built.map === runs.map && built.seed === runs.mapSeed) return null;
  const p = new URLSearchParams(search);
  if (p.get('map') === runs.map && p.get('seed') === String(runs.mapSeed)) return null;
  p.set('map', runs.map);
  p.set('seed', String(runs.mapSeed));
  return `?${p}`;
}

// OWNER: C3 cosmetics lane. Cosmetic coat ids (src/shared/content/cosmetics.ts) → the coat paint tables of the
// procedural characters (src/client/procgen/characters/species.ts). A coat repaints fur vertex colours only; the
// breed (body shape) stays the seeded one, so geometry, rig and silhouettes never change with a coat.
import { CAT_COATS, CORGI_COATS, CALICO_COAT, MERLE_COAT, type Coat } from '../characters/species';

const byName = (list: Coat[], name: string): Coat => {
  const c = list.find((x) => x.name === name);
  if (!c) throw new Error(`coat table has no ${name}`);
  return c;
};

/** Every cosmetic coat id with its paint. */
export const LOOK_COATS: Readonly<Record<string, Coat>> = {
  corgi_red: byName(CORGI_COATS, 'red'),
  corgi_tricolor: byName(CORGI_COATS, 'tri'),
  corgi_sable: byName(CORGI_COATS, 'sable'),
  corgi_merle: MERLE_COAT,
  cat_tabby: byName(CAT_COATS, 'tabby'),
  cat_tuxedo: byName(CAT_COATS, 'tuxedo'),
  cat_calico: CALICO_COAT,
  cat_siamese: byName(CAT_COATS, 'siamese'),
};

/** The paint of a cosmetic coat id (null for anything else). */
export function lookCoat(id: string | undefined | null): Coat | null {
  return id && Object.prototype.hasOwnProperty.call(LOOK_COATS, id) ? LOOK_COATS[id] : null;
}

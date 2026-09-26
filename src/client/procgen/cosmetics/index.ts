// OWNER: C3 cosmetics lane. Client side of looks: put a look (src/shared/content/cosmetics.ts) on a procedural
// corgi / cat of any class and team.
//   applyLook(avatar, look)        in place: coat repaint + neckwear swap, idempotent, releases what it replaces
//   createCharacter({ ..., look }) build straight into a look (no swap)
// Entity views (N2): pass the roster look at creation, or call applyLook when a roster update changes it.
import type { Avatar } from '../../views/avatar';
import type { Look } from '../../../shared/content/cosmetics';
import type { CharacterAvatar } from '../characters';

export { LOOK_COATS, lookCoat } from './coats';
export { NECKWEAR_IDS, NECK_TRI_BUDGET, isNeckwearId, neckwearCacheSize, hugLoop } from './neckwear';

type LookWearer = Avatar & Pick<CharacterAvatar, 'setLook'>;

/** Does this avatar take looks (procedural characters do; bosses and other avatars do not)? */
export function wearsLooks(avatar: Avatar): avatar is LookWearer {
  return typeof (avatar as Partial<LookWearer>).setLook === 'function';
}

/**
 * Put a look on an avatar in place: the coat repaints the fur (a cached body variant on the same skeleton), the
 * neckwear replaces the team collar (a cached skinned mesh on the same skeleton). Class gear, silhouette, rig, weapon
 * and animation state are untouched. Unknown / wrong-species ids fall back to the species default; null restores the
 * seeded classic look. Idempotent; whatever it replaces is released (renderer 'dispose' + cache refs). Avatars that
 * do not take looks (bosses) are left alone. Returns whether anything changed.
 */
export function applyLook(avatar: Avatar, look: Look | null | undefined): boolean {
  return wearsLooks(avatar) ? avatar.setLook(look) : false;
}

// Map registry (Wave 8, docs/design/EXPANSION_VISION.md): every playable battleground, keyed by a stable id that
// travels in URLs (?map=), room setups, the welcome message and GET /rooms. A map is a pure function of the seed.
// OWNER: lead (shared contract). A map lane adds its builder here at hand-back.
import type { WorldData } from './world-types';
import { buildWestYard } from './west-yard';
import { buildTheLot } from './the-lot';

export const MAP_IDS = ['west_yard', 'the_lot'] as const;
export type MapId = (typeof MAP_IDS)[number];
export const DEFAULT_MAP: MapId = 'west_yard';

export interface MapDef {
  id: MapId;
  /** Display name; also WorldData.name, which content tables (pickup layouts, objective chains) are keyed by. */
  title: string;
  /** Room modes this map can host. Adventure chapters and boss arenas are authored for the West Yard only. */
  modes: readonly string[];
  build(seed: number): WorldData;
}

const PVP = ['yard-skirmish', 'team-deathmatch', 'core-rush', 'base-assault'] as const;

export const MAPS: Record<MapId, MapDef> = {
  west_yard: { id: 'west_yard', title: 'West Yard', modes: [...PVP, 'boss-rush', 'adventure'], build: buildWestYard },
  the_lot: { id: 'the_lot', title: 'The Lot', modes: [...PVP], build: buildTheLot },
};

/**
 * W13: modes that belong to one map (their home): only it hosts them, and every request for them lands there.
 * 'slab' (the Godot game's mode) is played on The Lot's control slab. Every other mode falls back to DEFAULT_MAP.
 */
export const MODE_HOME: Readonly<Record<string, MapId>> = { slab: 'the_lot' };

/** The map a mode falls back to (the default map, unless the mode has its own home map). */
export function homeMapFor(mode: string): MapId {
  return Object.prototype.hasOwnProperty.call(MODE_HOME, mode) ? MODE_HOME[mode] : DEFAULT_MAP;
}

/** Can map `id` host `mode`? (Its mode list, or it is the mode's home.) */
export function mapHosts(id: MapId, mode: string): boolean {
  return MAPS[id].modes.includes(mode) || (Object.prototype.hasOwnProperty.call(MODE_HOME, mode) && MODE_HOME[mode] === id);
}

export const isMapId = (id: unknown): id is MapId => typeof id === 'string' && (MAP_IDS as readonly string[]).includes(id);

/** Untrusted input (URL, hello, welcome) → a known map id; anything else is the default map. */
export function sanitizeMap(id: unknown): MapId {
  return isMapId(id) ? id : DEFAULT_MAP;
}

/** Maps that can host `mode`, in registry order (the menu's MAP button cycles these; the mode's home map is always one:
 *  the default map, or The Lot for 'slab'). */
export function mapsForMode(mode: string): MapId[] {
  return MAP_IDS.filter((id) => mapHosts(id, mode));
}

/** The map a room in `mode` will really run for a requested id: unknown ids, and maps that can't host the mode, fall
 *  back to the mode's home map (the default map; The Lot for 'slab'), so a listing or a welcome never names a map the
 *  sim isn't playing. */
export function mapForMode(id: unknown, mode: string): MapId {
  const m = isMapId(id) ? id : homeMapFor(mode);
  return mapHosts(m, mode) ? m : homeMapFor(mode);
}

/** W10 C10: the map a room really runs. An adventure room plays its chapter's map (`ChapterDef.map`; absent or unknown →
 *  the default map) whatever the query asked; every other mode is `mapForMode`. */
export function mapForRoom(id: unknown, mode: string, chapterMap?: string): MapId {
  return mode === 'adventure' ? sanitizeMap(chapterMap) : mapForMode(id, mode);
}

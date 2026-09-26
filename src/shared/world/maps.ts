// Map registry (Wave 8, docs/design/EXPANSION_VISION.md): every playable battleground, keyed by a stable id that
// travels in URLs (?map=), room setups, the welcome message and GET /rooms. A map is a pure function of the seed.
// OWNER: lead (shared contract). A map lane adds its builder here at hand-back.
import type { WorldData } from './world-types';
import { buildWestYard } from './west-yard';

export const MAP_IDS = ['west_yard'] as const;
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

const PVP = ['yard-skirmish', 'team-deathmatch', 'core-rush'] as const;

export const MAPS: Record<MapId, MapDef> = {
  west_yard: { id: 'west_yard', title: 'West Yard', modes: [...PVP, 'boss-rush', 'adventure'], build: buildWestYard },
};

export const isMapId = (id: unknown): id is MapId => typeof id === 'string' && (MAP_IDS as readonly string[]).includes(id);

/** Untrusted input (URL, hello, welcome) → a known map id; anything else is the default map. */
export function sanitizeMap(id: unknown): MapId {
  return isMapId(id) ? id : DEFAULT_MAP;
}

/** Maps that can host `mode`, in registry order (the menu's MAP button cycles these; the default map is always one). */
export function mapsForMode(mode: string): MapId[] {
  return MAP_IDS.filter((id) => MAPS[id].modes.includes(mode));
}

/** The map a room in `mode` will really run for a requested id: unknown ids, and maps that can't host the mode, fall
 *  back to the default map (so a listing or a welcome never names a map the sim isn't playing). */
export function mapForMode(id: unknown, mode: string): MapId {
  const m = sanitizeMap(id);
  return MAPS[m].modes.includes(mode) ? m : DEFAULT_MAP;
}

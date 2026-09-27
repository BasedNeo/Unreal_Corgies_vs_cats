// W10 C10 contracts: every new field is optional and additive.
// - ChapterDef.map: an adventure room plays its chapter's map (absent or unknown → the West Yard), whatever the query
//   asked; every other mode keeps mapForMode's fallbacks.
// - The death event carries the killing weapon's wire index (wpn) when there is one, and it survives the wire.
// - WorldData.interiors is optional: both shipping maps build without it.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { kill } from '../../src/sim/combat';
import { Team, Species } from '../../src/shared/types';
import type { GameEvent, ServerMsg } from '../../src/shared/protocol';
import { CHAPTERS } from '../../src/shared/content/chapters';
import { DEFAULT_MAP, MAP_IDS, mapForMode, mapForRoom } from '../../src/shared/world/maps';
import { sanitizeRoomSetup } from '../../src/host/guard';
import { SnapEncoder, SnapDecoder, encodeServerMsg, decodeServerFrame } from '../../src/host/wire';
import { createWorldData } from '../../src/shared/world/world-data';

describe('W10 C10: a chapter names its map', () => {
  it('an adventure room plays the chapter map, never the query map; other modes keep mapForMode', () => {
    expect(mapForRoom('the_lot', 'adventure')).toBe(DEFAULT_MAP);               // no chapter map: the West Yard
    expect(mapForRoom(null, 'adventure', 'the_lot')).toBe('the_lot');
    expect(mapForRoom('west_yard', 'adventure', 'the_lot')).toBe('the_lot');    // the chapter wins over the query
    expect(mapForRoom(null, 'adventure', 'nowhere')).toBe(DEFAULT_MAP);         // unknown → default
    for (const mode of ['team-deathmatch', 'base-assault', 'boss-rush', 'yard-skirmish'])
      for (const id of [...MAP_IDS, 'junk', null]) expect(mapForRoom(id, mode, 'the_lot')).toBe(mapForMode(id, mode));
  });

  it('the shipping chapters keep the West Yard; a chapter map is always a registered map', () => {
    for (const ch of CHAPTERS) {
      if (ch.map !== undefined) expect(MAP_IDS as readonly string[]).toContain(ch.map);
      expect(sanitizeRoomSetup('adventure', ch.id, null, 'the_lot')!.map).toBe(ch.map ?? DEFAULT_MAP);
    }
    expect(sanitizeRoomSetup('base-assault', null, null, 'the_lot')!.map).toBe('the_lot');
  });
});

describe('W10 C10: the death event names the weapon', () => {
  it('a kill with a weapon carries wpn; one without does not; both survive the wire encoder', async () => {
    const sim = await Sim.create({ seed: 3 });
    const mk = (team: 0 | 1, x: number) => sim.spawnCharacter({ team, species: team ? Species.Cat : Species.Corgi, cls: 'assault', name: `p${x}`, x, y: sim.worldData.height(x, 0) + 0.02, z: 0, yaw: 0 });
    const a = mk(Team.Corgis, 0), b = mk(Team.Cats, 3), c = mk(Team.Cats, 6);
    kill(sim, b, { id: a.id, team: a.team, weapon: 2 });
    kill(sim, c, { id: c.id, team: c.team, weapon: -1 });
    const deaths = sim.drainEvents().filter((e): e is Extract<GameEvent, { e: 'death' }> => e.e === 'death');
    expect(deaths).toEqual([{ e: 'death', id: b.id, by: a.id, wpn: 2 }, { e: 'death', id: c.id, by: c.id }]);

    const enc = new SnapEncoder(), dec = new SnapDecoder();
    const snap = { t: 'snap', tick: 1, ack: 0, ents: [], ev: deaths } as unknown as ServerMsg;
    const back = decodeServerFrame(encodeServerMsg(snap, enc), dec) as Extract<ServerMsg, { t: 'snap' }>;
    expect(back.ev).toEqual(deaths);
  });
});

describe('W10 C10: WorldData.interiors is optional', () => {
  it('both shipping maps build without it', () => {
    expect(createWorldData(1).interiors).toBeUndefined();
    const lot = createWorldData(1, 'the_lot');
    expect(lot.interiors === undefined || Array.isArray(lot.interiors)).toBe(true);
  });
});

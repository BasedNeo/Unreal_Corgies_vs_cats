// Wave 8 M1 (docs/design/EXPANSION_VISION.md): the map registry and the map id's trip through the authority
// (Sim, Room welcome) and the client (reload into the authority's world). The West Yard stays the default everywhere.
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP, MAP_IDS, MAPS, isMapId, mapForMode, mapsForMode, sanitizeMap } from '../../src/shared/world/maps';
import { createWorldData } from '../../src/shared/world/world-data';
import { sanitizeRoomSetup, ROOM_MODES } from '../../src/host/guard';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import type { ServerMsg } from '../../src/shared/protocol';
import { worldReloadSearch } from '../../src/client/net/map-sync';

describe('map registry', () => {
  it('every id has a definition that builds a world tagged with that id; the default is the West Yard', () => {
    expect(DEFAULT_MAP).toBe('west_yard');
    for (const id of MAP_IDS) {
      expect(MAPS[id].id).toBe(id);
      const w = createWorldData(1, id);
      expect(w.map).toBe(id);
      expect(w.name).toBe(MAPS[id].title); // content tables (pickup layouts, objective chains) key on the name
    }
    expect(MAPS.west_yard.modes).toEqual(expect.arrayContaining([...ROOM_MODES]));
  });

  it('untrusted ids fall back to the default map; the default call is unchanged (same cached world)', () => {
    for (const bad of [undefined, null, '', 'WEST_YARD', 'the lot', '__proto__', 'constructor', 7, {}, 'x'.repeat(10_000)]) {
      expect(isMapId(bad)).toBe(false);
      expect(sanitizeMap(bad)).toBe(DEFAULT_MAP);
    }
    expect(createWorldData(1, 'nope')).toBe(createWorldData(1));
    expect(createWorldData(1, 'west_yard')).toBe(createWorldData(1));
    expect(createWorldData(1).name).toBe('West Yard');
  });

  it('a map that cannot host the mode is replaced by the default map', () => {
    expect(mapForMode('west_yard', 'adventure')).toBe('west_yard');
    expect(mapForMode('nope', 'team-deathmatch')).toBe('west_yard');
    for (const id of MAP_IDS) for (const mode of ROOM_MODES) {
      expect(mapForMode(id, mode)).toBe(MAPS[id].modes.includes(mode) ? id : DEFAULT_MAP);
    }
  });

  it('the maps a mode can be played on (the menu cycles these) always include the default map, in registry order', () => {
    for (const mode of ROOM_MODES) {
      const maps = mapsForMode(mode);
      expect(maps[0]).toBe(DEFAULT_MAP);
      expect(maps).toEqual(MAP_IDS.filter((id) => MAPS[id].modes.includes(mode)));
    }
    expect(mapsForMode('adventure')).toEqual(['west_yard']); // chapters are authored for the West Yard
    expect(mapsForMode('no-such-mode')).toEqual([]);
  });

  it('a room setup always names the map the room will run', () => {
    expect(sanitizeRoomSetup('team-deathmatch', null)).toMatchObject({ mode: 'team-deathmatch', map: 'west_yard' });
    expect(sanitizeRoomSetup('core-rush', null, null, 'west_yard')).toMatchObject({ map: 'west_yard' });
    expect(sanitizeRoomSetup('core-rush', null, null, '../../etc')).toMatchObject({ map: 'west_yard' });
    expect(sanitizeRoomSetup('adventure', 'yard_day', null, 'nope')).toMatchObject({ mode: 'adventure', chapter: 'yard_day', map: 'west_yard' });
    expect(sanitizeRoomSetup(null, null, null, 'west_yard')).toBeNull(); // no mode asked: the server's defaults
  });
});

describe('the authority announces its map', () => {
  it('Sim builds the requested map, and the welcome carries its id and seed', async () => {
    const sim = await Sim.create({ seed: 2, map: 'west_yard' });
    expect(sim.worldData).toBe(createWorldData(2, 'west_yard'));
    const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [0, 0] });
    const inbox: ServerMsg[] = [];
    room.join({ id: 'c1', send: (m) => inbox.push(m) }, { t: 'hello', v: PROTOCOL_VERSION, name: 'Ann', team: 0, cls: 'assault' });
    const w = inbox.find((m) => m.t === 'welcome');
    expect(w).toMatchObject({ t: 'welcome', map: 'west_yard', mapSeed: 2, mode: 'team-deathmatch' });
    room.dispose();
  });
});

describe('the page reloads into the world the authority runs', () => {
  it('no reload when the page built that world', () => {
    expect(worldReloadSearch('?server=ws%3A%2F%2Fh&room=a', { map: 'west_yard', seed: 1 }, { map: 'west_yard', mapSeed: 1 })).toBeNull();
  });

  it('another map or seed: the same page with that map and seed (every other param kept)', () => {
    const next = worldReloadSearch('?server=ws%3A%2F%2Fh&room=a&name=Rex', { map: 'west_yard', seed: 1 }, { map: 'the_lot', mapSeed: 7 });
    const p = new URLSearchParams(next!);
    expect([p.get('server'), p.get('room'), p.get('name'), p.get('map'), p.get('seed')]).toEqual(['ws://h', 'a', 'Rex', 'the_lot', '7']);
  });

  it('never loops: a page that already asked for that world, or a nonsense seed, stays put', () => {
    // e.g. a client that doesn't know the map: it sanitized ?map=the_lot to the West Yard, the room still runs the_lot
    expect(worldReloadSearch('?map=the_lot&seed=7', { map: 'west_yard', seed: 7 }, { map: 'the_lot', mapSeed: 7 })).toBeNull();
    expect(worldReloadSearch('', { map: 'west_yard', seed: 1 }, { map: 'west_yard', mapSeed: Number.NaN })).toBeNull();
  });
});

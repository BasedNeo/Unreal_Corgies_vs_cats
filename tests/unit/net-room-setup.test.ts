// Per-room setup: the first joiner's ?mode= / ?chapter= (validated) decide how a new room is created; later
// joiners get the room as it is. Needed for online co-op adventure and PvP modes on one server.
import { describe, expect, it, afterEach } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import { startGameServer, type GameServer } from '../../server/app';
import { loadConfig } from '../../server/config';
import { SnapDecoder, decodeServerFrame } from '../../src/host/wire';
import type { ServerMsg } from '../../src/shared/protocol';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import { sanitizeRoomSetup } from '../../src/host/guard';
import { resolveServerUrl } from '../../src/client/net/server-url';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room } from '../../src/host/room';
import { findBoss } from '../../src/sim/boss';
import { adventureState } from '../../src/sim/adventure';

const servers: GameServer[] = [];
const sockets: WsClient[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const s of servers.splice(0)) await s.close('test done');
});

async function welcome(url: string, name: string): Promise<Extract<ServerMsg, { t: 'welcome' }>> {
  const ws = new WsClient(url);
  sockets.push(ws);
  const dec = new SnapDecoder();
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`${name}: no welcome`)), 15_000); // a new room builds its world first
    ws.on('message', (d) => { const m = decodeServerFrame(String(d), dec); if (m?.t === 'welcome') { clearTimeout(timer); res(m); } });
    ws.on('error', rej);
    ws.once('open', () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name, team: -1, cls: 'assault' })));
  });
}

describe('room setup from the creator', () => {
  it('accepts known modes and simple chapter ids only', () => {
    expect(sanitizeRoomSetup('core-rush', null)).toEqual({ mode: 'core-rush', map: 'west_yard' });
    expect(sanitizeRoomSetup('adventure', 'yard_day')).toEqual({ mode: 'adventure', chapter: 'yard_day', map: 'west_yard' });
    expect(sanitizeRoomSetup('adventure', 'laser_dawn')).toEqual({ mode: 'adventure', chapter: 'laser_dawn', map: 'west_yard' });
    // an adventure room lists the chapter it really runs: unknown, hostile or missing ids → the first chapter (Q2 P2-3)
    expect(sanitizeRoomSetup('adventure', '../../etc')).toEqual({ mode: 'adventure', chapter: 'yard_day', map: 'west_yard' });
    expect(sanitizeRoomSetup('adventure', 'nonexistent')).toEqual({ mode: 'adventure', chapter: 'yard_day', map: 'west_yard' });
    expect(sanitizeRoomSetup('adventure', null)).toEqual({ mode: 'adventure', chapter: 'yard_day', map: 'west_yard' });
    expect(sanitizeRoomSetup('team-deathmatch', 'yard_day')).toEqual({ mode: 'team-deathmatch', map: 'west_yard' }); // chapter only for adventure
    expect(sanitizeRoomSetup('god-mode', null)).toBeNull();
    expect(sanitizeRoomSetup(null, 'yard_day')).toBeNull();
  });

  it('boss-rush rooms take a boss id (E1), only in boss-rush and only a plain id', () => {
    expect(sanitizeRoomSetup('boss-rush', null, 'madame_pointille')).toEqual({ mode: 'boss-rush', boss: 'madame_pointille', map: 'west_yard' });
    expect(sanitizeRoomSetup('boss-rush', null, '<b>')).toEqual({ mode: 'boss-rush', map: 'west_yard' });
    expect(sanitizeRoomSetup('boss-rush', null, 'mega_boss')).toEqual({ mode: 'boss-rush', map: 'west_yard' }); // well-formed but unknown
    expect(sanitizeRoomSetup('boss-rush', null, 'vac_tank')).toEqual({ mode: 'boss-rush', boss: 'vac_tank', map: 'west_yard' });
    expect(sanitizeRoomSetup('yard-skirmish', null, 'madame_pointille')).toEqual({ mode: 'yard-skirmish', map: 'west_yard' });
    const u = new URL(resolveServerUrl({ protocol: 'http:', host: 'lan:8787', search: '?online&room=duel&boss=madame_pointille' }, '/ws')!);
    expect(u.searchParams.get('mode')).toBe('boss-rush'); // ?boss= alone implies boss-rush, as offline
    expect(u.searchParams.get('boss')).toBe('madame_pointille');
  });

  it('a boss-rush Room with boss madame_pointille brings her in (not the Vac-Tank)', async () => {
    const sim = await Sim.create({ seed: 7 });
    const room = new Room(sim, { mode: 'boss-rush', boss: 'madame_pointille', botsPerTeam: [2, 0] });
    let found: SimEntity | null = null;
    for (let i = 0; i < 60 * 12 && !found; i++) { room.tick(); found = findBoss(sim, 'madame_pointille'); }
    expect(found).toBeTruthy();
    expect(findBoss(sim, 'vac_tank')).toBeNull();
    room.dispose();
  }, 60_000);

  it('the client forwards ?mode= / ?chapter= with the room', () => {
    const url = resolveServerUrl({ protocol: 'https:', host: 'play.example', search: '?room=Porch&mode=adventure&chapter=yard_day' }, '/ws')!;
    const u = new URL(url);
    expect(u.protocol).toBe('wss:');
    expect(u.searchParams.get('room')).toBe('Porch');
    expect(u.searchParams.get('mode')).toBe('adventure');
    expect(u.searchParams.get('chapter')).toBe('yard_day');
  });

  it('the first joiner sets a new room up; a later joiner with another mode gets the room as it is', async () => {
    const s = await startGameServer(loadConfig({}, { host: '127.0.0.1', port: 0, log: false }));
    servers.push(s);
    const a = await welcome(`${s.wsUrl}/?room=pads&mode=core-rush`, 'Ann');
    expect(a.mode).toBe('core-rush');
    const b = await welcome(`${s.wsUrl}/?room=pads&mode=team-deathmatch`, 'Bob');
    expect(b.mode).toBe('core-rush');
    const c = await welcome(`${s.wsUrl}/?room=plain`, 'Cy');
    expect(c.mode).toBe('yard-skirmish'); // the server's MODE when nothing was asked
  }, 60_000);

  it('an adventure room lists its chapter for the room browser', async () => {
    const s = await startGameServer(loadConfig({}, { host: '127.0.0.1', port: 0, log: false }));
    servers.push(s);
    await welcome(`${s.wsUrl}/?room=coop&mode=adventure&chapter=yard_day`, 'Ann');
    await welcome(`${s.wsUrl}/?room=pvp&mode=team-deathmatch&chapter=yard_day`, 'Bob');
    const list = s.rooms.list(10);
    expect(list.find((r) => r.name === 'coop')).toMatchObject({ mode: 'adventure', chapter: 'yard_day' });
    expect(list.find((r) => r.name === 'pvp')).not.toHaveProperty('chapter');
  }, 60_000);

  it('the listing names the chapter an adventure room is playing now, not the one it was created for (Q3 P2-1)', async () => {
    const s = await startGameServer(loadConfig({}, { host: '127.0.0.1', port: 0, log: false }));
    servers.push(s);
    await welcome(`${s.wsUrl}/?room=coop&mode=adventure&chapter=yard_day`, 'Ann');
    const mr = (s.rooms as unknown as { rooms: Map<string, { room: Room }> }).rooms.get('coop')!;
    for (let i = 0; i < 200 && !adventureState(mr.room.sim); i++) await new Promise((r) => setTimeout(r, 25)); // first tick
    adventureState(mr.room.sim)!.chapter = 'garage_job'; // what the room does by itself after a result online
    expect(s.rooms.list(10).find((r) => r.name === 'coop')).toMatchObject({ chapter: 'garage_job' });
  }, 60_000);

  it("the first joiner's ?map= sets the room's map (sanitized); the welcome and the listing name it", async () => {
    const s = await startGameServer(loadConfig({}, { host: '127.0.0.1', port: 0, log: false }));
    servers.push(s);
    const a = await welcome(`${s.wsUrl}/?room=m1&mode=team-deathmatch&map=west_yard`, 'Ann');
    const b = await welcome(`${s.wsUrl}/?room=m2&mode=core-rush&map=not_a_map`, 'Bob');
    expect([a.map, b.map]).toEqual(['west_yard', 'west_yard']);
    const list = s.rooms.list(10);
    expect(list.find((r) => r.name === 'm1')).toMatchObject({ map: 'west_yard' });
    expect(list.find((r) => r.name === 'm2')).toMatchObject({ map: 'west_yard' });
  }, 60_000);
});

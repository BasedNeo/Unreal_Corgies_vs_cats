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
    expect(sanitizeRoomSetup('core-rush', null)).toEqual({ mode: 'core-rush' });
    expect(sanitizeRoomSetup('adventure', 'yard_day')).toEqual({ mode: 'adventure', chapter: 'yard_day' });
    expect(sanitizeRoomSetup('adventure', '../../etc')).toEqual({ mode: 'adventure' });
    expect(sanitizeRoomSetup('team-deathmatch', 'yard_day')).toEqual({ mode: 'team-deathmatch' }); // chapter only for adventure
    expect(sanitizeRoomSetup('god-mode', null)).toBeNull();
    expect(sanitizeRoomSetup(null, 'yard_day')).toBeNull();
  });

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
});

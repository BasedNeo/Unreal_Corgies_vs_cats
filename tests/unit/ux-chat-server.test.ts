// U1: what the chat feed relies on from the Node authority — presence notices to the rest of the room, the chat echo
// to the sender (so pending lines resolve), and the server's own rate limit (why the client waits between sends).
import { describe, expect, it, afterEach } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import { startGameServer, type GameServer } from '../../server/app';
import { loadConfig } from '../../server/config';
import { SnapDecoder, decodeServerFrame } from '../../src/host/wire';
import type { ServerMsg } from '../../src/shared/protocol';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import { isPresenceNotice, cleanChatText } from '../../src/client/ui/chat-model';

const servers: GameServer[] = [];
const sockets: WsClient[] = [];
afterEach(async () => {
  for (const w of sockets.splice(0)) w.close();
  for (const s of servers.splice(0)) await s.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(10); }
}

async function client(url: string, name: string) {
  const ws = new WsClient(url);
  sockets.push(ws);
  const dec = new SnapDecoder();
  const msgs: ServerMsg[] = [];
  ws.on('message', (d) => { const m = decodeServerFrame(String(d), dec); if (m) msgs.push(m); });
  ws.on('error', () => {});
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name, team: -1, cls: 'assault' }));
  // a new room builds its world before the welcome: seconds on a loaded box (same as net-server.test.ts)
  await until(() => msgs.some((m) => m.t === 'welcome'), 15000, `${name} welcome`);
  const notices = () => msgs.filter((m): m is Extract<ServerMsg, { t: 'notice' }> => m.t === 'notice').map((m) => m.text);
  const chats = () => msgs.filter((m): m is Extract<ServerMsg, { t: 'chat' }> => m.t === 'chat').map((m) => `${m.from}: ${m.text}`);
  return { ws, msgs, notices, chats, say: (text: string) => ws.send(JSON.stringify({ t: 'chat', text })) };
}

describe('chat + presence over the Node server', () => {
  it('announces joins and leaves to the rest of the room only, as presence notices', async () => {
    const s = await startGameServer(loadConfig({}, { host: '127.0.0.1', port: 0, bots: [0, 0], log: false }));
    servers.push(s);
    const a = await client(`${s.wsUrl}/?room=porch`, 'Ann');
    const b = await client(`${s.wsUrl}/?room=porch`, 'Bob');
    const other = await client(`${s.wsUrl}/?room=elsewhere`, 'Cy');
    await until(() => a.notices().includes('Bob joined the yard'), 5000, 'join notice');
    expect(b.notices()).not.toContain('Bob joined the yard'); // not to the joiner
    expect(other.notices()).toEqual([]); // other rooms hear nothing
    b.ws.close();
    await until(() => a.notices().includes('Bob left the yard'), 5000, 'leave notice');
    expect(a.notices().every(isPresenceNotice)).toBe(true);
  });

  it('echoes chat to the sender (resolving pending lines) and drops a second line inside 0.5 s', async () => {
    const s = await startGameServer(loadConfig({}, { host: '127.0.0.1', port: 0, bots: [0, 0], log: false }));
    servers.push(s);
    const a = await client(s.wsUrl, 'Ann');
    const b = await client(s.wsUrl, 'Bob');
    const raw = '  hi\u0007   <b>pup</b>  ';
    a.say(raw);
    a.say('too soon');
    await until(() => b.chats().length >= 1 && a.chats().length >= 1, 5000, 'chat');
    await sleep(300);
    expect(a.chats()).toEqual([`Ann: ${cleanChatText(raw)}`]); // exactly what the client-side cleaner predicts
    expect(b.chats()).toEqual(a.chats());
    expect(b.msgs.find((m) => m.t === 'chat')).toMatchObject({ from: 'Ann', team: 0 }); // names aren't unique: the team rides along
    await sleep(600);
    a.say('later');
    await until(() => b.chats().length === 2, 5000, 'second chat');
    expect(b.chats()[1]).toBe('Ann: later');
  });
});

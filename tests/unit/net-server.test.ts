// Node server end to end over real sockets: lifecycle (join, move, leave, late join, rejoin, rooms,
// cleanup), hardening (abuse kick, oversize, flood, binary, hello/idle timeouts, shutdown) and the
// production static server (MIME, gzip, ETag, traversal, meta injection, /ws only).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Socket } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { WebSocket as WsClient } from 'ws';
import { startGameServer, type GameServer } from '../../server/app';
import { loadConfig, type ServerConfig } from '../../server/config';
import { createWebSocketTransport } from '../../src/client/net/transport';
import { NetClient } from '../../src/client/net/net-client';
import { SnapDecoder, decodeServerFrame } from '../../src/host/wire';
import type { ServerMsg } from '../../src/shared/protocol';
import { PROTOCOL_VERSION } from '../../src/shared/constants';

const servers: GameServer[] = [];
const nets: NetClient[] = [];
afterEach(async () => {
  for (const n of nets.splice(0)) { n.dispose(); n.transport.close(); }
  for (const s of servers.splice(0)) await s.close();
});

async function start(over: Partial<ServerConfig> = {}): Promise<GameServer> {
  const cfg = loadConfig({}, { host: '127.0.0.1', port: 0, bots: [0, 0], log: false, roomTtlMs: 100, ...over });
  const s = await startGameServer(cfg);
  servers.push(s);
  return s;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(10); }
}

/** A real client stack (transport + NetClient) that holds W while `moving`. */
async function player(url: string, name: string) {
  const net = new NetClient(await createWebSocketTransport(url, null), { predict: false, pingIntervalMs: 200 });
  nets.push(net);
  net.join(name, 'assault', -1);
  let seq = 0;
  const state = { moving: false };
  const timer = setInterval(() => {
    if (!net.connected) return;
    net.pushInput({ seq: ++seq, mx: 0, mz: state.moving ? 1 : 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 });
    net.flush();
  }, 1000 / 60);
  const origDispose = net.dispose.bind(net);
  net.dispose = () => { clearInterval(timer); origDispose(); };
  await until(() => net.connected && net.latest() !== null, 3000, `${name} welcome`);
  return { net, state };
}

/** Raw socket client that decodes frames (for abuse tests). */
async function raw(url: string, opts: { autoPong?: boolean } = {}) {
  const ws = new WsClient(url, { autoPong: opts.autoPong ?? true });
  const dec = new SnapDecoder();
  const msgs: ServerMsg[] = [];
  const closed: { code: number; reason: string } = { code: 0, reason: '' };
  ws.on('message', (d) => { const m = decodeServerFrame(String(d), dec); if (m) msgs.push(m); });
  ws.on('close', (code, reason) => { closed.code = code; closed.reason = String(reason); });
  ws.on('error', () => {});
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  return { ws, msgs, closed, hello: () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'raw', team: 0, cls: 'assault' })) };
}

describe('server lifecycle over WebSockets', () => {
  it('two players see each other move; leaving removes the entity', async () => {
    const s = await start();
    const a = await player(s.wsUrl, 'A');
    const b = await player(s.wsUrl, 'B');
    await until(() => b.net.latestState(a.net.localEntity) !== null, 2000, 'B sees A');
    const start0 = { ...b.net.latestState(a.net.localEntity)! };
    a.state.moving = true;
    await until(() => { const p = b.net.latestState(a.net.localEntity); return !!p && Math.hypot(p.x - start0.x, p.z - start0.z) > 2; }, 3000, 'B sees A move');
    const aEnt = a.net.localEntity;
    a.net.transport.close();
    await until(() => b.net.latestState(aEnt) === null, 2000, 'A gone for B');
    expect(s.rooms.get('default')!.room.humanCount).toBe(1);
  });

  it('a late joiner sees existing entities; a reconnect is a fresh join', async () => {
    const s = await start();
    const a = await player(s.wsUrl, 'A');
    a.state.moving = true;
    await sleep(300);
    const late = await player(s.wsUrl, 'Late');
    expect(late.net.latestState(a.net.localEntity)).not.toBeNull();
    const oldEnt = a.net.localEntity, oldPid = a.net.pid;
    a.net.transport.close();
    await until(() => !a.net.connected, 2000, 'A disconnected');
    await a.net.reconnect();
    await until(() => a.net.connected && a.net.localEntity !== oldEnt, 3000, 'A rejoined');
    expect(a.net.pid).not.toBe(oldPid);
    await until(() => late.net.latestState(a.net.localEntity) !== null && late.net.latestState(oldEnt) === null, 2000, 'late sees new A only');
  });

  it('rooms are isolated, created on demand and destroyed when empty', async () => {
    const s = await start({ roomTtlMs: 50 });
    const a = await player(`${s.wsUrl}/?room=alpha`, 'A');
    const b = await player(`${s.wsUrl}/?room=bravo`, 'B');
    expect(s.rooms.size).toBe(2);
    await sleep(200);
    // Entity ids are per room (both rooms start at 1): each client sees exactly its own entity.
    expect([...a.net.latest()!.ents.keys()]).toEqual([a.net.localEntity]);
    expect([...b.net.latest()!.ents.keys()]).toEqual([b.net.localEntity]);
    expect(a.net.roster.map((r) => r.name)).toEqual(['A']);
    const alpha = s.rooms.get('alpha')!;
    a.net.transport.close();
    b.net.transport.close();
    await until(() => s.rooms.size === 0, 3000, 'rooms destroyed');
    expect(alpha.destroyed).toBe(true);
  });

  it('refuses joins beyond the room limit', async () => {
    const s = await start({ maxRooms: 1 });
    await player(`${s.wsUrl}/?room=one`, 'A');
    const c = await raw(`${s.wsUrl}/?room=two`);
    c.hello();
    await until(() => c.closed.code !== 0, 2000, 'refused');
    expect(c.closed.code).toBe(1013);
    expect(c.msgs.some((m) => m.t === 'reject')).toBe(true);
  });
});

describe('server hardening', () => {
  it('kicks a client that keeps sending garbage (1008)', async () => {
    const s = await start();
    const c = await raw(s.wsUrl);
    c.hello();
    await until(() => c.msgs.some((m) => m.t === 'welcome'), 2000, 'welcome');
    for (let i = 0; i < 40; i++) c.ws.send('{"t":"input","cmds":[{"seq":"x"}]}');
    await until(() => c.closed.code !== 0, 2000, 'kick');
    expect(c.closed.code).toBe(1008);
    expect(c.msgs.some((m) => m.t === 'reject')).toBe(true);
  });

  it('closes oversize frames (1009) and kicks message floods and binary spam', async () => {
    const s = await start({ maxPayload: 4096 });
    const big = await raw(s.wsUrl);
    big.ws.send('x'.repeat(10_000));
    await until(() => big.closed.code !== 0, 2000, 'oversize close');
    expect(big.closed.code).toBe(1009);
    const flood = await raw(s.wsUrl);
    flood.hello();
    await until(() => flood.msgs.some((m) => m.t === 'welcome'), 2000, 'welcome');
    for (let i = 0; i < 1500; i++) flood.ws.send('{"t":"ping","id":1,"ct":1}');
    await until(() => flood.closed.code !== 0, 3000, 'flood kick');
    expect(flood.closed.code).toBe(1008);
    const bin = await raw(s.wsUrl);
    for (let i = 0; i < 30; i++) bin.ws.send(Buffer.from([1, 2, 3]));
    await until(() => bin.closed.code !== 0, 2000, 'binary kick');
    expect(bin.closed.code).toBe(1008);
    expect(s.stats().connections).toBe(0);
  });

  it('closes silent connections: no hello (4001) and idle (4000)', async () => {
    const s = await start({ helloTimeoutMs: 300, idleTimeoutMs: 1000, heartbeatMs: 100 });
    const silent = await raw(s.wsUrl);
    await until(() => silent.closed.code !== 0, 2000, 'hello timeout');
    expect(silent.closed.code).toBe(4001);
    const idle = await raw(s.wsUrl);
    idle.hello();
    await until(() => idle.closed.code !== 0, 3000, 'idle timeout');
    expect(idle.closed.code).toBe(4000);
  });

  it('terminates dead peers (no message, no pong) but not live-but-quiet ones', async () => {
    const s = await start({ heartbeatMs: 100, peerTimeoutMs: 500, idleTimeoutMs: 5000 });
    const dead = await raw(s.wsUrl, { autoPong: false });
    dead.hello();
    const quiet = await raw(s.wsUrl);
    quiet.hello();
    await until(() => dead.closed.code !== 0, 3000, 'dead peer terminated');
    expect(dead.closed.code).toBe(1006); // terminated, no close handshake
    await sleep(700);
    expect(quiet.closed.code).toBe(0); // answers pings: alive until the idle timeout
  });

  it('shuts down gracefully (notice + 1001)', async () => {
    const s = await start();
    const c = await raw(s.wsUrl);
    c.hello();
    await until(() => c.msgs.some((m) => m.t === 'welcome'), 2000, 'welcome');
    await s.close('maintenance');
    servers.length = 0;
    await until(() => c.closed.code !== 0, 2000, 'shutdown close');
    expect(c.closed.code).toBe(1001);
    expect(c.msgs.some((m) => m.t === 'notice' && m.text === 'maintenance')).toBe(true);
  });
});

function get(url: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Raw request line (no client-side path normalization). */
function rawGet(port: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = new Socket();
    let data = '';
    sock.connect(port, '127.0.0.1', () => sock.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
    sock.on('data', (d: Buffer) => { data += d.toString(); });
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
  });
}

describe('production server (static dist + /ws on one port)', () => {
  it('serves the build safely and upgrades only /ws', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'cvc-prod-'));
    const dist = path.join(base, 'dist');
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>t</title></head><body></body></html>');
    writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log("hello");\n'.repeat(400));
    writeFileSync(path.join(dist, 'assets', 'logic.wasm'), Buffer.alloc(64));
    writeFileSync(path.join(dist, '.env'), 'SECRET=1');
    writeFileSync(path.join(base, 'secret.txt'), 'top secret');
    const s = await start({ staticDir: dist, wsPath: '/ws' });
    const u = s.httpUrl;

    const index = await get(`${u}/?online&room=abc`);
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toMatch(/text\/html/);
    expect(index.body.toString()).toContain('<meta name="cvc-ws" content="/ws">');
    expect(index.headers['cache-control']).toBe('no-cache');

    const js = await get(`${u}/assets/app-abc123.js`, { 'Accept-Encoding': 'gzip, br' });
    expect(js.headers['content-type']).toMatch(/text\/javascript/);
    expect(js.headers['content-encoding']).toBe('gzip');
    expect(js.headers['cache-control']).toContain('immutable');
    expect(gunzipSync(js.body).toString()).toContain('console.log');
    const again = await get(`${u}/assets/app-abc123.js`, { 'If-None-Match': String(js.headers.etag) });
    expect(again.status).toBe(304);
    expect((await get(`${u}/assets/logic.wasm`)).headers['content-type']).toBe('application/wasm');
    expect((await get(`${u}/assets/app-abc123.js`, {}, 'HEAD')).body.length).toBe(0);
    expect((await get(`${u}/assets/app-abc123.js`, {}, 'POST')).status).toBe(405);
    expect((await get(`${u}/some/client/route`)).body.toString()).toContain('cvc-ws'); // SPA fallback
    expect((await get(`${u}/missing.js`)).status).toBe(404);

    for (const target of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/.env', '/%2eenv', '/assets%5c..%5c..%5csecret.txt', '/%00index.html', '/%E0%A4%A']) {
      const res = await rawGet(s.port, target);
      expect(res, target).not.toContain('top secret');
      expect(res, target).not.toContain('SECRET=1');
      expect(res.split(' ')[1], target).toMatch(/^(400|404)$/);
    }

    const health = JSON.parse((await get(`${u}/health`)).body.toString());
    expect(health.ok).toBe(true);

    const bad = new WsClient(`ws://127.0.0.1:${s.port}/other`);
    const badResult = await new Promise<string>((res) => { bad.on('unexpected-response', (_r, resp) => res(String(resp.statusCode))); bad.on('open', () => res('open')); bad.on('error', () => res('error')); });
    expect(badResult).toBe('404');
    const p = await player(`ws://127.0.0.1:${s.port}/ws?room=prod`, 'P');
    expect(p.net.connected).toBe(true);
    expect(s.rooms.get('prod')).toBeTruthy();
  });
});

// The online authority: one HTTP server that answers /health, /stats and /rooms, optionally serves the
// production build (staticDir), and upgrades WebSockets (on wsPath, or any path) into rooms.
//
// GET /rooms (U1 room browser): `[{ name, mode, players, humans, bots, maxPlayers, phase, chapter? }]` for live public rooms,
// busiest first, capped at roomsListMax rows. Room names only: no addresses, connection ids or player names;
// unlisted rooms (`_name`) never appear. CORS-readable (the dev client runs on another port). /rooms and /stats
// share a per-IP token bucket (httpRate/httpBurst → 429 + Retry-After); /health is exempt.
// Presence: joins and leaves are announced to the rest of the room as `notice` lines ("Rex joined the yard").
//
// Per connection: strict frame validation (src/host/guard.ts), message + byte token buckets, an
// abuse score that kicks with close code 1008, hello and idle timeouts, ws-level heartbeat (also
// used to measure RTT for the roster), backpressure (snapshots are skipped for slow consumers,
// persistent congestion closes with 1013) and per-connection delta snapshot encoding.
// Close codes: 1001 shutdown · 1008 policy/abuse · 1009 frame too large (ws) · 1011 room crashed ·
//              1013 full/busy/too slow · 4000 idle timeout · 4001 hello timeout. Dead peers (no message
//              and no pong for peerTimeoutMs) are terminated without a close frame.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { parseClientFrame, sanitizeRoomName, sanitizeRoomSetup, TokenBucket, AbuseMeter } from '../src/host/guard';
import type { RoomSetup } from './rooms';
import { SnapEncoder, encodeServerMsg, type WireEncoding } from '../src/host/wire';
import type { Conn } from '../src/host/room';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';
import { RoomManager, isUnlistedRoom, type ManagedRoom } from './rooms';
import { createStaticHandler } from './static';
import type { ServerConfig } from './config';

export interface ConnStats {
  id: string;
  room: string;
  ip: string;
  joined: boolean;
  rttMs: number;
  bytesIn: number;
  bytesOut: number;
  snapsSkipped: number;
  abuse: number;
}

interface Client {
  id: string;
  ws: WebSocket;
  ip: string;
  roomName: string;
  /** Requested setup if this client ends up creating its room (?mode=, ?chapter=). */
  roomSetup: RoomSetup | null;
  room: ManagedRoom | null;
  joined: boolean;
  joining: boolean;
  connectedAt: number;
  lastMsgAt: number;
  /** Last message or pong (peer liveness). */
  lastSeenAt: number;
  pingSentAt: number;
  rttMs: number;
  msgs: TokenBucket;
  bytes: TokenBucket;
  abuse: AbuseMeter;
  encoder: SnapEncoder | null;
  bytesIn: number;
  bytesOut: number;
  snapsSkipped: number;
  congestedSince: number;
  closing: boolean;
  closed: boolean;
}

export interface GameServer {
  readonly port: number;
  readonly config: ServerConfig;
  readonly rooms: RoomManager;
  /** Base URLs: http://host:port and ws://host:port<wsPath>. */
  readonly httpUrl: string;
  readonly wsUrl: string;
  /** Server stats. In-process callers see every room name; public HTTP callers get unlisted names redacted. */
  stats(resetMax?: boolean, redactUnlisted?: boolean): Record<string, unknown>;
  connections(): ConnStats[];
  /** Graceful shutdown: notify + close every socket (1001), stop rooms, close the HTTP server. */
  close(reason?: string): Promise<void>;
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function rawLength(data: RawData): number {
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) return data.reduce((n, b) => n + b.length, 0);
  return data.byteLength;
}

export async function startGameServer(cfg: ServerConfig): Promise<GameServer> {
  const log = (msg: string) => { if (cfg.log) console.log(msg); };
  const rooms = new RoomManager(cfg, log);
  const clients = new Map<string, Client>();
  const perIp = new Map<string, number>();
  const startedAt = Date.now();
  let nextId = 1;
  let shuttingDown = false;

  const serveStatic = cfg.staticDir
    ? createStaticHandler(cfg.staticDir, {
      transformHtml: (html) => html.includes('name="cvc-ws"') ? html : html.replace(/<\/head>/i, `  <meta name="cvc-ws" content="${cfg.wsPath ?? '/'}">\n</head>`),
    })
    : null;

  const stats = (resetMax = false, redactUnlisted = false) => ({
    ok: !shuttingDown,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    connections: clients.size,
    players: [...clients.values()].filter((c) => c.joined).length,
    rooms: rooms.stats(resetMax).map((r) => (redactUnlisted && isUnlistedRoom(r.name) ? { ...r, name: '(unlisted)' } : r)),
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
  });

  const clientIp = (req: http.IncomingMessage): string => {
    if (cfg.trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  /** Operator access: `&token=<statsToken>`, or a direct local peer (not a same-host reverse proxy, which sets XFF). */
  const privileged = (req: http.IncomingMessage, query: string): boolean => {
    const token = new URLSearchParams(query).get('token');
    if (cfg.statsToken && token === cfg.statsToken) return true;
    return LOOPBACK.has(req.socket.remoteAddress ?? '') && req.headers['x-forwarded-for'] === undefined;
  };

  // Per-IP token buckets for the public JSON endpoints. Idle entries are swept when the table grows large.
  const HTTP_BUCKETS_MAX = 4096;
  const httpBuckets = new Map<string, { bucket: TokenBucket; at: number }>();
  const httpAllowed = (req: http.IncomingMessage): boolean => {
    const ip = clientIp(req);
    const now = performance.now();
    let e = httpBuckets.get(ip);
    if (!e) {
      if (httpBuckets.size >= HTTP_BUCKETS_MAX) {
        for (const [k, v] of httpBuckets) if (now - v.at > 60_000) httpBuckets.delete(k);
        if (httpBuckets.size >= HTTP_BUCKETS_MAX) httpBuckets.clear();
      }
      e = { bucket: new TokenBucket(cfg.httpBurst, cfg.httpRate, now), at: now };
      httpBuckets.set(ip, e);
    }
    e.at = now;
    return e.bucket.take(now);
  };
  /** /rooms is read cross-origin by the dev client: public data, so any origin unless ALLOWED_ORIGINS is set. */
  const corsHeaders = (req: http.IncomingMessage): Record<string, string> => {
    if (!cfg.allowedOrigins) return { 'Access-Control-Allow-Origin': '*' };
    const origin = req.headers.origin;
    return origin && cfg.allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
  };
  const sendJson = (res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(JSON.stringify(body));
  };
  const tooMany = (res: http.ServerResponse, extra: Record<string, string> = {}) =>
    sendJson(res, 429, { error: 'too many requests' }, { 'Retry-After': String(Math.max(1, Math.ceil(1 / cfg.httpRate))), ...extra });

  const httpServer = http.createServer((req, res) => {
    const [url, query = ''] = (req.url ?? '/').split('?');
    if (url === '/health') {
      sendJson(res, shuttingDown ? 503 : 200, { ok: !shuttingDown, rooms: rooms.size, connections: clients.size });
      return;
    }
    if (url === '/stats') {
      if (!httpAllowed(req)) { tooMany(res); return; }
      // /stats?reset=1 starts a new tick-max/overrun window (soak tools skip warm-up that way) — local or token only.
      const op = privileged(req, query);
      sendJson(res, shuttingDown ? 503 : 200, stats(/(^|&)reset=1(&|$)/.test(query) && op, !op));
      return;
    }
    if (url === '/rooms') {
      const cors = corsHeaders(req);
      if (!cfg.listRooms) { sendJson(res, 404, { error: 'room list disabled' }, cors); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'GET, HEAD', ...cors }); return; }
      if (!httpAllowed(req)) { tooMany(res, cors); return; }
      sendJson(res, shuttingDown ? 503 : 200, shuttingDown ? [] : rooms.list(cfg.roomsListMax), cors);
      return;
    }
    if (serveStatic) {
      serveStatic(req, res).catch((err) => {
        log(`[cvc] static error: ${err}`);
        if (!res.headersSent) { res.writeHead(500); res.end('internal error'); } else res.destroy();
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Corgis vs Cats authority. Connect with a WebSocket client.\n');
  });
  httpServer.on('clientError', (_err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); else socket.destroy(); });

  const wss = new WebSocketServer({ noServer: true, maxPayload: cfg.maxPayload, perMessageDeflate: false, clientTracking: false });

  const refuseUpgrade = (socket: Duplex, code: number, text: string) => {
    socket.on('error', () => {});
    if (socket.writable) socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    else socket.destroy();
  };

  httpServer.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (shuttingDown) return refuseUpgrade(socket, 503, 'Service Unavailable');
    if (cfg.wsPath && url.pathname !== cfg.wsPath) return refuseUpgrade(socket, 404, 'Not Found');
    const origin = req.headers.origin;
    if (cfg.allowedOrigins && origin && !cfg.allowedOrigins.includes(origin)) return refuseUpgrade(socket, 403, 'Forbidden');
    if (clients.size >= cfg.maxConnections) return refuseUpgrade(socket, 503, 'Service Unavailable');
    const ip = clientIp(req);
    if ((perIp.get(ip) ?? 0) >= cfg.maxConnectionsPerIp) return refuseUpgrade(socket, 429, 'Too Many Requests');
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ip, url));
  });

  /** Presence line for everyone else in the room (clients show `notice` in the chat feed). */
  function announce(mr: ManagedRoom, text: string, exceptPid: string): void {
    if (mr.destroyed) return;
    for (const p of mr.room.players.values()) if (p.conn && p.pid !== exceptPid) p.conn.send({ t: 'notice', text });
  }

  function kick(c: Client, code: number, reason: string, notify = true): void {
    if (c.closed || c.closing) return;
    c.closing = true;
    if (notify && c.ws.readyState === WebSocket.OPEN) {
      try { c.ws.send(JSON.stringify({ t: 'reject', reason } satisfies ServerMsg)); } catch { /* socket already failing */ }
    }
    log(`[cvc] ${c.id} closed: ${reason} (${code})`);
    try { c.ws.close(code, reason.slice(0, 120)); } catch { c.ws.terminate(); }
  }

  function onConnection(ws: WebSocket, ip: string, url: URL): void {
    const now = performance.now();
    const id = `c${nextId++}`;
    const encoding: WireEncoding = url.searchParams.get('enc') === 'raw' ? 'raw' : url.searchParams.get('enc') === 'delta' ? 'delta' : cfg.encoding;
    const c: Client = {
      id, ws, ip, roomName: sanitizeRoomName(url.searchParams.get('room')), roomSetup: sanitizeRoomSetup(url.searchParams.get('mode'), url.searchParams.get('chapter')),
      room: null, joined: false, joining: false,
      connectedAt: now, lastMsgAt: now, lastSeenAt: now, pingSentAt: 0, rttMs: 0,
      msgs: new TokenBucket(cfg.msgBurst, cfg.msgRate, now), bytes: new TokenBucket(cfg.byteBurst, cfg.byteRate, now),
      abuse: new AbuseMeter(cfg.kickScore, 10_000, now), encoder: encoding === 'delta' ? new SnapEncoder() : null,
      bytesIn: 0, bytesOut: 0, snapsSkipped: 0, congestedSince: 0, closing: false, closed: false,
    };
    clients.set(id, c);
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);

    const conn: Conn = {
      id,
      send: (m: ServerMsg) => {
        if (c.closed || ws.readyState !== WebSocket.OPEN) return;
        if (m.t === 'snap' && ws.bufferedAmount > cfg.maxBufferedBytes) {
          // Slow consumer: skip whole snapshots (the delta baseline stays consistent because the
          // encoder only sees what is actually written) and give up if it never drains.
          c.snapsSkipped++;
          const t = performance.now();
          if (!c.congestedSince) c.congestedSince = t;
          else if (t - c.congestedSince > cfg.congestionKickMs) kick(c, 1013, 'connection too slow', false);
          return;
        }
        c.congestedSince = 0;
        const text = encodeServerMsg(m, c.encoder);
        c.bytesOut += text.length;
        ws.send(text);
      },
      close: () => kick(c, 1000, 'closed by server', false),
    };

    const strike = (weight: number, reason: string) => {
      if (c.abuse.total < 3) log(`[cvc] ${id} refused frame: ${reason}`); // first few only: no log spam under attack
      if (c.abuse.strike(performance.now(), weight)) kick(c, 1008, `kicked: ${reason}`);
    };

    ws.on('message', (data, isBinary) => {
      if (c.closed) return;
      const t = performance.now();
      c.lastMsgAt = t;
      c.lastSeenAt = t;
      const len = rawLength(data);
      c.bytesIn += len;
      if (!c.msgs.take(t)) { strike(0.25, 'message rate'); return; }
      if (!c.bytes.take(t, len)) { strike(0.5, 'byte rate'); return; }
      if (isBinary) { strike(1, 'binary frame'); return; }
      const v = parseClientFrame(rawToString(data));
      if (!v.ok) { strike(1, v.reason); return; }
      const msg = v.msg;
      if (!c.joined) {
        if (msg.t === 'ping') { conn.send({ t: 'pong', id: msg.id, ct: msg.ct, st: Date.now() }); return; }
        if (msg.t !== 'hello') { strike(0.5, 'message before hello'); return; }
        if (c.joining) return;
        c.joining = true;
        void join(msg);
        return;
      }
      const r = c.room!.room.handle(id, msg);
      if (r === 'abuse') strike(1, `invalid ${msg.t}`);
    });

    async function join(hello: Extract<ClientMsg, { t: 'hello' }>): Promise<void> {
      let mr: ManagedRoom | null = null;
      let failed = false;
      // A new room costs a whole simulation: cap how many distinct rooms one address may occupy.
      if (!rooms.get(c.roomName)) {
        const occupied = new Set<string>();
        for (const o of clients.values()) if (o !== c && o.ip === c.ip && (o.joined || o.joining)) occupied.add(o.roomName);
        if (occupied.size >= cfg.maxRoomsPerIp) { kick(c, 1013, 'too many rooms from your address'); return; }
      }
      try {
        mr = await rooms.acquire(c.roomName, id, c.roomSetup);
      } catch (err) {
        failed = true;
        log(`[cvc] room '${c.roomName}' could not be created: ${(err as Error)?.stack ?? err}`);
      }
      if (c.closed) { if (mr) rooms.release(mr, id); return; }
      if (!mr) { kick(c, failed ? 1011 : 1013, failed ? 'room could not be created' : 'server full: no free rooms'); return; }
      const slot = mr.room.join(conn, hello);
      if (!slot) { rooms.release(mr, id); kick(c, 1013, 'join refused', false); return; }
      c.room = mr;
      c.joined = true;
      announce(mr, `${slot.name} joined the yard`, id);
      log(`[cvc] ${id} joined room '${mr.name}' as ${slot.name} from ${ip} (${mr.room.humanCount} players)`);
    }

    ws.on('pong', () => {
      c.lastSeenAt = performance.now();
      if (c.pingSentAt) {
        c.rttMs = performance.now() - c.pingSentAt;
        if (c.joined) c.room?.room.setPing(id, c.rttMs);
      }
    });
    ws.on('error', (err) => log(`[cvc] ${id} socket error: ${err.message}`));
    ws.on('close', () => {
      c.closed = true;
      clients.delete(id);
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);
      if (c.room) {
        if (c.joined && !c.room.destroyed) {
          const name = c.room.room.players.get(id)?.name;
          c.room.room.leave(id);
          if (name) announce(c.room, `${name} left the yard`, id);
        }
        rooms.release(c.room, id);
        log(`[cvc] ${id} left room '${c.room.name}'`);
      }
      c.joined = false;
    });
  }

  rooms.onDestroy = (mr, reason) => {
    for (const cid of mr.conns) {
      const c = clients.get(cid);
      if (!c) continue;
      c.joined = false;
      c.room = null;
      kick(c, reason === 'room crashed' ? 1011 : 1001, reason);
    }
  };

  // Heartbeat + timeouts for every connection.
  const heartbeat = setInterval(() => {
    const now = performance.now();
    for (const c of clients.values()) {
      if (c.closed) continue;
      if (!c.joined && now - c.connectedAt > cfg.helloTimeoutMs) { kick(c, 4001, 'no hello received'); continue; }
      if (now - c.lastMsgAt > cfg.idleTimeoutMs) { kick(c, 4000, 'idle timeout'); continue; }
      if (now - c.lastSeenAt > cfg.peerTimeoutMs) { log(`[cvc] ${c.id} peer timeout (no message or pong)`); c.ws.terminate(); continue; }
      if (now - c.pingSentAt >= cfg.heartbeatMs) {
        c.pingSentAt = now;
        try { c.ws.ping(); } catch { c.ws.terminate(); }
      }
    }
  }, Math.max(50, Math.min(cfg.heartbeatMs, cfg.helloTimeoutMs / 2, cfg.idleTimeoutMs / 2, cfg.peerTimeoutMs / 2)));

  rooms.start();
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(cfg.port, cfg.host, () => { httpServer.off('error', reject); resolve(); });
  });
  const port = (httpServer.address() as AddressInfo).port;
  const shownHost = cfg.host === '0.0.0.0' || cfg.host === '::' ? 'localhost' : cfg.host;

  return {
    port,
    config: cfg,
    rooms,
    httpUrl: `http://${shownHost}:${port}`,
    wsUrl: `ws://${shownHost}:${port}${cfg.wsPath ?? ''}`,
    stats,
    connections: () => [...clients.values()].map((c) => ({
      id: c.id, room: c.roomName, ip: c.ip, joined: c.joined, rttMs: Math.round(c.rttMs),
      bytesIn: c.bytesIn, bytesOut: c.bytesOut, snapsSkipped: c.snapsSkipped, abuse: +c.abuse.score.toFixed(2),
    })),
    async close(reason = 'server shutting down') {
      if (shuttingDown) return;
      shuttingDown = true;
      clearInterval(heartbeat);
      for (const c of [...clients.values()]) {
        if (c.ws.readyState === WebSocket.OPEN) { try { c.ws.send(JSON.stringify({ t: 'notice', text: reason } satisfies ServerMsg)); } catch { /* closing anyway */ } }
        kick(c, 1001, reason, false);
      }
      rooms.stop(reason);
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => { for (const c of clients.values()) c.ws.terminate(); httpServer.closeAllConnections?.(); }, 2000);
        httpServer.close(() => { clearTimeout(force); resolve(); });
        httpServer.closeIdleConnections?.();
      });
      wss.close();
    },
  };
}

/** SIGINT/SIGTERM => graceful shutdown (second signal forces exit). */
export function installShutdownHandlers(server: GameServer): void {
  let stopping = false;
  const stop = (sig: string) => {
    if (stopping) { console.log(`[cvc] ${sig} again: forcing exit`); process.exit(1); }
    stopping = true;
    console.log(`[cvc] ${sig}: shutting down gracefully`);
    const force = setTimeout(() => process.exit(1), 5000);
    force.unref();
    server.close('server restarting').then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

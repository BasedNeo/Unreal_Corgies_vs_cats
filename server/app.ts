// The online authority: one HTTP server that answers /health and /stats, optionally serves the
// production build (staticDir), and upgrades WebSockets (on wsPath, or any path) into rooms.
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
import { parseClientFrame, sanitizeRoomName, TokenBucket, AbuseMeter } from '../src/host/guard';
import { SnapEncoder, encodeServerMsg, type WireEncoding } from '../src/host/wire';
import type { Conn } from '../src/host/room';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';
import { RoomManager, type ManagedRoom } from './rooms';
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
  stats(resetMax?: boolean): Record<string, unknown>;
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

  const stats = (resetMax = false) => ({
    ok: !shuttingDown,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    connections: clients.size,
    players: [...clients.values()].filter((c) => c.joined).length,
    rooms: rooms.stats(resetMax),
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
  });

  const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  const mayResetStats = (req: http.IncomingMessage, query: string): boolean => {
    const token = new URLSearchParams(query).get('token');
    if (cfg.statsToken && token === cfg.statsToken) return true;
    // a direct local peer only: behind a same-host reverse proxy every request arrives from loopback
    return LOOPBACK.has(req.socket.remoteAddress ?? '') && req.headers['x-forwarded-for'] === undefined;
  };

  const httpServer = http.createServer((req, res) => {
    const [url, query = ''] = (req.url ?? '/').split('?');
    if (url === '/health' || url === '/stats') {
      // /stats?reset=1 starts a new tick-max/overrun window (soak tools skip warm-up that way) — local or token only.
      const body = JSON.stringify(url === '/health' ? { ok: !shuttingDown, rooms: rooms.size, connections: clients.size } : stats(/(^|&)reset=1(&|$)/.test(query) && mayResetStats(req, query)));
      res.writeHead(shuttingDown ? 503 : 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
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

  const clientIp = (req: http.IncomingMessage): string => {
    if (cfg.trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

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
      id, ws, ip, roomName: sanitizeRoomName(url.searchParams.get('room')), room: null, joined: false, joining: false,
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
        mr = await rooms.acquire(c.roomName, id);
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
        if (c.joined && !c.room.destroyed) c.room.room.leave(id);
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

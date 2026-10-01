// Server configuration from environment variables (all optional). Shared by server/index.ts
// (WebSocket authority, dev) and server/prod.ts (static dist/ + WebSocket on one port).
import type { WireEncoding } from '../src/host/wire';
import { SLAB } from '../src/shared/content/modes';

export interface ServerConfig {
  host: string;
  port: number;
  /** Match mode for new rooms. */
  mode: string;
  /** Bots per team in every room. */
  bots: [number, number];
  /** Map/sim seed for every room. */
  seed: number;
  maxRooms: number;
  maxConnections: number;
  maxConnectionsPerIp: number;
  /** Distinct rooms one IP may occupy; creating more is refused (QA W1: one IP created 31 of 32 rooms). */
  maxRoomsPerIp: number;
  /** Trust X-Forwarded-For for per-IP limits (only behind your own reverse proxy). */
  trustProxy: boolean;
  /**
   * `/stats?reset=1` (restart the tick-max window) is honoured from a direct loopback peer, or anywhere with
   * `&token=<statsToken>` (env STATS_TOKEN). Otherwise anyone could hide overruns from a monitor (QA W1).
   */
  statsToken: string | null;
  /** Empty rooms are destroyed after this long (ms). */
  roomTtlMs: number;
  /**
   * Public JSON endpoints (`/rooms`, `/stats`): per-IP token bucket, requests per second and burst. Over it the
   * server answers 429 + Retry-After. `/health` is exempt (load-balancer probes).
   */
  httpRate: number;
  httpBurst: number;
  /**
   * `GET /rooms` lists live public rooms for the menu's room browser (env LIST_ROOMS=0 turns it off: 404). Room
   * names that start with `_` are unlisted: joinable by name, never listed (see server/rooms.ts UNLISTED_PREFIX).
   */
  listRooms: boolean;
  /** Most rooms one `/rooms` response carries (busiest first), which caps the response size. */
  roomsListMax: number;
  /** A connection must send 'hello' within this long (ms). */
  helloTimeoutMs: number;
  /** No message at all for this long closes the connection (ms). */
  idleTimeoutMs: number;
  /** WebSocket ping period (ms); also measures RTT for the roster. */
  heartbeatMs: number;
  /**
   * Terminate a peer not heard from (no message and no pong) for this long (ms): catches half-open
   * TCP. Generous on purpose: a browser whose main thread stalls stops reading frames (receive flow
   * control), so its pongs queue behind snapshots even though the client is alive.
   */
  peerTimeoutMs: number;
  /** Hard frame-size cap enforced by ws (bytes); larger frames close the socket with 1009. */
  maxPayload: number;
  /** Per-connection message rate (msgs/s) and burst. */
  msgRate: number;
  msgBurst: number;
  /** Per-connection byte rate (bytes/s) and burst. */
  byteRate: number;
  byteBurst: number;
  /** Abuse score (strikes, halving every 10 s) at which a connection is kicked (close 1008). */
  kickScore: number;
  /** Snapshots are skipped while a socket has more than this buffered (slow consumer). */
  maxBufferedBytes: number;
  /** Close a connection that stays congested this long (ms). */
  congestionKickMs: number;
  /** Allowed Origin headers (null = allow all). */
  allowedOrigins: string[] | null;
  /** Serve this directory over HTTP (prod). null = WebSocket + /health only. */
  staticDir: string | null;
  /** Accept WebSocket upgrades only on this path (null = any path). */
  wsPath: string | null;
  /** Default snapshot encoding (clients may request ?enc=raw). */
  encoding: WireEncoding;
  /** Log connections/rooms (false in tests). */
  log: boolean;
}

type Env = Record<string, string | undefined>;

function num(env: Env, key: string, def: number, min = -Infinity, max = Infinity): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`config: ${key}=${raw} is not a number`);
  return Math.min(max, Math.max(min, v));
}

function bots(raw: string | undefined, def: [number, number]): [number, number] {
  if (!raw) return def;
  const [a, b] = raw.split(',').map((s) => Math.max(0, Math.min(16, Math.floor(Number(s)))));
  return [Number.isFinite(a) ? a : def[0], Number.isFinite(b) ? b : def[1]];
}

export function loadConfig(env: Env = process.env, defaults: Partial<ServerConfig> = {}): ServerConfig {
  const d: ServerConfig = {
    host: '0.0.0.0', port: 8787, mode: 'yard-skirmish', bots: [3, 0], seed: 1,
    maxRooms: 32, maxConnections: 256, maxConnectionsPerIp: 16, maxRoomsPerIp: 3, trustProxy: false, statsToken: null,
    roomTtlMs: 10_000, httpRate: 5, httpBurst: 20, listRooms: true, roomsListMax: 50, helloTimeoutMs: 10_000, idleTimeoutMs: 30_000, heartbeatMs: 5_000, peerTimeoutMs: 20_000,
    maxPayload: 16 * 1024, msgRate: 120, msgBurst: 240, byteRate: 64 * 1024, byteBurst: 128 * 1024,
    kickScore: 20, maxBufferedBytes: 512 * 1024, congestionKickMs: 15_000,
    allowedOrigins: null, staticDir: null, wsPath: null, encoding: 'delta', log: true,
    ...defaults,
  };
  const origins = env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    ...d,
    host: env.HOST ?? d.host,
    port: num(env, 'PORT', d.port, 0, 65535),
    mode: env.MODE ?? d.mode,
    // Skirmish/boss-rush: a 3-bot corgi squad fights beside the players (cats come from the waves).
    // Team deathmatch: both teams bot-filled. (QA W1 P0: 0,4 made solo online skirmish unwinnable.)
    bots: bots(env.BOTS, defaults.bots ?? botsForMode(env.MODE ?? d.mode, d.bots)),
    seed: num(env, 'SEED', d.seed),
    maxRooms: num(env, 'MAX_ROOMS', d.maxRooms, 1),
    maxConnections: num(env, 'MAX_CONNECTIONS', d.maxConnections, 1),
    maxConnectionsPerIp: num(env, 'MAX_CONN_PER_IP', d.maxConnectionsPerIp, 1),
    maxRoomsPerIp: num(env, 'MAX_ROOMS_PER_IP', d.maxRoomsPerIp, 1),
    trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true' : d.trustProxy,
    statsToken: env.STATS_TOKEN || d.statsToken,
    roomTtlMs: num(env, 'ROOM_TTL_MS', d.roomTtlMs, 0),
    httpRate: num(env, 'HTTP_RATE', d.httpRate, 0.1),
    httpBurst: num(env, 'HTTP_BURST', d.httpBurst, 1),
    listRooms: env.LIST_ROOMS ? env.LIST_ROOMS !== '0' && env.LIST_ROOMS !== 'false' : d.listRooms,
    roomsListMax: num(env, 'ROOMS_LIST_MAX', d.roomsListMax, 1, 500),
    helloTimeoutMs: num(env, 'HELLO_TIMEOUT_MS', d.helloTimeoutMs, 100),
    idleTimeoutMs: num(env, 'IDLE_TIMEOUT_MS', d.idleTimeoutMs, 1000),
    heartbeatMs: num(env, 'HEARTBEAT_MS', d.heartbeatMs, 100),
    peerTimeoutMs: num(env, 'PEER_TIMEOUT_MS', d.peerTimeoutMs, 200),
    maxPayload: num(env, 'MAX_PAYLOAD', d.maxPayload, 1024),
    msgRate: num(env, 'MSG_RATE', d.msgRate, 1),
    msgBurst: num(env, 'MSG_BURST', d.msgBurst, 1),
    byteRate: num(env, 'BYTE_RATE', d.byteRate, 1024),
    byteBurst: num(env, 'BYTE_BURST', d.byteBurst, 1024),
    kickScore: num(env, 'KICK_SCORE', d.kickScore, 1),
    maxBufferedBytes: num(env, 'MAX_BUFFERED', d.maxBufferedBytes, 16 * 1024),
    congestionKickMs: num(env, 'CONGESTION_KICK_MS', d.congestionKickMs, 1000),
    allowedOrigins: origins && origins.length ? origins : d.allowedOrigins,
    staticDir: env.STATIC_DIR ?? d.staticDir,
    wsPath: env.WS_PATH ?? d.wsPath,
    encoding: env.WIRE === 'raw' ? 'raw' : env.WIRE === 'delta' ? 'delta' : d.encoding,
    log: env.LOG ? env.LOG !== '0' : d.log,
  };
}

/** Default bot fill per mode: PvP modes fill both teams; skirmish/boss-rush a corgi squad; adventure a squad of four;
 *  slab (W13) a 1v1 (SLAB.teamSize a side: the human plays one bot). */
export function botsForMode(mode: string, fallback: [number, number] = [3, 0]): [number, number] {
  if (mode === 'team-deathmatch' || mode === 'core-rush' || mode === 'base-assault') return [4, 4];
  if (mode === 'slab') return [SLAB.teamSize, SLAB.teamSize];
  if (mode === 'adventure') return [4, 0];
  return fallback;
}

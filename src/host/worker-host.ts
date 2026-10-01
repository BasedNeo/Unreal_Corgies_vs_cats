/// <reference lib="webworker" />
// Offline/local authority: runs the same Room + Sim as the Node server inside a Web Worker.
// Messages: the client posts ClientMsg objects; the worker posts ServerMsg objects back.
// Messages go through the same validator as the Node server so both authorities behave alike.
import { Sim } from '../sim/sim';
import { Room, startRoomLoop, type Conn } from './room';
import { validateClientMsg } from './guard';
import type { ServerMsg } from '../shared/protocol';
import { mapForRoom } from '../shared/world/maps';
import { chapterById } from '../shared/content/chapters';

/** The page's offline setup (src/client/net/transport.ts createWorkerTransport). `map` is sanitized like a room's. */
export interface WorkerBootConfig {
  seed: number; mode: string; bots: [number, number]; chapter?: string; boss?: string; map?: string;
  /** W13: a shortened slab match (tests, proofs; transport.ts slabOverridesFromSearch). Offline only: no online room
   *  reads it. Becomes sim.state.matchConfig.slab. */
  slab?: SlabOverrides;
}

/** The slab rules an offline page may shorten (SlabConfig fields). */
export interface SlabOverrides { winScore?: number; timeLimit?: number; overtimeMax?: number }

/** Only the three known numeric fields, finite, in range (the worker re-checks what the page sends). */
function slabOverrides(o: unknown): SlabOverrides | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const out: SlabOverrides = {};
  const take = (k: keyof SlabOverrides, min: number, max: number) => {
    const n = r[k];
    if (typeof n === 'number' && Number.isFinite(n)) out[k] = Math.min(max, Math.max(min, n));
  };
  take('winScore', 1, 999); take('timeLimit', 1, 3600); take('overtimeMax', 0, 600);
  return Object.keys(out).length ? out : null;
}

declare const self: DedicatedWorkerGlobalScope;

let room: Room | null = null;
const pending: unknown[] = [];
const conn: Conn = { id: 'local', send: (m: ServerMsg) => self.postMessage(m) };

async function boot(cfg: WorkerBootConfig) {
  const sim = await Sim.create({ seed: cfg.seed, map: mapForRoom(cfg.map, cfg.mode, chapterById(cfg.chapter)?.map) }); // W10: a chapter's own map
  // Offline an adventure's result card waits for the player's choice; online rooms move on after a countdown.
  if (cfg.mode === 'adventure') sim.state.adventureConfig = { holdResult: true };
  const slab = cfg.mode === 'slab' ? slabOverrides(cfg.slab) : null; // W13: a shortened slab match (offline only)
  if (slab) sim.state.matchConfig = { slab };
  room = new Room(sim, { mode: cfg.mode, botsPerTeam: cfg.bots, defaultTeam: 0, chapter: cfg.chapter, boss: cfg.boss });
  startRoomLoop(room);
  for (const m of pending.splice(0)) handle(m);
}

function handle(raw: unknown) {
  if (!room) { pending.push(raw); return; }
  const v = validateClientMsg(raw);
  if (!v.ok) return;
  if (v.msg.t === 'hello') room.join(conn, v.msg);
  else room.handle('local', v.msg);
}

self.onmessage = (ev: MessageEvent) => {
  const d = ev.data as { t?: string; cfg?: WorkerBootConfig };
  if (d?.t === '__boot' && d.cfg) void boot(d.cfg);
  else handle(ev.data);
};

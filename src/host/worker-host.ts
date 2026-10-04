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
import { EntityKind } from '../shared/types';
import { applyDamage } from '../sim/combat/damage';
import type { SimEntity } from '../sim/entity';

/** The page's offline setup (src/client/net/transport.ts createWorkerTransport). `map` is sanitized like a room's. */
export interface WorkerBootConfig {
  seed: number; mode: string; bots: [number, number]; chapter?: string; boss?: string; map?: string;
  /** W13: a shortened slab match (tests, proofs; transport.ts slabOverridesFromSearch). Offline only: no online room
   *  reads it. Becomes sim.state.matchConfig.slab. */
  slab?: SlabOverrides;
}

/** The slab rules an offline page may shorten (SlabConfig fields), and W15's &slabHurt (`hurt`: see slabHurtOn). */
export interface SlabOverrides { winScore?: number; timeLimit?: number; overtimeMax?: number; hurt?: boolean }

/** Only the three known numeric fields, finite, in range (the worker re-checks what the page sends); `hurt` never
 *  reaches the match rules (slabHurtOn reads it). */
function slabOverrides(o: unknown): SlabOverrides | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const out: SlabOverrides = {};
  const take = (k: 'winScore' | 'timeLimit' | 'overtimeMax', min: number, max: number) => {
    const n = r[k];
    if (typeof n === 'number' && Number.isFinite(n)) out[k] = Math.min(max, Math.max(min, n));
  };
  take('winScore', 1, 999); take('timeLimit', 1, 3600); take('overtimeMax', 0, 600);
  return Object.keys(out).length ? out : null;
}

/**
 * W15 &slabHurt, for reproducible HUD and FX shots: in an offline slab match the nearest living enemy really hits the
 * human on a fixed schedule of sim time and then takes it down (applyDamage, the same path as a shot: 'hit' and
 * 'death' events, the respawn, the roster credit). Each cycle: a hit of 25 at `start`, another 4 s later, the
 * knockout 8 s in; again every `period` s. The gaps leave a slow headless page (about 1 frame/s under SwiftShader)
 * time to shoot one cue before the next lands. A step the human cannot take (down, protected, no enemy) is skipped,
 * so the times never drift.
 */
export const SLAB_HURT = { start: 8, period: 16, steps: [{ at: 0, dmg: 25 }, { at: 4, dmg: 25 }, { at: 8, dmg: 999 }] } as const;

/**
 * The gate: only this offline worker reads it (no online room or Node server does; transport.ts passes the page's
 * &slabHurt to the worker only), only in a slab match, only when the page asked, and never in a production build.
 */
export function slabHurtOn(cfg: Pick<WorkerBootConfig, 'mode' | 'slab'> | null | undefined, prod: boolean = import.meta.env?.PROD === true): boolean {
  return !prod && cfg?.mode === 'slab' && cfg.slab?.hurt === true;
}

/** Applies the &slabHurt steps due by the room's sim time (`run.k`: steps done). Returns what landed. */
export function slabHurtStep(room: Room, run: { k: number }): Array<{ src: number; dst: number; dmg: number }> {
  const sim = room.sim, n = SLAB_HURT.steps.length, out: Array<{ src: number; dst: number; dmg: number }> = [];
  const due = (k: number) => SLAB_HURT.start + Math.floor(k / n) * SLAB_HURT.period + SLAB_HURT.steps[k % n].at;
  while (due(run.k) <= sim.time + 1e-9) {
    const step = SLAB_HURT.steps[run.k % n];
    run.k++;
    let me: SimEntity | null = null;
    for (const p of room.players.values()) if (!p.bot) { me = sim.entities.get(p.entity) ?? null; break; }
    if (!me || me.dead || !me.health) continue;
    let foe: SimEntity | null = null, best = Infinity;
    for (const e of sim.entities.values()) {
      if ((e.kind !== EntityKind.Player && e.kind !== EntityKind.Bot) || e.dead || e.team === me.team || !e.health) continue;
      const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
      if (d < best) { best = d; foe = e; }
    }
    if (!foe) continue;
    const dmg = applyDamage(sim, me, step.dmg, { id: foe.id, team: foe.team, weapon: foe.weapon }, me.pos.x, me.pos.y + 0.8, me.pos.z, false);
    if (dmg > 0) out.push({ src: foe.id, dst: me.id, dmg });
  }
  return out;
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
  const r = new Room(sim, { mode: cfg.mode, botsPerTeam: cfg.bots, defaultTeam: 0, chapter: cfg.chapter, boss: cfg.boss });
  if (slabHurtOn(cfg)) { // W15 &slabHurt: after each tick (offline, slab, asked for, not a production build)
    const run = { k: 0 }, tick = r.tick.bind(r);
    r.tick = () => { tick(); slabHurtStep(r, run); };
  }
  room = r;
  startRoomLoop(r);
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

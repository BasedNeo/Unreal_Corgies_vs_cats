// Multiple rooms per server: each named room owns its own Sim + Room, created on demand when the
// first player joins and destroyed once it has been empty for `roomTtlMs`. One shared fixed-rate
// loop drives every room; each tick is timed so /stats and the bot soak tool can judge tick health.
// A room whose tick keeps throwing is shut down instead of taking the whole server with it.
// list() feeds the public room browser (GET /rooms): names, mode, head counts and phase only — never who is
// connected from where.
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { MAX_PLAYERS_PER_ROOM, TICK_HZ } from '../src/shared/constants';
import type { MatchPhase } from '../src/shared/protocol';
import { botsForMode, type ServerConfig } from './config';
import type { RoomMode } from '../src/host/guard';

/** How a new room is set up (from its first joiner's ?mode= / ?chapter=, validated by sanitizeRoomSetup). */
export interface RoomSetup { mode: RoomMode; chapter?: string }

/**
 * Room names starting with this are unlisted: anyone with the name can join (`?room=_porch`), but the room browser
 * never lists them and public `/stats` redacts their names. (QA W1: room names act as private-room keys.)
 */
export const UNLISTED_PREFIX = '_';
export const isUnlistedRoom = (name: string): boolean => name.startsWith(UNLISTED_PREFIX);

/** One row of GET /rooms. `players` = everyone in the match (humans + bots); `maxPlayers` caps humans. */
export interface RoomListing {
  name: string;
  mode: string;
  players: number;
  humans: number;
  bots: number;
  maxPlayers: number;
  phase: MatchPhase;
  /** Adventure rooms: the chapter id the room was created for. */
  chapter?: string;
}

const TICK_MS = 1000 / TICK_HZ;
const MAX_TICKS_PER_WAKE = 8;
const MAX_ERRORS_IN_ROW = 30;

export interface ManagedRoom {
  name: string;
  room: Room;
  /** Connection ids attached to this room (joined or joining). */
  conns: Set<string>;
  createdAt: number;
  emptySince: number | null;
  acc: number;
  last: number;
  ticks: number;
  tickMsAvg: number;
  tickMsMax: number;
  /** Wake-ups that hit MAX_TICKS_PER_WAKE and dropped time (server overloaded / stalled). */
  overruns: number;
  errors: number;
  errorsInRow: number;
  destroyed: boolean;
}

export interface RoomStats {
  name: string;
  humans: number;
  entities: number;
  tick: number;
  ageSec: number;
  tickMsAvg: number;
  tickMsMax: number;
  overruns: number;
  errors: number;
  /** Input-buffer health summed over human players: starved ticks, catch-up ticks, dropped inputs. */
  inputStarves: number;
  inputCatchups: number;
  inputDrops: number;
}

export type RoomsConfig = Pick<ServerConfig, 'mode' | 'bots' | 'seed' | 'maxRooms' | 'roomTtlMs'>;

export class RoomManager {
  private rooms = new Map<string, ManagedRoom>();
  private creating = new Map<string, Promise<ManagedRoom>>();
  private loop: ReturnType<typeof setInterval> | null = null;
  private sweeper: ReturnType<typeof setInterval> | null = null;
  /** Called when a room is destroyed while connections are still attached (crash/shutdown). */
  onDestroy: (mr: ManagedRoom, reason: string) => void = () => {};

  constructor(readonly cfg: RoomsConfig, private readonly log: (msg: string) => void = () => {}) {}

  get size(): number { return this.rooms.size; }

  get(name: string): ManagedRoom | undefined { return this.rooms.get(name); }

  /** Attach a connection to a room, creating the room if needed. null = room limit reached. */
  async acquire(name: string, connId: string, setup?: RoomSetup | null): Promise<ManagedRoom | null> {
    let mr = this.rooms.get(name);
    if (!mr) {
      let pending = this.creating.get(name);
      if (!pending) {
        if (this.rooms.size + this.creating.size >= this.cfg.maxRooms) return null;
        pending = this.create(name, setup ?? null);
        this.creating.set(name, pending);
        pending.finally(() => this.creating.delete(name)).catch(() => {});
      }
      mr = await pending;
    }
    if (mr.destroyed) return null;
    mr.conns.add(connId);
    mr.emptySince = null;
    return mr;
  }

  /** Detach a connection; the room starts its empty countdown when the last one leaves. */
  release(mr: ManagedRoom, connId: string): void {
    mr.conns.delete(connId);
    if (mr.conns.size === 0 && mr.emptySince === null) mr.emptySince = performance.now();
  }

  /** Start the shared tick loop and the empty-room sweeper. */
  start(): void {
    if (this.loop) return;
    this.loop = setInterval(() => this.drive(performance.now()), 4);
    this.sweeper = setInterval(() => this.sweep(performance.now()), Math.max(50, Math.min(1000, this.cfg.roomTtlMs / 2 || 50)));
  }

  /** Stop the loop and destroy every room. */
  stop(reason = 'server stopping'): void {
    if (this.loop) clearInterval(this.loop);
    if (this.sweeper) clearInterval(this.sweeper);
    this.loop = this.sweeper = null;
    for (const mr of [...this.rooms.values()]) this.destroy(mr, reason);
  }

  /** Destroy rooms that have been empty longer than the TTL. */
  sweep(now: number): void {
    for (const mr of [...this.rooms.values()]) {
      if (mr.conns.size === 0 && mr.emptySince !== null && now - mr.emptySince >= this.cfg.roomTtlMs) this.destroy(mr, 'empty');
    }
  }

  /** Advance every room to `now` at the fixed tick rate (the loop calls this; tests may too). */
  drive(now: number): void {
    for (const mr of this.rooms.values()) {
      mr.acc += now - mr.last;
      mr.last = now;
      let n = 0;
      while (mr.acc >= TICK_MS && n < MAX_TICKS_PER_WAKE && !mr.destroyed) {
        const t0 = performance.now();
        try {
          mr.room.tick();
          mr.errorsInRow = 0;
        } catch (err) {
          mr.errors++;
          mr.errorsInRow++;
          if (mr.errors <= 5 || mr.errors % 100 === 0) this.log(`[cvc] room ${mr.name} tick error #${mr.errors}: ${(err as Error)?.stack ?? err}`);
          if (mr.errorsInRow >= MAX_ERRORS_IN_ROW) { this.destroy(mr, 'room crashed'); break; }
        }
        const dt = performance.now() - t0;
        mr.tickMsAvg += (dt - mr.tickMsAvg) * 0.02;
        if (dt > mr.tickMsMax) mr.tickMsMax = dt;
        mr.ticks++;
        mr.acc -= TICK_MS;
        n++;
      }
      if (n === MAX_TICKS_PER_WAKE) { mr.acc = 0; mr.overruns++; } // fell far behind: drop time instead of spiraling
    }
  }

  /**
   * Live public rooms for the room browser: at least one human, not unlisted, busiest first (then by name), at most
   * `max` rows. Carries no connection ids, addresses or player names.
   */
  list(max: number): RoomListing[] {
    const out: RoomListing[] = [];
    for (const mr of this.rooms.values()) {
      if (mr.destroyed || isUnlistedRoom(mr.name)) continue;
      let humans = 0, bots = 0;
      for (const p of mr.room.players.values()) { if (p.bot) bots++; else humans++; }
      if (humans === 0) continue; // emptied, waiting out its TTL: not a room anyone is playing in
      out.push({
        name: mr.name, mode: mr.room.opts.mode, players: humans + bots, humans, bots, maxPlayers: MAX_PLAYERS_PER_ROOM, phase: mr.room.match.phase,
        ...(mr.room.opts.chapter ? { chapter: mr.room.opts.chapter } : {}),
      });
    }
    out.sort((a, b) => b.humans - a.humans || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return out.slice(0, Math.max(0, Math.floor(max)));
  }

  stats(resetMax = false): RoomStats[] {
    const now = performance.now();
    return [...this.rooms.values()].map((mr) => {
      let starves = 0, catchups = 0, drops = 0;
      for (const p of mr.room.players.values()) { starves += p.net.starves; catchups += p.net.catchups; drops += p.net.drops; }
      const s: RoomStats = {
        name: mr.name, humans: mr.room.humanCount, entities: mr.room.sim.entities.size, tick: mr.room.sim.tick,
        ageSec: Math.round((now - mr.createdAt) / 1000), tickMsAvg: +mr.tickMsAvg.toFixed(3), tickMsMax: +mr.tickMsMax.toFixed(3),
        overruns: mr.overruns, errors: mr.errors, inputStarves: starves, inputCatchups: catchups, inputDrops: drops,
      };
      if (resetMax) { mr.tickMsMax = 0; mr.overruns = 0; }
      return s;
    });
  }

  private async create(name: string, setup: RoomSetup | null): Promise<ManagedRoom> {
    const sim = await Sim.create({ seed: this.cfg.seed });
    // the server's MODE/BOTS apply unless the creator asked for a mode (co-op adventure, core-rush, …)
    const room = setup
      ? new Room(sim, { mode: setup.mode, chapter: setup.chapter, botsPerTeam: botsForMode(setup.mode, this.cfg.bots) })
      : new Room(sim, { mode: this.cfg.mode, botsPerTeam: this.cfg.bots });
    const now = performance.now();
    const mr: ManagedRoom = {
      name, room, conns: new Set(), createdAt: now, emptySince: now, acc: 0, last: now,
      ticks: 0, tickMsAvg: 0, tickMsMax: 0, overruns: 0, errors: 0, errorsInRow: 0, destroyed: false,
    };
    this.rooms.set(name, mr);
    this.log(`[cvc] room '${name}' created (${this.rooms.size} rooms)`);
    return mr;
  }

  private destroy(mr: ManagedRoom, reason: string): void {
    if (mr.destroyed) return;
    mr.destroyed = true;
    this.rooms.delete(mr.name);
    if (mr.conns.size) this.onDestroy(mr, reason);
    mr.conns.clear();
    mr.room.dispose();
    this.log(`[cvc] room '${mr.name}' destroyed (${reason}); ${this.rooms.size} rooms left`);
  }
}

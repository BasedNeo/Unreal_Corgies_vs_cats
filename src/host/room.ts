// A game room: owns one authoritative Sim, the connected players and bots, input queues and
// snapshot broadcasting. Transport-agnostic: runs inside a Web Worker (offline) or Node (online).
//
// Input pipeline (per human player), designed so client-side prediction replays exactly what the
// authority applied:
//   - every input is sanitized once (sanitizeInput), stale/duplicate seqs are dropped silently
//     (redundant resends are normal), seqs absurdly far ahead are refused as abuse;
//   - one input is applied per tick from a small jitter buffer; when the buffer has held surplus
//     inputs for a whole window, two inputs are applied in one tick (the first through the very same
//     stepCharacter the sim uses) instead of dropping one — this trims latency without desync;
//   - when the buffer runs dry the last input is repeated (extrapolation), and after
//     STARVE_NEUTRAL_TICKS the player is brought to a stop instead of running on forever;
//   - player-controlled characters are rounded to snapshot precision after every tick
//     (quantize.ts) so snapshots are exact restart points for client reconciliation.
import type { Sim } from '../sim/sim';
import type { SimEntity } from '../sim/entity';
import { stepCharacter, type MoveContext } from '../sim/systems/movement';
import { stepWorldEffects } from '../sim/world/systems';
import type { ClientMsg, MatchState, RosterEntry, ServerMsg, GameEvent } from '../shared/protocol';
import { packEntity } from '../shared/protocol';
import { sanitizeInput, emptyInput, type InputCmd } from '../shared/input';
import { type ClassId, type TeamId, type EntityId, CLASS_IDS, EFlag, EntityKind, Species, Team } from '../shared/types';
import { SNAPSHOT_EVERY, MAX_PLAYERS_PER_ROOM, PROTOCOL_VERSION, TICK_HZ, TICK_DT } from '../shared/constants';
import { MAX_CMDS_PER_MSG, cleanText } from './guard';
import { quantizeMotion } from './quantize';
import { trySwapKit, swapKit, drainRosterCredits } from '../sim/interact';

export interface Conn {
  id: string;
  send(msg: ServerMsg): void;
  close?(): void;
}

/** Per-player input/network bookkeeping (authority side). */
export interface SlotNet {
  /** Ticks where no input was queued and the last one was repeated. */
  starves: number;
  /** Ticks where two queued inputs were applied to trim buffer latency. */
  catchups: number;
  /** Inputs dropped because the queue overflowed. */
  drops: number;
  /** Inputs refused (far-ahead seq, malformed). */
  refused: number;
  /** Inputs applied. */
  applied: number;
  starveRun: number;
  minDepth: number;
  windowTicks: number;
  lastMinDepth: number;
  /** Real-time input budget (see INPUT_CREDIT_CAP). */
  credit: number;
  inputsSeen: boolean;
  /** Last deploy-point class / team switch (separate: the menu sends both in one tick). */
  lastSwitchTick: number;
  lastTeamTick: number;
  lastChatTick: number;
}

export interface PlayerSlot {
  pid: string;
  name: string;
  conn: Conn | null;
  bot: boolean;
  team: TeamId;
  cls: ClassId;
  entity: EntityId;
  queue: InputCmd[];
  lastCmd: InputCmd;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
  net: SlotNet;
  /** Class / team chosen away from a kiosk: applied on the player's next respawn (S1, no free heal/teleport). */
  pendingCls?: ClassId;
  pendingTeam?: TeamId;
}

/** "At deploy": alive, full health and within this many meters of one of the team's spawn points. */
export const DEPLOY_RADIUS = 6;

export interface RoomOptions {
  mode: string;
  /** Fill teams with bots up to this many per team. */
  botsPerTeam?: [number, number];
  /** Which team human players join when they don't choose. */
  defaultTeam?: TeamId;
}

/** What handle() made of a message: 'abuse' should count against the sender's abuse meter. */
export type HandleResult = 'ok' | 'ignored' | 'abuse';

/**
 * Max inputs buffered per player; beyond this the oldest are dropped. Sized for a slow client frame
 * (a 250 ms frame samples 15 ticks at once); steady-state depth is trimmed by catch-up ticks.
 */
export const MAX_QUEUE = 16;
/** An input seq more than this far beyond the last applied one is refused (10 s of inputs). */
export const MAX_SEQ_AHEAD = TICK_HZ * 10;
/** After this many starved ticks the repeated input is replaced by a neutral (stopping) one. */
export const STARVE_NEUTRAL_TICKS = 15;
/** Buffer-trim window (ticks) and the minimum depth over a window that triggers a catch-up tick. */
export const CATCHUP_WINDOW = TICK_HZ;
export const CATCHUP_MIN_DEPTH = 3;
/**
 * Input credit: every tick grants one input's worth of movement; every applied input spends one. Catch-up (two
 * inputs in one tick) is only allowed when the player is owed ticks from earlier starvation (late/bursty packets),
 * so a client that sends inputs faster than real time can never move faster than real time (QA W1: +14 % speed).
 */
export const INPUT_CREDIT_CAP = 12;

export function defaultMatchState(mode: string): MatchState {
  return { mode, phase: 'live', timeLeft: 0, score: [0, 0], objective: 'Explore West Yard', wave: 0, winner: -1 };
}

function newSlotNet(): SlotNet {
  return { starves: 0, catchups: 0, drops: 0, refused: 0, applied: 0, starveRun: 0, minDepth: Infinity, windowTicks: 0, lastMinDepth: 0, credit: 0, inputsSeen: false, lastSwitchTick: -1e9, lastTeamTick: -1e9, lastChatTick: -1e9 };
}

export class Room {
  readonly players = new Map<string, PlayerSlot>();
  private pendingEvents: GameEvent[] = [];
  private botCounter = 0;
  private rosterDirty = true;
  private rosterTimer = 0;
  private readonly moveCtx: MoveContext;
  private disposed = false;
  private lastPhase: MatchState['phase'] | null = null;

  constructor(readonly sim: Sim, readonly opts: RoomOptions) {
    sim.state.room = { mode: opts.mode };
    this.moveCtx = { world: sim.world, kcc: sim.kcc, emit: (ev) => sim.emit(ev) };
    this.fillBots();
  }

  get match(): MatchState {
    return (this.sim.state.match as MatchState | undefined) ?? defaultMatchState(this.opts.mode);
  }

  /** Connected human players. */
  get humanCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  join(conn: Conn, hello: Extract<ClientMsg, { t: 'hello' }>): PlayerSlot | null {
    const existing = this.players.get(conn.id);
    if (existing) return existing; // repeated hello on the same connection: idempotent
    if (!hello || hello.v !== PROTOCOL_VERSION) { conn.send({ t: 'reject', reason: `protocol ${hello?.v} != ${PROTOCOL_VERSION}` }); return null; }
    if (this.humanCount >= MAX_PLAYERS_PER_ROOM) { conn.send({ t: 'reject', reason: 'room full' }); return null; }
    const cls: ClassId = (CLASS_IDS as readonly string[]).includes(hello.cls) ? hello.cls : 'assault';
    const team: TeamId = hello.team === Team.Corgis || hello.team === Team.Cats ? hello.team : (this.opts.defaultTeam ?? this.smallerTeam());
    const name = cleanText(String(hello.name ?? 'Player'), 64).replace(/[^\w \-.]/g, '').slice(0, 16) || 'Player';
    const slot = this.addSlot(conn.id, name, conn, false, team, cls);
    conn.send({ t: 'welcome', pid: slot.pid, entity: slot.entity, tick: this.sim.tick, mapSeed: this.sim.seed, mode: this.opts.mode, tickHz: TICK_HZ });
    this.fillBots();
    this.rosterDirty = true;
    return slot;
  }

  leave(pid: string): void {
    if (!this.removeSlot(pid)) return;
    this.fillBots();
  }

  /** Apply one (already structurally validated or trusted) client message from `pid`. */
  handle(pid: string, msg: ClientMsg): HandleResult {
    const p = this.players.get(pid);
    if (!p || p.bot || !msg || typeof msg !== 'object') return 'ignored';
    switch (msg.t) {
      case 'input':
        return this.queueInputs(p, msg.cmds);
      case 'ping':
        if (typeof msg.id !== 'number' || typeof msg.ct !== 'number') return 'abuse';
        p.conn?.send({ t: 'pong', id: msg.id, ct: msg.ct, st: Date.now() });
        return 'ok';
      case 'class': {
        // S1 rules: at their own team's Ordnance Terminal the kit changes in place (same entity, same spot,
        // same hp fraction, 1 s cooldown). Standing at a spawn with full health (the deploy menu) it respawns
        // as before — nothing to gain there. Anywhere else the choice waits for the player's next respawn:
        // a class switch must never be a free heal or a teleport home.
        if (!(CLASS_IDS as readonly string[]).includes(msg.cls)) return 'abuse';
        const e = this.sim.entities.get(p.entity);
        const swap = e ? trySwapKit(this.sim, e, msg.cls) : 'out_of_range';
        if (swap === 'cooldown') return 'ignored';
        if (swap === 'swapped') { p.cls = msg.cls; p.pendingCls = undefined; this.rosterDirty = true; return 'ok'; }
        if (this.atDeploy(p)) {
          if (!this.switchAllowed(p, 'lastSwitchTick')) return 'ignored';
          p.cls = msg.cls; p.pendingCls = undefined; this.respawnAs(p);
          return 'ok';
        }
        p.pendingCls = msg.cls === p.cls ? undefined : msg.cls;
        return 'ok';
      }
      case 'team':
        if (msg.team !== Team.Corgis && msg.team !== Team.Cats) return 'abuse';
        if (this.atDeploy(p)) {
          if (!this.switchAllowed(p, 'lastTeamTick')) return 'ignored';
          p.team = msg.team; p.pendingTeam = undefined; this.respawnAs(p); this.fillBots();
          return 'ok';
        }
        p.pendingTeam = msg.team === p.team ? undefined : msg.team; // applied on the next respawn (S1)
        return 'ok';
      case 'chat': {
        const text = cleanText(String(msg.text ?? ''), 120);
        if (!text) return 'ignored';
        if (this.sim.tick - p.net.lastChatTick < TICK_HZ / 2) return 'ignored';
        p.net.lastChatTick = this.sim.tick;
        this.broadcast({ t: 'chat', from: p.name, team: p.team, text });
        return 'ok';
      }
      case 'hello':
        return 'ignored';
      default:
        return 'abuse';
    }
  }

  /** Round-trip time measured by the transport (roster display only). */
  setPing(pid: string, ms: number): void {
    const p = this.players.get(pid);
    if (p && Number.isFinite(ms)) { p.ping = Math.round(ms); }
  }

  /** Advance the authority by one tick. */
  tick(): void {
    for (const p of this.players.values()) {
      if (p.bot) continue;
      this.feedInput(p);
    }
    this.sim.step();
    this.quantizePlayers();
    let restarted = false;
    let spawned: EntityId[] | null = null;
    for (const ev of this.sim.drainEvents()) {
      this.pendingEvents.push(ev);
      if (ev.e === 'death') this.creditDeath(ev.id, ev.by);
      else if (ev.e === 'score' && ev.reason === 'reset') restarted = true;
      else if (ev.e === 'spawn') (spawned ??= []).push(ev.id);
    }
    if (spawned) this.applyPendingSwitches(spawned);
    // Match restart (match rules emit score 'reset'; ended -> warmup/live as a fallback signal):
    // per-player K/D/score in the roster start over with the new match.
    const phase = this.match.phase;
    if (this.lastPhase === 'ended' && phase !== 'ended') restarted = true;
    this.lastPhase = phase;
    if (restarted) this.resetStats();
    for (const c of drainRosterCredits(this.sim)) this.creditScore(c.id, c.pts); // S1: kibble, cores, objectives
    if (this.sim.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots();
    this.rosterTimer++;
    if (this.rosterDirty || this.rosterTimer >= TICK_HZ * 2) this.sendRoster();
  }

  broadcast(msg: ServerMsg): void {
    for (const p of this.players.values()) p.conn?.send(msg);
  }

  addBot(team: TeamId, cls: ClassId = 'assault'): PlayerSlot {
    const n = ++this.botCounter;
    const name = team === Team.Cats ? `Cat ${n}` : `Pup ${n}`;
    return this.addSlot(`bot-${n}`, name, null, true, team, cls);
  }

  /** Free the simulation. The room must not be ticked afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.players.clear();
    this.sim.dispose();
  }

  // ---- input pipeline ----

  private queueInputs(p: PlayerSlot, cmds: unknown): HandleResult {
    if (!Array.isArray(cmds) || cmds.length === 0 || cmds.length > MAX_CMDS_PER_MSG) { p.net.refused++; return 'abuse'; }
    let abuse = false;
    for (const raw of cmds) {
      const cmd = sanitizeInput(raw);
      if (!cmd || cmd.seq < 1 || cmd.seq > Number.MAX_SAFE_INTEGER) { abuse = true; p.net.refused++; continue; }
      if (!p.net.inputsSeen) {
        // The first input of a connection establishes the sequence base (reconnects keep counting).
        p.net.inputsSeen = true;
        p.lastCmd = { ...p.lastCmd, seq: cmd.seq - 1 };
      }
      if (cmd.seq <= p.lastCmd.seq) continue; // stale or redundant resend: harmless
      if (cmd.seq > p.lastCmd.seq + MAX_SEQ_AHEAD) { abuse = true; p.net.refused++; continue; }
      if (p.queue.some((q) => q.seq === cmd.seq)) continue; // duplicate
      let i = p.queue.length;
      while (i > 0 && p.queue[i - 1].seq > cmd.seq) i--;
      p.queue.splice(i, 0, cmd);
    }
    while (p.queue.length > MAX_QUEUE) { p.queue.shift(); p.net.drops++; } // keep latency bounded
    return abuse ? 'abuse' : 'ok';
  }

  private feedInput(p: PlayerSlot): void {
    const net = p.net;
    const depth = p.queue.length;
    if (depth < net.minDepth) net.minDepth = depth;
    if (++net.windowTicks >= CATCHUP_WINDOW) { net.lastMinDepth = net.minDepth; net.minDepth = Infinity; net.windowTicks = 0; }
    if (net.inputsSeen) net.credit = Math.min(INPUT_CREDIT_CAP, net.credit + 1); // no credit before the first input
    let cmd = p.queue.shift();
    if (!cmd) {
      if (net.inputsSeen) { net.starves++; net.starveRun++; }
      const hold = net.starveRun > STARVE_NEUTRAL_TICKS ? { ...p.lastCmd, mx: 0, mz: 0, buttons: 0 } : p.lastCmd;
      this.sim.setInput(p.entity, hold);
      return;
    }
    net.starveRun = 0;
    const e = this.sim.entities.get(p.entity);
    if (e && !e.dead && e.char && !(e.flags & EFlag.Mounted) && p.queue.length && net.credit >= 2 && net.lastMinDepth >= CATCHUP_MIN_DEPTH && p.queue[0].buttons === cmd.buttons) {
      this.stepExtra(e, cmd);
      net.credit--;
      net.applied++;
      net.catchups++;
      net.lastMinDepth--;
      cmd = p.queue.shift()!;
    }
    p.lastCmd = cmd;
    net.credit--;
    net.applied++;
    this.sim.setInput(p.entity, cmd);
  }

  /** Apply one input's movement ahead of the regular tick (same function, same order as the client). */
  private stepExtra(e: SimEntity, cmd: InputCmd): void {
    this.sim.setInput(e.id, cmd);
    if (e.flags & EFlag.Mounted) return; // riders are moved by their vehicle during regular ticks
    stepCharacter(this.moveCtx, e, TICK_DT);
    // Map effects run right after movement in a regular tick (order 250); mirror that here.
    if (stepWorldEffects(this.sim.worldData, e, TICK_DT, this.moveCtx.emit).outOfBounds) {
      const s = this.sim.pickSpawn(e.team);
      this.sim.placeCharacter(e, s.x, s.y, s.z);
    }
    e.prevButtons = cmd.buttons;
    quantizeMotion(e);
  }

  /** Round player-controlled characters to snapshot precision (see quantize.ts). */
  private quantizePlayers(): void {
    for (const p of this.players.values()) {
      if (p.bot) continue;
      const e = this.sim.entities.get(p.entity);
      if (e && e.char && !e.dead && !(e.flags & EFlag.Mounted)) quantizeMotion(e); // riders follow their vehicle
    }
  }

  private switchAllowed(p: PlayerSlot, key: 'lastSwitchTick' | 'lastTeamTick'): boolean {
    if (this.sim.tick - p.net[key] < TICK_HZ) return false;
    p.net[key] = this.sim.tick;
    return true;
  }

  // ---- slots ----

  private addSlot(pid: string, name: string, conn: Conn | null, bot: boolean, team: TeamId, cls: ClassId): PlayerSlot {
    const species = team === Team.Cats ? Species.Cat : Species.Corgi;
    const e = this.sim.spawnCharacter({ kind: bot ? EntityKind.Bot : EntityKind.Player, team, species, cls, name, ownerPid: bot ? null : pid });
    const slot: PlayerSlot = { pid, name, conn, bot, team, cls, entity: e.id, queue: [], lastCmd: { ...emptyInput(0), yaw: e.yaw }, kills: 0, deaths: 0, score: 0, ping: 0, net: newSlotNet() };
    this.players.set(pid, slot);
    this.rosterDirty = true;
    return slot;
  }

  private removeSlot(pid: string): boolean {
    const p = this.players.get(pid);
    if (!p) return false;
    this.sim.removeEntity(p.entity);
    this.players.delete(pid);
    this.rosterDirty = true;
    return true;
  }

  private respawnAs(p: PlayerSlot): void {
    this.sim.removeEntity(p.entity);
    const species = p.team === Team.Cats ? Species.Cat : Species.Corgi;
    const e = this.sim.spawnCharacter({ kind: p.bot ? EntityKind.Bot : EntityKind.Player, team: p.team, species, cls: p.cls, name: p.name, ownerPid: p.bot ? null : p.pid });
    p.entity = e.id;
    p.queue = [];
    if (p.conn) p.conn.send({ t: 'welcome', pid: p.pid, entity: e.id, tick: this.sim.tick, mapSeed: this.sim.seed, mode: this.opts.mode, tickHz: TICK_HZ });
    this.rosterDirty = true;
  }

  private smallerTeam(): TeamId {
    let c = 0, k = 0;
    for (const p of this.players.values()) if (!p.bot) { if (p.team === Team.Corgis) c++; else k++; }
    return c <= k ? Team.Corgis : Team.Cats;
  }

  /** Keep each team topped up with bots, removing bots as humans join. */
  private fillBots(): void {
    const want = this.opts.botsPerTeam ?? [0, 0];
    for (const team of [Team.Corgis, Team.Cats] as TeamId[]) {
      const members = [...this.players.values()].filter((p) => p.team === team);
      const humans = members.filter((p) => !p.bot).length;
      const bots = members.filter((p) => p.bot);
      const target = Math.max(0, (want[team as 0 | 1] ?? 0) - humans);
      for (let i = bots.length; i < target; i++) this.addBot(team, CLASS_IDS[i % 3]);
      for (let i = target; i < bots.length; i++) this.removeSlot(bots[i].pid);
    }
  }

  private resetStats(): void {
    for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; p.score = 0; }
    this.rosterDirty = true;
  }

  /** Alive, unhurt and standing at one of the team's spawn points (S1: switching here gains nothing). */
  private atDeploy(p: PlayerSlot): boolean {
    const e = this.sim.entities.get(p.entity);
    if (!e || e.dead || !e.health || e.health.hp < e.health.max) return false;
    return this.sim.worldData.spawns.some((s) => s.team === p.team && Math.hypot(s.x - e.pos.x, s.z - e.pos.z) <= DEPLOY_RADIUS);
  }

  /** A player's entity (re)spawned: apply the class/team they picked away from a kiosk (S1). */
  private applyPendingSwitches(spawned: EntityId[]): void {
    for (const p of this.players.values()) {
      if (p.bot || (p.pendingCls === undefined && p.pendingTeam === undefined) || !spawned.includes(p.entity)) continue;
      const e = this.sim.entities.get(p.entity);
      if (!e || e.dead) continue;
      if (p.pendingCls !== undefined) p.cls = p.pendingCls;
      p.pendingCls = undefined;
      if (p.pendingTeam !== undefined && p.pendingTeam !== p.team) {
        p.team = p.pendingTeam;
        p.pendingTeam = undefined;
        this.respawnAs(p); // new body for the other species, at the new team's spawn
        this.fillBots();
      } else {
        p.pendingTeam = undefined;
        swapKit(e, p.cls); // just respawned at full health: the new kit in place, same entity
        this.rosterDirty = true;
      }
    }
  }

  private creditScore(entity: EntityId, pts: number): void {
    for (const p of this.players.values()) if (p.entity === entity) { p.score += pts; this.rosterDirty = true; }
  }

  private creditDeath(victim: EntityId, killer: EntityId): void {
    for (const p of this.players.values()) {
      if (p.entity === victim) p.deaths++;
      if (p.entity === killer && killer !== victim) { p.kills++; p.score += 100; }
    }
    this.rosterDirty = true;
  }

  private sendSnapshots(): void {
    const ents = this.sim.snapshotEntities().map(packEntity);
    const gone = this.sim.removedIds.splice(0);
    const ev = this.pendingEvents;
    this.pendingEvents = [];
    const match = this.match;
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      p.conn.send({ t: 'snap', tick: this.sim.tick, ack: p.lastCmd.seq, you: p.entity, ents, gone, match, ev });
    }
  }

  private sendRoster(): void {
    this.rosterDirty = false;
    this.rosterTimer = 0;
    const players: RosterEntry[] = [...this.players.values()].map((p) => ({
      pid: p.pid, name: p.name, team: p.team, cls: p.cls, entity: p.entity, bot: p.bot,
      kills: p.kills, deaths: p.deaths, score: p.score, ping: p.ping,
    }));
    this.broadcast({ t: 'roster', players });
  }
}

/** Drive a room at the fixed tick rate. Works in browsers, workers and Node. Returns a stop fn. */
export function startRoomLoop(room: Room, hz = TICK_HZ): () => void {
  const dt = 1000 / hz;
  let last = performance.now();
  let acc = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    acc += now - last;
    last = now;
    let n = 0;
    while (acc >= dt && n < 8) { room.tick(); acc -= dt; n++; }
    if (n === 8) acc = 0; // fell far behind: drop time instead of spiraling
  }, 4);
  return () => clearInterval(timer);
}

// A game room: owns one authoritative Sim, the connected players and bots, input queues and
// snapshot broadcasting. Transport-agnostic: runs inside a Web Worker (offline) or Node (online).
import type { Sim } from '../sim/sim';
import type { ClientMsg, MatchState, RosterEntry, ServerMsg, GameEvent } from '../shared/protocol';
import { packEntity } from '../shared/protocol';
import { sanitizeInput, emptyInput, type InputCmd } from '../shared/input';
import { type ClassId, type TeamId, type EntityId, CLASS_IDS, EntityKind, Species, Team } from '../shared/types';
import { SNAPSHOT_EVERY, MAX_PLAYERS_PER_ROOM, PROTOCOL_VERSION, TICK_HZ } from '../shared/constants';

export interface Conn {
  id: string;
  send(msg: ServerMsg): void;
  close?(): void;
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
}

export interface RoomOptions {
  mode: string;
  /** Fill teams with bots up to this many per team. */
  botsPerTeam?: [number, number];
  /** Which team human players join when they don't choose. */
  defaultTeam?: TeamId;
}

const MAX_QUEUE = 8;

export function defaultMatchState(mode: string): MatchState {
  return { mode, phase: 'live', timeLeft: 0, score: [0, 0], objective: 'Explore West Yard', wave: 0, winner: -1 };
}

export class Room {
  readonly players = new Map<string, PlayerSlot>();
  private pendingEvents: GameEvent[] = [];
  private botCounter = 0;
  private rosterDirty = true;
  private rosterTimer = 0;

  constructor(readonly sim: Sim, readonly opts: RoomOptions) {
    sim.state.room = { mode: opts.mode };
    this.fillBots();
  }

  get match(): MatchState {
    return (this.sim.state.match as MatchState | undefined) ?? defaultMatchState(this.opts.mode);
  }

  join(conn: Conn, hello: Extract<ClientMsg, { t: 'hello' }>): PlayerSlot | null {
    if (hello.v !== PROTOCOL_VERSION) { conn.send({ t: 'reject', reason: `protocol ${hello.v} != ${PROTOCOL_VERSION}` }); return null; }
    const humans = [...this.players.values()].filter((p) => !p.bot).length;
    if (humans >= MAX_PLAYERS_PER_ROOM) { conn.send({ t: 'reject', reason: 'room full' }); return null; }
    const cls: ClassId = (CLASS_IDS as readonly string[]).includes(hello.cls) ? hello.cls : 'assault';
    const team: TeamId = hello.team === Team.Corgis || hello.team === Team.Cats ? hello.team : (this.opts.defaultTeam ?? this.smallerTeam());
    const name = String(hello.name ?? 'Player').replace(/[^\w \-.]/g, '').slice(0, 16) || 'Player';
    const slot = this.addSlot(conn.id, name, conn, false, team, cls);
    conn.send({ t: 'welcome', pid: slot.pid, entity: slot.entity, tick: this.sim.tick, mapSeed: this.sim.seed, mode: this.opts.mode, tickHz: TICK_HZ });
    this.fillBots();
    this.rosterDirty = true;
    return slot;
  }

  leave(pid: string): void {
    const p = this.players.get(pid);
    if (!p) return;
    this.sim.removeEntity(p.entity);
    this.players.delete(pid);
    this.fillBots();
    this.rosterDirty = true;
  }

  handle(pid: string, msg: ClientMsg): void {
    const p = this.players.get(pid);
    if (!p || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'input': {
        if (!Array.isArray(msg.cmds)) return;
        for (const raw of msg.cmds.slice(0, MAX_QUEUE * 2)) {
          const cmd = sanitizeInput(raw);
          if (!cmd || cmd.seq <= p.lastCmd.seq || p.queue.some((q) => q.seq === cmd.seq)) continue;
          p.queue.push(cmd);
        }
        p.queue.sort((a, b) => a.seq - b.seq);
        while (p.queue.length > MAX_QUEUE) p.queue.shift(); // drop stale inputs rather than grow latency
        break;
      }
      case 'ping':
        p.conn?.send({ t: 'pong', id: msg.id, ct: msg.ct, st: Date.now() });
        break;
      case 'class':
        if ((CLASS_IDS as readonly string[]).includes(msg.cls)) { p.cls = msg.cls; this.respawnAs(p); }
        break;
      case 'team':
        if (msg.team === Team.Corgis || msg.team === Team.Cats) { p.team = msg.team; this.respawnAs(p); this.fillBots(); }
        break;
      case 'chat': {
        const text = String(msg.text ?? '').slice(0, 120);
        if (text) this.broadcast({ t: 'chat', from: p.name, text });
        break;
      }
      default:
        break;
    }
  }

  /** Advance the authority by one tick. */
  tick(): void {
    for (const p of this.players.values()) {
      if (p.bot) continue;
      const cmd = p.queue.shift();
      if (cmd) p.lastCmd = cmd;
      this.sim.setInput(p.entity, cmd ?? { ...p.lastCmd, buttons: p.lastCmd.buttons });
    }
    this.sim.step();
    for (const ev of this.sim.drainEvents()) {
      this.pendingEvents.push(ev);
      if (ev.e === 'death') this.creditDeath(ev.id, ev.by);
    }
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

  private addSlot(pid: string, name: string, conn: Conn | null, bot: boolean, team: TeamId, cls: ClassId): PlayerSlot {
    const species = team === Team.Cats ? Species.Cat : Species.Corgi;
    const e = this.sim.spawnCharacter({ kind: bot ? EntityKind.Bot : EntityKind.Player, team, species, cls, name, ownerPid: bot ? null : pid });
    const slot: PlayerSlot = { pid, name, conn, bot, team, cls, entity: e.id, queue: [], lastCmd: { ...emptyInput(0), yaw: e.yaw }, kills: 0, deaths: 0, score: 0, ping: 0 };
    this.players.set(pid, slot);
    this.rosterDirty = true;
    return slot;
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
      for (let i = target; i < bots.length; i++) this.leave(bots[i].pid);
    }
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

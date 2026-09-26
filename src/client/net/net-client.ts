// Client side of the protocol: snapshot buffer, server-time estimate, entity interpolation,
// input batching. OWNER: netcode lane (adds client-side prediction + reconciliation).
import type { Transport } from './transport';
import { unpackEntity, type EntityState, type MatchState, type RosterEntry, type ServerMsg } from '../../shared/protocol';
import type { InputCmd } from '../../shared/input';
import type { ClassId, TeamId } from '../../shared/types';
import { INTERP_DELAY, PROTOCOL_VERSION, TICK_HZ } from '../../shared/constants';
import { lerp, lerpAngle } from '../../shared/math';
import { bus } from '../core/events';

interface Snapshot {
  tick: number;
  ents: Map<number, EntityState>;
}

export interface NetStats { rttMs: number; snapshotsPerSec: number; bytesIn: number; pending: number }

export class NetClient {
  pid = '';
  localEntity = -1;
  tickHz = TICK_HZ;
  match: MatchState | null = null;
  roster: RosterEntry[] = [];
  lastAck = 0;
  connected = false;
  readonly stats: NetStats = { rttMs: 0, snapshotsPerSec: 0, bytesIn: 0, pending: 0 };
  private snaps: Snapshot[] = [];
  private outbox: InputCmd[] = [];
  /** Sent but not yet acknowledged inputs (for prediction/reconciliation). */
  readonly unacked: InputCmd[] = [];
  /** Estimated current server time (seconds) = serverTick/tickHz, advanced by local clock. */
  private serverTimeBase = 0;
  private localTimeBase = 0;
  private haveTime = false;
  private pingId = 0;
  private snapCount = 0;
  private snapWindowStart = performance.now();

  constructor(readonly transport: Transport) {
    transport.onMessage((m) => this.onMessage(m));
    transport.onClose((r) => { this.connected = false; bus.emit('disconnected', r); });
    setInterval(() => this.transport.send({ t: 'ping', id: ++this.pingId, ct: performance.now() }), 1000);
  }

  join(name: string, cls: ClassId, team: TeamId | -1): void {
    this.transport.send({ t: 'hello', v: PROTOCOL_VERSION, name, cls, team });
  }

  pushInput(cmd: InputCmd): void {
    this.outbox.push(cmd);
    this.unacked.push(cmd);
    if (this.unacked.length > 240) this.unacked.splice(0, this.unacked.length - 240);
  }

  flush(): void {
    if (!this.outbox.length || !this.connected) return;
    // Resend the last few unacked commands too: cheap redundancy against loss.
    const extra = this.unacked.slice(-this.outbox.length - 3, -this.outbox.length);
    this.transport.send({ t: 'input', cmds: [...extra, ...this.outbox] });
    this.outbox.length = 0;
  }

  /** Server time we should be rendering remote entities at. */
  renderTime(nowMs = performance.now()): number {
    return this.serverNow(nowMs) - INTERP_DELAY;
  }

  serverNow(nowMs = performance.now()): number {
    return this.serverTimeBase + (nowMs - this.localTimeBase) / 1000;
  }

  latest(): Snapshot | null {
    return this.snaps[this.snaps.length - 1] ?? null;
  }

  latestState(id: number): EntityState | null {
    return this.latest()?.ents.get(id) ?? null;
  }

  /** Interpolated states of all entities at render time. */
  interpolated(nowMs = performance.now()): Map<number, EntityState> {
    const out = new Map<number, EntityState>();
    if (!this.snaps.length) return out;
    const t = this.renderTime(nowMs) * this.tickHz;
    let a = this.snaps[0], b = this.snaps[this.snaps.length - 1];
    for (let i = this.snaps.length - 1; i > 0; i--) {
      if (this.snaps[i - 1].tick <= t) { a = this.snaps[i - 1]; b = this.snaps[i]; break; }
    }
    const span = b.tick - a.tick;
    const f = span > 0 ? Math.min(1.25, Math.max(0, (t - a.tick) / span)) : 1;
    for (const [id, sb] of b.ents) {
      const sa = a.ents.get(id);
      if (!sa) { out.set(id, sb); continue; }
      out.set(id, {
        ...sb,
        x: lerp(sa.x, sb.x, f), y: lerp(sa.y, sb.y, f), z: lerp(sa.z, sb.z, f),
        yaw: lerpAngle(sa.yaw, sb.yaw, f), pitch: lerp(sa.pitch, sb.pitch, f),
        vx: lerp(sa.vx, sb.vx, f), vy: lerp(sa.vy, sb.vy, f), vz: lerp(sa.vz, sb.vz, f),
      });
    }
    return out;
  }

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.pid = m.pid; this.localEntity = m.entity; this.tickHz = m.tickHz; this.connected = true;
        this.snaps.length = 0; this.unacked.length = 0; this.haveTime = false;
        bus.emit('connected', { pid: m.pid, entity: m.entity });
        break;
      case 'snap': {
        const ents = new Map<number, EntityState>();
        for (const a of m.ents) { const s = unpackEntity(a); ents.set(s.id, s); }
        this.snaps.push({ tick: m.tick, ents });
        if (this.snaps.length > 32) this.snaps.shift();
        if (m.you !== this.localEntity) { this.localEntity = m.you; bus.emit('localSpawn', m.you); }
        this.lastAck = m.ack;
        while (this.unacked.length && this.unacked[0].seq <= m.ack) this.unacked.shift();
        this.syncClock(m.tick);
        this.match = m.match;
        bus.emit('match', m.match);
        for (const ev of m.ev) bus.emit('game', ev);
        this.snapCount++;
        const now = performance.now();
        if (now - this.snapWindowStart > 1000) { this.stats.snapshotsPerSec = this.snapCount * 1000 / (now - this.snapWindowStart); this.snapCount = 0; this.snapWindowStart = now; }
        this.stats.pending = this.unacked.length;
        break;
      }
      case 'roster': this.roster = m.players; bus.emit('roster', m.players); break;
      case 'pong': this.stats.rttMs = this.stats.rttMs ? lerp(this.stats.rttMs, performance.now() - m.ct, 0.2) : performance.now() - m.ct; break;
      case 'notice': bus.emit('notice', m.text); break;
      case 'chat': bus.emit('chat', { from: m.from, text: m.text }); break;
      case 'reject': bus.emit('disconnected', m.reason); break;
    }
  }

  private syncClock(tick: number): void {
    const now = performance.now();
    const serverT = tick / this.tickHz;
    if (!this.haveTime) { this.serverTimeBase = serverT; this.localTimeBase = now; this.haveTime = true; return; }
    const err = serverT - this.serverNow(now);
    // Snap on big errors (tab stalls), otherwise slew gently to avoid visible time warps.
    if (Math.abs(err) > 0.25) { this.serverTimeBase = serverT; this.localTimeBase = now; }
    else { this.serverTimeBase += err * 0.1; }
  }
}

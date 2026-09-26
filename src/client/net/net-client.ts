// Client side of the protocol: snapshot buffer, server-time estimate, remote-entity interpolation
// (adaptive delay, bounded extrapolation), input batching with redundancy, and client-side
// prediction + reconciliation of the local player (./prediction.ts, loaded lazily on 'welcome').
//
// Integration contract for main.ts (no call-site changes needed beyond the existing ones):
//   net.pushInput(cmd)      each sampled 60 Hz input: sent AND applied to the local prediction
//   net.flush()             once per frame
//   net.interpolated(now)   remote entities interpolated; the local entity is the smoothed PREDICTED state
//   net.renderTime(now)     server time being rendered (for InputCmd.rt, lag compensation)
// Extras: predictedLocal(), reconnect(), setPrediction(on), stats / prediction counters,
// globalThis.__cvc.net debug block. ?predict=0 disables prediction (A/B testing).
import type { Transport } from './transport';
import type { LocalPredictor, ReconcileResult } from './prediction';
import { unpackEntity, type EntityState, type GameEvent, type MatchState, type RosterEntry, type ServerMsg } from '../../shared/protocol';
import type { InputCmd } from '../../shared/input';
import { EFlag, type ClassId, type TeamId } from '../../shared/types';
import { INTERP_DELAY, PROTOCOL_VERSION, SNAPSHOT_EVERY, TICK_HZ } from '../../shared/constants';
import { lerp, lerpAngle } from '../../shared/math';
import { bus } from '../core/events';

interface Snapshot {
  tick: number;
  ents: Map<number, EntityState>;
}

export interface NetStats {
  rttMs: number;
  snapshotsPerSec: number;
  bytesIn: number;
  /** Downstream kilobytes per second (WebSocket only). */
  kbIn: number;
  kbOut: number;
  pending: number;
  /** Current remote-entity interpolation delay (ms) and the arrival jitter it adapts to (ms). */
  interpDelayMs: number;
  jitterMs: number;
  /** True when the last interpolated() call had to extrapolate past the newest snapshot. */
  extrapolating: boolean;
  /** Frames that extrapolated / frames rendered. */
  extrapolatedFrames: number;
  renderedFrames: number;
}

export interface PredictionStats {
  enabled: boolean;
  active: boolean;
  /** Last reconcile error at the acked input (m), and running mean / p95 / max over the last 600. */
  last: number;
  mean: number;
  p95: number;
  max: number;
  /** Reconciles that replayed inputs because of a mismatch. */
  corrections: number;
  /** Visual corrections above 0.5 m that were not snaps. */
  bigCorrections: number;
  /** Largest smoothed (non-snap) correction (m). */
  maxCorrection: number;
  /** (Re)spawns and > 2 m corrections (snapped). */
  snaps: number;
  replays: number;
}

export interface NetClientOptions {
  /** Clock in ms (default performance.now). Tests pass a simulated clock. */
  now?: () => number;
  /** Predict the local player (default true unless the page URL has ?predict=0). */
  predict?: boolean;
  /** Ping + liveness check period (default 1000 ms, 0 = off: call `tickTimers()` yourself). */
  pingIntervalMs?: number;
  /** No server message for this long while connected => disconnected (default 5000 ms). */
  timeoutMs?: number;
  /** Previously sent unacked inputs re-sent with each input message (default 3 on lossy links, 0 on reliable ones). */
  redundancy?: number;
  /** Predictor factory (default: lazy `import('./prediction')`). */
  createPredictor?: (seed: number) => Promise<LocalPredictor>;
  /** Called after every reconciliation (telemetry, tests). */
  onReconcile?: (r: ReconcileResult, ack: number) => void;
}

/** Interpolation delay bounds (s): at least two snapshot intervals, at most 250 ms. */
export const MIN_INTERP_DELAY = (2 * SNAPSHOT_EVERY) / TICK_HZ;
export const MAX_INTERP_DELAY = 0.25;
/** Remote entities are extrapolated with their velocity for at most this long (s) on snapshot gaps. */
export const MAX_EXTRAPOLATION = 0.1;
/** A remote entity moving farther than this between two snapshots teleported: don't interpolate. */
const TELEPORT_DISTANCE = 5;
const MAX_UNACKED = TICK_HZ * 4;
const ERROR_WINDOW = 600;

function defaultPredict(): boolean {
  const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
  return !/[?&]predict=0(&|$)/.test(search);
}

/** Movement events the predictor produces for the local player; the authority's copies are dropped. */
function isPredictedEvent(ev: GameEvent, local: number): boolean {
  if (ev.e === 'jump' || ev.e === 'land') return ev.id === local;
  if (ev.e === 'ability') return ev.id === local && (ev.ability === 'slide' || ev.ability === 'ground_pound');
  return false;
}

export class NetClient {
  pid = '';
  localEntity = -1;
  tickHz = TICK_HZ;
  mapSeed = 0;
  mode = '';
  match: MatchState | null = null;
  roster: RosterEntry[] = [];
  lastAck = 0;
  connected = false;
  readonly stats: NetStats = { rttMs: 0, snapshotsPerSec: 0, bytesIn: 0, kbIn: 0, kbOut: 0, pending: 0, interpDelayMs: INTERP_DELAY * 1000, jitterMs: 0, extrapolating: false, extrapolatedFrames: 0, renderedFrames: 0 };
  readonly prediction: PredictionStats = { enabled: true, active: false, last: 0, mean: 0, p95: 0, max: 0, corrections: 0, bigCorrections: 0, maxCorrection: 0, snaps: 0, replays: 0 };
  /** Sent but not yet acknowledged inputs (replayed on reconciliation). */
  readonly unacked: InputCmd[] = [];
  /** Plain debug block, also published as globalThis.__cvc.net in the browser. */
  readonly debug: Record<string, unknown> = {};

  private snaps: Snapshot[] = [];
  private outbox: InputCmd[] = [];
  private readonly now: () => number;
  private readonly redundancy: number;
  private readonly timeoutMs: number;
  private readonly createPredictor: (seed: number) => Promise<LocalPredictor>;
  private readonly onReconcile: ((r: ReconcileResult, ack: number) => void) | null;
  // clock sync: serverTime(s) = localMs/1000 + offset; offset tracks the least-delayed arrivals
  private offset = 0;
  private haveTime = false;
  private jitter = 0;
  private interpDelay = INTERP_DELAY;
  // prediction
  private predictor: LocalPredictor | null = null;
  private predictorSeed = NaN;
  private loadingSeed = NaN;
  private loading: Promise<void> | null = null;
  private predictOn: boolean;
  private errors: number[] = [];
  // liveness / stats
  /** Liveness: consecutive timer periods without any server message (stall-proof, see tickTimers). */
  private silentPeriods = 0;
  private msgSinceTimer = false;
  private readonly pingEvery: number;
  private closeEmitted = false;
  /** 'localSpawn' still owed for the entity announced by the last welcome. */
  private spawnPending = false;
  private joinArgs: { name: string; cls: ClassId; team: TeamId | -1 } | null = null;
  private pingId = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private snapCount = 0;
  private windowStart = 0;
  private windowBytesIn = 0;
  private windowBytesOut = 0;

  constructor(readonly transport: Transport, opts: NetClientOptions = {}) {
    this.now = opts.now ?? (() => performance.now());
    this.redundancy = Math.max(0, Math.floor(opts.redundancy ?? (transport.lossy === false ? 0 : 3)));
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.predictOn = opts.predict ?? defaultPredict();
    this.prediction.enabled = this.predictOn;
    this.createPredictor = opts.createPredictor ?? ((seed) => import('./prediction').then((m) => m.LocalPredictor.create(seed)));
    this.onReconcile = opts.onReconcile ?? null;
    this.windowStart = this.now();
    transport.onMessage((m) => this.onMessage(m));
    transport.onClose((r) => this.markDisconnected(r));
    const every = opts.pingIntervalMs ?? 1000;
    this.pingEvery = every > 0 ? every : 1000;
    if (every > 0) this.timer = setInterval(() => this.tickTimers(), every);
    const dbg = (globalThis as { __cvc?: Record<string, unknown> }).__cvc;
    if (dbg && typeof dbg === 'object') dbg.net = this.debug;
  }

  join(name: string, cls: ClassId, team: TeamId | -1): void {
    this.joinArgs = { name, cls, team };
    this.transport.send({ t: 'hello', v: PROTOCOL_VERSION, name, cls, team });
  }

  /** Queue one sampled input for sending and apply it to the local prediction immediately. */
  pushInput(cmd: InputCmd): void {
    this.outbox.push(cmd);
    this.unacked.push(cmd);
    if (this.unacked.length > MAX_UNACKED) this.unacked.splice(0, this.unacked.length - MAX_UNACKED);
    if (this.predictor?.active) {
      for (const ev of this.predictor.step(cmd, this.now())) bus.emit('game', ev);
    }
  }

  flush(): void {
    if (!this.outbox.length || !this.connected) return;
    // Resend the last few unacked commands too: cheap redundancy against loss.
    const n = this.outbox.length;
    const extra = this.redundancy > 0 ? this.unacked.slice(Math.max(0, this.unacked.length - n - this.redundancy), this.unacked.length - n) : [];
    this.transport.send({ t: 'input', cmds: [...extra, ...this.outbox] });
    this.outbox.length = 0;
  }

  /** Server time we should be rendering remote entities at (seconds). */
  renderTime(nowMs = this.now()): number {
    return this.serverNow(nowMs) - this.interpDelay;
  }

  serverNow(nowMs = this.now()): number {
    return nowMs / 1000 + this.offset;
  }

  latest(): Snapshot | null {
    return this.snaps[this.snaps.length - 1] ?? null;
  }

  latestState(id: number): EntityState | null {
    return this.latest()?.ents.get(id) ?? null;
  }

  /** Unsmoothed predicted state of the local player (null when not predicting). */
  predictedLocal(): EntityState | null {
    if (!this.predictor?.active) return null;
    const base = this.latestState(this.localEntity);
    return base ? this.predictor.predicted(base) : null;
  }

  /** Resolves once the predictor for the current map is loaded (or failed). */
  get predictionReady(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }

  setPrediction(on: boolean): void {
    this.predictOn = on;
    this.prediction.enabled = on;
    if (!on) this.predictor?.deactivate();
    else if (this.connected) this.ensurePredictor(this.mapSeed);
  }

  /** Can this transport re-open after a disconnect? (WebSocket yes, offline worker no.) */
  get canReconnect(): boolean {
    return typeof this.transport.reconnect === 'function';
  }

  /** Re-open the connection and join again as a fresh player (the server keeps no session). */
  async reconnect(): Promise<void> {
    if (!this.transport.reconnect) throw new Error('this transport cannot reconnect');
    this.resetSession();
    await this.transport.reconnect();
    this.closeEmitted = false;
    this.silentPeriods = 0;
    if (this.joinArgs) this.join(this.joinArgs.name, this.joinArgs.cls, this.joinArgs.team);
  }

  /** Stop timers and free the prediction world. */
  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.predictor?.dispose();
    this.predictor = null;
  }

  /**
   * Ping + liveness check (called by the internal timer; tests with pingIntervalMs=0 call it directly).
   * Liveness counts consecutive timer periods with no server message rather than wall time, so a
   * main thread that stalls for seconds (slow frames, tab switches) is never mistaken for a dead link.
   */
  tickTimers(): void {
    const now = this.now();
    this.publishDebug();
    this.silentPeriods = this.msgSinceTimer ? 0 : this.silentPeriods + 1;
    this.msgSinceTimer = false;
    if (this.connected && this.silentPeriods * this.pingEvery >= this.timeoutMs) {
      this.markDisconnected('connection timed out');
      this.transport.close();
      return;
    }
    this.transport.send({ t: 'ping', id: ++this.pingId, ct: now });
  }

  /** Interpolated states of all entities at render time; the local player is predicted when possible. */
  interpolated(nowMs = this.now()): Map<number, EntityState> {
    const out = new Map<number, EntityState>();
    const n = this.snaps.length;
    if (!n) return out;
    const t = this.renderTime(nowMs) * this.tickHz;
    const last = this.snaps[n - 1];
    this.stats.renderedFrames++;
    if (t >= last.tick || n === 1) {
      // Past the newest snapshot: dead-reckon with velocity for a bounded time.
      const dt = Math.min(Math.max(0, (t - last.tick) / this.tickHz), MAX_EXTRAPOLATION);
      this.stats.extrapolating = t > last.tick;
      if (this.stats.extrapolating) this.stats.extrapolatedFrames++;
      for (const [id, s] of last.ents) {
        out.set(id, dt > 0 && !(s.flags & EFlag.Dead) ? { ...s, x: s.x + s.vx * dt, y: s.y + s.vy * dt, z: s.z + s.vz * dt } : s);
      }
    } else {
      this.stats.extrapolating = false;
      let i = n - 1;
      while (i > 0 && this.snaps[i - 1].tick > t) i--;
      if (i === 0) {
        for (const [id, s] of this.snaps[0].ents) out.set(id, s);
      } else {
        const a = this.snaps[i - 1], b = this.snaps[i];
        const f = Math.min(1, Math.max(0, (t - a.tick) / (b.tick - a.tick)));
        for (const [id, sb] of b.ents) {
          const sa = a.ents.get(id);
          if (!sa || Math.hypot(sb.x - sa.x, sb.y - sa.y, sb.z - sa.z) > TELEPORT_DISTANCE) { out.set(id, sb); continue; }
          out.set(id, {
            ...sb,
            x: lerp(sa.x, sb.x, f), y: lerp(sa.y, sb.y, f), z: lerp(sa.z, sb.z, f),
            yaw: lerpAngle(sa.yaw, sb.yaw, f), pitch: lerp(sa.pitch, sb.pitch, f),
            vx: lerp(sa.vx, sb.vx, f), vy: lerp(sa.vy, sb.vy, f), vz: lerp(sa.vz, sb.vz, f),
          });
        }
      }
    }
    if (this.predictor?.active) {
      const base = this.latestState(this.localEntity) ?? out.get(this.localEntity);
      if (base) out.set(this.localEntity, this.predictor.renderState(base, nowMs));
    }
    return out;
  }

  // ---- message handling ----

  private onMessage(m: ServerMsg): void {
    this.msgSinceTimer = true;
    switch (m.t) {
      case 'welcome': {
        const sameSession = this.connected && m.pid === this.pid;
        this.pid = m.pid; this.localEntity = m.entity; this.tickHz = m.tickHz; this.mapSeed = m.mapSeed; this.mode = m.mode;
        this.connected = true;
        this.closeEmitted = false;
        this.unacked.length = 0; // the authority cleared its input queue for the new entity
        this.outbox.length = 0;
        if (!sameSession) { this.snaps.length = 0; this.haveTime = false; this.interpDelay = INTERP_DELAY; }
        this.predictor?.deactivate();
        this.ensurePredictor(m.mapSeed);
        this.spawnPending = true;
        bus.emit('connected', { pid: m.pid, entity: m.entity });
        break;
      }
      case 'snap': this.onSnapshot(m); break;
      case 'roster': this.roster = m.players; bus.emit('roster', m.players); break;
      case 'pong': {
        const rtt = this.now() - m.ct;
        if (rtt >= 0 && rtt < 60_000) this.stats.rttMs = this.stats.rttMs ? lerp(this.stats.rttMs, rtt, 0.2) : rtt;
        break;
      }
      case 'notice': bus.emit('notice', m.text); break;
      case 'chat': bus.emit('chat', { from: m.from, text: m.text, team: m.team }); break;
      case 'reject': this.markDisconnected(m.reason); break;
    }
    this.publishDebug();
  }

  private onSnapshot(m: Extract<ServerMsg, { t: 'snap' }>): void {
    const now = this.now();
    const last = this.snaps[this.snaps.length - 1];
    if (last && m.tick <= last.tick) return; // duplicate or reordered snapshot: never go back in time
    const ents = new Map<number, EntityState>();
    for (const a of m.ents) { const s = unpackEntity(a); ents.set(s.id, s); }
    this.snaps.push({ tick: m.tick, ents });
    while (this.snaps.length > 32) this.snaps.shift();
    // 'localSpawn' fires once the first snapshot with our (new) entity is in, so listeners can read
    // its state (e.g. initial facing: net.latestState(id).yaw).
    if (m.you !== this.localEntity) { this.localEntity = m.you; this.spawnPending = true; }
    if (this.spawnPending && ents.has(m.you)) { this.spawnPending = false; bus.emit('localSpawn', m.you); }
    this.lastAck = m.ack;
    while (this.unacked.length && this.unacked[0].seq <= m.ack) this.unacked.shift();
    this.syncClock(m.tick, now);
    this.reconcileLocal(ents.get(m.you) ?? null, m.ack);
    this.match = m.match;
    bus.emit('match', m.match);
    const local = this.predictor?.active ? this.localEntity : -1;
    for (const ev of m.ev) if (local < 0 || !isPredictedEvent(ev, local)) bus.emit('game', ev);
    this.snapCount++;
    const span = now - this.windowStart;
    if (span >= 1000) {
      const st = this.transport.stats;
      this.stats.snapshotsPerSec = (this.snapCount * 1000) / span;
      if (st) {
        this.stats.kbIn = ((st.bytesIn - this.windowBytesIn) / span) * (1000 / 1024);
        this.stats.kbOut = ((st.bytesOut - this.windowBytesOut) / span) * (1000 / 1024);
        this.windowBytesIn = st.bytesIn; this.windowBytesOut = st.bytesOut;
        this.stats.bytesIn = st.bytesIn;
      }
      this.snapCount = 0; this.windowStart = now;
    }
    this.stats.pending = this.unacked.length;
  }

  private reconcileLocal(s: EntityState | null, ack: number): void {
    const pred = this.predictor;
    if (!pred) return;
    // Dead or seated in a vehicle (the vehicle moves the rider): show the authority's state instead.
    if (!this.predictOn || !s || (s.flags & (EFlag.Dead | EFlag.Mounted))) {
      if (pred.active) pred.deactivate();
      this.prediction.active = false;
      return;
    }
    const r = pred.reconcile(s, ack, this.unacked);
    this.onReconcile?.(r, ack);
    this.prediction.active = pred.active;
    this.prediction.replays += r.replayed;
    if (r.snapped) this.prediction.snaps++;
    else if (r.correction > 0 || r.replayed > 0) {
      this.prediction.corrections++;
      if (r.correction > this.prediction.maxCorrection) this.prediction.maxCorrection = r.correction;
      if (r.correction > 0.5) this.prediction.bigCorrections++;
    }
    if (Number.isFinite(r.error)) {
      this.errors.push(r.error);
      if (this.errors.length > ERROR_WINDOW) this.errors.shift();
      this.prediction.last = r.error;
      if (r.error > this.prediction.max) this.prediction.max = r.error;
      let sum = 0;
      for (const e of this.errors) sum += e;
      this.prediction.mean = sum / this.errors.length;
      if (this.errors.length % 10 === 0) {
        const sorted = [...this.errors].sort((a, b) => a - b);
        this.prediction.p95 = sorted[Math.floor(0.95 * (sorted.length - 1))];
      }
    }
  }

  private ensurePredictor(seed: number): void {
    if (!this.predictOn) return;
    if (this.predictor && this.predictorSeed === seed) return;
    if (this.loading && this.loadingSeed === seed) return;
    this.loadingSeed = seed;
    this.loading = this.createPredictor(seed).then(
      (p) => {
        if (this.loadingSeed !== seed) { p.dispose(); return; }
        this.predictor?.dispose();
        this.predictor = p;
        this.predictorSeed = seed;
      },
      (err) => {
        console.warn('[net] client prediction unavailable:', err);
        this.predictOn = false;
        this.prediction.enabled = false;
      },
    );
  }

  /**
   * Clock sync from snapshot arrivals. The offset follows the least-delayed arrivals (moves up fast,
   * decays slowly), jitter is the mean deviation from it, and the interpolation delay adapts to
   * cover two snapshot intervals plus jitter — slewed at 1 ms per snapshot so motion never warps.
   */
  private syncClock(tick: number, now: number): void {
    const sample = tick / this.tickHz - now / 1000;
    if (!this.haveTime) { this.offset = sample; this.jitter = 0; this.haveTime = true; return; }
    const d = sample - this.offset;
    if (Math.abs(d) > 0.5) { this.offset = sample; this.jitter = 0; return; } // stall / route change: resync
    this.offset += d > 0 ? d * 0.25 : d * 0.02;
    this.jitter += (Math.abs(d) - this.jitter) * 0.05;
    const interval = SNAPSHOT_EVERY / this.tickHz;
    const target = Math.min(MAX_INTERP_DELAY, Math.max(MIN_INTERP_DELAY, 2 * interval + 2.5 * this.jitter));
    this.interpDelay += Math.min(0.001, Math.max(-0.001, target - this.interpDelay));
    this.stats.interpDelayMs = this.interpDelay * 1000;
    this.stats.jitterMs = this.jitter * 1000;
  }

  private markDisconnected(reason: string): void {
    this.connected = false;
    this.predictor?.deactivate();
    this.prediction.active = false;
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    this.publishDebug();
    bus.emit('disconnected', reason);
  }

  private resetSession(): void {
    this.connected = false;
    this.snaps.length = 0;
    this.unacked.length = 0;
    this.outbox.length = 0;
    this.haveTime = false;
    this.interpDelay = INTERP_DELAY;
    this.lastAck = 0;
    this.predictor?.deactivate();
  }

  private publishDebug(): void {
    const d = this.debug;
    d.connected = this.connected;
    d.transport = this.transport.kind;
    d.localEntity = this.localEntity;
    d.rttMs = Math.round(this.stats.rttMs);
    d.kbIn = +this.stats.kbIn.toFixed(2);
    d.kbOut = +this.stats.kbOut.toFixed(2);
    d.snapshotsPerSec = +this.stats.snapshotsPerSec.toFixed(1);
    d.interpDelayMs = Math.round(this.stats.interpDelayMs);
    d.jitterMs = +this.stats.jitterMs.toFixed(1);
    d.pending = this.unacked.length;
    const ts = this.transport.stats;
    if (ts) { d.msgsIn = ts.msgsIn; d.msgsOut = ts.msgsOut; d.bytesIn = ts.bytesIn; d.bytesOut = ts.bytesOut; }
    d.predicting = !!this.predictor?.active;
    d.predErrCm = { last: +(this.prediction.last * 100).toFixed(2), mean: +(this.prediction.mean * 100).toFixed(2), p95: +(this.prediction.p95 * 100).toFixed(2), max: +(this.prediction.max * 100).toFixed(2) };
    d.corrections = this.prediction.corrections;
    d.snaps = this.prediction.snaps;
    const snap = this.latest();
    d.tick = snap?.tick ?? 0;
    d.entities = snap ? [...snap.ents.values()].map((s) => [s.id, s.kind, +s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2)]) : [];
  }
}

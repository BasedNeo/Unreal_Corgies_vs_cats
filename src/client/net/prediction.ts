// Client-side prediction + reconciliation for the local player.
//
// The predictor owns a private headless Sim with NO systems: `Sim.create` builds the static world
// through buildSimWorld -> buildStaticWorld(R, world, createWorldData(seed)) and configures the
// kinematic character controller exactly like the authority, so the only movement code involved is
// the shared `stepCharacter` (+ the map lane's per-character `stepWorldEffects`: jump pads, water).
// Every sampled input is applied immediately (same sanitizeInput, same order as the authority tick). On every snapshot the authoritative state at the
// acknowledged input is compared with what we predicted for that input; on a mismatch we rewind to
// the authoritative state and replay the inputs the authority has not applied yet. The visible
// correction is absorbed into a render offset that decays over ~100 ms (snap when > 2 m).
//
// Both sides round the character to snapshot precision after every step (src/host/quantize.ts), so
// a snapshot is an exact restart point and replays reproduce the authority bit for bit.
// Hidden movement state that snapshots do not carry (airTime, jumpBuffer, jumpsUsed, jumpHeld,
// slideTime, slideCooldown, pounding) is restored from our own history at the acked input.
import { Sim } from '../../sim/sim';
import { stepCharacter, type MoveContext } from '../../sim/systems/movement';
import { stepWorldEffects } from '../../sim/world/systems';
import type { CharacterState, SimEntity } from '../../sim/entity';
import type { EntityState, GameEvent } from '../../shared/protocol';
import { Btn, sanitizeInput, type InputCmd } from '../../shared/input';
import { CLASS_IDS, EFlag } from '../../shared/types';
import { TICK_DT, TICK_HZ } from '../../shared/constants';
import { quantizeMotion } from '../../host/quantize';

/** Corrections larger than this (m) snap instead of being smoothed (respawn, teleport). */
export const SNAP_DISTANCE = 2;
/** Render-offset decay rate (1/s): ~95 % of a correction is gone after 100 ms. */
export const CORRECTION_DECAY = 30;
/** Differences below these are rounding noise from snapshot quantization (1 mm, 1 cm/s). */
const POS_EPS = 0.002;
const VEL_EPS = 0.05;
const MAX_HISTORY = TICK_HZ * 4;
const TICK_MS = 1000 / TICK_HZ;
/** Flags owned by movement (predicted); every other flag comes from the authority. */
export const MOVE_FLAGS = EFlag.Grounded | EFlag.Sprinting | EFlag.Aiming | EFlag.Crouching;

interface Hist {
  seq: number;
  cmd: InputCmd;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  char: CharacterState;
  anim: number;
  flags: number;
}

export interface ReconcileResult {
  /** |authoritative - predicted| position at the acknowledged input (m); NaN if we had no prediction for it. */
  error: number;
  /** Size of the visual correction this reconcile caused (m). */
  correction: number;
  /** True when the local character was (re)created or the correction exceeded SNAP_DISTANCE. */
  snapped: boolean;
  /** Inputs replayed. */
  replayed: number;
}

interface V3 { x: number; y: number; z: number }

export class LocalPredictor {
  private e: SimEntity | null = null;
  private localId = -1;
  private key = '';
  private hist: Hist[] = [];
  private readonly ctx: MoveContext;
  private readonly quiet: MoveContext;
  private events: GameEvent[] = [];
  private prev: V3 = { x: 0, y: 0, z: 0 };
  private cur: V3 = { x: 0, y: 0, z: 0 };
  private offset: V3 = { x: 0, y: 0, z: 0 };
  private tickClock = NaN;
  private lastRender = NaN;

  private constructor(private readonly sim: Sim, readonly seed: number) {
    this.ctx = { world: sim.world, kcc: sim.kcc, emit: (ev) => this.events.push(ev) };
    this.quiet = { world: sim.world, kcc: sim.kcc };
  }

  /** Build the prediction world for a map seed (loads Rapier once per page). */
  static async create(seed: number): Promise<LocalPredictor> {
    const sim = await Sim.create({ seed, systems: [] });
    sim.world.step(); // populate the broad-phase so character queries see the static world
    return new LocalPredictor(sim, seed);
  }

  /** True while a local character is being predicted. */
  get active(): boolean { return this.e !== null; }
  /** Server entity id being predicted (-1 when inactive). */
  get entityId(): number { return this.e?.id ?? -1; }
  /** Current visual correction offset (m). */
  get offsetLength(): number { return Math.hypot(this.offset.x, this.offset.y, this.offset.z); }

  /**
   * Apply one freshly sampled input immediately. Returns the movement events it produced
   * (jump/land/slide/ground_pound) so presentation can react without waiting for the server.
   */
  step(raw: InputCmd, nowMs: number): GameEvent[] {
    const e = this.e;
    if (!e) return [];
    const cmd = sanitizeInput(raw);
    if (!cmd) return [];
    const last = this.hist[this.hist.length - 1];
    if (last && cmd.seq <= last.seq) return [];
    this.events = [];
    this.apply(cmd, this.ctx);
    this.prev = { ...this.cur };
    this.cur = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
    this.tickClock = Number.isFinite(this.tickClock) ? Math.min(this.tickClock + TICK_MS, nowMs) : nowMs;
    return this.events;
  }

  /**
   * Reconcile with the authoritative state of the local entity. `ack` is the last input the authority
   * applied; `pending` are the inputs sent after it (NetClient.unacked), replayed in order.
   */
  reconcile(s: EntityState, ack: number, pending: readonly InputCmd[]): ReconcileResult {
    const key = `${s.id}:${s.species}:${s.cls}:${s.team}`;
    if (!this.e || key !== this.key) {
      this.spawn(s, key);
      this.resetTo(s, null, pending);
      const replayed = this.replay(ack, pending, null);
      this.cur = { x: this.e!.pos.x, y: this.e!.pos.y, z: this.e!.pos.z };
      this.prev = { ...this.cur };
      this.offset = { x: 0, y: 0, z: 0 };
      return { error: NaN, correction: 0, snapped: true, replayed };
    }
    let h: Hist | null = null;
    let keep = 0;
    for (; keep < this.hist.length && this.hist[keep].seq <= ack; keep++) if (this.hist[keep].seq === ack) h = this.hist[keep];
    const error = h ? Math.hypot(s.x - h.x, s.y - h.y, s.z - h.z) : NaN;
    if (h && error <= POS_EPS && Math.hypot(s.vx - h.vx, s.vy - h.vy, s.vz - h.vz) <= VEL_EPS
      && ((s.flags & EFlag.Grounded) !== 0) === h.char.grounded) {
      // Keep the acked entry: if the authority repeats this input (its buffer ran dry) the next
      // snapshot carries the same ack and must be compared against it, not silently re-based.
      this.hist.splice(0, keep - 1);
      return { error, correction: 0, snapped: false, replayed: 0 };
    }
    // Rewind to the authoritative state and replay what the authority has not applied yet.
    const e = this.e;
    const before = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
    this.resetTo(s, h, pending);
    const replayed = this.replay(ack, pending, h?.cmd ?? null);
    const d = { x: before.x - e.pos.x, y: before.y - e.pos.y, z: before.z - e.pos.z };
    const correction = Math.hypot(d.x, d.y, d.z);
    this.cur = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
    if (correction > SNAP_DISTANCE) {
      this.prev = { ...this.cur };
      this.offset = { x: 0, y: 0, z: 0 };
      return { error, correction, snapped: true, replayed };
    }
    // Keep the rendered position continuous: shift the render segment and absorb the jump in the offset.
    this.prev = { x: this.prev.x - d.x, y: this.prev.y - d.y, z: this.prev.z - d.z };
    this.offset = { x: this.offset.x + d.x, y: this.offset.y + d.y, z: this.offset.z + d.z };
    const ol = this.offsetLength;
    if (ol > SNAP_DISTANCE) { const k = SNAP_DISTANCE / ol; this.offset.x *= k; this.offset.y *= k; this.offset.z *= k; }
    return { error, correction, snapped: false, replayed };
  }

  /** Latest predicted state (tick-exact, no smoothing), merged over an authoritative base state. */
  predicted(base: EntityState): EntityState {
    const e = this.e;
    if (!e) return base;
    return this.compose(base, e.pos.x, e.pos.y, e.pos.z);
  }

  /** State to render this frame: sub-tick interpolated between predicted ticks plus the decaying correction. */
  renderState(base: EntityState, nowMs: number): EntityState {
    const e = this.e;
    if (!e) return base;
    const dt = Number.isFinite(this.lastRender) ? Math.max(0, (nowMs - this.lastRender) / 1000) : 0;
    this.lastRender = nowMs;
    const k = Math.exp(-CORRECTION_DECAY * dt);
    this.offset.x *= k; this.offset.y *= k; this.offset.z *= k;
    if (Number.isFinite(this.tickClock) && nowMs - this.tickClock > 2 * TICK_MS) this.tickClock = nowMs - TICK_MS; // stalled frame loop
    const a = Number.isFinite(this.tickClock) ? Math.min(1, Math.max(0, (nowMs - this.tickClock) / TICK_MS)) : 1;
    return this.compose(base,
      this.prev.x + (this.cur.x - this.prev.x) * a + this.offset.x,
      this.prev.y + (this.cur.y - this.prev.y) * a + this.offset.y,
      this.prev.z + (this.cur.z - this.prev.z) * a + this.offset.z);
  }

  /** Stop predicting (death, disconnect, entity change). The next reconcile re-creates the character. */
  deactivate(): void {
    if (this.e) this.sim.removeEntity(this.localId);
    this.sim.removedIds.length = 0;
    this.e = null;
    this.key = '';
    this.hist = [];
    this.offset = { x: 0, y: 0, z: 0 };
    this.tickClock = NaN;
  }

  dispose(): void {
    this.deactivate();
    this.sim.dispose();
  }

  // ---- internals ----

  private compose(base: EntityState, x: number, y: number, z: number): EntityState {
    const e = this.e!;
    return {
      ...base,
      x, y, z,
      vx: e.vel.x, vy: e.vel.y, vz: e.vel.z,
      yaw: e.yaw, pitch: e.pitch,
      anim: e.anim,
      flags: (base.flags & ~MOVE_FLAGS) | (e.flags & MOVE_FLAGS),
    };
  }

  private spawn(s: EntityState, key: string): void {
    if (this.e) this.sim.removeEntity(this.localId);
    const cls = CLASS_IDS[s.cls] ?? 'assault';
    const e = this.sim.spawnCharacter({ team: s.team, species: s.species, cls, name: 'local', x: s.x, y: s.y, z: s.z, yaw: s.yaw });
    this.sim.drainEvents();
    this.localId = e.id;
    e.id = s.id; // events and states carry the authoritative id
    this.e = e;
    this.key = key;
    this.hist = [];
    this.tickClock = NaN;
  }

  private apply(cmd: InputCmd, ctx: MoveContext): void {
    const e = this.e!;
    e.input = cmd;
    e.lastInputSeq = cmd.seq;
    // Same per-character order as the authority tick: movement (200), then map effects (250:
    // jump pads, water). Out-of-bounds respawns are left to the authority (a snap follows).
    stepCharacter(ctx, e, TICK_DT);
    stepWorldEffects(this.sim.worldData, e, TICK_DT, ctx.emit);
    e.prevButtons = cmd.buttons;
    quantizeMotion(e); // the authority rounds to snapshot precision after every tick, so do we
    this.hist.push({
      seq: cmd.seq, cmd,
      x: e.pos.x, y: e.pos.y, z: e.pos.z, vx: e.vel.x, vy: e.vel.y, vz: e.vel.z,
      char: { ...e.char! }, anim: e.anim, flags: e.flags,
    });
    if (this.hist.length > MAX_HISTORY) this.hist.shift();
  }

  /** Rebuild history from the authoritative state at `ack` (kept as the first entry) plus the pending inputs. */
  private replay(ack: number, pending: readonly InputCmd[], ackCmd: InputCmd | null): number {
    const e = this.e!;
    this.hist = [{
      seq: ack, cmd: ackCmd ?? { seq: ack, mx: 0, mz: 0, yaw: e.yaw, pitch: e.pitch, buttons: e.prevButtons, rt: 0 },
      x: e.pos.x, y: e.pos.y, z: e.pos.z, vx: e.vel.x, vy: e.vel.y, vz: e.vel.z,
      char: { ...e.char! }, anim: e.anim, flags: e.flags,
    }];
    let n = 0;
    for (const raw of pending) {
      if (raw.seq <= ack) continue;
      const cmd = sanitizeInput(raw);
      if (!cmd) continue;
      this.apply(cmd, this.quiet);
      n++;
    }
    return n;
  }

  private resetTo(s: EntityState, h: Hist | null, pending: readonly InputCmd[]): void {
    const e = this.e!, c = e.char!;
    this.sim.placeCharacter(e, s.x, s.y, s.z);
    e.vel.x = s.vx; e.vel.y = s.vy; e.vel.z = s.vz;
    e.yaw = s.yaw; e.pitch = s.pitch;
    if (h) {
      Object.assign(c, h.char);
      e.input = h.cmd;
      e.prevButtons = h.cmd.buttons;
    } else {
      // No record of the acked input: assume held buttons were already held (no spurious presses).
      const first = pending[0];
      e.prevButtons = first ? Math.floor(first.buttons) & 0x3ff : 0;
      c.jumpHeld = (e.prevButtons & Btn.Jump) !== 0;
      c.jumpBuffer = 0; c.crouchBuffer = 0;
    }
    const grounded = (s.flags & EFlag.Grounded) !== 0;
    c.grounded = grounded;
    c.sprinting = (s.flags & EFlag.Sprinting) !== 0;
    if (grounded) { c.airTime = 0; c.jumpsUsed = 0; c.pounding = false; }
    e.anim = s.anim;
    e.flags = (e.flags & ~MOVE_FLAGS) | (s.flags & MOVE_FLAGS);
  }
}

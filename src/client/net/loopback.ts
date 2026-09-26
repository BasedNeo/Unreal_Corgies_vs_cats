// In-process network link between a NetClient and a Room on a virtual clock, using exactly the same
// frame path as the Node WebSocket server: JSON text up (parseClientFrame -> validate -> Room),
// per-connection compact snapshots down (SnapEncoder -> SnapDecoder), TCP-like ordered delivery
// with configurable one-way lag, jitter and loss (input/snapshot frames only, like ?loss=).
// Used by the network test matrix (tests/unit/net-*.test.ts) and headless tools; never bundled.
import type { Transport, TransportStats } from './transport';
import type { ClientMsg, EntityState, ServerMsg } from '../../shared/protocol';
import type { InputCmd } from '../../shared/input';
import type { Room, Conn, HandleResult } from '../../host/room';
import { TICK_HZ } from '../../shared/constants';
import { NetClient } from './net-client';
import { LocalPredictor, type ReconcileResult } from './prediction';
import { SnapDecoder, SnapEncoder, decodeServerFrame, encodeServerMsg, type WireEncoding } from '../../host/wire';
import { parseClientFrame } from '../../host/guard';
import { mulberry32 } from '../../shared/rng';

/** Discrete-event scheduler on virtual milliseconds. */
export class EventLoop {
  now = 0;
  private heap: { at: number; n: number; fn: () => void }[] = [];
  private n = 0;

  schedule(at: number, fn: () => void): void {
    const h = this.heap;
    h.push({ at, n: this.n++, fn });
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(h[p], h[i])) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }

  /** Run every task due at or before `t` (in time order), leaving `now` at `t`. */
  advanceTo(t: number): void {
    const h = this.heap;
    while (h.length && h[0].at <= t) {
      const top = h[0];
      const last = h.pop()!;
      if (h.length) {
        h[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < h.length && this.less(h[l], h[m])) m = l;
          if (r < h.length && this.less(h[r], h[m])) m = r;
          if (m === i) break;
          [h[m], h[i]] = [h[i], h[m]];
          i = m;
        }
      }
      this.now = Math.max(this.now, top.at);
      top.fn();
    }
    this.now = Math.max(this.now, t);
  }

  get pending(): number { return this.heap.length; }

  private less(a: { at: number; n: number }, b: { at: number; n: number }): boolean {
    return a.at < b.at || (a.at === b.at && a.n < b.n);
  }
}

export interface LinkEmulation {
  /** One-way latency (ms). */
  lagMs: number;
  /** Extra uniform random delay 0..jitterMs (ms), order preserved. */
  jitterMs: number;
  /** Loss percent for input (up) and snapshot (down) frames. */
  lossPct: number;
  /**
   * TCP head-of-line stalls (what loss really looks like on a WebSocket): with this probability per frame the
   * frame waits for a retransmission (`rtoMs`) and every later frame in that direction queues behind it, then
   * all arrive in a burst. Nothing is dropped. QA W1: the matrix modelled loss as dropped frames only.
   */
  stallPct?: number;
  /** Retransmission delay for a stalled frame (ms). Default max(200, 4 × lagMs). */
  rtoMs?: number;
}

/** Delivery time for the next frame on an ordered link (jitter, then an optional head-of-line stall). */
function dueAt(now: number, last: number, e: LinkEmulation, rng: () => number, stats: { stalls: number }): number {
  let due = Math.max(now + e.lagMs + rng() * e.jitterMs, last);
  if (e.stallPct && rng() * 100 < e.stallPct) { due += e.rtoMs ?? Math.max(200, 4 * e.lagMs); stats.stalls++; }
  return due;
}

export interface LoopbackOptions {
  loop: EventLoop;
  room: Room;
  /** Connection id (becomes the player's pid). */
  id: string;
  up: LinkEmulation;
  down: LinkEmulation;
  /** Seed for loss/jitter randomness. */
  seed: number;
  encoding?: WireEncoding;
}

export interface LinkStats {
  upBytes: number; downBytes: number; snapBytes: number; snaps: number;
  upFrames: number; downFrames: number; upLost: number; downLost: number;
  /** Head-of-line stalls injected (both directions). */
  stalls: number;
  /** Frames the authority refused or flagged as abuse. */
  refused: number;
}

export class LoopbackLink {
  readonly transport: Transport;
  readonly stats: LinkStats = { upBytes: 0, downBytes: 0, snapBytes: 0, snaps: 0, upFrames: 0, downFrames: 0, upLost: 0, downLost: 0, stalls: 0, refused: 0 };
  readonly conn: Conn;
  joined = false;
  open = true;
  private rng: () => number;
  private encoder: SnapEncoder | null;
  private decoder = new SnapDecoder();
  private lastUp = 0;
  private lastDown = 0;
  private onMsg: (m: ServerMsg) => void = () => {};
  private onClose: (r: string) => void = () => {};
  private tstats: TransportStats = { bytesIn: 0, bytesOut: 0, msgsIn: 0, msgsOut: 0 };

  constructor(readonly opts: LoopbackOptions) {
    this.rng = mulberry32(opts.seed);
    this.encoder = (opts.encoding ?? 'delta') === 'delta' ? new SnapEncoder() : null;
    this.conn = { id: opts.id, send: (m) => this.down(m), close: () => this.disconnect('closed by server') };
    const self = this;
    this.transport = {
      kind: 'loopback',
      lossy: opts.up.lossPct > 0,
      get stats() { return self.tstats; },
      send: (m: ClientMsg) => this.sendText(JSON.stringify(m), m.t === 'input'),
      onMessage: (cb) => { this.onMsg = cb; },
      onClose: (cb) => { this.onClose = cb; },
      close: () => this.disconnect('closed by client'),
    };
  }

  /** Send an arbitrary text frame upstream (negative tests: malformed/oversize frames). */
  sendText(text: string, droppable = false): void {
    if (!this.open) return;
    this.stats.upBytes += text.length; this.stats.upFrames++;
    this.tstats.bytesOut += text.length; this.tstats.msgsOut++;
    const { loop, up } = this.opts;
    if (droppable && this.rng() * 100 < up.lossPct) { this.stats.upLost++; return; }
    const due = dueAt(loop.now, this.lastUp, up, this.rng, this.stats);
    this.lastUp = due;
    loop.schedule(due, () => this.deliverUp(text));
  }

  /** Drop the connection (both ends see it closed; the room frees the player's slot). */
  disconnect(reason = 'disconnected'): void {
    if (!this.open) return;
    this.open = false;
    if (this.joined) this.opts.room.leave(this.opts.id);
    this.joined = false;
    this.onClose(reason);
  }

  private deliverUp(text: string): void {
    if (!this.open) return;
    const v = parseClientFrame(text);
    if (!v.ok) { this.stats.refused++; return; }
    const room = this.opts.room;
    if (!this.joined) {
      if (v.msg.t === 'hello') this.joined = !!room.join(this.conn, v.msg);
      return;
    }
    const r: HandleResult = room.handle(this.opts.id, v.msg);
    if (r === 'abuse') this.stats.refused++;
  }

  private down(m: ServerMsg): void {
    if (!this.open) return;
    const text = encodeServerMsg(m, this.encoder);
    this.stats.downBytes += text.length; this.stats.downFrames++;
    if (m.t === 'snap') { this.stats.snapBytes += text.length; this.stats.snaps++; }
    const { loop, down } = this.opts;
    const due = dueAt(loop.now, this.lastDown, down, this.rng, this.stats);
    this.lastDown = due;
    loop.schedule(due, () => {
      if (!this.open) return;
      this.tstats.bytesIn += text.length; this.tstats.msgsIn++;
      const msg = decodeServerFrame(text, this.decoder); // decode every frame in order (reliable stream)
      if (!msg) return;
      if (msg.t === 'snap' && this.rng() * 100 < down.lossPct) { this.stats.downLost++; return; }
      this.onMsg(msg);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// LoopbackSession: a Room plus N NetClients on one virtual clock. The Room ticks at exactly 60 Hz;
// each client samples an input at 60 Hz on its own phase, flushes, and "renders" (interpolated()).

export interface SessionClientOptions {
  id: string;
  up: LinkEmulation;
  down: LinkEmulation;
  seed: number;
  encoding?: WireEncoding;
  name?: string;
  team?: 0 | 1 | -1;
  /** Input for the k-th sampled tick of this client (seq/rt are filled in). null = send nothing. */
  input?: (k: number, net: NetClient) => Partial<InputCmd> | null;
  /** Called after each client frame with the render-time states. */
  onFrame?: (now: number, states: Map<number, EntityState>, net: NetClient) => void;
  onReconcile?: (r: ReconcileResult, ack: number) => void;
  /** Phase of this client's 60 Hz clock relative to the server's (ms). */
  phaseMs?: number;
  predict?: boolean;
}

export interface SessionClient {
  id: string;
  net: NetClient;
  link: LoopbackLink;
  seq: number;
  frames: number;
  opts: SessionClientOptions;
  next: number;
}

export class LoopbackSession {
  readonly loop = new EventLoop();
  readonly clients: SessionClient[] = [];
  private nextServer = 0;
  private nextPing = 1000;

  constructor(readonly room: Room, readonly onServerTick?: () => void) {}

  addClient(o: SessionClientOptions): SessionClient {
    const link = new LoopbackLink({ loop: this.loop, room: this.room, id: o.id, up: o.up, down: o.down, seed: o.seed, encoding: o.encoding });
    const net = new NetClient(link.transport, {
      now: () => this.loop.now, pingIntervalMs: 0, predict: o.predict ?? true,
      createPredictor: (seed) => LocalPredictor.create(seed), onReconcile: o.onReconcile,
    });
    net.join(o.name ?? o.id, 'assault', o.team ?? -1);
    const c: SessionClient = { id: o.id, net, link, seq: 0, frames: 0, opts: o, next: this.loop.now + (o.phaseMs ?? 3) };
    this.clients.push(c);
    return c;
  }

  removeClient(c: SessionClient): void {
    c.link.disconnect();
    c.net.dispose();
    const i = this.clients.indexOf(c);
    if (i >= 0) this.clients.splice(i, 1);
  }

  /** Advance virtual time by `ms`, ticking the room and every client. */
  async run(ms: number): Promise<void> {
    const end = this.loop.now + ms;
    const TICK = 1000 / TICK_HZ;
    for (;;) {
      let t = this.nextServer;
      for (const c of this.clients) if (c.next < t) t = c.next;
      if (this.nextPing < t) t = this.nextPing;
      if (t > end) break;
      this.loop.advanceTo(t);
      if (t === this.nextServer) { this.room.tick(); this.onServerTick?.(); this.nextServer += TICK; }
      if (t === this.nextPing) { for (const c of this.clients) if (c.link.open) c.net.tickTimers(); this.nextPing += 1000; }
      for (const c of this.clients) {
        if (t !== c.next) continue;
        c.next += TICK;
        const net = c.net;
        if (!net.connected || !c.link.open) continue;
        const k = c.seq + 1;
        const part = c.opts.input ? c.opts.input(k, net) : {};
        if (part) {
          c.seq = k;
          net.pushInput({ seq: k, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, ...part, rt: Math.max(0, Math.round(net.renderTime(t) * net.tickHz)) });
          net.flush();
        }
        const states = net.interpolated(t);
        c.frames++;
        c.opts.onFrame?.(t, states, net);
      }
      if (this.clients.some((c) => c.net.connected && !c.net.prediction.active && c.net.prediction.enabled)) {
        await Promise.all(this.clients.map((c) => c.net.predictionReady));
      }
    }
    this.loop.advanceTo(end);
  }
}

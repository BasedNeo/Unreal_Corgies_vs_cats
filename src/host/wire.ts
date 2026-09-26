// Wire encoding for the WebSocket path (server/** encodes, src/client/net/transport.ts decodes).
// ServerMsg stays the API on both ends; only snapshots get a compact per-connection form:
//   - entity fields are quantized exactly like packEntity() and sent as integer deltas against the
//     previous snapshot sent on the same connection (only changed fields, only changed entities);
//   - a full keyframe every `keyframeEvery` snapshots (and on the first) resets the baseline;
//   - match state is sent as changed fields only; event floats are rounded to millimetres.
// This is safe because a WebSocket is an ordered, reliable stream: every frame the encoder writes is
// decoded in order. Emulated loss (?loss=) is applied AFTER decoding, like UDP loss on a real link.
import { packEntity, unpackEntity, type EntityState, type GameEvent, type MatchState, type ServerMsg } from '../shared/protocol';

export type SnapMsg = Extract<ServerMsg, { t: 'snap' }>;

/** Compact snapshot frame. */
export interface SnapWire {
  t: 'S';
  /** tick */
  k: number;
  /** last applied input seq for this client */
  a: number;
  /** the client's entity */
  y: number;
  /** keyframe: the decoder clears its baseline first */
  f?: 1;
  /** [id, fieldMask, ...values]; scaled fields are integer deltas, others absolute */
  e: number[][];
  /** removed entity ids */
  g?: number[];
  /** changed match fields */
  m?: Partial<MatchState>;
  /** presentation events */
  v?: GameEvent[];
}

/** Field order and quantization scale, derived from the shared packer so they can never drift. */
const FIELD_NAMES: string[] = Object.keys(unpackEntity([]));
const N = FIELD_NAMES.length;
if (N > 31) throw new Error('wire: too many entity fields for a 31-bit mask');

function probeScale(index: number): number {
  const probe = 0.123456789;
  const s = unpackEntity([]) as unknown as Record<string, number>;
  s[FIELD_NAMES[index]] = probe;
  const packed = packEntity(s as unknown as EntityState)[index];
  if (packed === probe) return 0; // not rounded by packEntity: sent as an absolute raw number
  for (const r of [1, 10, 100, 1000, 10000, 100000]) if (Math.abs(packed * r - Math.round(packed * r)) < 1e-6) return r;
  return 0;
}
/** 0 = raw absolute value; otherwise values are integers after multiplying by this. */
export const FIELD_SCALES: readonly number[] = FIELD_NAMES.map((_, i) => (i === 0 ? 1 : probeScale(i)));

/** Quantization scale packEntity applies to an EntityState field (0 = sent unrounded). */
export function fieldScale(name: keyof EntityState): number {
  const i = FIELD_NAMES.indexOf(name);
  return i < 0 ? 0 : FIELD_SCALES[i];
}

function quantize(packed: readonly number[]): number[] {
  const q = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    const v = packed[i] ?? 0;
    const s = FIELD_SCALES[i];
    q[i] = s ? Math.round(v * s) : v;
  }
  return q;
}

function dequantize(q: readonly number[]): number[] {
  const out = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    const s = FIELD_SCALES[i];
    out[i] = s && s !== 1 ? q[i] / s : q[i];
  }
  return out;
}

const round3 = (v: number) => (Number.isInteger(v) ? v : Math.round(v * 1000) / 1000);

function roundDeep<T>(v: T): T {
  if (typeof v === 'number') return round3(v) as T;
  if (Array.isArray(v)) return v.map(roundDeep) as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = roundDeep(x);
    return o as T;
  }
  return v;
}

function matchField(k: string, v: unknown): unknown {
  if (k === 'timeLeft' && typeof v === 'number') return Math.round(v * 10) / 10;
  return roundDeep(v);
}

export class SnapEncoder {
  private base = new Map<number, number[]>();
  private match = new Map<string, string>();
  private count = 0;
  constructor(readonly keyframeEvery = 60) {}

  encode(m: SnapMsg): SnapWire {
    const key = this.count++ % this.keyframeEvery === 0;
    if (key) { this.base.clear(); this.match.clear(); }
    const e: number[][] = [];
    const seen = new Set<number>();
    for (const packed of m.ents) {
      const q = quantize(packed);
      const id = q[0];
      seen.add(id);
      const prev = this.base.get(id);
      const rec: number[] = [id, 0];
      let mask = 0;
      for (let i = 1; i < N; i++) {
        if (prev && prev[i] === q[i]) continue;
        mask |= 1 << (i - 1);
        rec.push(FIELD_SCALES[i] && prev ? q[i] - prev[i] : q[i]);
      }
      if (mask) { rec[1] = mask; e.push(rec); }
      else if (!prev) e.push(rec);
      this.base.set(id, q);
    }
    const gone = new Set<number>(m.gone);
    for (const id of this.base.keys()) if (!seen.has(id)) gone.add(id);
    for (const id of gone) this.base.delete(id);
    const w: SnapWire = { t: 'S', k: m.tick, a: m.ack, y: m.you, e };
    if (key) w.f = 1;
    if (gone.size) w.g = [...gone];
    const mm: Record<string, unknown> = {};
    let any = false;
    for (const [k, v] of Object.entries(m.match ?? {})) {
      const r = matchField(k, v);
      const s = JSON.stringify(r);
      if (this.match.get(k) === s) continue;
      this.match.set(k, s);
      mm[k] = r;
      any = true;
    }
    if (any) w.m = mm as Partial<MatchState>;
    if (m.ev && m.ev.length) w.v = m.ev.map(roundDeep);
    return w;
  }
}

const EMPTY_MATCH: MatchState = { mode: '', phase: 'live', timeLeft: 0, score: [0, 0], objective: '', wave: 0, winner: -1 };

export class SnapDecoder {
  private state = new Map<number, number[]>();
  private match: MatchState = { ...EMPTY_MATCH };

  decode(w: SnapWire): SnapMsg {
    if (w.f) { this.state.clear(); this.match = { ...EMPTY_MATCH }; }
    for (const rec of w.e) {
      const id = rec[0], mask = rec[1];
      let q = this.state.get(id);
      if (!q) { q = new Array<number>(N).fill(0); q[0] = id; this.state.set(id, q); }
      let j = 2;
      for (let i = 1; i < N; i++) {
        if (!(mask & (1 << (i - 1)))) continue;
        const v = rec[j++];
        q[i] = FIELD_SCALES[i] ? q[i] + v : v;
      }
    }
    const gone = w.g ?? [];
    for (const id of gone) this.state.delete(id);
    if (w.m) this.match = { ...this.match, ...w.m };
    const ents: number[][] = [];
    for (const q of this.state.values()) ents.push(dequantize(q));
    return { t: 'snap', tick: w.k, ack: w.a, you: w.y, ents, gone, match: { ...this.match, score: [...this.match.score] as [number, number] }, ev: w.v ?? [] };
  }
}

export type WireEncoding = 'delta' | 'raw';

/** Serialize one server message for a connection (snapshots through that connection's encoder). */
export function encodeServerMsg(m: ServerMsg, enc: SnapEncoder | null): string {
  return JSON.stringify(m.t === 'snap' && enc ? enc.encode(m) : m);
}

/** Parse one server frame; compact snapshots go through the connection's decoder. */
export function decodeServerFrame(text: string, dec: SnapDecoder): ServerMsg | null {
  let o: unknown;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const t = (o as { t?: unknown }).t;
  if (t === 'S') return dec.decode(o as SnapWire);
  return typeof t === 'string' ? (o as ServerMsg) : null;
}

// Shared by the S2 audio tests: a strict, tracking stand-in AudioContext and vehicle-scenario helpers. Node has no
// Web Audio; this fake records every node, connection, start/stop and AudioParam target, and throws on the calls
// browsers throw on (non-finite values, exponential ramps to <= 0, stop before start, a second stop or start). Its
// checks allocate nothing, so it also backs the per-update allocation test.
import { expect } from 'vitest';
import type { EntityState } from '../../src/shared/protocol';
import { EFlag, EntityKind } from '../../src/shared/types';
import { VoiceLimiter } from '../../src/client/audio/voice-limiter';
import type { LoopHost, VehicleLoops } from '../../src/client/audio/vehicle-loops';

export const finite = (a: number, b = 0, c = 0) => { if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) throw new TypeError(`non-finite ${a} ${b} ${c}`); };

export class FParam {
  lastTarget = Number.NaN;
  events = 0;
  constructor(public value: number) {}
  setValueAtTime(v: number, t: number) { finite(v, t); this.value = v; this.events++; return this; }
  linearRampToValueAtTime(v: number, t: number) { finite(v, t); this.events++; return this; }
  exponentialRampToValueAtTime(v: number, t: number) { finite(v, t); if (v <= 0) throw new RangeError(`expRamp to ${v}`); this.events++; return this; }
  setTargetAtTime(v: number, t: number, c: number) { finite(v, t, c); if (c < 0) throw new RangeError('tc < 0'); this.lastTarget = v; this.events++; return this; }
  cancelScheduledValues(t: number) { finite(t); return this; }
}

export class FNode {
  dests: unknown[] = [];
  disconnects = 0;
  started = -1;
  stops = 0;
  type = '';
  buffer: unknown = null;
  wave: unknown = null;
  [k: string]: unknown;
  constructor(public kind: string, params: Record<string, number> = {}) {
    for (const k of Object.keys(params)) this[k] = new FParam(params[k]);
  }
  connect(d: unknown) { this.dests.push(d); return d; }
  disconnect() { this.disconnects++; }
  start(t = 0, _offset = 0) { finite(t); if (this.started >= 0) throw new Error('start twice'); this.started = t; }
  stop(t = 0) { finite(t); if (this.started >= 0 && t < this.started) throw new RangeError('stop before start'); if (this.stops > 0) throw new Error('stop twice'); this.stops++; }
  setPeriodicWave(w: unknown) { this.type = 'custom'; this.wave = w; }
  setPosition(x: number, y: number, z: number) { finite(x, y, z); }
}

export interface FakeCtx {
  ctx: BaseAudioContext & { currentTime: number };
  nodes: FNode[];
  params(): FParam[];
}

export function fakeCtx(): FakeCtx {
  const nodes: FNode[] = [];
  const mk = (kind: string, params: Record<string, number>, extra: Record<string, unknown> = {}) => { const n = new FNode(kind, params); Object.assign(n, extra); nodes.push(n); return n; };
  const listener = new FNode('listener', { positionX: 0, positionY: 0, positionZ: 0, forwardX: 0, forwardY: 0, forwardZ: -1, upX: 0, upY: 1, upZ: 0 });
  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    state: 'running',
    destination: new FNode('destination'),
    listener,
    createGain: () => mk('gain', { gain: 1 }),
    createOscillator: () => mk('osc', { frequency: 440, detune: 0 }, { type: 'sine' }),
    createBiquadFilter: () => mk('biquad', { frequency: 350, Q: 1, gain: 0 }, { type: 'lowpass' }),
    createBufferSource: () => mk('src', { playbackRate: 1 }, { loop: false, loopStart: 0 }),
    createWaveShaper: () => mk('shaper', {}),
    createPanner: () => mk('panner', { positionX: 0, positionY: 0, positionZ: 0 }, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, maxDistance: 10000, rolloffFactor: 1 }),
    createDynamicsCompressor: () => mk('comp', { threshold: 0, knee: 0, ratio: 1, attack: 0, release: 0 }),
    createPeriodicWave: (re: Float32Array, im: Float32Array) => { for (const x of re) finite(x); for (const x of im) finite(x); return { re, im }; },
    createBuffer: (_ch: number, len: number, rate: number) => { const d = new Float32Array(len); return { length: len, sampleRate: rate, getChannelData: () => d }; },
    addEventListener() { /* statechange */ },
    resume: async () => {},
    close: async () => {},
  };
  return {
    ctx: ctx as unknown as BaseAudioContext & { currentTime: number },
    nodes,
    params: () => nodes.flatMap((n) => Object.values(n).filter((v): v is FParam => v instanceof FParam)),
  };
}

export const L = { x: 0, y: 1.5, z: 0 };
export function host(f: FakeCtx, limiter = new VoiceLimiter(28)): LoopHost {
  return { ctx: f.ctx, limiter, panningModel: 'equalpower', distanceTo: (x, y, z) => Math.sqrt((x - L.x) ** 2 + (y - L.y) ** 2 + (z - L.z) ** 2) };
}

export function vehicle(id: number, o: Partial<EntityState> = {}): EntityState {
  return {
    id, kind: EntityKind.Vehicle, team: 0, species: 0, cls: -1, seed: id, x: 0, y: 0, z: 8, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0,
    hp: 100, maxHp: 100, anim: 0, flags: EFlag.Grounded | EFlag.Busy, weapon: 99, ammo: 0, ...o,
  };
}

export function run(f: FakeCtx, loops: VehicleLoops, states: Map<number, EntityState>, seconds: number, localId = 1, intensity = 0): void {
  for (let t = 0; t < seconds; t += 1 / 60) { f.ctx.currentTime += 1 / 60; loops.update(states, localId, 1 / 60, intensity); }
}

export const byId = (list: EntityState[]) => new Map(list.map((s) => [s.id, s]));
export const oscs = (f: FakeCtx, type: string) => f.nodes.filter((n) => n.kind === 'osc' && n.type === type);
export const p = (n: FNode, name: string) => n[name] as FParam;
/** The node a node feeds (first connection). */
export const next = (n: FNode) => n.dests[0] as FNode;

export function expectNoLeaks(f: FakeCtx, loops: VehicleLoops, limiter: VoiceLimiter): void {
  const graph = f.nodes.slice(1); // [0] is the engines sub-bus, which lives as long as the manager
  for (const n of graph) expect(n.disconnects, `${n.kind} ${n.type} left connected`).toBeGreaterThanOrEqual(1);
  for (const n of graph.filter((n) => n.kind === 'osc' || n.kind === 'src')) {
    expect(n.started, `${n.kind} ${n.type} never started`).toBeGreaterThanOrEqual(0);
    expect(n.stops, `${n.kind} ${n.type} stops`).toBe(1);
  }
  expect(loops.active).toBe(0);
  expect(loops.debug()).toEqual([]);
  expect(limiter.countIn('engine')).toBe(0);
}


// OWNER: S2 (sound). Vehicle engine loops, driven from the interpolated entity states every frame (index.ts calls
// update() from GameAudio.update). Pure scheduling around the voices in presets-engines.ts:
//
//   which      Vehicles with a rider (EntityState.weapon = rider id ≥ 0, not Dead) run their engine; empty ones
//              are silent. The local rider's vehicle always gets a loop; the rest go nearest first, at most
//              LOOPS.maxActive audible at once, culled beyond 40 m (kart) / 70 m (plane). A playing vehicle keeps
//              its slot until it is 15 % further than the cull distance or clearly farther than a newcomer
//              (hysteresis: no churn when two karts sit at similar distances).
//   how        Each slot = voice → level → { direct (2D) | send → PannerNode } → an "engines" sub-bus → sfx bus.
//              The local rider's vehicle plays centered through `direct` at LOOPS.localGain; everyone else is
//              spatial at LOOPS.remoteGain (≤ localGain, so your own engine is always the loudest). Crossfades
//              between the two when you hop on or off. Remote loops bend pitch with their radial speed (a mild,
//              toy-scale doppler: the plane's flyby "neeeoww").
//   budget     Every audible loop holds one 'engine' voice in the shared VoiceLimiter (priority 1 local, 0 others)
//              acquired with canSteal = false: a loop never pushes a one-shot out. One-shots can steal a loop
//              (footsteps are priority 0 and newer, so a busy fight takes remote engines first); the loop notices
//              on its next update (extend() = false), fades and retries after LOOPS.retry s.
//   mix        The sub-bus ducks with combat intensity (−40 % at full intensity), the voices are low-passed under
//              the footstep/shot bands (see presets-engines.ts).
//   lifecycle  Fade in 0.12 s; on release the voice spools down, the level fades (τ 0.12 s), sources stop on the
//              audio clock 0.7 s later and the graph is disconnected on the next update after that. dispose() stops
//              and disconnects everything at once.
//   cost       Runs at ≤ 30 Hz. Steady state allocates nothing: fixed candidate arrays, a pre-bound Map.forEach
//              callback, one reused params object, knobs that skip unchanged targets, no Math.hypot (V8 allocates
//              in it), and per-update doubles (now, step) kept in fields rather than passed to non-inlined calls
//              (each such argument would be boxed into a HeapNumber).
import type { EntityState } from '../../shared/protocol';
import { EFlag, EntityKind } from '../../shared/types';
import { VEHICLES } from '../../shared/content/vehicles';
import type { VoiceLimiter } from './voice-limiter';
import { kartEngine, planeEngine, type EngineParams, type EngineVoice } from './presets-engines';

/** What the loops need from AudioEngine (structural, so tests can pass a stub). */
export interface LoopHost {
  readonly ctx: BaseAudioContext | null;
  readonly limiter: VoiceLimiter;
  readonly panningModel: PanningModelType;
  distanceTo(x: number, y: number, z: number): number;
}

export const LOOPS = {
  maxActive: 4,
  /** Physical slots: maxActive + room for loops still fading out. */
  slots: 6,
  kartMaxDist: 40, planeMaxDist: 70,
  /** A playing loop is kept until this × its cull distance. */
  keepMult: 1.15,
  /** A playing loop ranks as if this much nearer (hysteresis against slot churn). */
  stickiness: 0.8,
  localGain: 0.45, remoteGain: 0.4,
  kartRef: 3.5, planeRef: 8, rolloff: 1.15,
  fadeIn: 0.12, fadeOut: 0.12, stopAfter: 0.7,
  /** Limiter hold renewed every update; retry delay after a reject or a steal. */
  hold: 1, retry: 0.5,
  /** Update period (s). */
  rate: 1 / 30,
  /** Sub-bus gain at full combat intensity = 1 − duck. */
  duck: 0.4,
  /** "Speed of sound" for the toy doppler (m/s; exaggerated ~2×), and its pitch clamp. */
  dopplerC: 150, dopplerMin: 0.82, dopplerMax: 1.22,
  /** Candidate list size (vehicles considered per update). */
  maxCandidates: 64,
} as const;

const FREE = 0, ON = 1, OFF = 2;
const PLANE_GEAR = VEHICLES.rc_plane.gearHeight;

class Slot {
  state = FREE;
  id = -1;
  plane = false;
  local = false;
  voiceId = -1;
  stopAt = 0;
  stopped = false;
  voice: EngineVoice | null = null;
  level: GainNode | null = null;
  direct: GainNode | null = null;
  send: GainNode | null = null;
  pan: PannerNode | null = null;
  lastDist = 0;
  radial = 0;
}

export interface LoopDebug { id: number; plane: boolean; local: boolean; state: 'on' | 'off' }

export class VehicleLoops {
  readonly stats = { built: 0, released: 0, torn: 0, stolen: 0, rejected: 0 };
  private readonly bus: GainNode;
  private readonly slots: Slot[] = [];
  private readonly candId = new Int32Array(LOOPS.maxCandidates);
  private readonly candScore = new Float64Array(LOOPS.maxCandidates);
  private readonly candTaken = new Uint8Array(LOOPS.maxCandidates);
  private readonly chosen = new Int32Array(LOOPS.maxActive);
  private candN = 0;
  private chosenN = 0;
  private localId = -1;
  private acc = 0;
  private retryAt = 0;
  private duckLast = 1;
  /** This update's audio-clock time and period (fields, not arguments: see "cost" above). */
  private now = 0;
  private step = 0;
  private readonly P: EngineParams = { now: 0, speed: 0.5, throttle: 0.5, boost: false, crouch: false, grounded: true, doppler: 1.5 };
  private readonly scan: (s: EntityState, id: number) => void;

  constructor(private readonly host: LoopHost, ctx: BaseAudioContext, dest: AudioNode) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(dest);
    for (let i = 0; i < LOOPS.slots; i++) this.slots.push(new Slot());
    // Pre-bound once: Map.forEach with this callback allocates nothing per frame.
    this.scan = (s, id) => {
      if (s.kind !== EntityKind.Vehicle || s.weapon < 0 || (s.flags & EFlag.Dead) !== 0) return;
      if (this.candN >= LOOPS.maxCandidates) return;
      let score: number;
      if (s.weapon === this.localId) score = -1;
      else {
        const plane = s.cls === 1;
        const d = this.host.distanceTo(s.x, s.y + (plane ? PLANE_GEAR : 0.5), s.z);
        const playing = this.slotOf(id) !== null;
        const max = (plane ? LOOPS.planeMaxDist : LOOPS.kartMaxDist) * (playing ? LOOPS.keepMult : 1);
        if (d > max) return;
        score = playing ? d * LOOPS.stickiness : d;
      }
      this.candId[this.candN] = id;
      this.candScore[this.candN] = score;
      this.candN++;
    };
  }

  /** Audible (not fading) loops. */
  get active(): number { let n = 0; for (let i = 0; i < this.slots.length; i++) if (this.slots[i].state === ON) n++; return n; }

  /** Live slots for tests/debug (allocates; not for the frame loop). */
  debug(): LoopDebug[] {
    return this.slots.filter((s) => s.state !== FREE).map((s) => ({ id: s.id, plane: s.plane, local: s.local, state: s.state === ON ? 'on' as const : 'off' as const }));
  }

  update(states: Map<number, EntityState>, localId: number, dt: number, intensity: number): void {
    const ctx = this.host.ctx;
    if (!ctx) return;
    this.acc += dt;
    if (this.acc < LOOPS.rate) return;
    this.step = Math.min(0.25, this.acc);
    this.acc = 0;
    const now = ctx.currentTime;
    this.now = now;
    this.P.now = now;
    const lim = this.host.limiter;

    // 1. finished fade-outs → disconnect, free the slot
    for (let i = 0; i < this.slots.length; i++) {
      const sl = this.slots[i];
      if (sl.state === OFF && now >= sl.stopAt) this.teardown(sl);
    }

    // 2. candidates: running engines in range (the local rider's first)
    this.localId = localId;
    this.candN = 0;
    states.forEach(this.scan);

    // 3. the nearest maxActive
    this.chosenN = 0;
    this.candTaken.fill(0, 0, this.candN);
    while (this.chosenN < LOOPS.maxActive) {
      let best = -1;
      for (let c = 0; c < this.candN; c++) if (!this.candTaken[c] && (best < 0 || this.candScore[c] < this.candScore[best])) best = c;
      if (best < 0) break;
      this.candTaken[best] = 1;
      this.chosen[this.chosenN++] = this.candId[best];
    }

    // 4. release what dropped out, or what a one-shot stole
    for (let i = 0; i < this.slots.length; i++) {
      const sl = this.slots[i];
      if (sl.state !== ON) continue;
      if (!this.isChosen(sl.id)) { this.release(sl); continue; }
      if (!lim.extend(sl.voiceId, now + LOOPS.hold)) { this.stats.stolen++; this.release(sl); this.retryAt = now + LOOPS.retry; }
    }

    // 5. start loops for newly chosen vehicles
    for (let c = 0; c < this.chosenN; c++) {
      const id = this.chosen[c];
      if (this.slotOf(id) !== null) continue;
      if (now < this.retryAt) break;
      const sl = this.freeSlot();
      if (!sl) break;
      const s = states.get(id)!;
      const local = s.weapon === localId;
      const acq = lim.acquire(now, LOOPS.hold, local ? 1 : 0, 'engine', false);
      if (!acq) { this.stats.rejected++; this.retryAt = now + LOOPS.retry; break; }
      this.build(ctx, sl, s, local, acq.id);
    }

    // 6. steer the running loops
    for (let i = 0; i < this.slots.length; i++) {
      const sl = this.slots[i];
      if (sl.state !== ON) continue;
      const s = states.get(sl.id);
      if (s) this.steer(sl, s, localId);
    }

    // 7. duck under combat
    const duck = 1 - LOOPS.duck * Math.min(1, Math.max(0, intensity));
    if (Math.abs(duck - this.duckLast) > 0.02) { this.duckLast = duck; this.bus.gain.setTargetAtTime(duck, now, 0.4); }
  }

  /** Stops and disconnects everything now (GameAudio.dispose). */
  dispose(): void {
    const now = this.host.ctx?.currentTime ?? 0;
    for (let i = 0; i < this.slots.length; i++) {
      const sl = this.slots[i];
      if (sl.state === FREE) continue;
      if (!sl.stopped && sl.voice) for (const src of sl.voice.sources) { try { src.stop(now); } catch { /* already stopped */ } }
      sl.stopped = true;
      this.teardown(sl);
    }
    try { this.bus.disconnect(); } catch { /* already */ }
  }

  // ---------------------------------------------------------------------------------------------- internals

  private isChosen(id: number): boolean {
    for (let c = 0; c < this.chosenN; c++) if (this.chosen[c] === id) return true;
    return false;
  }

  private slotOf(id: number): Slot | null {
    for (let i = 0; i < this.slots.length; i++) { const sl = this.slots[i]; if (sl.state === ON && sl.id === id) return sl; }
    return null;
  }

  private freeSlot(): Slot | null {
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i].state === FREE) return this.slots[i];
    return null;
  }

  private build(ctx: BaseAudioContext, sl: Slot, s: EntityState, local: boolean, voiceId: number): void {
    const plane = s.cls === 1;
    const at = this.now + 0.01;
    const jitter = ((s.id * 0.618034) % 1 + 1) % 1; // per-vehicle detune/offsets: two karts never phase-lock
    const voice = plane ? planeEngine(ctx, at, jitter) : kartEngine(ctx, at, jitter);
    const level = ctx.createGain();
    level.gain.value = 0.0001;
    const direct = ctx.createGain();
    const send = ctx.createGain();
    direct.gain.value = local ? 1 : 0;
    send.gain.value = local ? 0 : 1;
    const pan = ctx.createPanner();
    pan.panningModel = this.host.panningModel;
    pan.distanceModel = 'inverse';
    pan.refDistance = plane ? LOOPS.planeRef : LOOPS.kartRef;
    pan.maxDistance = 90;
    pan.rolloffFactor = LOOPS.rolloff;
    const y = s.y + (plane ? PLANE_GEAR : 0.5);
    if (pan.positionX) { pan.positionX.value = s.x; pan.positionY.value = y; pan.positionZ.value = s.z; } else pan.setPosition(s.x, y, s.z);
    voice.out.connect(level);
    level.connect(direct); direct.connect(this.bus);
    level.connect(send); send.connect(pan); pan.connect(this.bus);
    level.gain.setTargetAtTime(local ? LOOPS.localGain : LOOPS.remoteGain, at, LOOPS.fadeIn);
    sl.state = ON; sl.id = s.id; sl.plane = plane; sl.local = local; sl.voiceId = voiceId; sl.stopped = false;
    sl.voice = voice; sl.level = level; sl.direct = direct; sl.send = send; sl.pan = pan;
    sl.lastDist = this.host.distanceTo(s.x, y, s.z);
    sl.radial = 0;
    this.stats.built++;
  }

  private steer(sl: Slot, s: EntityState, localId: number): void {
    const now = this.now, step = this.step;
    const plane = sl.plane;
    const y = s.y + (plane ? PLANE_GEAR : 0.5);
    const local = s.weapon === localId;
    if (local !== sl.local) {
      sl.local = local;
      sl.direct!.gain.setTargetAtTime(local ? 1 : 0, now, 0.15);
      sl.send!.gain.setTargetAtTime(local ? 0 : 1, now, 0.15);
      sl.level!.gain.setTargetAtTime(local ? LOOPS.localGain : LOOPS.remoteGain, now, 0.15);
    }
    const pan = sl.pan!;
    if (pan.positionX) {
      pan.positionX.setTargetAtTime(s.x, now, 0.03); pan.positionY.setTargetAtTime(y, now, 0.03); pan.positionZ.setTargetAtTime(s.z, now, 0.03);
    } else pan.setPosition(s.x, y, s.z);
    // toy doppler from the change in listener distance (covers the listener's own motion too)
    const d = this.host.distanceTo(s.x, y, s.z);
    const rs = (d - sl.lastDist) / step;
    sl.lastDist = d;
    sl.radial += (rs - sl.radial) * Math.min(1, step / 0.15);
    const P = this.P;
    P.doppler = local ? 1 : Math.min(LOOPS.dopplerMax, Math.max(LOOPS.dopplerMin, 1 - sl.radial / LOOPS.dopplerC));
    const f = s.flags;
    P.boost = (f & EFlag.Sprinting) !== 0;
    P.crouch = (f & EFlag.Crouching) !== 0;
    P.grounded = (f & EFlag.Grounded) !== 0;
    if (plane) {
      P.speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz); // not Math.hypot: V8 allocates per call
      P.throttle = planeThrottle(s.ammo);
    } else {
      P.speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
      P.throttle = 0;
    }
    sl.voice!.set(P);
  }

  private release(sl: Slot): void {
    const now = this.now;
    sl.state = OFF;
    sl.voice!.release(this.P);
    sl.level!.gain.setTargetAtTime(0, now, LOOPS.fadeOut);
    sl.stopAt = now + LOOPS.stopAfter;
    for (const src of sl.voice!.sources) { try { src.stop(sl.stopAt); } catch { /* already stopped */ } }
    sl.stopped = true;
    this.stats.released++;
  }

  private teardown(sl: Slot): void {
    if (sl.voice) for (const n of sl.voice.nodes) { try { n.disconnect(); } catch { /* already */ } }
    for (const n of [sl.level, sl.direct, sl.send, sl.pan]) { try { n?.disconnect(); } catch { /* already */ } }
    this.host.limiter.release(sl.voiceId);
    sl.state = FREE; sl.id = -1; sl.voiceId = -1; sl.voice = null;
    sl.level = sl.direct = sl.send = sl.pan = null;
    this.stats.torn++;
  }
}

/** A plane's throttle (0..1) from its snapshot `ammo` — unpackPlaneAux's throttle without the object allocation. */
export function planeThrottle(ammo: number): number {
  const a = Number.isFinite(ammo) ? Math.max(0, Math.round(ammo)) : 500;
  return Math.min(100, Math.floor(a / 1000)) / 100;
}

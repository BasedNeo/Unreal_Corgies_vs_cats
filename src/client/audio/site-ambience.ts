// W10 AU2 (audio-2): construction-site ambience, placed from the WORLD DATA (never from a map id), driven by the same
// weather sample the world view renders, positional where it makes sense. Voices: presets-site.ts.
//
//   emitters (siteEmitters: pure)   props of type 'container_roof' → rain on steel · 'skip' tops → rain on the tarp
//                                   WorldData.floodlights → floodlight hum · lamps 'laserRed' above 40 m (aviation
//                                   lights mark tall steel: the crane) → creaks · container eaves and 'pipe' props →
//                                   drips (in a pipe: with its echo) · water zones with a `tint` (the muddy ditch) →
//                                   running water and drops. None of these exist on the West Yard, so there the module
//                                   builds nothing at all (its soundscape is untouched; tests/unit/audio-w10-lot.test.ts
//                                   renders it bit-identical).
//   mix (siteMix: pure)             weather → levels and rates: dry = floodlight hum, the crane in the wind, far site
//                                   noise over a generator bed; rain = drops pinging on steel, patter on the tarps,
//                                   drips, the ditch running; storm = a roar on steel, tarps flapping, the crane
//                                   groaning, the far site gone quiet. The listener's position picks the nearest
//                                   emitters, and standing in a container turns its roof into a drum overhead.
//   budget                          every audible loop holds an 'ambloop' voice (priority 0, acquired with
//                                   canSteal = false: it never pushes a sound out, and any gameplay sound can take it;
//                                   it fades and retries); one-shots are 'amb', priority 0, at most 3 at once. A loop's
//                                   nodes exist only while it is wanted: built when it first needs to sound, stopped
//                                   and disconnected after AMB.idle s of silence (dry weather runs the hum and the bed
//                                   only).
//   mix bus                         a sub-bus on sfx: −6 dB at full combat intensity (the S2 engine-loop duck is
//                                   −4.4 dB), and the engine's danger duck (a fuse ticking at your feet) on top.
// Wiring (main.ts), next to the weather audio:
//   const siteAudio = createSiteAmbience(audio, worldData);
//   siteAudio.update(worldView.weather, ctx.camera, dt);       // per frame, after weatherAudio.update
import type { Object3D } from 'three/webgpu';
import type { PropBox, WaterZone, WorldData } from '../../shared/world/world-types';
import type { WeatherParams } from '../../shared/world/weather';
import type { AudioEngine, PlayOptions } from './engine';
import {
  craneCreak, ditchWater, drip, dustDrive, floodHum, siteBed, siteDistant, steelRain, tarpRain,
  type DitchWater, type FloodHum, type LoopVoice, type SiteBed, type SteelRain, type TarpRain,
} from './presets-site';

type V3 = [number, number, number];

/** The prop types that carry a sound (a table: a new map opts in by using these types). */
export const SITE_PROPS = { steel: ['container_roof'], tarp: ['skip'], pipe: ['pipe'] } as const;

export interface SiteEmitters {
  steel: PropBox[];
  tarp: PropBox[];
  flood: V3[];
  tall: V3[];
  drips: { x: number; y: number; z: number; pipe: boolean }[];
  ditch: WaterZone[];
}

/** Pure: the site's sound emitters from world data. */
export function siteEmitters(data: WorldData): SiteEmitters {
  const has = (list: readonly string[], t: string) => list.includes(t);
  const steel = data.props.filter((p) => has(SITE_PROPS.steel, p.type));
  // a skip is two solids (the steel body and the tarp over it): keep the top one of each
  const skips = data.props.filter((p) => has(SITE_PROPS.tarp, p.type));
  const tarp = skips.filter((p) => !skips.some((q) => q !== p && Math.hypot(q.x - p.x, q.z - p.z) < 2 && q.y + q.hy > p.y + p.hy));
  const flood: V3[] = (data.floodlights ?? []).map((f) => [f.pos[0], f.pos[1], f.pos[2]]);
  const tall: V3[] = [];
  for (const l of data.lamps ?? []) {
    if (l.col !== 'laserRed' || l.y < 40) continue;
    if (!tall.some((p) => Math.hypot(p[0] - l.x, p[1] - l.y, p[2] - l.z) < 5)) tall.push([l.x, l.y, l.z]);
  }
  const drips: SiteEmitters['drips'] = [];
  for (const r of steel) {
    // eaves: along both long edges, every 6 m, dropping to the ground
    const c = Math.cos(r.rotY), s = Math.sin(r.rotY);
    const long = r.hz >= r.hx, half = long ? r.hz : r.hx, side = long ? r.hx : r.hz;
    for (let u = -half + 2; u <= half - 2 + 1e-6; u += 6) for (const e of [-1, 1]) {
      const lx = long ? e * (side + 0.3) : u, lz = long ? u : e * (side + 0.3);
      const x = r.x + lx * c + lz * s, z = r.z - lx * s + lz * c;
      drips.push({ x, y: data.height(x, z) + 0.1, z, pipe: false });
    }
  }
  const pipes = data.props.filter((p) => has(SITE_PROPS.pipe, p.type));
  const centres: { x: number; y: number; z: number; n: number }[] = [];
  for (const p of pipes) {
    const c = centres.find((q) => Math.hypot(q.x / q.n - p.x, q.z / q.n - p.z) < 3);
    if (c) { c.x += p.x; c.y = Math.min(c.y, p.y); c.z += p.z; c.n++; } else centres.push({ x: p.x, y: p.y, z: p.z, n: 1 });
  }
  for (const c of centres) drips.push({ x: c.x / c.n, y: c.y + 0.2, z: c.z / c.n, pipe: true });
  const ditch = (data.water ?? []).filter((w) => !!w.tint);
  return { steel, tarp, flood, tall, drips, ditch };
}

export function hasSite(e: SiteEmitters): boolean {
  return e.steel.length + e.tarp.length + e.flood.length + e.tall.length + e.ditch.length > 0;
}

// ------------------------------------------------------------------------------------------------ mix (pure)

export const AMB = {
  /** Culling (m): a loop fades out over the last 25 % before this distance and releases its voice. */
  steelMax: 45, tarpMax: 35, floodMax: 60, ditchMax: 40, dripRange: 16,
  /** The second-nearest container sounds only this close (m). */
  steelMax2: 30,
  /** A loop silent this long (s) is torn down (its sources stopped, its nodes disconnected). */
  idle: 3,
  /** Sub-bus duck at full combat intensity. */
  combatDuck: 0.5,
  /** Source levels (play gains) from the AU2 renders (docs/handoff/AU2.md §4). */
  gain: { steel: 0.5, tarp: 0.42, flood: 0.07, ditch: 0.5, bed: 0.35, drip: 0.5, creak: 0.35, distant: 1 },
} as const;

export interface SteelTarget { on: boolean; x: number; y: number; z: number; d: number; inside: boolean; ping: number; pingLvl: number; drum: number; dense: number }
export interface TarpTarget { on: boolean; x: number; y: number; z: number; d: number; ping: number; pingLvl: number; flap: number }
export interface FloodTarget { on: boolean; x: number; y: number; z: number; d: number; hum: number; sizzle: number; sizzleLvl: number }
export interface DitchTarget { on: boolean; x: number; y: number; z: number; d: number; gurgle: number; plop: number; plopLvl: number }
export interface SiteMix {
  steel: [SteelTarget, SteelTarget];
  tarp: TarpTarget;
  flood: [FloodTarget, FloodTarget];
  ditch: DitchTarget;
  /** Far generator bed (2D level). */
  bed: number;
  /** Drops a second at the nearest drip sites (0 when none within AMB.dripRange). */
  dripRate: number;
  /** Mean seconds between crane creaks (Infinity: none) and their strength. */
  creakEvery: number; creakK: number;
  /** Mean seconds between far site noises (Infinity: none). */
  distantEvery: number;
}

const steelT = (): SteelTarget => ({ on: false, x: 0, y: 0, z: 0, d: Infinity, inside: false, ping: 0, pingLvl: 0, drum: 0, dense: 0 });
const floodT = (): FloodTarget => ({ on: false, x: 0, y: 0, z: 0, d: Infinity, hum: 0, sizzle: 0, sizzleLvl: 0 });
export function emptyMix(): SiteMix {
  return {
    steel: [steelT(), steelT()], tarp: { on: false, x: 0, y: 0, z: 0, d: Infinity, ping: 0, pingLvl: 0, flap: 0 },
    flood: [floodT(), floodT()], ditch: { on: false, x: 0, y: 0, z: 0, d: Infinity, gurgle: 0, plop: 0, plopLvl: 0 },
    bed: 0, dripRate: 0, creakEvery: Infinity, creakK: 0, distantEvery: Infinity,
  };
}

/** Nearest point of a yawed box's top face to (lx, ly, lz), into `o` (o.inside: the point is under the box, within
 *  12 m); returns the distance. Allocation-free. */
function onTop(b: PropBox, lx: number, ly: number, lz: number, o: { x: number; y: number; z: number; inside: boolean }): number {
  const c = Math.cos(b.rotY), s = Math.sin(b.rotY);
  const dx = lx - b.x, dz = lz - b.z;
  const ux = dx * c - dz * s, uz = dx * s + dz * c;          // world → box frame
  const inX = Math.abs(ux) < b.hx, inZ = Math.abs(uz) < b.hz;
  const qx = Math.max(-b.hx, Math.min(b.hx, ux)), qz = Math.max(-b.hz, Math.min(b.hz, uz));
  o.x = b.x + qx * c + qz * s; o.z = b.z - qx * s + qz * c; o.y = b.y + b.hy;
  o.inside = inX && inZ && ly < b.y - b.hy && ly > b.y - 12;
  const ex = lx - o.x, ey = ly - o.y, ez = lz - o.z;
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}

const fade = (d: number, max: number) => Math.max(0, Math.min(1, (max - d) / (max * 0.25)));
const P = { x: 0, y: 0, z: 0, inside: false };

/** Pure: the site's loop targets and one-shot rates for a weather and a listener position (allocation-free with `out`). */
export function siteMix(e: SiteEmitters, w: Readonly<Pick<WeatherParams, 'rain' | 'storm' | 'wind' | 'wet'>>, lx: number, ly: number, lz: number, out: SiteMix = emptyMix()): SiteMix {
  const r = Math.max(0, Math.min(1, w.rain)), wet = Math.max(0, Math.min(1, w.wet)), wind = Math.max(0, Math.min(1, w.wind));
  const raining = r > 0.02;
  // rain on steel: the two nearest container roofs
  const [a, b] = out.steel;
  a.on = b.on = false; a.d = b.d = Infinity;
  for (const box of e.steel) {
    const d = onTop(box, lx, ly, lz, P);
    const t = d < a.d ? (Object.assign(b, a), a) : d < b.d ? b : null;
    if (!t) continue;
    t.d = d; t.x = P.x; t.y = P.y; t.z = P.z; t.inside = P.inside;
  }
  for (let i = 0; i < 2; i++) {
    const t = out.steel[i];
    const f = t.d < Infinity ? fade(t.d, i === 0 ? AMB.steelMax : AMB.steelMax2) : 0;
    t.on = raining && f > 0;
    t.ping = 60 + 700 * r;
    t.pingLvl = t.on ? AMB.gain.steel * (0.4 + 0.6 * r) * (t.inside ? 2.2 : 1) * f : 0;
    t.drum = t.on ? (t.inside ? 1 : 0.25) * f : 0;
    t.dense = t.on ? AMB.gain.steel * 0.5 * r * r * (t.inside ? 1.6 : 1) * f : 0;
  }
  // rain on the nearest tarp
  const tp = out.tarp;
  tp.on = false; tp.d = Infinity;
  for (const box of e.tarp) {
    const d = onTop(box, lx, ly, lz, P);
    if (d < tp.d) { tp.d = d; tp.x = P.x; tp.y = P.y; tp.z = P.z; }
  }
  const tf = tp.d < Infinity ? fade(tp.d, AMB.tarpMax) : 0;
  const flap = Math.max(0, wind - 0.45) / 0.55;
  tp.on = tf > 0 && (raining || flap > 0);
  tp.ping = 150 + 900 * r;
  tp.pingLvl = raining ? AMB.gain.tarp * tf : 0;
  tp.flap = AMB.gain.tarp * 1.3 * flap * tf;
  // floodlight hum: the two nearest heads
  const [f0, f1] = out.flood;
  f0.on = f1.on = false; f0.d = f1.d = Infinity;
  for (const h of e.flood) {
    const d = Math.hypot(lx - h[0], ly - h[1], lz - h[2]);
    const t = d < f0.d ? (Object.assign(f1, f0), f0) : d < f1.d ? f1 : null;
    if (!t) continue;
    t.d = d; t.x = h[0]; t.y = h[1]; t.z = h[2];
  }
  for (const t of out.flood) {
    const f = t.d < Infinity ? fade(t.d, AMB.floodMax) : 0;
    t.on = f > 0;
    t.hum = AMB.gain.flood * f;
    t.sizzle = 30 + 400 * r;
    t.sizzleLvl = raining ? AMB.gain.flood * 4 * f : 0;
  }
  // the ditch: its nearest point
  const dt = out.ditch;
  dt.on = false; dt.d = Infinity;
  for (const z of e.ditch) {
    let px = z.x, pz = z.z;
    if (z.shape === 'rect') { px = Math.max(z.x - (z.hx ?? 0), Math.min(z.x + (z.hx ?? 0), lx)); pz = Math.max(z.z - (z.hz ?? 0), Math.min(z.z + (z.hz ?? 0), lz)); }
    else { const rr = z.r ?? 0, ddx = lx - z.x, ddz = lz - z.z, l = Math.hypot(ddx, ddz); if (l > rr) { px = z.x + ddx / l * rr; pz = z.z + ddz / l * rr; } else { px = lx; pz = lz; } }
    const d = Math.hypot(lx - px, ly - z.surfaceY, lz - pz);
    if (d < dt.d) { dt.d = d; dt.x = px; dt.y = z.surfaceY; dt.z = pz; }
  }
  const df = dt.d < Infinity ? fade(dt.d, AMB.ditchMax) : 0;
  dt.gurgle = AMB.gain.ditch * wet * df;
  dt.plop = 80 + 900 * r;
  dt.plopLvl = raining ? AMB.gain.ditch * 0.8 * df : 0;
  dt.on = dt.gurgle > 0 || dt.plopLvl > 0;
  // one-shots and the bed
  let nearDrip = false;
  for (const s of e.drips) if (Math.abs(s.x - lx) < AMB.dripRange && Math.abs(s.z - lz) < AMB.dripRange) { nearDrip = true; break; }
  out.dripRate = nearDrip ? 1.2 * wet + 1.5 * r : 0;
  out.creakEvery = e.tall.length ? 14 - 8 * wind : Infinity;
  out.creakK = wind;
  const site = e.flood.length + e.tall.length > 0;
  out.distantEvery = site && r < 0.95 ? 10 / (1 - 0.8 * r) : Infinity;
  out.bed = site ? AMB.gain.bed * (1 - 0.6 * r) : 0;
  return out;
}

// ------------------------------------------------------------------------------------------------ runtime

export interface SiteAmbience {
  /** Per frame, with the weather the world view renders (WorldView.weather) and the camera (the listener). */
  update(w: WeatherParams, listener: Object3D, dt: number): void;
  /** False on a world without site emitters (nothing is built). */
  readonly active: boolean;
  readonly emitters: SiteEmitters;
  /** This frame's targets (tests / debug). */
  readonly mix: SiteMix;
  readonly stats: { drips: number; creaks: number; distant: number; stolen: number };
  /** 'low' drops the second container and floodlight loops (the worst case halves); 'medium' / 'high' keep them. */
  setQuality(q: 'low' | 'medium' | 'high'): void;
  /** Loop voices built right now (their nodes exist), and how many were built / torn down so far. */
  readonly loops: number;
  readonly lifecycle: { built: number; torn: number };
  dispose(): void;
}

type Kind = 'steel' | 'tarp' | 'flood' | 'ditch';
interface Slot {
  kind: Kind;
  make: (ctx: BaseAudioContext) => LoopVoice;
  voice: LoopVoice | null;
  level: GainNode; pan: PannerNode;
  voiceId: number; retryAt: number; lvl: number; quietSince: number;
}
/** Stops a loop's sources on the clock and disconnects its nodes. */
function teardown(v: LoopVoice, at: number): void {
  for (const src of v.sources) { try { src.stop(at); } catch { /* already */ } }
  for (const n of v.nodes) { try { n.disconnect(); } catch { /* already */ } }
}

/** `audio`: the GameAudio (its engine and combat intensity). */
export function createSiteAmbience(audio: { readonly engine: AudioEngine; readonly intensity: number }, data: WorldData): SiteAmbience {
  const engine = audio.engine;
  const emitters = siteEmitters(data);
  const mix = emptyMix();
  const stats = { drips: 0, creaks: 0, distant: 0, stolen: 0 };
  const active = hasSite(emitters);
  if (!active) return { update() {}, setQuality() {}, active, emitters, mix, stats, loops: 0, lifecycle: { built: 0, torn: 0 }, dispose() {} };

  let seed = (data.seed * 2654435761) >>> 0 || 1;
  const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  let bus: GainNode | null = null;
  let bed: SiteBed | null = null;
  const slots: Slot[] = [];
  const stats2 = { built: 0, torn: 0 };
  let clock = 0, acc = 1, creakIn = 4 + 6 * rand(), distantIn = 3 + 5 * rand(), busLast = -1, low = false;
  const one: PlayOptions = {};

  engine.whenReady((ctx) => {
    bus = ctx.createGain(); bus.gain.value = 1; bus.connect(engine.buses!.sfx);
    const mk = (kind: Kind, make: (c: BaseAudioContext) => LoopVoice, ref: number, model: DistanceModelType, max: number) => {
      const level = ctx.createGain(); level.gain.value = 0;
      const pan = ctx.createPanner();
      // equal-power: diffuse beds gain nothing from HRTF, which costs ~5× more per panner (AU2 offline renders)
      pan.panningModel = 'equalpower'; pan.distanceModel = model; pan.refDistance = ref; pan.maxDistance = max; pan.rolloffFactor = model === 'linear' ? 1 : 1.1;
      level.connect(pan); pan.connect(bus!);
      slots.push({ kind, make, voice: null, level, pan, voiceId: -1, retryAt: 0, lvl: 0, quietSince: -1 });
    };
    const off = () => { const o = rand() * 1.9; return o; };
    if (emitters.steel.length) { const a = off(), b = off(); mk('steel', (c) => steelRain(c, a), 5, 'inverse', 80); mk('steel', (c) => steelRain(c, b), 5, 'inverse', 80); }
    if (emitters.tarp.length) { const a = off(); mk('tarp', (c) => tarpRain(c, a), 4, 'inverse', 80); }
    if (emitters.flood.length) { const a = off(), b = off(); mk('flood', (c) => floodHum(c, a), 10, 'linear', AMB.floodMax); mk('flood', (c) => floodHum(c, b), 10, 'linear', AMB.floodMax); }
    if (emitters.ditch.length) { const a = off(); mk('ditch', (c) => ditchWater(c, a), 4, 'inverse', 80); }
    if (emitters.flood.length + emitters.tall.length) { bed = siteBed(ctx, off()); bed.out.connect(bus); }
  });

  const setT = (p: AudioParam, v: number, tc: number) => { const c = engine.ctx; if (c) p.setTargetAtTime(v, c.currentTime, tc); };
  /** Hold (or take, or give back) a slot's limiter voice for the level it wants; returns the level it may play at. */
  const hold = (s: Slot, want: number, now: number): number => {
    const lim = engine.limiter;
    if (want <= 1e-3) { if (s.voiceId >= 0) { lim.release(s.voiceId); s.voiceId = -1; } return 0; }
    if (s.voiceId >= 0 && !lim.extend(s.voiceId, now + 1)) { s.voiceId = -1; s.retryAt = now + 0.5; stats.stolen++; }
    if (s.voiceId < 0) {
      if (now < s.retryAt) return 0;
      const acq = lim.acquire(now, 1, 0, 'ambloop', false);
      if (!acq) { s.retryAt = now + 0.5; return 0; }
      s.voiceId = acq.id;
    }
    return want;
  };
  const playAt = (recipe: typeof drip, x: number, y: number, z: number, k: number, g: number, ref: number, max: number) => {
    one.x = x; one.y = y; one.z = z; one.k = k; one.gain = g; one.priority = 0; one.category = 'amb'; one.refDist = ref; one.maxDist = max; one.bus = 'sfx';
    return engine.play(recipe, one);
  };

  return {
    active, emitters, mix, stats,
    update(w, listener, dt) {
      clock += dt; acc += dt;
      const e = listener.matrixWorld.elements, lx = e[12], ly = e[13], lz = e[14];
      const ctx = engine.ctx;
      const duck = engine.bedDuck();
      // the sub-bus: combat duck × danger duck (fast when a fuse ticks)
      if (bus) {
        const v = (1 - AMB.combatDuck * Math.min(1, Math.max(0, audio.intensity))) * duck;
        if (Math.abs(v - busLast) > 0.01) { busLast = v; setT(bus.gain, v, duck < 1 ? 0.08 : 0.4); }
      }
      if (acc >= 0.1) {
        acc = 0;
        siteMix(emitters, w, lx, ly, lz, mix);
        const now = ctx?.currentTime ?? clock;
        let si = 0, fi = 0;
        for (const s of slots) {
          let want = 0, x = 0, y = 0, z = 0;
          if (s.kind === 'steel') { const t = mix.steel[si++]; want = t.on ? Math.max(t.pingLvl, t.dense) : 0; x = t.x; y = t.y; z = t.z; }
          else if (s.kind === 'tarp') { const t = mix.tarp; want = t.on ? Math.max(t.pingLvl, t.flap) : 0; x = t.x; y = t.y; z = t.z; }
          else if (s.kind === 'flood') { const t = mix.flood[fi++]; want = t.on ? t.hum : 0; x = t.x; y = t.y; z = t.z; }
          else { const t = mix.ditch; want = t.on ? Math.max(t.gurgle, t.plopLvl) : 0; x = t.x; y = t.y; z = t.z; }
          if (low && ((s.kind === 'steel' && si === 2) || (s.kind === 'flood' && fi === 2))) want = 0;
          const lvl = hold(s, want, now) > 0 ? 1 : 0;
          // the voice's nodes: built when it first sounds, torn down after AMB.idle s of silence
          if (lvl > 0 && !s.voice && ctx) { s.voice = s.make(ctx); s.voice.out.connect(s.level); stats2.built++; }
          if (lvl > 0) s.quietSince = -1; else if (s.quietSince < 0) s.quietSince = now;
          if (!lvl && s.voice && now - s.quietSince > AMB.idle) { teardown(s.voice, now + 0.02); s.voice = null; stats2.torn++; }
          if (s.voice && ctx) {
            if (s.kind === 'steel') {
              const t = mix.steel[si - 1], v = s.voice as SteelRain;
              setT(v.ping.gain, dustDrive(t.ping, ctx.sampleRate), 0.5); setT(v.pingLvl.gain, t.pingLvl, 0.5); setT(v.drum.gain, t.drum, 0.3); setT(v.dense.gain, t.dense, 0.5);
            } else if (s.kind === 'tarp') {
              const t = mix.tarp, v = s.voice as TarpRain;
              setT(v.ping.gain, dustDrive(t.ping, ctx.sampleRate), 0.5); setT(v.pingLvl.gain, t.pingLvl, 0.5); setT(v.flap.gain, t.flap, 0.6);
            } else if (s.kind === 'flood') {
              const t = mix.flood[fi - 1], v = s.voice as FloodHum;
              setT(v.hum.gain, t.hum, 0.3); setT(v.sizzle.gain, dustDrive(t.sizzle, ctx.sampleRate), 0.5); setT(v.sizzleLvl.gain, t.sizzleLvl, 0.5);
            } else {
              const t = mix.ditch, v = s.voice as DitchWater;
              setT(v.gurgle.gain, t.gurgle, 0.6); setT(v.plop.gain, dustDrive(t.plop, ctx.sampleRate), 0.5); setT(v.plopLvl.gain, t.plopLvl, 0.5);
            }
          }
          if (lvl !== s.lvl || lvl > 0) {
            if (lvl !== s.lvl) setT(s.level.gain, lvl, lvl > 0 ? 0.15 : 0.12);
            s.lvl = lvl;
            if (lvl > 0 && ctx) {
              const P = s.pan;
              if (P.positionX) { setT(P.positionX, x, 0.1); setT(P.positionY, y, 0.1); setT(P.positionZ, z, 0.1); } else P.setPosition(x, y, z);
            }
          }
        }
        if (bed && ctx) setT(bed.level.gain, mix.bed, 1);
      }
      // one-shots (their gains take the ducks at trigger time)
      const oneDuck = (1 - AMB.combatDuck * Math.min(1, Math.max(0, audio.intensity))) * duck;
      if (mix.dripRate > 0 && rand() < mix.dripRate * dt) {
        // a near site, not always the nearest (each drop picks the nearest after a random stretch)
        let best = -1, bd = Infinity;
        for (let i = 0; i < emitters.drips.length; i++) {
          const s = emitters.drips[i];
          const d = Math.hypot(s.x - lx, s.z - lz) * (0.6 + 0.8 * rand());
          if (d < bd) { bd = d; best = i; }
        }
        const s = emitters.drips[best];
        if (s && Math.hypot(s.x - lx, s.z - lz) < AMB.dripRange + 4 && playAt(drip, s.x, s.y, s.z, s.pipe ? 1 : 0, AMB.gain.drip * oneDuck, 3, 24)) stats.drips++;
      }
      creakIn -= dt;
      if (creakIn <= 0) {
        creakIn = mix.creakEvery < Infinity ? mix.creakEvery * (0.5 + rand()) : 5;
        if (mix.creakEvery < Infinity && emitters.tall.length) {
          const t = emitters.tall[Math.floor(rand() * emitters.tall.length)];
          if (playAt(craneCreak, t[0], t[1], t[2], mix.creakK, AMB.gain.creak * oneDuck, 45, 320)) stats.creaks++;
        }
      }
      distantIn -= dt;
      if (distantIn <= 0) {
        distantIn = mix.distantEvery < Infinity ? mix.distantEvery * (0.5 + rand()) : 5;
        if (mix.distantEvery < Infinity) {
          const a = rand() * Math.PI * 2, far = 100 + 40 * rand();
          if (playAt(siteDistant, lx + Math.cos(a) * far, ly + 4, lz + Math.sin(a) * far, Math.floor(rand() * 4), AMB.gain.distant * oneDuck, 45, 400)) stats.distant++;
        }
      }
    },
    setQuality(q) { low = q === 'low'; },
    get loops() { let n = 0; for (const s of slots) if (s.voice) n++; return n; },
    lifecycle: stats2,
    dispose() {
      const at = engine.ctx?.currentTime ?? 0;
      for (const s of slots) {
        if (s.voiceId >= 0) engine.limiter.release(s.voiceId);
        if (s.voice) teardown(s.voice, at);
        try { s.level.disconnect(); s.pan.disconnect(); } catch { /* already */ }
      }
      if (bed) teardown(bed, at);
      try { bus?.disconnect(); } catch { /* already */ }
      slots.length = 0; bus = null; bed = null;
    },
  };
}

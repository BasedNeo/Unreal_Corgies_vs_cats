// OWNER: G1 (world lane) — added beside L5's audio engine. Weather ambience driven by the same weather
// sample the world view renders (WorldView.weather), all procedural (no files):
//   rain bed    pink noise, band-limited; a brown-noise "roar" layer joins in storms
//   wind        brown noise through a slowly wandering band-pass, gusting with an LFO
//   thunder     one-shot rumble (+ a crack for near strikes), scheduled strike.thunderDelay seconds
//               after each lightning flash (deterministic strikes: every client hears the same storm)
//   sprinkler   spatial "tch-tch-tch" hiss at the nearest running garden sprinkler
// Loops start silent and follow their targets with setTargetAtTime (no clicks). Nothing is created
// before the engine's AudioContext exists (first user gesture). Wiring (main.ts):
//   const weatherAudio = createWeatherAudio(audio.engine, worldData);
//   // per frame, after worldView.update(dt, camera, tick):
//   weatherAudio.update(worldView.weather, worldView.tick, ctx.camera, dt);
import type { Object3D } from 'three/webgpu';
import type { AudioEngine } from './engine';
import type { Voice } from './synth';
import { ad, filter, gain, glide, noise, noiseSrc } from './synth';
import type { WorldData } from '../../shared/world/world-data';
import { forEachStrike, sprinklerAt, type SprinklerState, type Strike, type WeatherSample } from '../../shared/world/weather';
import { TICK_HZ } from '../../shared/constants';

export interface WeatherAudio {
  /** tick: the tick the sample was taken at (WorldView.tick); NaN pauses thunder scheduling. */
  update(w: WeatherSample, tick: number, listener: Object3D, dt: number): void;
  /** Current loop targets (0..1) — debug/tests. */
  readonly levels: { rain: number; roar: number; wind: number; sprinkler: number };
  dispose(): void;
}

/** Thunder: low rumble with a falling low-pass; near strikes open with a crack. k = strike power 0..1. */
export function thunder(v: Voice, k: number): number {
  const near = Math.max(0, Math.min(1, k));
  const dur = 3.4 + 1.6 * (1 - near);
  const body = gain(v, 0.0001);
  const lp = filter(v, 'lowpass', 900, 0.7, body);
  glide(lp.frequency, v.t, 500 + 900 * near, 90, dur * 0.8);
  noiseSrc(v, lp, dur, 'brown', v.t, 0.7 + 0.2 * v.rand());
  // rolling: two swells
  const g = body.gain;
  g.cancelScheduledValues(v.t);
  g.setValueAtTime(0.0001, v.t);
  g.linearRampToValueAtTime(0.55 + 0.45 * near, v.t + 0.06 + 0.35 * (1 - near));
  g.exponentialRampToValueAtTime(0.25 + 0.2 * near, v.t + dur * 0.35);
  g.linearRampToValueAtTime(0.45 + 0.2 * near, v.t + dur * 0.5);
  g.exponentialRampToValueAtTime(0.0001, v.t + dur);
  if (near > 0.45) {
    const crack = gain(v, 0.0001);
    const hp = filter(v, 'highpass', 1200, 0.5, crack);
    noiseSrc(v, hp, 0.5, 'white');
    ad(crack.gain, v.t, 0.004, 0.5 * near, 0.35);
  }
  return dur;
}

export function createWeatherAudio(engine: AudioEngine, data: WorldData): WeatherAudio {
  interface Loops {
    rain: GainNode; roar: GainNode; wind: GainNode; windBp: BiquadFilterNode; spr: GainNode; sprPan: PannerNode; sprAm: GainNode;
    nodes: AudioNode[];
  }
  let L: Loops | null = null;
  const levels = { rain: 0, roar: 0, wind: 0, sprinkler: 0 };
  const sprState: SprinklerState = { on: 0, angle: 0, dirX: 1, dirZ: 0, t: -1 };
  const pending: { at: number; power: number; id: number }[] = [];
  let lastTick = NaN;
  let clock = 0;

  engine.whenReady((ctx) => {
    const bus = engine.buses!.sfx;
    const nodes: AudioNode[] = [];
    const loop = (kind: 'white' | 'pink' | 'brown', rate = 1): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = noise(ctx, kind);
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(ctx.currentTime + 0.01, Math.random() * 1.5);   // presentation-only jitter (client code)
      nodes.push(s);
      return s;
    };
    const g = (to: AudioNode) => { const n = ctx.createGain(); n.gain.value = 0; n.connect(to); nodes.push(n); return n; };
    const f = (type: BiquadFilterType, freq: number, q: number, to: AudioNode) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = freq; n.Q.value = q; n.connect(to); nodes.push(n); return n; };
    // rain: pink noise, high-passed hiss + a mid patter band
    const rain = g(bus);
    const rainHp = f('highpass', 450, 0.5, rain);
    loop('pink', 1.1).connect(rainHp);
    const patter = f('bandpass', 2600, 0.8, rain);
    loop('white', 0.9).connect(patter);
    // storm roar: brown noise low-passed
    const roar = g(bus);
    loop('brown', 0.8).connect(f('lowpass', 420, 0.6, roar));
    // wind: brown noise through a wandering band-pass (LFO on the frequency) + gust LFO on the gain
    const wind = g(bus);
    const windBp = f('bandpass', 420, 1.4, wind);
    loop('brown', 1.3).connect(windBp);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 180;
    lfo.connect(lfoAmt); lfoAmt.connect(windBp.frequency); lfo.start(); nodes.push(lfo, lfoAmt);
    // sprinkler: band-passed white noise, amplitude-chopped at ~6 Hz, spatial
    const sprPan = ctx.createPanner();
    sprPan.panningModel = engine.panningModel; sprPan.distanceModel = 'inverse'; sprPan.refDistance = 4; sprPan.rolloffFactor = 1.2; sprPan.maxDistance = 80;
    sprPan.connect(bus); nodes.push(sprPan);
    const spr = g(sprPan);
    const sprAm = ctx.createGain(); sprAm.gain.value = 0.55; sprAm.connect(spr); nodes.push(sprAm);
    const chop = ctx.createOscillator(); chop.type = 'square'; chop.frequency.value = 6.5;
    const chopAmt = ctx.createGain(); chopAmt.gain.value = 0.45; chop.connect(chopAmt); chopAmt.connect(sprAm.gain); chop.start(); nodes.push(chop, chopAmt);
    loop('white', 1).connect(f('bandpass', 3800, 0.9, sprAm));
    L = { rain, roar, wind, windBp, spr, sprPan, sprAm, nodes };
  });

  const set = (p: AudioParam, v: number, tc: number) => { const ctx = engine.ctx; if (ctx) p.setTargetAtTime(v, ctx.currentTime, tc); };

  return {
    levels,
    update(w, tick, listener, dt) {
      clock += dt;
      // levels (perceptual: quiet breeze always, rain and wind scale up)
      levels.rain = 0.34 * Math.pow(w.rain, 0.8);
      levels.roar = 0.3 * w.storm * w.rain;
      levels.wind = 0.035 + 0.3 * Math.pow(Math.max(0, w.wind - 0.2) / 0.8, 1.4);
      // nearest running sprinkler
      let best = Infinity, sx = 0, sy = 0, sz = 0, son = 0;
      const e = listener.matrixWorld.elements, lx = e[12], ly = e[13], lz = e[14];
      if (Number.isFinite(tick)) for (const sp of data.sprinklers ?? []) {
        sprinklerAt(data, sp, tick, sprState); // W9 L3: the world's schedule
        if (sprState.on <= 0) continue;
        const d = Math.hypot(sp.x - lx, sp.y - ly, sp.z - lz);
        if (d < best) { best = d; sx = sp.x; sy = sp.y; sz = sp.z; son = sprState.on; }
      }
      levels.sprinkler = 0.5 * son;
      // thunder: find flashes since the last update, schedule each after its delay (sound travels)
      if (Number.isFinite(tick)) {
        if (Number.isFinite(lastTick) && tick > lastTick && tick - lastTick < TICK_HZ * 5) {
          forEachStrike(data, lastTick, tick, (s: Strike) => pending.push({ at: s.tick + s.thunderDelay * TICK_HZ, power: s.power, id: s.id }));
        }
        lastTick = tick;
        for (let i = pending.length - 1; i >= 0; i--) {
          const p = pending[i];
          if (tick >= p.at) {
            pending.splice(i, 1);
            engine.play(thunder, { bus: 'sfx', k: p.power, gain: 0.55 + 0.45 * p.power, priority: 2, category: 'thunder' });
          } else if (tick < p.at - TICK_HZ * 10) pending.splice(i, 1);   // clock jumped back
        }
      }
      if (!L) return;
      set(L.rain.gain, levels.rain, 0.6);
      set(L.roar.gain, levels.roar, 0.8);
      set(L.wind.gain, levels.wind * (0.75 + 0.25 * Math.sin(clock * 0.37) * Math.sin(clock * 0.23 + 1)), 0.5);
      set(L.windBp.Q, 1.2 + 1.2 * w.storm, 1);
      set(L.spr.gain, levels.sprinkler, 0.25);
      if (son > 0) {
        const ctx = engine.ctx!;
        const P = L.sprPan;
        if (P.positionX) { P.positionX.setTargetAtTime(sx, ctx.currentTime, 0.05); P.positionY.setTargetAtTime(sy, ctx.currentTime, 0.05); P.positionZ.setTargetAtTime(sz, ctx.currentTime, 0.05); }
        else P.setPosition(sx, sy, sz);
      }
    },
    dispose() {
      if (L) for (const n of L.nodes) { try { (n as AudioScheduledSourceNode).stop?.(); } catch { /* not started */ } try { n.disconnect(); } catch { /* already */ } }
      L = null;
      pending.length = 0;
    },
  };
}

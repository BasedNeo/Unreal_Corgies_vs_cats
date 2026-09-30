// W10 AU2 (audio-2): the Node driver for the rendered audio tests. Mounts the REAL audio stack (createAudio, the X4
// ordnance director, G1 weather audio, the AU2 site ambience) on the offline renderer (audio-w10-render.ts), plays a
// scene (audio-w10-scenes.ts) at 60 Hz with fake timers following the audio clock (the engine's voice cleanup, the
// music's look-ahead scheduler), then renders the whole timeline. Deterministic: seeded Math.random, seeded voices.
import { vi } from 'vitest';
import { createAudio } from '../../src/client/audio';
import { createOrdnanceAudio } from '../../src/client/audio/presets-ordnance';
import { createWeatherAudio } from '../../src/client/audio/weather';
import { createSiteAmbience } from '../../src/client/audio/site-ambience';
import { RenderContext, seededRandom, type Tap } from './audio-w10-render';
import { FPS, SR, stepScene, type MountOptions, type Scene, type Stack } from './audio-w10-scenes';

export interface Mounted extends Stack {
  ctx: RenderContext;
  master: Tap;
  /** Move the audio clock and the fake timers forward together. */
  advance(dt: number): void;
  restore(): void;
}

/** Mount the real stack on a fresh render context. Call restore() when done (globals, timers, Math.random). */
export async function mount(o: MountOptions): Promise<Mounted> {
  vi.useFakeTimers();
  const g = globalThis as unknown as { AudioContext?: unknown; window?: unknown };
  const saved = { AudioContext: g.AudioContext, window: g.window };
  const rnd = vi.spyOn(Math, 'random').mockImplementation(seededRandom(o.seed ?? 7));
  const ctx = new RenderContext(SR);
  g.AudioContext = function FakeAudioContext() { return ctx; };
  g.window = { addEventListener() {}, removeEventListener() {} };
  const audio = createAudio({ autoUnlock: false, music: o.music ?? false });
  audio.engine.panningModel = 'equalpower';
  if (o.mute?.size) {
    const eng = audio.engine, orig = eng.play.bind(eng), mute = o.mute;
    eng.play = (r, opt = {}) => orig(r, mute.has(r) ? { ...opt, gain: 0 } : opt);
  }
  await audio.unlock();
  if (o.world) audio.setWorld(o.world);
  const ord = createOrdnanceAudio(audio.engine);
  const weather = o.world && o.weather !== false ? createWeatherAudio(audio.engine, o.world) : null;
  const ambience = o.world && o.ambience ? createSiteAmbience(audio, o.world) : null;
  const master = ctx.tap(audio.engine.master!, o.seconds);
  return {
    ctx, audio, ord, weather, ambience, master,
    advance(dt) { ctx.currentTime += dt; vi.advanceTimersByTime(dt * 1000); },
    restore() {
      audio.dispose();
      ambience?.dispose();
      rnd.mockRestore();
      vi.useRealTimers();
      g.AudioContext = saved.AudioContext; g.window = saved.window;
    },
  };
}

export interface Rendered { out: [Float32Array, Float32Array]; master: [Float32Array, Float32Array]; m: Mounted }

/** Drive a scene at 60 Hz, then render it. The caller must call `r.m.restore()` (renderAndRestore does). */
export async function play(s: Scene): Promise<Rendered> {
  const m = await mount(s);
  const events = [...(s.events ?? [])].sort((a, b) => a.at - b.at);
  const cues = [...(s.cues ?? [])].sort((a, b) => a.at - b.at);
  const cursor = { e: 0, c: 0 };
  const dt = 1 / FPS;
  for (let f = 0; f * dt < s.seconds; f++) {
    const t = f * dt;
    m.advance(t - m.ctx.currentTime);
    stepScene(s, m, t, dt, cursor, events, cues);
  }
  m.advance(Math.max(0, s.seconds - m.ctx.currentTime));
  const out = m.ctx.render(s.seconds);
  return { out, master: m.master.data, m };
}

export async function renderAndRestore(s: Scene): Promise<Rendered> {
  const r = await play(s);
  r.m.restore();
  return r;
}

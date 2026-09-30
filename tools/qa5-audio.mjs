#!/usr/bin/env node
// Q5 verification probe (read-only): AU2's mix by measurement.
//   npx tsx tools/qa5-audio.mjs mix                        per-bus peak / RMS on AU2's own offline renderer
//   npx tsx tools/qa5-audio.mjs duck                       how much the site ambience ducks gunfire (limiter pumping)
//   npx tsx tools/qa5-audio.mjs cost                       render cost on AU2's offline renderer (relative CPU): West Yard vs The Lot
// mix: the REAL audio stack (createAudio + the X4 director + G1 weather + the AU2 site ambience) on the Node renderer
//      AU2 cross-checked against Chromium (tests/unit/audio-w10-render.ts), driven like tests/unit/audio-w10-driver.ts
//      (60 Hz frames, the audio clock moving the timers) but without vitest: a small fake-timer queue here. Taps the
//      sfx / ui / music buses, the master gain (the mix into the dynamics chain) and the output. Scenes: AU2's busy Base
//      Assault capture moment on The Lot in a storm (both factions), The Lot's storm ambience alone at AU2's spots, and
//      the West Yard's storm (weather only) for reference.
// cost: the same renderer's wall time per second of audio and the nodes each scene creates (best of 3, interleaved):
//      a relative CPU measure (a JS renderer, not Chromium's audio thread), the West Yard's storm against The Lot's.
const argv = process.argv.slice(2);
const mode = argv[0] ?? 'mix';
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const out = (o) => console.log(JSON.stringify(o));

if (mode === 'mix' || mode === 'duck' || mode === 'cost') {
  const { register } = await import('node:module');
  register('data:text/javascript,' + encodeURIComponent('export async function load(u, c, n) { return /\\.(woff2?|png|svg|css)(\\?|$)/.test(u) ? { format: "module", source: "export default \'\'", shortCircuit: true } : n(u, c); }'), import.meta.url);
  const { RenderContext, seededRandom, peak, rmsDb, maxWindowDb } = await import('../tests/unit/audio-w10-render.ts');
  const { busyMoment, camera, pet, weatherSample, SR, FPS, stepScene } = await import('../tests/unit/audio-w10-scenes.ts');
  const { createAudio } = await import('../src/client/audio/index.ts');
  const { createOrdnanceAudio } = await import('../src/client/audio/presets-ordnance.ts');
  const { createWeatherAudio } = await import('../src/client/audio/weather.ts');
  const { createSiteAmbience } = await import('../src/client/audio/site-ambience.ts');
  const { createWorldData } = await import('../src/shared/world/world-data.ts');
  const lot = createWorldData(1, 'the_lot'), yard = createWorldData(1, 'west_yard');

  // fake timers on the audio clock (the engine's voice cleanup, the music's look-ahead scheduler)
  const real = { setTimeout, clearTimeout, setInterval, clearInterval, random: Math.random };
  let now = 0, idc = 1; let timers = [];
  const fake = () => {
    globalThis.setTimeout = (fn, ms = 0, ...a) => { const id = idc++; timers.push({ id, at: now + ms, fn, a }); return id; };
    globalThis.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
    globalThis.setInterval = (fn, ms = 0, ...a) => { const id = idc++; timers.push({ id, at: now + ms, fn, a, every: Math.max(1, ms) }); return id; };
    globalThis.clearInterval = globalThis.clearTimeout;
  };
  const advanceTimers = (ms) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      now = t.at;
      if (t.every) t.at += t.every; else timers.shift();
      t.fn(...t.a);
    }
    now = end;
  };
  const unfake = () => { Object.assign(globalThis, { setTimeout: real.setTimeout, clearTimeout: real.clearTimeout, setInterval: real.setInterval, clearInterval: real.clearInterval }); Math.random = real.random; timers = []; now = 0; };

  async function render(s) {
    fake(); Math.random = seededRandom(s.seed ?? 7);
    const ctx = new RenderContext(SR);
    const g = globalThis; const saved = { AudioContext: g.AudioContext, window: g.window };
    g.AudioContext = function FakeAudioContext() { return ctx; };
    g.window = { addEventListener() {}, removeEventListener() {} };
    const audio = createAudio({ autoUnlock: false, music: s.music ?? false });
    audio.engine.panningModel = 'equalpower';
    if (s.muteCategory) { const eng = audio.engine, orig = eng.play.bind(eng); eng.play = (r, o = {}) => orig(r, o.category === s.muteCategory ? { ...o, gain: 0 } : o); }
    await audio.unlock();
    if (s.world) audio.setWorld(s.world);
    const ord = createOrdnanceAudio(audio.engine);
    const weather = s.world && s.weather !== false ? createWeatherAudio(audio.engine, s.world) : null;
    const ambience = s.world && s.ambience ? createSiteAmbience(audio, s.world) : null;
    const B = audio.engine.buses;
    const taps = { sfx: ctx.tap(B.sfx, s.seconds), ui: ctx.tap(B.ui, s.seconds), music: ctx.tap(B.music, s.seconds), master: ctx.tap(audio.engine.master, s.seconds) };
    const m = { audio, ord, weather, ambience };
    const events = [...(s.events ?? [])].sort((a, b) => a.at - b.at), cues = [...(s.cues ?? [])].sort((a, b) => a.at - b.at);
    const cursor = { e: 0, c: 0 }, dt = 1 / FPS;
    const adv = (d) => { ctx.currentTime += d; advanceTimers(d * 1000); };
    for (let f = 0; f * dt < s.seconds; f++) { const t = f * dt; adv(t - ctx.currentTime); stepScene(s, m, t, dt, cursor, events, cues); }
    adv(Math.max(0, s.seconds - ctx.currentTime));
    const r0 = performance.now();
    const o = ctx.render(s.seconds);
    const renderMs = performance.now() - r0;
    audio.dispose(); ambience?.dispose();
    g.AudioContext = saved.AudioContext; g.window = saved.window;
    unfake();
    const lv = (ch, from = 0, to = Infinity) => ({ peak: +peak(ch, SR, from, to).toFixed(3), peakDb: +(20 * Math.log10(peak(ch, SR, from, to) + 1e-12)).toFixed(1), rmsDb: +rmsDb(ch, SR, from, to).toFixed(1), max100msDb: +maxWindowDb(ch, SR, 0.1, from, to).toFixed(1) });
    const from = s.settle ?? 0;
    if (s.raw) return { out: o };
    if (s.cost) return { renderMsPerS: renderMs / s.seconds, nodes: ctx.nodeCount, loops: ambience?.loops ?? 0 };
    return { sfx: lv(taps.sfx.data, from), ui: lv(taps.ui.data, from), music: lv(taps.music.data, from), master: lv(taps.master.data, from), out: lv(o, from) };
  }

  if (mode === 'cost') {
    const Hc = (w, x, z) => w.height(x, z) + 2.2;
    const sc = (world, x, z, sky, ambience, low = false) => ({ seconds: 6, cost: true, music: false, world, weather: true, ambience, localId: 1,
      listener: () => camera(x, Hc(world, x, z), z), states: () => new Map([[1, pet(1, { x, y: Hc(world, x, z) - 2.2, z })]]), sky: () => weatherSample(sky),
      frame: low ? (m, t) => { if (t === 0) m.ambience?.setQuality('low'); } : undefined });
    const cases = [
      ['no world audio (engine only)', { seconds: 6, cost: true, music: false, world: null, localId: 1, listener: () => camera(0, 2, 0), states: () => new Map() }],
      ['West Yard storm (weather; site builds nothing)', sc(yard, 0, 20, 'storm', true)],
      ['West Yard clear', sc(yard, 0, 20, 'clear', true)],
      ['The Lot storm, mud (weather + site)', sc(lot, 0, 30, 'storm', true)],
      ['The Lot storm, by a container', sc(lot, -103, -32, 'storm', true)],
      ['The Lot storm, inside a container', sc(lot, -95.5, -32, 'storm', true)],
      ['The Lot storm, ditch', sc(lot, -41, 6, 'storm', true)],
      ['The Lot storm, floodlight foot', sc(lot, -82, -112, 'storm', true)],
      ['The Lot storm, inside a container, site off', sc(lot, -95.5, -32, 'storm', false)],
      ['The Lot storm, inside a container, low tier', sc(lot, -95.5, -32, 'storm', true, true)],
      ['The Lot clear, floodlight foot', sc(lot, -82, -112, 'clear', true)],
    ];
    const best = new Map();
    for (let r = 0; r < 3; r++) for (const [name, s] of cases) { const x = await render(s); const b = best.get(name); if (!b || x.renderMsPerS < b.renderMsPerS) best.set(name, x); }
    const base = best.get('West Yard storm (weather; site builds nothing)').renderMsPerS;
    for (const [name] of cases) { const x = best.get(name); out({ scene: name, renderMsPerSecondOfAudio: +x.renderMsPerS.toFixed(1), xWestYardStorm: +(x.renderMsPerS / base).toFixed(2), nodesCreated: x.nodes, loops: x.loops }); }
    process.exit(0);
  }
  if (mode === 'duck') {
    const { diff } = await import('../tests/unit/audio-w10-render.ts');
    const H = (w, x, z) => w.height(x, z) + 2.2;
    const W = ['squeaker_rifle', 'snap_pistol', 'laser_longshot', 'tennis_mortar', 'sprinkler_cannon', 'frisbee_launcher'];
    const duck = (world, x, z, sky, ambience, weather = true) => {
      const ev = [];
      for (let t = 0.5; t < 5.8; t += 0.5) ev.push({ at: t, v: { e: 'fire', id: 2, wpn: 0, x: x + 6, y: H(world, x, z) - 1.2, z, dx: -1, dy: 0, dz: 0, hx: x - 20, hy: 0, hz: z, hit: -1 } });
      return { seconds: 6, music: false, world, weather, ambience, localId: 1, events: ev,
        listener: () => camera(x, H(world, x, z), z), states: () => new Map([[1, pet(1, { x, y: H(world, x, z) - 2.2, z })], [2, pet(2, { x: x + 6, y: H(world, x, z) - 2.2, z })]]),
        sky: () => weatherSample(sky), frame: (m, t) => { if (t === 0) m.audio.setWeaponIds(W); } };
    };
    const cases = [
      ['West Yard storm (weather only)', yard, 0, 20, 'storm', true],
      ['Lot storm @mud (weather + site)', lot, 0, 30, 'storm', true],
      ['Lot storm @containerOut (weather + site)', lot, -103, -32, 'storm', true],
      ['Lot storm @containerIn (weather + site)', lot, -95.5, -32, 'storm', true],
      ['Lot storm @containerIn (weather only, site off)', lot, -95.5, -32, 'storm', false],
      ['Lot clear @containerIn (weather + site)', lot, -95.5, -32, 'clear', true],
    ];
    for (const [name, w, x, z, sky, amb] of cases) {
      const A = await render({ ...duck(w, x, z, sky, amb), raw: true });
      const M = await render({ ...duck(w, x, z, sky, amb), raw: true, muteCategory: 'fire' });
      const D = diff(A.out, M.out);
      // the rifle's own level at the output (A − M: the shots as the whole mix's dynamics let them through), 1-5.8 s
      out({ scene: name, rifleOutMax100msDb: +maxWindowDb(D, SR, 0.1, 1, 5.8).toFixed(1), rifleOutPeakDb: +(20 * Math.log10(peak(D, SR, 1, 5.8) + 1e-12)).toFixed(1), bedOutRmsDb: +rmsDb(M.out, SR, 1, 5.8).toFixed(1) });
    }
    process.exit(0);
  }
  // 1. AU2's busy Base Assault capture moment on The Lot, storm, both factions (the mix test's own placement)
  const AT = [1.5, 0.15, -1.5];
  for (const [local, kind] of [[0, 1], [1, 0]]) {
    out({ scene: `busy BA capture, Lot storm, local ${local ? 'cat' : 'corgi'} vs ${kind ? 'hairball' : 'squeaker'}`, ...(await render(busyMoment({ world: lot, local, fuseKind: kind, fuseAt: AT, fuseFrom: 1.0 }))) });
  }
  // the capture alone (no fight, no throwable): the fanfare over the storm and the site
  out({ scene: 'BA capture alone, Lot storm', ...(await render(busyMoment({ world: lot, local: 0, fuseKind: 1, fuseAt: [40, 0, 40], fuseFrom: 9, fight: false, ticks: false }))) });
  // 2. ambience alone: The Lot's storm at AU2's listener spots (settled 1-4 s), and the West Yard's storm
  const H = (w, x, z) => w.height(x, z) + 2.2;
  const SPOT = { containerOut: [-103, -32], containerIn: [-95.5, -32], floodBase: [-82, -112], skip: [-54, 50], ditch: [-41, 6], mud: [0, 30] };
  const amb = (world, x, z, sky, ambience = true) => ({ seconds: 4, settle: 1, music: false, world, weather: true, ambience, localId: 1,
    listener: () => camera(x, H(world, x, z), z), states: () => new Map([[1, pet(1, { x, y: H(world, x, z) - 2.2, z })]]), sky: () => weatherSample(sky) });
  for (const [k, [x, z]] of Object.entries(SPOT)) for (const sky of ['storm', 'rain', 'clear']) out({ scene: `Lot ${sky} ambience @${k}`, ...(await render(amb(lot, x, z, sky))) });
  for (const sky of ['storm', 'rain', 'clear']) out({ scene: `West Yard ${sky} (weather only)`, ...(await render(amb(yard, 0, 20, sky))) });
  process.exit(0);
}

console.error(`unknown mode ${mode}: mix | duck | cost`);
process.exit(2);

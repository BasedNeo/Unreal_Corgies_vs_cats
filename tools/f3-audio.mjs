#!/usr/bin/env node
// F3 probe (read-only, W11): P2-6, the Lot's container rain in the mix. Runs Q5's harness (tools/qa5-audio.mjs mix/duck:
// the REAL audio stack on AU2's offline renderer, 60 Hz frames, fake timers on the audio clock) over the scenes the fix is
// accepted on, and prints one JSON line per scene:
//   · masterPeakDb   the mix into the limiter (the engine's master gain), the P2-6 number: ≤ 0 dBFS is the target
//   · sfxPeakDb, outPeakDb (the output after the limiter), masterRmsDb
//   · tick SMR (busy scenes): per fuse tick of the last 1.2 s, the best third-octave band of the ticks over the rest
//     (A − M, the ticks muted in M: AU2's own measure in tests/unit/audio-w10-mix.test.ts), min and median
//   · digest (West Yard scenes): an FNV-1a hash of the output samples, to prove the West Yard bit-identical to HEAD
//   npx tsx tools/f3-audio.mjs            from the tree under test (it imports ../src and ../tests/unit)
const out = (o) => console.log(JSON.stringify(o));
const { register } = await import('node:module');
register('data:text/javascript,' + encodeURIComponent('export async function load(u, c, n) { return /\\.(woff2?|png|svg|css)(\\?|$)/.test(u) ? { format: "module", source: "export default \'\'", shortCircuit: true } : n(u, c); }'), import.meta.url);
const { RenderContext, seededRandom, peak, rmsDb, band, diff } = await import('../tests/unit/audio-w10-render.ts');
const { busyMoment, camera, pet, weatherSample, fuseTicks, SR, FPS, stepScene } = await import('../tests/unit/audio-w10-scenes.ts');
const { createAudio } = await import('../src/client/audio/index.ts');
const { createOrdnanceAudio, ORDNANCE_SFX } = await import('../src/client/audio/presets-ordnance.ts');
const { createWeatherAudio } = await import('../src/client/audio/weather.ts');
const { createSiteAmbience } = await import('../src/client/audio/site-ambience.ts');
const { createWorldData } = await import('../src/shared/world/world-data.ts');
const lot = createWorldData(1, 'the_lot'), yard = createWorldData(1, 'west_yard');

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

/** Render a scene; `mute`: recipes played at gain 0 (the same voices, limiter and seed). Returns output + master. */
async function render(s) {
  fake(); Math.random = seededRandom(s.seed ?? 7);
  const ctx = new RenderContext(SR);
  const g = globalThis; const saved = { AudioContext: g.AudioContext, window: g.window };
  g.AudioContext = function FakeAudioContext() { return ctx; };
  g.window = { addEventListener() {}, removeEventListener() {} };
  const audio = createAudio({ autoUnlock: false, music: s.music ?? false });
  audio.engine.panningModel = 'equalpower';
  const eng = audio.engine, orig = eng.play.bind(eng);
  if (s.mute?.size || s.muteCategory) eng.play = (r, o = {}) => orig(r, s.mute?.has(r) || (s.muteCategory && o.category === s.muteCategory) ? { ...o, gain: 0 } : o);
  await audio.unlock();
  if (s.world) audio.setWorld(s.world);
  const ord = createOrdnanceAudio(audio.engine);
  const weather = s.world && s.weather !== false ? createWeatherAudio(audio.engine, s.world) : null;
  const ambience = s.world && s.ambience ? createSiteAmbience(audio, s.world) : null;
  const B = audio.engine.buses;
  const taps = { sfx: ctx.tap(B.sfx, s.seconds), master: ctx.tap(audio.engine.master, s.seconds) };
  const m = { audio, ord, weather, ambience };
  const events = [...(s.events ?? [])].sort((a, b) => a.at - b.at), cues = [...(s.cues ?? [])].sort((a, b) => a.at - b.at);
  const cursor = { e: 0, c: 0 }, dt = 1 / FPS;
  const adv = (d) => { ctx.currentTime += d; advanceTimers(d * 1000); };
  for (let f = 0; f * dt < s.seconds; f++) { const t = f * dt; adv(t - ctx.currentTime); stepScene(s, m, t, dt, cursor, events, cues); }
  adv(Math.max(0, s.seconds - ctx.currentTime));
  const o = ctx.render(s.seconds);
  audio.dispose(); ambience?.dispose();
  g.AudioContext = saved.AudioContext; g.window = saved.window;
  unfake();
  return { out: o, master: taps.master.data, sfx: taps.sfx.data };
}
const db = (x) => +(20 * Math.log10(x + 1e-12)).toFixed(1);
const lv = (r, from = 0, to = Infinity) => ({
  masterPeakDb: db(peak(r.master, SR, from, to)), sfxPeakDb: db(peak(r.sfx, SR, from, to)), outPeakDb: db(peak(r.out, SR, from, to)),
  masterRmsDb: +rmsDb(r.master, SR, from, to).toFixed(1),
});
function digest(ch) {
  let h = 0x811c9dc5;
  const dv = new DataView(new ArrayBuffer(4));
  for (const c of ch) for (let i = 0; i < c.length; i++) { dv.setFloat32(0, c[i]); for (let b = 0; b < 4; b++) { h ^= dv.getUint8(b); h = Math.imul(h, 0x01000193) >>> 0; } }
  return h.toString(16).padStart(8, '0');
}

/** A scene moved by (dx, dz) on the map, its heights by the ground there (the busy moment is authored at the origin). */
function shifted(s, world, dx, dz) {
  const dy = world.height(dx, dz + 3.8) - world.height(0, 3.8);
  const mv = (v) => {
    const o = { ...v };
    if ('x' in o) { o.x += dx; o.z += dz; if (typeof o.y === 'number') o.y += dy; }
    if ('hx' in o) { o.hx += dx; o.hz += dz; o.hy += dy; }
    return o;
  };
  const states = new Map();
  const mvStates = (t) => { const src = s.states(t); let c = states.get(src); if (!c) { c = new Map([...src].map(([k, e]) => [k, { ...e, x: e.x + dx, y: e.y + dy, z: e.z + dz }])); states.set(src, c); } return c; };
  const cam0 = s.listener(0).matrixWorld.elements;
  return { ...s, events: s.events?.map((e) => ({ at: e.at, v: mv(e.v) })), cues: s.cues?.map((c) => ({ at: c.at, v: mv(c.v) })),
    listener: () => camera(cam0[12] + dx, cam0[13] + dy, cam0[14] + dz), states: mvStates };
}

const THIRDS = [500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500];
const TICKS = new Set([ORDNANCE_SFX.fusePeep, ORDNANCE_SFX.wickCrackle, ORDNANCE_SFX.fuseAlarm]);
const AT = [1.5, 0.15, -1.5], FUSE_FROM = 1.0, BLAST = FUSE_FROM + 2.2;
function tickSmr(sig, mask, kind, at) {
  const bs = THIRDS.map((f) => band(sig, SR, f / 1.12, f * 1.12)), bm = THIRDS.map((f) => band(mask, SR, f / 1.12, f * 1.12));
  return fuseTicks(FUSE_FROM, kind, ...at).filter((c) => c.at >= BLAST - 1.2).map((c) => {
    let best = -200;
    for (let i = 0; i < THIRDS.length; i++) best = Math.max(best, rmsDb(bs[i], SR, c.at, c.at + 0.06) - rmsDb(bm[i], SR, c.at, c.at + 0.06));
    return best;
  });
}
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

// 1. AU2's storm firefight (the busy Base Assault moment, both factions): where AU2 authored it, and inside a container
const CIN = [-95.5, -32], COUT = [-103, -32];
for (const [where, off] of [['origin (AU2)', null], ['inside a container', CIN], ['by a container', COUT]]) {
  for (const [local, kind] of [[0, 1], [1, 0]]) {
    const mk = (mute) => { const b = busyMoment({ world: lot, local, fuseKind: kind, fuseAt: AT, fuseFrom: FUSE_FROM, mute }); return off ? shifted(b, lot, off[0], off[1] - 3.8) : b; };
    const A = await render(mk(undefined)), M = await render(mk(TICKS));
    const at = off ? [AT[0] + off[0], AT[1], AT[2] + off[1] - 3.8] : AT;
    const smr = tickSmr(diff(A.master, M.master), M.master, kind, at);
    out({ scene: `storm firefight (busy BA) ${where}, local ${local ? 'cat' : 'corgi'}`, ...lv(A), tickSmrMin: +Math.min(...smr).toFixed(1), tickSmrMedian: +median(smr).toFixed(1), ticks: smr.length });
  }
}
// 2. Q5's duck scene: a teammate's rifle 6 m away every 0.5 s, storm (the firefight's own shots, the rest of the mix)
const H = (w, x, z) => w.height(x, z) + 2.2;
const W = ['squeaker_rifle', 'snap_pistol', 'laser_longshot', 'tennis_mortar', 'sprinkler_cannon', 'frisbee_launcher'];
const rifle = (world, x, z, sky, ambience) => {
  const ev = [];
  for (let t = 0.5; t < 5.8; t += 0.5) ev.push({ at: t, v: { e: 'fire', id: 2, wpn: 0, x: x + 6, y: H(world, x, z) - 1.2, z, dx: -1, dy: 0, dz: 0, hx: x - 20, hy: 0, hz: z, hit: -1 } });
  return { seconds: 6, music: false, world, weather: true, ambience, localId: 1, events: ev,
    listener: () => camera(x, H(world, x, z), z), states: () => new Map([[1, pet(1, { x, y: H(world, x, z) - 2.2, z })], [2, pet(2, { x: x + 6, y: H(world, x, z) - 2.2, z })]]),
    sky: () => weatherSample(sky), frame: (m, t) => { if (t === 0) m.audio.setWeaponIds(W); } };
};
for (const [name, w, [x, z], sky] of [['Lot storm, inside a container', lot, CIN, 'storm'], ['Lot storm, by a container', lot, COUT, 'storm'], ['Lot rain, inside a container', lot, CIN, 'rain'], ['Lot storm, mud', lot, [0, 30], 'storm']]) {
  const A = await render(rifle(w, x, z, sky, true)), M = await render({ ...rifle(w, x, z, sky, true), muteCategory: 'fire' });
  out({ scene: `rifle every 0.5 s: ${name}`, ...lv(A, 1, 5.8), bedMasterPeakDb: db(peak(M.master, SR, 1, 5.8)), rifleVsBedOutDb: +(rmsDb(diff(A.out, M.out), SR, 1, 5.8) - rmsDb(M.out, SR, 1, 5.8)).toFixed(1) });
}
// 3. The ambience alone (no combat: nothing ducks it), settled 1-4 s
const amb = (world, x, z, sky) => ({ seconds: 4, music: false, world, weather: true, ambience: true, localId: 1,
  listener: () => camera(x, H(world, x, z), z), states: () => new Map([[1, pet(1, { x, y: H(world, x, z) - 2.2, z })]]), sky: () => weatherSample(sky) });
for (const [k, [x, z]] of Object.entries({ containerIn: CIN, containerOut: COUT, skip: [-54, 50], mud: [0, 30] })) for (const sky of ['storm', 'rain']) {
  out({ scene: `Lot ${sky} ambience alone @${k}`, ...lv(await render(amb(lot, x, z, sky)), 1) });
}
// 4. The West Yard (the site ambience builds nothing there): output digests, to compare with HEAD
for (const sky of ['storm', 'rain', 'clear']) { const r = await render(amb(yard, 0, 20, sky)); out({ scene: `West Yard ${sky} ambience`, ...lv(r, 1), digest: digest(r.out) }); }
{ const r = await render(rifle(yard, 0, 20, 'storm', true)); out({ scene: 'West Yard storm, rifle every 0.5 s', ...lv(r, 1, 5.8), digest: digest(r.out) }); }
{ const r = await render(busyMoment({ world: yard, local: 0, fuseKind: 1, fuseAt: AT, fuseFrom: FUSE_FROM })); out({ scene: 'West Yard busy moment (storm)', ...lv(r), digest: digest(r.out) }); }
process.exit(0);

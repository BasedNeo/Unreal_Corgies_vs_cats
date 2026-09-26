// World lab: renders the West Yard with the real style pipeline and a free camera.
//   /labs/world.html?bm=overview&t=0.68&webgl&seed=1&hud=0&dummies=0
//   G1 clock/weather: &tick=N (server tick) · &wx=clear|overcast|rain|storm|clearing (jump the clock to the
//   middle of that state) · &bolt=1 (jump to the next nearby lightning flash) · &spr=meadow|veg (jump into
//   a sprinkler burst) · &freeze (clock stops: deterministic shots) · &look=... &pos=... as before.
//   Keys: 1-9 bookmarks · T/G time of day +/- (pins it) · WASD/QE fly (Shift fast) · drag to look · P print
//   pose · R cycle weather override · L next lightning · [ / ] clock -/+ 30 s · F freeze clock
// Exposes window.__cvc (ready, fps, drawCalls, triangles, world stats, bookmarks) for tools/probe.mjs.
import { debug } from '../src/client/debug/debug-hook';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { createRenderContext } from '../src/client/engine/renderer';
import { createWorldData } from '../src/shared/world/world-data';
import { createWorldView } from '../src/client/world/world-view';
import { findWeather, forEachStrike, sprinklerAt, WEATHER_KINDS, type WeatherKind } from '../src/shared/world/weather';
import { toon } from '../src/client/style/style-webgpu.js';
import { PALETTE } from '../src/client/style/style-tokens.js';

const params = new URLSearchParams(location.search);
const hudEl = document.getElementById('hud')!;

interface LabDebug { drawCalls: number; triangles: number; world: Record<string, number>; bookmark: string; timeOfDay: number; buildMs: number }

async function main() {
  const ctx = await createRenderContext(document.getElementById('app')!, { forceWebGL: params.has('webgl') });
  debug.backend = ctx.backend;
  const seed = Number(params.get('seed') ?? 1);
  const t0 = performance.now();
  const data = createWorldData(seed);
  const view = createWorldView(ctx.scene, data, {
    timeOfDay: params.has('t') ? Number(params.get('t')) : undefined,
    quality: (params.get('q') as 'low' | 'med' | 'high' | null) ?? undefined,
    grade: ctx.pipeline.grade.uniforms as unknown as { saturation: { value: number } },
  });
  // ---- G1 clock ----
  let clock = Number(params.get('tick') ?? 0);
  let frozen = params.has('freeze');
  const wxParam = params.get('wx') as WeatherKind | null;
  if (wxParam && WEATHER_KINDS.includes(wxParam)) clock = findWeather(seed, wxParam, clock);
  /** Next near strike after `from` (optionally with its bearing in [b0, b1], math angle in XZ). */
  const nextBolt = (from: number, b0 = -Infinity, b1 = Infinity) => {
    let hit = -1;
    const inWin = (b: number) => { for (const k of [-1, 0, 1]) { const x = b + k * Math.PI * 2; if (x >= b0 && x <= b1) return true; } return false; };
    for (let t = from; t < from + 60 * 60 * 40 && hit < 0; t += 600) forEachStrike(seed, t, t + 600, (s) => { if (hit < 0 && s.dist < 700 && s.tick > from && inWin(s.bearing)) hit = s.tick; });
    return hit;
  };
  if (params.get('bolt') === '1') { const b = nextBolt(clock); if (b >= 0) clock = b + 2; }
  const sprId = params.get('spr');
  if (sprId) {
    const sp = data.sprinklers?.find((s) => s.id === sprId);
    if (sp) for (let t = clock; t < clock + 60 * 600; t += 30) if (sprinklerAt(seed, sp, t).on >= 1) { clock = t + 60 * 4; break; }
  }
  let overrideIdx = -1;
  const buildMs = performance.now() - t0;
  (globalThis as unknown as { __lab: unknown }).__lab = { scene: ctx.scene, view, data, renderer: ctx.renderer, ctx, THREE, TSL };
  const lab = debug as unknown as typeof debug & LabDebug;
  lab.buildMs = Math.round(buildMs);
  for (const b of view.bookmarks) {
    const dx = b.look[0] - b.pos[0], dy = b.look[1] - b.pos[1], dz = b.look[2] - b.pos[2];
    debug.bookmarks[b.name] = { x: b.pos[0], y: b.pos[1], z: b.pos[2], yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  }

  // Scale dummies: 1.2 m toon stand-ins (corgi blue / cat crimson) at spawns and a few landmarks.
  if (params.get('dummies') !== '0') {
    const g = new THREE.Group();
    const body = new THREE.CapsuleGeometry(0.36, 0.48, 4, 10);
    const ear = new THREE.ConeGeometry(0.13, 0.32, 6);
    const mk = (x: number, y: number, z: number, team: number, yaw: number) => {
      const d = new THREE.Group();
      const m = new THREE.Mesh(body, toon({ color: team === 0 ? PALETTE.teamCorgis : PALETTE.teamCats }));
      m.position.y = 0.6;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), toon({ color: team === 0 ? PALETTE.corgiOrange : PALETTE.catGrey }));
      head.position.set(0, 1.12, -0.05);
      for (const s of [-1, 1]) { const e = new THREE.Mesh(ear, toon({ color: team === 0 ? PALETTE.corgiOrange : PALETTE.catGrey })); e.position.set(s * 0.15, 1.42, -0.02); d.add(e); }
      d.add(m, head);
      d.position.set(x, y, z); d.rotation.y = yaw;
      d.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(d);
    };
    for (const s of data.spawns.filter((_, i) => i % 2 === 0)) mk(s.x, s.y, s.z, s.team, s.yaw);
    mk(-52, 3.0, -88, 0, Math.PI); mk(-50, data.height(-50, -60), -60, 0, 2.8); mk(0.5, 1.25, 1.5, 1, 0.3);
    mk(46, 9.4, 86, 1, 0); mk(22.2, 6.4, 84.1, 1, 0.6); mk(-60, data.height(-60, 30), 30, 0, 1);
    ctx.scene.add(g);
  }

  const cam = ctx.camera;
  const pose = { x: 0, y: 30, z: 60, yaw: 0, pitch: -0.4 };
  const applyBookmark = (name: string) => {
    const b = view.bookmarks.find((v) => v.name === name) ?? view.bookmarks[0];
    if (!b) return;
    const dx = b.look[0] - b.pos[0], dy = b.look[1] - b.pos[1], dz = b.look[2] - b.pos[2];
    Object.assign(pose, { x: b.pos[0], y: b.pos[1], z: b.pos[2], yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) });
    cam.fov = Number(params.get('fov') ?? b.fov ?? 62);
    cam.updateProjectionMatrix();
    lab.bookmark = b.name;
  };
  applyBookmark(params.get('bm') ?? 'overview');
  // ad-hoc camera: &pos=x,y,z&look=x,y,z
  if (params.has('pos') && params.has('look')) {
    const [px, py, pz] = params.get('pos')!.split(',').map(Number), [lx, ly, lz] = params.get('look')!.split(',').map(Number);
    Object.assign(pose, { x: px, y: py, z: pz, yaw: Math.atan2(-(lx - px), -(lz - pz)), pitch: Math.atan2(ly - py, Math.hypot(lx - px, lz - pz)) });
    lab.bookmark = 'custom';
  }

  // scripting hook for batch screenshots (tools / scratch scripts): one page load, many shots
  const setPose = (p: number[], l: number[], fov?: number) => {
    Object.assign(pose, { x: p[0], y: p[1], z: p[2], yaw: Math.atan2(-(l[0] - p[0]), -(l[2] - p[2])), pitch: Math.atan2(l[1] - p[1], Math.hypot(l[0] - p[0], l[2] - p[2])) });
    if (fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    lab.bookmark = 'custom';
  };
  Object.assign((globalThis as unknown as { __lab: Record<string, unknown> }).__lab, {
    applyBookmark, setPose,
    setClock: (t: number) => { clock = t; },
    getClock: () => clock,
    setFrozen: (f: boolean) => { frozen = f; },
    frames: () => frames,
    nextBolt,
    findWeather: (k: WeatherKind, from = 0) => findWeather(seed, k, from),
  });

  const keys = new Set<string>();
  addEventListener('keydown', (e) => {
    keys.add(e.code);
    const n = Number(e.key);
    if (n >= 1 && n <= view.bookmarks.length) applyBookmark(view.bookmarks[n - 1].name);
    if (e.code === 'KeyT') view.setTimeOfDay(view.timeOfDay + 0.02);
    if (e.code === 'KeyG') view.setTimeOfDay(view.timeOfDay - 0.02);
    if (e.code === 'KeyR') { overrideIdx = overrideIdx + 1 >= WEATHER_KINDS.length ? -1 : overrideIdx + 1; view.setWeather(overrideIdx < 0 ? null : WEATHER_KINDS[overrideIdx]); }
    if (e.code === 'KeyL') { const b = nextBolt(clock); if (b >= 0) clock = b - 30; }
    if (e.code === 'BracketLeft') clock = Math.max(0, clock - 1800);
    if (e.code === 'BracketRight') clock += 1800;
    if (e.code === 'KeyF') frozen = !frozen;
    if (e.code === 'KeyP') console.log('pose', JSON.stringify(pose), 't', view.timeOfDay.toFixed(3));
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  let drag = false;
  ctx.renderer.domElement.addEventListener('pointerdown', () => { drag = true; });
  addEventListener('pointerup', () => { drag = false; });
  addEventListener('pointermove', (e) => { if (drag) { pose.yaw -= e.movementX * 0.004; pose.pitch = Math.max(-1.5, Math.min(1.5, pose.pitch - e.movementY * 0.004)); } });

  ctx.renderer.info.autoReset = false;
  let last = performance.now(), frames = 0, fpsT = last, fpsN = 0;
  ctx.renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const sp = (keys.has('ShiftLeft') ? 40 : 12) * dt;
    const fx = -Math.sin(pose.yaw), fz = -Math.cos(pose.yaw);
    if (keys.has('KeyW')) { pose.x += fx * sp; pose.z += fz * sp; }
    if (keys.has('KeyS')) { pose.x -= fx * sp; pose.z -= fz * sp; }
    if (keys.has('KeyA')) { pose.x += fz * sp; pose.z -= fx * sp; }
    if (keys.has('KeyD')) { pose.x -= fz * sp; pose.z += fx * sp; }
    if (keys.has('KeyE')) pose.y += sp;
    if (keys.has('KeyQ')) pose.y -= sp;
    cam.position.set(pose.x, pose.y, pose.z);
    cam.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
    if (!frozen) clock += dt * 60;
    view.update(dt, cam, clock);
    ctx.renderer.info.reset();
    ctx.render();
    frames++; fpsN++;
    if (now - fpsT > 500) { debug.fps = (fpsN * 1000) / (now - fpsT); fpsN = 0; fpsT = now; }
    const info = ctx.renderer.info.render as unknown as { drawCalls?: number; calls?: number; triangles?: number };
    lab.drawCalls = info.drawCalls ?? info.calls ?? 0;
    lab.triangles = info.triangles ?? 0;
    lab.timeOfDay = view.timeOfDay;
    const wx = view.weather;
    (lab as unknown as { weather: unknown }).weather = { tick: Math.round(clock), kind: wx.kind, rain: +wx.rain.toFixed(2), wet: +wx.wet.toFixed(2), storm: +wx.storm.toFixed(2), flash: +wx.flash.toFixed(2) };
    debug.frames = frames;
    debug.frameMs = dt * 1000;
    if (frames === 3 || frames % 30 === 0) lab.world = view.stats();
    debug.ready = frames > 5;
    if (params.get('hud') !== '0') hudEl.textContent = `${lab.bookmark} · t=${view.timeOfDay.toFixed(2)} · ${wx.kind}${wx.blend > 0 ? `→${wx.to}` : ''} tick ${Math.round(clock)} · ${debug.fps.toFixed(1)} fps · ${lab.drawCalls} draws · ${(lab.triangles / 1000).toFixed(0)}k tris · ${ctx.backend}`;
  });
}

main().catch((err) => {
  console.error(err);
  debug.errors.push(String(err?.stack ?? err));
  hudEl.textContent = `Failed: ${String(err?.message ?? err)}`;
});

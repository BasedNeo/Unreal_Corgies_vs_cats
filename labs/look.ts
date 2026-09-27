// HARDENED look lab (W7 S4): the West Yard with the real style pipeline at a quality tier, fixed bookmarks, a weather
// override, a character lineup (team + class reads) and demo sodium floodlights — the proof bench for the look.
//   /labs/look.html?webgl&bm=center&t=0.68&wx=storm&quality=high&freeze&hud=0
//   &quality=low|medium|high   engine + world + material detail of that tier (default high)
//   &wx=clear|overcast|rain|storm|clearing   weather override (default: clock tick 0 = clear)
//   &chars=0   no character lineup · &flood=0   no demo floodlights · &harden=0   world keeps its own materials
//   &inkmin=0   P3 A/B: every ink hull drawn (default: the renderer's ink LOD skips hulls under 0.3 px)
//   &harden=1 (default): world materials are rebuilt with toonMaterial() + a surface preset IN THIS LAB ONLY — the
//   preview of the materials.ts snippet in docs/handoff/S4.md (toonFrom -> toonMaterial).
//   W9 P4 readability bench: &lineup=35 puts all 12 class × species kits (NPC tier; corgis team Corgis, cats team Cats)
//   on an arc `lineup` m ahead of the bookmark camera, on the ground (&facing=back turns them round; the 4-pet lineup
//   is off). &mask=1 renders only them, flat white on black (no world, sky, fog, grade vignette/grain): the pixel mask
//   for artifacts/p4/tools/metrics.mjs. With &freeze the poses are settled once and held (same frame in both shots).
//   window.__lab.boxes: per lineup character { x0, y0, x1, y1 } CSS px, species, team, cls, tag.
//   &cam=x,h,z&at=x,y,z: an explicit camera, h metres above the ground at (x, z) (the bench uses cam=42,1.7,2&at=74.3,0.6,-11.4).
// Keys: 1-9 bookmarks · T/G time of day · R cycle weather · WASD/QE fly · drag to look.
// Exposes window.__cvc (ready, frames, drawCalls, triangles) and window.__lab (applyBookmark, view, ctx, setWeather).
import { debug } from '../src/client/debug/debug-hook';
import * as THREE from 'three/webgpu';
import { createRenderContext } from '../src/client/engine/renderer';
import { toQualityTier } from '../src/client/engine/quality';
import { createWorldData } from '../src/shared/world/world-data';
import { createWorldView } from '../src/client/world/world-view';
import { WEATHER_KINDS, type WeatherKind } from '../src/shared/world/weather';
import { surfaceAt } from '../src/shared/world/queries';
import { toonMaterial, glow, type HardenedToonMaterial } from '../src/client/style/style-webgpu.js';
import { createFloodlights } from '../src/client/style/floodlights.js';
import { createCharacter } from '../src/client/procgen/characters';
import { CLASS_IDS, Species, Team } from '../src/shared/types';
import type { AvatarFrame } from '../src/client/views/avatar';

const params = new URLSearchParams(location.search);
const hudEl = document.getElementById('hud')!;

interface LabDebug { drawCalls: number; triangles: number; bookmark: string; timeOfDay: number }

/** Lab-only preview of the materials.ts snippet: world toon materials -> hardened toonMaterial with a surface preset. */
function hardenWorld(root: THREE.Object3D): number {
  const done = new Map<THREE.Material, THREE.Material>();
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o.userData.styleInk) return;
    const swap = (m: THREE.Material): THREE.Material => {
      const style = m.userData?.style;
      if ((style !== 'toon' && style !== 'toon-noink') || (m as unknown as { isHardenedToonMaterial?: boolean }).isHardenedToonMaterial) return m;
      let r = done.get(m);
      if (r) return r;
      const src = m as THREE.MeshToonNodeMaterial;
      const surface = src.transparent && src.opacityNode ? 'water' : src.positionNode ? 'foliage' : src.normalNode ? 'ground' : 'world';
      const h = toonMaterial({
        color: src.color.getHex(), vertexColors: src.vertexColors, side: src.side, transparent: src.transparent,
        opacity: src.opacity, ink: style === 'toon', surface,
      }) as HardenedToonMaterial;
      h.colorNode = src.colorNode; h.normalNode = src.normalNode; h.positionNode = src.positionNode; h.opacityNode = src.opacityNode;
      h.depthWrite = src.depthWrite;
      done.set(m, h);
      n++;
      return (r = h);
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  return n;
}

async function main() {
  const tier = toQualityTier(params.get('quality'));
  const ctx = await createRenderContext(document.getElementById('app')!, { forceWebGL: params.has('webgl'), quality: tier, inkMinPx: params.has('inkmin') ? Number(params.get('inkmin')) : undefined });
  debug.backend = ctx.backend;
  const seed = Number(params.get('seed') ?? 1);
  const data = createWorldData(seed);
  const view = createWorldView(ctx.scene, data, {
    timeOfDay: params.has('t') ? Number(params.get('t')) : undefined,
    quality: tier === 'medium' ? 'med' : tier,
    grade: ctx.pipeline.grade.uniforms as unknown as { saturation: { value: number } },
  });
  const wx = params.get('wx') as WeatherKind | null;
  if (wx && WEATHER_KINDS.includes(wx)) view.setWeather(wx);
  const hardened = params.get('harden') !== '0' ? hardenWorld(view.root) : 0;

  // character lineup: a corgi and a cat per team colour, rebuilt in front of each bookmark
  const frame: AvatarFrame = { speed: 0, vy: 0, grounded: true, anim: 0, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false };
  const lineup = new THREE.Group();
  lineup.name = 'lineup';
  const avatars: { update(f: AvatarFrame, dt: number): void; root: THREE.Object3D }[] = [];
  const lineupDist = params.has('lineup') ? Number(params.get('lineup')) : 0;
  const mask = params.get('mask') === '1';
  if (params.get('chars') !== '0' && lineupDist <= 0) {
    const specs = [
      { species: 0, cls: 'assault', team: 0, x: -1.6 }, { species: 0, cls: 'breacher', team: 0, x: -0.55 },
      { species: 1, cls: 'assault', team: 1, x: 0.55 }, { species: 1, cls: 'overwatch', team: 1, x: 1.6 },
    ] as const;
    for (const s of specs) {
      try {
        const av = createCharacter({ species: s.species, cls: s.cls as never, team: s.team, seed: 7, isLocal: true });
        av.root.position.x = s.x;
        av.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        lineup.add(av.root);
        avatars.push(av);
      } catch (e) { debug.errors.push(`lineup: ${String(e)}`); }
    }
    ctx.scene.add(lineup);
  }

  // demo floodlights: one pooled on the ground ahead of each bookmark (the environment lane places the real ones)
  const floods = params.get('flood') !== '0' ? createFloodlights({ tier }) : null;
  if (floods) {
    for (const b of view.bookmarks.slice(0, 12)) {
      const dx = b.look[0] - b.pos[0], dz = b.look[2] - b.pos[2], d = Math.hypot(dx, dz) || 1;
      const tx = b.pos[0] + (dx / d) * Math.min(14, d * 0.6), tz = b.pos[2] + (dz / d) * Math.min(14, d * 0.6);
      const gy = surfaceAt(data, tx, tz).y;
      floods.add({ pos: [tx + 3.5, gy + 9, tz + 2.5], target: [tx, gy, tz] });
    }
    ctx.scene.add(floods.group);
  }

  const cam = ctx.camera;
  const pose = { x: 0, y: 30, z: 60, yaw: 0, pitch: -0.4 };
  const lab = debug as unknown as typeof debug & LabDebug;
  const applyBookmark = (name: string) => {
    const b = view.bookmarks.find((v) => v.name === name) ?? view.bookmarks[0];
    if (!b) return;
    const dx = b.look[0] - b.pos[0], dy = b.look[1] - b.pos[1], dz = b.look[2] - b.pos[2];
    Object.assign(pose, { x: b.pos[0], y: b.pos[1], z: b.pos[2], yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) });
    cam.fov = Number(params.get('fov') ?? b.fov ?? 62);
    cam.updateProjectionMatrix();
    lab.bookmark = b.name;
    // lineup: 6.5 m ahead on the ground, facing the camera (skipped for the high overview)
    const d = Math.hypot(dx, dz) || 1, ahead = b.pos[1] > 20 ? 0 : 6.5;
    lineup.visible = ahead > 0;
    const lx = b.pos[0] + (dx / d) * ahead, lz = b.pos[2] + (dz / d) * ahead;
    lineup.position.set(lx, surfaceAt(data, lx, lz).y, lz);
    lineup.rotation.y = Math.atan2(-dx, -dz) + Math.PI;
  };
  applyBookmark(params.get('bm') ?? 'center');
  if (params.has('cam') && params.has('at')) {
    // explicit camera (the bench's open 35 m sightline: artifacts/p4/tools/sightline.mjs): y is above the ground there
    const [px, py, pz] = params.get('cam')!.split(',').map(Number), [ax, ay, az] = params.get('at')!.split(',').map(Number);
    const gy = surfaceAt(data, px, pz).y;
    const dx = ax - px, dz = az - pz, dy = ay - py;
    Object.assign(pose, { x: px, y: gy + py, z: pz, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) });
    lab.bookmark = 'cam';
  }

  // W9 P4 readability bench: the 12 kits on an arc `lineupDist` m ahead of the camera, on the ground (see the header)
  const bench: { root: THREE.Object3D; height: number; species: number; team: number; cls: string; tag: string }[] = [];
  if (lineupDist > 0) {
    const back = params.get('facing') === 'back';
    const step = 1.9 / lineupDist, gap = 1.6 / lineupDist;
    const span = 2 * CLASS_IDS.length * step + gap - step;
    let a = pose.yaw - span / 2;
    for (const sp of [Species.Corgi, Species.Cat]) {
      for (const cls of CLASS_IDS) {
        const x = pose.x - Math.sin(a) * lineupDist, z = pose.z - Math.cos(a) * lineupDist;
        const av = createCharacter({ species: sp, cls, team: sp === Species.Cat ? Team.Cats : Team.Corgis, seed: 3 + bench.length, isLocal: false });
        av.root.position.set(x, surfaceAt(data, x, z).y, z);
        av.root.rotation.y = Math.atan2(pose.x - x, pose.z - z) + (back ? 0 : Math.PI); // characters face -Z
        for (let i = 0; i < 72; i++) av.update(frame, 1 / 60); // settled idle (held with &freeze)
        ctx.scene.add(av.root);
        avatars.push(av);
        bench.push({ root: av.root, height: av.height, species: sp, team: sp === Species.Cat ? Team.Cats : Team.Corgis, cls, tag: back ? 'back' : 'front' });
        a += step;
      }
      a += gap;
    }
    if (mask) {
      // only the characters, flat white on black: no world, sky, fog, floodlights, vignette or grain
      view.root.visible = false;
      if (floods) floods.group.visible = false;
      ctx.scene.traverse((o) => { if (o.name === 'sky_dome') o.visible = false; });
      const white = glow(0xffffff, 1);
      for (const b of bench) b.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !o.userData.styleInk) m.material = white; if (o.userData.styleInk) o.visible = false; });
      const g = (ctx.pipeline as unknown as { grade: { uniforms: Record<string, { value: number }> } }).grade.uniforms;
      g.vignette.value = 0; g.grain.value = 0;
    }
  }
  const boxOf = (b: (typeof bench)[number]) => {
    const v = new THREE.Vector3();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py, pz] of [[-0.55, -0.05, -0.55], [0.55, -0.05, 0.55], [-0.55, b.height + 0.25, 0.55], [0.55, b.height + 0.25, -0.55], [-0.55, b.height + 0.25, -0.55], [0.55, b.height + 0.25, 0.55], [-0.55, -0.05, 0.55], [0.55, -0.05, -0.55]]) {
      v.set(px, py, pz).applyMatrix4(b.root.matrixWorld).project(cam);
      const sx = ((v.x + 1) / 2) * innerWidth, sy = ((1 - v.y) / 2) * innerHeight;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x0, y0, x1, y1, species: b.species, team: b.team, cls: b.cls, squad: null, tag: b.tag };
  };
  Object.assign(globalThis as unknown as Record<string, unknown>, {
    __lab: {
      scene: ctx.scene, view, data, renderer: ctx.renderer, ctx, THREE, floods, hardened, applyBookmark,
      setWeather: (w: WeatherKind | null) => view.setWeather(w),
    },
  });

  const keys = new Set<string>();
  let wxIdx = -1;
  addEventListener('keydown', (e) => {
    keys.add(e.code);
    const n = Number(e.key);
    if (n >= 1 && n <= view.bookmarks.length) applyBookmark(view.bookmarks[n - 1].name);
    if (e.code === 'KeyT') view.setTimeOfDay(view.timeOfDay + 0.01);
    if (e.code === 'KeyG') view.setTimeOfDay(view.timeOfDay - 0.01);
    if (e.code === 'KeyR') { wxIdx = wxIdx + 1 >= WEATHER_KINDS.length ? -1 : wxIdx + 1; view.setWeather(wxIdx < 0 ? null : WEATHER_KINDS[wxIdx]); }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  let drag = false;
  ctx.renderer.domElement.addEventListener('pointerdown', () => { drag = true; });
  addEventListener('pointerup', () => { drag = false; });
  addEventListener('pointermove', (e) => { if (drag) { pose.yaw -= e.movementX * 0.004; pose.pitch = Math.max(-1.5, Math.min(1.5, pose.pitch - e.movementY * 0.004)); } });

  ctx.renderer.info.autoReset = false;
  const frozen = params.has('freeze');
  let clock = 0, last = performance.now(), frames = 0, fpsT = last, fpsN = 0;
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
    if (mask) { ctx.scene.fogNode = null; ctx.scene.background = new THREE.Color(0x000000); }
    floods?.update(cam);
    if (!(frozen && lineupDist > 0)) for (const a of avatars) a.update(frame, dt);
    ctx.renderer.info.reset();
    ctx.render();
    frames++; fpsN++;
    if (now - fpsT > 500) { debug.fps = (fpsN * 1000) / (now - fpsT); fpsN = 0; fpsT = now; }
    const info = ctx.renderer.info.render as unknown as { drawCalls?: number; calls?: number; triangles?: number };
    lab.drawCalls = info.drawCalls ?? info.calls ?? 0;
    lab.triangles = info.triangles ?? 0;
    lab.timeOfDay = view.timeOfDay;
    if (bench.length) { for (const b of bench) b.root.updateMatrixWorld(true); (globalThis as unknown as { __lab: Record<string, unknown> }).__lab.boxes = bench.map(boxOf); }
    (globalThis as unknown as { __lab: Record<string, unknown> }).__lab.frames = frames;
    debug.frames = frames;
    debug.frameMs = dt * 1000;
    debug.ready = frames > 5;
    if (params.get('hud') !== '0') hudEl.textContent = `${lab.bookmark} · ${tier} (detail ${ctx.styleDetail}) · t=${view.timeOfDay.toFixed(2)} · ${view.weather.kind} · ${debug.fps.toFixed(1)} fps · ${lab.drawCalls} draws · ${(lab.triangles / 1000).toFixed(0)}k tris · ${ctx.backend}`;
  });
}

main().catch((err) => {
  console.error(err);
  debug.errors.push(String(err?.stack ?? err));
  hudEl.textContent = `Failed: ${String(err?.message ?? err)}`;
});

// Weapons lab (X3): the weapon models and their combat feedback on a small firing range, through the real
// style pipeline, FX director, audio and hitmarker.
//   /labs/weapons.html?webgl&view=models            every weapon, both factions (x3 scale for inspection; &scale=1)
//   &view=fire&wpn=squeaker_rifle&surf=metal         one armed pet firing at a panel (surf: dirt|grass|metal|wood|stone|water)
//   &view=fire&wpn=all                               the six weapons in a firing line
//   &view=impacts&wpn=squeaker_rifle                  bullets landing on every surface (marks accumulate)
//   &view=hits                                       a cat taking hits: fur tufts, a soft glow, crit, kill + hitmarker
//   &view=explode                                    a tennis-mortar round going off on dirt (fireball, smoke, scorch)
//   &cam=side|ots|front|impact (impact: close on the hit point)   &mood=dusk|day   &quality=low|medium|high   &slow=0.25 (slow motion)   &period=0.6 (s)
// Deterministic: fixed 1/60 s steps per rendered frame (× slow). Captures set window.__wlab.pause = true to hold a
// frame (the scene keeps rendering), then release it; __wlab.frames counts simulated frames. &hold starts held (a
// capture script arms __wlab.pauseAt, then releases it).
import * as THREE from 'three/webgpu';
import { createRenderContext } from '../src/client/engine/renderer';
import { toon, glow } from '../src/client/style/style-webgpu.js';
import { PALETTE } from '../src/client/style/style-tokens.js';
import { buildWeapon } from '../src/client/procgen/characters/weapons';
import { createCharacter, type CharacterAvatar } from '../src/client/procgen/characters';
import { CLASS_IDS, EntityKind, Species, Team, type ClassId, type TeamId } from '../src/shared/types';
import { CLASSES } from '../src/shared/content/classes';
import { WEAPONS, weaponIndex } from '../src/shared/content/weapons';
import type { EntityState, GameEvent } from '../src/shared/protocol';
import type { AvatarFrame } from '../src/client/views/avatar';
import type { PropBox } from '../src/shared/world/world-types';
import { createFx, type FxQuality, type MuzzleSource } from '../src/client/fx';
import type { SurfaceWorld } from '../src/client/fx/surfaces';
import { createAudio } from '../src/client/audio';
import { createHitFeedback } from '../src/client/ui/hit-feedback';

const P = new URLSearchParams(location.search);
const view = P.get('view') ?? 'models';
const wpnParam = P.get('wpn') ?? 'squeaker_rifle';
const surfParam = P.get('surf') ?? 'metal';
const slow = Number(P.get('slow') ?? 1);
const period = Number(P.get('period') ?? 0.7);
const mood = P.get('mood') ?? 'dusk';
const quality = (P.get('quality') ?? 'high') as FxQuality;
const DT = 1 / 60;

interface Lab { frames: number; renders: number; pause: boolean; pauseAt: number[]; ready: boolean; error: string | null; fx: unknown; t: number; events: number }
const lab: Lab = { frames: 0, renders: 0, pause: P.has('hold'), pauseAt: [], ready: false, error: null, fx: null, t: 0, events: 0 };
(globalThis as unknown as { __wlab: Lab }).__wlab = lab;

const clsOf = (wid: string): ClassId => (CLASS_IDS.find((c) => CLASSES[c].primary === wid) ?? 'assault');

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const ctx = await createRenderContext(app, { forceWebGL: P.has('webgl'), quality: quality === 'medium' ? 'medium' : quality });
  const { scene, camera } = ctx;
  if (mood === 'dusk') {
    // HARDENED battle mood stand-in for the lab (the real grade/rig is S4's): dusk sky, a lower, warmer key.
    scene.background = new THREE.Color(0x27303b);
    scene.traverse((o) => {
      const l = o as THREE.Light;
      if ((l as THREE.DirectionalLight).isDirectionalLight) l.intensity *= 0.55;
      if ((l as THREE.HemisphereLight).isHemisphereLight) l.intensity *= 0.5;
    });
  }
  const labelsEl = document.getElementById('labels')!;
  const labels: { el: HTMLElement; at: THREE.Vector3 }[] = [];
  const label = (text: string, at: THREE.Vector3) => { const el = document.createElement('div'); el.textContent = text; labelsEl.appendChild(el); labels.push({ el, at }); };

  if (view === 'models') { buildModels(scene, camera, label); }
  else { await buildRange(scene, camera, ctx.renderer.domElement); }

  const v = new THREE.Vector3();
  const placeLabels = () => {
    for (const l of labels) {
      v.copy(l.at).project(camera);
      l.el.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
      l.el.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
      l.el.style.display = v.z < 1 ? 'block' : 'none';
    }
  };
  document.getElementById('lab')!.innerHTML = ['models', 'fire', 'impacts', 'hits', 'explode']
    .map((m) => `<a href="?${P.has('webgl') ? 'webgl&' : ''}view=${m}">${m}</a>`).join('');
  ctx.renderer.setAnimationLoop(() => {
    try {
      if (!lab.pause) {
        stepHook?.(DT * slow); lab.frames++; lab.t += DT * slow;
        if (lab.pauseAt.includes(lab.frames)) lab.pause = true;
      }
      placeLabels();
      ctx.render();
      lab.renders++;
      lab.ready = true;
    } catch (e) { lab.error = String((e as Error)?.stack ?? e); console.error(e); }
  });
}

let stepHook: ((dt: number) => void) | null = null;

// ---------------------------------------------------------------------------------------------
// models: every weapon, both factions, with the character's material setup (vertex-colour style material + glow)

function buildModels(scene: THREE.Scene, camera: THREE.PerspectiveCamera, label: (t: string, at: THREE.Vector3) => void): void {
  const scale = Number(P.get('scale') ?? 3);
  const yaw = Number(P.get('yaw') ?? -1.05);
  // the weapon material the character kit uses (K2 index.ts): weathered toon from the weapon's finish
  const matFor = (fin: { metal: number; wear: number; grime: number }) => toon({ color: 0xffffff, vertexColors: true, surface: 'weapon', ...fin } as Parameters<typeof toon>[0]);
  const one = P.get('wpn');
  if (one) {
    // close-up: one weapon, both factions, big
    ([Team.Corgis, Team.Cats] as TeamId[]).forEach((team, row) => {
      const w = buildWeapon(clsOf(one), team, 0.86);
      const m = new THREE.Mesh(w.geometry, matFor(w.finish));
      if (w.glow) m.add(new THREE.Mesh(w.glow, glow(w.glowColor, 2.6)));
      m.scale.setScalar(4.2);
      m.rotation.y = yaw;
      m.position.set(0.3, row === 0 ? 0.55 : -0.75, 0);
      scene.add(m);
    });
    camera.fov = 40;
    camera.position.set(0, 0, 4.6);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    return;
  }
  CLASS_IDS.forEach((cls, i) => {
    ([Team.Corgis, Team.Cats] as TeamId[]).forEach((team, row) => {
      const w = buildWeapon(cls, team, P.has('npc') ? 0.66 : 0.86);
      const mat = matFor(w.finish);
      const m = new THREE.Mesh(w.geometry, mat);
      if (w.glow) m.add(new THREE.Mesh(w.glow, glow(w.glowColor, 2.6)));
      const g = new THREE.Group();
      g.add(m);
      g.scale.setScalar(scale);
      g.rotation.y = yaw;
      // 3 columns × 2 weapon rows; in each cell the corgi kit above the cat kit
      const col = i % 3, rr = Math.floor(i / 3), u = scale / 3;
      g.position.set((col - 1) * 3.4 * u, (0.5 - rr) * 2.7 * u + (row === 0 ? 0.52 : -0.42) * u, 0);
      scene.add(g);
      if (row === 1) label(`${WEAPONS[w.id as keyof typeof WEAPONS].name} · ${w.triangles} tris`, g.position.clone().add(new THREE.Vector3(0, -0.5 * u, 0)));
    });
  });
  camera.fov = 40;
  camera.position.set(0, 0, 8.9 * scale / 3);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------------------------
// range: shooters, surfaces, FX

interface Shooter { id: number; wid: string; av: CharacterAvatar; x: number; z: number; yaw: number; next: number; target: THREE.Vector3; pitch: number }

async function buildRange(scene: THREE.Scene, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement): Promise<void> {
  // --- the range: grass ground, a dirt strip, a steel plate, a board fence, a brick wall, a water trough ---
  const props: PropBox[] = [];
  const addBox = (type: string, x: number, y: number, z: number, hx: number, hy: number, hz: number, color: number, rotY = 0) => {
    props.push({ type, x, y, z, hx, hy, hz, rotY });
    const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), toon({ color }));
    m.position.set(x, y, z); m.rotation.y = rotY;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), toon({ color: PALETTE.grassDark }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  const dirt = new THREE.Mesh(new THREE.PlaneGeometry(6, 40), toon({ color: PALETTE.dirt }));
  dirt.rotation.x = -Math.PI / 2; dirt.position.set(-6, 0.005, -8);
  scene.add(dirt);
  const panels: Record<string, THREE.Vector3> = {};
  addBox('car', -4.2, 1.2, -9, 1.1, 1.2, 0.08, mixColor(PALETTE.concrete, PALETTE.hullDark, 0.5)); panels.metal = new THREE.Vector3(-4.2, 1.1, -8.92);
  addBox('fence', -1.4, 1.2, -9, 1.1, 1.2, 0.1, PALETTE.fenceWood); panels.wood = new THREE.Vector3(-1.4, 1.1, -8.9);
  addBox('bricks', 1.4, 1.2, -9, 1.1, 1.2, 0.2, PALETTE.brick); panels.stone = new THREE.Vector3(1.4, 1.1, -8.8);
  const water = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), toon({ color: PALETTE.water }));
  water.rotation.x = -Math.PI / 2; water.position.set(4.4, 0.06, -8.2);
  scene.add(water);
  panels.water = new THREE.Vector3(4.4, 0.06, -8.2);
  panels.dirt = new THREE.Vector3(-3.4, 0, -5.6);
  panels.grass = new THREE.Vector3(1.6, 0, -5.4);
  const world: SurfaceWorld = {
    height: () => 0,
    props,
    water: [{ id: 'trough', shape: 'circle', x: 4.4, z: -8.2, r: 1.6, surfaceY: 0.06, bottomY: -0.4, drag: 0.6 }],
    surface: (x) => ({ dirt: x > -9 && x < -3 ? 1 : 0, sand: 0, mulch: 0, wild: 0 }),
  };

  // --- shooters ---
  const wids = wpnParam === 'all' ? CLASS_IDS.map((c) => CLASSES[c].primary) : [wpnParam];
  const shooters: Shooter[] = [];
  const hero = wids.length === 1;
  wids.forEach((wid, i) => {
    const cls = clsOf(wid);
    const team = (P.get('team') === '1' || (wpnParam === 'all' && i % 2 === 1)) ? Team.Cats : Team.Corgis;
    const av = createCharacter({ species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, team, seed: 3 + i * 5, isLocal: hero });
    const panel = (panels[surfParam] ?? panels.metal).clone();
    // one shooter: square to its panel (ground surfaces: 6 m ahead of it); a line: spread across the range
    const x = hero ? (view === 'fire' ? panel.x : 0) : (i - (wids.length - 1) / 2) * 1.9;
    const z = hero && view === 'fire' && panel.y < 0.5 ? panel.z + 6 : 0;
    av.root.position.set(x, 0, z);
    scene.add(av.root);
    const tgt = view === 'impacts' ? panels.metal.clone() : panel;
    if (!hero) tgt.set(x * 1.2, 1.0, -8.85);
    shooters.push({ id: 10 + i, wid, av, x, z, yaw: 0, next: 0.15 + (hero ? 0 : i * 0.0), target: tgt, pitch: 0 });
  });

  // --- a target cat for view=hits ---
  let dummy: CharacterAvatar | null = null;
  if (view === 'hits') {
    dummy = createCharacter({ species: Species.Cat, cls: 'assault', team: Team.Cats, seed: 21, isLocal: false });
    dummy.root.position.set(0.3, 0, -4.5);
    dummy.root.rotation.y = 0.35;
    scene.add(dummy.root);
  }

  const views: MuzzleSource = { get: (id) => { const s = shooters.find((q) => q.id === id); return s ? { avatar: s.av } : undefined; } };
  const fx = createFx(scene, camera, views, { seed: 7, world, quality });
  lab.fx = fx;
  const audio = createAudio();
  canvas.addEventListener('pointerdown', () => { void audio.unlock(); });
  audio.setWorld(world);
  const hf = createHitFeedback(document.getElementById('ui')!, { clock: () => lab.t });

  // --- camera ---
  const cam = P.get('cam') ?? (view === 'fire' ? (hero ? 'ots' : 'front') : view === 'hits' ? 'ots' : 'front');
  const s0 = shooters[0];
  if (view === 'explode') { camera.position.set(3.2, 2.6, 2.5); camera.lookAt(-1.2, 0.6, -5.5); }
  else if (view === 'impacts') { camera.position.set(0.4, 1.6, -3.2); camera.lookAt(0, 0.9, -9); }
  else if (cam === 'impact') {
    // close on the hit point: walls from the front-right, ground surfaces from above-right
    const t = s0.target, ground = t.y < 0.5;
    camera.position.set(t.x + (ground ? 1.4 : 1.3), t.y + (ground ? 1.3 : 0.35), t.z + (ground ? 1.9 : 2.3));
    camera.lookAt(t.x, t.y + (ground ? 0.1 : 0), t.z);
  }
  else if (cam === 'side') { camera.position.set(s0.x + 1.7, 1.0, s0.z - 0.55); camera.lookAt(s0.x - 0.1, 0.85, s0.z - 0.85); }
  else if (cam === 'ots') { camera.position.set(s0.x + 1.25, 1.75, s0.z + 2.6); camera.lookAt(s0.target.x + 0.4, s0.target.y + 0.3, s0.target.z); }
  else if (hero) { camera.position.set(s0.x - 1.6, 1.0, s0.z - 1.7); camera.lookAt(s0.x + 0.1, 0.9, s0.z - 0.3); }
  else { camera.position.set(0, 1.9, 5.5); camera.lookAt(0, 0.9, -3); }
  camera.fov = Number(P.get('fov') ?? 55);
  camera.updateProjectionMatrix();

  // --- simulation ---
  const states = new Map<number, EntityState>();
  const frame: AvatarFrame = { speed: 0, vy: 0, grounded: true, anim: 0, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: true, sprinting: false };
  const st = (id: number, x: number, z: number, team: number, species: number): EntityState => ({
    id, kind: EntityKind.Bot, team: team as 0 | 1, species: species as 0 | 1, cls: 0, seed: id, x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
    anim: 0, flags: 1, hp: 100, weapon: 0, ammo: 30,
  } as unknown as EntityState);
  for (const s of shooters) states.set(s.id, st(s.id, s.x, s.z, s.av === shooters[0].av ? 0 : 1, 0));
  if (dummy) states.set(99, st(99, 0.3, -4.5, 1, Species.Cat));
  const local = shooters[0].id;
  const emit = (ev: GameEvent) => {
    lab.events++;
    const r = fx.onGameEvent(ev, { states, localId: local });
    void r;
    audio.onGameEvent(ev);
    hf.onGameEvent(ev, local);
    if (ev.e === 'fire') shooters.find((q) => q.id === ev.id)?.av.trigger('fire');
    if (ev.e === 'hit' && dummy) dummy.trigger('hit', ev.dmg / 20);
  };
  // impacts view: cycle the target over every surface
  const impactOrder = ['metal', 'wood', 'stone', 'dirt', 'grass', 'water'];
  let shot = 0, hitN = 0, boomAt = 0.25;
  const aimVec = new THREE.Vector3(), eye = new THREE.Vector3();

  stepHook = (dt) => {
    const t = lab.t;
    for (const s of shooters) {
      // face the target, pitch toward it
      if (view === 'hits') s.target.set(0.3 + Math.sin(t * 3) * 0.12, 0.72 + Math.cos(t * 5) * 0.12, -4.5);
      if (view === 'impacts') {
        const key = impactOrder[Math.floor(shot / 3) % impactOrder.length];
        const base = panels[key];
        s.target.set(base.x + ((shot * 0.37) % 1 - 0.5) * 1.3, key === 'water' || key === 'dirt' || key === 'grass' ? base.y : base.y + ((shot * 0.61) % 1 - 0.5) * 1.2, base.z + (key === 'dirt' || key === 'grass' || key === 'water' ? ((shot * 0.53) % 1 - 0.5) * 1.4 : 0));
      }
      eye.set(s.x, 1.05, s.z);
      aimVec.subVectors(s.target, eye);
      s.yaw = Math.atan2(-aimVec.x, -aimVec.z);
      s.pitch = Math.atan2(aimVec.y, Math.hypot(aimVec.x, aimVec.z));
      s.av.root.rotation.y = s.yaw;
      frame.aimPitch = s.pitch; frame.firing = t - s.next > -0.2;
      s.av.update(frame, dt);
      const sst = states.get(s.id)!; sst.yaw = s.yaw;
      if (view !== 'explode' && t >= s.next) {
        const def = WEAPONS[s.wid as keyof typeof WEAPONS];
        const d = aimVec.clone().normalize();
        const hit = view === 'hits' ? 99 : -1;
        emit({ e: 'fire', id: s.id, wpn: weaponIndex(s.wid), x: eye.x, y: eye.y, z: eye.z, dx: d.x, dy: d.y, dz: d.z, hx: s.target.x, hy: s.target.y, hz: s.target.z, hit });
        if (view === 'hits') {
          hitN++;
          const crit = hitN % 4 === 0;
          emit({ e: 'hit', src: s.id, dst: 99, dmg: crit ? 24 : def.damage, x: s.target.x, y: s.target.y + (crit ? 0.35 : 0), z: s.target.z + 0.2, crit });
          if (hitN % 7 === 0) emit({ e: 'death', id: 99, by: s.id });
        }
        shot++;
        s.next = t + (view === 'impacts' ? 0.18 : Math.max(period, 1 / def.fireRate));
      }
    }
    if (dummy) { frame.aimPitch = 0; frame.firing = false; dummy.update(frame, dt); }
    if (view === 'explode' && t >= boomAt) {
      emit({ e: 'explode', x: -1.2, y: 0.15, z: -5.5, r: 4.2, by: local });
      boomAt = t + 3.2;
    }
    fx.update(dt, states, local);
    audio.update(camera, states, local, dt);
    hf.update();
  };
}

function mixColor(a: number, b: number, t: number): number { return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex(); }

main().catch((e) => { lab.error = String(e?.stack ?? e); console.error(e); });

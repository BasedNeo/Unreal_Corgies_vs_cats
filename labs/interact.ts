// Interaction lab (S1): Ordnance Kiosks, Upgrade Cores, Golden Kibble, the objective beacon and the DOM prompts,
// with the real style pipeline.
//   /labs/interact.html?view=showcase[&picker=1]   both teams' kiosks, the four cores (one refilling), kibble, a local
//                                                  corgi at its kiosk (prompt / picker), buff chips, mission card
//   /labs/interact.html?view=objective[&contested=1] the trampoline-hold step: ring + progress pips + mission card
//   /labs/interact.html?view=yard&focus=kiosk0|kiosk1|<spot id>|squeaker   the real West Yard with a real Sim: runtime
//                                                  kiosk sites next to the Kart-O-Matics, cores and kibble at their spots
//   &webgl forces WebGL2 · &cam=x,y,z&look=x,y,z overrides the camera · &hud=0 hides the info box
// Exposes window.__cvc (ready, fps, drawCalls, triangles, interact stats) for tools/probe.mjs.
import { debug } from '../src/client/debug/debug-hook';
import * as THREE from 'three/webgpu';
import { createRenderContext, type RenderContext } from '../src/client/engine/renderer';
import { toon } from '../src/client/style/style-webgpu.js';
import { PALETTE } from '../src/client/style/style-tokens.js';
import { createInteractViews, createInteractPrompts } from '../src/client/interact';
import { createVehicleViews } from '../src/client/vehicles';
import { createAvatar } from '../src/client/procgen/characters';
import { createWorldView } from '../src/client/world/world-view';
import type { Avatar } from '../src/client/views/avatar';
import type { EntityState, GameEvent } from '../src/shared/protocol';
import { Anim, CLASS_IDS, EFlag, EntityKind, Species, Team, type TeamId } from '../src/shared/types';
import { terminalIndex, terminalKindAt } from '../src/shared/content/terminals';
import { PICKUP_IDS, PICKUP_LAYOUTS } from '../src/shared/content/pickups';
import { objectiveChainIndex } from '../src/shared/content/objectives';
import { createWorldData } from '../src/shared/world/world-data';
import { surfaceAt } from '../src/shared/world/queries';
import { Sim } from '../src/sim/sim';
import { interactSystems } from '../src/sim/interact';
import { vehicleSystems } from '../src/sim/vehicles';
import { movementSystem } from '../src/sim/systems/movement';
import { physicsStepSystem } from '../src/sim/systems/core';
import { worldSystems } from '../src/sim/world/systems';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'showcase';
const info = document.getElementById('info')!;
const labels = document.getElementById('labels')!;
const ui = document.getElementById('ui')!;
type LabDebug = typeof debug & { drawCalls: number; triangles: number; interact: unknown; view: string };
const lab = debug as LabDebug;
lab.view = view;

function enableShadows(ctx: RenderContext, extent = 14): void {
  ctx.scene.traverse((o) => {
    const l = o as THREE.DirectionalLight;
    if (l.isDirectionalLight && !l.castShadow && l.intensity > 2) {
      l.castShadow = true;
      l.shadow.mapSize.set(2048, 2048);
      const c = l.shadow.camera as THREE.OrthographicCamera;
      c.left = -extent; c.right = extent; c.top = extent; c.bottom = -extent; c.near = 0.5; c.far = 80;
      l.position.multiplyScalar(3);
      l.shadow.bias = -0.0005;
    }
  });
}

function groundDisc(ctx: RenderContext, r: number): void {
  const g = new THREE.Mesh(new THREE.CircleGeometry(r, 64), toon({ color: PALETTE.grass }));
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  ctx.scene.add(g);
  const stripe = toon({ color: PALETTE.grassDark });
  for (let i = -6; i <= 6; i += 2) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(3, r * 1.8), stripe);
    s.rotation.x = -Math.PI / 2; s.position.set(i * 3, 0.004, 0); s.receiveShadow = true;
    ctx.scene.add(s);
  }
}

function label(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'lbl'; d.textContent = text;
  labels.appendChild(d);
  return d;
}
const lv = new THREE.Vector3();
function placeLabel(el: HTMLDivElement, cam: THREE.Camera, x: number, y: number, z: number): void {
  lv.set(x, y, z).project(cam);
  el.style.left = `${(lv.x * 0.5 + 0.5) * innerWidth}px`;
  el.style.top = `${(-lv.y * 0.5 + 0.5) * innerHeight}px`;
  el.style.display = lv.z < 1 ? 'block' : 'none';
}

function applyCameraOverride(cam: THREE.PerspectiveCamera): boolean {
  if (!params.has('cam') || !params.has('look')) return false;
  const [x, y, z] = params.get('cam')!.split(',').map(Number), [lx, ly, lz] = params.get('look')!.split(',').map(Number);
  cam.position.set(x, y, z); cam.lookAt(lx, ly, lz);
  return true;
}

const base = { species: 0, seed: 1, pitch: 0, vx: 0, vy: 0, vz: 0, anim: Anim.Idle, hp: 0, maxHp: 0, flags: 0, weapon: -1, ammo: 0, yaw: 0 } as const;
const pickupState = (id: number, item: (typeof PICKUP_IDS)[number], x: number, y: number, z: number, seed: number, extra: Partial<EntityState> = {}): EntityState => ({
  ...base, id, kind: EntityKind.Pickup, team: Team.Neutral, cls: PICKUP_IDS.indexOf(item), x, y, z, seed, ...extra,
});

interface Pet { avatar: Avatar; s: EntityState }
function makePet(ctx: RenderContext, s: EntityState, local: boolean): Pet {
  const avatar = createAvatar({ species: s.species as 0 | 1, cls: CLASS_IDS[s.cls] ?? 'assault', team: s.team as TeamId, seed: s.seed, isLocal: local });
  avatar.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  ctx.scene.add(avatar.root);
  return { avatar, s };
}
function updatePet(p: Pet, dt: number): void {
  const s = p.s;
  p.avatar.root.position.set(s.x, s.y, s.z);
  p.avatar.root.rotation.y = s.yaw;
  p.avatar.update({ speed: 0, vy: 0, grounded: true, anim: s.anim, flags: s.flags, aimPitch: 0, aimYawOffset: 0, hpFrac: s.maxHp ? s.hp / s.maxHp : 1, dead: false, firing: false, aiming: false, sprinting: false }, dt);
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const ctx = await createRenderContext(document.getElementById('app')!, { forceWebGL: params.has('webgl') });
  debug.backend = ctx.backend;
  const cam = ctx.camera;
  const prompts = createInteractPrompts(ui, { send: (m) => console.log('[lab] send', JSON.stringify(m)) });
  let tick: (dt: number) => string;
  let t = 0;

  if (view === 'showcase' || view === 'objective') {
    enableShadows(ctx, view === 'objective' ? 16 : 9);
    groundDisc(ctx, 60);
    const iv = createInteractViews(ctx.scene, { camera: cam });
    const states = new Map<number, EntityState>();
    const pets: Pet[] = [];
    const localId = 100;
    const ev = (e: GameEvent) => { iv.onGameEvent(e); prompts.onGameEvent(e, localId); };
    const beacon = (step: number, ammo: number, flags: number, x: number, y: number, z: number): EntityState => ({
      ...base, id: 50, kind: EntityKind.Prop, team: Team.Corgis, cls: objectiveChainIndex('yard_squeaker'), x, y, z, weapon: step, ammo, flags,
      hp: (ammo / 100) * 20, maxHp: 20,
    });
    let labelsFn: () => void = () => {};
    if (view === 'showcase') {
      const ORD = terminalIndex('ordnance_terminal');
      states.set(1, { ...base, id: 1, kind: EntityKind.Terminal, team: Team.Corgis, cls: ORD, x: -2.1, y: 0, z: -2.2, yaw: Math.PI - 0.32 });
      states.set(2, { ...base, id: 2, kind: EntityKind.Terminal, team: Team.Cats, cls: ORD, x: 2.3, y: 0, z: -2.6, yaw: Math.PI + 0.38 });
      states.set(10, pickupState(10, 'overclock', -4.6, 0.8, 1.4, 0));
      states.set(11, pickupState(11, 'thick_fur', -2.3, 0.8, 2.6, 1));
      states.set(12, pickupState(12, 'zoomies_plus', 2.4, 0.8, 2.4, 2));
      states.set(13, pickupState(13, 'squeaky_clean', 4.7, 0.8, 1.2, 3, { flags: EFlag.Busy, ammo: 13, hp: 22, maxHp: 35 }));
      const kib: [number, number, number][] = [[-0.7, 0.62, 3.6], [0.55, 0.9, 3.9], [-5.6, 1.9, -1.3], [6.0, 1.2, -1.6]];
      kib.forEach(([x, y, z], i) => states.set(20 + i, pickupState(20 + i, 'golden_kibble', x, y, z, i)));
      states.set(50, beacon(0, 0, 0, 7.6, 0, -5.5));
      // The local corgi at its kiosk (seen from behind), a cat by the other one.
      const me: EntityState = { ...base, id: localId, kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls: 0, x: -1.55, y: 0, z: -0.62, yaw: Math.PI - 0.32 + Math.PI, hp: 88, maxHp: 120, seed: 7, flags: EFlag.Grounded };
      me.yaw = Math.atan2(-(-2.1 - me.x), -(-2.2 - me.z));
      states.set(localId, me);
      const cat: EntityState = { ...base, id: 101, kind: EntityKind.Bot, team: Team.Cats, species: Species.Cat, cls: 1, x: 3.9, y: 0, z: -1.2, yaw: 0.9, hp: 90, maxHp: 90, seed: 3, flags: EFlag.Grounded };
      states.set(101, cat);
      pets.push(makePet(ctx, me, true), makePet(ctx, cat, false));
      ev({ e: 'pickup', id: localId, item: 'overclock' });
      ev({ e: 'pickup', id: localId, item: 'zoomies_plus' });
      for (let i = 0; i < 3; i++) ev({ e: 'pickup', id: localId, item: 'golden_kibble' });
      if (!applyCameraOverride(cam)) { cam.position.set(0.3, 3.3, 9.8); cam.lookAt(0.2, 1.25, -0.6); }
      cam.fov = 50; cam.updateProjectionMatrix();
      const l = [label('Ordnance Kiosk (Corgis)'), label('Ordnance Kiosk (Cats)'), label('Overclock'), label('Thick Fur'), label('Zoomies+'), label('Squeaky Clean · 13 s'), label('Golden Kibble'), label('the Squeaker')];
      labelsFn = () => {
        placeLabel(l[0], cam, -2.1, 3.55, -2.2); placeLabel(l[1], cam, 2.3, 3.55, -2.6);
        placeLabel(l[2], cam, -4.6, 1.6, 1.4); placeLabel(l[3], cam, -2.3, 1.6, 2.6); placeLabel(l[4], cam, 2.4, 1.6, 2.4); placeLabel(l[5], cam, 4.7, 1.6, 1.2);
        placeLabel(l[6], cam, 0, 1.45, 3.8); placeLabel(l[7], cam, 7.6, 1.2, -5.5);
      };
    } else {
      // The hold step: the trampoline stand-in (a pad) with the ring; two corgis holding, maybe a cat contesting.
      const contested = params.has('contested');
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(7.0, 7.0, 1.25, 40), toon({ color: PALETTE.accentHot }));
      pad.position.y = 0.625; pad.receiveShadow = true; pad.castShadow = true;
      const mat = new THREE.Mesh(new THREE.CylinderGeometry(5.8, 5.8, 0.02, 40), toon({ color: PALETTE.catBlack }));
      mat.position.y = 1.26;
      ctx.scene.add(pad, mat);
      states.set(50, beacon(1, contested ? 46 : 63, contested ? EFlag.Busy : 0, 0, 1.25, 0));
      const me: EntityState = { ...base, id: localId, kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls: 0, x: -1.6, y: 1.25, z: 2.2, yaw: 0.3, hp: 120, maxHp: 120, seed: 7, flags: EFlag.Grounded };
      const pal: EntityState = { ...me, id: 102, kind: EntityKind.Bot, x: 2.2, z: 1.6, yaw: -0.4, seed: 12, cls: 1 };
      states.set(localId, me); states.set(102, pal);
      pets.push(makePet(ctx, me, true), makePet(ctx, pal, false));
      if (contested) {
        const cat: EntityState = { ...base, id: 103, kind: EntityKind.Bot, team: Team.Cats, species: Species.Cat, cls: 0, x: 5.5, y: 0, z: 6.6, yaw: 2.4, hp: 90, maxHp: 90, seed: 5, flags: EFlag.Grounded };
        states.set(103, cat); pets.push(makePet(ctx, cat, false));
      }
      if (!applyCameraOverride(cam)) { cam.position.set(-2, 9.5, 19); cam.lookAt(0, 1, 0); }
      cam.fov = 55; cam.updateProjectionMatrix();
    }
    if (params.has('picker')) prompts.openPicker();
    let frames = 0;
    tick = (dt) => {
      t += dt;
      iv.sync(states, dt);
      for (const p of pets) updatePet(p, dt);
      prompts.update(states, localId, dt);
      if (frames++ === 2 && params.has('picker') && !prompts.pickerOpen) prompts.openPicker();
      labelsFn();
      lab.interact = iv.stats();
      return `${view} · ${JSON.stringify(iv.stats())} · prompt: ${prompts.target?.verb ?? '-'}`;
    };
  } else {
    // The real West Yard with a real Sim: runtime-placed kiosks (both kinds), cores and kibble, objective beacon.
    const data = createWorldData(1);
    const worldView = createWorldView(ctx.scene, data, { quality: (params.get('q') as 'low' | 'med' | 'high') ?? 'high' });
    const sim = await Sim.create({ seed: 1, world: data, systems: [...vehicleSystems(), ...interactSystems(), movementSystem, ...worldSystems(), physicsStepSystem] });
    sim.state.room = { mode: 'yard-skirmish' };
    sim.state.interactConfig = { coreFirstSpawn: 0.05, coreStagger: 0 };
    sim.step();
    sim.state.match = { mode: 'yard-skirmish', phase: 'live', timeLeft: 0, score: [0, 0], objective: '', wave: 1, winner: -1 };
    for (let i = 0; i < 12; i++) sim.step();
    const iv = createInteractViews(ctx.scene, { world: data, camera: cam });
    const vv = createVehicleViews(ctx.scene, { world: data, camera: cam });
    const focus = params.get('focus') ?? 'kiosk0';
    const layout = PICKUP_LAYOUTS['West Yard'];
    const spot = [...layout.cores, ...layout.kibble].find((s) => s.id === focus);
    const kiosks = [...sim.entities.values()].filter((e) => e.ordnance);
    let target = { x: 0, y: 0, z: 0 }, from = { x: 6, y: 4, z: 8 };
    if (focus.startsWith('kiosk')) {
      const k = kiosks.find((e) => e.team === Number(focus.slice(5))) ?? kiosks[0];
      const fx = -Math.sin(k.yaw), fz = -Math.cos(k.yaw);
      target = { x: k.pos.x + fx * 1.2, y: k.pos.y + 1.2, z: k.pos.z + fz * 1.2 };
      from = { x: k.pos.x + fx * 9 + fz * 4.5, y: k.pos.y + 3.6, z: k.pos.z + fz * 9 - fx * 4.5 };
    } else if (spot) {
      target = { x: spot.x, y: spot.y, z: spot.z };
      const r = spot.route?.[0] ?? [spot.x + 6, spot.y, spot.z + 6];
      const dx = spot.x - r[0], dz = spot.z - r[2], dl = Math.hypot(dx, dz) || 1;
      from = { x: spot.x - (dx / dl) * 7 + (dz / dl) * 2, y: spot.y + 2.4, z: spot.z - (dz / dl) * 7 - (dx / dl) * 2 };
      from.y = Math.max(from.y, surfaceAt(data, from.x, from.z).y + 1.8);
    } else if (focus === 'squeaker') {
      target = { x: 47, y: 0.8, z: 78.4 }; from = { x: 39, y: 4.2, z: 67 };
    }
    if (!applyCameraOverride(cam)) { cam.position.set(from.x, from.y, from.z); cam.lookAt(target.x, target.y, target.z); cam.fov = 58; cam.updateProjectionMatrix(); }
    let frames = 0;
    tick = (dt) => {
      t += dt;
      sim.step(); sim.drainEvents();
      const states = new Map<number, EntityState>();
      for (const e of sim.entities.values()) states.set(e.id, sim.toState(e));
      iv.sync(states, dt);
      // V1's views draw every Terminal as a Kart-O-Matic: hand them the vehicle terminals only (lead wiring note).
      const vstates = new Map([...states].filter(([, s]) => s.kind !== EntityKind.Terminal || terminalKindAt(s.cls) === 'vehicle'));
      vv.sync(vstates, dt);
      worldView.update(dt, cam);
      if (++frames === 3) lab.interact = { ...iv.stats(), kiosks: kiosks.map((k) => ({ team: k.team, x: +k.pos.x.toFixed(1), z: +k.pos.z.toFixed(1), yaw: +k.yaw.toFixed(2) })) };
      return `yard · focus ${focus} · kiosks ${kiosks.map((k) => `${k.team ? 'Cats' : 'Corgis'} (${k.pos.x.toFixed(1)}, ${k.pos.z.toFixed(1)})`).join(' · ')} · ${JSON.stringify(iv.stats())}`;
    };
  }

  ctx.renderer.info.autoReset = false;
  let last = performance.now(), frames = 0, fpsT = last, fpsN = 0;
  ctx.renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const text = tick(dt);
    ctx.renderer.info.reset();
    ctx.render();
    frames++; fpsN++;
    if (now - fpsT > 500) { debug.fps = (fpsN * 1000) / (now - fpsT); fpsN = 0; fpsT = now; }
    const ri = ctx.renderer.info.render as unknown as { drawCalls?: number; calls?: number; triangles?: number };
    lab.drawCalls = ri.drawCalls ?? ri.calls ?? 0;
    lab.triangles = ri.triangles ?? 0;
    debug.frames = frames;
    debug.frameMs = dt * 1000;
    debug.ready = frames > 5;
    info.style.display = params.get('hud') === '0' ? 'none' : 'block';
    info.textContent = `${text}\n${debug.fps.toFixed(1)} fps · ${lab.drawCalls} draws · ${(lab.triangles / 1000).toFixed(1)}k tris · ${ctx.backend}`;
  });
}

main().catch((err) => {
  console.error(err);
  debug.errors.push(String(err?.stack ?? err));
  info.textContent = `Failed: ${String(err?.message ?? err)}`;
});

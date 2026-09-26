// Vehicle lab: the Mower Kart and the Kart-O-Matic terminal in both team colors, with the real style
// pipeline, real avatars seated in Anim.Drive, and the authoritative sim driving the karts.
//   /labs/vehicles.html?view=showcase            both teams side by side (terminal states: ready / cooling)
//   /labs/vehicles.html?view=drive&t=2.4         a real Sim on a test yard, scripted lap (drift, turbo, ramp,
//                                                jump pad); t = fast-forward seconds (60 Hz) then keep running
//   /labs/vehicles.html?view=yard&team=0         West Yard: runtime-placed terminals + vended karts at the bases
//   /labs/vehicles.html?view=plane               R1: both teams' RC planes (parked / banking + boosting) with seated,
//                                                tilted pilots, and the Rooftop Hangar with its runway markings
//   /labs/vehicles.html?view=fly&route=shed&t=4  R1: a real Sim on the West Yard: board at the Rooftop Hangar and fly
//                                                (route = shed | circuit | crash; cls = the pilot's class) with the
//                                                game's chase camera rig, avatars and FX; t = fast-forward seconds
//   &webgl forces WebGL2 · &freeze stops time after the fast-forward · &cam=x,y,z&look=x,y,z overrides the camera
// Exposes window.__cvc (ready, fps, drawCalls, triangles, vehicles) for tools/probe.mjs.
import { debug } from '../src/client/debug/debug-hook';
import * as THREE from 'three/webgpu';
import { createRenderContext, type RenderContext } from '../src/client/engine/renderer';
import { toon } from '../src/client/style/style-webgpu.js';
import { PALETTE } from '../src/client/style/style-tokens.js';
import { createVehicleViews, vehicleCameraFor, mountedBodyYaw, mountedBodyTilt, mountedVehicle, followYaw, type VehicleViews } from '../src/client/vehicles';
import { EntityViews } from '../src/client/views/entity-views';
import { createThirdPersonCamera } from '../src/client/camera/third-person';
import { createFx } from '../src/client/fx';
import { lerpAngle } from '../src/shared/math';
import { packPlaneAux, vehicleIndex } from '../src/shared/content/vehicles';
import { terminalIndex } from '../src/shared/content/terminals';
import type { GameEvent } from '../src/shared/protocol';
import { combatSystems } from '../src/sim/combat';
import { planeAutopilot, mountPlane, type AutopilotGoal } from '../src/sim/vehicles';
import { createAvatar } from '../src/client/procgen/characters';
import type { Avatar } from '../src/client/views/avatar';
import type { EntityState } from '../src/shared/protocol';
import { Anim, EFlag, EntityKind, Species, Team, type TeamId } from '../src/shared/types';
import { Btn } from '../src/shared/input';
import { VEHICLES, TERMINALS } from '../src/shared/content/vehicles';
import type { PropBox, WorldData } from '../src/shared/world/world-data';
import { createWorldData } from '../src/shared/world/world-data';
import { createWorldView } from '../src/client/world/world-view';
import { Sim } from '../src/sim/sim';
import type { SimEntity } from '../src/sim/entity';
import { vehicleSystems, spawnKart, mountKart, useTerminal } from '../src/sim/vehicles';
import { movementSystem } from '../src/sim/systems/movement';
import { physicsStepSystem } from '../src/sim/systems/core';
import { worldSystems } from '../src/sim/world/systems';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'showcase';
const info = document.getElementById('info')!;
const labels = document.getElementById('labels')!;
const DT = 1 / 60;
type LabDebug = typeof debug & { drawCalls: number; triangles: number; vehicles: unknown; view: string };
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

function groundDisc(ctx: RenderContext, r: number, color = PALETTE.grass): void {
  const g = new THREE.Mesh(new THREE.CircleGeometry(r, 64), toon({ color }));
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  g.name = 'lab_ground';
  ctx.scene.add(g);
  // mown stripes for scale and speed reading
  const stripe = toon({ color: PALETTE.grassDark });
  for (let i = -6; i <= 6; i += 2) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(3, r * 1.8), stripe);
    s.rotation.x = -Math.PI / 2; s.position.set(i * 3, 0.004, 0); s.receiveShadow = true;
    ctx.scene.add(s);
  }
}

function propMeshes(ctx: RenderContext, props: PropBox[]): void {
  for (const p of props) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.hx * 2, p.hy * 2, p.hz * 2), toon({ color: p.type === 'ramp' ? PALETTE.fenceWood : p.type === 'deck' ? PALETTE.fenceDark : PALETTE.hull }));
    m.position.set(p.x, p.y, p.z);
    m.rotation.set(p.pitch ?? 0, p.rotY, p.roll ?? 0, 'YXZ');
    m.castShadow = true; m.receiveShadow = true;
    ctx.scene.add(m);
  }
}

/** Minimal West Yard render (terrain grid + collider boxes/cylinders), used when the world view can't build. */
function simpleWorld(ctx: RenderContext, data: WorldData): void {
  const g = data.terrain;
  if (g) {
    const size = (g.n - 1) * g.cell;
    const geo = new THREE.PlaneGeometry(size, size, g.n - 1, g.n - 1);
    geo.rotateX(-Math.PI / 2);
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, data.height(p.getX(i) + g.x0 + size / 2, p.getZ(i) + g.z0 + size / 2));
    geo.translate(g.x0 + size / 2, 0, g.z0 + size / 2);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, toon({ color: PALETTE.grass }));
    m.receiveShadow = true;
    ctx.scene.add(m);
  } else groundDisc(ctx, data.halfExtent);
  for (const b of data.props) {
    if (b.type === 'boundary') continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2), toon({ color: b.color ?? PALETTE.fenceWood }));
    m.position.set(b.x, b.y, b.z); m.rotation.set(b.pitch ?? 0, b.rotY, b.roll ?? 0, 'YXZ');
    m.castShadow = true; m.receiveShadow = true;
    ctx.scene.add(m);
  }
  for (const c of data.cylinders ?? []) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, c.hh * 2, 14), toon({ color: PALETTE.fenceDark }));
    m.position.set(c.x, c.y, c.z); m.castShadow = true;
    ctx.scene.add(m);
  }
}

interface Rider { avatar: Avatar; id: number }
function makeRider(ctx: RenderContext, id: number, species: number, team: TeamId, seed: number): Rider {
  const avatar = createAvatar({ species: species as 0 | 1, cls: 'assault', team, seed, isLocal: true });
  avatar.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  ctx.scene.add(avatar.root);
  return { avatar, id };
}
function updateRider(r: Rider, s: EntityState, states: Map<number, EntityState>, dt: number): void {
  r.avatar.root.position.set(s.x, s.y, s.z);
  r.avatar.root.rotation.y = mountedBodyYaw(s, states) ?? s.yaw;
  r.avatar.update({
    speed: 0, vy: 0, grounded: true, anim: s.anim, flags: s.flags, aimPitch: s.pitch, aimYawOffset: 0,
    hpFrac: s.maxHp ? s.hp / s.maxHp : 1, dead: false, firing: false, aiming: false, sprinting: false,
  }, dt);
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

function seatOf(k: EntityState): { x: number; y: number; z: number } {
  const s = VEHICLES.mower_kart.seat;
  const cp = Math.cos(k.pitch), sp = Math.sin(k.pitch);
  const ly = s.y * cp - s.z * sp, lz = s.y * sp + s.z * cp;
  return { x: k.x + s.x * Math.cos(k.yaw) + lz * Math.sin(k.yaw), y: k.y + ly, z: k.z - s.x * Math.sin(k.yaw) + lz * Math.cos(k.yaw) };
}

function stateOf(sim: Sim, e: SimEntity): EntityState { return sim.toState(e); }

function applyCameraOverride(cam: THREE.PerspectiveCamera): boolean {
  if (!params.has('cam') || !params.has('look')) return false;
  const [x, y, z] = params.get('cam')!.split(',').map(Number), [lx, ly, lz] = params.get('look')!.split(',').map(Number);
  cam.position.set(x, y, z); cam.lookAt(lx, ly, lz);
  return true;
}


/** The proposed EntityViews edit (docs/handoff/R1.md): a plane pilot's avatar tilts with the plane. */
function tiltAvatar(views: EntityViews, s: EntityState, states: Map<number, EntityState>): void {
  const v = views.get(s.id);
  const t = mountedBodyTilt(s, states);
  if (!v) return;
  v.avatar.root.rotation.order = 'YXZ';
  v.avatar.root.rotation.set(t?.pitch ?? 0, v.bodyYaw, t?.roll ?? 0, 'YXZ');
}

/**
 * R1 fly-through: a real Sim on the West Yard. A pilot walks up to the Rooftop Hangar, vends a plane (E), hops in
 * (E) and flies a route with the scripted autopilot. The camera is the game's third-person rig driven exactly like
 * the proposed main.ts wiring (vehicleCameraFor + followYaw + pitchFollow); the "mouse" is the autopilot's aim,
 * eased like a human hand, and it is both the camera direction and the flight command (mouse-aim).
 */
async function flyView(ctx: RenderContext): Promise<(dt: number) => string> {
  const cam = ctx.camera;
  const data = createWorldData(1);
  let worldView: { update(dt: number, camera: THREE.Camera): void; cameraColliders?: THREE.Object3D[] };
  try { worldView = createWorldView(ctx.scene, data); }
  catch (err) { console.warn('world view unavailable, using the lab fallback:', String(err)); simpleWorld(ctx, data); enableShadows(ctx, 60); worldView = { update() {} }; }
  const sim = await Sim.create({ seed: 1, world: data, systems: [...vehicleSystems(), movementSystem, ...worldSystems(), physicsStepSystem, ...combatSystems()] });
  sim.state.room = { mode: 'yard-skirmish' };
  sim.step();
  const term = [...sim.entities.values()].find((e) => e.terminal?.id === 'plane_hangar')!;
  const cls = (params.get('cls') ?? 'skyraider') as 'skyraider';
  const fx0 = -Math.sin(term.yaw), fz0 = -Math.cos(term.yaw);
  const dog = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls, name: 'Rex', x: term.pos.x + fx0 * 1.4, y: term.pos.y + 0.05, z: term.pos.z + fz0 * 1.4 });
  for (let i = 0; i < 10; i++) sim.step();
  const plane = useTerminal(sim, term, dog)!;
  sim.step();
  sim.placeCharacter(dog, plane.pos.x + 1.4, plane.pos.y + 0.05, plane.pos.z);
  sim.step();
  mountPlane(sim, plane, dog);
  sim.drainEvents();
  const route = params.get('route') ?? 'shed';
  const land: AutopilotGoal = { x: 46, z: -42, y: data.height(46, -42), mode: 'land', landYaw: 0 };
  const goals: AutopilotGoal[] = route === 'circuit' ? [{ x: 80, z: 25, y: 14 }, { x: 46, z: 50, y: 12 }, { x: 46, z: 30, y: 9 }, land]
    : route === 'crash' ? [{ x: 88, z: -12, y: 11 }, { x: 60, z: -20, y: 7 }]
    : [{ x: 47, z: 88, y: 13.1 }];
  let gi = 0, seq = 0, t = 0, aimYaw = plane.yaw, aimPitch = -0.1, phase = 'takeoff';
  const vehicles = createVehicleViews(ctx.scene, { world: data, camera: cam });
  const views = new EntityViews(ctx.scene);
  const fx = createFx(ctx.scene, cam, views, { heightAt: (x, z) => data.height(x, z) });
  const rig = createThirdPersonCamera(cam);
  if (worldView.cameraColliders) rig.setColliders(worldView.cameraColliders);
  const focus = new THREE.Vector3();
  const events: string[] = [];
  let states = new Map<number, EntityState>();
  const step = () => {
    t += DT;
    if (!plane.removed && dog.seat) {
      const g = goals[Math.min(gi, goals.length - 1)];
      const { cmd, state } = planeAutopilot(sim, plane, g);
      phase = state.phase;
      if (g.mode !== 'land' && state.distance < 12 && gi < goals.length - 1) gi++;
      // The crash route: after the first waypoint, point the nose at the garage's west wall and floor it.
      let wantYaw = cmd.yaw, wantPitch = cmd.pitch, buttons = cmd.buttons;
      if (route === 'crash' && gi >= 1) { wantYaw = Math.atan2(-(68 - plane.pos.x), -(-60 - plane.pos.z)); wantPitch = Math.atan2(3 - plane.pos.y, 25); buttons |= Btn.Sprint; phase = 'kamikaze'; }
      // A human hand: the aim eases toward where the autopilot wants to look.
      aimYaw = lerpAngle(aimYaw, wantYaw, 1 - Math.exp(-4 * DT));
      aimPitch += (wantPitch - aimPitch) * (1 - Math.exp(-4 * DT));
      sim.setInput(dog.id, { ...cmd, seq: ++seq, yaw: ((aimYaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), pitch: aimPitch, buttons });
    } else sim.setInput(dog.id, { seq: ++seq, mx: 0, mz: 0, yaw: aimYaw, pitch: -0.2, buttons: 0, rt: 0 });
    sim.step();
    for (const ev of sim.drainEvents()) {
      fx.onGameEvent(ev as GameEvent, { localId: dog.id, states });
      if (ev.e === 'explode' || ev.e === 'land' || ev.e === 'jump' || (ev.e === 'ability' && ev.id === plane.id)) events.push(`${t.toFixed(1)} ${ev.e}${ev.e === 'ability' ? ':' + ev.ability : ''}`);
    }
  };
  const render = (dt: number) => {
    states = new Map<number, EntityState>();
    for (const e of sim.entities.values()) states.set(e.id, stateOf(sim, e));
    vehicles.sync(states, dt);
    views.sync(states, dog.id, dt);
    const ds = states.get(dog.id);
    if (ds) tiltAvatar(views, ds, states);
    fx.update(dt, states, dog.id);
    const ps = ds ? mountedVehicle(ds, states) : null;
    if (!applyCameraOverride(cam)) {
      if (ps) {
        const c = vehicleCameraFor(ps);
        focus.set(ps.x, ps.y, ps.z);
        rig.update(focus, aimYaw, aimPitch, false, dt, Math.hypot(ps.vx, ps.vz), c);
      } else if (ds) {
        focus.set(ds.x, ds.y, ds.z);
        rig.update(focus, aimYaw, -0.25, false, dt, Math.hypot(ds.vx, ds.vz));
      }
    }
    worldView.update(dt, cam);
    const p = plane.plane!;
    lab.vehicles = {
      ...vehicles.stats(), route, phase, t: +t.toFixed(2), removed: plane.removed,
      plane: [+plane.pos.x.toFixed(1), +plane.pos.y.toFixed(1), +plane.pos.z.toFixed(1)], speed: +p.speed.toFixed(1),
      roll: +p.roll.toFixed(2), pitch: +plane.pitch.toFixed(2), throttle: +p.throttle.toFixed(2), hp: plane.health?.hp ?? 0,
      pilot: [+dog.pos.x.toFixed(1), +dog.pos.y.toFixed(1), +dog.pos.z.toFixed(1)], mounted: !!dog.seat, events: events.slice(-8),
    };
    return `fly · ${route} · t=${t.toFixed(1)} s · ${phase} · ${p.speed.toFixed(1)} m/s · alt ${plane.pos.y.toFixed(1)} m · bank ${(p.roll * 57.3).toFixed(0)}° · ${plane.removed ? 'CRASHED' : ''}\n${events.slice(-4).join(' · ')}`;
  };
  const ff = Number(params.get('t') ?? 0);
  for (let i = 0; i < Math.round(ff / DT); i++) { step(); if (i % 2 === 0 || i > Math.round(ff / DT) - 30) render(DT); }
  const freeze = params.has('freeze');
  return (dt: number) => {
    if (!freeze) { const n = Math.min(4, Math.max(1, Math.round(dt / DT))); for (let i = 0; i < n; i++) step(); }
    return render(freeze ? 0 : dt);
  };
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const ctx = await createRenderContext(document.getElementById('app')!, { forceWebGL: params.has('webgl') });
  debug.backend = ctx.backend;
  const cam = ctx.camera;
  let tick: (dt: number) => string;

  if (view === 'showcase') {
    enableShadows(ctx, 9);
    groundDisc(ctx, 40);
    const vehicles = createVehicleViews(ctx.scene);
    const states = new Map<number, EntityState>();
    const base = { species: 0, seed: 11, pitch: 0, vx: 0, vy: 0, vz: 0, anim: Anim.Idle, ammo: 100 } as const;
    states.set(1, { ...base, id: 1, kind: EntityKind.Terminal, team: Team.Corgis, cls: 0, x: -3.3, y: 0, z: -2.6, yaw: Math.PI - 0.35, hp: 20, maxHp: 20, flags: 0, weapon: -1 });
    states.set(2, { ...base, id: 2, kind: EntityKind.Terminal, team: Team.Cats, cls: 0, x: 3.3, y: 0, z: -2.6, yaw: Math.PI + 0.35, hp: 8, maxHp: 20, flags: EFlag.Busy, weapon: -1 });
    states.set(3, { ...base, id: 3, kind: EntityKind.Vehicle, team: Team.Corgis, cls: 0, x: -1.55, y: 0, z: 1.3, yaw: Math.PI + 0.62, hp: 260, maxHp: 260, flags: EFlag.Grounded | EFlag.Busy, weapon: 5, seed: 3 });
    states.set(4, { ...base, id: 4, kind: EntityKind.Vehicle, team: Team.Cats, cls: 0, x: 1.75, y: 0, z: 1.1, yaw: Math.PI - 0.7, hp: 70, maxHp: 260, flags: EFlag.Grounded | EFlag.Busy | EFlag.Sprinting, weapon: 6, seed: 4, ammo: 40 });
    for (const [rid, kid, species, team] of [[5, 3, Species.Corgi, Team.Corgis], [6, 4, Species.Cat, Team.Cats]] as const) {
      const k = states.get(kid)!;
      const p = seatOf(k);
      states.set(rid, { ...base, id: rid, kind: EntityKind.Player, team, species, cls: 0, x: p.x, y: p.y, z: p.z, yaw: k.yaw, hp: 120, maxHp: 120, flags: EFlag.Mounted | EFlag.Grounded, anim: Anim.Drive, weapon: 0, seed: rid * 13 });
    }
    const riders = [makeRider(ctx, 5, Species.Corgi, Team.Corgis, 5 * 13), makeRider(ctx, 6, Species.Cat, Team.Cats, 6 * 13)];
    if (!applyCameraOverride(cam)) { cam.position.set(0.2, 3.1, 8.4); cam.lookAt(0, 0.95, -0.4); }
    cam.fov = 50; cam.updateProjectionMatrix();
    const l1 = label('Mower Kart'), l2 = label('Purrmower · boosting · 27% armor'), l3 = label('Kart-O-Matic · ready'), l4 = label('Kart-O-Matic · cooling 12 s');
    tick = (dt) => {
      vehicles.sync(states, dt);
      for (const r of riders) updateRider(r, states.get(r.id)!, states, dt);
      placeLabel(l1, cam, -1.55, 2.1, 1.3); placeLabel(l2, cam, 1.75, 2.1, 1.1); placeLabel(l3, cam, -3.3, 2.75, -2.6); placeLabel(l4, cam, 3.3, 2.75, -2.6);
      lab.vehicles = vehicles.stats();
      return `showcase · kart ≤ 3k tris / ≤ 4 draws each · ${JSON.stringify(vehicles.stats())}`;
    };
  } else if (view === 'drive') {
    enableShadows(ctx, 30);
    groundDisc(ctx, 90);
    // The unit tests' kind of test yard: flat heightfield, a jump pad, a 20° ramp onto a 3 m deck, crates.
    const a = 20 * Math.PI / 180, len = 3 / Math.sin(a) + 1.2, run = Math.cos(a) * len;
    const props: PropBox[] = [
      { type: 'ramp', x: 0, y: (Math.sin(a) * len) / 2 - 0.25 / Math.cos(a), z: -18 - run / 2, hx: 2.5, hy: 0.25, hz: len / 2, rotY: 0, pitch: a },
      { type: 'deck', x: 0, y: 1.5, z: -18 - run - 5 + 0.3, hx: 3, hy: 1.5, hz: 5, rotY: 0 },
      { type: 'crate', x: -5, y: 0.7, z: 4, hx: 0.7, hy: 0.7, hz: 0.7, rotY: 0.4 },
      { type: 'crate', x: 5.5, y: 0.7, z: -6, hx: 0.7, hy: 0.7, hz: 0.7, rotY: 1.1 },
      { type: 'crate', x: 4, y: 0.5, z: 22, hx: 0.5, hy: 0.5, hz: 0.5, rotY: 0.2 },
      { type: 'crate', x: -7, y: 0.5, z: -50, hx: 0.5, hy: 0.5, hz: 0.5, rotY: 0.7 },
    ];
    const n = 81;
    const world: WorldData = {
      seed: 1, name: 'lab yard', height: () => 0, halfExtent: 80, killY: -30, props,
      terrain: { x0: -80, z0: -80, cell: 2, n, heights: new Float32Array(n * n) },
      spawns: [{ x: 0, y: 0, z: 20, yaw: 0, team: 0 }, { x: 0, y: 0, z: -40, yaw: Math.PI, team: 1 }],
      jumpPads: [{ id: 'pad', x: 0, y: 0, z: 14, r: 2.2, vy: 14 }],
      bounds: { minX: -78, maxX: 78, minZ: -78, maxZ: 78 },
    };
    propMeshes(ctx, props);
    const padMesh = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.3, 0.12, 24), toon({ color: PALETTE.tennisBall }));
    padMesh.position.set(0, 0.06, 14); padMesh.receiveShadow = true; ctx.scene.add(padMesh);
    const sim = await Sim.create({ seed: 5, world, systems: [...vehicleSystems(), movementSystem, ...worldSystems(), physicsStepSystem] });
    sim.state.vehicleConfig = { autoTerminals: false };
    sim.step();
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, 0, 0, 30, 0);
    const kart2 = spawnKart(sim, 'mower_kart', Team.Cats, 3.2, 0, 27, 0.5);
    const dog = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'Rex', x: 10, y: 0, z: 40 });
    sim.step();
    mountKart(sim, kart, dog);
    const vehicles = createVehicleViews(ctx.scene, { world, camera: cam });
    const rider = makeRider(ctx, dog.id, Species.Corgi, Team.Corgis, dog.seed);
    // Scripted lap: launch over the jump pad, up the ramp and off the deck, drift a U-turn, mini-turbo,
    // boost, then lazy circles. (t ≈ 1.8 airborne · 4.4 on the ramp · 5.6 off the deck · 7 drifting · 8.6 boosting)
    const script = (t: number): { mz: number; mx: number; b: number } => {
      if (t < 6.2) return { mz: 1, mx: 0, b: 0 };
      if (t < 8) return { mz: 1, mx: -1, b: Btn.Jump };
      if (t < 8.2) return { mz: 1, mx: 0, b: 0 };
      if (t < 9.8) return { mz: 1, mx: 0.1, b: Btn.Sprint };
      return { mz: 1, mx: -0.45, b: (t % 6) < 1.5 ? Btn.Jump : 0 };
    };
    let t = 0, seq = 0, camYaw = kart.yaw;
    const camCtl = { dist: 5.5, fov: 64, h: 1.55, pitch: -0.2 };
    const step = (dt: number) => {
      t += dt;
      const inp = script(t);
      sim.setInput(dog.id, { seq: ++seq, mx: inp.mx, mz: inp.mz, yaw: camYaw, pitch: 0, buttons: inp.b, rt: 0 });
      sim.step();
      sim.drainEvents();
    };
    const render = (dt: number) => {
      const states = new Map<number, EntityState>();
      for (const e of sim.entities.values()) states.set(e.id, stateOf(sim, e));
      vehicles.sync(states, dt);
      updateRider(rider, states.get(dog.id)!, states, dt);
      const ks = states.get(kart.id)!;
      const c = vehicleCameraFor(ks);
      camYaw = followYaw(camYaw, c.yaw, c.followRate, dt);
      camCtl.dist += (c.distance - camCtl.dist) * (1 - Math.exp(-4 * dt));
      camCtl.fov += (c.fov - camCtl.fov) * (1 - Math.exp(-4 * dt));
      if (!applyCameraOverride(cam)) {
        const px = ks.x, py = ks.y + c.height, pz = ks.z;
        const cp = Math.cos(c.pitch);
        cam.position.set(px + Math.sin(camYaw) * cp * camCtl.dist, py - Math.sin(c.pitch) * camCtl.dist, pz + Math.cos(camYaw) * cp * camCtl.dist);
        cam.lookAt(px - Math.sin(camYaw) * 6, py - 0.4, pz - Math.cos(camYaw) * 6);
        cam.fov = camCtl.fov; cam.updateProjectionMatrix();
      }
      lab.vehicles = { ...vehicles.stats(), speed: +Math.hypot(ks.vx, ks.vz).toFixed(2), kart: [+ks.x.toFixed(2), +ks.y.toFixed(2), +ks.z.toFixed(2)], flags: ks.flags, boost: ks.ammo, t: +t.toFixed(2), kart2: sim.entities.has(kart2.id) };
      return `drive · t=${t.toFixed(2)} s · ${Math.hypot(ks.vx, ks.vz).toFixed(1)} m/s · boost ${ks.ammo}% ${ks.flags & EFlag.Crouching ? '· DRIFT' : ''}${ks.flags & EFlag.Sprinting ? ' · BOOST' : ''}`;
    };
    const ff = Number(params.get('t') ?? 0);
    for (let i = 0; i < Math.round(ff / DT); i++) { step(DT); render(DT); }
    const freeze = params.has('freeze');
    tick = (dt) => {
      if (!freeze) { const n = Math.min(4, Math.max(1, Math.round(dt / DT))); for (let i = 0; i < n; i++) step(DT); }
      return render(freeze ? 0 : dt);
    };
  } else if (view === 'plane') {
    // R1 showcase: a parked corgi plane with its pilot, a cat plane banking + boosting overhead, the Rooftop Hangar.
    enableShadows(ctx, 10);
    groundDisc(ctx, 40, PALETTE.concrete);
    const vehicles = createVehicleViews(ctx.scene);
    const views = new EntityViews(ctx.scene);
    const states = new Map<number, EntityState>();
    const P = vehicleIndex('rc_plane');
    const base = { species: 0, pitch: 0, vx: 0, vy: 0, vz: 0, anim: Anim.Idle } as const;
    states.set(1, { ...base, id: 1, kind: EntityKind.Vehicle, team: Team.Corgis, cls: P, seed: 3, x: -1.4, y: 0, z: 0.6, yaw: Math.PI * 0.78, pitch: 0.05, hp: 140, maxHp: 140, flags: EFlag.Grounded | EFlag.Busy, weapon: 5, ammo: packPlaneAux(0.3, 0) });
    states.set(2, { ...base, id: 2, kind: EntityKind.Vehicle, team: Team.Cats, cls: P, seed: 4, x: 2.2, y: 1.9, z: -1.6, yaw: Math.PI * 1.12, pitch: 0.12, vx: 5, vz: 20, hp: 40, maxHp: 140, flags: EFlag.Busy | EFlag.Sprinting, weapon: 6, ammo: packPlaneAux(1, 0.75) });
    states.set(7, { ...base, id: 7, kind: EntityKind.Terminal, team: Team.Neutral, cls: terminalIndex('plane_hangar'), seed: 1, x: -5.2, y: 0, z: -3.2, yaw: Math.PI * 0.85, hp: 25, maxHp: 25, flags: 0, weapon: -1, ammo: 0 });
    const seat = (v: EntityState) => {
      const d = VEHICLES.rc_plane, sp = d.seat, roll = v.ammo % 1000 - 500;
      const r = roll / 100, cr = Math.cos(r), sr = Math.sin(r);
      let x = sp.x, y = sp.y - d.pivotY, z = sp.z;
      [x, y] = [x * cr - y * sr, x * sr + y * cr];
      const cp = Math.cos(v.pitch), spp = Math.sin(v.pitch);
      [y, z] = [y * cp - z * spp, y * spp + z * cp];
      const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
      return { x: v.x + x * cy + z * sy, y: v.y + d.pivotY + y, z: v.z - x * sy + z * cy };
    };
    for (const [rid, pid, species, team] of [[5, 1, Species.Corgi, Team.Corgis], [6, 2, Species.Cat, Team.Cats]] as const) {
      const p = seat(states.get(pid)!);
      states.set(rid, { ...base, id: rid, kind: EntityKind.Player, team, species, cls: 5, seed: rid * 13, x: p.x, y: p.y, z: p.z, yaw: states.get(pid)!.yaw, hp: 100, maxHp: 100, flags: EFlag.Mounted, anim: Anim.Drive, weapon: 0, ammo: 0 });
    }
    if (!applyCameraOverride(cam)) { cam.position.set(2.6, 3.4, 8.6); cam.lookAt(-0.6, 1.1, -0.8); }
    cam.fov = 50; cam.updateProjectionMatrix();
    const l1 = label('Fetch Flyer · parked'), l2 = label('Pounce Plane · banking + boost · 29% hull'), l3 = label('Rooftop Hangar · ready');
    tick = (dt) => {
      vehicles.sync(states, dt);
      views.sync(states, -1, dt);
      for (const id of [5, 6]) tiltAvatar(views, states.get(id)!, states);
      placeLabel(l1, cam, -1.4, 2.1, 0.6); placeLabel(l2, cam, 2.2, 3.9, -1.6); placeLabel(l3, cam, -5.2, 3.9, -3.2);
      lab.vehicles = vehicles.stats();
      return `plane showcase · ${JSON.stringify(vehicles.stats())}`;
    };
  } else if (view === 'fly') {
    tick = await flyView(ctx);
  } else {
    // West Yard: runtime-placed terminals, a vended kart at each base, a driver seated in each.
    const data = createWorldData(1);
    let worldView: { update(dt: number, camera: THREE.Camera): void };
    try {
      worldView = createWorldView(ctx.scene, data);
    } catch (err) {
      // The world lane's view is in flight: fall back to a plain toon terrain + collider boxes.
      console.warn('world view unavailable, using the lab fallback:', String(err));
      simpleWorld(ctx, data);
      enableShadows(ctx, 40);
      worldView = { update() {} };
    }
    const sim = await Sim.create({ seed: 1, world: data, systems: [...vehicleSystems(), movementSystem, ...worldSystems(), physicsStepSystem] });
    sim.state.room = { mode: 'yard-skirmish' }; // as a Room would: the mode's map setup places the terminals
    sim.state.vehicleConfig = { hangar: false }; // karts only here (view=fly shows the Rooftop Hangar)
    sim.step(); sim.step();
    const terms = [...sim.entities.values()].filter((e) => e.kind === EntityKind.Terminal);
    for (const term of terms) {
      const sp = term.team === Team.Cats ? Species.Cat : Species.Corgi;
      const fx = Math.sin(term.yaw), fz = Math.cos(term.yaw);
      const pet = sim.spawnCharacter({ team: term.team, species: sp, cls: 'assault', name: 'd', x: term.pos.x - fx * 1.8, y: term.pos.y + 0.1, z: term.pos.z - fz * 1.8 });
      for (let i = 0; i < 5; i++) sim.step();
      const kart = useTerminal(sim, term, pet);
      if (kart && params.get('mount') !== '0') { sim.step(); mountKart(sim, kart, pet); }
      for (let i = 0; i < 3; i++) sim.step();
    }
    const vehicles = createVehicleViews(ctx.scene, { world: data, camera: cam });
    const riders = new Map<number, Rider>();
    for (const e of sim.entities.values()) if (e.char) riders.set(e.id, makeRider(ctx, e.id, e.species, e.team, e.seed));
    const team = Number(params.get('team') ?? 0);
    const t0 = terms.find((e) => e.team === team) ?? terms[0];
    if (!applyCameraOverride(cam)) {
      // 3/4 view from in front of the kiosk, looking at kiosk + pad.
      const rx = Math.cos(t0.yaw), rz = -Math.sin(t0.yaw), fx = -Math.sin(t0.yaw), fz = -Math.cos(t0.yaw);
      const cx = t0.pos.x + rx * 1.5, cz = t0.pos.z + rz * 1.5;
      cam.position.set(cx + fx * 8.5 - rx * 2.5, t0.pos.y + 3.6, cz + fz * 8.5 - rz * 2.5);
      cam.lookAt(cx, t0.pos.y + 0.9, cz);
      cam.fov = 55; cam.updateProjectionMatrix();
    }
    let frames = 0;
    tick = (dt) => {
      const states = new Map<number, EntityState>();
      for (const e of sim.entities.values()) states.set(e.id, stateOf(sim, e));
      vehicles.sync(states, dt);
      for (const [id, r] of riders) { const s = states.get(id); if (s) updateRider(r, s, states, dt); }
      worldView.update(dt, cam);
      if (++frames === 3) lab.vehicles = { ...vehicles.stats(), terminals: terms.map((t) => ({ team: t.team, x: +t.pos.x.toFixed(1), z: +t.pos.z.toFixed(1), yaw: +t.yaw.toFixed(2) })) };
      return `yard · terminals at runtime sites: ${terms.map((t) => `${t.team === 0 ? 'Corgis' : 'Cats'} (${t.pos.x.toFixed(1)}, ${t.pos.z.toFixed(1)})`).join(' · ')}`;
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
    if (params.get('hud') !== '0') info.textContent = `${text}\n${debug.fps.toFixed(1)} fps · ${lab.drawCalls} draws · ${(lab.triangles / 1000).toFixed(1)}k tris · ${ctx.backend}\n${TERMINALS.kart_terminal.name} · ${VEHICLES.mower_kart.name} / ${VEHICLES.mower_kart.catName} · ${TERMINALS.plane_hangar.name} · ${VEHICLES.rc_plane.name} / ${VEHICLES.rc_plane.catName}`;
  });
}

main().catch((err) => {
  console.error(err);
  debug.errors.push(String(err?.stack ?? err));
  info.textContent = `Failed: ${String(err?.message ?? err)}`;
});

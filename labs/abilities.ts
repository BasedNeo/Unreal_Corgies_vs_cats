// Abilities lab (C2): Spotter Drone, Dig Charge, Squeak Barrier views and the "spotted" cue, with the real style
// pipeline.
//   /labs/abilities.html?view=showcase   fake states: both teams' drones, barriers and charges (the enemy charge drawn
//                                        faintly), the local corgi, and a spotted cat behind a wall (marker through it)
//   /labs/abilities.html?view=live       a real Sim on a flat yard: a warden raises a wall, an overwatch launches a
//                                        drone that spots a cat behind cover, a breacher plants a charge a cat walks into
//   &focus=drone|charge|barrier|spotted  close-ups (showcase) · live: &tpf=N sim ticks per frame, &until=T stop at tick T
//   &webgl forces WebGL2 · &cam=x,y,z&look=x,y,z · &hud=0
// Exposes window.__cvc (ready, fps, drawCalls, triangles, abilities stats) for tools/probe.mjs.
import { debug } from '../src/client/debug/debug-hook';
import * as THREE from 'three/webgpu';
import { createRenderContext, type RenderContext } from '../src/client/engine/renderer';
import { toon } from '../src/client/style/style-webgpu.js';
import { PALETTE } from '../src/client/style/style-tokens.js';
import { createAbilityViews } from '../src/client/abilities';
import { createAvatar } from '../src/client/procgen/characters';
import type { Avatar } from '../src/client/views/avatar';
import type { EntityState, GameEvent } from '../src/shared/protocol';
import { Anim, CLASS_IDS, EFlag, EntityKind, Species, Team, type TeamId, type ClassId } from '../src/shared/types';
import { ABILITY_IDS } from '../src/shared/content/abilities';
import type { WorldData } from '../src/shared/world/world-data';
import type { PropBox } from '../src/shared/world/world-types';
import { Sim } from '../src/sim/sim';
import { Btn } from '../src/shared/input';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'showcase';
const focus = params.get('focus') ?? '';
const info = document.getElementById('info')!;
const labels = document.getElementById('labels')!;
type LabDebug = typeof debug & { drawCalls: number; triangles: number; abilities: unknown; view: string };
const lab = debug as LabDebug;
lab.view = view;

function enableShadows(ctx: RenderContext, extent = 14): void {
  ctx.scene.traverse((o) => {
    const l = o as THREE.DirectionalLight;
    if (l.isDirectionalLight && !l.castShadow && l.intensity > 2) {
      l.castShadow = true;
      l.shadow.mapSize.set(1024, 1024);
      const c = l.shadow.camera as THREE.OrthographicCamera;
      c.left = -extent; c.right = extent; c.top = extent; c.bottom = -extent; c.near = 0.5; c.far = 80;
      l.position.multiplyScalar(3);
      l.shadow.bias = -0.0005;
    }
  });
}

function ground(ctx: RenderContext, r: number): void {
  const g = new THREE.Mesh(new THREE.CircleGeometry(r, 48), toon({ color: PALETTE.grass }));
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  ctx.scene.add(g);
  const stripe = toon({ color: PALETTE.grassDark });
  for (let i = -5; i <= 5; i += 2) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(3, r * 1.8), stripe);
    s.rotation.x = -Math.PI / 2; s.position.set(i * 3, 0.004, 0); s.receiveShadow = true;
    ctx.scene.add(s);
  }
}

function fence(ctx: RenderContext, p: PropBox): void {
  const m = new THREE.Mesh(new THREE.BoxGeometry(p.hx * 2, p.hy * 2, p.hz * 2), toon({ color: PALETTE.fenceWood }));
  m.position.set(p.x, p.y, p.z);
  m.rotation.y = p.rotY;
  m.castShadow = true; m.receiveShadow = true;
  ctx.scene.add(m);
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
const ab = (id: string) => ABILITY_IDS.indexOf(id as (typeof ABILITY_IDS)[number]);
const prop = (id: number, ability: string, team: TeamId, x: number, y: number, z: number, extra: Partial<EntityState> = {}): EntityState => ({
  ...base, id, kind: EntityKind.Prop, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls: ab(ability), x, y, z, ...extra,
});

/** Avatars for character states (created on first sight, removed when gone). */
class Pets {
  private map = new Map<number, Avatar>();
  constructor(private scene: THREE.Scene, private localId: number) {}
  sync(states: ReadonlyMap<number, EntityState>, dt: number): void {
    for (const s of states.values()) {
      if (s.kind !== EntityKind.Player && s.kind !== EntityKind.Bot) continue;
      let a = this.map.get(s.id);
      if (!a) {
        a = createAvatar({ species: s.species as 0 | 1, cls: CLASS_IDS[s.cls] ?? 'assault', team: s.team as TeamId, seed: s.seed, isLocal: s.id === this.localId });
        a.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        this.scene.add(a.root);
        this.map.set(s.id, a);
      }
      a.root.position.set(s.x, s.y, s.z);
      a.root.rotation.y = s.yaw;
      const dead = (s.flags & EFlag.Dead) !== 0;
      a.update({ speed: Math.hypot(s.vx, s.vz), vy: s.vy, grounded: (s.flags & EFlag.Grounded) !== 0, anim: s.anim, flags: s.flags, aimPitch: s.pitch, aimYawOffset: 0, hpFrac: s.maxHp ? s.hp / s.maxHp : 1, dead, firing: (s.flags & EFlag.Firing) !== 0, aiming: false, sprinting: false }, dt);
    }
    for (const [id, a] of this.map) if (!states.has(id)) { this.scene.remove(a.root); this.map.delete(id); }
  }
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const ctx = await createRenderContext(document.getElementById('app')!, { forceWebGL: params.has('webgl') });
  debug.backend = ctx.backend;
  const cam = ctx.camera;
  const views = createAbilityViews(ctx.scene, { camera: cam });
  let tick: (dt: number) => string;
  let t = 0;

  if (view === 'showcase') {
    enableShadows(ctx, 12);
    ground(ctx, 45);
    const localId = 100;
    const cover: PropBox = { type: 'fence', x: 5.6, y: 1.1, z: -6.2, hx: 1.6, hy: 1.1, hz: 0.18, rotY: 0.25 };
    fence(ctx, cover);
    const states = new Map<number, EntityState>();
    const put = (s: EntityState) => states.set(s.id, s);
    put(prop(1, 'spotter_drone', Team.Corgis, -3.2, 3.6, -3.5, { hp: 60, maxHp: 60, weapon: 1, yaw: 0.4 }));
    put(prop(2, 'spotter_drone', Team.Cats, 4.6, 4.1, -10.5, { hp: 60, maxHp: 60, yaw: -0.8 }));
    put(prop(3, 'squeak_barrier', Team.Corgis, -3.6, 0, -1.2, { hp: 300, maxHp: 300, yaw: -0.3 }));
    put(prop(4, 'squeak_barrier', Team.Cats, 1.2, 0, -11.5, { hp: 170, maxHp: 300, yaw: Math.PI + 0.2 }));
    put(prop(5, 'dig_charge', Team.Corgis, 0.9, 0, 1.6, { flags: EFlag.Busy }));
    put(prop(6, 'dig_charge', Team.Cats, 2.6, 0, -2.4, { flags: EFlag.Busy }));
    const me: EntityState = { ...base, id: localId, kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls: CLASS_IDS.indexOf('warden'), x: -3.2, y: 0, z: 1.2, yaw: -0.3, hp: 140, maxHp: 140, seed: 7, flags: EFlag.Grounded };
    const buddy: EntityState = { ...me, id: 101, kind: EntityKind.Bot, cls: CLASS_IDS.indexOf('overwatch'), x: -1.6, z: 3.2, yaw: 0.2, seed: 11 };
    // a cat hiding behind the fence (spotted: the marker shows through it) and one out in the open (not spotted)
    const hider: EntityState = { ...base, id: 102, kind: EntityKind.Bot, team: Team.Cats, species: Species.Cat, cls: CLASS_IDS.indexOf('infiltrator'), x: 5.9, y: 0, z: -7.5, yaw: 0.2, hp: 90, maxHp: 90, seed: 5, flags: EFlag.Grounded | EFlag.Spotted };
    const cat2: EntityState = { ...hider, id: 103, cls: CLASS_IDS.indexOf('assault'), x: -0.4, z: -13.5, yaw: 0.3, seed: 9, flags: EFlag.Grounded | EFlag.Spotted };
    for (const s of [me, buddy, hider, cat2]) put(s);
    const pets = new Pets(ctx.scene, localId);
    const shots: Record<string, [number[], number[]]> = {
      drone: [[-1.4, 4.4, -0.2], [-3.2, 3.6, -3.5]],
      charge: [[3.4, 1.5, 3.6], [1.8, 0.1, 0]],
      barrier: [[-0.6, 2.6, 5.6], [-2.4, 1.1, -4]],
      spotted: [[-1, 3.2, 6.5], [4.2, 1.2, -8]],
    };
    const shot = shots[focus];
    if (!applyCameraOverride(cam)) {
      if (shot) { cam.position.set(shot[0][0], shot[0][1], shot[0][2]); cam.lookAt(shot[1][0], shot[1][1], shot[1][2]); }
      else { cam.position.set(1.2, 5.2, 10.5); cam.lookAt(0.4, 1.4, -4.5); }
    }
    cam.fov = shot ? 55 : 58; cam.updateProjectionMatrix();
    const l = [label('Squeak Barrier (Corgis)'), label('Scratch Wall (Cats, damaged)'), label('Spotter Drone'), label('Bird Watcher'), label('Dig Charge (ally)'), label('Litter Mine (enemy: faint)'), label('spotted cat behind the fence')];
    let hitT = 0;
    tick = (dt) => {
      t += dt;
      // the cats' wall takes a hit every 0.6 s (flash + squash); the corgi drone bobs
      hitT += dt;
      if (hitT > 0.6) { hitT = 0; views.onGameEvent({ e: 'hit', src: 100, dst: 4, dmg: 15, x: 1.2, y: 1, z: -11.5, crit: false }); }
      const d1 = states.get(1)!;
      d1.y = 3.6 + Math.sin(t * 5) * 0.1; d1.yaw += dt * 0.9;
      views.sync(states, Team.Corgis, dt);
      pets.sync(states, dt);
      if (params.get('hud') !== '0' && !shot) {
        placeLabel(l[0], cam, -3.6, 3.2, -1.2); placeLabel(l[1], cam, 1.2, 3.2, -11.5); placeLabel(l[2], cam, -3.2, 4.4, -3.5); placeLabel(l[3], cam, 4.6, 4.9, -10.5);
        placeLabel(l[4], cam, 0.9, 0.7, 1.6); placeLabel(l[5], cam, 2.6, 0.6, -2.4); placeLabel(l[6], cam, 5.9, 2.6, -8.1);
      } else for (const x of l) x.style.display = 'none';
      lab.abilities = views.stats();
      return `showcase${focus ? ` · ${focus}` : ''} · ${JSON.stringify(views.stats())}`;
    };
  } else {
    // A real Sim on a flat trimesh yard with one fence: the views draw the authority's own states.
    enableShadows(ctx, 16);
    ground(ctx, 45);
    const cover: PropBox = { type: 'fence', x: 7, y: 1.6, z: -12, hx: 0.25, hy: 1.6, hz: 3, rotY: 0 };
    fence(ctx, cover);
    const n = 41, cell = 2;
    const world = {
      seed: 1, name: 'lab', height: () => 0, halfExtent: 38, props: [cover], killY: -30,
      terrain: { x0: -40, z0: -40, cell, n, heights: new Float32Array(n * n) },
      spawns: [{ x: 0, y: 0.5, z: 30, yaw: 0, team: 0 }, { x: 0, y: 0.5, z: -30, yaw: 0, team: 1 }],
    } as unknown as WorldData;
    const sim = await Sim.create({ seed: 2, world });
    sim.step();
    const mk = (team: TeamId, cls: ClassId, x: number, z: number, yaw: number) =>
      sim.spawnCharacter({ team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: cls, x, y: 0.02, z, yaw });
    const warden = mk(Team.Corgis, 'warden', -4, 2, 0);
    const over = mk(Team.Corgis, 'overwatch', 1, 3, -0.25);
    const breach = mk(Team.Corgis, 'breacher', 4.5, 1, 0.1);
    const hider = mk(Team.Cats, 'infiltrator', 9, -12, Math.PI / 2);
    const runner = mk(Team.Cats, 'assault', 4, -14, Math.PI);
    const localId = warden.id;
    let seq = 0;
    const press = (e: typeof warden, buttons: number, yaw = e.yaw, pitch = 0, mz = 0) => sim.setInput(e.id, { seq: ++seq, mx: 0, mz, yaw, pitch, buttons, rt: 0 });
    const pets = new Pets(ctx.scene, localId);
    if (!applyCameraOverride(cam)) { cam.position.set(-1, 7.5, 12); cam.lookAt(2, 1, -6); }
    cam.fov = 58; cam.updateProjectionMatrix();
    let step = 0;
    const evs: GameEvent[] = [];
    tick = () => {
      // fixed script at the sim's 60 Hz (a few ticks per frame keeps the headless probe moving)
      const tpf = Number(params.get('tpf') ?? 4), stop = Number(params.get('until') ?? Infinity);
      for (let k = 0; k < tpf && step < stop; k++) {
        const s = step++;
        if (s === 10) { press(warden, Btn.Ability); press(over, Btn.Ability); press(breach, Btn.Ability, 0.1, -0.55); }
        else if (s === 11) { press(warden, 0); press(over, 0); press(breach, 0, 0.1, -0.55); }
        if (s > 60 && s < 400) press(runner, 0, Math.PI - 0.08, 0, 0.6); else press(runner, 0);
        sim.step();
        for (const ev of sim.drainEvents()) { evs.push(ev); views.onGameEvent(ev); }
      }
      const states = new Map<number, EntityState>();
      for (const e of sim.entities.values()) states.set(e.id, sim.toState(e));
      views.sync(states, Team.Corgis, 4 / 60);
      pets.sync(states, 4 / 60);
      lab.abilities = { ...views.stats(), tick: sim.tick, hiderSpotted: !!(hider.flags & EFlag.Spotted), runnerHp: runner.health?.hp, booms: evs.filter((e) => e.e === 'explode').length };
      return `live · tick ${sim.tick} · ${JSON.stringify(lab.abilities)}`;
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

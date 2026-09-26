// Ordnance lab (W9 X4): a real Sim in the page (a small range at dusk), the real comic pipeline, EntityViews, the X3
// FX director and the ordnance view + HUD slot, stepped one sim tick per rendered frame (deterministic: captures pause at
// exact ticks — frame-by-frame slow motion).
//   /labs/ordnance.html?webgl&view=corgi   a corgi aims (the arc preview), throws a Squeaker Grenade at two cats
//   &view=cat                              a cat throws a Hairball Bomb at two corgis
//   &view=models                           both throwables, both teams, big (the model look)
//   &cam=ots|side|target|close             over the shoulder · the arc from the side · the target's view · low close-up
//   &hold                                  start paused (a capture arms __olab.pauseAt = [ticks], optionally __olab.ffTo, and
//                                          sets pause = false)
// The aim comes from the bot decision module (planThrow): the same arc the preview draws, aimed so the blast lands on
// the pair. The FX director is fed the states WITHOUT the throwables, as the wiring snippet in docs/handoff/X4.md does
// (no tennis-ball trail on them: they have their own).
import * as THREE from 'three/webgpu';
import { createRenderContext } from '../src/client/engine/renderer';
import { toon } from '../src/client/style/style-webgpu.js';
import { PALETTE } from '../src/client/style/style-tokens.js';
import { Sim } from '../src/sim/sim';
import type { SimEntity } from '../src/sim/entity';
import { movementSystem } from '../src/sim/systems/movement';
import { physicsStepSystem } from '../src/sim/systems/core';
import { worldSystems } from '../src/sim/world/systems';
import { combatSystems, ordnanceArcWorld, ordnanceStats } from '../src/sim/combat';
import { makePlan, planThrow } from '../src/sim/ai/ordnance-ai';
import { Btn } from '../src/shared/input';
import { EntityKind, Species, Team, type TeamId } from '../src/shared/types';
import type { EntityState } from '../src/shared/protocol';
import type { PropBox, WorldData } from '../src/shared/world/world-data';
import { ordnanceByWire } from '../src/shared/content/ordnance';
import { EntityViews } from '../src/client/views/entity-views';
import { createFx } from '../src/client/fx';
import { buildHairball, buildSqueaker, createOrdnanceView, ordnanceMaterials, type OrdnanceAim } from '../src/client/fx/ordnance-view';
import { createOrdnanceHud } from '../src/client/ui/ordnance-hud';
import { HUD_CSS } from '../src/client/ui/hud-style';

const P = new URLSearchParams(location.search);
const view = P.get('view') ?? 'corgi';
const cam = P.get('cam') ?? 'side';
const DT = 1 / 60;

interface Lab { ticks: number; pause: boolean; pauseAt: number[]; ready: boolean; error: string | null; throwTick: number; blastTick: number; stats: unknown; ffTo: number }
/** ffTo: step up to 12 sim ticks per rendered frame until this tick (captures fast-forward to just before a still). */
const lab: Lab = { ticks: 0, pause: P.has('hold'), pauseAt: [], ready: false, error: null, throwTick: -1, blastTick: -1, stats: null, ffTo: 0 };
(globalThis as unknown as { __olab: Lab }).__olab = lab;

function range(): WorldData {
  const n = 81, cell = 1;
  const props: PropBox[] = [
    { type: 'sandbag', x: 0, y: 0.45, z: -9.5, hx: 3.2, hy: 0.45, hz: 0.5, rotY: 0.05 },
    { type: 'crate', x: -5.5, y: 0.7, z: -3, hx: 0.7, hy: 0.7, hz: 0.7, rotY: 0.4 },
    { type: 'crate', x: 6, y: 0.6, z: 1, hx: 0.6, hy: 0.6, hz: 0.6, rotY: -0.3 },
    { type: 'sandbag', x: 0, y: 0.45, z: 11.5, hx: 3.2, hy: 0.45, hz: 0.5, rotY: -0.05 },
  ];
  return {
    seed: 1, name: 'ordnance lab range', height: () => 0, halfExtent: 38, killY: -30, props,
    terrain: { x0: -40, z0: -40, cell, n, heights: new Float32Array(n * n) },
    spawns: [{ x: 0, y: 0, z: 8, yaw: 0, team: Team.Corgis }, { x: 0, y: 0, z: -6, yaw: Math.PI, team: Team.Cats }],
  };
}

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const ctx = await createRenderContext(app, { forceWebGL: P.has('webgl'), quality: 'high' });
  const { scene, camera } = ctx;
  // dusk mood stand-in (the real sky/grade rig is S4's): a dim slate sky, a lower warm key
  scene.background = new THREE.Color(0x27303b);
  scene.traverse((o) => {
    const l = o as THREE.Light;
    if ((l as THREE.DirectionalLight).isDirectionalLight) l.intensity *= 0.8;
    if ((l as THREE.HemisphereLight).isHemisphereLight) l.intensity *= 0.75;
  });
  const world = range();
  // the range: mud + grass ground, the props as weathered toon boxes
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), toon({ color: PALETTE.grassDark, surface: 'ground' }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  const mud = new THREE.Mesh(new THREE.PlaneGeometry(9, 26), toon({ color: PALETTE.mud, surface: 'ground' }));
  mud.rotation.x = -Math.PI / 2; mud.position.set(0, 0.004, 1); mud.receiveShadow = true;
  scene.add(mud);
  for (const p of world.props) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.hx * 2, p.hy * 2, p.hz * 2), toon({ color: p.type === 'crate' ? PALETTE.fenceWood : PALETTE.sandbag, surface: p.type === 'crate' ? 'wood' : 'cloth' }));
    m.position.set(p.x, p.y, p.z); m.rotation.y = p.rotY; m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }

  // the HUD slot, in the HUD's own root (its CSS variables)
  const css = document.createElement('style'); css.textContent = HUD_CSS; document.head.appendChild(css);
  const hudRoot = document.createElement('div'); hudRoot.id = 'cvc-hud';
  document.getElementById('ui')!.appendChild(hudRoot);
  const ordHud = createOrdnanceHud(hudRoot);

  if (view === 'models') { buildModels(scene, camera); runLoop(ctx, () => {}); return; }

  const sim = await Sim.create({ seed: 4, world, systems: [movementSystem, ...worldSystems(), physicsStepSystem, ...combatSystems()] });
  sim.state.ordnanceConfig = { enabled: true };
  const cat = view === 'cat';
  const mk = (team: TeamId, x: number, z: number, yaw: number, kind: number, seed: number) => sim.spawnCharacter({
    kind: kind as 0, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls: 'assault', name: `lab${seed}`, x, y: 0.02, z, yaw, seed, ownerPid: kind === EntityKind.Player ? 'lab' : null,
  });
  // thrower 14 m from a pair of targets (the corgi throws toward −Z, the cat toward +Z)
  const s = cat ? -1 : 1;
  const thrower = mk(cat ? Team.Cats : Team.Corgis, 0.4 * s, 7.5 * s, cat ? Math.PI : 0, EntityKind.Player, 11);
  const targets = [mk(cat ? Team.Corgis : Team.Cats, 0.9 * s, -5.6 * s, cat ? 0 : Math.PI, EntityKind.Bot, 21), mk(cat ? Team.Corgis : Team.Cats, -1.3 * s, -6.4 * s, cat ? 0.3 : Math.PI - 0.3, EntityKind.Bot, 23)];
  const ally = mk(cat ? Team.Cats : Team.Corgis, -3.2 * s, 6.8 * s, cat ? Math.PI : 0, EntityKind.Bot, 13);
  sim.step();
  const plan = makePlan();
  const planned = planThrow(thrower, targets, [thrower, ally], ordnanceArcWorld(sim), plan);
  if (!planned) console.warn('[olab] no throw plan');
  const views = new EntityViews(scene, { surfaceAt: () => 0 });
  const fx = createFx(scene, camera, views, { heightAt: () => 0, world, seed: 7 });
  const ov = createOrdnanceView(scene, { world, seed: 9 });
  const localId = thrower.id;
  const aim: OrdnanceAim = { holding: false, yaw: thrower.yaw, pitch: 0 };
  const HOLD_FROM = 12, RELEASE = 70;
  let states = new Map<number, EntityState>();
  const noOrd = new Map<number, EntityState>();
  let seq = 1;
  const setInput = (e: SimEntity, yaw: number, pitch: number, buttons: number) => sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw, pitch, buttons, rt: 0 });
  placeCamera(camera, cam, cat);
  for (const t of targets) t.combat!.invulnUntil = 0;

  runLoop(ctx, () => {
    const tick = lab.ticks;
    // the throw: turn to the plan while holding Throw (the preview shows), release at RELEASE
    const k = Math.min(1, Math.max(0, (tick - HOLD_FROM) / 40));
    const yaw = thrower.yaw + (plan.yaw - thrower.yaw) * k, pitch = plan.pitch * k;
    const holding = tick >= HOLD_FROM && tick < RELEASE;
    setInput(thrower, planned ? yaw : thrower.yaw, planned ? pitch : 0, holding ? Btn.Throw : 0);
    aim.holding = holding; aim.yaw = yaw; aim.pitch = pitch;
    const thrown = ordnanceStats(sim).throws;
    sim.step();
    if (lab.throwTick < 0 && ordnanceStats(sim).throws > thrown) lab.throwTick = sim.tick;
    const evs = sim.drainEvents();
    sim.removedIds.length = 0;
    states = new Map(sim.snapshotEntities().map((x) => [x.id, x]));
    noOrd.clear();
    states.forEach((x, id) => { if (!(x.kind === EntityKind.Projectile && ordnanceByWire(x.weapon))) noOrd.set(id, x); });
    for (const ev of evs) {
      if (ev.e === 'explode' && lab.blastTick < 0) lab.blastTick = sim.tick;
      fx.onGameEvent(ev, { states, localId });
      ov.onGameEvent(ev);
    }
    views.sync(states, localId, DT);
    ov.update(DT, states, localId, aim);
    fx.update(DT, noOrd, localId);
    ordHud.update(states.get(localId) ?? null, sim.time);
    lab.stats = { ord: ov.stats, fx: fx.stats, plan: planned ? { yaw: plan.yaw, pitch: plan.pitch, hits: plan.hits } : null, hp: targets.map((t) => t.health!.hp) };
    if (cam === 'follow') followCamera(camera, sim, cat);
  });
}

function runLoop(ctx: Awaited<ReturnType<typeof createRenderContext>>, step: () => void): void {
  ctx.renderer.setAnimationLoop(() => {
    try {
      for (let n = 0; n < 12 && !lab.pause; n++) {
        step();
        lab.ticks++;
        if (lab.pauseAt.includes(lab.ticks)) lab.pause = true;
        if (lab.ticks >= lab.ffTo) break;
      }
      ctx.render();
      lab.ready = true;
    } catch (e) { lab.error = String((e as Error)?.stack ?? e); console.error(e); lab.pause = true; }
  });
}

function placeCamera(camera: THREE.PerspectiveCamera, c: string, cat: boolean): void {
  const s = cat ? -1 : 1;
  camera.fov = 50;
  if (c === 'ots') { camera.position.set(1.3 * s, 2.3, 10.8 * s); camera.lookAt(0, 0.8, -3 * s); }
  else if (c === 'target') { camera.position.set(3.4 * s, 1.25, -8.6 * s); camera.lookAt(-0.6 * s, 0.4, -4.4 * s); }
  else if (c === 'close') { camera.position.set(2.2 * s, 0.9, -3.4 * s); camera.lookAt(-0.3 * s, 0.25, -6 * s); }
  else { camera.position.set(15 * s, 4.2, 1.2 * s); camera.lookAt(0, 1.4, -0.4 * s); }
  camera.updateProjectionMatrix();
}

function followCamera(camera: THREE.PerspectiveCamera, sim: Sim, cat: boolean): void {
  for (const e of sim.entities.values()) {
    if (!e.ordProj) continue;
    const s = cat ? -1 : 1;
    camera.position.set(e.pos.x + 2.6 * s, e.pos.y + 1.2, e.pos.z + 2.2 * s);
    camera.lookAt(e.pos.x, e.pos.y + 0.1, e.pos.z);
    return;
  }
}

function buildModels(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
  // above the range's ground (y = 0): squeakers on the top row, hairballs below (&swap: the other way round)
  const [rubber, fur] = ordnanceMaterials();
  const items = [buildSqueaker(0), buildSqueaker(1), buildHairball(0), buildHairball(1)];
  items.forEach((g, i) => {
    const m = new THREE.Mesh(g, i < 2 ? rubber : fur);
    m.scale.setScalar(5);
    const top = P.has('swap') ? i >= 2 : i < 2;
    m.position.set(i % 2 ? 0.85 : -0.85, top ? 2.25 : 0.8, 0);
    m.rotation.set(0.3, -0.6 + (i % 2) * 0.5, 0.05);
    m.castShadow = true;
    scene.add(m);
  });
  camera.fov = 38;
  camera.position.set(0, 2.3, 5.6);
  camera.lookAt(0, 1.5, 0);
  camera.updateProjectionMatrix();
}

main().catch((e) => { lab.error = String(e?.stack ?? e); console.error(e); });

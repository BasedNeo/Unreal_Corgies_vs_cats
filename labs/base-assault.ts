// Base Assault lab (W9 G4a): the real West Yard, a real authoritative Sim in base-assault mode, the real avatars
// (EntityViews), the match HUD, and the G4a view + HUD, frozen at a scripted moment so every shot is repeatable on any
// machine (the sim is fast-forwarded, then only presentation runs).
//   /labs/base-assault.html?shot=home      the corgi ball on its stand by the flag, the capture ring, a pup on guard
//   /labs/base-assault.html?shot=ball      close-up of the cat ball on its stand
//   /labs/base-assault.html?shot=carry     Rex has stolen the cat ball and sprints home, slowed, a cat on his tail
//   /labs/base-assault.html?shot=dropped   Rex was knocked out: the cat ball on the lawn, halo + beacon + countdown
//   /labs/base-assault.html?shot=capture   Rex runs into his ring: CAPTURED!
//   /labs/base-assault.html?shot=far       a cat runs off with the corgi ball, seen from the corgi flag: beacon + marker
//   &map=the_lot (the spawn-centroid fallback bases) · &webgl · &q=low|med|high · &t=0.74 (time of day) · &hud=0
// Exposes window.__cvc (ready, fps, drawCalls, triangles, assault stats) for tools/probe.mjs.
import { debug } from '../src/client/debug/debug-hook';
import * as THREE from 'three/webgpu';
import { createRenderContext } from '../src/client/engine/renderer';
import { createWorldView } from '../src/client/world/world-view';
import { EntityViews } from '../src/client/views/entity-views';
import { createHud } from '../src/client/ui/hud';
import { createBaseAssaultView } from '../src/client/modes/base-assault-view';
import { createBaseAssaultHud } from '../src/client/ui/base-assault-hud';
import { createWorldData } from '../src/shared/world/world-data';
import { surfaceAt } from '../src/shared/world/queries';
import { mapForMode } from '../src/shared/world/maps';
import { Sim } from '../src/sim/sim';
import type { SimEntity } from '../src/sim/entity';
import { baseAssaultState } from '../src/sim/match';
import { kill } from '../src/sim/combat';
import { Btn, emptyInput } from '../src/shared/input';
import { EntityKind, Species, Team, type ClassId, type TeamId } from '../src/shared/types';
import type { EntityState, GameEvent, MatchState, RosterEntry } from '../src/shared/protocol';

const params = new URLSearchParams(location.search);
const shot = params.get('shot') ?? 'home';
const info = document.getElementById('info')!;
const ui = document.getElementById('ui')!;
type LabDebug = typeof debug & { drawCalls: number; triangles: number; assault: unknown; shot: string };
const lab = debug as LabDebug;
lab.shot = shot;

const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

async function main() {
  const ctx = await createRenderContext(document.getElementById('app')!, { forceWebGL: params.has('webgl') });
  debug.backend = ctx.backend;
  const cam = ctx.camera;
  const mapId = mapForMode(params.get('map'), 'yard-skirmish');
  const data = createWorldData(1, mapId);
  const worldView = createWorldView(ctx.scene, data, { quality: (params.get('q') as 'low' | 'med' | 'high') ?? 'high', grade: ctx.pipeline.grade.uniforms });
  if (params.has('t')) worldView.setTimeOfDay(Number(params.get('t')));
  const sim = await Sim.create({ seed: 1, world: data });
  sim.state.room = { mode: 'base-assault' };
  sim.state.matchConfig = { baseAssault: { warmup: 0.05 } };
  for (let i = 0; i < 20; i++) { sim.step(); sim.drainEvents(); }
  const st = baseAssaultState(sim)!;
  const [home0, home1] = st.spots;

  const views = new EntityViews(ctx.scene, { surfaceAt: (x, z, y) => surfaceAt(data, x, z, y).y });
  const assault = createBaseAssaultView(ctx.scene, { heightAt: (x, z) => data.height(x, z), heightOf: (id) => views.get(id)?.avatar.height, camera: cam });
  const hud = createHud(ui, {}, { match: 'base-assault', map: mapId });
  const assaultHud = createBaseAssaultHud(ui);
  const roster: RosterEntry[] = [];
  const pet = (name: string, team: TeamId, cls: ClassId, x: number, z: number, yaw = 0): SimEntity => {
    const e = sim.spawnCharacter({ kind: EntityKind.Player, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name, x, y: surfaceAt(data, x, z).y + 0.02, z, yaw });
    roster.push({ pid: name, name, team, cls, entity: e.id, bot: false, kills: 0, deaths: 0, score: 0, ping: 0 });
    return e;
  };
  const place = (e: SimEntity, x: number, z: number, yaw: number) => {
    sim.placeCharacter(e, x, surfaceAt(data, x, z, e.pos.y + 2).y + 0.02, z);
    e.yaw = yaw; e.input = { ...emptyInput(0), yaw };
    for (const b of st.balls) if (b.carrier === e.id) { b.lastX = e.pos.x; b.lastY = e.pos.y; b.lastZ = e.pos.z; } // a lab move, not a teleport
  };
  let seq = 0;
  const drive = (e: SimEntity, tx: number, tz: number, buttons = Btn.Sprint) => {
    if (e.dead) return;
    e.input = { seq: ++seq, mx: 0, mz: 1, yaw: yawTo(e.pos.x, e.pos.z, tx, tz), pitch: 0, buttons, rt: 0 };
  };
  const stand0 = home0.stand, stand1 = home1.stand, ring0 = home0.flag;
  // the cast
  const rex = pet('Rex', Team.Corgis, 'assault', stand0.x + 3, stand0.z + 3);
  const biscuit = pet('Biscuit', Team.Corgis, 'warden', ring0.x - 2.2, ring0.z - 1.6, yawTo(ring0.x, ring0.z, stand1.x, stand1.z));
  const tom = pet('Tom', Team.Cats, 'infiltrator', stand1.x + 4, stand1.z + 4);
  const mitts = pet('Mitts', Team.Cats, 'assault', stand1.x - 3, stand1.z + 2);
  let localId = rex.id;
  const events: GameEvent[] = [];
  const states = new Map<number, EntityState>();
  const collect = () => { states.clear(); for (const e of sim.entities.values()) states.set(e.id, sim.toState(e)); };
  const match = () => sim.state.match as MatchState;
  // fast-forward: the HUDs see every event in order with their clocks ticking 1/60 s per sim tick, as in a session
  const stepSim = (n: number, each?: (k: number) => void) => {
    for (let k = 0; k < n; k++) {
      each?.(k);
      sim.step();
      collect();
      assaultHud.update({ states, localId, roster, match: match(), camera: cam }, 1 / 60);
      for (const ev of sim.drainEvents()) { events.push(ev); hud.onGameEvent(ev); assaultHud.onGameEvent(ev, localId); }
    }
  };
  // the shot's moment, fast-forwarded
  type P3 = { x: number; y: number; z: number };
  let camAt: () => { from: P3; to: P3 };
  const at = (x: number, y: number, z: number): P3 => ({ x, y, z });
  const steal = () => { place(rex, stand1.x, stand1.z + 0.2, yawTo(stand1.x, stand1.z, ring0.x, ring0.z)); stepSim(1); };
  if (shot === 'home') {
    // a pup on guard beside the stand; the camera low and close, the flag and its ring behind the ball
    const ax = stand0.x - ring0.x, az = stand0.z - ring0.z, al = Math.hypot(ax, az) || 1;
    const side = { x: -az / al, z: ax / al };
    place(rex, stand0.x - side.x * 1.8 + (ax / al) * 0.6, stand0.z - side.z * 1.8 + (az / al) * 0.6, 0);
    rex.input = { ...emptyInput(0), yaw: yawTo(rex.pos.x, rex.pos.z, stand1.x, stand1.z) };
    localId = biscuit.id;
    stepSim(40);
    const from = at(stand0.x + (ax / al) * 3.6 + side.x * 1.5, stand0.y + 1.55, stand0.z + (az / al) * 3.6 + side.z * 1.5);
    camAt = () => ({ from, to: at(stand0.x - (ax / al) * 1.2, stand0.y + 1.2, stand0.z - (az / al) * 1.2) });
  } else if (shot === 'ball') {
    // macro: the cat ball on its stand (felt, seam, team tape, the tin cup, the can's tape and stencil)
    localId = tom.id;
    stepSim(20);
    const f = { x: Math.sin(stand1.yaw), z: Math.cos(stand1.yaw) };
    const from = at(stand1.x - f.x * 1.5 + f.z * 0.7, stand1.y + 1.45, stand1.z - f.z * 1.5 - f.x * 0.7);
    camAt = () => ({ from, to: at(stand1.x, stand1.y + 0.8, stand1.z) });
  } else if (shot === 'carry' || shot === 'dropped') {
    steal();
    place(tom, rex.pos.x + 3, rex.pos.z + 5, 0);
    stepSim(150, () => { drive(rex, ring0.x, ring0.z); drive(tom, rex.pos.x, rex.pos.z); });
    if (shot === 'dropped') {
      place(tom, rex.pos.x + 9, rex.pos.z + 7, 0); // (a cat touching the ball would send it straight home)
      localId = mitts.id; // seen by a cat: their own ball is on the ground
      kill(sim, rex, { id: tom.id, team: tom.team, weapon: 0 });
      stepSim(80, () => { tom.input = { ...emptyInput(0), yaw: tom.yaw }; });
      const b = st.balls[1];
      const e = sim.entities.get(b.ball)!;
      camAt = () => ({ from: at(e.pos.x + 4.5, e.pos.y + 2.2, e.pos.z + 5.5), to: at(e.pos.x, e.pos.y + 0.6, e.pos.z) });
    } else {
      camAt = () => {
        const fx = -Math.sin(rex.yaw), fz = -Math.cos(rex.yaw);
        return { from: at(rex.pos.x - fx * 4.8 + fz * 1.9, rex.pos.y + 2.1, rex.pos.z - fz * 4.8 - fx * 1.9), to: at(rex.pos.x + fx * 2, rex.pos.y + 1.0, rex.pos.z + fz * 2) };
      };
    }
  } else if (shot === 'capture') {
    steal();
    const a = yawTo(ring0.x, ring0.z, stand1.x, stand1.z);
    const ox = -Math.sin(a) * 9, oz = -Math.cos(a) * 9;
    place(rex, ring0.x + ox, ring0.z + oz, yawTo(ring0.x + ox, ring0.z + oz, ring0.x, ring0.z));
    let captured = -1;
    stepSim(240, (k) => {
      if (captured < 0) drive(rex, ring0.x, ring0.z);
      else rex.input = { ...emptyInput(0), yaw: rex.yaw };
      if (captured < 0 && events.some((ev) => ev.e === 'score' && ev.reason === 'captured')) captured = k;
      });
    const from = at(ring0.x + ox * 1.1 - oz * 0.55, ring0.y + 3.4, ring0.z + oz * 1.1 + ox * 0.55);
    camAt = () => ({ from, to: at(ring0.x, ring0.y + 1.4, ring0.z) });
  } else {
    // a cat steals the corgi ball and runs for home; Biscuit, on guard at the corgi flag, watches it go
    place(tom, stand0.x, stand0.z + 0.2, yawTo(stand0.x, stand0.z, home1.flag.x, home1.flag.z));
    localId = biscuit.id;
    stepSim(330, () => drive(tom, home1.flag.x, home1.flag.z));
    const bx = biscuit.pos.x, bz = biscuit.pos.z;
    camAt = () => {
      const dx = tom.pos.x - bx, dz = tom.pos.z - bz, dl = Math.hypot(dx, dz) || 1;
      return { from: at(bx - (dx / dl) * 4.5 + (dz / dl) * 1.2, biscuit.pos.y + 2.4, bz - (dz / dl) * 4.5 - (dx / dl) * 1.2), to: at(tom.pos.x, tom.pos.y + 3, tom.pos.z) };
    };
  }
  collect();
  let frames = 0, fpsT = performance.now(), fpsN = 0;
  ctx.renderer.info.autoReset = false;
  ctx.renderer.setAnimationLoop(() => {
    const dt = 1 / 60; // presentation only: the sim stays frozen at the shot's moment
    views.sync(states, localId, dt);
    assault.sync(states, localId, dt);
    const c = camAt();
    cam.position.set(c.from.x, c.from.y, c.from.z);
    cam.lookAt(c.to.x, c.to.y, c.to.z);
    cam.fov = 60; cam.updateProjectionMatrix();
    worldView.update(dt, cam, sim.tick);
    const local = states.get(localId) ?? null;
    hud.update({ local, match: match(), roster, fps: debug.fps, rttMs: 0, locked: true, backend: ctx.backend, transport: 'lab', states, showDebug: false } as Parameters<typeof hud.update>[0]);
    assaultHud.update({ states, localId, roster, match: match(), camera: cam, ballAt: (t) => assault.ballPosition(t) }, dt);
    ctx.renderer.info.reset();
    ctx.render();
    frames++; fpsN++;
    const now = performance.now();
    if (now - fpsT > 500) { debug.fps = (fpsN * 1000) / (now - fpsT); fpsN = 0; fpsT = now; }
    const ri = ctx.renderer.info.render as unknown as { drawCalls?: number; calls?: number; triangles?: number };
    lab.drawCalls = ri.drawCalls ?? ri.calls ?? 0;
    lab.triangles = ri.triangles ?? 0;
    lab.assault = { ...assault.stats(), banner: assaultHud.banner?.text ?? null, score: match().score, phase: match().phase, balls: st.balls.map((b) => [b.state, b.carrier]) };
    debug.frames = frames;
    debug.ready = frames > 3;
    info.style.display = params.get('hud') === '0' ? 'none' : 'block';
    info.textContent = `base-assault lab · ${shot} · ${mapId} · ${JSON.stringify(lab.assault)}\n${debug.fps.toFixed(1)} fps · ${lab.drawCalls} draws · ${(lab.triangles / 1000).toFixed(1)}k tris · ${ctx.backend}`;
  });
}

main().catch((err) => {
  console.error(err);
  debug.errors.push(String(err?.stack ?? err));
  info.textContent = `Failed: ${String(err?.message ?? err)}`;
});

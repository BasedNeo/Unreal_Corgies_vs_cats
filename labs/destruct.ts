// Destructibles lab (X1): the real West Yard world view (its destructible view inside) + the FX director, and
// optionally a real authoritative Sim whose snapshots and events drive the view exactly as main.ts does.
//   /labs/destruct.html?bm=breach_out&break=wall&at=0.35&webgl
//   bm     breach_out | breach_in | tuna | crate | any world bookmark (garage_breach, garage, ...)
//   break  none | wall | tuna | crates | all — what breaks after `wait` frames (default 10)
//   at     seconds of debris flight to show, then everything freezes (mid-flight shots); without it the breaks show
//          as settled rubble (no debris), i.e. the "after" state
//   live=1 a real Sim in the page: a Breacher plants a Dig Charge at the breach wall, the breaching fuse blows it;
//          the view gets the Sim's states (sync) and events (onGameEvent) like the game client. &spf=N runs N sim
//          ticks per rendered frame (fast-forward for slow headless renders; default: real time)
//   measure=1  break every destructible one per 20 frames with debris; __cvc.x1 reports the break handling cost and
//          the worst per-frame debris/FX update cost
// Exposes window.__cvc (ready, frames, drawCalls, triangles, world stats, x1 costs) for tools/probe.mjs.
import { debug } from '../src/client/debug/debug-hook';
import * as THREE from 'three/webgpu';
import { createRenderContext } from '../src/client/engine/renderer';
import { createWorldData } from '../src/shared/world/world-data';
import { createWorldView } from '../src/client/world/world-view';
import { createFx } from '../src/client/fx';
import { createAbilityViews } from '../src/client/abilities';
import type { EntityState, GameEvent } from '../src/shared/protocol';
import { Species, Team } from '../src/shared/types';
import { toon } from '../src/client/style/style-webgpu.js';
import { PALETTE } from '../src/client/style/style-tokens.js';
import { Sim } from '../src/sim/sim';
import type { SimEntity } from '../src/sim/entity';
import { movementSystem } from '../src/sim/systems/movement';
import { physicsStepSystem, killPlaneSystem } from '../src/sim/systems/core';
import { combatSystems, eyeHeight } from '../src/sim/combat';
import { worldSystems } from '../src/sim/world/systems';
import { destructSystems } from '../src/sim/destruct';
import { Btn } from '../src/shared/input';

const params = new URLSearchParams(location.search);
const hudEl = document.getElementById('hud')!;

const POSES: Record<string, { pos: [number, number, number]; look: [number, number, number]; fov: number }> = {
  breach_out: { pos: [99.4, 2.3, -58.6], look: [93.6, 2.1, -66.2], fov: 64 },
  breach_in: { pos: [81.6, 2.5, -65.6], look: [94, 1.9, -65.8], fov: 64 },
  tuna: { pos: [81.2, 3.3, -45.8], look: [75.2, 0.5, -58.5], fov: 66 },
  tuna_car: { pos: [89.8, 3.6, -52.2], look: [75, 0.6, -59.5], fov: 66 },
  crate: { pos: [43.8, 2.6, -52.6], look: [50, 1.1, -58], fov: 60 },
};

interface X1Debug { drawCalls: number; triangles: number; world: Record<string, number>; x1: Record<string, number> }

async function main() {
  const ctx = await createRenderContext(document.getElementById('app')!, { forceWebGL: params.has('webgl') });
  debug.backend = ctx.backend;
  const data = createWorldData(1);
  const view = createWorldView(ctx.scene, data, {
    timeOfDay: Number(params.get('t') ?? 0.62),
    quality: (params.get('q') as 'low' | 'med' | 'high' | null) ?? undefined,
    grade: ctx.pipeline.grade.uniforms as unknown as { saturation: { value: number } },
  });
  const destruct = view.destruct;
  const fx = createFx(ctx.scene, ctx.camera, null, { heightAt: (x, z) => data.height(x, z), seed: 7 });
  const abilities = createAbilityViews(ctx.scene, { camera: ctx.camera });
  const lab = debug as unknown as typeof debug & X1Debug;
  lab.x1 = { breakMs: 0, breakMaxMs: 0, updateMaxMs: 0, updateAvgMs: 0, breaks: 0 };

  // camera
  const cam = ctx.camera;
  const bm = params.get('bm') ?? 'breach_out';
  const p = POSES[bm] ?? (() => { const b = view.bookmarks.find((v) => v.name === bm) ?? view.bookmarks[0]; return { pos: b.pos, look: b.look, fov: b.fov ?? 62 }; })();
  cam.position.set(...p.pos);
  cam.lookAt(new THREE.Vector3(...p.look));
  cam.fov = Number(params.get('fov') ?? p.fov);
  cam.updateProjectionMatrix();

  // ---- what to break
  const defs = data.destructibles ?? [];
  const which = params.get('break') ?? 'none';
  const targets = defs.map((d, i) => ({ d, i })).filter(({ d }) =>
    which === 'all' || (which === 'wall' && d.kind === 'wall_boards') || (which === 'tuna' && d.kind === 'tuna_stack') || (which === 'crates' && d.kind === 'crate_stack'));
  const at = params.has('at') ? Number(params.get('at')) : NaN;
  const wait = Number(params.get('wait') ?? 10);
  const eventOf = (i: number): GameEvent => ({ e: 'ability', id: 1000 + i, ability: `destruct:${defs[i].kind}`, x: defs[i].cx, y: defs[i].cy, z: defs[i].cz });
  const onEvent = (ev: GameEvent, states?: Map<number, EntityState>) => {
    const t0 = performance.now();
    destruct.onGameEvent(ev);
    fx.onGameEvent(ev, { localId: -1, states });
    abilities.onGameEvent(ev);
    if (ev.e === 'ability' && ev.ability.startsWith('destruct:')) {
      const ms = performance.now() - t0;
      lab.x1.breakMs = ms;
      lab.x1.breakMaxMs = Math.max(lab.x1.breakMaxMs, ms);
      lab.x1.breaks++;
    }
  };

  // ---- live: a real Sim, a Breacher and a Dig Charge
  let sim: Sim | null = null, breacher: SimEntity | null = null, seq = 1, simAcc = 0, brokeAt = -1;
  const states = new Map<number, EntityState>();
  if (params.get('live') === '1') {
    sim = await Sim.create({ seed: 1, systems: [movementSystem, ...worldSystems(), physicsStepSystem, ...combatSystems(), killPlaneSystem, ...destructSystems()] });
    breacher = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'breacher', name: 'Breacher', x: 96.2, y: 0.05, z: -67.2, yaw: Math.PI / 2 });
  }
  const dummy = new THREE.Group();
  {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.48, 4, 10), toon({ color: PALETTE.teamCorgis }));
    m.position.y = 0.6;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), toon({ color: PALETTE.corgiOrange }));
    head.position.y = 1.12;
    dummy.add(m, head);
    dummy.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    dummy.visible = !!sim;
    ctx.scene.add(dummy);
  }
  const stepSim = () => {
    if (!sim || !breacher) return;
    const t = sim.tick / 60;
    let yaw = Math.PI / 2, pitch = 0, buttons = 0, mz = 0;
    if (t > 0.5 && t < 0.52) {
      const ex = breacher.pos.x, ey = breacher.pos.y + eyeHeight(breacher), ez = breacher.pos.z;
      yaw = Math.atan2(-(94.4 - ex), -(-67.2 - ez)); pitch = Math.atan2(0 - ey, Math.hypot(94.4 - ex, -67.2 - ez));
      buttons = Btn.Ability;
    } else if (t >= 0.6 && t < 1.2) { yaw = -Math.PI / 2 - 0.9; mz = 1; }             // step back from the wall
    else if (t >= 1.2) yaw = Math.PI / 2 + 0.35;                                        // watch it
    sim.setInput(breacher.id, { seq: seq++, mx: 0, mz, yaw, pitch, buttons, rt: 0 });
    sim.step();
    states.clear();
    for (const e of sim.entities.values()) states.set(e.id, sim.toState(e));
    for (const ev of sim.drainEvents()) {
      onEvent(ev, states);
      if (ev.e === 'ability' && ev.ability.startsWith('destruct:') && brokeAt < 0) brokeAt = sim.tick;
    }
  };

  // ---- measure: break everything, one every 20 frames, with debris
  const measure = params.get('measure') === '1';
  let frames = 0, frozen = false, updN = 0, updSum = 0;
  let last = performance.now(), fpsT = last, fpsN = 0;
  ctx.renderer.info.autoReset = false;
  ctx.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frames++;
    if (!frozen) {
      if (sim) {
        // real time, capped so slow (SwiftShader) frames don't spiral; or a fixed number of ticks per frame (&spf)
        const spf = Number(params.get('spf') ?? 0);
        if (spf > 0) {
          // presentation (debris, FX) advances with the sim ticks, so a frozen shot shows the same moment for both
          for (let k = 0; k < spf && !(brokeAt >= 0 && Number.isFinite(at) && sim.tick - brokeAt >= at * 60); k++) {
            stepSim();
            destruct.sync(states);
            destruct.update(1 / 60);
            fx.update(1 / 60);
          }
        } else {
          simAcc = Math.min(simAcc + dt, 8 / 60);
          while (simAcc >= 1 / 60) { simAcc -= 1 / 60; stepSim(); }
        }
        destruct.sync(states);
        abilities.sync(states, Team.Corgis, dt);
        if (breacher) { dummy.position.set(breacher.pos.x, breacher.pos.y, breacher.pos.z); dummy.rotation.y = breacher.yaw; }
        if (brokeAt >= 0 && Number.isFinite(at) && sim.tick - brokeAt >= at * 60) frozen = true;
      } else if (frames === wait && targets.length) {
        if (Number.isFinite(at)) {
          for (const { i } of targets) onEvent(eventOf(i));
          // advance debris + FX to exactly `at` s after the break, then freeze: the shot shows that moment at any fps
          for (let s = 0; s < Math.round(at * 60); s++) { destruct.update(1 / 60); fx.update(1 / 60); }
          frozen = true;
        } else for (const { i } of targets) destruct.setBroken(i, true, false);
      }
      if (measure && frames > wait && (frames - wait) % 20 === 0) {
        const i = (frames - wait) / 20 - 1;
        if (i < defs.length) onEvent(eventOf(i));
      }
      if (!frozen && !(sim && Number(params.get('spf') ?? 0) > 0)) {
        const u0 = performance.now();
        destruct.update(dt);
        fx.update(dt);
        const um = performance.now() - u0;
        if (lab.x1.breaks > 0) { updN++; updSum += um; lab.x1.updateMaxMs = Math.max(lab.x1.updateMaxMs, um); lab.x1.updateAvgMs = updSum / updN; }
      }
    }
    view.update(dt, cam, 60 * 60 * 3);
    ctx.renderer.info.reset();
    ctx.render();
    fpsN++;
    if (now - fpsT > 500) { debug.fps = (fpsN * 1000) / (now - fpsT); fpsN = 0; fpsT = now; }
    const info = ctx.renderer.info.render as unknown as { drawCalls?: number; calls?: number; triangles?: number };
    lab.drawCalls = info.drawCalls ?? info.calls ?? 0;
    lab.triangles = info.triangles ?? 0;
    debug.frames = frames;
    if (frames === 3 || frames % 15 === 0) lab.world = view.stats();
    debug.ready = frames > wait + 2;
    const st = destruct.stats();
    hudEl.textContent = `${bm} · break=${which}${Number.isFinite(at) ? ` @${at}s` : ''}${sim ? ` · live tick ${sim.tick}` : ''}${frozen ? ' · frozen' : ''}\n`
      + `${st.destructBroken}/${st.destructibles} broken · debris ${st.debrisAlive} · ${lab.drawCalls} draws · ${(lab.triangles / 1000).toFixed(0)}k tris · ${debug.fps.toFixed(1)} fps\n`
      + `break ${lab.x1.breakMaxMs.toFixed(2)} ms · debris+fx frame max ${lab.x1.updateMaxMs.toFixed(2)} ms`;
  });
  (globalThis as unknown as { __lab: unknown }).__lab = { view, destruct, fx, sim, ctx };
}

main().catch((err) => {
  console.error(err);
  debug.errors.push(String(err?.stack ?? err));
  hudEl.textContent = `Failed: ${String(err?.message ?? err)}`;
});

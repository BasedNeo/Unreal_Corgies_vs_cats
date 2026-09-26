#!/usr/bin/env node
// Q1 verification probe (read-only): measures the MASTER_PLAN §4 feel numbers on the real shared movement
// code (stepCharacter through a headless Sim: movement + world effects + physics, player quantization on)
// and models the client camera's crosshair-vs-authority ray offset from the damping constants in
// src/client/camera/third-person.ts.
//   npx tsx tools/qa-feel.mjs            prints a table; always exits 0 (evidence, not a gate)
// Horizontal numbers (speeds, stop, slide) run on the real West Yard trimesh lawn: the flat test slab
// (cuboid) produces spurious one-tick KCC stops that the shipped map does not (checked separately).
// Vertical numbers (jump, buffer, coyote, pound) run on a flat slab with a 2 m platform.
import { Sim } from '../src/sim/sim';
import { Btn } from '../src/shared/input';
import { Team, Species } from '../src/shared/types';
import { movementSystem } from '../src/sim/systems/movement';
import { physicsStepSystem } from '../src/sim/systems/core';
import { worldSystems } from '../src/sim/world/systems';
import { quantizeMotion } from '../src/host/quantize';
import { TICK_DT } from '../src/shared/constants';
import { createWorldData } from '../src/shared/world/world-data';
import { nearestPropDist, waterAt, jumpPadAt } from '../src/shared/world/queries';

const flat = (seed) => ({
  seed, name: 'qa-flat', height: () => 0, halfExtent: 80, spawns: [{ x: 0, y: 0, z: 0, yaw: 0, team: 0 }], killY: -30,
  // 2 m high platform to run off (coyote): top y=2, z in [-30,-10], x in [-5,5]
  props: [{ type: 'crate', x: 0, y: 1, z: -20, hx: 5, hy: 1, hz: 10, rotY: 0 }],
});
const yard = createWorldData(1);
// First open-lawn leg (≥ 30 m clear, dry, no pad) heading yaw.
function openLeg() {
  for (let s = 0; s < 2000; s++) {
    const x0 = -80 + ((s * 37) % 160), z0 = -70 + ((s * 53) % 140), yaw = (s % 8) * Math.PI / 4;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let ok = true;
    for (let d = 0; d <= 32; d++) { const x = x0 + fx * d, z = z0 + fz * d; if (nearestPropDist(yard, x, z, -1, 3) < 2.5 || waterAt(yard, x, z) || jumpPadAt(yard, x, yard.height(x, z), z, 2)) { ok = false; break; } }
    if (ok) return { x0, z0, yaw };
  }
  throw new Error('no open leg');
}
const LEG = openLeg();

async function make(species, cls, where = 'flat', x = 20, z = 20, y = 0) {
  const onYard = where === 'yard';
  const sim = await Sim.create(onYard ? { seed: 1, systems: [movementSystem, ...worldSystems(), physicsStepSystem] } : { seed: 3, world: flat(3), systems: [movementSystem, physicsStepSystem] });
  const px = onYard ? LEG.x0 : x, pz = onYard ? LEG.z0 : z, py = onYard ? yard.height(px, pz) + 0.05 : y;
  const yaw = onYard ? LEG.yaw : 0;
  const e = sim.spawnCharacter({ team: species === Species.Cat ? Team.Cats : Team.Corgis, species, cls, name: 'Q', x: px, y: py, z: pz, yaw });
  let seq = 1;
  const evs = [];
  const step = (mz, mx, b, n = 1, cb) => {
    for (let i = 0; i < n; i++) {
      sim.setInput(e.id, { seq: seq++, mx, mz, yaw, pitch: 0, buttons: b, rt: 0 });
      sim.step();
      quantizeMotion(e); // what the Room does for player-controlled characters
      for (const ev of sim.drainEvents()) evs.push({ t: sim.tick, ...ev });
      cb?.(i);
    }
  };
  step(0, 0, 0, 40);
  evs.length = 0;
  const fwd = () => (e.pos.x - px) * -Math.sin(yaw) + (e.pos.z - pz) * -Math.cos(yaw);
  return { sim, e, step, evs, fwd };
}
const hs = (e) => Math.hypot(e.vel.x, e.vel.z);
const ms = (ticks) => Math.round(ticks * TICK_DT * 1000);
const out = [];
const row = (k, v, target = '') => out.push([k, v, target]);

const CASES = [['corgi assault', Species.Corgi, 'assault'], ['cat assault', Species.Cat, 'assault'], ['corgi infiltrator', Species.Corgi, 'infiltrator'], ['corgi breacher', Species.Corgi, 'breacher']];
for (const [label, species, cls] of CASES) {
  // steady speeds + accel + stop (West Yard lawn)
  for (const [name, b] of [['run', 0], ['sprint', Btn.Sprint], ['aim-walk', Btn.Aim]]) {
    const { e, step, fwd } = await make(species, cls, 'yard');
    const m = e.char.move;
    const target = { run: m.runSpeed, sprint: m.sprintSpeed, 'aim-walk': m.walkSpeed }[name];
    let t90 = -1;
    step(1, 0, b, 90, (i) => { if (t90 < 0 && hs(e) >= 0.9 * target) t90 = i + 1; });
    row(`${label} ${name} speed`, `${hs(e).toFixed(2)} m/s (0→90 % in ${ms(t90)} ms)`, `data ${target} m/s`);
    if (name === 'run') {
      const d0 = fwd(); let n = 0;
      do { step(0, 0, 0, 1); n++; } while (hs(e) > 0.05 && n < 120);
      row(`${label} stop from run`, `${ms(n)} ms / ${(fwd() - d0).toFixed(2)} m`, 'decel data 50 (cat 55) m/s²');
    }
  }
  // slide from full sprint (West Yard lawn), compared with sprinting for the same time
  {
    const { e, step, evs, fwd } = await make(species, cls, 'yard');
    step(1, 0, Btn.Sprint, 70);
    const d0 = fwd(), v0 = hs(e);
    step(1, 0, Btn.Sprint | Btn.Crouch, 1);
    let n = 1, vmax = hs(e);
    while (e.char.slideTime > 0 && n < 120) { step(1, 0, Btn.Sprint | Btn.Crouch, 1); n++; vmax = Math.max(vmax, hs(e)); }
    const slid = fwd() - d0;
    row(`${label} slide (sprint→C)`, `${ms(n)} ms, ${slid.toFixed(2)} m, ${v0.toFixed(1)}→${vmax.toFixed(1)} peak→${hs(e).toFixed(1)} m/s exit`, `sprinting instead ≈ ${(v0 * n * TICK_DT).toFixed(2)} m · evt ${evs.some((v) => v.ability === 'slide')}`);
  }
  // jump: full hold, 1-tick tap, double (flat slab)
  {
    const { e, step } = await make(species, cls);
    const y0 = e.pos.y; let peak = 0, tPeak = 0, n = 0;
    do { step(0, 0, Btn.Jump, 1); n++; if (e.pos.y - y0 > peak) { peak = e.pos.y - y0; tPeak = n; } } while (!(e.char.grounded && n > 5) && n < 200);
    row(`${label} jump (held) apex`, `${peak.toFixed(2)} m @ ${ms(tPeak)} ms, air ${ms(n)} ms`, 'corgi v²/2g = 1.47 m');
  }
  {
    const { e, step } = await make(species, cls);
    const y0 = e.pos.y; let peak = 0;
    step(0, 0, Btn.Jump, 1); step(0, 0, 0, 80, () => { peak = Math.max(peak, e.pos.y - y0); });
    row(`${label} short hop (1-tick tap)`, `${peak.toFixed(2)} m`, 'release early = short hop');
  }
  {
    const { e, step, evs } = await make(species, cls);
    const y0 = e.pos.y; let peak = 0;
    step(0, 0, Btn.Jump, 20, () => { peak = Math.max(peak, e.pos.y - y0); });
    step(0, 0, 0, 1); step(0, 0, Btn.Jump, 30, () => { peak = Math.max(peak, e.pos.y - y0); });
    step(0, 0, 0, 90);
    row(`${label} double jump apex`, `${peak.toFixed(2)} m (${evs.filter((v) => v.e === 'jump').map((v) => (v.double ? 'J2' : 'J1')).join(',')})`, 'corgi ≈ 2.5 m');
  }
  // jump buffer: spend both jumps, then press Jump N ms before touching down
  for (const early of [100, 116, 150]) {
    const seqJ = async () => { const s = await make(species, cls); s.step(0, 0, Btn.Jump, 10); s.step(0, 0, 0, 2); s.step(0, 0, Btn.Jump, 5); s.step(0, 0, 0, 1); return s; };
    const twin = await seqJ(); let k = 0; while (!twin.e.char.grounded && k < 300) { twin.step(0, 0, 0, 1); k++; }
    const { e, step, evs } = await seqJ();
    const pressAt = k - Math.round(early / 1000 / TICK_DT);
    step(0, 0, 0, Math.max(0, pressAt - 1)); step(0, 0, Btn.Jump, 1); step(0, 0, 0, 20);
    const jumps = evs.filter((v) => v.e === 'jump');
    row(`${label} jump buffer, pressed ${early} ms before landing`, jumps.length >= 3 ? 'jumps on touchdown' : 'LOST (no jump)', 'buffer 120 ms');
  }
  // coyote: run off the platform edge; report the actual air time at the press tick
  for (const lateTicks of [5, 7, 8]) {
    const { e, step, evs } = await make(species, cls, 'flat', 0, -11, 2.2);
    let n = 0;
    while (n < 300) { step(1, 0, 0, 1); n++; if (!e.char.grounded && e.pos.y < 1.99) break; }
    evs.length = 0;
    const airAtPress = e.char.airTime + (lateTicks - 1) * TICK_DT;
    step(1, 0, 0, lateTicks - 1); step(1, 0, Btn.Jump, 1);
    const j = evs.find((v) => v.e === 'jump');
    row(`${label} coyote, Jump at ${Math.round(airAtPress * 1000)} ms airborne`, j ? (j.double ? 'double jump (window closed)' : 'ground jump (coyote)') : 'no jump', `coyote ${e.char.move.coyoteTime * 1000} ms`);
  }
  // ground pound: press C N ms after takeoff
  for (const atMs of [17, 33, 200]) {
    const { e, step, evs } = await make(species, cls);
    step(0, 0, Btn.Jump, 1); step(0, 0, Btn.Jump, Math.round(atMs / 1000 / TICK_DT) - 1);
    const h = e.pos.y;
    step(0, 0, Btn.Crouch, 1);
    let n = 1, vmin = e.vel.y; while (!e.char.grounded && n < 200) { step(0, 0, Btn.Crouch, 1); n++; vmin = Math.min(vmin, e.vel.y); }
    const gp = evs.some((v) => v.ability === 'ground_pound');
    row(`${label} ground pound, C ${atMs} ms after takeoff (h ${h.toFixed(2)} m)`, gp ? `slam ${vmin.toFixed(0)} m/s, down in ${ms(n)} ms` : 'ignored (C not buffered; needs airTime > 0.15 s, airTime starts at coyote 0.12)', '');
  }
}

// Camera crosshair vs authority ray (third-person.ts): pivot damp λ=22 (x,z) / λ=10 (y), shoulder λ=14, FOV λ=8, dist λ=10.
{
  const lag = (v, lambda) => v / lambda; // steady-state lag of an exponential follower
  row('crosshair lateral offset vs authority ray, strafing 6.4 m/s', `${lag(6.4, 22).toFixed(2)} m`, 'parallel offset ⇒ same miss at every range');
  row('crosshair lateral offset, strafing at sprint 9.6 m/s', `${lag(9.6, 22).toFixed(2)} m`, 'capsule radius 0.33–0.36 m');
  let y = 0, vy = 8.4, py = 0, maxOff = 0; const dt = 1 / 60;
  for (let i = 0; i < 90; i++) { vy += (vy < 0 ? -24 * 1.55 : -24) * dt; y = Math.max(0, y + vy * dt); py += (y - py) * (1 - Math.exp(-10 * dt)); maxOff = Math.max(maxOff, Math.abs(y - py)); if (y === 0 && i > 5) break; }
  row('crosshair vertical offset during a corgi jump', `${maxOff.toFixed(2)} m max`, 'head zone = top 20 % of ~1.2 m capsule');
  const t95 = (lambda) => Math.round((Math.log(20) / lambda) * 1000);
  row('aim zoom FOV 62→48 (95 %)', `${t95(8)} ms`, 'plan ≈ 120 ms');
  row('aim shoulder 0.55→0.75 (95 %)', `${t95(14)} ms`, 'authority switches in 0 ms');
  row('camera follow x/z (95 %)', `${t95(22)} ms`, 'plan ≈ 150 ms');
  row('camera follow y and distance (95 %)', `${t95(10)} ms`, '');
}

console.log(`open lawn leg: (${LEG.x0}, ${LEG.z0}) yaw ${LEG.yaw.toFixed(2)}`);
const w0 = Math.max(...out.map((r) => r[0].length)), w1 = Math.max(...out.map((r) => String(r[1]).length));
for (const [k, v, t] of out) console.log(`${k.padEnd(w0)}  ${String(v).padEnd(w1)}  ${t}`);

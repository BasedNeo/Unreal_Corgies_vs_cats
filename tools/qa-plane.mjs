#!/usr/bin/env node
// Q2 verification probe (read-only): R1's RC plane crashes on the REAL West Yard with the shipped systems.
//   npx tsx tools/qa-plane.mjs
// A pilot at cruise/boost flies into the garage's west wall, dives onto the garage roof (7.2 m slab), and flies into the
// shed's side. Each must explode on the near side (no tunnelling), throw the pilot out clear of geometry, stun them
// (inputs ignored), then give control back; the pilot survives the crash blast.
import { Sim } from '../src/sim/sim';
import { createDefaultSystems } from '../src/sim/systems';
import { spawnPlane, mountPlane, planeSeatPosition, isStunned } from '../src/sim/vehicles';
import { VEHICLES } from '../src/shared/content/vehicles';
import { Btn } from '../src/shared/input';
import { EFlag, Species, Team } from '../src/shared/types';
import { surfaceAt } from '../src/shared/world/queries';
import { TICK_HZ } from '../src/shared/constants';

const PLANE = VEHICLES.rc_plane;
const rec = (name, pass, detail) => console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
let seq = 1;
async function flight(name, x, y, z, yaw, pitch, speed, boost, check, pushWhileStunned = true) {
  const sim = await Sim.create({ seed: 3, systems: createDefaultSystems() });
  sim.state.room = { mode: 'free' };
  sim.state.rules = { combatLive: true, respawn: [true, true, true] };
  sim.state.vehicleConfig = { autoTerminals: false, hangar: false };
  sim.step(); sim.drainEvents();
  const gx = -43, gz = -27; // spawn + mount on open lawn, then teleport the plane into the air (like the unit tests)
  const plane = spawnPlane(sim, 'rc_plane', Team.Corgis, gx, sim.worldData.height(gx, gz), gz, yaw);
  const pilot = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'pilot', x: gx + 2.2, y: surfaceAt(sim.worldData, gx + 2.2, gz).y + 0.05, z: gz });
  sim.step(); sim.drainEvents();
  mountPlane(sim, plane, pilot);
  plane.collider.setTranslation({ x, y: y + PLANE.gearHeight, z });
  plane.pos.x = x; plane.pos.y = y; plane.pos.z = z; plane.yaw = yaw;
  const p = plane.plane; p.grounded = false; p.speed = speed; p.throttle = 1; plane.pitch = pitch;
  const s = planeSeatPosition(plane); sim.placeCharacter(pilot, s.x, s.y, s.z);
  const ev = [];
  let crashed = -1;
  for (let i = 0; i < 4 * TICK_HZ && crashed < 0; i++) {
    sim.setInput(pilot.id, { seq: seq++, mx: 0, mz: 1, yaw, pitch, buttons: boost ? Btn.Sprint : 0, rt: 0 });
    sim.step();
    for (const e of sim.drainEvents()) ev.push(e);
    if (plane.removed) crashed = i;
  }
  const boom = ev.find((e) => e.e === 'explode');
  sim.step(); sim.drainEvents();
  const stunned = isStunned(sim, pilot), mounted = !!(pilot.flags & EFlag.Mounted);
  const at = { x: +pilot.pos.x.toFixed(2), y: +pilot.pos.y.toFixed(2), z: +pilot.pos.z.toFixed(2) };
  // inputs ignored while stunned
  // stunned: pushing sideways (mx) must not add sideways speed (the eject throw carries on; the input must not)
  let maxSide = 0;
  const sx = Math.cos(yaw), sz = -Math.sin(yaw); // the input's +x (strafe) direction for this yaw
  for (let i = 0; i < 20; i++) { sim.setInput(pilot.id, pushWhileStunned ? { seq: seq++, mx: 1, mz: 1, yaw, pitch: 0, buttons: Btn.Jump | Btn.Sprint, rt: 0 } : { seq: seq++, mx: 0, mz: 0, yaw, pitch: 0, buttons: 0, rt: 0 }); sim.step(); sim.drainEvents(); maxSide = Math.max(maxSide, Math.abs(pilot.vel.x * sx + pilot.vel.z * sz)); }
  const movedStunned = maxSide;
  const stunPos = [pilot.pos.x, pilot.pos.y, pilot.pos.z];
  for (let i = 0; i < 90; i++) { sim.setInput(pilot.id, { seq: seq++, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }); sim.step(); sim.drainEvents(); }
  const x1 = pilot.pos.x, z1 = pilot.pos.z;
  for (let i = 0; i < 40; i++) { sim.setInput(pilot.id, { seq: seq++, mx: 0, mz: 1, yaw: yaw + Math.PI, pitch: 0, buttons: 0, rt: 0 }); sim.step(); sim.drainEvents(); } // walk back the way the plane came
  const movedAfter = Math.hypot(pilot.pos.x - x1, pilot.pos.z - z1);
  const ok = crashed >= 0 && !!boom && check(boom, pilot) && !mounted && stunned && movedAfter > 1 && !pilot.dead;
  rec(name, ok, `crash after ${(crashed / TICK_HZ).toFixed(2)} s · explode at (${boom?.x.toFixed(2)}, ${boom?.y.toFixed(2)}, ${boom?.z.toFixed(2)}) · pilot out at ${JSON.stringify(at)} mounted ${mounted} stunned ${stunned} · max sideways speed while stunned (pushing strafe) ${movedStunned.toFixed(2)} m/s · after ${movedAfter.toFixed(2)} m · hp ${pilot.health.hp}/${pilot.health.max}`);
  sim.dispose();
  return stunPos;
}
const EAST = -Math.PI / 2, SOUTH = Math.PI; // forward = (-sin yaw, -cos yaw)
const cmp = async (...a) => { const p1 = await flight(...a, true); const p0 = await flight(a[0] + ' [control: no input]', ...a.slice(1), false); const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]); rec(`  stun ignores inputs (${a[0].split(' —')[0]})`, d < 0.01, `position after 20 stunned ticks, pushing W+D+jump+sprint vs no input: ${d.toFixed(3)} m apart`); };
await cmp('cruise into the garage west wall (x 68) at y 4 — near side, pilot clear + stunned', 40, 4, -59, EAST, 0, PLANE.topSpeed, false, (b, pl) => b.x < 68.2 && pl.pos.x < 68);
await cmp('boosted dive onto the garage roof (7.2 m) — explodes on top, pilot above the roof', 70, 22, -59, EAST, -0.9, PLANE.topSpeed * 1.3, true, (b, pl) => b.y > 6.6 && pl.pos.y > 6.9);
await cmp('boost into the shed side (z 80) at y 3 — near side', 47, 3, 55, SOUTH, 0, PLANE.topSpeed * 1.3, true, (b, pl) => b.z < 80.2 && pl.pos.z < 80);

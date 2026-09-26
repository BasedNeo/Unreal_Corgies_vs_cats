#!/usr/bin/env node
// Q2 verification probe (read-only): X1 destructibles + the lead's rams/direct hits, re-measured with the SHIPPED
// system list (createDefaultSystems: AI, vehicles, bosses, adventure, destruct … all registered) on the real West Yard.
//   npx tsx tools/qa-destruct.mjs
// Checks: rifle vs the breach wall · a corgi running at the wall before/after a Dig Charge · the breaching fuse time ·
// nav path alley→inside before/after · the prediction mirror · frisbee direct hits (crate: yes, wall: no) · kart rams
// (hard into crate_stack_1 / crate_stack_3 / the wall; a gentle bump) · a tennis-mortar lob on a tuna stack.
import { Sim } from '../src/sim/sim';
import { createDefaultSystems } from '../src/sim/systems';
import { movementSystem } from '../src/sim/systems/movement';
import { physicsStepSystem } from '../src/sim/systems/core';
import { worldSystems } from '../src/sim/world/systems';
import { eyeHeight, worldLineClear } from '../src/sim/combat';
import { destructibles, destructiblesByTag, mirrorDestructibles } from '../src/sim/destruct';
import { findPath, navGridFor } from '../src/sim/ai/nav';
import { spawnKart, mountKart, spawnPlane, planeCenterOf } from '../src/sim/vehicles';
import { Btn } from '../src/shared/input';
import { Species, Team } from '../src/shared/types';
import { surfaceAt } from '../src/shared/world/queries';
import { GARAGE_BREACH } from '../src/shared/world/garage';
import { TICK_HZ } from '../src/shared/constants';

const out = [];
const rec = (name, pass, detail) => { out.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };
const BZ = (GARAGE_BREACH.z0 + GARAGE_BREACH.z1) / 2, WEST = Math.PI / 2;
async function yard() {
  const sim = await Sim.create({ seed: 3, systems: createDefaultSystems() });
  sim.state.room = { mode: 'free' };
  sim.state.rules = { combatLive: true, respawn: [true, true, true] };
  sim.state.vehicleConfig = { autoTerminals: false, hangar: false };
  sim.step(); sim.drainEvents();
  return sim;
}
const spawn = (sim, team, cls, x, z, yaw = 0) => sim.spawnCharacter({ team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: `q${sim.entities.size}`, x, y: surfaceAt(sim.worldData, x, z, 3).y + 0.05, z, yaw });
let seq = 1;
function hold(sim, e, s, o = {}, evs = []) {
  for (let i = 0; i < Math.round(s * TICK_HZ); i++) {
    sim.setInput(e.id, { seq: seq++, mx: 0, mz: o.mz ?? 0, yaw: o.yaw ?? e.yaw, pitch: o.pitch ?? 0, buttons: o.tap && i > 0 ? 0 : o.buttons ?? 0, rt: 0 });
    sim.step();
    for (const ev of sim.drainEvents()) evs.push({ ...ev, tick: sim.tick });
  }
  return evs;
}
const aim = (e, x, y, z) => { const ex = e.pos.x, ey = e.pos.y + eyeHeight(e), ez = e.pos.z; return { yaw: Math.atan2(-(x - ex), -(z - ez)), pitch: Math.atan2(y - ey, Math.hypot(x - ex, z - ez)) }; };
const wallOf = (sim) => destructiblesByTag(sim, 'garage_breach_wall')[0];
const byId = (sim, id) => destructibles(sim).find((e) => e.dsx.def.id === id);
const breaks = (evs) => evs.filter((e) => e.e === 'ability' && String(e.ability).startsWith('destruct:'));

{ // rifle vs the wall; a runner stays outside
  const sim = await yard();
  const w = wallOf(sim);
  const a = spawn(sim, Team.Corgis, 'assault', 101, BZ, WEST);
  const evs = hold(sim, a, 6, { ...aim(a, 93.7, 1.6, BZ), buttons: Btn.Fire });
  const shots = evs.filter((e) => e.e === 'fire' && e.id === a.id).length;
  rec('rifle fire does not hurt the breach wall', w.health.hp === 150 && !w.dsx.broken, `${shots} rifle shots · wall hp ${w.health.hp}`);
  const r = spawn(sim, Team.Corgis, 'assault', 100, BZ + 1, WEST);
  hold(sim, r, 3, { mz: 1, yaw: WEST, buttons: Btn.Sprint });
  rec('before the breach a corgi running at the wall stays outside', r.pos.x > 93.9, `runner x ${r.pos.x.toFixed(2)} (wall face x 94.0)`);
  const plen = () => { const o = []; if (!findPath(navGridFor(sim), 97, BZ, 89, BZ, o)) return null; let d = 0, px = 97, pz = BZ; for (let i = 0; i < o.length; i += 2) { d += Math.hypot(o[i] - px, o[i + 1] - pz); px = o[i]; pz = o[i + 1]; } return +d.toFixed(1); };
  const before = plen();
  // Breacher plants a Dig Charge at the wall, then backs off
  const b = spawn(sim, Team.Corgis, 'breacher', 95.2, BZ - 1, WEST);
  const pe = hold(sim, b, 0.1, { yaw: WEST, buttons: Btn.Ability, tap: true });
  const plantTick = sim.tick;
  const be = hold(sim, b, 4, { mz: -1, yaw: WEST });
  const brk = breaks([...pe, ...be])[0];
  rec('a Dig Charge planted at the wall breaches it (breaching fuse)', !!brk && w.dsx.broken, brk ? `broke ${((brk.tick - plantTick) / TICK_HZ).toFixed(2)} s after the Q press (claim 2.5 s) · by ${w.dsx.brokeBy === b.id ? 'the breacher' : w.dsx.brokeBy}` : `no break · wall hp ${w.health.hp}`);
  hold(sim, r, 3, { mz: 1, yaw: WEST, buttons: Btn.Sprint });
  rec('after the breach the same corgi runs into the garage', r.pos.x < 90, `runner x ${r.pos.x.toFixed(2)}`);
  const after = plen();
  const len = (v) => v;
  rec('nav: the path alley→inside shortens through the hole', (len(after) ?? 99) < 8.5 && (len(before) ?? 0) > (len(after) ?? 99), `path before ${len(before)} m · after ${len(after)} m (straight line 8 m; claim > 12 before, ≤ 8.5 after)`);
  // prediction mirror: a system-less predicted sim with the snapshot states
  const psim = await Sim.create({ seed: 3, systems: [movementSystem, ...worldSystems(), physicsStepSystem] });
  const cache = new Map();
  const states = sim.snapshotEntities();
  mirrorDestructibles(psim, states, cache);
  const standing = [...cache.values()].filter((c) => c?.length).length;
  const wallRay = worldLineClear(psim, 97, 1.5, BZ, 90, 1.5, BZ);
  rec('prediction mirror: the broken wall is not mirrored (the predicted ray passes)', wallRay && standing === destructibles(sim).filter((d) => !d.dsx.broken).length, `mirrored standing ${standing} · predicted ray alley→inside clear ${wallRay}`);
  sim.dispose(); psim.dispose();
}

{ // frisbee direct hits: a crate stack takes it, the wall does not
  const sim = await yard();
  const c = byId(sim, 'crate_stack_1'), w = wallOf(sim);
  const cx = c.dsx.def.cx, cz = c.dsx.def.cz;
  let s = null;
  for (let k = 0; k < 24 && !s; k++) { const a = (k / 24) * Math.PI * 2, x = cx + Math.cos(a) * 9, z = cz + Math.sin(a) * 9; if (Math.abs(surfaceAt(sim.worldData, x, z).y - sim.worldData.height(x, z)) < 0.05 && worldLineClear(sim, x, sim.worldData.height(x, z) + 1.2, z, cx, sim.worldData.height(cx, cz) + 0.8, cz)) s = { x, z }; }
  const sk = spawn(sim, Team.Corgis, 'skyraider', s.x, s.z);
  const hp0 = c.health.hp;
  const evs = [];
  for (let k = 0; k < 8; k++) { hold(sim, sk, 0.05, { ...aim(sk, cx, sim.worldData.height(cx, cz) + 0.9, cz), buttons: Btn.Fire }, evs); hold(sim, sk, 0.45, { ...aim(sk, cx, sim.worldData.height(cx, cz) + 0.9, cz) }, evs); }
  console.log('   frisbee events:', JSON.stringify(evs.filter((e) => e.e !== 'fire' && e.e !== 'land' && e.e !== 'jump').slice(0, 6)), 'shooter at', sk.pos.x.toFixed(1), sk.pos.z.toFixed(1), 'crate at', cx.toFixed(1), cz.toFixed(1));
  rec('frisbee direct hits damage a crate stack', c.health.hp < hp0 || c.dsx.broken, `crate hp ${hp0} → ${c.health.hp}, broken ${c.dsx.broken} · frisbees fired ${evs.filter((e) => e.e === 'fire' && e.id === sk.id).length}`);
  const sk2 = spawn(sim, Team.Corgis, 'skyraider', 101, BZ);
  for (let k = 0; k < 8; k++) { hold(sim, sk2, 0.05, { ...aim(sk2, 93.7, 1.4, BZ), buttons: Btn.Fire }); hold(sim, sk2, 0.45, aim(sk2, 93.7, 1.4, BZ)); }
  rec('frisbees do not hurt the breach wall', w.health.hp === 150 && !w.dsx.broken, `wall hp ${w.health.hp}`);
  sim.dispose();
}

{ // frisbee direct hits on vehicles (one fresh yard per target, same open-lawn spot): enemy kart / enemy plane take it; a friendly kart does not
  const one = async (kind, team) => {
    const sim = await yard();
    const px = -43, pz = -27;
    const v = kind === 'plane' ? spawnPlane(sim, 'rc_plane', team, px, sim.worldData.height(px, pz), pz, 0) : spawnKart(sim, 'mower_kart', team, px, sim.worldData.height(px, pz), pz, 0);
    sim.step(); sim.drainEvents();
    const c = kind === 'plane' ? planeCenterOf(v) : { x: v.pos.x, y: v.pos.y + 0.6, z: v.pos.z };
    const sk = spawn(sim, Team.Corgis, 'skyraider', c.x, c.z + 9);
    const h0 = v.health.hp;
    for (let k = 0; k < 3; k++) { hold(sim, sk, 0.05, { ...aim(sk, c.x, c.y, c.z), buttons: Btn.Fire }); hold(sim, sk, 0.6, aim(sk, c.x, c.y, c.z)); }
    const r = `${h0}→${v.health.hp}`; sim.dispose(); return [h0, v.health.hp, r];
  };
  const ek = await one('kart', Team.Cats), fk = await one('kart', Team.Corgis), ep = await one('plane', Team.Cats);
  rec('frisbee direct hits (3 each): enemy kart and enemy plane take damage, a friendly kart does not', ek[1] < ek[0] && fk[1] === fk[0] && ep[1] < ep[0], `enemy kart ${ek[2]} · friendly kart ${fk[2]} · enemy plane ${ep[2]}`);
}

async function ram(id, throttle, runUp, boost) {
  const sim = await yard();
  const t = id === 'wall' ? wallOf(sim) : byId(sim, id);
  const cx = id === 'wall' ? 94.5 : t.dsx.def.cx, cz = id === 'wall' ? BZ : t.dsx.def.cz;
  let start = null;
  const angles = id === 'wall' ? [0] : Array.from({ length: 16 }, (_, k) => (k / 16) * Math.PI * 2);
  for (const a of angles) {
    if (start) break;
    const x = cx + Math.cos(a) * runUp, z = cz + Math.sin(a) * runUp, y = surfaceAt(sim.worldData, x, z).y;
    if (Math.abs(y - sim.worldData.height(x, z)) > 0.05) continue;
    const sx = cx + Math.cos(a) * 2.4, sz = cz + Math.sin(a) * 2.4;
    if (worldLineClear(sim, x, y + 0.5, z, sx, sim.worldData.height(sx, sz) + 0.5, sz)) start = { x, z };
  }
  if (!start) { sim.dispose(); return { id, err: 'no clear run-up' }; }
  const yaw = Math.atan2(-(cx - start.x), -(cz - start.z));
  const kart = spawnKart(sim, 'mower_kart', Team.Corgis, start.x, surfaceAt(sim.worldData, start.x, start.z).y, start.z, yaw);
  const d = spawn(sim, Team.Corgis, 'assault', start.x + 1.5, start.z);
  hold(sim, d, 0.1);
  const mounted = mountKart(sim, kart, d);
  let vmax = 0;
  const evs = [];
  for (let i = 0; i < 3.5 * TICK_HZ; i++) { hold(sim, d, 1 / TICK_HZ, { mz: throttle, yaw, buttons: boost ? Btn.Sprint : 0 }, evs); vmax = Math.max(vmax, Math.hypot(kart.vel.x, kart.vel.z)); }
  const r = { id, mounted, broken: t.dsx.broken, hp: +t.health.hp.toFixed(1), vmax: +vmax.toFixed(1), breaks: breaks(evs).length };
  sim.dispose();
  return r;
}
for (const [id, th, run, boost, expectBreak] of [['crate_stack_1', 1, 18, true, true], ['crate_stack_3', 1, 18, true, true], ['tuna_stack_1', 1, 6, true, null], ['wall', 1, 5, true, false], ['crate_stack_1', 0.3, 4, false, false]]) {
  const r = await ram(id, th, run, boost);
  const pass = r.err ? expectBreak === null : expectBreak === null ? true : r.broken === expectBreak;
  rec(`kart ram ${boost ? 'hard (boost, 18 m run-up)' : 'gentle (0.3 throttle, 4 m)'} into ${id}: ${expectBreak === null ? 'measured' : expectBreak ? 'breaks' : 'holds'}`, pass, JSON.stringify(r));
}
const fails = out.filter((r) => !r.pass).length;
console.log(`\nDESTRUCT: ${out.length - fails}/${out.length} pass`);

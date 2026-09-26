#!/usr/bin/env node
// Q2 verification probe (read-only): the lead's friendly-shot pass on the REAL West Yard with the shipped systems.
//   npx tsx tools/qa-w4lead.mjs
// A Warden raises a Squeak Barrier (real Q press) between a corgi rifle and a cat: the corgi's shots pass their own
// wall and hit the cat; the cat's shots stop on the wall; a corgi bot behind its own wall still sees (and shoots) the cat.
import { Sim } from '../src/sim/sim';
import { createDefaultSystems } from '../src/sim/systems';
import { eyeHeight } from '../src/sim/combat';
import { applyArchetype } from '../src/sim/ai';
import { Btn } from '../src/shared/input';
import { EntityKind, Species, Team } from '../src/shared/types';
import { surfaceAt } from '../src/shared/world/queries';
import { TICK_HZ } from '../src/shared/constants';

const rec = (name, pass, detail) => console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
async function yard() {
  const sim = await Sim.create({ seed: 3, systems: createDefaultSystems() });
  sim.state.room = { mode: 'free' };
  sim.state.rules = { combatLive: true, respawn: [false, false, false] };
  sim.state.vehicleConfig = { autoTerminals: false, hangar: false };
  sim.step(); sim.drainEvents();
  return sim;
}
const spawn = (sim, team, cls, x, z, yaw = 0, kind = EntityKind.Player) => sim.spawnCharacter({ kind, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: `q${sim.entities.size}`, x, y: surfaceAt(sim.worldData, x, z, 3).y + 0.05, z, yaw });
const aim = (e, x, y, z) => { const ex = e.pos.x, ey = e.pos.y + eyeHeight(e), ez = e.pos.z; return { yaw: Math.atan2(-(x - ex), -(z - ez)), pitch: Math.atan2(y - ey, Math.hypot(x - ex, z - ez)) }; };
let seq = 1;
const input = (sim, e, buttons, a) => sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw: a.yaw, pitch: a.pitch, buttons, rt: 0 });

for (const botShooter of [false, true]) {
  const sim = await yard();
  const X = -43, Z = -20; // open lawn; the cat stands 12 m north (-z)
  const owner = spawn(sim, Team.Corgis, 'warden', X, Z, 0);
  const shooter = spawn(sim, Team.Corgis, 'assault', X + 0.8, Z + 1.6, 0, botShooter ? EntityKind.Bot : EntityKind.Player);
  const cat = spawn(sim, Team.Cats, 'assault', X, Z - 12, Math.PI);
  for (let i = 0; i < 20; i++) { sim.step(); sim.drainEvents(); }
  // Warden presses Q facing the cat
  input(sim, owner, Btn.Ability, aim(owner, cat.pos.x, cat.pos.y + 0.6, cat.pos.z)); sim.step(); sim.drainEvents();
  input(sim, owner, 0, aim(owner, cat.pos.x, cat.pos.y + 0.6, cat.pos.z));
  const bar = [...sim.entities.values()].find((e) => e.kind === EntityKind.Ability && e.team === Team.Corgis && !e.removed);
  if (botShooter) applyArchetype(shooter, 'rifleman');
  const evs = [];
  for (let i = 0; i < 2.5 * TICK_HZ; i++) {
    if (!botShooter) input(sim, shooter, Btn.Fire, aim(shooter, cat.pos.x, cat.pos.y + 0.6, cat.pos.z));
    input(sim, cat, Btn.Fire, aim(cat, owner.pos.x, owner.pos.y + 0.6, owner.pos.z));
    input(sim, owner, 0, aim(owner, cat.pos.x, cat.pos.y + 0.6, cat.pos.z));
    cat.health.hp = Math.max(cat.health.hp, 1); // keep the target up for the count
    sim.step();
    for (const ev of sim.drainEvents()) evs.push(ev);
  }
  const hits = (s, d) => evs.filter((e) => e.e === 'hit' && e.src === s && e.dst === d).length;
  const between = bar && bar.pos.z < Z && bar.pos.z > Z - 12;
  const ok = !!bar && between && hits(shooter.id, cat.id) > 0 && hits(cat.id, bar.id) > 0 && hits(cat.id, owner.id) === 0 && hits(cat.id, shooter.id) === 0;
  rec(`${botShooter ? 'corgi BOT' : 'corgi player'} shoots through its own Squeak Barrier; the cat's shots stop on it`, ok,
    `barrier ${bar ? `at z ${bar.pos.z.toFixed(1)} (between: ${between}), hp ${bar.health.hp}` : 'NOT RAISED'} · corgi→cat hits ${hits(shooter.id, cat.id)} · cat→barrier ${hits(cat.id, bar?.id)} · cat→warden ${hits(cat.id, owner.id)} · cat→shooter ${hits(cat.id, shooter.id)}`);
  sim.dispose();
}

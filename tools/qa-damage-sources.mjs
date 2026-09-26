#!/usr/bin/env node
// Lead diagnostic: who damages the local player in offline skirmish (stand-in "you" driven by the rifleman brain).
//   npx tsx tools/qa-damage-sources.mjs [--seconds 240] [--seed 1]
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { PROTOCOL_VERSION, TICK_HZ } from '../src/shared/constants';
import { applyArchetype } from '../src/sim/ai';
import { EntityKind } from '../src/shared/types';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SECONDS = Number(opt('seconds', 240)), SEED = Number(opt('seed', 1));
const sim = await Sim.create({ seed: SEED });
const room = new Room(sim, { mode: 'yard-skirmish', botsPerTeam: [3, 0] });
const slot = room.join({ id: 'you', send() {} }, { t: 'hello', v: PROTOCOL_VERSION, name: 'You', team: 0, cls: 'assault' });
const by = new Map(); let deaths = 0, taken = 0;
const label = (id) => { const e = sim.entities.get(id); if (!e) return `gone#${id}`; const k = Object.keys(EntityKind).find((n) => EntityKind[n] === e.kind); return `${k}:${e.ai?.arch?.id ?? e.name?.split(' ')[0] ?? ''}${id === slot.entity ? '(self)' : ''}`; };
const drain = sim.drainEvents.bind(sim);
sim.drainEvents = () => { const evs = drain(); for (const e of evs) {
  if (e.e === 'hit' && e.dst === slot.entity) { const k = label(e.src); by.set(k, (by.get(k) ?? 0) + e.dmg); taken += e.dmg; }
  if (e.e === 'death' && e.id === slot.entity) deaths++;
} return evs; };
let seq = 0;
for (let t = 0; t < SECONDS * TICK_HZ; t++) {
  const e = sim.entities.get(slot.entity);
  if (e) { if (!e.ai) applyArchetype(e, 'rifleman', { external: true }); const c = e.ai?.out; if (c) room.handle('you', { t: 'input', cmds: [{ seq: ++seq, mx: c.mx, mz: c.mz, yaw: c.yaw, pitch: c.pitch, buttons: c.buttons, rt: Math.max(0, sim.tick - 6) }] }); }
  room.tick();
}
console.log(`seed ${SEED} ${SECONDS}s: deaths ${deaths}, damage taken ${taken}`);
for (const [k, v] of [...by.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${v}`);

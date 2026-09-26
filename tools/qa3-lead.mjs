#!/usr/bin/env node
// Q3 verification probe (read-only): the lead's post-Q2 authority changes, in-process on the real Room + default systems.
//   npx tsx tools/qa3-lead.mjs holdresult [--seed 3]   offline (holdResult, as worker-host sets it) vs online (no hold):
//                                                      ch1 and the finale (ch6), bot-only, then 60 s past completion
//   npx tsx tools/qa3-lead.mjs listing [--seed 3]  an online adventure room (no holdResult) after it moves on: what /rooms
//                                                      would list (server/rooms.ts list() reads room.opts.chapter) vs what runs
//   npx tsx tools/qa3-lead.mjs steal2 [--seeds 1,2,3,7]  Q2 P1-1 follow-up: ch3 with a human Breacher; once the human reaches
//                                                      the wall (step 2 'Blow the wall … (Q)'), who blows it: (a) the human
//                                                      idles, (b) the human plants 1.0 s after step 2 goes live, 1.5 m from the boards
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { createDefaultSystems } from '../src/sim/systems';
import { adventureSystems, adventureState } from '../src/sim/adventure';
import { chapterById } from '../src/shared/content/chapters';
import { PROTOCOL_VERSION, TICK_HZ } from '../src/shared/constants';
import { destructiblesByTag } from '../src/sim/destruct';
import { Btn } from '../src/shared/input';
import { EntityKind } from '../src/shared/types';

const argv = process.argv.slice(2);
const scenario = argv[0] ?? 'holdresult';
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const SEED = Number(opt('seed', 3));
const withAdventure = () => { const s = createDefaultSystems(); return s.some((x) => x.name === 'adventure') ? s : [...s, ...adventureSystems()]; };

if (scenario === 'holdresult') {
  for (const chapter of ['yard_day', 'last_ball']) {
    for (const hold of [true, false]) {
      const def = chapterById(chapter);
      const sim = await Sim.create({ seed: SEED, systems: withAdventure() });
      if (hold) sim.state.adventureConfig = { holdResult: true }; // exactly what src/host/worker-host.ts sets offline
      const room = new Room(sim, { mode: 'adventure', chapter, botsPerTeam: [4, 0] });
      let completeAt = -1;
      const seen = [];
      for (let i = 0; i < (def.par * 2 + 30) * TICK_HZ; i++) {
        room.tick(); sim.drainEvents();
        const st = adventureState(sim);
        if (st.phase === 'complete') { completeAt = sim.tick; break; }
      }
      // then 60 s more: does the room move on by itself?
      let last = '';
      for (let i = 0; i < 60 * TICK_HZ && completeAt >= 0; i++) {
        room.tick(); sim.drainEvents();
        const st = adventureState(sim);
        const k = `${st.chapter}:${st.phase}`;
        if (k !== last) { seen.push(`${((sim.tick - completeAt) / TICK_HZ).toFixed(1)} s ${k}`); last = k; }
      }
      const st = adventureState(sim);
      console.log(JSON.stringify({ chapter, mode: hold ? 'offline (holdResult)' : 'online (no hold)', completedAtS: completeAt >= 0 ? +(completeAt / TICK_HZ).toFixed(1) : null, afterCompletion60s: seen, endsOn: `${st.chapter}:${st.phase}`, match: room.match.phase }));
      room.dispose();
    }
  }
}

if (scenario === 'steal2') {
  const seeds = String(opt('seeds', '1,2,3,7')).split(',').map(Number);
  for (const seed of seeds) for (const plant of [false, true]) {
    const sim = await Sim.create({ seed });
    const room = new Room(sim, { mode: 'adventure', chapter: 'garage_job', botsPerTeam: [4, 0] });
    const slot = room.join({ id: `h${seed}`, send() {} }, { t: 'hello', v: PROTOCOL_VERSION, name: 'Human', team: 0, cls: 'breacher' });
    const evs = [];
    const drain = sim.drainEvents.bind(sim);
    sim.drainEvents = () => { const a = drain(); evs.push(...a.map((x) => ({ ...x, tick: sim.tick }))); return a; };
    const wall = () => destructiblesByTag(sim, 'garage_breach_wall')[0];
    let seq = 0;
    const idle = (buttons = 0, yaw = Math.PI / 2) => room.handle(slot.pid, { t: 'input', cmds: [{ seq: ++seq, mx: 0, mz: 0, yaw, pitch: 0, buttons, rt: Math.max(0, sim.tick - 2) }] });
    for (let i = 0; i < 30 * TICK_HZ; i++) { idle(); room.tick(); }
    const h = [...sim.entities.values()].find((e) => e.kind === EntityKind.Player);
    sim.placeCharacter(h, 95.5, sim.worldData.height(95.5, -66) + 0.05, -66);
    let s2 = -1;
    for (let i = 0; i < 3 * TICK_HZ && s2 < 0; i++) { idle(); room.tick(); if (adventureState(sim).step >= 1) s2 = sim.tick; }
    evs.length = 0;
    let broke = -1, pressed = -1;
    for (let i = 0; i < 20 * TICK_HZ && broke < 0; i++) {
      const t = (sim.tick - s2) / TICK_HZ;
      const press = plant && t >= 1.0 && t < 1.2;
      if (press && pressed < 0) pressed = sim.tick;
      idle(press ? Btn.Ability : 0);
      room.tick();
      h.health.hp = h.health.max;
      if (wall().dsx.broken) broke = sim.tick;
    }
    const charges = evs.filter((e) => e.e === 'ability' && e.ability === 'dig_charge').map((e) => { const c = sim.entities.get(e.id); return `${((e.tick - s2) / TICK_HZ).toFixed(2)} s by ${c?.kind === EntityKind.Player ? 'HUMAN' : (c?.name ?? e.id)}`; });
    const by = sim.entities.get(wall().dsx.brokeBy);
    console.log(JSON.stringify({ seed, human: plant ? 'plants (Q) 1.0 s after step 2 goes live, 1.5 m from the boards' : 'idles at the wall', step2LiveAtS: +(s2 / TICK_HZ).toFixed(2), wallBrokeAfterS: broke >= 0 ? +((broke - s2) / TICK_HZ).toFixed(2) : null, brokeBy: by ? (by.kind === EntityKind.Player ? 'HUMAN' : `${by.name} ${by.cls}`) : wall().dsx.brokeBy, chargesAfterStep2: charges, stepNow: adventureState(sim).step }));
    room.dispose();
  }
}

if (scenario === 'listing') {
  const sim = await Sim.create({ seed: SEED, systems: withAdventure() });
  const room = new Room(sim, { mode: 'adventure', chapter: 'yard_day', botsPerTeam: [4, 0] }); // as server/rooms.ts creates it
  const seen = [];
  let last = '';
  for (let i = 0; i < 260 * TICK_HZ; i++) {
    room.tick(); sim.drainEvents();
    const st = adventureState(sim);
    const k = `${st.chapter}:${st.phase}`;
    if (k !== last) { last = k; seen.push(`${(sim.tick / TICK_HZ).toFixed(0)} s runs ${st.chapter} (${st.phase}) · listed as ${room.opts.chapter}`); }
  }
  for (const l of seen) console.log(l);
  room.dispose();
}

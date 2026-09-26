#!/usr/bin/env node
// Q3 verification probe (read-only): the authority's heap over a LONG match history (MASTER_PLAN §8.7: no growth over
// a 10-minute soak). tools/soak.mjs --heap fits one slope over 10 simulated minutes; this runs --minutes (default 30)
// of a shipping-config room (Room bot fill, the shipping match config, so matches end and restart, bots drive and fly)
// and prints every per-minute sample after a forced GC, plus the entity count and vehicle count, so a plateau can be
// told apart from a leak.
//   NODE_OPTIONS=--expose-gc npx tsx tools/qa3-heap.mjs [--mode team-deathmatch] [--minutes 30] [--seed 1] [--soak-config]
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { TICK_HZ } from '../src/shared/constants';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const MODE = opt('mode', 'team-deathmatch'), MINUTES = Number(opt('minutes', 30)), SEED = Number(opt('seed', 1));
if (typeof globalThis.gc !== 'function') throw new Error('run with NODE_OPTIONS=--expose-gc');
const sim = await Sim.create({ seed: SEED });
const room = new Room(sim, { mode: MODE, botsPerTeam: MODE === 'adventure' ? [4, 0] : MODE === 'yard-skirmish' || MODE === 'boss-rush' ? [3, 0] : [4, 4], ...(MODE === 'adventure' ? { chapter: 'yard_day' } : {}) });
if (argv.includes('--soak-config')) sim.state.matchConfig = { tdm: { warmup: 3, killLimit: 12, timeLimit: 45, endedHold: 5 } };
const samples = [];
let restarts = 0, prev = null;
const t0 = performance.now();
for (let m = 0; m <= MINUTES; m++) {
  if (m > 0) for (let i = 0; i < 60 * TICK_HZ; i++) { room.tick(); sim.drainEvents(); const ph = room.match.phase; if (prev === 'ended' && ph !== 'ended') restarts++; prev = ph; }
  globalThis.gc(); globalThis.gc();
  const h = process.memoryUsage();
  let veh = 0; for (const e of sim.entities.values()) if (e.kart || e.plane) veh++;
  const s = { min: m, heapMB: +(h.heapUsed / 1048576).toFixed(2), entities: sim.entities.size, vehicles: veh, restarts };
  samples.push(s);
  console.log(JSON.stringify(s));
}
const fit = (from) => {
  const tail = samples.filter((s) => s.min >= from);
  const mx = tail.reduce((a, s) => a + s.min, 0) / tail.length, my = tail.reduce((a, s) => a + s.heapMB, 0) / tail.length;
  let num = 0, den = 0;
  for (const s of tail) { num += (s.min - mx) * (s.heapMB - my); den += (s.min - mx) ** 2; }
  return +(num / den).toFixed(3);
};
console.log('SUMMARY', JSON.stringify({ mode: MODE, minutes: MINUTES, wallS: Math.round((performance.now() - t0) / 1000), first: samples[0].heapMB, last: samples.at(-1).heapMB, slopeAfter1: fit(1), slopeAfter10: fit(10), slopeLastHalf: fit(Math.floor(MINUTES / 2)), restarts }));
room.dispose();

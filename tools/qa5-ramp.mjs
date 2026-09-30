#!/usr/bin/env node
// Q5 verification probe (read-only): is A7's "heap north-ramp pin" (LEARNINGS 2026-09-27: a bot heading diagonally for
// the Lot heap's top slid up and down the north ramp's east edge for ~40 s, at (66.4, 84.5)-(68.4, 92.6)) still there?
//   npx tsx tools/qa5-ramp.mjs [--cap 45]
//   npx tsx tools/qa5-ramp.mjs --trace 68.4,92.6,44,120.8 [--cat]   one run, position every 0.5 s
// A lone bot on the real Lot (no match, vehicles off) is sent from points round the ramp's foot to points on the heap
// top, with N3's harness (ai.hasGoal / goalX / goalZ every tick) and the soak's stuck rule. Prints each run's arrival
// time, stuck max and where it spent its time; a run that does not arrive inside the cap is a pin.
import { Sim } from '../src/sim/sim';
import { ensureBrain } from '../src/sim/ai/brain';
import { TICK_HZ } from '../src/shared/constants';
import { EntityKind, Species, Team } from '../src/shared/types';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const CAP = Number(opt('cap', 45));
// starts: the reported pin's ends, and points south / east / west of the ramp's foot (HEAP_RAMP x 60-66, z 95 → top)
const STARTS = [[66.4, 84.5], [68.4, 92.6], [72, 80], [80, 88], [70, 70], [58, 82], [90, 96], [62, 60]];
// goals on the heap top: the siren fuse, two stash balls, the scaffold hold
const GOALS = [[44, 120.8], [52, 114], [28, 110], [36, 99]];

function stuckMeter(e) {
  let px = e.pos.x, pz = e.pos.z, odo = 0, want = 0, n = 0, stuck = 0, max = 0;
  return {
    tick() {
      odo += Math.hypot(e.pos.x - px, e.pos.z - pz); px = e.pos.x; pz = e.pos.z;
      if (!e.dead && Math.hypot(e.input.mx, e.input.mz) > 0.5) want++;
      if (++n >= 30) { stuck = !e.dead && want >= 27 && odo < 0.25 ? stuck + 0.5 : 0; max = Math.max(max, stuck); odo = 0; want = 0; n = 0; }
    },
    get max() { return max; },
  };
}

if (opt('trace', null)) {
  const [sx, sz, gx, gz] = opt('trace').split(',').map(Number);
  const sp = argv.includes('--cat') ? Species.Cat : Species.Corgi;
  const sim = await Sim.create({ seed: 1, map: 'the_lot' });
  sim.state.aiConfig = { vehicles: false }; sim.step();
  const b = sim.spawnCharacter({ kind: EntityKind.Bot, team: sp === Species.Cat ? Team.Cats : Team.Corgis, species: sp, cls: 'assault', name: 'trace', x: sx, y: sim.worldData.height(sx, sz) + 0.05, z: sz, yaw: 0 });
  const ai = ensureBrain(b); const line = [];
  for (let i = 0; i < CAP * TICK_HZ; i++) {
    ai.hasGoal = true; ai.goalX = gx; ai.goalZ = gz; ai.waitUntil = sim.tick + 999;
    sim.step(); sim.drainEvents();
    if (i % (TICK_HZ / 2) === 0) line.push(`${(i / TICK_HZ).toFixed(1)}s (${b.pos.x.toFixed(1)}, ${b.pos.y.toFixed(2)}, ${b.pos.z.toFixed(1)})`);
    if (Math.hypot(b.pos.x - gx, b.pos.z - gz) < 1.5) { line.push(`arrived ${(i / TICK_HZ).toFixed(1)} s`); break; }
  }
  console.log(line.join(' | '));
  process.exit(0);
}
const rows = [];
for (const sp of [Species.Corgi, Species.Cat]) {
  for (const [sx, sz] of STARTS) {
    for (const [gx, gz] of GOALS) {
      const sim = await Sim.create({ seed: 1, map: 'the_lot' });
      sim.state.aiConfig = { vehicles: false };
      sim.step();
      const y = sim.worldData.height(sx, sz) + 0.05;
      const b = sim.spawnCharacter({ kind: EntityKind.Bot, team: sp === Species.Cat ? Team.Cats : Team.Corgis, species: sp, cls: 'assault', name: 'ramp', x: sx, y, z: sz, yaw: 0 });
      const ai = ensureBrain(b);
      const meter = stuckMeter(b);
      let arrived = -1; const t0 = sim.time;
      // time spent in the reported pin box (x 64-70, z 82-95: the ramp's east edge, below its top)
      let inBox = 0, maxY = -99, minY = 99;
      for (let i = 0; i < CAP * TICK_HZ && arrived < 0; i++) {
        ai.hasGoal = true; ai.goalX = gx; ai.goalZ = gz; ai.waitUntil = sim.tick + 999;
        sim.step(); sim.drainEvents();
        meter.tick();
        if (b.pos.x > 64 && b.pos.x < 70 && b.pos.z > 82 && b.pos.z < 95) inBox++;
        if (Math.hypot(b.pos.x - gx, b.pos.z - gz) < 1.5) arrived = sim.time - t0;
      }
      const direct = Math.hypot(gx - sx, gz - sz);
      rows.push({ sp: sp === Species.Cat ? 'cat' : 'corgi', from: [sx, sz], to: [gx, gz], direct: +direct.toFixed(1), arrived: arrived < 0 ? null : +arrived.toFixed(1),
        stuckMax: meter.max, pinBoxS: +(inBox / TICK_HZ).toFixed(1), end: [+b.pos.x.toFixed(1), +b.pos.z.toFixed(1)] });
      console.log(JSON.stringify(rows.at(-1)));
      sim.dispose();
    }
  }
}
const fail = rows.filter((r) => r.arrived === null);
const slow = rows.filter((r) => r.arrived !== null && r.arrived > r.direct / 2 + 10);
console.log(JSON.stringify({ summary: true, runs: rows.length, notArrived: fail.length, slow: slow.length,
  worstArrive: Math.max(...rows.map((r) => r.arrived ?? CAP)), stuckMax: Math.max(...rows.map((r) => r.stuckMax)), pinBoxMax: Math.max(...rows.map((r) => r.pinBoxS)) }));

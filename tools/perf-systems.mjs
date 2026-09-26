// Per-system sim cost in a full room (team-deathmatch, bots only), plus Room overhead.
//   npx tsx tools/perf-systems.mjs [--bots 28] [--seconds 30] [--reps 3] [--fast 1|0]
// Measurement discipline for a shared, loaded box (perf lane P1):
//  - one warm-up room first: V8 tiers the Rapier wasm up during the first seconds, which made whichever variant ran
//    first look ~10-20 % slower;
//  - the room is deterministic (seed 1), so every rep does the same work per tick: we keep, per tick index and per
//    system, the minimum over --reps runs (the same best-of approach as tools/qa-budget.mjs), which strips most of
//    the preemption noise from other processes;
//  - --fast 0 turns the terrain fast path off (src/sim/world/build.ts) for A/B.
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { createDefaultSystems } from '../src/sim/systems';
import { TICK_HZ } from '../src/shared/constants';
import { terrainFastPath } from '../src/sim/world/build';
import { loadavg } from 'node:os';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const BOTS = opt('bots', 28), SECONDS = opt('seconds', 30), REPS = Math.max(1, opt('reps', 3));
terrainFastPath.enabled = opt('fast', 1) !== 0;
const WARM = 5 * TICK_HZ, TICKS = SECONDS * TICK_HZ;

async function run(seconds) {
  const cost = new Map();
  const systems = createDefaultSystems().map((s) => ({
    ...s,
    update(sim, dt) { const t0 = performance.now(); s.update(sim, dt); const a = cost.get(s.name); if (a) a.push(performance.now() - t0); else cost.set(s.name, [performance.now() - t0]); },
  }));
  const sim = await Sim.create({ seed: 1, systems });
  const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [Math.ceil(BOTS / 2), Math.floor(BOTS / 2)] });
  const ticks = [];
  for (let t = 0; t < seconds * TICK_HZ; t++) { const t0 = performance.now(); room.tick(); ticks.push(performance.now() - t0); }
  const chars = [...sim.entities.values()].filter((e) => e.char).length;
  return { ticks, cost, chars };
}

await run(15);                                     // warm-up (wasm tier-up, JIT)
const runs = [];
for (let r = 0; r < REPS; r++) runs.push(await run(SECONDS));
const bestOf = (get) => { const n = get(runs[0]).length; const out = new Array(n); for (let i = 0; i < n; i++) out[i] = Math.min(...runs.map((x) => get(x)[i] ?? Infinity)); return out.slice(WARM); };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const ticks = bestOf((x) => x.ticks);
const sysSum = new Array(ticks.length).fill(0);
const rows = [...runs[0].cost.keys()].map((k) => {
  const a = bestOf((x) => x.cost.get(k));
  a.forEach((v, i) => { sysSum[i] += v; });
  return [k, mean(a), pct(a, 0.95)];
}).sort((a, b) => b[1] - a[1]);
const roomOverhead = ticks.map((v, i) => Math.max(0, v - sysSum[i]));
console.log(`chars ${runs[0].chars} · terrain fast path ${terrainFastPath.enabled ? 'on' : 'off'} · best-of-${REPS} per tick · ${TICKS - WARM} ticks · load ${loadavg()[0].toFixed(1)}`);
console.log(`tick p50 ${pct(ticks, 0.5).toFixed(2)} p95 ${pct(ticks, 0.95).toFixed(2)} max ${Math.max(...ticks).toFixed(2)} · mean ${mean(ticks).toFixed(2)} ms`);
for (const [k, m, p] of rows) if (m >= 0.005) console.log(`  ${k.padEnd(18)} mean ${m.toFixed(3)} p95 ${p.toFixed(3)}`);
console.log(`  ${'(room overhead)'.padEnd(18)} mean ${mean(roomOverhead).toFixed(3)} p95 ${pct(roomOverhead, 0.95).toFixed(3)}`);

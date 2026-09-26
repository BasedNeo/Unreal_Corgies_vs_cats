// Lead profiler: per-system sim cost in a full room (team-deathmatch, bots only), plus Room overhead.
//   npx tsx tools/perf-systems.mjs [--bots 28] [--seconds 40]
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { createDefaultSystems } from '../src/sim/systems';
import { TICK_HZ } from '../src/shared/constants';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const BOTS = opt('bots', 28), SECONDS = opt('seconds', 40);
const cost = new Map();
const systems = createDefaultSystems().map((s) => ({ ...s, update(sim, dt) { const t0 = performance.now(); s.update(sim, dt); const a = cost.get(s.name) ?? []; a.push(performance.now() - t0); cost.set(s.name, a); } }));
const sim = await Sim.create({ seed: 1, systems });
const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [Math.ceil(BOTS / 2), Math.floor(BOTS / 2)] });
const ticks = [];
for (let t = 0; t < SECONDS * TICK_HZ; t++) { const t0 = performance.now(); room.tick(); ticks.push(performance.now() - t0); }
const skip = 5 * TICK_HZ; // ignore warmup
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`chars ${[...sim.entities.values()].filter((e) => e.char).length} · tick mean ${mean(ticks.slice(skip)).toFixed(2)} p95 ${pct(ticks.slice(skip), 0.95).toFixed(2)} ms`);
const rows = [...cost.entries()].map(([k, a]) => [k, mean(a.slice(skip)), pct(a.slice(skip), 0.95)]).sort((a, b) => b[1] - a[1]);
for (const [k, m, p] of rows) console.log(`  ${k.padEnd(18)} mean ${m.toFixed(3)} p95 ${p.toFixed(3)}`);

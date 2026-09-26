// Movement cost per tick under character-controller variants (full TDM room of 28 bots).
//   npx tsx tools/perf-kcc.mjs [--seconds 20] [--reps 2]
// A warm-up room runs first and variants are interleaved over --reps rounds (best kept): the first room in a
// process runs the Rapier wasm before V8 tiers it up, which made the old "baseline" row (always first) look ~8-10 %
// slower than every variant (perf lane P1). Measured after that fix, only two rows move materially:
//   - fastPathOff: the terrain fast path (src/sim/world/build.ts) disabled -> every move runs the controller;
//   - noSnap (-17 %), which changes movement behaviour, like noAutostep and offset01: reference only.
// noImpulses is behaviour-neutral (the sim has no rigid bodies) but saves nothing measurable.
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { createDefaultSystems } from '../src/sim/systems';
import { TICK_HZ } from '../src/shared/constants';
import { terrainFastPath } from '../src/sim/world/build';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const SECONDS = opt('seconds', 20), REPS = Math.max(1, opt('reps', 2));
const variants = {
  baseline: { kcc: () => {} },
  fastPathOff: { kcc: () => {}, fast: false },
  noImpulses: { kcc: (k) => k.setApplyImpulsesToDynamicBodies(false) },
  noAutostep: { kcc: (k) => k.disableAutostep() },
  noSnap: { kcc: (k) => k.disableSnapToGround() },
  offset01: { kcc: (k) => k.setOffset(0.01) },
};
async function run(v, seconds) {
  terrainFastPath.enabled = v.fast ?? true;
  let mv = 0, n = 0;
  const systems = createDefaultSystems().map((s) => s.name !== 'movement' ? s : ({ ...s, update(sim, dt) { const t0 = performance.now(); s.update(sim, dt); mv += performance.now() - t0; n++; } }));
  const sim = await Sim.create({ seed: 1, systems });
  v.kcc(sim.kcc);
  const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [14, 14] });
  for (let t = 0; t < seconds * TICK_HZ; t++) { if (t === 5 * TICK_HZ) { mv = 0; n = 0; } room.tick(); }
  terrainFastPath.enabled = true;
  return mv / n;
}
await run(variants.baseline, 10);                  // warm-up
const best = {};
for (let r = 0; r < REPS; r++) {
  const names = Object.keys(variants);
  if (r % 2) names.reverse();
  for (const name of names) best[name] = Math.min(best[name] ?? Infinity, await run(variants[name], SECONDS));
}
for (const [name, ms] of Object.entries(best)) console.log(`${name.padEnd(12)} movement ${ms.toFixed(3)} ms/tick`);

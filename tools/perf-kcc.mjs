// Lead micro-bench: movement cost per character under KCC settings variants (full TDM room of bots).
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { createDefaultSystems } from '../src/sim/systems';
import { TICK_HZ } from '../src/shared/constants';
const variants = {
  baseline: () => {},
  noAutostep: (k) => k.disableAutostep(),
  noSnap: (k) => k.disableSnapToGround(),
  offset01: (k) => k.setOffset(0.01),
  noImpulses: (k) => k.setApplyImpulsesToDynamicBodies(false),
};
for (const [name, fn] of Object.entries(variants)) {
  let mv = 0, n = 0;
  const systems = createDefaultSystems().map((s) => s.name !== 'movement' ? s : ({ ...s, update(sim, dt) { const t0 = performance.now(); s.update(sim, dt); mv += performance.now() - t0; n++; } }));
  const sim = await Sim.create({ seed: 1, systems });
  fn(sim.kcc);
  const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [14, 14] });
  for (let t = 0; t < 25 * TICK_HZ; t++) { if (t === 5 * TICK_HZ) { mv = 0; n = 0; } room.tick(); }
  console.log(`${name.padEnd(12)} movement ${(mv / n).toFixed(3)} ms/tick`);
}

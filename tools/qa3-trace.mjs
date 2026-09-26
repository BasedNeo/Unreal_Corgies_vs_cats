#!/usr/bin/env node
// Q3 verification probe (read-only): per-0.25 s trace of every RC plane (position, AGL, speed, hull, rider and its ride
// phase) plus mount / bail / explode / death / plane-hit events, for one TDM seed between two times (P2-2, bails).
//   npx tsx tools/qa3-trace.mjs <seed> <fromS> <toS>          (B2's 4v4 lineup, soak match config)
//   ROOMFILL=1 npx tsx tools/qa3-trace.mjs <seed> <fromS> <toS>  (room bot fill, shipping match config)
const Q = '../src';
const { Sim } = await import(Q + '/sim/sim.ts');
const { Room } = await import(Q + '/host/room.ts');
const { TICK_HZ } = await import(Q + '/shared/constants.ts');
const seed = Number(process.argv[2] ?? 33), from = Number(process.argv[3] ?? 150), to = Number(process.argv[4] ?? 163);
const L = [[0, 'assault'], [0, 'overwatch'], [0, 'breacher'], [0, 'warden'], [1, 'assault'], [1, 'overwatch'], [1, 'breacher'], [1, 'warden']];
const sim = await Sim.create({ seed });
const ROOMFILL = process.env.ROOMFILL === '1';
const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: ROOMFILL ? [4, 4] : [0, 0] });
if (!ROOMFILL) sim.state.matchConfig = { tdm: { warmup: 3, killLimit: 12, timeLimit: 45, endedHold: 5 } };
if (!ROOMFILL) for (const [t, c] of L) room.addBot(t, c);
const EV = []; const drain0 = sim.drainEvents.bind(sim); sim.drainEvents = () => { const a = drain0(); EV.push(...a); return a; };
for (let i = 0; i < to * TICK_HZ; i++) {
  room.tick();
  const evs = EV.splice(0);
  const t = sim.tick / TICK_HZ;
  if (t < from) continue;
  for (const ev of evs) {
    const x = sim.entities.get(ev.id ?? -1);
    if ((ev.e === 'ability' && ['mount','dismount','bail','boost'].includes(ev.ability)) || ev.e === 'explode' || (ev.e === 'death') || (ev.e === 'hit' && (sim.entities.get(ev.dst)?.plane || sim.entities.get(ev.src)?.seat))) console.log(t.toFixed(2), JSON.stringify(ev), x ? `${x.name ?? ''} k${x.kind}` : '');
  }
  if (sim.tick % 15 === 0) for (const p of sim.entities.values()) if (p.plane) {
    const r = sim.entities.get(p.plane.rider);
    console.log(t.toFixed(2), `plane ${p.id} pos ${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)},${p.pos.z.toFixed(1)} agl ${(p.pos.y - sim.worldData.height(p.pos.x, p.pos.z)).toFixed(1)} v ${Math.hypot(p.vel.x,p.vel.y,p.vel.z).toFixed(1)} hp ${p.health.hp} grounded ${p.plane.grounded} rider ${r ? r.name + ' ' + r.cls + ' hp ' + r.health.hp : '-'} phase ${r?.ai?.tac?.ride?.phase}`);
  }
}

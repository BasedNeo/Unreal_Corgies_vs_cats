// W9 F2 (mode-1, Q4 P2-4): Base Assault pushes use The Lot's lanes. Each push (a rally, then the storm) picks a lane
// with L3's weighted pickLane per (world seed, team, push); its attackers walk the lane's waypoints and gather at its
// enemy-side end, so attacks come down Container Canyon and the Pipeworks too (Q4: 0 bot-seconds there in Base Assault,
// every push ran the Mud). Carriers still take the shortest way home. The West Yard has no lanes: unchanged.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room } from '../../src/host/room';
import { EFlag, EntityKind } from '../../src/shared/types';
import { TICK_HZ } from '../../src/shared/constants';
import { BA_REASON } from '../../src/shared/content/modes';
import { districtAt } from '../../src/shared/world/queries';
import { baseAssaultState, checkBallInvariants } from '../../src/sim/match';
import { lanesFor } from '../../src/sim/ai/lanes';
import { baLaneOf, baRoleOf } from '../../src/sim/ai/base-assault-ai';

const SIDE = new Set(['Container Canyon', 'The Pipeworks']);

/** The soak's stuck rule: wants to move (|input| > 0.5 for 90 % of a 0.5 s window) but moves < 0.25 m. */
function stuckMeter(e: SimEntity) {
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

/** A bot-only 4v4 on The Lot to the horn: captures, the attack runs (a life's stretch in the attack role) and how many
 *  crossed the Canyon or the Pipeworks, the lanes the pushes took, stuck max. */
async function lotMatch(seed: number, seconds: number) {
  const sim = await Sim.create({ seed, map: 'the_lot' });
  sim.state.matchConfig = { baseAssault: { timeLimit: seconds, endedHold: 2, captureLimit: 99 } };
  const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [4, 4] });
  let captures = 0;
  const drain = sim.drainEvents.bind(sim);
  sim.drainEvents = () => { const ev = drain(); for (const x of ev) if (x.e === 'score' && x.reason === BA_REASON.captured) captures++; return ev; };
  const meters = new Map<number, ReturnType<typeof stuckMeter>>();
  const runs = new Map<number, { life: number; side: boolean } | null>();
  let n = 0, side = 0;
  const lanes = new Set<string>();
  const close = (id: number) => { const r = runs.get(id); if (r) { n++; if (r.side) side++; } runs.set(id, null); };
  for (let i = 0; i < (seconds + 6) * TICK_HZ && room.match.phase !== 'ended'; i++) {
    room.tick();
    const bad = checkBallInvariants(sim);
    if (bad.length) throw new Error(bad.join('; '));
    for (const t of [0, 1] as const) { const l = baLaneOf(sim, t).lane; if (l) lanes.add(l); }
    for (const e of sim.entities.values()) {
      if (!e.char || e.kind !== EntityKind.Bot) continue;
      let m = meters.get(e.id);
      if (!m) { m = stuckMeter(e); meters.set(e.id, m); }
      m.tick();
      if (i % 30) continue;
      const attacking = !e.dead && baRoleOf(e) === 'attack' && !(e.flags & EFlag.Carrier);
      const r = runs.get(e.id);
      if (r && (!attacking || r.life !== e.respawnTick)) close(e.id);
      if (!attacking) continue;
      let rr = runs.get(e.id);
      if (!rr) { rr = { life: e.respawnTick, side: false }; runs.set(e.id, rr); }
      if (SIDE.has(districtAt(sim.worldData, e.pos.x, e.pos.z)?.name ?? '')) rr.side = true;
    }
  }
  for (const id of runs.keys()) close(id);
  let stuck = 0;
  for (const m of meters.values()) stuck = Math.max(stuck, m.max);
  room.dispose();
  return { seed, captures, runs: n, side, lanes: [...lanes].sort(), stuck };
}

describe('F2 Base Assault pushes use The Lot\'s lanes (Q4 P2-4)', () => {
  it('every lane\'s enemy-side end is a rally 20-60 m from the enemy stand; the West Yard has no lanes', async () => {
    const sim = await Sim.create({ seed: 1, map: 'the_lot' });
    sim.state.matchConfig = { baseAssault: { warmup: 0.05 } };
    sim.state.room = { mode: 'base-assault' };
    for (let i = 0; i < 12; i++) { sim.step(); sim.drainEvents(); }
    const st = baseAssaultState(sim)!;
    const lanes = lanesFor(sim)!;
    expect(lanes.length).toBeGreaterThanOrEqual(3);
    for (const l of lanes) {
      const ends = [l.pts[l.pts.length - 1], l.pts[0]]; // corgis walk forward (their end is the cats' side), cats backward
      for (const t of [0, 1] as const) {
        const s = st.spots[t === 0 ? 1 : 0].stand, [x, z] = ends[t];
        const d = Math.hypot(s.x - x, s.z - z);
        expect(d, `${l.id} team ${t}`).toBeGreaterThanOrEqual(20);
        expect(d, `${l.id} team ${t}`).toBeLessThanOrEqual(60);
      }
    }
    const wy = await Sim.create({ seed: 1 });
    expect(lanesFor(wy)).toBeNull();
    sim.dispose(); wy.dispose();
  }, 120_000);

  it('two 200 s bot matches on The Lot: >= 25 % of attack runs cross the Canyon or the Pipeworks, pushes take several lanes, captures happen, nobody stuck > 5 s', async () => {
    const res = [await lotMatch(1, 200), await lotMatch(2, 200)];
    console.log(`[f2 lanes] ${res.map((r) => `seed ${r.seed}: captures ${r.captures}, attack runs ${r.runs} (${r.side} via canyon/pipeworks), lanes ${r.lanes.join('+')}, stuck max ${r.stuck} s`).join(' · ')}`);
    const runs = res.reduce((a, r) => a + r.runs, 0), side = res.reduce((a, r) => a + r.side, 0);
    expect(side / runs).toBeGreaterThanOrEqual(0.25);
    expect(new Set(res.flatMap((r) => r.lanes)).size).toBeGreaterThanOrEqual(3);
    expect(res.reduce((a, r) => a + r.captures, 0)).toBeGreaterThanOrEqual(2);
    for (const r of res) expect(r.stuck).toBeLessThanOrEqual(5);
  }, 900_000);
});

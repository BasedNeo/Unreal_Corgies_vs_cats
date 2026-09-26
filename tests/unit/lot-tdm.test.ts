// Wave 8 M2 "The Lot": bots play a 14v14 team deathmatch on it (in-process Room + Sim, like the N1 budget test in
// ai-nav-links.test.ts): 60 s live after the warm-up, twice (the sim is deterministic: best-of-2 per tick filters the
// shared machine's noise). Proves kills happen, no bot is stuck > 5 s (the soak's rule), where the bots fight (lanes
// by district), and the sim tick p95 with 28 characters (<= 3 ms on an idle machine; scaled by the load like N1).
import os from 'node:os';
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room } from '../../src/host/room';
import { districtAt } from '../../src/shared/world/queries';
import { EntityKind } from '../../src/shared/types';

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

describe('The Lot: 14v14 TDM with bots', () => {
  it('kills happen, no bot stuck > 5 s, every lane sees traffic, tick p95 within budget', async () => {
    const WARM = 5 * 60, LIVE = 60 * 60;
    const series: number[][] = [];
    const reports: string[] = [];
    let deaths = 0, stuckMax = 0, stuckWho = '', score: [number, number] = [0, 0];
    const lanes = new Map<string, number>();
    for (let rep = 0; rep < 2; rep++) {
      const sim = await Sim.create({ seed: 8, map: 'the_lot' });
      const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [14, 14] });
      let d = 0;
      const drain = sim.drainEvents.bind(sim);
      sim.drainEvents = () => { const ev = drain(); for (const x of ev) if (x.e === 'death') d++; return ev; };
      const meters = new Map<number, ReturnType<typeof stuckMeter>>();
      const ms: number[] = [];
      for (let i = 0; i < WARM + LIVE; i++) {
        const c0 = process.cpuUsage(), t0 = performance.now();
        room.tick();
        const wall = performance.now() - t0, c = process.cpuUsage(c0);
        if (i >= 10 * 60) ms.push(Math.min(wall, (c.user + c.system) / 1000));   // after the start (nav build, first plans)
        for (const e of sim.entities.values()) {
          if (!e.char || e.kind !== EntityKind.Bot) continue;
          let m = meters.get(e.id);
          if (!m) { m = stuckMeter(e); meters.set(e.id, m); }
          m.tick();
          if (rep === 0 && i % 30 === 0 && !e.dead) {
            const k = districtAt(sim.worldData, e.pos.x, e.pos.z)?.name ?? 'open ground';
            lanes.set(k, (lanes.get(k) ?? 0) + 0.5);
          }
        }
      }
      let chars = 0;
      for (const e of sim.entities.values()) if (e.char) chars++;
      expect(chars).toBe(28);
      for (const [id, m] of meters) if (m.max > stuckMax) { stuckMax = m.max; stuckWho = sim.entities.get(id)?.name ?? String(id); }
      const match = (sim.state as { match?: { score: [number, number] } }).match;
      score = match?.score ?? score;
      deaths = rep === 0 ? d : deaths;
      reports.push(`rep ${rep}: deaths ${d}, score ${score.join(':')}`);
      series.push(ms);
      sim.dispose();
    }
    const best = series[0].map((v, i) => Math.min(v, series[1][i])).sort((a, b) => a - b);
    const p95 = best[Math.floor(best.length * 0.95)], p50 = best[best.length >> 1];
    const load = os.loadavg()[0];
    const byLane = [...lanes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · ');
    console.log(`[lot-tdm] 14v14 on The Lot, 60 s live: ${reports.join(' | ')} · stuck max ${stuckMax} s (${stuckWho}) · tick p50 ${p50.toFixed(2)} · p95 ${p95.toFixed(2)} · max ${best[best.length - 1].toFixed(2)} ms · load ${load.toFixed(1)} on ${os.cpus().length} cores\n[lot-tdm] bot-seconds by district: ${byLane}`);
    expect(deaths).toBeGreaterThan(5);
    expect(stuckMax).toBeLessThanOrEqual(5);
    for (const lane of ['Container Canyon', 'The Mud', 'The Pipeworks']) expect(lanes.get(lane) ?? 0, lane).toBeGreaterThan(0);
    expect(p95).toBeLessThan(3 * Math.max(1, load / Math.max(1, os.cpus().length)));
  }, 600_000);
});

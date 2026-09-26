// core-rush: fair pad placement on the real West Yard, capture timing, contest, neutralize-then-take,
// hold scoring, win and restart.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Team, Species, EntityKind, EFlag, type TeamId } from '../../src/shared/types';
import type { GameEvent, MatchState } from '../../src/shared/protocol';
import { createWorldData } from '../../src/shared/world/world-data';
import { coreRushPads } from '../../src/sim/match';
import { simNavGrid } from '../../src/sim/ai';
import { cellIndex } from '../../src/sim/ai/nav';
import { CAPTURE_SCALE, CORE_RUSH } from '../../src/shared/content/modes';

async function rushSim(over: Record<string, number> = {}, seed = 9): Promise<Sim> {
  const sim = await Sim.create({ seed, world: createWorldData(seed) });
  sim.state.room = { mode: 'core-rush' };
  sim.state.matchConfig = { coreRush: { warmup: 0.1, ...over } };
  return sim;
}

function run(sim: Sim, seconds: number, until?: () => boolean): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    sim.step();
    out.push(...sim.drainEvents());
    if (until?.()) break;
  }
  return out;
}

function standOn(sim: Sim, team: TeamId, padIndex: number, dx = 0): SimEntity {
  const pad = coreRushPads(sim).find((p) => p.index === padIndex)!;
  const e = sim.spawnCharacter({ team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls: 'assault', name: `t${team}`, x: pad.x + dx, y: pad.y + 0.1, z: pad.z, yaw: 0 });
  return e;
}

const match = (sim: Sim) => sim.state.match as MatchState;
const pad = (sim: Sim, i: number) => coreRushPads(sim).find((p) => p.index === i)!;

describe('core-rush', () => {
  it('places three fair pads on open, reachable lawn', async () => {
    const sim = await rushSim();
    run(sim, 0.05);
    const pads = coreRushPads(sim);
    expect(pads.map((p) => p.index)).toEqual([0, 1, 2]);
    const g = simNavGrid(sim)!;
    const base = (t: TeamId) => {
      const s = sim.worldData.spawns.filter((p) => p.team === t);
      return { x: s.reduce((a, p) => a + p.x, 0) / s.length, z: s.reduce((a, p) => a + p.z, 0) / s.length };
    };
    const b0 = base(Team.Corgis), b1 = base(Team.Cats);
    for (const p of pads) {
      const c = cellIndex(g, p.x, p.z);
      expect(g.walk[c]).toBe(1);
      expect(g.region[c]).toBe(g.mainRegion);
      const d0 = Math.hypot(p.x - b0.x, p.z - b0.z), d1 = Math.hypot(p.x - b1.x, p.z - b1.z);
      expect(Math.abs(d0 - d1) / Math.max(d0, d1)).toBeLessThan(0.2); // neither base is much closer
      const s = sim.toState(sim.entities.get(p.id)!);
      expect(s.kind).toBe(EntityKind.Zone);
      expect(s.team).toBe(Team.Neutral);
    }
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(Math.hypot(pads[i].x - pads[j].x, pads[i].z - pads[j].z)).toBeGreaterThan(15);
  });

  it('one player takes a neutral pad in captureTime; held pads trickle points; the take is announced', async () => {
    const sim = await rushSim();
    run(sim, 0.2); // warmup over, pads placed
    expect(match(sim).phase).toBe('live');
    standOn(sim, Team.Corgis, 1);
    let t = 0;
    const evs: GameEvent[] = [];
    while (pad(sim, 1).owner !== Team.Corgis && t < 600) { evs.push(...run(sim, 1 / 60)); t++; }
    expect(t / 60).toBeGreaterThan(CORE_RUSH.captureTime - 0.3);
    expect(t / 60).toBeLessThan(CORE_RUSH.captureTime + 0.5);
    expect(evs.some((e) => e.e === 'score' && e.reason === 'took pad B' && e.pts === CORE_RUSH.captureBonus)).toBe(true);
    const s0 = match(sim).score[0];
    run(sim, 10);
    expect(match(sim).score[0] - s0).toBeGreaterThanOrEqual(9); // 1 pad × 1 pt/s
    expect(match(sim).score[0] - s0).toBeLessThanOrEqual(11);
    expect(sim.toState(sim.entities.get(pad(sim, 1).id)!).hp).toBe(CAPTURE_SCALE);
  });

  it('both teams on a pad freeze it (contested); an enemy pad takes twice as long (neutralize, then take)', async () => {
    const sim = await rushSim();
    run(sim, 0.2);
    const dog = standOn(sim, Team.Corgis, 0);
    run(sim, CORE_RUSH.captureTime + 0.3);
    expect(pad(sim, 0).owner).toBe(Team.Corgis);
    const cat = standOn(sim, Team.Cats, 0, 1.5);
    run(sim, 3);
    expect(pad(sim, 0).contested).toBe(true);
    expect(pad(sim, 0).owner).toBe(Team.Corgis);
    expect(sim.toState(sim.entities.get(pad(sim, 0).id)!).flags & EFlag.Busy).toBeTruthy();
    sim.removeEntity(dog.id);
    let t = 0;
    while (pad(sim, 0).owner !== Team.Cats && t < 1200) { run(sim, 1 / 60); t++; }
    expect(t / 60).toBeGreaterThan(2 * CORE_RUSH.captureTime - 0.5);
    expect(t / 60).toBeLessThan(2 * CORE_RUSH.captureTime + 0.8);
    expect(pad(sim, 0).contested).toBe(false);
    void cat;
  });

  it('first to the score limit wins; the restart puts every pad back to neutral', async () => {
    const sim = await rushSim({ scoreLimit: 12, endedHold: 1 });
    run(sim, 0.2);
    standOn(sim, Team.Cats, 2);
    run(sim, 30, () => match(sim).phase === 'ended');
    expect(match(sim).phase).toBe('ended');
    expect(match(sim).winner).toBe(Team.Cats);
    run(sim, 1.5, () => match(sim).phase === 'warmup');
    expect(match(sim).phase).toBe('warmup');
    expect(match(sim).score).toEqual([0, 0]);
    expect(coreRushPads(sim).every((p) => p.owner === Team.Neutral && p.progress === 0)).toBe(true);
    expect(coreRushPads(sim).length).toBe(3); // same pads, not duplicated
  });
});

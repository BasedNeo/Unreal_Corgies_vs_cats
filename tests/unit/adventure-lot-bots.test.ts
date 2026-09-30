// W10 A7 chapter 7 "Night Shift at The Lot" played by a bot squad (no human), A1/A2's pattern on The Lot: it completes
// inside the silver par on at least 4 of 5 seeds (the best run inside the gold par), every step completes without the
// fail-forward grace (the kart is really driven home), it replays identically, and each beat is done the chapter's way:
// a pup takes the siren fuse, the pups carry off the four stash balls, the scaffold is held, a pup drives the kart home.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { createDefaultSystems } from '../../src/sim/systems';
import { adventureSystems, adventureState } from '../../src/sim/adventure';
import { EFlag, EntityKind, Team } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import { TICK_HZ } from '../../src/shared/constants';
import { SILVER_RATIO, STRICT_GRACE_SECONDS, chapterById } from '../../src/shared/content/chapters';

function withAdventure() {
  const sys = createDefaultSystems();
  return sys.some((s) => s.name === 'adventure') ? sys : [...sys, ...adventureSystems()];
}

const def = chapterById('night_shift')!;

interface Run {
  complete: boolean; time: number; medal: string; wipes: number; tick: number; counters: Record<string, number>;
  /** Seconds spent on each step (live steps only). */
  steps: number[];
  digest: string;
}
interface Seen { pickups: Array<{ item: string; bot: boolean }>; kartDriver: string | null; heavy: boolean }

async function botRun(seed: number): Promise<{ run: Run; seen: Seen }> {
  const sim = await Sim.create({ seed, map: def.map, systems: withAdventure() });
  const room = new Room(sim, { mode: 'adventure', chapter: def.id, botsPerTeam: [4, 0] });
  const seen: Seen = { pickups: [], kartDriver: null, heavy: false };
  const evs: GameEvent[] = [];
  const drain = sim.drainEvents.bind(sim);
  sim.drainEvents = () => { const a = drain(); evs.push(...a); return a; };
  const steps: number[] = [];
  let step = -1, since = 0;
  for (let i = 0; i < def.par * SILVER_RATIO * 1.5 * TICK_HZ; i++) {
    room.tick();
    for (const e of evs.splice(0)) {
      if (e.e !== 'pickup') continue;
      const who = sim.entities.get(e.id);
      seen.pickups.push({ item: e.item, bot: who?.kind === EntityKind.Bot });
    }
    const st = adventureState(sim)!;
    if (st.phase === 'live' && st.step !== step) {
      if (step >= 0) steps[step] = (steps[step] ?? 0) + (sim.tick - since) / TICK_HZ;
      step = st.step; since = sim.tick;
    }
    if (st.phase === 'live' && st.step === 3 && !seen.heavy) seen.heavy = [...sim.entities.values()].some((e) => e.name.startsWith('Heavy') && !e.dead);
    if (st.phase === 'live' && st.step === def.steps.length - 1) {
      // who is driving the chapter's kart right now (vehicle snapshot convention: weapon = the rider's id)
      for (const v of sim.entities.values()) {
        if (v.kind !== EntityKind.Vehicle || v.weapon < 0) continue;
        const d = sim.entities.get(v.weapon);
        if (d && d.team === Team.Corgis && d.kind === EntityKind.Bot && d.flags & EFlag.Mounted) seen.kartDriver = d.cls ?? '?';
      }
    }
    if (st.phase === 'complete') { if (step >= 0) steps[step] = (steps[step] ?? 0) + (sim.tick - since) / TICK_HZ; break; }
  }
  const st = adventureState(sim)!;
  const digest = sim.snapshotEntities().filter((s) => s.kind === EntityKind.Bot || s.kind === EntityKind.Player)
    .map((s) => `${s.id}:${s.x.toFixed(3)}:${s.z.toFixed(3)}:${s.hp}`).join('|');
  const run: Run = {
    complete: st.phase === 'complete', time: st.time, medal: st.medal, wipes: st.wipes, tick: sim.tick, counters: { ...st.counters },
    steps: steps.map((s) => Math.round(s * 10) / 10), digest,
  };
  room.dispose();
  return { run, seen };
}

describe('chapter 7 "Night Shift at The Lot" played by a bot squad (no human)', () => {
  it('completes inside the silver par on at least 4 of 5 seeds, the best inside the gold par, each step without the grace', async () => {
    const runs: Run[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const { run, seen } = await botRun(seed);
      runs.push(run);
      console.log(`[a7] night_shift bots seed ${seed}: ${run.complete ? `${run.time} s (${run.medal})` : `NOT complete (step ${run.steps.length})`} vs par ${def.par} s; wipes ${run.wipes}, alarms ${run.counters.alarms ?? 0}; steps ${run.steps.map((s, i) => `${def.steps[i].id} ${s}`).join(' · ')}; kart driver ${seen.kartDriver}`);
      if (!run.complete) continue;
      expect(run.steps.length).toBe(def.steps.length);
      for (const s of run.steps) expect(s).toBeLessThan(STRICT_GRACE_SECONDS); // nobody waited out the fail-forward grace
      // the chapter's way: a pup takes the siren fuse, pups carry the four stash balls off, the Heavy comes for the
      // scaffold, and a pup drives the kart home (a bot-only squad keeps the vehicle rule: B2)
      expect(seen.pickups.filter((p) => p.item === 'siren_fuse' && p.bot)).toHaveLength(1);
      expect(seen.pickups.filter((p) => p.item === 'tennis_ball' && p.bot)).toHaveLength(4);
      expect(run.counters.tennis_ball).toBe(4);
      expect(seen.heavy).toBe(true);
      expect(seen.kartDriver).not.toBeNull();
    }
    const inSilver = runs.filter((r) => r.complete && r.time <= def.par * SILVER_RATIO);
    expect(inSilver.length).toBeGreaterThanOrEqual(4);
    expect(Math.min(...runs.filter((r) => r.complete).map((r) => r.time))).toBeLessThanOrEqual(def.par);
  }, 900_000);

  it('replays identically with the same seed', async () => {
    const a = await botRun(1), b = await botRun(1);
    expect(b.run).toEqual(a.run);
  }, 600_000);
});

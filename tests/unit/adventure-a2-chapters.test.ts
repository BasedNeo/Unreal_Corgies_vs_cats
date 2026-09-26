// A2 on the real West Yard: chapters 3–6 played by a bot squad (no human), A1's pattern — each completes inside
// 2× par, plays out identically on a second run with the same seed, and shows its featured kit at work:
//   3 The Garage Job     a Breacher pup breaks the breach wall; pups wreck the tuna stacks (shots and lobs)
//   4 Laser Pointer      Overwatch pups deal most of the damage to Madame Pointillé
//   5 The Porch Siege    four barricades go up; Warden pups raise Squeak Barriers of their own in the siege
//   6 The Last Ball      Skyraider pups Ear Glide on the way; the Vac-Tank goes down
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { createDefaultSystems } from '../../src/sim/systems';
import { adventureSystems, adventureState } from '../../src/sim/adventure';
import { drainBreaks, type BreakRecord } from '../../src/sim/destruct';
import { EntityKind, Team } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import { TICK_HZ } from '../../src/shared/constants';
import { BARRICADE_HP, chapterById } from '../../src/shared/content/chapters';

function withAdventure() {
  const sys = createDefaultSystems();
  return sys.some((s) => s.name === 'adventure') ? sys : [...sys, ...adventureSystems()];
}

interface Run {
  complete: boolean; time: number; medal: string; wipes: number; tick: number; counters: Record<string, number>;
  /** Seconds spent on each step (live steps only). */
  steps: number[];
  digest: string;
}
interface Seen { events: GameEvent[]; breaks: BreakRecord[]; cls: Map<number, string | null>; kinds: Map<number, number> }

async function botRun(chapter: string, seed = 1): Promise<{ run: Run; seen: Seen }> {
  const sim = await Sim.create({ seed, systems: withAdventure() });
  const room = new Room(sim, { mode: 'adventure', chapter, botsPerTeam: [4, 0] });
  const seen: Seen = { events: [], breaks: [], cls: new Map(), kinds: new Map() };
  const drain = sim.drainEvents.bind(sim);
  sim.drainEvents = () => { const a = drain(); seen.events.push(...a); return a; };
  const def = chapterById(chapter)!;
  const steps: number[] = [];
  let step = -1, since = 0;
  for (let i = 0; i < def.par * 2 * TICK_HZ + 30 * TICK_HZ; i++) {
    room.tick();
    for (const b of drainBreaks(sim)) seen.breaks.push(b);
    for (const e of sim.entities.values()) if (e.char) { seen.cls.set(e.id, e.cls); seen.kinds.set(e.id, e.kind); }
    const st = adventureState(sim)!;
    if (st.phase === 'live' && st.step !== step) {
      if (step >= 0) steps[step] = (steps[step] ?? 0) + (sim.tick - since) / TICK_HZ;
      step = st.step; since = sim.tick;
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

function report(chapter: string, r: Run): void {
  const def = chapterById(chapter)!;
  const longest = r.steps.indexOf(Math.max(...r.steps));
  console.log(`[a2] ${chapter} bots: ${r.time} s vs par ${def.par} s (${r.medal}), wipes ${r.wipes}; steps ${r.steps.map((s, i) => `${def.steps[i].id} ${s}`).join(' · ')}; longest: ${def.steps[longest]?.id}`);
}

const squadOf = (seen: Seen, id: number) => seen.kinds.get(id) === EntityKind.Bot && seen.cls.has(id);

describe('chapters 3–6 played by a bot squad (no human)', () => {
  for (const chapter of ['garage_job', 'laser_dawn', 'porch_siege', 'last_ball'] as const) {
    it(`${chapter}: completed inside 2× par, identically twice, with its featured kit at work`, async () => {
      const def = chapterById(chapter)!;
      const { run, seen } = await botRun(chapter);
      report(chapter, run);
      expect(run.complete).toBe(true);
      expect(run.time).toBeLessThanOrEqual(def.par * 2);
      expect(run.steps.length).toBe(def.steps.length);
      const ev = seen.events;
      if (chapter === 'garage_job') {
        const wall = seen.breaks.find((b) => b.tag === 'garage_breach_wall')!;
        expect(seen.cls.get(wall.by)).toBe('breacher'); // a Dig Charge at the boards
        expect(seen.breaks.filter((b) => b.tag === 'tuna_stack').length).toBe(4);
        expect(seen.breaks.filter((b) => b.tag !== 'crate_stack').every((b) => b.byTeam === Team.Corgis)).toBe(true);
        expect(run.counters['broken:tuna_stack']).toBe(4);
      } else if (chapter === 'laser_dawn') {
        const boss = ev.find((e) => e.e === 'ability' && e.ability === 'boss_intro')!;
        const dmg: Record<string, number> = {};
        for (const e of ev) if (e.e === 'hit' && e.dst === (boss as { id: number }).id) { const c = seen.cls.get(e.src) ?? '?'; dmg[c] = (dmg[c] ?? 0) + e.dmg; }
        const total = Object.values(dmg).reduce((a, b) => a + b, 0);
        console.log(`[a2] laser_dawn damage to Madame Pointillé by kit: ${JSON.stringify(dmg)}`);
        expect(dmg.overwatch / total).toBeGreaterThan(0.5);
        expect(run.counters['kills:boss']).toBe(1);
      } else if (chapter === 'porch_siege') {
        const walls = ev.filter((e) => e.e === 'ability' && e.ability === 'squeak_barrier' && Math.abs(e.z + 68) < 0.01);
        const own = ev.filter((e) => e.e === 'ability' && e.ability === 'squeak_barrier' && Math.abs(e.z + 68) >= 0.01 && squadOf(seen, e.id) && seen.cls.get(e.id) === 'warden');
        console.log(`[a2] porch_siege: ${walls.length} barricades (${BARRICADE_HP} hp each), ${own.length} Squeak Barriers raised by Warden pups`);
        expect(walls.length).toBe(4);
        expect(own.length).toBeGreaterThanOrEqual(1);
        expect(run.counters['kills:wave3']).toBeGreaterThanOrEqual(1);
      } else {
        const glides = ev.filter((e) => e.e === 'ability' && e.ability === 'ear_glide' && squadOf(seen, e.id));
        console.log(`[a2] last_ball: ${glides.length} Ear Glides by Skyraider pups`);
        expect(glides.length).toBeGreaterThanOrEqual(3);
        expect(glides.every((e) => seen.cls.get((e as { id: number }).id) === 'skyraider')).toBe(true);
        expect(run.counters['kills:boss']).toBe(1);
      }
      const again = await botRun(chapter);
      expect(again.run).toEqual(run);
    }, 400000);
  }
});

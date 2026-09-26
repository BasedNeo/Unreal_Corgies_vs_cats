// A2's bot hook for props (brain.ts propShot, tactics.ts propTarget): in an adventure `destroy` step, with nobody to
// fight, a bot shoots the step's destructible when its weapon can hurt it — hitscan from where it first has it in
// sight, an explosive lob from outside its own splash (6.5 m) — instead of walking up and waiting on a charge fuse.
// Outside a destroy step (any other mode) no bot ever picks a prop target.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { createDefaultSystems } from '../../src/sim/systems';
import { adventureSystems, adventureState } from '../../src/sim/adventure';
import { drainBreaks, destructiblesByTag, type BreakRecord } from '../../src/sim/destruct';
import { EntityKind, Team, type ClassId } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import { TICK_HZ } from '../../src/shared/constants';
import type { ChapterDef } from '../../src/shared/content/chapters';

function withAdventure() {
  const sys = createDefaultSystems();
  return sys.some((s) => s.name === 'adventure') ? sys : [...sys, ...adventureSystems()];
}

/** One pup of `kit`, one destroy step: break a yard crate stack (the nearest is ~18 m from the start). */
async function crateRun(kit: ClassId): Promise<{ breaks: BreakRecord[]; pupId: number; closest: number; fires: number; charges: number; complete: boolean; time: number }> {
  const def: ChapterDef = {
    id: 'crate_test', index: 9, title: 'Crates', district: 'West Yard', cls: kit, intro: ['a', 'b'], outro: ['c', 'd'], squad: 1,
    start: { x: 50, z: -40, yaw: 0 }, par: 60, pups: [kit],
    steps: [{ id: 'crate', text: 'Break a crate stack', trigger: { type: 'destroy', params: { tag: 'crate_stack', count: 1 } } }],
  };
  const sim = await Sim.create({ seed: 2, systems: withAdventure() });
  sim.state.adventureConfig = { chapter: def, briefing: 0.1, briefingWait: 0.1 };
  const room = new Room(sim, { mode: 'adventure', chapter: 'crate_test', botsPerTeam: [1, 0] });
  const evs: GameEvent[] = [];
  const drain = sim.drainEvents.bind(sim);
  sim.drainEvents = () => { const a = drain(); evs.push(...a); return a; };
  const breaks: BreakRecord[] = [];
  const pupId = [...room.players.values()][0].entity;
  let closest = Infinity;
  const crate = destructiblesByTag(sim, 'crate_stack');
  for (let i = 0; i < 60 * TICK_HZ && adventureState(sim)?.phase !== 'complete'; i++) {
    room.tick();
    breaks.push(...drainBreaks(sim));
    const pup = sim.entities.get(pupId)!;
    const live = adventureState(sim)?.phase === 'live';
    if (live) for (const c of crate) if (!c.dsx!.broken) closest = Math.min(closest, Math.hypot(c.dsx!.def.cx - pup.pos.x, c.dsx!.def.cz - pup.pos.z));
  }
  const st = adventureState(sim)!;
  const out = {
    breaks, pupId, closest, complete: st.phase === 'complete', time: st.time,
    fires: evs.filter((e) => e.e === 'fire' && e.id === pupId).length,
    charges: evs.filter((e) => e.e === 'ability' && e.id === pupId && e.ability === 'dig_charge').length,
  };
  room.dispose();
  return out;
}

describe('bots shoot adventure props (A2)', () => {
  it('a rifle pup shoots the crate stack from a standoff until it breaks (no charge, no walking up to it)', async () => {
    const r = await crateRun('assault');
    console.log(`[ai-props] assault: crate down at ${r.time} s, ${r.fires} shots, closest ${r.closest.toFixed(1)} m`);
    expect(r.complete).toBe(true);
    expect(r.breaks[0].by).toBe(r.pupId);
    expect(r.fires).toBeGreaterThan(3);
    expect(r.closest).toBeGreaterThan(3);
    expect(r.time).toBeLessThan(20);
  }, 60000);

  it('a mortar pup lobs from outside its own splash (6.5 m)', async () => {
    const r = await crateRun('breacher');
    console.log(`[ai-props] breacher: crate down at ${r.time} s, ${r.fires} lobs, closest ${r.closest.toFixed(1)} m`);
    expect(r.complete).toBe(true);
    expect(r.breaks[0].by).toBe(r.pupId);
    expect(r.charges).toBe(0);
    expect(r.closest).toBeGreaterThan(6);
  }, 60000);

  it('outside an adventure destroy step no bot ever picks a prop target', async () => {
    const sim = await Sim.create({ seed: 3, systems: createDefaultSystems() });
    const room = new Room(sim, { mode: 'yard-skirmish', botsPerTeam: [3, 3] });
    let props = 0;
    for (let i = 0; i < 25 * TICK_HZ; i++) {
      room.tick();
      for (const e of sim.entities.values()) if (e.kind === EntityKind.Bot && e.team === Team.Corgis && e.ai && e.ai.tac.prop >= 0) props++;
    }
    expect(props).toBe(0);
    room.dispose();
  }, 60000);
});

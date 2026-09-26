// OWNER: combat lane (cat AI). Bots write InputCmds into their entity each tick (order 100), through
// the same authority path as human input. Every EntityKind.Bot character gets a brain (room
// team-fill bots of both species get a profile from their class kit; wave cats get an archetype).
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { think, ensureBrain, isAiControlled, type AiContext } from './brain';
import { navGridFor, pathStats } from './nav';

export { applyArchetype, createBrain, think, type AiState, type AiMode } from './brain';
export { ARCHETYPES, archetypeForClass, type Archetype, type ArchetypeId } from './archetypes';
export { navGridFor, buildNavGrid, findPath, lineWalkable, isWalkable, nearestWalkable, cellX, cellZ, type NavGrid } from './nav';

/** Per-tick AI cost, readable by soaks/debug tools. */
export interface AiPerf { ms: number; bots: number; searches: number; navBuildMs: number }

const contexts = new WeakMap<Sim, AiContext>();

function contextOf(sim: Sim): AiContext {
  let c = contexts.get(sim);
  if (!c) { c = { grid: null, chars: [], pathBudget: 0 }; contexts.set(sim, c); }
  return c;
}

/** The nav grid for a sim (built on first use after the first physics step), or null before that. */
export function simNavGrid(sim: Sim): AiContext['grid'] {
  return contextOf(sim).grid;
}

export const aiSystem: SimSystem = {
  name: 'ai',
  order: 100,
  update(sim, dt) {
    const t0 = performance.now();
    const ctx = contextOf(sim);
    const perf = (sim.state.aiPerf as AiPerf | undefined) ?? { ms: 0, bots: 0, searches: 0, navBuildMs: 0 };
    // Rapier's query structures exist only after the first world.step() (physics system, tick 0).
    if (!ctx.grid && sim.tick >= 1) { ctx.grid = navGridFor(sim); perf.navBuildMs = ctx.grid.buildMs; }
    ctx.pathBudget = 2;
    const chars: SimEntity[] = ctx.chars;
    chars.length = 0;
    for (const e of sim.entities.values()) if (e.char && !e.dead) chars.push(e);
    const s0 = pathStats.searches;
    let bots = 0;
    for (const e of sim.entities.values()) {
      if (!isAiControlled(e)) continue;
      const ai = ensureBrain(e);
      think(sim, e, ai, ctx, dt);
      bots++;
    }
    perf.ms = performance.now() - t0;
    perf.bots = bots;
    perf.searches = pathStats.searches - s0;
    sim.state.aiPerf = perf;
  },
};

export function aiSystems(): SimSystem[] {
  return [aiSystem];
}

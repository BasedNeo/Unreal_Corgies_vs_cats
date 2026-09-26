// The interaction system (order 150, next to the vehicle lane's terminal system):
//   tick 0     place Ordnance Terminals (runtime sites), pickup spots (cores + kibble) and the objective beacon
//   match      watches sim.state.match: live → schedule cores / run the objective chain; ended → buffs end,
//              cores go dark, the chain freezes; restart (new MatchState / ended → warmup) → everything resets
//   per tick   buffs (expiry, death, fire-rate/ability drains before combat 400/450) · pickup refills and
//              touches · objective chain triggers
// Kit swaps are not a tick step: the Room calls trySwapKit() when a `{t:'class'}` message arrives.
import type { Sim, SimSystem } from '../sim';
import type { MatchState } from '../../shared/protocol';
import { TERMINALS } from '../../shared/content/terminals';
import { pickupLayoutFor } from '../../shared/content/pickups';
import { chainsFor } from '../../shared/content/objectives';
import { clearBuffs, stepBuffs } from './buffs';
import { placeOrdnanceTerminals } from './ordnance';
import { placePickups, resetPickups, scheduleCores, stepPickups } from './pickups';
import { initObjectives, resetObjectives, stepObjectives } from './objectives';
import { interactConfig, interactRuntime, roomMode, type InteractRuntime } from './state';
import type { KeepOut } from './sites';

/** Should this sim run the interaction layer? (config override, else the Room's match mode). */
export function interactEnabledFor(sim: Sim): boolean {
  const cfg = interactConfig(sim);
  if (cfg.auto !== undefined) return cfg.auto;
  const mode = roomMode(sim);
  return mode !== undefined && TERMINALS.ordnance_terminal.modes.includes(mode);
}

function place(sim: Sim, rt: InteractRuntime): void {
  const cfg = interactConfig(sim);
  rt.placed = true;
  rt.enabled = interactEnabledFor(sim);
  if (!rt.enabled) return;
  rt.parts = { terminals: cfg.terminals ?? true, cores: cfg.cores ?? true, kibble: cfg.kibble ?? true, objectives: cfg.objectives ?? true };
  const layout = cfg.layout ?? pickupLayoutFor(sim.worldData.name);
  const mode = roomMode(sim) === 'boss-rush' ? 'yard-skirmish' : roomMode(sim) ?? '';
  const chain = cfg.chain ?? chainsFor(sim.worldData.name, mode)[0] ?? null;
  // Keep kiosks clear of pickups and objective points so one Interact press never means two things.
  const avoid: KeepOut[] = [];
  for (const s of [...(layout?.cores ?? []), ...(layout?.kibble ?? [])]) avoid.push({ x: s.x, z: s.z, r: 4 });
  for (const st of chain?.steps ?? []) avoid.push({ x: st.trigger.params.x, z: st.trigger.params.z, r: st.trigger.params.radius + 4 });
  if (rt.parts.terminals) rt.terminals = placeOrdnanceTerminals(sim, avoid).map((e) => e.id);
  if (layout) { rt.pickupEnts = placePickups(sim, rt, layout); rt.pickups = rt.pickupEnts.map((e) => e.id); }
  if (rt.parts.objectives && chain) initObjectives(sim, rt, chain);
}

const MATCH_MODES = ['yard-skirmish', 'team-deathmatch', 'boss-rush'];

/** The match phase ('live' when no match system runs this mode; 'warmup' until a match mode's state exists). */
function matchPhase(sim: Sim): { phase: string; ref: unknown } {
  const ms = sim.state.match as MatchState | undefined;
  if (ms) return { phase: ms.phase, ref: ms };
  return { phase: MATCH_MODES.includes(roomMode(sim) ?? '') ? 'warmup' : 'live', ref: undefined };
}

/** New match (restart) or match over: clean slate for everything match-scoped. */
function resetMatch(sim: Sim, rt: InteractRuntime): void {
  for (const e of sim.entities.values()) if (e.buffs?.length) clearBuffs(e);
  resetPickups(sim, rt);
  resetObjectives(sim, rt);
}

export const interactSystem: SimSystem = {
  name: 'interact',
  order: 150,
  update(sim, dt) {
    const rt = interactRuntime(sim);
    if (!rt.placed) place(sim, rt);
    if (!rt.enabled) return;
    const { phase, ref } = matchPhase(sim);
    const restarted = (rt.matchRef !== undefined && ref !== rt.matchRef) || (rt.lastPhase === 'ended' && phase !== 'ended');
    const ended = phase === 'ended' && rt.lastPhase !== 'ended';
    if (restarted || ended) resetMatch(sim, rt);
    rt.matchRef = ref;
    rt.lastPhase = phase;
    const live = phase === 'live';
    if (live && !rt.coresScheduled && rt.parts.cores) scheduleCores(sim, rt);
    stepBuffs(sim, dt);
    stepPickups(sim, rt, dt, live);
    stepObjectives(sim, rt, dt, phase);
  },
};

export function interactSystems(): SimSystem[] {
  return [interactSystem];
}

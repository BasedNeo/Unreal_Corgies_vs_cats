// Objective chain runner (MASTER_PLAN §13 data: src/shared/content/objectives.ts). Steps run in order while
// the match is live; the runner writes plain data to `sim.state.objective` (ObjectiveState: the lead folds
// its `text` into MatchState.objective and drains its points into MatchState.score, see docs/handoff/S1.md)
// and drives one beacon entity (EntityKind.Prop) so clients can draw the marker, the hold ring and the prompt.
// Resets on match restart. Never edits the match system's state.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { pressed } from '../entity';
import { Anim, CLASS_IDS, EFlag, EntityKind, Team, type TeamId } from '../../shared/types';
import { Btn, emptyInput } from '../../shared/input';
import { objectiveChainIndex, type ObjectiveChain, type ObjectiveDef } from '../../shared/content/objectives';
import { creditRoster, type InteractRuntime } from './state';

/** Plain objective state in `sim.state.objective` (read by the lead's match/HUD fold). */
export interface ObjectiveState {
  chain: string;
  team: TeamId;
  /** -1 = not started (warmup / not live), 0..total-1 = current step, total = chain complete. */
  step: number;
  total: number;
  /** Current step id ('' when none). */
  id: string;
  /** Ready-to-show HUD text ('' = nothing to show). */
  text: string;
  /** Hold progress 0..1 (other step types: 0). */
  progress: number;
  contested: boolean;
  /** Current target point (ground under the marker). */
  x: number; y: number; z: number;
  /** Team points earned but not yet folded into MatchState.score (drain with `takeObjectiveScore`). */
  pendingScore: [number, number];
  /** Team points earned this match. */
  score: [number, number];
  /** Seconds the completion text stays up. */
  doneTimer: number;
}

export function objectiveState(sim: Sim): ObjectiveState | null {
  return (sim.state.objective as ObjectiveState | undefined) ?? null;
}

/** Take the objective points not yet added to MatchState.score (the lead's fold calls this every tick). */
export function takeObjectiveScore(sim: Sim): [number, number] {
  const st = objectiveState(sim);
  if (!st) return [0, 0];
  const out: [number, number] = [st.pendingScore[0], st.pendingScore[1]];
  st.pendingScore[0] = 0; st.pendingScore[1] = 0;
  return out;
}

/**
 * Suggested MatchState.objective text: the wave/match text with the current objective appended
 * ("Wave 2/5 — 6 cats left · ▶ Hold the trampoline 12/20 s"). Pure; the lead's fold can use it.
 */
export function foldObjectiveText(matchText: string, st: ObjectiveState | null): string {
  const base = matchText.split(OBJ_SEP)[0]; // idempotent: a text folded last tick is folded again, not appended twice
  if (!st || !st.text) return base;
  return base ? `${base}${OBJ_SEP}${st.text}` : st.text;
}
const OBJ_SEP = ' · ▶ ';

function groundY(sim: Sim, x: number, z: number): number {
  return sim.worldData.height(x, z);
}

function stepText(def: ObjectiveDef, i: number, n: number, progress: number, contested: boolean): string {
  const t = def.trigger;
  if (t.type === 'hold') {
    const s = Math.min(t.params.seconds, Math.floor(progress * t.params.seconds));
    return `${def.text} ${s}/${t.params.seconds}s${contested ? ' · CONTESTED!' : ''} (${i + 1}/${n})`;
  }
  return `${def.text} (${i + 1}/${n})`;
}

/** Create the beacon + state for a chain (inactive until the match is live). */
export function initObjectives(sim: Sim, rt: InteractRuntime, chain: ObjectiveChain): void {
  rt.chain = chain;
  const id = sim.allocId();
  const e: SimEntity = {
    id, kind: EntityKind.Prop, team: chain.team, species: 0,
    // Sim.toState() writes CLASS_IDS.indexOf(cls) into EntityState.cls: this makes it the OBJECTIVE_CHAIN_IDS index.
    cls: CLASS_IDS[objectiveChainIndex(chain.id)] ?? null,
    seed: 0, name: chain.id, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, collider: null,
    input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null,
    health: { hp: 0, max: 0, lastDamageTick: -9999, lastAttacker: -1 },
    anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
    ownerPid: null, removed: false, data: {}, beacon: { chain: chain.id },
  };
  sim.entities.set(id, e);
  rt.beacon = id;
  sim.state.objective = freshState(chain);
  writeBeacon(sim, rt);
}

function freshState(chain: ObjectiveChain): ObjectiveState {
  return {
    chain: chain.id, team: chain.team, step: -1, total: chain.steps.length, id: '', text: '', progress: 0, contested: false,
    x: 0, y: 0, z: 0, pendingScore: [0, 0], score: [0, 0], doneTimer: 0,
  };
}

/** Match restart: the chain starts over (points folded or not are dropped with the old match). */
export function resetObjectives(sim: Sim, rt: InteractRuntime): void {
  if (!rt.chain) return;
  sim.state.objective = freshState(rt.chain);
  writeBeacon(sim, rt);
}

function enterStep(sim: Sim, rt: InteractRuntime, st: ObjectiveState, i: number): void {
  const chain = rt.chain!;
  st.step = i;
  st.progress = 0;
  st.contested = false;
  if (i >= chain.steps.length) {
    st.id = '';
    st.text = chain.doneText;
    st.doneTimer = chain.doneTime;
    return;
  }
  const def = chain.steps[i];
  const p = def.trigger.params;
  st.id = def.id;
  st.x = p.x; st.z = p.z; st.y = groundY(sim, p.x, p.z);
  st.text = stepText(def, i, chain.steps.length, 0, false);
}

function squadMember(e: SimEntity, team: TeamId): boolean {
  return !!e.char && !e.dead && !e.removed && e.team === team;
}

function inCylinder(e: SimEntity, x: number, y: number, z: number, r: number, h: number): boolean {
  const dx = e.pos.x - x, dz = e.pos.z - z;
  return dx * dx + dz * dz <= r * r && e.pos.y >= y - 2 && e.pos.y <= y + h;
}

function complete(sim: Sim, rt: InteractRuntime, st: ObjectiveState, def: ObjectiveDef, by: SimEntity[]): void {
  const r = def.reward;
  const team = st.team;
  if (r.score > 0 && (team === Team.Corgis || team === Team.Cats)) {
    st.pendingScore[team] += r.score;
    st.score[team] += r.score;
    sim.emit({ e: 'score', team, pts: r.score, reason: 'objective' });
  }
  const lead = by[0];
  if (lead) {
    if (r.item) sim.emit({ e: 'pickup', id: lead.id, item: r.item });
    sim.emit({ e: 'bark', id: lead.id, line: r.bark });
  }
  for (const c of by) creditRoster(sim, c.id, r.roster, `objective:${def.id}`);
  enterStep(sim, rt, st, st.step + 1);
}

/** Per tick. `phase` = MatchState phase ('live' when no match system runs). */
export function stepObjectives(sim: Sim, rt: InteractRuntime, dt: number, phase: string): void {
  const chain = rt.chain;
  const st = objectiveState(sim);
  if (!chain || !st) return;
  if (phase !== 'live') {
    // warmup: nothing yet · ended: the chain freezes (text hidden) until the restart resets it
    if (phase === 'warmup' && st.step >= 0) Object.assign(st, freshState(chain), { pendingScore: st.pendingScore, score: st.score });
    st.text = '';
    st.contested = false;
    writeBeacon(sim, rt, true);
    return;
  }
  if (st.step < 0) enterStep(sim, rt, st, 0);
  const n = chain.steps.length;
  if (st.step >= n) {
    st.doneTimer = Math.max(0, st.doneTimer - dt);
    if (st.doneTimer <= 0) st.text = '';
    writeBeacon(sim, rt);
    return;
  }
  const def = chain.steps[st.step];
  const t = def.trigger;
  if (t.type === 'interact') {
    st.text = stepText(def, st.step, n, 0, false);
    const by: SimEntity[] = [];
    for (const c of sim.entities.values()) {
      if (!squadMember(c, st.team) || c.flags & EFlag.Mounted || !pressed(c, Btn.Interact)) continue;
      if (inCylinder(c, st.x, st.y, st.z, t.params.radius, 9)) by.push(c);
    }
    if (by.length) complete(sim, rt, st, def, by);
  } else {
    const p = t.params;
    const members: SimEntity[] = [];
    let enemies = 0;
    for (const c of sim.entities.values()) {
      if (!c.char || c.dead || c.removed || !inCylinder(c, st.x, st.y, st.z, p.radius, p.height)) continue;
      if (c.team === st.team) members.push(c);
      else if (c.team === Team.Corgis || c.team === Team.Cats) enemies++;
    }
    if (t.type === 'reach') {
      if (members.length) complete(sim, rt, st, def, members);
    } else {
      st.contested = members.length > 0 && enemies > 0;
      if (members.length && !enemies) st.progress = Math.min(1, st.progress + dt / t.params.seconds);
      else if (!members.length) st.progress = Math.max(0, st.progress - (t.params.decay * dt) / t.params.seconds);
      if (st.progress >= 1) complete(sim, rt, st, def, members);
      else st.text = stepText(def, st.step, n, st.progress, st.contested);
    }
  }
  writeBeacon(sim, rt);
}

/** Beacon snapshot fields (see src/shared/content/objectives.ts). */
function writeBeacon(sim: Sim, rt: InteractRuntime, hidden = false): void {
  const e = sim.entities.get(rt.beacon);
  const st = objectiveState(sim);
  if (!e || !st || !rt.chain) return;
  const n = rt.chain.steps.length;
  const showDone = st.step >= n && st.doneTimer > 0;
  const active = !hidden && ((st.step >= 0 && st.step < n) || showDone);
  e.weapon = active ? st.step : -1;
  e.pos.x = st.x; e.pos.y = st.y; e.pos.z = st.z;
  const def = st.step >= 0 && st.step < n ? rt.chain.steps[st.step] : null;
  const secs = def?.trigger.type === 'hold' ? def.trigger.params.seconds : 0;
  e.ammo = Math.round(st.progress * 100);
  e.health!.hp = st.progress * secs;
  e.health!.max = secs;
  e.flags = st.contested && active ? EFlag.Busy : 0;
}

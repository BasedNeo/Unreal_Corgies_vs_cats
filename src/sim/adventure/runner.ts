// The adventure runner (mode `adventure`): briefing → live (steps in order) → complete (time vs par → medal),
// with fail forward: a squad wipe shows a 3 s beat ('failed'), then restarts at the last checkpoint. Two systems:
//   95  adventure-setup  first tick of a chapter: MatchState/rules, S1's kiosks (interactConfig), the beacon, the
//                        squad at the chapter start — before the AI (100) and S1's interaction layer (150)
//   790 adventure        after combat (600) and respawns (700), before the match system (800, which ignores this
//                        mode): respawn relocation, triggers, spawns, the stealth alarm, wipes, the MatchState fold
// A2 adds (chapters.ts header): the pups' chapter kits, minY/maxY and the fail-forward grace for the human-only rules,
// an interact step's object, vehicles parked for a step, barricades raised by a step, a step's rally point and an
// elevated start/rally for humans (props.ts holds the world pieces).
// Everything clients see goes through existing channels: MatchState (objective line, step counter in `wave`, the
// survive countdown in `timeLeft`), the S1-style beacon (snapshot convention in src/shared/content/chapters.ts),
// item props, and `score` (reasons `step`, `chapter`, `kill`) / `bark` / `pickup` events. No new message types.
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { pressed } from '../entity';
import { Anim, CLASS_IDS, EFlag, EntityKind, Team, type EntityId, type TeamId } from '../../shared/types';
import { Btn, emptyInput } from '../../shared/input';
import { TICK_HZ } from '../../shared/constants';
import { hash2, mulberry32 } from '../../shared/rng';
import type { GameEvent, MatchState } from '../../shared/protocol';
import {
  ADVENTURE_CHAIN_INDEX, ADVENTURE_PHASES, ALARM_BARKS, BRIEFING_SECONDS, CHAPTERS, CHAPTER_POINTS, COLLECT_RADIUS,
  BRIEFING_WAIT_SECONDS, COMPLETE_HOLD_SECONDS, FAIL_BEAT_SECONDS, REGROUP_SECONDS, GRACE_BARK, HOLD_DECAY, HOLD_HEIGHT, KIOSK_PROMPT, REACH_HEIGHT, REGROUP_BARK,
  STEP_POINTS, STEP_ROSTER, STRICT_GRACE_SECONDS,
  chapterById, medalFor, roomChapterAfter, type ChapterDef, type ChapterStep,
} from '../../shared/content/chapters';
import { occupiedAt, surfaceAt, waterAt, yawToward } from '../../shared/world/queries';
import type { MatchRules } from '../combat/state';
import { respawnNow } from '../combat/damage';
import { creditRoster } from '../interact/state';
import type { InteractConfig } from '../interact/state';
import type { ObjectiveState } from '../interact/objectives';
import {
  adventureConfig, adventureRuntime, adventureState, checkpointHooks, isAdventureMode, isSquad, readDestructible, setAdventureRuntime, squadHasHuman, squadOf,
  type AdventureRuntime, type AdventureState, type CheckpointEnemy, type CheckpointSpot,
} from './state';
import { spawnChapterCat, spawnItem } from './spawns';
import { clearBarricades, clearVehicles, kitPup, kitPups, parkStepVehicles, raiseBarricade, reparkVehicles, standingBarricades } from './props';
import { stunCharacter } from '../vehicles';
import { simNavGrid } from '../ai';
import { cellX, cellZ, isWalkable, nearestWalkable } from '../ai/nav';

const BARK_GAP = Math.round(2.4 * TICK_HZ);

// ---------------------------------------------------------------------------------------------- helpers
const scratch: SimEntity[] = [];

/**
 * This tick's events the runner has not looked at yet. Sim.peekEvents() is the live queue, which the Room drains
 * after every tick; a caller that never drains (a bare test) would otherwise show the runner old events again.
 */
const evSeen = new WeakMap<Sim, { arr: readonly GameEvent[]; n: number }>();
function freshEvents(sim: Sim): readonly GameEvent[] {
  const arr = sim.peekEvents();
  const seen = evSeen.get(sim);
  const from = seen && seen.arr === arr ? Math.min(seen.n, arr.length) : 0;
  return arr.slice(from);
}
/** Everything queued so far (including the runner's own events) counts as seen. */
function markEventsSeen(sim: Sim): void {
  const arr = sim.peekEvents();
  evSeen.set(sim, { arr, n: arr.length });
}
let tickEvents: readonly GameEvent[] = [];

function ground(sim: Sim, x: number, z: number): number {
  return sim.worldData.height(x, z);
}

function inCylinder(e: SimEntity, x: number, y: number, z: number, r: number, h: number): boolean {
  const dx = e.pos.x - x, dz = e.pos.z - z;
  return dx * dx + dz * dz <= r * r && e.pos.y >= y - 2 && e.pos.y <= y + h;
}

function alive(e: SimEntity): boolean {
  return !e.dead && !e.removed;
}

function stateOfMatch(sim: Sim): MatchState {
  return sim.state.match as MatchState;
}

function addScore(sim: Sim, team: TeamId, pts: number, reason: string): void {
  const ms = sim.state.match as MatchState | undefined;
  if (!ms || (team !== Team.Corgis && team !== Team.Cats)) return;
  ms.score[team] += pts;
  sim.emit({ e: 'score', team, pts, reason });
}

/** Runtime solids the static WorldData doesn't know about (kiosks, kart pads, vehicles, destructibles). */
function nearRuntimeSolid(sim: Sim, x: number, z: number): boolean {
  for (const e of sim.entities.values()) {
    if (e.kind !== EntityKind.Terminal && e.kind !== EntityKind.Vehicle && e.kind !== EntityKind.Destructible) continue;
    if (Math.hypot(e.pos.x - x, e.pos.z - z) < 2.2) return true;
  }
  return false;
}

/**
 * A standing spot for squad member k around (ax, az): open, dry, walkable ground near the anchor's height. With `ay`
 * (A2: an elevated rally point, e.g. a roof) the spot is on that surface instead: within 1.2 m of its height (not
 * off its edge or down a hatch), clear of props.
 */
function formationSpot(sim: Sim, ax: number, az: number, k: number, ay = -1, taken: readonly { x: number; z: number }[] = []): { x: number; y: number; z: number } {
  const d = sim.worldData;
  const g = simNavGrid(sim);
  const up = ay > ground(sim, ax, az) + 1.5;
  const top = up ? ay + 1 : ground(sim, ax, az) + 3;
  for (let tries = 0; tries < 36; tries++) {
    const ring = 1.6 + 1.3 * Math.floor((k + tries) / 5);
    const a = (k + tries * 0.5) * 2.39996;
    const x = ax + Math.cos(a) * ring, z = az + Math.sin(a) * ring;
    if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < SPOT_GAP)) continue; // never two pups on one spot
    const s = surfaceAt(d, x, z, top);
    if (up && Math.abs(s.y - ay) > 1.2) continue;
    if (occupiedAt(d, x, s.y + 0.7, z) || (!up && waterAt(d, x, z)) || nearRuntimeSolid(sim, x, z)) continue;
    if (!up && g && !isWalkable(g, x, z)) continue;
    return { x, y: s.y + 0.05, z };
  }
  if (up) return { x: ax, y: ay + 0.05, z: az };
  if (g) {
    const c = nearestWalkable(g, ax, az, 8);
    if (c >= 0) return { x: cellX(g, c), y: g.ground[c] + 0.05, z: cellZ(g, c) };
  }
  return { x: ax, y: surfaceAt(d, ax, az, top).y + 0.05, z: az };
}

/** Minimum distance between two squad members' standing spots when the squad is placed (m). */
const SPOT_GAP = 1.1;

/** Positions of the members already placed this tick (so the next one doesn't stand on them). */
function placedSpots(sim: Sim): { x: number; z: number }[] {
  const rt = adventureRuntime(sim)!;
  if (rt.placedTick !== sim.tick) return [];
  const out: { x: number; z: number }[] = [];
  for (const id of rt.placed) { const o = sim.entities.get(id); if (o) out.push({ x: o.pos.x, z: o.pos.z }); }
  return out;
}

/** A checkpoint spot is still good to stand on: dry, open, walkable, clear of vehicles/kiosks and of the others. */
function spotStillGood(sim: Sim, s: CheckpointSpot, taken: readonly { x: number; z: number }[]): boolean {
  const d = sim.worldData, g = simNavGrid(sim);
  if (taken.some((t) => Math.hypot(t.x - s.x, t.z - s.z) < SPOT_GAP)) return false;
  if (occupiedAt(d, s.x, s.y + 0.7, s.z) || waterAt(d, s.x, s.z) || nearRuntimeSolid(sim, s.x, s.z)) return false;
  // on the ground the nav grid must agree; up on a roof (above the terrain) the surface must still be there
  return s.y > ground(sim, s.x, s.z) + 1.5 ? Math.abs(surfaceAt(d, s.x, s.z, s.y + 1).y - s.y) < 0.6 : !g || isWalkable(g, s.x, s.z);
}

function placeMember(sim: Sim, e: SimEntity, k: number, st: AdventureState, respawn: boolean, at?: CheckpointSpot): void {
  const taken = placedSpots(sim);
  const kept = at && spotStillGood(sim, at, taken) ? at : null;
  // humans rally up on an elevated rally point (a roof); pups can't climb, so they gather on the ground below it
  const p = kept ? { x: kept.x, y: kept.y, z: kept.z } : formationSpot(sim, st.anchorX, st.anchorZ, k, e.kind === EntityKind.Player ? st.anchorY : -1, taken);
  const yaw = kept ? kept.yaw : st.step >= 0 && (st.x !== st.anchorX || st.z !== st.anchorZ) ? yawToward(p.x, p.z, st.x, st.z) : adventureRuntime(sim)!.def!.start.yaw;
  if (respawn) respawnNow(sim, e, { x: p.x, y: p.y, z: p.z, yaw });
  else {
    sim.placeCharacter(e, p.x, p.y, p.z);
    e.yaw = yaw;
    e.input = { ...e.input, yaw, mx: 0, mz: 0 };
  }
  const rt = adventureRuntime(sim)!;
  if (rt.placedTick !== sim.tick) { rt.placed.clear(); rt.placedTick = sim.tick; }
  rt.placed.add(e.id);
}

function memberIndex(sim: Sim, e: SimEntity): number {
  let k = 0;
  for (const o of squadOf(sim, scratch)) if (o.id < e.id) k++;
  return k;
}

// ---------------------------------------------------------------------------------------------- setup
function freshState(def: ChapterDef, briefing: number): AdventureState {
  return {
    chapter: def.id, step: -1, phase: 'briefing', progress: 0, counters: { kills: 0, alarms: 0, deaths: 0 }, startTick: -1, checkpoint: 0,
    index: def.index, total: def.steps.length, time: 0, medal: '', alarm: false, wipes: 0, timer: briefing,
    x: def.start.x, y: 0, z: def.start.z, anchorX: def.start.x, anchorZ: def.start.z, anchorY: def.start.y ?? -1, contested: false,
  };
}

function freshObjective(def: ChapterDef): ObjectiveState {
  return {
    chain: `adventure:${def.id}`, team: Team.Corgis, step: -1, total: def.steps.length, id: '', text: '', progress: 0, contested: false,
    x: def.start.x, y: 0, z: def.start.z, pendingScore: [0, 0], score: [0, 0], doneTimer: 0,
  };
}

function newRuntime(sim: Sim): AdventureRuntime {
  return {
    def: null, beacon: -1, enemies: new Map(), items: [], destructSeen: new Map(), destructBroken: new Set(), snap: null,
    stepTicks: 0, hold: 0, stepKills: 0, barks: [], barkTurn: 0, ready: new Set(), briefingTicks: 0, placed: new Set(), placedTick: -1, setup: false,
    rng: mulberry32(Math.floor(hash2(sim.seed, 0xad7, 0x3e1) * 0x7fffffff)),
    vehicles: [], barricades: [], kitted: new Set(),
  };
}

function spawnBeacon(sim: Sim, rt: AdventureRuntime): void {
  const id = sim.allocId();
  sim.entities.set(id, {
    id, kind: EntityKind.Prop, team: Team.Corgis, species: 0,
    // Sim.toState() writes CLASS_IDS.indexOf(cls) into EntityState.cls: this makes it the adventure chain slot.
    cls: CLASS_IDS[ADVENTURE_CHAIN_INDEX], seed: 0, name: 'adventure',
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, collider: null,
    input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null,
    health: { hp: 0, max: 0, lastDamageTick: -9999, lastAttacker: -1 },
    anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0, ownerPid: null, removed: false, data: {},
  });
  rt.beacon = id;
}

/** Remove every chapter cat and item (restart, chapter over); with `world`, the chapter's vehicles and barricades too. */
function clearChapterEntities(sim: Sim, rt: AdventureRuntime, world = false): void {
  for (const id of rt.enemies.keys()) sim.removeEntity(id);
  rt.enemies.clear();
  for (const id of rt.items) sim.removeEntity(id);
  rt.items.length = 0;
  if (world) { clearVehicles(sim, rt); clearBarricades(sim, rt); }
}

/** Load a chapter: fresh state, MatchState and rules, the squad at the start, the briefing running. */
export function loadChapter(sim: Sim, def: ChapterDef): void {
  let rt = adventureRuntime(sim);
  if (!rt) { rt = newRuntime(sim); setAdventureRuntime(sim, rt); }
  const cfg = adventureConfig(sim);
  const first = !rt.setup;
  rt.setup = true;
  if (first && cfg.interact !== false && sim.state.interactConfig === undefined) {
    // S1's interaction layer (kiosks for kit swaps, Upgrade Cores, Golden Kibble) — not its Squeaker chain.
    sim.state.interactConfig = { auto: true, objectives: false } satisfies InteractConfig;
  }
  clearChapterEntities(sim, rt, true);
  rt.def = def;
  rt.snap = null;
  rt.stepTicks = 0; rt.hold = 0; rt.stepKills = 0; rt.barks.length = 0; rt.ready.clear(); rt.briefingTicks = 0;
  rt.destructSeen.clear(); rt.destructBroken.clear();
  if (rt.beacon < 0 || !sim.entities.has(rt.beacon)) spawnBeacon(sim, rt);
  const st = freshState(def, cfg.briefing ?? BRIEFING_SECONDS);
  st.y = ground(sim, st.x, st.z);
  sim.state.adventure = st;
  sim.state.objective = freshObjective(def);
  const ms: MatchState = { mode: 'adventure', phase: 'warmup', timeLeft: st.timer, score: [0, 0], objective: '', wave: 0, winner: -1 };
  sim.state.match = ms; // a new object: S1's layer reads it as a new match (kibble back, cores re-dealt)
  const rules: MatchRules = { combatLive: false, respawn: [true, false, true] };
  sim.state.rules = rules;
  kitPups(sim, rt, def); // A2: the chapter's pup kits (featured kit first)
  const squad = squadOf(sim, scratch).slice().sort((a, b) => a.id - b.id);
  squad.forEach((e, k) => placeMember(sim, e, k, st, !first || e.dead));
  fold(sim, rt, st);
}

// ---------------------------------------------------------------------------------------------- steps
function queueBarks(sim: Sim, rt: AdventureRuntime, lines: readonly string[] | undefined): void {
  let t = Math.max(sim.tick, rt.barks.length ? rt.barks[rt.barks.length - 1].tick + BARK_GAP : sim.tick);
  for (const line of lines ?? []) { rt.barks.push({ tick: t, line }); t += BARK_GAP; }
}

function flushBarks(sim: Sim, rt: AdventureRuntime): void {
  while (rt.barks.length && rt.barks[0].tick <= sim.tick) {
    const b = rt.barks.shift()!;
    const speakers = squadOf(sim, scratch).filter(alive).sort((a, c) => a.id - c.id);
    if (!speakers.length) continue;
    const who = speakers[rt.barkTurn++ % speakers.length];
    sim.emit({ e: 'bark', id: who.id, line: b.line });
  }
}

function spawnGroups(sim: Sim, rt: AdventureRuntime, st: AdventureState, groups: ChapterStep['spawns'] | ChapterStep['alarm'], tag: string, sentries: boolean): void {
  let n = rt.enemies.size;
  for (const g of groups ?? []) {
    const gtag = (g as { tag?: string }).tag ?? tag;
    for (let i = 0; i < g.count; i++) {
      spawnChapterCat(sim, rt, {
        arch: g.archetype, x: g.at.x, z: g.at.z, tag: gtag, step: st.step, jitter: g.count > 1 ? 2.5 : 0.8,
        sentry: sentries, faceX: st.anchorX, faceZ: st.anchorZ,
      }, ++n);
    }
  }
}

function saveCheckpoint(sim: Sim, rt: AdventureRuntime, st: AdventureState): void {
  st.checkpoint = st.step;
  const enemies: CheckpointEnemy[] = [];
  for (const [id, r] of rt.enemies) {
    const e = sim.entities.get(id);
    if (!e || !alive(e)) continue;
    enemies.push({ arch: r.arch, tag: r.tag, step: r.step, x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: e.yaw, route: e.adv?.sentry ? [...e.adv.sentry.route] : undefined });
  }
  // where the squad stands as the step begins (on its feet: not seated in a vehicle, not mid-jump)
  const squad: CheckpointSpot[] = [];
  for (const c of squadOf(sim, scratch)) if (alive(c) && !c.seat && c.char?.grounded) squad.push({ id: c.id, x: c.pos.x, y: c.pos.y, z: c.pos.z, yaw: c.yaw });
  const extra: Record<string, unknown> = {};
  for (const [name, h] of checkpointHooks()) extra[name] = h.save(sim);
  rt.snap = {
    step: st.step, counters: { ...st.counters }, anchorX: st.anchorX, anchorZ: st.anchorZ, anchorY: st.anchorY, enemies, squad,
    broken: [...rt.destructBroken], extra, barricades: standingBarricades(sim, rt),
  };
}

function spawnStepItems(sim: Sim, rt: AdventureRuntime, step: ChapterStep): void {
  for (const id of rt.items) sim.removeEntity(id);
  rt.items.length = 0;
  const t = step.trigger;
  // A2: an interact step can show its object (the last tennis ball) at the point; E takes it
  if (t.type === 'interact' && t.params.item) spawnItem(sim, rt, t.params.item, 0, t.params.x, t.params.z, t.params.minY !== undefined ? t.params.minY + 4 : undefined);
  if (t.type !== 'collect') return;
  const p = t.params;
  p.spots.forEach((s, i) => spawnItem(sim, rt, p.item, i, s.x, s.z));
}

/** Beacon height for a step target: its ground, or up on the roof a `minY` asks for (A2). */
function targetY(sim: Sim, step: ChapterStep, x: number, z: number): number {
  const t = step.trigger;
  const minY = t.type === 'reach' || t.type === 'interact' ? t.params.minY : undefined;
  const g = ground(sim, x, z);
  return minY !== undefined && minY > g ? surfaceAt(sim.worldData, x, z, minY + 4).y : g;
}

function enterStep(sim: Sim, rt: AdventureRuntime, st: AdventureState, i: number): void {
  const def = rt.def!;
  st.step = i;
  st.progress = 0;
  st.alarm = false;
  st.contested = false;
  rt.stepTicks = 0; rt.hold = 0; rt.stepKills = 0;
  if (i >= def.steps.length) { completeChapter(sim, rt, st); return; }
  const step = def.steps[i];
  spawnGroups(sim, rt, st, step.spawns, step.stealth ? 'sentry' : 'cat', !!step.stealth);
  const boss = step.trigger.type === 'defeat' ? step.trigger.params.boss : undefined;
  if (boss && ![...rt.enemies.values()].some((r) => r.boss === boss && !r.counted)) {
    // a boss fight with no spawn for it: the boss arrives at its own default spot (E1: the sniper picks a perch)
    spawnChapterCat(sim, rt, { arch: boss, x: 0, z: 0, tag: 'boss', step: i, jitter: 0, auto: true }, rt.enemies.size + 1);
  }
  spawnStepItems(sim, rt, step);
  parkStepVehicles(sim, rt, i, step.vehicles);
  const t = step.trigger;
  if (t.type === 'reach' || t.type === 'interact' || t.type === 'hold') { st.x = t.params.x; st.z = t.params.z; st.y = targetY(sim, step, st.x, st.z); }
  else { pointAtNearest(sim, st, squadOf(sim, scratch), stepTargets(sim, rt, step)); st.y = ground(sim, st.x, st.z); }
  queueBarks(sim, rt, step.barks);
  if (i === 0 || step.checkpoint) saveCheckpoint(sim, rt, st);
}

function completeStep(sim: Sim, rt: AdventureRuntime, st: AdventureState, by: SimEntity[]): void {
  const step = rt.def!.steps[st.step];
  addScore(sim, Team.Corgis, STEP_POINTS, 'step');
  for (const c of by) creditRoster(sim, c.id, STEP_ROSTER, `step:${step.id}`);
  // the squad rallies (and restarts after a wipe) where it last got something done (A2: or at the step's `rally`)
  const t = step.trigger;
  if (step.rally) { st.anchorX = step.rally.x; st.anchorZ = step.rally.z; st.anchorY = step.rally.y ?? -1; }
  else if (t.type === 'reach' || t.type === 'interact' || t.type === 'hold') { st.anchorX = t.params.x; st.anchorZ = t.params.z; st.anchorY = -1; }
  else if (by[0]) { st.anchorX = by[0].pos.x; st.anchorZ = by[0].pos.z; st.anchorY = -1; }
  // A2: the step's barricades go up (owned by whoever finished the step)
  const owner = by[0] ?? squadOf(sim, scratch)[0];
  if (owner) for (const spot of step.raise ?? []) raiseBarricade(sim, rt, owner, spot);
  enterStep(sim, rt, st, st.step + 1);
}

function completeChapter(sim: Sim, rt: AdventureRuntime, st: AdventureState): void {
  const def = rt.def!;
  st.phase = 'complete';
  st.step = def.steps.length;
  st.time = Math.round(((sim.tick - st.startTick) / TICK_HZ) * 10) / 10;
  st.medal = medalFor(st.time, def.par);
  st.timer = adventureConfig(sim).completeHold ?? COMPLETE_HOLD_SECONDS;
  st.progress = 1;
  addScore(sim, Team.Corgis, CHAPTER_POINTS, 'chapter');
  sim.emit({ e: 'score', team: Team.Corgis, pts: 0, reason: 'win' });
  clearChapterEntities(sim, rt); // the cats scatter
  (sim.state.rules as MatchRules).combatLive = false;
  rt.barks.length = 0;
}

// ---------------------------------------------------------------------------------------------- triggers
interface Eval { done: boolean; by: SimEntity[]; progress: number }
const res: Eval = { done: false, by: [], progress: 0 };

function evalStep(sim: Sim, rt: AdventureRuntime, st: AdventureState, step: ChapterStep, dt: number): Eval {
  res.done = false; res.by = []; res.progress = 0;
  const squad = squadOf(sim, scratch);
  const human = squad.some((e) => e.kind === EntityKind.Player);
  const t = step.trigger;
  // A2: the human-only rules (vehicle, airborne, minY) hold for STRICT_GRACE_SECONDS, then fail forward
  const strictRules = human && rt.stepTicks <= STRICT_GRACE_SECONDS * TICK_HZ;
  switch (t.type) {
    case 'reach': {
      const p = t.params, y = ground(sim, p.x, p.z);
      // A2: maxY lifts the zone's ceiling (a plane over the shed); minY is a floor for humans (bots can't climb)
      const h = p.maxY !== undefined ? Math.max(REACH_HEIGHT, p.maxY - y) : REACH_HEIGHT;
      const strict = strictRules && (p.vehicle || p.airborne);
      const floor = strictRules && p.minY !== undefined ? p.minY : -Infinity;
      for (const c of squad) {
        if (!alive(c) || !inCylinder(c, p.x, y, p.z, p.radius, h)) continue;
        if (human && c.kind !== EntityKind.Player) continue; // the pups escort; the human gets there (first success is theirs)
        if (c.pos.y < floor) continue;
        if (strict) {
          if (p.vehicle && !(c.flags & EFlag.Mounted)) continue;
          if (p.airborne && (c.char!.grounded || c.pos.y < ground(sim, c.pos.x, c.pos.z) + 0.3)) continue;
        }
        res.by.push(c);
      }
      if (strict && p.vehicle) {
        // a driven vehicle inside the zone counts for its driver (vehicle snapshot convention: weapon = rider id)
        for (const v of sim.entities.values()) {
          if (v.kind !== EntityKind.Vehicle || v.weapon < 0 || !inCylinder(v, p.x, y, p.z, p.radius, h) || v.pos.y < floor) continue;
          const d = sim.entities.get(v.weapon);
          if (d && isSquad(d) && !res.by.includes(d)) res.by.push(d);
        }
      }
      res.done = res.by.length > 0;
      break;
    }
    case 'interact': {
      const p = t.params, y = ground(sim, p.x, p.z);
      const kiosk = p.prompt === KIOSK_PROMPT;
      const floor = strictRules && p.minY !== undefined ? p.minY : -Infinity; // A2: up on the roof (humans)
      const h = p.minY !== undefined ? Math.max(9, p.minY + 4 - y) : 9;
      for (const c of squad) {
        if (!alive(c) || (c.flags & EFlag.Mounted) || (human && c.kind !== EntityKind.Player) || c.pos.y < floor) continue;
        if (pressed(c, Btn.Interact) && inCylinder(c, p.x, y, p.z, p.radius, h)) res.by.push(c);
      }
      if (kiosk && !res.by.length) {
        // a kit swap at the kiosk counts too (S1 emits `ability kit_swap` with the player's position)
        for (const ev of tickEvents) {
          if (ev.e !== 'ability' || ev.ability !== 'kit_swap' || Math.hypot(ev.x - p.x, ev.z - p.z) > p.radius + 0.5) continue;
          let best: SimEntity | null = null, bd = 1;
          for (const c of squad) {
            const d = Math.hypot(c.pos.x - ev.x, c.pos.z - ev.z);
            if (alive(c) && d < bd && (!human || c.kind === EntityKind.Player)) { bd = d; best = c; }
          }
          if (best) res.by.push(best);
        }
      }
      res.done = res.by.length > 0;
      if (res.done && p.item) sim.emit({ e: 'pickup', id: res.by[0].id, item: p.item }); // A2: took the object
      break;
    }
    case 'hold': {
      const p = t.params, y = ground(sim, p.x, p.z);
      let enemies = 0;
      for (const c of sim.entities.values()) {
        if (!c.char || !alive(c) || !inCylinder(c, p.x, y, p.z, p.radius, HOLD_HEIGHT)) continue;
        if (isSquad(c)) res.by.push(c);
        else if (c.team === Team.Cats) enemies++;
      }
      st.contested = res.by.length > 0 && enemies > 0;
      if (res.by.length && !enemies) rt.hold = Math.min(1, rt.hold + dt / p.seconds);
      else if (!res.by.length) rt.hold = Math.max(0, rt.hold - (HOLD_DECAY * dt) / p.seconds);
      res.progress = rt.hold;
      res.done = rt.hold >= 1;
      break;
    }
    case 'collect': {
      const p = t.params;
      for (let i = rt.items.length - 1; i >= 0; i--) {
        const it = sim.entities.get(rt.items[i]);
        if (!it) { rt.items.splice(i, 1); continue; }
        let best: SimEntity | null = null, bd = COLLECT_RADIUS;
        for (const c of squad) {
          if (!alive(c) || Math.abs(c.pos.y + 0.5 - it.pos.y) > 1.8) continue;
          const d = Math.hypot(c.pos.x - it.pos.x, c.pos.z - it.pos.z);
          if (d < bd) { bd = d; best = c; }
        }
        if (!best) continue;
        sim.removeEntity(it.id);
        rt.items.splice(i, 1);
        st.counters[p.item] = (st.counters[p.item] ?? 0) + 1;
        sim.emit({ e: 'pickup', id: best.id, item: p.item });
        res.by.push(best);
        st.anchorX = it.pos.x; st.anchorZ = it.pos.z;
      }
      const got = p.spots.length - rt.items.length;
      res.progress = Math.min(1, got / p.count);
      res.done = got >= p.count;
      if (res.done) { for (const id of rt.items) sim.removeEntity(id); rt.items.length = 0; }
      // the beacon marks the untaken item nearest the squad
      pointAtNearest(sim, st, squad, rt.items.map((id) => sim.entities.get(id)!).filter(Boolean));
      break;
    }
    case 'defeat': {
      const p = t.params;
      const targets: SimEntity[] = [];
      let spawned = 0, down = 0;
      for (const [id, r] of rt.enemies) {
        const match = p.boss ? r.boss === p.boss : !p.tag || r.tag === p.tag;
        if (!match) continue;
        spawned++;
        const e = sim.entities.get(id);
        if (e && alive(e)) targets.push(e); else down++;
      }
      if (p.boss) {
        const b = targets[0];
        res.progress = b?.health ? 1 - b.health.hp / Math.max(1, b.health.max) : spawned ? 1 : 0;
        res.done = spawned > 0 && targets.length === 0;
      } else if (p.count !== undefined) {
        const got = p.tag ? st.counters[`kills:${p.tag}`] ?? 0 : rt.stepKills;
        res.progress = Math.min(1, got / Math.max(1, p.count));
        res.done = got >= p.count;
      } else {
        res.progress = spawned ? down / spawned : 0;
        res.done = spawned > 0 && targets.length === 0;
      }
      pointAtNearest(sim, st, squad, targets);
      break;
    }
    case 'destroy': {
      const p = t.params;
      const targets: SimEntity[] = [];
      for (const e of sim.entities.values()) {
        if (e.kind !== EntityKind.Destructible) continue;
        const d = readDestructible(sim, e);
        if (d && d.tag === p.tag && !d.broken) targets.push(e);
      }
      const got = st.counters[`broken:${p.tag}`] ?? 0;
      res.progress = Math.min(1, got / Math.max(1, p.count));
      res.done = got >= p.count;
      pointAtNearest(sim, st, squad, targets);
      break;
    }
    case 'survive': {
      const secs = t.params.seconds;
      res.progress = Math.min(1, rt.stepTicks / (secs * TICK_HZ));
      res.done = rt.stepTicks >= secs * TICK_HZ;
      if (res.done) for (const c of squad) if (alive(c)) res.by.push(c);
      break;
    }
  }
  return res;
}

/** Does the step have a human-only rule (vehicle, airborne, minY) that the grace can waive? */
function strictStep(step: ChapterStep): boolean {
  const t = step.trigger;
  if (t.type === 'reach') return !!(t.params.vehicle || t.params.airborne || t.params.minY !== undefined);
  return t.type === 'interact' && t.params.minY !== undefined;
}

/** Point the beacon at the target nearest the squad (humans first). */
function pointAtNearest(sim: Sim, st: AdventureState, squad: SimEntity[], targets: SimEntity[]): void {
  if (!targets.length) return;
  let rx = 0, rz = 0, n = 0;
  for (const c of squad) if (alive(c) && c.kind === EntityKind.Player) { rx += c.pos.x; rz += c.pos.z; n++; }
  if (!n) for (const c of squad) if (alive(c)) { rx += c.pos.x; rz += c.pos.z; n++; }
  if (n) { rx /= n; rz /= n; } else { rx = st.anchorX; rz = st.anchorZ; }
  let best = targets[0], bd = Infinity;
  for (const t of targets) { const d = Math.hypot(t.pos.x - rx, t.pos.z - rz); if (d < bd) { bd = d; best = t; } }
  st.x = best.pos.x; st.z = best.pos.z; st.y = ground(sim, st.x, st.z);
}

/** What the beacon can point at for collect / defeat / destroy steps. */
function stepTargets(sim: Sim, rt: AdventureRuntime, step: ChapterStep): SimEntity[] {
  const out: SimEntity[] = [];
  const t = step.trigger;
  if (t.type === 'collect') for (const id of rt.items) { const e = sim.entities.get(id); if (e) out.push(e); }
  else if (t.type === 'defeat') {
    for (const [id, r] of rt.enemies) {
      const e = sim.entities.get(id);
      if (e && alive(e) && (t.params.boss ? r.boss === t.params.boss : !t.params.tag || r.tag === t.params.tag)) out.push(e);
    }
  } else if (t.type === 'destroy') {
    for (const e of sim.entities.values()) {
      if (e.kind !== EntityKind.Destructible) continue;
      const d = readDestructible(sim, e);
      if (d && d.tag === t.params.tag && !d.broken) out.push(e);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- bookkeeping
/** Chapter cats that went down since last tick: counters and a point each for the corgis. */
function trackEnemies(sim: Sim, rt: AdventureRuntime, st: AdventureState): void {
  for (const [id, r] of rt.enemies) {
    if (r.counted) continue;
    const e = sim.entities.get(id);
    if (e && alive(e)) continue;
    r.counted = true;
    st.counters.kills = (st.counters.kills ?? 0) + 1;
    st.counters[`kills:${r.tag}`] = (st.counters[`kills:${r.tag}`] ?? 0) + 1;
    rt.stepKills++;
    if (st.phase === 'live') addScore(sim, Team.Corgis, 1, 'kill');
  }
}

/** Destructibles broken since last tick (they may be removed on break: remember tags while they stand). */
function trackDestructibles(sim: Sim, rt: AdventureRuntime, st: AdventureState): void {
  for (const e of sim.entities.values()) {
    if (e.kind !== EntityKind.Destructible || rt.destructBroken.has(e.id)) continue;
    const d = readDestructible(sim, e);
    if (!d) continue;
    rt.destructSeen.set(e.id, d.tag);
    if (d.broken) countBroken(rt, st, e.id, d.tag);
  }
  for (const [id, tag] of rt.destructSeen) if (!rt.destructBroken.has(id) && !sim.entities.has(id)) countBroken(rt, st, id, tag);
}

function countBroken(rt: AdventureRuntime, st: AdventureState, id: EntityId, tag: string): void {
  rt.destructBroken.add(id);
  st.counters[`broken:${tag}`] = (st.counters[`broken:${tag}`] ?? 0) + 1;
}

/** Squad members (re)spawned this tick by the respawn system or the Room join the squad at its rally point. */
function relocateSpawns(sim: Sim, rt: AdventureRuntime, st: AdventureState): void {
  if (rt.placedTick !== sim.tick) { rt.placed.clear(); rt.placedTick = sim.tick; }
  for (const ev of tickEvents) {
    if (ev.e === 'death') {
      const v = sim.entities.get(ev.id);
      if (v && isSquad(v) && st.phase === 'live') { st.counters.deaths = (st.counters.deaths ?? 0) + 1; addScore(sim, Team.Cats, 1, 'kill'); }
      continue;
    }
    if (ev.e !== 'spawn' || rt.placed.has(ev.id)) continue;
    const e = sim.entities.get(ev.id);
    if (!e || !isSquad(e) || e.dead) continue;
    if (rt.def) kitPup(sim, rt, rt.def, e); // A2: a pup that joins mid-chapter gets its kit (once)
    placeMember(sim, e, memberIndex(sim, e), st, false);
  }
}

// ---------------------------------------------------------------------------------------------- phases
function goLive(sim: Sim, rt: AdventureRuntime, st: AdventureState): void {
  st.phase = 'live';
  st.startTick = sim.tick;
  st.timer = 0;
  (sim.state.rules as MatchRules).combatLive = true;
  enterStep(sim, rt, st, 0);
}

function raiseAlarm(sim: Sim, rt: AdventureRuntime, st: AdventureState, step: ChapterStep, by: SimEntity): void {
  st.alarm = true;
  st.counters.alarms = (st.counters.alarms ?? 0) + 1;
  sim.emit({ e: 'bark', id: by.id, line: ALARM_BARKS[Math.floor(rt.rng() * ALARM_BARKS.length) % ALARM_BARKS.length] });
  for (const id of rt.enemies.keys()) { const e = sim.entities.get(id); if (e?.adv) e.adv.sentry = undefined; } // the garden wakes up
  spawnGroups(sim, rt, st, step.alarm, 'alarm', false);
}

function wiped(sim: Sim): boolean {
  const squad = squadOf(sim, scratch);
  return squad.length > 0 && squad.every((e) => e.dead);
}

function holdRespawns(sim: Sim): void {
  for (const e of squadOf(sim, scratch)) if (e.dead) e.respawnTick = 0;
}

/** Fail forward: back to the last checkpoint — its cats, its counters, the squad at its rally point. */
export function restartAtCheckpoint(sim: Sim): void {
  const rt = adventureRuntime(sim), st = adventureState(sim);
  if (!rt?.def || !st || !rt.snap) return;
  const snap = rt.snap;
  clearChapterEntities(sim, rt, true);
  // other lanes' world state first (X1: props broken after the checkpoint stand back up), then our bookkeeping of it
  for (const [name, h] of checkpointHooks()) if (name in snap.extra) h.restore(sim, snap.extra[name]);
  rt.destructBroken = new Set(snap.broken); // anything still broken beyond these recounts on the next tick
  st.counters = { ...snap.counters };
  st.anchorX = snap.anchorX; st.anchorZ = snap.anchorZ; st.anchorY = snap.anchorY;
  st.step = snap.step;
  st.phase = 'live';
  st.timer = 0;
  st.progress = 0; st.alarm = false; st.contested = false;
  rt.stepTicks = 0; rt.hold = 0; rt.stepKills = 0; rt.barks.length = 0;
  const step = rt.def.steps[snap.step];
  const t = step.trigger;
  if (t.type === 'reach' || t.type === 'interact' || t.type === 'hold') { st.x = t.params.x; st.z = t.params.z; }
  else { st.x = st.anchorX; st.z = st.anchorZ; }
  (sim.state.rules as MatchRules).combatLive = true;
  const squad = squadOf(sim, scratch).slice().sort((a, b) => a.id - b.id);
  // everyone back where they stood when the step began (a newcomer, or a spot gone bad, gets the formation)
  squad.forEach((e, k) => placeMember(sim, e, k, st, true, snap.squad?.find((s) => s.id === e.id)));
  let n = 0;
  for (const c of snap.enemies) {
    spawnChapterCat(sim, rt, { arch: c.arch, x: c.x, z: c.z, y: c.y, yaw: c.yaw, tag: c.tag, step: c.step, jitter: 0, sentry: !!c.route, route: c.route }, ++n);
  }
  // the regroup beat: the respawned squad starts cold (no targets yet), the cats don't, so they hold still a moment
  for (const id of rt.enemies.keys()) { const c = sim.entities.get(id); if (c?.char && alive(c)) stunCharacter(sim, c, REGROUP_SECONDS); }
  spawnStepItems(sim, rt, step);
  // A2: the checkpoint's barricades stand again (full health); vehicles of the steps so far are parked again
  const owner = squad[0];
  if (owner) for (const spot of snap.barricades) raiseBarricade(sim, rt, owner, spot);
  for (let i = 0; i <= snap.step; i++) parkStepVehicles(sim, rt, i, rt.def.steps[i].vehicles);
  if (t.type !== 'reach' && t.type !== 'interact' && t.type !== 'hold') { pointAtNearest(sim, st, squad, stepTargets(sim, rt, step)); st.y = ground(sim, st.x, st.z); }
  else st.y = targetY(sim, step, st.x, st.z);
  queueBarks(sim, rt, [REGROUP_BARK]);
}

function update(sim: Sim, dt: number): void {
  const rt = adventureRuntime(sim), st = adventureState(sim);
  if (!rt?.def || !st) return;
  const def = rt.def;
  tickEvents = freshEvents(sim);
  relocateSpawns(sim, rt, st);
  trackEnemies(sim, rt, st);
  trackDestructibles(sim, rt, st);
  switch (st.phase) {
    case 'briefing': {
      let humans = 0;
      for (const e of squadOf(sim, scratch)) {
        if (e.kind !== EntityKind.Player) continue;
        humans++;
        if (pressed(e, Btn.Interact)) rt.ready.add(e.id);
      }
      // the captions wait for a human to be there to read them (a slow page load joins late), at most BRIEFING_WAIT
      rt.briefingTicks++;
      if (humans > 0 || rt.briefingTicks > (adventureConfig(sim).briefingWait ?? BRIEFING_WAIT_SECONDS) * TICK_HZ) st.timer = Math.max(0, st.timer - dt);
      let ready = 0;
      for (const id of rt.ready) { const e = sim.entities.get(id); if (e && isSquad(e) && e.kind === EntityKind.Player) ready++; }
      if (st.timer <= 0 || (humans > 0 && ready >= humans)) goLive(sim, rt, st);
      break;
    }
    case 'live': {
      st.time = (sim.tick - st.startTick) / TICK_HZ;
      if (wiped(sim)) {
        st.phase = 'failed';
        st.wipes++;
        st.timer = adventureConfig(sim).failBeat ?? FAIL_BEAT_SECONDS;
        rt.barks.length = 0;
        holdRespawns(sim);
        break;
      }
      const step = def.steps[st.step];
      rt.stepTicks++;
      if (rt.vehicles.length) reparkVehicles(sim, rt, st);
      if (rt.stepTicks === STRICT_GRACE_SECONDS * TICK_HZ + 1 && strictStep(step) && squadHasHuman(sim)) queueBarks(sim, rt, [GRACE_BARK]);
      if (step.stealth && !st.alarm) {
        for (const id of rt.enemies.keys()) {
          const e = sim.entities.get(id);
          if (e && alive(e) && e.flags & EFlag.Alerted) { raiseAlarm(sim, rt, st, step, e); break; }
        }
      }
      const r = evalStep(sim, rt, st, step, dt);
      st.progress = r.progress;
      if (r.done) completeStep(sim, rt, st, r.by);
      break;
    }
    case 'failed': {
      st.time = (sim.tick - st.startTick) / TICK_HZ;
      holdRespawns(sim);
      st.timer = Math.max(0, st.timer - dt);
      if (st.timer <= 0) restartAtCheckpoint(sim);
      break;
    }
    case 'complete': {
      if (adventureConfig(sim).holdResult) break; // offline: the player picks what's next on the card
      st.timer = Math.max(0, st.timer - dt);
      if (st.timer <= 0) {
        const next = adventureConfig(sim).advance === false ? def : roomChapterAfter(def);
        sim.emit({ e: 'score', team: Team.Corgis, pts: 0, reason: 'reset' });
        sim.emit({ e: 'score', team: Team.Cats, pts: 0, reason: 'reset' });
        loadChapter(sim, next);
        markEventsSeen(sim);
        return;
      }
      break;
    }
  }
  flushBarks(sim, rt);
  fold(sim, rt, st);
  markEventsSeen(sim);
}

// ---------------------------------------------------------------------------------------------- fold
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** HUD line for the current step ("Grab the catnip bags 1/3 (2/3)"). */
export function adventureText(def: ChapterDef, st: AdventureState): string {
  if (st.phase === 'briefing') return `Chapter ${def.index}: ${def.title} — starts in ${Math.max(1, Math.ceil(st.timer))}`;
  if (st.phase === 'failed') return `Squad down! Back to the checkpoint in ${Math.max(1, Math.ceil(st.timer))}`;
  if (st.phase === 'complete') return `Chapter complete! ${fmtTime(st.time)} · ${st.medal.toUpperCase()} paw`;
  const step = def.steps[st.step];
  if (!step) return '';
  const t = step.trigger;
  let extra = '';
  if (t.type === 'hold') extra = ` ${Math.min(t.params.seconds, Math.floor(st.progress * t.params.seconds))}/${t.params.seconds}s${st.contested ? ' · CONTESTED!' : ''}`;
  else if (t.type === 'collect') extra = ` ${Math.min(t.params.count, Math.round(st.progress * t.params.count))}/${t.params.count}`;
  else if (t.type === 'defeat' && t.params.count !== undefined) extra = ` ${Math.min(t.params.count, Math.round(st.progress * t.params.count))}/${t.params.count}`;
  else if (t.type === 'destroy') extra = ` ${Math.min(t.params.count, Math.round(st.progress * t.params.count))}/${t.params.count}`;
  else if (t.type === 'survive') extra = ` ${Math.max(0, Math.ceil(t.params.seconds * (1 - st.progress)))}s`;
  const alarm = step.stealth && st.alarm ? ' · ALARM!' : '';
  return `${step.text}${extra}${alarm} (${st.step + 1}/${def.steps.length})`;
}

function fold(sim: Sim, rt: AdventureRuntime, st: AdventureState): void {
  const def = rt.def!;
  const ms = stateOfMatch(sim);
  const step = st.step >= 0 && st.step < def.steps.length ? def.steps[st.step] : null;
  const text = adventureText(def, st);
  ms.mode = 'adventure';
  ms.phase = st.phase === 'briefing' ? 'warmup' : st.phase === 'complete' ? 'ended' : 'live';
  ms.winner = st.phase === 'complete' ? Team.Corgis : -1;
  ms.objective = text;
  ms.wave = st.phase === 'briefing' ? 0 : Math.min(st.step + 1, def.steps.length);
  const surviveLeft = step?.trigger.type === 'survive' && st.phase === 'live' ? step.trigger.params.seconds * (1 - st.progress) : 0;
  ms.timeLeft = st.phase === 'live' ? surviveLeft : st.timer;
  // S1's ObjectiveState (tools, tests, anything that reads objectiveState(sim))
  const os = sim.state.objective as ObjectiveState;
  os.step = st.step; os.id = step?.id ?? ''; os.text = st.phase === 'live' ? text : '';
  os.progress = st.progress; os.contested = st.contested; os.x = st.x; os.y = st.y; os.z = st.z;
  os.score[0] = ms.score[0]; os.doneTimer = st.phase === 'complete' ? st.timer : 0;
  // the beacon (snapshot convention: src/shared/content/chapters.ts)
  const b = sim.entities.get(rt.beacon);
  if (!b) return;
  b.seed = def.index;
  b.pos.x = st.x; b.pos.y = st.y; b.pos.z = st.z;
  b.anim = ADVENTURE_PHASES.indexOf(st.phase) as typeof b.anim;
  b.weapon = st.phase === 'briefing' ? -1 : st.phase === 'complete' ? def.steps.length : st.step;
  b.ammo = Math.round(st.progress * 100);
  const secs = step?.trigger.type === 'hold' || step?.trigger.type === 'survive' ? step.trigger.params.seconds : 0;
  if (st.phase === 'complete') { b.health!.hp = st.time; b.health!.max = def.par; }
  else { b.health!.hp = st.progress * secs; b.health!.max = secs; }
  b.flags = (st.contested || (step?.stealth && st.alarm)) && st.phase === 'live' ? EFlag.Busy : 0;
}

// ---------------------------------------------------------------------------------------------- systems
export const adventureSetupSystem: SimSystem = {
  name: 'adventure-setup',
  order: 95,
  update(sim) {
    if (!isAdventureMode(sim) || adventureRuntime(sim)?.setup) return;
    const cfg = adventureConfig(sim);
    const room = sim.state.room as { chapter?: string } | undefined;
    loadChapter(sim, cfg.chapter ?? chapterById(room?.chapter) ?? CHAPTERS[0]);
  },
};

export const adventureSystem: SimSystem = {
  name: 'adventure',
  order: 790,
  update(sim, dt) {
    if (!isAdventureMode(sim)) return;
    update(sim, dt);
  },
};

/** The adventure's systems (the lead adds `...adventureSystems()` to createDefaultSystems). */
export function adventureSystems(): SimSystem[] {
  return [adventureSetupSystem, adventureSystem];
}

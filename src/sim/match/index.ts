// OWNER: combat lane (match rules). Score, timer, waves, win conditions (order 800).
// Reads the mode from sim.state.room.mode (set by the Room) and writes sim.state.match (MatchState,
// sent in every snapshot) plus sim.state.rules (MatchRules, read by combat).
//
//   yard-skirmish    co-op PvE: corgis (players + bots) vs escalating cat waves from the cat spawns.
//                    warmup → wave 1..N (intermissions between) → win after the final wave, or lose
//                    when the whole squad is down at once more than `wipeLives` times → restart.
//   team-deathmatch  warmup → live (first to killLimit or timeLimit) → ended (winner shown) → restart
//                    with reset scores.
//   core-rush        PvP domination over three Core Pads (core-rush.ts): hold pads for points, first to
//                    scoreLimit or the leader at the horn.
//   base-assault     W9 G4a: steal the enemy's squeaky ball and run it home (base-assault.ts): first to
//                    captureLimit captures, or the most captures at the horn (equal = draw).
//   slab             W13: the Godot game's mode on The Lot (slab.ts; rules + snapshot contract: SLAB in
//                    shared/content/modes.ts): hold the slab alone for 1 point per full second; first to winScore, or
//                    the leader at timeLimit, tied: overtime (at most overtimeMax s, then a draw). Live from the first
//                    tick; the result holds until a human presses Reload (bots-only rooms: endedHold s).
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import type { MatchState } from '../../shared/protocol';
import { Team, Species, EntityKind, type TeamId, type EntityId } from '../../shared/types';
import { Btn } from '../../shared/input';
import { pressed } from '../entity';
import { combatBus, ensureCombat, ticksOf, type MatchRules, type KillRecord } from '../combat/state';
import { respawnNow } from '../combat/damage';
import { applyArchetype, simNavGrid } from '../ai';
import { ARCHETYPES, type ArchetypeId } from '../ai/archetypes';
import { nearestWalkable, cellX, cellZ } from '../ai/nav';
import { SKIRMISH, TDM, type SkirmishConfig, type TdmConfig, type MatchConfigOverrides } from './config';
import { spawnBoss, bossWaveStatus, bossRushConfig } from '../boss'; // B1 hook: boss waves (E1: which boss)
import { objectiveState, takeObjectiveScore, foldObjectiveText } from '../interact'; // S1: mission chain
import { coreRushConfig, setupCorePads, stepCorePads } from './core-rush';
import { BA_REASON, CORE_PAD_LABELS, SLAB_TEXT } from '../../shared/content/modes';
import { baseAssaultConfig, resetBaseAssault, setupBaseAssault, stepBaseAssault } from './base-assault';
import { assignSlabSlots, evaluateSlab, resetSlab, setupSlab, slabConfig, slabKitSystem, slabRespawnDelay, slabRespawns } from './slab';
import { clearVehicles } from '../vehicles';

export { SKIRMISH, TDM, type SkirmishConfig, type TdmConfig, type WaveDef, type MatchConfigOverrides } from './config';

export const MODES = ['yard-skirmish', 'team-deathmatch', 'core-rush', 'base-assault', 'slab'] as const;
export { coreRushPads, corePadSpots, type CorePadInfo } from './core-rush';
export { baseAssaultBalls, baseAssaultSpots, baseAssaultState, checkBallInvariants, type BallInfo, type BaseSpot } from './base-assault';
export {
  applySlabKit, hasSlabKit, slabCatSlots, slabConfig, slabRespawnPoint, slabRespawnPoints, slabSlotOf, slabSlots, slabSprintTime, slabZone,
  SLAB_CAT_OFFSET, SLAB_CAT_SLOTS, SLAB_CORGI_TRIPS, type SlabCatSlot, type SlabInfo, type SlabLayout, type SlabSlot,
} from './slab';

/** Match runtime bookkeeping (plain data in sim.state.matchRt). */
interface MatchRuntime {
  mode: string;
  /** Seconds left in the current timed step (warmup, intermission, ended hold, TDM clock). */
  clock: number;
  intermission: boolean;
  queue: ArchetypeId[];
  spawnTimer: number;
  spawned: number;
  wipes: number;
  squadAlive: boolean;
  banner: string;
  bannerTime: number;
  /** B1 hook: entity id of the current wave's boss (0 = none). */
  boss: EntityId;
  /** core-rush: pads placed for this match; fractional hold points not yet in the score. */
  padsReady: boolean;
  holdAcc: [number, number];
  /** base-assault: balls, stands and rings placed for this match. */
  ballsReady: boolean;
  /** slab: zone placed for this match; the team counted as holding and the seconds it has held since (Godot
   *  hold_acc: starts over whenever the holder changes); overtime and its seconds; the tick the match ended. */
  slabReady: boolean;
  slabHolder: TeamId | -1;
  slabHold: number;
  overtime: boolean;
  overtimeT: number;
  endedTick: number;
}

function roomMode(sim: Sim): string | undefined {
  return (sim.state.room as { mode?: string } | undefined)?.mode;
}

function overrides(sim: Sim): MatchConfigOverrides {
  return (sim.state.matchConfig as MatchConfigOverrides | undefined) ?? {};
}

export function skirmishConfig(sim: Sim): SkirmishConfig {
  return { ...SKIRMISH, ...overrides(sim).skirmish };
}

export function tdmConfig(sim: Sim): TdmConfig {
  return { ...TDM, ...overrides(sim).tdm };
}

function stateOf(sim: Sim): MatchState {
  return sim.state.match as MatchState;
}

function rulesOf(sim: Sim): MatchRules {
  return sim.state.rules as MatchRules;
}

function init(sim: Sim, mode: string): MatchRuntime {
  const rt: MatchRuntime = {
    mode, clock: 0, intermission: false, queue: [], spawnTimer: 0, spawned: 0, wipes: 0, squadAlive: false, banner: '', bannerTime: 0, boss: 0,
    padsReady: false, holdAcc: [0, 0], ballsReady: false, slabReady: false, slabHolder: -1, slabHold: 0, overtime: false, overtimeT: 0, endedTick: 0,
  };
  sim.state.matchRt = rt;
  const ms: MatchState = { mode, phase: 'warmup', timeLeft: 0, score: [0, 0], objective: '', wave: 0, winner: -1 };
  sim.state.match = ms;
  const rules: MatchRules = { combatLive: false, respawn: [true, mode !== 'yard-skirmish', true] };
  sim.state.rules = rules;
  rt.clock = mode === 'team-deathmatch' ? tdmConfig(sim).warmup : mode === 'core-rush' ? coreRushConfig(sim).warmup
    : mode === 'base-assault' ? baseAssaultConfig(sim).warmup : mode === 'slab' ? slabConfig(sim).timeLimit : skirmishConfig(sim).warmup;
  ms.timeLeft = rt.clock;
  if (mode === 'slab') { ms.phase = 'live'; ms.objective = SLAB_TEXT.hold; rules.combatLive = true; } // Godot: no warm-up
  return rt;
}

function addScore(sim: Sim, team: TeamId, pts: number, reason: string): void {
  const ms = stateOf(sim);
  if (team !== Team.Corgis && team !== Team.Cats) return;
  ms.score[team] += pts;
  sim.emit({ e: 'score', team, pts, reason });
}

function characters(sim: Sim): SimEntity[] {
  const out: SimEntity[] = [];
  for (const e of sim.entities.values()) if (e.char) out.push(e);
  return out;
}

/** Restart: clear wave enemies and vehicles, bring every player/bot back at a spawn, reset scores. */
function restart(sim: Sim, rt: MatchRuntime): void {
  const remove: EntityId[] = [];
  for (const e of sim.entities.values()) if (e.char && e.combat?.pve) remove.push(e.id);
  for (const id of remove) sim.removeEntity(id);
  clearVehicles(sim); // Q3 P2-2: no pilotless plane from the last match crashing into this one
  resetBaseAssault(sim); // G4a: every ball home, no carrier keeps EFlag.Carrier into the new match (no-op in other modes)
  for (const e of characters(sim)) respawnNow(sim, e, undefined, true);
  const ms = stateOf(sim);
  ms.score[0] = 0; ms.score[1] = 0;
  sim.emit({ e: 'score', team: Team.Corgis, pts: 0, reason: 'reset' });
  sim.emit({ e: 'score', team: Team.Cats, pts: 0, reason: 'reset' });
  combatBus(sim).kills.length = 0;
  const fresh = init(sim, rt.mode);
  Object.assign(rt, fresh);
  sim.state.matchRt = rt;
}

function endMatch(sim: Sim, rt: MatchRuntime, winner: TeamId | -1, text: string, hold: number): void {
  const ms = stateOf(sim);
  ms.phase = 'ended';
  ms.winner = winner;
  ms.objective = text;
  rt.clock = hold;
  ms.timeLeft = hold;
  rulesOf(sim).combatLive = false;
  if (winner === Team.Corgis || winner === Team.Cats) sim.emit({ e: 'score', team: winner, pts: 0, reason: 'win' });
}

// ------------------------------------------------------------------ team deathmatch

function updateTdm(sim: Sim, rt: MatchRuntime, dt: number, kills: KillRecord[]): void {
  const cfg = tdmConfig(sim);
  const ms = stateOf(sim);
  const rules = rulesOf(sim);
  rt.clock -= dt;
  if (ms.phase === 'warmup') {
    rules.combatLive = false;
    ms.objective = `Warm-up — fight starts in ${Math.max(1, Math.ceil(rt.clock))}`;
    if (rt.clock <= 0) {
      ms.phase = 'live';
      rt.clock = cfg.timeLimit;
      rules.combatLive = true;
    }
  } else if (ms.phase === 'live') {
    for (const k of kills) {
      if (k.killerTeam !== -1 && k.killerTeam !== k.victimTeam) addScore(sim, k.killerTeam, 1, 'kill');
    }
    ms.objective = `Team Deathmatch — first to ${cfg.killLimit}`;
    const [c, k] = ms.score;
    if (c >= cfg.killLimit || k >= cfg.killLimit || rt.clock <= 0) {
      const winner: TeamId | -1 = c > k ? Team.Corgis : k > c ? Team.Cats : -1;
      const text = winner === Team.Corgis ? `Corgis win ${c}–${k}!` : winner === Team.Cats ? `Cats win ${k}–${c}!` : `Draw ${c}–${k}!`;
      endMatch(sim, rt, winner, text, cfg.endedHold);
    }
  } else if (rt.clock <= 0) {
    restart(sim, rt);
    return;
  }
  ms.timeLeft = Math.max(0, rt.clock);
}

// ------------------------------------------------------------------ core rush

function updateCoreRush(sim: Sim, rt: MatchRuntime, dt: number): void {
  const cfg = coreRushConfig(sim);
  const ms = stateOf(sim);
  const rules = rulesOf(sim);
  if (!rt.padsReady) { setupCorePads(sim); rt.padsReady = true; } // a restart re-inits rt: pads go back to neutral
  rt.clock -= dt;
  if (ms.phase === 'warmup') {
    rules.combatLive = false;
    ms.objective = `Core Rush — take the pads in ${Math.max(1, Math.ceil(rt.clock))}`;
    if (rt.clock <= 0) {
      ms.phase = 'live';
      rt.clock = cfg.timeLimit;
      rules.combatLive = true;
    }
  } else if (ms.phase === 'live') {
    const r = stepCorePads(sim, dt, cfg);
    for (const [t, i] of r.captured) addScore(sim, t, cfg.captureBonus, `took pad ${CORE_PAD_LABELS[i] ?? i}`);
    for (const t of [Team.Corgis, Team.Cats] as const) {
      // held pads trickle points in silently (the HUD score counter shows them; no toast per point)
      rt.holdAcc[t] += r.held[t] * cfg.holdRate * dt;
      const whole = Math.floor(rt.holdAcc[t]);
      if (whole > 0) { ms.score[t] += whole; rt.holdAcc[t] -= whole; }
    }
    ms.objective = `Core Rush — hold the pads · first to ${cfg.scoreLimit}`;
    const [c, k] = ms.score;
    if (c >= cfg.scoreLimit || k >= cfg.scoreLimit || rt.clock <= 0) {
      const winner: TeamId | -1 = c > k ? Team.Corgis : k > c ? Team.Cats : -1;
      const text = winner === Team.Corgis ? `Corgis hold the yard ${c}–${k}!` : winner === Team.Cats ? `Cats hold the yard ${k}–${c}!` : `Draw ${c}–${k}!`;
      endMatch(sim, rt, winner, text, cfg.endedHold);
    }
  } else if (rt.clock <= 0) {
    restart(sim, rt);
    setupCorePads(sim); // back to neutral on the restart tick itself
    rt.padsReady = true;
    return;
  }
  ms.timeLeft = Math.max(0, rt.clock);
}

// ------------------------------------------------------------------ base assault (G4a)

function updateBaseAssault(sim: Sim, rt: MatchRuntime, dt: number): void {
  const cfg = baseAssaultConfig(sim);
  const ms = stateOf(sim);
  const rules = rulesOf(sim);
  if (!rt.ballsReady) { setupBaseAssault(sim); rt.ballsReady = true; } // a restart re-inits rt: balls go home
  rt.clock -= dt;
  if (ms.phase === 'warmup') {
    rules.combatLive = false;
    stepBaseAssault(sim, false, cfg);
    ms.objective = `Base Assault — steal their ball in ${Math.max(1, Math.ceil(rt.clock))}`;
    if (rt.clock <= 0) {
      ms.phase = 'live';
      rt.clock = cfg.timeLimit;
      rules.combatLive = true;
    }
  } else if (ms.phase === 'live') {
    const r = stepBaseAssault(sim, true, cfg);
    for (const t of r.captures) addScore(sim, t, 1, BA_REASON.captured);
    const relief = (sim.state.baseAssault as { relief?: boolean } | undefined)?.relief;
    ms.objective = relief ? 'STALEMATE — any carrier can capture!' : `Base Assault — steal their ball · first to ${cfg.captureLimit}`;
    const [c, k] = ms.score;
    if (c >= cfg.captureLimit || k >= cfg.captureLimit || rt.clock <= 0) {
      const winner: TeamId | -1 = c > k ? Team.Corgis : k > c ? Team.Cats : -1;
      const text = winner === Team.Corgis ? `Corgis take the war ${c}–${k}!` : winner === Team.Cats ? `Cats take the war ${k}–${c}!` : `Draw ${c}–${k}!`;
      endMatch(sim, rt, winner, text, cfg.endedHold);
      stepBaseAssault(sim, false, cfg); // the horn: every ball goes home, no carrier runs slowed through the result
    }
  } else if (rt.clock <= 0) {
    restart(sim, rt);
    setupBaseAssault(sim); // balls home on the restart tick itself (idempotent: the same entities, reset)
    rt.ballsReady = true;
    return;
  } else stepBaseAssault(sim, false, cfg);
  ms.timeLeft = Math.max(0, rt.clock);
}

// ------------------------------------------------------------------ slab (W13)

function humanPresent(sim: Sim): boolean {
  for (const e of sim.entities.values()) if (e.char && e.kind === EntityKind.Player) return true;
  return false;
}

/** A human pressed Reload this tick (R / pad X: the rematch request while the result is up). */
function rematchAsked(sim: Sim): boolean {
  for (const e of sim.entities.values()) if (e.char && e.kind === EntityKind.Player && pressed(e, Btn.Reload)) return true;
  return false;
}

/**
 * The Godot match flow (match.gd _physics_process: step_score, clock, _check_end), every tick while live: who holds the
 * slab, a point per full second held alone, the clock, then the end checks (first to winScore; at the horn the leader;
 * tied: overtime until someone leads, a draw after overtimeMax). Ended: the result holds until a human's rematch.
 */
function updateSlab(sim: Sim, rt: MatchRuntime, dt: number, kills: KillRecord[]): void {
  const cfg = slabConfig(sim);
  const ms = stateOf(sim);
  slabRespawnDelay(sim, kills, cfg);
  let start = false;
  if (!rt.slabReady) {
    // the first match (Godot start_match): every pet to its start slot (slabRespawns places them), shielded
    setupSlab(sim, cfg);
    assignSlabSlots(sim);
    for (const e of characters(sim)) respawnNow(sim, e, undefined, true);
    rt.slabReady = true;
    start = true;
  }
  if (ms.phase === 'ended') {
    rt.clock -= dt; // only a bots-only room counts this down; ms.timeLeft stays at the final clock
    const humans = humanPresent(sim);
    const rematch = humans ? sim.tick - rt.endedTick >= ticksOf(cfg.rematchDelay) && rematchAsked(sim) : rt.clock <= 1e-6;
    if (rematch) {
      restart(sim, rt); // 0-0, every pet respawned (slabRespawns: at its start slot), live at the full clock
      resetSlab(sim);
      assignSlabSlots(sim);
      rt.slabReady = true;
      start = true;
    }
    slabRespawns(sim, cfg, start);
    return;
  }
  rulesOf(sim).combatLive = true;
  ms.phase = 'live';
  const st = evaluateSlab(sim, cfg);
  if (st.holder !== rt.slabHolder) { rt.slabHolder = st.holder; rt.slabHold = 0; }
  if (st.holder === Team.Corgis || st.holder === Team.Cats) {
    rt.slabHold += dt;
    // a point per full second held alone, added silently (the HUD's score counter shows them; no toast per point)
    while (rt.slabHold >= 1 - 1e-6) { rt.slabHold -= 1; ms.score[st.holder] += 1; }
  }
  if (rt.overtime) rt.overtimeT += dt;
  else { rt.clock = Math.max(0, rt.clock - dt); if (rt.clock < 1e-6) rt.clock = 0; }
  const [c, k] = ms.score;
  const leader: TeamId | -1 = c > k ? Team.Corgis : k > c ? Team.Cats : -1;
  let end: TeamId | -1 | null = null;
  if (c >= cfg.winScore) end = Team.Corgis;
  else if (k >= cfg.winScore) end = Team.Cats;
  else if (!rt.overtime && rt.clock <= 0) { if (leader !== -1) end = leader; else rt.overtime = true; }
  else if (rt.overtime) { if (leader !== -1) end = leader; else if (rt.overtimeT >= cfg.overtimeMax - 1e-6) end = -1; }
  const otLeft = cfg.overtimeMax - rt.overtimeT;
  ms.timeLeft = rt.overtime ? (otLeft < 1e-6 ? 0 : otLeft) : rt.clock;
  ms.objective = rt.overtime ? SLAB_TEXT.overtime : SLAB_TEXT.hold;
  if (end !== null) {
    const timeLeft = ms.timeLeft;
    endMatch(sim, rt, end, end === -1 ? SLAB_TEXT.draw : SLAB_TEXT.win[end], cfg.endedHold);
    ms.timeLeft = timeLeft; // frozen at the final clock (the result holds for a human's rematch, not a countdown)
    rt.endedTick = sim.tick;
  }
  slabRespawns(sim, cfg, start);
}

// ------------------------------------------------------------------ yard skirmish

function waveScale(cfg: SkirmishConfig, corgis: number): number {
  return Math.min(cfg.scaleMax, Math.max(cfg.scaleMin, cfg.scaleBase + cfg.scalePerCorgi * corgis));
}

function startWave(sim: Sim, rt: MatchRuntime, cfg: SkirmishConfig, n: number): void {
  const ms = stateOf(sim);
  ms.wave = n;
  ms.phase = 'live';
  rt.intermission = false;
  rulesOf(sim).combatLive = true;
  let corgis = 0;
  for (const e of sim.entities.values()) if (e.char && e.team === Team.Corgis) corgis++;
  const scale = waveScale(cfg, corgis);
  const def = cfg.waves[n - 1];
  const q: ArchetypeId[] = [];
  for (const [id, count] of Object.entries(def.counts) as [ArchetypeId, number][]) {
    const c = Math.max(count > 0 ? 1 : 0, Math.round(count * scale));
    for (let i = 0; i < c; i++) q.push(id);
  }
  // room-slot cats (team-fill bots) fight as part of every wave and count toward its size: the PvE
  // spawns shrink by their number (grunts first, never below half the wave). They don't respawn mid-wave.
  let roomCats = 0;
  for (const e of sim.entities.values()) {
    if (!e.char || e.team !== Team.Cats || e.combat?.pve || e.kind !== EntityKind.Bot) continue;
    if (e.dead) respawnNow(sim, e);
    roomCats++;
  }
  let cut = q.length - Math.max(Math.ceil(q.length / 2), q.length - roomCats);
  for (const trim of ['grunt', 'kitten', 'alley_raider', 'sniper', 'tabby_heavy', 'brute'] as ArchetypeId[]) { // W9 K3 squads trim before the heavy hitters
    for (let i = q.length - 1; i >= 0 && cut > 0; i--) if (q[i] === trim) { q.splice(i, 1); cut--; }
  }
  for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(sim.rng() * (i + 1)); const t = q[i]; q[i] = q[j]; q[j] = t; }
  rt.queue = q;
  rt.spawnTimer = 0;
  rt.boss = def.boss ? spawnBoss(sim, undefined, { boss: def.boss }).id : 0; // B1 hook
  ms.timeLeft = 0;
  ms.objective = waveObjective(cfg, n, q.length + roomCats + (rt.boss ? 1 : 0));
}

function waveObjective(cfg: SkirmishConfig, wave: number, left: number): string {
  const label = cfg.waves[wave - 1]?.label;
  const head = label ? `${label} (${wave}/${cfg.waves.length})` : `Wave ${wave}/${cfg.waves.length}`;
  return `${head} — ${left} ${left === 1 ? 'cat' : 'cats'} left`;
}

/** Spawn one PvE wave enemy near a cat spawn (nav-checked jitter so squads don't stack). */
export function spawnWaveEnemy(sim: Sim, arch: ArchetypeId, index: number): SimEntity {
  const A = ARCHETYPES[arch];
  const spawns = sim.worldData.spawns.filter((s) => s.team === Team.Cats);
  const list = spawns.length ? spawns : sim.worldData.spawns;
  const s = list[Math.floor(sim.rng() * list.length) % list.length];
  let x = s.x, y = s.y, z = s.z;
  const g = simNavGrid(sim);
  if (g) {
    const c = nearestWalkable(g, s.x + (sim.rng() - 0.5) * 6, s.z + (sim.rng() - 0.5) * 6, 4);
    if (c >= 0) { x = cellX(g, c); z = cellZ(g, c); y = g.ground[c] + 0.05; }
  }
  const e = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Cats, species: Species.Cat, cls: A.cls, name: `${A.label} ${index}`, x, y, z, yaw: s.yaw });
  ensureCombat(e);
  e.combat!.pve = true;
  applyArchetype(e, arch);
  return e;
}

function updateSkirmish(sim: Sim, rt: MatchRuntime, dt: number, kills: KillRecord[]): void {
  const cfg = skirmishConfig(sim);
  const ms = stateOf(sim);
  const rules = rulesOf(sim);
  const total = cfg.waves.length;
  for (const k of kills) {
    if (ms.phase === 'ended') break;
    if (k.killerTeam === Team.Corgis && k.victimTeam === Team.Cats) addScore(sim, Team.Corgis, 1, 'kill');
    else if (k.killerTeam === Team.Cats && k.victimTeam === Team.Corgis) addScore(sim, Team.Cats, 1, 'kill');
  }
  let corgis = 0, corgisAlive = 0, catsAlive = 0;
  for (const e of sim.entities.values()) {
    if (!e.char) continue;
    if (e.team === Team.Corgis) { corgis++; if (!e.dead) corgisAlive++; }
    else if (e.team === Team.Cats && !e.dead && e.kind === EntityKind.Bot) catsAlive++; // humans on the cat side don't hold waves open
  }
  if (rt.bannerTime > 0) rt.bannerTime -= dt;
  rt.clock -= dt;

  if (ms.phase === 'warmup') {
    rules.combatLive = false;
    ms.timeLeft = Math.max(0, rt.clock);
    ms.objective = `Defend the yard! Cats attack in ${Math.max(1, Math.ceil(rt.clock))}`;
    if (rt.clock <= 0) startWave(sim, rt, cfg, 1);
    rt.squadAlive = corgisAlive > 0;
    return;
  }
  if (ms.phase === 'ended') {
    ms.timeLeft = Math.max(0, rt.clock);
    if (rt.clock <= 0) restart(sim, rt);
    return;
  }

  // squad wipe: every corgi down at the same moment
  if (corgis > 0 && corgisAlive === 0 && rt.squadAlive) {
    rt.wipes++;
    if (rt.wipes > cfg.wipeLives) {
      endMatch(sim, rt, Team.Cats, `The cats took the yard! (wave ${ms.wave}/${total})`, cfg.endedHold);
      rt.squadAlive = false;
      return;
    }
    const left = cfg.wipeLives - rt.wipes + 1;
    rt.banner = `Squad down! ${left} ${left === 1 ? 'retry' : 'retries'} left`;
    rt.bannerTime = 4;
  }
  rt.squadAlive = corgisAlive > 0;

  if (rt.intermission) {
    ms.timeLeft = Math.max(0, rt.clock);
    ms.objective = `Wave ${ms.wave} cleared! Wave ${ms.wave + 1}${ms.wave + 1 === total ? ' (FINAL)' : ''} in ${Math.max(1, Math.ceil(rt.clock))}`;
    if (rt.clock <= 0) startWave(sim, rt, cfg, ms.wave + 1);
    return;
  }

  // B1 hook: a wave boss holds the wave open; its defeat clears the wave (the rest of the cats retreat)
  if (rt.boss) {
    const boss = bossWaveStatus(sim, rt.boss);
    if (boss.alive) catsAlive++;
    else {
      if (boss.score > 0) addScore(sim, Team.Corgis, boss.score, 'boss');
      rt.boss = 0;
      rt.queue.length = 0;
      catsAlive = 0;
    }
  }

  // spawn the wave in batches while under the alive cap
  rt.spawnTimer -= dt;
  const cap = cfg.waves[ms.wave - 1]?.maxAlive ?? cfg.maxAlive;
  if (rt.queue.length && rt.spawnTimer <= 0 && catsAlive < cap) {
    const n = Math.min(cfg.spawnBatch, rt.queue.length, cap - catsAlive);
    for (let i = 0; i < n; i++) spawnWaveEnemy(sim, rt.queue.shift()!, ++rt.spawned);
    catsAlive += n;
    rt.spawnTimer = cfg.spawnInterval;
  }
  const left = catsAlive + rt.queue.length;
  if (left === 0) {
    addScore(sim, Team.Corgis, cfg.waveBonus, 'wave');
    if (ms.wave >= total) {
      endMatch(sim, rt, Team.Corgis, 'Yard secured! The cats retreat.', cfg.endedHold);
      return;
    }
    rt.intermission = true;
    rt.clock = cfg.intermission;
    ms.timeLeft = rt.clock;
    return;
  }
  ms.timeLeft = 0;
  ms.objective = rt.bannerTime > 0 ? `${rt.banner} · ${left} cats left` : waveObjective(cfg, ms.wave, left);
}

export const matchSystem: SimSystem = {
  name: 'match',
  order: 800,
  update(sim, dt) {
    let mode = roomMode(sim);
    if (mode === 'boss-rush') {
      // Test/showcase mode: a skirmish whose only wave is the boss (?mode=boss-rush or ?boss=1).
      sim.state.matchConfig ??= bossRushConfig((sim.state.room as { boss?: string } | undefined)?.boss);
      (sim.state.room as { mode: string }).mode = mode = 'yard-skirmish';
    }
    const kills = combatBus(sim).kills;
    if (mode !== 'yard-skirmish' && mode !== 'team-deathmatch' && mode !== 'core-rush' && mode !== 'base-assault' && mode !== 'slab') return;
    let rt = sim.state.matchRt as MatchRuntime | undefined;
    if (!rt || rt.mode !== mode) rt = init(sim, mode);
    const batch = kills.splice(0);
    if (mode === 'team-deathmatch') updateTdm(sim, rt, dt, batch);
    else if (mode === 'core-rush') updateCoreRush(sim, rt, dt);
    else if (mode === 'base-assault') updateBaseAssault(sim, rt, dt);
    else if (mode === 'slab') { updateSlab(sim, rt, dt, batch); return; } // no mission chain in this mode
    else updateSkirmish(sim, rt, dt, batch);
    // S1 mission chain: its points join the team score; its current step rides the objective line
    // ("Wave 2/5 — 6 cats left · ▶ Hold the trampoline 12/20s (2/3)"). The fold is idempotent.
    const ms = stateOf(sim);
    const [c, k] = takeObjectiveScore(sim);
    ms.score[0] += c; ms.score[1] += k;
    if (ms.phase === 'live') ms.objective = foldObjectiveText(ms.objective, objectiveState(sim));
  },
};

export function matchSystems(): SimSystem[] {
  return [slabKitSystem, matchSystem];
}

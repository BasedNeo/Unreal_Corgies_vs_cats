// Bot brain: a small hierarchical FSM that writes an InputCmd every tick — the same authority path
// as a human player (it never moves entities directly).
//
//   patrol ──heard/hurt──▶ alert ──sees enemy──▶ engage ──low hp──▶ cover ──healed/timeout──▶ regroup ─▶ patrol
//      ▲                     │                    │  (approach / hold band + strafe / back off,
//      └──────timeout────────┘          lost ◀────┘   reaction delay, settling aim error, bursts)
//
// Perception: sight cone + range + world line-of-sight (10 Hz, staggered), cloak reveal range,
// hearing via combat noise (weapon fire, explosions, barks) and "who just shot me".
// World (G1): weather scales the sight range (storm x0.6) and tall-grass concealment (e.conceal from the
// world lane's conceal system) shrinks the distance a target is spotted at (5 m fully hidden, x2 when
// already tracked; halved concealment when the observer's eye is > 3.5 m above the target's feet).
// Spotter Drones (C2): enemies carrying EFlag.Spotted are known to the other team — a room bot with nobody in sight
// goes to investigate the nearest spotted enemy (it still needs its own line of sight to shoot); with nothing better
// to do it shoots down enemy drones in sight. A room bot also goes to help a human teammate under fire nearby.
// Class abilities and objective play (Upgrade Cores, the objective chain) are decided in tactics.ts.
// Adventure (A2): with nobody to fight, a bot whose tactics picked a prop target (a tuna stack in a destroy step)
// holds a standoff spot and shoots it (propShot); sentries walk their posts (tac.walk).
// Climbing (N1, nav-links.ts): a goal on a deck (a roof) or a bot standing on one is planned across grids through
// validated links (climb routes, stepping stones, drops); the bot runs a link leg by leg (legStep: hops, double jumps,
// held Jump), retries a missed hop once, then marks the link costly (it takes the other route or gives up); a bot
// shot on a link abandons it (contested). While on a link nothing else moves it (no strafing, detours, separation,
// aim-walk or random hops). Perches (N1): a bot told to hold one (holdPerch; marksman room bots in TDM and
// yard-skirmish pick an unclaimed WorldData perch by themselves) climbs there and holds it: from the perch it snipes
// without chasing, retreating or regrouping.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { Btn, type InputCmd } from '../../shared/input';
import { EFlag, EntityKind, type EntityId } from '../../shared/types';
import { angleDelta } from '../../shared/math';
import { TICK_HZ } from '../../shared/constants';
import { WEAPONS, AIM_RAY, type WeaponDef, type WeaponId } from '../../shared/content/weapons';
import { ABILITIES, abilityDef } from '../../shared/content/abilities';
import { combatBus, ensureCombat, equipWeapon, eyeHeight, characterHeight, isStealthed } from '../combat/state';
import { worldLineClear } from '../combat/geometry';
import { ARCHETYPES, archetypeForClass, detectionRange, type Archetype, type ArchetypeId } from './archetypes';
import { type NavGrid, cellIndex, cellX, cellZ, findPath, isWalkable, lineWalkable, nearestWalkable, randomCell } from './nav';
import {
  CONTEST_PENALTY, MISS_PENALTY, type LegOut, type NavBot, type NavLinkSet, type NavSpot, type ProfileLinks, clearMiss, countMiss,
  createNavBot, gridOf, legStep, locate, navLinksFor, penalize, planNav, profileLinks, resetLegRun,
} from './nav-links';
import { concealLevel, concealRevealRange, weatherSightMult } from '../world/env';
import { abilityEntities, friendlyShotPass } from '../combat/ability-core';
import { DRONE } from '../combat/ability-tuning';
import { destructDistance } from '../../shared/world/destructibles';
import { surfaceAt } from '../../shared/world/queries';
import type { Destructible } from '../../shared/world/world-types';
import {
  abilityIntent, buddyInTrouble, createTactics, objectiveInteract, pushBand, raiderAir, skipGoal, updateObjectiveGoal, type TacticsState,
  vehicleThink,
} from './tactics';
import { CARRIER_FOCUS, ballRunIgnores } from './base-assault-ai';
import {
  createOrdnanceBot, keepClearOfOwnBlast, makeIntent, ordnanceBotThink, throwApproachBand, type OrdnanceBot, type OrdnanceIntent,
} from './ordnance-ai'; // W9 X4 hook
import { ordnanceArcWorld } from '../combat/ordnance'; // W9 X4 hook

export type AiMode = 'patrol' | 'alert' | 'engage' | 'cover' | 'regroup';

export interface AiState {
  arch: ArchetypeId;
  mode: AiMode;
  modeTick: number;
  // perception
  nextPerceive: number;
  target: EntityId;
  visible: boolean;
  lastSeenTick: number;
  lkx: number; lky: number; lkz: number;
  reaction: number;
  trackTime: number;
  aimHead: boolean;
  alertX: number; alertZ: number;
  lastHurtTick: number;
  lastNoiseTick: number;
  // aim
  yaw: number; pitch: number;
  errX: number; errY: number; errTX: number; errTY: number; errTimer: number;
  // trigger
  burstLeft: number;
  pause: number;
  semiTimer: number;
  chargeHold: number;
  telegraph: number;
  lastShots: number;
  // locomotion
  hasGoal: boolean;
  goalX: number; goalZ: number;
  path: number[];
  pathIdx: number;
  pathGX: number; pathGZ: number;
  repathTick: number;
  waitUntil: number;
  strafeDir: number;
  strafeTimer: number;
  wantMove: boolean;
  lastX: number; lastZ: number;
  odo: number;
  checkTimer: number;
  /** Seconds the bot has wanted to move without moving (telemetry reads this). */
  stuck: number;
  detourUntil: number;
  detourX: number; detourZ: number;
  /** W9 F2: no step-away (unhug) before this tick (one per UNHUG_EVERY: a second stuck there takes a random detour). */
  unhugAt: number;
  coverCooldown: number;
  wasDead: boolean;
  jumpNext: boolean;
  seq: number;
  /** When true the brain writes into `out` instead of e.input (used by headless net-bot clients). */
  external: boolean;
  out: InputCmd;
  /** Ability and objective tactics (tactics.ts). */
  tac: TacticsState;
  /** N1: the grid `path` was planned on (the ground grid or a deck); link runner + plan cache; the perch to hold. */
  pathGrid: NavGrid | null;
  nav: NavBot;
  perch: PerchGoal | null;
  /** Next tick a marksman room bot looks for a perch. */
  perchNext: number;
  /** W9 X4 hook: the throw sequencer (ordnance-ai.ts), its per-tick intent, and the enemies perceived this pass. */
  ord: OrdnanceBot; ordIntent: OrdnanceIntent; seen: SimEntity[];
}

/** N1: a spot a bot climbs to and holds (feet position, facing yaw). */
export interface PerchGoal {
  id: string;
  x: number; y: number; z: number;
  yaw: number;
  /** Picked by the bot itself (marksman room bots) rather than told (holdPerch). */
  auto: boolean;
  /** Tick it was set / first reached (-1 = not yet); unreachable: plain patrol until pauseUntil, then try again. */
  since: number;
  reachedAt: number;
  pauseUntil: number;
}

declare module '../entity' {
  interface SimEntity {
    ai?: AiState;
  }
}

export interface AiContext {
  grid: NavGrid | null;
  /** Living characters this tick (shared scratch). */
  chars: SimEntity[];
  /** Path searches left this tick (spreads A* cost over ticks). */
  pathBudget: number;
}

const PERCEIVE_EVERY = 6;
const DEG = Math.PI / 180;
const CLOAK_REVEAL = ABILITIES.shadow_cloak.revealRange;

export function createBrain(arch: ArchetypeId, yaw: number): AiState {
  return {
    arch, mode: 'patrol', modeTick: 0, nextPerceive: 0, target: -1, visible: false, lastSeenTick: -9999,
    lkx: 0, lky: 0, lkz: 0, reaction: 0, trackTime: 0, aimHead: false, alertX: 0, alertZ: 0,
    lastHurtTick: -9999, lastNoiseTick: -9999, yaw, pitch: 0, errX: 0, errY: 0, errTX: 0, errTY: 0, errTimer: 0,
    burstLeft: 0, pause: 0, semiTimer: 0, chargeHold: 0, telegraph: 0, lastShots: 0,
    hasGoal: false, goalX: 0, goalZ: 0, path: [], pathIdx: 0, pathGX: 0, pathGZ: 0, repathTick: 0, waitUntil: 0,
    strafeDir: 1, strafeTimer: 0, wantMove: false, lastX: 0, lastZ: 0, odo: 0, checkTimer: 0, stuck: 0,
    detourUntil: 0, detourX: 0, detourZ: 0, unhugAt: 0, coverCooldown: 0, wasDead: false, jumpNext: false, seq: 0, external: false,
    out: { seq: 0, mx: 0, mz: 0, yaw, pitch: 0, buttons: 0, rt: 0 },
    tac: createTactics(),
    pathGrid: null, nav: createNavBot(), perch: null, perchNext: 0,
    ord: createOrdnanceBot(0), ordIntent: makeIntent(), seen: [], // W9 X4 hook
  };
}

/**
 * Turn a freshly spawned character into an archetype: weapon, max hp, speed and brain. Used by
 * wave spawns (PvE cats) and lazily for room bots (profile from their class kit).
 */
export function applyArchetype(e: SimEntity, id: ArchetypeId, opts: { external?: boolean } = {}): void {
  const a = ARCHETYPES[id];
  ensureCombat(e);
  if (a.weapon) equipWeapon(e, a.weapon);
  if (a.hp && e.health) { e.health.max = a.hp; e.health.hp = a.hp; }
  if (a.speedMult !== 1 && e.char) {
    const m = e.char.move;
    e.char.move = { ...m, walkSpeed: m.walkSpeed * a.speedMult, runSpeed: m.runSpeed * a.speedMult, sprintSpeed: m.sprintSpeed * a.speedMult };
  }
  e.ai = createBrain(id, e.yaw);
  e.ai.ord = createOrdnanceBot(e.id); // W9 X4 hook: re-plans staggered by id
  e.ai.lastX = e.pos.x; e.ai.lastZ = e.pos.z;
  e.ai.external = !!opts.external;
}

function rand(sim: Sim, a: number, b: number): number {
  return a + (b - a) * sim.rng();
}

function setMode(sim: Sim, ai: AiState, m: AiMode): void {
  if (ai.mode === m) return;
  ai.mode = m;
  ai.modeTick = sim.tick;
  ai.hasGoal = false;
  ai.path.length = 0;
  ai.waitUntil = 0;
}

function validTarget(sim: Sim, id: EntityId): SimEntity | null {
  if (id < 0) return null;
  const t = sim.entities.get(id);
  return t && !t.dead && t.char ? t : null;
}

// ---------------------------------------------------------------- perception

function perceive(sim: Sim, e: SimEntity, ai: AiState, a: Archetype, ctx: AiContext): void {
  const ex = e.pos.x, ey = e.pos.y + eyeHeight(e), ez = e.pos.z;
  const fx = -Math.sin(ai.yaw), fz = -Math.cos(ai.yaw);
  const cosFov = Math.cos(a.fovHalf), cosTrack = Math.cos(100 * DEG);
  const attacker = e.health && sim.tick - e.health.lastDamageTick < 120 ? e.health.lastAttacker : -1;
  let best: SimEntity | null = null, bestScore = Infinity;
  const sight = detectionRange(a, weatherSightMult(sim)); // W11 F3: the sentry cone's far arc is drawn at this
  ai.seen.length = 0; // W9 X4 hook
  for (const t of ctx.chars) {
    if (t.team === e.team || t === e) continue;
    const dx = t.pos.x - ex, dz = t.pos.z - ez;
    const dist = Math.hypot(dx, dz);
    if (dist > sight) continue;
    if (isStealthed(sim, t) && dist > CLOAK_REVEAL) continue;
    const tracking = t.id === ai.target && sim.tick - ai.lastSeenTick < 90;
    const hidden = concealLevel(t) * (ey - t.pos.y > 3.5 ? 0.5 : 1);   // lookouts see into the grass
    if (hidden > 0 && dist > concealRevealRange(hidden, sight, tracking)) continue;
    const c = dist > 1e-3 ? (dx * fx + dz * fz) / dist : 1;
    if (dist > 5 && c < (tracking || t.id === attacker ? cosTrack : cosFov)) continue;
    const h = characterHeight(t);
    const pass = friendlyShotPass(sim, e.team); // bots see (and so shoot) through their own team's barriers
    if (!worldLineClear(sim, ex, ey, ez, t.pos.x, t.pos.y + h * 0.55, t.pos.z, pass) && !worldLineClear(sim, ex, ey, ez, t.pos.x, t.pos.y + h * 0.9, t.pos.z, pass)) continue;
    ai.seen.push(t); // W9 X4 hook: every enemy it perceives (throws only at pets it can see)
    const score = dist - (tracking ? 10 : 0) - (t.id === attacker ? 8 : 0) - (t.flags & EFlag.Carrier ? CARRIER_FOCUS : 0); // G4b
    if (score < bestScore) { bestScore = score; best = t; }
  }
  if (best) {
    if (best.id !== ai.target) {
      const quickSwitch = ai.visible && sim.tick - ai.lastSeenTick < 30;
      ai.target = best.id;
      ai.reaction = quickSwitch ? rand(sim, 0.12, 0.2) : rand(sim, a.reaction[0], a.reaction[1]);
      ai.trackTime = 0;
      ai.aimHead = sim.rng() < a.headChance;
      ai.burstLeft = 0; ai.pause = 0;
    }
    ai.visible = true;
    ai.lastSeenTick = sim.tick;
    ai.lkx = best.pos.x; ai.lky = best.pos.y; ai.lkz = best.pos.z;
  } else {
    ai.visible = false;
    // an enemy our drones spot: go and look (no line of sight needed to know where; still needed to shoot)
    // (room bots only: PvE waves already hunt the squad; knowing more would only make them harder)
    if (!e.combat?.pve && (ai.mode === 'patrol' || ai.mode === 'regroup' || (ai.mode === 'alert' && sim.tick - ai.modeTick > 60))) {
      let spot: SimEntity | null = null, sd = sight * 1.2;
      for (const t of ctx.chars) {
        if (t.team === e.team || !(t.flags & EFlag.Spotted)) continue;
        const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
        if (d < sd) { sd = d; spot = t; }
      }
      if (spot) {
        ai.alertX = spot.pos.x; ai.alertZ = spot.pos.z;
        if (ai.mode !== 'alert') setMode(sim, ai, 'alert'); else ai.modeTick = sim.tick;
        return;
      }
      // a human teammate under fire nearby: go help (toward whoever is shooting them)
      if (ai.mode !== 'alert') {
        const buddy = buddyInTrouble(sim, e, ctx.chars);
        const foe = buddy ? sim.entities.get(buddy.health!.lastAttacker) : undefined;
        if (buddy && foe && foe.char && !foe.dead && foe.team !== e.team) {
          ai.alertX = (buddy.pos.x + foe.pos.x) * 0.5; ai.alertZ = (buddy.pos.z + foe.pos.z) * 0.5;
          setMode(sim, ai, 'alert');
          return;
        }
      }
    }
  }
  // hearing: gunfire / explosions / barks from the other team within earshot
  const noise = combatBus(sim).noise;
  for (let i = noise.length - 1; i >= 0; i--) {
    const n = noise[i];
    if (n.tick <= ai.lastNoiseTick) break;
    if (n.team === e.team) continue;
    const d = Math.hypot(n.x - e.pos.x, n.z - e.pos.z);
    if (d > n.radius) continue;
    ai.lastNoiseTick = n.tick;
    if (ai.mode === 'patrol' || ai.mode === 'regroup' || (ai.mode === 'alert' && !ai.visible)) {
      ai.alertX = n.x + rand(sim, -2, 2); ai.alertZ = n.z + rand(sim, -2, 2);
      setMode(sim, ai, 'alert');
    }
    break;
  }
}

// ---------------------------------------------------------------- locomotion helpers

const mv = { x: 0, z: 0, sprint: false };

function requestPath(sim: Sim, e: SimEntity, ai: AiState, ctx: AiContext, g: NavGrid, gx: number, gz: number): void {
  if (ctx.pathBudget <= 0 || sim.tick < ai.detourUntil) return;
  ctx.pathBudget--;
  findPath(g, e.pos.x, e.pos.z, gx, gz, ai.path);
  ai.pathGrid = g;
  ai.pathIdx = 0;
  ai.pathGX = gx; ai.pathGZ = gz;
  ai.repathTick = sim.tick + 150 + (e.id % 30);
}

/**
 * Desired move direction toward (gx, gz) along the nav path. Returns remaining distance. `gy` (N1): the goal's feet
 * height when it may stand on a deck (a roof perch); a goal on another grid, or a bot standing on a deck, is steered
 * through the link layer (linkSteer); everything else takes the ground grid exactly as before.
 */
function steerTo(sim: Sim, e: SimEntity, ai: AiState, ctx: AiContext, gx: number, gz: number, moving: boolean, gy = NaN): number {
  const d = linkSteer(sim, e, ai, ctx, gx, gy, gz, moving);
  if (d >= 0) return d;
  return steerOn(sim, e, ai, ctx, ctx.grid!, gx, gz, moving);
}

/** Path following on one grid (the ground grid, or the deck the bot stands on). */
function steerOn(sim: Sim, e: SimEntity, ai: AiState, ctx: AiContext, g: NavGrid, gx: number, gz: number, moving: boolean): number {
  const dist = Math.hypot(gx - e.pos.x, gz - e.pos.z);
  mv.x = 0; mv.z = 0;
  if (dist < 0.6) return dist;
  if (ai.pathGrid !== g) { ai.path.length = 0; ai.pathGrid = g; }
  const stale = !ai.path.length || Math.hypot(gx - ai.pathGX, gz - ai.pathGZ) > (moving ? 3 : 1.5) || sim.tick >= ai.repathTick;
  if (stale) {
    if (dist < 25 && lineWalkable(g, e.pos.x, e.pos.z, gx, gz, true)) {
      ai.path.length = 0; ai.path.push(gx, gz); ai.pathIdx = 0; ai.pathGX = gx; ai.pathGZ = gz; ai.repathTick = sim.tick + 45;
    } else requestPath(sim, e, ai, ctx, g, gx, gz);
  }
  let tx = gx, tz = gz;
  if (ai.path.length) {
    while (ai.pathIdx < ai.path.length / 2 - 1) {
      const wx = ai.path[ai.pathIdx * 2], wz = ai.path[ai.pathIdx * 2 + 1];
      if (Math.hypot(wx - e.pos.x, wz - e.pos.z) > 0.8) break;
      // pass a waypoint only once the next one is in a straight walkable line from here: heading for it from up to
      // 0.8 m off the path clipped round obstacles (the trampoline), where the character controller can deadlock (N1)
      const n = ai.pathIdx + 1;
      if (!lineWalkable(g, e.pos.x, e.pos.z, ai.path[n * 2], ai.path[n * 2 + 1])) break;
      ai.pathIdx++;
    }
    tx = ai.path[ai.pathIdx * 2]; tz = ai.path[ai.pathIdx * 2 + 1];
    // skip ahead when the next corner is directly walkable (smooths around corners)
    const n = ai.pathIdx + 1;
    if (n < ai.path.length / 2 && lineWalkable(g, e.pos.x, e.pos.z, ai.path[n * 2], ai.path[n * 2 + 1], true)) {
      ai.pathIdx = n; tx = ai.path[n * 2]; tz = ai.path[n * 2 + 1];
    }
  } else if (!lineWalkable(g, e.pos.x, e.pos.z, gx, gz)) {
    return dist; // waiting for a path this tick
  }
  const dx = tx - e.pos.x, dz = tz - e.pos.z;
  const l = Math.hypot(dx, dz);
  if (l > 1e-3) { mv.x = dx / l; mv.z = dz / l; }
  return dist;
}

/** W9 F2: body-wide walkable line: the centre line and both sides BODY_SIDE off it. A centre line grazing a blocked
 *  row's edge passes, the body's side does not: The Lot's diagonal scaffold brace dips to the heap beside a walkable
 *  row (the probe at the cell centre clears it), and a stuck detour along that row pinned a cat under it 6.5 s. */
const BODY_SIDE = 0.3;
function bodyLineWalkable(g: NavGrid, ax: number, az: number, bx: number, bz: number): boolean {
  const l = Math.hypot(bx - ax, bz - az);
  if (l < 1e-3) return isWalkable(g, bx, bz);
  const px = (-(bz - az) / l) * BODY_SIDE, pz = ((bx - ax) / l) * BODY_SIDE;
  return lineWalkable(g, ax, az, bx, bz) && lineWalkable(g, ax + px, az + pz, bx + px, bz + pz) && lineWalkable(g, ax - px, az - pz, bx - px, bz - pz);
}

/**
 * W9 F2: a bot whose body (not its centre) overlaps a closed cell is pressed against something the grid keeps in the
 * next cell: a diagonal brace or a low beam the character controller cannot slide along (its underside is a ceiling).
 * Step UNHUG m straight away from the closed side, then re-plan from there: the new path's line clears it, where a
 * random detour along the same row grazes it again (The Lot: a cat under the scaffold's facade brace, 6.5 s).
 * Writes the detour target into unhugOut (UNHUG + 0.5 m out: the detour ends 0.5 m short of it).
 */
const UNHUG = 0.5, UNHUG_R = 0.4, UNHUG_EVERY = 5 * TICK_HZ;
const unhugOut = { x: 0, z: 0 };
function unhug(g: NavGrid, e: SimEntity): boolean {
  let ax = 0, az = 0;
  for (let k = 0; k < 8; k++) {
    const sx = Math.cos((k * Math.PI) / 4), sz = Math.sin((k * Math.PI) / 4);
    if (!isWalkable(g, e.pos.x + sx * UNHUG_R, e.pos.z + sz * UNHUG_R)) { ax -= sx; az -= sz; }
  }
  const l = Math.hypot(ax, az);
  if (l < 1e-3) return false;
  const sx = e.pos.x + (ax / l) * UNHUG, sz = e.pos.z + (az / l) * UNHUG;
  if (!isWalkable(g, sx, sz) || !lineWalkable(g, e.pos.x, e.pos.z, sx, sz)) return false;
  unhugOut.x = e.pos.x + (ax / l) * (UNHUG + 0.5); unhugOut.z = e.pos.z + (az / l) * (UNHUG + 0.5);
  return true;
}

/** Can the bot step ~1 m in direction (dx, dz)? */
function openAhead(g: NavGrid, e: SimEntity, dx: number, dz: number): boolean {
  return lineWalkable(g, e.pos.x, e.pos.z, e.pos.x + dx * 1.1, e.pos.z + dz * 1.1);
}

// ---------------------------------------------------------------- N1: links, decks, perches

const navOut: LegOut = { x: 0, z: 0, buttons: 0 };
const here: NavSpot = { grid: -1, cell: -1 };
/** A grounded bot this far over the ground grid stands on something (a deck, a crate stack): it plans across grids. */
const ELEV = 1.5;
/** Unreachable perch (no clean route): patrol the ground this long before trying again. */
const PERCH_PAUSE = 20 * TICK_HZ;
const PERCH_MODES = new Set(['team-deathmatch', 'yard-skirmish']);
const perchPlan = { link: -1, cost: Infinity, penalty: 0 };

/** Ground-grid height under (x, z). */
function groundY(g: NavGrid, x: number, z: number): number {
  const c = cellIndex(g, x, z);
  return c >= 0 ? g.ground[c] : 0;
}

/** The grid the bot stands on: a deck while it is up on one, else the ground grid. */
function hereGrid(sim: Sim, e: SimEntity, ai: AiState, g: NavGrid): NavGrid {
  if (!ai.nav.elev) return g;
  const set = navLinksFor(sim);
  if (!set) return g;
  const at = locate(set, g, e.pos.x, e.pos.y, e.pos.z, here);
  return at.grid > 0 ? gridOf(set, g, at.grid) : g;
}

/**
 * Steering across grids (N1). Returns the distance left (>= 0, mv written) when the link layer steered, or -1 when
 * the plain ground-grid steering applies (bot and goal both on the ground grid: the unchanged fast path).
 */
function linkSteer(sim: Sim, e: SimEntity, ai: AiState, ctx: AiContext, gx: number, gy: number, gz: number, moving: boolean): number {
  const nb = ai.nav, g0 = ctx.grid!;
  if (e.flags & EFlag.Mounted) { if (nb.link >= 0) endLink(ai); return -1; }   // seated: the vehicle moves it
  const elevGoal = Number.isFinite(gy) && gy - groundY(g0, gx, gz) > ELEV;
  if (nb.link < 0 && !nb.elev && !elevGoal) return -1;
  const set = e.char ? navLinksFor(sim) : null;
  if (!set) return -1;
  const prof = profileLinks(sim, set, e.char!.move);
  if (nb.link >= 0) return runLink(sim, e, ai, set, prof);
  // an elevated goal stands on the surface under it (a zone's minY floor is below its roof)
  const goalY = !elevGoal ? groundY(g0, gx, gz) : Math.max(gy, surfaceAt(sim.worldData, gx, gz, gy + 1).y);
  if (sim.tick - nb.planTick > 90 || Math.hypot(gx - nb.planGX, gz - nb.planGZ) > 1.5 || Math.abs(goalY - nb.planGY) > 1) {
    planNav(set, prof, g0, e.pos.x, e.pos.y, e.pos.z, gx, goalY, gz, nb.pen, sim.tick, nb.plan);
    nb.planTick = sim.tick; nb.planGX = gx; nb.planGY = goalY; nb.planGZ = gz;
  }
  const at = locate(set, g0, e.pos.x, e.pos.y, e.pos.z, here, true);
  if (at.grid < 0) return -1;
  const grid = gridOf(set, g0, at.grid);
  const L = nb.plan.link >= 0 ? set.links[nb.plan.link] : null;
  if (!L) {
    if (at.grid === 0 || !Number.isFinite(nb.plan.cost)) return -1;       // ground grid (or no route): as before
    return steerOn(sim, e, ai, ctx, grid, gx, gz, moving);               // across the deck
  }
  const c = e.char!;
  const dx = L.from.x - e.pos.x, dz = L.from.z - e.pos.z, d = Math.hypot(dx, dz);
  if (at.grid === L.fromGrid && d < 2.5 && lineWalkable(grid, e.pos.x, e.pos.z, L.from.x, L.from.z)) {
    // line up on the entry and stop on it (links are validated from rest)
    nb.fine = sim.tick;
    if (d < 0.45 && c.grounded && Math.abs(e.pos.y - L.from.y) < 0.4 && Math.hypot(e.vel.x, e.vel.z) < 1.5) {
      nb.link = L.id; nb.leg = 0; resetLegRun(nb.run); nb.linkStart = sim.tick;
      return runLink(sim, e, ai, set, prof);
    }
    const k = Math.min(1, (Math.sqrt(2 * c.move.groundDecel * Math.max(0, d - 0.1)) * 0.8) / c.move.runSpeed);
    mv.x = d > 1e-3 ? (dx / d) * k : 0; mv.z = d > 1e-3 ? (dz / d) * k : 0;
    return Math.max(2, nb.plan.cost);
  }
  steerOn(sim, e, ai, ctx, grid, L.from.x, L.from.z, moving);
  return Math.max(2, nb.plan.cost);
}

/** One tick of the link the bot is on: the leg controller drives mv + Jump; misses and contested links end it. */
function runLink(sim: Sim, e: SimEntity, ai: AiState, set: NavLinkSet, prof: ProfileLinks): number {
  const nb = ai.nav, L = set.links[nb.link], params = prof.params[nb.link];
  nb.fine = sim.tick;
  nb.linkTick = sim.tick;
  mv.x = 0; mv.z = 0;
  if (!params) { endLink(ai); return 2; }
  if (e.health && e.health.lastDamageTick > nb.linkStart) {
    // contested: shot while climbing — give the link up for a while and fight from here (the ground, soon)
    nb.contested++;
    penalize(nb, L.id, sim.tick, CONTEST_PENALTY);
    endLink(ai);
    return 2;
  }
  const from = nb.leg === 0 ? L.from : L.legs[nb.leg - 1];
  const res = legStep(e, from, L.legs[nb.leg], params[nb.leg], nb.run, navOut);
  mv.x = navOut.x; mv.z = navOut.z; nb.buttons = navOut.buttons;
  if (res === 1) {
    if (++nb.leg >= L.legs.length) { nb.done++; clearMiss(nb, L.id); endLink(ai); } else resetLegRun(nb.run);
  } else if (res === -1) {
    // a missed hop: the next plan retries the link once; a second miss marks it costly (fall back)
    nb.misses++;
    if (countMiss(nb, L.id) >= 2) { clearMiss(nb, L.id); penalize(nb, L.id, sim.tick, MISS_PENALTY); nb.fallbacks++; }
    endLink(ai);
  }
  return Math.max(2, nb.plan.cost);
}

function endLink(ai: AiState): void {
  ai.nav.link = -1;
  ai.nav.planTick = -9999;
  ai.path.length = 0;
}

/** On the perch it holds (reached, within 2 m, same level)? */
function isPerched(sim: Sim, e: SimEntity, ai: AiState): boolean {
  const p = ai.perch;
  return !!p && p.reachedAt >= 0 && sim.tick >= p.pauseUntil && Math.hypot(p.x - e.pos.x, p.z - e.pos.z) < 2 && Math.abs(p.y - e.pos.y) < 0.6;
}

/** Patrol toward / hold the perch. Returns the yaw to look along (NaN = the move direction). */
function perchPatrol(sim: Sim, e: SimEntity, ai: AiState, ctx: AiContext): number {
  const p = ai.perch!, c = e.char!;
  const dx = p.x - e.pos.x, dz = p.z - e.pos.z, d = Math.hypot(dx, dz), dy = Math.abs(e.pos.y - p.y);
  if (d < 0.9 && dy < 0.45 && c.grounded) {
    if (p.reachedAt < 0) p.reachedAt = sim.tick;
    mv.x = 0; mv.z = 0;
    return p.yaw + Math.sin(sim.tick * 0.012 + e.id) * 0.55;                 // scan the perch's lanes
  }
  if (d < 2.5 && dy < 0.45 && ai.nav.link < 0) {
    // on the perch's surface: straight in, braking onto the spot
    const k = Math.min(1, (Math.sqrt(2 * c.move.groundDecel * Math.max(0, d - 0.1)) * 0.8) / c.move.runSpeed);
    mv.x = (dx / d) * k; mv.z = (dz / d) * k;
    ai.nav.fine = sim.tick;
    return NaN;
  }
  const left = steerTo(sim, e, ai, ctx, p.x, p.z, false, p.y);
  mv.sprint = left > 12 && ai.nav.link < 0;
  // no clean route (none validated, or every one marked costly after misses / getting shot): the ground for a while
  const nb = ai.nav;
  if (nb.planTick === sim.tick && nb.link < 0 && (!Number.isFinite(nb.plan.cost) || nb.plan.penalty > 0)) {
    p.pauseUntil = sim.tick + PERCH_PAUSE;
    p.reachedAt = -1;
  }
  return NaN;
}

/** Marksman room bots in TDM / yard-skirmish take the cheapest perch no teammate holds (checked every 4 s; not before
 *  1 s, so building and validating the links never lands on the nav grid's build tick). */
function autoPerch(sim: Sim, e: SimEntity, ai: AiState, ctx: AiContext): void {
  if (ai.perch || sim.tick < ai.perchNext || sim.tick < TICK_HZ) return;
  ai.perchNext = sim.tick + 240;
  if (ai.arch !== 'marksman' || e.kind !== EntityKind.Bot || e.combat?.pve || ai.external || ai.tac.goal || !e.char) return;
  const perches = sim.worldData.perches;
  if (!perches?.length || !PERCH_MODES.has((sim.state.room as { mode?: string } | undefined)?.mode ?? '')) return;
  const set = navLinksFor(sim);
  if (!set) return;
  const prof = profileLinks(sim, set, e.char.move);
  let best: (typeof perches)[number] | null = null, bc = Infinity;
  for (const p of perches) {
    if (ctx.chars.some((t) => t !== e && t.team === e.team && t.ai?.perch?.id === p.id)) continue;
    planNav(set, prof, ctx.grid!, e.pos.x, e.pos.y, e.pos.z, p.x, p.y, p.z, ai.nav.pen, sim.tick, perchPlan);
    if (perchPlan.penalty > 0 || perchPlan.cost >= bc) continue;
    bc = perchPlan.cost; best = p;
  }
  if (best) ai.perch = { id: best.id, x: best.x, y: best.y, z: best.z, yaw: best.yaw, auto: true, since: sim.tick, reachedAt: -1, pauseUntil: 0 };
}

/**
 * N1 API: tell a bot to climb to and hold a perch (feet position; `yaw` = the facing it scans around), or clear it
 * (null). The bot walks there in patrol when its tactics have no objective for it; see the header.
 */
export function holdPerch(sim: Sim, e: SimEntity, p: { id?: string; x: number; y: number; z: number; yaw?: number } | null): void {
  const ai = ensureBrain(e);
  ai.perch = p ? { id: p.id ?? 'perch', x: p.x, y: p.y, z: p.z, yaw: p.yaw ?? ai.yaw, auto: false, since: sim.tick, reachedAt: -1, pauseUntil: 0 } : null;
}

function pickPatrolGoal(sim: Sim, e: SimEntity, ai: AiState, ctx: AiContext): void {
  const g = ctx.grid!;
  const here = nearestWalkable(g, e.pos.x, e.pos.z, 4);
  const region = here >= 0 ? g.region[here] : g.mainRegion;
  const hunt = e.combat?.pve ? 0.8 : 0.55;
  let cell = -1;
  if (sim.rng() < hunt) {
    let n = 0;
    for (const t of ctx.chars) if (t.team !== e.team) n++;
    if (n > 0) {
      let k = Math.floor(sim.rng() * n);
      for (const t of ctx.chars) {
        if (t.team === e.team) continue;
        if (k-- === 0) { cell = randomCell(g, sim.rng, region, t.pos.x, t.pos.z, e.combat?.pve ? 7 : 12); break; }
      }
    }
  }
  if (cell < 0) cell = randomCell(g, sim.rng, region, e.pos.x * 0.5, e.pos.z * 0.5, sim.worldData.halfExtent * 0.6, 4);
  if (cell < 0) cell = randomCell(g, sim.rng, region, e.pos.x, e.pos.z, 15, 3);
  if (cell < 0) return;
  ai.goalX = cellX(g, cell); ai.goalZ = cellZ(g, cell); ai.hasGoal = true;
}

function findCover(sim: Sim, e: SimEntity, ai: AiState, ctx: AiContext, tx: number, ty: number, tz: number): boolean {
  const g = ctx.grid!;
  const here = nearestWalkable(g, e.pos.x, e.pos.z, 4);
  if (here < 0) return false;
  const region = g.region[here];
  const away = Math.atan2(e.pos.z - tz, e.pos.x - tx);
  let best = -1, bestScore = Infinity;
  for (const r of [3, 6, 9, 13]) {
    for (let k = -3; k <= 3; k++) {
      const a = away + k * 0.5 + rand(sim, -0.15, 0.15);
      const c = nearestWalkable(g, e.pos.x + Math.cos(a) * r, e.pos.z + Math.sin(a) * r, 1, region);
      if (c < 0) continue;
      const cx = cellX(g, c), cz = cellZ(g, c);
      const cy = g.ground[c] + 0.7;
      if (worldLineClear(sim, tx, ty, tz, cx, cy, cz)) continue; // exposed
      const score = r + Math.abs(k) * 0.8 - Math.min(8, Math.hypot(cx - tx, cz - tz)) * 0.3;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (best >= 0) break;
  }
  if (best < 0) {
    const c = nearestWalkable(g, e.pos.x + Math.cos(away) * 12, e.pos.z + Math.sin(away) * 12, 5, region);
    if (c < 0) return false;
    best = c;
  }
  ai.goalX = cellX(g, best); ai.goalZ = cellZ(g, best); ai.hasGoal = true;
  return true;
}

// ---------------------------------------------------------------- aiming

function ballisticPitch(speed: number, gravity: number, d: number, y: number): number {
  const g = -gravity;
  if (g < 1e-3) return Math.atan2(y, d);
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * d * d + 2 * y * v2);
  if (disc < 0) return Math.PI / 4;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * d));
}

const aimOut = { yaw: 0, pitch: 0, dist: 0 };
/** Ideal yaw/pitch from the bot's eye to where it wants its shot to go (with lead for projectiles). */
function idealAim(e: SimEntity, t: SimEntity, def: WeaponDef, a: Archetype, head: boolean, shoulder: number): typeof aimOut {
  const ex = e.pos.x, ey = e.pos.y + eyeHeight(e), ez = e.pos.z;
  const h = characterHeight(t);
  let px = t.pos.x, py = t.pos.y + h * (head ? 0.9 : 0.55), pz = t.pos.z;
  // lead: cancel the bot's own aim smoothing lag, plus flight time for projectiles
  let lead = 0.85 / a.aimLambda;
  if (def.projectile) lead += (Math.hypot(px - ex, pz - ez) / def.projectile.speed) * 0.75;
  px += t.vel.x * lead; pz += t.vel.z * lead;
  if (def.projectile && def.projectile.explodeRadius > 0) py = t.pos.y + 0.3; // splash: aim at the feet
  const dx = px - ex, dy = py - ey, dz = pz - ez;
  const d = Math.hypot(dx, dz);
  aimOut.yaw = Math.atan2(-dx, -dz);
  aimOut.pitch = def.projectile ? ballisticPitch(def.projectile.speed, def.projectile.gravity, d, dy) : Math.atan2(dy, d);
  aimOut.dist = Math.hypot(d, dy);
  if (shoulder > 0 && !def.projectile) {
    // Camera-aimed characters (a headless client driving a player slot): the authority traces the
    // over-the-shoulder crosshair ray, so aim that ray (from pivot + shoulder offset) at the point.
    let yaw = aimOut.yaw;
    for (let i = 0; i < 3; i++) {
      const ox = e.pos.x + Math.cos(yaw) * shoulder, oz = e.pos.z - Math.sin(yaw) * shoulder;
      yaw = Math.atan2(-(px - ox), -(pz - oz));
    }
    const ox = e.pos.x + Math.cos(yaw) * shoulder, oz = e.pos.z - Math.sin(yaw) * shoulder;
    aimOut.yaw = yaw;
    aimOut.pitch = Math.atan2(py - (e.pos.y + AIM_RAY.pivotHeight), Math.hypot(px - ox, pz - oz));
  }
  return aimOut;
}

function turnToward(ai: AiState, a: Archetype, yaw: number, pitch: number, dt: number, rateMult = 1): void {
  const k = 1 - Math.exp(-a.aimLambda * dt);
  const maxStep = a.turnRate * rateMult * dt;
  let dy = angleDelta(ai.yaw, yaw) * k;
  if (dy > maxStep) dy = maxStep; else if (dy < -maxStep) dy = -maxStep;
  ai.yaw += dy;
  let dp = (pitch - ai.pitch) * k;
  if (dp > maxStep) dp = maxStep; else if (dp < -maxStep) dp = -maxStep;
  ai.pitch = Math.max(-1.4, Math.min(1.4, ai.pitch + dp));
}

// ---------------------------------------------------------------- think

export function think(sim: Sim, e: SimEntity, ai: AiState, ctx: AiContext, dt: number): void {
  const inp = ai.external ? ai.out : e.input;
  inp.seq = ++ai.seq;
  inp.rt = 0;
  if (e.dead) {
    inp.mx = 0; inp.mz = 0; inp.buttons = 0;
    ai.wasDead = true;
    return;
  }
  ensureCombat(e);
  if (ai.wasDead) {
    ai.wasDead = false;
    ai.target = -1; ai.visible = false; ai.stuck = 0; ai.odo = 0;
    ai.yaw = e.yaw; ai.pitch = 0;
    ai.lastX = e.pos.x; ai.lastZ = e.pos.z;
    setMode(sim, ai, 'patrol');
    ai.nav.link = -1; ai.nav.elev = false; ai.nav.planTick = -9999;
    if (ai.perch) ai.perch.reachedAt = -1;
  }
  const g = ctx.grid;
  if (!g) { inp.mx = 0; inp.mz = 0; inp.buttons = 0; inp.yaw = ai.yaw; inp.pitch = ai.pitch; return; }
  // N1: standing on a deck / a crate stack? (only re-judged on the ground: a jump on the lawn is no deck)
  if (e.char?.grounded) ai.nav.elev = e.pos.y - groundY(g, e.pos.x, e.pos.z) > ELEV;
  ai.nav.buttons = 0;
  const a = ARCHETYPES[ai.arch];
  const w = e.wpn!;
  const def = WEAPONS[w.id as WeaponId];

  if (sim.tick >= ai.nextPerceive) {
    perceive(sim, e, ai, a, ctx);
    ai.nextPerceive = sim.tick + PERCEIVE_EVERY;
  }
  // got shot: turn toward the attacker and investigate
  const hp = e.health!;
  if (hp.lastDamageTick > ai.lastHurtTick) {
    ai.lastHurtTick = hp.lastDamageTick;
    const src = sim.entities.get(hp.lastAttacker);
    if (src && src.team !== e.team && ai.mode !== 'engage' && ai.mode !== 'cover') {
      ai.alertX = src.pos.x; ai.alertZ = src.pos.z;
      setMode(sim, ai, 'alert');
    }
  }
  let target = validTarget(sim, ai.target);
  if (!target) { ai.target = -1; ai.visible = false; }
  if (target && ai.visible && ai.mode !== 'cover') setMode(sim, ai, 'engage');
  if (target && ai.visible) { ai.reaction -= dt; ai.trackTime += dt; } else ai.trackTime = Math.max(0, ai.trackTime - dt * 2);
  ai.coverCooldown = Math.max(0, ai.coverCooldown - dt);
  // B2a: a seated bot drives, a bot on its way to a kart boards it (tactics.ts vehicleThink); the on-foot FSM sleeps
  if (vehicleThink(sim, e, ai, ctx, inp, dt)) return;

  let buttons = 0;
  let lookYaw = ai.yaw, lookPitch = 0, aiming = false;
  mv.x = 0; mv.z = 0; mv.sprint = false;
  ai.wantMove = false;
  const modeAge = (sim.tick - ai.modeTick) / TICK_HZ;

  updateObjectiveGoal(sim, e, ai.tac, g, ctx.chars); // (re-evaluated every 0.5 s; followed in patrol)
  if (ai.mode === 'patrol') autoPerch(sim, e, ai, ctx);
  const perched = isPerched(sim, e, ai);
  /** On its way to a perch it holds (not paused): it keeps going instead of chasing or investigating. */
  const perchBound = !perched && !!ai.perch && sim.tick >= ai.perch.pauseUntil && !ai.tac.goal;
  const hg = hereGrid(sim, e, ai, g);   // the grid under the bot (a deck while up on one) for strafe/back-off checks
  // G4b: a ball run (a carrier going home, a push for the enemy ball, a return) keeps running through fights and noises
  const ballRun = ai.mode !== 'patrol' && ai.tac.goal === 'ball' && !!ai.tac.ba?.rush;
  if (ballRun) { steerTo(sim, e, ai, ctx, ai.tac.gx, ai.tac.gz, true, ai.tac.gy); mv.sprint = true; if (mv.x || mv.z) lookYaw = Math.atan2(-mv.x, -mv.z); }
  else switch (ai.mode) {
    case 'patrol': {
      const t = ai.tac;
      if (t.goal) {
        // objective / Upgrade Core: walk there (straight in over the last few meters to a core), interact, hold
        // (N1: t.gy on a deck — a roof zone, the Rooftop Hangar — climbs there; with no route it walks below, as before)
        const d = steerTo(sim, e, ai, ctx, t.gx, t.gz, false, t.goal === 'post' ? NaN : t.gy);
        if ((t.goal === 'core' || t.goal === 'ball') && d < 4.5 && d > 0.2) { mv.x = (t.gx - e.pos.x) / d; mv.z = (t.gz - e.pos.z) / d; }
        if (t.goal === 'step' && t.interact && d < 1.5) {
          // from the closest walkable cell, straight in until the point is in reach
          const dc = Math.hypot(t.cx - e.pos.x, t.cz - e.pos.z);
          if (dc > t.gr - 0.5) { mv.x = (t.cx - e.pos.x) / dc; mv.z = (t.cz - e.pos.z) / dc; }
        }
        if (t.hold && d < 1.2) { mv.x = 0; mv.z = 0; }
        mv.sprint = d > 12;
        if (t.prop >= 0) {
          // A2: a prop to shoot: back off out of our own splash, else stand where it is in sight and in the band
          const dp = Math.hypot(t.px - e.pos.x, t.pz - e.pos.z);
          if (dp < t.propMin && dp > 1e-3) {
            const ox = (e.pos.x - t.px) / dp, oz = (e.pos.z - t.pz) / dp;
            if (openAhead(g, e, ox, oz)) { mv.x = ox; mv.z = oz; mv.sprint = false; }
          } else if (t.propSeen) { mv.x = 0; mv.z = 0; }
        }
        if (t.walk) {
          // A2: pacing a post, not rushing it
          const m = e.char!.move, k = m.runSpeed > 0 ? m.walkSpeed / m.runSpeed : 1;
          mv.x *= k; mv.z *= k; mv.sprint = false;
        }
        if (t.goal === 'core' && sim.tick - t.goalSince > 25 * TICK_HZ) skipGoal(sim, t);
        if (mv.x || mv.z) lookYaw = Math.atan2(-mv.x, -mv.z);
        ai.hasGoal = false;
        break;
      }
      if (ai.perch && sim.tick >= ai.perch.pauseUntil) {
        // N1: climb to the perch and hold it, scanning its lanes
        const look = perchPatrol(sim, e, ai, ctx);
        lookYaw = Number.isFinite(look) ? look : mv.x || mv.z ? Math.atan2(-mv.x, -mv.z) : lookYaw;
        ai.hasGoal = false;
        break;
      }
      if (!ai.hasGoal && sim.tick >= ai.waitUntil) pickPatrolGoal(sim, e, ai, ctx);
      if (ai.hasGoal) {
        const d = steerTo(sim, e, ai, ctx, ai.goalX, ai.goalZ, false);
        if (d < 1.5) { ai.hasGoal = false; ai.waitUntil = sim.tick + Math.round(rand(sim, 20, 70)); }
        mv.sprint = d > 18;
      }
      if (mv.x || mv.z) lookYaw = Math.atan2(-mv.x, -mv.z);
      break;
    }
    case 'alert': {
      if (perched || perchBound) {
        // a sniper on (or on its way to) its perch looks toward the noise instead of going there
        if (perchBound) perchPatrol(sim, e, ai, ctx);
        lookYaw = Math.atan2(-(ai.alertX - e.pos.x), -(ai.alertZ - e.pos.z));
        if (modeAge > 4) setMode(sim, ai, 'patrol');
        break;
      }
      const d = steerTo(sim, e, ai, ctx, ai.alertX, ai.alertZ, false);
      lookYaw = Math.atan2(-(ai.alertX - e.pos.x), -(ai.alertZ - e.pos.z));
      if (d < 2 || modeAge > 7) setMode(sim, ai, 'patrol');
      mv.sprint = d > 14;
      break;
    }
    case 'engage': {
      if (!target || sim.tick - ai.lastSeenTick > 150) {
        ai.alertX = ai.lkx; ai.alertZ = ai.lkz;
        setMode(sim, ai, target ? 'alert' : 'patrol');
        break;
      }
      if (a.retreatHp > 0 && hp.hp < hp.max * a.retreatHp && ai.coverCooldown <= 0 && !perched) {
        if (findCover(sim, e, ai, ctx, target.pos.x, target.pos.y + 1.1, target.pos.z)) {
          setMode(sim, ai, 'cover');
          ai.hasGoal = true;
          ai.coverCooldown = 14;
          if (e.abil && abilityDef(e.abil.id)?.kind === 'cloak' && e.abil.cooldown <= 0 && !(e.prevButtons & Btn.Ability)) buttons |= Btn.Ability;
          break;
        }
      }
      const [minR, maxR] = pushBand(sim, ai.tac) ?? throwBand(sim, e, ai, target) ?? a.preferRange ?? def.aiRange; // F2: a grenadier closes on a camper
      const tx = ai.visible ? target.pos.x : ai.lkx, tz = ai.visible ? target.pos.z : ai.lkz;
      const dx = tx - e.pos.x, dz = tz - e.pos.z;
      const dist = Math.hypot(dx, dz) || 1e-3;
      const ux = dx / dist, uz = dz / dist;
      if (perched) {
        // N1: snipe from the perch: no chasing, no backing off the roof
      } else if (perchBound && (!ai.visible || dist > maxR)) {
        perchPatrol(sim, e, ai, ctx);   // out of its band: the perch is the better spot to fight from
      } else if (!ai.visible || dist > maxR) {
        steerTo(sim, e, ai, ctx, tx, tz, true);
        // close-range kits sprint to close the gap; ranged kits only sprint when far out of band
        mv.sprint = maxR < 12 ? dist > maxR + 2 : dist > maxR + 10 && a.adsBeyond > 0;
      } else {
        ai.strafeTimer -= dt;
        if (ai.strafeTimer <= 0) { ai.strafeDir = sim.rng() < 0.5 ? -1 : 1; ai.strafeTimer = rand(sim, 0.7, 1.8); }
        let sx = -uz * ai.strafeDir * a.strafe, sz = ux * ai.strafeDir * a.strafe;
        if (!openAhead(hg, e, sx, sz)) { ai.strafeDir = -ai.strafeDir; sx = -sx; sz = -sz; ai.strafeTimer = rand(sim, 0.6, 1.2); }
        let fx = 0, fz = 0;
        if (dist < minR) { fx = -ux; fz = -uz; } else if (dist > (minR + maxR) * 0.5 + 4) { fx = ux * 0.35; fz = uz * 0.35; }
        if ((fx || fz) && !openAhead(hg, e, fx, fz)) { fx = 0; fz = 0; }
        if (!openAhead(hg, e, sx, sz)) { sx = 0; sz = 0; }
        mv.x = sx + fx; mv.z = sz + fz;
        const l = Math.hypot(mv.x, mv.z);
        if (l > 1) { mv.x /= l; mv.z /= l; }
        if (a.jumpRate > 0 && sim.rng() < a.jumpRate * dt) ai.jumpNext = true;
      }
      // the objective runner keeps heading for an interact step while trading shots with a distant enemy
      if (ai.tac.goal === 'step' && ai.tac.interact && dist > 18) {
        steerTo(sim, e, ai, ctx, ai.tac.gx, ai.tac.gz, true);
        mv.sprint = false;
      }
      break;
    }
    case 'cover': {
      const threat = target ?? null;
      const d = ai.hasGoal ? steerTo(sim, e, ai, ctx, ai.goalX, ai.goalZ, false) : 0;
      mv.sprint = d > 3;
      if (threat) lookYaw = Math.atan2(-(threat.pos.x - e.pos.x), -(threat.pos.z - e.pos.z));
      const close = threat && ai.visible && Math.hypot(threat.pos.x - e.pos.x, threat.pos.z - e.pos.z) < 7;
      if (close) setMode(sim, ai, 'engage');
      else if ((hp.hp >= hp.max * 0.6 && sim.tick >= ai.tac.holdUntil) || modeAge > 6) setMode(sim, ai, 'regroup');
      break;
    }
    case 'regroup': {
      if (perched) { setMode(sim, ai, 'patrol'); break; }
      if (!ai.hasGoal) {
        let best: SimEntity | null = null, bd = Infinity;
        for (const t of ctx.chars) {
          if (t.team !== e.team || t === e) continue;
          const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
          if (d < bd) { bd = d; best = t; }
        }
        if (best && bd > 5) {
          const c = nearestWalkable(g, best.pos.x, best.pos.z, 4);
          if (c >= 0) { ai.goalX = cellX(g, c); ai.goalZ = cellZ(g, c); ai.hasGoal = true; }
        }
        if (!ai.hasGoal) { setMode(sim, ai, 'patrol'); break; }
      }
      const d = steerTo(sim, e, ai, ctx, ai.goalX, ai.goalZ, false);
      if (mv.x || mv.z) lookYaw = Math.atan2(-mv.x, -mv.z);
      mv.sprint = d > 12;
      if (d < 4 || modeAge > 5) setMode(sim, ai, 'patrol');
      break;
    }
  }

  // holding an objective zone: fight, investigate and take cover from inside it; use an interact step in reach
  if (ai.mode !== 'patrol') holdZone(e, ai.tac);
  buttons |= objectiveInteract(sim, e, ai.tac);
  // N1: a link in progress runs every tick whatever the mode (a hop can't pause mid-air); nothing else moves the bot
  if (ai.nav.link >= 0 && (e.flags & EFlag.Mounted)) endLink(ai);
  if (ai.nav.link >= 0 && ai.nav.linkTick !== sim.tick && e.char) {
    const set = navLinksFor(sim);
    if (set) runLink(sim, e, ai, set, profileLinks(sim, set, e.char.move));
  }
  const onLink = ai.nav.fine === sim.tick;

  // ---- class ability (tactics.ts) and the skyraider's glide hops
  {
    const tdist = target ? Math.hypot(target.pos.x - e.pos.x, target.pos.z - e.pos.z) : Infinity;
    const intent = abilityIntent(sim, e, ai.tac, a, g, ctx.chars, {
      target, visible: ai.visible, dist: tdist, mode: ai.mode, modeTick: ai.modeTick, lastSeenTick: ai.lastSeenTick,
      alertX: ai.alertX, alertZ: ai.alertZ, aimYaw: ai.yaw,
    });
    if (intent.retarget) {
      target = intent.retarget;
      if (ai.target !== target.id) { ai.target = target.id; ai.reaction = Math.min(ai.reaction, 0.15); ai.trackTime = 0; }
      ai.lastSeenTick = sim.tick; ai.lkx = target.pos.x; ai.lky = target.pos.y; ai.lkz = target.pos.z;
    }
    if (intent.press) buttons |= Btn.Ability;
    if (intent.cover && ai.mode !== 'cover' && target && !perched && !onLink) {
      let ok = true;
      if (abilityDef(e.abil!.id)?.kind === 'barrier') { ai.goalX = e.pos.x; ai.goalZ = e.pos.z; } // stay behind the new wall
      else ok = findCover(sim, e, ai, ctx, target.pos.x, target.pos.y + 1.1, target.pos.z);
      if (ok) {
        const gx = ai.goalX, gz = ai.goalZ;
        setMode(sim, ai, 'cover');
        ai.goalX = gx; ai.goalZ = gz; ai.hasGoal = true;
        ai.coverCooldown = 10;
        ai.tac.holdUntil = sim.tick + Math.round(2.5 * TICK_HZ);
      }
    }
    if (!onLink) {
      const air = raiderAir(sim, e, ai.tac, ai.mode === 'patrol' && Math.hypot(mv.x, mv.z) > 0.5 && mv.sprint);
      if (air.hop) ai.jumpNext = true;
      buttons |= air.buttons;
    }
  }

  // ---- stuck detection (odometer while wanting to move) + recovery
  ai.wantMove = Math.hypot(mv.x, mv.z) > 0.45;
  ai.odo += Math.hypot(e.pos.x - ai.lastX, e.pos.z - ai.lastZ);
  ai.lastX = e.pos.x; ai.lastZ = e.pos.z;
  ai.checkTimer += dt;
  if (ai.checkTimer >= 0.5) {
    if (ai.wantMove && ai.odo < 0.3) ai.stuck += ai.checkTimer; else ai.stuck = 0;
    ai.checkTimer = 0; ai.odo = 0;
    if (onLink) ai.stuck = 0;   // (a link has its own no-progress rule: legStep)
    if (ai.stuck >= 1 && ai.stuck < 1.6) ai.jumpNext = true;
    if (ai.stuck >= 1.5) {
      // detour: walk straight to a random nearby open cell (of the deck it stands on, if any), then re-plan; prefer
      // one the straight line reaches (from just off the obstacle the bot is wedged against)
      const cur = nearestWalkable(hg, e.pos.x, e.pos.z, 4);
      // wedged in a closed cell (against an obstacle): the nearest open cell is the way out
      const wayOut = cur >= 0 && !isWalkable(hg, e.pos.x, e.pos.z);
      let c = wayOut ? cur : -1, line = -1; // F2: line = the first candidate only the centre line reaches (the fallback)
      for (let k = 0; k < 6 && !wayOut; k++) {
        const cand = randomCell(hg, sim.rng, cur >= 0 ? hg.region[cur] : -1, e.pos.x, e.pos.z, 6, 2.5);
        if (cand < 0) continue;
        if (c < 0) c = cand;
        const cx = cellX(hg, cand), cz = cellZ(hg, cand), l = Math.hypot(cx - e.pos.x, cz - e.pos.z);
        if (l <= 1e-3) continue;
        const ax = e.pos.x + ((cx - e.pos.x) / l) * 0.6, az = e.pos.z + ((cz - e.pos.z) / l) * 0.6;
        if (!lineWalkable(hg, ax, az, cx, cz)) continue;
        if (line < 0) line = cand;
        if (bodyLineWalkable(hg, ax, az, cx, cz)) { line = -1; c = cand; break; } // W9 F2: the body's width clears too
      }
      if (line >= 0) c = line;
      if (c >= 0) { ai.detourX = cellX(hg, c); ai.detourZ = cellZ(hg, c); ai.detourUntil = sim.tick + 70; ai.path.length = 0; }
      if (!wayOut && sim.tick >= ai.unhugAt && unhug(hg, e)) {
        ai.detourX = unhugOut.x; ai.detourZ = unhugOut.z; ai.detourUntil = sim.tick + 70; ai.path.length = 0;
        ai.unhugAt = sim.tick + UNHUG_EVERY;
      }
      if (ai.stuck >= 3) { ai.hasGoal = false; ai.stuck = 0; if (ai.tac.goal) skipGoal(sim, ai.tac); if (ai.mode !== 'engage') setMode(sim, ai, 'patrol'); }
    }
  }
  if (onLink) ai.detourUntil = 0;
  if (sim.tick < ai.detourUntil) {
    const dx = ai.detourX - e.pos.x, dz = ai.detourZ - e.pos.z;
    const l = Math.hypot(dx, dz);
    if (l > 0.5) { mv.x = dx / l; mv.z = dz / l; } else ai.detourUntil = 0;
  }

  // separation from teammates (characters pass through each other; keep squads readable)
  if (!onLink && !perched) for (const t of ctx.chars) {
    if (t === e || t.team !== e.team) continue;
    const dx = e.pos.x - t.pos.x, dz = e.pos.z - t.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 1.2 || d2 < 1e-6 || Math.abs(t.pos.y - e.pos.y) > 1.5) continue;
    const d = Math.sqrt(d2), push = (1.1 - d) * 0.8;
    if (openAhead(hg, e, dx / d, dz / d)) { mv.x += (dx / d) * push; mv.z += (dz / d) * push; }
  }

  // ---- aim + trigger
  if (target && (ai.visible || sim.tick - ai.lastSeenTick < 20) && ai.mode !== 'cover' && !ballRunIgnores(e, ai.tac, target, mv.x, mv.z)) {
    const tdist = Math.hypot(target.pos.x - e.pos.x, target.pos.z - e.pos.z);
    aiming = (tdist > a.adsBeyond || a.telegraph > 0) && !pushBand(sim, ai.tac) && !onLink && !ballRun; // a push (or G4b ball run) runs in, hip-firing; a hop runs at run speed
    const shoulder = e.ownerPid === null ? 0 : aiming ? AIM_RAY.shoulderAim : AIM_RAY.shoulderHip;
    const ia = idealAim(e, target, def, a, ai.aimHead, shoulder);
    ai.errTimer -= dt;
    if (ai.errTimer <= 0) {
      const r = Math.sqrt(sim.rng()), th = sim.rng() * Math.PI * 2;
      ai.errTX = Math.cos(th) * r; ai.errTY = Math.sin(th) * r;
      ai.errTimer = rand(sim, 0.25, 0.55);
    }
    const k = Math.min(1, dt * 5);
    ai.errX += (ai.errTX - ai.errX) * k; ai.errY += (ai.errTY - ai.errY) * k;
    const lateral = Math.abs(target.vel.x * Math.cos(ia.yaw) - target.vel.z * Math.sin(ia.yaw));
    // lobbed/slow projectiles: bots misjudge range and lead like people do (1.8× error)
    const err = (a.aimErrMin + (a.aimErr - a.aimErrMin) * Math.exp(-ai.trackTime / a.aimSettle) + lateral * 0.12 * DEG) * (def.projectile ? 1.8 : 1);
    lookYaw = ia.yaw + ai.errX * err;
    lookPitch = ia.pitch + ai.errY * err * 0.6;
    turnToward(ai, a, lookYaw, lookPitch, dt);
    // fire gate: reaction elapsed, target visible, aligned within the target's angular size, in range
    const aligned = Math.abs(angleDelta(ai.yaw, ia.yaw)) < Math.max(1.2 * DEG, Math.atan2(0.45, ia.dist) * 1.3) + (def.pellets > 1 ? def.spreadHip * 0.6 : 0)
      && Math.abs(ai.pitch - ia.pitch) < Math.max(1.5 * DEG, Math.atan2(0.5, ia.dist) * 1.3) + (def.projectile ? 2 * DEG : 0);
    // spread weapons hold fire until the pellets can actually land (just past the engagement band)
    const inRange = ia.dist <= (def.pellets > 1 ? (a.preferRange ?? def.aiRange)[1] * 1.35 : def.range * 0.92);
    const canShoot = ai.visible && ai.reaction <= 0 && aligned && inRange && w.reload === 0 && w.ammo > 0;
    buttons |= trigger(sim, e, ai, a, def, canShoot, dt);
  } else if (droneShot(sim, e, ai, a, def, dt) >= 0) {
    // nobody to fight: shoot down an enemy Spotter Drone in sight (hitscan kits), firing once lined up
    buttons |= trigger(sim, e, ai, a, def, ai.tac.droneLined, dt);
  } else if (propShot(sim, e, ai, a, def, dt) >= 0) {
    // A2: nobody to fight: shoot the adventure step's prop (a tuna stack) once lined up
    buttons |= trigger(sim, e, ai, a, def, ai.tac.propLined, dt);
  } else {
    ai.telegraph = 0; ai.chargeHold = 0;
    turnToward(ai, a, lookYaw, lookPitch, dt, 0.6);
    if (w.ammo < def.magSize * 0.35 && w.reload === 0 && sim.tick - ai.lastSeenTick > 90) buttons |= (e.prevButtons & Btn.Reload) ? 0 : Btn.Reload;
  }
  if (aiming && a.telegraph === 0) mv.sprint = false;
  if (aiming) buttons |= Btn.Aim;

  // ---- W9 X4 hook: throwables at clusters (ordnance-ai.ts). Room bots only: never wave or chapter cats, never in
  //      adventure, never a player stand-in. A ball carrier never stops to throw (G4b): its wind-up is dropped.
  if (e.flags & EFlag.Carrier) ai.ord.phase = 'idle';
  else if (e.kind === EntityKind.Bot && !e.combat?.pve && (sim.state.room as { mode?: string } | undefined)?.mode !== 'adventure'
    && (ai.ord.phase === 'wind' || !onLink)) { // (F2: never starts a throw mid-climb)
    const oi = ordnanceBotThink(ai.ord, e, sim.tick, ai.yaw, ai.pitch, ai.seen, ctx.chars, ordnanceArcWorld(sim), ai.ordIntent);
    if (oi.active) {
      if (oi.buttons) turnToward(ai, a, oi.yaw, oi.pitch, dt, 1.5); // the wind-up: turn to the throw, Throw held
      else { ai.yaw = oi.yaw; ai.pitch = oi.pitch; }                   // the release: exactly the solved angles
      buttons = (buttons & ~(Btn.Fire | Btn.Aim)) | oi.buttons;
      mv.x = 0; mv.z = 0; mv.sprint = false; ai.jumpNext = false;       // F2 (P2-3): plant the feet, so the arc holds
    } else keepClearOfOwnBlast(ai.ord, e, sim.tick, mv);                // F2: never run into its own live grenade
  }

  // ---- write the input (camera frame: mx right, mz forward relative to the aim yaw)
  const sy = Math.sin(ai.yaw), cy = Math.cos(ai.yaw);
  let mz = mv.x * -sy + mv.z * -cy;
  let mx = mv.x * cy + mv.z * -sy;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) { mx /= ml; mz /= ml; }
  if (onLink) { mv.sprint = false; ai.jumpNext = false; buttons = (buttons & ~(Btn.Jump | Btn.Ability | Btn.Aim)) | ai.nav.buttons; }
  if (mv.sprint && mz > 0.5 && !aiming) buttons |= Btn.Sprint;
  if (ai.jumpNext) { if (!(e.prevButtons & Btn.Jump)) buttons |= Btn.Jump; ai.jumpNext = false; }
  inp.mx = mx; inp.mz = mz;
  inp.yaw = ai.yaw; inp.pitch = ai.pitch;
  inp.buttons = buttons;
  // presentation: alerted bots (investigating or fighting) carry EFlag.Alerted for "!" telegraphs
  if (!ai.external) e.flags = ai.mode === 'alert' || ai.mode === 'engage' ? e.flags | EFlag.Alerted : e.flags & ~EFlag.Alerted;
}

/** F2 (P2-3): the X4 hook's approach band (the rules are ordnance-ai.ts's). Room bots in team-deathmatch only: in the
 *  objective modes the objective owns where a bot stands (G4b's guards hold their zone, chasers hunt the carrier, core
 *  pushers push), and a closer engage band pulled them off it. */
function throwBand(sim: Sim, e: SimEntity, ai: AiState, target: SimEntity): [number, number] | null {
  if (e.kind !== EntityKind.Bot || e.combat?.pve || !ai.visible || (sim.state.room as { mode?: string } | undefined)?.mode !== 'team-deathmatch') return null;
  return throwApproachBand(ai.ord, e, target, sim.tick);
}

/** Trigger discipline: bursts for auto weapons, paced taps for semi-auto, telegraph + charge for chargers. */
function trigger(sim: Sim, e: SimEntity, ai: AiState, a: Archetype, def: WeaponDef, canShoot: boolean, dt: number): number {
  const w = e.wpn!;
  const firedNow = w.shots !== ai.lastShots;
  ai.lastShots = w.shots;
  if (def.chargeTime > 0) {
    ai.telegraph = ai.visible ? ai.telegraph + dt : Math.max(0, ai.telegraph - dt);
    if (w.reload > 0 || w.ammo <= 0) { ai.chargeHold = 0; return 0; }
    if (w.charging) {
      if (w.charge >= 0.999) {
        ai.chargeHold += dt;
        // releasing the trigger fires the charged shot
        if (canShoot || ai.chargeHold > 1.5) { ai.telegraph = a.telegraph * 0.35; ai.chargeHold = 0; return 0; }
      }
      return Btn.Fire;
    }
    return ai.visible && ai.telegraph >= a.telegraph && w.cooldown <= 0 ? Btn.Fire : 0;
  }
  if (def.auto) {
    if (firedNow && ai.burstLeft > 0) {
      ai.burstLeft--;
      if (ai.burstLeft === 0) ai.pause = rand(sim, a.burstPause[0], a.burstPause[1]);
    }
    if (ai.pause > 0) { ai.pause -= dt; return 0; }
    if (!canShoot) return 0;
    if (ai.burstLeft <= 0) ai.burstLeft = Math.round(rand(sim, a.burst[0], a.burst[1]));
    return Btn.Fire;
  }
  ai.semiTimer -= dt;
  if (!canShoot || ai.semiTimer > 0 || w.cooldown > 0) return 0;
  if (e.prevButtons & Btn.Fire) return 0; // release a tick between presses
  ai.semiTimer = 1 / def.fireRate + rand(sim, 0.02, 0.16);
  return Btn.Fire;
}

/**
 * No character target: an enemy drone within reach and in sight (checked with perception, every 6 ticks) is aimed
 * at. Returns -1 (no drone), 0 (turning to it) or 1 (lined up: tac.droneLined, the caller pulls the trigger).
 * Hitscan, non-charge kits only.
 */
function droneShot(sim: Sim, e: SimEntity, ai: AiState, a: Archetype, def: WeaponDef, dt: number): number {
  const t = ai.tac;
  t.droneLined = false;
  if (def.kind !== 'hitscan' || def.chargeTime > 0 || e.wpn!.reload > 0 || e.wpn!.ammo <= 0) { t.drone = -1; return -1; }
  const reach = Math.min(40, def.pellets > 1 ? 18 : def.range * 0.8);
  const ex = e.pos.x, ey = e.pos.y + eyeHeight(e), ez = e.pos.z;
  if (sim.tick >= ai.nextPerceive - 1) {
    t.drone = -1;
    let bd = reach;
    for (const d of abilityEntities(sim)) {
      if (d.abx!.kind !== 'drone' || d.team === e.team) continue;
      const dist = Math.hypot(d.pos.x - ex, d.pos.y - ey, d.pos.z - ez);
      if (dist > bd) continue;
      const k = (dist - DRONE.radius - 0.1) / dist;
      if (!worldLineClear(sim, ex, ey, ez, ex + (d.pos.x - ex) * k, ey + (d.pos.y - ey) * k, ez + (d.pos.z - ez) * k)) continue;
      bd = dist; t.drone = d.id;
    }
  }
  const d = t.drone >= 0 ? sim.entities.get(t.drone) : undefined;
  if (!d || d.removed) { t.drone = -1; return -1; }
  const dx = d.pos.x - ex, dy = d.pos.y - ey, dz = d.pos.z - ez;
  const h = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, h);
  turnToward(ai, a, yaw, pitch, dt);
  const tol = Math.atan2(DRONE.radius * 0.8, Math.hypot(h, dy));
  t.droneLined = Math.abs(angleDelta(ai.yaw, yaw)) < tol && Math.abs(ai.pitch - pitch) < tol;
  return t.droneLined ? 1 : 0;
}

/**
 * A2: no character target and the tactics picked a prop (tac.prop): when it is in sight (checked with perception,
 * every 6 ticks) and inside the standoff band, aim at it (a ballistic lob for projectiles) and report lined up
 * (tac.propLined, the caller pulls the trigger). Returns -1 (nothing to shoot), 0 (turning to it) or 1 (lined up).
 * The sight line runs to just short of the prop's nearest face, so the prop's own collider doesn't hide it.
 */
function propShot(sim: Sim, e: SimEntity, ai: AiState, a: Archetype, def: WeaponDef, dt: number): number {
  const t = ai.tac;
  t.propLined = false;
  const p = t.prop >= 0 ? sim.entities.get(t.prop) : undefined;
  const d = (p as { dsx?: { def?: Destructible; broken?: boolean } } | undefined)?.dsx;
  if (!p || p.removed || !d?.def || d.broken || e.wpn!.reload > 0 || e.wpn!.ammo <= 0) { t.propSeen = false; return -1; }
  const ex = e.pos.x, ey = e.pos.y + eyeHeight(e), ez = e.pos.z;
  const h = Math.hypot(t.px - ex, t.pz - ez);
  if (sim.tick >= ai.nextPerceive - 1) {
    t.propSeen = false;
    if (h >= t.propMin && h <= t.propMax) {
      const near = destructDistance(d.def, ex, ey, ez);
      const len = Math.hypot(t.px - ex, t.py - ey, t.pz - ez);
      const k = Math.max(0, near - 0.15) / Math.max(1e-3, len);
      t.propSeen = worldLineClear(sim, ex, ey, ez, ex + (t.px - ex) * k, ey + (t.py - ey) * k, ez + (t.pz - ez) * k, friendlyShotPass(sim, e.team));
    }
  }
  if (!t.propSeen) return -1;
  // explosive lobs land at its foot (the blast does the work); hitscan goes for the middle
  const ty = def.projectile ? p.pos.y + 0.5 : t.py;
  const dy = ty - ey;
  const yaw = Math.atan2(-(t.px - ex), -(t.pz - ez));
  const pitch = def.projectile ? ballisticPitch(def.projectile.speed, def.projectile.gravity, h, dy) : Math.atan2(dy, h);
  turnToward(ai, a, yaw, pitch, dt);
  const tol = Math.max(1.2 * DEG, Math.atan2(0.35, Math.hypot(h, dy)));
  t.propLined = Math.abs(angleDelta(ai.yaw, yaw)) < tol && Math.abs(ai.pitch - pitch) < tol + (def.projectile ? 2 * DEG : 0);
  return t.propLined ? 1 : 0;
}

/**
 * While the bot's objective is a hold zone and it is near it, keep the fight inside: back into the zone when it
 * drifted out, and drop any move component that would carry it out.
 */
function holdZone(e: SimEntity, t: TacticsState): void {
  if ((t.goal !== 'step' && t.goal !== 'ball') || !t.hold) return;
  const ox = e.pos.x - t.cx, oz = e.pos.z - t.cz;
  const d = Math.hypot(ox, oz);
  if (d > t.gr + 14) return; // far away (just respawned): fight normally on the way
  const lim = Math.max(t.gr * 0.75, Math.hypot(t.gx - t.cx, t.gz - t.cz) + 1); // (the middle may be a prop)
  if (d > lim) { mv.x = -ox / d; mv.z = -oz / d; mv.sprint = false; return; }
  if (d > t.gr * 0.4) {
    const out = (mv.x * ox + mv.z * oz) / d;
    if (out > 0) { mv.x -= (ox / d) * out; mv.z -= (oz / d) * out; }
  }
}

/** True for characters the AI system drives. */
export function isAiControlled(e: SimEntity): boolean {
  return !!e.char && (e.kind === EntityKind.Bot || !!e.ai?.external);
}

export function ensureBrain(e: SimEntity): AiState {
  if (!e.ai) {
    ensureCombat(e);
    applyArchetype(e, archetypeForClass(e.cls).id);
  }
  return e.ai!;
}


// Boss components (module augmentation on SimEntity) and small shared helpers. OWNER: boss lane (B1, E1).
// Plain data only (the sim must stay serialisable and headless): no Three.js, no DOM, no Math.random().
// `boss` (BossState) is common to every boss (stage machine, phase, taunts, stats) and carries the
// Vac-Tank's own fields; the sniper elite adds `sniper` (SniperState) for perches, the dot and the lock.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { EntityKind, type EntityId } from '../../shared/types';
import {
  BOSSES, BOSS_BARKS, BOSS_FLAG_MASK, packBossFlags, type BossBarkKey, type BossDef, type SniperDef, type SniperHop,
  type SniperPerch, type VacTankDef,
} from '../../shared/content/bosses';

export interface BossStats {
  /** Attacks started, indexed by BossAttack id. */
  attacks: number[];
  weakHits: number;
  hullHits: number;
  dmgTaken: number;
  dmgDealt: number;
  kills: number;
  /** Seconds from the spawn to the defeat (0 while alive). */
  fightTime: number;
}

export interface BossState {
  /** Index into BOSSES. */
  def: number;
  phase2: boolean;
  /** Current BossAttack / BossStage and the time spent in the stage (s) out of stageLen. */
  attack: number;
  stage: number;
  stageT: number;
  stageLen: number;
  /** Sim time (s) at which the next attack may begin. */
  readyAt: number;
  /** Sim time at which spin / kitten deploy are available again. */
  spinAt: number;
  kittensAt: number;
  /** Last attack started and how many times in a row. */
  last: number;
  streak: number;
  /** Attack forced by a test / lab (0 = none). */
  forced: number;
  spawnedAt: number;
  // targeting
  target: EntityId;
  retargetAt: number;
  /** Last enemy that damaged the boss and when (sim time) — the boss turns on whoever hurts it. */
  aggroId: EntityId;
  aggroAt: number;
  // locomotion
  heading: number;
  anchorX: number; anchorZ: number;
  goalX: number; goalZ: number; hasGoal: boolean; goalUntil: number; strafe: number;
  lastX: number; lastZ: number; odo: number; checkT: number; stuck: number;
  aimYaw: number; aimPitch: number;
  // laser
  dotX: number; dotY: number; dotZ: number;
  lockYaw: number; lockDist: number; sweepSign: number;
  // mortar: planned landing points (x, y, z triples) and shells launched so far
  shells: number[];
  launched: number;
  /** Entities already hit by the current attack (one hit each per laser sweep / brush spin). */
  hitIds: EntityId[];
  // kittens
  kittens: EntityId[];
  kitSpawned: number;
  // defeat sequence
  ejected: boolean;
  booms: number;
  // taunts
  barkAt: number;
  hurtBarkAt: number;
  lowHpBarked: boolean;
  wonBarked: boolean;
  /** Corgi combatants counted for the hp scale. */
  players: number;
  stats: BossStats;
}

/** A lobbed hairball: an EntityKind.Projectile snapshot entity on an exact ballistic arc. */
export interface HairballState {
  boss: EntityId;
  sx: number; sy: number; sz: number;
  vx: number; vy: number; vz: number;
  g: number;
  t: number;
  /** Flight time = warning-circle time; it lands exactly on (tx, ty, tz). */
  T: number;
  tx: number; ty: number; tz: number;
  phase2: boolean;
}

/** One sniper shot, for fairness proofs and balance stats. */
export interface SniperShot {
  target: EntityId;
  /** Sim time the dot was painted on this target (acquisition) and fired. */
  paintAt: number;
  fireAt: number;
  /** Seconds of painted (line-of-sight) tracking accumulated before the shot. */
  tracked: number;
  hit: boolean;
  dmg: number;
}

export interface SniperStats {
  shots: number;
  hits: number;
  spoiled: number;
  lost: number;
  lobs: number;
  leaps: number;
  deviceHits: number;
  headHits: number;
  bodyHits: number;
  /** Every shot (capped at 512 entries). */
  shotLog: SniperShot[];
}

/** Madame Pointillé's own state (E1). */
export interface SniperState {
  perches: SniperPerch[];
  /** Perch she is on (or leaping to) and the one she left. */
  perch: number;
  prevPerch: number;
  // relocation
  route: SniperHop[];
  hop: number;
  hopT: number;
  /** Start of the current hop. */
  hx: number; hy: number; hz: number;
  arriveAt: number;
  relocateAt: number;
  /** Damage taken since she arrived on this perch. */
  hurtHere: number;
  forceMove: boolean;
  // aim
  aimYaw: number;
  aimPitch: number;
  /** Aim point: the dot chases the target's chest (or head) through it at the dot speed. */
  ax: number; ay: number; az: number;
  /** Dot distance from the lens along the aim (m); 0 = beam off. */
  dot: number;
  // the lock
  lock: EntityId;
  trackT: number;
  lostT: number;
  paintAt: number;
  glinted: boolean;
  /** Last seen chest/head point of the lock target. */
  seenX: number; seenY: number; seenZ: number;
  lastLock: EntityId;
  // lob memory: who hid, where (feet), when
  hideId: EntityId;
  hideX: number; hideY: number; hideZ: number;
  hideAt: number;
  lobAt: number;
  launched: boolean;
  stats: SniperStats;
}

declare module '../entity' {
  interface SimEntity {
    boss?: BossState;
    hairball?: HairballState;
    sniper?: SniperState;
  }
}

export function createBossState(def: number, sim: Sim, x: number, z: number, heading: number, players: number): BossState {
  return {
    def, phase2: false, attack: 0, stage: 0, stageT: 0, stageLen: 1, readyAt: 0, spinAt: 0, kittensAt: 0,
    last: 0, streak: 0, forced: 0, spawnedAt: sim.time,
    target: -1, retargetAt: 0, aggroId: -1, aggroAt: -1e9,
    heading, anchorX: x, anchorZ: z, goalX: x, goalZ: z, hasGoal: false, goalUntil: 0, strafe: 1,
    lastX: x, lastZ: z, odo: 0, checkT: 0, stuck: 0, aimYaw: heading, aimPitch: 0,
    dotX: 0, dotY: 0, dotZ: 0, lockYaw: 0, lockDist: 0, sweepSign: 1,
    shells: [], launched: 0, hitIds: [], kittens: [], kitSpawned: 0,
    ejected: false, booms: 0,
    barkAt: 0, hurtBarkAt: 0, lowHpBarked: false, wonBarked: false,
    players,
    stats: { attacks: [0, 0, 0, 0, 0, 0, 0, 0], weakHits: 0, hullHits: 0, dmgTaken: 0, dmgDealt: 0, kills: 0, fightTime: 0 },
  };
}

export function bossDef(b: BossState): BossDef {
  return BOSSES[b.def] ?? BOSSES[0];
}

/** The Vac-Tank definition of a tank boss state. */
export function tankDef(b: BossState): VacTankDef {
  const d = bossDef(b);
  if (d.kind !== 'tank') throw new Error(`boss ${d.id} is not a tank`);
  return d;
}

/** The sniper definition of a sniper boss state. */
export function sniperDef(b: BossState): SniperDef {
  const d = bossDef(b);
  if (d.kind !== 'sniper') throw new Error(`boss ${d.id} is not a sniper`);
  return d;
}

export function createSniperState(perches: SniperPerch[], perch: number, yaw: number): SniperState {
  const p = perches[perch];
  return {
    perches, perch, prevPerch: -1,
    route: [], hop: 0, hopT: 0, hx: p.x, hy: p.y, hz: p.z,
    arriveAt: 0, relocateAt: 0, hurtHere: 0, forceMove: false,
    aimYaw: yaw, aimPitch: 0, ax: p.x, ay: p.y, az: p.z, dot: 0,
    lock: -1, trackT: 0, lostT: 0, paintAt: 0, glinted: false, seenX: 0, seenY: 0, seenZ: 0, lastLock: -1,
    hideId: -1, hideX: 0, hideY: 0, hideZ: 0, hideAt: -1e9, lobAt: 0, launched: false,
    stats: { shots: 0, hits: 0, spoiled: 0, lost: 0, lobs: 0, leaps: 0, deviceHits: 0, headHits: 0, bodyHits: 0, shotLog: [] },
  };
}

export function isBoss(e: SimEntity | undefined | null): e is SimEntity & { boss: BossState } {
  return !!e && e.kind === EntityKind.Boss && !!e.boss;
}

/** Every boss entity in the sim (alive or in its defeat sequence). */
export function bossesOf(sim: Sim, out: SimEntity[] = []): SimEntity[] {
  out.length = 0;
  for (const e of sim.entities.values()) if (e.kind === EntityKind.Boss && e.boss) out.push(e);
  return out;
}

export function setStage(b: BossState, stage: number, len: number): void {
  b.stage = stage;
  b.stageT = 0;
  b.stageLen = Math.max(1e-3, len);
}

/** Mirror the boss state into the snapshot flags (bits 16..26, see packBossFlags). */
export function writeBossFlags(e: SimEntity, b: BossState): void {
  const p = b.stageT / b.stageLen;
  e.flags = (e.flags & ~BOSS_FLAG_MASK) | packBossFlags(b.attack, b.stage, b.phase2, p);
}

/** Emit a taunt (`bark` event) unless one played recently (`force` ignores the cooldown). */
export function bossBark(sim: Sim, e: SimEntity, b: BossState, key: BossBarkKey, force = false): void {
  const def = bossDef(b);
  if (!force && sim.time < b.barkAt) return;
  const lines = BOSS_BARKS[def.id]?.[key];
  if (!lines || !lines.length) return;
  const line = lines[Math.floor(sim.rng() * lines.length) % lines.length];
  sim.emit({ e: 'bark', id: e.id, line });
  b.barkAt = sim.time + def.barkCooldown;
}

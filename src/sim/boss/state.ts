// Boss components (module augmentation on SimEntity) and small shared helpers. OWNER: B1 boss lane.
// Plain data only (the sim must stay serialisable and headless): no Three.js, no DOM, no Math.random().
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { EntityKind, type EntityId } from '../../shared/types';
import { BOSSES, BOSS_BARKS, BOSS_FLAG_MASK, packBossFlags, type BossBarkKey, type BossDef } from '../../shared/content/bosses';

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

declare module '../entity' {
  interface SimEntity {
    boss?: BossState;
    hairball?: HairballState;
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

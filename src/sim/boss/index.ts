// OWNER: B1 boss lane. "The Vac-Tank" — Baron Von Floof's robot-vacuum war machine, the skirmish
// finale. Authoritative and deterministic (sim.rng only; no three/DOM/Math.random).
//
// Systems (bossSystems()):
//   150 boss-brain    target, telegraphed attack state machine, aim, movement intent (KCC via stepCharacter)
//   455 boss-attacks  laser sweep hitscan, hairball launches/landings (combat explode()), brush spin,
//                     kitten deploy (AI archetype 'kitten')
//   560 boss-damage   weak-point regrade of this tick's hits on bosses (pilot ×2), kill taunts, aggro
// The boss is an EntityKind.Boss *character*: the combat lane's hitscan, projectiles, blasts and bark
// blast hit its capsule (a 5 m sphere), corgi bots perceive and fight it, and the combat lane's
// kill()/PvE-corpse path handles its death and removal.
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, CLASS_IDS, EntityKind, Species, Team, type TeamId } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import { CHARACTER_GROUPS } from '../rapier';
import { ensureCombat, ticksOf } from '../combat/state';
import {
  BOSSES, BossAttack, BossStage, BOSS_ABILITY, BOSS_ATTACK_NAMES, bossIndex, bossMaxHp, type BossDef,
} from '../../shared/content/bosses';
import { bossBrainSystem } from './brain';
import { bossAttackSystem } from './attacks';
import { bossDamageSystem } from './damage';
import { bossBark, bossesOf, createBossState, setStage, writeBossFlags, type BossState } from './state';
import { bossNavGrid, nearestClear } from './nav';

export { bossBrainSystem, updateBoss, DEFEAT_TIME, EJECT_AT } from './brain';
export { bossAttackSystem, spawnKitten } from './attacks';
export { bossDamageSystem, rayHitsWeakPoint } from './damage';
export { bossesOf, isBoss, bossDef, type BossState, type BossStats, type HairballState } from './state';

export function bossSystems(): SimSystem[] {
  return [bossBrainSystem, bossAttackSystem, bossDamageSystem];
}

export interface SpawnBossOptions {
  /** Boss id from BOSSES (default: the first, 'vac_tank'). */
  boss?: string;
  /** Corgi combatants to scale hp for (default: every character on the opposing team right now). */
  players?: number;
  team?: TeamId;
  /** Drop in from above (default true): lands with a `land` event and a short invulnerable intro. */
  drop?: boolean;
}

/** Corgi combatants (players and squad bots, alive or respawning) the boss will face. */
export function countSquad(sim: Sim, bossTeam: TeamId): number {
  let n = 0;
  for (const e of sim.entities.values()) if (e.char && e.team !== bossTeam && e.kind !== EntityKind.Boss && !e.combat?.pve && e.team !== Team.Neutral) n++;
  return Math.max(1, n);
}

/**
 * Default arena spot: halfway between the boss team's spawns and the map centre, on a patch of plain
 * lawn wide enough for the tank (falls back to the raw point before the nav grid exists).
 */
export function defaultBossSpawn(sim: Sim, def: BossDef = BOSSES[0], team: TeamId = Team.Cats): { x: number; z: number } {
  const own = sim.worldData.spawns.filter((s) => s.team === team);
  let cx = 0, cz = 0;
  for (const s of own) { cx += s.x; cz += s.z; }
  if (own.length) { cx /= own.length; cz /= own.length; }
  let x = cx * 0.5, z = cz * 0.5;
  const g = bossNavGrid(sim);
  if (g) {
    const c = nearestClear(g, x, z, def.radius + 1.5, 30) ?? nearestClear(g, x, z, def.radius + 0.3, 40);
    if (c) { x = c.x; z = c.z; }
  }
  return { x, z };
}

/**
 * Spawn a boss (the lead wires `?boss=1` to this; the skirmish's boss wave calls it too).
 * `at` = feet position (y defaults to the ground there); returns the boss entity.
 */
export function spawnBoss(sim: Sim, at?: { x: number; z: number; y?: number; yaw?: number }, opts: SpawnBossOptions = {}): SimEntity {
  const idx = Math.max(0, bossIndex(opts.boss ?? BOSSES[0].id));
  const def = BOSSES[idx];
  const team = opts.team ?? Team.Cats;
  const p = at ?? defaultBossSpawn(sim, def, team);
  const ground = at?.y ?? sim.worldData.height(p.x, p.z);
  const drop = opts.drop ?? true;
  const y = ground + (drop ? def.dropHeight : 0.05);
  // face the other team's spawns
  let yaw = at?.yaw;
  if (yaw === undefined) {
    const foes = sim.worldData.spawns.filter((s) => s.team !== team);
    let fx = 0, fz = 0;
    for (const s of foes) { fx += s.x; fz += s.z; }
    if (foes.length) { fx /= foes.length; fz /= foes.length; }
    yaw = Math.atan2(-(fx - p.x), -(fz - p.z));
  }
  const players = opts.players ?? countSquad(sim, team);
  const hp = bossMaxHp(def, players);
  const id = sim.allocId();
  const e: SimEntity = {
    id, kind: EntityKind.Boss, team, species: Species.Cat,
    // Sim.toState() writes CLASS_IDS.indexOf(cls) into EntityState.cls: this makes it the BOSSES index.
    cls: CLASS_IDS[idx] ?? null,
    seed: 0x5eed0000 + idx, name: def.name,
    pos: { x: p.x, y, z: p.z }, vel: { x: 0, y: 0, z: 0 }, yaw, pitch: 0, collider: null,
    input: { ...emptyInput(0), yaw }, prevButtons: 0, lastInputSeq: 0,
    char: {
      move: {
        walkSpeed: def.move.speed * 0.5, runSpeed: def.move.speed, sprintSpeed: def.move.speed,
        groundAccel: def.move.accel, airAccel: def.move.accel * 0.4, groundDecel: def.move.decel,
        jumpVelocity: 0, doubleJumpVelocity: 0, fallGravityScale: 1.6, coyoteTime: 0, jumpBuffer: 0,
        capsuleRadius: def.radius, capsuleHalfHeight: 0,
      },
      grounded: false, airTime: 0, jumpBuffer: 0, jumpsUsed: 0, jumpHeld: false, landImpact: 0, sprinting: false, slideTime: 0, slideCooldown: 0, pounding: false,
    },
    health: { hp, max: hp, lastDamageTick: sim.tick, lastAttacker: -1 },
    anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
    ownerPid: null, removed: false, data: {},
  };
  const R = sim.R;
  const cd = R.ColliderDesc.ball(def.radius).setTranslation(p.x, y + def.radius, p.z).setCollisionGroups(CHARACTER_GROUPS);
  e.collider = sim.world.createCollider(cd);
  e.collider.setActiveCollisionTypes(R.ActiveCollisionTypes.DEFAULT | R.ActiveCollisionTypes.KINEMATIC_FIXED);
  (e.collider as unknown as { __entityId: number }).__entityId = id;
  sim.entities.set(id, e);
  ensureCombat(e);
  const meta = e.combat!;
  meta.pve = true; // never respawns; the combat lane removes the wreck (removeTick set by the defeat sequence)
  const b = createBossState(idx, sim, p.x, p.z, yaw, players);
  b.aimYaw = yaw;
  b.attack = BossAttack.Intro;
  setStage(b, BossStage.Active, def.intro);
  meta.invulnUntil = sim.tick + ticksOf(def.intro);
  e.boss = b;
  writeBossFlags(e, b);
  sim.emit({ e: 'spawn', id });
  sim.emit({ e: 'ability', id, ability: BOSS_ABILITY.intro, x: p.x, y: ground, z: p.z });
  bossBark(sim, e, b, 'intro', true);
  return e;
}

/** Tests / lab: make the boss start this attack as soon as it is idle (name from BOSS_ATTACK_NAMES or id). */
export function forceBossAttack(boss: SimEntity, attack: number | 'laser' | 'mortar' | 'spin' | 'kittens'): void {
  const b = boss.boss;
  if (!b) return;
  const id = typeof attack === 'number' ? attack : (BOSS_ATTACK_NAMES as readonly string[]).indexOf(attack);
  if (id < BossAttack.Laser || id > BossAttack.Kittens) return;
  b.forced = id;
  b.readyAt = 0;
  if (b.attack === BossAttack.None) b.stageT = b.stageLen;
}

/** Tests / lab: skip the drop-in intro (the boss becomes attackable and starts choosing attacks). */
export function skipBossIntro(sim: Sim, boss: SimEntity): void {
  const b = boss.boss;
  if (!b || b.attack !== BossAttack.Intro) return;
  b.attack = BossAttack.None;
  setStage(b, BossStage.Idle, 1);
  b.readyAt = sim.time;
  if (boss.combat) boss.combat.invulnUntil = 0;
  writeBossFlags(boss, b);
}

/** Living bosses (for match rules: a boss holds its wave open). */
export function livingBosses(sim: Sim): number {
  let n = 0;
  for (const e of sim.entities.values()) if (e.kind === EntityKind.Boss && e.boss && !e.dead) n++;
  return n;
}

/**
 * Match hook helper: state of a boss spawned by a wave. `alive` holds the wave open; once it is not,
 * the wave counts as cleared and `score` is the defeat bonus (0 if it vanished without a defeat).
 */
export function bossWaveStatus(sim: Sim, id: number): { alive: boolean; score: number } {
  const e = sim.entities.get(id);
  if (e && !e.dead) return { alive: true, score: 0 };
  const b = e?.boss as BossState | undefined;
  return { alive: false, score: e && b ? BOSSES[b.def].score : 0 };
}

export { bossesOf as bossEntities };

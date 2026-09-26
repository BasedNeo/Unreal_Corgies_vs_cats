// OWNER: boss lane (E1). Madame Pointillé — the Siamese sniper elite, a laser-pointer duel mini-boss.
//
// A character-sized (1.4× a cat), kinematic EntityKind.Boss: a capsule the combat lane's hitscan, lag
// compensation, blasts and bots all handle as usual. She holds perches across the lawn from the garage
// Rooftops and has exactly one way to hurt you directly — a telegraphed shot:
//
//   idle ─pick─▶ TRACK  the red dot appears beside a target, sweeps onto it and follows its chest (or its head
//                       when the chest is behind cover) at the dot speed. Painted time builds only while she
//                       has line of sight and drains while the target hides; `lose` s out of sight loses the
//                       lock (she re-acquires from zero). For the last `glint` s the device glints: a hit on
//                       it then spoils the shot (stagger). At `track.time` (≥ MIN_TELEGRAPH) she fires along
//                       the dot — it only hits if the dot is on the tracked target. Then a recover beat.
//        ─target hid─▶ LOB  a hairball at the spot where it hid (its warning circle is up for the whole flight).
//        ─timer / hurt / crowded / phase 2─▶ LEAP  a readable crouch (the destination is announced), then
//                       parabolic leap(s) to another perch, then a landing beat.
//   50 % hp: the beret flies off (phase shift, then a forced relocation); phase 2 tracks faster.
//   Defeat: she tumbles off her perch (the combat lane's corpse physics) and is removed after DEFEAT_TIME.
//
// Timing: decisions + movement run in the boss brain (order 150); tracking, the shot and the lob in the boss
// attack system (455: after movement and player weapons, so this tick's positions); device hits and spoiled
// shots in the boss damage system (560). Deterministic: sim.rng only; no three/DOM/Math.random.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, CLASS_IDS, EFlag, EntityKind, Species, Team, type TeamId } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import { angleDelta } from '../../shared/math';
import { moveStatsFor } from '../../shared/content/classes';
import { weaponIndex } from '../../shared/content/weapons';
import { surfaceAt } from '../../shared/world/queries';
import {
  BOSS_ABILITY, BossStage, MIN_TELEGRAPH, SNIPER_ABILITY, SNIPER_DOT_SCALE, SniperAct, bossMaxHp, bossTime,
  hairballSpec, hopAt, sniperLens, sniperRoute, sniperTrackTime, type P3, type SniperDef, type SniperPerch,
} from '../../shared/content/bosses';
import { CHARACTER_GROUPS } from '../rapier';
import { applyDamage, knockback, ensureCombat, capsuleOf, characterHeight, combatLive, isInvulnerable, isStealthed, rayCapsule, worldLineClear, worldRay } from '../combat';
import { reportNoise, ticksOf } from '../combat/state';
import { bossBark, createBossState, createSniperState, setStage, sniperDef, writeBossFlags, type BossState, type SniperState } from './state';
import { fizzleHairballs, launchHairball } from './hairball';

const LASER_WPN = weaponIndex('laser_longshot');
/** Seconds the defeat lasts before the body is removed (same beat as the Vac-Tank). */
const DEFEAT_TIME = 5;
/** Intro: she drops onto her first perch from this high, over this long. */
const INTRO_DROP_H = 7;
const INTRO_DROP_T = 0.55;
/** A shot's flash (stage Active) before the recover beat. */
const SHOT_HOLD = 0.15;
/** Remember a target that hid behind cover this long (s) for a lob. */
const HIDE_MEMORY = 8;
const SHOT_LOG_CAP = 512;

const L: P3 = { x: 0, y: 0, z: 0 };
const P: P3 = { x: 0, y: 0, z: 0 };
const Q: P3 = { x: 0, y: 0, z: 0 };
const D: P3 = { x: 0, y: 0, z: 0 };
const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const rand = (sim: Sim, a: number, b: number) => a + (b - a) * sim.rng();

// ------------------------------------------------------------------ spawn

export interface SpawnSniperOptions {
  team: TeamId;
  /** Squad size already weighted (humans 1, bots def.botWeight). */
  players: number;
  /** Perches (default: the def's West Yard perches) and the one to start on (default: nearest to `at`, else 0). */
  perches?: SniperPerch[];
  perch?: number;
  /** Drop onto the first perch (default true). */
  drop?: boolean;
}

/** Create the sniper boss entity on a perch (spawnBoss routes `kind: 'sniper'` defs here). */
export function spawnSniper(sim: Sim, idx: number, def: SniperDef, at: { x: number; z: number } | undefined, o: SpawnSniperOptions): SimEntity {
  const perches = (o.perches ?? def.perches).map((p) => ({ ...p }));
  let k = o.perch ?? 0;
  if (o.perch === undefined && at) {
    let best = Infinity;
    perches.forEach((p, i) => { const d = Math.hypot(p.x - at.x, p.z - at.z); if (d < best) { best = d; k = i; } });
  }
  k = Math.max(0, Math.min(perches.length - 1, k));
  const p = perches[k];
  const hp = bossMaxHp(def, o.players);
  const move = { ...moveStatsFor(Species.Cat, 'infiltrator'), capsuleRadius: def.capsule.r, capsuleHalfHeight: def.capsule.halfH };
  const id = sim.allocId();
  const e: SimEntity = {
    id, kind: EntityKind.Boss, team: o.team, species: Species.Cat,
    // Sim.toState() writes CLASS_IDS.indexOf(cls) into EntityState.cls: this makes it the BOSSES index.
    cls: CLASS_IDS[idx] ?? null,
    seed: 0x5eed0000 + idx, name: def.name,
    pos: { x: p.x, y: p.y, z: p.z }, vel: { x: 0, y: 0, z: 0 }, yaw: p.yaw, pitch: 0, collider: null,
    input: { ...emptyInput(0), yaw: p.yaw }, prevButtons: 0, lastInputSeq: 0,
    char: {
      move, grounded: true, airTime: 0, jumpBuffer: 0, jumpsUsed: 0, jumpHeld: false, landImpact: 0, sprinting: false, slideTime: 0, slideCooldown: 0,
      pounding: false, crouchBuffer: 0, glideTime: 0, glideCooldown: 0, restX: NaN, restY: NaN, restZ: NaN,
    },
    health: { hp, max: hp, lastDamageTick: sim.tick, lastAttacker: -1 },
    anim: Anim.Idle, flags: EFlag.Grounded, dead: false, respawnTick: 0, weapon: LASER_WPN, ammo: 0,
    ownerPid: null, removed: false, data: {},
    moveFrozen: true, // kinematic: movement + map effects skip her; she is placed on perches and leap arcs
  };
  const R = sim.R;
  const cd = R.ColliderDesc.capsule(def.capsule.halfH, def.capsule.r).setTranslation(p.x, p.y + def.capsule.halfH + def.capsule.r, p.z).setCollisionGroups(CHARACTER_GROUPS);
  e.collider = sim.world.createCollider(cd);
  e.collider.setActiveCollisionTypes(R.ActiveCollisionTypes.DEFAULT | R.ActiveCollisionTypes.KINEMATIC_FIXED);
  (e.collider as unknown as { __entityId: number }).__entityId = id;
  sim.entities.set(id, e);
  ensureCombat(e);
  e.combat!.pve = true; // never respawns; the combat lane removes the body (removeTick set by the defeat)
  const b = createBossState(idx, sim, p.x, p.z, p.yaw, o.players);
  b.attack = SniperAct.Intro;
  setStage(b, BossStage.Active, def.intro);
  e.combat!.invulnUntil = sim.tick + ticksOf(def.intro);
  e.boss = b;
  const s = createSniperState(perches, k, p.yaw);
  s.arriveAt = sim.time;
  s.relocateAt = sim.time + def.intro + rand(sim, def.relocate.every[0], def.relocate.every[1]);
  if (o.drop === false) b.stageT = INTRO_DROP_T; // already on the perch: skip the drop, keep the invulnerable beat
  e.sniper = s;
  place(e, b, s, def);
  writeBossFlags(e, b);
  sim.emit({ e: 'spawn', id });
  sim.emit({ e: 'ability', id, ability: BOSS_ABILITY.intro, x: p.x, y: p.y, z: p.z });
  bossBark(sim, e, b, 'intro', true);
  return e;
}

// ------------------------------------------------------------------ helpers

function dropLock(s: SniperState): void {
  if (s.lock >= 0) s.lastLock = s.lock;
  s.lock = -1; s.dot = 0; s.trackT = 0; s.lostT = 0; s.glinted = false;
}

function toIdle(sim: Sim, b: BossState, delay: number): void {
  b.attack = SniperAct.None;
  setStage(b, BossStage.Idle, 1);
  b.readyAt = sim.time + delay;
}

function idlePause(sim: Sim, def: SniperDef, b: BossState): number {
  return bossTime(def, rand(sim, def.idle[0], def.idle[1]), b.phase2);
}

/** Chest (1) or head (2) of `t` visible from `from` (written to `out`), else 0. */
function sightPoint(sim: Sim, from: P3, t: SimEntity, out: P3): number {
  const h = characterHeight(t);
  out.x = t.pos.x; out.z = t.pos.z;
  out.y = t.pos.y + h * 0.55;
  if (worldLineClear(sim, from.x, from.y, from.z, out.x, out.y, out.z)) return 1;
  out.y = t.pos.y + h * 0.86;
  if (worldLineClear(sim, from.x, from.y, from.z, out.x, out.y, out.z)) return 2;
  return 0;
}

/**
 * Aim so the beam — from the lens along (yaw, pitch) — passes exactly through a world point: the lens moves
 * with the aim, so solve it in a few fixed-point steps. Clients rebuild the beam from yaw/pitch alone.
 */
function aimAt(e: SimEntity, s: SniperState, def: SniperDef, x: number, y: number, z: number): void {
  let yaw = yawTo(x - e.pos.x, z - e.pos.z), pitch = Math.atan2(y - (e.pos.y + def.lens.pivotY), Math.max(0.3, Math.hypot(x - e.pos.x, z - e.pos.z)));
  for (let i = 0; i < 3; i++) {
    sniperLens(def, e.pos.x, e.pos.y, e.pos.z, yaw, pitch, Q);
    const dx = x - Q.x, dz = z - Q.z, h = Math.hypot(dx, dz);
    if (h < 0.2) break; // (the point is at the device itself)
    yaw = yawTo(dx, dz);
    pitch = Math.atan2(y - Q.y, h);
  }
  s.aimYaw = yaw; s.aimPitch = pitch;
}

/** Turn the aim toward a point at a limited rate (idle scanning). */
function turnToward(e: SimEntity, s: SniperState, def: SniperDef, x: number, y: number, z: number, rate: number): void {
  const dx = x - e.pos.x, dz = z - e.pos.z;
  const wy = yawTo(dx, dz), wp = Math.atan2(y - (e.pos.y + def.lens.pivotY), Math.max(0.3, Math.hypot(dx, dz)));
  s.aimYaw += Math.max(-rate, Math.min(rate, angleDelta(s.aimYaw, wy)));
  s.aimPitch += Math.max(-rate, Math.min(rate, wp - s.aimPitch));
}

/** Lens (beam origin) toward a target point, for line-of-sight checks before she aims. */
function lensToward(e: SimEntity, def: SniperDef, x: number, y: number, z: number, out: P3): P3 {
  const dx = x - e.pos.x, dz = z - e.pos.z;
  const yaw = yawTo(dx, dz), pitch = Math.atan2(y - (e.pos.y + def.lens.pivotY), Math.max(0.3, Math.hypot(dx, dz)));
  return sniperLens(def, e.pos.x, e.pos.y, e.pos.z, yaw, pitch, out);
}

/** Unit aim direction for (yaw, pitch) into `out`. */
function aimDir(yaw: number, pitch: number, out: P3): P3 {
  const c = Math.cos(pitch);
  out.x = -Math.sin(yaw) * c; out.y = Math.sin(pitch); out.z = -Math.cos(yaw) * c;
  return out;
}

function isEnemy(e: SimEntity, t: SimEntity): boolean {
  return !!t.char && !t.dead && t !== e && t.team !== e.team && !t.boss && t.team !== Team.Neutral;
}

/** Distance along the beam (lens, unit dir) to the first surface (world or any character), else `reach`. */
function dotDistance(sim: Sim, e: SimEntity, lens: P3, dir: P3, reach: number): number {
  const maxT = reach + 30;
  let best = worldRay(sim, lens.x, lens.y, lens.z, dir.x, dir.y, dir.z, maxT);
  for (const c of sim.entities.values()) {
    if (!c.char || c.dead || c === e) continue;
    const cap = capsuleOf(c);
    const t = rayCapsule(lens.x, lens.y, lens.z, dir.x, dir.y, dir.z, c.pos.x, c.pos.y + cap.r, c.pos.z, cap.len, cap.r, best);
    if (t >= 0 && t < best) best = t;
  }
  return best >= maxT - 1e-6 ? reach : Math.max(0.05, best);
}

/** Aim at the aim point, then place the dot where the beam lands (updates s.aimYaw/Pitch, s.dot, L, D). */
function paintDot(sim: Sim, e: SimEntity, s: SniperState, def: SniperDef): void {
  aimAt(e, s, def, s.ax, s.ay, s.az);
  sniperLens(def, e.pos.x, e.pos.y, e.pos.z, s.aimYaw, s.aimPitch, L);
  aimDir(s.aimYaw, s.aimPitch, D);
  s.dot = dotDistance(sim, e, L, D, Math.hypot(s.ax - L.x, s.ay - L.y, s.az - L.z));
}

// ------------------------------------------------------------------ decisions

function pickTarget(sim: Sim, e: SimEntity, b: BossState, s: SniperState, def: SniperDef): SimEntity | null {
  let best: SimEntity | null = null, bs = Infinity;
  for (const t of sim.entities.values()) {
    if (!isEnemy(e, t)) continue;
    const d = Math.hypot(t.pos.x - e.pos.x, t.pos.y - e.pos.y, t.pos.z - e.pos.z);
    if (d > def.track.range) continue;
    if (isStealthed(sim, t) && d > 8) continue;
    if (isInvulnerable(sim, t)) continue; // fresh spawns are not worth a shot (and a free telegraph is no telegraph)
    lensToward(e, def, t.pos.x, t.pos.y + 0.8, t.pos.z, L);
    if (!sightPoint(sim, L, t, P)) continue;
    let score = d;
    if (t.ownerPid !== null) score -= 30;                                   // players before squad bots
    if (t.id === b.aggroId && sim.time - b.aggroAt < 5) score -= 25;        // the counter-sniper who hurt her
    if (t.id === s.lastLock) score -= 6;
    score += sim.rng() * 4;
    if (score < bs) { bs = score; best = t; }
  }
  return best;
}

function beginTrack(sim: Sim, e: SimEntity, b: BossState, s: SniperState, def: SniperDef, t: SimEntity): void {
  b.attack = SniperAct.Track;
  b.hitIds.length = 0;
  b.stats.attacks[SniperAct.Track]++;
  setStage(b, BossStage.Telegraph, sniperTrackTime(def, b.phase2));
  s.lock = t.id; s.trackT = 0; s.lostT = 0; s.glinted = false; s.paintAt = sim.time;
  // the dot appears beside the target (a little low) and sweeps onto it at the dot speed
  lensToward(e, def, t.pos.x, t.pos.y + 0.8, t.pos.z, L);
  const vis = sightPoint(sim, L, t, P);
  s.seenX = P.x; s.seenY = P.y; s.seenZ = P.z;
  void vis;
  let px = -(P.z - L.z), pz = P.x - L.x;
  const pl = Math.hypot(px, pz) || 1;
  px /= pl; pz /= pl;
  const side = sim.rng() < 0.5 ? -1 : 1;
  s.ax = P.x + px * def.track.sweepIn * side; s.ay = P.y - 0.9; s.az = P.z + pz * def.track.sweepIn * side;
  paintDot(sim, e, s, def);
  sim.emit({ e: 'ability', id: e.id, ability: SNIPER_ABILITY.paint, x: L.x + D.x * s.dot, y: L.y + D.y * s.dot, z: L.z + D.z * s.dot });
  if (sim.rng() < 0.4) bossBark(sim, e, b, 'laser');
}

function canLob(sim: Sim, e: SimEntity, s: SniperState, def: SniperDef): boolean {
  if (s.hideId < 0 || sim.time < s.lobAt) return false;
  const t = sim.entities.get(s.hideId);
  const since = sim.time - s.hideAt;
  if (!t || t.dead || since > HIDE_MEMORY) { s.hideId = -1; return false; }
  if (since < def.lob.hiddenFor) return false;
  const d = Math.hypot(s.hideX - e.pos.x, s.hideZ - e.pos.z);
  return d >= def.lob.minRange && d <= def.lob.maxRange;
}

function beginLob(sim: Sim, e: SimEntity, b: BossState, s: SniperState, def: SniperDef): void {
  b.attack = SniperAct.Lob;
  b.stats.attacks[SniperAct.Lob]++;
  setStage(b, BossStage.Telegraph, bossTime(def, def.lob.windup, b.phase2));
  s.lobAt = sim.time + def.lob.cooldown;
  s.launched = false;
  aimAt(e, s, def, s.hideX, s.hideY + 0.6, s.hideZ);
  sim.emit({ e: 'ability', id: e.id, ability: BOSS_ABILITY.mortarWindup, x: e.pos.x, y: e.pos.y, z: e.pos.z });
  if (sim.rng() < 0.6) bossBark(sim, e, b, 'mortar');
}

function needRelocate(sim: Sim, e: SimEntity, s: SniperState, def: SniperDef): boolean {
  if (s.perches.length < 2) return false;
  if (s.forceMove || sim.time >= s.relocateAt || s.hurtHere >= def.relocate.hurtFrac * e.health!.max) return true;
  for (const t of sim.entities.values()) {
    if (isEnemy(e, t) && Math.abs(t.pos.y - e.pos.y) < 2.5 && Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z) < def.relocate.close) return true;
  }
  return false;
}

/** Next perch: one from which she can see the duel partner (aggro / last lock), not straight back, a bit random. */
function chooseDest(sim: Sim, e: SimEntity, b: BossState, s: SniperState, def: SniperDef): number {
  const foeId = sim.time - b.aggroAt < 8 ? b.aggroId : s.lastLock;
  const foe = foeId >= 0 ? sim.entities.get(foeId) : undefined;
  let best = -1, bs = -Infinity;
  for (let i = 0; i < s.perches.length; i++) {
    if (i === s.perch) continue;
    const p = s.perches[i];
    let score = sim.rng() * 0.6 + (i === s.prevPerch ? -0.35 : 0);
    if (foe && isEnemy(e, foe)) {
      L.x = p.x; L.y = p.y + def.lens.pivotY; L.z = p.z;
      if (sightPoint(sim, L, foe, P)) score += 1;
    }
    if (score > bs) { bs = score; best = i; }
  }
  return best;
}

function beginLeap(sim: Sim, e: SimEntity, b: BossState, s: SniperState, def: SniperDef): void {
  const dest = chooseDest(sim, e, b, s, def);
  if (dest < 0) { s.forceMove = false; s.relocateAt = sim.time + def.relocate.every[0]; return; }
  sniperRoute(def, s.perches, s.perch, dest, s.route);
  dropLock(s);
  b.attack = SniperAct.Leap;
  b.stats.attacks[SniperAct.Leap]++;
  s.stats.leaps++;
  setStage(b, BossStage.Telegraph, def.relocate.windup);
  s.prevPerch = s.perch; s.perch = dest;
  s.hop = 0; s.hopT = 0; s.hx = e.pos.x; s.hy = e.pos.y; s.hz = e.pos.z;
  s.forceMove = false; s.hurtHere = 0;
  const p = s.perches[dest];
  s.aimYaw = yawTo(s.route[0].x - e.pos.x, s.route[0].z - e.pos.z); s.aimPitch = 0;
  sim.emit({ e: 'ability', id: e.id, ability: SNIPER_ABILITY.leap, x: p.x, y: p.y, z: p.z });
  if (sim.rng() < 0.6) bossBark(sim, e, b, 'leap');
}

function land(sim: Sim, e: SimEntity, b: BossState, s: SniperState, def: SniperDef): void {
  const p = s.perches[s.perch];
  const impact = Math.abs(e.vel.y);
  e.pos.x = p.x; e.pos.y = p.y; e.pos.z = p.z;
  e.vel.x = 0; e.vel.y = 0; e.vel.z = 0;
  s.aimYaw = p.yaw; s.aimPitch = 0;
  s.arriveAt = sim.time;
  const ev = b.phase2 ? def.relocate.everyP2 : def.relocate.every;
  s.relocateAt = sim.time + rand(sim, ev[0], ev[1]);
  s.hurtHere = 0;
  setStage(b, BossStage.Recover, def.relocate.land);
  sim.emit({ e: 'land', id: e.id, impact });
}

function startPhase2(sim: Sim, e: SimEntity, b: BossState, s: SniperState, def: SniperDef): void {
  // crouched for a leap that has not started yet: stay on the perch she is standing on
  if (b.attack === SniperAct.Leap && b.stage === BossStage.Telegraph) s.perch = s.prevPerch;
  b.phase2 = true;
  b.attack = SniperAct.PhaseShift;
  b.hitIds.length = 0;
  setStage(b, BossStage.Active, def.phase2.shiftTime);
  dropLock(s);
  s.forceMove = true;
  sim.emit({ e: 'ability', id: e.id, ability: SNIPER_ABILITY.beretOff, x: e.pos.x, y: e.pos.y + def.height, z: e.pos.z });
  bossBark(sim, e, b, 'phase2', true);
}

/** A weak-point hit while the device glints: the shot is spoiled and she staggers (damage system, 560). */
export function spoilSniperShot(sim: Sim, e: SimEntity): void {
  const b = e.boss!, s = e.sniper!, def = sniperDef(b);
  if (b.attack !== SniperAct.Track || b.stage !== BossStage.Telegraph) return;
  sniperLens(def, e.pos.x, e.pos.y, e.pos.z, s.aimYaw, s.aimPitch, L);
  dropLock(s);
  b.attack = SniperAct.Stagger;
  setStage(b, BossStage.Active, def.stagger);
  s.stats.spoiled++;
  sim.emit({ e: 'ability', id: e.id, ability: SNIPER_ABILITY.spoiled, x: L.x, y: L.y, z: L.z });
  bossBark(sim, e, b, 'spoiled', true);
  writeBossFlags(e, b);
}

/** Is the device glinting right now (the spoil window)? */
export function sniperGlintingNow(e: SimEntity): boolean {
  const b = e.boss, s = e.sniper;
  if (!b || !s || b.attack !== SniperAct.Track || b.stage !== BossStage.Telegraph) return false;
  const def = sniperDef(b);
  return s.trackT >= sniperTrackTime(def, b.phase2) - def.track.glint - 1e-9;
}

// ------------------------------------------------------------------ stage clocks (brain, order 150)

function step(sim: Sim, e: SimEntity, b: BossState, s: SniperState, def: SniperDef, live: boolean, dt: number): void {
  const done = () => b.stageT >= b.stageLen - 1e-9;
  switch (b.attack) {
    case SniperAct.Intro: {
      const before = b.stageT;
      b.stageT += dt;
      if (before < INTRO_DROP_T && b.stageT >= INTRO_DROP_T) sim.emit({ e: 'land', id: e.id, impact: 9 });
      if (done()) toIdle(sim, b, 0.2);
      return;
    }
    case SniperAct.None: {
      if (!live) return;
      // scan: turn toward the last target (or the nearest enemy) between attacks
      const t = s.lastLock >= 0 ? sim.entities.get(s.lastLock) : undefined;
      if (t && isEnemy(e, t)) turnToward(e, s, def, t.pos.x, t.pos.y + 0.7, t.pos.z, 3 * dt);
      if (sim.time < b.readyAt) return;
      if (needRelocate(sim, e, s, def)) { beginLeap(sim, e, b, s, def); return; }
      const target = pickTarget(sim, e, b, s, def);
      if (target) { beginTrack(sim, e, b, s, def, target); return; }
      if (canLob(sim, e, s, def)) { beginLob(sim, e, b, s, def); return; }
      b.readyAt = sim.time + 0.3;
      return;
    }
    case SniperAct.Track:
      if (b.stage === BossStage.Telegraph) {
        // tracking itself runs at 455; enough pain on this perch makes her abandon the shot and move
        if (s.hurtHere >= def.relocate.hurtFrac * e.health!.max) beginLeap(sim, e, b, s, def);
        return;
      }
      b.stageT += dt;
      if (!done()) return;
      if (b.stage === BossStage.Active) { s.dot = 0; setStage(b, BossStage.Recover, bossTime(def, def.recover, b.phase2)); return; }
      toIdle(sim, b, idlePause(sim, def, b));
      return;
    case SniperAct.Lob:
      b.stageT += dt;
      if (!done()) return;
      if (b.stage === BossStage.Telegraph) { setStage(b, BossStage.Active, 0.3); s.launched = false; return; }
      if (b.stage === BossStage.Active) { setStage(b, BossStage.Recover, bossTime(def, 0.8, b.phase2)); return; }
      toIdle(sim, b, idlePause(sim, def, b));
      return;
    case SniperAct.Leap:
      if (b.stage === BossStage.Telegraph) {
        b.stageT += dt;
        if (done()) {
          let total = 0;
          for (const h of s.route) total += h.t;
          setStage(b, BossStage.Active, total);
          s.hop = 0; s.hopT = 0;
        }
        return;
      }
      if (b.stage === BossStage.Active) {
        b.stageT += dt;
        s.hopT += dt;
        while (s.hop < s.route.length && s.hopT >= s.route[s.hop].t - 1e-9) {
          const h = s.route[s.hop];
          s.hopT -= h.t;
          s.hx = h.x; s.hy = h.y; s.hz = h.z;
          s.hop++;
          if (s.hop < s.route.length) sim.emit({ e: 'jump', id: e.id, double: true }); // bounce off the waypoint
        }
        if (s.hop >= s.route.length) land(sim, e, b, s, def);
        else s.aimYaw = yawTo(s.route[s.hop].x - s.hx, s.route[s.hop].z - s.hz);
        return;
      }
      b.stageT += dt;
      if (done()) toIdle(sim, b, idlePause(sim, def, b) * 0.5);
      return;
    case SniperAct.Stagger:
    case SniperAct.PhaseShift:
      b.stageT += dt;
      if (done()) toIdle(sim, b, 0.1);
      return;
  }
}

/** Put the body where the state says (perch, leap arc or intro drop) and keep the collider on it. */
function place(e: SimEntity, b: BossState, s: SniperState, def: SniperDef): void {
  const p = s.perches[s.perch];
  if (b.attack === SniperAct.Leap && b.stage === BossStage.Active && s.hop < s.route.length) {
    hopAt(s.hx, s.hy, s.hz, s.route[s.hop], s.hopT, e.pos, e.vel);
  } else if (b.attack === SniperAct.Leap && b.stage === BossStage.Telegraph) {
    e.pos.x = s.hx; e.pos.y = s.hy; e.pos.z = s.hz;
    e.vel.x = e.vel.y = e.vel.z = 0;
  } else if (b.attack === SniperAct.Intro && b.stageT < INTRO_DROP_T) {
    const u = 1 - Math.max(0, b.stageT) / INTRO_DROP_T;
    e.pos.x = p.x; e.pos.z = p.z; e.pos.y = p.y + INTRO_DROP_H * u * u;
    e.vel.x = 0; e.vel.z = 0; e.vel.y = (-2 * INTRO_DROP_H * u) / INTRO_DROP_T;
  } else {
    e.pos.x = p.x; e.pos.y = p.y; e.pos.z = p.z;
    e.vel.x = e.vel.y = e.vel.z = 0;
  }
  e.char!.grounded = !(e.vel.y !== 0);
  e.collider?.setTranslation({ x: e.pos.x, y: e.pos.y + def.capsule.halfH + def.capsule.r, z: e.pos.z });
}

function defeat(sim: Sim, e: SimEntity, b: BossState, s: SniperState, def: SniperDef, dt: number): void {
  if (b.attack !== SniperAct.Dying) {
    b.attack = SniperAct.Dying;
    setStage(b, BossStage.Active, DEFEAT_TIME);
    b.stats.fightTime = sim.time - b.spawnedAt;
    dropLock(s);
    bossBark(sim, e, b, 'defeat', true);
    if (e.combat) e.combat.removeTick = sim.tick + ticksOf(DEFEAT_TIME);
    if (!sim.state.matchRt) sim.emit({ e: 'score', team: (e.team === Team.Cats ? Team.Corgis : Team.Cats) as 0 | 1, pts: def.score, reason: 'boss' });
    fizzleHairballs(sim, e.id);
    // she tumbles off the perch toward the lawn (the combat lane's corpse physics takes it from here)
    e.moveFrozen = false;
    e.vel.x = -Math.sin(s.aimYaw) * 3; e.vel.y = 4.5; e.vel.z = -Math.cos(s.aimYaw) * 3;
    if (e.char) e.char.grounded = false;
  }
  b.stageT += dt;
}

// ------------------------------------------------------------------ brain entry (order 150)

export function updateSniper(sim: Sim, e: SimEntity, dt: number): void {
  const b = e.boss!, s = e.sniper!, def = sniperDef(b);
  if (e.dead) { defeat(sim, e, b, s, def, dt); writeBossFlags(e, b); return; }
  e.moveFrozen = true;
  const h = e.health!;
  h.lastDamageTick = Math.max(h.lastDamageTick, sim.tick - 1); // bosses never regenerate
  const live = combatLive(sim);
  const midAir = b.attack === SniperAct.Leap && b.stage === BossStage.Active; // the tantrum waits for the landing
  if (!b.phase2 && h.hp <= h.max * def.phase2.at && live && b.attack !== SniperAct.Intro && !midAir) startPhase2(sim, e, b, s, def);
  if (!b.lowHpBarked && h.hp <= h.max * 0.2) { b.lowHpBarked = true; bossBark(sim, e, b, 'lowHp', true); }
  if (!live && (b.attack === SniperAct.Track || b.attack === SniperAct.Lob)) { dropLock(s); toIdle(sim, b, 0.5); }
  if (!live && !b.wonBarked) {
    const m = sim.state.match as { phase?: string; winner?: number } | undefined;
    if (m?.phase === 'ended' && m.winner === e.team) { b.wonBarked = true; bossBark(sim, e, b, 'victory', true); }
  }
  step(sim, e, b, s, def, live, dt);
  place(e, b, s, def);
  writeBossFlags(e, b);
}

// ------------------------------------------------------------------ tracking, the shot, the lob (order 455)

function track(sim: Sim, e: SimEntity, b: BossState, s: SniperState, def: SniperDef, dt: number): void {
  const t = s.lock >= 0 ? sim.entities.get(s.lock) : undefined;
  if (!t || t.dead || !t.char) { dropLock(s); toIdle(sim, b, 0.15); return; }
  const len = sniperTrackTime(def, b.phase2);
  sniperLens(def, e.pos.x, e.pos.y, e.pos.z, s.aimYaw, s.aimPitch, L);
  const vis = sightPoint(sim, L, t, P);
  if (vis) {
    s.seenX = P.x; s.seenY = P.y; s.seenZ = P.z;
    s.hideX = t.pos.x; s.hideY = t.pos.y; s.hideZ = t.pos.z;
    if (sim.time > s.paintAt + 1e-9) s.trackT += dt; // the paint tick itself is the first frame of the warning
    s.lostT = 0;
  } else {
    s.trackT = Math.max(0, s.trackT - def.track.decay * dt);
    s.lostT += dt;
  }
  // the aim point chases the target's chest/head (or where it was last seen) at the dot speed
  const speed = (b.phase2 ? def.track.dotSpeedP2 : def.track.dotSpeed) * dt;
  const dx = s.seenX - s.ax, dy = s.seenY - s.ay, dz = s.seenZ - s.az, d = Math.hypot(dx, dy, dz);
  if (d <= speed) { s.ax = s.seenX; s.ay = s.seenY; s.az = s.seenZ; } else { const k = speed / d; s.ax += dx * k; s.ay += dy * k; s.az += dz * k; }
  paintDot(sim, e, s, def);
  if (!vis && s.lostT >= def.track.lose) {
    // cover works: the lock is lost; she will re-acquire from zero (or lob a hairball at the hiding spot)
    sim.emit({ e: 'ability', id: e.id, ability: SNIPER_ABILITY.lost, x: L.x + D.x * s.dot, y: L.y + D.y * s.dot, z: L.z + D.z * s.dot });
    s.stats.lost++;
    s.hideId = t.id; s.hideAt = sim.time;
    if (sim.rng() < 0.35) bossBark(sim, e, b, 'miss');
    dropLock(s);
    toIdle(sim, b, 0.2);
    return;
  }
  b.stageT = Math.min(s.trackT, b.stageLen - 1e-6); // flags carry the track progress (the glint is its tail)
  if (!s.glinted && s.trackT >= len - def.track.glint - 1e-9) {
    s.glinted = true;
    sim.emit({ e: 'ability', id: e.id, ability: SNIPER_ABILITY.glint, x: L.x, y: L.y, z: L.z });
  }
  if (s.trackT >= len - 1e-9) fire(sim, e, b, s, def, t);
}

function fire(sim: Sim, e: SimEntity, b: BossState, s: SniperState, def: SniperDef, t: SimEntity): void {
  // along the beam exactly as clients draw it (lens + yaw/pitch): the dot shows where the shot goes
  const dx = D.x, dy = D.y, dz = D.z;
  const maxR = def.track.range + 30;
  const tw = worldRay(sim, L.x, L.y, L.z, dx, dy, dz, maxR);
  const cap = capsuleOf(t);
  // only the painted target can be hit: the shot goes along the dot and passes through anyone else
  const tt = rayCapsule(L.x, L.y, L.z, dx, dy, dz, t.pos.x, t.pos.y + cap.r, t.pos.z, cap.len, cap.r, tw);
  const hit = tt >= 0;
  const dist = hit ? tt : Math.min(tw, s.dot > 0 ? s.dot : tw);
  const hx = L.x + dx * dist, hy = L.y + dy * dist, hz = L.z + dz * dist;
  let dmg = 0;
  if (hit) {
    dmg = applyDamage(sim, t, def.shot.damage * (b.phase2 ? def.phase2.dmgMult : 1), { id: e.id, team: e.team, weapon: LASER_WPN }, hx, hy, hz, false);
    b.stats.dmgDealt += dmg;
    if (dmg > 0 && !t.dead) knockback(t, dx * def.shot.knockback, 2, dz * def.shot.knockback);
  }
  sim.emit({ e: 'fire', id: e.id, wpn: LASER_WPN, x: L.x, y: L.y, z: L.z, dx, dy, dz, hx, hy, hz, hit: hit ? t.id : -1 });
  reportNoise(sim, e, 50);
  s.stats.shots++;
  if (hit) s.stats.hits++;
  if (s.stats.shotLog.length < SHOT_LOG_CAP) s.stats.shotLog.push({ target: t.id, paintAt: s.paintAt, fireAt: sim.time, tracked: s.trackT, hit, dmg });
  if (!hit && sim.rng() < 0.5) bossBark(sim, e, b, 'miss');
  s.dot = dist;
  s.lastLock = t.id;
  s.lock = -1;
  setStage(b, BossStage.Active, SHOT_HOLD);
}

function lob(sim: Sim, e: SimEntity, b: BossState, s: SniperState, def: SniperDef): void {
  s.launched = true;
  s.stats.lobs++;
  const count = b.phase2 ? def.lob.countP2 : def.lob.count;
  const T = hairballSpec(def, b.phase2).flight;
  const fx = -Math.sin(s.aimYaw), fz = -Math.cos(s.aimYaw);
  const mx = e.pos.x + fx * 0.35, my = e.pos.y + def.lob.mouthY, mz = e.pos.z + fz * 0.35;
  let sx = -(s.hideZ - mz), sz = s.hideX - mx;
  const sl = Math.hypot(sx, sz) || 1;
  sx /= sl; sz /= sl;
  for (let i = 0; i < count; i++) {
    const off = i === 0 ? 0 : (i % 2 ? 1 : -1) * def.lob.bracket * Math.ceil(i / 2);
    const tx = s.hideX + sx * off, tz = s.hideZ + sz * off;
    const ty = i === 0 ? s.hideY : surfaceAt(sim.worldData, tx, tz, s.hideY + 0.6).y;
    launchHairball(sim, e, mx, my, mz, tx, ty, tz, Math.max(MIN_TELEGRAPH + 0.35, T), def.lob.gravity, b.phase2);
  }
  s.hideId = -1;
}

/** Attack-system entry (order 455): tracking/shot/lob, then the snapshot fields clients draw from. */
export function sniperEffects(sim: Sim, e: SimEntity, dt: number): void {
  const b = e.boss!, s = e.sniper!, def = sniperDef(b);
  if (!e.dead) {
    if (b.attack === SniperAct.Track && b.stage === BossStage.Telegraph) track(sim, e, b, s, def, dt);
    else if (b.attack === SniperAct.Lob && b.stage === BossStage.Active && !s.launched) lob(sim, e, b, s, def);
  }
  // Snapshot: yaw/pitch = the laser aim; ammo = dot distance along it (cm; 0 = beam off); weapon = the laser.
  const beam = !e.dead && b.attack === SniperAct.Track && (b.stage === BossStage.Telegraph || b.stage === BossStage.Active) && s.dot > 0;
  e.ammo = beam ? Math.max(1, Math.round(s.dot * SNIPER_DOT_SCALE)) : 0;
  e.weapon = LASER_WPN;
  if (!e.dead) {
    e.yaw = s.aimYaw; e.pitch = s.aimPitch;
    e.input.yaw = s.aimYaw; e.input.pitch = s.aimPitch;
    const flying = (b.attack === SniperAct.Leap && b.stage === BossStage.Active) || (b.attack === SniperAct.Intro && b.stageT < INTRO_DROP_T);
    let f = e.flags & ~(EFlag.Grounded | EFlag.Aiming | EFlag.Firing | EFlag.Sprinting | EFlag.Reloading);
    if (!flying) f |= EFlag.Grounded | EFlag.Aiming;
    if (b.attack === SniperAct.Track && b.stage === BossStage.Active) f |= EFlag.Firing;
    e.flags = f;
    e.anim = flying ? (e.vel.y > 0 ? Anim.Jump : Anim.Fall) : Anim.Idle;
  }
  writeBossFlags(e, b);
}

/** Squad size for the hp formula: humans (and scripted players) count 1, corgi bots `botWeight`. */
export function weightedSquad(sim: Sim, bossTeam: TeamId, botWeight: number): number {
  let n = 0;
  for (const e of sim.entities.values()) {
    if (!e.char || e.team === bossTeam || e.kind === EntityKind.Boss || e.combat?.pve || e.team === Team.Neutral) continue;
    n += e.kind === EntityKind.Bot ? botWeight : 1;
  }
  return Math.max(1, n);
}


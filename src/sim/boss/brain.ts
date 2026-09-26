// Boss brain (order 150, after bot AI at 100 and before movement at 200). A telegraphed attack state
// machine that only decides: target, stage timers, aim (yaw/pitch = the laser/turret) and a movement
// intent written into e.input, so the shared KCC movement (stepCharacter) drives the tank over the
// terrain exactly like a character. Damage and spawns happen in the attack system (order 455).
//
//   intro ─▶ idle ──choose──▶ telegraph (≥ 0.8 s, readable) ─▶ active (damage window) ─▶ recover ─▶ idle
//              ▲                                                                                   │
//              └───────────────────────────────────────────────────────────────────────────────────┘
//   at 50 % hp: phase shift (lid pops, taunt, kittens) → phase 2 (attacks ×1.3 faster, pilot exposed)
//   on death:   defeat sequence (big boom, pilot ejects, removal after ~5 s)
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { Team, EFlag, type EntityId } from '../../shared/types';
import { angleDelta } from '../../shared/math';
import { CHARACTER_MOVE_FILTER } from '../rapier';
import { combatLive, isStealthed, ticksOf, capsuleOf } from '../combat/state';
import { worldLineClear } from '../combat/geometry';
import {
  BossAttack, BossStage, BOSS_ABILITY, MIN_TELEGRAPH, bossContactPush, bossMuzzle, bossTime, type VacTankDef as BossDef, type P3,
} from '../../shared/content/bosses';
import { bossBark, bossesOf, setStage, tankDef, writeBossFlags, type BossState } from './state';
import { updateSniper } from './sniper';
import { bossNavGrid, discClear, nearestClear, sweepClear } from './nav';

const scratch: SimEntity[] = [];
const enemies: SimEntity[] = [];
const mz: P3 = { x: 0, y: 0, z: 0 };
const push = { x: 0, z: 0 };

/** Seconds the defeat sequence lasts before the wreck is removed. */
export const DEFEAT_TIME = 5;
/** Moment in the defeat sequence the pilot is ejected. */
export const EJECT_AT = 0.45;

const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);

// ------------------------------------------------------------------ helpers

function enemyTeamOf(e: SimEntity): number {
  return e.team === Team.Cats ? Team.Corgis : Team.Cats;
}

/** Living enemy characters in range, visible to the boss (cloaked ones only up close). */
function collectEnemies(sim: Sim, e: SimEntity, range: number): SimEntity[] {
  enemies.length = 0;
  for (const t of sim.entities.values()) {
    if (!t.char || t.dead || t === e || t.team === e.team || t.boss) continue;
    const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
    if (d > range) continue;
    if (isStealthed(sim, t) && d > 6) continue;
    enemies.push(t);
  }
  return enemies;
}

function targetScore(sim: Sim, e: SimEntity, b: BossState, t: SimEntity): number {
  const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
  let s = d;
  if (t.id === b.target) s -= 5;                                                       // sticky
  if (t.id === b.aggroId && sim.time - b.aggroAt < 3) s -= 7;                          // aggro on who hurts it
  if (t.ownerPid !== null) s -= 8;                                                     // players over bots (the squad is support)
  return s + sim.rng() * 3;
}

function retarget(sim: Sim, e: SimEntity, b: BossState): SimEntity | null {
  const list = collectEnemies(sim, e, 60);
  let best: SimEntity | null = null, bs = Infinity;
  for (const t of list) {
    const s = targetScore(sim, e, b, t);
    if (s < bs) { bs = s; best = t; }
  }
  b.target = best ? best.id : -1;
  b.retargetAt = sim.time + 1.2;
  return best;
}

function currentTarget(sim: Sim, e: SimEntity, b: BossState): SimEntity | null {
  const t = b.target >= 0 ? sim.entities.get(b.target) : undefined;
  const valid = t && t.char && !t.dead && t.team !== e.team;
  // an attack in progress keeps its target (the telegraph must stay truthful)
  const committed = b.stage === BossStage.Telegraph || b.stage === BossStage.Active;
  if (!valid || (!committed && sim.time >= b.retargetAt)) return retarget(sim, e, b);
  return t!;
}

/** Laser lens position if the turret faced (tx, tz). */
function muzzleToward(def: BossDef, e: SimEntity, tx: number, tz: number, out: P3): P3 {
  return bossMuzzle(def, e.pos.x, e.pos.y, e.pos.z, yawTo(tx - e.pos.x, tz - e.pos.z), 0, out);
}

function hasLaserLine(sim: Sim, def: BossDef, e: SimEntity, t: SimEntity): boolean {
  muzzleToward(def, e, t.pos.x, t.pos.z, mz);
  const h = capsuleOf(t).height;
  return worldLineClear(sim, mz.x, mz.y, mz.z, t.pos.x, t.pos.y + h * 0.5, t.pos.z) || worldLineClear(sim, mz.x, mz.y, mz.z, t.pos.x, t.pos.y + 0.2, t.pos.z);
}

function aliveKittens(sim: Sim, b: BossState): number {
  let n = 0;
  for (let i = b.kittens.length - 1; i >= 0; i--) {
    const k = sim.entities.get(b.kittens[i]);
    if (!k || k.dead) b.kittens.splice(i, 1); else n++;
  }
  return n;
}

// ------------------------------------------------------------------ attack scheduling

function begin(sim: Sim, e: SimEntity, b: BossState, def: BossDef, attack: number, t: SimEntity | null): void {
  const p2 = b.phase2;
  b.attack = attack;
  b.hitIds.length = 0;
  b.stats.attacks[attack]++;
  b.streak = b.last === attack ? b.streak + 1 : 1;
  b.last = attack;
  const tele = (s: number) => bossTime(def, s, p2, MIN_TELEGRAPH);
  switch (attack) {
    case BossAttack.Laser: {
      setStage(b, BossStage.Telegraph, tele(def.laser.telegraph));
      // the dot appears on the ground just ahead of the turret and races toward the target
      const tx = t ? t.pos.x : e.pos.x - Math.sin(b.aimYaw) * 12, tz = t ? t.pos.z : e.pos.z - Math.cos(b.aimYaw) * 12;
      const dx = tx - e.pos.x, dz = tz - e.pos.z, d = Math.hypot(dx, dz) || 1;
      // start where the dot reaches the target ~80 % into the telegraph, then it tracks them
      const run = def.laser.dotSpeed * (p2 ? def.phase2.speedup : 1) * b.stageLen * 0.8;
      const start = Math.max(Math.min(4, d * 0.5), Math.min(d, d - run));
      b.dotX = e.pos.x + (dx / d) * start; b.dotZ = e.pos.z + (dz / d) * start;
      b.dotY = sim.worldData.height(b.dotX, b.dotZ);
      b.sweepSign = sim.rng() < 0.5 ? -1 : 1;
      sim.emit({ e: 'ability', id: e.id, ability: BOSS_ABILITY.laserPaint, x: b.dotX, y: b.dotY, z: b.dotZ });
      if (sim.rng() < 0.45) bossBark(sim, e, b, 'laser');
      break;
    }
    case BossAttack.Mortar:
      setStage(b, BossStage.Telegraph, tele(def.mortar.windup));
      b.shells.length = 0; b.launched = 0;
      sim.emit({ e: 'ability', id: e.id, ability: BOSS_ABILITY.mortarWindup, x: e.pos.x, y: e.pos.y, z: e.pos.z });
      if (sim.rng() < 0.45) bossBark(sim, e, b, 'mortar');
      break;
    case BossAttack.Spin:
      setStage(b, BossStage.Telegraph, tele(def.spin.windup));
      b.spinAt = sim.time + def.spin.cooldown;
      sim.emit({ e: 'ability', id: e.id, ability: BOSS_ABILITY.spinWindup, x: e.pos.x, y: e.pos.y, z: e.pos.z });
      if (sim.rng() < 0.5) bossBark(sim, e, b, 'spin');
      break;
    case BossAttack.Kittens:
      setStage(b, BossStage.Telegraph, tele(def.kittens.windup));
      b.kittensAt = sim.time + def.kittens.cooldown;
      b.kitSpawned = 0;
      bossBark(sim, e, b, 'kittens');
      break;
  }
}

/** Pick the next attack (deterministic: weights + sim.rng). 0 = nothing sensible right now. */
function chooseAttack(sim: Sim, e: SimEntity, b: BossState, def: BossDef, t: SimEntity | null): number {
  if (b.forced) { const f = b.forced; b.forced = 0; return f; }
  if (!t) return 0;
  // too close: brush spin (the "get off me" move) whenever it is off cooldown
  let close = 0;
  for (const c of collectEnemies(sim, e, def.spin.trigger)) if (c.pos.y - e.pos.y < def.spin.maxFeet + 1) close++;
  if (close > 0 && sim.time >= b.spinAt) return BossAttack.Spin;
  if (b.phase2 && sim.time >= b.kittensAt && aliveKittens(sim, b) < def.kittens.maxAlive) return BossAttack.Kittens;
  const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
  let wl = 0, wm = 0;
  if (d >= def.laser.minRange && d <= def.laser.maxRange && hasLaserLine(sim, def, e, t)) wl = 1;
  if (d >= def.mortar.minRange && d <= def.mortar.maxRange) {
    wm = 1;
    const n = collectEnemies(sim, e, def.mortar.maxRange).length;
    if (n >= 2) wm += 0.2;
    if (wl === 0) wm += 1;
  }
  if (b.last === BossAttack.Laser) wl *= b.streak >= 2 ? 0 : 0.45;
  if (b.last === BossAttack.Mortar) wm *= b.streak >= 2 ? 0 : 0.45;
  const sum = wl + wm;
  if (sum <= 0) return 0;
  return sim.rng() * sum < wl ? BossAttack.Laser : BossAttack.Mortar;
}

function toIdle(sim: Sim, b: BossState): void {
  b.attack = BossAttack.None;
  setStage(b, BossStage.Idle, 1);
  b.readyAt = sim.time + sim.rng() * 0.35;
}

function recover(b: BossState, def: BossDef): void {
  setStage(b, BossStage.Recover, bossTime(def, def.recover, b.phase2));
}

function startPhaseShift(sim: Sim, e: SimEntity, b: BossState, def: BossDef): void {
  b.phase2 = true;
  b.attack = BossAttack.PhaseShift;
  b.hitIds.length = 0;
  b.kitSpawned = 0;
  b.kittensAt = sim.time + def.kittens.cooldown;
  b.spinAt = Math.min(b.spinAt, sim.time + def.phase2.shiftTime);
  setStage(b, BossStage.Active, def.phase2.shiftTime);
  const m = e.char!.move;
  m.runSpeed = def.move.speed * def.phase2.moveMult;
  m.walkSpeed = m.runSpeed * 0.5;
  sim.emit({ e: 'ability', id: e.id, ability: BOSS_ABILITY.lidPop, x: e.pos.x, y: e.pos.y + def.deckY + 0.9, z: e.pos.z });
  bossBark(sim, e, b, 'phase2', true);
}

/** Advance the current attack's stage clock; transitions only (effects live in attacks.ts). */
function stepStages(sim: Sim, e: SimEntity, b: BossState, def: BossDef, t: SimEntity | null, live: boolean, dt: number): void {
  b.stageT += dt;
  const done = b.stageT >= b.stageLen - 1e-9;
  switch (b.attack) {
    case BossAttack.Intro:
      if (done) toIdle(sim, b);
      return;
    case BossAttack.None:
      if (live && sim.time >= b.readyAt) {
        const a = chooseAttack(sim, e, b, def, t);
        if (a) begin(sim, e, b, def, a, t);
        else b.readyAt = sim.time + 0.4;
      }
      return;
    case BossAttack.PhaseShift:
      if (done) { toIdle(sim, b); b.readyAt = sim.time + 0.5; }
      return;
  }
  if (!done) return;
  if (b.stage === BossStage.Recover) { toIdle(sim, b); return; }
  if (b.stage === BossStage.Active) { recover(b, def); return; }
  // telegraph over → active
  const p2 = b.phase2;
  b.hitIds.length = 0;
  switch (b.attack) {
    case BossAttack.Laser: {
      // lock: the sweep arc is centred on wherever the dot is now
      b.lockYaw = yawTo(b.dotX - e.pos.x, b.dotZ - e.pos.z);
      b.lockDist = Math.max(def.laser.minRange * 0.8, Math.hypot(b.dotX - e.pos.x, b.dotZ - e.pos.z) - def.turret.pivotFwd);
      setStage(b, BossStage.Active, bossTime(def, def.laser.sweep, p2));
      sim.emit({ e: 'ability', id: e.id, ability: BOSS_ABILITY.laserSweep, x: b.dotX, y: b.dotY, z: b.dotZ });
      break;
    }
    case BossAttack.Mortar: {
      planShells(sim, e, b, def, t);
      const flight = bossTime(def, def.mortar.flight, p2, MIN_TELEGRAPH + 0.35);
      setStage(b, BossStage.Active, (shellCount(def, b) - 1) * def.mortar.stagger + flight + 0.1);
      break;
    }
    case BossAttack.Spin:
      setStage(b, BossStage.Active, bossTime(def, def.spin.duration, p2));
      sim.emit({ e: 'ability', id: e.id, ability: BOSS_ABILITY.spinGo, x: e.pos.x, y: e.pos.y, z: e.pos.z });
      break;
    case BossAttack.Kittens:
      setStage(b, BossStage.Active, def.kittens.stagger * def.kittens.count + 0.3);
      break;
  }
}

export const shellCount = (def: BossDef, b: BossState) => (b.phase2 ? def.mortar.countP2 : def.mortar.count);

/** Landing points: one per visible enemy (priority order), extra shells bracket the main target. */
function planShells(sim: Sim, e: SimEntity, b: BossState, def: BossDef, t: SimEntity | null): void {
  const list = collectEnemies(sim, e, def.mortar.maxRange + 4).slice();
  list.sort((a, c) => (a.id === b.target ? -1 : c.id === b.target ? 1 : 0) || Math.hypot(a.pos.x - e.pos.x, a.pos.z - e.pos.z) - Math.hypot(c.pos.x - e.pos.x, c.pos.z - e.pos.z));
  const main = t ?? list[0] ?? null;
  const shells = b.shells;
  shells.length = 0;
  const used: EntityId[] = [];
  // half-lead on moving targets (the circle shows the true landing spot, so it stays fair)
  const lead = bossTime(def, def.mortar.flight, b.phase2, MIN_TELEGRAPH + 0.35) * 0.5;
  for (const c of list) {
    if (shells.length / 3 >= shellCount(def, b)) break;
    if (Math.hypot(c.pos.x - e.pos.x, c.pos.z - e.pos.z) < def.mortar.minRange) continue;
    const lx = c.pos.x + c.vel.x * lead, lz = c.pos.z + c.vel.z * lead;
    const onGround = c.char?.grounded ?? true;
    shells.push(lx, onGround && Math.hypot(c.vel.x, c.vel.z) < 0.5 ? c.pos.y : sim.worldData.height(lx, lz), lz);
    used.push(c.id);
  }
  // bracket the main target sideways (and a little long/short) with the rest
  let k = 0;
  const mx = main ? main.pos.x : e.pos.x - Math.sin(b.aimYaw) * 14, mzz = main ? main.pos.z : e.pos.z - Math.cos(b.aimYaw) * 14;
  const dx = mx - e.pos.x, dz = mzz - e.pos.z, d = Math.hypot(dx, dz) || 1;
  const px = -dz / d, pz = dx / d;
  while (shells.length / 3 < shellCount(def, b)) {
    const side = k % 2 === 0 ? 1 : -1, ring = 1 + (k >> 1);
    const along = (sim.rng() - 0.5) * 2.2;
    const x = mx + px * def.mortar.bracket * side * ring + (dx / d) * along;
    const z = mzz + pz * def.mortar.bracket * side * ring + (dz / d) * along;
    shells.push(x, sim.worldData.height(x, z), z);
    k++;
  }
}

// ------------------------------------------------------------------ locomotion

function chooseGoal(sim: Sim, e: SimEntity, b: BossState, def: BossDef, t: SimEntity | null): void {
  const g = bossNavGrid(sim);
  const R = def.radius + 0.3;
  let gx = b.anchorX, gz = b.anchorZ;
  if (t) {
    const dx = e.pos.x - t.pos.x, dz = e.pos.z - t.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const [lo, hi] = def.move.band;
    let want = d;
    if (d > hi) want = (lo + hi) * 0.5;
    else if (d < lo) want = hi - 2;
    // circle-strafe around the target a little so the tank never parks
    if (sim.rng() < 0.3) b.strafe = -b.strafe;
    const a = Math.atan2(dz, dx) + b.strafe * (0.35 + sim.rng() * 0.3);
    gx = t.pos.x + Math.cos(a) * want; gz = t.pos.z + Math.sin(a) * want;
  } else {
    const a = sim.rng() * Math.PI * 2, r = 4 + sim.rng() * 10;
    gx = b.anchorX + Math.cos(a) * r; gz = b.anchorZ + Math.sin(a) * r;
  }
  // leash to the arena
  const lx = gx - b.anchorX, lz = gz - b.anchorZ, ld = Math.hypot(lx, lz);
  if (ld > def.move.leash) { gx = b.anchorX + (lx / ld) * def.move.leash; gz = b.anchorZ + (lz / ld) * def.move.leash; }
  if (g) {
    const c = nearestClear(g, gx, gz, R, 12);
    if (c) { gx = c.x; gz = c.z; } else { gx = b.anchorX; gz = b.anchorZ; }
  }
  b.goalX = gx; b.goalZ = gz; b.hasGoal = true;
  b.goalUntil = sim.time + 2 + sim.rng() * 1.5;
}

/** Desired move direction toward the goal, bent around blocked footprints. Returns speed fraction 0..1. */
function steer(sim: Sim, e: SimEntity, b: BossState, def: BossDef, out: { x: number; z: number }): number {
  const dx = b.goalX - e.pos.x, dz = b.goalZ - e.pos.z;
  const d = Math.hypot(dx, dz);
  out.x = 0; out.z = 0;
  if (d < 1.2) { b.hasGoal = false; return 0; }
  let ux = dx / d, uz = dz / d;
  const g = bossNavGrid(sim);
  if (g) {
    const R = def.radius + 0.2, look = Math.min(d, 5);
    let ok = sweepClear(g, e.pos.x, e.pos.z, e.pos.x + ux * look, e.pos.z + uz * look, R, 1.25);
    for (let k = 1; !ok && k <= 6; k++) {
      const a = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.45;
      const c = Math.cos(a), s = Math.sin(a);
      const vx = ux * c - uz * s, vz = ux * s + uz * c;
      if (sweepClear(g, e.pos.x, e.pos.z, e.pos.x + vx * look, e.pos.z + vz * look, R, 1.25)) { ux = vx; uz = vz; ok = true; }
    }
    if (!ok && !discClear(g, e.pos.x, e.pos.z, R)) { /* already overlapping clutter: push straight on, the KCC slides */ }
  }
  out.x = ux; out.z = uz;
  return Math.min(1, d / 3);
}

const dir = { x: 0, z: 0 };

function drive(sim: Sim, e: SimEntity, b: BossState, def: BossDef, t: SimEntity | null, dt: number): void {
  const moving = (b.attack === BossAttack.None || b.stage === BossStage.Recover) && b.attack !== BossAttack.Intro && b.attack !== BossAttack.PhaseShift;
  let speed = 0;
  dir.x = 0; dir.z = 0;
  if (moving) {
    if (!b.hasGoal || sim.time >= b.goalUntil) chooseGoal(sim, e, b, def, t);
    speed = steer(sim, e, b, def, dir);
  }
  // chassis heading turns toward the desired direction; the tank creeps forward while turning
  let vx = 0, vz = 0;
  if (speed > 0) {
    const want = yawTo(dir.x, dir.z);
    const da = angleDelta(b.heading, want);
    const step = def.move.turnRate * (b.phase2 ? def.phase2.moveMult : 1) * dt;
    b.heading += Math.max(-step, Math.min(step, da));
    const k = speed * (0.3 + 0.7 * Math.max(0, Math.cos(angleDelta(b.heading, want))));
    vx = -Math.sin(b.heading) * k; vz = -Math.cos(b.heading) * k;
  }
  // stuck detection (odometer while wanting to move)
  b.odo += Math.hypot(e.pos.x - b.lastX, e.pos.z - b.lastZ);
  b.lastX = e.pos.x; b.lastZ = e.pos.z;
  b.checkT += dt;
  if (b.checkT >= 0.75) {
    if (speed > 0.3 && b.odo < 0.25) b.stuck += b.checkT; else b.stuck = 0;
    b.checkT = 0; b.odo = 0;
    if (b.stuck >= 1.5) {
      b.stuck = 0;
      b.hasGoal = false;
      b.goalX = e.pos.x + (sim.rng() - 0.5) * 16; b.goalZ = e.pos.z + (sim.rng() - 0.5) * 16;
      b.hasGoal = true; b.goalUntil = sim.time + 2.5;
    }
  }
  // write the input (movement relative to the aim yaw, like every other actor)
  const inp = e.input;
  const sy = Math.sin(b.aimYaw), cy = Math.cos(b.aimYaw);
  inp.mz = vx * -sy + vz * -cy;
  inp.mx = vx * cy + vz * -sy;
  inp.yaw = b.aimYaw;
  inp.pitch = b.aimPitch;
  inp.buttons = 0;
  inp.rt = 0;
  inp.seq++;
}

// ------------------------------------------------------------------ aim

function aim(sim: Sim, e: SimEntity, b: BossState, def: BossDef, t: SimEntity | null, dt: number): void {
  const p2 = b.phase2;
  if (b.attack === BossAttack.Laser && b.stage === BossStage.Telegraph) {
    // the dot runs across the ground toward the target's feet
    if (t) {
      const dx = t.pos.x - b.dotX, dz = t.pos.z - b.dotZ, d = Math.hypot(dx, dz);
      const v = def.laser.dotSpeed * (p2 ? def.phase2.speedup : 1) * dt;
      if (d > 1e-4) { const k = Math.min(1, v / d); b.dotX += dx * k; b.dotZ += dz * k; }
    }
    b.dotY = sim.worldData.height(b.dotX, b.dotZ);
    aimAtGround(e, b, def, b.dotX, b.dotY, b.dotZ);
    return;
  }
  if (b.attack === BossAttack.Laser && b.stage === BossStage.Active) {
    const u = Math.min(1, b.stageT / b.stageLen);
    const yaw = b.lockYaw + b.sweepSign * def.laser.arc * (2 * u - 1);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const reach = def.turret.pivotFwd + b.lockDist;
    b.dotX = e.pos.x + fx * reach; b.dotZ = e.pos.z + fz * reach;
    b.dotY = sim.worldData.height(b.dotX, b.dotZ);
    aimAtGround(e, b, def, b.dotX, b.dotY, b.dotZ);
    return;
  }
  if (b.attack === BossAttack.Spin && b.stage === BossStage.Active) {
    b.aimYaw += 9 * dt; // turret whirls with the brushes
    b.aimPitch = 0;
    return;
  }
  // idle tracking: the turret follows the target at a turret turn rate
  let wantYaw = b.aimYaw, wantPitch = 0;
  if (t) {
    wantYaw = yawTo(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
    const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
    wantPitch = Math.atan2(t.pos.y + 0.6 - (e.pos.y + def.turret.pivotY), Math.max(1, d - def.turret.pivotFwd));
    if (b.attack === BossAttack.Mortar) wantPitch = 0.55;
  }
  const step = (p2 ? 3 : 2.3) * dt;
  b.aimYaw += Math.max(-step, Math.min(step, angleDelta(b.aimYaw, wantYaw)));
  b.aimPitch += Math.max(-step, Math.min(step, wantPitch - b.aimPitch));
}

function aimAtGround(e: SimEntity, b: BossState, def: BossDef, x: number, y: number, z: number): void {
  const yaw = yawTo(x - e.pos.x, z - e.pos.z);
  const px = e.pos.x - Math.sin(yaw) * def.turret.pivotFwd, pz = e.pos.z - Math.cos(yaw) * def.turret.pivotFwd;
  b.aimYaw = yaw;
  b.aimPitch = Math.atan2(y - (e.pos.y + def.turret.pivotY), Math.max(0.5, Math.hypot(x - px, z - pz)));
}

// ------------------------------------------------------------------ body contact

/** Keep characters out of the hull (characters' KCC ignores other characters, so the boss pushes). */
function pushOut(sim: Sim, e: SimEntity, def: BossDef): void {
  for (const c of sim.entities.values()) {
    if (c === e || !c.char || c.dead || c.boss || !c.collider || c.flags & EFlag.Mounted) continue;
    const cap = capsuleOf(c);
    const p = bossContactPush(def, e.pos.x, e.pos.y, e.pos.z, c.pos.x, c.pos.y, c.pos.z, cap.height, cap.r, push);
    if (p <= 0) continue;
    const amt = p + 0.01;
    sim.kcc.computeColliderMovement(c.collider, { x: push.x * amt, y: 0, z: push.z * amt }, undefined, CHARACTER_MOVE_FILTER);
    const mv = sim.kcc.computedMovement();
    const tr = c.collider.translation();
    c.collider.setTranslation({ x: tr.x + mv.x, y: tr.y, z: tr.z + mv.z });
    c.pos.x += mv.x; c.pos.z += mv.z;
    const vn = c.vel.x * push.x + c.vel.z * push.z;
    if (vn < 0) { c.vel.x -= push.x * vn; c.vel.z -= push.z * vn; }
  }
}

/** The tank is far heavier than anything that shoves it: bleed off knockback, no launches. */
function clampBody(e: SimEntity, b: BossState, def: BossDef): void {
  const max = def.move.speed * (b.phase2 ? def.phase2.moveMult : 1) + 0.3;
  const hs = Math.hypot(e.vel.x, e.vel.z);
  if (hs > max) { e.vel.x *= max / hs; e.vel.z *= max / hs; }
  if (e.vel.y > 0 && b.attack !== BossAttack.Intro) e.vel.y = 0;
}

// ------------------------------------------------------------------ defeat

function defeat(sim: Sim, e: SimEntity, b: BossState, def: BossDef, dt: number): void {
  if (b.attack !== BossAttack.Dying) {
    b.attack = BossAttack.Dying;
    setStage(b, BossStage.Active, DEFEAT_TIME);
    b.ejected = false; b.booms = 0;
    b.stats.fightTime = sim.time - b.spawnedAt;
    const killer = e.health!.lastAttacker;
    sim.emit({ e: 'explode', x: e.pos.x, y: e.pos.y + def.radius * 0.8, z: e.pos.z, r: def.radius * 2.6, by: killer });
    bossBark(sim, e, b, 'defeat', true);
    // the wreck stays for the defeat sequence, then the respawn system removes it (PvE corpse)
    if (e.combat) e.combat.removeTick = sim.tick + ticksOf(DEFEAT_TIME);
    // inside a match the match system awards the defeat; standalone (lab, tests) we do
    if (!sim.state.matchRt) sim.emit({ e: 'score', team: enemyTeamOf(e) as 0 | 1, pts: def.score, reason: 'boss' });
    // hairballs still in the air fizzle out
    for (const h of sim.entities.values()) if (h.hairball && h.hairball.boss === e.id) h.hairball.t = -1e9;
  }
  b.stageT += dt;
  if (!b.ejected && b.stageT >= EJECT_AT) {
    b.ejected = true;
    sim.emit({ e: 'ability', id: e.id, ability: BOSS_ABILITY.eject, x: e.pos.x, y: e.pos.y + def.deckY + 0.6, z: e.pos.z });
  }
  const booms = [1.0, 1.7, 2.3];
  if (b.booms < booms.length && b.stageT >= booms[b.booms]) {
    const a = sim.rng() * Math.PI * 2;
    sim.emit({ e: 'explode', x: e.pos.x + Math.cos(a) * 1.6, y: e.pos.y + 1.2 + sim.rng() * 1.2, z: e.pos.z + Math.sin(a) * 1.6, r: 2.2, by: e.id });
    b.booms++;
  }
}

// ------------------------------------------------------------------ system

export function updateBoss(sim: Sim, e: SimEntity, dt: number): void {
  const b = e.boss!;
  const def = tankDef(b);
  if (e.dead) { defeat(sim, e, b, def, dt); writeBossFlags(e, b); return; }
  const h = e.health!;
  h.lastDamageTick = Math.max(h.lastDamageTick, sim.tick - 1); // bosses never regenerate
  e.weapon = -1;
  clampBody(e, b, def);
  pushOut(sim, e, def);
  const live = combatLive(sim);

  if (!b.phase2 && h.hp <= h.max * def.phase2.at && live && b.attack !== BossAttack.Intro) startPhaseShift(sim, e, b, def);
  if (!b.lowHpBarked && h.hp <= h.max * 0.2) { b.lowHpBarked = true; bossBark(sim, e, b, 'lowHp', true); }
  if (!live && b.attack !== BossAttack.Intro && b.attack !== BossAttack.None && b.attack !== BossAttack.PhaseShift) toIdle(sim, b);
  if (!live && !b.wonBarked) {
    const m = sim.state.match as { phase?: string; winner?: number } | undefined;
    if (m?.phase === 'ended' && m.winner === e.team) { b.wonBarked = true; bossBark(sim, e, b, 'victory', true); }
  }

  const t = currentTarget(sim, e, b);
  stepStages(sim, e, b, def, t, live, dt);
  aim(sim, e, b, def, t, dt);
  drive(sim, e, b, def, t, dt);
  writeBossFlags(e, b);
}

export const bossBrainSystem: SimSystem = {
  name: 'boss-brain',
  order: 150,
  update(sim, dt) {
    for (const e of bossesOf(sim, scratch)) {
      if (e.sniper) updateSniper(sim, e, dt); // E1: the sniper elite (perches, relocation, decisions)
      else updateBoss(sim, e, dt);
    }
    scratch.length = 0;
  },
};

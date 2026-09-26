// Boss attack effects (order 455: after movement, the physics step and player weapons, so hit tests
// use this tick's positions and a fresh world BVH). The brain (150) decided the stage and aim; this
// system applies the damage windows through the combat lane's own functions (applyDamage, knockback,
// explode) and spawns hairballs and kittens. Nothing here deals damage outside an `active` stage.
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, EntityKind, Species } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import { weaponIndex, type ProjectileDef } from '../../shared/content/weapons';
import { BossAttack, BossStage, BOSS_ABILITY, MIN_TELEGRAPH, BOSSES, bossMuzzle, bossTime, type BossDef, type P3 } from '../../shared/content/bosses';
import { applyDamage, knockback, explode, ensureCombat, capsuleOf, rayCapsule, worldRay } from '../combat';
import { reportNoise } from '../combat/state';
import { applyArchetype, ARCHETYPES } from '../ai';
import { bossDef, bossesOf, writeBossFlags, type BossState } from './state';
import { bossNavGrid, groundAt } from './nav';
import { nearestWalkable, cellX, cellZ } from '../ai/nav';

const LASER_WPN = weaponIndex('laser_longshot');
/** The laser dot scorches feet within this reach (m, beyond the capsule radius) and this height of the ground. */
export const LASER_BURN = 0.35;
export const LASER_BURN_HEIGHT = 0.6;
const scratch: SimEntity[] = [];
const hairballs: SimEntity[] = [];
const m: P3 = { x: 0, y: 0, z: 0 };

/** Blast definitions per boss and phase (phase 2 hits harder). */
const blastCache = new Map<string, ProjectileDef>();
function blastFor(def: BossDef, phase2: boolean): ProjectileDef {
  const key = `${def.id}:${phase2 ? 2 : 1}`;
  let b = blastCache.get(key);
  if (!b) {
    const base = def.mortar.blast;
    b = phase2 ? { ...base, explodeDamage: base.explodeDamage * def.phase2.dmgMult } : base;
    blastCache.set(key, b);
  }
  return b;
}

const dmgScale = (def: BossDef, b: BossState) => (b.phase2 ? def.phase2.dmgMult : 1);

// ------------------------------------------------------------------ laser pointer sweep

function laserSweep(sim: Sim, e: SimEntity, b: BossState, def: BossDef): void {
  const mz = bossMuzzle(def, e.pos.x, e.pos.y, e.pos.z, b.aimYaw, b.aimPitch, m);
  let dx = b.dotX - mz.x, dy = b.dotY - mz.y, dz = b.dotZ - mz.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;
  const maxT = len + 0.4;
  let best = worldRay(sim, mz.x, mz.y, mz.z, dx, dy, dz, maxT);
  const blocked = best < len - 0.6; // cover between the lens and the dot: no dot on the far side
  let hit: SimEntity | null = null;
  let burn: SimEntity | null = null;
  for (const t of sim.entities.values()) {
    if (!t.char || t.dead || t.team === e.team || t.boss || b.hitIds.includes(t.id)) continue;
    const cap = capsuleOf(t);
    // the beam: anything standing in the line from the lens to the dot
    const tt = rayCapsule(mz.x, mz.y, mz.z, dx, dy, dz, t.pos.x, t.pos.y + cap.r, t.pos.z, cap.len, cap.r, best);
    if (tt >= 0 && tt < best) { best = tt; hit = t; continue; }
    // the dot: it scorches the ground it crosses (feet on the ground within reach of the dot; jump it)
    if (!blocked && !burn && Math.hypot(t.pos.x - b.dotX, t.pos.z - b.dotZ) <= cap.r + LASER_BURN && Math.abs(t.pos.y - b.dotY) <= LASER_BURN_HEIGHT) burn = t;
  }
  if (!hit && burn) { hit = burn; best = len; }
  const hx = mz.x + dx * best, hy = mz.y + dy * best, hz = mz.z + dz * best;
  if (hit) {
    b.hitIds.push(hit.id);
    const cap = capsuleOf(hit);
    const py = hit === burn ? hit.pos.y + cap.r : hy;
    const dmg = applyDamage(sim, hit, def.laser.damage * dmgScale(def, b), { id: e.id, team: e.team, weapon: LASER_WPN }, hx, py, hz, false);
    b.stats.dmgDealt += dmg;
    if (dmg > 0) knockback(hit, dx * 3, 2.5, dz * 3);
  }
  // beam segments for FX/audio (the client also draws the continuous beam from yaw/pitch)
  const every = Math.max(1, def.laser.fireEvery);
  if (hit || Math.floor(b.stageT * 60 + 1e-6) % every === 0) {
    sim.emit({ e: 'fire', id: e.id, wpn: LASER_WPN, x: mz.x, y: mz.y, z: mz.z, dx, dy, dz, hx, hy, hz, hit: hit ? hit.id : -1 });
  }
}

// ------------------------------------------------------------------ hairball mortar

function launchShell(sim: Sim, e: SimEntity, b: BossState, def: BossDef, i: number): void {
  const tx = b.shells[i * 3], ty = b.shells[i * 3 + 1], tz = b.shells[i * 3 + 2];
  const fx = -Math.sin(b.aimYaw), fz = -Math.cos(b.aimYaw);
  const lat = (i - (b.shells.length / 3 - 1) / 2) * 0.45;
  const sx = e.pos.x - fx * def.turret.mortarBack - fz * lat, sy = e.pos.y + def.turret.mortarY, sz = e.pos.z - fz * def.turret.mortarBack + fx * lat;
  const T = bossTime(def, def.mortar.flight, b.phase2, MIN_TELEGRAPH + 0.35);
  const g = def.mortar.gravity;
  const vx = (tx - sx) / T, vz = (tz - sz) / T, vy = (ty - sy) / T - 0.5 * g * T;
  const h: SimEntity = {
    id: sim.allocId(), kind: EntityKind.Projectile, team: e.team, species: Species.Cat, cls: null, seed: e.id, name: 'hairball',
    pos: { x: sx, y: sy, z: sz }, vel: { x: vx, y: vy, z: vz }, yaw: Math.atan2(-vx, -vz), pitch: Math.atan2(vy, Math.hypot(vx, vz)),
    collider: null, input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null, health: null,
    anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0, ownerPid: null, removed: false, data: {},
    hairball: { boss: e.id, sx, sy, sz, vx, vy, vz, g, t: 0, T, tx, ty, tz, phase2: b.phase2 },
  };
  sim.entities.set(h.id, h);
  // the warning circle: exactly where (and T seconds before) it lands
  sim.emit({ e: 'ability', id: e.id, ability: BOSS_ABILITY.mortarShell, x: tx, y: ty, z: tz });
  reportNoise(sim, e, 30);
}

function stepHairball(sim: Sim, h: SimEntity, dt: number): void {
  const s = h.hairball!;
  const owner = sim.entities.get(s.boss);
  if (s.t < 0 || !owner) { sim.removeEntity(h.id); return; } // fizzled (boss defeated / removed)
  s.t += dt;
  if (s.t >= s.T - 1e-9) {
    const def = owner.boss ? bossDef(owner.boss) : BOSSES[0];
    explode(sim, s.tx, s.ty + 0.5, s.tz, blastFor(def, s.phase2), owner.id, owner.team, -1);
    sim.removeEntity(h.id);
    return;
  }
  const t = s.t;
  h.pos.x = s.sx + s.vx * t; h.pos.y = s.sy + s.vy * t + 0.5 * s.g * t * t; h.pos.z = s.sz + s.vz * t;
  h.vel.x = s.vx; h.vel.y = s.vy + s.g * t; h.vel.z = s.vz;
  h.yaw = Math.atan2(-h.vel.x, -h.vel.z);
  h.pitch = Math.atan2(h.vel.y, Math.hypot(h.vel.x, h.vel.z));
}

// ------------------------------------------------------------------ brush spin

function brushSpin(sim: Sim, e: SimEntity, b: BossState, def: BossDef): void {
  const R = def.spin.radius;
  for (const t of sim.entities.values()) {
    if (!t.char || t.dead || t.team === e.team || t.boss || b.hitIds.includes(t.id)) continue;
    if (t.pos.y - e.pos.y > def.spin.maxFeet) continue; // jumped over the brushes
    const cap = capsuleOf(t);
    let kx = t.pos.x - e.pos.x, kz = t.pos.z - e.pos.z;
    const d = Math.hypot(kx, kz);
    if (d > R + cap.r) continue;
    b.hitIds.push(t.id);
    if (d > 1e-3) { kx /= d; kz /= d; } else { kx = -Math.sin(b.heading); kz = -Math.cos(b.heading); }
    const dmg = applyDamage(sim, t, def.spin.damage * dmgScale(def, b), { id: e.id, team: e.team, weapon: -1 }, t.pos.x, t.pos.y + cap.height * 0.5, t.pos.z, false);
    b.stats.dmgDealt += dmg;
    if (dmg > 0) knockback(t, kx * def.spin.knockback, def.spin.knockUp, kz * def.spin.knockback);
  }
}

// ------------------------------------------------------------------ kittens

export function spawnKitten(sim: Sim, e: SimEntity, b: BossState, def: BossDef, i: number): SimEntity {
  const arch = ARCHETYPES.kitten;
  const bx = Math.sin(b.heading), bz = Math.cos(b.heading); // backward (heading faces -Z at 0)
  const lat = (i - 1) * 1.4;
  let x = e.pos.x + bx * def.turret.hatchBack - bz * lat, z = e.pos.z + bz * def.turret.hatchBack + bx * lat;
  const g = bossNavGrid(sim);
  if (g) {
    const c = nearestWalkable(g, x, z, 4);
    if (c >= 0) { x = cellX(g, c); z = cellZ(g, c); }
  }
  const y = groundAt(sim, g, x, z) + 0.05;
  const k = sim.spawnCharacter({ kind: EntityKind.Bot, team: e.team, species: Species.Cat, cls: arch.cls, name: `${arch.label} ${b.kittens.length + 1}`, x, y, z, yaw: Math.atan2(bx, bz) + Math.PI });
  ensureCombat(k);
  k.combat!.pve = true;
  applyArchetype(k, 'kitten');
  // pop out of the hatch with a little hop
  k.vel.x = bx * 4; k.vel.z = bz * 4; k.vel.y = 5.5;
  if (k.char) k.char.grounded = false;
  b.kittens.push(k.id);
  return k;
}

function deployKittens(sim: Sim, e: SimEntity, b: BossState, def: BossDef, t0: number): void {
  while (b.kitSpawned < def.kittens.count && b.stageT >= t0 + b.kitSpawned * def.kittens.stagger) {
    if (b.kitSpawned === 0) {
      const bx = Math.sin(b.heading), bz = Math.cos(b.heading);
      sim.emit({ e: 'ability', id: e.id, ability: BOSS_ABILITY.kittens, x: e.pos.x + bx * def.turret.hatchBack, y: e.pos.y + def.turret.hatchY, z: e.pos.z + bz * def.turret.hatchBack });
    }
    spawnKitten(sim, e, b, def, b.kitSpawned);
    b.kitSpawned++;
  }
}

// ------------------------------------------------------------------ system

function effects(sim: Sim, e: SimEntity, b: BossState): void {
  const def = bossDef(b);
  switch (b.attack) {
    case BossAttack.Laser:
      if (b.stage === BossStage.Active) laserSweep(sim, e, b, def);
      break;
    case BossAttack.Mortar:
      if (b.stage === BossStage.Active) {
        while (b.launched < b.shells.length / 3 && b.stageT >= b.launched * def.mortar.stagger - 1e-9) { launchShell(sim, e, b, def, b.launched); b.launched++; }
      }
      break;
    case BossAttack.Spin:
      if (b.stage === BossStage.Active) brushSpin(sim, e, b, def);
      break;
    case BossAttack.Kittens:
      if (b.stage === BossStage.Active) deployKittens(sim, e, b, def, 0);
      break;
    case BossAttack.PhaseShift:
      deployKittens(sim, e, b, def, def.phase2.kittensAt);
      break;
  }
}

export const bossAttackSystem: SimSystem = {
  name: 'boss-attacks',
  order: 455,
  update(sim, dt) {
    for (const e of bossesOf(sim, scratch)) {
      e.weapon = -1;
      e.ammo = 0;
      if (!e.dead) effects(sim, e, e.boss!);
      writeBossFlags(e, e.boss!);
    }
    scratch.length = 0;
    hairballs.length = 0;
    for (const h of sim.entities.values()) if (h.hairball) hairballs.push(h);
    for (const h of hairballs) if (!h.removed) stepHairball(sim, h, dt);
    hairballs.length = 0;
  },
};

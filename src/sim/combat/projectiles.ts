// Projectile system (order 500): pooled projectile entities (EntityKind.Projectile) with gravity,
// world bounces (Rapier raycasts), analytic swept-sphere hits on characters, and radius-falloff
// explosions. Projectile entities appear in snapshots (position/velocity/weapon index), so clients
// render tennis balls and frisbees straight from EntityState; they get fresh ids, never reused.
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, EntityKind, type EntityId, type TeamId } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import { WEAPONS, COMBAT_RULES, type WeaponId, type ProjectileDef } from '../../shared/content/weapons';
import { pointCapsuleDistance, rayCapsule, worldLineClear, worldRayNormal, type WorldHit } from './geometry';
import { applyDamage, knockback } from './damage';
import { capsuleOf, reportNoiseAt, type ProjectileState } from './state';
import { friendlyShotPass } from './ability-core';

const pools = new WeakMap<Sim, SimEntity[]>();
const POOL_MAX = 64;

function blankProjectile(): SimEntity {
  return {
    id: 0, kind: EntityKind.Projectile, team: 0, species: 0, cls: null, seed: 0, name: '',
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, collider: null,
    input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null, health: null,
    anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
    ownerPid: null, removed: false, data: {},
  };
}

export function spawnProjectile(sim: Sim, owner: SimEntity, weapon: WeaponId, x: number, y: number, z: number, vx: number, vy: number, vz: number): SimEntity {
  let pool = pools.get(sim);
  if (!pool) { pool = []; pools.set(sim, pool); }
  const e = pool.pop() ?? blankProjectile();
  e.id = sim.allocId();
  e.kind = EntityKind.Projectile;
  e.team = owner.team;
  e.species = owner.species;
  e.seed = owner.id;
  e.name = weapon;
  e.pos.x = x; e.pos.y = y; e.pos.z = z;
  e.vel.x = vx; e.vel.y = vy; e.vel.z = vz;
  e.yaw = Math.atan2(-vx, -vz);
  e.pitch = Math.atan2(vy, Math.hypot(vx, vz));
  e.flags = 0; e.dead = false; e.removed = false; e.anim = Anim.Idle;
  e.weapon = owner.wpn?.index ?? -1;
  e.ammo = 0;
  const p: ProjectileState = e.proj ?? { owner: 0, ownerTeam: 0, weapon, age: 0, bounces: 0, dmgMult: 1 };
  p.owner = owner.id; p.ownerTeam = owner.team; p.weapon = weapon; p.age = 0; p.bounces = 0; p.dmgMult = 1;
  e.proj = p;
  sim.entities.set(e.id, e);
  return e;
}

function despawn(sim: Sim, e: SimEntity): void {
  sim.removeEntity(e.id);
  const pool = pools.get(sim);
  if (pool && pool.length < POOL_MAX) pool.push(e);
}

/**
 * Blast listeners (X1: destructibles take blast damage). Called at the end of every explode(), after the characters
 * were hit — so a wall the blast breaks still shielded whoever stood behind it — with the blast's exact profile.
 * Module-level (every Sim): a listener ignores sims it has no state for. Register once (duplicates are ignored).
 */
export type BlastListener = (sim: Sim, x: number, y: number, z: number, pdef: ProjectileDef, owner: EntityId, ownerTeam: TeamId, weapon: number) => void;
const blastListeners: BlastListener[] = [];
export function addBlastListener(f: BlastListener): void {
  if (!blastListeners.includes(f)) blastListeners.push(f);
}

/** Radius-falloff explosion: damage (LOS-checked, self-damage reduced), knockback, `explode` event. */
export function explode(sim: Sim, x: number, y: number, z: number, pdef: ProjectileDef, owner: EntityId, ownerTeam: TeamId, weapon: number): void {
  const R = pdef.explodeRadius;
  sim.emit({ e: 'explode', x, y, z, r: R, by: owner });
  reportNoiseAt(sim, x, y, z, 50, ownerTeam, owner);
  for (const t of sim.entities.values()) {
    if (!t.char || t.dead) continue;
    const self = t.id === owner;
    if (!self && !COMBAT_RULES.friendlyFire && t.team === ownerTeam) continue;
    const cap = capsuleOf(t);
    const d = pointCapsuleDistance(x, y, z, t.pos.x, t.pos.y + cap.r, t.pos.z, cap.len, cap.r);
    if (d > R) continue;
    const cy = t.pos.y + cap.height * 0.5;
    if (!worldLineClear(sim, x, y, z, t.pos.x, cy, t.pos.z)) continue; // cover blocks blasts
    const frac = d <= pdef.explodeInner ? 1 : 1 + (pdef.explodeEdgeFrac - 1) * ((d - pdef.explodeInner) / (R - pdef.explodeInner));
    const dmg = pdef.explodeDamage * frac * (self ? pdef.selfDamageMult : 1);
    applyDamage(sim, t, dmg, { id: owner, team: ownerTeam, weapon }, t.pos.x, cy, t.pos.z, false);
    if (pdef.knockback > 0) {
      let kx = t.pos.x - x, kz = t.pos.z - z;
      const kl = Math.hypot(kx, kz);
      if (kl > 1e-3) { kx /= kl; kz /= kl; } else { kx = 0; kz = 0; }
      const k = pdef.knockback * frac;
      knockback(t, kx * k, k * 0.55, kz * k);
    }
  }
  for (let i = 0; i < blastListeners.length; i++) blastListeners[i](sim, x, y, z, pdef, owner, ownerTeam, weapon);
}

const wh: WorldHit = { t: 0, nx: 0, ny: 0, nz: 0 };

/**
 * Terrain backstop: Rapier heightfield raycasts can miss along exact grid lines (e.g. a ball
 * dropping straight down), so a segment ending below WorldData.height() is treated as a ground hit.
 */
function terrainHit(sim: Sim, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, out: WorldHit): WorldHit | null {
  const H = sim.worldData.height;
  if (oy + dy * len >= H(ox + dx * len, oz + dz * len)) return null;
  if (oy < H(ox, oz) - 0.05) return null; // started below ground (tunnel/overhang): leave to Rapier
  let lo = 0, hi = len;
  for (let i = 0; i < 8; i++) {
    const m = (lo + hi) * 0.5;
    if (oy + dy * m >= H(ox + dx * m, oz + dz * m)) lo = m; else hi = m;
  }
  const x = ox + dx * lo, z = oz + dz * lo;
  const gx = (H(x + 0.1, z) - H(x - 0.1, z)) / 0.2, gz = (H(x, z + 0.1) - H(x, z - 0.1)) / 0.2;
  const nl = Math.sqrt(gx * gx + 1 + gz * gz);
  out.t = lo; out.nx = -gx / nl; out.ny = 1 / nl; out.nz = -gz / nl;
  return out;
}

function stepProjectile(sim: Sim, e: SimEntity, dt: number): void {
  const p = e.proj!;
  const def = WEAPONS[p.weapon];
  const pd = def.projectile!;
  p.age += dt;
  if (p.age >= pd.lifetime) {
    if (pd.fuse && pd.explodeRadius > 0) explode(sim, e.pos.x, e.pos.y, e.pos.z, pd, p.owner, p.ownerTeam, e.weapon);
    despawn(sim, e);
    return;
  }
  e.vel.y += pd.gravity * dt;
  const mx = e.vel.x * dt, my = e.vel.y * dt, mz = e.vel.z * dt;
  const len = Math.sqrt(mx * mx + my * my + mz * mz);
  if (len < 1e-6) return;
  const dx = mx / len, dy = my / len, dz = mz / len;
  const ox = e.pos.x, oy = e.pos.y, oz = e.pos.z;
  const w = worldRayNormal(sim, ox, oy, oz, dx, dy, dz, len, wh, friendlyShotPass(sim, p.ownerTeam)) ?? terrainHit(sim, ox, oy, oz, dx, dy, dz, len, wh);
  let best = w ? w.t : len;
  let hitChar: SimEntity | null = null;
  for (const t of sim.entities.values()) {
    if (!t.char || t.dead || t.id === p.owner) continue;
    if (!COMBAT_RULES.friendlyFire && t.team === p.ownerTeam) continue;
    const cap = capsuleOf(t);
    const r = cap.r + pd.radius;
    const tc = rayCapsule(ox, oy, oz, dx, dy, dz, t.pos.x, t.pos.y + cap.r, t.pos.z, cap.len, r, best);
    if (tc >= 0 && tc < best) { best = tc; hitChar = t; }
  }
  const hx = ox + dx * best, hy = oy + dy * best, hz = oz + dz * best;
  if (hitChar) {
    const cap = capsuleOf(hitChar);
    const crit = hy - hitChar.pos.y >= COMBAT_RULES.headFraction * cap.height;
    const src = { id: p.owner, team: p.ownerTeam, weapon: e.weapon };
    applyDamage(sim, hitChar, def.damage * p.dmgMult * (crit ? def.headMult : 1), src, hx, hy, hz, crit);
    if (pd.explodeRadius > 0) explode(sim, hx, hy, hz, pd, p.owner, p.ownerTeam, e.weapon);
    despawn(sim, e);
    return;
  }
  if (w && w.t <= len) {
    const px = hx + w.nx * 0.03, py = hy + w.ny * 0.03, pz = hz + w.nz * 0.03;
    if (p.bounces < pd.bounces) {
      const vn = e.vel.x * w.nx + e.vel.y * w.ny + e.vel.z * w.nz;
      e.vel.x = (e.vel.x - 2 * vn * w.nx) * pd.restitution;
      e.vel.y = (e.vel.y - 2 * vn * w.ny) * pd.restitution;
      e.vel.z = (e.vel.z - 2 * vn * w.nz) * pd.restitution;
      p.bounces++;
      p.dmgMult += pd.bounceBonus;
      e.pos.x = px; e.pos.y = py; e.pos.z = pz;
    } else {
      if (pd.explodeRadius > 0) explode(sim, hx + w.nx * 0.12, hy + w.ny * 0.12, hz + w.nz * 0.12, pd, p.owner, p.ownerTeam, e.weapon);
      despawn(sim, e);
      return;
    }
  } else {
    e.pos.x = hx; e.pos.y = hy; e.pos.z = hz;
  }
  e.yaw = Math.atan2(-e.vel.x, -e.vel.z);
  e.pitch = Math.atan2(e.vel.y, Math.hypot(e.vel.x, e.vel.z));
  const lim = sim.worldData.halfExtent + 30;
  if (e.pos.y < sim.worldData.killY || Math.abs(e.pos.x) > lim || Math.abs(e.pos.z) > lim) despawn(sim, e);
}

const live: SimEntity[] = [];

export const projectileSystem: SimSystem = {
  name: 'projectiles',
  order: 500,
  update(sim, dt) {
    live.length = 0;
    for (const e of sim.entities.values()) if (e.proj && e.kind === EntityKind.Projectile) live.push(e);
    for (const e of live) if (!e.removed) stepProjectile(sim, e, dt);
    live.length = 0;
  },
};

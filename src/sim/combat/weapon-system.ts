// Weapon system (order 400): trigger/charge/reload handling, spread + bloom, lag-compensated
// hitscan and projectile launch. Runs after movement + the physics step, so shooters use their
// positions for this tick and Rapier's world BVH is current.
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { pressed, held } from '../entity';
import { Btn } from '../../shared/input';
import { EFlag } from '../../shared/types';
import { viewDir } from '../../shared/math';
import { WEAPONS, COMBAT_RULES, AIM_RAY, type WeaponDef } from '../../shared/content/weapons';
import { abilityDef } from '../../shared/content/abilities';
import { rayCapsule, worldRay, type RayPass } from './geometry';
import { friendlyShotPass } from './ability-core';
import { TargetSet, rewindTick } from './lagcomp';
import { applyDamage } from './damage';
import { spawnProjectile } from './projectiles';
import { capsuleOf, combatBus, combatLive, ensureCombat, eyeHeight, isStealthed, reportNoise, ticksOf, type WeaponState } from './state';

const FIRING_HOLD_TICKS = ticksOf(COMBAT_RULES.firingFlagHold);
const NOISE_TTL_TICKS = ticksOf(1);
const EPS = 1e-9;

const targets = new TargetSet();
/** Result of the last trace (module scratch — the sim is single-threaded). */
const tr = { t: 0, idx: -1 };

/** Closest hit along a unit ray among static world geometry and the prepared target set (`pass`: own shields). */
function trace(sim: Sim, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, ts: TargetSet, pass?: RayPass): void {
  let best = worldRay(sim, ox, oy, oz, dx, dy, dz, maxT, pass);
  let bi = -1;
  for (let i = 0; i < ts.n; i++) {
    const cap = capsuleOf(ts.ents[i]);
    const t = rayCapsule(ox, oy, oz, dx, dy, dz, ts.x[i], ts.y[i] + cap.r, ts.z[i], cap.len, cap.r, best);
    if (t >= 0 && t < best) { best = t; bi = i; }
  }
  tr.t = best; tr.idx = bi;
}

export function falloff(def: WeaponDef, dist: number): number {
  if (dist <= def.falloffStart) return 1;
  if (dist >= def.falloffEnd) return def.falloffMin;
  return 1 + (def.falloffMin - 1) * ((dist - def.falloffStart) / (def.falloffEnd - def.falloffStart));
}

const pd = { x: 0, y: 0, z: 0 };
/** Random direction inside a cone of half-angle `spread` around a unit direction (uniform on the disk). */
function perturb(sim: Sim, dx: number, dy: number, dz: number, spread: number): typeof pd {
  if (spread <= 0) { pd.x = dx; pd.y = dy; pd.z = dz; return pd; }
  const r = spread * Math.sqrt(sim.rng());
  const a = sim.rng() * Math.PI * 2;
  // Basis around d: right = normalize(d x up) = (-dz, 0, dx)/|.|, up2 = right x d.
  let rx = -dz, rz = dx;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-6) { rx = 1; rz = 0; } else { rx /= rl; rz /= rl; }
  const ux = -rz * dy, uy = rz * dx - rx * dz, uz = rx * dy;
  const ta = Math.tan(r);
  const ca = Math.cos(a) * ta, sa = Math.sin(a) * ta;
  const x = dx + rx * ca + ux * sa, y = dy + uy * sa, z = dz + rz * ca + uz * sa;
  const l = Math.sqrt(x * x + y * y + z * z);
  pd.x = x / l; pd.y = y / l; pd.z = z / l;
  return pd;
}

/** Current cone half-angle for the shooter's stance (aim/hip, speed, airborne) plus bloom. */
export function currentSpread(e: SimEntity, def: WeaponDef, w: WeaponState): number {
  const c = e.char!;
  const hs = Math.hypot(e.vel.x, e.vel.z);
  const moveT = Math.min(1, hs / c.move.runSpeed);
  const base = held(e, Btn.Aim) ? def.spreadAim : def.spreadHip;
  return base * (1 + (def.moveSpreadMult - 1) * moveT) * (c.grounded ? 1 : def.airSpreadMult) + (def.chargeTime > 0 ? 0 : w.bloom);
}

const aim = { x: 0, y: 0, z: 0 };
/**
 * Shot direction. Bots fire straight along their view from the eye. Human players see through an
 * over-the-shoulder camera, so the authority first finds what the crosshair ray (AIM_RAY) is on and
 * then fires from the eye toward that point — hits land where the crosshair shows.
 */
function aimDirection(sim: Sim, e: SimEntity, ex: number, ey: number, ez: number, def: WeaponDef, pass?: RayPass): typeof aim {
  const v = viewDir(e.yaw, e.pitch);
  aim.x = v.x; aim.y = v.y; aim.z = v.z;
  if (e.ownerPid === null) return aim;
  const shoulder = held(e, Btn.Aim) ? AIM_RAY.shoulderAim : AIM_RAY.shoulderHip;
  const ox = e.pos.x + Math.cos(e.yaw) * shoulder, oy = e.pos.y + AIM_RAY.pivotHeight, oz = e.pos.z - Math.sin(e.yaw) * shoulder;
  const maxT = def.range + 4;
  trace(sim, ox, oy, oz, v.x, v.y, v.z, maxT, targets, pass);
  if (tr.t < 1) return aim; // crosshair origin is inside/against geometry: trust the eye ray
  const px = ox + v.x * tr.t - ex, py = oy + v.y * tr.t - ey, pz = oz + v.z * tr.t - ez;
  const l = Math.sqrt(px * px + py * py + pz * pz);
  if (l < 0.5) return aim;
  aim.x = px / l; aim.y = py / l; aim.z = pz / l;
  return aim;
}

// per-shot aggregation (pellets hitting the same target become one `hit` event)
const aggE: SimEntity[] = [];
const aggDmg: number[] = [];
const aggCrit: boolean[] = [];
const aggP: number[] = [];

/** Firing ends spawn protection early, except in slab (W13, Godot pet.gd): there the 1 s shield runs its full time. */
function fireEndsShield(sim: Sim): boolean {
  return (sim.state.room as { mode?: string } | undefined)?.mode !== 'slab';
}

function fire(sim: Sim, e: SimEntity, w: WeaponState, def: WeaponDef, frac: number): void {
  w.ammo--;
  e.ammo = w.ammo;
  w.cooldown += 1 / def.fireRate;
  w.lastShotTick = sim.tick;
  w.shots++;
  const spread = currentSpread(e, def, w);
  w.bloom = Math.min(def.bloomMax, w.bloom + def.bloomPerShot);
  const meta = e.combat!;
  if (meta.invulnUntil > sim.tick && fireEndsShield(sim)) { meta.invulnUntil = 0; e.flags &= ~EFlag.Invulnerable; }
  if (isStealthed(sim, e) && abilityDef(e.abil?.id ?? '')?.breakOnFire) { meta.stealthUntil = 0; e.flags &= ~EFlag.Stealthed; }
  reportNoise(sim, e, def.noise);

  const ex = e.pos.x, ey = e.pos.y + eyeHeight(e), ez = e.pos.z;
  targets.fill(sim, e, rewindTick(sim, e.input.rt), COMBAT_RULES.friendlyFire);
  const pass = friendlyShotPass(sim, e.team); // shots pass the shooter's own barriers and drones
  const a = aimDirection(sim, e, ex, ey, ez, def, pass);
  const ax = a.x, ay = a.y, az = a.z;

  if (def.kind === 'projectile' && def.projectile) {
    const d = perturb(sim, ax, ay, az, spread);
    const muzzle = Math.max(0.05, Math.min(0.55, worldRay(sim, ex, ey, ez, d.x, d.y, d.z, 0.6, pass) - 0.08));
    const mx = ex + d.x * muzzle, my = ey + d.y * muzzle, mz = ez + d.z * muzzle;
    const s = def.projectile.speed;
    spawnProjectile(sim, e, w.id, mx, my, mz, d.x * s, d.y * s, d.z * s);
    sim.emit({ e: 'fire', id: e.id, wpn: w.index, x: ex, y: ey, z: ez, dx: d.x, dy: d.y, dz: d.z, hx: mx, hy: my, hz: mz, hit: -1 });
    return;
  }

  let n = 0;
  let fdx = ax, fdy = ay, fdz = az, fhx = 0, fhy = 0, fhz = 0, fhit = -1;
  for (let p = 0; p < def.pellets; p++) {
    const d = perturb(sim, ax, ay, az, spread);
    const dx = d.x, dy = d.y, dz = d.z;
    trace(sim, ex, ey, ez, dx, dy, dz, def.range, targets, pass);
    const hx = ex + dx * tr.t, hy = ey + dy * tr.t, hz = ez + dz * tr.t;
    if (p === 0) { fdx = dx; fdy = dy; fdz = dz; fhx = hx; fhy = hy; fhz = hz; fhit = tr.idx >= 0 ? targets.ents[tr.idx].id : -1; }
    if (tr.idx < 0) continue;
    const tgt = targets.ents[tr.idx];
    const crit = hy - targets.y[tr.idx] >= COMBAT_RULES.headFraction * capsuleOf(tgt).height;
    const dmg = def.damage * frac * falloff(def, tr.t) * (crit ? def.headMult : 1);
    let k = 0;
    while (k < n && aggE[k] !== tgt) k++;
    if (k === n) { aggE[n] = tgt; aggDmg[n] = 0; aggCrit[n] = false; aggP[n * 3] = hx; aggP[n * 3 + 1] = hy; aggP[n * 3 + 2] = hz; n++; }
    aggDmg[k] += dmg;
    aggCrit[k] = aggCrit[k] || crit;
  }
  sim.emit({ e: 'fire', id: e.id, wpn: w.index, x: ex, y: ey, z: ez, dx: fdx, dy: fdy, dz: fdz, hx: fhx, hy: fhy, hz: fhz, hit: fhit });
  for (let k = 0; k < n; k++) {
    applyDamage(sim, aggE[k], aggDmg[k], { id: e.id, team: e.team, weapon: w.index }, aggP[k * 3], aggP[k * 3 + 1], aggP[k * 3 + 2], aggCrit[k]);
    aggE[k] = undefined as unknown as SimEntity;
  }
}

function updateWeapon(sim: Sim, e: SimEntity, dt: number, live: boolean): void {
  const w = e.wpn!;
  const def = WEAPONS[w.id];
  if (w.cooldown > 0) w.cooldown -= dt; // may dip below 0 by < dt: that carry keeps exact fire rates
  w.bloom = Math.max(0, w.bloom - def.bloomRecover * dt);
  w.buffer = Math.max(0, w.buffer - dt);
  if (e.dead) {
    w.charge = 0; w.charging = false;
    if (w.cooldown < 0) w.cooldown = 0;
    e.flags &= ~(EFlag.Firing | EFlag.Reloading);
    return;
  }
  if (w.reload > 0) {
    w.reload -= dt;
    if (w.reload <= EPS) { w.reload = 0; w.ammo = def.magSize; }
  }
  if (w.reload === 0 && w.ammo < def.magSize && (w.ammo <= 0 || pressed(e, Btn.Reload)) && !w.charging) {
    w.reload = def.reloadTime;
    w.charge = 0;
    w.buffer = 0;
    sim.emit({ e: 'reload', id: e.id });
  }
  const fireHeld = held(e, Btn.Fire);
  if (!def.auto && pressed(e, Btn.Fire)) w.buffer = COMBAT_RULES.triggerBuffer;
  let fired = false;
  if (live && w.reload === 0 && w.ammo > 0) {
    if (def.chargeTime > 0) {
      if (fireHeld && w.cooldown <= EPS) {
        w.charging = true;
        w.charge = Math.min(1, w.charge + dt / def.chargeTime);
      } else if (!fireHeld && w.charging) {
        fire(sim, e, w, def, def.chargeMinFrac + (1 - def.chargeMinFrac) * w.charge);
        fired = true;
        w.charging = false; w.charge = 0;
      }
    } else if (w.cooldown <= EPS && (def.auto ? fireHeld : w.buffer > 0)) {
      fire(sim, e, w, def, 1);
      fired = true;
      w.buffer = 0;
    }
  } else if (!live) {
    w.charging = false; w.charge = 0; w.buffer = 0;
  }
  if (!fired && w.cooldown < 0) w.cooldown = 0;
  e.weapon = w.index;
  e.ammo = w.ammo;
  let f = e.flags & ~(EFlag.Firing | EFlag.Reloading);
  if (w.charging || sim.tick - w.lastShotTick <= FIRING_HOLD_TICKS) f |= EFlag.Firing;
  if (w.reload > 0) f |= EFlag.Reloading;
  e.flags = f;
}

export const weaponSystem: SimSystem = {
  name: 'weapons',
  order: 400,
  update(sim, dt) {
    const noise = combatBus(sim).noise;
    while (noise.length && sim.tick - noise[0].tick > NOISE_TTL_TICKS) noise.shift();
    const live = combatLive(sim);
    for (const e of sim.entities.values()) {
      if (!e.char) continue;
      ensureCombat(e);
      updateWeapon(sim, e, dt, live);
    }
  },
};

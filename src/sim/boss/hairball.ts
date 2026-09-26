// Hairballs: lobbed boss shells on an exact analytic arc (EntityKind.Projectile snapshot entities whose
// `seed` is the owner boss). Shared by the Vac-Tank's mortar (B1) and the sniper elite's flush-out lob (E1).
// Fairness: the owner emits the landing point (`hairball_mortar` warning circle) when it launches, and the
// shell lands exactly there `T` seconds later, where the combat lane's explode() applies the blast.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, EntityKind, Species } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import type { ProjectileDef } from '../../shared/content/weapons';
import { BOSSES, BOSS_ABILITY, hairballSpec, type BossDef } from '../../shared/content/bosses';
import { explode } from '../combat';
import { reportNoise } from '../combat/state';
import { bossDef } from './state';

/** Blast definitions per boss and phase (phase 2 hits harder). */
const blastCache = new Map<string, ProjectileDef>();
export function hairballBlast(def: BossDef, phase2: boolean): ProjectileDef {
  const key = `${def.id}:${phase2 ? 2 : 1}`;
  let b = blastCache.get(key);
  if (!b) {
    const base = hairballSpec(def, false).blast;
    b = phase2 ? { ...base, explodeDamage: base.explodeDamage * def.phase2.dmgMult } : base;
    blastCache.set(key, b);
  }
  return b;
}

/**
 * Launch a hairball from (sx, sy, sz) that lands exactly on (tx, ty, tz) after T seconds under gravity g,
 * and announce the landing point (the warning circle) now.
 */
export function launchHairball(sim: Sim, owner: SimEntity, sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, T: number, g: number, phase2: boolean): SimEntity {
  const vx = (tx - sx) / T, vz = (tz - sz) / T, vy = (ty - sy) / T - 0.5 * g * T;
  const h: SimEntity = {
    id: sim.allocId(), kind: EntityKind.Projectile, team: owner.team, species: Species.Cat, cls: null, seed: owner.id, name: 'hairball',
    pos: { x: sx, y: sy, z: sz }, vel: { x: vx, y: vy, z: vz }, yaw: Math.atan2(-vx, -vz), pitch: Math.atan2(vy, Math.hypot(vx, vz)),
    collider: null, input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null, health: null,
    anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0, ownerPid: null, removed: false, data: {},
    hairball: { boss: owner.id, sx, sy, sz, vx, vy, vz, g, t: 0, T, tx, ty, tz, phase2 },
  };
  sim.entities.set(h.id, h);
  // the warning circle: exactly where (and T seconds before) it lands
  sim.emit({ e: 'ability', id: owner.id, ability: BOSS_ABILITY.mortarShell, x: tx, y: ty, z: tz });
  reportNoise(sim, owner, 30);
  return h;
}

function stepHairball(sim: Sim, h: SimEntity, dt: number): void {
  const s = h.hairball!;
  const owner = sim.entities.get(s.boss);
  if (s.t < 0 || !owner) { sim.removeEntity(h.id); return; } // fizzled (boss defeated / removed)
  s.t += dt;
  if (s.t >= s.T - 1e-9) {
    const def = owner.boss ? bossDef(owner.boss) : BOSSES[0];
    explode(sim, s.tx, s.ty + 0.5, s.tz, hairballBlast(def, s.phase2), owner.id, owner.team, -1);
    sim.removeEntity(h.id);
    return;
  }
  const t = s.t;
  h.pos.x = s.sx + s.vx * t; h.pos.y = s.sy + s.vy * t + 0.5 * s.g * t * t; h.pos.z = s.sz + s.vz * t;
  h.vel.x = s.vx; h.vel.y = s.vy + s.g * t; h.vel.z = s.vz;
  h.yaw = Math.atan2(-h.vel.x, -h.vel.z);
  h.pitch = Math.atan2(h.vel.y, Math.hypot(h.vel.x, h.vel.z));
}

const live: SimEntity[] = [];

/** Advance every hairball in flight (called once per tick by the boss attack system). */
export function stepHairballs(sim: Sim, dt: number): void {
  live.length = 0;
  for (const h of sim.entities.values()) if (h.hairball) live.push(h);
  for (const h of live) if (!h.removed) stepHairball(sim, h, dt);
  live.length = 0;
}

/** Every hairball a boss still has in the air fizzles out (the boss was defeated). */
export function fizzleHairballs(sim: Sim, bossId: number): void {
  for (const h of sim.entities.values()) if (h.hairball && h.hairball.boss === bossId) h.hairball.t = -1e9;
}

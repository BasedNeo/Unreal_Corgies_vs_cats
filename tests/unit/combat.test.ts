import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Btn } from '../../src/shared/input';
import { Team, Species, EFlag, Anim, type TeamId, type ClassId } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import { createWorldData } from '../../src/shared/world/world-data';
import { WEAPONS, COMBAT_RULES, weaponIndex } from '../../src/shared/content/weapons';
import { ABILITIES } from '../../src/shared/content/abilities';
import { eyeHeight, characterHeight, worldLineClear, spawnProjectile, equipWeapon } from '../../src/sim/combat';
import { falloff } from '../../src/sim/combat/weapon-system';

// ---- helpers (robust to whatever WorldData the world lane ships: props are stripped, terrain kept) ----
async function arena(seed = 3): Promise<Sim> {
  const world = { ...createWorldData(seed), props: [] };
  const sim = await Sim.create({ seed, world });
  sim.step(); // builds Rapier's query structures
  return sim;
}

// Terrain height from WorldData (exact heightfield surface). Vertical Rapier rays can slip through
// heightfield grid lines, so tests never probe the ground with straight-down rays.
function groundAt(sim: Sim, x: number, z: number): number {
  return sim.worldData.height(x, z);
}

/** A straight, flat, unobstructed lane of `len` meters (start A, direction d). */
function findLane(sim: Sim, len: number): { ax: number; az: number; dx: number; dz: number } {
  const h = sim.worldData.halfExtent * 0.6;
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let r = 0; r <= h; r += 4) {
    for (let a = 0; a < 16; a++) {
      const ax = Math.cos((a / 16) * Math.PI * 2) * r, az = Math.sin((a / 16) * Math.PI * 2) * r;
      for (const [dx, dz] of dirs) {
        const bx = ax + dx * len, bz = az + dz * len;
        if (Math.max(Math.abs(bx), Math.abs(bz)) > h) continue;
        const g0 = groundAt(sim, ax, az);
        let ok = true;
        for (let s = -2; s <= len + 2 && ok; s += 0.5) {
          const g = groundAt(sim, ax + dx * s, az + dz * s);
          if (Math.abs(g - g0) > 0.25) ok = false;
        }
        for (const y of [0.4, 0.9, 1.4]) {
          if (ok && !worldLineClear(sim, ax - dx * 3, g0 + y, az - dz * 3, bx + dx * 3, g0 + y, bz + dz * 3)) ok = false;
        }
        if (ok) return { ax, az, dx, dz };
      }
    }
  }
  throw new Error('no clear lane in this world');
}

function spawn(sim: Sim, team: TeamId, x: number, z: number, cls: ClassId = 'assault'): SimEntity {
  const e = sim.spawnCharacter({ team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: `t${sim.entities.size}`, x, y: groundAt(sim, x, z) + 0.02, z, yaw: 0 });
  return e;
}

let seq = 1;
function input(sim: Sim, e: SimEntity, buttons: number, yaw = e.yaw, pitch = e.pitch, rt = 0): void {
  sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw, pitch, buttons, rt });
}

function aimAt(e: SimEntity, x: number, y: number, z: number): { yaw: number; pitch: number } {
  const ex = e.pos.x, ey = e.pos.y + eyeHeight(e), ez = e.pos.z;
  const dx = x - ex, dy = y - ey, dz = z - ez;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

function run(sim: Sim, ticks: number, each?: () => void): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) { each?.(); sim.step(); out.push(...sim.drainEvents()); }
  return out;
}

async function duel(dist = 8, targetTeam: TeamId = Team.Cats, targetCls: ClassId = 'assault') {
  const sim = await arena();
  const lane = findLane(sim, dist);
  const shooter = spawn(sim, Team.Corgis, lane.ax, lane.az);
  const target = spawn(sim, targetTeam, lane.ax + lane.dx * dist, lane.az + lane.dz * dist, targetCls);
  run(sim, 20); // settle on the ground
  sim.drainEvents();
  return { sim, shooter, target, lane };
}

const chestOf = (t: SimEntity) => t.pos.y + characterHeight(t) * 0.5;
const headOf = (t: SimEntity) => t.pos.y + characterHeight(t) * 0.92;

describe('weapons data', () => {
  it('squeaker rifle body TTK is 0.6–0.9 s against the assault kit', () => {
    const w = WEAPONS.squeaker_rifle;
    const shots = Math.ceil(120 / w.damage);
    const ttk = (shots - 1) / w.fireRate;
    expect(ttk).toBeGreaterThanOrEqual(0.6);
    expect(ttk).toBeLessThanOrEqual(0.9);
    expect(falloff(w, 10)).toBe(1);
    expect(falloff(w, 200)).toBeCloseTo(w.falloffMin, 5);
  });
});

describe('hitscan damage', () => {
  it('body shots deal base damage, head shots crit with the head multiplier', async () => {
    const { sim, shooter, target } = await duel(8);
    const w = WEAPONS.squeaker_rifle;
    let a = aimAt(shooter, target.pos.x, chestOf(target), target.pos.z);
    input(sim, shooter, Btn.Fire | Btn.Aim, a.yaw, a.pitch);
    let ev = run(sim, 1);
    input(sim, shooter, Btn.Aim, a.yaw, a.pitch);
    const fire = ev.find((e) => e.e === 'fire');
    expect(fire && fire.e === 'fire' && fire.hit).toBe(target.id);
    const body = ev.find((e) => e.e === 'hit');
    expect(body).toMatchObject({ e: 'hit', src: shooter.id, dst: target.id, dmg: w.damage, crit: false });
    expect(target.health!.hp).toBe(120 - w.damage);
    run(sim, 10);
    a = aimAt(shooter, target.pos.x, headOf(target), target.pos.z);
    input(sim, shooter, Btn.Fire | Btn.Aim, a.yaw, a.pitch);
    ev = run(sim, 1);
    const head = ev.find((e) => e.e === 'hit');
    expect(head).toMatchObject({ e: 'hit', crit: true, dmg: Math.round(w.damage * w.headMult) });
    expect(shooter.flags & EFlag.Firing).toBeTruthy();
  });

  it('killing a target emits death with the killer and plays the dead state', async () => {
    const { sim, shooter, target } = await duel(8);
    const a = aimAt(shooter, target.pos.x, chestOf(target), target.pos.z);
    const events = run(sim, 90, () => input(sim, shooter, Btn.Fire | Btn.Aim, a.yaw, a.pitch));
    const death = events.find((e) => e.e === 'death');
    expect(death).toEqual({ e: 'death', id: target.id, by: shooter.id, wpn: shooter.wpn!.index }); // W10: the killing weapon
    expect(target.dead).toBe(true);
    expect(target.anim).toBe(Anim.Dead);
    expect(sim.toState(target).flags & EFlag.Dead).toBeTruthy();
    // 8 body shots at 10 rps: dead within ~0.7 s of the first shot
    const hits = events.filter((e) => e.e === 'hit');
    expect(hits.length).toBe(8);
  });
});

describe('fire rate, ammo and reload', () => {
  it('auto fire runs at exactly the fire rate and consumes ammo', async () => {
    const { sim, shooter } = await duel(8);
    const w = WEAPONS.squeaker_rifle;
    const ev = run(sim, 60, () => input(sim, shooter, Btn.Fire, shooter.yaw, 0.6));
    expect(ev.filter((e) => e.e === 'fire').length).toBe(w.fireRate);
    expect(shooter.ammo).toBe(w.magSize - w.fireRate);
    expect(shooter.weapon).toBe(weaponIndex('squeaker_rifle'));
  });

  it('auto-reloads when empty and refills after reloadTime', async () => {
    const { sim, shooter } = await duel(8);
    const w = WEAPONS.squeaker_rifle;
    const ev: GameEvent[] = [];
    let emptyTick = -1, reloadTick = -1;
    for (let i = 0; i < 400 && reloadTick < 0; i++) {
      input(sim, shooter, Btn.Fire, shooter.yaw, 0.6);
      sim.step();
      const e = sim.drainEvents();
      ev.push(...e);
      if (shooter.ammo === 0 && emptyTick < 0) emptyTick = sim.tick;
      if (e.some((x) => x.e === 'reload')) reloadTick = sim.tick;
    }
    expect(ev.filter((e) => e.e === 'fire').length).toBe(w.magSize);
    expect(reloadTick - emptyTick).toBeLessThanOrEqual(1);
    expect(shooter.flags & EFlag.Reloading).toBeTruthy();
    // still holding fire: nothing fires during the reload
    const during = run(sim, Math.round(w.reloadTime * 60) - 2, () => input(sim, shooter, Btn.Fire, shooter.yaw, 0.6));
    expect(during.filter((e) => e.e === 'fire').length).toBe(0);
    expect(shooter.ammo).toBe(0);
    run(sim, 3, () => input(sim, shooter, 0, shooter.yaw, 0.6));
    expect(shooter.ammo).toBe(w.magSize);
    expect(shooter.flags & EFlag.Reloading).toBeFalsy();
  });

  it('manual reload with Btn.Reload, semi-auto fires once per press and respects its rate', async () => {
    const { sim, shooter } = await duel(8);
    equipWeapon(shooter, 'snap_pistol');
    const w = WEAPONS.snap_pistol;
    // mash the trigger every other tick for 1 s: capped at fireRate shots
    let ev = run(sim, 60, () => input(sim, shooter, sim.tick % 2 ? Btn.Fire : 0, shooter.yaw, 0.6));
    const shots = ev.filter((e) => e.e === 'fire').length;
    expect(shots).toBeGreaterThanOrEqual(w.fireRate - 1);
    expect(shots).toBeLessThanOrEqual(w.fireRate);
    // holding the trigger fires only once
    run(sim, 30, () => input(sim, shooter, 0));
    ev = run(sim, 60, () => input(sim, shooter, Btn.Fire, shooter.yaw, 0.6));
    expect(ev.filter((e) => e.e === 'fire').length).toBe(1);
    const before = shooter.ammo;
    expect(before).toBeLessThan(w.magSize);
    input(sim, shooter, Btn.Reload);
    ev = run(sim, 1);
    expect(ev.some((e) => e.e === 'reload')).toBe(true);
    run(sim, Math.ceil(w.reloadTime * 60) + 1, () => input(sim, shooter, 0));
    expect(shooter.ammo).toBe(w.magSize);
  });
});

describe('friendly fire', () => {
  it('teammates take no damage and shots pass through them', async () => {
    const { sim, shooter, target, lane } = await duel(10);
    const mate = spawn(sim, Team.Corgis, lane.ax + lane.dx * 5, lane.az + lane.dz * 5);
    run(sim, 10);
    const a = aimAt(shooter, target.pos.x, chestOf(target), target.pos.z);
    const ev = run(sim, 30, () => input(sim, shooter, Btn.Fire | Btn.Aim, a.yaw, a.pitch));
    expect(mate.health!.hp).toBe(mate.health!.max);
    expect(ev.some((e) => e.e === 'hit' && e.dst === mate.id)).toBe(false);
    expect(ev.some((e) => e.e === 'hit' && e.dst === target.id)).toBe(true);
  });
});

describe('death and respawn', () => {
  it('respawns after 3 s at a team spawn with full hp and brief invulnerability', async () => {
    const { sim, shooter, target } = await duel(8);
    target.health!.hp = 10;
    const a = aimAt(shooter, target.pos.x, chestOf(target), target.pos.z);
    input(sim, shooter, Btn.Fire | Btn.Aim, a.yaw, a.pitch);
    let ev = run(sim, 1);
    input(sim, shooter, 0);
    expect(ev).toContainEqual({ e: 'death', id: target.id, by: shooter.id, wpn: shooter.wpn!.index });
    const diedAt = sim.tick;
    ev = run(sim, Math.round(COMBAT_RULES.respawnDelay * 60) - 2);
    expect(target.dead).toBe(true);
    ev = run(sim, 4);
    expect(target.dead).toBe(false);
    expect(ev).toContainEqual({ e: 'spawn', id: target.id });
    expect(sim.tick - diedAt).toBeGreaterThanOrEqual(COMBAT_RULES.respawnDelay * 60);
    expect(target.health!.hp).toBe(target.health!.max);
    expect(target.anim).not.toBe(Anim.Dead);
    expect(target.flags & EFlag.Invulnerable).toBeTruthy();
    const spawns = sim.worldData.spawns.filter((s) => s.team === target.team);
    const near = Math.min(...spawns.map((s) => Math.hypot(s.x - target.pos.x, s.z - target.pos.z)));
    expect(near).toBeLessThan(0.6);
    // protected: damage is ignored until the protection ends
    const b = aimAt(shooter, target.pos.x, chestOf(target), target.pos.z);
    if (worldLineClear(sim, shooter.pos.x, shooter.pos.y + eyeHeight(shooter), shooter.pos.z, target.pos.x, chestOf(target), target.pos.z)) {
      run(sim, 6, () => input(sim, shooter, Btn.Fire | Btn.Aim, b.yaw, b.pitch));
      expect(target.health!.hp).toBe(target.health!.max);
    }
    run(sim, Math.round(COMBAT_RULES.spawnInvulnerable * 60), () => input(sim, shooter, 0));
    expect(target.flags & EFlag.Invulnerable).toBeFalsy();
  });

  it('regenerates slowly after 5 s without damage', async () => {
    const { sim, shooter, target } = await duel(8);
    const a = aimAt(shooter, target.pos.x, chestOf(target), target.pos.z);
    run(sim, 18, () => input(sim, shooter, Btn.Fire | Btn.Aim, a.yaw, a.pitch));
    input(sim, shooter, 0);
    const hurt = target.health!.hp;
    expect(hurt).toBeLessThan(target.health!.max);
    run(sim, 60 * 4);
    expect(target.health!.hp).toBe(hurt);
    run(sim, 60 * 2);
    expect(target.health!.hp).toBeGreaterThan(hurt);
    expect(target.health!.hp).toBeLessThan(hurt + target.health!.max * COMBAT_RULES.regenPerSec * 1.5);
  });
});

describe('lag compensation', () => {
  async function setup() {
    const { sim, shooter, target, lane } = await duel(12);
    // the target stands at A; the client renders it there at tick rt
    const A = { x: target.pos.x, y: target.pos.y, z: target.pos.z };
    const rt = sim.tick;
    // then it moves 2.5 m sideways (to B) and stays there
    const sx = -lane.dz, sz = lane.dx;
    sim.placeCharacter(target, A.x + sx * 2.5, A.y, A.z + sz * 2.5);
    return { sim, shooter, target, A, rt };
  }

  it('hits a target at its rt position when aimed there (≤ 200 ms ago)', async () => {
    const { sim, shooter, target, A, rt } = await setup();
    run(sim, 6); // 100 ms later the shot arrives
    const a = aimAt(shooter, A.x, A.y + characterHeight(target) * 0.5, A.z);
    input(sim, shooter, Btn.Fire | Btn.Aim, a.yaw, a.pitch, rt);
    const ev = run(sim, 1);
    expect(ev.some((e) => e.e === 'hit' && e.dst === target.id)).toBe(true);
  });

  it('does not rewind without rt (the target is no longer there)', async () => {
    const { sim, shooter, target, A } = await setup();
    run(sim, 6);
    const a = aimAt(shooter, A.x, A.y + characterHeight(target) * 0.5, A.z);
    input(sim, shooter, Btn.Fire | Btn.Aim, a.yaw, a.pitch, 0);
    const ev = run(sim, 1);
    expect(ev.some((e) => e.e === 'hit')).toBe(false);
  });

  it('clamps rewinds to 200 ms: an older rt misses', async () => {
    const { sim, shooter, target, A, rt } = await setup();
    run(sim, 30); // 500 ms later: rt is outside the rewind window
    const a = aimAt(shooter, A.x, A.y + characterHeight(target) * 0.5, A.z);
    input(sim, shooter, Btn.Fire | Btn.Aim, a.yaw, a.pitch, rt);
    const ev = run(sim, 1);
    expect(ev.some((e) => e.e === 'hit')).toBe(false);
  });
});

describe('third-person aim convergence', () => {
  it('a human shot lands where the over-the-shoulder crosshair points', async () => {
    const { sim, shooter, target } = await duel(15);
    shooter.ownerPid = 'human';
    // aim the camera ray (pivot + shoulder offset, parallel to the view) at the target's chest
    const ty = chestOf(target);
    let yaw = 0, pitch = 0;
    for (let i = 0; i < 4; i++) {
      const sh = 0.75; // aiming shoulder
      const ox = shooter.pos.x + Math.cos(yaw) * sh, oz = shooter.pos.z - Math.sin(yaw) * sh, oy = shooter.pos.y + 1.25;
      const dx = target.pos.x - ox, dz = target.pos.z - oz;
      yaw = Math.atan2(-dx, -dz);
      pitch = Math.atan2(ty - oy, Math.hypot(dx, dz));
    }
    input(sim, shooter, Btn.Fire | Btn.Aim, yaw, pitch);
    const ev = run(sim, 1);
    expect(ev.some((e) => e.e === 'hit' && e.dst === target.id)).toBe(true);
  });
});

describe('projectiles', () => {
  it('explosions deal radius-falloff damage, blocked beyond the radius, reduced self-damage', async () => {
    const { sim, lane } = await duel(20);
    const pdef = WEAPONS.tennis_mortar.projectile!;
    const cx = lane.ax + lane.dx * 10, cz = lane.az + lane.dz * 10;
    const sx = -lane.dz, sz = lane.dx;
    const near = spawn(sim, Team.Cats, cx + sx * 1, cz + sz * 1);
    const far = spawn(sim, Team.Cats, cx + sx * 3, cz + sz * 3);
    const out = spawn(sim, Team.Cats, cx - sx * (pdef.explodeRadius + 1.5), cz - sz * (pdef.explodeRadius + 1.5));
    const breacher = spawn(sim, Team.Corgis, cx - sx * 2.2, cz - sz * 2.2, 'breacher');
    run(sim, 20);
    sim.drainEvents();
    equipWeapon(breacher, 'tennis_mortar');
    const g = groundAt(sim, cx, cz);
    spawnProjectile(sim, breacher, 'tennis_mortar', cx, g + 3, cz, 0, -20, 0);
    const ev = run(sim, 30);
    const boom = ev.find((e) => e.e === 'explode');
    expect(boom).toBeTruthy();
    const dmg = (id: number) => ev.filter((e) => e.e === 'hit' && e.dst === id).reduce((s, e) => s + (e.e === 'hit' ? e.dmg : 0), 0);
    expect(dmg(near.id)).toBeGreaterThan(dmg(far.id));
    expect(dmg(far.id)).toBeGreaterThan(0);
    expect(dmg(out.id)).toBe(0);
    const self = dmg(breacher.id);
    expect(self).toBeGreaterThan(0);
    expect(self).toBeLessThan(pdef.explodeDamage * pdef.selfDamageMult + 1);
    // knockback pushes the near target away from the blast
    expect(Math.hypot(near.pos.x - cx, near.pos.z - cz)).toBeGreaterThan(1);
    // the projectile entity is gone
    expect([...sim.entities.values()].some((e) => e.proj && !e.removed)).toBe(false);
  });

  it('a fired mortar arcs, flies as a snapshot entity and explodes on the ground', async () => {
    const { sim, shooter } = await duel(12);
    equipWeapon(shooter, 'tennis_mortar');
    input(sim, shooter, Btn.Fire, shooter.yaw, 0.5);
    let ev = run(sim, 1);
    input(sim, shooter, 0);
    expect(ev.some((e) => e.e === 'fire' && e.hit === -1)).toBe(true);
    const proj = [...sim.entities.values()].find((e) => e.proj);
    expect(proj).toBeTruthy();
    expect(sim.toState(proj!).weapon).toBe(weaponIndex('tennis_mortar'));
    let peak = -Infinity;
    ev = run(sim, 240, () => { if (!proj!.removed) peak = Math.max(peak, proj!.pos.y); });
    expect(ev.some((e) => e.e === 'explode')).toBe(true);
    expect(peak).toBeGreaterThan(shooter.pos.y + 3);
  });

  it('frisbees bounce off walls with a bank-shot bonus', async () => {
    const { sim, shooter } = await duel(8);
    equipWeapon(shooter, 'frisbee_launcher');
    // straight down at the ground from above: it bounces instead of vanishing
    const f = spawnProjectile(sim, shooter, 'frisbee_launcher', shooter.pos.x + 3, groundAt(sim, shooter.pos.x + 3, shooter.pos.z) + 2, shooter.pos.z, 0, -20, 0);
    run(sim, 12);
    expect(f.removed).toBe(false);
    expect(f.proj!.bounces).toBe(1);
    expect(f.proj!.dmgMult).toBeCloseTo(1 + WEAPONS.frisbee_launcher.projectile!.bounceBonus, 5);
    expect(f.vel.y).toBeGreaterThan(0);
  });
});

describe('abilities', () => {
  it('bark blast damages and knocks back enemies in the cone, then goes on cooldown', async () => {
    const { sim, shooter, lane } = await duel(20);
    const front = spawn(sim, Team.Cats, lane.ax + lane.dx * 3, lane.az + lane.dz * 3);
    const behind = spawn(sim, Team.Cats, lane.ax - lane.dx * 3, lane.az - lane.dz * 3);
    run(sim, 15);
    const a = aimAt(shooter, front.pos.x, chestOf(front), front.pos.z);
    const d0 = Math.hypot(front.pos.x - shooter.pos.x, front.pos.z - shooter.pos.z);
    input(sim, shooter, Btn.Ability, a.yaw, a.pitch);
    let ev = run(sim, 1);
    input(sim, shooter, 0, a.yaw, a.pitch);
    expect(ev.find((e) => e.e === 'ability')).toMatchObject({ e: 'ability', id: shooter.id, ability: 'bark_blast' });
    expect(front.health!.max - front.health!.hp).toBe(ABILITIES.bark_blast.damage);
    expect(behind.health!.hp).toBe(behind.health!.max);
    run(sim, 40);
    const d1 = Math.hypot(front.pos.x - shooter.pos.x, front.pos.z - shooter.pos.z);
    expect(d1 - d0).toBeGreaterThan(1.5);
    // cooldown: a second press does nothing
    input(sim, shooter, Btn.Ability, a.yaw, a.pitch);
    ev = run(sim, 1);
    expect(ev.some((e) => e.e === 'ability')).toBe(false);
    expect(shooter.abil!.cooldown).toBeGreaterThan(ABILITIES.bark_blast.cooldown - 1.5);
  });

  it('shadow cloak stealths for its duration and breaks on fire', async () => {
    const { sim, target } = await duel(8, Team.Cats, 'infiltrator');
    input(sim, target, Btn.Ability);
    run(sim, 2);
    expect(target.flags & EFlag.Stealthed).toBeTruthy();
    run(sim, 60, () => input(sim, target, 0));
    expect(target.flags & EFlag.Stealthed).toBeTruthy();
    input(sim, target, Btn.Fire, target.yaw, 0.5);
    run(sim, 2);
    expect(target.flags & EFlag.Stealthed).toBeFalsy();
  });
});

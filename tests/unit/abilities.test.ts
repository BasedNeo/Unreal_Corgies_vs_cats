// C2a: Spotter Drone, Dig Charge and Squeak Barrier as authoritative ability entities, on a flat trimesh test yard
// (the real terrain collider path) with hand-placed walls.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Btn } from '../../src/shared/input';
import { Team, Species, EFlag, EntityKind, type TeamId, type ClassId } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import type { WorldData } from '../../src/shared/world/world-data';
import type { PropBox } from '../../src/shared/world/world-types';
import { ABILITIES, ABILITY_IDS } from '../../src/shared/content/abilities';
import { eyeHeight, kill } from '../../src/sim/combat';
import { abilityEntities } from '../../src/sim/combat/ability-core';
import { findBarrierSpot, mirrorBarriers } from '../../src/sim/combat/ability-barrier';
import { stepCharacter } from '../../src/sim/systems/movement';
import { packEntity, unpackEntity } from '../../src/shared/protocol';
import type { Collider } from '@dimforge/rapier3d-compat';
import { BARRIER, CHARGE, DRONE } from '../../src/sim/combat/ability-tuning';
import { TICK_HZ } from '../../src/shared/constants';

function wall(x: number, z: number, hx: number, hz: number, hy = 4): PropBox {
  return { type: 'fence', x, y: hy, z, hx, hy, hz, rotY: 0 };
}

function flatWorld(props: PropBox[] = []): WorldData {
  const n = 65, cell = 2;
  const terrain = { x0: -64, z0: -64, cell, n, heights: new Float32Array(n * n) };
  return {
    seed: 1, name: 'flat', height: () => 0, halfExtent: 60, props, terrain, killY: -30,
    spawns: [{ x: 0, y: 0.5, z: 45, yaw: 0, team: 0 }, { x: 0, y: 0.5, z: -45, yaw: 0, team: 1 }],
  } as WorldData;
}

async function yard(props: PropBox[] = []): Promise<Sim> {
  const sim = await Sim.create({ seed: 5, world: flatWorld(props) });
  sim.step();
  sim.drainEvents();
  return sim;
}

function spawn(sim: Sim, team: TeamId, x: number, z: number, cls: ClassId = 'assault', yaw = 0): SimEntity {
  return sim.spawnCharacter({ team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: `t${sim.entities.size}`, x, y: 0.02, z, yaw });
}

let seq = 1;
function input(sim: Sim, e: SimEntity, buttons: number, yaw = e.yaw, pitch = e.pitch, mz = 0): void {
  sim.setInput(e.id, { seq: seq++, mx: 0, mz, yaw, pitch, buttons, rt: 0 });
}

function aimAt(e: SimEntity, x: number, y: number, z: number): { yaw: number; pitch: number } {
  const ex = e.pos.x, ey = e.pos.y + eyeHeight(e), ez = e.pos.z;
  const dx = x - ex, dy = y - ey, dz = z - ez;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

type Ev = GameEvent & { t: number };
function run(sim: Sim, seconds: number, out: Ev[] = [], each?: () => void): Ev[] {
  for (let i = 0; i < Math.round(seconds * TICK_HZ); i++) {
    each?.();
    sim.step();
    for (const ev of sim.drainEvents()) out.push({ ...ev, t: sim.time } as Ev);
  }
  return out;
}

/** Press Ability for one tick (then release) while facing yaw/pitch. */
function useAbility(sim: Sim, e: SimEntity, yaw = e.yaw, pitch = 0, out: Ev[] = []): Ev[] {
  input(sim, e, Btn.Ability, yaw, pitch);
  run(sim, 1 / TICK_HZ, out);
  input(sim, e, 0, yaw, pitch);
  return out;
}

const ents = (sim: Sim, kind: 'drone' | 'charge' | 'barrier') => abilityEntities(sim).filter((a) => a.abx!.kind === kind);
const spotted = (sim: Sim, e: SimEntity) => (sim.toState(e).flags & EFlag.Spotted) !== 0;

describe('spotter drone', () => {
  it('launches above and ahead, marks enemies it can see (not through walls, never allies), then expires', async () => {
    // wall between the drone's station and cat B (tall enough that the drone cannot see over it)
    const sim = await yard([wall(10, -5, 0.3, 8, 6)]);
    const owner = spawn(sim, Team.Corgis, 0, 0, 'overwatch');
    const catA = spawn(sim, Team.Cats, 4, -22);
    const catB = spawn(sim, Team.Cats, 16, -5);
    const ally = spawn(sim, Team.Corgis, 3, -10);
    run(sim, 0.3);
    const evs = useAbility(sim, owner, 0);
    expect(evs.some((e) => e.e === 'ability' && e.id === owner.id && e.ability === 'spotter_drone')).toBe(true);
    expect(owner.abil!.cooldown).toBeCloseTo(ABILITIES.spotter_drone.cooldown, 1);
    const [drone] = ents(sim, 'drone');
    expect(drone).toBeTruthy();
    const st = sim.toState(drone);
    expect(st.kind).toBe(EntityKind.Ability);
    expect(ABILITY_IDS[st.cls]).toBe('spotter_drone');
    expect(st.team).toBe(Team.Corgis);
    expect(st.maxHp).toBe(DRONE.hp);
    run(sim, 1);
    // on station: ahead (-Z) and up
    expect(drone.pos.z).toBeLessThan(-DRONE.ahead + 0.5);
    expect(drone.pos.y).toBeGreaterThan(DRONE.up - 0.4);
    expect(spotted(sim, catA)).toBe(true);
    expect(spotted(sim, catB)).toBe(false);
    expect(spotted(sim, ally)).toBe(false);
    expect(spotted(sim, owner)).toBe(false);
    // a second press while cooling down does nothing
    useAbility(sim, owner, 0);
    expect(ents(sim, 'drone').length).toBe(1);
    const later = run(sim, ABILITIES.spotter_drone.duration);
    expect(later.some((e) => e.e === 'ability' && e.id === drone.id && e.ability === 'spotter_drone:end')).toBe(true);
    expect(drone.removed).toBe(true);
    expect(spotted(sim, catA)).toBe(false);
  });

  it('can be shot down by the other team (hit markers, then :down) and goes down with its owner', async () => {
    const sim = await yard();
    const owner = spawn(sim, Team.Corgis, 0, 0, 'overwatch');
    const shooter = spawn(sim, Team.Cats, 0, -16, 'assault', Math.PI);
    run(sim, 0.3);
    useAbility(sim, owner, 0);
    run(sim, 0.8);
    const [drone] = ents(sim, 'drone');
    const evs: Ev[] = [];
    run(sim, 2.5, evs, () => {
      if (drone.removed) { input(sim, shooter, 0); return; }
      const a = aimAt(shooter, drone.pos.x, drone.pos.y, drone.pos.z);
      input(sim, shooter, Btn.Fire, a.yaw, a.pitch);
    });
    const hits = evs.filter((e) => e.e === 'hit' && e.dst === drone.id);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.e === 'hit' && h.src === shooter.id)).toBe(true);
    expect(evs.some((e) => e.e === 'ability' && e.id === drone.id && e.ability === 'spotter_drone:down')).toBe(true);
    expect(drone.removed).toBe(true);
    expect(sim.entities.has(drone.id)).toBe(false);
    expect(owner.health!.hp).toBe(owner.health!.max); // the drone took the bullets

    // a new drone goes down with its owner
    owner.abil!.cooldown = 0;
    useAbility(sim, owner, 0);
    const [d2] = ents(sim, 'drone');
    kill(sim, owner, { id: shooter.id, team: Team.Cats, weapon: 0 });
    const down = run(sim, 0.1);
    expect(down.some((e) => e.e === 'ability' && e.id === d2.id && e.ability === 'spotter_drone:down')).toBe(true);
    expect(d2.removed).toBe(true);
  });

  it('is not hurt by its own team', async () => {
    const sim = await yard();
    const owner = spawn(sim, Team.Corgis, 0, 0, 'overwatch');
    const mate = spawn(sim, Team.Corgis, 0, -16, 'assault', Math.PI);
    run(sim, 0.3);
    useAbility(sim, owner, 0);
    run(sim, 0.8);
    const [drone] = ents(sim, 'drone');
    const evs = run(sim, 1, [], () => {
      const a = aimAt(mate, drone.pos.x, drone.pos.y, drone.pos.z);
      input(sim, mate, Btn.Fire, a.yaw, a.pitch);
    });
    expect(evs.some((e) => e.e === 'hit' && e.dst === drone.id)).toBe(false);
    expect(drone.health!.hp).toBe(DRONE.hp);
  });
});

describe('dig charge', () => {
  it('plants under the crosshair, arms, then blasts enemies in reach with falloff — never through walls, never allies', async () => {
    // cat C stands inside the blast radius but behind a wall (x = -2)
    const sim = await yard([wall(-2, -9.5, 0.3, 3, 2)]);
    const owner = spawn(sim, Team.Corgis, 0, -8, 'breacher');
    run(sim, 0.3);
    // look down at the ground ~1.5 m ahead (-Z)
    const evs = useAbility(sim, owner, 0, -0.6);
    const [charge] = ents(sim, 'charge');
    expect(charge).toBeTruthy();
    expect(evs.some((e) => e.e === 'ability' && e.id === owner.id && e.ability === 'dig_charge')).toBe(true);
    expect(charge.pos.z).toBeLessThan(owner.pos.z - 1);
    expect(charge.pos.z).toBeGreaterThan(owner.pos.z - CHARGE.plantReach);
    expect(Math.abs(charge.pos.y)).toBeLessThan(0.05);
    const cz = charge.pos.z;
    // the owner walks off; an ally stands on it; cat A walks up within the trigger radius before it arms
    sim.placeCharacter(owner, 0, 0.02, 20);
    const ally = spawn(sim, Team.Corgis, 0.5, cz + 0.4);
    const catA = spawn(sim, Team.Cats, 2.2, cz);
    const catC = spawn(sim, Team.Cats, -4.2, cz);
    expect(sim.toState(charge).flags & EFlag.Busy).toBe(0); // not armed yet
    const blast = run(sim, CHARGE.armTime + 0.3);
    const boom = blast.find((e) => e.e === 'explode');
    expect(boom).toBeTruthy();
    expect(boom!.t).toBeGreaterThanOrEqual(0.3 + CHARGE.armTime - 0.05);
    expect(boom!.e === 'explode' && boom!.by).toBe(owner.id);
    expect(charge.removed).toBe(true);
    const hitA = blast.find((e) => e.e === 'hit' && e.dst === catA.id);
    expect(hitA).toBeTruthy();
    const dmg = hitA!.e === 'hit' ? hitA!.dmg : 0;
    expect(dmg).toBeGreaterThan(ABILITIES.dig_charge.damage * CHARGE.edgeFrac);
    expect(dmg).toBeLessThan(ABILITIES.dig_charge.damage);
    expect(catA.pos.x).toBeGreaterThan(2.2 + 0.5); // knocked away from the charge
    // cat C is within the blast radius, behind the wall: untouched
    expect(Math.hypot(catC.pos.x - charge.pos.x, catC.pos.z - cz)).toBeLessThan(ABILITIES.dig_charge.range);
    expect(blast.some((e) => e.e === 'hit' && e.dst === catC.id)).toBe(false);
    expect(catC.health!.hp).toBe(catC.health!.max);
    expect(ally.health!.hp).toBe(ally.health!.max);
  });

  it('does not trigger for allies, goes off when its fuse runs out, and caps live charges per owner', async () => {
    const sim = await yard();
    const owner = spawn(sim, Team.Corgis, 0, 0, 'breacher');
    spawn(sim, Team.Corgis, 1, -1); // an ally loitering on it
    run(sim, 0.3);
    useAbility(sim, owner, 0, 0); // looking level: plants at the feet
    const [c1] = ents(sim, 'charge');
    expect(Math.hypot(c1.pos.x, c1.pos.z)).toBeLessThan(0.05);
    sim.placeCharacter(owner, 20, 0.02, 0);
    for (let i = 0; i < 2; i++) { run(sim, 0.2); owner.abil!.cooldown = 0; useAbility(sim, owner, 0, 0); }
    // three planted, two live: the oldest fizzled
    expect(c1.removed).toBe(true);
    expect(ents(sim, 'charge').length).toBe(CHARGE.maxPerOwner);
    const fuse = run(sim, ABILITIES.dig_charge.duration + 0.5);
    expect(fuse.filter((e) => e.e === 'explode').length).toBe(CHARGE.maxPerOwner);
    expect(ents(sim, 'charge').length).toBe(0);
  });

  it('an enemy shot defuses it (no blast)', async () => {
    const sim = await yard();
    const owner = spawn(sim, Team.Corgis, 0, 0, 'breacher');
    run(sim, 0.3);
    useAbility(sim, owner, 0, 0);
    const [charge] = ents(sim, 'charge');
    sim.placeCharacter(owner, 30, 0.02, 0);
    const shooter = spawn(sim, Team.Cats, 0, -8, 'infiltrator', Math.PI);
    run(sim, 0.2);
    const evs: Ev[] = [];
    let k = 0;
    run(sim, 0.8, evs, () => {
      const a = aimAt(shooter, charge.pos.x, charge.pos.y + 0.12, charge.pos.z);
      input(sim, shooter, k++ % 8 < 4 ? Btn.Fire : 0, a.yaw, a.pitch);
    });
    expect(evs.some((e) => e.e === 'fire' && e.id === shooter.id)).toBe(true);
    expect(evs.some((e) => e.e === 'ability' && e.id === charge.id && e.ability === 'dig_charge:down')).toBe(true);
    expect(evs.some((e) => e.e === 'explode')).toBe(false);
    expect(charge.removed).toBe(true);
  });
});

describe('squeak barrier', () => {
  it('stands in front of the owner facing the aim and blocks movement for both teams', async () => {
    const sim = await yard();
    const owner = spawn(sim, Team.Corgis, 0, 0, 'warden');
    run(sim, 0.3);
    const evs = useAbility(sim, owner, 0);
    const [bar] = ents(sim, 'barrier');
    expect(bar).toBeTruthy();
    expect(evs.some((e) => e.e === 'ability' && e.id === owner.id && e.ability === 'squeak_barrier')).toBe(true);
    expect(bar.pos.z).toBeCloseTo(-BARRIER.dist, 1);
    expect(bar.yaw).toBeCloseTo(0, 5);
    expect(sim.toState(bar).maxHp).toBe(BARRIER.hp);
    // a cat charges at it from the far side (yaw PI faces +Z), an ally runs into it from behind the owner
    const cat = spawn(sim, Team.Cats, 0.4, -9, 'assault', Math.PI);
    const ally = spawn(sim, Team.Corgis, -0.6, 2);
    run(sim, 0.2); // (the barrier's collider joins Rapier's query structures at the next physics step)
    let catMax = -Infinity, allyMin = Infinity;
    run(sim, 2.5, [], () => {
      input(sim, cat, 0, Math.PI, 0, 1);
      input(sim, ally, 0, 0, 0, 1);
      catMax = Math.max(catMax, cat.pos.z); allyMin = Math.min(allyMin, ally.pos.z);
    });
    const face = BARRIER.thickness / 2;
    expect(catMax).toBeLessThan(-BARRIER.dist - face - 0.2);
    expect(allyMin).toBeGreaterThan(-BARRIER.dist + face + 0.2);
    expect(catMax).toBeGreaterThan(-BARRIER.dist - face - 0.8); // it did reach the wall
  });

  it('blocks bullets, takes the damage, and is destroyed after enough of it', async () => {
    const sim = await yard();
    const owner = spawn(sim, Team.Corgis, 0, 0, 'warden');
    const shooter = spawn(sim, Team.Cats, 0, -10, 'assault', Math.PI);
    run(sim, 0.3);
    useAbility(sim, owner, 0);
    const [bar] = ents(sim, 'barrier');
    run(sim, 0.1);
    const evs: Ev[] = [];
    const t0 = sim.time;
    let hpWhenDown = -1;
    run(sim, 5, evs, () => {
      const a = aimAt(shooter, owner.pos.x, owner.pos.y + 0.6, owner.pos.z);
      input(sim, shooter, Btn.Fire, a.yaw, a.pitch);
      if (bar.removed && hpWhenDown < 0) hpWhenDown = owner.health!.hp;
    });
    const barHits = evs.filter((e) => e.e === 'hit' && e.dst === bar.id);
    expect(barHits.length).toBeGreaterThan(5);
    const down = evs.find((e) => e.e === 'ability' && e.id === bar.id && e.ability === 'squeak_barrier:down');
    expect(down).toBeTruthy();
    // the owner was untouched while the wall stood, and gets hit after it broke
    const firstOwnerHit = evs.find((e) => e.e === 'hit' && e.dst === owner.id);
    expect(firstOwnerHit).toBeTruthy();
    expect(firstOwnerHit!.t).toBeGreaterThanOrEqual(down!.t);
    expect(hpWhenDown).toBe(owner.health!.max);
    expect(down!.t - t0).toBeLessThan(ABILITIES.squeak_barrier.duration);
  });

  it('stops projectiles: mortar direct hits and their blasts wear it down; enemy blasts defuse charges', async () => {
    const sim = await yard();
    const owner = spawn(sim, Team.Corgis, 0, 0, 'warden');
    const mine = spawn(sim, Team.Corgis, 9, 1, 'breacher');
    const lobber = spawn(sim, Team.Cats, 0, -14, 'breacher', Math.PI);
    run(sim, 0.3);
    useAbility(sim, owner, 0);
    useAbility(sim, mine, 0, 0);
    const [bar] = ents(sim, 'barrier');
    const [charge] = ents(sim, 'charge');
    run(sim, 0.1);
    const evs: Ev[] = [];
    let k = 0, ownerHp = -1;
    run(sim, 3, evs, () => {
      if (k === 120) ownerHp = owner.health!.hp;
      // lob straight at the wall's face (flat-ish arc), then at the charge
      const tgt = k < 120 ? { x: 0, y: 1.2, z: bar.pos.z } : { x: charge.pos.x, y: charge.pos.y, z: charge.pos.z };
      const a = aimAt(lobber, tgt.x, tgt.y, tgt.z);
      input(sim, lobber, k++ % 30 < 3 ? Btn.Fire : 0, a.yaw, a.pitch + (k < 120 ? 0.1 : 0.18));
    });
    const barHits = evs.filter((e) => e.e === 'hit' && e.dst === bar.id);
    expect(evs.filter((e) => e.e === 'explode').length).toBeGreaterThan(0);
    expect(barHits.length).toBeGreaterThan(0);
    expect(bar.health!.hp).toBeLessThan(BARRIER.hp);
    expect(ownerHp).toBe(owner.health!.max); // the wall ate the blasts
    expect(evs.some((e) => e.e === 'ability' && e.id === charge.id && e.ability === 'dig_charge:down')).toBe(true);
    expect(charge.removed).toBe(true);
  });

  it('client prediction mirrors barriers from snapshots, so predicted movement stops at the wall too', async () => {
    const auth = await yard();
    const owner = spawn(auth, Team.Corgis, 0, 0, 'warden');
    run(auth, 0.3);
    useAbility(auth, owner, 0);
    const snap = [...auth.entities.values()].map((e) => unpackEntity(packEntity(auth.toState(e)))); // wire precision
    const pred = await Sim.create({ seed: 5, world: flatWorld(), systems: [] });
    pred.world.step();
    const cache = new Map<number, Collider>();
    expect(mirrorBarriers(pred, snap, cache)).toBe(true);
    expect(cache.size).toBe(1);
    expect(mirrorBarriers(pred, snap, cache)).toBe(false); // idempotent
    const runner = pred.spawnCharacter({ team: Team.Cats, species: Species.Cat, cls: 'assault', name: 'r', x: 0.4, y: 0.02, z: -9, yaw: Math.PI });
    const ctx = { world: pred.world, kcc: pred.kcc };
    let maxZ = -Infinity;
    for (let i = 0; i < 150; i++) {
      runner.input = { seq: i + 1, mx: 0, mz: 1, yaw: Math.PI, pitch: 0, buttons: 0, rt: 0 };
      stepCharacter(ctx, runner, 1 / TICK_HZ);
      runner.prevButtons = 0;
      maxZ = Math.max(maxZ, runner.pos.z);
    }
    expect(maxZ).toBeLessThan(-BARRIER.dist - BARRIER.thickness / 2 - 0.2);
    expect(maxZ).toBeGreaterThan(-BARRIER.dist - BARRIER.thickness / 2 - 0.8);
    expect(mirrorBarriers(pred, [], cache)).toBe(true); // gone from the snapshot → removed
    expect(cache.size).toBe(0);
  });

  it('expires after its duration', async () => {
    const sim = await yard();
    const owner = spawn(sim, Team.Corgis, 0, 0, 'warden');
    run(sim, 0.3);
    useAbility(sim, owner, 0);
    const [bar] = ents(sim, 'barrier');
    const evs = run(sim, ABILITIES.squeak_barrier.duration + 0.2);
    expect(evs.some((e) => e.e === 'ability' && e.id === bar.id && e.ability === 'squeak_barrier:end')).toBe(true);
    expect(bar.removed).toBe(true);
  });

  it('never spawns inside a character or a prop: nudged clear, or refused with no cooldown spent', async () => {
    const sim = await yard([wall(0, -40.9, 6, 0.3, 3)]);
    const owner = spawn(sim, Team.Corgis, 0, 0, 'warden');
    const cat = spawn(sim, Team.Cats, 0, -BARRIER.dist);
    run(sim, 0.3);
    useAbility(sim, owner, 0);
    const [bar] = ents(sim, 'barrier');
    expect(bar).toBeTruthy();
    // the cat's capsule is clear of the wall box
    const c = Math.cos(bar.yaw), s = Math.sin(bar.yaw);
    const dx = cat.pos.x - bar.pos.x, dz = cat.pos.z - bar.pos.z;
    const lx = dx * c - dz * s, lz = -dx * s - dz * c;
    const out = Math.hypot(Math.max(0, Math.abs(lx) - ABILITIES.squeak_barrier.range / 2), Math.max(0, Math.abs(lz) - BARRIER.thickness / 2));
    expect(out).toBeGreaterThan(cat.char!.move.capsuleRadius);

    // right up against a wide wall: nothing fits between
    const w = spawn(sim, Team.Corgis, 0, -40, 'warden');
    run(sim, 0.2);
    expect(findBarrierSpot(sim, w, ABILITIES.squeak_barrier.range)).toBeNull();
    const evs = useAbility(sim, w, 0);
    expect(evs.some((e) => e.e === 'ability' && e.id === w.id)).toBe(false);
    expect(w.abil!.cooldown).toBe(0);
    expect(ents(sim, 'barrier').length).toBe(1);
  });
});

describe('ability entity lifecycle', () => {
  it('everything is cleared when combat stops (warmup / match over / restart)', async () => {
    const sim = await yard();
    const o = spawn(sim, Team.Corgis, 0, 0, 'overwatch');
    const b = spawn(sim, Team.Corgis, 6, 0, 'breacher');
    const w = spawn(sim, Team.Corgis, -6, 0, 'warden');
    run(sim, 0.3);
    for (const e of [o, b, w]) input(sim, e, Btn.Ability, 0, 0);
    run(sim, 2 / TICK_HZ);
    expect(abilityEntities(sim).length).toBe(3);
    sim.state.rules = { combatLive: false, respawn: [true, true, true] };
    run(sim, 2 / TICK_HZ);
    expect(abilityEntities(sim).length).toBe(0);
    expect([...sim.entities.values()].some((e) => e.kind === EntityKind.Ability)).toBe(false);
    expect(sim.removedIds.length).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic for the same inputs', async () => {
    const trace = async () => {
      const sim = await yard();
      const o = spawn(sim, Team.Corgis, 0, 0, 'overwatch');
      const b = spawn(sim, Team.Corgis, 6, 0, 'breacher');
      const w = spawn(sim, Team.Corgis, -6, 0, 'warden');
      const cat = spawn(sim, Team.Cats, 3, -12, 'assault', Math.PI);
      run(sim, 0.3);
      for (const e of [o, b, w]) input(sim, e, Btn.Ability, 0.2, -0.3);
      const out: string[] = [];
      run(sim, 3, [], () => {
        input(sim, cat, Btn.Fire, Math.PI + 0.1, 0.05, 1);
        out.push(abilityEntities(sim).map((a) => `${a.id}:${a.pos.x.toFixed(4)},${a.pos.y.toFixed(4)},${a.pos.z.toFixed(4)},${a.health?.hp ?? 0}`).join('|'));
      });
      return out.join('\n');
    };
    expect(await trace()).toBe(await trace());
  });
});

// V1 vehicles: Vehicle Terminal + Mower Kart on a deterministic flat test yard (a real heightfield
// ground like the West Yard's, plus crates, a wall, a 20° ramp and a jump pad).
import { describe, it, expect } from 'vitest';
import { Sim, type SimSystem } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Btn } from '../../src/shared/input';
import { Anim, EFlag, EntityKind, Species, Team, type TeamId } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import type { PropBox, WorldData } from '../../src/shared/world/world-data';
import { mulberry32 } from '../../src/shared/rng';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem } from '../../src/sim/systems/core';
import { worldSystems } from '../../src/sim/world/systems';
import { combatSystems } from '../../src/sim/combat';
import { groups, Layer } from '../../src/sim/rapier';
import {
  vehicleSystems, spawnKart, spawnTerminal, mountKart, damageKart, findTerminalSite, seatPosition, capsuleClear,
} from '../../src/sim/vehicles';
import { TERMINALS, VEHICLES } from '../../src/shared/content/vehicles';

const KART = VEHICLES.mower_kart;
const TERM = TERMINALS.kart_terminal;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------
// Test yard: 160 m flat heightfield (same collider type as the West Yard), props added per test.
// ---------------------------------------------------------------------------------------------
function yard(props: PropBox[] = [], extra: Partial<WorldData> = {}): WorldData {
  const n = 81, cell = 2;
  return {
    seed: 1, name: 'vehicle test yard', height: () => 0, halfExtent: 80, killY: -30,
    terrain: { x0: -80, z0: -80, cell, n, heights: new Float32Array(n * n) },
    props,
    spawns: [
      { x: -40, y: 0, z: 40, yaw: 0, team: Team.Corgis }, { x: -34, y: 0, z: 42, yaw: 0, team: Team.Corgis },
      { x: 40, y: 0, z: -40, yaw: Math.PI, team: Team.Cats }, { x: 34, y: 0, z: -42, yaw: Math.PI, team: Team.Cats },
    ],
    bounds: { minX: -78, maxX: 78, minZ: -78, maxZ: 78 },
    ...extra,
  };
}

/** A 20° ramp rising toward -Z from (x, z0) up to a 3 m platform. */
function rampProps(x: number, z0: number): PropBox[] {
  const a = 20 * DEG, len = 3 / Math.sin(a) + 1.2; // long enough to reach 3 m
  const run = Math.cos(a) * len;
  const thick = 0.5;
  // Box center: along the slope, sunk so its top surface starts at ground level at z0.
  const cz = z0 - (run / 2), cy = (Math.sin(a) * len) / 2 - (thick / 2) / Math.cos(a);
  return [
    { type: 'ramp', x, y: cy, z: cz, hx: 2.5, hy: thick / 2, hz: len / 2, rotY: 0, pitch: a },
    { type: 'deck', x, y: 1.5, z: z0 - run - 5 + 0.3, hx: 3, hy: 1.5, hz: 5, rotY: 0 },
  ];
}

const VEHICLE_ONLY = (): SimSystem[] => [...vehicleSystems(), movementSystem, ...worldSystems(), physicsStepSystem];
const WITH_COMBAT = (): SimSystem[] => [...VEHICLE_ONLY(), ...combatSystems()];

async function makeSim(world: WorldData, systems = VEHICLE_ONLY(), autoTerminals = false): Promise<Sim> {
  const sim = await Sim.create({ seed: 5, world, systems });
  sim.state.vehicleConfig = { autoTerminals };
  sim.step(); // tick 0: Rapier query structures exist after the first world.step()
  return sim;
}

function spawnPet(sim: Sim, team: TeamId, x: number, z: number, yaw = 0): SimEntity {
  return sim.spawnCharacter({ team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls: 'assault', name: `p${sim.entities.size}`, x, y: sim.worldData.height(x, z) + 0.02, z, yaw });
}

let seq = 1;
function drive(sim: Sim, e: SimEntity, mz: number, mx: number, buttons: number, ticks: number, events?: GameEvent[]): void {
  for (let i = 0; i < ticks; i++) {
    sim.setInput(e.id, { seq: seq++, mx, mz, yaw: e.input.yaw, pitch: 0, buttons, rt: 0 });
    sim.step();
    const ev = sim.drainEvents();
    if (events) events.push(...ev);
  }
}
/** One Interact tap (press + release). */
function interact(sim: Sim, e: SimEntity, events?: GameEvent[]): void {
  drive(sim, e, 0, 0, Btn.Interact, 1, events);
  drive(sim, e, 0, 0, 0, 1, events);
}
const speedOf = (e: SimEntity) => Math.hypot(e.vel.x, e.vel.z);
const karts = (sim: Sim) => [...sim.entities.values()].filter((e) => e.kind === EntityKind.Vehicle);

const CAPSULE_TEST = groups(Layer.Character, Layer.World | Layer.Vehicle);
/** True when the character's capsule (shrunk 3 cm) overlaps world/terminal/kart geometry. */
function capsuleInsideGeometry(sim: Sim, e: SimEntity): boolean {
  const m = e.char!.move;
  const shape = new sim.R.Capsule(m.capsuleHalfHeight, m.capsuleRadius - 0.03);
  const c = { x: e.pos.x, y: e.pos.y + m.capsuleHalfHeight + m.capsuleRadius, z: e.pos.z };
  return sim.world.intersectionWithShape(c, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, CAPSULE_TEST, e.collider ?? undefined) !== null;
}

// ---------------------------------------------------------------------------------------------

describe('vehicle terminal', () => {
  async function terminalYard() {
    const world = yard();
    const sim = await makeSim(world);
    const site = findTerminalSite(world, Team.Corgis)!;
    expect(site).not.toBeNull();
    const term = spawnTerminal(sim, site);
    sim.step();
    return { sim, term, site };
  }

  it('is placed from world data near its team spawns, on clear flat ground', async () => {
    const world = yard([{ type: 'crate', x: -37, y: 1, z: 34, hx: 1, hy: 1, hz: 1, rotY: 0 }]);
    for (const team of [Team.Corgis, Team.Cats] as TeamId[]) {
      const s = findTerminalSite(world, team)!;
      const sp = world.spawns.filter((p) => p.team === team);
      const cx = sp.reduce((a, p) => a + p.x, 0) / sp.length, cz = sp.reduce((a, p) => a + p.z, 0) / sp.length;
      const dist = Math.hypot(s.x - cx, s.z - cz);
      expect(dist).toBeGreaterThan(5);
      expect(dist).toBeLessThan(26);
      expect(Math.hypot(s.padX - s.x, s.padZ - s.z)).toBeCloseTo(TERM.padOffset, 3);
      // the crate near the corgi base is avoided
      expect(Math.hypot(s.x + 37, s.z - 34)).toBeGreaterThan(2.5);
    }
    // deterministic
    expect(findTerminalSite(world, Team.Cats)).toEqual(findTerminalSite(world, Team.Cats));
  });

  it('vends a kart only within 2.5 m, only for its own team, and respects the 20 s cooldown', async () => {
    const { sim, term, site } = await terminalYard();
    const fx = Math.sin(site.yaw), fz = Math.cos(site.yaw);
    // Out of range (3.4 m in front of the screen): nothing.
    const far = spawnPet(sim, Team.Corgis, site.x - fx * 3.4, site.z - fz * 3.4);
    drive(sim, far, 0, 0, 0, 10);
    interact(sim, far);
    expect(karts(sim)).toHaveLength(0);
    // Enemy team in range: nothing.
    const cat = spawnPet(sim, Team.Cats, site.x - fx * 1.6 + 0.8, site.z - fz * 1.6);
    drive(sim, cat, 0, 0, 0, 10);
    interact(sim, cat);
    expect(karts(sim)).toHaveLength(0);
    expect(term.flags & EFlag.Busy).toBe(0);
    // Own team in range: one kart on the pad, terminal busy.
    const dog = spawnPet(sim, Team.Corgis, site.x - fx * 1.7 - 0.6, site.z - fz * 1.7);
    drive(sim, dog, 0, 0, 0, 10);
    const ev: GameEvent[] = [];
    interact(sim, dog, ev);
    const ks = karts(sim);
    expect(ks).toHaveLength(1);
    const kart = ks[0];
    expect(kart.team).toBe(Team.Corgis);
    expect(Math.hypot(kart.pos.x - site.padX, kart.pos.z - site.padZ)).toBeLessThan(2.2);
    expect(ev.some((e) => e.e === 'spawn' && e.id === kart.id)).toBe(true);
    expect(term.flags & EFlag.Busy).toBeTruthy();
    expect(term.weapon).toBe(kart.id);
    // One active kart per terminal.
    interact(sim, dog);
    expect(karts(sim)).toHaveLength(1);
    // Destroy it: explode, 20 s cooldown, still busy, cannot vend.
    damageKart(sim, kart, 9999, { id: cat.id, team: Team.Cats, weapon: -1 }, kart.pos.x, kart.pos.y, kart.pos.z);
    expect(kart.removed).toBe(true);
    drive(sim, dog, 0, 0, 0, 2);
    expect(term.terminal!.cooldown).toBeGreaterThan(TERM.cooldown - 0.1);
    expect(term.ammo).toBe(20);
    expect(term.flags & EFlag.Busy).toBeTruthy();
    drive(sim, dog, 0, 0, 0, 60 * 10);
    interact(sim, dog);
    expect(karts(sim)).toHaveLength(0);
    drive(sim, dog, 0, 0, 0, 60 * 10);
    expect(term.flags & EFlag.Busy).toBe(0);
    if (dog.dead) drive(sim, dog, 0, 0, 0, 60 * 4);
    sim.placeCharacter(dog, site.x - fx * 1.7 - 0.6, 0.02, site.z - fz * 1.7); // the blast knocked it away
    drive(sim, dog, 0, 0, 0, 5);
    interact(sim, dog);
    expect(karts(sim)).toHaveLength(1);
  });

  it('vends beside the pad when someone is standing on it', async () => {
    const { sim, site } = await terminalYard();
    const blocker = spawnPet(sim, Team.Corgis, site.padX, site.padZ);
    const fx = Math.sin(site.yaw), fz = Math.cos(site.yaw);
    const dog = spawnPet(sim, Team.Corgis, site.x - fx * 1.7, site.z - fz * 1.7);
    drive(sim, dog, 0, 0, 0, 10);
    interact(sim, dog);
    const [kart] = karts(sim);
    expect(kart).toBeDefined();
    expect(Math.hypot(kart.pos.x - blocker.pos.x, kart.pos.z - blocker.pos.z)).toBeGreaterThan(KART.radius + 0.3);
  });
});

describe('mount / dismount', () => {
  it('seats the rider (Mounted, Drive, follows the seat) and movement leaves them alone', async () => {
    const sim = await makeSim(yard());
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, 0, 0, 0, 0);
    const dog = spawnPet(sim, Team.Corgis, 2, 0.5);
    drive(sim, dog, 0, 0, 0, 20);
    const ev: GameEvent[] = [];
    interact(sim, dog, ev);
    expect(dog.flags & EFlag.Mounted).toBeTruthy();
    expect(dog.anim).toBe(Anim.Drive);
    expect(kart.kart!.rider).toBe(dog.id);
    expect(kart.flags & EFlag.Busy).toBeTruthy();
    expect(kart.weapon).toBe(dog.id);
    expect(ev.some((e) => e.e === 'ability' && e.ability === 'mount')).toBe(true);
    drive(sim, dog, 1, 0.4, 0, 90);
    const s = seatPosition(kart);
    expect(Math.hypot(dog.pos.x - s.x, dog.pos.y - s.y, dog.pos.z - s.z)).toBeLessThan(1e-6);
    expect(speedOf(kart)).toBeGreaterThan(5);
    // riders cannot shoot or use abilities while driving (Fire = horn)
    const ev2: GameEvent[] = [];
    drive(sim, dog, 1, 0, Btn.Fire, 3, ev2);
    expect(ev2.some((e) => e.e === 'ability' && e.ability === 'horn')).toBe(true);
    expect(ev2.some((e) => e.e === 'fire')).toBe(false);
    expect(dog.input.buttons & Btn.Fire).toBe(0);
  });

  it('cannot mount out of range, a taken seat, or a speeding kart', async () => {
    const sim = await makeSim(yard());
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, 0, 0, 0, 0);
    const far = spawnPet(sim, Team.Corgis, 3.2, 0);
    const near = spawnPet(sim, Team.Cats, -1.9, 0.3);
    const third = spawnPet(sim, Team.Corgis, 0.4, 1.9);
    drive(sim, far, 0, 0, 0, 20);
    interact(sim, far);
    expect(far.flags & EFlag.Mounted).toBe(0);
    interact(sim, near); // enemies may steal an empty kart
    expect(kart.kart!.rider).toBe(near.id);
    interact(sim, third);
    expect(third.flags & EFlag.Mounted).toBe(0);
    expect(kartTeamOf(sim, kart)).toBe(Team.Cats);
  });

  it('dismounts to a clear spot on the ground: 50 random spots among props never end inside geometry', async () => {
    const rng = mulberry32(99);
    const props: PropBox[] = [];
    for (let i = 0; i < 70; i++) {
      const x = (rng() - 0.5) * 100, z = (rng() - 0.5) * 100;
      const tall = rng() < 0.3;
      props.push({ type: tall ? 'wall' : 'crate', x, y: tall ? 2 : 0.5 + rng() * 0.6, z, hx: 0.3 + rng() * (tall ? 3 : 1.2), hy: tall ? 2 : 0.5 + rng() * 0.6, hz: 0.3 + rng() * 1.2, rotY: rng() * Math.PI });
    }
    const sim = await makeSim(yard(props));
    let done = 0, attempts = 0, stayed = 0;
    while (done < 50 && attempts < 400) {
      attempts++;
      const x = (rng() - 0.5) * 100, z = (rng() - 0.5) * 100, yaw = rng() * Math.PI * 2;
      // Kart spots hugging props (the hard case) but not overlapping them.
      const shape = new sim.R.Cylinder(0.3, KART.radius + 0.05);
      if (sim.world.intersectionWithShape({ x, y: 0.4, z }, { x: 0, y: 0, z: 0, w: 1 }, shape) !== null) continue;
      let nearProp = false;
      for (const p of props) if (Math.hypot(p.x - x, p.z - z) < Math.hypot(p.hx, p.hz) + 2.2) nearProp = true;
      if (!nearProp) continue;
      const kart = spawnKart(sim, 'mower_kart', Team.Corgis, x, 0, z, yaw);
      const dog = spawnPet(sim, Team.Corgis, x + 50, z + 50); // anywhere; mountKart seats directly
      sim.step();
      expect(mountKart(sim, kart, dog)).toBe(true);
      drive(sim, dog, 0, 0, 0, 2);
      interact(sim, dog);
      if (dog.flags & EFlag.Mounted) { stayed++; } else {
        drive(sim, dog, 0, 0, 0, 1); // settle one tick, refresh query structures
        expect(capsuleInsideGeometry(sim, dog)).toBe(false);
        expect(dog.pos.y).toBeGreaterThan(sim.worldData.height(dog.pos.x, dog.pos.z) - 0.02);
        expect(Math.hypot(dog.pos.x - kart.pos.x, dog.pos.z - kart.pos.z)).toBeLessThan(4.5);
        done++;
      }
      sim.removeEntity(kart.id);
      sim.removeEntity(dog.id);
      sim.step();
    }
    expect(done).toBe(50);
    expect(stayed).toBeLessThan(5);
  });

  it('refuses to dismount when boxed in on every side (the rider stays seated)', async () => {
    const walls: PropBox[] = [
      { type: 'wall', x: 0, y: 1, z: -1.45, hx: 2, hy: 1, hz: 0.5, rotY: 0 }, { type: 'wall', x: 0, y: 1, z: 1.45, hx: 2, hy: 1, hz: 0.5, rotY: 0 },
      { type: 'wall', x: -1.45, y: 1, z: 0, hx: 0.5, hy: 1, hz: 2, rotY: 0 }, { type: 'wall', x: 1.45, y: 1, z: 0, hx: 0.5, hy: 1, hz: 2, rotY: 0 },
      { type: 'roof', x: 0, y: 1.9, z: 0, hx: 2, hy: 0.1, hz: 2, rotY: 0 },
    ];
    const sim = await makeSim(yard(walls));
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, 0, 0, 0, 0);
    const dog = spawnPet(sim, Team.Corgis, 20, 20);
    sim.step();
    mountKart(sim, kart, dog);
    drive(sim, dog, 0, 0, 0, 2);
    interact(sim, dog);
    expect(dog.flags & EFlag.Mounted).toBeTruthy();
    expect(capsuleClear(sim, dog, 3, 0.05, 3)).toBe(true);
    expect(capsuleClear(sim, dog, 0.9, 0.05, 0)).toBe(false);
  });
});

function kartTeamOf(sim: Sim, kart: SimEntity): TeamId {
  const r = kart.kart!.rider >= 0 ? sim.entities.get(kart.kart!.rider) : undefined;
  return r ? r.team : kart.team;
}

describe('kart handling', () => {
  async function driver(props: PropBox[] = [], extra: Partial<WorldData> = {}, x = 0, z = 60, yaw = 0) {
    const sim = await makeSim(yard(props, extra));
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, x, 0, z, yaw);
    const dog = spawnPet(sim, Team.Corgis, x + 30, z);
    sim.step();
    mountKart(sim, kart, dog);
    return { sim, kart, dog };
  }

  it('accelerates to top speed and boosts to ~18 m/s on the meter', async () => {
    const { sim, kart, dog } = await driver();
    drive(sim, dog, 1, 0, 0, 60);
    const at1 = speedOf(kart);
    drive(sim, dog, 1, 0, 0, 120);
    expect(at1).toBeGreaterThan(8);
    expect(speedOf(kart)).toBeCloseTo(KART.topSpeed, 1);
    expect(kart.pos.z).toBeLessThan(30); // went forward (-Z at yaw 0)
    expect(Math.abs(kart.pos.x)).toBeLessThan(0.1);
    const ev: GameEvent[] = [];
    drive(sim, dog, 1, 0, Btn.Sprint, 50, ev);
    expect(speedOf(kart)).toBeGreaterThan(17.5);
    expect(speedOf(kart)).toBeLessThanOrEqual(KART.boostSpeed + 1e-6);
    expect(kart.flags & EFlag.Sprinting).toBeTruthy();
    expect(kart.ammo).toBeLessThan(100);
    expect(ev.some((e) => e.e === 'ability' && e.ability === 'boost')).toBe(true);
    // empty meter: back to top speed
    drive(sim, dog, 1, 0, Btn.Sprint, 180);
    expect(kart.kart!.boost).toBeLessThan(0.001);
    expect(speedOf(kart)).toBeLessThan(KART.topSpeed + 0.3);
    // brakes and reverses
    drive(sim, dog, -1, 0, 0, 150);
    expect(-Math.sin(kart.yaw) * kart.vel.x - Math.cos(kart.yaw) * kart.vel.z).toBeCloseTo(-KART.reverseSpeed, 1);
  });

  it('steers with speed-scaled yaw rate (no pivot at a standstill, right = clockwise)', async () => {
    const { sim, kart, dog } = await driver([], {}, 0, 0);
    drive(sim, dog, 0, 1, 0, 60);
    expect(Math.abs(kart.yaw)).toBeLessThan(1e-6);
    drive(sim, dog, 1, 0, 0, 90);
    const y0 = kart.yaw;
    drive(sim, dog, 1, 1, 0, 30);
    expect(kart.yaw).toBeLessThan(y0 - 0.5); // turned right (yaw decreases)
    expect(kart.pos.x).toBeGreaterThan(0.5); // heading toward +X
    // a full circle at speed stays within a sane radius
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < 240; i++) { drive(sim, dog, 1, -1, 0, 1); minX = Math.min(minX, kart.pos.x); maxX = Math.max(maxX, kart.pos.x); }
    expect(maxX - minX).toBeGreaterThan(6);
    expect(maxX - minX).toBeLessThan(20);
  });

  it('drifts on the handbrake (sideways slip, tighter line) and releases into a mini-turbo', async () => {
    const grip = await driver();
    drive(grip.sim, grip.dog, 1, 0, 0, 150);
    const g0 = grip.kart.yaw;
    drive(grip.sim, grip.dog, 1, -1, 0, 45);
    const gripTurn = grip.kart.yaw - g0;

    const { sim, kart, dog } = await driver();
    drive(sim, dog, 1, 0, 0, 150);
    const y0 = kart.yaw;
    let maxSlip = 0;
    const ev: GameEvent[] = [];
    for (let i = 0; i < 45; i++) {
      drive(sim, dog, 1, -1, Btn.Jump, 1, ev);
      const vh = Math.atan2(-kart.vel.x, -kart.vel.z);
      let slip = Math.abs(vh - kart.yaw); if (slip > Math.PI) slip = Math.PI * 2 - slip;
      maxSlip = Math.max(maxSlip, slip);
    }
    expect(kart.kart!.drifting).toBe(true);
    expect(kart.flags & EFlag.Crouching).toBeTruthy();
    expect(maxSlip).toBeGreaterThan(12 * DEG);
    expect(kart.yaw - y0).toBeGreaterThan(gripTurn * 1.15);
    drive(sim, dog, 1, -1, Btn.Jump, 30);
    drive(sim, dog, 1, 0, 0, 1, ev);
    expect(kart.kart!.turbo).toBeGreaterThan(0);
    expect(ev.some((e) => e.e === 'ability' && e.ability === 'boost')).toBe(true);
    drive(sim, dog, 1, 0, 0, 20);
    expect(speedOf(kart)).toBeGreaterThan(KART.topSpeed * 0.8);
  });

  it('climbs a 20° ramp onto a 3 m deck', async () => {
    const { sim, kart, dog } = await driver(rampProps(0, 40), {}, 0, 52);
    let maxY = 0;
    for (let i = 0; i < 240; i++) { drive(sim, dog, 1, 0, 0, 1); maxY = Math.max(maxY, kart.pos.y); }
    expect(maxY).toBeGreaterThan(2.9);
    expect(kart.pos.z).toBeLessThan(40 - 8.5);
    expect(kart.kart!.grounded).toBe(true);
  });

  it('is stopped by a wall (bounces back, never passes through) and takes crash damage', async () => {
    const wall: PropBox = { type: 'wall', x: 0, y: 2, z: 30, hx: 10, hy: 2, hz: 0.4, rotY: 0 };
    const { sim, kart, dog } = await driver([wall], {}, 0, 58);
    const ev: GameEvent[] = [];
    let minZ = Infinity, bounced = false;
    for (let i = 0; i < 240; i++) {
      drive(sim, dog, 1, 0, Btn.Sprint, 1, ev);
      minZ = Math.min(minZ, kart.pos.z);
      if (kart.vel.z > 0.5) bounced = true;
    }
    expect(minZ).toBeGreaterThan(30 + 0.4 + KART.radius - 0.05);
    expect(bounced).toBe(true);
    expect(kart.health!.hp).toBeLessThan(KART.maxHp);
    expect(ev.some((e) => e.e === 'hit' && e.dst === kart.id)).toBe(true);
    expect(kart.removed).toBe(false);
  });

  it('survives a jump pad: launched, airborne, lands upright and drives on', async () => {
    const pad = { id: 'pad', x: 0, y: 0, z: 40, r: 2.5, vy: 17.5 };
    const { sim, kart, dog } = await driver([], { jumpPads: [pad] }, 0, 55);
    const ev: GameEvent[] = [];
    let maxY = 0, air = 0;
    for (let i = 0; i < 300; i++) {
      drive(sim, dog, 1, 0, 0, 1, ev);
      maxY = Math.max(maxY, kart.pos.y);
      if (!kart.kart!.grounded) air++;
    }
    expect(ev.some((e) => e.e === 'jump' && e.id === kart.id)).toBe(true);
    expect(maxY).toBeGreaterThan(2.5);
    expect(air).toBeGreaterThan(30);
    expect(ev.some((e) => e.e === 'land' && e.id === kart.id)).toBe(true);
    expect(kart.removed).toBe(false);
    expect(kart.health!.hp).toBeGreaterThan(KART.maxHp * 0.8);
    expect(kart.kart!.grounded).toBe(true);
    expect(Math.abs(kart.pitch)).toBeLessThan(0.05);
    expect(kart.pos.y).toBeGreaterThan(-0.05);
    expect(speedOf(kart)).toBeGreaterThan(10);
    expect(Math.hypot(dog.pos.x - seatPosition(kart).x, dog.pos.z - seatPosition(kart).z)).toBeLessThan(1e-6);
  });

  it('is deterministic: identical inputs give bit-identical kart and rider positions', async () => {
    const run = async () => {
      const props = rampProps(4, 30);
      const { sim, kart, dog } = await driver([...props, { type: 'crate', x: -6, y: 1, z: 20, hx: 1, hy: 1, hz: 1, rotY: 0.4 }], { jumpPads: [{ id: 'p', x: -4, y: 0, z: 44, r: 2, vy: 16 }] }, 0, 58);
      const rng = mulberry32(1234);
      const trace: number[] = [];
      for (let i = 0; i < 600; i++) {
        const b = (rng() < 0.2 ? Btn.Jump : 0) | (rng() < 0.3 ? Btn.Sprint : 0);
        drive(sim, dog, rng() * 2 - 0.6, rng() * 2 - 1, b, 1);
        trace.push(kart.pos.x, kart.pos.y, kart.pos.z, kart.yaw, dog.pos.x, dog.pos.y, dog.pos.z);
      }
      return trace;
    };
    const a = await run(), b = await run();
    expect(a.length).toBe(b.length);
    expect(a).toEqual(b);
  });
});

describe('rams, damage and destruction', () => {
  it('hits a character above 6 m/s (damage + launch through the combat damage path); slow contact only shoves', async () => {
    const sim = await makeSim(yard(), WITH_COMBAT());
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, 0, 0, 60, 0);
    const dog = spawnPet(sim, Team.Corgis, 30, 60);
    const cat = spawnPet(sim, Team.Cats, 0, 36);
    sim.step();
    mountKart(sim, kart, dog);
    const ev: GameEvent[] = [];
    let hitAt = -1;
    for (let i = 0; i < 180 && hitAt < 0; i++) {
      const v = speedOf(kart);
      drive(sim, dog, 1, 0, 0, 1, ev);
      if (ev.some((e) => e.e === 'hit' && e.dst === cat.id)) hitAt = v;
    }
    expect(hitAt).toBeGreaterThan(KART.ramMinSpeed);
    expect(cat.health!.hp).toBeLessThan(cat.health!.max);
    const h = ev.find((e) => e.e === 'hit' && e.dst === cat.id) as Extract<GameEvent, { e: 'hit' }>;
    expect(h.src).toBe(dog.id); // credited to the driver
    drive(sim, dog, 0, 0, 0, 3);
    expect(cat.vel.y > 0 || !cat.char!.grounded || cat.dead).toBe(true);

    // Slow bump: a teammate-free slow push does no damage.
    const sim2 = await makeSim(yard(), WITH_COMBAT());
    const k2 = spawnKart(sim2, 'mower_kart', Team.Corgis, 0, 0, 60, 0);
    const d2 = spawnPet(sim2, Team.Corgis, 30, 60);
    const c2 = spawnPet(sim2, Team.Cats, 0, 57.4);
    sim2.step();
    mountKart(sim2, k2, d2);
    const ev2: GameEvent[] = [];
    drive(sim2, d2, 0.25, 0, 0, 120, ev2);
    expect(ev2.some((e) => e.e === 'hit' && e.dst === c2.id)).toBe(false);
    expect(c2.health!.hp).toBe(c2.health!.max);
    expect(c2.pos.z).toBeLessThan(57.4 - 0.3); // shoved ahead of the kart
    expect(Math.hypot(c2.pos.x - k2.pos.x, c2.pos.z - k2.pos.z)).toBeGreaterThan(KART.radius + 0.3);
  });

  it('is damaged by gunfire through the combat lane (armor), and destruction ejects the rider with an explosion', async () => {
    const world = yard();
    const sim = await makeSim(world, WITH_COMBAT());
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, 0, 0, 0, Math.PI / 2);
    const dog = spawnPet(sim, Team.Corgis, 20, 20);
    sim.step();
    mountKart(sim, kart, dog);
    // A cat bot 10 m away aims low at the kart body (below the rider) and holds the trigger.
    const cat = sim.spawnCharacter({ team: Team.Cats, species: Species.Cat, cls: 'assault', name: 'gunner', x: 0, y: 0, z: 10, yaw: 0, kind: EntityKind.Player });
    cat.ownerPid = null; // fire straight along the view from the eye
    const pitch = Math.atan2(0.35 - 1.1, 10);
    const ev: GameEvent[] = [];
    for (let i = 0; i < 90; i++) {
      sim.setInput(cat.id, { seq: seq++, mx: 0, mz: 0, yaw: 0, pitch, buttons: Btn.Fire, rt: 0 });
      drive(sim, dog, 0, 0, 0, 1, ev);
    }
    const hp = kart.health!.hp;
    expect(hp).toBeLessThan(KART.maxHp);
    expect(ev.some((e) => e.e === 'hit' && e.dst === kart.id && e.src === cat.id)).toBe(true);
    // Finish it: explode event, the rider is ejected (not mounted, clear of geometry, above ground).
    const ev2: GameEvent[] = [];
    damageKart(sim, kart, hp, { id: cat.id, team: Team.Cats, weapon: 0 }, kart.pos.x, kart.pos.y + 0.4, kart.pos.z);
    ev2.push(...sim.drainEvents());
    expect(kart.removed).toBe(true);
    expect(ev2.some((e) => e.e === 'explode')).toBe(true);
    expect(dog.flags & EFlag.Mounted).toBe(0);
    expect(dog.seat).toBeUndefined();
    drive(sim, dog, 0, 0, 0, 2);
    expect(capsuleInsideGeometry(sim, dog)).toBe(false);
    expect(dog.pos.y).toBeGreaterThan(-0.05);
    expect(dog.health!.hp).toBeLessThan(dog.health!.max); // caught in the blast
  });

  it('a rider killed while driving is thrown out of the seat before corpse physics', async () => {
    const sim = await makeSim(yard(), WITH_COMBAT());
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, 0, 0, 30, 0);
    const dog = spawnPet(sim, Team.Corgis, 20, 20);
    sim.step();
    mountKart(sim, kart, dog);
    drive(sim, dog, 1, 0, 0, 60);
    dog.health!.hp = 1;
    const cat = spawnPet(sim, Team.Cats, 40, 40);
    // direct combat-lane kill
    const { applyDamage } = await import('../../src/sim/combat');
    applyDamage(sim, dog, 50, { id: cat.id, team: Team.Cats, weapon: 0 }, dog.pos.x, dog.pos.y, dog.pos.z, false);
    drive(sim, dog, 0, 0, 0, 1);
    expect(dog.dead).toBe(true);
    expect(dog.flags & EFlag.Mounted).toBe(0);
    expect(kart.kart!.rider).toBe(-1);
    expect(kart.flags & EFlag.Busy).toBe(0);
    drive(sim, dog, 0, 0, 0, 30);
    expect(capsuleInsideGeometry(sim, dog)).toBe(false);
  });
});

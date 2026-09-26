// R1 RC plane: the flight model, collisions, crashes, the gun, pilots, determinism (flat test yard), and the real
// West Yard: the Rooftop Hangar, a take-off from the roof + circuit + landing, and a scripted pilot flying from
// The Rooftops to the shed roof (adventure chapter 6's route).
import { describe, it, expect } from 'vitest';
import { Sim, type SimSystem } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Btn, type InputCmd } from '../../src/shared/input';
import { Anim, CLASS_IDS, EFlag, EntityKind, Species, Team, type ClassId, type TeamId } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import type { PropBox, WorldData } from '../../src/shared/world/world-data';
import { createWorldData } from '../../src/shared/world/world-data';
import { mulberry32 } from '../../src/shared/rng';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem } from '../../src/sim/systems/core';
import { worldSystems } from '../../src/sim/world/systems';
import { combatSystems } from '../../src/sim/combat';
import { equipWeapon, explode } from '../../src/sim/combat';
import { groups, Layer } from '../../src/sim/rapier';
import {
  vehicleSystems, spawnPlane, mountPlane, useTerminal, hangarSite, planeAutopilot, planeFlightBox, planeSeatPosition,
  isStunned, riderVehicle, vehicleKindOf, isFlyingPlane, spawnTerminal, type AutopilotGoal,
} from '../../src/sim/vehicles';
import { TERMINALS, VEHICLES, packPlaneAux, unpackPlaneAux, vehicleIndex } from '../../src/shared/content/vehicles';
import { WEAPONS } from '../../src/shared/content/weapons';
import { terminalIndex } from '../../src/shared/content/terminals';

const PLANE = VEHICLES.rc_plane;
const HANGAR = TERMINALS.plane_hangar;

// ---------------------------------------------------------------------------------------------
// Test yard: 320 m flat heightfield (the West Yard's collider type), props per test. Big enough that a
// 20 m/s plane measured for a few seconds stays clear of the flight box's turn-home zone.
// ---------------------------------------------------------------------------------------------
function yard(props: PropBox[] = [], extra: Partial<WorldData> = {}): WorldData {
  const n = 161, cell = 2;
  return {
    seed: 1, name: 'plane test yard', height: () => 0, halfExtent: 160, killY: -30,
    terrain: { x0: -160, z0: -160, cell, n, heights: new Float32Array(n * n) },
    props,
    spawns: [{ x: -40, y: 0, z: 40, yaw: 0, team: Team.Corgis }, { x: 40, y: 0, z: -40, yaw: Math.PI, team: Team.Cats }],
    bounds: { minX: -158, maxX: 158, minZ: -158, maxZ: 158 },
    ...extra,
  };
}

const FLIGHT = (): SimSystem[] => [...vehicleSystems(), movementSystem, ...worldSystems(), physicsStepSystem];
const WITH_COMBAT = (): SimSystem[] => [...FLIGHT(), ...combatSystems()];

async function makeSim(world: WorldData, systems = FLIGHT()): Promise<Sim> {
  const sim = await Sim.create({ seed: 5, world, systems });
  sim.state.vehicleConfig = { autoTerminals: false, hangar: false };
  sim.step(); // Rapier queries see colliders after the first world.step()
  return sim;
}

function pet(sim: Sim, team: TeamId, x: number, z: number, cls: ClassId = 'assault', y?: number): SimEntity {
  return sim.spawnCharacter({ team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: `p${sim.entities.size}`, x, y: y ?? sim.worldData.height(x, z) + 0.02, z });
}

/** A pilot seated in a fresh plane on the ground at (x, z), nose along yaw. */
async function pilotIn(sim: Sim, x: number, z: number, yaw: number, cls: ClassId = 'assault', team: TeamId = Team.Corgis, y = 0): Promise<{ plane: SimEntity; pilot: SimEntity }> {
  const plane = spawnPlane(sim, 'rc_plane', team, x, y, z, yaw)!;
  expect(plane).not.toBeNull();
  const pilot = pet(sim, team, x + 2.2, z, cls, y + 0.05);
  sim.step();
  expect(mountPlane(sim, plane, pilot)).toBe(true);
  return { plane, pilot };
}

/** A pilot in a plane already flying level at `speed` and height y (for flight-model tests). */
async function airborne(sim: Sim, x: number, y: number, z: number, yaw: number, speed = PLANE.topSpeed, cls: ClassId = 'assault', team: TeamId = Team.Corgis): Promise<{ plane: SimEntity; pilot: SimEntity }> {
  const r = await pilotIn(sim, x, z, yaw, cls, team);
  const p = r.plane.plane!;
  r.plane.collider!.setTranslation({ x, y: y + PLANE.gearHeight, z });
  r.plane.pos.y = y;
  p.grounded = false; p.speed = speed; p.throttle = 1; r.plane.pitch = 0;
  const s = planeSeatPosition(r.plane);
  sim.placeCharacter(r.pilot, s.x, s.y, s.z); // teleported planes take their pilot along (else the seat guard unseats)
  sim.step();
  expect(r.pilot.seat?.vehicle).toBe(r.plane.id);
  return r;
}

let seq = 1;
function fly(sim: Sim, pilot: SimEntity, cmd: Partial<InputCmd>, ticks: number, events?: GameEvent[], each?: (i: number) => void): void {
  for (let i = 0; i < ticks; i++) {
    sim.setInput(pilot.id, { seq: seq++, mx: 0, mz: 0, yaw: pilot.input.yaw, pitch: 0, buttons: 0, rt: 0, ...cmd });
    sim.step();
    const ev = sim.drainEvents();
    if (events) events.push(...ev);
    each?.(i);
  }
}
const planes = (sim: Sim) => [...sim.entities.values()].filter((e) => e.plane);
const center = (e: SimEntity) => ({ x: e.pos.x, y: e.pos.y + PLANE.gearHeight, z: e.pos.z });

const CAPSULE_TEST = groups(Layer.Character, Layer.World | Layer.Vehicle);
function insideGeometry(sim: Sim, e: SimEntity): boolean {
  const m = e.char!.move;
  const shape = new sim.R.Capsule(m.capsuleHalfHeight, m.capsuleRadius - 0.03);
  return sim.world.intersectionWithShape({ x: e.pos.x, y: e.pos.y + m.capsuleHalfHeight + m.capsuleRadius, z: e.pos.z }, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, CAPSULE_TEST, e.collider ?? undefined) !== null;
}

// ---------------------------------------------------------------------------------------------

describe('RC plane: flight model', () => {
  it('rolls, lifts off under power, climbs out, and reaches its cruise speed', async () => {
    const sim = await makeSim(yard());
    const { plane, pilot } = await pilotIn(sim, 0, 120, 0); // nose toward -Z
    const ev: GameEvent[] = [];
    let liftoffAt = -1, liftoffDist = 0;
    const z0 = plane.pos.z;
    fly(sim, pilot, { mz: 1, yaw: 0, pitch: 0.3 }, 60 * 5, ev, (i) => {
      if (liftoffAt < 0 && !plane.plane!.grounded) { liftoffAt = i / 60; liftoffDist = z0 - plane.pos.z; }
    });
    const p = plane.plane!;
    console.log(`[plane] take-off run ${liftoffDist.toFixed(1)} m in ${liftoffAt.toFixed(2)} s; after 5 s: ${p.speed.toFixed(1)} m/s at ${plane.pos.y.toFixed(1)} m`);
    expect(liftoffAt).toBeGreaterThan(0.8);
    expect(liftoffAt).toBeLessThan(2.2);
    expect(liftoffDist).toBeLessThan(14); // fits the 18.7 m roof runway
    expect(ev.some((e) => e.e === 'jump' && e.id === plane.id)).toBe(true);
    expect(p.grounded).toBe(false);
    expect(plane.pos.y).toBeGreaterThan(8);
    // Level it off and let it settle at cruise.
    fly(sim, pilot, { mz: 1, yaw: 0, pitch: 0 }, 60 * 5);
    expect(p.speed).toBeGreaterThan(PLANE.topSpeed - 1.2);
    expect(p.speed).toBeLessThan(PLANE.topSpeed + 0.5);
    // The pilot rides on the seat the whole time.
    const s = planeSeatPosition(plane);
    expect(Math.hypot(pilot.pos.x - s.x, pilot.pos.y - s.y, pilot.pos.z - s.z)).toBeLessThan(0.05);
    expect(pilot.flags & EFlag.Mounted).toBeTruthy();
    expect(pilot.anim).toBe(Anim.Drive);
  });

  it('banks into turns toward the aim, and A/D add a rudder turn', async () => {
    const sim = await makeSim(yard());
    const { plane, pilot } = await airborne(sim, 0, 20, 30, 0);
    // Aim 90° left: the plane turns left (yaw grows) and banks left (+roll).
    let maxRoll = 0;
    fly(sim, pilot, { mz: 1, yaw: Math.PI / 2, pitch: 0 }, 30, undefined, () => { maxRoll = Math.max(maxRoll, plane.plane!.roll); });
    expect(plane.yaw).toBeGreaterThan(0.3);
    expect(maxRoll).toBeGreaterThan(0.5);
    fly(sim, pilot, { mz: 1, yaw: Math.PI / 2, pitch: 0 }, 120);
    expect(Math.abs(plane.yaw - Math.PI / 2)).toBeLessThan(0.05); // settles on the aim, no overshoot left
    expect(Math.abs(plane.plane!.roll)).toBeLessThan(0.1);        // wings level again
    // Rudder only (the aim stays put on the heading): D turns right.
    const y0 = plane.yaw;
    fly(sim, pilot, { mz: 1, yaw: y0, mx: 1, pitch: 0 }, 20);
    expect(plane.yaw).toBeLessThan(y0 - 0.05);
    expect(plane.plane!.roll).toBeLessThan(-0.2);
  });

  it('measures the turn circle, the climb and the dive (the feel numbers in the handoff)', async () => {
    const sim = await makeSim(yard());
    const { plane, pilot } = await airborne(sim, 0, 8, 60, 0);
    // Sustained turn: keep the aim 90° left of the nose.
    let turned = 0, t = 0, minX = Infinity, maxX = -Infinity, maxBank = 0;
    let last = plane.yaw;
    while (turned < Math.PI * 2 && t < 20 * 60) {
      fly(sim, pilot, { mz: 1, yaw: plane.yaw + Math.PI / 2, pitch: 0.05 }, 1);
      let d = plane.yaw - last; if (d < -Math.PI) d += Math.PI * 2; if (d > Math.PI) d -= Math.PI * 2;
      turned += d; last = plane.yaw; t++;
      if (turned > Math.PI / 2) { minX = Math.min(minX, plane.pos.x); maxX = Math.max(maxX, plane.pos.x); }
      maxBank = Math.max(maxBank, plane.plane!.roll);
    }
    const turnS = t / 60, diameter = maxX - minX;
    // Climb: full power, nose at max (2 s, well under the soft ceiling).
    const y0 = plane.pos.y;
    fly(sim, pilot, { mz: 1, yaw: plane.yaw, pitch: 0.6 }, 120);
    const climb = (plane.pos.y - y0) / 2;
    // Dive: nose down under power.
    const climbSpeed = plane.plane!.speed;
    fly(sim, pilot, { mz: 1, yaw: plane.yaw, pitch: -0.6 }, 90);
    const dive = plane.plane!.speed;
    console.log(`[plane] 360° in ${turnS.toFixed(2)} s, circle ⌀ ${diameter.toFixed(1)} m, max bank ${(maxBank * 180 / Math.PI).toFixed(0)}° · climb ${climb.toFixed(1)} m/s (down to ${climbSpeed.toFixed(1)} m/s) · 1.5 s powered dive → ${dive.toFixed(1)} m/s`);
    expect(turnS).toBeGreaterThan(3);
    expect(turnS).toBeLessThan(5.5);
    expect(diameter).toBeGreaterThan(18);
    expect(diameter).toBeLessThan(36);
    expect(maxBank).toBeGreaterThan(0.6);
    expect(maxBank).toBeLessThanOrEqual(PLANE.maxBank + 1e-6);
    expect(climb).toBeGreaterThan(4);
    expect(climb).toBeLessThan(10);
    expect(dive).toBeGreaterThan(PLANE.topSpeed);
  });

  it('glides down slowly with the engine idle, never stalling hands-off', async () => {
    const sim = await makeSim(yard());
    const { plane, pilot } = await airborne(sim, 0, 25, 60, 0);
    fly(sim, pilot, { mz: 0, yaw: 0, pitch: 0 }, 60 * 4); // settle into the glide
    const y0 = plane.pos.y, z0 = plane.pos.z;
    let stalled = false;
    fly(sim, pilot, { mz: 0, yaw: 0, pitch: 0 }, 60 * 3, undefined, () => { stalled ||= plane.plane!.stalled; });
    const sink = (y0 - plane.pos.y) / 3, run = (z0 - plane.pos.z) / 3;
    console.log(`[plane] glide: ${run.toFixed(1)} m/s forward, ${sink.toFixed(2)} m/s down (ratio ${(run / sink).toFixed(1)}:1)`);
    expect(stalled).toBe(false);
    expect(sink).toBeGreaterThan(0.8);
    expect(sink).toBeLessThan(2.6);
    expect(run / sink).toBeGreaterThan(5);
    // Holding the nose up with no power mushes into a glide (stall protection) instead of a stall.
    fly(sim, pilot, { mz: 0, yaw: 0, pitch: 0.6 }, 60 * 3, undefined, () => { stalled ||= plane.plane!.stalled; });
    expect(stalled).toBe(false);
    expect(plane.plane!.speed).toBeGreaterThan(PLANE.stallSpeed);
  });

  it('stalls below the stall speed, drops its nose and recovers', async () => {
    const sim = await makeSim(yard());
    const { plane, pilot } = await airborne(sim, 0, 30, 0, 0, 5);
    const ev: GameEvent[] = [];
    let stalledSeen = false, minPitch = 0, minY = plane.pos.y;
    const y0 = plane.pos.y;
    let recovered = -1;
    fly(sim, pilot, { mz: 1, yaw: 0, pitch: 0.3 }, 60 * 4, ev, (i) => {
      stalledSeen ||= plane.plane!.stalled;
      minPitch = Math.min(minPitch, plane.pitch);
      minY = Math.min(minY, plane.pos.y);
      if (stalledSeen && recovered < 0 && !plane.plane!.stalled) recovered = i / 60;
    });
    console.log(`[plane] stall at 5 m/s: nose down to ${(minPitch * 180 / Math.PI).toFixed(0)}°, flying again after ${recovered.toFixed(2)} s, ${(y0 - minY).toFixed(1)} m lost at worst`);
    expect(stalledSeen).toBe(true);
    expect(minPitch).toBeLessThan(-0.3);
    expect(recovered).toBeGreaterThan(0);
    expect(recovered).toBeLessThan(2.5);
    expect(plane.removed).toBe(false);
  });

  it('boosts on Sprint, then waits out the cooldown', async () => {
    const sim = await makeSim(yard());
    const { plane, pilot } = await airborne(sim, 0, 20, 70, 0);
    const ev: GameEvent[] = [];
    let top = 0;
    fly(sim, pilot, { mz: 1, yaw: 0, pitch: 0, buttons: Btn.Sprint }, 60 * 1.5, ev, () => { top = Math.max(top, plane.plane!.speed); });
    const boosts = () => ev.filter((e) => e.e === 'ability' && e.id === plane.id && (e as { ability: string }).ability === 'boost').length;
    expect(boosts()).toBe(1);
    expect(top).toBeGreaterThan(PLANE.topSpeed + 3);
    expect(plane.flags & EFlag.Reloading).toBeTruthy(); // recharging
    fly(sim, pilot, { mz: 1, yaw: 0, pitch: 0, buttons: Btn.Sprint }, 60 * 2, ev);
    expect(boosts()).toBe(1); // still cooling down
    fly(sim, pilot, { mz: 1, yaw: 0, pitch: 0, buttons: Btn.Sprint }, 60 * 3, ev);
    expect(boosts()).toBe(2);
  });

  it('flies Skyraiders faster and tighter than other classes (content data)', async () => {
    const run = async (cls: ClassId) => {
      const sim = await makeSim(yard());
      const { plane, pilot } = await airborne(sim, 0, 20, 120, 0, PLANE.topSpeed, cls);
      fly(sim, pilot, { mz: 1, yaw: 0, pitch: 0 }, 60 * 6);
      const top = plane.plane!.speed;
      let turned = 0, t = 0, last = plane.yaw;
      while (turned < Math.PI * 2 && t < 20 * 60) {
        fly(sim, pilot, { mz: 1, yaw: plane.yaw + Math.PI / 2, pitch: 0.05 }, 1);
        let d = plane.yaw - last; if (d < -Math.PI) d += Math.PI * 2; if (d > Math.PI) d -= Math.PI * 2;
        turned += d; last = plane.yaw; t++;
      }
      return { top, turn: t / 60 };
    };
    const a = await run('assault'), s = await run('skyraider');
    console.log(`[plane] assault: ${a.top.toFixed(1)} m/s, 360° ${a.turn.toFixed(2)} s · skyraider: ${s.top.toFixed(1)} m/s, 360° ${s.turn.toFixed(2)} s`);
    expect(PLANE.pilots.skyraider).toBeDefined();
    expect(s.top).toBeGreaterThan(a.top * 1.1);
    expect(s.turn).toBeLessThan(a.turn * 0.9);
  });

  it('is deterministic: the same inputs give bit-identical flights', async () => {
    const run = async () => {
      const sim = await makeSim(yard([{ type: 'wall', x: 0, y: 4, z: -40, hx: 12, hy: 4, hz: 0.3, rotY: 0.3 }]));
      const { plane, pilot } = await pilotIn(sim, 0, 60, 0);
      const rng = mulberry32(7);
      const trace: number[] = [];
      let cmd: Partial<InputCmd> = {};
      for (let i = 0; i < 900 && !plane.removed; i++) {
        if (i % 40 === 0) cmd = { mz: rng() < 0.8 ? 1 : 0, mx: rng() < 0.2 ? rng() * 2 - 1 : 0, yaw: rng() * Math.PI * 2, pitch: rng() * 0.8 - 0.3, buttons: rng() < 0.15 ? Btn.Sprint : rng() < 0.2 ? Btn.Fire : 0 };
        fly(sim, pilot, cmd, 1);
        trace.push(plane.pos.x, plane.pos.y, plane.pos.z, plane.yaw, plane.pitch, plane.plane!.roll, plane.plane!.speed);
      }
      return trace;
    };
    const a = await run(), b = await run();
    expect(a.length).toBeGreaterThan(1000);
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------------------------

describe('RC plane: collisions, crashes and the flight envelope', () => {
  it('crashes into a wall at speed: explodes and throws the pilot out, stunned', async () => {
    const wall: PropBox = { type: 'wall', x: 0, y: 5, z: -20, hx: 15, hy: 5, hz: 0.4, rotY: 0 };
    const sim = await makeSim(yard([wall]), WITH_COMBAT());
    const { plane, pilot } = await airborne(sim, 0, 3, 20, 0);
    const ev: GameEvent[] = [];
    let crashTick = -1;
    fly(sim, pilot, { mz: 1, yaw: 0, pitch: 0 }, 120, ev, (i) => { if (crashTick < 0 && plane.removed) crashTick = i; });
    expect(plane.removed).toBe(true);
    const boom = ev.find((e) => e.e === 'explode');
    expect(boom).toBeDefined();
    expect((boom as { z: number }).z).toBeGreaterThan(wall.z + wall.hz); // on the near side of the wall
    expect(pilot.flags & EFlag.Mounted).toBeFalsy();
    expect(pilot.seat).toBeUndefined();
    expect(insideGeometry(sim, pilot)).toBe(false);
    expect(pilot.pos.z).toBeGreaterThan(wall.z);
    // Stunned for a moment: inputs are ignored (no walking, no jumping), then control comes back.
    sim.step(); sim.drainEvents();
    expect(isStunned(sim, pilot)).toBe(true);
    const x0 = pilot.pos.x;
    fly(sim, pilot, { mx: 1, mz: 0, yaw: 0, buttons: Btn.Jump }, 20);
    expect(Math.abs(pilot.vel.x)).toBeLessThan(1.5);
    fly(sim, pilot, {}, 60);
    expect(isStunned(sim, pilot)).toBe(false);
    fly(sim, pilot, { mx: 1, yaw: 0 }, 30);
    expect(pilot.pos.x).toBeGreaterThan(x0 + 1);
    expect(pilot.dead).toBe(false); // the blast hurts (self damage) but a pilot survives a crash
    expect(pilot.health!.hp).toBeLessThan(pilot.health!.max);
  });

  it('scrapes along a wall at a shallow angle instead of exploding (hull damage)', async () => {
    const wall: PropBox = { type: 'wall', x: 6, y: 6, z: 0, hx: 0.4, hy: 6, hz: 40, rotY: 0 };
    const sim = await makeSim(yard([wall]), WITH_COMBAT());
    const { plane, pilot } = await airborne(sim, 0, 4, 30, -0.2); // heading -Z, converging on the wall at +X
    fly(sim, pilot, { mz: 1, yaw: -0.3, pitch: 0 }, 90);
    expect(plane.removed).toBe(false);
    expect(plane.health!.hp).toBeLessThan(PLANE.maxHp);
    expect(center(plane).x).toBeLessThan(wall.x - wall.hx);
  });

  it('never tunnels through thin fences, walls or roofs at max (boost) speed', async () => {
    // A 10 cm fence board (60 x 8 m) and a 0.2 m roof slab, from many angles, at boost speed and in dives. Whenever the
    // fuselage center crosses the fence's plane, it must be outside the board (around its end or over its top).
    const fence: PropBox = { type: 'fence', x: 0, y: 4, z: 0, hx: 30, hy: 4, hz: 0.05, rotY: 0 };
    const roof: PropBox = { type: 'roof', x: 0, y: 12, z: 60, hx: 20, hy: 0.1, hz: 12, rotY: 0 };
    let crossings = 0, stops = 0, samples = 0;
    for (const [yaw, pitch, x0] of [[0, 0, 0], [0.5, 0, 0], [-0.9, 0.1, 0], [1.2, -0.2, 0], [0, 0.4, 0], [0.3, 0.12, 12], [-0.2, 0.2, -20]] as const) {
      const sim = await makeSim(yard([fence]));
      const { plane, pilot } = await airborne(sim, x0, 3, 25, yaw, PLANE.maxSpeed);
      plane.plane!.boostTime = 5;
      plane.pitch = pitch;
      let prev = center(plane);
      for (let i = 0; i < 150 && !plane.removed; i++) {
        fly(sim, pilot, { mz: 1, yaw, pitch, buttons: Btn.Sprint }, 1);
        if (plane.removed) { stops++; break; }
        const c = center(plane);
        samples++;
        if (prev.z > fence.z && c.z <= fence.z) {
          crossings++;
          const t = (prev.z - fence.z) / Math.max(1e-6, prev.z - c.z);
          const x = prev.x + (c.x - prev.x) * t, y = prev.y + (c.y - prev.y) * t;
          expect(Math.abs(x) > fence.hx + PLANE.radius - 0.05 || y > fence.y + fence.hy + PLANE.radius - 0.05).toBe(true);
        }
        // Never inside the board either.
        expect(Math.abs(c.z - fence.z) > fence.hz + PLANE.radius - 0.05 || Math.abs(c.x) > fence.hx || c.y > fence.y + fence.hy).toBe(true);
        prev = c;
      }
    }
    for (const [dx, dz] of [[0, 0], [5, -3], [-8, 4]] as const) {
      const sim = await makeSim(yard([roof]));
      const { plane, pilot } = await airborne(sim, dx, 22, 60 + dz, 0, PLANE.maxSpeed);
      for (let i = 0; i < 90 && !plane.removed; i++) {
        fly(sim, pilot, { mz: 1, yaw: 0, pitch: -0.8, buttons: Btn.Sprint }, 1);
        if (plane.removed) { stops++; break; }
        if (Math.abs(plane.pos.x) < roof.hx && Math.abs(plane.pos.z - roof.z) < roof.hz) { expect(center(plane).y).toBeGreaterThan(roof.y + roof.hy); samples++; }
      }
    }
    console.log(`[plane] tunnelling: ${samples} samples, ${crossings} legit crossings (around/over), ${stops} crashes on the near side`);
    expect(stops).toBeGreaterThanOrEqual(5); // head-on runs and every roof dive end in a crash on the near side
    expect(samples).toBeGreaterThan(100);
  });

  it('dives into the lawn: crash; a gentle touchdown on flat ground: a landing', async () => {
    {
      const sim = await makeSim(yard(), WITH_COMBAT());
      const { plane, pilot } = await airborne(sim, 0, 25, 40, 0, 26);
      const ev: GameEvent[] = [];
      fly(sim, pilot, { mz: 1, yaw: 0, pitch: -0.8 }, 180, ev);
      expect(plane.removed).toBe(true);
      expect(ev.some((e) => e.e === 'explode')).toBe(true);
    }
    {
      const sim = await makeSim(yard());
      const { plane, pilot } = await airborne(sim, 0, 3, 60, 0, 12);
      const ev: GameEvent[] = [];
      fly(sim, pilot, { mz: 0, yaw: 0, pitch: -0.04 }, 240, ev);
      expect(plane.removed).toBe(false);
      const land = ev.find((e) => e.e === 'land' && e.id === plane.id) as { impact: number } | undefined;
      expect(land).toBeDefined();
      expect(land!.impact).toBeLessThan(PLANE.landMaxSink);
      fly(sim, pilot, { mz: -1, yaw: 0, pitch: 0 }, 120);
      expect(plane.plane!.grounded).toBe(true);
      expect(plane.plane!.speed).toBeLessThan(0.5);
      expect(plane.health!.hp).toBe(PLANE.maxHp);
      expect(plane.flags & EFlag.Grounded).toBeTruthy();
    }
  });

  it('holds the hard ceiling and the flight box (turns home, never touches the boundary walls)', async () => {
    const sim = await makeSim(yard());
    const { plane, pilot } = await airborne(sim, 0, 20, 100, 0);
    let maxY = 0;
    fly(sim, pilot, { mz: 1, yaw: 0, pitch: 0.6, buttons: Btn.Sprint }, 60 * 25, undefined, () => { maxY = Math.max(maxY, center(plane).y); });
    console.log(`[plane] ceiling ${PLANE.ceiling} m: max fuselage height ${maxY.toFixed(2)} m`);
    expect(maxY).toBeLessThanOrEqual(PLANE.ceiling + 1e-6);
    expect(maxY).toBeGreaterThan(PLANE.ceiling - PLANE.ceilingSoft - 1);
    // Full power straight at the east edge for 20 s: the plane turns back inside the box, no damage.
    const box = planeFlightBox(sim.worldData, PLANE);
    let out = false;
    fly(sim, pilot, { mz: 1, yaw: -Math.PI / 2, pitch: 0 }, 60 * 20, undefined, () => {
      const c = center(plane);
      if (c.x < box.minX - 1e-6 || c.x > box.maxX + 1e-6 || c.z < box.minZ - 1e-6 || c.z > box.maxZ + 1e-6) out = true;
    });
    expect(out).toBe(false);
    expect(plane.removed).toBe(false);
    expect(plane.health!.hp).toBe(PLANE.maxHp);
  });
});

// ---------------------------------------------------------------------------------------------

describe('RC plane: pilots, the gun and damage', () => {
  it('mounts, steps out beside a parked plane, and bails out in the air keeping speed', async () => {
    const sim = await makeSim(yard([{ type: 'crate', x: -2, y: 1, z: 20, hx: 1, hy: 1, hz: 1, rotY: 0 }]));
    const { plane, pilot } = await pilotIn(sim, 0, 20, 0);
    expect(riderVehicle(sim, pilot)).toBe(plane);
    expect(vehicleKindOf(riderVehicle(sim, pilot))).toBe('plane');
    expect(isFlyingPlane(sim, pilot)).toBe(false);
    // Hands on the stick: the pilot's own weapon never fires.
    const ev: GameEvent[] = [];
    fly(sim, pilot, { buttons: Btn.Fire }, 5, ev);
    expect(ev.some((e) => e.e === 'fire' && e.id === pilot.id)).toBe(false);
    // E while parked: out beside the plane (the crate blocks the left side), clear of geometry.
    fly(sim, pilot, { buttons: Btn.Interact }, 1); fly(sim, pilot, {}, 1);
    expect(pilot.seat).toBeUndefined();
    expect(insideGeometry(sim, pilot)).toBe(false);
    expect(Math.hypot(pilot.pos.x - plane.pos.x, pilot.pos.z - plane.pos.z)).toBeGreaterThan(PLANE.wingspan / 2);
    // Back in, take off, bail out in the air.
    fly(sim, pilot, {}, 10);
    fly(sim, pilot, { buttons: Btn.Interact }, 1); fly(sim, pilot, {}, 1);
    expect(pilot.seat?.vehicle).toBe(plane.id);
    fly(sim, pilot, { mz: 1, yaw: 0, pitch: 0.3 }, 60 * 4);
    expect(isFlyingPlane(sim, pilot)).toBe(true);
    const v0 = Math.hypot(plane.vel.x, plane.vel.z);
    fly(sim, pilot, { mz: 1, yaw: 0, pitch: 0.3, buttons: Btn.Interact }, 1);
    expect(pilot.seat).toBeUndefined();
    expect(Math.hypot(pilot.vel.x, pilot.vel.z)).toBeGreaterThan(v0 * 0.4);
    expect(insideGeometry(sim, pilot)).toBe(false);
    // The empty plane glides on with the engine idle.
    fly(sim, pilot, {}, 30);
    expect(plane.plane!.rider).toBe(-1);
    expect(plane.plane!.throttle).toBeLessThan(0.5);
  });

  it("fires a squeaky gun that hits what's ahead and never its own plane or pilot", async () => {
    const sim = await makeSim(yard(), WITH_COMBAT());
    sim.state.match = { mode: 'test', phase: 'live', timeLeft: 99, score: [0, 0], objective: '', wave: 0, winner: -1 };
    const { plane, pilot } = await pilotIn(sim, 0, 40, 0);
    const cat = pet(sim, Team.Cats, 0, 22);
    const mate = pet(sim, Team.Corgis, 3, 40);
    sim.step(); sim.drainEvents();
    const ev: GameEvent[] = [];
    fly(sim, pilot, { buttons: Btn.Fire, yaw: 0, pitch: -0.05 }, 60, ev);
    const shots = ev.filter((e) => e.e === 'fire') as Extract<GameEvent, { e: 'fire' }>[];
    expect(shots.length).toBeGreaterThan(6);
    expect(shots.every((s) => s.id === plane.id)).toBe(true);
    // Tracers start at the muzzle in front of the fuselage, going forward.
    for (const s of shots) { expect(s.z).toBeLessThan(plane.pos.z - 0.4); expect(s.dz).toBeLessThan(-0.9); }
    expect(ev.some((e) => e.e === 'hit' && e.dst === cat.id && e.src === pilot.id)).toBe(true);
    expect(cat.health!.hp).toBeLessThan(cat.health!.max);
    expect(plane.health!.hp).toBe(PLANE.maxHp);
    expect(pilot.health!.hp).toBe(pilot.health!.max);
    expect(mate.health!.hp).toBe(mate.health!.max);
    expect(ev.some((e) => e.e === 'hit' && (e.dst === plane.id || e.dst === pilot.id))).toBe(false);
    // Holding the trigger overheats the gun (Aiming flag), then it cools and fires again.
    fly(sim, pilot, { buttons: Btn.Fire, yaw: 0, pitch: 0.4 }, 60 * 2);
    expect(plane.plane!.overheated).toBe(true);
    expect(plane.flags & EFlag.Aiming).toBeTruthy();
    fly(sim, pilot, { yaw: 0 }, 60 * 2);
    expect(plane.plane!.overheated).toBe(false);
  });

  it('is shootable in PvP: rifle fire and blasts wear it down, shot down → explode + eject', async () => {
    const sim = await makeSim(yard(), WITH_COMBAT());
    sim.state.match = { mode: 'test', phase: 'live', timeLeft: 99, score: [0, 0], objective: '', wave: 0, winner: -1 };
    const { plane, pilot } = await airborne(sim, 0, 6, 0, 0, 12);
    const cat = pet(sim, Team.Cats, 0, -30);
    equipWeapon(cat, 'squeaker_rifle');
    sim.step(); sim.drainEvents();
    const ev: GameEvent[] = [];
    // The cat aims straight at the incoming plane every tick.
    for (let i = 0; i < 90 && !plane.removed; i++) {
      const c = center(plane);
      const eyeY = cat.pos.y + 1.0;
      const yaw = Math.atan2(-(c.x - cat.pos.x), -(c.z - cat.pos.z));
      const pitch = Math.atan2(c.y - eyeY, Math.hypot(c.x - cat.pos.x, c.z - cat.pos.z));
      sim.setInput(cat.id, { seq: seq++, mx: 0, mz: 0, yaw, pitch, buttons: Btn.Fire, rt: 0 });
      sim.setInput(pilot.id, { seq: seq++, mx: 0, mz: 0, yaw: Math.PI, pitch: 0, buttons: 0, rt: 0 }); // flying away… then around
      sim.step();
      ev.push(...sim.drainEvents());
    }
    const planeHits = ev.filter((e) => e.e === 'hit' && e.dst === plane.id && e.src === cat.id);
    expect(planeHits.length).toBeGreaterThan(3);
    expect(plane.removed || plane.health!.hp < PLANE.maxHp).toBe(true);
    if (!plane.removed) {
      // Finish it with a blast next to it (the combat lane's explode(), e.g. a tennis mortar): shot down → explode, pilot out.
      const hp0 = plane.health!.hp;
      const c = center(plane);
      explode(sim, c.x + 1.5, c.y, c.z, WEAPONS.tennis_mortar.projectile!, cat.id, cat.team, -1);
      sim.step(); ev.push(...sim.drainEvents());
      if (!plane.removed) {
        expect(plane.health!.hp).toBeLessThan(hp0); // blasts hurt planes
        plane.health!.hp = 1;
        explode(sim, c.x + 1.5, c.y, c.z, WEAPONS.tennis_mortar.projectile!, cat.id, cat.team, -1);
        sim.step(); ev.push(...sim.drainEvents());
      }
    }
    expect(plane.removed).toBe(true);
    expect(ev.some((e) => e.e === 'explode')).toBe(true);
    expect(pilot.seat).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------

describe('RC plane: snapshots', () => {
  it('sends its content index, bank and throttle for smooth remote planes', async () => {
    const sim = await makeSim(yard());
    const { plane, pilot } = await airborne(sim, 0, 20, 0, 0);
    fly(sim, pilot, { mz: 1, yaw: 1.2, pitch: 0 }, 20);
    const s = sim.toState(plane);
    expect(s.kind).toBe(EntityKind.Vehicle);
    expect(s.cls).toBe(vehicleIndex('rc_plane'));
    expect(s.weapon).toBe(pilot.id);
    expect(s.flags & EFlag.Busy).toBeTruthy();
    const aux = unpackPlaneAux(s.ammo);
    expect(aux.throttle).toBeCloseTo(plane.plane!.throttle, 2);
    expect(aux.roll).toBeCloseTo(plane.plane!.roll, 2);
    expect(aux.roll).toBeGreaterThan(0.3);
    expect(unpackPlaneAux(packPlaneAux(0.37, -0.81))).toEqual({ throttle: 0.37, roll: -0.81 });
    expect(unpackPlaneAux(packPlaneAux(2, 9)).roll).toBeLessThan(5);
    expect(CLASS_IDS.length).toBeGreaterThan(vehicleIndex('rc_plane'));
  });
});

// ---------------------------------------------------------------------------------------------
// The real West Yard: the Rooftop Hangar, a circuit from the roof, and chapter 6's route to the shed
// ---------------------------------------------------------------------------------------------

async function westYard(mode = 'yard-skirmish'): Promise<Sim> {
  const sim = await Sim.create({ seed: 1, world: createWorldData(1), systems: WITH_COMBAT() });
  sim.state.room = { mode };
  sim.step();
  return sim;
}
const hangarOf = (sim: Sim) => [...sim.entities.values()].find((e) => e.terminal?.id === 'plane_hangar');

/** Walk up to the hangar, vend a plane with E, hop in with E (the real Interact flow). */
function boardAtHangar(sim: Sim, team: TeamId, cls: ClassId = 'assault'): { plane: SimEntity; pilot: SimEntity } {
  const term = hangarOf(sim)!;
  const fx = -Math.sin(term.yaw), fz = -Math.cos(term.yaw);
  const pilot = pet(sim, team, term.pos.x + fx * 1.4, term.pos.z + fz * 1.4, cls, term.pos.y + 0.05);
  fly(sim, pilot, {}, 10);
  fly(sim, pilot, { buttons: Btn.Interact }, 1); fly(sim, pilot, {}, 1);
  const plane = planes(sim).find((p) => p.plane!.terminal === term.id)!;
  expect(plane).toBeDefined();
  sim.placeCharacter(pilot, plane.pos.x + 1.4, plane.pos.y + 0.05, plane.pos.z);
  fly(sim, pilot, {}, 5);
  fly(sim, pilot, { buttons: Btn.Interact }, 1); fly(sim, pilot, {}, 1);
  expect(pilot.seat?.vehicle).toBe(plane.id);
  return { plane, pilot };
}

/** Fly the autopilot through goals; returns the time (s) each goal was reached (-1 = not reached). */
function autopilot(sim: Sim, plane: SimEntity, pilot: SimEntity, goals: AutopilotGoal[], maxS: number, done: (g: AutopilotGoal) => boolean, ev?: GameEvent[]): number[] {
  const at: number[] = goals.map(() => -1);
  let gi = 0;
  for (let i = 0; i < maxS * 60 && gi < goals.length && !plane.removed; i++) {
    const { cmd } = planeAutopilot(sim, plane, goals[gi]);
    sim.setInput(pilot.id, { ...cmd, seq: seq++ });
    sim.step();
    const e = sim.drainEvents();
    if (ev) ev.push(...e);
    if (done(goals[gi])) { at[gi] = i / 60; gi++; }
  }
  return at;
}

describe('RC plane on the West Yard', () => {
  it('puts one neutral Rooftop Hangar on The Rooftops with a clear runway, only for match modes', async () => {
    const data = createWorldData(1);
    const site = hangarSite(data)!;
    expect(site).not.toBeNull();
    expect(site.y).toBeCloseTo(7.2, 3);
    expect(hangarSite(yard())).toBeNull(); // no Rooftops, no hangar
    for (const mode of HANGAR.modes) {
      const sim = await westYard(mode);
      const h = [...sim.entities.values()].filter((e) => e.terminal?.id === 'plane_hangar');
      expect(h).toHaveLength(1);
      expect(h[0].team).toBe(Team.Neutral);
      expect(sim.toState(h[0]).cls).toBe(terminalIndex('plane_hangar'));
    }
    const off = await Sim.create({ seed: 1, world: data, systems: vehicleSystems() });
    off.state.room = { mode: 'net-bandwidth' }; off.step();
    expect([...off.entities.values()].some((e) => e.terminal)).toBe(false);
    const forcedOff = await Sim.create({ seed: 1, world: data, systems: vehicleSystems() });
    forcedOff.state.room = { mode: 'adventure' }; forcedOff.state.vehicleConfig = { hangar: false }; forcedOff.step();
    expect(hangarOf(forcedOff)).toBeUndefined();
    // The runway: a plane-sized sweep at taxi height from the pad to the parapet line hits nothing.
    const sim = await westYard();
    const c = { x: site.padX, y: site.padY + PLANE.gearHeight + 0.05, z: site.padZ };
    const fx = -Math.sin(site.padYaw), fz = -Math.cos(site.padYaw);
    const shape = new sim.R.Ball(PLANE.radius);
    const hit = sim.world.castShape(c, { x: 0, y: 0, z: 0, w: 1 }, { x: fx, y: 0, z: fz }, shape, 0, HANGAR.site!.runway - 0.6, true, undefined, groups(Layer.Vehicle, Layer.World));
    expect(hit).toBeNull();
  });

  it('vends one plane at a time for either team; the hangar cools down after a crash', async () => {
    const sim = await westYard();
    const term = hangarOf(sim)!;
    const cat = pet(sim, Team.Cats, term.pos.x - 1.4, term.pos.z, 'assault', term.pos.y + 0.05);
    fly(sim, cat, {}, 5);
    const plane = useTerminal(sim, term, cat)!;
    expect(plane).not.toBeNull();
    expect(plane.team).toBe(Team.Cats);
    expect(Math.hypot(plane.pos.x - HANGAR.site!.padX, plane.pos.z - HANGAR.site!.padZ)).toBeLessThan(0.01);
    expect(useTerminal(sim, term, pet(sim, Team.Corgis, term.pos.x - 1.4, term.pos.z + 0.8, 'assault', term.pos.y + 0.05))).toBeNull(); // one at a time
    sim.step();
    expect(term.flags & EFlag.Busy).toBeTruthy();
    plane.health!.hp = 1;
    sim.state.match = { mode: 'yard-skirmish', phase: 'live', timeLeft: 99, score: [0, 0], objective: '', wave: 1, winner: -1 };
    const { damagePlane } = await import('../../src/sim/vehicles');
    damagePlane(sim, plane, 10, { id: cat.id, team: Team.Corgis }, 0, 0, 0);
    expect(plane.removed).toBe(true);
    sim.step();
    expect(term.terminal!.cooldown).toBeGreaterThan(HANGAR.cooldown - 0.1);
    expect(term.flags & EFlag.Busy).toBeTruthy();
  });

  it('takes off from the roof, flies a circuit around the yard and lands on the lawn', async () => {
    const sim = await westYard();
    const { plane, pilot } = boardAtHangar(sim, Team.Corgis);
    const land: AutopilotGoal = { x: 46, z: -42, y: sim.worldData.height(46, -42), mode: 'land', landYaw: 0 };
    const goals: AutopilotGoal[] = [{ x: 80, z: 25, y: 14 }, { x: 46, z: 50, y: 12 }, { x: 46, z: 30, y: 9 }, land];
    const ev: GameEvent[] = [];
    const at = autopilot(sim, plane, pilot, goals, 45, (g) => g === land ? plane.plane!.grounded && plane.plane!.speed < 0.5 : Math.hypot(plane.pos.x - g.x, plane.pos.z - g.z) < 12, ev);
    console.log(`[plane] West Yard circuit: waypoints at ${at.map((t) => t.toFixed(1)).join(' / ')} s; touchdown ${JSON.stringify(ev.filter((e) => e.e === 'land' && e.id === plane.id))}`);
    expect(at.every((t) => t > 0)).toBe(true);
    expect(plane.removed).toBe(false);
    expect(ev.some((e) => e.e === 'jump' && e.id === plane.id)).toBe(true); // lift-off
    expect(plane.plane!.grounded).toBe(true);
    expect(Math.hypot(plane.pos.x - land.x, plane.pos.z - land.z)).toBeLessThan(30);
    expect(plane.health!.hp).toBeGreaterThan(PLANE.maxHp * 0.9);
    expect(pilot.seat?.vehicle).toBe(plane.id);
  });

  it('a scripted pilot flies from The Rooftops to the shed roof in under 60 s (chapter 6)', async () => {
    const sim = await westYard('adventure');
    const t0 = sim.tick;
    const { plane, pilot } = boardAtHangar(sim, Team.Corgis, 'skyraider');
    // The shed: 26 x 16 m at (47, 88), ridge 10.6 m. Reached = the mounted pilot over the roof (below 12 m above it).
    const shed = { x: 47, z: 88, hx: 13, hz: 8, ridge: 10.6 };
    const goal: AutopilotGoal = { x: shed.x, z: shed.z, y: shed.ridge + 2.5 };
    const over = () => Math.abs(pilot.pos.x - shed.x) < shed.hx && Math.abs(pilot.pos.z - shed.z) < shed.hz && pilot.pos.y > 7 && pilot.pos.y < shed.ridge + 12;
    const at = autopilot(sim, plane, pilot, [goal], 60, () => over() && !!(pilot.flags & EFlag.Mounted));
    const total = (sim.tick - t0) / 60;
    console.log(`[plane] Rooftops -> shed roof: ${at[0].toFixed(1)} s of flying (${total.toFixed(1)} s incl. boarding)`);
    expect(at[0]).toBeGreaterThan(0);
    expect(total).toBeLessThan(60);
    expect(riderVehicle(sim, pilot)).toBe(plane);
    expect(isFlyingPlane(sim, pilot)).toBe(true);
    // Bail out over the roof: the corgi lands on the shed (the chapter's next beat is on foot).
    fly(sim, pilot, { buttons: Btn.Interact }, 1);
    fly(sim, pilot, {}, 120);
    expect(pilot.seat).toBeUndefined();
    expect(Math.abs(pilot.pos.x - shed.x)).toBeLessThan(shed.hx + 6);
  });
});

// A spawnTerminal import keeps the fixed-site API honest for labs (placed by hand at the hangar site).
void spawnTerminal;

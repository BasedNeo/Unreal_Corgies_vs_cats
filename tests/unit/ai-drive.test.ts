// B2a: bots drive karts — the kart driver (src/sim/ai/drive.ts) and the vehicle tactics (tactics.ts vehicleThink).
// These tests need no brain hook: the driver-only ones call driveKart() for a seated pet; the tactics ones run the bots
// through a test AI system that gives vehicleThink the tick first and runs the brain's think() when it declines (the
// same hand-over the brain hook makes after perception; tests/unit/ai-drive-brain.test.ts runs the real brain hook).
import { describe, it, expect } from 'vitest';
import { Sim, type SimSystem } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { EFlag, EntityKind, Species, Team, type ClassId, type TeamId } from '../../src/shared/types';
import type { WorldData } from '../../src/shared/world/world-data';
import type { PropBox } from '../../src/shared/world/world-types';
import type { GameEvent } from '../../src/shared/protocol';
import { TICK_HZ } from '../../src/shared/constants';
import { VEHICLES } from '../../src/shared/content/vehicles';
import { mulberry32 } from '../../src/shared/rng';
import { angleDelta } from '../../src/shared/math';
import { createWorldData } from '../../src/shared/world/world-data';
import { createDefaultSystems } from '../../src/sim/systems';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem } from '../../src/sim/systems/core';
import { worldSystems } from '../../src/sim/world/systems';
import { vehicleSystems, spawnKart, mountKart, spawnTerminal, findTerminalSite } from '../../src/sim/vehicles';
import { groups, Layer } from '../../src/sim/rapier';
import { ensureBrain, isAiControlled, think } from '../../src/sim/ai/brain';
import { navGridFor, cellX, cellZ, type NavGrid } from '../../src/sim/ai/nav';
import { vehicleThink } from '../../src/sim/ai/tactics';
import {
  controlsToInput, createDriver, driveKart, driveLineClear, kartNavFor, nearestDrivable, type DriveGoal, type KartControls,
} from '../../src/sim/ai/drive';

const DT = 1 / TICK_HZ;

/** 160 m flat heightfield test yard (the West Yard's collider type), props per test. */
function yard(props: PropBox[] = []): WorldData {
  const n = 81, cell = 2;
  return {
    seed: 1, name: 'drive test yard', height: () => 0, halfExtent: 80, killY: -30, props,
    terrain: { x0: -80, z0: -80, cell, n, heights: new Float32Array(n * n) },
    spawns: [
      { x: -40, y: 0, z: 40, yaw: 0, team: Team.Corgis }, { x: -34, y: 0, z: 42, yaw: 0, team: Team.Corgis },
      { x: 40, y: 0, z: -40, yaw: Math.PI, team: Team.Cats }, { x: 34, y: 0, z: -42, yaw: Math.PI, team: Team.Cats },
    ],
    bounds: { minX: -78, maxX: 78, minZ: -78, maxZ: 78 },
  } as WorldData;
}

/** A wall box from (x0, z0) to (x1, z1) (axis-aligned), 3 m tall. */
function wall(x0: number, z0: number, x1: number, z1: number): PropBox {
  return { type: 'wall', x: (x0 + x1) / 2, y: 1.5, z: (z0 + z1) / 2, hx: Math.abs(x1 - x0) / 2, hy: 1.5, hz: Math.abs(z1 - z0) / 2, rotY: 0 };
}

/** The test AI system: vehicleThink gets each bot's tick first; the brain's think() runs when it declines. */
function hookedAi(): SimSystem {
  const ctx = { grid: null as NavGrid | null, chars: [] as SimEntity[], pathBudget: 0 };
  return {
    name: 'ai', order: 100,
    update(sim, dt) {
      if (!ctx.grid && sim.tick >= 1) ctx.grid = navGridFor(sim);
      ctx.pathBudget = 2;
      ctx.chars.length = 0;
      for (const e of sim.entities.values()) if (e.char && !e.dead) ctx.chars.push(e);
      for (const e of sim.entities.values()) {
        if (!isAiControlled(e)) continue;
        const ai = ensureBrain(e);
        if (!e.dead && ctx.grid && vehicleThink(sim, e, ai, ctx, e.input, dt)) { e.input.seq = ++ai.seq; continue; }
        think(sim, e, ai, ctx, dt);
      }
    },
  };
}

const withHookedAi = (): SimSystem[] => createDefaultSystems().map((s) => (s.name === 'ai' ? hookedAi() : s));
const vehicleOnly = (): SimSystem[] => [...vehicleSystems(), movementSystem, ...worldSystems(), physicsStepSystem];

async function makeSim(world: WorldData, systems: SimSystem[], seed = 5): Promise<Sim> {
  const sim = await Sim.create({ seed, world, systems });
  sim.state.vehicleConfig = { autoTerminals: false, hangar: false };
  sim.step();
  sim.drainEvents();
  return sim;
}

function pet(sim: Sim, team: TeamId, x: number, z: number, opts: { bot?: boolean; cls?: ClassId; yaw?: number } = {}): SimEntity {
  return sim.spawnCharacter({
    kind: opts.bot ? EntityKind.Bot : EntityKind.Player, team, species: team === Team.Cats ? Species.Cat : Species.Corgi,
    cls: opts.cls ?? 'assault', name: `p${sim.entities.size}`, x, y: sim.worldData.height(x, z) + 0.02, z, yaw: opts.yaw ?? 0,
  });
}

/** A seated pet driven by driveKart() alone (no brain): one tick. */
function driverTick(sim: Sim, rider: SimEntity, kart: SimEntity, drv: ReturnType<typeof createDriver>, goal: DriveGoal, grid: NavGrid, ctrl: KartControls, seq: { n: number }) {
  const st = driveKart(sim, kart, drv, goal, grid, { pathBudget: 2 }, ctrl);
  const cmd = { seq: ++seq.n, mx: 0, mz: 0, yaw: kart.yaw, pitch: 0, buttons: 0, rt: 0 };
  controlsToInput(ctrl, cmd);
  sim.setInput(rider.id, cmd);
  sim.step();
  sim.drainEvents();
  return st;
}

/** A patrolling bot with a goal (the brain's own patrol goal fields). */
function sendTo(e: SimEntity, x: number, z: number): void {
  const ai = ensureBrain(e);
  ai.mode = 'patrol'; ai.hasGoal = true; ai.goalX = x; ai.goalZ = z;
}

describe('kart driver (drive.ts)', () => {
  it('follows a route around a wall: two 90° corners, braking into them, no scrapes, no stalls', async () => {
    // a 40 m wall across the yard; start south of it, goal north of it: the route rounds its (nearer) west end
    const sim = await makeSim(yard([wall(-6, -0.4, 34, 0.4)]), vehicleOnly());
    const g = navGridFor(sim);
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, 6, 0, 12, 0); // nose north, into the wall's side
    const rider = pet(sim, Team.Corgis, 8, 12);
    expect(mountKart(sim, kart, rider)).toBe(true);
    const drv = createDriver(), ctrl: KartControls = { throttle: 0, steer: 0, boost: false, handbrake: false }, seq = { n: 0 };
    const goal: DriveGoal = { x: 6, z: -12, r: 3, stop: true };
    let t = 0, maxSpeed = 0, yawTravel = 0, prevYaw = kart.yaw, minCornerSpeed = Infinity, st = 'driving';
    const hp0 = kart.health!.hp;
    for (; t < 30 * TICK_HZ && st !== 'arrived'; t++) {
      st = driverTick(sim, rider, kart, drv, goal, g, ctrl, seq);
      const v = Math.hypot(kart.vel.x, kart.vel.z);
      maxSpeed = Math.max(maxSpeed, v);
      yawTravel += Math.abs(angleDelta(prevYaw, kart.yaw)); prevYaw = kart.yaw;
      if (Math.abs(kart.pos.z) < 2.5) minCornerSpeed = Math.min(minCornerSpeed, v); // rounding the wall's end
    }
    expect(st).toBe('arrived');
    expect(t / TICK_HZ).toBeLessThan(12);                 // ~45 m of route
    expect(yawTravel).toBeGreaterThan(Math.PI * 0.9);     // it really turned round the wall
    expect(maxSpeed).toBeGreaterThan(12);                 // flat out on the legs
    expect(minCornerSpeed).toBeLessThan(maxSpeed - 3);    // and slower round the end
    expect(kart.health!.hp).toBe(hp0);                    // no crash damage (walls hit > 11 m/s hurt)
    expect(drv.reverses).toBe(0);
    expect(Math.hypot(kart.pos.x - goal.x, kart.pos.z - goal.z)).toBeLessThan(3);
  });

  it('backs out when it starts nosed into a wall with its goal behind it', async () => {
    const sim = await makeSim(yard([wall(-20, -0.4, 20, 0.4)]), vehicleOnly());
    const g = navGridFor(sim);
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, 0, 0, 1.6, 0); // nose (−z) 0.5 m from the wall
    const rider = pet(sim, Team.Corgis, 2, 3);
    mountKart(sim, kart, rider);
    const drv = createDriver(), ctrl: KartControls = { throttle: 0, steer: 0, boost: false, handbrake: false }, seq = { n: 0 };
    const goal: DriveGoal = { x: 0, z: 25, r: 3, stop: true };
    let st = 'driving', t = 0, backed = 0;
    for (; t < 15 * TICK_HZ && st !== 'arrived'; t++) {
      st = driverTick(sim, rider, kart, drv, goal, g, ctrl, seq);
      if (ctrl.throttle < 0 && Math.hypot(kart.vel.x, kart.vel.z) > 0.5) backed++;
    }
    expect(st).toBe('arrived');
    expect(backed).toBeGreaterThan(10);   // it reversed away from the wall first
    expect(t / TICK_HZ).toBeLessThan(8);
  });

  it('reverses out when stuck (no progress for 1.5 s), re-plans, and gives up after three tries', async () => {
    // an obstacle the nav grid doesn't know (a block added after the grid was built) across the straight route
    const sim = await makeSim(yard(), vehicleOnly());
    const g = navGridFor(sim);
    sim.world.createCollider(sim.R.ColliderDesc.cuboid(12, 1.5, 0.4).setTranslation(0, 1.5, -10).setCollisionGroups(groups(Layer.World, 0xffff)));
    sim.step();
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, 0, 0, 0, 0);
    const rider = pet(sim, Team.Corgis, 2, 0);
    mountKart(sim, kart, rider);
    const drv = createDriver(), ctrl: KartControls = { throttle: 0, steer: 0, boost: false, handbrake: false }, seq = { n: 0 };
    const goal: DriveGoal = { x: 0, z: -30, r: 3, stop: true };
    let st = 'driving', t = 0, firstContact = -1, firstReverse = -1, still = 0, maxStill = 0;
    let lx = kart.pos.x, lz = kart.pos.z;
    for (; t < 20 * TICK_HZ && st !== 'giveup'; t++) {
      st = driverTick(sim, rider, kart, drv, goal, g, ctrl, seq);
      if (firstContact < 0 && kart.pos.z < -8.0) firstContact = t;
      if (firstReverse < 0 && drv.reverses > 0) firstReverse = t;
      if (t % 30 === 0) {
        const moved = Math.hypot(kart.pos.x - lx, kart.pos.z - lz);
        still = moved < 0.25 ? still + 0.5 : 0; maxStill = Math.max(maxStill, still);
        lx = kart.pos.x; lz = kart.pos.z;
      }
    }
    expect(firstContact).toBeGreaterThan(0);
    expect(firstReverse).toBeGreaterThan(firstContact);
    expect((firstReverse - firstContact) / TICK_HZ).toBeLessThan(2.6);   // 1.5 s of no progress (+ the run-in)
    expect(st).toBe('giveup');
    expect(drv.reverses).toBe(3);
    expect(maxStill).toBeLessThanOrEqual(2);                               // never parked against it
  });

  it('builds a kart grid narrower than the pets\' grid (clearance, ledges) with regions', async () => {
    const sim = await makeSim(yard([wall(-10, -0.4, 10, 0.4), { type: 'step', x: 30, y: 0.2, z: 30, hx: 3, hy: 0.2, hz: 3, rotY: 0 }]), vehicleOnly());
    const g = navGridFor(sim);
    const nav = kartNavFor(g, sim.worldData);
    expect(nav.cells).toBeGreaterThan(0);
    expect(nav.cells).toBeLessThan(g.walkable);
    // a pet walks right up to the wall; a kart keeps a cell off it
    const at = (x: number, z: number) => nav.ok[Math.floor((z - g.oz) / g.cell) * g.w + Math.floor((x - g.ox) / g.cell)];
    expect(at(0, 1.5)).toBe(0);
    expect(at(0, 3.5)).toBe(1);
    // the 0.4 m step (a pet steps it, a kart's autostep is 0.3 m) is ringed off
    expect(at(33, 30)).toBe(0);
    expect(driveLineClear(g, nav, 20, 20, 40, 40)).toBe(false);
    expect(driveLineClear(g, nav, 20, 20, 20, 40)).toBe(true);
    const c = nearestDrivable(g, nav, 0, 0, 5);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(cellX(g, c), cellZ(g, c))).toBeGreaterThan(1.4);
  });
});

describe('bots board, drive and leave karts (tactics.ts vehicleThink)', () => {
  it('boards an empty own-team kart for a far trip, drives it and hops out near the trip\'s end', async () => {
    const sim = await makeSim(yard(), withHookedAi());
    const b = pet(sim, Team.Corgis, -50, 50, { bot: true });
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, -48, 0, 50, Math.PI / 2);
    sim.step();
    sendTo(b, 40, -40);                                           // 127 m away
    const evs: GameEvent[] = [];
    let mountedAt = -1, outAt = -1;
    for (let t = 0; t < 30 * TICK_HZ && outAt < 0; t++) {
      sim.step();
      evs.push(...sim.drainEvents());
      if (mountedAt < 0 && b.seat) mountedAt = t;
      if (mountedAt >= 0 && !b.seat) outAt = t;
    }
    expect(mountedAt).toBeGreaterThanOrEqual(0);
    expect(mountedAt / TICK_HZ).toBeLessThan(1.5);
    expect(outAt).toBeGreaterThan(mountedAt);
    expect(Math.hypot(kart.pos.x - 40, kart.pos.z + 40)).toBeLessThan(10); // hopped out near the goal
    expect((outAt - mountedAt) / TICK_HZ).toBeLessThan(13);
    expect(evs.some((e) => e.e === 'ability' && e.ability === 'dismount' && e.id === kart.id)).toBe(true);
    const r = b.ai!.tac.ride;
    expect(r.boards).toBe(1);
    sim.step();
    expect(r.phase).toBe('idle');                               // on foot again: the brain has it
    expect(r.hops).toBe(1);
  });

  it('vends a kart at its Kart-O-Matic (E), boards it (E) and drives off', async () => {
    const world = yard();
    const sim = await makeSim(world, withHookedAi());
    const site = findTerminalSite(world, Team.Corgis)!;
    const term = spawnTerminal(sim, site);
    sim.step();
    const b = pet(sim, Team.Corgis, site.x - 6, site.z + 2, { bot: true });
    sendTo(b, 40, -40);
    let vended = -1, mounted = -1;
    for (let t = 0; t < 12 * TICK_HZ && mounted < 0; t++) {
      sim.step();
      sim.drainEvents();
      if (vended < 0 && term.terminal!.kart >= 0) vended = t;
      if (b.seat) mounted = t;
    }
    expect(vended).toBeGreaterThanOrEqual(0);
    expect(mounted).toBeGreaterThan(vended);
    expect(b.seat!.vehicle).toBe(term.terminal!.kart);
    expect(mounted / TICK_HZ).toBeLessThan(5);
    for (let t = 0; t < 3 * TICK_HZ; t++) sim.step();
    const kart = sim.entities.get(term.terminal!.kart)!;
    expect(Math.hypot(kart.pos.x - site.padX, kart.pos.z - site.padZ)).toBeGreaterThan(15); // away toward the goal
  });

  it('never takes a kart a human teammate is heading for (standing by it, walking at it, looking at it)', async () => {
    for (const human of ['none', 'near', 'walking', 'looking'] as const) {
      const sim = await makeSim(yard(), withHookedAi());
      const b = pet(sim, Team.Corgis, -50, 50, { bot: true });
      const kart = spawnKart(sim, 'mower_kart', Team.Corgis, -46, 0, 50, 0);
      let h: SimEntity | null = null;
      if (human === 'near') h = pet(sim, Team.Corgis, -44, 48);
      if (human === 'walking') h = pet(sim, Team.Corgis, -46, 68);
      if (human === 'looking') h = pet(sim, Team.Corgis, -46, 61, { yaw: 0 });   // yaw 0 faces −z: at the kart
      sim.step();
      let seq = 1;
      for (let t = 0; t < 3 * TICK_HZ; t++) {
        if (t === 20) sendTo(b, 40, -40);   // (the walking human is already on the move)
        if (h) {
          // the human: walking at the kart (−z) or standing still, facing it
          const walking = human === 'walking' && h.pos.z > 53;
          sim.setInput(h.id, { seq: seq++, mx: 0, mz: walking ? 1 : 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 });
        }
        sim.step();
        sim.drainEvents();
      }
      if (human === 'none') expect(kart.kart!.rider).toBe(b.id);
      else expect(kart.kart!.rider, `human ${human}`).toBe(-1);
      if (human !== 'none') expect(b.ai!.tac.ride.phase, `human ${human}`).toBe('idle');
    }
  });

  it('a bot-driven kart beats walking to a 60 m goal on the West Yard (4 of 5 seeds)', async () => {
    const results: { seed: number; walk: number; kart: number }[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const rng = mulberry32(seed * 7919);
      // a start and a goal 60 m apart, both drivable and in one kart region, a kart parked beside the start
      const probe = await makeSim(createWorldData(1), vehicleOnly(), seed);
      const g = navGridFor(probe);
      const nav = kartNavFor(g, probe.worldData);
      let sx = 0, sz = 0, gx = 0, gz = 0, ky = 0;
      for (let tries = 0; tries < 500; tries++) {
        sx = (rng() - 0.5) * 150; sz = (rng() - 0.5) * 150;
        const a = rng() * Math.PI * 2;
        gx = sx + Math.cos(a) * 60; gz = sz + Math.sin(a) * 60;
        ky = rng() * Math.PI * 2;
        const kx = sx + Math.cos(ky) * 2.4, kz = sz - Math.sin(ky) * 2.4;
        const s = nearestDrivable(g, nav, sx, sz, 0), gg = nearestDrivable(g, nav, gx, gz, 0), k = nearestDrivable(g, nav, kx, kz, 0);
        if (s >= 0 && gg >= 0 && k >= 0 && nav.region[s] === nav.region[gg] && nav.region[k] === nav.region[s]) break;
      }
      const time = async (withKart: boolean): Promise<number> => {
        const sim = await makeSim(createWorldData(1), withHookedAi(), seed);
        const b = pet(sim, Team.Corgis, sx, sz, { bot: true });
        if (withKart) spawnKart(sim, 'mower_kart', Team.Corgis, sx + Math.cos(ky) * 2.4, sim.worldData.height(sx + Math.cos(ky) * 2.4, sz - Math.sin(ky) * 2.4), sz - Math.sin(ky) * 2.4, ky);
        sim.step();
        sendTo(b, gx, gz);
        for (let t = 0; t < 40 * TICK_HZ; t++) {
          sim.step();
          sim.drainEvents();
          if (Math.hypot(b.pos.x - gx, b.pos.z - gz) < 8) return t / TICK_HZ;
        }
        return Infinity;
      };
      results.push({ seed, walk: await time(false), kart: await time(true) });
    }
    const wins = results.filter((r) => r.kart < r.walk).length;
    console.log('B2a 60 m goal, walk vs kart (s):', results.map((r) => `seed ${r.seed}: ${r.walk.toFixed(2)} / ${r.kart.toFixed(2)}`).join(' · '));
    expect(wins).toBeGreaterThanOrEqual(4);
    for (const r of results) expect(r.kart).toBeLessThan(20);
  }, 240000);

  it('is deterministic: the same seed drives the same trip, tick for tick', async () => {
    const run = async () => {
      const sim = await makeSim(createWorldData(1), withHookedAi(), 3);
      const b = pet(sim, Team.Corgis, -20, -40, { bot: true });
      spawnKart(sim, 'mower_kart', Team.Corgis, -18, sim.worldData.height(-18, -40), -40, 1);
      sim.step();
      sendTo(b, 40, 30);
      let h = 0;
      for (let t = 0; t < 15 * TICK_HZ; t++) {
        sim.step();
        sim.drainEvents();
        for (const e of sim.entities.values()) h = (h * 31 + Math.round(e.pos.x * 1000) * 7 + Math.round(e.pos.z * 1000) + (e.flags & EFlag.Mounted)) | 0;
      }
      return { h, ride: JSON.stringify({ ...b.ai!.tac.ride, drv: { ...b.ai!.tac.ride.drv } }) };
    };
    const a = await run(), b = await run();
    expect(a.h).toBe(b.h);
    expect(a.ride).toBe(b.ride);
  }, 60000);
});

describe('bots fly the RC plane (B2b: tactics.ts planeTick, drive.ts flyPlane)', () => {
  /** The West Yard in team-deathmatch with the Rooftop Hangar, the test AI system, a Skyraider bot up by the hangar. */
  async function hangarYard(seed = 3) {
    const sim = await Sim.create({ seed, world: createWorldData(1), systems: withHookedAi() });
    sim.state.room = { mode: 'team-deathmatch' };
    sim.state.vehicleConfig = { autoTerminals: false, hangar: true };
    sim.state.matchConfig = { tdm: { warmup: 0, killLimit: 999, timeLimit: 999, endedHold: 5 } };
    sim.step();
    sim.drainEvents();
    const hangar = [...sim.entities.values()].find((e) => e.terminal?.id === 'plane_hangar')!;
    expect(hangar).toBeTruthy();
    const pilot = sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Corgis, species: Species.Corgi, cls: 'skyraider', name: 'Ace', x: 86, y: hangar.pos.y + 0.05, z: -63, yaw: 0 });
    return { sim, hangar, pilot };
  }

  const evsOf = (sim: Sim, evs: GameEvent[]) => { evs.push(...sim.drainEvents()); };

  it('a bot on the roof vends the plane at the Rooftop Hangar (E), boards it (E) and takes off', async () => {
    const { sim, hangar, pilot } = await hangarYard();
    const evs: GameEvent[] = [];
    let vended = -1, boarded = -1, airborne = -1;
    for (let t = 0; t < 20 * TICK_HZ && airborne < 0; t++) {
      sim.step();
      evsOf(sim, evs);
      if (vended < 0 && hangar.terminal!.kart >= 0) vended = t;
      if (boarded < 0 && pilot.seat) boarded = t;
      const pl = hangar.terminal!.kart >= 0 ? sim.entities.get(hangar.terminal!.kart) : undefined;
      if (boarded >= 0 && pl?.plane && !pl.plane.grounded && pl.pos.y > hangar.pos.y + 3) airborne = t;
    }
    console.log(`[b2b] hangar: vend ${(vended / TICK_HZ).toFixed(1)} s, board ${(boarded / TICK_HZ).toFixed(1)} s, climbing past 3 m over the roof ${(airborne / TICK_HZ).toFixed(1)} s`);
    expect(vended).toBeGreaterThanOrEqual(0);
    expect(boarded).toBeGreaterThan(vended);
    expect(boarded / TICK_HZ).toBeLessThan(8);
    expect(airborne).toBeGreaterThan(boarded);
    expect((airborne - boarded) / TICK_HZ).toBeLessThan(5);
    expect(pilot.ai!.tac.ride.phase).toBe('drive');
  }, 60000);

  it('bot pilots never crash on take-off, the house included (5 runs, targets all round the yard)', async () => {
    // an enemy standing in the open by the house (north), behind the garage, on the lawn, at the cat base
    const targets: [number, number][] = [[-44, -86], [-78, -88], [-8, -90], [20, 20], [60, 70]];
    const report: string[] = [];
    for (const [tx, tz] of targets) {
      const { sim, hangar, pilot } = await hangarYard(5);
      const cat = pet(sim, Team.Cats, tx, tz);
      const evs: GameEvent[] = [];
      let plane: SimEntity | undefined, maxY = -Infinity, minHp = Infinity, t = 0;
      for (; t < 25 * TICK_HZ; t++) {
        sim.setInput(cat.id, { seq: t + 1, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 });
        sim.step();
        evsOf(sim, evs);
        cat.health!.hp = cat.health!.max; // a target that stays (this is about flying, not killing)
        if (!plane && hangar.terminal!.kart >= 0) plane = sim.entities.get(hangar.terminal!.kart);
        if (plane && !plane.removed) { maxY = Math.max(maxY, plane.pos.y); minHp = Math.min(minHp, plane.health!.hp); }
      }
      report.push(`(${tx}, ${tz}): top ${maxY.toFixed(1)} m, hull ${minHp}${plane?.removed ? ' DESTROYED' : ''}`);
      expect(plane, `target (${tx}, ${tz})`).toBeTruthy();
      expect(plane!.removed, `target (${tx}, ${tz})`).toBe(false);
      expect(evs.some((e) => e.e === 'explode'), `target (${tx}, ${tz})`).toBe(false);
      expect(minHp, `target (${tx}, ${tz})`).toBe(VEHICLES.rc_plane.maxHp);
      expect(maxY).toBeGreaterThan(hangar.pos.y + 4);
      expect(pilot.seat?.vehicle).toBe(plane!.id);
    }
    console.log('[b2b] take-offs:', report.join(' · '));
  }, 240000);

  it('flies strafing runs that hit an enemy in the open, and bails out when the plane is shot up', async () => {
    const { sim, hangar, pilot } = await hangarYard(7);
    const cat = pet(sim, Team.Cats, 30, -20);
    const evs: GameEvent[] = [];
    let plane: SimEntity | undefined;
    for (let t = 0; t < 40 * TICK_HZ; t++) {
      sim.setInput(cat.id, { seq: t + 1, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 });
      sim.step();
      evsOf(sim, evs);
      cat.health!.hp = cat.health!.max;
      if (!plane && hangar.terminal!.kart >= 0) plane = sim.entities.get(hangar.terminal!.kart);
    }
    const shots = evs.filter((e) => e.e === 'fire' && e.id === plane!.id).length;
    const hits = evs.filter((e) => e.e === 'hit' && e.src === pilot.id && e.dst === cat.id).length;
    console.log(`[b2b] 40 s sortie on a standing target: ${pilot.ai!.tac.ride.flight.dives} dives, ${shots} rounds, ${hits} hits`);
    expect(pilot.ai!.tac.ride.flight.dives).toBeGreaterThanOrEqual(2);
    expect(hits).toBeGreaterThanOrEqual(3);
    // shot up: the pilot bails out (E in the air) and falls clear
    plane!.health!.hp = Math.floor(plane!.health!.max * 0.3);
    let bailed = false;
    for (let t = 0; t < 2 * TICK_HZ && !bailed; t++) { sim.step(); evsOf(sim, evs); bailed = evs.some((e) => e.e === 'ability' && e.ability === 'bail' && e.id === plane!.id); }
    expect(bailed).toBe(true);
    expect(pilot.seat).toBeUndefined();
  }, 120000);
});

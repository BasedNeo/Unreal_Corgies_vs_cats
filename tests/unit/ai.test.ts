import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Btn } from '../../src/shared/input';
import { Team, Species, EntityKind, EFlag, type TeamId, type ClassId } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import { createWorldData } from '../../src/shared/world/world-data';
import { worldLineClear } from '../../src/sim/combat';
import { aiSystem, applyArchetype, simNavGrid, navGridFor, findPath, lineWalkable, isWalkable, cellX, cellZ, nearestWalkable, type AiPerf, type NavGrid } from '../../src/sim/ai';

// Tests run against whatever WorldData the world lane ships (createWorldData); positions are found
// at runtime (clear lanes, obstacles between two walkable points) instead of being hard-coded.
async function world(seed = 5): Promise<Sim> {
  const sim = await Sim.create({ seed, world: createWorldData(seed) });
  sim.step(); // tick 0: physics builds query structures; the AI builds its nav grid on tick 1
  sim.step();
  return sim;
}

// Terrain height from WorldData (exact heightfield surface). Vertical Rapier rays can slip through
// heightfield grid lines, so tests never probe the ground with straight-down rays.
function groundAt(sim: Sim, x: number, z: number): number {
  return sim.worldData.height(x, z);
}

function grid(sim: Sim): NavGrid {
  const g = simNavGrid(sim);
  expect(g).toBeTruthy();
  return g!;
}

/** Straight, flat, unobstructed lane of len meters on walkable nav cells. */
function findLane(sim: Sim, len: number): { ax: number; az: number; dx: number; dz: number } {
  const g = grid(sim);
  const h = sim.worldData.halfExtent * 0.8;
  for (let r = 0; r <= h; r += 3) {
    for (let a = 0; a < 24; a++) {
      const ax = Math.cos((a / 24) * Math.PI * 2) * r, az = Math.sin((a / 24) * Math.PI * 2) * r;
      for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const bx = ax + dx * len, bz = az + dz * len;
        if (!lineWalkable(g, ax - dx * 3, az - dz * 3, bx + dx * 3, bz + dz * 3, true)) continue;
        const g0 = groundAt(sim, ax, az);
        let ok = Math.abs(groundAt(sim, bx, bz) - g0) < 0.3;
        for (const y of [0.5, 1.1]) if (ok && !worldLineClear(sim, ax, g0 + y, az, bx, g0 + y, bz)) ok = false;
        // room to strafe on both sides
        for (let s = 0; s <= len && ok; s += 2) {
          if (!isWalkable(g, ax + dx * s - dz * 3, az + dz * s + dx * 3) || !isWalkable(g, ax + dx * s + dz * 3, az + dz * s - dx * 3)) ok = false;
        }
        if (ok) return { ax, az, dx, dz };
      }
    }
  }
  throw new Error('no clear lane');
}

function spawnAt(sim: Sim, team: TeamId, x: number, z: number, yaw: number, kind: number = EntityKind.Player, cls: ClassId = 'assault'): SimEntity {
  return sim.spawnCharacter({ kind: kind as 0, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: 'e', x, y: groundAt(sim, x, z) + 0.05, z, yaw });
}

function run(sim: Sim, ticks: number, each?: () => void): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) { each?.(); sim.step(); out.push(...sim.drainEvents()); }
  return out;
}

describe('bot combat', () => {
  it('turns to a target in view and hits it within 2 s (after a human-like reaction delay)', async () => {
    const sim = await world();
    const lane = findLane(sim, 14);
    const toTarget = Math.atan2(-lane.dx, -lane.dz);
    const target = spawnAt(sim, Team.Cats, lane.ax + lane.dx * 14, lane.az + lane.dz * 14, 0);
    // 40° off the target: inside the 55° sight cone but not aimed
    const bot = spawnAt(sim, Team.Corgis, lane.ax, lane.az, toTarget + (40 * Math.PI) / 180, EntityKind.Bot);
    const start = sim.tick;
    let firstHit = -1, firstFire = -1;
    for (let i = 0; i < 120 && firstHit < 0; i++) {
      sim.step();
      for (const ev of sim.drainEvents()) {
        if (ev.e === 'fire' && ev.id === bot.id && firstFire < 0) firstFire = sim.tick;
        if (ev.e === 'hit' && ev.src === bot.id && ev.dst === target.id) firstHit = sim.tick;
      }
    }
    expect(bot.ai).toBeTruthy();
    expect(firstHit).toBeGreaterThan(0);
    expect((firstHit - start) / 60).toBeLessThanOrEqual(2);
    // reaction delay: no shot in the first 250 ms
    expect(firstFire - start).toBeGreaterThanOrEqual(15);
    expect(bot.ai!.mode).toBe('engage');
    expect(bot.flags & EFlag.Firing).toBeTruthy();
    expect(bot.flags & EFlag.Alerted).toBeTruthy();
  });

  it('does not see a cloaked enemy at range, but spots it up close', async () => {
    const sim = await world();
    const lane = findLane(sim, 16);
    const toTarget = Math.atan2(-lane.dx, -lane.dz);
    const sneak = spawnAt(sim, Team.Cats, lane.ax + lane.dx * 16, lane.az + lane.dz * 16, 0, EntityKind.Player, 'infiltrator');
    run(sim, 3);
    sim.setInput(sneak.id, { seq: 1, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: Btn.Ability, rt: 0 });
    run(sim, 2);
    sim.setInput(sneak.id, { seq: 2, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 });
    expect(sneak.flags & EFlag.Stealthed).toBeTruthy();
    const bot = spawnAt(sim, Team.Corgis, lane.ax, lane.az, toTarget, EntityKind.Bot);
    run(sim, 60);
    expect(bot.ai!.target).not.toBe(sneak.id);
    sim.placeCharacter(sneak, lane.ax + lane.dx * 4, groundAt(sim, lane.ax + lane.dx * 4, lane.az + lane.dz * 4) + 0.05, lane.az + lane.dz * 4);
    run(sim, 20);
    expect(bot.ai!.target).toBe(sneak.id);
  });

  it('hears gunfire behind it and turns to investigate', async () => {
    const sim = await world();
    const lane = findLane(sim, 18);
    const away = Math.atan2(lane.dx, lane.dz); // facing away from the shooter
    const bot = spawnAt(sim, Team.Corgis, lane.ax, lane.az, away, EntityKind.Bot);
    const shooter = spawnAt(sim, Team.Cats, lane.ax + lane.dx * 18, lane.az + lane.dz * 18, 0);
    run(sim, 10);
    const yaw0 = bot.ai!.yaw;
    run(sim, 30, () => sim.setInput(shooter.id, { seq: sim.tick + 1, mx: 0, mz: 0, yaw: Math.atan2(lane.dx, lane.dz), pitch: 0.4, buttons: Btn.Fire, rt: 0 }));
    run(sim, 60, () => sim.setInput(shooter.id, { seq: sim.tick + 1, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }));
    expect(['alert', 'engage']).toContain(bot.ai!.mode);
    const toShooter = Math.atan2(-(shooter.pos.x - bot.pos.x), -(shooter.pos.z - bot.pos.z));
    const off = (a: number) => Math.abs(Math.atan2(Math.sin(a - toShooter), Math.cos(a - toShooter)));
    expect(off(bot.ai!.yaw)).toBeLessThan(off(yaw0));
  });

  it('retreats to cover when badly hurt', async () => {
    const sim = await world();
    const lane = findLane(sim, 16);
    const toTarget = Math.atan2(-lane.dx, -lane.dz);
    spawnAt(sim, Team.Cats, lane.ax + lane.dx * 16, lane.az + lane.dz * 16, 0);
    const bot = spawnAt(sim, Team.Corgis, lane.ax, lane.az, toTarget, EntityKind.Bot);
    run(sim, 40);
    expect(bot.ai!.mode).toBe('engage');
    bot.health!.hp = bot.health!.max * 0.2;
    run(sim, 12);
    expect(bot.ai!.mode).toBe('cover');
  });
});

describe('navigation', () => {
  /** Two walkable points on opposite sides of a prop, whose straight line is blocked. */
  function obstacleCrossing(sim: Sim): { sx: number; sz: number; gx: number; gz: number } {
    const g = grid(sim);
    const props = [...sim.worldData.props].filter((p) => p.type !== 'boundary' && p.hx * p.hz > 1.5 && p.hx * p.hz < 150)
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    for (const p of props) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2 + p.rotY;
        const ext = Math.hypot(p.hx, p.hz) + 4;
        const s = nearestWalkable(g, p.x + Math.cos(ang) * ext, p.z + Math.sin(ang) * ext, 2, g.mainRegion);
        const t = nearestWalkable(g, p.x - Math.cos(ang) * ext, p.z - Math.sin(ang) * ext, 2, g.mainRegion);
        if (s < 0 || t < 0) continue;
        const sx = cellX(g, s), sz = cellZ(g, s), gx = cellX(g, t), gz = cellZ(g, t);
        if (!lineWalkable(g, sx, sz, gx, gz) && !worldLineClear(sim, sx, g.ground[s] + 0.8, sz, gx, g.ground[t] + 0.8, gz)) return { sx, sz, gx, gz };
      }
    }
    throw new Error('no obstacle crossing found');
  }

  it('builds a grid from the real colliders: props block cells, the yard is one connected region', async () => {
    const sim = await world();
    const g = grid(sim);
    expect(g.walkable).toBeGreaterThan(g.w * g.h * 0.3);
    expect(g.regionSize[g.mainRegion]).toBeGreaterThan(g.walkable * 0.8);
    // every team spawn stands in (or right next to) the main region
    for (const s of sim.worldData.spawns) expect(nearestWalkable(g, s.x, s.z, 3, g.mainRegion)).toBeGreaterThanOrEqual(0);
    // a solid prop's center is not walkable
    const solid = sim.worldData.props.find((p) => p.type !== 'boundary' && p.hx > 1 && p.hz > 1 && p.y + p.hy > groundAt(sim, p.x, p.z) + 1 && Math.abs(p.x) < sim.worldData.halfExtent - 5 && Math.abs(p.z) < sim.worldData.halfExtent - 5);
    if (solid) expect(isWalkable(g, solid.x, solid.z)).toBe(false);
    expect(navGridFor(sim)).toBe(g); // cached per world
  });

  it('A* finds a smoothed path around an obstacle', async () => {
    const sim = await world();
    const g = grid(sim);
    const c = obstacleCrossing(sim);
    const path: number[] = [];
    expect(findPath(g, c.sx, c.sz, c.gx, c.gz, path)).toBe(true);
    expect(path.length).toBeGreaterThanOrEqual(4); // at least one corner + the goal
    let px = c.sx, pz = c.sz;
    for (let i = 0; i < path.length; i += 2) {
      expect(lineWalkable(g, px, pz, path[i], path[i + 1])).toBe(true);
      px = path[i]; pz = path[i + 1];
    }
    expect(Math.hypot(px - c.gx, pz - c.gz)).toBeLessThan(1.5);
  });

  it('a bot walks across the yard around props to its goal without getting stuck', async () => {
    const sim = await world();
    const c = obstacleCrossing(sim);
    const bot = spawnAt(sim, Team.Corgis, c.sx, c.sz, 0, EntityKind.Bot);
    run(sim, 2);
    const ai = bot.ai!;
    ai.goalX = c.gx; ai.goalZ = c.gz; ai.hasGoal = true; ai.mode = 'patrol'; ai.path.length = 0;
    let reached = -1, maxStuck = 0;
    const dist0 = Math.hypot(c.gx - c.sx, c.gz - c.sz);
    for (let i = 0; i < 60 * 30 && reached < 0; i++) {
      sim.step();
      sim.drainEvents();
      maxStuck = Math.max(maxStuck, ai.stuck);
      if (Math.hypot(bot.pos.x - c.gx, bot.pos.z - c.gz) < 1.6) reached = i;
    }
    expect(reached).toBeGreaterThan(0);
    expect(reached / 60).toBeLessThan(dist0 / 3 + 6);
    expect(maxStuck).toBeLessThan(3);
  });

  it('a long trip between the team bases completes', async () => {
    const sim = await world();
    const g = grid(sim);
    const a = sim.worldData.spawns.find((s) => s.team === Team.Corgis)!;
    const b = sim.worldData.spawns.find((s) => s.team === Team.Cats)!;
    const t = nearestWalkable(g, b.x, b.z, 4, g.mainRegion);
    const bot = spawnAt(sim, Team.Corgis, a.x, a.z, 0, EntityKind.Bot);
    run(sim, 2);
    const ai = bot.ai!;
    ai.goalX = cellX(g, t); ai.goalZ = cellZ(g, t); ai.hasGoal = true; ai.mode = 'patrol'; ai.path.length = 0;
    let reached = -1;
    for (let i = 0; i < 60 * 60 && reached < 0; i++) {
      sim.step();
      sim.drainEvents();
      if (Math.hypot(bot.pos.x - ai.goalX, bot.pos.z - ai.goalZ) < 1.6 || (!ai.hasGoal && Math.hypot(bot.pos.x - cellX(g, t), bot.pos.z - cellZ(g, t)) < 2)) reached = i;
    }
    expect(reached).toBeGreaterThan(0);
  });
});

describe('ai budget', () => {
  it('16 bots think in well under 1.5 ms per tick (p95)', async () => {
    const sim = await world(7);
    const g = grid(sim);
    const spawns = sim.worldData.spawns;
    for (let i = 0; i < 16; i++) {
      const s = spawns[i % spawns.length];
      const c = nearestWalkable(g, s.x + (i % 3) - 1, s.z + ((i >> 2) % 3) - 1, 4);
      const e = sim.spawnCharacter({ kind: EntityKind.Bot, team: s.team, species: s.team === Team.Cats ? Species.Cat : Species.Corgi, cls: (['assault', 'infiltrator', 'overwatch', 'breacher', 'warden', 'skyraider'] as const)[i % 6], name: `b${i}`, x: cellX(g, c), y: g.ground[c] + 0.05, z: cellZ(g, c), yaw: s.yaw });
      if (s.team === Team.Cats && i % 4 === 3) applyArchetype(e, 'kitten');
    }
    // Cost per AI update = min(wall, process CPU): wall time is inflated by preemption when the
    // machine is busy, CPU time by V8 background threads; the minimum is the update's own work.
    const ms: number[] = [];
    const update = aiSystem.update;
    aiSystem.update = (s, dt) => {
      const c0 = process.cpuUsage(), t0 = performance.now();
      update.call(aiSystem, s, dt);
      const wall = performance.now() - t0, c = process.cpuUsage(c0);
      ms.push(Math.min(wall, (c.user + c.system) / 1000));
    };
    try {
      for (let i = 0; i < 60 * 20; i++) { sim.step(); sim.drainEvents(); }
    } finally {
      aiSystem.update = update;
    }
    ms.sort((a, b) => a - b);
    const p95 = ms[Math.floor(ms.length * 0.95)];
    expect((sim.state.aiPerf as AiPerf).bots).toBe(16);
    console.log(`[ai budget] 16 bots: p50 ${ms[ms.length >> 1].toFixed(3)} ms · p95 ${p95.toFixed(3)} ms · max ${ms[ms.length - 1].toFixed(3)} ms`);
    expect(p95).toBeLessThan(1.5);
    // they actually fought
    let shots = 0;
    for (const e of sim.entities.values()) shots += e.wpn?.shots ?? 0;
    expect(shots).toBeGreaterThan(20);
  });
});

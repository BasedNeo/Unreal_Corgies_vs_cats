// W9 X4: bots throw at clusters (src/sim/ai/ordnance-ai.ts, the pure decision module the lead wires at INT9).
// When: ≥ 2 enemies within 4 m of each other, 8–22 m away, the arc lands in the open near them, no ally near the blast.
// Never: a lone enemy, too close / too far, an ally in the blast, a roof over them, without a throwable. Deterministic.
// End to end: a bot driven by ordnanceBotThink (wired like the snippet in docs/handoff/X4.md) throws a real grenade that
// hurts both cats of a cluster and no ally, and the wind-up is visible (Throw held before the release).
import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { Sim, type SimSystem } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Btn } from '../../src/shared/input';
import { EFlag, EntityKind, Species, Team, type TeamId } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import type { PropBox, WorldData } from '../../src/shared/world/world-data';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem } from '../../src/sim/systems/core';
import { worldSystems } from '../../src/sim/world/systems';
import { combatSystems, liveOrdnance, ordnanceArcWorld, ordnanceStats } from '../../src/sim/combat';
import { ORDNANCE_AI, createOrdnanceBot, makeIntent, makePlan, ordnanceBotThink, planThrow } from '../../src/sim/ai/ordnance-ai';
import { ORDNANCE_BLAST, arcWorldOf } from '../../src/shared/content/ordnance';

function flat(props: PropBox[] = []): WorldData {
  const n = 101, cell = 1.2, x0 = -60;
  return {
    seed: 1, name: 'ai yard', height: () => 0, halfExtent: 58, killY: -40, props,
    terrain: { x0, z0: x0, cell, n, heights: new Float32Array(n * n) },
    spawns: [{ x: 0, y: 0, z: 0, yaw: 0, team: Team.Corgis }, { x: 0, y: 0, z: -30, yaw: 0, team: Team.Cats }],
  };
}
const SYSTEMS = (): SimSystem[] => [movementSystem, ...worldSystems(), physicsStepSystem, ...combatSystems()];

async function setup(props: PropBox[] = []) {
  const sim = await Sim.create({ seed: 7, world: flat(props), systems: SYSTEMS() });
  sim.state.ordnanceConfig = { enabled: true };
  const mk = (team: TeamId, x: number, z: number, kind: number = EntityKind.Bot) =>
    sim.spawnCharacter({ kind: kind as 1, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls: 'assault', name: `c${sim.entities.size}`, x, y: 0.02, z });
  return { sim, mk };
}
const settle = (sim: Sim, n = 3) => { for (let i = 0; i < n; i++) { sim.step(); sim.drainEvents(); } };

describe('X4 ordnance AI: planThrow', () => {
  it('throws at two enemies clustered 14 m out in the open, the blast (after the bounces) by them, reaching both', async () => {
    const { sim, mk } = await setup();
    const bot = mk(Team.Corgis, 0, 0);
    const a = mk(Team.Cats, 1, -14), b = mk(Team.Cats, -1.5, -15);
    settle(sim);
    expect(bot.flags & EFlag.Ordnance).toBeTruthy();
    const plan = makePlan();
    expect(planThrow(bot, [a, b], [bot], ordnanceArcWorld(sim), plan)).toBe(true);
    expect(Math.hypot(plan.bx - plan.cx, plan.bz - plan.cz)).toBeLessThan(ORDNANCE_AI.landTol);
    expect(Math.hypot(plan.x, plan.z)).toBeLessThan(Math.hypot(plan.cx, plan.cz)); // the squeaker is aimed short: it bounces on
    expect(plan.hits).toBe(2);
    expect(Math.abs(plan.yaw)).toBeLessThan(0.2); // facing −Z
  });

  it('holds: a lone enemy, a cluster too close or too far, an ally by the blast, no throwable, in a vehicle', async () => {
    const { sim, mk } = await setup();
    const bot = mk(Team.Corgis, 0, 0);
    const lone = mk(Team.Cats, 0, -14);
    const near1 = mk(Team.Cats, 0.5, -5), near2 = mk(Team.Cats, -0.5, -5.5);
    const far1 = mk(Team.Cats, 0.5, -30), far2 = mk(Team.Cats, -0.5, -31);
    const c1 = mk(Team.Cats, 12, -8), c2 = mk(Team.Cats, 13, -9);
    const ally = mk(Team.Corgis, 11.5, -7.5);
    settle(sim);
    const aw = ordnanceArcWorld(sim), plan = makePlan();
    expect(planThrow(bot, [lone], [bot], aw, plan)).toBe(false);
    expect(planThrow(bot, [near1, near2], [bot], aw, plan)).toBe(false);
    expect(planThrow(bot, [far1, far2], [bot], aw, plan)).toBe(false);
    expect(planThrow(bot, [c1, c2], [bot], aw, plan)).toBe(true);
    expect(planThrow(bot, [c1, c2], [bot, ally], aw, plan)).toBe(false); // the ally stands in it
    // every character as `allies` (the brain's ctx.chars) is safe: enemies there never veto, teammates as targets never count
    expect(planThrow(bot, [c1, c2, ally], [bot, c1, c2, lone], aw, plan)).toBe(true);
    expect(planThrow(bot, [ally, mk(Team.Corgis, 12.5, -8.5)], [bot], aw, plan)).toBe(false);
    bot.flags &= ~EFlag.Ordnance;
    expect(planThrow(bot, [c1, c2], [bot], aw, plan)).toBe(false);
    bot.flags |= EFlag.Ordnance | EFlag.Mounted;
    expect(planThrow(bot, [c1, c2], [bot], aw, plan)).toBe(false);
  });

  it('holds when the cluster is inside a shed (no way in for the arc); an open pen only when a lob drops in on them', async () => {
    const shed: PropBox[] = [
      { type: 'roof', x: 0, y: 2.6, z: -14, hx: 3, hy: 0.15, hz: 3, rotY: 0 },
      { type: 'wall', x: 0, y: 1.3, z: -11, hx: 3, hy: 1.3, hz: 0.15, rotY: 0 },
      { type: 'wall', x: 0, y: 1.3, z: -17, hx: 3, hy: 1.3, hz: 0.15, rotY: 0 },
      { type: 'wall', x: -3, y: 1.3, z: -14, hx: 0.15, hy: 1.3, hz: 3, rotY: 0 },
      { type: 'wall', x: 3, y: 1.3, z: -14, hx: 0.15, hy: 1.3, hz: 3, rotY: 0 },
    ];
    // an open-topped pen around the other cluster: the blast lands outside and the pen wall shields them
    const pen: PropBox[] = [
      { type: 'wall', x: 14, y: 1.5, z: -10.5, hx: 3, hy: 1.5, hz: 0.2, rotY: 0 },
      { type: 'wall', x: 14, y: 1.5, z: -15.5, hx: 3, hy: 1.5, hz: 0.2, rotY: 0 },
      { type: 'wall', x: 11, y: 1.5, z: -13, hx: 0.2, hy: 1.5, hz: 2.7, rotY: 0 },
      { type: 'wall', x: 17, y: 1.5, z: -13, hx: 0.2, hy: 1.5, hz: 2.7, rotY: 0 },
    ];
    const { sim, mk } = await setup(shed);
    const bot = mk(Team.Corgis, 0, 0);
    const a = mk(Team.Cats, 1, -14), b = mk(Team.Cats, -1, -14.5);
    settle(sim);
    expect(planThrow(bot, [a, b], [bot], ordnanceArcWorld(sim), makePlan())).toBe(false);
    // the pen is pure arc-world geometry: planThrow reads nothing else
    const aw = arcWorldOf(flat(pen));
    const p = { ...a, pos: { x: 13.5, y: 0, z: -13 } } as SimEntity, q = { ...b, pos: { x: 14.5, y: 0, z: -13.5 } } as SimEntity;
    const plan = makePlan();
    const ok = planThrow(bot, [p, q], [bot], aw, plan);
    // either it finds a lob that drops inside the pen (then it must reach both), or it holds
    if (ok) expect(plan.hits).toBe(2);
  });

  it('is deterministic and cheap enough for the AI budget', async () => {
    const { sim, mk } = await setup();
    const bot = mk(Team.Corgis, 0, 0);
    const es = [mk(Team.Cats, 3, -16), mk(Team.Cats, 4.5, -17), mk(Team.Cats, 2, -18.5), mk(Team.Cats, -10, -5)];
    settle(sim);
    const aw = ordnanceArcWorld(sim);
    const p1 = makePlan(), p2 = makePlan();
    expect(planThrow(bot, es, [bot], aw, p1)).toBe(true);
    expect(planThrow(bot, es, [bot], aw, p2)).toBe(true);
    expect(p2).toEqual(p1);
    expect(p1.hits).toBe(3);
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) planThrow(bot, es, [bot], aw, p2);
    const ms = (performance.now() - t0) / 50;
    const load = Math.max(1, os.loadavg()[0] / os.cpus().length);
    console.log(`[X4 ai] planThrow ${ms.toFixed(3)} ms per call (load ×${load.toFixed(1)})`);
    expect(ms).toBeLessThan(1.0 * load); // a bot re-plans every 0.25 s at most, and only with a cluster in the band
  });
});

describe('X4 ordnance AI: ordnanceBotThink end to end', () => {
  it('winds up (Throw held), releases on the plan, and the real grenade hurts both cats and no corgi', async () => {
    const { sim, mk } = await setup();
    const bot = mk(Team.Corgis, 0, 0);
    const mate = mk(Team.Corgis, 6, 2);
    const a = mk(Team.Cats, 1, -15), b = mk(Team.Cats, -1.2, -16);
    settle(sim);
    for (const c of [a, b, mate]) c.combat!.invulnUntil = 0;
    const ob = createOrdnanceBot(bot.id), intent = makeIntent();
    const events: GameEvent[] = [];
    let yaw = bot.yaw, pitch = 0, held = 0, seq = 1, releasedAt = -1;
    for (let t = 0; t < 60 * 4; t++) {
      ordnanceBotThink(ob, bot, sim.tick, yaw, pitch, [a, b], [bot, mate], ordnanceArcWorld(sim), intent);
      let buttons = 0;
      if (intent.active) {
        // the wiring: turn toward the plan (like turnToward), snap to the exact angles on the release tick
        if (intent.buttons & Btn.Throw) { yaw += (intent.yaw - yaw) * 0.25; pitch += (intent.pitch - pitch) * 0.25; held++; }
        else { yaw = intent.yaw; pitch = intent.pitch; if (releasedAt < 0) releasedAt = sim.tick; }
        buttons = intent.buttons;
      }
      sim.setInput(bot.id, { seq: seq++, mx: 0, mz: 0, yaw, pitch, buttons, rt: 0 });
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(held).toBeGreaterThanOrEqual(ORDNANCE_AI.windTicks);
    expect(releasedAt).toBeGreaterThan(0);
    expect(ob.throws).toBe(1);
    expect(ordnanceStats(sim)).toMatchObject({ throws: 1, blasts: 1 });
    const hurt = new Set(events.filter((e) => e.e === 'hit').map((e) => (e as { dst: number }).dst));
    expect(hurt.has(a.id) && hurt.has(b.id)).toBe(true);
    expect(hurt.has(mate.id) || hurt.has(bot.id)).toBe(false);
    for (const c of [a, b]) expect(c.dead).toBe(false);
    expect(bot.flags & EFlag.Ordnance).toBe(0);
    expect(liveOrdnance(sim).length).toBe(0);
    // no throwable, no plan: it stays idle
    for (let t = 0; t < 60; t++) expect(ordnanceBotThink(ob, bot, sim.tick + t, yaw, pitch, [a, b], [bot], ordnanceArcWorld(sim), intent).active).toBe(false);
    void ORDNANCE_BLAST;
  });
});

// W9 F2 (mode-1, Q4 P2-3): bot throws that land. Only holding targets (a pet that has stayed within 2.5 m of one spot
// for 1 s; a lone one with >= 60 % health too), the thrower plants its feet through the wind-up (brain.ts X4 block)
// and the release re-solves the arc from where it stands. Q4's test: a pair walking at 6 m/s → no throw; the same pair
// holding → the blast within 1.5 m of the plan. Plus the brain wiring: a bot running when it starts the wind-up stops,
// and its blast still lands on the plan.
import { describe, it, expect } from 'vitest';
import { Sim, type SimSystem } from '../../src/sim/sim';
import { Btn } from '../../src/shared/input';
import { EFlag, EntityKind, Species, Team, type TeamId } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import type { WorldData } from '../../src/shared/world/world-data';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem } from '../../src/sim/systems/core';
import { worldSystems } from '../../src/sim/world/systems';
import { combatSystems, ordnanceArcWorld, ordnanceStats } from '../../src/sim/combat';
import { aiSystems } from '../../src/sim/ai';
import {
  ORDNANCE_AI, createOrdnanceBot, heldTicks, keepClearOfOwnBlast, makeIntent, makePlan, noteBodies, ordnanceBotThink, planThrow,
} from '../../src/sim/ai/ordnance-ai';

function flat(): WorldData {
  const n = 101, cell = 1.2, x0 = -60;
  return {
    seed: 1, name: 'f2 throw yard', height: () => 0, halfExtent: 58, killY: -40, props: [],
    terrain: { x0, z0: x0, cell, n, heights: new Float32Array(n * n) },
    spawns: [{ x: 0, y: 0, z: 0, yaw: 0, team: Team.Corgis }, { x: 0, y: 0, z: -30, yaw: 0, team: Team.Cats }],
  };
}

async function setup(systems: SimSystem[] = [movementSystem, ...worldSystems(), physicsStepSystem, ...combatSystems()]) {
  const sim = await Sim.create({ seed: 7, world: flat(), systems });
  sim.state.ordnanceConfig = { enabled: true };
  const mk = (team: TeamId, x: number, z: number, kind: number = EntityKind.Player, cls: 'assault' | 'warden' = 'assault') =>
    sim.spawnCharacter({ kind: kind as 1, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls, name: `c${sim.entities.size}`, x, y: 0.02, z });
  return { sim, mk };
}

describe('F2 bot throws only at holding targets (Q4 P2-3)', () => {
  it('a pair walking at 6 m/s is no target; the same pair holding is, after 1 s', async () => {
    const { sim, mk } = await setup();
    const bot = mk(Team.Corgis, 0, 0);
    const a = mk(Team.Cats, -8, -14), b = mk(Team.Cats, -10, -15);
    for (let i = 0; i < 3; i++) { sim.step(); sim.drainEvents(); }
    const aw = ordnanceArcWorld(sim), plan = makePlan();
    // they walk east across the bot's front at 6 m/s (0.1 m a tick) for 3 s: never a target
    let planned = 0;
    for (let t = 0; t < 180; t++) {
      a.pos.x += 0.1; b.pos.x += 0.1;
      noteBodies(t, [a, b]);
      if (t % 30 === 0 && planThrow(bot, [a, b], [bot], aw, plan, t)) planned++;
    }
    expect(planned).toBe(0);
    expect(heldTicks(a, 179)).toBeLessThan(ORDNANCE_AI.holdTicks);
    // they stop (strafing 1 m either way, like a firefight): a target after holdTicks
    let first = -1;
    for (let t = 180; t < 360; t++) {
      a.pos.x += Math.sin(t * 0.2) * 0.05; b.pos.x -= Math.sin(t * 0.2) * 0.05;
      noteBodies(t, [a, b]);
      if (first < 0 && planThrow(bot, [a, b], [bot], aw, plan, t)) first = t;
    }
    expect(first).toBeGreaterThanOrEqual(180 + ORDNANCE_AI.holdTicks - 1);
    expect(first).toBeLessThan(180 + ORDNANCE_AI.holdTicks + 30);
    expect(plan.hits).toBe(2);
  });

  it('the release re-solves from where the thrower stands: a bot still running at the start of the wind-up lands the blast within 1.5 m of the plan', async () => {
    const { sim, mk } = await setup();
    const bot = mk(Team.Corgis, 0, 0);
    const a = mk(Team.Cats, 1, -15), b = mk(Team.Cats, -1.2, -16);
    for (let i = 0; i < 3; i++) { sim.step(); sim.drainEvents(); }
    for (const c of [a, b]) c.combat!.invulnUntil = 0;
    const ob = createOrdnanceBot(bot.id), intent = makeIntent();
    const events: GameEvent[] = [];
    let yaw = bot.yaw, pitch = 0, seq = 1, planX = NaN, planZ = NaN, wind = 0;
    for (let t = 0; t < 60 * 4; t++) {
      ordnanceBotThink(ob, bot, sim.tick, yaw, pitch, [a, b], [bot], ordnanceArcWorld(sim), intent);
      let buttons = 0, mx = 0;
      if (intent.active) {
        if (intent.buttons & Btn.Throw) {
          if (Number.isNaN(planX)) { planX = ob.plan.bx; planZ = ob.plan.bz; }
          yaw += (intent.yaw - yaw) * 0.25; pitch += (intent.pitch - pitch) * 0.25;
          mx = wind++ < 8 ? 1 : 0; // still sidestepping for 8 ticks before its feet are planted
        } else { yaw = intent.yaw; pitch = intent.pitch; }
        buttons = intent.buttons;
      }
      sim.setInput(bot.id, { seq: seq++, mx, mz: 0, yaw, pitch, buttons: buttons | (mx ? Btn.Sprint : 0), rt: 0 });
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(ob.throws).toBe(1);
    const boom = events.find((e) => e.e === 'explode') as { x: number; z: number } | undefined;
    expect(boom).toBeTruthy();
    expect(Math.hypot(boom!.x - planX, boom!.z - planZ)).toBeLessThan(ORDNANCE_AI.landTol);
    const hurt = new Set(events.filter((e) => e.e === 'hit').map((e) => (e as { dst: number }).dst));
    expect(hurt.has(a.id) && hurt.has(b.id)).toBe(true);
  });

  it('while its own grenade is live, a bot never walks into the blast (Q4: storming attackers hit themselves)', async () => {
    const { sim, mk } = await setup();
    const bot = mk(Team.Corgis, 0, 0);
    const ob = createOrdnanceBot(bot.id);
    ob.released = 100; ob.rx = 0; ob.rz = -6; // its blast lands 6 m ahead (-z)
    const mv = { x: 0, z: -1 };                // and it wants to run straight at it
    keepClearOfOwnBlast(ob, bot, 150, mv);
    expect(mv.z).toBeGreaterThanOrEqual(-1e-9); // no inward component left
    const away = { x: 0, z: 1 };
    keepClearOfOwnBlast(ob, bot, 150, away);
    expect(away).toEqual({ x: 0, z: 1 });       // moving away: untouched
    bot.pos.z = -3;                             // inside the margin, still heading in: steps out instead
    const m2 = { x: 0.3, z: -1 };
    keepClearOfOwnBlast(ob, bot, 150, m2);
    expect(m2.z).toBeGreaterThan(0.9);
    const side = { x: 1, z: 0 };                // (sideways is not inward: left alone)
    keepClearOfOwnBlast(ob, bot, 150, side);
    expect(side).toEqual({ x: 1, z: 0 });
    const late = { x: 0, z: -1 };               // after the fuse: free again
    keepClearOfOwnBlast(ob, bot, 100 + 133, late);
    expect(late).toEqual({ x: 0, z: -1 });
  });

  it('through the real brain: a room bot facing two holding cats plants its feet, throws, and the blast reaches them', async () => {
    const { sim, mk } = await setup([...aiSystems(), movementSystem, ...worldSystems(), physicsStepSystem, ...combatSystems()]);
    sim.state.room = { mode: 'team-deathmatch' };
    const bot = mk(Team.Corgis, 0, 0, EntityKind.Bot, 'warden'); // (an Assault would rush in to bark: inside the 8 m minimum)
    // two cats standing (dummies: no input) 15 m out, invulnerable to guns but not to the blast's check (0 = off)
    const a = mk(Team.Cats, 1, -15), b = mk(Team.Cats, -1.2, -16);
    let windTicks = 0, movedInWind = 0, px = bot.pos.x, pz = bot.pos.z;
    const events: GameEvent[] = [];
    for (let t = 0; t < 60 * 6 && ordnanceStats(sim).blasts === 0; t++) {
      for (const c of [a, b]) { c.combat && (c.combat.invulnUntil = 0); c.health!.hp = c.health!.max; }
      sim.step();
      events.push(...sim.drainEvents());
      if (bot.ai?.ord.phase === 'wind') { windTicks++; movedInWind = Math.max(movedInWind, Math.hypot(bot.pos.x - px, bot.pos.z - pz)); }
      else { px = bot.pos.x; pz = bot.pos.z; }
    }
    expect(bot.flags & EFlag.Ordnance).toBe(0);
    expect(ordnanceStats(sim).blasts).toBe(1);
    expect(windTicks).toBeGreaterThanOrEqual(ORDNANCE_AI.windTicks);
    expect(movedInWind).toBeLessThan(0.6); // planted (a sprint would cover 3+ m in the wind-up)
    const hurt = new Set(events.filter((e) => e.e === 'hit' && (e as { src: number }).src === bot.id).map((e) => (e as { dst: number }).dst));
    expect(hurt.has(a.id) || hurt.has(b.id)).toBe(true);
  });
});

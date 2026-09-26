// W9 G4a acceptance 2: Base Assault is playable end to end offline. An in-process Room (the same Room + Sim the worker
// runs for ?mode=base-assault) with a human against bots (4 v 4 with the human): the scripted human sends real input
// messages, runs to the cat base, steals the ball, carries it home (slowed), captures, three times, and wins. The bots
// fight as in a deathmatch but don't play the objective yet (G4b). The human is kept on its feet: this test is about the
// objective pipeline (inputs → movement → pickup → carry → capture → score → win → restart), not the gunfight; the
// knockout drop has its own tests (base-assault.test.ts).
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import type { GameEvent, MatchState, ServerMsg } from '../../src/shared/protocol';
import { Btn } from '../../src/shared/input';
import { EFlag, EntityKind, Team } from '../../src/shared/types';
import { PROTOCOL_VERSION, TICK_HZ } from '../../src/shared/constants';
import { baseAssaultBalls, baseAssaultState, checkBallInvariants } from '../../src/sim/match';
import { findPath, navGridFor } from '../../src/sim/ai';
import { BallState, BA_BALL_SEED, BA_REASON } from '../../src/shared/content/modes';

describe('base-assault in a Room: a human vs bots, steal → carry → capture → win', () => {
  it('the scripted human captures three times and the corgis win; carrying is slowed; the match restarts clean', async () => {
    const sim = await Sim.create({ seed: 4 });
    sim.state.matchConfig = { baseAssault: { warmup: 1, endedHold: 2 } };
    const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [4, 4] });
    const events: GameEvent[] = [];
    const snaps: Extract<ServerMsg, { t: 'snap' }>[] = [];
    const conn = { id: 'human', send(m: ServerMsg) { if (m.t === 'snap') { snaps.push(m); events.push(...m.ev); } } };
    const slot = room.join(conn as never, { t: 'hello', v: PROTOCOL_VERSION, name: 'Rex', team: Team.Corgis, cls: 'assault' })!;
    expect([...sim.entities.values()].filter((e) => e.kind === EntityKind.Bot)).toHaveLength(7); // 3 corgi + 4 cat bots
    room.tick(); // the first physics step builds the query structures the nav grid needs
    const g = navGridFor(sim);
    const path: number[] = [];
    let seq = 0, replanAt = 0, goalKey = '', lastPos = { x: 0, z: 0 }, stuckTicks = 0;
    let carryTicks = 0, carryDist = 0, runTicks = 0, runDist = 0;
    const match = (): MatchState => room.match;
    for (let k = 0; k < TICK_HZ * 400 && match().phase !== 'ended'; k++) {
      const h = sim.entities.get(slot.entity)!;
      if (h.health && !h.dead) h.health.hp = h.health.max; // the objective, not the gunfight
      let mx = 0, mz = 0, yaw = h.yaw, buttons = 0;
      const balls = baseAssaultBalls(sim);
      const cat = balls[Team.Cats], own = balls[Team.Corgis];
      const carrying = cat.carrier === h.id;
      // goal: our own dropped ball (send it home), else the cat ball (on its stand or on the ground), else our ring
      const goal = own.state === BallState.Dropped ? { x: own.x, z: own.z, k: 'own' }
        : carrying ? { x: own.flag.x, z: own.flag.z, k: 'ring' }
        : cat.state !== BallState.Carried ? { x: cat.x, z: cat.z, k: `cat${cat.state}` } : null;
      if (!h.dead && goal && match().phase === 'live') {
        if (goal.k !== goalKey || k >= replanAt || path.length === 0) {
          findPath(g, h.pos.x, h.pos.z, goal.x, goal.z, path);
          goalKey = goal.k; replanAt = k + TICK_HZ;
        }
        while (path.length > 2 && Math.hypot(path[0] - h.pos.x, path[1] - h.pos.z) < 1.4) path.splice(0, 2);
        const tx = path.length ? path[0] : goal.x, tz = path.length ? path[1] : goal.z;
        yaw = Math.atan2(-(tx - h.pos.x), -(tz - h.pos.z)); // yaw 0 faces -Z
        mz = 1;
        buttons |= Btn.Sprint;
        const moved = Math.hypot(h.pos.x - lastPos.x, h.pos.z - lastPos.z);
        stuckTicks = moved < 0.02 ? stuckTicks + 1 : 0;
        if (stuckTicks > 20 && stuckTicks % 30 < 3) buttons |= Btn.Jump;
        if (stuckTicks > 90) { path.length = 0; stuckTicks = 0; }
        // measure open-lawn sprint speed with and without the ball (grounded, not blocked)
        if (moved > 0.01 && (h.flags & EFlag.Grounded) && (h.flags & EFlag.Sprinting)) {
          if (carrying) { carryTicks++; carryDist += moved; } else { runTicks++; runDist += moved; }
        }
      }
      lastPos = { x: h.pos.x, z: h.pos.z };
      room.handle(slot.pid, { t: 'input', cmds: [{ seq: ++seq, mx, mz, yaw, pitch: 0, buttons, rt: Math.max(0, sim.tick - 6) }] });
      room.tick();
      const bad = checkBallInvariants(sim);
      if (bad.length) throw new Error(`tick ${sim.tick}: ${bad.join('; ')}`);
    }
    const wonAt = sim.tick / TICK_HZ;
    for (let i = 0; i < 4; i++) room.tick(); // flush the last events (snapshots go out every SNAPSHOT_EVERY ticks)
    const reasons = events.filter((e): e is Extract<GameEvent, { e: 'score' }> => e.e === 'score');
    const captures = reasons.filter((e) => e.reason === BA_REASON.captured);
    expect(match().phase).toBe('ended');
    expect(wonAt).toBeLessThan(400);
    expect(match().winner).toBe(Team.Corgis);
    expect(match().score).toEqual([3, 0]);
    expect(captures).toHaveLength(3);
    expect(captures.every((e) => e.team === Team.Corgis && e.pts === 1)).toBe(true);
    expect(reasons.filter((e) => e.reason === BA_REASON.taken && e.team === Team.Corgis).length).toBeGreaterThanOrEqual(3);
    expect(events.some((e) => e.e === 'pickup' && e.id === slot.entity)).toBe(true);
    // the roster credits the capturer; the snapshot carried the balls to the client
    expect(slot.score).toBeGreaterThanOrEqual(30);
    const last = snaps[snaps.length - 1];
    expect(last.ents.filter((a) => a[1] === EntityKind.Prop && a[5] === BA_BALL_SEED)).toHaveLength(2);
    // carrying was slower on the same kind of ground (per-tick sprint speed, grounded)
    expect(carryTicks).toBeGreaterThan(TICK_HZ * 10);
    expect(runTicks).toBeGreaterThan(TICK_HZ * 10);
    const ratio = (carryDist / carryTicks) / (runDist / runTicks);
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(0.85);
    // the result hold, then a clean restart: balls home, scores reset, the same six props
    const ids = baseAssaultState(sim)!.balls.map((b) => [b.ball, b.stand, b.goal]).flat();
    for (let k = 0; k < TICK_HZ * 3 && match().phase === 'ended'; k++) { room.handle(slot.pid, { t: 'input', cmds: [{ seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }] }); room.tick(); }
    expect(match().phase).toBe('warmup');
    expect(match().score).toEqual([0, 0]);
    expect(baseAssaultBalls(sim).map((b) => b.state)).toEqual([BallState.Home, BallState.Home]);
    expect(baseAssaultState(sim)!.balls.map((b) => [b.ball, b.stand, b.goal]).flat()).toEqual(ids);
    expect(checkBallInvariants(sim)).toEqual([]);
    room.dispose();
  }, 240_000);
});

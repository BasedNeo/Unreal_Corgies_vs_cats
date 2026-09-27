// W9 Q4 P2-1: a human joining a Base Assault room trims a bot to keep the teams even. It used to trim the newest bot even
// when that bot was carrying the enemy ball, which dropped the steal (a second tab could undo a theft). The carrier stays.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import type { ServerMsg } from '../../src/shared/protocol';
import { EFlag, Team } from '../../src/shared/types';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import { baseAssaultBalls, checkBallInvariants } from '../../src/sim/match';

describe('Room.fillBots never trims a ball carrier', () => {
  it('a human joins the thieves team: a non-carrier bot leaves, the carrier keeps the ball', async () => {
    const sim = await Sim.create({ seed: 7 });
    sim.state.matchConfig = { baseAssault: { warmup: 0.05 } }; // steals only count once the match is live
    const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [4, 4] });
    for (let i = 0; i < 30; i++) room.tick();
    const corgiBots = [...room.players.values()].filter((p) => p.bot && p.team === Team.Corgis);
    expect(corgiBots.length).toBe(4);
    const thief = corgiBots[corgiBots.length - 1]; // the newest: the one the old trim removed
    const cat = baseAssaultBalls(sim)[Team.Cats];
    const e = sim.entities.get(thief.entity)!;
    for (let i = 0; i < 240 && baseAssaultBalls(sim)[Team.Cats].carrier !== e.id; i++) {
      sim.placeCharacter(e, cat.x, sim.worldData.height(cat.x, cat.z) + 0.02, cat.z); // stand on the ball until it is handed over
      room.tick();
    }
    expect(baseAssaultBalls(sim)[Team.Cats].carrier).toBe(e.id);
    expect(e.flags & EFlag.Carrier).not.toBe(0);

    const conn = { id: 'late', send(_m: ServerMsg) {} };
    room.join(conn as never, { t: 'hello', v: PROTOCOL_VERSION, name: 'Late', team: Team.Corgis, cls: 'assault' });
    room.tick();

    const after = [...room.players.values()].filter((p) => p.bot && p.team === Team.Corgis);
    expect(after.length).toBe(3);
    expect(after.some((p) => p.pid === thief.pid)).toBe(true);
    expect(baseAssaultBalls(sim)[Team.Cats].carrier).toBe(e.id);
    expect(checkBallInvariants(sim)).toEqual([]);
  }, 60_000);
});

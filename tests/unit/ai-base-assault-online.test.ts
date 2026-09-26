// W9 G4b: Base Assault online. An in-process room per map (the same Room the Node server runs for
// ?mode=base-assault&map=…) with two network clients on emulated links (40 ± 10 ms one way, 1 % loss, the server's delta
// snapshots, JSON input frames, client prediction), one per team, plus bots to 4 v 4. Each client is a headless
// stand-in: a bot brain on its authority entity writes the input that the client sends over the wire (the soak's
// net-bot). The bots play the objective. A full round is played: live → a winner (first to 3) or the horn → the result
// hold → a clean restart. Checked every snapshot: each client's view of both balls equals the authority's at that
// snapshot's tick (no desync of the objective), and at the end the clients agree with the authority on the score,
// the winner and the restart.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { LoopbackSession, type LinkEmulation, type SessionClient } from '../../src/client/net/loopback';
import type { NetClient } from '../../src/client/net/net-client';
import { applyArchetype } from '../../src/sim/ai';
import { baseAssaultState, checkBallInvariants } from '../../src/sim/match';
import { readBaseAssault } from '../../src/client/ui/base-assault-hud';
import { BallState } from '../../src/shared/content/modes';
import { EntityKind, Team } from '../../src/shared/types';
import { TICK_HZ } from '../../src/shared/constants';

const LINK: LinkEmulation = { lagMs: 40, jitterMs: 10, lossPct: 1 };
const CHIP = ['home', 'taken', 'dropped'] as const;

interface Online {
  map: string; phases: string[]; score: [number, number]; winner: number; liveSec: number; captures: number;
  checks: number; mismatches: string[]; clientScores: string[]; clientPhases: string[]; restartClean: boolean; snaps: number[];
}

async function onlineRound(map: string, seed: number): Promise<Online> {
  const sim = await Sim.create({ seed, ...(map === 'west_yard' ? {} : { map }) });
  sim.state.matchConfig = { baseAssault: { warmup: 3, timeLimit: 300, endedHold: 3 } };
  const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [4, 4] });
  // the authority's ball states per tick (for comparing each client snapshot at its own tick)
  const truth = new Map<number, string>();
  const session = new LoopbackSession(room, () => {
    const st = baseAssaultState(sim);
    if (st) truth.set(sim.tick, st.balls.map((b) => `${CHIP[b.state]}:${b.state === BallState.Carried ? b.carrier : 0}`).join(' '));
    truth.delete(sim.tick - 600);
    const bad = checkBallInvariants(sim);
    if (bad.length) throw new Error(`tick ${sim.tick}: ${bad.join('; ')}`);
  });
  const standIn = (_k: number, net: NetClient) => {
    const e = sim.entities.get(net.localEntity);
    if (!e || e.kind !== EntityKind.Player) return {};
    if (!e.ai) applyArchetype(e, 'rifleman', { external: true });
    const c = e.ai!.out;
    return { mx: c.mx, mz: c.mz, yaw: c.yaw, pitch: c.pitch, buttons: c.buttons };
  };
  const out: Online = { map, phases: [], score: [0, 0], winner: -2, liveSec: 0, captures: 0, checks: 0, mismatches: [], clientScores: [], clientPhases: [], restartClean: false, snaps: [] };
  const lastSeen = new Map<SessionClient, number>();
  const check = (c: SessionClient) => {
    const snap = c.net.latest();
    if (!snap || lastSeen.get(c) === snap.tick) return;
    lastSeen.set(c, snap.tick);
    const want = truth.get(snap.tick);
    const model = readBaseAssault(snap.ents, c.net.localEntity, c.net.roster);
    if (!want || !model) return;
    const seen = model.balls.map((b) => `${b.state}:${b.state === 'taken' ? b.carrier : 0}`).join(' ');
    out.checks++;
    if (seen !== want && out.mismatches.length < 5) out.mismatches.push(`${c.id} @${snap.tick}: ${seen} vs ${want}`);
  };
  const a = session.addClient({ id: 'rex', name: 'Rex', up: LINK, down: LINK, seed: 11, team: Team.Corgis, input: standIn, onFrame: (_t, _s, _n) => check(a) });
  const b = session.addClient({ id: 'tom', name: 'Tom', up: LINK, down: LINK, seed: 12, team: Team.Cats, input: standIn, onFrame: (_t, _s, _n) => check(b) });
  let prev = '';
  let liveTicks = 0;
  for (let s = 0; s < 330; s++) {
    await session.run(1000);
    const m = room.match;
    if (m.phase !== prev) { out.phases.push(m.phase); prev = m.phase; }
    if (m.phase === 'live') liveTicks += TICK_HZ;
    if (m.phase === 'ended') break;
  }
  out.score = [room.match.score[0], room.match.score[1]];
  out.captures = out.score[0] + out.score[1];
  out.winner = room.match.winner;
  out.liveSec = liveTicks / TICK_HZ;
  await session.run(600); // the clients get the result
  out.clientScores = [a, b].map((c) => `${c.net.match?.score.join(':')} w${c.net.match?.winner}`);
  out.clientPhases = [a, b].map((c) => c.net.match?.phase ?? '?');
  // the result hold ends: a clean restart, seen by both clients (both balls home, 0:0)
  await session.run(4000);
  const home = (c: SessionClient) => { const md = readBaseAssault(c.net.latest()!.ents, c.net.localEntity); return !!md && md.balls.every((x) => x.state === 'home'); };
  out.restartClean = room.match.phase !== 'ended' && room.match.score[0] + room.match.score[1] === 0 && [a, b].every((c) => c.net.match?.phase !== 'ended' && home(c));
  out.snaps = [a, b].map((c) => c.link.stats.snaps);
  for (const c of [...session.clients]) session.removeClient(c);
  room.dispose();
  return out;
}

describe('G4b Base Assault online: two clients, bots to 4 v 4, one full round per map', () => {
  // Measured (G4b.md): with the two stand-ins (combat brains, no objective play) taking a bot slot on each team, a single
  // 5-minute round on The Lot captured in 2 of 4 seeds, the West Yard in 3 of 3; so captures are gated on the pair.
  it('The Lot and the West Yard: each round plays to a result and restarts cleanly; both clients see the balls and the score exactly as the authority', async () => {
    const only = process.env.G4B_ONLINE?.split(':');
    const rounds: Online[] = [];
    for (const [map, seed] of (only ? [[only[0], Number(only[1])]] : [['the_lot', 2], ['west_yard', 2]]) as [string, number][]) {
      const r = await onlineRound(map, seed);
      console.log(`[g4b online] ${map} seed ${seed}: phases ${r.phases.join(' → ')} · score ${r.score.join(':')} winner ${r.winner} after ${r.liveSec.toFixed(0)} s live · clients ${r.clientScores.join(' / ')} (${r.clientPhases.join(', ')}) · ball checks ${r.checks}, mismatches ${r.mismatches.length} · snaps ${r.snaps.join('/')} · restart clean ${r.restartClean}`);
      rounds.push(r);
    }
    for (const r of rounds) {
      expect(r.phases).toEqual(['warmup', 'live', 'ended']);
      expect(r.clientPhases).toEqual(['ended', 'ended']);
      for (const s of r.clientScores) expect(s).toBe(`${r.score.join(':')} w${r.winner}`);
      expect(r.checks).toBeGreaterThan(1000);
      expect(r.mismatches).toEqual([]);
      expect(r.restartClean).toBe(true);
    }
    if (!only) expect(rounds.reduce((a, r) => a + r.captures, 0)).toBeGreaterThanOrEqual(1); // the bots play the objective online
  }, 1_800_000);
});

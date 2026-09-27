#!/usr/bin/env node
// Q4 verification probe (read-only): prediction for a Base Assault carrier and a thrower online, and a reconnect
// mid-carry. An in-process Room (the one the Node server runs) + LoopbackSession clients on emulated links (JSON input
// frames up, delta snapshots down, the real NetClient + LocalPredictor).
//   npx tsx tools/qa4-net.mjs [--maps west_yard,the_lot] [--links clean,mid,bad] [--bots 2]
// Per map × link, one scripted human (Rex, corgi assault):
//   free   : 12 s running home without the ball (baseline: sprint, jumps, a slide every 3 s)
//   carry  : takes the cat ball, then the same 12 s run home carrying (0.75× speed, no glide)
//   throw  : 12 s running with a throw every 2 s (the carry is handed back for the measurement)
// Reported per phase: reconcile error at acks (mean / p95 / max, m), corrections, snaps.
// Then: the link drops mid-carry, the client reconnects with a fresh hello → the ball drops once, the new client
// sees the true ball state, no invariant violation.
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { LoopbackSession } from '../src/client/net/loopback';
import { baseAssaultBalls, baseAssaultState, checkBallInvariants } from '../src/sim/match';
import { surfaceAt } from '../src/shared/world/queries';
import { BA_BALL_SEED, BallState } from '../src/shared/content/modes';
import { Btn } from '../src/shared/input';
import { EFlag, EntityKind, Team } from '../src/shared/types';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const LINKS = {
  clean: { lagMs: 10, jitterMs: 0, lossPct: 0 },
  mid: { lagMs: 40, jitterMs: 10, lossPct: 1 },
  bad: { lagMs: 75, jitterMs: 15, lossPct: 3 },
};
const r3 = (v) => Math.round(v * 1000) / 1000;
const out = (o) => console.log(JSON.stringify(o));
const stats = (a) => {
  if (!a.length) return { n: 0 };
  const s = [...a].sort((x, y) => x - y);
  return { n: a.length, mean: r3(a.reduce((x, y) => x + y, 0) / a.length), p95: r3(s[Math.floor(0.95 * (s.length - 1))]), max: r3(s.at(-1)) };
};

for (const map of opt('maps', 'west_yard,the_lot').split(',')) {
  for (const lk of opt('links', 'clean,mid,bad').split(',')) {
    const LINK = LINKS[lk];
    const sim = await Sim.create({ seed: 5, ...(map === 'west_yard' ? {} : { map }) });
    sim.state.matchConfig = { baseAssault: { warmup: 2, timeLimit: 900, endedHold: 3, captureLimit: 99 } };
    const nb = Number(opt('bots', 2));
    const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [nb + 1, nb] });
    let violations = 0;
    const session = new LoopbackSession(room, () => { if (checkBallInvariants(sim).length) violations++; });
    const home = baseAssaultState; void home;
    let phase = 'warm', k0 = 0;
    const errs = { free: [], carry: [], throw: [] };
    const corr = { free: 0, carry: 0, throw: 0 };
    const script = (k, net) => {
      const e = sim.entities.get(net.localEntity);
      if (!e || e.dead) return { mx: 0, mz: 0 };
      const st = baseAssaultState(sim);
      if (!st) return {};
      const flag = st.spots[0].flag;
      const yaw = Math.atan2(-(flag.x - e.pos.x), -(flag.z - e.pos.z)) + Math.sin(k / 40) * 0.5;
      const t = k - k0;
      let buttons = Btn.Sprint;
      if (t % 90 === 30) buttons |= Btn.Jump;
      if (t % 180 === 100) buttons |= Btn.Crouch;
      if (phase === 'throw' && t % 120 >= 60 && t % 120 < 75) buttons |= Btn.Throw;
      return { mx: 0, mz: 1, yaw, pitch: 0.25, buttons };
    };
    const a = session.addClient({ id: 'rex', name: 'Rex', up: LINK, down: LINK, seed: 11, team: Team.Corgis, input: script,
      onReconcile: (r) => { if (errs[phase] && Number.isFinite(r.error)) { errs[phase].push(r.error); if (r.correction > 0 || r.replayed > 0) corr[phase]++; } } });
    await session.run(3500);
    const me = () => sim.entities.get(a.net.localEntity);
    const startRun = () => { const b = baseAssaultBalls(sim)[1]; const ang = Math.atan2(b.stand.z - 0, b.stand.x - 0); void ang; };
    void startRun;
    // free run: from 40 m out on the line cat stand → corgi flag
    const st = baseAssaultState(sim);
    const place = (x, z) => { const e = me(); sim.placeCharacter(e, x, surfaceAt(sim.worldData, x, z, e.pos.y + 3).y + 0.02, z); };
    const s1 = st.spots[1].stand, f0 = st.spots[0].flag;
    const L = Math.hypot(f0.x - s1.x, f0.z - s1.z), ux = (f0.x - s1.x) / L, uz = (f0.z - s1.z) / L;
    place(s1.x + ux * 25, s1.z + uz * 25);
    await session.run(600);
    phase = 'free'; k0 = a.seq; const snaps0 = a.net.prediction.snaps;
    await session.run(12000);
    const freeSnaps = a.net.prediction.snaps - snaps0;
    // carry: back to the cat stand (a teleport: one snap, excluded), take the ball, run home
    phase = 'warm';
    const b1 = baseAssaultBalls(sim)[1];
    sim.placeCharacter(me(), b1.x, surfaceAt(sim.worldData, b1.x, b1.z, b1.y).y + 0.02, b1.z);
    await session.run(600);
    const took = st.balls[1].state === BallState.Carried && st.balls[1].carrier === a.net.localEntity;
    phase = 'carry'; k0 = a.seq; const snaps1 = a.net.prediction.snaps;
    let carriedTicks = 0;
    for (let i = 0; i < 24; i++) { await session.run(500); if (st.balls[1].carrier === a.net.localEntity) carriedTicks += 30; }
    const carrySnaps = a.net.prediction.snaps - snaps1;
    const carriedS = carriedTicks / 60;
    // throw: running, a throw every 2 s (the carry handed back each time: measurement only)
    phase = 'warm';
    place(s1.x + ux * 25, s1.z + uz * 25);
    await session.run(600);
    phase = 'throw'; k0 = a.seq; const snaps2 = a.net.prediction.snaps;
    let thrown = 0;
    for (let i = 0; i < 24; i++) {
      const e = me();
      if (e?.ordCarry && !e.ordCarry.carry) { e.ordCarry.carry = true; e.ordCarry.nextThrow = 0; thrown++; }
      await session.run(500);
    }
    const throwSnaps = a.net.prediction.snaps - snaps2;
    // reconnect mid-carry
    phase = 'warm';
    const b2 = baseAssaultBalls(sim)[1];
    if (st.balls[1].state !== BallState.Home) { await session.run(21000); }
    const b3 = baseAssaultBalls(sim)[1];
    sim.placeCharacter(me(), b3.x, surfaceAt(sim.worldData, b3.x, b3.z, b3.y).y + 0.02, b3.z);
    await session.run(800);
    const carryingBeforeDrop = st.balls[1].carrier === a.net.localEntity;
    session.removeClient(a);
    await session.run(200);
    const afterDrop = st.balls[1].state;
    const c = session.addClient({ id: 'rex2', name: 'Rex', up: LINK, down: LINK, seed: 13, team: Team.Corgis, input: () => ({}) });
    await session.run(3000);
    // the client's own snapshot: the cat ball prop (EntityKind.Prop, seed BA_BALL_SEED, team 1): weapon = BallState
    const snap = c.net.latest();
    const ballEnt = snap ? [...(snap.ents.values ? snap.ents.values() : snap.ents)].find((x) => x.kind === EntityKind.Prop && x.seed === BA_BALL_SEED && x.team === 1) : null;
    const seen = ballEnt ? ['home', 'taken', 'dropped'][ballEnt.weapon] : null;
    const truth = ['home', 'taken', 'dropped'][st.balls[1].state];
    void b2;
    out({ map, link: lk, bots: [nb + 1, nb], took, carriedS, thrown,
      free: { ...stats(errs.free), corrections: corr.free, snaps: freeSnaps },
      carry: { ...stats(errs.carry), corrections: corr.carry, snaps: carrySnaps },
      throw: { ...stats(errs.throw), corrections: corr.throw, snaps: throwSnaps },
      reconnect: { carryingBeforeDrop, afterDrop: ['home', 'carried', 'dropped'][afterDrop], rejoined: c.net.connected, clientSees: seen, authority: truth, agree: seen === truth },
      invariantViolations: violations, carrierFlagOnMe: ((me()?.flags ?? 0) & EFlag.Carrier) !== 0 });
    for (const x of [...session.clients]) session.removeClient(x);
    room.dispose();
  }
}

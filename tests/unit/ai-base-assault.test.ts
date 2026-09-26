// W9 G4b: bots play Base Assault (src/sim/ai/base-assault-ai.ts, hooked into tactics.ts updateObjectiveGoal and the
// brain). Roles per team (attack, defend, escort, carry, return, chase) from the roster and both balls, sticky; the
// attackers rally short of the enemy stand and storm it together; carriers run home through fights and never ride.
// Unit tests on the pure planner, behaviour tests on a flat yard, and the statistical gate: bot-only 4v4 matches on the
// West Yard, pooled over seeds (KNOWLEDGE.md §8: chaotic bot statistics are gated on pooled samples). The full
// acceptance (5 seeds x 5 minutes on both maps) runs with G4B_ACCEPT=1.
import os from 'node:os';
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room } from '../../src/host/room';
import { Team, Species, EFlag, EntityKind, type TeamId, type ClassId, type EntityId } from '../../src/shared/types';
import type { GameEvent, MatchState } from '../../src/shared/protocol';
import type { WorldData } from '../../src/shared/world/world-data';
import { TICK_HZ } from '../../src/shared/constants';
import { BA_REASON, BallState } from '../../src/shared/content/modes';
import { baseAssaultState, checkBallInvariants } from '../../src/sim/match';
import { kill } from '../../src/sim/combat';
import { spawnKart } from '../../src/sim/vehicles';
import { baPerf, baRoleOf, planTeam, type BaRole } from '../../src/sim/ai/base-assault-ai';

// ------------------------------------------------------------------------------------------------ helpers

/** A flat 160 m yard with Base Assault bases (WorldData.bases): flags 80 m apart, each stand 6 m in front of its flag. */
function yard(): WorldData {
  const n = 81, cell = 2;
  return {
    seed: 1, name: 'g4b test yard', height: () => 0, halfExtent: 80, killY: -30, props: [],
    terrain: { x0: -80, z0: -80, cell, n, heights: new Float32Array(n * n) },
    spawns: [{ x: 0, y: 0, z: 60, yaw: 0, team: Team.Corgis }, { x: 0, y: 0, z: -60, yaw: Math.PI, team: Team.Cats }],
    bases: [{ team: 0, flag: [0, 0, 40], ballStand: [4, 0, 35] }, { team: 1, flag: [0, 0, -40], ballStand: [-4, 0, -35] }],
  } as WorldData;
}

async function yardSim(seed = 3): Promise<Sim> {
  const sim = await Sim.create({ seed, world: yard() });
  sim.state.room = { mode: 'base-assault' };
  sim.state.matchConfig = { baseAssault: { warmup: 0.05 } };
  sim.state.aiConfig = { vehicles: false };
  run(sim, 0.2);
  expect((sim.state.match as MatchState).phase).toBe('live');
  return sim;
}

/** Step `seconds` (or until `until`), checking the ball invariants after every tick; returns the events. */
function run(sim: Sim, seconds: number, until?: () => boolean, each?: () => void): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds * TICK_HZ); i++) {
    each?.();
    sim.step();
    out.push(...sim.drainEvents());
    const bad = checkBallInvariants(sim);
    if (bad.length) throw new Error(`tick ${sim.tick}: ${bad.join('; ')}`);
    if (until?.()) break;
  }
  return out;
}

const species = (t: TeamId) => (t === Team.Cats ? Species.Cat : Species.Corgi);
function bot(sim: Sim, team: TeamId, x: number, z: number, cls: ClassId = 'assault'): SimEntity {
  return sim.spawnCharacter({ kind: EntityKind.Bot, team, species: species(team), cls, name: `b${team}.${sim.entities.size}`, x, y: 0.02, z, yaw: team === Team.Cats ? Math.PI : 0 });
}
function dummy(sim: Sim, team: TeamId, x: number, z: number): SimEntity {
  return sim.spawnCharacter({ team, species: species(team), cls: 'assault', name: `d${team}.${sim.entities.size}`, x, y: 0.02, z, yaw: 0 });
}
const scoreEvents = (evs: GameEvent[], reason: string) => evs.filter((e): e is Extract<GameEvent, { e: 'score' }> => e.e === 'score' && e.reason === reason);
const living = (sim: Sim) => [...sim.entities.values()].filter((e) => e.char && !e.dead);
const roles = (m: Map<EntityId, BaRole>, ids: SimEntity[]) => ids.map((b) => m.get(b.id));

/** Put a ball in a state for the planner (planTeam reads the state, the carrier and the ball entity's position). */
function setBall(sim: Sim, team: 0 | 1, state: number, carrier: EntityId = -1, at?: { x: number; z: number }): void {
  const b = baseAssaultState(sim)!.balls[team];
  b.state = state as typeof b.state; b.carrier = carrier;
  if (at) { const e = sim.entities.get(b.ball)!; e.pos.x = at.x; e.pos.z = at.z; }
}

// ------------------------------------------------------------------------------------------------ roles

describe('G4b roles (planTeam)', () => {
  it('both balls home: the bot nearest its stand guards it, the rest attack; two guards from six bots', async () => {
    const sim = await yardSim();
    const st = baseAssaultState(sim)!;
    const four = [bot(sim, 0, 0, 20), bot(sim, 0, 3, 34), bot(sim, 0, -10, 0), bot(sim, 0, 10, -10)];
    const r = planTeam(sim, st, 0, living(sim), new Map());
    expect(roles(r, four)).toEqual(['attack', 'defend', 'attack', 'attack']);
    const six = [...four, bot(sim, 0, 6, 30), bot(sim, 0, 20, 0)];
    const r6 = planTeam(sim, st, 0, living(sim), new Map());
    expect(roles(r6, six).filter((x) => x === 'defend')).toHaveLength(2);
    expect(r6.get(six[1].id)).toBe('defend');
    expect(r6.get(six[4].id)).toBe('defend');
  });

  it('our ball taken: everybody hunts the thief but one attacker; when we carry too, one bodyguard stays on ours', async () => {
    const sim = await yardSim();
    const st = baseAssaultState(sim)!;
    const us = [bot(sim, 0, 0, 20), bot(sim, 0, 3, 30), bot(sim, 0, -10, 0), bot(sim, 0, 10, -20)];
    const thief = dummy(sim, 1, 0, 10);
    setBall(sim, 0, BallState.Carried, thief.id);
    const r = planTeam(sim, st, 0, living(sim), new Map());
    expect(roles(r, us).filter((x) => x === 'chase')).toHaveLength(3);
    expect(r.get(us[3].id)).toBe('attack'); // the one farthest from the thief keeps going for their ball
    setBall(sim, 1, BallState.Carried, us[3].id);
    const r2 = planTeam(sim, st, 0, living(sim), new Map());
    expect(r2.get(us[3].id)).toBe('carry');
    expect(r2.get(us[2].id)).toBe('escort'); // the nearest to our carrier
    expect(roles(r2, us).filter((x) => x === 'chase')).toHaveLength(2);
  });

  it('we carry with our ball home: half the rest escort (the nearest to the carrier), the others guard', async () => {
    const sim = await yardSim();
    const st = baseAssaultState(sim)!;
    const us = [bot(sim, 0, 0, -30), bot(sim, 0, 2, -20), bot(sim, 0, 3, 30), bot(sim, 0, 0, 25), bot(sim, 0, 20, 0)];
    setBall(sim, 1, BallState.Carried, us[0].id);
    const r = planTeam(sim, st, 0, living(sim), new Map());
    expect(roles(r, us)).toEqual(['carry', 'escort', 'defend', 'defend', 'escort']);
  });

  it('our ball on the ground: the nearest two go to touch it home', async () => {
    const sim = await yardSim();
    const st = baseAssaultState(sim)!;
    const us = [bot(sim, 0, 0, 20), bot(sim, 0, 3, 30), bot(sim, 0, -10, 0), bot(sim, 0, 10, -20)];
    setBall(sim, 0, BallState.Dropped, -1, { x: -8, z: 4 });
    const r = planTeam(sim, st, 0, living(sim), new Map());
    expect(r.get(us[2].id)).toBe('return');
    expect(r.get(us[0].id)).toBe('return');
    expect(roles(r, us).filter((x) => x === 'return')).toHaveLength(2);
  });

  it('roles are sticky: a guard keeps its post until another bot is 25 m closer to the stand; same input, same plan', async () => {
    const sim = await yardSim();
    const st = baseAssaultState(sim)!;
    const a = bot(sim, 0, 4, 30), b = bot(sim, 0, 4, 10), c = bot(sim, 0, -10, 0);
    const r0 = planTeam(sim, st, 0, living(sim), new Map());
    expect(r0.get(a.id)).toBe('defend');
    // the guard wanders 20 m out, the attacker walks back past it: still the same guard
    sim.placeCharacter(a, 4, 0.02, 12); sim.placeCharacter(b, 4, 0.02, 30);
    const r1 = planTeam(sim, st, 0, living(sim), r0);
    expect(r1.get(a.id)).toBe('defend');
    expect(r1.get(b.id)).toBe('attack');
    expect(planTeam(sim, st, 0, living(sim), r0)).toEqual(r1);
    // 30 m farther than the other bot: now it swaps (the hysteresis is 25 m)
    sim.placeCharacter(a, 4, 0.02, -2);
    const r2 = planTeam(sim, st, 0, living(sim), r1);
    expect(r2.get(b.id)).toBe('defend');
    expect(r2.get(a.id)).toBe('attack');
    expect(r2.get(c.id)).toBe('attack');
  });

  it('a team behind in the last 90 s goes all in: nobody stays on guard', async () => {
    const sim = await yardSim();
    const st = baseAssaultState(sim)!;
    const us = [bot(sim, 0, 3, 30), bot(sim, 0, 0, 20), bot(sim, 0, -10, 0)];
    const m = sim.state.match as MatchState;
    m.score = [0, 1]; m.timeLeft = 200;
    expect(roles(planTeam(sim, st, 0, living(sim), new Map()), us)).toContain('defend');
    m.timeLeft = 80;
    expect(roles(planTeam(sim, st, 0, living(sim), new Map()), us)).toEqual(['attack', 'attack', 'attack']);
    m.score = [1, 1];
    expect(roles(planTeam(sim, st, 0, living(sim), new Map()), us)).toContain('defend');
  });
});

// ------------------------------------------------------------------------------------------------ behaviour

describe('G4b bots play Base Assault (flat yard)', () => {
  it('a lone attacker rallies short of the stand, storms it, steals, runs home and captures', async () => {
    const sim = await yardSim();
    const b = bot(sim, Team.Corgis, 0, 50);
    const seen = new Set<string>();
    const evs = run(sim, 60, () => (sim.state.match as MatchState).score[0] > 0, () => { const r = baRoleOf(b); if (r) seen.add(r); });
    expect(scoreEvents(evs, BA_REASON.taken).map((e) => e.team)).toEqual([Team.Corgis]);
    expect(scoreEvents(evs, BA_REASON.captured).map((e) => e.team)).toEqual([Team.Corgis]);
    expect((sim.state.match as MatchState).score).toEqual([1, 0]);
    expect([...seen].sort()).toEqual(['attack', 'carry']);
    expect(sim.time).toBeLessThan(50);
  });

  it('a guard sends its dropped ball home by touch (well before the 20 s timer)', async () => {
    const sim = await yardSim();
    const guard = bot(sim, Team.Corgis, -12, 22);
    const st = baseAssaultState(sim)!;
    // a cat takes the corgi ball and is knocked out 3 m from the stand, 17 m from the guard
    const s0 = st.spots[0].stand;
    const thief = dummy(sim, Team.Cats, s0.x, s0.z);
    run(sim, 2 / 60);
    expect(thief.flags & EFlag.Carrier).toBeTruthy();
    sim.placeCharacter(thief, s0.x, 0.02, s0.z - 3); // (under 4 m a tick: a run, not a teleport)
    run(sim, 2 / 60);
    kill(sim, thief, { id: guard.id, team: guard.team, weapon: -1 });
    const evs = run(sim, 1 / 60);
    expect(scoreEvents(evs, BA_REASON.dropped)).toHaveLength(1);
    const t0 = sim.time;
    const more = run(sim, 15, () => st.balls[0].state === BallState.Home);
    expect(st.balls[0].state).toBe(BallState.Home);
    expect(sim.time - t0).toBeLessThan(8);
    expect(scoreEvents(more, BA_REASON.returned)).toHaveLength(1);
    expect(baRoleOf(guard) === 'return' || baRoleOf(guard) === 'defend').toBe(true);
  });

  it('bots focus the carrier: with a nearer enemy in view, they turn on the one with the ball', async () => {
    const sim = await yardSim();
    const s0 = baseAssaultState(sim)!.spots[0].stand;
    // a cat steals the corgi ball; a corgi bot 21 m behind it (facing it) also has a cat 11 m away in view
    const thief = dummy(sim, Team.Cats, s0.x, s0.z);
    run(sim, 2 / 60);
    expect(thief.flags & EFlag.Carrier).toBeTruthy();
    const hunter = bot(sim, Team.Corgis, s0.x, s0.z + 21);
    const near = dummy(sim, Team.Cats, s0.x + 4, s0.z + 11);
    run(sim, 0.5);
    expect(hunter.ai!.target).toBe(thief.id);
    kill(sim, thief, { id: hunter.id, team: hunter.team, weapon: -1 });
    run(sim, 1);
    expect(hunter.ai!.target).toBe(near.id);
  });

  it('a carrier never boards: a kart parked by its route is left alone', async () => {
    const sim = await Sim.create({ seed: 5, world: yard() });
    sim.state.room = { mode: 'base-assault' };
    sim.state.matchConfig = { baseAssault: { warmup: 0.05 } };
    run(sim, 0.2);
    const st = baseAssaultState(sim)!;
    // a corgi bot with the cat ball at the cat stand (80 m from home: a trip a kart would win), a kart 3 m away
    const c = bot(sim, Team.Corgis, st.spots[1].stand.x, st.spots[1].stand.z);
    run(sim, 2 / 60);
    expect(c.flags & EFlag.Carrier).toBeTruthy();
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, c.pos.x + 3, 0, c.pos.z + 1, 0);
    let boarding = 0;
    run(sim, 6, undefined, () => { if (c.ai && c.ai.tac.ride.phase !== 'idle') boarding++; });
    expect(boarding).toBe(0);
    expect(kart.kart!.rider).toBe(-1);
    expect(c.flags & EFlag.Carrier).toBeTruthy();
    expect(Math.hypot(c.pos.x - st.spots[0].flag.x, c.pos.z - st.spots[0].flag.z)).toBeLessThan(80 - 25); // on its way home
  });

  it('a carrier runs home through a fight: it keeps sprinting and ignores a shooter behind it', async () => {
    const sim = await yardSim();
    const st = baseAssaultState(sim)!;
    const c = bot(sim, Team.Corgis, st.spots[1].stand.x, st.spots[1].stand.z);
    run(sim, 2 / 60);
    expect(c.flags & EFlag.Carrier).toBeTruthy();
    // a cat behind it, shooting at it: the carrier turns its back and runs
    const cat = bot(sim, Team.Cats, c.pos.x, c.pos.z - 12);
    c.health!.max = c.health!.hp = 5000; // (the run, not the gunfight)
    let sprintTicks = 0, n = 0;
    const home = st.spots[0].flag;
    const d0 = Math.hypot(c.pos.x - home.x, c.pos.z - home.z);
    run(sim, 6, undefined, () => { n++; if (c.flags & EFlag.Sprinting) sprintTicks++; });
    expect(c.ai!.target).toBe(cat.id);
    expect(sprintTicks / n).toBeGreaterThan(0.7);
    const d1 = Math.hypot(c.pos.x - home.x, c.pos.z - home.z);
    expect(d0 - d1).toBeGreaterThan(6 * 9.6 * 0.75 * 0.75); // most of a carrier's sprint
  });
});

// ------------------------------------------------------------------------------------------------ bot matches

interface MatchStats {
  seed: number; map: string; captures: [number, number]; steals: [number, number]; returns: [number, number]; drops: [number, number];
  stuckMax: number; stuckWho: string; carrierRides: number; rides: number; kills: number; deaths: [number, number]; usPerTick: number; flips: number; liveSec: number;
}

/** The soak's stuck rule: wants to move (|input| > 0.5 for 90 % of a 0.5 s window) but moves < 0.25 m. */
function stuckMeter(e: SimEntity) {
  let px = e.pos.x, pz = e.pos.z, odo = 0, want = 0, n = 0, stuck = 0, max = 0;
  return {
    tick() {
      odo += Math.hypot(e.pos.x - px, e.pos.z - pz); px = e.pos.x; pz = e.pos.z;
      if (!e.dead && Math.hypot(e.input.mx, e.input.mz) > 0.5) want++;
      if (++n >= 30) { stuck = !e.dead && want >= 27 && odo < 0.25 ? stuck + 0.5 : 0; max = Math.max(max, stuck); odo = 0; want = 0; n = 0; }
    },
    get max() { return max; },
  };
}

/** One bot-only base-assault match (4 v 4 by default): `live` s after the warm-up, or until a team reaches 3. */
async function botMatch(seed: number, map: string, live: number, perTeam = 4): Promise<MatchStats> {
  const sim = await Sim.create({ seed, ...(map === 'west_yard' ? {} : { map }) });
  sim.state.matchConfig = { baseAssault: { timeLimit: live, endedHold: 2 } };
  const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [perTeam, perTeam] });
  const s: MatchStats = { seed, map, captures: [0, 0], steals: [0, 0], returns: [0, 0], drops: [0, 0], stuckMax: 0, stuckWho: '', carrierRides: 0, rides: 0, kills: 0, deaths: [0, 0], usPerTick: 0, flips: 0, liveSec: 0 };
  const drain = sim.drainEvents.bind(sim);
  let ballEventTick = -1;
  sim.drainEvents = () => {
    const ev = drain();
    for (const x of ev) {
      if (x.e === 'death') { s.kills++; const v = sim.entities.get(x.id); if (v && (v.team === 0 || v.team === 1)) s.deaths[v.team]++; }
      if (x.e !== 'score') continue;
      if (x.reason === BA_REASON.captured) s.captures[x.team as 0 | 1]++;
      else if (x.reason === BA_REASON.taken) s.steals[x.team as 0 | 1]++;
      else if (x.reason === BA_REASON.returned) s.returns[x.team as 0 | 1]++;
      else if (x.reason === BA_REASON.dropped) s.drops[x.team as 0 | 1]++;
      else continue;
      ballEventTick = sim.tick;
    }
    return ev;
  };
  const meters = new Map<number, ReturnType<typeof stuckMeter>>();
  const last = new Map<number, { role: string | null; at: number; prev: string | null }>();
  const boarding = new Map<number, number>();
  const perf0 = baPerf.ms;
  let ended = false, liveTicks = 0;
  for (let i = 0; i < (live + 8) * TICK_HZ && !ended; i++) {
    room.tick();
    const bad = checkBallInvariants(sim);
    if (bad.length) throw new Error(`${map} seed ${seed} tick ${sim.tick}: ${bad.join('; ')}`);
    const m = room.match;
    if (m.phase === 'live') liveTicks++;
    if (m.phase === 'ended') ended = true;
    for (const e of sim.entities.values()) {
      if (!e.char || e.kind !== EntityKind.Bot) continue;
      let mt = meters.get(e.id);
      if (!mt) { mt = stuckMeter(e); meters.set(e.id, mt); }
      mt.tick();
      if (mt.max > s.stuckMax) { s.stuckMax = mt.max; s.stuckWho = `${e.name} (${e.pos.x.toFixed(1)}, ${e.pos.z.toFixed(1)}) ${baRoleOf(e)}`; }
      // a carrier seated, or still on its way to a vehicle a tick after it took the ball (vehicleThink drops that ride)
      const riding = (e.flags & EFlag.Carrier) !== 0 && (!!e.seat || (!!e.ai && e.ai.tac.ride.phase !== 'idle'));
      boarding.set(e.id, riding ? (boarding.get(e.id) ?? 0) + 1 : 0);
      if (e.seat && (e.flags & EFlag.Carrier)) s.carrierRides++;
      else if ((boarding.get(e.id) ?? 0) >= 2) s.carrierRides++;
      // a flicker: a role that flips back within 1 s with no ball event in between
      const r = e.dead ? null : baRoleOf(e);
      const l = last.get(e.id);
      if (!l) last.set(e.id, { role: r, at: sim.tick, prev: null });
      else if (r !== l.role && r !== null && l.role !== null) {
        if (r === l.prev && sim.tick - l.at < TICK_HZ && ballEventTick < l.at) s.flips++;
        last.set(e.id, { role: r, at: sim.tick, prev: l.role });
      }
    }
  }
  for (const e of sim.entities.values()) if (e.ai) s.rides += e.ai.tac.ride.boards;
  s.liveSec = liveTicks / TICK_HZ;
  s.usPerTick = ((baPerf.ms - perf0) * 1000) / sim.tick;
  room.dispose();
  return s;
}

const fmt = (r: MatchStats) => `${r.map} seed ${r.seed}: captures ${r.captures.join('/')} · steals ${r.steals.join('/')} · drops ${r.drops.join('/')} · returns ${r.returns.join('/')} · knockouts ${r.kills} (corgis ${r.deaths[0]} / cats ${r.deaths[1]} down) · rides ${r.rides} · live ${r.liveSec.toFixed(0)} s · stuck max ${r.stuckMax} s${r.stuckMax > 2 ? ` (${r.stuckWho})` : ''} · flicker ${r.flips} · ${r.usPerTick.toFixed(1)} µs/tick`;
/** Timing limits scale with the machine's load (KNOWLEDGE.md §8), strict when idle. */
const load = Math.max(1, os.loadavg()[0] / os.cpus().length);

describe('G4b bot-only 4v4 on the West Yard (pooled seeds)', () => {
  it('three 150 s matches: captures, both teams steal, no bot stuck > 5 s, carriers never ride, roles do not flicker', async () => {
    const runs: MatchStats[] = [];
    for (const seed of [1, 2, 3]) runs.push(await botMatch(seed, 'west_yard', 150));
    console.log(`[g4b] 4v4 West Yard, 150 s:\n  ${runs.map(fmt).join('\n  ')}`);
    const caps = runs.reduce((a, r) => a + r.captures[0] + r.captures[1], 0);
    expect(caps).toBeGreaterThanOrEqual(2);
    expect(runs.filter((r) => r.captures[0] + r.captures[1] > 0).length).toBeGreaterThanOrEqual(2);
    expect(runs.reduce((a, r) => a + r.steals[0], 0)).toBeGreaterThan(0);
    expect(runs.reduce((a, r) => a + r.steals[1], 0)).toBeGreaterThan(0);
    for (const r of runs) {
      expect(r.stuckMax).toBeLessThanOrEqual(5);
      expect(r.carrierRides).toBe(0);
      expect(r.flips).toBeLessThanOrEqual(2);
      expect(r.usPerTick).toBeLessThan(60 * load); // the new code, team plans included (8 bots)
    }
  }, 900_000);

  it('is deterministic: the same seed plays the same match', async () => {
    const a = await botMatch(4, 'west_yard', 40), b = await botMatch(4, 'west_yard', 40);
    const strip = (r: MatchStats) => ({ ...r, usPerTick: 0 });
    expect(strip(b)).toEqual(strip(a));
    expect(a.steals[0] + a.steals[1]).toBeGreaterThan(0);
  }, 300_000);
});

// The card's acceptance, 5 seeds x a 5-minute match on each map (about 10-20 min on a busy 4-core box):
//   G4B_ACCEPT=1 npx vitest run tests/unit/ai-base-assault.test.ts -t acceptance
describe.runIf(process.env.G4B_ACCEPT)('G4b acceptance: bot-only 4v4, 5 seeds x 5 min per map', () => {
  for (const map of ['west_yard', 'the_lot']) {
    it(`${map}: >= 1 capture in 4 of 5 matches, both teams score across the seeds, no bot stuck > 5 s`, async () => {
      const runs: MatchStats[] = [];
      for (const seed of [1, 2, 3, 4, 5]) runs.push(await botMatch(seed, map, 300));
      console.log(`[g4b acceptance] ${map}:\n  ${runs.map(fmt).join('\n  ')}`);
      expect(runs.filter((r) => r.captures[0] + r.captures[1] >= 1).length).toBeGreaterThanOrEqual(4);
      expect(runs.reduce((a, r) => a + r.captures[0], 0)).toBeGreaterThan(0);
      expect(runs.reduce((a, r) => a + r.captures[1], 0)).toBeGreaterThan(0);
      for (const r of runs) { expect(r.stuckMax).toBeLessThanOrEqual(5); expect(r.carrierRides).toBe(0); }
    }, 3_600_000);
  }
  it('tick cost of the new code with 8 and 16 bots', async () => {
    const r8 = await botMatch(1, 'west_yard', 120, 4), r16 = await botMatch(1, 'west_yard', 120, 8);
    console.log(`[g4b cost] 8 bots ${r8.usPerTick.toFixed(1)} µs/tick · 16 bots ${r16.usPerTick.toFixed(1)} µs/tick (load ${load.toFixed(1)})`);
    expect(r16.usPerTick).toBeLessThan(120 * load);
  }, 1_800_000);
});

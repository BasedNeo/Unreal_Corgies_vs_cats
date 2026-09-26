// W9 G4a Base Assault, authoritative rules: base placement (bases data → E4 flags → spawn fallback), steal, carry, capture,
// the own-ball-home rule and the stalemate relief, drops on knockout (surface snap, water), returns (timer, defender
// touch), same-tick contests, carriers that leave / switch / teleport / fall out of the world, restarts, the win rule.
// Every sim tick of every test checks the no-duplication / no-loss invariants.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room } from '../../src/host/room';
import { Team, Species, EFlag, EntityKind, type TeamId, type ClassId } from '../../src/shared/types';
import type { GameEvent, MatchState } from '../../src/shared/protocol';
import { Btn, emptyInput } from '../../src/shared/input';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import { createWorldData } from '../../src/shared/world/world-data';
import { surfaceAt, waterAt } from '../../src/shared/world/queries';
import { battleOf, TOWER_DECK } from '../../src/shared/world/fortifications';
import { baseAssaultBalls, baseAssaultState, checkBallInvariants, type BallInfo } from '../../src/sim/match';
import { kill, respawnNow } from '../../src/sim/combat';
import { swapKit } from '../../src/sim/interact/ordnance';
import { spawnKart } from '../../src/sim/vehicles';
import { navGridFor } from '../../src/sim/ai';
import { cellIndex } from '../../src/sim/ai/nav';
import {
  BASE_ASSAULT, BA_BALL, BA_BALL_SEED, BA_GOAL_SEED, BA_PICKUP_ITEM, BA_REASON, BA_STAND_SEED, BallState,
} from '../../src/shared/content/modes';

type Over = Partial<typeof BASE_ASSAULT>;
const HOME_Y = BA_BALL.standTop + BA_BALL.radius;

async function baSim(over: Over = {}, opts: { seed?: number; map?: string; world?: ReturnType<typeof createWorldData> } = {}): Promise<Sim> {
  const seed = opts.seed ?? 9;
  const sim = await Sim.create({ seed, map: opts.map, world: opts.world });
  sim.state.room = { mode: 'base-assault' };
  sim.state.matchConfig = { baseAssault: { warmup: 0.05, ...over } };
  return sim;
}

/** Step `seconds` (or until `until`), checking the ball invariants after every tick; returns the events. */
function run(sim: Sim, seconds: number, until?: () => boolean): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    sim.step();
    out.push(...sim.drainEvents());
    const bad = checkBallInvariants(sim);
    if (bad.length) throw new Error(`tick ${sim.tick}: ${bad.join('; ')}`);
    if (until?.()) break;
  }
  return out;
}

const match = (sim: Sim) => sim.state.match as MatchState;
type Side = 0 | 1;
const ball = (sim: Sim, team: Side): BallInfo => baseAssaultBalls(sim)[team];
const spot = (sim: Sim, team: Side) => baseAssaultState(sim)!.spots[team];
const species = (t: TeamId) => (t === Team.Cats ? Species.Cat : Species.Corgi);
const scoreEvents = (evs: GameEvent[], reason: string) => evs.filter((e): e is Extract<GameEvent, { e: 'score' }> => e.e === 'score' && e.reason === reason);

function pet(sim: Sim, team: TeamId, x: number, z: number, cls: ClassId = 'assault', y?: number): SimEntity {
  return sim.spawnCharacter({ team, species: species(team), cls, name: `p${team}`, x, y: y ?? sim.worldData.height(x, z) + 0.02, z, yaw: 0 });
}

/** A pet of `team` touching ball `of` where it sits now (at its feet, so the ball is inside its reach). */
function petAtBall(sim: Sim, team: Side, of: Side, dx = 0, dz = 0): SimEntity {
  const b = ball(sim, of);
  const x = b.x + dx, z = b.z + dz;
  return pet(sim, team, x, z, 'assault', surfaceAt(sim.worldData, x, z, b.y).y + 0.02);
}

/** Warm-up over, match live. */
async function liveSim(over: Over = {}, opts: Parameters<typeof baSim>[1] = {}): Promise<Sim> {
  const sim = await baSim(over, opts);
  run(sim, 0.2);
  expect(match(sim).phase).toBe('live');
  return sim;
}

/** A corgi stealing the cat ball (placed at the cat stand, one tick). */
function steal(sim: Sim, team: Side = Team.Corgis): SimEntity {
  const c = petAtBall(sim, team, team === Team.Corgis ? Team.Cats : Team.Corgis);
  run(sim, 1 / 60);
  return c;
}

describe('base-assault: bases', () => {
  it('West Yard: each ball stand sits beside its E4 flag on open, reachable lawn, and both runs are the same length', async () => {
    const sim = await liveSim();
    const st = baseAssaultState(sim)!;
    const g = navGridFor(sim);
    const battle = battleOf(sim.worldData)!;
    for (const t of [0, 1] as const) {
      const s = st.spots[t];
      expect(s.source).toBe('battle');
      const flag = battle.banners.find((b) => b.team === t && b.icon !== false)!;
      expect([s.flag.x, s.flag.z]).toEqual([flag.x, flag.z]); // the ring is the flag
      const d = Math.hypot(s.stand.x - s.flag.x, s.stand.z - s.flag.z);
      expect(d).toBeGreaterThan(3);
      expect(d).toBeLessThan(6.5);
      const c = cellIndex(g, s.stand.x, s.stand.z);
      expect(g.walk[c]).toBe(1);
      expect(g.region[c]).toBe(g.mainRegion);
      for (const sp of sim.worldData.spawns) expect(Math.hypot(sp.x - s.stand.x, sp.z - s.stand.z)).toBeGreaterThan(2.5);
      expect(Math.abs(s.stand.y - sim.worldData.height(s.stand.x, s.stand.z))).toBeLessThan(0.05); // on the lawn
      const b = ball(sim, t);
      expect(b.state).toBe(BallState.Home);
      expect(b.y).toBeCloseTo(s.stand.y + HOME_Y, 6);
    }
    const [a, b] = st.spots;
    const run0 = Math.hypot(b.stand.x - a.flag.x, b.stand.z - a.flag.z), run1 = Math.hypot(a.stand.x - b.flag.x, a.stand.z - b.flag.z);
    expect(Math.abs(run0 - run1) / Math.max(run0, run1)).toBeLessThan(0.03);
    // snapshot convention: three Prop entities per team, cls -1, told apart by seed
    const props = [...sim.entities.values()].filter((e) => e.kind === EntityKind.Prop).map((e) => sim.toState(e));
    for (const seed of [BA_BALL_SEED, BA_STAND_SEED, BA_GOAL_SEED]) {
      const list = props.filter((p) => p.seed === seed);
      expect(list.map((p) => p.team).sort()).toEqual([0, 1]);
      for (const p of list) expect(p.cls).toBe(-1);
    }
  });

  it('WorldData.bases wins over the E4 layout; The Lot (no bases yet) falls back to its spawn centroids', async () => {
    const w = createWorldData(9, 'west_yard');
    w.bases = [{ team: 1, flag: [40, w.height(40, 60), 60], ballStand: [36, 0, 58] }, { team: 0, flag: [-30, w.height(-30, -60), -60], ballStand: [-26, 0, -58] }];
    const sim = await liveSim({}, { world: w });
    expect(spot(sim, 0).source).toBe('bases');
    expect([spot(sim, 0).flag.x, spot(sim, 0).stand.x, spot(sim, 1).flag.z, spot(sim, 1).stand.z]).toEqual([-30, -26, 60, 58]);
    expect(spot(sim, 1).stand.y).toBeCloseTo(surfaceAt(w, 36, 58, 1.5).y, 6); // settled on what is under the point

    const lot = await liveSim({}, { map: 'the_lot' });
    const g = navGridFor(lot);
    for (const t of [0, 1] as const) {
      const s = spot(lot, t);
      expect(s.source).toBe('spawns');
      const sp = lot.worldData.spawns.filter((p) => p.team === t);
      const cx = sp.reduce((a, p) => a + p.x, 0) / sp.length, cz = sp.reduce((a, p) => a + p.z, 0) / sp.length;
      expect(Math.hypot(s.flag.x - cx, s.flag.z - cz)).toBeLessThan(14);
      const c = cellIndex(g, s.stand.x, s.stand.z);
      expect(g.walk[c] === 1 && g.region[c] === g.mainRegion).toBe(true);
      expect(Math.hypot(s.stand.x - s.flag.x, s.stand.z - s.flag.z)).toBeLessThan(6.5);
    }
  });
});

describe('base-assault: steal, carry, capture', () => {
  it('an attacker touching the enemy ball takes it; a defender touching its own ball at home does nothing', async () => {
    const sim = await liveSim();
    const guard = petAtBall(sim, Team.Cats, Team.Cats); // the cat ball's own defender, right on it
    let evs = run(sim, 0.5);
    expect(ball(sim, Team.Cats).state).toBe(BallState.Home);
    expect(guard.flags & EFlag.Carrier).toBe(0);
    const dog = petAtBall(sim, Team.Corgis, Team.Cats, 0.3);
    evs = run(sim, 1 / 60);
    const b = ball(sim, Team.Cats);
    expect(b.state).toBe(BallState.Carried);
    expect(b.carrier).toBe(dog.id);
    expect(dog.flags & EFlag.Carrier).toBeTruthy();
    expect(scoreEvents(evs, BA_REASON.taken)).toEqual([{ e: 'score', team: Team.Corgis, pts: 0, reason: BA_REASON.taken }]);
    expect(evs).toContainEqual({ e: 'pickup', id: dog.id, item: BA_PICKUP_ITEM });
    // the ball rides the carrier (snapshot: position, carrier id, away flag)
    sim.placeCharacter(dog, dog.pos.x + 2, dog.pos.y, dog.pos.z);
    run(sim, 1 / 60);
    const s = sim.toState(sim.entities.get(b.id)!);
    expect([s.weapon, s.ammo, s.flags & EFlag.Busy]).toEqual([BallState.Carried, dog.id, EFlag.Busy]);
    expect(s.x).toBeCloseTo(dog.pos.x, 6);
    expect(s.y).toBeCloseTo(dog.pos.y + BA_BALL.carryHeight, 6);
  });

  it('a carrier in its own ring with its own ball home captures: +1, the ball goes home, the carrier is free', async () => {
    const sim = await liveSim();
    const dog = steal(sim);
    const ring = spot(sim, Team.Corgis).flag;
    // walk in (small steps: a jump of more than a few metres in one tick is a teleport and sends the ball home)
    let evs: GameEvent[] = [];
    const path = 12;
    const from = { x: ring.x + 8, z: ring.z };
    sim.placeCharacter(dog, from.x, sim.worldData.height(from.x, from.z) + 0.02, from.z);
    const b0 = baseAssaultState(sim)!.balls[Team.Cats];
    b0.lastX = dog.pos.x; b0.lastY = dog.pos.y; b0.lastZ = dog.pos.z; // (the test moved it; not a teleport)
    for (let i = 1; i <= path && match(sim).score[0] === 0; i++) {
      const x = from.x - (8 * i) / path;
      sim.placeCharacter(dog, x, surfaceAt(sim.worldData, x, ring.z, dog.pos.y + 1).y + 0.02, ring.z);
      evs.push(...run(sim, 1 / 60));
    }
    expect(match(sim).score).toEqual([1, 0]);
    expect(ball(sim, Team.Cats).state).toBe(BallState.Home);
    expect(dog.flags & EFlag.Carrier).toBe(0);
    expect(scoreEvents(evs, BA_REASON.captured)).toEqual([{ e: 'score', team: Team.Corgis, pts: 1, reason: BA_REASON.captured }]);
    const ringDist = Math.hypot(dog.pos.x - ring.x, dog.pos.z - ring.z);
    expect(ringDist).toBeLessThanOrEqual(BASE_ASSAULT.captureRadius + 1e-6);
    expect(ringDist).toBeGreaterThan(BASE_ASSAULT.captureRadius - 0.8); // captured on entering, not deep inside
    evs = run(sim, 0.5);
    expect(scoreEvents(evs, BA_REASON.captured)).toHaveLength(0); // once
  });

  it('no capture while your own ball is away; the stalemate relief opens the ring after both are away for stalemateAfter s', async () => {
    expect(BASE_ASSAULT.stalemateAfter).toBe(60);
    const sim = await liveSim({ stalemateAfter: 3 });
    const dog = steal(sim, Team.Corgis);
    const cat = steal(sim, Team.Cats);
    expect(ball(sim, 0).state).toBe(BallState.Carried);
    expect(ball(sim, 1).state).toBe(BallState.Carried);
    // the corgi carrier stands in its own ring: blocked while the corgi ball is away
    const ring = spot(sim, Team.Corgis).flag;
    const goal = sim.entities.get(baseAssaultState(sim)!.balls[0].goal)!;
    sim.placeCharacter(dog, ring.x + 1.2, surfaceAt(sim.worldData, ring.x + 1.2, ring.z, ring.y + 1).y + 0.02, ring.z);
    baseAssaultState(sim)!.balls[1].lastX = dog.pos.x; baseAssaultState(sim)!.balls[1].lastY = dog.pos.y; baseAssaultState(sim)!.balls[1].lastZ = dog.pos.z;
    let evs = run(sim, 1);
    expect(match(sim).score).toEqual([0, 0]);
    expect(goal.flags & EFlag.Busy).toBe(EFlag.Busy); // the ring reads "blocked"
    expect(sim.toState(goal).hp).toBeGreaterThan(0.5); // the relief countdown
    expect(sim.toState(goal).hp).toBeLessThan(2.5);
    evs = run(sim, 2.5, () => match(sim).score[0] > 0);
    expect(match(sim).score).toEqual([1, 0]); // relief: captured with its own ball still carried by the cat
    expect(scoreEvents(evs, BA_REASON.captured)).toHaveLength(1);
    expect(sim.state.match && (sim.state.baseAssault as { relief: boolean }).relief).toBe(false); // a ball is home again
    expect(ball(sim, 0).carrier).toBe(cat.id); // the cat still has the corgi ball
    expect(goal.flags & EFlag.Busy).toBe(EFlag.Busy);
  });
});

describe('base-assault: drops and returns', () => {
  it('a knocked-out carrier drops the ball at the death spot, on the surface under it; it goes home after returnTime s', async () => {
    const sim = await liveSim({ returnTime: 2 });
    const dog = steal(sim);
    // die mid-air over open lawn 20 m out from the cat stand: the ball lands on the ground under the death spot
    const s = spot(sim, Team.Cats).stand;
    const x = s.x + 14, z = s.z - 14;
    sim.placeCharacter(dog, x, sim.worldData.height(x, z) + 2.5, z);
    const bt = baseAssaultState(sim)!.balls[1];
    bt.lastX = dog.pos.x; bt.lastY = dog.pos.y; bt.lastZ = dog.pos.z;
    kill(sim, dog, { id: dog.id, team: dog.team, weapon: -1 });
    let evs = run(sim, 1 / 60);
    const b = ball(sim, Team.Cats);
    expect(b.state).toBe(BallState.Dropped);
    expect(Math.hypot(b.x - x, b.z - z)).toBeLessThan(0.01); // the death spot (the corpse may settle a hair)
    expect(b.y).toBeCloseTo(surfaceAt(sim.worldData, x, z, dog.pos.y + 1).y + BA_BALL.radius, 3);
    expect(dog.flags & EFlag.Carrier).toBe(0);
    expect(scoreEvents(evs, BA_REASON.dropped)).toEqual([{ e: 'score', team: Team.Cats, pts: 0, reason: BA_REASON.dropped }]);
    const st = sim.toState(sim.entities.get(b.id)!);
    expect(st.hp).toBeGreaterThan(1.8);
    expect(st.maxHp).toBe(2);
    evs = run(sim, 2.1, () => ball(sim, Team.Cats).state === BallState.Home);
    expect(ball(sim, Team.Cats).state).toBe(BallState.Home);
    expect(sim.tick).toBeGreaterThan(0);
    expect(scoreEvents(evs, BA_REASON.returned)).toHaveLength(1);
  });

  it('a ball dropped on the watchtower deck stays on the deck (a surface, not the lawn below)', async () => {
    const sim = await liveSim();
    const dog = steal(sim);
    const tower = battleOf(sim.worldData)!.towers[1].route.at(-1)!; // the cat tower's deck standing point
    sim.placeCharacter(dog, tower[0], tower[1] + 0.02, tower[2]);
    const bt = baseAssaultState(sim)!.balls[1];
    bt.lastX = dog.pos.x; bt.lastY = dog.pos.y; bt.lastZ = dog.pos.z;
    kill(sim, dog, { id: dog.id, team: dog.team, weapon: -1 });
    run(sim, 1 / 60);
    expect(ball(sim, Team.Cats).state).toBe(BallState.Dropped);
    expect(ball(sim, Team.Cats).y).toBeCloseTo(tower[1] + BA_BALL.radius, 1);
    expect(tower[1]).toBeCloseTo(TOWER_DECK + sim.worldData.height(tower[0], tower[2]), 0);
  });

  it('a defender touching its dropped ball sends it home at once; an attacker touching it picks it up', async () => {
    const sim = await liveSim();
    const dog = steal(sim);
    const x = dog.pos.x + 12, z = dog.pos.z;
    sim.placeCharacter(dog, x, sim.worldData.height(x, z) + 0.02, z);
    const bt = baseAssaultState(sim)!.balls[1];
    bt.lastX = dog.pos.x; bt.lastY = dog.pos.y; bt.lastZ = dog.pos.z;
    kill(sim, dog, { id: dog.id, team: dog.team, weapon: -1 });
    run(sim, 1 / 60);
    expect(ball(sim, 1).state).toBe(BallState.Dropped);
    const pup = petAtBall(sim, Team.Corgis, Team.Cats);
    run(sim, 1 / 60);
    expect(ball(sim, 1).carrier).toBe(pup.id); // a teammate of the fallen carrier picks it up
    const bt2 = baseAssaultState(sim)!.balls[1];
    kill(sim, pup, { id: pup.id, team: pup.team, weapon: -1 });
    run(sim, 1 / 60);
    expect(ball(sim, 1).state).toBe(BallState.Dropped);
    expect(bt2.carrier).toBe(-1);
    const evs = (petAtBall(sim, Team.Cats, Team.Cats), run(sim, 1 / 60));
    expect(ball(sim, 1).state).toBe(BallState.Home);
    expect(scoreEvents(evs, BA_REASON.returned)).toEqual([{ e: 'score', team: Team.Cats, pts: 0, reason: BA_REASON.returned }]);
  });

  it('two grabs on the same tick: one carrier only (the nearest; a tie goes to the lower id; a defender wins a tie on a dropped ball)', async () => {
    const sim = await liveSim();
    const a = petAtBall(sim, Team.Corgis, Team.Cats, 0.25, 0);
    const b = petAtBall(sim, Team.Corgis, Team.Cats, -0.25, 0);
    run(sim, 1 / 60);
    expect(ball(sim, 1).carrier).toBe(Math.min(a.id, b.id));
    expect([a, b].filter((p) => p.flags & EFlag.Carrier)).toHaveLength(1);
    // unequal: the nearer one wins even with the higher id
    const sim2 = await liveSim();
    const far = petAtBall(sim2, Team.Cats, Team.Corgis, 0.45, 0);
    const near = petAtBall(sim2, Team.Cats, Team.Corgis, 0, 0.05);
    run(sim2, 1 / 60);
    expect(near.id).toBeGreaterThan(far.id);
    expect(ball(sim2, 0).carrier).toBe(near.id);
    // a dropped ball touched by an attacker and a defender at the same distance on the same tick: it goes home
    const x = spot(sim2, 1).stand.x + 10, z = spot(sim2, 1).stand.z;
    sim2.placeCharacter(near, x, sim2.worldData.height(x, z) + 0.02, z);
    const bt = baseAssaultState(sim2)!.balls[0];
    bt.lastX = near.pos.x; bt.lastY = near.pos.y; bt.lastZ = near.pos.z;
    kill(sim2, near, { id: near.id, team: near.team, weapon: -1 });
    run(sim2, 1 / 60);
    expect(ball(sim2, 0).state).toBe(BallState.Dropped);
    petAtBall(sim2, Team.Cats, Team.Corgis, 0.3, 0);
    petAtBall(sim2, Team.Corgis, Team.Corgis, -0.3, 0);
    run(sim2, 1 / 60);
    expect(ball(sim2, 0).state).toBe(BallState.Home);
  });
});

describe('base-assault: carriers that leave, switch, teleport, swim', () => {
  it('the carrier disconnects: the ball drops where it last stood', async () => {
    const sim = await liveSim();
    const dog = steal(sim);
    const at = { x: dog.pos.x, z: dog.pos.z };
    sim.removeEntity(dog.id);
    const evs = run(sim, 1 / 60);
    expect(ball(sim, 1).state).toBe(BallState.Dropped);
    expect(Math.hypot(ball(sim, 1).x - at.x, ball(sim, 1).z - at.z)).toBeLessThan(1e-6);
    expect(scoreEvents(evs, BA_REASON.dropped)).toHaveLength(1);
  });

  it('team or class switch at the deploy point (the Room respawns a new entity): the ball drops; a kiosk kit swap keeps it', async () => {
    for (const msg of [{ t: 'team', team: Team.Cats }, { t: 'class', cls: 'overwatch' }] as const) {
      const w = createWorldData(5, 'west_yard');
      const sp = w.spawns.find((s) => s.team === Team.Corgis)!;
      // a test layout: the cat ball stand right on a corgi deploy point
      w.bases = [{ team: 0, flag: [-30, w.height(-30, -40), -40], ballStand: [-20, 0, -40] }, { team: 1, flag: [30, w.height(30, 40), 40], ballStand: [sp.x + 0.3, sp.y, sp.z] }];
      const sim = await Sim.create({ seed: 5, world: w });
      sim.state.matchConfig = { baseAssault: { warmup: 0.05 } };
      const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [0, 0] });
      const evs: GameEvent[] = [];
      const conn = { id: 'h', send(m: { t: string; ev?: GameEvent[] }) { if (m.t === 'snap' && m.ev) evs.push(...m.ev); } };
      const slot = room.join(conn as never, { t: 'hello', v: PROTOCOL_VERSION, name: 'Rex', team: Team.Corgis, cls: 'assault' })!;
      for (let i = 0; i < 20; i++) room.tick();
      const h = sim.entities.get(slot.entity)!;
      sim.placeCharacter(h, sp.x, sp.y, sp.z);
      room.tick();
      expect(ball(sim, 1).carrier).toBe(h.id);
      evs.length = 0;
      expect(room.handle(slot.pid, msg as never)).toBe('ok');
      for (let i = 0; i < 4; i++) { room.tick(); expect(checkBallInvariants(sim)).toEqual([]); }
      expect(slot.entity).not.toBe(h.id); // respawned as a new entity
      expect(sim.entities.has(h.id)).toBe(false);
      expect(scoreEvents(evs, BA_REASON.dropped), `${msg.t}: the ball drops where the old body stood`).toHaveLength(1);
      // (a corgi re-deployed on that spot may pick it straight back up: that is a new, legal steal)
      expect(ball(sim, 1).state === BallState.Dropped || ball(sim, 1).carrier === slot.entity).toBe(true);
      expect(ball(sim, 1).carrier).not.toBe(h.id);
      room.dispose();
    }
    // Ordnance kiosk kit swap: same entity, same ball, still slowed, and now a Skyraider that can't glide
    const sim = await liveSim();
    const dog = steal(sim);
    swapKit(dog, 'skyraider');
    run(sim, 0.2);
    expect(ball(sim, 1).carrier).toBe(dog.id);
    expect(dog.flags & EFlag.Carrier).toBeTruthy();
  });

  it('a carrier whose inputs stall and then arrive in a burst (Room freeze + catch-up, 4 inputs a tick) keeps the ball', async () => {
    const sim = await Sim.create({ seed: 6 });
    sim.state.matchConfig = { baseAssault: { warmup: 0.05 } };
    const room = new Room(sim, { mode: 'base-assault', botsPerTeam: [0, 0] });
    const slot = room.join({ id: 'h', send() {} } as never, { t: 'hello', v: PROTOCOL_VERSION, name: 'Rex', team: Team.Corgis, cls: 'infiltrator' })!;
    let seq = 0;
    const cmd = () => ({ seq: ++seq, mx: 0, mz: 1, yaw: Math.PI / 2, pitch: 0, buttons: Btn.Sprint, rt: Math.max(0, sim.tick - 4) });
    for (let i = 0; i < 20; i++) { room.handle(slot.pid, { t: 'input', cmds: [cmd()] }); room.tick(); }
    const h = sim.entities.get(slot.entity)!;
    const s = spot(sim, 1).stand;
    sim.placeCharacter(h, s.x, s.y + 0.02, s.z);
    for (let i = 0; i < 30; i++) { room.handle(slot.pid, { t: 'input', cmds: [cmd()] }); room.tick(); expect(checkBallInvariants(sim)).toEqual([]); }
    expect(ball(sim, 1).carrier).toBe(h.id);
    for (let i = 0; i < 30; i++) { room.tick(); expect(checkBallInvariants(sim)).toEqual([]); } // the link stalls: frozen
    let maxStep = 0, prev = { ...h.pos };
    room.handle(slot.pid, { t: 'input', cmds: Array.from({ length: 30 }, cmd) }); // everything arrives at once
    for (let i = 0; i < 40; i++) {
      room.handle(slot.pid, { t: 'input', cmds: [cmd()] });
      room.tick();
      maxStep = Math.max(maxStep, Math.hypot(h.pos.x - prev.x, h.pos.z - prev.z));
      prev = { ...h.pos };
      expect(checkBallInvariants(sim)).toEqual([]);
    }
    expect(slot.net.catchups).toBeGreaterThan(5);
    expect(maxStep).toBeGreaterThan(0.25); // several inputs a tick really happened…
    expect(maxStep).toBeLessThan(1.5); // …far under the 4 m teleport line
    expect(ball(sim, 1).carrier).toBe(h.id); // still carried
    room.dispose();
  });

  it('a carrier that falls below killY, or is respawned alive (teleported), loses the ball: it goes straight home', async () => {
    const sim = await liveSim();
    const dog = steal(sim);
    sim.placeCharacter(dog, dog.pos.x, sim.worldData.killY - 1, dog.pos.z); // out of the world
    let evs = run(sim, 1 / 60);
    expect(ball(sim, 1).state).toBe(BallState.Home);
    expect(dog.flags & EFlag.Carrier).toBe(0);
    expect(scoreEvents(evs, BA_REASON.returned)).toHaveLength(1);
    const pup = steal(sim);
    respawnNow(sim, pup); // alive, moved to a corgi spawn (a restart or a script would do this)
    evs = run(sim, 1 / 60);
    expect(ball(sim, 1).state).toBe(BallState.Home);
    expect(pup.flags & EFlag.Carrier).toBe(0);
  });

  it('a carrier wades through the pond with the ball; knocked out there, the ball floats on the surface; a wading defender returns it', async () => {
    const sim = await liveSim();
    const pond = sim.worldData.water!.find((w) => w.id === 'pond')!;
    const dog = steal(sim);
    const px = pond.x + 3, pz = pond.z;
    sim.placeCharacter(dog, px, sim.worldData.height(px, pz) + 0.02, pz);
    const bt = baseAssaultState(sim)!.balls[1];
    bt.lastX = dog.pos.x; bt.lastY = dog.pos.y; bt.lastZ = dog.pos.z;
    dog.input = { ...emptyInput(1), mz: 1, yaw: Math.PI / 2 }; // wade west
    run(sim, 1);
    expect(waterAt(sim.worldData, dog.pos.x, dog.pos.z)).not.toBeNull();
    expect(dog.pos.y).toBeLessThan(pond.surfaceY - 0.1); // really in the water
    expect(ball(sim, 1).carrier).toBe(dog.id);
    kill(sim, dog, { id: dog.id, team: dog.team, weapon: -1 });
    run(sim, 1 / 60);
    const b = ball(sim, 1);
    expect(b.state).toBe(BallState.Dropped);
    expect(b.y).toBeCloseTo(pond.surfaceY + BA_BALL.float, 6); // floating, reachable
    const cat = pet(sim, Team.Cats, b.x + 0.2, b.z);
    run(sim, 0.1);
    expect(cat.pos.y).toBeLessThan(pond.surfaceY);
    expect(ball(sim, 1).state).toBe(BallState.Home);
  });

  it('seated characters never touch a ball; a carrier cannot ride a kart (a free pet can)', async () => {
    const sim = await liveSim();
    const dog = steal(sim);
    const kart = spawnKart(sim, 'mower_kart', Team.Corgis, dog.pos.x + 1.6, dog.pos.y, dog.pos.z, 0);
    run(sim, 0.2);
    dog.input = { ...emptyInput(2), buttons: Btn.Interact };
    run(sim, 1 / 60);
    dog.input = { ...emptyInput(3) };
    run(sim, 0.1);
    expect(dog.flags & EFlag.Mounted).toBe(0);
    expect(dog.seat).toBeUndefined();
    expect(kart.kart!.rider).toBe(-1);
    // the same pet without the ball boards
    const free = pet(sim, Team.Corgis, kart.pos.x - 1.4, kart.pos.z + 0.5);
    run(sim, 0.2);
    free.input = { ...emptyInput(2), buttons: Btn.Interact };
    run(sim, 1 / 60);
    expect(kart.kart!.rider).toBe(free.id);
    // a seated attacker parked on the dropped corgi ball doesn't pick it up
    const sim2 = await liveSim();
    const cat = steal(sim2, Team.Cats);
    kill(sim2, cat, { id: cat.id, team: cat.team, weapon: -1 });
    run(sim2, 1 / 60);
    expect(ball(sim2, 0).state).toBe(BallState.Dropped);
    const rider = petAtBall(sim2, Team.Cats, Team.Corgis);
    rider.flags |= EFlag.Mounted; // as the vehicle lane seats a rider
    run(sim2, 0.2);
    expect(ball(sim2, 0).state).toBe(BallState.Dropped);
  });
});

describe('base-assault: match flow', () => {
  it('first to captureLimit wins; the horn gives the leader the win, equal is a draw; the restart puts every ball home', async () => {
    const sim = await liveSim({ captureLimit: 2, endedHold: 0.5, stalemateAfter: 0.5 });
    const st = baseAssaultState(sim)!;
    const capture = (team: Side) => {
      const c = steal(sim, team);
      const ring = spot(sim, team).flag;
      sim.placeCharacter(c, ring.x, surfaceAt(sim.worldData, ring.x, ring.z, ring.y + 2).y + 0.02, ring.z);
      const b = st.balls[team === Team.Corgis ? 1 : 0];
      b.lastX = c.pos.x; b.lastY = c.pos.y; b.lastZ = c.pos.z;
      run(sim, 1 / 60);
      sim.removeEntity(c.id);
    };
    capture(Team.Cats);
    capture(Team.Corgis);
    expect(match(sim).score).toEqual([1, 1]);
    // mid-carry at the win: the corgi ball is being carried when the corgis score their second (the relief allows it)
    const cat = steal(sim, Team.Cats);
    const dog = steal(sim, Team.Corgis);
    run(sim, 0.6);
    expect(baseAssaultState(sim)!.relief).toBe(true);
    const goal = sim.toState(sim.entities.get(st.balls[0].goal)!);
    expect([goal.weapon, goal.flags & EFlag.Busy]).toEqual([1, 0]); // the ring reads open
    const ring = spot(sim, Team.Corgis).flag;
    sim.placeCharacter(dog, ring.x, surfaceAt(sim.worldData, ring.x, ring.z, ring.y + 2).y + 0.02, ring.z);
    Object.assign(st.balls[1], { lastX: dog.pos.x, lastY: dog.pos.y, lastZ: dog.pos.z });
    run(sim, 1 / 60);
    expect(match(sim).phase).toBe('ended');
    expect(match(sim).winner).toBe(Team.Corgis);
    expect(baseAssaultBalls(sim).every((b) => b.state === BallState.Home)).toBe(true);
    expect(cat.flags & EFlag.Carrier).toBe(0);
    const ids = st.balls.map((b) => [b.ball, b.stand, b.goal]).flat();
    run(sim, 1, () => match(sim).phase === 'warmup');
    expect(match(sim).phase).toBe('warmup');
    expect(match(sim).score).toEqual([0, 0]);
    expect(baseAssaultState(sim)!.balls.map((b) => [b.ball, b.stand, b.goal]).flat()).toEqual(ids); // same entities
    // the horn
    const sim2 = await liveSim({ timeLimit: 1, endedHold: 5 });
    run(sim2, 1.2, () => match(sim2).phase === 'ended');
    expect([match(sim2).phase, match(sim2).winner]).toEqual(['ended', -1]);
  });

  it('a restart mid-carry clears the carrier and sends both balls home (no ball left behind, none duplicated)', async () => {
    const sim = await liveSim({ timeLimit: 2, endedHold: 0.3 });
    const dog = steal(sim, Team.Corgis);
    const cat = steal(sim, Team.Cats);
    run(sim, 2.5, () => match(sim).phase === 'warmup');
    expect(match(sim).phase).toBe('warmup');
    for (const p of [dog, cat]) expect(p.flags & EFlag.Carrier).toBe(0);
    expect(baseAssaultBalls(sim).map((b) => b.state)).toEqual([BallState.Home, BallState.Home]);
    expect([...sim.entities.values()].filter((e) => e.seed === BA_BALL_SEED && e.kind === EntityKind.Prop)).toHaveLength(2);
    // warm-up: nobody can take a ball
    petAtBall(sim, Team.Corgis, Team.Cats);
    run(sim, 0.02);
    expect(ball(sim, 1).state).toBe(BallState.Home);
  });
});

describe('base-assault: invariants and determinism under chaos', () => {
  /** A seeded brawl around both bases: pets pop up next to balls, rings and each other, die, leave, respawn. */
  async function chaos(seed: number): Promise<{ log: string; captures: number; steals: number; drops: number; returns: number }> {
    const sim = await liveSim({ returnTime: 3, stalemateAfter: 2, captureLimit: 99 }, { seed: 3 });
    let s = seed >>> 0;
    const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pets: SimEntity[] = [];
    for (let i = 0; i < 8; i++) pets.push(pet(sim, (i % 2) as TeamId, 0, -40 + i * 5));
    const log: string[] = [];
    let captures = 0, steals = 0, drops = 0, returns = 0;
    for (let k = 0; k < 60 * 45; k++) {
      if (k % 4 === 0) {
        const alive = pets.filter((p) => !p.removed);
        const p = alive[Math.floor(rnd() * alive.length)];
        const r = rnd();
        const st = baseAssaultState(sim)!;
        const target = r < 0.35 ? baseAssaultBalls(sim)[Math.floor(rnd() * 2)] : null;
        for (const c of [...pets]) {
          if (c.removed || c.dead || !(c.flags & EFlag.Carrier)) continue;
          const q = rnd();
          if (q < 0.97) {
            // a carrier runs for its ring, 3.5 m per hop (a longer jump in one tick would count as a teleport)
            const ring = st.spots[c.team as 0 | 1].flag;
            const dx = ring.x - c.pos.x, dz = ring.z - c.pos.z, d = Math.hypot(dx, dz), step = Math.min(3.5, d);
            const x = c.pos.x + (dx / (d || 1)) * step, z = c.pos.z + (dz / (d || 1)) * step;
            sim.placeCharacter(c, x, surfaceAt(sim.worldData, x, z, c.pos.y + 1.5).y + 0.02, z);
          } else if (q < 0.985) kill(sim, c, { id: c.id, team: c.team, weapon: -1 });
          else if (q < 0.993) sim.placeCharacter(c, c.pos.x, sim.worldData.killY - 1, c.pos.z); // over the edge
          else { sim.removeEntity(c.id); pets.push(pet(sim, c.team, 0, 0)); } // leaves mid-carry
        }
        if (!p || (p.flags & EFlag.Carrier)) {
          // (carriers moved above)
        } else if (p && !p.dead && target && target.state !== BallState.Carried) {
          const x = target.x + (rnd() - 0.5) * 1.2, z = target.z + (rnd() - 0.5) * 1.2;
          sim.placeCharacter(p, x, surfaceAt(sim.worldData, x, z, target.y + 0.5).y + 0.02, z);
        } else if (p && !p.dead && r < 0.55) {
          const ring = st.spots[p.team as 0 | 1].flag;
          const x = ring.x + (rnd() - 0.5) * 5, z = ring.z + (rnd() - 0.5) * 5;
          sim.placeCharacter(p, x, surfaceAt(sim.worldData, x, z, ring.y + 2).y + 0.02, z);
        } else if (p && !p.dead && r < 0.7) kill(sim, p, { id: p.id, team: p.team, weapon: -1 });
        else if (p && p.dead && r < 0.9) respawnNow(sim, p);
        else if (p && r > 0.985) { sim.removeEntity(p.id); pets.push(pet(sim, p.team, 0, 0)); }
        else if (p && !p.dead) { const x = p.pos.x + (rnd() - 0.5) * 3, z = p.pos.z + (rnd() - 0.5) * 3; sim.placeCharacter(p, x, sim.worldData.height(x, z) + 0.02, z); }
      }
      for (const p of pets) if (!p.removed && !p.dead) p.input = { ...emptyInput(k), mx: Math.sin(k * 0.05 + p.id), mz: Math.cos(k * 0.03 + p.id), yaw: p.id, buttons: k % 90 === p.id % 90 ? Btn.Jump : 0 };
      sim.step();
      for (const ev of sim.drainEvents()) {
        if (ev.e === 'score') {
          log.push(`${sim.tick}:${ev.team}:${ev.reason}:${ev.pts}`);
          if (ev.reason === BA_REASON.captured) captures++;
          if (ev.reason === BA_REASON.taken) steals++;
          if (ev.reason === BA_REASON.dropped) drops++;
          if (ev.reason === BA_REASON.returned) returns++;
        }
      }
      const bad = checkBallInvariants(sim);
      if (bad.length) throw new Error(`seed ${seed} tick ${sim.tick}: ${bad.join('; ')}`);
    }
    for (const b of baseAssaultBalls(sim)) log.push(`${b.state}:${b.x.toFixed(4)},${b.y.toFixed(4)},${b.z.toFixed(4)}`);
    sim.dispose();
    return { log: log.join('\n'), captures, steals, drops, returns };
  }

  it('45 s of seeded chaos: never a duplicated or lost ball, every transition exercised, the same seed replays exactly', async () => {
    const a = await chaos(11);
    expect(a.steals).toBeGreaterThan(20);
    expect(a.drops).toBeGreaterThan(5);
    expect(a.returns).toBeGreaterThan(10);
    expect(a.captures).toBeGreaterThanOrEqual(3);
    const b = await chaos(11);
    expect(b.log).toBe(a.log);
    const c = await chaos(12);
    expect(c.log).not.toBe(a.log);
  }, 120_000);
});

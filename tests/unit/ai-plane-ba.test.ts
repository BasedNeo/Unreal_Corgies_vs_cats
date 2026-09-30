// W10 N3 (ai-3): a plane pilot in Base Assault. PLANE_MODES (src/sim/ai/tactics.ts) gains 'base-assault', and the mode's
// objective goal lets the team's pilot (its lowest-id Overwatch or Skyraider room bot, B2b) go for the Rooftop Hangar
// while its Base Assault role is attack (the surplus: guards, escorts, returners, chasers and the carrier stay on the
// ball), once its team has made its first storm: the opening push goes in with everyone. A pilot at kick-off cost 14 % of
// the captures (seeds 6-15); after the first storm 3 % over 20 seeds, within noise, with a flight in 19 of 20 matches.
// Carriers never fly: G4a refuses them a seat, vehicleThink drops a carrier's boarding, planeGoal skips them, and a
// carrier's role is carry. The tests:
//   - West Yard, bot-only 4v4: a bot flies the plane and its gun fires (2 seeds); nobody takes the hangar goal before its
//     team's first storm; no carrier is ever seated or headed for the hangar;
//   - the pilot on its way to the hangar steals the enemy ball: it drops the hangar goal, runs the ball home, never mounts;
//   - The Lot has no hangar (no Rooftops): its Base Assault bots never take a plane goal.
// Mutation-checked: without 'base-assault' in PLANE_MODES no bot flies (test 1 fails); without the first-storm rule a pilot
// leaves at kick-off (test 1 fails); with both carrier guards gone (planeGoal's isCarrier and the attack-role gate) the
// thief keeps walking to the hangar (test 2 fails).
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room } from '../../src/host/room';
import { EFlag, EntityKind } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import { TICK_HZ } from '../../src/shared/constants';
import { baseAssaultBalls, baseAssaultState, checkBallInvariants } from '../../src/sim/match';
import { baPushCount, baRoleOf } from '../../src/sim/ai/base-assault-ai';
import { surfaceAt } from '../../src/shared/world/queries';

type Tac = { plane: boolean; goal: string; ride: { phase: string } };
const tacOf = (e: SimEntity) => (e.ai as { tac?: Tac } | undefined)?.tac;

/** A bot-only 4v4 Base Assault room, played to the horn at `seconds` (the capture limit out of reach). */
async function baRoom(seed: number, map: string, seconds = 300): Promise<{ sim: Sim; room: Room }> {
  const sim = await Sim.create({ seed, map });
  sim.state.matchConfig = { baseAssault: { timeLimit: seconds, endedHold: 2, captureLimit: 99 } };
  return { sim, room: new Room(sim, { mode: 'base-assault', botsPerTeam: [4, 4] }) };
}

describe('N3 Base Assault: a bot flies the RC plane', () => {
  it('West Yard bot-only 4v4: a bot flies and the plane\'s gun fires (2 seeds); nobody heads for the hangar before its team\'s first storm; no carrier is ever seated or headed for the hangar', async () => {
    const rows: string[] = [];
    let rounds = 0;
    // W11 F3: seeds 2 and 6 (were 1 and 6). West Yard Base Assault now paths without N3's thin pass (nav.ts
    // thinPassFor), and seed 1's first sortie moved from 34.5 s to 211 s (chaotic: seeds 1-8 now sortie at 34.5-248.5 s,
    // a flight in 10 of 10 matches of 300 s). Seed 2 sorties at 57.7 s, seed 6 at 34.5 s: inside the 90 s window.
    for (const seed of [2, 6]) {
      const { sim, room } = await baRoom(seed, 'west_yard');
      const evs: GameEvent[] = [];
      const drain = sim.drainEvents.bind(sim);
      sim.drainEvents = () => { const a = drain(); evs.push(...a); return a; };
      const planes = new Set<number>();
      let flights = 0, flewAt = -1, carrierSeated = 0, carrierHangar = 0, fired = 0, pilot = '', early = 0;
      const goalAt: [number, number] = [-1, -1], stormAt: [number, number] = [-1, -1];
      for (let i = 0; i < 90 * TICK_HZ && !(flewAt > 0 && sim.time > flewAt + 15); i++) {
        room.tick();
        const pushes = baPushCount(sim);
        for (const t of [0, 1] as const) if (stormAt[t] < 0 && pushes[t] > 0) stormAt[t] = sim.time;
        for (const e of sim.entities.values()) {
          if (e.kind !== EntityKind.Bot || !tacOf(e)?.plane || (e.team !== 0 && e.team !== 1)) continue;
          if (goalAt[e.team] < 0) goalAt[e.team] = sim.time;
          if (pushes[e.team] === 0) early++;
        }
        for (const ev of evs.splice(0)) {
          if (ev.e === 'ability' && ev.ability === 'mount') {
            const v = sim.entities.get(ev.id), r = v?.plane ? sim.entities.get(v.plane.rider) : undefined;
            if (v?.plane && r?.kind === EntityKind.Bot) { flights++; planes.add(v.id); if (flewAt < 0) { flewAt = sim.time; pilot = `${r.name} ${r.cls}`; } }
          } else if (ev.e === 'fire' && planes.has(ev.id)) fired++;
        }
        for (const e of sim.entities.values()) {
          if (!e.char || !(e.flags & EFlag.Carrier)) continue;
          if (e.seat) carrierSeated++;
          if (tacOf(e)?.plane && tacOf(e)?.goal === 'step') carrierHangar++;
        }
        expect(checkBallInvariants(sim)).toEqual([]);
      }
      rows.push(`seed ${seed}: first storms at ${stormAt.map((v) => v.toFixed(1)).join(' / ')} s, hangar goals from ${goalAt.map((v) => v.toFixed(1)).join(' / ')} s, ${flights} flight(s), first at ${flewAt.toFixed(1)} s by ${pilot}, ${fired} rounds`);
      expect(early, `seed ${seed}: a hangar goal before the team's first storm`).toBe(0);
      expect(goalAt[0] >= 0 || goalAt[1] >= 0, `seed ${seed}: a pilot goes`).toBe(true);
      expect(flights, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(carrierSeated, `seed ${seed}: a carrier seated`).toBe(0);
      expect(carrierHangar, `seed ${seed}: a carrier headed for the hangar`).toBe(0);
      rounds += fired;
      room.dispose();
    }
    console.log(`[n3 plane] West Yard Base Assault: ${rows.join(' · ')}`);
    expect(rounds).toBeGreaterThan(0);
  }, 300_000);

  it('the pilot on its way to the hangar steals the enemy ball: it drops the hangar goal, runs home, never mounts', async () => {
    for (const seed of [2, 5]) {
      const { sim, room } = await baRoom(seed, 'west_yard');
      let pilot: SimEntity | undefined;
      for (let i = 0; i < 40 * TICK_HZ && !pilot; i++) {
        room.tick();
        for (const e of sim.entities.values()) if (e.kind === EntityKind.Bot && tacOf(e)?.plane) pilot = e;
      }
      expect(pilot, `seed ${seed}: a pilot heads for the hangar`).toBeDefined();
      const p = pilot!;
      for (let i = 0; i < TICK_HZ; i++) room.tick();                          // on its way
      expect(room.match.phase).toBe('live');
      expect(tacOf(p)?.plane, `seed ${seed}: still the pilot`).toBe(true);
      expect(p.seat, `seed ${seed}: not up yet`).toBeFalsy();
      // onto the enemy ball: the steal
      const ball = baseAssaultBalls(sim)[1 - p.team];
      sim.placeCharacter(p, ball.x, surfaceAt(sim.worldData, ball.x, ball.z, ball.y).y + 0.02, ball.z);
      p.health!.max = p.health!.hp = 5000;                                  // (the run home, not the gunfight)
      for (let i = 0; i < 3 && !(p.flags & EFlag.Carrier); i++) room.tick();
      expect(p.flags & EFlag.Carrier, `seed ${seed}: the steal`).toBeTruthy();
      const home = baseAssaultState(sim)!.spots[p.team as 0 | 1].flag;
      const d0 = Math.hypot(p.pos.x - home.x, p.pos.z - home.z);
      let hangarTicks = 0, boarding = 0, seated = 0;
      for (let i = 0; i < 8 * TICK_HZ && (p.flags & EFlag.Carrier); i++) {
        room.tick();
        const t = tacOf(p)!;
        if (i >= 0.6 * TICK_HZ && t.plane) hangarTicks++;                  // (the goal is re-planned every 0.5 s)
        if (t.ride.phase !== 'idle') boarding++;
        if (p.seat) seated++;
      }
      expect(hangarTicks, `seed ${seed}: the thief still headed for the hangar`).toBe(0);
      expect(boarding, `seed ${seed}: the thief boarding`).toBe(0);
      expect(seated, `seed ${seed}: the thief seated`).toBe(0);
      if (p.flags & EFlag.Carrier) {
        expect(baRoleOf(p), `seed ${seed}`).toBe('carry');
        expect(Math.hypot(p.pos.x - home.x, p.pos.z - home.z), `seed ${seed}: on its way home`).toBeLessThan(d0 - 20);
      }
      room.dispose();
    }
  }, 300_000);

  it('The Lot has no hangar: its Base Assault bots never take a plane goal', async () => {
    const { sim, room } = await baRoom(2, 'the_lot');
    let planeGoals = 0;
    for (let i = 0; i < 20 * TICK_HZ; i++) {
      room.tick();
      for (const e of sim.entities.values()) if (e.kind === EntityKind.Bot && tacOf(e)?.plane) planeGoals++;
    }
    expect([...sim.entities.values()].some((e) => e.terminal?.id === 'plane_hangar')).toBe(false);
    expect(planeGoals).toBe(0);
    room.dispose();
  }, 120_000);
});

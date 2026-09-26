// B2a with the real brain: these tests need the brain hook (docs/handoff/B2.md §3 — brain.ts think() hands the tick to
// tactics.ts vehicleThink right after perception). Without it bots never drive, and each test says so first.
//   · 4v4 TDM (bots only, the soak's match config): bots drive a kart in every match and ram enemies; no kart sits
//     stuck under throttle for more than 5 s
//   · chapter 3 "The Garage Job", bot-only: a pup drives the getaway kart into the garden-gate zone and is seated there
//     when the step completes (the `vehicle` rule holds without the bot-only waiver)
//   · chapter 3 with a human in the squad: the getaway kart is the human's, no pup takes it
//   · the same seed plays out identically
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room } from '../../src/host/room';
import { createDefaultSystems } from '../../src/sim/systems';
import { adventureSystems, adventureState } from '../../src/sim/adventure';
import { breakDestructibles } from '../../src/sim/destruct';
import { driveStats } from '../../src/sim/ai/drive';
import { EFlag, EntityKind, Species, Team, type ClassId, type TeamId } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import { TICK_HZ } from '../../src/shared/constants';
import { chapterById } from '../../src/shared/content/chapters';

function withAdventure() {
  const sys = createDefaultSystems();
  return sys.some((s) => s.name === 'adventure') ? sys : [...sys, ...adventureSystems()];
}

const HOOK_MISSING = 'the B2a brain hook is not in brain.ts (docs/handoff/B2.md §3): bots never reach vehicleThink';

/** The soak's TDM match config (tools/soak.mjs) and a 4v4 bot lineup. */
const TDM = { tdm: { warmup: 3, killLimit: 12, timeLimit: 45, endedHold: 5 } };
const LINEUP: [TeamId, ClassId][] = [
  [Team.Corgis, 'assault'], [Team.Corgis, 'overwatch'], [Team.Corgis, 'breacher'], [Team.Corgis, 'warden'],
  [Team.Cats, 'assault'], [Team.Cats, 'overwatch'], [Team.Cats, 'breacher'], [Team.Cats, 'warden'],
];

interface TdmRun {
  mounts: number; teams: Set<number>; rammed: number; ramKills: number; kills: number; kartStuckMax: number; digest: string;
  /** B2b: plane boardings by bots, rounds its gun fired, hits by pilots, planes lost. */
  flights: number; rounds: number; strafeHits: number; planesLost: number;
}

async function tdm(seed: number, seconds = 50): Promise<TdmRun> {
  const sim = await Sim.create({ seed });
  const room = new Room(sim, { mode: 'team-deathmatch', botsPerTeam: [0, 0] });
  sim.state.matchConfig = TDM;
  for (const [team, cls] of LINEUP) room.addBot(team, cls);
  const evs: GameEvent[] = [];
  const drain = sim.drainEvents.bind(sim);
  sim.drainEvents = () => { const a = drain(); evs.push(...a); return a; };
  const out: TdmRun = { mounts: 0, teams: new Set(), rammed: 0, ramKills: 0, kills: 0, kartStuckMax: 0, digest: '', flights: 0, rounds: 0, strafeHits: 0, planesLost: 0 };
  const planes = new Set<number>();
  const stuck = new Map<number, { x: number; z: number; t: number }>();
  for (let i = 0; i < seconds * TICK_HZ; i++) {
    room.tick();
    for (const ev of evs.splice(0)) {
      if (ev.e === 'ability' && ev.ability === 'mount') {
        const k = sim.entities.get(ev.id);
        const r = k?.kart ? sim.entities.get(k.kart.rider) : k?.plane ? sim.entities.get(k.plane.rider) : undefined;
        if (r?.kind === EntityKind.Bot && k?.kart) { out.mounts++; out.teams.add(r.team); }
        if (r?.kind === EntityKind.Bot && k?.plane) { out.flights++; planes.add(k.id); }
      } else if (ev.e === 'fire' && planes.has(ev.id)) {
        out.rounds++;
      } else if (ev.e === 'hit') {
        const s = sim.entities.get(ev.src), d = sim.entities.get(ev.dst);
        const v = s?.seat ? sim.entities.get(s.seat.vehicle) : undefined;
        if (v?.kart && d?.char) out.rammed++;       // a pet seated in a kart can only hurt pets by ramming
        if (v?.plane && d?.char) out.strafeHits++;
      } else if (ev.e === 'death') {
        out.kills++;
        const k = sim.entities.get(ev.by);
        if (k && k.flags & EFlag.Mounted) out.ramKills++;
      }
    }
    for (const id of planes) { const pl = sim.entities.get(id); if (!pl || pl.removed) { planes.delete(id); out.planesLost++; } }
    // a driven kart under throttle that doesn't move (0.25 m per 0.5 s window) is stuck
    if (i % (TICK_HZ / 2) === 0) {
      for (const k of sim.entities.values()) {
        if (!k.kart || k.kart.rider < 0) continue;
        const r = sim.entities.get(k.kart.rider)!;
        let s = stuck.get(k.id);
        if (!s) { s = { x: k.pos.x, z: k.pos.z, t: 0 }; stuck.set(k.id, s); }
        const moved = Math.hypot(k.pos.x - s.x, k.pos.z - s.z);
        s.t = Math.abs(r.input.mz) > 0.3 && moved < 0.25 ? s.t + 0.5 : 0;
        out.kartStuckMax = Math.max(out.kartStuckMax, s.t);
        s.x = k.pos.x; s.z = k.pos.z;
      }
    }
  }
  out.digest = [...sim.entities.values()].filter((e) => e.char || e.kart).map((e) => `${e.id}:${e.pos.x.toFixed(3)}:${e.pos.z.toFixed(3)}:${e.flags}`).join('|');
  room.dispose();
  return out;
}

describe('bots drive karts with the real brain (needs the B2a brain hook)', () => {
  // Rams are a low-rate event (≈ 0.5–0.9 per 45 s match) that shifts with any change to the yard's cover, so they are
  // pooled over six matches. Measured (W7): the open yard 6 ram hits over seeds 1–6 (and failed ≥ 3 on two of three
  // 3-seed batches); E4's fortified yard 3 (its sack cover blocks the clear drive lines a ram needs, by design). This
  // gate asks that bots ram in ordinary matches at all; the rate is a design metric for the soak and the playtest.
  it('4v4 TDM: a kart ride in every match, rams on enemies, no kart stuck > 5 s (6 seeds)', async () => {
    const calls = driveStats.hookCalls;
    const runs: TdmRun[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      runs.push(await tdm(seed));
      if (seed === 1) expect(driveStats.hookCalls, HOOK_MISSING).toBeGreaterThan(calls);
    }
    console.log('[b2a] TDM 45 s matches:', runs.map((r, i) => `seed ${i + 1}: ${r.mounts} rides (teams ${[...r.teams].join('+')}), ${r.rammed} ram hits, ${r.ramKills} ram kills / ${r.kills} kills, kart stuck max ${r.kartStuckMax} s`).join(' · '));
    for (const r of runs) {
      expect(r.mounts).toBeGreaterThanOrEqual(1);
      expect(r.kartStuckMax).toBeLessThanOrEqual(5);
    }
    expect(runs.filter((r) => r.teams.size === 2).length).toBeGreaterThanOrEqual(4); // both teams use their karts
    expect(runs.reduce((a, r) => a + r.rammed, 0)).toBeGreaterThanOrEqual(2);
  }, 600000);

  it('TDM with the same seed plays out identically', async () => {
    const calls = driveStats.hookCalls;
    const a = await tdm(4, 25), b = await tdm(4, 25);
    expect(driveStats.hookCalls, HOOK_MISSING).toBeGreaterThan(calls);
    expect(a.mounts).toBeGreaterThanOrEqual(1);
    expect(b).toEqual(a);
  }, 200000);

  it('chapter 3, bot-only: a pup drives the getaway kart into the gate zone; seated there when the step completes', async () => {
    const def = chapterById('garage_job')!;
    const escape = def.steps.findIndex((s) => s.id === 'escape');
    const tr = def.steps[escape].trigger as { params: { x: number; z: number; radius: number } };
    const calls = driveStats.hookCalls;
    const sim = await Sim.create({ seed: 1, systems: withAdventure() });
    const room = new Room(sim, { mode: 'adventure', chapter: 'garage_job', botsPerTeam: [4, 0] });
    let started = -1, done = -1, driverIn = false, walkerIn = false;
    const found: { driver: SimEntity | null } = { driver: null };
    // who is in the zone at the moment the runner scores the step (mid-tick: the chapter's end dismounts everyone after)
    const emit = sim.emit.bind(sim);
    sim.emit = (ev) => {
      if (started >= 0 && done < 0 && ev.e === 'score' && (ev.reason === 'step' || ev.reason === 'chapter')) {
        done = sim.tick;
        const inZone = (x: number, z: number) => Math.hypot(x - tr.params.x, z - tr.params.z) <= tr.params.radius;
        for (const e of sim.entities.values()) {
          if (e.kind !== EntityKind.Bot || e.team !== Team.Corgis || e.dead) continue;
          // (a driven vehicle inside the zone counts for its driver, as in the runner)
          const v = e.seat ? sim.entities.get(e.seat.vehicle) : undefined;
          if (e.flags & EFlag.Mounted && (inZone(e.pos.x, e.pos.z) || (v && inZone(v.pos.x, v.pos.z)))) { driverIn = true; found.driver = e; }
          else if (inZone(e.pos.x, e.pos.z)) walkerIn = true;
        }
      }
      emit(ev);
    };
    for (let i = 0; i < (def.par * 2 + 30) * TICK_HZ && done < 0; i++) {
      room.tick();
      sim.drainEvents();
      const st = adventureState(sim)!;
      if (st.phase === 'live' && st.step === escape && started < 0) started = sim.tick;
    }
    for (let i = 0; i < TICK_HZ && adventureState(sim)!.phase !== 'complete'; i++) { room.tick(); sim.drainEvents(); }
    expect(driveStats.hookCalls, HOOK_MISSING).toBeGreaterThan(calls);
    expect(started).toBeGreaterThan(0);
    expect(done).toBeGreaterThan(started);
    const secs = (done - started) / TICK_HZ;
    console.log(`[b2a] garage_job escape, bot-only: ${secs.toFixed(1)} s (driver ${found.driver?.name} ${found.driver?.cls}), chapter ${adventureState(sim)!.time} s vs par ${def.par} s`);
    expect(driverIn).toBe(true);        // a seated pup was inside the zone: the `vehicle` rule holds for real
    expect(walkerIn).toBe(false);       // it beat the pups on foot there
    expect(secs).toBeLessThan(30);
    expect(adventureState(sim)!.phase).toBe('complete');
    room.dispose();
  }, 300000);

  it('chapter 3 with a human in the squad: no pup takes the getaway kart', async () => {
    const sim = await Sim.create({ seed: 1, systems: withAdventure() });
    sim.state.room = { mode: 'adventure', chapter: 'garage_job' };
    sim.state.adventureConfig = { briefing: 0.1, briefingWait: 0.1 };
    const h = sim.spawnCharacter({ kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls: 'breacher', name: 'Rex', ownerPid: 'p1', x: 80, y: sim.worldData.height(80, -30) + 0.05, z: -30 });
    for (let i = 0; i < 3; i++) sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: `Pup ${i + 1}`, x: 84 + i, y: sim.worldData.height(84, -44) + 0.05, z: -44 });
    let seq = 1;
    const tick = () => { sim.setInput(h.id, { seq: seq++, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }); sim.step(); sim.drainEvents(); h.health!.hp = h.health!.max; };
    for (let i = 0; i < 60 && adventureState(sim)?.phase !== 'live'; i++) tick();
    breakDestructibles(sim, 'garage_breach_wall');
    sim.placeCharacter(h, 97, sim.worldData.height(97, -66) + 0.05, -66);
    for (let i = 0; i < 5; i++) tick();
    breakDestructibles(sim, 'tuna_stack');
    for (let i = 0; i < 5; i++) tick();
    expect(adventureState(sim)!.step).toBe(3);
    const calls = driveStats.hookCalls;
    let mounted = 0;
    for (let i = 0; i < 20 * TICK_HZ; i++) {
      tick();
      for (const e of sim.entities.values()) if (e.kind === EntityKind.Bot && e.flags & EFlag.Mounted) mounted++;
    }
    expect(driveStats.hookCalls, HOOK_MISSING).toBeGreaterThan(calls);
    expect(mounted).toBe(0);
    expect(adventureState(sim)!.step).toBe(3);          // the step waits for the human's drive
  }, 120000);
  it('B2b TDM: a bot flies the RC plane in at least 3 of 4 matches, strafing (4 seeds, 45 s matches)', async () => {
    const calls = driveStats.hookCalls;
    const runs: TdmRun[] = [];
    for (const seed of [1, 2, 3, 4]) runs.push(await tdm(seed));
    expect(driveStats.hookCalls, HOOK_MISSING).toBeGreaterThan(calls);
    console.log('[b2b] TDM plane:', runs.map((r, i) => `seed ${i + 1}: ${r.flights} sorties, ${r.rounds} rounds, ${r.strafeHits} hits, ${r.planesLost} planes lost`).join(' · '));
    expect(runs.filter((r) => r.flights >= 1).length).toBeGreaterThanOrEqual(3);
    expect(runs.reduce((a, r) => a + r.rounds, 0)).toBeGreaterThan(0);
  }, 400000);

  it('B2b chapter 6, bot-only, vehicle/airborne not waived (needs the runner edit, B2.md §3): glide, plane, flyover met for real', async () => {
    const def = chapterById('last_ball')!;
    const calls = driveStats.hookCalls;
    const sim = await Sim.create({ seed: 1, systems: withAdventure() });
    const room = new Room(sim, { mode: 'adventure', chapter: 'last_ball', botsPerTeam: [4, 0] });
    const met: string[] = [];
    let step = -1;
    for (let i = 0; i < (def.par * 2 + 30) * TICK_HZ; i++) {
      room.tick();
      sim.drainEvents();
      const st = adventureState(sim)!;
      if (st.phase === 'live' && step < 0) step = st.step;
      if (step >= 0 && (st.step !== step || st.phase === 'complete')) {
        // the step just completed: did a pup in its zone meet the rule for real?
        const tr = def.steps[step].trigger;
        if (tr.type === 'reach') {
          const p = tr.params;
          const how: string[] = [];
          for (const e of sim.entities.values()) {
            if (e.kind !== EntityKind.Bot || e.team !== Team.Corgis || e.dead) continue;
            const v = e.seat ? sim.entities.get(e.seat.vehicle) : undefined; // a driven vehicle in the zone counts for its driver
            if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > p.radius && !(v && Math.hypot(v.pos.x - p.x, v.pos.z - p.z) <= p.radius)) continue;
            const seated = !!(e.flags & EFlag.Mounted), air = !e.char!.grounded;
            const ok = (!p.vehicle || seated) && (!p.airborne || air) && (p.minY === undefined || e.pos.y >= p.minY);
            if (ok) how.push(`${e.name} ${e.cls}${seated ? ' seated' : ''}${air ? ' airborne' : ''} y ${e.pos.y.toFixed(1)}`);
          }
          met.push(`${def.steps[step].id} at ${(sim.tick / TICK_HZ).toFixed(1)} s: ${how.join(', ') || 'NOBODY (waived)'}`);
          if (p.vehicle || p.airborne) expect(how.length, `step ${def.steps[step].id}: the runner still waives vehicle/airborne for bot-only squads (apply B2.md §3), or no pup met it`).toBeGreaterThan(0);
        }
        step = st.step;
        if (st.phase === 'complete') break;
      }
    }
    expect(driveStats.hookCalls, HOOK_MISSING).toBeGreaterThan(calls);
    const st = adventureState(sim)!;
    console.log(`[b2b] last_ball bot-only: ${st.time} s vs par ${def.par} s · ${met.join(' · ')}`);
    expect(st.phase).toBe('complete');
    expect(st.time).toBeLessThanOrEqual(def.par);
    room.dispose();
  }, 600000);
});

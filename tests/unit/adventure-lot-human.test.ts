// W10 A7 chapter 7 "Night Shift at The Lot" with a scripted human stand-in (an Infiltrator, the featured kit) on the
// real Lot. What the chapter promises a player, measured:
//   · fair stealth: the approach from the site gate is out of every sentry's sight range; standing still inside the
//     Pipeworks' pipes is never seen; a blind sprint through the pipes is spotted, while the featured kit's plan (cloak
//     over the causeway, wait for the cloak in the dark pipe, cloak across the mud) goes unseen; at the siren, a cloak
//     from round the back of the tower does too
//   · the human-only rules hold: with a human in the squad only a human pulls the siren fuse (E, from the ground by the
//     tower); the drive home needs the kart (on foot in the pit zone nothing happens; driving the parked kart there does)
//   · no softlock: a squad wipe in any step restarts at its checkpoint (the getaway at the hold) and the chapter still
//     completes
//   · the gold par is reachable by a player: a scripted run (it sneaks, fights the way a simple player does, drives the
//     kart home) finishes inside the gold par
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { Room } from '../../src/host/room';
import { createDefaultSystems } from '../../src/sim/systems';
import { adventureSystems, adventureState, adventureRuntime, adventureItems, type AdventureConfig } from '../../src/sim/adventure';
import { kill } from '../../src/sim/combat/damage';
import { isStealthed } from '../../src/sim/combat/state';
import { worldLineClear } from '../../src/sim/combat/geometry';
import { navGridFor, findPath } from '../../src/sim/ai/nav';
import { createDriver, driveKart, controlsToInput, type DriverState, type KartControls } from '../../src/sim/ai/drive';
import { Btn, emptyInput, type InputCmd } from '../../src/shared/input';
import { EFlag, EntityKind, Species, Team, type ClassId } from '../../src/shared/types';
import type { GameEvent } from '../../src/shared/protocol';
import { TICK_HZ } from '../../src/shared/constants';
import { surfaceAt, yawToward } from '../../src/shared/world/queries';
import { STRICT_GRACE_SECONDS, type ChapterDef } from '../../src/shared/content/chapters';
import { NIGHT_SHIFT } from '../../src/shared/content/chapters-lot';

function withAdventure() {
  const sys = createDefaultSystems();
  return sys.some((s) => s.name === 'adventure') ? sys : [...sys, ...adventureSystems()];
}

interface Play { sim: Sim; h: SimEntity; evs: GameEvent[]; tick(cmd?: Partial<InputCmd>): void; st(): NonNullable<ReturnType<typeof adventureState>>; t(): number }

/** Chapter 7 (or `chapter`) on The Lot with one scripted human (an Infiltrator) and `pups` bots, live after a 0.1 s briefing. */
async function play(seed: number, pups: ClassId[] = [], chapter: ChapterDef = NIGHT_SHIFT, cfg: AdventureConfig = {}): Promise<Play> {
  const sim = await Sim.create({ seed, map: 'the_lot', systems: withAdventure() });
  sim.state.room = { mode: 'adventure', chapter: NIGHT_SHIFT.id };
  sim.state.adventureConfig = { chapter, briefing: 0.1, briefingWait: 0.1, ...cfg } satisfies AdventureConfig;
  const y = sim.worldData.height(chapter.start.x, chapter.start.z) + 0.05;
  const h = sim.spawnCharacter({ kind: EntityKind.Player, team: Team.Corgis, species: Species.Corgi, cls: 'infiltrator', name: 'Rex', ownerPid: 'p1', x: chapter.start.x, y, z: chapter.start.z });
  pups.forEach((c, i) => sim.spawnCharacter({ kind: EntityKind.Bot, team: Team.Corgis, species: Species.Corgi, cls: c, name: `Pup ${i + 1}`, x: chapter.start.x + i + 1, y, z: chapter.start.z }));
  let seq = 1;
  const evs: GameEvent[] = [];
  const tick = (cmd: Partial<InputCmd> = {}) => { sim.setInput(h.id, { seq: seq++, mx: 0, mz: 0, yaw: h.yaw, pitch: 0, buttons: 0, rt: 0, ...cmd }); sim.step(); evs.push(...sim.drainEvents()); };
  for (let i = 0; i < 60 && adventureState(sim)?.phase !== 'live'; i++) tick();
  expect(adventureState(sim)!.phase).toBe('live');
  const st = () => adventureState(sim)!;
  return { sim, h, evs, tick, st, t: () => (sim.tick - st().startTick) / TICK_HZ };
}

/** A stand-in's legs: sprint along nav paths toward (tx, tz), one tick per call; true once there. */
function mover(p: Play) {
  const g = navGridFor(p.sim);
  const path: number[] = [];
  let key = '', at = -1e9, k = 0;
  return (tx: number, tz: number, buttons = 0): boolean => {
    const kk = `${tx},${tz}`;
    if (kk !== key || p.sim.tick - at > 120) { if (!findPath(g, p.h.pos.x, p.h.pos.z, tx, tz, path)) { path.length = 0; path.push(tx, tz); } key = kk; at = p.sim.tick; k = 0; }
    while (k < path.length - 2 && Math.hypot(path[k] - p.h.pos.x, path[k + 1] - p.h.pos.z) < 1.6) k += 2;
    if (Math.hypot(tx - p.h.pos.x, tz - p.h.pos.z) < 1) { p.tick({ yaw: p.h.yaw, buttons }); return true; }
    p.tick({ mz: 1, yaw: yawToward(p.h.pos.x, p.h.pos.z, path[k], path[k + 1]), buttons: Btn.Sprint | buttons });
    return false;
  };
}
/** Walk the via points in order (or until `stop`); false if time ran out. */
function walk(p: Play, via: Array<[number, number]>, stop: () => boolean, maxS = 60): boolean {
  const move = mover(p);
  const end = p.sim.tick + maxS * TICK_HZ;
  for (const [x, z] of via) while (!move(x, z)) { if (stop()) return true; if (p.sim.tick > end) return false; }
  return true;
}
const cloak = (p: Play) => { p.tick({ buttons: Btn.Ability, yaw: p.h.yaw }); p.tick({ yaw: p.h.yaw }); };
const cloakReady = (p: Play) => (p.h.abil?.cooldown ?? 1) <= 0;

/** Run the stand-in `plan` on a seed; report whether the stealth alarm ever went up before the step was done. */
async function sneakTrial(seed: number, plan: (p: Play, stop: () => boolean) => void, chapter: ChapterDef = NIGHT_SHIFT): Promise<{ seen: boolean; done: boolean }> {
  const p = await play(seed, [], chapter);
  let seen = false;
  const stop = () => { if (p.st().alarm) seen = true; return seen || p.st().step > 0; };
  plan(p, stop);
  const done = !seen && p.st().step > 0;
  p.sim.dispose();
  return { seen, done };
}

const SEEDS = [1, 2, 3, 4];
const SEEDS8 = [1, 2, 3, 4, 5, 6, 7, 8];
/** The siren step on its own, from the heap's east foot (where the Pipeworks step ends). */
const SIREN_ONLY: ChapterDef = { ...NIGHT_SHIFT, start: { x: 93, z: 101, yaw: Math.PI / 2 }, steps: NIGHT_SHIFT.steps.slice(1) };

describe('chapter 7: fair stealth for the featured kit', () => {
  it('the approach from the site gate stays out of every sentry\'s sight range; standing still inside the pipes is never seen', async () => {
    const p = await play(1);
    const sentries = [...adventureRuntime(p.sim)!.enemies.keys()].map((id) => p.sim.entities.get(id)!);
    expect(sentries).toHaveLength(3);
    for (const s of sentries) expect(s.adv?.sentry).toBeTruthy();
    // start -> the ditch's north bank at the pipes causeway: > 45 m (a grunt's sight) + 5 m (its pacing loop) from every post
    for (let f = 0; f <= 1; f += 0.02) {
      const x = 138 + (102 - 138) * f, z = -34 + (-8 + 34) * f;
      for (const s of sentries) expect(Math.hypot(x - s.pos.x, z - s.pos.z), `(${x.toFixed(0)}, ${z.toFixed(0)})`).toBeGreaterThan(50);
    }
    p.sim.dispose();
    for (const seed of SEEDS) {
      const r = await sneakTrial(seed, (q, stop) => {
        for (const [x, z] of [[79.5, 18], [79.5, 29], [79.5, 38], [91.5, 18], [91.5, 29], [91.5, 38]] as const) {
          q.sim.placeCharacter(q.h, x, surfaceAt(q.sim.worldData, x, z, 2).y + 0.05, z);
          for (let i = 0; i < 8 * TICK_HZ; i++) { q.tick(); if (stop()) return; }
        }
      });
      expect(r.seen, `seed ${seed}: seen inside the pipes`).toBe(false);
    }
  }, 240_000);

  it('a blind sprint through the pipes is spotted; the Infiltrator\'s two-cloak plan is not', async () => {
    let blindSeen = 0, cloakClean = 0;
    for (const seed of SEEDS8) {
      const blind = await sneakTrial(seed, (p, stop) => { walk(p, [[102, -8], [91.5, 8], [91.5, 46], [93, 99]], stop); });
      if (blind.seen) blindSeen++;
      const plan = await sneakTrial(seed, (p, stop) => {
        if (walk(p, [[102, -8]], stop)) { if (stop()) return; }
        cloak(p);                                                     // over the causeway, into the east pipe
        if (walk(p, [[91.5, 8], [91.5, 41]], stop) && stop()) return;
        for (let i = 0; i < 20 * TICK_HZ && !cloakReady(p); i++) p.tick({ yaw: p.h.yaw }); // wait in the dark pipe
        cloak(p);                                                     // across the mud to the heap's east foot
        walk(p, [[92, 60], [93, 99]], stop);
      });
      if (plan.done) cloakClean++;
    }
    console.log(`[a7] Pipeworks: blind sprint spotted ${blindSeen}/${SEEDS8.length}; Infiltrator two-cloak plan unseen ${cloakClean}/${SEEDS8.length}`);
    expect(blindSeen).toBeGreaterThanOrEqual(6);
    expect(cloakClean).toBeGreaterThanOrEqual(6);
  }, 300_000);

  it('the siren fuse: straight at it past the floodlight pools is spotted; a cloak from round the back of the tower is not', async () => {
    let blindSeen = 0, cloakClean = 0;
    const press = (p: Play, stop: () => boolean) => { for (let i = 0; i < 10 && !stop(); i++) { p.tick({ buttons: Btn.Interact, yaw: p.h.yaw }); p.tick({ yaw: p.h.yaw }); } };
    for (const seed of SEEDS) {
      const blind = await sneakTrial(seed, (p, stop) => { if (walk(p, [[45, 119.5]], stop) && !stop()) press(p, stop); }, SIREN_ONLY);
      if (blind.seen) blindSeen++;
      const plan = await sneakTrial(seed, (p, stop) => {
        if (walk(p, [[86, 124], [78, 124]], stop) && stop()) return;
        cloak(p);
        if (walk(p, [[45, 119.5]], stop) && !stop()) press(p, stop);
      }, SIREN_ONLY);
      if (plan.done) cloakClean++;
    }
    console.log(`[a7] siren: straight at it spotted ${blindSeen}/${SEEDS.length}; cloak round the back unseen ${cloakClean}/${SEEDS.length}`);
    expect(blindSeen).toBeGreaterThanOrEqual(2);
    expect(cloakClean).toBeGreaterThanOrEqual(3);
  }, 240_000);
});

describe('chapter 7: the human-only rules', () => {
  it('only the human pulls the siren fuse (E by the tower, on the heap top): a pup standing there does not', async () => {
    const p = await play(2, ['assault'], SIREN_ONLY);
    const pup = [...p.sim.entities.values()].find((e) => e.kind === EntityKind.Bot && e.team === Team.Corgis)!;
    const fuse = adventureItems(p.sim)[0];
    expect(fuse?.name).toBe('siren_fuse');
    expect(Math.abs(fuse.pos.y - (4.6 + 0.45))).toBeLessThan(0.05); // on the heap top at the tower's ballast box
    p.sim.placeCharacter(pup, 45, 4.65, 119.5);
    p.sim.placeCharacter(p.h, 60, 4.65, 124); // the human hangs back
    for (let i = 0; i < 3 * TICK_HZ; i++) { p.tick(); if (!pup.dead) pup.input = { ...pup.input, buttons: i % 2 ? Btn.Interact : 0 }; }
    expect(p.st().step).toBe(0);
    walk(p, [[45, 119.5]], () => false, 20);
    p.tick({ buttons: Btn.Interact, yaw: p.h.yaw }); p.tick();
    expect(p.st().step).toBe(1);
    expect(p.evs.some((e) => e.e === 'pickup' && e.id === p.h.id && e.item === 'siren_fuse')).toBe(true);
    expect(p.sim.entities.has(fuse.id)).toBe(false);
    p.sim.dispose();
  }, 120_000);

  it('the drive home needs the kart: on foot in the pit zone nothing happens; driving the parked kart there finishes the chapter', async () => {
    const ESCAPE_ONLY: ChapterDef = { ...NIGHT_SHIFT, start: { x: 10, z: 108, yaw: Math.PI / 2 }, steps: NIGHT_SHIFT.steps.slice(4).map((s) => ({ ...s, spawns: [] })) };
    const p = await play(3, [], ESCAPE_ONLY);
    const kart = [...p.sim.entities.values()].find((e) => e.kart)!;
    expect(Math.hypot(kart.pos.x - 4, kart.pos.z - 112)).toBeLessThan(0.01);
    // on foot at the pit's ramp: not the way home
    p.sim.placeCharacter(p.h, 12, p.sim.worldData.height(12, -108) + 0.05, -108);
    for (let i = 0; i < 2 * TICK_HZ; i++) p.tick();
    expect(p.st().phase).toBe('live');
    // back to the kart, E, drive home (the bot driver's steering on the human's controls)
    p.sim.placeCharacter(p.h, kart.pos.x + 1.8, kart.pos.y + 0.1, kart.pos.z);
    for (let i = 0; i < 10; i++) p.tick();
    p.tick({ buttons: Btn.Interact }); p.tick();
    expect(p.h.flags & EFlag.Mounted).toBeTruthy();
    const g = navGridFor(p.sim), d = createDriver(), ctl: KartControls = { throttle: 0, steer: 0, boost: false, handbrake: false };
    const t0 = p.sim.tick;
    for (let i = 0; i < 90 * TICK_HZ && p.st().phase === 'live'; i++) {
      driveKart(p.sim, kart, d, { x: 12, z: -108, r: 4, stop: false }, g, { pathBudget: 4 }, ctl);
      const inp = controlsToInput(ctl, emptyInput(0));
      p.tick({ mz: inp.mz, mx: inp.mx, buttons: inp.buttons });
    }
    console.log(`[a7] escape: ${((p.sim.tick - t0) / TICK_HZ).toFixed(1)} s from the heap's west side to the pit, driving`);
    expect(p.st().phase).toBe('complete');
    expect((p.sim.tick - t0) / TICK_HZ).toBeLessThan(40);
    p.sim.dispose();
  }, 120_000);
});

describe('chapter 7: no softlock', () => {
  it('a squad wipe in every step restarts at its checkpoint (the getaway at the hold), and the bot squad still finishes', async () => {
    const sim = await Sim.create({ seed: 4, map: 'the_lot', systems: withAdventure() });
    const room = new Room(sim, { mode: 'adventure', chapter: 'night_shift', botsPerTeam: [4, 0] });
    const wiped = new Set<number>(), restarts: string[] = [];
    let armed = -1, armedAt = 0;
    for (let i = 0; i < 700 * TICK_HZ; i++) {
      room.tick();
      const st = adventureState(sim)!;
      if (st.phase === 'complete') break;
      // 3 s into each step (its first time), every squad member goes down at once
      if (st.phase === 'live' && !wiped.has(st.step)) {
        if (armed !== st.step) { armed = st.step; armedAt = sim.tick; }
        if (sim.tick - armedAt >= 3 * TICK_HZ) {
          wiped.add(st.step);
          for (const e of [...sim.entities.values()]) if (e.char && e.team === Team.Corgis && !e.dead) kill(sim, e, { id: -1, team: Team.Cats, weapon: -1 });
        }
      }
      if (st.phase === 'live' && restarts.length < wiped.size && st.wipes === wiped.size) restarts.push(`${st.step}`); // live again: where
    }
    const st = adventureState(sim)!;
    console.log(`[a7] wipes at steps ${[...wiped].join(', ')} → restarted at ${restarts.join(', ')}; ${st.phase} in ${st.time} s (${st.medal}), wipes ${st.wipes}`);
    expect([...wiped]).toEqual([0, 1, 2, 3, 4]);
    expect(restarts).toEqual(['0', '1', '2', '3', '3']); // the drive home has no checkpoint: back to the hold
    expect(st.phase).toBe('complete');
    expect(st.wipes).toBeGreaterThanOrEqual(5);
    room.dispose();
  }, 600_000);
});

describe('chapter 7: the gold par is a player\'s par', () => {
  /** A scripted Infiltrator with three pups plays the whole chapter: two-cloak Pipeworks, the siren from round the back,
   *  then it fights like a simple player (aims at the nearest cat in sight, taps fire) while it takes stash balls, holds
   *  the scaffold and drives the kart home with the bot driver's steering. Wipes restart the step's plan. */
  async function scriptedRun(seed: number) {
    const p = await play(seed, ['infiltrator', 'warden', 'assault']);
    const move = mover(p);
    let tap = false, sub = 0, subStep = -1, drv: DriverState | null = null;
    const fight = (range: number): boolean => {
      if (isStealthed(p.sim, p.h)) return false;
      let best: SimEntity | null = null, bd = range;
      for (const id of adventureRuntime(p.sim)!.enemies.keys()) {
        const e = p.sim.entities.get(id);
        if (!e || e.dead || !e.char) continue;
        const d = Math.hypot(e.pos.x - p.h.pos.x, e.pos.z - p.h.pos.z);
        if (d < bd && worldLineClear(p.sim, p.h.pos.x, p.h.pos.y + 1.1, p.h.pos.z, e.pos.x, e.pos.y + 0.8, e.pos.z)) { bd = d; best = e; }
      }
      if (!best) return false;
      tap = !tap;
      p.tick({ yaw: yawToward(p.h.pos.x, p.h.pos.z, best.pos.x, best.pos.z), pitch: Math.atan2(best.pos.y + 0.7 - (p.h.pos.y + 1.2), bd), buttons: (tap ? Btn.Fire : 0) | Btn.Aim });
      return true;
    };
    const press = () => { p.tick({ buttons: Btn.Interact, yaw: p.h.yaw }); p.tick({ yaw: p.h.yaw }); };
    while (p.sim.tick < 600 * TICK_HZ) {
      const st = p.st();
      if (st.phase === 'complete') break;
      if (st.phase !== 'live' || p.h.dead) { p.tick(); sub = 0; continue; }
      if (st.step !== subStep) { subStep = st.step; sub = 0; }
      if (st.step === 0) {
        if (sub === 0) { if (p.h.pos.z > 0) sub = 3; else if (move(102, -8)) sub = 1; }
        else if (sub === 1) { if (cloakReady(p)) cloak(p); sub = 2; }
        else if (sub === 2) { if (p.h.pos.z < 8 ? move(91.5, 8) : move(91.5, 41)) if (p.h.pos.z > 40) sub = 3; }
        else if (sub === 3) { if (cloakReady(p) || p.h.pos.z > 45) { if (p.h.pos.z <= 45) cloak(p); sub = 4; } else p.tick({ yaw: p.h.yaw }); }
        else if (!fight(26)) move(93, 99);
      } else if (st.step === 1) {
        if (sub === 0) { if (fight(18)) continue; if (p.h.pos.x < 80 && p.h.pos.z > 118) sub = 1; else if (move(p.h.pos.z < 118 ? 86 : 78, 124)) sub = p.h.pos.x < 80 ? 1 : 0; }
        else if (sub === 1) { if (cloakReady(p)) cloak(p); sub = 2; }
        else if (Math.hypot(p.h.pos.x - 45, p.h.pos.z - 119.5) < 2) press();
        else if (!fight(10)) move(45, 119.5);
      } else if (st.step === 2) {
        if (fight(22)) continue;
        const items = adventureItems(p.sim).sort((a, b) => Math.hypot(a.pos.x - p.h.pos.x, a.pos.z - p.h.pos.z) - Math.hypot(b.pos.x - p.h.pos.x, b.pos.z - p.h.pos.z));
        if (items.length) move(items[0].pos.x, items[0].pos.z); else p.tick();
      } else if (st.step === 3) {
        if (Math.hypot(p.h.pos.x - 36, p.h.pos.z - 101) > 3) { if (!fight(14)) move(36, 101); } else if (!fight(40)) p.tick({ yaw: p.h.yaw });
      } else {
        const v = adventureRuntime(p.sim)!.vehicles[0], kart = v ? p.sim.entities.get(v.id) : undefined;
        if (!(p.h.flags & EFlag.Mounted)) {
          drv = null;
          if (!kart) { if (!fight(26)) p.tick(); }
          else if (Math.hypot(kart.pos.x - p.h.pos.x, kart.pos.z - p.h.pos.z) > 2.2) { if (!fight(12)) move(kart.pos.x + 1.6, kart.pos.z); }
          else { p.tick({ yaw: yawToward(p.h.pos.x, p.h.pos.z, kart.pos.x, kart.pos.z) }); press(); }
          continue;
        }
        drv ??= createDriver();
        const ctl: KartControls = { throttle: 0, steer: 0, boost: false, handbrake: false };
        driveKart(p.sim, kart!, drv, { x: 12, z: -108, r: 4, stop: false }, navGridFor(p.sim), { pathBudget: 4 }, ctl);
        const inp = controlsToInput(ctl, emptyInput(0));
        p.tick({ mz: inp.mz, mx: inp.mx, buttons: inp.buttons, yaw: p.h.yaw });
      }
    }
    const st = p.st();
    const out = { seed, complete: st.phase === 'complete', time: st.time, medal: st.medal, wipes: st.wipes, alarms: st.counters.alarms ?? 0, deaths: p.evs.filter((e) => e.e === 'death' && e.id === p.h.id).length };
    p.sim.dispose();
    return out;
  }

  it('a scripted player run finishes inside the gold par (4:00)', async () => {
    const runs = [await scriptedRun(1), await scriptedRun(2)];
    for (const r of runs) console.log(`[a7] scripted player seed ${r.seed}: ${r.complete ? `${r.time} s (${r.medal})` : 'NOT complete'}; wipes ${r.wipes}, alarms ${r.alarms}, human knocked out ${r.deaths}×`);
    for (const r of runs) expect(r.complete).toBe(true);
    expect(Math.min(...runs.map((r) => r.time))).toBeLessThanOrEqual(NIGHT_SHIFT.par);
    expect(STRICT_GRACE_SECONDS).toBeLessThan(NIGHT_SHIFT.par); // (the grace is a safety net, not the route)
  }, 600_000);
});

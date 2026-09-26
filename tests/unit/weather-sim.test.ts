// G1 weather in the authoritative sim: rain makes grass slippery (lower ground accel/decel), sprinkler
// jets shove / pop / slow characters, client prediction reproduces both exactly (the input's rt clock),
// and storms shrink AI sight range.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { LocalPredictor } from '../../src/client/net/prediction';
import { quantizeMotion } from '../../src/host/quantize';
import { Btn, sanitizeInput, type InputCmd } from '../../src/shared/input';
import { Team, Species, EntityKind, type TeamId } from '../../src/shared/types';
import { TICK_DT, TICK_HZ } from '../../src/shared/constants';
import { findWeather, sprinklerAt, weatherCycle } from '../../src/shared/world/weather';
import { surfaceAt, concealmentAt } from '../../src/shared/world/queries';
import { stepWorldEffects, worldSystems, envTick, ENV_RT_WINDOW, SLIP_LEVELS, SLIP_ACCEL_LOSS, baseMoveStats } from '../../src/sim/world/systems';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem, killPlaneSystem } from '../../src/sim/systems/core';
import { worldLineClear } from '../../src/sim/combat';

const TICK_MS = 1000 / TICK_HZ;
const coreSystems = () => [movementSystem, ...worldSystems(), physicsStepSystem, killPlaneSystem];
const RAIN = findWeather(1, 'rain');
const STORM = findWeather(1, 'storm');

function spawn(sim: Sim, x: number, z: number, opts: { team?: TeamId; kind?: number; yaw?: number } = {}): SimEntity {
  const team = opts.team ?? Team.Corgis;
  return sim.spawnCharacter({
    kind: (opts.kind ?? EntityKind.Player) as 0, team, species: team === Team.Cats ? Species.Cat : Species.Corgi, cls: 'assault',
    name: 'W', x, y: sim.worldData.height(x, z) + 0.05, z, yaw: opts.yaw ?? 0,
  });
}

describe('rain: slippery grass', () => {
  async function runSlide(tick: number) {
    const sim = await Sim.create({ seed: 1, systems: coreSystems() });
    sim.tick = tick;
    const e = spawn(sim, -10, -40);
    for (let i = 0; i < 20; i++) sim.step();
    const cmd = (seq: number, mz: number): InputCmd => ({ seq, mx: 0, mz, yaw: Math.PI / 2, pitch: 0, buttons: 0, rt: 0 });
    let seq = 0;
    for (let i = 0; i < 6; i++) { sim.setInput(e.id, cmd(++seq, 1)); sim.step(); }
    const v6 = Math.hypot(e.vel.x, e.vel.z);
    for (let i = 0; i < 40; i++) { sim.setInput(e.id, cmd(++seq, 1)); sim.step(); }
    const top = Math.hypot(e.vel.x, e.vel.z);
    const x0 = e.pos.x, z0 = e.pos.z;
    for (let i = 0; i < 60; i++) { sim.setInput(e.id, cmd(++seq, 0)); sim.step(); }
    const out = { v6, top, slide: Math.hypot(e.pos.x - x0, e.pos.z - z0), accel: e.char!.move.groundAccel, base: baseMoveStats(e.char!.move).groundAccel };
    sim.dispose();
    return out;
  }

  it('soaked grass: slower to get going, slides further when you let go; same top speed', async () => {
    const dry = await runSlide(600), wet = await runSlide(RAIN);
    expect(dry.accel).toBe(dry.base);
    expect(wet.accel).toBeCloseTo(wet.base * (1 - SLIP_ACCEL_LOSS), 9);
    expect(wet.v6 / dry.v6).toBeLessThan(0.55);          // 6 ticks of running: ~2.8 vs 6.4 m/s
    expect(wet.top).toBeCloseTo(dry.top, 1);             // top speed unchanged
    expect(wet.slide).toBeGreaterThan(dry.slide * 2.5);  // ~1.5 m vs ~0.4 m to stop
  });

  it('only grounded on terrain slips (decks/props keep full grip; airborne keeps air control)', async () => {
    const sim = await Sim.create({ seed: 1, systems: coreSystems() });
    sim.tick = RAIN;
    const deck = spawn(sim, -52, -88);                       // Corgi-base deck top ~3 m
    deck.pos.y = surfaceAt(sim.worldData, -52, -88).y + 0.05;
    sim.placeCharacter(deck, -52, deck.pos.y, -88);
    const lawn = spawn(sim, -10, -40);
    for (let i = 0; i < 30; i++) sim.step();
    expect(deck.pos.y).toBeGreaterThan(2.5);
    expect(deck.char!.move.groundAccel).toBe(baseMoveStats(deck.char!.move).groundAccel);
    expect(lawn.char!.move.groundAccel).toBeLessThan(baseMoveStats(lawn.char!.move).groundAccel);
    const r = stepWorldEffects(sim.worldData, lawn, TICK_DT, undefined, sim.tick);
    expect(r.slip).toBe(SLIP_LEVELS);
    sim.dispose();
  });

  it('environment clock: the input rt (what the client rendered) within the window, else the sim tick', () => {
    const e = { input: { rt: 1000 }, data: {} } as unknown as SimEntity;
    expect(envTick(e, 1010)).toBe(1000);                       // authority, honest client
    expect(envTick(e, 1000 + ENV_RT_WINDOW + 1)).toBe(1000 + ENV_RT_WINDOW + 1);   // too old: authority tick
    expect(envTick(e, 990)).toBe(990);                         // from the future: authority tick
    expect(envTick(e)).toBe(1000);                             // client prediction: rt
    (e.data as Record<string, unknown>).worldTick = 1005;
    expect(envTick(e)).toBe(1000);                             // Room.stepExtra: stamped tick bounds rt
    (e.input as { rt: number }).rt = 0;
    expect(envTick(e, 1234)).toBe(1234);                       // bots
  });
});

/** Authority (full default systems, quantized like the Room) vs LocalPredictor on the same raw inputs. */
async function predictionRun(startTick: number, x: number, z: number, ticks: number, input: (k: number, e: SimEntity) => Omit<InputCmd, 'seq' | 'rt'>) {
  const sim = await Sim.create({ seed: 1 });
  sim.tick = startTick;
  const e = spawn(sim, x, z);
  for (let i = 0; i < 30; i++) sim.step();
  quantizeMotion(e);
  const pred = await LocalPredictor.create(1);
  pred.reconcile(sim.toState(e), 0, []);
  let maxErr = 0, sprayed = 0, slipped = 0, maxSpeedIdle = 0;
  for (let k = 1; k <= ticks; k++) {
    const raw: InputCmd = { seq: k, rt: sim.tick - 6, ...input(k, e) };   // client renders ~100 ms behind
    sim.setInput(e.id, sanitizeInput(raw)!);
    sim.step();
    quantizeMotion(e);
    pred.step(raw, k * TICK_MS);
    const p = pred.predicted(sim.toState(e));
    maxErr = Math.max(maxErr, Math.hypot(p.x - e.pos.x, p.y - e.pos.y, p.z - e.pos.z));
    if (e.char!.move !== baseMoveStats(e.char!.move)) slipped++;
    const probe = { ...e, pos: { ...e.pos }, vel: { ...e.vel }, char: { ...e.char! }, data: {} } as SimEntity;
    if (stepWorldEffects(sim.worldData, probe, TICK_DT, undefined, sim.tick).sprayed) sprayed++;
    if (raw.mx === 0 && raw.mz === 0) maxSpeedIdle = Math.max(maxSpeedIdle, Math.hypot(e.vel.x, e.vel.z));
  }
  const out = { maxErr, sprayed, slipped, maxSpeedIdle, pos: { ...e.pos } };
  pred.dispose();
  sim.dispose();
  return out;
}

describe('prediction reflects the weather exactly', () => {
  it('slippery rain (through the overcast -> rain transition) predicts bit-for-bit', async () => {
    const rainSeg = weatherCycle(1, 0).find((s) => s.kind === 'rain')!;
    const r = await predictionRun(rainSeg.start - 700, -10, -40, 60 * 20, (k) => {
      const t = k % 240;
      return { mx: t > 150 && t < 190 ? 1 : 0, mz: t < 120 ? 1 : 0, yaw: Math.PI / 2 + k * 0.004, pitch: 0, buttons: t === 60 ? Btn.Jump : 0 };
    });
    expect(r.slipped).toBeGreaterThan(300);
    expect(r.maxErr).toBe(0);
  }, 60000);

  it('sprinkler shoves predict bit-for-bit (and really shove)', async () => {
    const data = (await Sim.create({ seed: 1, systems: [] })).worldData;
    const sp = data.sprinklers!.find((s) => s.id === 'meadow')!;
    let t0 = sp.first * TICK_HZ;
    while (sprinklerAt(1, sp, t0).on < 1) t0 += 10;
    const a = -1.6, x = sp.x + Math.cos(a) * 6, z = sp.z + Math.sin(a) * 6;
    const r = await predictionRun(t0 - 30, x, z, 60 * 9, (k) => ({ mx: 0, mz: k > 400 && k < 430 ? 1 : 0, yaw: 0, pitch: 0, buttons: 0 }));
    expect(r.sprayed).toBeGreaterThan(5);
    expect(r.maxSpeedIdle).toBeGreaterThan(2);           // pushed around while standing still
    expect(r.maxErr).toBe(0);
  }, 60000);
});

describe('sprinklers in the sim', () => {
  it('a jet shoves along its direction, drags motion across it and pops you off your feet', async () => {
    const sim = await Sim.create({ seed: 1, systems: coreSystems() });
    const sp = sim.worldData.sprinklers!.find((s) => s.id === 'meadow')!;
    let t = sp.first * TICK_HZ;
    let st = sprinklerAt(1, sp, t);
    while (st.on < 1) st = sprinklerAt(1, sp, (t += 5));
    const x = sp.x + st.dirX * 5, z = sp.z + st.dirZ * 5;
    const e = spawn(sim, x, z);
    for (let i = 0; i < 20; i++) sim.step();
    expect(e.char!.grounded).toBe(true);
    // cross the jet sideways at 3 m/s
    const perpX = -st.dirZ, perpZ = st.dirX;
    e.vel.x = perpX * 3; e.vel.z = perpZ * 3; e.vel.y = 0;
    const r = stepWorldEffects(sim.worldData, e, TICK_DT, undefined, t);
    expect(r.sprayed).toBe('meadow');
    const across = e.vel.x * perpX + e.vel.z * perpZ, along = e.vel.x * st.dirX + e.vel.z * st.dirZ;
    expect(across).toBeLessThan(3 * 0.9);                 // slowed
    expect(along).toBeGreaterThan(0.5);                   // shoved along the jet
    expect(e.vel.y).toBeGreaterThan(3);                   // popped
    expect(e.char!.grounded).toBe(false);
    // the swept lawn is wet -> slippery while the burst runs, even in clear weather
    const e2 = spawn(sim, sp.x + Math.cos(0.3) * 7, sp.z + Math.sin(0.3) * 7);
    for (let i = 0; i < 20; i++) sim.step();
    const r2 = stepWorldEffects(sim.worldData, e2, TICK_DT, undefined, t);
    expect(r2.slip).toBe(SLIP_LEVELS);
    const r3 = stepWorldEffects(sim.worldData, e2, TICK_DT, undefined, 600);   // off (before the first burst)
    expect(r3.slip).toBe(0);
    sim.dispose();
  });
});

describe('storm: AI sight', () => {
  /** An open, level 35 m lane on the lawn with clear line of sight and no tall grass. */
  function lane(sim: Sim): { ax: number; az: number; bx: number; bz: number } {
    const d = sim.worldData;
    for (let z = -60; z <= 40; z += 4) for (let x = -40; x <= 10; x += 3) {
      const bx = x + 35, bz = z;
      if (surfaceAt(d, x, z).kind !== 'terrain' || surfaceAt(d, bx, bz).kind !== 'terrain') continue;
      if (concealmentAt(d, x, d.height(x, z), z) > 0 || concealmentAt(d, bx, d.height(bx, bz), bz) > 0) continue;
      const ya = d.height(x, z), yb = d.height(bx, bz);
      if (Math.abs(ya - yb) > 0.4) continue;
      if (!worldLineClear(sim, x, ya + 1.0, z, bx, yb + 0.7, bz) || !worldLineClear(sim, x, ya + 1.0, z, bx, yb + 1.1, bz)) continue;
      let ok = true;
      for (let s = 0; s <= 35 && ok; s += 2.5) if (surfaceAt(d, x + s, z).kind !== 'terrain') ok = false;
      if (ok) return { ax: x, az: z, bx, bz };
    }
    throw new Error('no lane');
  }

  async function seesAt(tick: number): Promise<{ seen: boolean; sightMult: number }> {
    const sim = await Sim.create({ seed: 1 });
    sim.tick = tick;
    sim.step(); sim.step();
    const L = lane(sim);
    const target = spawn(sim, L.bx, L.bz, { team: Team.Cats });
    const bot = spawn(sim, L.ax, L.az, { kind: EntityKind.Bot, yaw: Math.atan2(-(L.bx - L.ax), -(L.bz - L.az)) });
    let seen = false;
    for (let i = 0; i < 90; i++) {
      sim.setInput(target.id, { seq: i + 1, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 });
      sim.step();
      if (bot.ai?.visible && bot.ai.target === target.id && Math.hypot(bot.pos.x - target.pos.x, bot.pos.z - target.pos.z) > 30) seen = true;
    }
    const { weatherSightMult } = await import('../../src/sim/world/env');
    const out = { seen, sightMult: weatherSightMult(sim) };
    sim.dispose();
    return out;
  }

  it('a bot spots an enemy at 35 m in clear weather but not in a storm (sight x0.6 = 27 m)', async () => {
    const clear = await seesAt(600), storm = await seesAt(STORM);
    expect(clear.sightMult).toBe(1);
    expect(storm.sightMult).toBeCloseTo(0.6, 9);
    expect(clear.seen).toBe(true);
    expect(storm.seen).toBe(false);
  }, 60000);
});

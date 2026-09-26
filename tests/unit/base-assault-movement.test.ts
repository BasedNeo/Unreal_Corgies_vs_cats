// W9 G4a: the ball carrier's movement rules live in the shared stepCharacter (keyed on EFlag.Carrier), so the authority
// and client prediction apply them identically: 25 % slower at every speed (run, sprint, walk, the slide boost), no Ear
// Glide. Parity: the LocalPredictor reproduces a carrier's run to the millimetre (bit for bit), and it picks the flag up
// from snapshots like a buff: one correction when the ball is taken, one when it is lost, none in between.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import type { SimEntity } from '../../src/sim/entity';
import { LocalPredictor } from '../../src/client/net/prediction';
import { quantizeMotion } from '../../src/host/quantize';
import { Btn, sanitizeInput, type InputCmd } from '../../src/shared/input';
import { Team, Species, EFlag, type ClassId } from '../../src/shared/types';
import type { EntityState, GameEvent } from '../../src/shared/protocol';
import { TICK_HZ } from '../../src/shared/constants';
import { BASE_ASSAULT } from '../../src/shared/content/modes';

const TICK_MS = 1000 / TICK_HZ;

/** Open, nearly flat lawn in the West Yard's middle: a 42 m lane running west from (10, -12) (seed 3: the prediction
 *  tests' world). */
const LANE = { x: 10, z: -12 } as const;
const WEST = Math.PI / 2;

async function lawnSim(): Promise<Sim> {
  return Sim.create({ seed: 3 });
}

function corgi(sim: Sim, x: number = LANE.x, z: number = LANE.z, cls: ClassId = 'assault'): SimEntity {
  return sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls, name: 'c', x, y: sim.worldData.height(x, z) + 0.05, z, yaw: WEST });
}

/** One pet down the lane for `secs` with `buttons` held (the same lane and inputs for the free pet and the carrier). */
async function runLane(carrier: boolean, secs: number, buttons: (k: number) => number, cls: ClassId = 'assault'): Promise<{ dist: number; peak: number; slides: number; glides: number; gliding: number; e: SimEntity; sim: Sim }> {
  const sim = await lawnSim();
  const e = corgi(sim, LANE.x, LANE.z, cls);
  for (let i = 0; i < 30; i++) sim.step();
  if (carrier) e.flags |= EFlag.Carrier;
  const p0 = { ...e.pos };
  let peak = 0, slides = 0, glides = 0, gliding = 0;
  for (let k = 1; k <= secs * TICK_HZ; k++) {
    sim.setInput(e.id, { seq: k, mx: 0, mz: 1, yaw: WEST, pitch: 0, buttons: buttons(k), rt: 0 });
    sim.step();
    for (const ev of sim.drainEvents()) if (ev.e === 'ability' && ev.id === e.id) { if (ev.ability === 'slide') slides++; if (ev.ability === 'ear_glide') glides++; }
    peak = Math.max(peak, Math.hypot(e.vel.x, e.vel.z));
    if (e.flags & EFlag.Gliding) gliding++;
  }
  return { dist: Math.hypot(e.pos.x - p0.x, e.pos.z - p0.z), peak, slides, glides, gliding, e, sim };
}

describe('base-assault carrier movement', () => {
  it('a carrier runs and sprints 25 % slower than the same pet without the ball', async () => {
    expect(BASE_ASSAULT.carrierSpeed).toBe(0.75);
    for (const b of [0, Btn.Sprint]) {
      const free = await runLane(false, 3, () => b), carrier = await runLane(true, 3, () => b);
      expect(carrier.e.flags & EFlag.Carrier).toBeTruthy(); // movement keeps the authority's bit
      expect(free.dist).toBeGreaterThan(b ? 20 : 14);
      expect(carrier.dist / free.dist).toBeGreaterThan(0.74);
      expect(carrier.dist / free.dist).toBeLessThan(0.765); // (both accelerate alike; the top speed is what differs)
      expect(carrier.peak).toBeCloseTo(free.peak * 0.75, 3);
      free.sim.dispose(); carrier.sim.dispose();
    }
  });

  it('the slide boost is scaled too: a sliding carrier still slides, but never outruns a sprinting free pet', async () => {
    const taps = (k: number) => Btn.Sprint | (k > TICK_HZ && k % 72 === 0 ? Btn.Crouch : 0); // sprint, slide every 1.2 s
    const free = await runLane(false, 5, () => Btn.Sprint), carrier = await runLane(true, 5, taps);
    expect(carrier.slides).toBeGreaterThan(1); // the slide threshold scales with the carrier's speed
    expect(carrier.peak).toBeLessThanOrEqual(free.e.char!.move.sprintSpeed * 1.25 * BASE_ASSAULT.carrierSpeed + 1e-6);
    expect(carrier.dist).toBeLessThan(free.dist);
    free.sim.dispose(); carrier.sim.dispose();
  });

  it('a Skyraider carrier cannot Ear Glide (and a glider that takes the ball mid-glide stops gliding)', async () => {
    const hop = (k: number) => {
      const t = k / TICK_HZ;
      return (t < 0.3 || (t >= 0.4 && t < 0.75) ? Btn.Jump : 0) | (t >= 0.78 && t < 0.83 ? Btn.Ability : 0);
    };
    const free = await runLane(false, 1.2, hop, 'skyraider'), carrier = await runLane(true, 1.2, hop, 'skyraider');
    expect(free.glides).toBe(1);
    expect(free.gliding).toBeGreaterThan(0);
    expect(carrier.glides).toBe(0);
    expect(carrier.gliding).toBe(0);
    // mid-glide: the glide ends on the carrier's next step
    const g = free.e;
    expect(g.flags & EFlag.Gliding).toBeTruthy();
    g.flags |= EFlag.Carrier;
    free.sim.setInput(g.id, { seq: 999, mx: 0, mz: 1, yaw: WEST, pitch: 0, buttons: 0, rt: 0 });
    free.sim.step();
    expect(g.flags & EFlag.Gliding).toBe(0);
    expect(g.char!.glideTime).toBe(0);
    free.sim.dispose(); carrier.sim.dispose();
  });
});

describe('base-assault carrier prediction parity (LocalPredictor)', () => {
  it('a carrier running 3 s (runs, sprints, jumps, a slide): the authority and the predictor agree to the millimetre', async () => {
    const sim = await lawnSim();
    const e = corgi(sim);
    for (let i = 0; i < 30; i++) sim.step();
    e.flags |= EFlag.Carrier;
    quantizeMotion(e);
    const pred = await LocalPredictor.create(3);
    pred.reconcile(sim.toState(e), 0, []); // the snapshot carries EFlag.Carrier
    let maxErr = 0, slides = 0;
    for (let k = 1; k <= 3 * TICK_HZ; k++) {
      const t = k / TICK_HZ;
      let buttons = t > 0.5 && t < 2.4 ? Btn.Sprint : 0;
      if (t > 1.0 && t < 1.15) buttons |= Btn.Jump;
      if (t > 1.9 && t < 1.95) buttons |= Btn.Crouch;
      const raw: InputCmd = { seq: k, rt: 0, mx: t > 2.5 ? 0.6 : 0, mz: 1, yaw: WEST + t * 0.3, pitch: -0.1, buttons };
      sim.setInput(e.id, sanitizeInput(raw)!);
      sim.step();
      quantizeMotion(e);
      for (const ev of sim.drainEvents()) if (ev.e === 'ability' && ev.ability === 'slide') slides++;
      pred.step(raw, k * TICK_MS);
      const p = pred.predicted(sim.toState(e));
      maxErr = Math.max(maxErr, Math.hypot(p.x - e.pos.x, p.y - e.pos.y, p.z - e.pos.z));
    }
    expect(slides).toBe(1);
    expect(maxErr).toBeLessThan(0.001);
    expect(maxErr).toBe(0); // bit for bit, in fact
    pred.dispose();
    sim.dispose();
  });

  it('the Carrier bit comes from snapshots like a buff: a correction when the ball is taken and when it is lost, none between', async () => {
    const sim = await lawnSim();
    const e = corgi(sim);
    for (let i = 0; i < 30; i++) sim.step();
    quantizeMotion(e);
    const pred = await LocalPredictor.create(3);
    pred.reconcile(sim.toState(e), 0, []);
    const LAG = 6, inputs: InputCmd[] = [], snaps: EntityState[] = [];
    const corrections: number[] = [];
    let carryTicks = 0, errDuringCarry = 0;
    for (let k = 1; k <= 60 * 8; k++) {
      const raw: InputCmd = { seq: k, rt: 0, mx: 0, mz: 1, yaw: WEST + k * 0.004, pitch: 0, buttons: k % 200 < 120 ? Btn.Sprint : 0 };
      inputs.push(raw);
      pred.step(raw, k * TICK_MS);
      sim.setInput(e.id, sanitizeInput(raw)!);
      sim.step();
      if (k === 90) e.flags |= EFlag.Carrier; // took the ball at the end of this tick (the match system runs last)
      if (k === 330) e.flags &= ~EFlag.Carrier; // lost it
      quantizeMotion(e);
      snaps.push(sim.toState(e));
      if (e.flags & EFlag.Carrier) carryTicks++;
      if (k > LAG) {
        const a = k - LAG;
        const r = pred.reconcile(snaps[a - 1], a, inputs.filter((i) => i.seq > a));
        if (r.correction > 1e-6) corrections.push(k);
        if (a > 100 && a < 320 && Number.isFinite(r.error)) errDuringCarry = Math.max(errDuringCarry, r.error);
      }
    }
    expect(carryTicks).toBe(240);
    expect(corrections.length).toBeGreaterThan(0); // the pickup itself can't be foreseen
    expect(corrections.length).toBeLessThanOrEqual(2); // its start and its end, not every snapshot of the carry
    expect(errDuringCarry).toBeLessThan(0.001);
    // the predicted state shows the ball-carrier bit (views read it for the ball on the back)
    expect(pred.predicted(snaps[snaps.length - 1]).flags & EFlag.Carrier).toBe(0);
    pred.dispose();
    sim.dispose();
  });

  it('a Skyraider carrier pressing Q in the air: neither side glides, still bit-exact', async () => {
    const sim = await lawnSim();
    const e = corgi(sim, LANE.x, LANE.z, 'skyraider');
    for (let i = 0; i < 30; i++) sim.step();
    e.flags |= EFlag.Carrier;
    quantizeMotion(e);
    const pred = await LocalPredictor.create(3);
    pred.reconcile(sim.toState(e), 0, []);
    let maxErr = 0;
    const seen: GameEvent[] = [];
    for (let k = 1; k <= 2 * TICK_HZ; k++) {
      const t = k / TICK_HZ;
      let buttons = 0;
      if (t < 0.3 || (t >= 0.4 && t < 0.75)) buttons |= Btn.Jump;
      if (t >= 0.78 && t < 0.83) buttons |= Btn.Ability;
      const raw: InputCmd = { seq: k, rt: 0, mx: 0, mz: 1, yaw: 0, pitch: 0, buttons };
      sim.setInput(e.id, sanitizeInput(raw)!);
      sim.step();
      quantizeMotion(e);
      seen.push(...sim.drainEvents());
      seen.push(...pred.step(raw, k * TICK_MS));
      const p = pred.predicted(sim.toState(e));
      maxErr = Math.max(maxErr, Math.hypot(p.x - e.pos.x, p.y - e.pos.y, p.z - e.pos.z));
      expect(p.flags & EFlag.Gliding).toBe(0);
    }
    expect(seen.some((ev) => ev.e === 'ability' && ev.ability === 'ear_glide')).toBe(false);
    expect(maxErr).toBe(0);
    pred.dispose();
    sim.dispose();
  });
});

// Client-side prediction: the predictor must reproduce the authority bit-for-bit for the same inputs,
// reconcile rounding noise without corrections, smooth real corrections and snap teleports.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { LocalPredictor, SNAP_DISTANCE } from '../../src/client/net/prediction';
import { quantizeMotion } from '../../src/host/quantize';
import { NetClient } from '../../src/client/net/net-client';
import { EventLoop, LoopbackLink } from '../../src/client/net/loopback';
import { Btn, sanitizeInput, type InputCmd } from '../../src/shared/input';
import { Team, Species, EFlag } from '../../src/shared/types';
import { TICK_HZ } from '../../src/shared/constants';
import type { EntityState } from '../../src/shared/protocol';
import { grantBuff, stepBuffs } from '../../src/sim/interact';

const TICK_MS = 1000 / TICK_HZ;

/** Scripted run/jump/double-jump/strafe/slide/ground-pound sequence (tick index -> input). */
function scripted(k: number, yaw0: number): Omit<InputCmd, 'seq' | 'rt'> {
  const t = k / TICK_HZ;
  const phase = t % 6;
  let mx = 0, mz = 1, buttons = 0;
  if (phase >= 1.5 && phase < 1.7) buttons |= Btn.Jump;
  if (phase >= 2 && phase < 3.5) { mx = 1; buttons |= Btn.Sprint; }
  if (phase >= 2.6 && phase < 2.8) buttons |= Btn.Jump;
  if (phase >= 2.95 && phase < 3.1) buttons |= Btn.Jump;
  if (phase >= 3.5 && phase < 4.5) buttons |= Btn.Sprint;
  if (phase >= 3.8 && phase < 3.85) buttons |= Btn.Crouch;
  if (phase >= 4.5 && phase < 5.2) { mx = -1; mz = 0.3; }
  if (phase >= 5.2 && phase < 5.3) buttons |= Btn.Jump;
  if (phase >= 5.5 && phase < 5.55) buttons |= Btn.Crouch;
  if (phase >= 5.8) { mx = 0; mz = 0; }
  return { mx, mz, yaw: yaw0 + t * 0.6, pitch: -0.1, buttons };
}

describe('client prediction (LocalPredictor)', () => {
  it('matches the authority exactly for the same inputs (run, jumps, slide, pound, prop collision)', async () => {
    const sim = await Sim.create({ seed: 3 });
    const e = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'A' });
    for (let i = 0; i < 30; i++) sim.step();
    quantizeMotion(e); // the Room rounds player characters to snapshot precision after every tick
    const pred = await LocalPredictor.create(3);
    pred.reconcile(sim.toState(e), 0, []);
    // Head for the nearest prop so collide-and-slide is exercised whatever the map lane builds.
    const props = sim.worldData.props;
    let yaw0 = e.yaw;
    if (props.length) {
      const near = [...props].sort((a, b) => Math.hypot(a.x - e.pos.x, a.z - e.pos.z) - Math.hypot(b.x - e.pos.x, b.z - e.pos.z))[0];
      yaw0 = Math.atan2(-(near.x - e.pos.x), -(near.z - e.pos.z));
    }
    let maxErr = 0;
    const seen = new Set<string>();
    for (let k = 1; k <= 60 * 12; k++) {
      const raw: InputCmd = { seq: k, rt: 0, ...scripted(k, yaw0) };
      if (k < 180) { raw.yaw = yaw0; raw.mx = 0; raw.mz = 1; raw.buttons = 0; } // first 3 s: straight at the prop
      sim.setInput(e.id, sanitizeInput(raw)!);
      sim.step();
      quantizeMotion(e);
      for (const ev of sim.drainEvents()) seen.add(ev.e === 'ability' ? ev.ability : ev.e);
      pred.step(raw, k * TICK_MS);
      const p = pred.predicted(sim.toState(e));
      maxErr = Math.max(maxErr, Math.hypot(p.x - e.pos.x, p.y - e.pos.y, p.z - e.pos.z));
    }
    expect(seen.has('jump')).toBe(true);
    expect(seen.has('land')).toBe(true);
    expect(maxErr).toBe(0);
    pred.dispose();
    sim.dispose();
  });

  it('matches the authority exactly while Ear Gliding (Skyraider)', async () => {
    const sim = await Sim.create({ seed: 3 });
    const e = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'skyraider', name: 'A' });
    for (let i = 0; i < 30; i++) sim.step();
    quantizeMotion(e);
    const pred = await LocalPredictor.create(3);
    pred.reconcile(sim.toState(e), 0, []);
    let maxErr = 0, glidingTicks = 0;
    const seen = new Set<string>();
    for (let k = 1; k <= 60 * 20; k++) {
      // every 6.5 s (glide cooldown 6 s): jump, double jump, Q at the apex, glide forward while turning; one cycle
      // cancels early with a second Q
      const t = (k / TICK_HZ) % 6.5, cycle = Math.floor(k / (TICK_HZ * 6.5));
      let buttons = 0;
      if (t < 0.3 || (t >= 0.4 && t < 0.75)) buttons |= Btn.Jump;
      if (t >= 0.78 && t < 0.83) buttons |= Btn.Ability;
      if (cycle === 1 && t >= 1.2 && t < 1.25) buttons |= Btn.Ability;
      const raw: InputCmd = { seq: k, rt: 0, mx: t > 1.2 ? 0.4 : 0, mz: 1, yaw: k * 0.004, pitch: -0.1, buttons };
      sim.setInput(e.id, sanitizeInput(raw)!);
      sim.step();
      quantizeMotion(e);
      for (const ev of sim.drainEvents()) seen.add(ev.e === 'ability' ? ev.ability : ev.e);
      if (e.flags & EFlag.Gliding) glidingTicks++;
      pred.step(raw, k * TICK_MS);
      const p = pred.predicted(sim.toState(e));
      maxErr = Math.max(maxErr, Math.hypot(p.x - e.pos.x, p.y - e.pos.y, p.z - e.pos.z));
      expect(p.flags & EFlag.Gliding).toBe(e.flags & EFlag.Gliding);
    }
    expect(seen.has('ear_glide')).toBe(true);
    expect(glidingTicks).toBeGreaterThan(120);
    expect(maxErr).toBe(0);
    pred.dispose();
    sim.dispose();
  });

  it('follows Upgrade Core buffs from snapshot flags: Zoomies+ corrects once at start and once at expiry', async () => {
    const sim = await Sim.create({ seed: 3 });
    const e = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'A' });
    for (let i = 0; i < 30; i++) sim.step();
    quantizeMotion(e);
    const pred = await LocalPredictor.create(3);
    pred.reconcile(sim.toState(e), 0, []);
    const LAG = 6, inputs: InputCmd[] = [], snaps: EntityState[] = [];
    const corrections: number[] = [];
    let buffTicks = 0;
    for (let k = 1; k <= 60 * 26; k++) {
      const raw: InputCmd = { seq: k, rt: 0, mx: 0, mz: 1, yaw: k * 0.01, pitch: 0, buttons: k % 240 < 120 ? Btn.Sprint : 0 };
      inputs.push(raw);
      pred.step(raw, k * TICK_MS);
      if (k === 90) grantBuff(sim, e, 'zoomies_plus'); // 20 s buff, as if picked up this tick
      stepBuffs(sim, 1 / TICK_HZ); // the interact system (order 150) is off without a room mode: run its buff step
      sim.setInput(e.id, sanitizeInput(raw)!);
      sim.step();
      quantizeMotion(e);
      snaps.push(sim.toState(e));
      if (e.flags & EFlag.BuffZoomies) buffTicks++;
      if (k > LAG) {
        const a = k - LAG;
        const r = pred.reconcile(snaps[a - 1], a, inputs.filter((i) => i.seq > a));
        if (r.correction > 1e-6) corrections.push(k);
      }
    }
    expect(buffTicks).toBeGreaterThan(60 * 19);
    expect(e.flags & EFlag.BuffZoomies).toBe(0); // expired
    expect(corrections.length).toBeGreaterThan(0);
    expect(corrections.length).toBeLessThanOrEqual(2);
    pred.dispose();
    sim.dispose();
  });

  it('matches the authority exactly across map effects (jump pad bounce)', async () => {
    const sim = await Sim.create({ seed: 1 });
    const pads = (sim.worldData as { jumpPads?: { x: number; y: number; z: number; r: number }[] }).jumpPads ?? [];
    if (!pads.length) { sim.dispose(); return; } // the map lane may ship a map without pads
    const pad = pads[0];
    const e = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'A', x: pad.x, y: pad.y + 0.6, z: pad.z });
    quantizeMotion(e);
    const pred = await LocalPredictor.create(1);
    pred.reconcile(sim.toState(e), 0, []);
    let peak = e.pos.y, maxErr = 0;
    for (let k = 1; k <= 240; k++) {
      const raw: InputCmd = { seq: k, mx: 0, mz: k > 120 ? 0.5 : 0, yaw: 0, pitch: 0, buttons: k === 150 ? Btn.Jump : 0, rt: 0 };
      sim.setInput(e.id, sanitizeInput(raw)!);
      sim.step();
      quantizeMotion(e);
      pred.step(raw, k * TICK_MS);
      const p = pred.predicted(sim.toState(e));
      maxErr = Math.max(maxErr, Math.hypot(p.x - e.pos.x, p.y - e.pos.y, p.z - e.pos.z));
      peak = Math.max(peak, e.pos.y);
    }
    expect(peak - pad.y).toBeGreaterThan(2); // it really bounced
    expect(maxErr).toBe(0);
    pred.dispose();
    sim.dispose();
  });

  it('reconciles quantized snapshots without corrections and smooths a real correction', async () => {
    const sim = await Sim.create({ seed: 1 });
    const room = new Room(sim, { mode: 'test', botsPerTeam: [0, 0] });
    const loop = new EventLoop();
    const link = new LoopbackLink({ loop, room, id: 'c1', up: { lagMs: 0, jitterMs: 0, lossPct: 0 }, down: { lagMs: 0, jitterMs: 0, lossPct: 0 }, seed: 1 });
    const net = new NetClient(link.transport, { now: () => loop.now, pingIntervalMs: 0, predict: true, createPredictor: (s) => LocalPredictor.create(s) });
    net.join('P', 'assault', 0);
    let seq = 0;
    const run = async (ms: number, cmd: (k: number) => Partial<InputCmd>) => {
      const end = loop.now + ms;
      let nextS = Math.ceil(loop.now / TICK_MS) * TICK_MS, nextC = nextS + 3;
      while (loop.now < end) {
        const t = Math.min(nextS, nextC);
        loop.advanceTo(t);
        if (t === nextS) { room.tick(); nextS += TICK_MS; }
        if (t === nextC) {
          if (net.connected) { seq++; net.pushInput({ seq, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0, ...cmd(seq) }); net.flush(); net.interpolated(loop.now); }
          nextC += TICK_MS;
        }
        await net.predictionReady;
      }
    };
    await run(500, () => ({}));
    expect(net.prediction.active).toBe(true);
    const corrBefore = net.prediction.corrections;
    await run(3000, (k) => ({ mz: 1, yaw: k * 0.01, buttons: k % 90 < 10 ? Btn.Jump : 0 }));
    expect(net.prediction.corrections - corrBefore).toBe(0);
    expect(net.prediction.max).toBeLessThan(0.002);

    // Authority moves the player 1 m sideways (e.g. knockback): smoothed, not snapped.
    const ent = sim.entities.get(net.localEntity)!;
    sim.placeCharacter(ent, ent.pos.x + 1, ent.pos.y, ent.pos.z);
    const snapsBefore = net.prediction.snaps;
    await run(100, () => ({}));
    expect(net.prediction.corrections).toBeGreaterThan(corrBefore);
    expect(net.prediction.snaps).toBe(snapsBefore);
    expect(net.prediction.maxCorrection).toBeGreaterThan(0.8);
    expect(net.prediction.maxCorrection).toBeLessThan(SNAP_DISTANCE);
    await run(150, () => ({}));
    // The rendered position converged onto the predicted one.
    const rendered = net.interpolated(loop.now).get(net.localEntity)!;
    const predicted = net.predictedLocal()!;
    expect(Math.hypot(rendered.x - predicted.x, rendered.z - predicted.z)).toBeLessThan(0.06);

    // Teleport (respawn-like) far away: snapped.
    sim.placeCharacter(ent, ent.pos.x - 20, ent.pos.y, ent.pos.z);
    await run(100, () => ({}));
    expect(net.prediction.snaps).toBe(snapsBefore + 1);

    // Death stops prediction; respawn restarts it.
    ent.dead = true;
    ent.flags |= EFlag.Dead;
    await run(200, () => ({ mz: 1 }));
    expect(net.prediction.active).toBe(false);
    ent.dead = false;
    ent.flags &= ~EFlag.Dead;
    await run(200, () => ({ mz: 1 }));
    expect(net.prediction.active).toBe(true);

    // Seated in a vehicle: the vehicle moves the rider, so the client stops predicting on foot.
    ent.flags |= EFlag.Mounted;
    await run(200, () => ({ mz: 1 }));
    expect(net.prediction.active).toBe(false);
    ent.flags &= ~EFlag.Mounted;
    await run(200, () => ({ mz: 1 }));
    expect(net.prediction.active).toBe(true);
    net.dispose();
    room.dispose();
  });
});

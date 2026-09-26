import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Btn } from '../../src/shared/input';
import { Team, Species, EFlag } from '../../src/shared/types';
import type { WorldData } from '../../src/shared/world/world-data';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem } from '../../src/sim/systems/core';

// Movement is tested in isolation: a flat yard with crates on a 12 m ring, only movement + physics.
function flatWorld(seed: number): WorldData {
  const props = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    return { type: 'crate', x: Math.cos(a) * 12, y: 1, z: Math.sin(a) * 12, hx: 1, hy: 1, hz: 1, rotY: a };
  });
  return { seed, name: 'flat', height: () => 0, halfExtent: 60, props, spawns: [{ x: 0, y: 1, z: 6, yaw: 0, team: 0 }], killY: -30 };
}
async function makeSim() {
  const sim = await Sim.create({ seed: 7, world: flatWorld(7), systems: [movementSystem, physicsStepSystem] });
  const e = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'T', x: 0, y: 0.5, z: 0, yaw: 0 });
  return { sim, e };
}

describe('character movement', () => {
  it('settles onto the ground', async () => {
    const { sim, e } = await makeSim();
    for (let i = 0; i < 60; i++) sim.step();
    expect(e.char!.grounded).toBe(true);
    expect(e.pos.y).toBeGreaterThan(-0.05);
    expect(e.pos.y).toBeLessThan(0.1);
  });

  it('runs forward (-Z at yaw 0) at run speed', async () => {
    const { sim, e } = await makeSim();
    for (let i = 0; i < 30; i++) sim.step();
    for (let i = 0; i < 60; i++) { sim.setInput(e.id, { seq: i + 1, mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: 0, rt: 0 }); sim.step(); }
    expect(e.pos.z).toBeLessThan(-5);
    expect(Math.abs(e.pos.x)).toBeLessThan(0.01);
    expect(Math.hypot(e.vel.x, e.vel.z)).toBeCloseTo(e.char!.move.runSpeed, 1);
  });

  it('jumps, double-jumps and lands', async () => {
    const { sim, e } = await makeSim();
    for (let i = 0; i < 30; i++) sim.step();
    const events: string[] = [];
    let seq = 1, peak = 0;
    const press = (b: number) => { sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: b, rt: 0 }); sim.step(); for (const ev of sim.drainEvents()) events.push(ev.e + (ev.e === 'jump' && ev.double ? '2' : '')); peak = Math.max(peak, e.pos.y); };
    press(Btn.Jump); for (let i = 0; i < 10; i++) press(Btn.Jump);
    press(0); press(Btn.Jump); for (let i = 0; i < 10; i++) press(Btn.Jump);
    for (let i = 0; i < 120; i++) press(0);
    expect(events).toContain('jump');
    expect(events).toContain('jump2');
    expect(events).toContain('land');
    expect(peak).toBeGreaterThan(1.5);
    expect(e.flags & EFlag.Grounded).toBeTruthy();
  });

  it('is blocked by props', async () => {
    const { sim, e } = await makeSim();
    // crate 0 sits at (12, 1, 0) with half extent 1 -> wall face at x=11
    sim.placeCharacter(e, 8, 0.1, 0);
    for (let i = 0; i < 120; i++) { sim.setInput(e.id, { seq: i + 1, mx: 1, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 }); sim.step(); }
    expect(e.pos.x).toBeLessThan(11);
    expect(e.pos.x).toBeGreaterThan(10);
  });
});

describe('slide and ground pound', () => {
  it('slides when crouching during a sprint and keeps speed above run', async () => {
    const { sim, e } = await makeSim();
    for (let i = 0; i < 30; i++) sim.step();
    let seq = 1;
    const go = (b: number) => { sim.setInput(e.id, { seq: seq++, mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: b, rt: 0 }); sim.step(); };
    for (let i = 0; i < 45; i++) go(Btn.Sprint);
    go(Btn.Sprint | Btn.Crouch);
    const evs = sim.drainEvents();
    expect(evs.some((v) => v.e === 'ability' && v.ability === 'slide')).toBe(true);
    for (let i = 0; i < 10; i++) go(Btn.Sprint | Btn.Crouch);
    expect(e.char!.slideTime).toBeGreaterThan(0);
    expect(Math.hypot(e.vel.x, e.vel.z)).toBeGreaterThan(e.char!.move.runSpeed);
    for (let i = 0; i < 60; i++) go(0);
    expect(e.char!.slideTime).toBe(0);
  });

  it('a slide covers more ground than sprinting for the same time', async () => {
    const run = async (slide: boolean) => {
      const { sim, e } = await makeSim();
      sim.placeCharacter(e, 0, 0.05, 40); // open lane toward -Z (crates sit on the 12 m ring)
      for (let i = 0; i < 30; i++) sim.step();
      let seq = 1;
      const go = (b: number) => { sim.setInput(e.id, { seq: seq++, mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: b, rt: 0 }); sim.step(); };
      for (let i = 0; i < 45; i++) go(Btn.Sprint);
      const z0 = e.pos.z;
      go(Btn.Sprint | (slide ? Btn.Crouch : 0));
      for (let i = 0; i < 38; i++) go(Btn.Sprint);
      return z0 - e.pos.z;
    };
    const sprint = await run(false), slid = await run(true);
    expect(slid).toBeGreaterThan(sprint);
  });

  it('ground pounds from the air and emits the impact', async () => {
    const { sim, e } = await makeSim();
    for (let i = 0; i < 30; i++) sim.step();
    let seq = 1;
    const go = (b: number) => { sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: b, rt: 0 }); sim.step(); };
    go(Btn.Jump); for (let i = 0; i < 20; i++) go(Btn.Jump);
    sim.drainEvents();
    go(Btn.Crouch);
    expect(e.char!.pounding).toBe(true);
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) { go(0); for (const v of sim.drainEvents()) seen.push(v.e === 'ability' ? v.ability : v.e); }
    expect(seen).toContain('ground_pound');
    expect(e.char!.grounded).toBe(true);
  });

  it('buffers a crouch tapped right after takeoff into a pound (QA W1: the press was dropped)', async () => {
    const { sim, e } = await makeSim();
    for (let i = 0; i < 30; i++) sim.step();
    let seq = 1;
    const seen: string[] = [];
    const go = (b: number) => { sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: b, rt: 0 }); sim.step(); for (const v of sim.drainEvents()) seen.push(v.e === 'ability' ? v.ability : v.e); };
    go(Btn.Jump); go(Btn.Jump | Btn.Crouch); // one tick into the jump: airTime is still inside the no-pound window
    expect(e.char!.pounding).toBe(false);
    for (let i = 0; i < 40; i++) go(Btn.Jump);
    expect(seen).toContain('ground_pound');
  });

  it('a crouch on the ground does not carry into the next jump as a pound', async () => {
    const { sim, e } = await makeSim();
    for (let i = 0; i < 30; i++) sim.step();
    let seq = 1;
    const seen: string[] = [];
    const go = (b: number) => { sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: b, rt: 0 }); sim.step(); for (const v of sim.drainEvents()) seen.push(v.e === 'ability' ? v.ability : v.e); };
    go(Btn.Crouch); go(Btn.Jump);
    for (let i = 0; i < 60; i++) go(Btn.Jump);
    expect(seen).toContain('jump');
    expect(seen).not.toContain('ground_pound');
  });

  it('honours the whole jump buffer: a press 7 ticks (~117 ms) before touchdown still jumps', async () => {
    // jump, double jump, then press again shortly before landing (the press can only be buffered: no jumps left)
    const hop = async (earlyPressAt: number) => {
      const { sim, e } = await makeSim();
      for (let i = 0; i < 30; i++) sim.step();
      let seq = 1, t = 0, land = -1, rejump = -1;
      const go = (b: number) => {
        sim.setInput(e.id, { seq: seq++, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: b, rt: 0 }); sim.step(); t++;
        for (const v of sim.drainEvents()) if (v.e === 'jump' && land >= 0 && rejump < 0) rejump = t;
        if (land < 0 && t > 20 && e.char!.grounded) land = t;
      };
      go(Btn.Jump); for (let i = 0; i < 12; i++) go(0);
      go(Btn.Jump); while (t < 200 && (land < 0 || t < land + 5)) go(t + 1 === earlyPressAt ? Btn.Jump : 0);
      return { land, rejump };
    };
    const dry = await hop(-1);
    expect(dry.land).toBeGreaterThan(20);
    expect(dry.rejump).toBe(-1);
    const early = await hop(dry.land - 7);
    expect(early.land).toBe(dry.land);
    expect(early.rejump).toBe(dry.land + 1);
  });
});

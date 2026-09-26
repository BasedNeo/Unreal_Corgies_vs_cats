import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Btn } from '../../src/shared/input';
import { Team, Species, EFlag } from '../../src/shared/types';

async function makeSim() {
  const sim = await Sim.create({ seed: 7 });
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

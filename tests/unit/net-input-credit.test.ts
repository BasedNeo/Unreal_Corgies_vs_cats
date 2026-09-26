// Regression for QA W1 "speed exploit": a client that sends more than one input per tick must not move faster
// than real time. The Room's input credit only allows catch-up after genuine starvation (late packets).
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room, type Conn } from '../../src/host/room';
import type { WorldData } from '../../src/shared/world/world-data';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import type { InputCmd } from '../../src/shared/input';

// Flat ground built through the real terrain path (trimesh), like the West Yard.
function flatWorld(): WorldData {
  const n = 65, cell = 2;
  const terrain = { x0: -64, z0: -64, cell, n, heights: new Float32Array(n * n) };
  return { seed: 1, name: 'flat', height: () => 0, halfExtent: 60, props: [], terrain, spawns: [{ x: 0, y: 0.5, z: 45, yaw: 0, team: 0 }, { x: 0, y: 0.5, z: -45, yaw: 0, team: 1 }], killY: -30 };
}

async function run(perTick: number, starveEvery = 0): Promise<number> {
  const sim = await Sim.create({ seed: 3, world: flatWorld() });
  const room = new Room(sim, { mode: 'test', botsPerTeam: [0, 0] });
  const conn: Conn = { id: 'c', send: () => {} };
  const slot = room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: 'x', team: 0, cls: 'assault' })!;
  for (let i = 0; i < 30; i++) room.tick();
  const e = sim.entities.get(slot.entity)!;
  const z0 = e.pos.z;
  let seq = 0;
  const cmd = (): InputCmd => ({ seq: ++seq, mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: 0, rt: 0 });
  let pending: InputCmd[] = [];
  for (let t = 0; t < 300; t++) {
    for (let k = 0; k < perTick; k++) pending.push(cmd());
    // Optional burstiness: hold packets for `starveEvery` ticks, then deliver them all at once.
    if (!starveEvery || t % starveEvery === 0) { room.handle('c', { t: 'input', cmds: pending }); pending = []; }
    room.tick();
  }
  return z0 - e.pos.z;
}

describe('input credit', () => {
  it('sending two inputs per tick gives no extra speed', async () => {
    const honest = await run(1);
    const cheater = await run(2);
    expect(honest).toBeGreaterThan(25);
    expect(cheater).toBeLessThanOrEqual(honest * 1.005);
  });

  it('bursty but honest delivery still catches up (no lost movement)', async () => {
    const steady = await run(1);
    const bursty = await run(1, 6); // packets arrive in bursts of 6 ticks
    expect(bursty).toBeGreaterThan(steady * 0.95);
  });
});

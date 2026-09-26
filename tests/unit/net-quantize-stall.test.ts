// Regression (lead, QA W1 follow-up): snapshot-precision quantization must never park a character on the KCC's
// 2 cm skin distance, where Rapier's controller deadlocks on flat ground (was: frozen for good at z=34.709).
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { quantizeMotion } from '../../src/host/quantize';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem } from '../../src/sim/systems/core';

describe('quantized movement on flat ground', () => {
  it('keeps running along a grid line with per-tick quantization', async () => {
    const n = 65, cell = 2;
    const terrain = { x0: -64, z0: -64, cell, n, heights: new Float32Array(n * n) };
    const world = { seed: 1, name: 'flat', height: () => 0, halfExtent: 60, props: [], terrain, spawns: [{ x: 0, y: 0.5, z: 45, yaw: 0, team: 0 as const }], killY: -30 };
    const sim = await Sim.create({ seed: 3, world, systems: [movementSystem, physicsStepSystem] });
    const e = sim.spawnCharacter({ team: 0, species: 0, cls: 'assault', name: 't', x: 0, y: 0.5, z: 45 });
    for (let i = 0; i < 30; i++) { sim.step(); quantizeMotion(e); }
    const z0 = e.pos.z;
    for (let t = 0; t < 600; t++) {
      sim.setInput(e.id, { seq: t + 1, mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: 0, rt: 0 });
      sim.step();
      quantizeMotion(e);
      expect(e.pos.y).toBeGreaterThan(0.0199); // never inside the skin
    }
    // 10 s at 6.4 m/s ≈ 63 m minus the ramp; the lane is 108 m long.
    expect(z0 - e.pos.z).toBeGreaterThan(55);
  });
});

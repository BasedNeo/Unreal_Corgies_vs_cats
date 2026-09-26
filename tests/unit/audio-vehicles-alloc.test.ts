// S2: the vehicle engine loops allocate nothing per update in steady state. In its own file on purpose: vitest runs
// each file in a fresh process, so V8's inlining isn't shaped by other tests' polymorphic use of the fakes (which
// can leave a double argument boxed at a call boundary and blur a byte-exact measurement).
import { describe, expect, it } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';
import { PerformanceObserver } from 'node:perf_hooks';
import { EFlag } from '../../src/shared/types';
import { packPlaneAux } from '../../src/shared/content/vehicles';
import { VehicleLoops } from '../../src/client/audio/vehicle-loops';
import { FNode, byId, fakeCtx, host, vehicle } from './audio-fakes';

describe('S2 vehicle loops: steady-state allocations', () => {
  it('allocates nothing per update in steady state (4 moving loops, 40k updates)', async () => {
    // Heap growth is exact while no GC runs (checked with a gc PerformanceObserver). The harness's own cost (moving
    // the states, advancing the clock) is measured the same way without the loops and subtracted. Combat intensity
    // is held constant here: a computed double passed into update() (or into any Web Audio setTargetAtTime binding,
    // like the duck's) is boxed into a 12-byte HeapNumber by V8 at the call boundary — engine-level, not our garbage.
    v8.setFlagsFromString('--expose_gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const f = fakeCtx();
    const loops = new VehicleLoops(host(f), f.ctx, new FNode('sfx') as unknown as AudioNode);
    const list = [
      vehicle(10, { weapon: 1, vx: 9 }),
      vehicle(11, { weapon: 5, z: 12, vx: 14, flags: EFlag.Grounded | EFlag.Sprinting }),
      vehicle(12, { weapon: 6, cls: 1, z: 20, y: 9, vz: 20, ammo: packPlaneAux(0.8, 0.2), flags: 0 }),
      vehicle(13, { weapon: 7, cls: 1, z: -25, y: 14, vz: 8, ammo: packPlaneAux(0.3, -0.1), flags: EFlag.Crouching }),
      vehicle(14, { weapon: -1, z: 4 }), // parked
    ];
    const states = byId(list);
    let tick = 0;
    const move = () => {
      tick++;
      const w = Math.sin(tick * 0.01);
      list[0].vx = 9 + 5 * w; list[1].x = 3 * w; list[2].z = 20 + 6 * w; list[3].vz = 8 + 4 * w;
      f.ctx.currentTime += 1 / 30;
    };
    const withLoops = () => { move(); loops.update(states, 1, 1 / 30, 0.5); };
    for (let i = 0; i < 4000; i++) { move(); loops.update(states, 1, 1 / 30, 0.5 + 0.5 * Math.sin(i * 0.05)); } // warm up (JIT, knobs)
    expect(loops.active).toBe(4);
    let gcs = 0;
    const obs = new PerformanceObserver((l) => { gcs += l.getEntries().length; });
    obs.observe({ entryTypes: ['gc'] });
    const N = 40_000;
    const measure = async (fn: () => void) => {
      gc();
      await new Promise((r) => setTimeout(r, 10));
      gcs = 0;
      const h0 = process.memoryUsage().heapUsed;
      for (let i = 0; i < N; i++) fn();
      const h1 = process.memoryUsage().heapUsed;
      await new Promise((r) => setTimeout(r, 10));
      return { bytes: h1 - h0, gcs };
    };
    for (let i = 0; i < 4000; i++) move();
    const base = await measure(move);
    const run = await measure(withLoops);
    obs.disconnect();
    const perUpdate = (run.bytes - base.bytes) / N;
    console.log(`[S2] steady state, ${N} updates × 4 loops: heap +${run.bytes} B (harness alone +${base.bytes} B) → ${perUpdate.toFixed(3)} B/update; GCs ${run.gcs}/${base.gcs}`);
    expect(run.gcs).toBe(0);
    expect(base.gcs).toBe(0);
    expect(perUpdate).toBeLessThan(1); // a single object, array, closure or boxed number per update would be ≥ 12 B
    expect(loops.stats.built).toBe(4); // steady: no rebuilds
  });
});

// W9 X4 performance: throws allocate nothing after warm-up. Own file (the heap measurements want a quiet process).
// Measured like X3 (tests/unit/fx-weapons-perf.test.ts): heap after a forced GC, before and after thousands of throws,
// against the same 96 KB harness-noise allowance, so anything a throw keeps (an object, a closure, a growing array)
// shows up: one 32-byte object per throw over 3000 throws is already 96 KB. (Idle sim ticks alone wander by ±50 KB
// between measurements; that is why the counts are large.)
//  1. The shared hot paths the client preview runs every frame and the bots run to plan (throwLaunch, clampLaunch,
//     predictArc with preview dots, stepBody on the arc world, solveThrow): nothing retained. No objects or arrays are
//     created on them (module scratch); their transient heap is V8 boxing doubles passed to non-inlined calls
//     (the existing world.height() shows the same 80 B per call) — reported, bounded against regressions.
//  2. The authority: full cycles (throw → flight → bounces → blast → despawn, pooled entities) retain nothing.
import { describe, expect, it } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';
import { Sim, type SimSystem } from '../../src/sim/sim';
import { Btn } from '../../src/shared/input';
import { Species, Team } from '../../src/shared/types';
import { createWorldData } from '../../src/shared/world/world-data';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem } from '../../src/sim/systems/core';
import { worldSystems } from '../../src/sim/world/systems';
import { combatSystems, liveOrdnance, tryThrow } from '../../src/sim/combat';
import {
  arcQuery, arcWorldOf, clampLaunch, launchBody, makeArcResult, makeBody, makeLaunch, makeSegHit, makeSolve, ordnanceFor,
  predictArc, solveThrow, stepBody, throwLaunch, type SegQuery,
} from '../../src/shared/content/ordnance';

v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc') as () => void;
const heapAfterGc = () => { gc(); gc(); return process.memoryUsage().heapUsed; };
/** Bytes allocated by fn() (no GC can run inside: the young generation is emptied first and fn allocates far less). */
/** Transient bytes fn() puts on the heap (young generation emptied first; fn allocates far less than it holds). */
function transient(fn: () => void): number {
  gc(); gc();
  const h0 = process.memoryUsage().heapUsed;
  fn();
  return process.memoryUsage().heapUsed - h0;
}

describe('X4 ordnance: allocations', () => {
  it('the preview / AI hot paths allocate nothing (launch, clamp, predictArc + dots, stepBody, solveThrow)', () => {
    const world = createWorldData(1, 'west_yard');
    const aw = arcWorldOf(world);
    const L = makeLaunch(), arc = makeArcResult(), pts = new Float32Array(96 * 3), body = makeBody(), hit = makeSegHit(), s = makeSolve();
    const def = ordnanceFor(Species.Corgi);
    const q: SegQuery = (ox, oy, oz, dx, dy, dz, len, out) => arcQuery(aw, ox, oy, oz, dx, dy, dz, len, out);
    const sp = world.spawns[0];
    const frame = (i: number) => {
      throwLaunch(sp.x, sp.y, sp.z, i * 0.37, -0.3 + (i % 9) * 0.1, Species.Corgi, L);
      clampLaunch(aw, sp.x, sp.y, sp.z, Species.Corgi, L);
      predictArc(aw, L, def, arc, pts, 2);
      launchBody(body, L);
      for (let k = 0; k < 30; k++) stepBody(body, def, 1 / 60, q, hit);
    };
    for (let i = 0; i < 200; i++) frame(i); // warm-up (JIT)
    for (let i = 0; i < 40; i++) solveThrow(aw, sp.x, sp.y, sp.z, Species.Cat, sp.x + 6 + (i % 7), world.height(sp.x + 6, sp.z - 9), sp.z - 9 - (i % 5), s);
    const solves = (n: number) => { for (let i = 0; i < n; i++) solveThrow(aw, sp.x, sp.y, sp.z, Species.Cat, sp.x + 6 + (i % 7), world.height(sp.x + 6, sp.z - 9), sp.z - 9 - (i % 5), s); };
    for (let i = 0; i < 2000; i++) frame(i); // more warm-up: every branch optimized (JIT code lives on the heap too)
    solves(200);
    const h0 = heapAfterGc();
    for (let i = 0; i < 4000; i++) frame(i);
    solves(400);
    const retained = heapAfterGc() - h0;
    const perFrame = transient(() => { for (let i = 0; i < 500; i++) frame(i); }) / 500;
    const perSolve = transient(() => solves(50)) / 50;
    console.log(`[X4 alloc] 4000 preview frames + 400 aim solves retain ${retained} B (${(retained / 4000).toFixed(2)} B/frame); transient (boxed doubles) ${(perFrame / 1024).toFixed(1)} KB per preview frame, ${(perSolve / 1024).toFixed(1)} KB per aim solve`);
    expect(retained).toBeLessThan(96 * 1024); // one 24-byte object per frame would already be 96 KB
    expect(perFrame).toBeLessThan(64 * 1024); // regression guard: one preview is ~130 ticks of flight
    expect(perSolve).toBeLessThan(512 * 1024);
  });

  it('the throw itself and full throw → flight → blast cycles: nothing of its own per throw, nothing retained', async () => {
    const world = createWorldData(1, 'west_yard');
    const systems: SimSystem[] = [movementSystem, ...worldSystems(), physicsStepSystem, ...combatSystems()];
    const sim = await Sim.create({ seed: 2, world, systems });
    sim.state.ordnanceConfig = { enabled: true };
    const sp = world.spawns[0];
    const dog = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'd', x: sp.x, y: sp.y, z: sp.z, ownerPid: 'p' });
    const cat = sim.spawnCharacter({ team: Team.Cats, species: Species.Cat, cls: 'warden', name: 'c', x: sp.x + 8, y: sp.y, z: sp.z - 10 });
    let seq = 1;
    const input = { seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, rt: 0 };
    const tick = () => { sim.step(); sim.drainEvents(); sim.removedIds.length = 0; };
    const cycle = (i: number) => {
      dog.ordCarry!.carry = true; dog.ordCarry!.nextThrow = 0;
      input.seq = seq++; input.yaw = 3.4 + (i % 5) * 0.08; input.pitch = 0.1 + (i % 3) * 0.1; input.buttons = Btn.Throw;
      sim.setInput(dog.id, input); tick();
      input.seq = seq++; input.buttons = 0; sim.setInput(dog.id, input); tick();
      for (let t = 0; t < 140; t++) tick();
      cat.health!.hp = cat.health!.max; dog.health!.hp = dog.health!.max; // nobody dies (no respawn churn)
      sim.placeCharacter(cat, sp.x + 8, sp.y, sp.z - 10); sim.placeCharacter(dog, sp.x, sp.y, sp.z);
    };
    tick();
    for (let i = 0; i < 30; i++) cycle(i); // warm-up: pool, JIT, Rapier caches
    // the throw path alone: throw, and take it straight back (the pool round trip), n times
    const throwOnly = (n: number) => {
      for (let i = 0; i < n; i++) {
        dog.ordCarry!.carry = true; dog.ordCarry!.nextThrow = 0;
        tryThrow(sim, dog);
        sim.removedIds.length = 0;
        const live = liveOrdnance(sim);
        sim.removeEntity(live[live.length - 1].id); // removed: the next ordnance tick returns it to the pool
        tick();
      }
    };
    throwOnly(6000); // JIT warm-up: the first few thousand throws still settle optimized code on the heap
    for (let i = 0; i < 100; i++) cycle(i); // more warm-up (bounce/blast branches, Rapier's caches)
    let h0 = heapAfterGc();
    throwOnly(3000);
    const throwGrown = heapAfterGc() - h0;
    h0 = heapAfterGc();
    for (let i = 0; i < 400; i++) cycle(i);
    const cycleGrown = heapAfterGc() - h0;
    const perThrow = Math.max(0, transient(() => throwOnly(200)) - transient(() => { for (let i = 0; i < 200; i++) tick(); })) / 200;
    console.log(`[X4 alloc] authority: 3000 throws ${throwGrown >= 0 ? '+' : ''}${throwGrown} B (${(throwGrown / 3000).toFixed(2)} B/throw), 400 full throw → flight → blast cycles ${cycleGrown >= 0 ? '+' : ''}${cycleGrown} B; transient ≈ ${perThrow.toFixed(0)} B/throw over idle ticks (boxed doubles, the entities Map's amortized rehash)`);
    expect(throwGrown).toBeLessThan(96 * 1024);
    expect(cycleGrown).toBeLessThan(96 * 1024);
    expect(perThrow).toBeLessThan(4096);
  }, 120_000);
});

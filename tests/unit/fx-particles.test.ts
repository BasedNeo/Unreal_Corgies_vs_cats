// L5: pooled particles — slot reuse, bounded capacity, zero allocations per spawn/update/write after warm-up.
import { describe, expect, it } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';
import { Curve, Fade, FxRng, Mode, ParticlePool, Shape, createInstanceArrays, makeSpec, resetSpec, sizeAt } from '../../src/client/fx/particle-pool';
import * as P from '../../src/client/fx/presets';

v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc') as () => void;

function heapAfterGc(): number { gc(); gc(); return process.memoryUsage().heapUsed; }

describe('ParticlePool', () => {
  it('spawns into slots, ages out and reuses them (compacted, bounded)', () => {
    const pool = new ParticlePool(8);
    const s = makeSpec();
    s.life = 0.1;
    for (let i = 0; i < 8; i++) expect(pool.spawn(s)).toBe(i);
    expect(pool.count).toBe(8);
    pool.update(0.2); // all dead
    expect(pool.count).toBe(0);
    // Freed slots are reused from 0 again.
    expect(pool.spawn(s)).toBe(0);
    expect(pool.spawn(s)).toBe(1);
  });

  it('steals round-robin when full instead of growing', () => {
    const pool = new ParticlePool(4);
    const s = makeSpec();
    s.life = 10;
    for (let i = 0; i < 4; i++) pool.spawn(s);
    const stolen = [pool.spawn(s), pool.spawn(s), pool.spawn(s), pool.spawn(s), pool.spawn(s)];
    expect(stolen).toEqual([0, 1, 2, 3, 0]);
    expect(pool.count).toBe(4);
    expect(pool.stats.stolen).toBe(5);
  });

  it('kills by swapping the last particle into the hole (survivors keep their data)', () => {
    const pool = new ParticlePool(4);
    const s = makeSpec();
    const out = createInstanceArrays(4);
    s.life = 0.05; s.x = 1; pool.spawn(s);      // dies first
    s.life = 1; s.x = 2; pool.spawn(s);
    s.life = 1; s.x = 3; pool.spawn(s);
    pool.update(0.1);
    expect(pool.count).toBe(2);
    pool.write(out);
    const xs = [out.pos[0], out.pos[4]].sort();
    expect(xs).toEqual([2, 3]);
  });

  it('writes 4 floats per attribute per alive particle into the same GPU arrays every frame', () => {
    const pool = new ParticlePool(16);
    const out = createInstanceArrays(16);
    const refs = [out.pos, out.col, out.axis, out.misc];
    const s = makeSpec();
    s.life = 1; s.size0 = 0.5; s.size1 = 0.5; s.r = 0.2; s.g = 0.4; s.b = 0.6; s.shape = Shape.Star; s.mode = Mode.Ground; s.param = 0.3;
    s.x = 1; s.y = 2; s.z = 3;
    for (let i = 0; i < 5; i++) pool.spawn(s);
    expect(pool.write(out)).toBe(5);
    expect(Array.from(out.pos.subarray(0, 4))).toEqual([1, 2, 3, 0.5]);
    expect(out.col[3]).toBe(Shape.Star);
    expect(out.misc[1]).toBe(Mode.Ground);
    expect(out.misc[2]).toBeCloseTo(0.3);
    pool.update(0.016);
    pool.write(out);
    expect([out.pos, out.col, out.axis, out.misc]).toEqual(refs);
    refs.forEach((r, i) => expect(r).toBe([out.pos, out.col, out.axis, out.misc][i]));
  });

  it('head-anchors velocity streaks: tail never starts behind the spawn point', () => {
    const pool = new ParticlePool(2);
    const out = createInstanceArrays(2);
    const s = makeSpec();
    s.mode = Mode.Stretched; s.vx = 100; s.stretch = 0.05; s.life = 1; // wants a 5 m streak
    pool.spawn(s);
    pool.update(0.01); // traveled 1 m
    pool.write(out);
    const len = out.axis[0];
    expect(len).toBeGreaterThan(0.9);
    expect(len).toBeLessThan(1.1); // capped by distance traveled, not 5 m
    expect(out.pos[0]).toBeCloseTo(1 - len / 2, 3); // centered between spawn and head
  });

  it('size curves: pop overshoots then shrinks to zero; hold-shrink ends at zero', () => {
    expect(sizeAt(Curve.Linear, 1, 3, 0.5)).toBeCloseTo(2);
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => sizeAt(Curve.Pop, 0, 1, i / 49)));
    expect(peak).toBeGreaterThan(1.05);
    expect(sizeAt(Curve.Pop, 0, 1, 1)).toBeCloseTo(0);
    expect(sizeAt(Curve.HoldShrink, 0.2, 0.4, 1)).toBeCloseTo(0);
  });

  it('glow fade dims color over life', () => {
    const pool = new ParticlePool(1);
    const out = createInstanceArrays(1);
    const s = makeSpec();
    s.fade = Fade.Fade; s.life = 1; s.r = 2;
    pool.spawn(s);
    pool.write(out);
    const c0 = out.col[0];
    pool.update(0.5);
    pool.write(out);
    expect(out.col[0]).toBeLessThan(c0 * 0.3);
  });

  it('allocates nothing per spawn/update/write after warm-up (heap measured with forced GC)', () => {
    const pool = new ParticlePool(1024);
    const out = createInstanceArrays(1024);
    const s = makeSpec();
    const rng = new FxRng(1);
    const frame = () => {
      for (let i = 0; i < 40; i++) {
        resetSpec(s);
        s.x = rng.sym(5); s.vy = rng.range(1, 4); s.life = rng.range(0.2, 0.8); s.mode = i % 3; s.stretch = 0.03; s.vx = 20;
        pool.spawn(s);
      }
      pool.update(1 / 60);
      pool.write(out);
    };
    for (let i = 0; i < 200; i++) frame(); // warm-up (JIT, steady state)
    const arraysBefore = pool.stats.arrays;
    const before = heapAfterGc();
    for (let i = 0; i < 5000; i++) frame(); // 200k spawns, 5k updates + writes
    const grown = heapAfterGc() - before;
    expect(pool.stats.spawned).toBeGreaterThan(200_000);
    expect(pool.stats.arrays).toBe(arraysBefore);
    // Even 8 bytes per spawn would be 1.6 MB; allow noise from the test harness itself.
    expect(grown).toBeLessThan(96 * 1024);
  });

  it('effect recipes (muzzle flash, tracer, hits, explosion, poof) spawn without allocating', () => {
    const pools: P.FxPools = { solid: new ParticlePool(1400), glow: new ParticlePool(700), rng: new FxRng(3), density: 1 };
    const out = createInstanceArrays(1400);
    const burst = () => {
      P.muzzleFlash(pools, 0, 1, 0, 0, 0, -1, 0xffd04a, 0.26);
      P.tracer(pools, 0, 1, 0, 3, 1, -12, 0xd7f542, 2.6);
      P.laserBeam(pools, 0, 1, 0, 3, 1, -20, 0xff3b3b, 4);
      P.furHit(pools, 3, 1, -12, true, 1, true, 0, -1);
      P.worldHit(pools, 1, 0, -6, 0);
      P.explosion(pools, 4, 0, -10, 3.5, 0);
      P.deathPoof(pools, 3, 0, -12, false);
      P.landDust(pools, 0, 0, 0, 15);
      P.sprintPuff(pools, 0, 0, 0, 6, 6);
      pools.solid.update(1 / 60); pools.glow.update(1 / 60);
      pools.solid.write(out);
    };
    // Long warm-up: TurboFan code objects land on the heap during the first few thousand calls.
    for (let i = 0; i < 3000; i++) burst();
    const before = heapAfterGc();
    for (let i = 0; i < 6000; i++) burst(); // ≈ 600k particle spawns
    const grown = heapAfterGc() - before;
    expect(pools.solid.count).toBeLessThanOrEqual(1400);
    expect(pools.glow.count).toBeLessThanOrEqual(700);
    // 1 byte per spawn would already be ~600 KB.
    expect(grown).toBeLessThan(128 * 1024);
  });
});

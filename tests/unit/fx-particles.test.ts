// L5: pooled particles — slot reuse, bounded capacity, zero allocations per spawn/update/write after warm-up.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import v8 from 'node:v8';
import * as THREE from 'three/webgpu';
import vm from 'node:vm';
import { Curve, Fade, FxRng, Mode, ParticlePool, Shape, createInstanceArrays, makeSpec, resetSpec, sizeAt } from '../../src/client/fx/particle-pool';
import * as P from '../../src/client/fx/presets';
import * as W from '../../src/client/fx/presets-weapons';
import * as O from '../../src/client/fx/presets-ordnance';
import { WEAPON_FX } from '../../src/client/fx/weapon-fx';
import { Surface } from '../../src/client/fx/surfaces';
import { createParticleMesh, PARTICLE_RENDER_ORDER } from '../../src/client/fx/particle-mesh';
import { createWorldData } from '../../src/shared/world/world-data';
import { createWaterView } from '../../src/client/world/water-view';
import { EntityViews } from '../../src/client/views/entity-views';
import { createFloodlights } from '../../src/client/style/floodlights.js';

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
    s.life = 1; s.size0 = 0.5; s.size1 = 0.5; s.r = 0.2; s.g = 0.4; s.b = 0.6; s.shape = Shape.Ring; s.mode = Mode.Ground; s.param = 0.3;
    s.x = 1; s.y = 2; s.z = 3;
    for (let i = 0; i < 5; i++) pool.spawn(s);
    expect(pool.write(out)).toBe(5);
    expect(Array.from(out.pos.subarray(0, 4))).toEqual([1, 2, 3, 0.5]);
    expect(out.col[3]).toBe(Shape.Ring);
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

  it('size curves: linear, and hold-shrink that grows to s1 without overshoot, then ends at zero (W15: no Pop)', () => {
    expect(Object.keys(Curve)).toEqual(['Linear', 'HoldShrink']);
    expect(sizeAt(Curve.Linear, 1, 3, 0.5)).toBeCloseTo(2);
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => sizeAt(Curve.HoldShrink, 0.4, 1, i / 49)));
    expect(peak).toBeLessThanOrEqual(1 + 1e-9);
    expect(sizeAt(Curve.HoldShrink, 0.2, 0.4, 1)).toBeCloseTo(0);
    // the retired overshoot id (1) is no special case any more: it sizes like Linear
    expect(sizeAt(1, 1, 3, 0.5)).toBeCloseTo(2);
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

  it('effect recipes (muzzle flash, tracer, hits, explosion, takedown) spawn without allocating', () => {
    const pools: P.FxPools = { solid: new ParticlePool(1400), glow: new ParticlePool(700), rng: new FxRng(3), density: 1 };
    const out = createInstanceArrays(1400);
    const burst = () => {
      P.muzzleFlash(pools, 0, 1, 0, 0, 0, -1, 0xffd04a, 0.26);
      P.tracer(pools, 0, 1, 0, 3, 1, -12, 0xd7f542, 2.6);
      P.laserBeam(pools, 0, 1, 0, 3, 1, -20, 0xff3b3b, 4);
      P.furHit(pools, 3, 1, -12, true, 1, true, 0, -1);
      P.worldHit(pools, 1, 0, -6, 0);
      P.explosion(pools, 4, 0, -10, 3.5, 0);
      P.takedownDust(pools, 3, 0, -12, false);
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

/** The ids W15 retired (the comic Star and spiky Burst shapes, the overshoot Pop curve): nothing may spawn them. */
const RETIRED = { Star: 3, Burst: 6, Pop: 1 } as const;

describe('hit + takedown FX (W15: stylised-realistic, no comic)', () => {
  it('the killing hit and the takedown in one fresh pool: no Star/Burst/Splat, no ink, no Pop, coats under the night cap', () => {
    // A rifle takedown emits 'hit' then 'death' in the same tick (src/sim/combat/damage.ts), so both recipes land
    // together. The pool's SoA store is private: read its curve field by index, proven first on two known spawns.
    const CURVE = 10;
    const fieldsOf = (pool: ParticlePool) => (pool as unknown as { f: Float32Array[] }).f;
    const probe = new ParticlePool(2), spec = makeSpec();
    spec.curve = Curve.Linear; probe.spawn(spec);
    spec.curve = Curve.HoldShrink; probe.spawn(spec);
    expect([fieldsOf(probe)[CURVE][0], fieldsOf(probe)[CURVE][1]]).toEqual([Curve.Linear, Curve.HoldShrink]);
    // Brightest coat channel × the night scale (0.35), per species, plus a hair: full-strength coats fail.
    const TUFT_CAP = { cat: 0.21, corgi: 0.32 };
    const BANNED = new Set<number>([RETIRED.Star, RETIRED.Burst, Shape.Splat]);
    for (const [cat, crit, density, seed] of [[true, true, 1, 1], [true, false, 1, 2], [false, true, 1, 3], [false, false, 0.35, 4]] as const) {
      const pools: P.FxPools = { solid: new ParticlePool(256), glow: new ParticlePool(64), rng: new FxRng(seed), density };
      P.furHit(pools, 3, 1.1, -12, cat, cat ? 1 : 0, crit, 0, -1);
      P.takedownDust(pools, 3, 0, -12, cat);
      for (const [name, pool] of [['solid', pools.solid], ['glow', pools.glow]] as const) {
        const out = createInstanceArrays(pool.capacity);
        const n = pool.write(out), curve = fieldsOf(pool)[CURVE];
        expect(n, name).toBeGreaterThan(0);
        for (let i = 0; i < n; i++) {
          const o = i * 4, shape = out.col[o + 3], hi = Math.max(out.col[o], out.col[o + 1], out.col[o + 2]);
          const what = `${name} #${i} shape ${shape} (cat ${cat}, crit ${crit})`;
          expect(BANNED.has(shape), `${what}: no Star, Burst or Splat`).toBe(false);
          expect(out.misc[o + 2], `${what}: no ink`).toBe(0);
          expect(curve[i], `${what}: no Pop`).not.toBe(RETIRED.Pop);
          if (name === 'glow') { expect(shape, `${what}: the only glow is the soft impact glow`).toBe(Shape.Glow); continue; }
          expect(out.axis[o + 3], `${what}: opaque, no halftone`).toBe(1);
          expect(hi, `${what}: under the night cap`).toBeLessThanOrEqual(shape === Shape.Tuft ? TUFT_CAP[cat ? 'cat' : 'corgi'] : 0.3);
        }
      }
      expect(pools.glow.count, 'one soft glow per hit, nothing from the takedown').toBe(1);
    }
  });

  const SRC = readFileSync(new URL('../../src/client/fx/presets.ts', import.meta.url), 'utf8');
  it('is a muted wet-night dust and grit burst plus fur tufts: no stars, no glow, no white pop, no ink rim', () => {
    expect('deathPoof' in P).toBe(false);
    for (const [seed, density, cat] of [[1, 1, false], [7, 1, true], [3, 0.35, true]] as const) {
      const pools: P.FxPools = { solid: new ParticlePool(256), glow: new ParticlePool(64), rng: new FxRng(seed), density };
      P.takedownDust(pools, 3, 0, -12, cat);
      expect(pools.glow.count, 'no glow particles (the dizzy stars were additive)').toBe(0);
      const out = createInstanceArrays(256);
      const n = pools.solid.write(out);
      expect(n).toBeGreaterThan(0);
      const shapes = new Set<number>();
      for (let i = 0; i < n; i++) {
        const o = i * 4, r = out.col[o], g = out.col[o + 1], b = out.col[o + 2], shape = out.col[o + 3];
        shapes.add(shape);
        expect([Shape.Puff, Shape.Chunk, Shape.Tuft]).toContain(shape);
        expect(out.misc[o + 2], 'no ink rim').toBe(0);
        expect(out.axis[o + 3], 'opaque: no halftone screen-door').toBe(1);
        if (shape !== Shape.Tuft) {
          // dust and grit: dark, near-neutral greys under the night exposure (the old pop was 0xfff4dc × 0.84 white)
          expect(Math.max(r, g, b)).toBeLessThan(0.12);
          expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.02);
        }
      }
      expect(shapes.has(RETIRED.Star)).toBe(false);
      expect(shapes.has(Shape.Puff) && shapes.has(Shape.Chunk) && shapes.has(Shape.Tuft)).toBe(true);
    }
    // and the recipe itself never reaches for the cartoon pieces
    const body = SRC.slice(SRC.indexOf('export function takedownDust'), SRC.indexOf('\n}\n', SRC.indexOf('export function takedownDust')));
    expect(body.length).toBeGreaterThan(100);
    for (const banned of ['Shape.Star', 'Curve.Pop', 'p.glow', 'C.white', 'Fade.Soft']) expect(body, banned).not.toContain(banned);
  });
});

describe('no ink, no comic anywhere in the FX (W15 Sprint D: dead ink helpers)', () => {
  const MESH = readFileSync(new URL('../../src/client/fx/particle-mesh.ts', import.meta.url), 'utf8');
  type Pools = P.FxPools;
  const fresh = (seed: number): Pools => ({ solid: new ParticlePool(2048), glow: new ParticlePool(1024), rng: new FxRng(seed), density: 1 });
  // Every exported recipe, with the arguments the game uses (both teams, both species, crits, every surface, every gun).
  const RECIPES: Record<string, (p: Pools) => void> = {
    'P.muzzleFlash': (p) => P.muzzleFlash(p, 0, 1, 0, 0, 0, -1, 0xffd04a, 0.26),
    'P.tracer': (p) => P.tracer(p, 0, 1, 0, 3, 1, -12, 0xd7f542, 2.6),
    'P.laserBeam': (p) => P.laserBeam(p, 0, 1, 0, 3, 1, -20, 0xff3b3b, 4),
    'P.waterSpray': (p) => P.waterSpray(p, 0, 1, 0, 2, 1, -6),
    'P.discWhoosh': (p) => P.discWhoosh(p, 0, 1, 0, 2, 1, -6),
    'P.furHit': (p) => { for (const c of [true, false]) for (const k of [true, false]) P.furHit(p, 3, 1, -12, c, c ? 1 : 0, k, 0, -1); },
    'P.worldHit': (p) => P.worldHit(p, 1, 0, -6, 0),
    'P.destructDust': (p) => { P.destructDust(p, 1, 1, -6, 0, 1.2, true); P.destructDust(p, 1, 1, -6, 0, 1.2, false); },
    'P.landDust': (p) => P.landDust(p, 0, 0, 0, 15),
    'P.jumpDust': (p) => { P.jumpDust(p, 0, 0, 0, false); P.jumpDust(p, 0, 0, 0, true); },
    'P.sprintPuff': (p) => P.sprintPuff(p, 0, 0, 0, 6, 6),
    'P.ballTrail': (p) => P.ballTrail(p, 0, 1, 0),
    'P.explosion': (p) => P.explosion(p, 4, 0, -10, 3.5, 0),
    'P.takedownDust': (p) => { P.takedownDust(p, 3, 0, -12, true); P.takedownDust(p, 3, 0, -12, false); },
    'P.respawnSparkle': (p) => { P.respawnSparkle(p, 0, 0, 0, 0); P.respawnSparkle(p, 0, 0, 0, 1); },
    'P.pickupSparkle': (p) => P.pickupSparkle(p, 0, 0, 0),
    'P.abilityRing': (p) => { P.abilityRing(p, 0, 0, 0, 0, false); P.abilityRing(p, 0, 0, 0, 1, true); },
    'W.muzzle': (p) => { for (const w of Object.values(WEAPON_FX)) W.muzzle(p, w, 0, 1, 0, 0, 0, -1, 1, 0, 0); },
    'W.smoke': (p) => W.smoke(p, [0.3, 0.3, 0.3], 4, 0, 1, 0, 0, 0, -1, 1),
    'W.groundGlow': (p) => W.groundGlow(p, 0, 0, 0, 0xff9b3d, 0.7, 0.4),
    'W.tracer': (p) => W.tracer(p, 0, 1, 0, 3, 1, -20, 0xffb84a, 3, 0.034),
    'W.casing': (p) => { for (const k of ['rifle', 'pistol', 'magnum', 'shell'] as const) W.casing(p, k, 0.1, 1, 0.4, 1, 0, 0, 0, 0, 1, 0); },
    'W.impact': (p) => { for (const k of Object.values(Surface)) W.impact(p, k, 2, 1, -9, 0, 0, 1, 0, 0, -1, 1, 0); },
    'W.clawSlash': (p) => W.clawSlash(p, 0, 1, -1, 1, 0),
    'W.explosionExtras': (p) => W.explosionExtras(p, 4, 0, -10, 4.2, 0),
    'O.ordTrail': (p) => { for (const k of [0, 1] as const) for (let i = 0; i < 8; i++) O.ordTrail(p, k, 0, 1, 0, 3, 2, 0); },
    'O.ordBounce': (p) => { for (const k of [0, 1] as const) O.ordBounce(p, k, 0, 0.1, 0, 1, 0); },
    'O.ordFuse': (p) => { for (const k of [0, 1] as const) O.ordFuse(p, k, 0, 0.1, 0, 1); },
    'O.ordBlast': (p) => { for (const k of [0, 1] as const) for (const t of [0, 1]) O.ordBlast(p, k, t, 0, 0.2, 0, 3, 0); },
  };

  it('the comic pieces are gone from the vocabulary: no Star or Burst shape, no Pop curve, no default ink width', () => {
    expect(Object.keys(Shape)).not.toContain('Star');
    expect(Object.keys(Shape)).not.toContain('Burst');
    expect(Object.keys(Curve)).not.toContain('Pop');
    expect(makeSpec().param).toBe(0);
  });

  it('every recipe, run for real: no retired shape or curve, and no solid but a ring carries a shape parameter (ink)', () => {
    // a recipe added later must be listed here too
    const exported = [...Object.keys(P).map((k) => `P.${k}`), ...Object.keys(W).map((k) => `W.${k}`), ...Object.keys(O).map((k) => `O.${k}`)]
      .filter((k) => typeof ({ P, W, O } as Record<string, Record<string, unknown>>)[k[0]][k.slice(2)] === 'function');
    expect(exported.filter((k) => !(k in RECIPES)), 'recipes without a no-comic check').toEqual([]);
    const CURVE = 10, fieldsOf = (pool: ParticlePool) => (pool as unknown as { f: Float32Array[] }).f;
    let seed = 1;
    for (const [name, run] of Object.entries(RECIPES)) {
      const pools = fresh(seed++);
      run(pools);
      expect(pools.solid.count + pools.glow.count, `${name} spawns`).toBeGreaterThan(0);
      for (const [flavor, pool] of [['solid', pools.solid], ['glow', pools.glow]] as const) {
        const out = createInstanceArrays(pool.capacity);
        const n = pool.write(out), curve = fieldsOf(pool)[CURVE];
        for (let i = 0; i < n; i++) {
          const o = i * 4, shape = out.col[o + 3], what = `${name} ${flavor} #${i} (shape ${shape})`;
          expect([RETIRED.Star, RETIRED.Burst], `${what}: no comic star or spiky burst`).not.toContain(shape);
          expect([Curve.Linear, Curve.HoldShrink], `${what}: no Pop overshoot`).toContain(curve[i]);
          if (flavor === 'solid' && shape !== Shape.Ring) expect(out.misc[o + 2], `${what}: no ink width`).toBe(0);
        }
      }
    }
  });

  it('respawn and pickup are soft rising glows: Glow particles only, nothing solid, no ring', () => {
    for (const run of [(p: Pools) => P.respawnSparkle(p, 0, 0, 0, 0), (p: Pools) => P.respawnSparkle(p, 0, 0, 0, 1), (p: Pools) => P.pickupSparkle(p, 0, 0, 0)]) {
      const pools = fresh(5);
      run(pools);
      expect(pools.solid.count).toBe(0);
      const out = createInstanceArrays(pools.glow.capacity), n = pools.glow.write(out);
      expect(n).toBeGreaterThan(1);
      for (let i = 0; i < n; i++) expect(out.col[i * 4 + 3]).toBe(Shape.Glow);
    }
  });

  it('the particle shader draws no ink rim, no halftone, no toon crescent and no lobed cartoon puff; solids are alpha-blended', () => {
    const banned: Array<[RegExp, string]> = [
      [/PALETTE\.ink|\bINK\b/, 'an ink colour'],
      [/screenCoordinate|fract\(/, 'a halftone screen-door'],
      [/0\.7071|\bshade\b/, 'the 2-tone toon crescent'],
      [/ang\.mul\(7\)/, 'the 7-lobe cartoon puff'],
      [/pow\(abs\(p\.x\), 0\.5\)/, 'the star shape'],
      [/cos\(ang\.mul\(4\)\)/, 'the spiky burst shape'],
    ];
    for (const [re, what] of banned) expect(MESH, what).not.toMatch(re);
    const solid = createParticleMesh(4, 'solid'), glow = createParticleMesh(4, 'glow');
    const sm = solid.mesh.material as THREE.MeshBasicNodeMaterial, gm = glow.mesh.material as THREE.MeshBasicNodeMaterial;
    expect(sm.transparent, 'real alpha').toBe(true);
    expect(sm.depthWrite).toBe(false);
    expect(sm.blending).toBe(THREE.NormalBlending);
    expect(sm.opacityNode, 'opacity drives alpha, not a screen-door mask').not.toBeNull();
    expect(gm.blending).toBe(THREE.AdditiveBlending);
    solid.dispose(); glow.dispose();
  });

  it('the built solid node graph: the colour reads only the particle colour and a vertical gradient; no screen-space or periodic term', () => {
    // Names can be dodged (a literal vec3 rim colour, a halftone from viewportCoordinate + mod), so check the graph.
    const solid = createParticleMesh(4, 'solid');
    const m = solid.mesh.material as THREE.MeshBasicNodeMaterial;
    type N = { constructor: { type?: string }; method?: string; op?: string; isConstNode?: boolean; value?: unknown; traverse(cb: (n: N) => void): void };
    const kinds = (node: unknown) => { const out: string[] = []; (node as N).traverse((n) => out.push(`${n.constructor.type}${n.method ? `.${n.method}` : ''}${n.op ? `.${n.op}` : ''}${n.isConstNode && typeof n.value !== 'number' ? '.object' : ''}`)); return out; };
    // colour: an allow-list. No edge term (nothing derived from the shape's distance), no constant colour, no select.
    const ALLOWED = new Set(['VarNode', 'OperatorNode.*', 'OperatorNode.-', 'OperatorNode.+', 'SplitNode', 'BufferAttributeNode', 'AttributeNode',
      'MathNode.mix', 'MathNode.smoothstep', 'ConstNode']);
    const col = kinds(m.colorNode);
    expect(col.filter((k) => !ALLOWED.has(k)), 'colour graph: only the particle colour and a vertical gradient').toEqual([]);
    expect(col).toContain('BufferAttributeNode');
    // alpha and mask: no screen-space coordinate and no periodic function (a halftone needs both)
    for (const [name, node] of [['opacity', m.opacityNode], ['mask', m.maskNode]] as const) {
      const ks = kinds(node);
      expect(ks.filter((k) => /^ScreenNode|^ViewportDepthNode|MathNode\.(fract|mod)$|OperatorNode\.%$/.test(k)), `${name}: no screen-door`).toEqual([]);
    }
    solid.dispose();
  });

  it('draw order: solids draw after the water, the blob shadows and the floodlight pools they hover over, and before the glows', () => {
    const scene = new THREE.Scene();
    const water = createWaterView(createWorldData(1, 'the_lot'));
    new EntityViews(scene);
    const floods = createFloodlights({});
    const under: Array<[string, number]> = [];
    water.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) under.push([o.name, o.renderOrder]); });
    expect(under.length, 'The Lot has water').toBeGreaterThan(0);
    under.push(['blob_shadows', scene.getObjectByName('blob_shadows')!.renderOrder]);
    under.push(['fx_flood_pools', floods.group.getObjectByName('fx_flood_pools')!.renderOrder]);
    const solid = createParticleMesh(4, 'solid'), glow = createParticleMesh(4, 'glow');
    for (const [name, ro] of under) expect(solid.mesh.renderOrder, `solid particles over ${name}`).toBeGreaterThan(ro);
    expect(solid.mesh.renderOrder).toBe(PARTICLE_RENDER_ORDER.solid);
    expect(glow.mesh.renderOrder).toBeGreaterThan(solid.mesh.renderOrder);
    solid.dispose(); glow.dispose(); water.dispose();
  });

  it('drops stay crisp drops: water spray, water-impact drops, goo drips and the soil spray spawn Drop (only a Puff is drawn soft)', () => {
    expect(MESH, 'only shape 0 (Puff) takes the soft alpha').toMatch(/const isPuff = aCol\.w\.lessThan\(0\.5\);/);
    const shapesOf = (run: (p: Pools) => void) => {
      const pools = fresh(9); run(pools);
      const out = createInstanceArrays(pools.solid.capacity), n = pools.solid.write(out), s = new Set<number>();
      for (let i = 0; i < n; i++) s.add(out.col[i * 4 + 3]);
      return s;
    };
    expect([...shapesOf((p) => P.waterSpray(p, 0, 1, 0, 2, 1, -6))]).toEqual([Shape.Drop]);
    // the water impact: its splash drops are Drops (the mist over it is the one soft Puff, the crown is a Ring)
    const pools = fresh(9);
    W.impact(pools, Surface.Water, 2, 0, -9, 0, 1, 0, 0, -1, 0, 1, 0);
    const out = createInstanceArrays(pools.solid.capacity), n = pools.solid.write(out), count = new Map<number, number>();
    for (let i = 0; i < n; i++) count.set(out.col[i * 4 + 3], (count.get(out.col[i * 4 + 3]) ?? 0) + 1);
    expect(count.get(Shape.Drop) ?? 0).toBeGreaterThanOrEqual(4);
    expect(count.get(Shape.Puff) ?? 0, 'only the mist is soft').toBe(1);
    const goo = shapesOf((p) => { for (let i = 0; i < 6; i++) O.ordTrail(p, 1, 0, 1, 0, 3, 2, 0); });
    expect(goo.has(Shape.Drop) && !goo.has(Shape.Puff)).toBe(true);
    for (const surf of [Surface.Dirt, Surface.Sand]) {
      const soil = shapesOf((p) => W.impact(p, surf, 2, 0, -9, 0, 1, 0, 0, -1, 0, 1, 0));
      expect(soil.has(Shape.Drop), 'the soil spray column is a crisp clod').toBe(true);
    }
  });
});


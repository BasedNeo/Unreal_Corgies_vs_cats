// X3: weapons + combat feedback — surface classification, pooled impact marks, light pulses, the presentation table,
// view kick / FOV punch (presentation only), the hitmarker model, and zero-allocation weapon recipes.
import { describe, expect, it } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';
import { Surface, SurfaceMap, makeSurfaceHit, surfaceOfType, type SurfaceWorld } from '../../src/client/fx/surfaces';
import { DecalKind, DecalPool, createDecalArrays } from '../../src/client/fx/decal-pool';
import { PulseEnvelope, pickSlot, PulseLights } from '../../src/client/fx/light-pulses';
import { WEAPON_FX, WeaponTable, viewKickOf } from '../../src/client/fx/weapon-fx';
import { impactDelay, TRACER_SPEED } from '../../src/client/fx/delays';
import { reactionFor, makeReaction, REACT, type ReactionContext } from '../../src/client/fx/reactions';
import { FxRng, ParticlePool, createInstanceArrays, makeSpec, Fade } from '../../src/client/fx/particle-pool';
import * as W from '../../src/client/fx/presets-weapons';
import type { FxPools } from '../../src/client/fx/presets';
import { KickSpring } from '../../src/client/camera/third-person';
import { HitKind, HitMarkerModel, type HitMarkerFrame } from '../../src/client/ui/hit-feedback';
import { WEAPON_IDS, WEAPONS, weaponIndex } from '../../src/shared/content/weapons';
import type { GameEvent } from '../../src/shared/protocol';

v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc') as () => void;
const heapAfterGc = () => { gc(); gc(); return process.memoryUsage().heapUsed; };

/** A small hand-built world: flat ground with a dirt strip, a steel plate, a board fence yawed 90°, a pitched ramp,
 *  a brick wall, a barrel, a pond and a crate-stack destructible. */
function labWorld(): SurfaceWorld {
  return {
    height: (x, z) => (x > 20 ? (x - 20) * 0.5 : 0) + z * 0,
    props: [
      { type: 'car', x: 0, y: 1, z: -5, hx: 1, hy: 1, hz: 0.1, rotY: 0 },
      { type: 'fence', x: 5, y: 1, z: 0, hx: 2, hy: 1, hz: 0.05, rotY: Math.PI / 2 },
      { type: 'ramp', x: -6, y: 0.5, z: 0, hx: 1, hy: 0.1, hz: 2, rotY: 0, pitch: 0.3 },
      { type: 'bricks', x: 0, y: 1, z: 6, hx: 2, hy: 1, hz: 0.3, rotY: 0 },
      { type: 'boundary', x: 0, y: 1, z: -40, hx: 50, hy: 5, hz: 1, rotY: 0 },
    ],
    cylinders: [{ type: 'barrel', x: 10, y: 0.5, z: 10, r: 0.4, hh: 0.5 }],
    water: [{ id: 'pond', shape: 'circle', x: -10, z: -10, r: 3, surfaceY: 0.1, bottomY: -1, drag: 0.6 }],
    surface: (x) => ({ dirt: x < -15 ? 1 : 0, sand: x > 30 ? 1 : 0, mulch: 0, wild: 0 }),
    destructibles: [{ id: 'c1', tag: 'crate_stack', kind: 'crate_stack', x: 14, y: 0, z: -14, yaw: 0, hp: 60, cx: 14, cy: 0.5, cz: -14, prims: [], rubble: [],
      boxes: [{ type: 'crate', x: 14, y: 0.5, z: -14, hx: 0.5, hy: 0.5, hz: 0.5, rotY: 0 }] }],
  };
}

describe('surfaces: what a bullet hit', () => {
  it('maps prop types to materials by keyword (short words only as whole words)', () => {
    expect(surfaceOfType('fence')).toBe(Surface.Wood);
    expect(surfaceOfType('car')).toBe(Surface.Metal);
    expect(surfaceOfType('roof_ac')).toBe(Surface.Metal);
    expect(surfaceOfType('garage_door')).toBe(Surface.Metal);
    expect(surfaceOfType('garage')).toBe(Surface.Stone);
    expect(surfaceOfType('bricks')).toBe(Surface.Stone);
    expect(surfaceOfType('sandbox')).toBe(Surface.Sand);
    expect(surfaceOfType('sack')).toBe(Surface.Soft);
    expect(surfaceOfType('scarecrow')).toBe(Surface.Soft); // not 'car'
    expect(surfaceOfType('stack_of_things')).toBe(Surface.Stone); // not 'ac' in 'stack'
    // E4-style new content reads sensibly without touching the table
    expect(surfaceOfType('sandbag_wall')).toBe(Surface.Soft);
    expect(surfaceOfType('shipping_container')).toBe(Surface.Metal);
    expect(surfaceOfType('bird_feeder_watchtower')).toBe(Surface.Wood);
    expect(surfaceOfType('picket_barricade')).toBe(Surface.Wood);
    expect(surfaceOfType('mystery')).toBe(Surface.Stone);
  });

  it('classifies props (with their face normal), cylinders, water, terrain and the unknown', () => {
    const m = new SurfaceMap(labWorld()), h = makeSurfaceHit();
    // steel plate front face (z = -4.9), shot travelling −z
    m.classify(0.3, 1.2, -4.9, 0, 0, -1, h);
    expect([h.kind, h.what, h.decal]).toEqual([Surface.Metal, 2, true]);
    expect(h.nz).toBeCloseTo(1, 5);
    // fence yawed 90°: its thin axis is world x → a hit on its +x face has normal +x
    m.classify(5.05, 1, 0.5, -1, 0, 0, h);
    expect(h.kind).toBe(Surface.Wood);
    expect(h.nx).toBeCloseTo(1, 4);
    // pitched ramp: the top-face normal leans with the pitch
    const top = { x: -6, y: 0.5 + Math.cos(0.3) * 0.1, z: -Math.sin(0.3) * 0.1 };
    m.classify(top.x, top.y, top.z, 0, -1, 0, h);
    expect(h.kind).toBe(Surface.Stone); // 'ramp' is unknown content → stone
    expect(h.ny).toBeCloseTo(Math.cos(0.3), 3);
    expect(Math.abs(h.nz)).toBeCloseTo(Math.sin(0.3), 3);
    // barrel side and top
    m.classify(10.4, 0.5, 10, -1, 0, 0, h);
    expect([h.kind, h.what]).toEqual([Surface.Metal, 3]);
    expect(h.nx).toBeCloseTo(1, 4);
    m.classify(10, 1.0, 10, 0, -1, 0, h);
    expect(h.ny).toBeCloseTo(1, 4);
    // water: splash, no mark
    m.classify(-10, 0.1, -10, 0, -1, 0, h);
    expect([h.kind, h.decal, h.what]).toEqual([Surface.Water, false, 4]);
    // terrain: grass by default, dirt where the surface says so, a slope normal from the height field
    m.classify(3, 0, 3, 0, -1, 0, h);
    expect([h.kind, h.what, h.decal]).toEqual([Surface.Grass, 1, true]);
    m.classify(-20, 0, 3, 0, -1, 0, h);
    expect(h.kind).toBe(Surface.Dirt);
    m.classify(25, 2.5, 3, 0, -1, 0, h);
    expect(h.nx).toBeLessThan(-0.3); // the ground rises toward +x
    m.classify(35, 7.5, 3, 0, -1, 0, h);
    expect(h.kind).toBe(Surface.Sand);
    // a destructible: wood, but never marked (it breaks)
    m.classify(14.5, 0.5, -14, -1, 0, 0, h);
    expect([h.kind, h.what, h.decal]).toEqual([Surface.Wood, 5, false]);
    // mid-air (a drone, a kart we don't model): generic chips, no mark, facing back along the shot
    m.classify(0, 5, 0, 0, 0, -1, h);
    expect([h.kind, h.what, h.decal]).toEqual([Surface.Stone, 0, false]);
    expect(h.nz).toBeCloseTo(1, 5);
    // boundary blockers are ignored (an invisible wall is not a surface)
    m.classify(0, 1, -39, 0, 0, -1, h);
    expect(h.what).toBe(0);
  });

  it('classifies the real West Yard without allocating', async () => {
    const { createWorldData } = await import('../../src/shared/world/world-data');
    const w = createWorldData(1);
    const m = new SurfaceMap(w), h = makeSurfaceHit();
    const fence = w.props.find((p) => p.type === 'fence' && !p.pitch && !p.roll)!;
    m.classify(fence.x, fence.y + fence.hy, fence.z, 0, -1, 0, h); // a hit on its top face (hitscan points lie on surfaces)
    expect(h.kind).toBe(Surface.Wood);
    const rng = new FxRng(5);
    for (let i = 0; i < 20_000; i++) m.classify(rng.sym(90), rng.range(0, 6), rng.sym(90), 0, -1, 0, h); // warm-up
    const before = heapAfterGc();
    for (let i = 0; i < 200_000; i++) m.classify(rng.sym(90), rng.range(0, 6), rng.sym(90), 0, -1, 0, h);
    expect(heapAfterGc() - before).toBeLessThan(64 * 1024);
  });
});

describe('impact marks (decal pool)', () => {
  it('caps per tier, recycles the oldest, fades the oldest of a full ring and at end of life', () => {
    const pool = new DecalPool(64, 4);
    const out = createDecalArrays(64);
    for (let i = 0; i < 4; i++) pool.spawn(i, 0, 0, 0, 1, 0, 0.1, DecalKind.Hole, Surface.Metal, 0, 0.5);
    pool.update(0.1); // past the 50 ms fade-in
    expect(pool.write(out)).toBe(4);
    // full ring: the oldest (x = 0) is the most faded, the newest is opaque
    expect(out.pos[0]).toBe(0);
    expect(out.misc[0]).toBeLessThan(out.misc[12]);
    pool.update(0.1);
    pool.spawn(9, 0, 0, 0, 1, 0, 0.1, DecalKind.Hole, Surface.Wood, 0, 0.5); // recycles x = 0
    expect(pool.stats.recycled).toBe(1);
    pool.write(out);
    const xs = [out.pos[0], out.pos[4], out.pos[8], out.pos[12]];
    expect(xs).toEqual([1, 2, 3, 9]); // oldest first; the recycled slot now holds the newest
    // end of life
    pool.update(100);
    expect(pool.write(out)).toBe(0);
    // tier change drops everything; cap 0 = no marks (low tier could use it)
    pool.setCap(16);
    expect(pool.count).toBe(0);
    const none = new DecalPool(8, 0);
    expect(none.spawn(0, 0, 0, 0, 1, 0, 0.1, 0, 0, 0, 0)).toBe(-1);
  });

  it('lays each mark in the surface plane, lifted off it, with a unit rotated basis', () => {
    const pool = new DecalPool(4);
    const out = createDecalArrays(4);
    const n = [0.6, 0, 0.8];
    pool.spawn(1, 2, 3, n[0], n[1], n[2], 0.2, DecalKind.Scorch, Surface.Stone, 1.1, 0.3);
    pool.write(out);
    const t = [out.tan[0], out.tan[1], out.tan[2]], b = [out.bit[0], out.bit[1], out.bit[2]];
    const dot = (a: number[], c: number[]) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    expect(dot(t, n)).toBeCloseTo(0, 5);
    expect(dot(b, n)).toBeCloseTo(0, 5);
    expect(dot(t, b)).toBeCloseTo(0, 5);
    expect(dot(t, t)).toBeCloseTo(1, 5);
    expect(out.tan[3]).toBe(DecalKind.Scorch);
    expect(out.bit[3]).toBe(Surface.Stone);
    expect(out.pos[0] - 1).toBeGreaterThan(0); // lifted along n
  });

  it('spawns, ages and writes without allocating', () => {
    const pool = new DecalPool(64);
    const out = createDecalArrays(64);
    const rng = new FxRng(2);
    const frame = () => { for (let i = 0; i < 4; i++) pool.spawn(rng.sym(9), 0, rng.sym(9), 0, 1, 0, 0.1, i & 1, i & 7, rng.next() * 6, rng.next()); pool.update(1 / 60); pool.write(out); };
    for (let i = 0; i < 2000; i++) frame();
    const before = heapAfterGc();
    for (let i = 0; i < 30_000; i++) frame();
    expect(heapAfterGc() - before).toBeLessThan(64 * 1024);
  });
});

describe('light pulses', () => {
  it('attack then fall to zero by the end; the dimmest (weighted) light is stolen', () => {
    const e = new PulseEnvelope();
    e.peak = 4; e.dur = 0.1; e.t = 0;
    expect(e.value).toBeGreaterThan(0);
    e.step(0.012);
    expect(e.value).toBeCloseTo(4, 1);
    e.step(0.05);
    const mid = e.value;
    expect(mid).toBeLessThan(4);
    e.step(0.1);
    expect(e.value).toBe(0);
    const a = new PulseEnvelope(), b = new PulseEnvelope();
    a.peak = 3; a.dur = 1; a.t = 0.2; a.weight = 1.5;   // the local player's pulse
    b.peak = 3; b.dur = 1; b.t = 0.2;
    expect(pickSlot([a, b], 2)).toBe(1);
    expect(pickSlot([a, new PulseEnvelope()], 2)).toBe(1); // idle first
  });

  it('keeps a fixed light count per tier (idle lights stay in the scene at intensity 0)', () => {
    const L = new PulseLights(2, 2);
    expect(L.group.children.length).toBe(2);
    L.pulse(0, 1, 0, 0xffffff, 3, 4, 0.1);
    expect(L.update(0.01)).toBe(1);
    expect(L.update(0.5)).toBe(0);
    expect(L.group.children.length).toBe(2);
    L.setCount(0); // low tier
    expect(L.group.children.length).toBe(0);
    L.pulse(0, 1, 0, 0xffffff, 3, 4, 0.1); // no-op
    expect(L.update(0.01)).toBe(0);
    L.dispose();
  });
});

describe('presentation table + reactions (visual only)', () => {
  it('covers every weapon in the authoritative table order, heavier classes hit harder', () => {
    const t = new WeaponTable();
    WEAPON_IDS.forEach((id, i) => { expect(t.id(i)).toBe(id); expect(WEAPON_FX[id]).toBeDefined(); });
    expect(t.id(weaponIndex('claw_swipe'))).toBe('claw_swipe');
    expect(t.id(99)).toBe('unknown');
    const F = WEAPON_FX;
    expect(F.snap_pistol.flashSize).toBeLessThan(F.squeaker_rifle.flashSize);
    expect(F.squeaker_rifle.flashSize).toBeLessThan(F.laser_longshot.flashSize);
    expect(F.laser_longshot.flashSize).toBeLessThan(F.tennis_mortar.flashSize);
    expect(F.squeaker_rifle.kick).toBeLessThan(F.laser_longshot.kick);
    expect(F.laser_longshot.kick).toBeLessThan(F.tennis_mortar.kick);
    expect(F.squeaker_rifle.tracer).toBe('bullet');
    expect(F.snap_pistol.tracer).toBe('bullet');
    expect(F.claw_swipe.flashSize).toBe(0);
  });

  it('view kick comes from the weapon RecoilDef, for the local shooter only; kills and crits punch the FOV', () => {
    const ctx: ReactionContext = { localId: 1, lx: 0, ly: 0, lz: 0, hasLocal: true, weaponOf: (w) => new WeaponTable().id(w) };
    const fire = (id: number, wpn: string): GameEvent => ({ e: 'fire', id, wpn: weaponIndex(wpn), x: 0, y: 1, z: 0, dx: 0, dy: 0, dz: -1, hx: 0, hy: 1, hz: -10, hit: -1 });
    const r = reactionFor(fire(1, 'laser_longshot'), ctx, makeReaction());
    const k = viewKickOf('laser_longshot', { pitch: 0, yaw: 0, recover: 0 });
    expect(r.kickPitch).toBeCloseTo(WEAPONS.laser_longshot.recoil.pitch * WEAPON_FX.laser_longshot.viewKick, 6);
    expect(r.kickPitch).toBe(k.pitch);
    expect(Math.abs(r.kickYaw)).toBeGreaterThan(0);
    expect(r.kickRecover).toBeGreaterThan(0.05);
    const other = reactionFor(fire(2, 'laser_longshot'), ctx, makeReaction());
    expect([other.kickPitch, other.shake]).toEqual([0, 0]);
    expect(reactionFor(fire(1, 'squeaker_rifle'), ctx, makeReaction()).kickPitch).toBeLessThan(r.kickPitch);
    expect(reactionFor({ e: 'death', id: 5, by: 1 }, ctx, makeReaction()).fovPunch).toBe(REACT.killPunch);
    expect(reactionFor({ e: 'hit', src: 1, dst: 5, dmg: 30, x: 0, y: 0, z: 0, crit: true }, ctx, makeReaction()).fovPunch).toBe(REACT.critPunch);
    expect(reactionFor({ e: 'death', id: 5, by: 7 }, ctx, makeReaction()).fovPunch).toBe(0);
  });

  it('camera kick spring: rises to ~the impulse, settles by `recover`, is capped for long bursts', () => {
    const s = new KickSpring();
    s.impulse(0.02, 0.12);
    let peak = 0;
    for (let t = 0; t < 0.3; t += 1 / 60) peak = Math.max(peak, s.step(1 / 60, 1));
    expect(peak).toBeGreaterThan(0.015);
    expect(peak).toBeLessThan(0.022);
    expect(Math.abs(s.x)).toBeLessThan(1e-4);
    // a 10 rps burst for 3 s never walks the view past the cap
    const b = new KickSpring();
    let max = 0;
    for (let i = 0; i < 180; i++) { if (i % 6 === 0) b.impulse(0.006, 0.12); max = Math.max(max, b.step(1 / 60, 0.05)); }
    expect(max).toBeLessThanOrEqual(0.05);
    // big frame times stay stable (sub-stepped)
    const c = new KickSpring();
    c.impulse(0.03, 0.2);
    for (let i = 0; i < 10; i++) expect(Number.isFinite(c.step(0.25, 1))).toBe(true);
  });

  it('impacts land when the tracer arrives (laser: instantly; spray: along its arc)', () => {
    expect(impactDelay('bullet', 19)).toBeCloseTo(19 / TRACER_SPEED, 6);
    expect(impactDelay('bullet', 500)).toBe(0.3);
    expect(impactDelay('laser', 80)).toBe(0);
    expect(impactDelay('water', 11)).toBeCloseTo(0.5, 6);
  });
});

describe('hitmarker model', () => {
  const f = (): HitMarkerFrame => ({ visible: false, kind: HitKind.None, opacity: 0, scale: 1, rot: 0, boost: 0, ring: -1 });
  const hit = (src: number, crit = false): GameEvent => ({ e: 'hit', src, dst: 9, dmg: 15, x: 0, y: 0, z: 0, crit });
  it('pops on your hits (white), crits (gold), kills (red + ring), fades out; others’ hits do nothing', () => {
    const m = new HitMarkerModel(), out = f();
    m.onEvent(hit(2), 1, 0);
    expect(m.sample(0.01, out).visible).toBe(false);
    m.onEvent(hit(1), 1, 0);
    m.sample(0.0, out);
    expect([out.visible, out.kind]).toEqual([true, HitKind.Hit]);
    expect(out.scale).toBeGreaterThan(1.2);
    m.sample(0.1, out);
    expect(out.scale).toBeCloseTo(1, 1);
    expect(m.sample(0.5, out).visible).toBe(false);
    m.onEvent(hit(1, true), 1, 1);
    expect(m.sample(1.01, out).kind).toBe(HitKind.Crit);
    m.onEvent(hit(1), 1, 1.02); // a plain hit on the same beat never downgrades the crit
    expect(m.sample(1.03, out).kind).toBe(HitKind.Crit);
    m.onEvent({ e: 'death', id: 9, by: 1 }, 1, 2);
    m.sample(2.06, out);
    expect(out.kind).toBe(HitKind.Kill);
    expect(out.ring).toBeGreaterThan(0);
    expect(out.rot).toBeGreaterThan(0);
    m.onEvent(hit(1), 1, 2.12); // a trailing hit right after the kill keeps the kill marker up
    expect(m.sample(2.13, out).kind).toBe(HitKind.Kill);
  });
  it('stacks rapid hits into a boost (a landed burst reads bigger than a tap)', () => {
    const m = new HitMarkerModel(), out = f();
    for (let i = 0; i < 6; i++) m.onEvent(hit(1), 1, i * 0.1);
    expect(m.sample(0.52, out).boost).toBeGreaterThan(0.8);
    const tap = new HitMarkerModel();
    tap.onEvent(hit(1), 1, 0);
    expect(tap.sample(0.02, out).boost).toBe(0);
  });
});

describe('weapon recipes', () => {
  it('spawn muzzle flashes, tracers, brass, every surface impact, splats and explosions without allocating', () => {
    const pools: FxPools = { solid: new ParticlePool(1600), glow: new ParticlePool(900), rng: new FxRng(3), density: 1 };
    const out = createInstanceArrays(1600);
    const kinds = [Surface.Dirt, Surface.Grass, Surface.Sand, Surface.Stone, Surface.Metal, Surface.Wood, Surface.Water, Surface.Soft];
    const burst = () => {
      for (const id of ['squeaker_rifle', 'snap_pistol', 'laser_longshot', 'tennis_mortar', 'sprinkler_cannon'] as const) W.muzzle(pools, WEAPON_FX[id], 0, 1, 0, 0, 0, -1, 1, 0, 0);
      W.tracer(pools, 0, 1, 0, 3, 1, -20, 0xffb84a, 3, 0.034);
      W.casing(pools, 'rifle', 0.1, 1, 0.4, 1, 0, 0, 0, 0, 1, 0);
      W.casing(pools, 'shell', 0.1, 1, 0.4, 1, 0, 0, 0, 0, 1, 0);
      for (const k of kinds) W.impact(pools, k, 2, 1, -9, 0, 0, 1, 0, 0, -1, 1, 0);
      W.comicSplat(pools, 0, 1, -5, 0, 0, 1, true);
      W.groundGlow(pools, 0, 0, 0, 0xff9b3d, 0.7, 0.4);
      W.clawSlash(pools, 0, 1, -1, 1, 0);
      W.explosionExtras(pools, 4, 0, -10, 4.2, 0);
      pools.solid.update(1 / 60); pools.glow.update(1 / 60);
      pools.solid.write(out);
    };
    for (let i = 0; i < 2500; i++) burst();
    const before = heapAfterGc();
    for (let i = 0; i < 4000; i++) burst();
    const grown = heapAfterGc() - before;
    expect(pools.solid.count).toBeLessThanOrEqual(1600);
    expect(grown).toBeLessThan(128 * 1024);
  });

  it('smoke thins out as halftone (opacity in axis.w), flashes show at full strength on their first frame', () => {
    const pool = new ParticlePool(8);
    pool.freshFirstFrame = true;
    const out = createInstanceArrays(8);
    const s = makeSpec();
    s.fade = Fade.Soft; s.alpha = 0.6; s.life = 1;
    pool.spawn(s);
    pool.update(0.2); // fresh: skipped
    pool.write(out);
    expect(out.misc[3]).toBe(0); // t = 0 on the first rendered frame
    expect(out.axis[3]).toBeCloseTo(0.6, 5);
    pool.update(0.5);
    pool.write(out);
    expect(out.axis[3]).toBeLessThan(0.3);
  });
});

// W9 L3 (M3) on The Lot: the atmosphere as data and its readers.
//   - weather bias (weather.ts WeatherKey + WorldData weatherBias, lot/layout.ts LOT_WEATHER): a dry overcast first
//     minute, then rain, a storm in the first cycle, wet ~3/4 of the time, deterministic per seed, blends as smooth as the default schedule; the
//     West Yard's schedule is bit-for-bit the one before W9 (a golden digest taken on HEAD 38db372); the authority (world
//     effects, AI sight) and client prediction read the world's schedule.
//   - the S4 floodlight rig's source (battle-dressing floodlightSpecs): WorldData.floodlights on The Lot, the E4 layout's
//     floods on the West Yard exactly as before; pools lie on the ground they light.
//   - the ditch's muddy water (water-view tint), the crane's lamps as glow draws.
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import * as THREE from 'three/webgpu';
import { createWorldData, type WorldData } from '../../src/shared/world/world-data';
import {
  findWeather, forEachStrike, strikeInSecond, weatherAt, weatherCycle, weatherParamsAt, WEATHER_CYCLE_S, WEATHER_PARAMS, type WeatherBias,
} from '../../src/shared/world/weather';
import { LOT_WEATHER } from '../../src/shared/world/lot/layout';
import { battleOf } from '../../src/shared/world/fortifications';
import { Sim } from '../../src/sim/sim';
import { simWeather } from '../../src/sim/world/env';
import { movementSystem } from '../../src/sim/systems/movement';
import { physicsStepSystem, killPlaneSystem } from '../../src/sim/systems/core';
import { stepWorldEffects, worldSystems } from '../../src/sim/world/systems';
import { Species, Team } from '../../src/shared/types';
import { TICK_HZ } from '../../src/shared/constants';
import { createBattleDressing, floodlightSpecs, FLOOD_REF_THROW, FLOOD_TOWER_GAIN } from '../../src/client/world/battle-dressing';
import { createWaterView } from '../../src/client/world/water-view';
import { createLampsView } from '../../src/client/world/lamps-view';
import { createWorldView } from '../../src/client/world/world-view';
import { STYLE } from '../../src/client/style/style-tokens.js';

const CYCLE = WEATHER_CYCLE_S * TICK_HZ;
let lot: WorldData & { weatherBias?: WeatherBias };
let yard: WorldData;
beforeAll(() => { lot = createWorldData(1, 'the_lot'); yard = createWorldData(1); });

describe('The Lot: rain by default (per-map weather bias)', () => {
  it('the West Yard schedule is unchanged: golden digest of cycles, samples and strikes (HEAD 38db372)', () => {
    const h = createHash('sha256');
    for (const seed of [1, 2, 3, 7, 1234]) for (let k = 0; k < 6; k++) h.update(JSON.stringify(weatherCycle(seed, k)));
    for (const seed of [1, 5]) for (let t = 0; t < 60 * 60 * 40; t += 997) { const w = weatherAt(seed, t); h.update(JSON.stringify([w.kind, w.cloud, w.rain, w.wet, w.storm, w.flash, w.strike?.id ?? -1])); }
    for (let j = 0; j < 3000; j += 7) h.update(JSON.stringify(strikeInSecond(3, j)));
    h.update(String(findWeather(1, 'storm')) + ',' + findWeather(2, 'rain'));
    expect(h.digest('hex')).toBe('fa973b9ff450336eb1f0da92ea9266eb6dce68eb76d9cdad901711b22889ccf3');
    // the world as the key (no bias) = the bare seed, sample for sample
    for (let t = 0; t < 3 * CYCLE; t += 1777) expect(weatherAt(yard, t)).toEqual(weatherAt(yard.seed, t));
  });

  it('The Lot opens overcast, rains within two minutes, storms in its first cycle, and is wet about three quarters of the time', () => {
    expect(lot.weatherBias).toBe(LOT_WEATHER);
    const w0 = weatherAt(lot, 0);
    expect(w0.kind).toBe('overcast');                                                     // a dry first minute (soaks)
    expect(w0.wet).toBe(0);
    expect(w0.blend).toBe(0);
    expect(weatherAt(lot, 60 * TICK_HZ).wet).toBe(0);
    expect(weatherAt(lot, 2 * 60 * TICK_HZ).kind).toBe('rain');
    for (const seed of [1, 2, 3, 4, 5]) {
      const c0 = weatherCycle(seed, 0, LOT_WEATHER);
      expect(c0[0].kind).toBe('overcast');
      expect(c0[1].kind).toBe('rain');
      expect(c0[1].start).toBeGreaterThanOrEqual(1.3 * 60 * TICK_HZ);
      expect(c0[1].start).toBeLessThanOrEqual(1.8 * 60 * TICK_HZ);
      expect(c0.some((s) => s.kind === 'storm')).toBe(true);
    }
    let wet = 0, wetY = 0, n = 0, storm = 0;
    for (let t = 0; t < 8 * CYCLE; t += 97) {
      n++;
      if (weatherParamsAt(lot, t).wet > 0.5) wet++;
      if (weatherParamsAt(yard, t).wet > 0.5) wetY++;
      if (weatherAt(lot, t).kind === 'storm') storm++;
    }
    console.log(`[l3-weather] wet share: The Lot ${(wet / n).toFixed(2)} · West Yard ${(wetY / n).toFixed(2)} · Lot storm ${(storm / n).toFixed(2)}`);
    expect(wet / n).toBeGreaterThan(0.65);
    expect(wetY / n).toBeLessThan(0.45);
    expect(storm / n).toBeGreaterThan(0.1);
    let strikes = 0;
    forEachStrike(lot, 0, CYCLE, () => strikes++);
    expect(strikes).toBeGreaterThan(3);
  });

  it('is deterministic per seed, tiles every cycle, and blends as smoothly as the default schedule', () => {
    for (const seed of [1, 2, 9]) {
      const a = createWorldData(seed, 'the_lot'), b = createWorldData(seed, 'the_lot');
      for (let t = 0; t < 2 * CYCLE; t += 3001) expect(weatherAt(a, t)).toEqual(weatherAt(b, t));
      for (let k = 0; k < 6; k++) {
        const segs = weatherCycle(seed, k, LOT_WEATHER);
        expect(segs[0].start).toBe(k * CYCLE);
        expect(segs[segs.length - 1].end).toBe((k + 1) * CYCLE);
        expect(segs[0].kind).toBe(k === 0 ? 'overcast' : 'rain');
        expect(segs[segs.length - 1].kind).toBe('overcast');
        for (let i = 0; i < segs.length; i++) {
          expect(segs[i].end - segs[i].start, `seed ${seed} k ${k} ${segs[i].kind}`).toBeGreaterThanOrEqual(40 * TICK_HZ);
          if (i) { expect(segs[i].start).toBe(segs[i - 1].end); expect(segs[i].kind).not.toBe(segs[i - 1].kind); }
        }
      }
    }
    // no parameter moves faster than 1.5 x its step over the 20 s blend (the default schedule's bound): every tick around
    // every segment boundary (blends are +-10 s), cycle ends included
    const keys = ['cloud', 'rain', 'storm', 'wind', 'wet', 'fog', 'dark', 'sight'] as const;
    const a = { ...WEATHER_PARAMS.clear }, b = { ...WEATHER_PARAMS.clear };
    let worst = 0;
    for (let k = 0; k < 3; k++) for (const sgm of weatherCycle(lot.seed, k, LOT_WEATHER)) {
      for (let t = Math.max(1, sgm.start - 12 * TICK_HZ); t <= sgm.start + 12 * TICK_HZ; t++) {
        weatherParamsAt(lot, t - 1, a); weatherParamsAt(lot, t, b);
        for (const key of keys) worst = Math.max(worst, Math.abs(b[key] - a[key]));
      }
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(1.5 / (20 * TICK_HZ) + 1e-9);
  }, 120_000);

  it('the authority and prediction read the world schedule: wet, slippery mud and shorter AI sight once it rains', async () => {
    const rainTick = findWeather(lot, 'rain');
    for (const [map, wet] of [['the_lot', true], ['west_yard', false]] as const) {
      const sim = await Sim.create({ seed: 1, map, systems: [movementSystem, ...worldSystems(), physicsStepSystem, killPlaneSystem] });
      sim.tick = rainTick;                                                                  // the West Yard is clear then
      sim.step();
      expect(simWeather(sim).wet, map).toBe(wet ? 1 : 0);
      expect(simWeather(sim).sight, map).toBe(wet ? WEATHER_PARAMS.rain.sight : 1);
      const s = sim.pickSpawn(Team.Corgis);
      const e = sim.spawnCharacter({ team: Team.Corgis, species: Species.Corgi, cls: 'assault', name: 'wet', x: s.x, y: s.y, z: s.z, yaw: 0 });
      for (let i = 0; i < 20; i++) sim.step();
      // world effects put a grounded pet on wet terrain on slippery move stats; the client's prediction runs the same
      // function on its own copy of the world (same data, same schedule), without the authority's clock
      expect(e.char!.grounded).toBe(true);
      const auth = stepWorldEffects(sim.worldData, e, 1 / TICK_HZ, undefined, sim.tick).slip;
      const pred = stepWorldEffects(createWorldData(1, map), e, 1 / TICK_HZ).slip;
      expect(auth > 0, map).toBe(wet);
      expect(pred).toBe(auth);
      sim.dispose();
    }
  }, 60_000);
});

describe('The Lot: floodlights, water and lamps in the view', () => {
  it('the West Yard keeps its E4 floodlights exactly (same list, same pools, style defaults)', () => {
    const layout = battleOf(yard)!;
    expect(yard.floodlights).toBeUndefined();
    const specs = floodlightSpecs(yard);
    expect(specs).toEqual(layout.floods.map((f) => ({ pos: f.pos, target: [f.target[0], yard.height(f.target[0], f.target[2]), f.target[2]], poolRadius: f.poolRadius })));
    for (const s of specs) { expect(s.intensity).toBeUndefined(); expect(s.range).toBeUndefined(); }
  });

  it('The Lot: one floodlight per tower from WorldData.floodlights; far-throw towers scaled, pools lying on their ground', () => {
    const specs = floodlightSpecs(lot);
    expect(specs.length).toBe(4);
    const T = STYLE.floodlight as { intensity: number; range: number; poolRadius: number };
    for (const [i, s] of specs.entries()) {
      const f = lot.floodlights![i];
      expect(s.pos).toEqual(f.pos);
      expect(s.target).toEqual(f.target);
      const k = Math.hypot(f.pos[0] - f.target[0], f.pos[1] - f.target[1], f.pos[2] - f.target[2]) / FLOOD_REF_THROW;
      expect(k).toBeGreaterThan(2);
      expect(s.intensity).toBe(Math.round(T.intensity * k * k * FLOOD_TOWER_GAIN));
      expect(s.range).toBeCloseTo(T.range * k, 6);
      expect(s.range!).toBeGreaterThan(Math.hypot(f.pos[0] - f.target[0], f.pos[1] - f.target[1], f.pos[2] - f.target[2]) * 1.5);
      expect(s.poolRadius!).toBeGreaterThanOrEqual(T.poolRadius);
      expect(s.poolRadius!).toBeLessThanOrEqual(22);
      // the pool disc never floats more than 0.6 m over the ground within 75 % of its radius
      for (let a = 0; a < 32; a++) for (const fr of [0.3, 0.5, 0.75]) {
        const x = s.target[0] + Math.cos(a / 5.09) * s.poolRadius! * fr, z = s.target[2] + Math.sin(a / 5.09) * s.poolRadius! * fr;
        expect(lot.height(x, z), `pool ${i} at ${x.toFixed(1)},${z.toFixed(1)}`).toBeGreaterThan(s.target[1] - 0.6 - 1e-6);
      }
    }
    // the pit's pools cover the pit floor's middle; the heap's stop short of its north face (they shrank)
    expect(specs[0].poolRadius).toBeGreaterThan(15);
    expect(Math.min(specs[2].poolRadius!, specs[3].poolRadius!)).toBeLessThan(Math.max(specs[0].poolRadius!, specs[1].poolRadius!));
    const d = createBattleDressing(lot, { quality: 'high' });
    const st = d.stats();
    expect(st.floods).toBe(4);
    expect(st.banners + st.nets + st.casings + st.paws).toBe(0);                           // no battle layout on The Lot
    expect(st.dressingDraws).toBe(3);                                                       // heads, halos, pools
    d.dispose();
  });

  it('the ditch zones render as muddy water; the West Yard pond and pool keep their colours', () => {
    const w = createWaterView(lot);
    const mats = w.group.children.map((m) => (m as THREE.Mesh).material as THREE.Material);
    expect(mats.length).toBe(4);
    for (const m of mats) expect(m.userData.waterTint).toBe('mud');
    w.dispose();
    const y = createWaterView(yard);
    for (const m of y.group.children) expect(((m as THREE.Mesh).material as THREE.Material).userData.waterTint).toBeUndefined();
    y.dispose();
  });

  it('style audit: every material of The Lot\'s world view comes from the style system (the West Yard\'s kinds, no new ones)', () => {
    const kinds = (map: string) => {
      const scene = new THREE.Scene();
      const v = createWorldView(scene, createWorldData(1, map), { quality: 'high' });
      const out = new Map<string, number>();
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        for (const x of Array.isArray(m) ? m : [m]) {
          const k = x.userData.style ?? (x.type === 'Line2NodeMaterial' && /crease/.test(o.name) ? 'crease-ink' : `NOT STYLED: ${x.type} ${o.name}`);
          out.set(k, (out.get(k) ?? 0) + 1);
        }
      });
      v.dispose();
      return out;
    };
    const lot = kinds('the_lot'), yard = kinds('west_yard');
    console.log(`[l3-style] The Lot ${JSON.stringify([...lot])} · West Yard ${JSON.stringify([...yard])}`);
    for (const k of lot.keys()) expect([...yard.keys()], k).toContain(k);
    expect(lot.get('glow')).toBeGreaterThanOrEqual(5);                                      // 3 lamp colours + flood heads + halos
  }, 60_000);

  it('crane lamps are glow tubes: one more instanced draw (red); the cab glass joins the tube draw', () => {
    const v = createLampsView(lot, { quality: 'high' });
    const st = v.stats();
    expect(st.lampDraws).toBe(3);                                                           // sodium, lampTube, laserRed
    const names = v.group.children.map((c) => c.name);
    expect(names).toContain('lamps_laserRed');
    for (const c of v.group.children) if (c.name.startsWith('lamps_')) expect(((c as THREE.Mesh).material as THREE.Material).userData.style).toBe('glow');
    v.dispose();
  });
});

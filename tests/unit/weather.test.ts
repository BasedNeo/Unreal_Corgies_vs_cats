// G1 weather proofs (pure functions of seed + tick): cross-machine determinism (golden hash over
// + - * / floor sqrt math), state machine order and dwell times, blended transitions (no jumps),
// lightning schedule + thunder delay, time of day, sprinkler bursts, deterministic trig.
import { describe, it, expect } from 'vitest';
import {
  weatherAt, weatherParamsAt, weatherCycle, findWeather, strikeInSecond, forEachStrike, lastStrike, flashEnvelope,
  timeOfDayAt, sprinklerAt, inSprinklerJet, inSprinklerSweep, dsin, dcos, WEATHER_PARAMS, WEATHER_CYCLE_S, type WeatherParams,
} from '../../src/shared/world/weather';
import { createWorldData } from '../../src/shared/world/world-data';

const TICK = 60;
const KEYS = ['cloud', 'rain', 'storm', 'wind', 'wet', 'fog', 'dark', 'sight'] as const;
const fnv = (s: string) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); };

describe('weather: determinism', () => {
  it('same seed + tick -> identical state, and a golden hash pins the math across machines', () => {
    const a = weatherAt(3, 123456.5), b = weatherAt(3, 123456.5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Golden: every gameplay-relevant value (params, cycle schedule, strikes, time of day, sprinkler jets,
    // dsin) is built from integer hashing and + - * / floor sqrt, which IEEE-754 makes bit-identical on
    // every machine/engine. If this hash changes, clients and the authority could disagree.
    const parts: string[] = [];
    for (const seed of [1, 7, 42]) {
      for (let t = 0; t < 3 * 46800; t += 997) parts.push(JSON.stringify(weatherParamsAt(seed, t)));
      for (let k = 0; k < 4; k++) parts.push(JSON.stringify(weatherCycle(seed, k)));
      for (let j = 0; j < 3000; j += 7) { const s = strikeInSecond(seed, j); if (s) parts.push(JSON.stringify(s)); }
      for (let t = 0; t < 200000; t += 4999) parts.push(String(timeOfDayAt(seed, t)));
    }
    const d = createWorldData(1);
    for (const sp of d.sprinklers!) for (let t = 4000; t < 40000; t += 37) { const s = sprinklerAt(1, sp, t); parts.push(`${s.on},${s.dirX},${s.dirZ}`); }
    for (let a2 = -20; a2 < 20; a2 += 0.37) parts.push(String(dsin(a2)));
    expect(parts.length).toBe(2620);
    expect(fnv(parts.join('|'))).toBe('4e887dda');
  });

  it('different seeds give different skies', () => {
    const k = (seed: number) => weatherCycle(seed, 1).map((s) => `${s.kind}:${s.end}`).join();
    expect(k(1)).not.toBe(k(2));
  });
});

describe('weather: state machine', () => {
  it('every seed starts with >= 3 minutes of clear sky (tests and short matches see the L2 world unchanged)', () => {
    for (const seed of [1, 2, 3, 5, 8, 13]) {
      for (let t = 0; t <= 3 * 60 * TICK; t += 30) {
        const w = weatherParamsAt(seed, t);
        expect(w.wet, `seed ${seed} t ${t}`).toBe(0);
        expect(w.sight).toBe(1);
        expect(w.rain).toBe(0);
      }
    }
  });

  it('cycles clear -> overcast -> rain -> [storm] -> clearing -> clear with minute-long dwells; all states occur', () => {
    const seen = new Set<string>();
    let storms = 0;
    for (const seed of [1, 4, 9]) for (let k = 0; k < 6; k++) {
      const segs = weatherCycle(seed, k);
      const kinds = segs.map((s) => s.kind);
      const order = kinds.join('>');
      expect(['clear>overcast>rain>storm>clearing>clear', 'clear>overcast>rain>clearing>clear']).toContain(order);
      if (kinds.includes('storm')) storms++;
      for (const s of segs) {
        seen.add(s.kind);
        expect(s.end - s.start, `${seed}/${k} ${s.kind}`).toBeGreaterThanOrEqual(60 * TICK);
      }
      expect(segs[0].start).toBe(k * WEATHER_CYCLE_S * TICK);
      expect(segs[segs.length - 1].end).toBe((k + 1) * WEATHER_CYCLE_S * TICK);
    }
    expect([...seen].sort()).toEqual(['clear', 'clearing', 'overcast', 'rain', 'storm']);
    expect(storms).toBeGreaterThanOrEqual(8);   // ~65 % + cycle 0 always
    // the first cycle always has a storm (the slice shows weather within a session)
    expect(weatherCycle(1, 0).some((s) => s.kind === 'storm')).toBe(true);
  });

  it('transitions blend over ~20 s: no parameter moves more than 0.08 per second (checked every tick over 3 cycles)', () => {
    const seed = 11, prev: WeatherParams = weatherParamsAt(seed, 0), cur: WeatherParams = { ...prev };
    const worst: Record<string, number> = {};
    let transitions = 0, prevKind = 'clear';
    for (let t = 1; t < 3 * WEATHER_CYCLE_S * TICK; t++) {
      weatherParamsAt(seed, t, cur);
      for (const k of KEYS) {
        const d = Math.abs(cur[k] - prev[k]) * TICK;          // per second
        worst[k] = Math.max(worst[k] ?? 0, d);
      }
      Object.assign(prev, cur);
      if (t % 60 === 0) { const kind = weatherAt(seed, t).kind; if (kind !== prevKind) transitions++; prevKind = kind; }
    }
    for (const k of KEYS) expect(worst[k], k).toBeLessThanOrEqual(0.08);
    expect(worst.wet).toBeGreaterThan(0.05);    // it does change (1 over ~20 s: 1.5/20 = 0.075/s peak)
    expect(transitions).toBeGreaterThanOrEqual(12);
  });

  it('samples mid-state match the table and report the transition while blending', () => {
    const t = findWeather(1, 'storm');
    const w = weatherAt(1, t);
    expect(w.kind).toBe('storm');
    for (const k of KEYS) expect(w[k]).toBeCloseTo(WEATHER_PARAMS.storm[k], 9);
    expect(w.sight).toBe(0.6);
    const seg = weatherCycle(1, 0).find((s) => s.kind === 'rain')!;
    const mid = weatherAt(1, seg.start);                    // exactly on the boundary: halfway
    expect(mid.from).toBe('overcast');
    expect(mid.to).toBe('rain');
    expect(mid.blend).toBeCloseTo(0.5, 6);
    expect(mid.wet).toBeCloseTo(0.5, 6);
  });
});

describe('weather: lightning', () => {
  it('strikes only in storms, ~every 6 s at full strength, with a comic double-flicker flash and sound-delayed thunder', () => {
    const seed = 1;
    const storm = weatherCycle(seed, 0).find((s) => s.kind === 'storm')!;
    let n = 0;
    forEachStrike(seed, storm.start + 600, storm.end - 600, (s) => {
      n++;
      expect(s.tick).toBeGreaterThanOrEqual(storm.start);
      expect(s.thunderDelay).toBeGreaterThan(0.4);
      expect(s.thunderDelay).toBeLessThan(3.9);
      expect(s.power).toBeGreaterThan(0.3);
      expect(s.power).toBeLessThanOrEqual(1);
    });
    const secs = (storm.end - storm.start - 1200) / TICK;
    expect(n / secs).toBeGreaterThan(0.08);
    expect(n / secs).toBeLessThan(0.26);
    // none in clear weather
    let clear = 0;
    forEachStrike(seed, 0, 3 * 60 * TICK, () => clear++);
    expect(clear).toBe(0);
    // flash envelope: bright, dip, second flicker, decay to nothing
    expect(flashEnvelope(0.02)).toBe(1);
    expect(flashEnvelope(0.07)).toBeLessThan(0.5);
    expect(flashEnvelope(0.13)).toBeGreaterThan(0.7);
    expect(flashEnvelope(1.2)).toBeLessThan(0.001);
    // weatherAt carries the flash of the most recent strike
    let first = -1;
    forEachStrike(seed, storm.start, storm.end, (s) => { if (first < 0) first = s.tick; });
    const w = weatherAt(seed, first + 1);
    expect(w.flash).toBeGreaterThan(0.2);
    expect(w.strike?.tick).toBe(first);
    expect(lastStrike(seed, first + 1)?.tick).toBe(first);
  });
});

describe('time of day', () => {
  it('starts late morning, moves smoothly, and spends ~72 % of the 24-minute cycle in daylight', () => {
    for (const seed of [1, 2, 3]) {
      const t0 = timeOfDayAt(seed, 0);
      expect(t0).toBeGreaterThanOrEqual(0.4);
      expect(t0).toBeLessThanOrEqual(0.46);
    }
    let day = 0, n = 0, worst = 0, prev = timeOfDayAt(1, 0);
    for (let t = 30; t < 24 * 60 * TICK; t += 30) {
      const v = timeOfDayAt(1, t);
      let d = v - prev; if (d < -0.5) d += 1;
      worst = Math.max(worst, Math.abs(d));
      prev = v;
      n++; if (v > 0.25 && v < 0.75) day++;
    }
    expect(worst).toBeLessThan(0.002);           // 0.5 s steps: never a visible jump
    expect(day / n).toBeGreaterThan(0.64);
    expect(day / n).toBeLessThan(0.72);
    // an 8-minute match (from tick 0) ends in the golden hour, not at night
    const end = timeOfDayAt(1, 8 * 60 * TICK);
    expect(end).toBeGreaterThan(0.6);
    expect(end).toBeLessThan(0.76);
  });
});

describe('sprinklers', () => {
  const data = createWorldData(1);
  const sp = data.sprinklers!.find((s) => s.id === 'meadow')!;

  it('bursts on a seeded schedule: never before `first`, `burst` seconds long, ramped pressure, sweep inside the arc', () => {
    for (let t = 0; t < sp.first * TICK; t += 10) expect(sprinklerAt(1, sp, t).on).toBe(0);
    let onTicks = 0, bursts = 0, was = false, minA = Infinity, maxA = -Infinity, jump = 0, prevOn = 0;
    const span = sp.period * 6 * TICK;
    for (let t = sp.first * TICK; t < sp.first * TICK + span; t++) {
      const s = sprinklerAt(1, sp, t);
      jump = Math.max(jump, Math.abs(s.on - prevOn));
      prevOn = s.on;
      if (s.on > 0) {
        onTicks++;
        minA = Math.min(minA, s.angle); maxA = Math.max(maxA, s.angle);
        expect(Math.hypot(s.dirX, s.dirZ)).toBeCloseTo(1, 6);
        expect(s.dirX).toBeCloseTo(Math.cos(s.angle), 6);
        expect(s.dirZ).toBeCloseTo(Math.sin(s.angle), 6);
      }
      if (s.on > 0 && !was) bursts++;
      was = s.on > 0;
    }
    expect(bursts).toBe(6);
    expect(onTicks / TICK / 6).toBeCloseTo(sp.burst, 0);
    expect(jump).toBeLessThan(0.02);             // pressure ramps (1.5 s), never pops on/off
    expect(minA).toBeGreaterThanOrEqual(sp.a0 - 1e-9);
    expect(maxA).toBeLessThanOrEqual(sp.a1 + 1e-9);
    expect(maxA - minA).toBeGreaterThan((sp.a1 - sp.a0) * 0.95);
  });

  it('jet and sweep hit tests', () => {
    const st = { on: 1, angle: 0, dirX: 1, dirZ: 0, t: 1 };
    expect(inSprinklerJet(sp, st, sp.x + 6, sp.z)).toBeCloseTo(6, 6);
    expect(inSprinklerJet(sp, st, sp.x + 6, sp.z + 0.5)).toBeGreaterThan(0);       // within the 9 deg cone
    expect(inSprinklerJet(sp, st, sp.x + 6, sp.z + 2)).toBe(-1);
    expect(inSprinklerJet(sp, st, sp.x - 6, sp.z)).toBe(-1);                       // behind the nozzle
    expect(inSprinklerJet(sp, st, sp.x + sp.reach + 0.5, sp.z)).toBe(-1);
    expect(inSprinklerJet(sp, { ...st, on: 0 }, sp.x + 6, sp.z)).toBe(-1);
    expect(inSprinklerSweep(sp, sp.x + 5, sp.z)).toBe(true);
    expect(inSprinklerSweep(sp, sp.x + 14, sp.z)).toBe(false);
  });

  it('deterministic trig matches Math.sin/cos', () => {
    let worst = 0;
    for (let a = -50; a < 50; a += 0.0137) worst = Math.max(worst, Math.abs(dsin(a) - Math.sin(a)), Math.abs(dcos(a) - Math.cos(a)));
    expect(worst).toBeLessThan(1e-7);
  });
});

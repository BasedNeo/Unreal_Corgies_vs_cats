// G1 weather audio director: thunder follows every deterministic lightning strike after the sound's
// travel time, loop levels follow the weather, sprinkler hiss follows the nearest running sprinkler.
// Node has no AudioContext, so the engine is a stub: this checks the scheduling/levels logic that decides
// WHAT plays and WHEN (the Web Audio graph itself is exercised in the world lab in a browser).
import { describe, it, expect } from 'vitest';
import { createWeatherAudio } from '../../src/client/audio/weather';
import type { AudioEngine } from '../../src/client/audio/engine';
import { createWorldData } from '../../src/shared/world/world-data';
import { forEachStrike, sprinklerAt, weatherAt, weatherCycle, type Strike } from '../../src/shared/world/weather';

function stubEngine() {
  const plays: { k: number; category?: string }[] = [];
  const engine = {
    ctx: null, buses: null, panningModel: 'HRTF',
    whenReady() { /* never ready in Node: loops are not built */ },
    play(_recipe: unknown, o: { k?: number; category?: string }) { plays.push({ k: o.k ?? 0, category: o.category }); return true; },
  } as unknown as AudioEngine;
  return { engine, plays };
}
const listener = (x = 0, y = 2, z = 0) => ({ matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1] } }) as never;

describe('weather audio', () => {
  it('plays one thunder per strike, each after its sound-travel delay', () => {
    const data = createWorldData(1);
    const { engine, plays } = stubEngine();
    const wa = createWeatherAudio(engine, data);
    const storm = weatherCycle(1, 0).find((s) => s.kind === 'storm')!;
    const t0 = storm.start, t1 = storm.start + 60 * 60;
    const strikes: Strike[] = [];
    forEachStrike(1, t0, t1, (s) => { if (s.tick + s.thunderDelay * 60 <= t1) strikes.push(s); });
    expect(strikes.length).toBeGreaterThan(3);
    strikes.sort((a, b) => (a.tick + a.thunderDelay * 60) - (b.tick + b.thunderDelay * 60));   // heard in arrival order
    const heardAt: number[] = [];
    for (let t = t0; t <= t1; t += 1) {                          // 60 fps frames, 1 tick per frame
      const before = plays.length;
      wa.update(weatherAt(1, t), t, listener(), 1 / 60);
      for (let i = before; i < plays.length; i++) if (plays[i].category === 'thunder') heardAt.push(t);
    }
    expect(heardAt.length).toBe(strikes.length);
    strikes.forEach((s, i) => {
      const due = s.tick + s.thunderDelay * 60;
      expect(heardAt[i]).toBeGreaterThanOrEqual(due);
      expect(heardAt[i] - due).toBeLessThanOrEqual(1);
    });
    // a clock jump backwards (rejoin / lab scrub) doesn't replay or strand thunder
    const n = plays.length;
    wa.update(weatherAt(1, t0), t0, listener(), 1 / 60);
    expect(plays.length).toBe(n);
  });

  it('loop levels follow the weather; sprinkler hiss only while a sprinkler runs', () => {
    const data = createWorldData(1);
    const { engine } = stubEngine();
    const wa = createWeatherAudio(engine, data);
    wa.update(weatherAt(1, 600), 600, listener(), 1 / 60);
    expect(wa.levels.rain).toBe(0);
    expect(wa.levels.wind).toBeGreaterThan(0);                  // a quiet breeze is always there
    const calm = wa.levels.wind;
    const storm = weatherCycle(1, 0).find((s) => s.kind === 'storm')!;
    const mid = Math.floor((storm.start + storm.end) / 2);
    wa.update(weatherAt(1, mid), mid, listener(), 1 / 60);
    expect(wa.levels.rain).toBeGreaterThan(0.3);
    expect(wa.levels.roar).toBeGreaterThan(0.2);
    expect(wa.levels.wind).toBeGreaterThan(calm * 4);
    const sp = data.sprinklers!.find((s) => s.id === 'meadow')!;
    let t = sp.first * 60;
    while (sprinklerAt(1, sp, t).on < 1) t += 10;
    wa.update(weatherAt(1, t), t, listener(sp.x + 3, 2, sp.z), 1 / 60);
    expect(wa.levels.sprinkler).toBeCloseTo(0.5, 6);
    wa.update(weatherAt(1, 600), 600, listener(sp.x + 3, 2, sp.z), 1 / 60);
    expect(wa.levels.sprinkler).toBe(0);
    wa.dispose();
  });
});

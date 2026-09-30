// W11 F3 (P2-6): The Lot's container rain stays under full scale into the limiter. Q5 measured the steel-rain clicks
// driving the mix into the limiter (the engine's master gain) to +6 dBFS inside a container in a storm, and gunfire did
// not duck them. Rendered with AU2's offline renderer and driver (the real audio stack): inside and by a container, in
// rain and storm, alone and under a teammate's rifle every 0.5 s, the pre-limiter peak is ≤ 0 dBFS; the steel voice's
// soft ceiling is unity below its knee; the combat duck is full from AMB.combatFull.
import { describe, expect, it } from 'vitest';
import { createWorldData } from '../../src/shared/world/world-data';
import { AMB, combatGain } from '../../src/client/audio/site-ambience';
import { STEEL_CEIL, STEEL_KNEE, steelCeiling } from '../../src/client/audio/presets-site';
import type { GameEvent } from '../../src/shared/protocol';
import { peak, rmsDb, RenderContext } from './audio-w10-render';
import { camera, pet, weatherSample, SR, WEAPON_IDS, type Scene, type Timed } from './audio-w10-scenes';
import { renderAndRestore } from './audio-w10-driver';

const lot = createWorldData(1, 'the_lot');
const H = (x: number, z: number) => lot.height(x, z) + 2.2;
const SPOT = { containerIn: [-95.5, -32], containerOut: [-103, -32] } as const;
const dbfs = (x: number) => 20 * Math.log10(x + 1e-12);

/** The listener at a spot on The Lot, in this weather; with `rifle`, a teammate 6 m away fires every 0.5 s (Q5's duck scene). */
function scene(spot: keyof typeof SPOT, sky: 'rain' | 'storm', rifle: boolean): Scene {
  const [x, z] = SPOT[spot];
  const ev: Timed<GameEvent>[] = [];
  if (rifle) for (let t = 0.5; t < 3.8; t += 0.5) ev.push({ at: t, v: { e: 'fire', id: 2, wpn: 0, x: x + 6, y: H(x, z) - 1.2, z, dx: -1, dy: 0, dz: 0, hx: x - 20, hy: 0, hz: z, hit: -1 } });
  return {
    seconds: 4, music: false, world: lot, weather: true, ambience: true, localId: 1, events: ev,
    listener: () => camera(x, H(x, z), z),
    states: () => new Map([[1, pet(1, { x, y: H(x, z) - 2.2, z })], [2, pet(2, { x: x + 6, y: H(x, z) - 2.2, z })]]),
    sky: () => weatherSample(sky), frame: (m, t) => { if (t === 0) m.audio.setWeaponIds(WEAPON_IDS); },
  };
}

describe('F3 P2-6: container rain under full scale into the limiter', () => {
  for (const spot of ['containerIn', 'containerOut'] as const) for (const sky of ['storm', 'rain'] as const) for (const rifle of [false, true]) {
    it(`${spot}, ${sky}${rifle ? ', a rifle every 0.5 s' : ''}: the mix into the limiter peaks ≤ 0 dBFS`, async () => {
      const r = await renderAndRestore(scene(spot, sky, rifle));
      const p = peak(r.master, SR, 1, 4);
      expect(dbfs(p), `${spot} ${sky} rifle ${rifle}: ${dbfs(p).toFixed(1)} dBFS`).toBeLessThanOrEqual(0);
      // and the rain is still there: the bed is not gated away (AU2 measured -20 to -27 dB RMS at these spots)
      expect(rmsDb(r.master, SR, 1, 4)).toBeGreaterThan(-30);
    }, 60_000);
  }

  it('the steel ceiling is unity below its knee, smooth and monotonic above it, and never over STEEL_CEIL', () => {
    const c = steelCeiling(new RenderContext(SR) as unknown as BaseAudioContext);
    const n = c.length;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      if (Math.abs(x) <= STEEL_KNEE) expect(c[i]).toBeCloseTo(x, 6);
      if (i > 0) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
      max = Math.max(max, Math.abs(c[i]));
    }
    expect(max).toBeLessThanOrEqual(STEEL_CEIL);
    expect(c[n - 1]).toBeGreaterThan(STEEL_KNEE);
  });

  it('the combat duck: 1 at peace, full (1 − combatDuck) from combatFull of intensity, linear between', () => {
    expect(combatGain(0)).toBe(1);
    expect(combatGain(AMB.combatFull)).toBeCloseTo(1 - AMB.combatDuck, 12);
    expect(combatGain(1)).toBeCloseTo(1 - AMB.combatDuck, 12);
    expect(combatGain(AMB.combatFull / 2)).toBeCloseTo(1 - AMB.combatDuck / 2, 12);
    expect(combatGain(-1)).toBe(1);
  });
});

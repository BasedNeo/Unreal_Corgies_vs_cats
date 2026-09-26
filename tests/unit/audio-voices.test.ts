// L5: audio voice limiting/stealing, combat intensity model, music layer mix, gibberish syllables.
import { describe, expect, it } from 'vitest';
import { VoiceLimiter } from '../../src/client/audio/voice-limiter';
import { CombatIntensity, INTENSITY, intensityFor, layerGains, type IntensityContext } from '../../src/client/audio/intensity';
import { syllables } from '../../src/client/audio/gibberish';

describe('VoiceLimiter', () => {
  it('accepts up to the global cap, then steals the oldest of the lowest priority', () => {
    const v = new VoiceLimiter(3, {});
    const a = v.acquire(0, 5, 1, 'fx')!;
    const b = v.acquire(0.1, 5, 0, 'fx')!;
    const c = v.acquire(0.2, 5, 0, 'fx')!;
    expect(v.active).toBe(3);
    const d = v.acquire(0.3, 5, 1, 'fx')!;
    expect(d.stolen?.id).toBe(b.id); // lowest priority (0), oldest of those
    const e = v.acquire(0.4, 5, 1, 'fx')!;
    expect(e.stolen?.id).toBe(c.id);
    const f = v.acquire(0.5, 5, 1, 'fx')!;
    expect(f.stolen?.id).toBe(a.id); // now all priority 1 → oldest
    expect(v.active).toBe(3);
  });

  it('never steals a more important voice: a trivial sound is rejected instead', () => {
    const v = new VoiceLimiter(2, {});
    v.acquire(0, 5, 3, 'impact');
    v.acquire(0, 5, 3, 'impact');
    expect(v.acquire(0.1, 1, 0, 'foot')).toBeNull();
    expect(v.stats.rejected).toBe(1);
    expect(v.acquire(0.1, 1, 3, 'impact')?.stolen).not.toBeNull();
  });

  it('enforces per-category caps by stealing within the category', () => {
    const v = new VoiceLimiter(10, { foot: 2 });
    const s1 = v.acquire(0, 5, 0, 'foot')!;
    v.acquire(0.1, 5, 0, 'foot');
    v.acquire(0.1, 5, 1, 'fire');
    const s3 = v.acquire(0.2, 5, 0, 'foot')!;
    expect(s3.stolen?.id).toBe(s1.id);
    expect(v.countIn('foot')).toBe(2);
    expect(v.countIn('fire')).toBe(1);
  });

  it('frees finished voices on prune and on release', () => {
    const v = new VoiceLimiter(4, {});
    const a = v.acquire(0, 0.2, 1, 'fx')!;
    v.acquire(0, 2, 1, 'fx');
    v.prune(0.5);
    expect(v.active).toBe(1);
    v.release(a.id); // already gone: no-op
    expect(v.active).toBe(1);
  });
});

describe('combat intensity → music layers', () => {
  const c: IntensityContext = { localId: 1, hasLocal: true, lx: 0, ly: 0, lz: 0, posOf: () => ({ x: 100, y: 0, z: 0 }) };

  it('weights events by proximity and involvement', () => {
    const taken = intensityFor({ e: 'hit', src: 2, dst: 1, dmg: 10, x: 0, y: 0, z: 0, crit: false }, c);
    const near = intensityFor({ e: 'fire', id: 3, wpn: 0, x: 5, y: 0, z: 0, dx: 1, dy: 0, dz: 0, hx: 20, hy: 0, hz: 0, hit: -1 }, c);
    const far = intensityFor({ e: 'fire', id: 3, wpn: 0, x: 80, y: 0, z: 0, dx: 1, dy: 0, dz: 0, hx: 90, hy: 0, hz: 0, hit: -1 }, c);
    const boom = intensityFor({ e: 'explode', x: 10, y: 0, z: 0, r: 3, by: 2 }, c);
    expect(taken).toBe(INTENSITY.hitTaken);
    expect(near).toBeGreaterThan(0);
    expect(far).toBe(0);
    expect(boom).toBe(INTENSITY.explodeNear);
  });

  it('rises with a firefight and decays back to calm', () => {
    const i = new CombatIntensity();
    for (let k = 0; k < 12; k++) i.add(0.08);
    expect(i.level).toBeGreaterThan(0.9);
    expect(i.value).toBeLessThanOrEqual(INTENSITY.max);
    for (let k = 0; k < 60 * 20; k++) i.update(1 / 60);
    expect(i.level).toBeLessThan(0.05);
  });

  it('crossfades: calm = bed only, fight = groove, peak = stabs', () => {
    expect(layerGains(0)).toEqual({ bed: 1, groove: 0, stabs: 0 });
    const mid = layerGains(0.45);
    expect(mid.groove).toBeGreaterThan(0.9);
    expect(mid.stabs).toBe(0);
    const peak = layerGains(1);
    expect(peak.stabs).toBe(1);
    expect(peak.bed).toBeCloseTo(0.65);
  });
});

describe('gibberish voices', () => {
  it('turns a line into vowel syllables (capped, never empty)', () => {
    expect(syllables('Cover me, pup!')).toEqual(['o', 'e', 'e', 'u']);
    expect(syllables('hmm')).toEqual(['a']);
    expect(syllables('a e i o u a e i o u a e').length).toBe(9);
  });
});

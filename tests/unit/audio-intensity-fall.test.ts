// W15 D: a fall is a death with `by: -1`. With no local pet (localId -1: a spectator, the menu) it must not raise combat
// intensity as your own kill would (src/client/audio/intensity.ts 'death').
import { describe, expect, it } from 'vitest';
import { INTENSITY, intensityFor, type IntensityContext } from '../../src/client/audio/intensity';

const ctx = (localId: number): IntensityContext => ({ localId, hasLocal: localId >= 0, lx: 0, ly: 0, lz: 0, posOf: () => ({ x: 200, y: 0, z: 0 }) });

describe('a death by -1 (a fall) is nobody\'s kill for the music', () => {
  it('with no local pet (localId -1) a far fall adds nothing', () => {
    expect(intensityFor({ e: 'death', id: 5, by: -1 }, ctx(-1))).toBe(0);
  });

  it('while you play, a far fall is not yours either; your kill and your own fall still count', () => {
    expect(intensityFor({ e: 'death', id: 5, by: -1 }, ctx(1))).toBe(0);
    expect(intensityFor({ e: 'death', id: 5, by: 1 }, ctx(1))).toBe(INTENSITY.deathNear * 1.5);
    expect(intensityFor({ e: 'death', id: 1, by: -1 }, ctx(1))).toBe(INTENSITY.deathNear * 1.5);
  });
});

// W9 C9: the contracts every Wave 9 lane codes against. All additive: a new button, two flag bits and optional
// WorldData fields; nothing existing moves.
import { describe, expect, it } from 'vitest';
import { Btn, BTN_MASK, sanitizeInput } from '../../src/shared/input';
import { EFlag } from '../../src/shared/types';
import { createWorldData } from '../../src/shared/world/world-data';

describe('W9 contracts', () => {
  it('Btn.Throw is a new bit inside BTN_MASK and survives sanitizeInput; every button is covered by the mask', () => {
    const bits = Object.values(Btn);
    expect(new Set(bits).size).toBe(bits.length);
    for (const b of bits) expect(b & BTN_MASK).toBe(b);
    expect(BTN_MASK).toBe(bits.reduce((a, b) => a | b, 0)); // no undefined bit slips through
    const s = sanitizeInput({ seq: 1, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: Btn.Throw | Btn.Fire | (1 << 20), rt: 0 });
    expect(s?.buttons).toBe(Btn.Throw | Btn.Fire);
  });

  it('EFlag bits are unique and fit a 31-bit integer (snapshot flags are plain numbers)', () => {
    const bits = Object.values(EFlag);
    expect(new Set(bits).size).toBe(bits.length);
    for (const b of bits) { expect(b).toBeGreaterThan(0); expect(b).toBeLessThan(2 ** 31); expect(b & (b - 1)).toBe(0); }
    expect([EFlag.Ordnance, EFlag.Carrier]).toEqual([1 << 19, 1 << 20]);
  });

  it('the new WorldData fields are optional: both maps still build without them', () => {
    for (const map of ['west_yard', 'the_lot']) {
      const w = createWorldData(1, map);
      expect(w.map).toBe(map);
      for (const k of ['floodlights', 'climbRoutes', 'bases'] as const) expect(w[k] === undefined || Array.isArray(w[k])).toBe(true);
    }
  });
});

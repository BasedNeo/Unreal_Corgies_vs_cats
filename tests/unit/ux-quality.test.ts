// U1: the quality "applies after reload" notice — which tier the world was built with, when to say so, and a
// reload that doesn't let ?quality= override the new choice.
import { describe, expect, it } from 'vitest';
import { bootQuality, qualityNote, reloadUrl } from '../../src/client/ui/quality-note';
import { QUALITY_STRINGS } from '../../src/client/ui/strings';

describe('quality notice', () => {
  it('knows the tier the world was built with (?quality= first, as main.ts reads it)', () => {
    expect(bootQuality('', 'medium')).toBe('medium');
    expect(bootQuality('?quality=low', 'high')).toBe('low');
    expect(bootQuality('?webgl&quality=med', 'high')).toBe('medium');
    expect(bootQuality('?quality=medium', 'low')).toBe('medium');
    expect(bootQuality('?quality=ultra', 'low')).toBe('high'); // world-view treats unknown tiers as high
  });

  it('says "applies after reload" only when the choice differs from the built world', () => {
    expect(qualityNote('high', 'high', false, true)).toBeNull();
    expect(qualityNote('high', 'low', true, true)).toBeNull(); // once quality is live, no notice
    expect(qualityNote('high', 'low', false, false)).toBe(QUALITY_STRINGS.reload);
    expect(qualityNote('low', 'high', false, true)).toContain(QUALITY_STRINGS.reloadInMatch);
  });

  it('reloads without ?quality= and keeps every other parameter', () => {
    expect(reloadUrl('http://h:5173/?server=ws%3A%2F%2Fh%3A8787&quality=low&name=Rex')).toBe('http://h:5173/?server=ws%3A%2F%2Fh%3A8787&name=Rex');
    expect(reloadUrl('http://h:5173/')).toBe('http://h:5173/');
  });
});

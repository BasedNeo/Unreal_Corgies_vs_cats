// Perf lane P2: quality tiers are data, the engine applies them live (no GPU needed for these checks).
import { describe, it, expect, vi } from 'vitest';
import { QUALITY, toQualityTier, type QualityTier } from '../../src/client/engine/quality';
import { createAdaptiveQuality } from '../../src/client/engine/adaptive-quality';
import { applyEngineQuality, type QualityTarget, type OutputNodes } from '../../src/client/engine/renderer';

const TIERS: QualityTier[] = ['low', 'medium', 'high'];

describe('quality profiles', () => {
  it('are monotonic: every knob of a lower tier costs no more than the tier above', () => {
    for (let i = 0; i + 1 < TIERS.length; i++) {
      const a = QUALITY[TIERS[i]], b = QUALITY[TIERS[i + 1]];
      expect(a.maxPixelRatio).toBeLessThanOrEqual(b.maxPixelRatio);
      expect(a.minPixelRatio).toBeLessThanOrEqual(b.minPixelRatio);
      expect(a.shadowMapSize).toBeLessThanOrEqual(b.shadowMapSize);
      expect(a.foliageDensity).toBeLessThanOrEqual(b.foliageDensity);
      expect(a.gardenDensity).toBeLessThanOrEqual(b.gardenDensity);
      expect(a.rainDrops).toBeLessThanOrEqual(b.rainDrops);
      expect(Number(a.shadows)).toBeLessThanOrEqual(Number(b.shadows));
      expect(Number(a.bloom)).toBeLessThanOrEqual(Number(b.bloom));
      expect(Number(a.propCreases)).toBeLessThanOrEqual(Number(b.propCreases));
    }
    for (const t of TIERS) {
      expect(QUALITY[t].outlines).toBe(true);                      // the ink hull is the look in every tier
      expect(QUALITY[t].minPixelRatio).toBeLessThanOrEqual(QUALITY[t].maxPixelRatio);
    }
  });

  it('low drops the passes that made it only 4-6 % cheaper than high (tools/perf-render.mjs)', () => {
    const low = QUALITY.low;
    expect(low.shadows).toBe(false);
    expect(low.bloom).toBe(false);
    expect(low.propCreases).toBe(false);
    expect(low.foliageDensity).toBe(0);
    expect(low.gardenDensity).toBeLessThan(0.5);
    expect(low.maxPixelRatio).toBeLessThan(1);
  });

  it('normalizes the tier spellings used by settings, URL and world view', () => {
    expect(toQualityTier('low')).toBe('low');
    expect(toQualityTier('medium')).toBe('medium');
    expect(toQualityTier('med')).toBe('medium');
    expect(toQualityTier('high')).toBe('high');
    expect(toQualityTier(null)).toBe('high');
    expect(toQualityTier('ultra')).toBe('high');
  });
});

describe('applyEngineQuality (live tier switch)', () => {
  const nodes: OutputNodes = { withBloom: { id: 'bloom' }, withoutBloom: { id: 'plain' } };
  const target = () => {
    const setBounds = vi.fn();
    const t: QualityTarget = {
      renderer: { shadowMap: { enabled: true } },
      pipeline: { pipeline: { outputNode: nodes.withBloom, needsUpdate: false } },
      adaptive: { setBounds },
    };
    return { t, setBounds };
  };

  it('switches shadows, bloom and the resolution bounds, and back', () => {
    const { t, setBounds } = target();
    applyEngineQuality(t, QUALITY.low, nodes, 2);
    expect(t.renderer.shadowMap.enabled).toBe(false);
    expect(t.pipeline.pipeline.outputNode).toBe(nodes.withoutBloom);
    expect(t.pipeline.pipeline.needsUpdate).toBe(true);
    expect(setBounds).toHaveBeenLastCalledWith(0.5, 0.85);
    t.pipeline.pipeline.needsUpdate = false;
    applyEngineQuality(t, QUALITY.high, nodes, 2);
    expect(t.renderer.shadowMap.enabled).toBe(true);
    expect(t.pipeline.pipeline.outputNode).toBe(nodes.withBloom);
    expect(t.pipeline.pipeline.needsUpdate).toBe(true);
    expect(setBounds).toHaveBeenLastCalledWith(0.75, 1.5);
  });

  it('does not rebuild the output pass when the bloom setting is unchanged, and caps by devicePixelRatio', () => {
    const { t, setBounds } = target();
    applyEngineQuality(t, QUALITY.medium, nodes, 1);
    expect(t.pipeline.pipeline.needsUpdate).toBe(false);
    expect(setBounds).toHaveBeenLastCalledWith(0.6, 1);           // dpr 1 caps medium's 1.15
  });
});

describe('adaptive resolution bounds', () => {
  const fakeRenderer = (r: number) => {
    const o = { r, getPixelRatio: () => o.r, setPixelRatio: (v: number) => { o.r = v; } };
    return o;
  };

  it('clamps and applies the ratio immediately when the tier changes', () => {
    const r = fakeRenderer(1.5);
    const a = createAdaptiveQuality(r, { min: 0.6, max: 1.5 });
    expect(a.ratio).toBe(1.5);
    a.setBounds(0.5, 0.85);
    expect(r.r).toBe(0.85);
    expect(a.ratio).toBe(0.85);
    a.setBounds(0.75, 1.5);                                         // raising the cap never jumps up by itself
    expect(r.r).toBe(0.85);
  });

  it('adapts only inside the bounds', () => {
    const r = fakeRenderer(0.85);
    const a = createAdaptiveQuality(r, { min: 0.5, max: 0.85, sampleFrames: 2 });
    for (let i = 0; i < 40; i++) a.update(40);                      // far too slow: steps down to the floor
    expect(r.r).toBe(0.5);
    for (let i = 0; i < 60; i++) a.update(5);                       // very fast: back up to the cap, not beyond
    expect(r.r).toBe(0.85);
  });
});

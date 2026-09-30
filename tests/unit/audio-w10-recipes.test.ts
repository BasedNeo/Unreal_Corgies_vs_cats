// W10 AU2 (audio-2): every new voice is well-formed Web Audio. On S2's strict fake (tests/unit/audio-fakes.ts: throws
// on non-finite values, exponential ramps to ≤ 0, stop before start, a second start or stop) every recipe, loop and
// the tension layer schedule cleanly at every variant; rendered, every one-shot is finite, audible, under full scale
// and silent once its reported duration has passed (the voice limiter frees its slot then); the dust shaper clicks at
// the rate it is asked for; the limiter knows the new categories.
import { describe, expect, it } from 'vitest';
import { OBJECTIVE_SFX } from '../../src/client/audio/presets-objective';
import { ORDNANCE_SFX } from '../../src/client/audio/presets-ordnance';
import { SITE_SFX, DUST_TH, dustCurve, dustDrive, ditchWater, floodHum, siteBed, steelRain, tarpRain } from '../../src/client/audio/presets-site';
import { scheduleTension } from '../../src/client/audio/music-tension';
import { DEFAULT_CATEGORY_CAPS } from '../../src/client/audio/voice-limiter';
import type { Voice } from '../../src/client/audio/synth';
import { fakeCtx } from './audio-fakes';
import { RenderContext, peak, rmsDb } from './audio-w10-render';

type Recipe = (v: Voice, k: number) => number;
const RECIPES: [string, Recipe][] = [
  ...Object.entries(OBJECTIVE_SFX), ...Object.entries(SITE_SFX), ['fuseAlarm', ORDNANCE_SFX.fuseAlarm],
] as [string, Recipe][];
const KS = [0, 0.3, 1, 2, 3, 4, 5];

describe('AU2 recipes on the strict fake context', () => {
  for (const [name, r] of RECIPES) {
    it(`${name} schedules cleanly at every variant`, () => {
      for (const k of KS) {
        const f = fakeCtx();
        const out = f.ctx.createGain();
        const dur = r({ ctx: f.ctx, out, t: 0.1, rand: () => 0.37 }, k);
        expect(Number.isFinite(dur) && dur > 0 && dur < 3).toBe(true);
        for (const n of f.nodes.filter((x) => x.kind === 'osc' || x.kind === 'src')) {
          expect(n.started, `${name} k=${k}: ${n.kind} never started`).toBeGreaterThanOrEqual(0.1 - 1e-9);
          expect(n.stops, `${name} k=${k}: ${n.kind} must stop on the clock`).toBe(1);
        }
      }
    });
  }

  it('the site loops build on the strict fake: every source started, nothing stopped (they loop until dispose)', () => {
    for (const build of [steelRain, tarpRain, floodHum, ditchWater, siteBed]) {
      const f = fakeCtx();
      const v = build(f.ctx, 0.7);
      expect(v.sources.length).toBeGreaterThan(0);
      for (const s of v.sources) expect((s as unknown as { started: number }).started).toBeGreaterThanOrEqual(0);
      for (const n of v.nodes) expect(f.nodes).toContain(n);
    }
  });

  it('the tension layer schedules every step at every level, hunted or not', () => {
    for (const hunted of [false, true]) for (const lv of [0, 0.25, 0.6, 0.75, 1]) {
      const f = fakeCtx();
      for (let s = 0; s < 16; s++) scheduleTension(f.ctx, f.ctx.destination as unknown as AudioNode, s, 0.1 + s * 0.139, 41, lv, hunted);
      if (lv < 0.2) expect(f.nodes.length).toBe(0);
    }
  });

  it('the limiter knows the new categories (fuse, amb, ambloop)', () => {
    expect(DEFAULT_CATEGORY_CAPS.fuse).toBe(4);
    expect(DEFAULT_CATEGORY_CAPS.amb).toBe(3);
    expect(DEFAULT_CATEGORY_CAPS.ambloop).toBe(6);
  });
});

describe('AU2 recipes rendered', () => {
  for (const [name, r] of RECIPES) {
    it(`${name}: finite, audible, under full scale, silent after its duration`, () => {
      for (const k of name === 'baCall' ? [0, 1, 2, 3, 4, 5] : name === 'siteDistant' ? [0, 1, 2, 3] : [0, 1]) {
        const ctx = new RenderContext(32000);
        const g = ctx.createGain(); g.connect(ctx.destination as unknown as AudioNode);
        let seed = 5;
        const dur = r({ ctx: ctx.asContext(), out: g, t: 0.05, rand: () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; } }, k);
        const out = ctx.render(dur + 0.6);
        for (const ch of out) for (const x of ch) if (!Number.isFinite(x)) throw new Error(`${name} k=${k}: non-finite`);
        const p = peak(out, 32000);
        expect(p, `${name} k=${k} audible`).toBeGreaterThan(0.004);
        expect(p, `${name} k=${k} under full scale`).toBeLessThan(1);
        expect(rmsDb(out, 32000, 0.05 + dur + 0.15, 0.05 + dur + 0.6), `${name} k=${k} silent after ${dur.toFixed(2)} s`).toBeLessThan(-80);
      }
    });
  }

  it('dust clicks at the asked rate (±35 %) through the threshold shaper', () => {
    for (const rate of [60, 400]) {
      const ctx = new RenderContext(32000);
      const drive = ctx.createGain(); drive.gain.value = dustDrive(rate, 32000);
      const sh = ctx.createWaveShaper(); sh.curve = dustCurve(ctx.asContext());
      const src = ctx.createBufferSource();
      const len = 64000, buf = ctx.createBuffer(1, len, 32000), d = buf.getChannelData(0);
      let s = 0x2468ace;
      for (let i = 0; i < len; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = ((s >>> 0) / 4294967296) * 2 - 1; }
      src.buffer = buf; src.connect(drive); drive.connect(sh); sh.connect(ctx.destination as unknown as AudioNode); src.start(0);
      const out = ctx.render(2);
      let clicks = 0;
      for (let i = 1; i < out[0].length; i++) if (out[0][i] !== 0 && out[0][i - 1] === 0) clicks++;
      expect(clicks / 2).toBeGreaterThan(rate * 0.65);
      expect(clicks / 2).toBeLessThan(rate * 1.35);
    }
    expect(dustDrive(0, 48000)).toBeLessThan(DUST_TH);
  });
});

// W10 AU2 (audio-2), acceptance 1: the busy moment. The REAL audio stack (createAudio + music, the X4 ordnance
// director, G1 weather, the AU2 site ambience) rendered offline on The Lot (audio-w10-render.ts): a storm, a 5-gun
// firefight with hits both ways and a mortar, a teammate carrying the enemy ball home and capturing (the carrier
// heartbeat, then the capture fanfare), and an enemy throwable ticking 2.1 m from the local pet to its blast.
//   · no clipping: every output sample finite and under full scale (the modelled master limiter), and the mix into it
//     measured too
//   · the fuse floor: every tick of the target's last 1.2 s stands ≥ FLOOR dB over everything else in its best
//     third-octave band (median ≥ FLOOR_MEDIAN), for both factions; the same throwable as a teammate's (= X4's levels,
//     nothing threatened) was ≥ 8 dB UNDER (the finding this card fixes)
//   · the voice budget: the limiter never exceeds its cap, no fuse tick is ever stolen or refused, loops never steal
//   · the ducks: the danger duck dips the rain bed while the fuse ticks and lets it back after the blast
//   · the capture fanfare cuts through the firefight
import { afterEach, describe, expect, it } from 'vitest';
import { createWorldData } from '../../src/shared/world/world-data';
import { ORDNANCE_SFX, createOrdnanceAudio, FUSE_THREAT, fuseThreat } from '../../src/client/audio/presets-ordnance';
import { captureFanfare, ballSqueal } from '../../src/client/audio/presets-objective';
import { DANGER, type AudioEngine } from '../../src/client/audio/engine';
import type { AcquireResult } from '../../src/client/audio/voice-limiter';
import type { OrdnanceCue } from '../../src/client/fx/ordnance-view';
import { band, diff, peak, rmsDb } from './audio-w10-render';
import { busyMoment, camera, fuseTicks, pet, weatherSample, SR } from './audio-w10-scenes';
import { play, renderAndRestore, type Rendered } from './audio-w10-driver';

const world = createWorldData(1, 'the_lot');
const THIRDS = [500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500];
const TICKS = new Set<unknown>([ORDNANCE_SFX.fusePeep, ORDNANCE_SFX.wickCrackle, ORDNANCE_SFX.fuseAlarm]);
/** The floor, stated: every tick of the last 1.2 s ≥ +3 dB over the rest in its best band; the median ≥ +6 dB. */
const FLOOR = 3, FLOOR_MEDIAN = 6;
const AT: [number, number, number] = [1.5, 0.15, -1.5];   // 2.1 m from the local pet; blast radius 4 m
const FUSE_FROM = 1.0, BLAST = FUSE_FROM + 2.2;

const bands = (x: Float32Array[]) => THIRDS.map((f) => band(x, SR, f / 1.12, f * 1.12));
/** Per tick of the last 1.2 s: the best third-octave band's level of `sig` over `mask` in the tick's 60 ms. */
function tickSmr(sig: Float32Array[], mask: Float32Array[], kind: 0 | 1): number[] {
  const bs = bands(sig), bm = bands(mask);
  return fuseTicks(FUSE_FROM, kind, ...AT).filter((c) => c.at >= BLAST - 1.2).map((c) => {
    let best = -200;
    for (let i = 0; i < THIRDS.length; i++) best = Math.max(best, rmsDb(bs[i], SR, c.at, c.at + 0.06) - rmsDb(bm[i], SR, c.at, c.at + 0.06));
    return best;
  });
}
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

/** Records every limiter decision (the engine's voice budget) during a scene. */
function budgetSpy(r: { m: { audio: { engine: AudioEngine } } }) {
  const lim = r.m.audio.engine.limiter;
  const log = { maxActive: 0, fuseStolen: 0, fuseRejected: 0, fuseAcquired: 0, loopStole: 0 };
  const orig = lim.acquire.bind(lim);
  lim.acquire = (now: number, dur: number, pri: number, cat: string, canSteal = true): AcquireResult | null => {
    const res = orig(now, dur, pri, cat, canSteal);
    if (cat === 'fuse') { if (res) log.fuseAcquired++; else log.fuseRejected++; }
    if (res?.stolen?.category === 'fuse') log.fuseStolen++;
    if (res?.stolen && !canSteal) log.loopStole++;
    log.maxActive = Math.max(log.maxActive, lim.active);
    return res;
  };
  return log;
}

describe('AU2 mix: a storm firefight + a capture + rain + a fuse', () => {
  const done: Rendered[] = [];
  afterEach(() => { for (const r of done.splice(0)) r.m.restore(); });

  for (const [local, kind, name] of [[0, 1, 'a corgi, an enemy hairball'], [1, 0, 'a cat, an enemy squeaker']] as const) {
    it(`${name}: no clipping, the tick above the floor, inside the voice budget`, async () => {
      // A: as it plays · M: the tick voices muted (same limiter, duck and voice seed) · A − M = exactly the ticks
      const A = await play(busyMoment({ world, local, fuseKind: kind, fuseAt: AT, fuseFrom: FUSE_FROM }));
      done.push(A);
      const M = await renderAndRestore(busyMoment({ world, local, fuseKind: kind, fuseAt: AT, fuseFrom: FUSE_FROM, mute: TICKS }));
      // no clipping, nothing non-finite
      for (const ch of A.out) for (const x of ch) expect(Number.isFinite(x)).toBe(true);
      expect(peak(A.out, SR)).toBeLessThan(0.99);
      expect(peak(A.master, SR)).toBeLessThan(1.6); // the mix into the limiter: a boom alone peaks 1.34
      // the floor
      const smr = tickSmr(diff(A.master, M.master), M.master, kind);
      expect(smr.length).toBeGreaterThanOrEqual(8);
      expect(Math.min(...smr)).toBeGreaterThanOrEqual(FLOOR);
      expect(median(smr)).toBeGreaterThanOrEqual(FLOOR_MEDIAN);
      // the stack really played: a capture, footsteps, guns, the ticks
      expect(A.m.audio.objective.counts['captured:mine']).toBe(1);
      expect(A.m.ord.counts.tick).toBe(fuseTicks(FUSE_FROM, kind, ...AT).length);
      expect(A.m.audio.engine.limiter.stats.acquired).toBeGreaterThan(150);
    }, 60000);
  }

  it('as X4 shipped it (the same throwable, a teammate\'s: nothing threatened, nothing ducked), the tick was buried', async () => {
    for (const [local, kind] of [[0, 0], [1, 1]] as const) {
      const A = await renderAndRestore(busyMoment({ world, local, fuseKind: kind, fuseAt: AT, fuseFrom: FUSE_FROM }));
      const M = await renderAndRestore(busyMoment({ world, local, fuseKind: kind, fuseAt: AT, fuseFrom: FUSE_FROM, mute: TICKS }));
      const smr = tickSmr(diff(A.master, M.master), M.master, kind);
      expect(median(smr)).toBeLessThan(-8);
    }
  }, 60000);

  it('the voice budget: never over the cap; fuse ticks never stolen or refused; ambience loops never steal', async () => {
    const r = await mountAndSpy();
    expect(r.log.maxActive).toBeLessThanOrEqual(r.cap);
    expect(r.log.fuseAcquired).toBe(fuseTicks(FUSE_FROM, 1, ...AT).length);
    expect(r.log.fuseStolen).toBe(0);
    expect(r.log.fuseRejected).toBe(0);
    expect(r.log.loopStole).toBe(0);
  }, 60000);

  it('the danger duck: the rain bed dips while the fuse ticks, and comes back after the blast', async () => {
    // storm rain alone + the throwable (no fight, no music): the 500-1000 Hz band holds only the rain (the crackle is
    // above 3 kHz); the throw comes at 3 s, once the rain bed has settled
    const from = 3, blast = from + 2.2;
    const r = await renderAndRestore(busyMoment({ world, local: 0, fuseKind: 1, fuseAt: AT, fuseFrom: from, fight: false, capture: false, music: false, ambience: false, seconds: blast + 3 }));
    const rain = band(r.master, SR, 500, 1000);
    const before = rmsDb(rain, SR, 2.2, 2.9), ducked = rmsDb(rain, SR, blast - 0.4, blast - 0.05), after = rmsDb(rain, SR, blast + 2.2, blast + 2.8);
    expect(before - ducked).toBeGreaterThan(8);
    expect(Math.abs(after - before)).toBeLessThan(1.5);
  }, 60000);

  it('the capture fanfare cuts through the firefight (its best band ≥ 4 dB over the rest at the chord)', async () => {
    const mute = new Set<unknown>([captureFanfare, ballSqueal]);
    const A = await renderAndRestore(busyMoment({ world, local: 0, fuseKind: 1, fuseAt: AT, fuseFrom: FUSE_FROM }));
    const M = await renderAndRestore(busyMoment({ world, local: 0, fuseKind: 1, fuseAt: AT, fuseFrom: FUSE_FROM, mute }));
    const bs = bands(diff(A.master, M.master)), bm = bands(M.master);
    let best = -200;
    for (let i = 0; i < THIRDS.length; i++) best = Math.max(best, rmsDb(bs[i], SR, 2.4 + 1.2, 2.4 + 1.6) - rmsDb(bm[i], SR, 2.4 + 1.2, 2.4 + 1.6));
    expect(best).toBeGreaterThan(4);
  }, 60000);
});

async function mountAndSpy() {
  // the busy moment with a spy on the limiter from the first frame (hooked at frame 0, before any sound)
  const base = busyMoment({ world, local: 0, fuseKind: 1, fuseAt: AT, fuseFrom: FUSE_FROM });
  let log: ReturnType<typeof budgetSpy> | null = null;
  const r = await play({ ...base, frame: (m, t) => { if (!log) log = budgetSpy({ m }); base.frame?.(m, t); } });
  const cap = r.m.audio.engine.limiter.maxVoices;
  r.m.restore();
  return { log: log!, cap };
}

describe('AU2 fuse ticks: who they threaten', () => {
  const cue = (kind: 0 | 1, x: number, local = false): OrdnanceCue => ({ type: 'tick', kind, x, y: 0, z: 0, k: 1, local });
  function director(species: number | null) {
    const plays: { r: unknown; o: Record<string, unknown> }[] = [];
    let danger = 0;
    const focus = species === null ? null : { x: 0, y: 0, z: 0, species };
    const engine = {
      focus,
      play: (r: unknown, o: Record<string, unknown> = {}) => { plays.push({ r, o: { ...o } }); return true; },
      focusDistance: (x: number, y: number, z: number) => Math.hypot(x, y, z),
      raiseDanger: (l: number) => { danger = Math.max(danger, l); },
    } as unknown as AudioEngine;
    return { a: createOrdnanceAudio(engine), plays, danger: () => danger };
  }
  const X4_GAIN = 0.35 + 0.35 * 1;

  it('an enemy throwable at your feet: louder, priority 3, its own category, the alarm voice, the duck', () => {
    const d = director(1); // a cat
    d.a.cue(cue(0, 2));
    expect(d.plays[0].r).toBe(ORDNANCE_SFX.fuseAlarm);
    expect(d.plays[0].o).toMatchObject({ priority: 3, category: 'fuse' });
    expect(d.plays[0].o.gain).toBeCloseTo(X4_GAIN * (1 + FUSE_THREAT.boost[0]), 6);
    expect(d.danger()).toBeCloseTo(1, 6);
  });

  it('your own throwable threatens you too (self damage); a teammate\'s does not (friendly fire is off)', () => {
    const own = director(0); own.a.cue(cue(0, 2, true));
    expect(own.plays[0].r).toBe(ORDNANCE_SFX.fuseAlarm);
    const mate = director(0); mate.a.cue(cue(0, 2));
    expect(mate.plays[0].r).toBe(ORDNANCE_SFX.fusePeep);
    expect(mate.plays[0].o.gain).toBeCloseTo(X4_GAIN, 6);
    expect(mate.danger()).toBe(0);
  });

  it('far away it is X4\'s texture exactly (threat 0 beyond 10 m, full within 4.5 m)', () => {
    const d = director(1);
    d.a.cue(cue(1, 25));
    d.a.cue(cue(0, 25));
    expect(d.plays.map((p) => p.r)).toEqual([ORDNANCE_SFX.wickCrackle, ORDNANCE_SFX.fusePeep]);
    for (const p of d.plays) expect(p.o.gain).toBeCloseTo(X4_GAIN, 6);
    expect(d.danger()).toBe(0);
    expect(fuseThreat(4.5)).toBe(1); expect(fuseThreat(10)).toBe(0); expect(fuseThreat(7.25)).toBeCloseTo(0.5, 6);
  });

  it('no local character (spectating, dead): measured from the listener, any throwable may be the threat', () => {
    const d = director(null);
    d.a.cue(cue(0, 2));
    expect(d.plays[0].r).toBe(ORDNANCE_SFX.fuseAlarm);
  });

  it('the engine\'s danger duck holds, then releases; bedDuck is exactly 1 without danger', async () => {
    const r = await play({ seconds: 0.1, world: null, localId: 1, listener: () => camera(0, 2, 0), states: () => new Map([[1, pet(1)]]), sky: () => weatherSample('clear') });
    const e = r.m.audio.engine;
    expect(e.bedDuck()).toBe(1);
    e.raiseDanger(1, 0.5);
    expect(e.bedDuck()).toBeCloseTo(1 - DANGER.bedDuck, 6);
    r.m.advance(0.5);
    expect(e.danger).toBeCloseTo(1, 6);
    r.m.advance(DANGER.release * 3);
    expect(e.danger).toBeLessThan(0.06);
    r.m.advance(3);
    expect(e.danger).toBe(0);
    expect(e.bedDuck()).toBe(1);
    e.raiseDanger(0.4, 1);
    e.raiseDanger(0.2, 1); // a lesser threat never lowers a greater one
    expect(e.danger).toBeCloseTo(0.4, 6);
    r.m.restore();
  });
});

// W10 AU2 (audio-2), acceptance 3: Base Assault's sound. Through the real createAudio (offline renderer):
//   · each event plays its cue: the ball's voice where it happens + the 2D call; "mine" and "theirs" differ, and the
//     generic pickup chime / score sting no longer double them; other modes' events sound exactly as before
//   · rendered, all eight cues (4 events × mine/theirs) are distinct from each other (spectrum + envelope)
//   · the carrier tension (pure) and its music layer: a heartbeat under a teammate's run, the minor-second pulse when
//     you carry or they have your ball, rising toward the ring, ducked under combat like the bed
import { afterEach, describe, expect, it } from 'vitest';
import type { EntityState, GameEvent } from '../../src/shared/protocol';
import { EFlag, EntityKind, Species } from '../../src/shared/types';
import { BA_BALL_SEED, BA_GOAL_SEED, BA_PICKUP_ITEM, BA_REASON, BA_STAND_SEED, BallState } from '../../src/shared/content/modes';
import * as S from '../../src/client/audio/presets';
import { OBJECTIVE_SFX, BA_GAIN, CALL_TRIM, TENSION, baCue, objectiveTension } from '../../src/client/audio/presets-objective';
import { PULSE, heartAt, pulseGain, scheduleTension } from '../../src/client/audio/music-tension';
import { midiHz } from '../../src/client/audio/synth';
import type { Voice } from '../../src/client/audio/synth';
import { band, RenderContext, rmsDb } from './audio-w10-render';
import { camera, pet, SR, type Scene } from './audio-w10-scenes';
import { play, type Rendered } from './audio-w10-driver';
import { fakeCtx } from './audio-fakes';

const O = OBJECTIVE_SFX;
const prop = (id: number, seed: number, team: 0 | 1, x: number, z: number, o: Partial<EntityState> = {}) =>
  pet(id, { kind: EntityKind.Prop, cls: -1, seed, team, species: team, x, z, weapon: 0, ammo: 0, flags: 0, ...o });
/** A Base Assault snapshot: stands and rings 80 m apart, balls home unless overridden. */
function baStates(localTeam: 0 | 1, over: Partial<Record<'ball0' | 'ball1', Partial<EntityState>>> = {}, extra: EntityState[] = []): Map<number, EntityState> {
  const m = new Map<number, EntityState>([
    [1, pet(1, { team: localTeam, species: localTeam === 0 ? Species.Corgi : Species.Cat })],
    [90, prop(90, BA_STAND_SEED, 0, -40, 0)], [91, prop(91, BA_STAND_SEED, 1, 40, 0)],
    [92, prop(92, BA_GOAL_SEED, 0, -42, 2)], [93, prop(93, BA_GOAL_SEED, 1, 42, 2)],
    [94, prop(94, BA_BALL_SEED, 0, -40, 0, over.ball0)], [95, prop(95, BA_BALL_SEED, 1, 40, 0, over.ball1)],
  ]);
  for (const e of extra) m.set(e.id, e);
  return m;
}

interface Played { r: unknown; k: unknown; bus: unknown; x: unknown; gain: unknown }
/** Plays `events` through createAudio at 0.1 s steps and records every engine.play. */
async function hear(states: Map<number, EntityState>, events: GameEvent[], o: Partial<Scene> = {}): Promise<{ plays: Played[]; r: Rendered }> {
  const plays: Played[] = [];
  const r = await play({
    seconds: 0.2 + 0.1 * events.length, world: null, localId: 1, listener: () => camera(0, 2, 3), states: () => states,
    events: events.map((v, i) => ({ at: 0.1 + 0.1 * i, v })),
    frame: (m, t) => {
      if (t !== 0) return;
      const e = m.audio.engine, orig = e.play.bind(e);
      e.play = (rc, opt = {}) => { if (opt.category !== 'foot') plays.push({ r: rc, k: opt.k, bus: opt.bus ?? 'sfx', x: opt.x, gain: opt.gain }); return orig(rc, opt); };
    },
    ...o,
  });
  return { plays, r };
}

describe('AU2 Base Assault: every event plays its cue, mine and theirs', () => {
  const done: Rendered[] = [];
  afterEach(() => { for (const r of done.splice(0)) r.m.restore(); });

  for (const localTeam of [0, 1] as const) {
    const foe = (1 - localTeam) as 0 | 1;
    it(`local team ${localTeam}: steal, drop, return, capture — ours then theirs`, async () => {
      const thief = pet(7, { team: localTeam, species: localTeam, x: 30, z: 4 });
      const enemy = pet(8, { team: foe, species: foe, x: -30, z: 5 });
      const st = baStates(localTeam, {}, [thief, enemy]);
      const ev = (reason: string, team: number): GameEvent => ({ e: 'score', team: team as 0 | 1, pts: reason === BA_REASON.captured ? 1 : 0, reason });
      const { plays, r } = await hear(st, [
        { e: 'pickup', id: 7, item: BA_PICKUP_ITEM }, ev(BA_REASON.taken, localTeam),         // we steal
        { e: 'pickup', id: 8, item: BA_PICKUP_ITEM }, ev(BA_REASON.taken, foe),               // they steal
        ev(BA_REASON.dropped, localTeam), ev(BA_REASON.dropped, foe),
        ev(BA_REASON.returned, localTeam), ev(BA_REASON.returned, foe),
        ev(BA_REASON.captured, localTeam), ev(BA_REASON.captured, foe),
      ]);
      done.push(r);
      const seq = plays.map((p) => [p.r, p.k, p.bus]);
      expect(seq).toEqual([
        [O.ballGrab, 0, 'sfx'], [O.baCall, 0, 'ui'],
        [O.ballGrab, 1, 'sfx'], [O.baCall, 1, 'ui'],
        [O.ballBounce, 0, 'sfx'], [O.baCall, 2, 'ui'], [O.ballBounce, 1, 'sfx'], [O.baCall, 3, 'ui'],
        [O.ballHome, 0, 'sfx'], [O.baCall, 4, 'ui'], [O.ballHome, 1, 'sfx'], [O.baCall, 5, 'ui'],
        [O.ballSqueal, 0, 'sfx'], [O.captureFanfare, 0, 'ui'], [O.ballSqueal, 1, 'sfx'], [O.captureLament, 0, 'ui'],
      ]);
      // positional where it happens: the thief, the ball, the ring; never the old chime or score sting
      expect(plays[0].x).toBe(30);
      expect(plays.filter((p) => p.bus === 'sfx').every((p) => typeof p.x === 'number')).toBe(true);
      expect(plays.some((p) => p.r === S.chime || p.r === S.sting || p.r === S.chapterFanfare)).toBe(false);
      expect(plays[1].gain).toBeCloseTo(BA_GAIN.call * CALL_TRIM[0], 6);
      expect(r.m.audio.objective.counts).toEqual({ 'grab:mine': 1, 'grab:theirs': 1, 'taken:mine': 1, 'taken:theirs': 1, 'dropped:mine': 1, 'dropped:theirs': 1, 'returned:mine': 1, 'returned:theirs': 1, 'captured:mine': 1, 'captured:theirs': 1 });
    }, 30000);
  }

  it('your own steal plays the grab 2D (on your back), the rest positional', async () => {
    const { plays, r } = await hear(baStates(0), [{ e: 'pickup', id: 1, item: BA_PICKUP_ITEM }, { e: 'score', team: 0, pts: 0, reason: BA_REASON.taken }]);
    done.push(r);
    expect(plays[0].r).toBe(O.ballGrab);
    expect(plays[0].x).toBeUndefined();
  }, 30000);

  it('other modes sound exactly as before: pickups chime, kills sting, adventure steps jingle', async () => {
    const { plays, r } = await hear(new Map([[1, pet(1)]]), [
      { e: 'pickup', id: 1, item: 'kibble' }, { e: 'score', team: 0, pts: 1, reason: 'kill' }, { e: 'score', team: 1, pts: 1, reason: 'core' },
    ]);
    done.push(r);
    expect(plays.map((p) => [p.r, p.k])).toEqual([[S.chime, undefined], [S.sting, 1], [S.sting, 2]]);
    expect(r.m.audio.objective.counts).toEqual({});
  }, 30000);

  it('baCue: every Base Assault reason maps (mine ≠ theirs), anything else is not ours', () => {
    for (const reason of Object.values(BA_REASON)) {
      const a = baCue(reason, true)!, b = baCue(reason, false)!;
      expect(a && b).toBeTruthy();
      expect([a.ball, a.ballK, a.call, a.callK]).not.toEqual([b.ball, b.ballK, b.call, b.callK]);
    }
    for (const reason of ['kill', 'step', 'chapter', 'core', 'win', '']) expect(baCue(reason, true)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ distinct

type Recipe = (v: Voice, k: number) => number;
/** Renders a cue (the ball's voice + the call) and returns its signature: 1/3-octave spectrum + 20 ms envelope. */
function signature(ball: Recipe, bk: number, call: Recipe, ck: number): number[] {
  const ctx = new RenderContext(SR);
  let seed = 3;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const g = ctx.createGain(); g.connect(ctx.destination as unknown as AudioNode);
  const d1 = ball({ ctx: ctx.asContext(), out: g, t: 0.02, rand }, bk);
  const d2 = call({ ctx: ctx.asContext(), out: g, t: 0.02, rand }, ck);
  const out = ctx.render(Math.max(d1, d2) + 0.2);
  const f: number[] = [];
  for (const fc of [125, 250, 500, 800, 1250, 2000, 3150, 5000, 8000]) f.push(Math.pow(10, rmsDb(band(out, SR, fc / 1.26, fc * 1.26), SR) / 20));
  const n = f.reduce((a, b) => a + b, 0);
  const spec = f.map((x) => x / n);
  const env: number[] = [];
  for (let t = 0; t < 2.4; t += 0.02) env.push(Math.pow(10, rmsDb(out, SR, t, t + 0.02) / 20));
  const m = env.reduce((a, b) => a + b, 0) || 1;
  return [...spec, ...env.map((x) => x / m)];
}
const cosine = (a: number[], b: number[]) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y); };

describe('AU2 Base Assault: the eight cues are distinct', () => {
  it('every pair of (event × mine/theirs) cues differs in spectrum or envelope (cosine < 0.97)', () => {
    const cues = Object.values(BA_REASON).flatMap((reason) => [true, false].map((mine) => ({ name: `${reason}:${mine ? 'mine' : 'theirs'}`, c: baCue(reason, mine)! })));
    const sig = cues.map(({ c }) => signature(c.ball, c.ballK, c.call, c.callK));
    for (let i = 0; i < cues.length; i++) for (let j = i + 1; j < cues.length; j++) {
      expect(cosine(sig[i], sig[j]), `${cues[i].name} vs ${cues[j].name}`).toBeLessThan(0.97);
    }
  }, 30000);
});

// ------------------------------------------------------------------------------------------------ tension

describe('AU2 carrier tension (pure)', () => {
  const carrying = (team: 0 | 1, carrier: number, x: number) => ({ weapon: BallState.Carried, ammo: carrier, x, flags: EFlag.Busy, team });
  it('nothing at stake: 0 (no Base Assault props, both balls home, or no local character)', () => {
    expect(objectiveTension(new Map([[1, pet(1)]]), 1).level).toBe(0);
    expect(objectiveTension(baStates(0), 1).level).toBe(0);
    expect(objectiveTension(baStates(0), 99).level).toBe(0);
  });
  it('a teammate carries their ball home: a heartbeat that rises as the carrier nears our ring', () => {
    const far = objectiveTension(baStates(0, { ball1: carrying(1, 7, 35) }), 1), near = objectiveTension(baStates(0, { ball1: carrying(1, 7, -36) }), 1);
    expect(far.level).toBeGreaterThanOrEqual(TENSION.oursBase);
    expect(near.level).toBeGreaterThan(far.level + 0.2);
    expect(near.hunted).toBe(false);
  });
  it('you carry: you are the one hunted (≥ 0.72, the minor-second pulse)', () => {
    const t = objectiveTension(baStates(0, { ball1: carrying(1, 1, 20) }), 1);
    expect(t.level).toBeGreaterThanOrEqual(TENSION.selfBase);
    expect(t.hunted).toBe(true);
  });
  it('they have our ball: dread that grows as they near their ring; a ball on the ground simmers', () => {
    const early = objectiveTension(baStates(0, { ball0: carrying(0, 8, -35) }), 1), late = objectiveTension(baStates(0, { ball0: carrying(0, 8, 36) }), 1);
    expect(early.hunted).toBe(true);
    expect(late.level).toBeGreaterThan(early.level + 0.2);
    expect(objectiveTension(baStates(0, { ball0: { weapon: BallState.Dropped } }), 1).level).toBeCloseTo(TENSION.oursDropped, 6);
    const both = objectiveTension(baStates(0, { ball0: carrying(0, 8, 0), ball1: carrying(1, 7, 0) }), 1);
    expect(both.level).toBeGreaterThan(Math.max(TENSION.oursBase, TENSION.theirsBase));
  });
});

describe('AU2 carrier tension: the music layer', () => {
  it('the heart: half-time from 0.2, every beat from 0.55; nothing below', () => {
    const beats = (lv: number) => Array.from({ length: 16 }, (_, s) => heartAt(s, lv)).filter(Boolean).length;
    expect(beats(0.1)).toBe(0);
    expect(beats(0.3)).toBe(4);   // lub-dub on beats 1 and 3
    expect(beats(0.6)).toBe(8);   // lub-dub on every beat
  });
  it('the pulse: root and fifth for a teammate\'s run, root and minor second when hunted', () => {
    const notes = (hunted: boolean) => {
      const f = fakeCtx();
      for (let s = 0; s < 4; s++) scheduleTension(f.ctx, f.ctx.destination as unknown as AudioNode, s, s * 0.14, 41, 0.9, hunted);
      return f.nodes.filter((n) => n.kind === 'osc' && n.type === 'sawtooth').map((n) => Math.round((n.frequency as { value: number }).value * 10) / 10);
    };
    expect(notes(false)).toEqual([midiHz(53), midiHz(60)].map((x) => Math.round(x * 10) / 10));
    expect(notes(true)).toEqual([midiHz(53), midiHz(54)].map((x) => Math.round(x * 10) / 10));
  });
  it('ducks under the groove like the bed (−35 %), silent without tension', () => {
    expect(pulseGain(0, 0)).toBeLessThan(0.001);
    expect(pulseGain(0.8, 1) / pulseGain(0.8, 0)).toBeCloseTo(1 - PULSE.duck, 6);
  });

  it('rendered: a teammate\'s run home puts a heartbeat under the music (≥ 10 dB in 35-70 Hz on the beat grid)', async () => {
    const run = (withCarrier: boolean) => play({
      seconds: 5, music: true, world: null, localId: 1, listener: () => camera(0, 2, 3),
      states: () => baStates(0, withCarrier ? { ball1: { weapon: BallState.Carried, ammo: 7, x: -30, flags: EFlag.Busy } } : {}, [pet(7, { x: -30 })]),
    });
    const a = await run(true), b = await run(false);
    a.m.restore(); b.m.restore();
    expect(a.m.audio.objective.tension.level).toBeGreaterThan(0.7);
    const lo = (r: Rendered) => rmsDb(band(r.master, SR, 35, 70), SR, 2.5, 5);
    expect(lo(a) - lo(b)).toBeGreaterThan(10);
  }, 60000);
});

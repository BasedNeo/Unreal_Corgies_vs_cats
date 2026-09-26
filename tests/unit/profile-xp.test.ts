// P2: XP for a match as a pure function of its result, the level curve, the match tally (events → result) and
// recordMatch → rewardSummary.
import { describe, expect, it } from 'vitest';
import { freshProfile, type Profile } from '../../src/client/profile/schema';
import { applyMatch } from '../../src/client/profile/record';
import { ProfileStore } from '../../src/client/profile/store';
import { MatchTally, type TallyFrame } from '../../src/client/profile/tally';
import {
  CAPS, FIRST_LEVEL_XP, MAX_LEVEL, MAX_XP, MIN_PLAY_SECONDS, XP, levelForXp, levelProgress, matchXp, sanitizeResult, xpForLevel, xpToNext,
} from '../../src/client/profile/xp';
import { rewardSummary } from '../../src/client/ui/rewards';
import type { EntityState, MatchState } from '../../src/shared/protocol';
import { EFlag, EntityKind } from '../../src/shared/types';
import { ADVENTURE_CHAIN_INDEX, ADVENTURE_PHASES } from '../../src/shared/content/chapters';
import { FIXTURE } from './profile-fixture';

const none = { firstWins: [] as string[], medalXp: {} };

describe('XP: a pure function of the match result', () => {
  it('the table: played + outcome + per-event XP, in reward-card order', () => {
    const r = matchXp({ mode: 'core-rush', outcome: 'win', knockouts: 4, steps: 1, cores: 2, pads: 3 }, { firstWins: ['core-rush'], medalXp: {} });
    expect(r.lines).toEqual([
      { kind: 'played', xp: 60 }, { kind: 'win', xp: 100 }, { kind: 'knockouts', count: 4, xp: 40 },
      { kind: 'steps', count: 1, xp: 15 }, { kind: 'cores', count: 2, xp: 20 }, { kind: 'pads', count: 3, xp: 60 },
    ]);
    expect(r.total).toBe(295);
    expect(matchXp({ mode: 'team-deathmatch', outcome: 'loss' }, none).total).toBe(XP.played + XP.loss);
    expect(matchXp({ mode: 'team-deathmatch', outcome: 'draw' }, none).total).toBe(XP.played + XP.draw);
  });

  it('the first win in a mode pays once; other modes still pay theirs', () => {
    const first = matchXp({ mode: 'team-deathmatch', outcome: 'win' }, none);
    expect(first.lines.at(-1)).toEqual({ kind: 'firstWin', xp: XP.firstWin, mode: 'team-deathmatch' });
    expect(matchXp({ mode: 'team-deathmatch', outcome: 'win' }, { firstWins: ['team-deathmatch'], medalXp: {} }).lines.some((l) => l.kind === 'firstWin')).toBe(false);
    expect(matchXp({ mode: 'core-rush', outcome: 'win' }, { firstWins: ['team-deathmatch'], medalXp: {} }).lines.some((l) => l.kind === 'firstWin')).toBe(true);
    expect(matchXp({ mode: 'core-rush', outcome: 'loss' }, none).lines.some((l) => l.kind === 'firstWin')).toBe(false);
  });

  it('chapter paws: medal XP every clear, the new-best bonus only for a better paw than was paid for', () => {
    const ch = (medal: 'gold' | 'silver' | 'bronze') => ({ mode: 'adventure', outcome: 'win' as const, steps: 5, chapter: { id: 'yard_day', medal } });
    const a = matchXp(ch('silver'), { firstWins: ['adventure'], medalXp: {} });
    expect(a.lines.map((l) => l.kind)).toEqual(['played', 'win', 'steps', 'medal', 'newBest']);
    expect(a.total).toBe(60 + 100 + 75 + XP.medal.silver + XP.newBest);
    expect(matchXp(ch('silver'), { firstWins: ['adventure'], medalXp: { yard_day: 'silver' } }).lines.some((l) => l.kind === 'newBest')).toBe(false);
    expect(matchXp(ch('bronze'), { firstWins: ['adventure'], medalXp: { yard_day: 'silver' } }).lines.some((l) => l.kind === 'newBest')).toBe(false);
    expect(matchXp(ch('gold'), { firstWins: ['adventure'], medalXp: { yard_day: 'silver' } }).lines.find((l) => l.kind === 'medal')).toEqual({ kind: 'medal', medal: 'gold', xp: XP.medal.gold });
    expect(matchXp(ch('gold'), { firstWins: ['adventure'], medalXp: { yard_day: 'silver' } }).lines.some((l) => l.kind === 'newBest')).toBe(true);
  });

  it('a match shorter than MIN_PLAY_SECONDS earns event XP only', () => {
    const r = matchXp({ mode: 'team-deathmatch', outcome: 'win', knockouts: 2, seconds: MIN_PLAY_SECONDS - 1, chapter: null }, none);
    expect(r.lines).toEqual([{ kind: 'knockouts', count: 2, xp: 20 }]);
    expect(matchXp({ mode: 'team-deathmatch', outcome: 'win', seconds: MIN_PLAY_SECONDS }, none).total).toBe(60 + 100 + 150);
  });

  it('bad input is sanitized: counts floored and capped, unknown chapters and modes dropped', () => {
    const r = sanitizeResult({ mode: 'Team Deathmatch!', outcome: 'victory' as never, knockouts: 1e9, steps: -3, cores: 2.9, pads: NaN, chapter: { id: 'moon_base', medal: 'gold' } });
    expect(r).toMatchObject({ mode: '', outcome: 'loss', knockouts: CAPS.knockouts, steps: 0, cores: 2, pads: 0, chapter: null, seconds: Infinity });
    expect(matchXp({ mode: 'x', outcome: 'win', knockouts: 1e9 }, none).total).toBe(60 + 100 + CAPS.knockouts * XP.knockout + XP.firstWin);
    expect(matchXp({ mode: '', outcome: 'win' }, none).lines.some((l) => l.kind === 'firstWin')).toBe(false);
  });

  it('is pure: same input, same output', () => {
    const res = { mode: 'yard-skirmish', outcome: 'win' as const, knockouts: 9, steps: 2 };
    expect(matchXp(res, none)).toEqual(matchXp(res, none));
  });
});

describe('level curve', () => {
  it('numbers: 100 to level 2, then 200, 250, 300 … per level', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(xpForLevel)).toEqual([0, 100, 300, 550, 850, 1200, 1600, 2050, 2550, 3100]);
    expect([1, 2, 3, 10].map(xpToNext)).toEqual([100, 200, 250, 600]);
    for (let l = 1; l < MAX_LEVEL; l++) expect(xpForLevel(l + 1) - xpForLevel(l)).toBe(xpToNext(l));
  });

  it('levelForXp inverts xpForLevel and is monotonic; the bar fills within each level', () => {
    for (let l = 1; l <= MAX_LEVEL; l++) {
      expect(levelForXp(xpForLevel(l))).toBe(l);
      if (l > 1) expect(levelForXp(xpForLevel(l) - 1)).toBe(l - 1);
    }
    expect(levelForXp(-5)).toBe(1);
    expect(levelForXp(NaN)).toBe(1);
    expect(levelForXp(MAX_XP * 10)).toBe(MAX_LEVEL);
    expect(levelProgress(400)).toEqual({ level: 3, into: 100, need: 250, frac: 0.4 });
    expect(levelProgress(MAX_XP).frac).toBe(1);
  });

  it('any first match levels up, even a quick loss with no knockouts', () => {
    expect(XP.played + XP.loss).toBeGreaterThanOrEqual(FIRST_LEVEL_XP);
    const rec = applyMatch(freshProfile(), { mode: 'team-deathmatch', outcome: 'loss' }, FIXTURE);
    expect(rec.profile.level).toBe(2);
    expect(rec.newly).toEqual(['coat_tricolor']); // the fixture's level-2 look
  });

  it('slows down: matches per level grow with the level (typical 200 XP match)', () => {
    const per = (l: number) => xpToNext(l) / 200;
    expect(per(1)).toBeLessThanOrEqual(0.5);
    expect(per(2)).toBe(1);
    expect(per(10)).toBe(3);
    for (let l = 2; l < 30; l++) expect(per(l + 1)).toBeGreaterThan(per(l));
  });
});

describe('recordMatch → rewardSummary', () => {
  it('applies XP, stats, first wins, paws and unlocks; the summary lists them', () => {
    const kv = new Map<string, string>();
    const s = new ProfileStore({ storage: { getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => void kv.set(k, v) }, content: FIXTURE });
    const sum = s.recordMatch({ mode: 'core-rush', outcome: 'win', knockouts: 3, pads: 2 });
    expect(sum.xp).toBe(60 + 100 + 30 + 40 + 150);
    expect(sum.levelBefore).toBe(1);
    expect(sum.levelAfter).toBe(3);
    expect(sum.levelUps).toBe(2);
    expect(sum.newLooks.map((l) => l.id)).toEqual(['coat_tricolor', 'coat_calico', 'neck_bandana']); // content order
    expect(sum.newLooks[0]).toMatchObject({ name: 'Tricolor', slot: 'coat', species: 'corgi' });
    expect(sum.next).toMatchObject({ level: 4, looks: [{ id: 'coat_tuxedo' }] });
    expect(sum.lines.map((l) => l.kind)).toEqual(['played', 'win', 'knockouts', 'pads', 'firstWin']);
    const p = s.load();
    expect(p.stats).toMatchObject({ matches: 1, wins: 1, knockouts: 3, pads: 2 });
    expect(p.firstWins).toEqual(['core-rush']);
  });

  it('rewardSummary is pure and reads a quiet match as a small card, nothing as empty', () => {
    const before: Profile = { ...freshProfile(), xp: 120, level: 2, unlocked: ['coat_tricolor'] };
    const after: Profile = { ...before, xp: 220 };
    const sum = rewardSummary(before, after, { content: FIXTURE });
    expect(sum).toMatchObject({ xp: 100, levelBefore: 2, levelAfter: 2, levelUps: 0, newLooks: [], empty: false });
    expect(sum.bar.from).toBeCloseTo(0.1);
    expect(sum.bar.to).toBeCloseTo(0.6);
    expect(rewardSummary(before, before).empty).toBe(true);
    expect(rewardSummary(before, after, { content: FIXTURE })).toEqual(sum);
  });
});

// ------------------------------------------------------------------------------------------------ the tally
function ent(id: number, o: Partial<EntityState>): EntityState {
  return { id, kind: EntityKind.Player, team: 0, cls: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, hp: 100, maxHp: 100, flags: 0, anim: 0, weapon: 0, ammo: 0, seed: 0, ...o } as EntityState;
}
const match = (mode: string, phase: MatchState['phase'], winner: MatchState['winner'] = -1): MatchState => ({ mode, phase, timeLeft: 0, score: [0, 0], objective: '', wave: 0, winner });

describe('MatchTally: events → the local player\'s result', () => {
  it('TDM: knockouts (enemies only), cores, seconds; one result at the end; the next match starts over', () => {
    const t = new MatchTally();
    const me = 5;
    const states = new Map<number, EntityState>([[me, ent(me, { team: 0 })], [9, ent(9, { team: 1 })], [10, ent(10, { team: 0 })]]);
    const frame = (m: MatchState, dt = 1): TallyFrame => ({ match: m, localId: me, states, dt });
    expect(t.update(frame(match('team-deathmatch', 'warmup')))).toBeNull();
    for (let i = 0; i < 40; i++) expect(t.update(frame(match('team-deathmatch', 'live'), 0.25))).toBeNull();
    t.onEvent({ e: 'death', id: 9, by: me });
    t.onEvent({ e: 'death', id: 9, by: me });
    t.onEvent({ e: 'death', id: 10, by: me }); // a teammate: not a knockout
    t.onEvent({ e: 'death', id: me, by: me }); // a fall
    t.onEvent({ e: 'death', id: 9, by: 7 }); // someone else's
    t.onEvent({ e: 'pickup', id: me, item: 'overclock' });
    t.onEvent({ e: 'pickup', id: me, item: 'golden_kibble' }); // not a core
    t.onEvent({ e: 'pickup', id: 7, item: 'thick_fur' });
    t.update(frame(match('team-deathmatch', 'live'), 0.25));
    const res = t.update(frame(match('team-deathmatch', 'ended', 0)));
    expect(res).toEqual({ mode: 'team-deathmatch', outcome: 'win', knockouts: 2, steps: 0, cores: 1, pads: 0, chapter: null, seconds: 10.3 });
    expect(t.update(frame(match('team-deathmatch', 'ended', 0)))).toBeNull(); // once
    t.update(frame(match('team-deathmatch', 'warmup')));
    t.update(frame(match('team-deathmatch', 'live'), 0.25));
    expect(t.update(frame(match('team-deathmatch', 'ended', 1)))).toMatchObject({ outcome: 'loss', knockouts: 0, cores: 0, seconds: 0.3 });
  });

  it('a match only seen ended (joined during the result) gives no result; a draw reads as a draw', () => {
    const t = new MatchTally();
    const states = new Map([[1, ent(1, {})]]);
    expect(t.update({ match: match('core-rush', 'ended', 0), localId: 1, states, dt: 1 })).toBeNull();
    t.update({ match: match('core-rush', 'live'), localId: 1, states, dt: 0.1 });
    expect(t.update({ match: match('core-rush', 'ended', -1), localId: 1, states, dt: 1 })?.outcome).toBe('draw');
  });

  it('core-rush pads count only while you stand on the pad your team took; steps are your team\'s', () => {
    const t = new MatchTally();
    const me = 3;
    const states = new Map<number, EntityState>([
      [me, ent(me, { team: 1, x: 10, z: 0 })],
      [20, ent(20, { kind: EntityKind.Zone, seed: 0, team: 2, x: 11, z: 1 })],
      [21, ent(21, { kind: EntityKind.Zone, seed: 1, team: 2, x: 60, z: 0 })],
    ]);
    const f = (m: MatchState): TallyFrame => ({ match: m, localId: me, states, dt: 0.2 });
    t.update(f(match('core-rush', 'live')));
    t.onEvent({ e: 'score', team: 1, pts: 5, reason: 'took pad A' }); // on it: counts
    t.onEvent({ e: 'score', team: 1, pts: 5, reason: 'took pad B' }); // far away: no
    t.onEvent({ e: 'score', team: 0, pts: 5, reason: 'took pad A' }); // the other team
    t.onEvent({ e: 'score', team: 1, pts: 10, reason: 'objective' });
    t.onEvent({ e: 'score', team: 0, pts: 10, reason: 'objective' });
    t.update(f(match('core-rush', 'live')));
    states.set(me, ent(me, { team: 1, x: 10, z: 0, flags: EFlag.Dead }));
    t.onEvent({ e: 'score', team: 1, pts: 5, reason: 'took pad A' }); // knocked out on it: no
    t.update(f(match('core-rush', 'live')));
    expect(t.update(f(match('core-rush', 'ended', 1)))).toMatchObject({ outcome: 'win', pads: 1, steps: 1 });
  });

  it('adventure: steps, and the chapter paw from the beacon when the chapter completes', () => {
    const t = new MatchTally();
    const me = 2;
    const states = new Map<number, EntityState>([[me, ent(me, { team: 0 })]]);
    const f = (m: MatchState): TallyFrame => ({ match: m, localId: me, states, dt: 0.25 });
    t.update(f(match('adventure', 'warmup')));
    for (let i = 0; i < 200; i++) t.update(f(match('adventure', 'live')));
    for (let i = 0; i < 5; i++) t.onEvent({ e: 'score', team: 0, pts: 10, reason: 'step' });
    t.onEvent({ e: 'score', team: 0, pts: 50, reason: 'chapter' });
    // ended before the beacon shows the paw: wait for it
    expect(t.update(f(match('adventure', 'ended', 0)))).toBeNull();
    // the beacon: chapter 3 complete, 100 s against a 120 s par (gold)
    states.set(40, ent(40, { kind: EntityKind.Prop, cls: ADVENTURE_CHAIN_INDEX, seed: 3, anim: ADVENTURE_PHASES.indexOf('complete') as EntityState['anim'], hp: 100, maxHp: 120 }));
    expect(t.update(f(match('adventure', 'ended', 0)))).toEqual({ mode: 'adventure', outcome: 'win', knockouts: 0, steps: 5, cores: 0, pads: 0, chapter: { id: 'garage_job', medal: 'gold' }, seconds: 50 });
  });

  it('adventure without a visible beacon still reports after a short wait (no paw)', () => {
    const t = new MatchTally();
    const states = new Map([[1, ent(1, {})]]);
    t.update({ match: match('adventure', 'live'), localId: 1, states, dt: 0.1 });
    let res = null;
    for (let i = 0; i < 30 && !res; i++) res = t.update({ match: match('adventure', 'ended', 0), localId: 1, states, dt: 0.1 });
    expect(res).toMatchObject({ mode: 'adventure', outcome: 'win', chapter: null });
  });

  it('a score reset (the room restarts the match) drops what was counted', () => {
    const t = new MatchTally();
    const states = new Map([[1, ent(1, {})], [2, ent(2, { team: 1 })]]);
    t.update({ match: match('yard-skirmish', 'live'), localId: 1, states, dt: 0.1 });
    t.onEvent({ e: 'death', id: 2, by: 1 });
    t.onEvent({ e: 'score', team: 0, pts: 0, reason: 'reset' });
    t.update({ match: match('yard-skirmish', 'live'), localId: 1, states, dt: 0.1 });
    expect(t.update({ match: match('yard-skirmish', 'ended', 0), localId: 1, states, dt: 0.1 })).toMatchObject({ knockouts: 0 });
  });
});

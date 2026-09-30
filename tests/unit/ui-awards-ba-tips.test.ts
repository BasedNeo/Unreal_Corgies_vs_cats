// W10 U3: Base Assault first-match tips through the U1 tip scheduler (ui/tips.ts). Named ui-awards-* to stay inside the
// U3 lane's declared test paths; it tests tips.ts only.
// - the facts come from the snapshot's ball props (baseAssaultTipFacts): our ball, theirs, who carries;
// - in the first Base Assault match, each tip once: the goal at 4 s, the situational three when their situation
//   happens (our ball down, ours carried off, a teammate carrying theirs), ending when it is over;
// - the goal tip is skipped if you already carried a ball; nothing outside Base Assault or after that first match;
// - state persists under its own key (the first-match record keeps its exact shape); Show again resets both.
import { describe, expect, it } from 'vitest';
import { BA_TIP_IDS, TIPS_BA_KEY, TIPS_KEY, TIP_RULES, TipScheduler, baseAssaultTipFacts, type BaTipFacts, type TipFrame, type TipId } from '../../src/client/ui/tips';
import { TIP_TEXT } from '../../src/client/ui/strings';
import type { KV } from '../../src/client/ui/settings';
import type { EntityState } from '../../src/shared/protocol';
import { EntityKind } from '../../src/shared/types';
import { BA_BALL_SEED, BA_GOAL_SEED, BASE_ASSAULT, BallState } from '../../src/shared/content/modes';

class MemKV implements KV {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

const HOME: BaTipFacts = { own: 'home', enemy: 'home', localCarrying: false, teamCarrying: false };
const PLAY: TipFrame = { active: true, phase: 'live', nearKiosk: false, moving: false, firing: false, aiming: false };
const BA: TipFrame = { ...PLAY, ba: HOME };

function run(t: TipScheduler, secs: number, f: Partial<TipFrame> = {}): Array<TipId | null> {
  const seen: Array<TipId | null> = [];
  for (let i = 0; i < Math.round(secs * 60); i++) {
    const id = t.update(1 / 60, { ...BA, ...f });
    if (seen.at(-1) !== id) seen.push(id);
  }
  return seen;
}

/** A player whose first match (general tips) is long over. */
function veteran(): { kv: MemKV; t: TipScheduler } {
  const kv = new MemKV();
  kv.setItem(TIPS_KEY, JSON.stringify({ v: 1, seen: ['basics', 'kiosk', 'moves'], done: true }));
  return { kv, t: new TipScheduler(kv) };
}

describe('W10 U3: Base Assault facts from the snapshot', () => {
  const st = (o: Partial<EntityState>): EntityState => ({ id: 0, kind: EntityKind.Player, team: 0, species: 0, cls: 0, seed: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 100, maxHp: 100, anim: 0, flags: 0, weapon: 0, ammo: 0, ...o } as EntityState);
  const ball = (id: number, team: 0 | 1, state: number, carrier = 0) => st({ id, kind: EntityKind.Prop, team, cls: -1, seed: BA_BALL_SEED, weapon: state, ammo: carrier });
  const world = (...extra: EntityState[]) => new Map(extra.map((e) => [e.id, e]));

  it('our ball, theirs, and who carries, from the local side', () => {
    const me = st({ id: 1, team: 0 }), mate = st({ id: 2, team: 0 }), cat = st({ id: 11, team: 1 });
    const goal = st({ id: 52, kind: EntityKind.Prop, team: 0, cls: -1, seed: BA_GOAL_SEED });
    expect(baseAssaultTipFacts(world(me, mate, cat, goal, ball(50, 0, BallState.Home), ball(51, 1, BallState.Home)), 1, 'base-assault')).toEqual(HOME);
    expect(baseAssaultTipFacts(world(me, cat, ball(50, 0, BallState.Carried, 11), ball(51, 1, BallState.Carried, 2)), 1, 'base-assault'))
      .toEqual({ own: 'taken', enemy: 'taken', localCarrying: false, teamCarrying: true });
    expect(baseAssaultTipFacts(world(me, ball(50, 0, BallState.Dropped), ball(51, 1, BallState.Carried, 1)), 1))
      .toEqual({ own: 'dropped', enemy: 'taken', localCarrying: true, teamCarrying: false });
    // seen from the cats' side
    expect(baseAssaultTipFacts(world(cat, ball(50, 0, BallState.Carried, 11), ball(51, 1, BallState.Dropped)), 11))
      .toEqual({ own: 'dropped', enemy: 'taken', localCarrying: true, teamCarrying: false });
  });

  it('null outside Base Assault, before you have a body or a team, or without both balls', () => {
    const me = st({ id: 1, team: 0 });
    const both = [ball(50, 0, BallState.Home), ball(51, 1, BallState.Home)];
    expect(baseAssaultTipFacts(world(me, ...both), 1, 'team-deathmatch')).toBeNull();
    expect(baseAssaultTipFacts(world(...both), 1, 'base-assault')).toBeNull();
    expect(baseAssaultTipFacts(world(st({ id: 1, team: 2 as EntityState['team'] }), ...both), 1, 'base-assault')).toBeNull();
    expect(baseAssaultTipFacts(world(me, both[0]), 1, 'base-assault')).toBeNull();
  });
});

describe('W10 U3: Base Assault tips, first Base Assault match', () => {
  it('the goal tip 4 s into the mode; nothing outside it', () => {
    const { t } = veteran();
    expect(run(t, 30, { ba: null })).toEqual([null]); // a TDM match: the general tips are done, nothing to show
    expect(run(t, TIP_RULES.baGoalDelay - 0.1)).toEqual([null]);
    expect(run(t, 0.2)).toEqual([null, 'ba_goal']);
    expect(run(t, TIP_RULES.duration.ba_goal)).toEqual(['ba_goal', null]);
    expect(t.isSeen('ba_goal')).toBe(true);
    expect(TIP_TEXT.ba_goal).toContain(`first to ${BASE_ASSAULT.captureLimit}`);
  });

  it('situational tips when it happens, each once, ending when the situation does', () => {
    const { t } = veteran();
    run(t, 20); // the goal tip and its gap
    // our ball is down: touch it to send it home
    expect(run(t, 1, { ba: { ...HOME, own: 'dropped' } })).toEqual(['ba_return']);
    expect(run(t, 1.2, { ba: { ...HOME, own: 'dropped' } })).toEqual(['ba_return']);
    expect(run(t, TIP_RULES.kioskAway + 0.1)).toEqual(['ba_return', null]); // home again: it goes (after the grace)
    expect(t.isSeen('ba_return')).toBe(true);
    run(t, TIP_RULES.gap + 0.1);
    // they carry ours off: we only capture with our own ball home
    expect(run(t, 3, { ba: { ...HOME, own: 'taken' } })).toEqual(['ba_home']);
    run(t, TIP_RULES.duration.ba_home + TIP_RULES.gap, { ba: { ...HOME, own: 'taken' } });
    expect(t.isSeen('ba_home')).toBe(true);
    // a teammate carries theirs: escort (it is slower, can't glide or ride)
    expect(run(t, 3, { ba: { ...HOME, enemy: 'taken', teamCarrying: true } })).toEqual(['ba_carry']);
    run(t, 20, { ba: { ...HOME, enemy: 'taken', teamCarrying: true } });
    // every one seen: never again, whatever happens
    expect(t.baFinished).toBe(true);
    for (const ba of [{ ...HOME, own: 'dropped' as const }, { ...HOME, own: 'taken' as const }, { ...HOME, enemy: 'taken' as const, teamCarrying: true }])
      expect(run(t, 10, { ba })).toEqual([null]);
  });

  it('a situational tip cut short before 2 s comes back the next time', () => {
    const { t } = veteran();
    run(t, 20);
    expect(run(t, 0.5, { ba: { ...HOME, own: 'dropped' } })).toEqual(['ba_return']);
    run(t, TIP_RULES.kioskAway + TIP_RULES.gap + 0.5); // returned at once: gone before it counted as seen
    expect(t.isSeen('ba_return')).toBe(false);
    expect(run(t, 1, { ba: { ...HOME, own: 'dropped' } })).toEqual(['ba_return']);
  });

  it('the goal tip is skipped if you already carried a ball (even while the carrier cue paused the tips)', () => {
    const { t } = veteran();
    run(t, 1);
    run(t, 5, { active: false, ba: { ...HOME, enemy: 'taken', localCarrying: true } }); // the carrier cue holds the slot
    expect(run(t, 10)).toEqual([null]);
    expect(t.isSeen('ba_goal')).toBe(true);
  });

  it('only the first Base Assault match (≥ 10 s of play) teaches; a shorter one does not count', () => {
    const { kv, t } = veteran();
    run(t, 3); // joined for 3 s, the match ended
    t.update(1 / 60, { ...BA, phase: 'ended' });
    expect(t.baFinished).toBe(false);
    run(t, 12, { phase: 'live' });
    t.update(1 / 60, { ...BA, phase: 'ended' });
    expect(t.baFinished).toBe(true);
    expect(run(t, 60, { phase: 'live', ba: { ...HOME, own: 'dropped' } })).toEqual([null]);
    expect(new TipScheduler(kv).baFinished).toBe(true); // across sessions
    expect(JSON.parse(kv.map.get(TIPS_BA_KEY)!)).toMatchObject({ v: 1, done: true });
    expect(JSON.parse(kv.map.get(TIPS_KEY)!)).toEqual({ v: 1, seen: ['basics', 'kiosk', 'moves'], done: true }); // untouched
  });

  it('a first-ever match in Base Assault: basics first, then the mode, then the kiosk', () => {
    const t = new TipScheduler(new MemKV());
    const ids = [...run(t, 25), ...run(t, 15, { nearKiosk: true })];
    expect(ids.filter((x) => x)).toEqual(['basics', 'ba_goal', 'kiosk']);
  });

  it('Show again resets both; the first-match record keeps its exact shape; bad storage never breaks it', () => {
    const { kv, t } = veteran();
    run(t, 20);
    t.reset();
    expect(JSON.parse(kv.map.get(TIPS_KEY)!)).toEqual({ v: 1, seen: [], done: false });
    expect(JSON.parse(kv.map.get(TIPS_BA_KEY)!)).toEqual({ v: 1, seen: [], done: false });
    const bad: KV = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const b = new TipScheduler(bad);
    b.update(1 / 60, { ...BA, ba: HOME });
    expect(run(b, 3).filter((x) => x)).toEqual(['basics']);
    const junk = new MemKV();
    junk.setItem(TIPS_BA_KEY, JSON.stringify({ seen: ['ba_goal', 'basics', 'bogus'], done: 'yes' }));
    const j = new TipScheduler(junk);
    expect(j.isSeen('ba_goal')).toBe(true);
    expect(j.isSeen('basics')).toBe(false); // a general id in the BA record is ignored
    expect(j.baFinished).toBe(false);
  });

  it('every Base Assault tip has text and a duration', () => {
    for (const id of BA_TIP_IDS) {
      expect(TIP_TEXT[id].length, id).toBeGreaterThan(20);
      expect(TIP_RULES.duration[id], id).toBeGreaterThanOrEqual(TIP_RULES.minSeen + 3);
    }
  });
});

// W10 U3: match awards from a recorded event stream (+ the roster and the MatchState the client receives), per PvP
// mode. Pins: which awards a match earns and who wins them, ties (shared ≤ 3, wider ties dropped, BEST IN SHOW broken
// like the scoreboard), empty categories (skipped; nothing earned → no card), the local player's award, determinism
// (the same stream twice, or with unrelated events interleaved, gives the same card), a stream joined mid-match (no
// FIRST BITE, no derived returns), and the roster credits the returns / pads arithmetic relies on.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { AWARD_IDS, AWARD_RULES, AwardsTally, MODE_AWARDS, awardCardHtml, pickAwards, type MatchAwards, type PlayerTally } from '../../src/client/ui/awards';
import { AWARD_GLYPHS } from '../../src/client/ui/icons';
import { AWARD_STRINGS } from '../../src/client/ui/strings';
import { BA_PICKUP_ITEM, BA_REASON, CORE_RUSH } from '../../src/shared/content/modes';
import { PICKUPS } from '../../src/shared/content/pickups';
import { ordnanceWire } from '../../src/shared/content/ordnance';
import { weaponIndex } from '../../src/shared/content/weapons';
import type { GameEvent, MatchPhase, MatchState, RosterEntry } from '../../src/shared/protocol';

// ------------------------------------------------------------------------------------------------ a recorded stream

type Item = { t: number; ev: GameEvent } | { t: number; match: MatchState } | { t: number; roster: RosterEntry[] };
const RIFLE = weaponIndex('squeaker_rifle');
const GRENADE = ordnanceWire('squeaker_grenade'), HAIRBALL = ordnanceWire('hairball_bomb');
const NAMES: Record<number, string> = { 1: 'Rex', 2: 'Pup 2', 3: 'Pup 3', 4: 'Pup 4', 11: 'Cat 11', 12: 'Cat 12', 13: 'Cat 13', 14: 'Cat 14' };
const LOCAL = 1;

/** Records what a client receives: game events, MatchStates, rosters, on a clock (seconds). */
class Rec {
  items: Item[] = [];
  t = 0;
  score: [number, number] = [0, 0];
  constructor(readonly mode: string) {}
  at(t: number): this { this.t = t; return this; }
  frame(phase: MatchPhase, winner: -1 | 0 | 1 = -1): this {
    this.items.push({ t: this.t, match: { mode: this.mode, phase, timeLeft: 60, score: [this.score[0], this.score[1]], objective: '', wave: 0, winner } });
    return this;
  }
  ev(...evs: GameEvent[]): this { for (const ev of evs) this.items.push({ t: this.t, ev }); return this; }
  kill(by: number, id: number, wpn?: number): this { return this.ev(wpn === undefined ? { e: 'death', id, by } : { e: 'death', id, by, wpn }); }
  roster(r: RosterEntry[]): this { this.items.push({ t: this.t, roster: r }); return this; }
  // Base Assault, as the authority emits it (base-assault.ts): pickup first, then the score reason
  grab(id: number, thieves: 0 | 1): this { return this.ev({ e: 'pickup', id, item: BA_PICKUP_ITEM }, { e: 'score', team: thieves, pts: 0, reason: BA_REASON.taken }); }
  drop(ballTeam: 0 | 1): this { return this.ev({ e: 'score', team: ballTeam, pts: 0, reason: BA_REASON.dropped }); }
  ret(ballTeam: 0 | 1): this { return this.ev({ e: 'score', team: ballTeam, pts: 0, reason: BA_REASON.returned }); }
  capture(team: 0 | 1): this { this.score[team]++; return this.ev({ e: 'score', team, pts: 1, reason: BA_REASON.captured }); }
  /** The authority's roster: kills / deaths from the recorded deaths (host/room.ts creditDeath: +100 a knockout),
   *  plus the objective credits the Room adds (creditRoster). */
  authorityRoster(credits: Record<number, number> = {}, bots = true): RosterEntry[] {
    const kills = new Map<number, number>(), deaths = new Map<number, number>();
    for (const it of this.items) if ('ev' in it && it.ev.e === 'death') {
      deaths.set(it.ev.id, (deaths.get(it.ev.id) ?? 0) + 1);
      if (it.ev.by >= 0 && it.ev.by !== it.ev.id) kills.set(it.ev.by, (kills.get(it.ev.by) ?? 0) + 1);
    }
    return Object.keys(NAMES).map(Number).map((entity) => ({
      pid: `p${entity}`, name: NAMES[entity], team: entity < 10 ? 0 : 1, cls: 'assault', entity, bot: bots && entity !== LOCAL,
      kills: kills.get(entity) ?? 0, deaths: deaths.get(entity) ?? 0,
      score: 100 * (kills.get(entity) ?? 0) + (credits[entity] ?? 0), ping: 0,
    } as RosterEntry));
  }
}

/** Plays a recorded stream into a fresh tally; returns every result it produced. */
function play(items: readonly Item[], localId = LOCAL): MatchAwards[] {
  const tally = new AwardsTally();
  let roster: RosterEntry[] = [];
  const out: MatchAwards[] = [];
  for (const it of items) {
    if ('ev' in it) tally.onEvent(it.ev, it.t);
    else if ('roster' in it) roster = it.roster;
    else {
      const r = tally.update({ match: it.match, roster, localId, now: it.t });
      if (r) out.push(r);
    }
  }
  return out;
}

/** End the recording: the final roster, the ended frame, and frames through the settle time. */
function finish(r: Rec, t: number, winner: -1 | 0 | 1, credits: Record<number, number> = {}): Item[] {
  r.at(t).roster(r.authorityRoster(credits)).frame('ended', winner).at(t + 0.3).frame('ended', winner).at(t + AWARD_RULES.settle + 0.1).frame('ended', winner);
  return r.items;
}

const ids = (m: MatchAwards) => m.awards.map((a) => a.id);
const who = (m: MatchAwards) => Object.fromEntries(m.awards.map((a) => [a.id, a.winners.map((w) => w.entity)]));

// ------------------------------------------------------------------------------------------------ per mode

/** A Base Assault match: steals, a stopped carrier, a touch return, a pick-up of a dropped ball, captures, a hairball. */
function baseAssaultMatch(): Item[] {
  const r = new Rec('base-assault');
  r.roster(r.authorityRoster()).at(0).frame('warmup').at(5).frame('live');
  r.at(10).grab(11, 1);                        // Cat 11 steals the corgi ball from its stand
  r.at(18).kill(2, 11, RIFLE).drop(0);         // Pup 2 stops the carrier (the first knockout); the ball drops
  r.at(21).ret(0);                             // Pup 3 touches it home (roster +3; no event names the returner)
  r.at(25).grab(1, 0);                         // Rex steals the cat ball
  r.at(40).kill(1, 13, RIFLE);
  r.at(55).capture(0).frame('live');           // Rex captures: a 30 s carry
  r.at(60).grab(12, 1);                        // Cat 12 steals
  r.at(70).kill(2, 12, RIFLE).drop(0);         // Pup 2 stops a second carrier
  r.at(72).grab(13, 1);                        // Cat 13 picks the dropped ball up (a grab, not a steal)
  r.at(80).kill(14, 2, HAIRBALL);              // a hairball knockout while the cats trail 0–1
  r.at(90).capture(1).frame('live');           // Cat 13 captures
  r.at(100).ev(...[0, 1, 2, 3, 4].map((): GameEvent => ({ e: 'hit', src: 1, dst: 11, dmg: 30, x: 0, y: 0, z: 0, crit: true })));
  r.at(110).kill(4, 11, RIFLE).kill(4, 14, RIFLE).kill(4, 12, RIFLE); // Pup 4: three in one life
  r.at(120).grab(3, 0);                        // Pup 3 steals
  r.at(125).kill(11, 3, RIFLE).drop(1);        // Cat 11 stops him
  r.at(127).ret(1);                            // Cat 12 touches it home (roster +3)
  r.at(150).grab(1, 0);                        // Rex steals again
  r.at(170).capture(0).frame('live');          // and captures (a 20 s carry)
  // roster objective credits (base-assault.ts ROSTER: capture 10, steal 2 per grab, return 3)
  return finish(r, 200, 0, { 1: 2 * 10 + 2 * 2, 3: 2 + 3, 11: 2, 12: 2 + 3, 13: 10 + 2 });
}

describe('W10 U3 awards: Base Assault', () => {
  it('the objective awards go to the thief, the defender, the lobber; BEST IN SHOW first; the local award flagged', () => {
    const [m, ...more] = play(baseAssaultMatch());
    expect(more).toEqual([]); // one result per match
    expect(m.mode).toBe('base-assault');
    expect(m.complete).toBe(true);
    // Pup 4 tops the roster (300); Rex's 2 captures; Pup 2's 2 stops; Cat 14's hairball. Every other earned category
    // (STICKY PAWS, MARATHON, BULLSEYE → Rex; ON A ROLL, HEAVY PAWS → Pup 4; FIRST BITE → Pup 2) goes to a player who
    // already has one, and the card has its 3: they stay off.
    expect(ids(m)).toEqual(['best_in_show', 'special_delivery', 'guard_dog', 'lob_star']);
    expect(who(m)).toEqual({ best_in_show: [4], special_delivery: [1], guard_dog: [2], lob_star: [14] });
    const by = Object.fromEntries(m.awards.map((a) => [a.id, a]));
    expect(by.special_delivery).toMatchObject({ name: 'SPECIAL DELIVERY', value: 2, stat: '2 captures', local: true });
    expect(by.special_delivery.winners[0]).toEqual({ entity: 1, name: 'Rex', team: 0, bot: false, local: true });
    expect(by.guard_dog).toMatchObject({ value: 2, stat: '2 carriers stopped', local: false });
    expect(by.lob_star).toMatchObject({ value: 1, species: 'cat', stat: '1 hairball knockout' });
    expect(by.best_in_show).toMatchObject({ value: 300, stat: 'top score · 300' });
    expect(m.awards.filter((a) => a.local).map((a) => a.id)).toEqual(['special_delivery']);
  });

  it('counts from events: steals vs pick-ups, carry times, carrier stops; returns from the roster remainder', () => {
    const items = baseAssaultMatch();
    const tally = new AwardsTally();
    let roster: RosterEntry[] = [];
    for (const it of items) {
      if ('ev' in it) tally.onEvent(it.ev, it.t);
      else if ('roster' in it) roster = it.roster;
      else tally.update({ match: it.match, roster, localId: LOCAL, now: it.t });
    }
    expect(tally.statsOf(1)).toMatchObject({ grabs: 2, steals: 2, captures: 2, longestCarry: 30, crits: 5 });
    expect(tally.statsOf(13)).toMatchObject({ grabs: 1, steals: 0, captures: 1, longestCarry: 18 });
    expect(tally.statsOf(2)).toMatchObject({ kills: 2, stops: 2, firstKill: true });
    expect(tally.statsOf(11)).toMatchObject({ stops: 1, grabs: 1, steals: 1, longestCarry: 8 });
    expect(tally.statsOf(14)).toMatchObject({ throwKills: 1, throwSpecies: 'cat', behindKills: 1 });
    expect(tally.statsOf(4)).toMatchObject({ bestStreak: 3 });
    // GUARD DOG = carrier stops + returns. Pup 3 has 1 return (roster 5 = a grab's 2 + a return's 3); one more return
    // credited (+3) ties him with Pup 2's 2 stops; two more make him the sole winner; a remainder that isn't a whole
    // number of returns (+7) is never guessed.
    const stats = (e: number) => tally.statsOf(e);
    const credits = (r: RosterEntry[], e: number, pts: number) => r.map((p) => (p.entity === e ? { ...p, score: p.score + pts } : p));
    const extra = pickAwards('base-assault', credits(roster, 3, AWARD_RULES.baRoster.return), stats, LOCAL, true);
    const gd = extra.find((a) => a.id === 'guard_dog')!;
    expect(gd.winners.map((w) => w.entity)).toEqual([2, 3]); // a tie: 2 stops vs 2 returns
    expect(gd.stat).toBe('2 carriers stopped'); // (the first winner's split)
    const p3 = pickAwards('base-assault', credits(credits(roster, 3, 3), 3, 3), stats, LOCAL, true).find((a) => a.id === 'guard_dog')!;
    expect(p3.winners.map((w) => w.entity)).toEqual([3]);
    expect(p3.stat).toBe('3 returns');
    // a remainder that isn't a whole number of returns is never guessed
    expect(pickAwards('base-assault', credits(roster, 3, 7), stats, LOCAL, true).find((a) => a.id === 'guard_dog')!.winners.map((w) => w.entity)).toEqual([2]);
  });

  it('joined mid-match: no FIRST BITE, no derived returns (the stream does not cover the start)', () => {
    const items = baseAssaultMatch().filter((it) => it.t >= 30); // the first frame the tally sees is live
    const [m] = play(items);
    expect(m.complete).toBe(false);
    const tally = new AwardsTally();
    let roster: RosterEntry[] = [];
    for (const it of items) { if ('ev' in it) tally.onEvent(it.ev, it.t); else if ('roster' in it) roster = it.roster; else tally.update({ match: it.match, roster, localId: LOCAL, now: it.t }); }
    const all = pickAwards('base-assault', roster, (e) => tally.statsOf(e), LOCAL, false);
    expect(all.find((a) => a.id === 'first_bite')).toBeUndefined();
    // Pup 3 has 5 roster points of objective credit (a steal + a return) but only one grab seen: never a return guessed
    expect(tally.statsOf(3)).toMatchObject({ grabs: 1 });
  });
});

describe('W10 U3 awards: Core Rush', () => {
  it('PAD PATROL from the roster credit (captureBonus × 2 a pad), the fights from events', () => {
    const r = new Rec('core-rush');
    r.roster(r.authorityRoster()).at(0).frame('warmup').at(5).frame('live');
    r.at(8).ev({ e: 'score', team: 0, pts: CORE_RUSH.captureBonus, reason: 'took pad A' });
    r.at(9).ev({ e: 'pickup', id: 3, item: 'squeaky_clean' }); // an Upgrade Core: roster points, not a pad
    r.at(12).kill(12, 2, RIFLE).kill(12, 3, RIFLE).kill(12, 4, RIFLE); // Cat 12 on a roll (first knockout)
    r.at(20).kill(1, 12, GRENADE);                                    // Rex's grenade ends it
    r.at(30).ev({ e: 'score', team: 1, pts: CORE_RUSH.captureBonus, reason: 'took pad B' });
    r.at(40).kill(2, 13, RIFLE).kill(2, 14, RIFLE);
    const pad = CORE_RUSH.captureBonus * 2;
    const items = finish(r, 250, 1, { 3: 4 * pad + PICKUPS.squeaky_clean.score, 11: 2 * pad, 1: pad });
    const [m] = play(items);
    // Cat 12 tops the roster (300); Pup 3 took 4 pads; Rex's grenade (LOB STAR) is his; FIRST BITE and ON A ROLL are
    // Cat 12's, HEAVY PAWS (3) too: no new winner → off.
    expect(ids(m)).toEqual(['best_in_show', 'pad_patrol', 'lob_star']);
    expect(who(m)).toEqual({ best_in_show: [12], pad_patrol: [3], lob_star: [1] });
    expect(m.awards[1]).toMatchObject({ value: 4, stat: 'took 4 pads' });
    expect(m.awards[2]).toMatchObject({ species: 'corgi', stat: '1 grenade knockout', local: true });
  });
});

/** A Deathmatch comeback: the cats go 5 up (each knockout's frame carries its point), then Rex and Pup 2 answer. */
function tdmRec(): Rec {
  const r = new Rec('team-deathmatch');
  r.roster(r.authorityRoster()).at(0).frame('warmup').at(5).frame('live');
  let t = 10;
  for (const [by, id] of [[11, 1], [12, 2], [11, 3], [13, 4], [14, 3]] as const) { r.at(t++).kill(by, id, RIFLE); r.score[1]++; r.frame('live'); }
  // Rex and Pup 2 answer while behind: 3 each, in one life each
  for (const [by, id] of [[1, 11], [2, 12], [1, 13], [2, 14], [1, 12], [2, 11]] as const) { r.at(t++).kill(by, id, RIFLE); r.score[0]++; r.frame('live'); }
  // Pup 4 soaks a wall of damage and keeps going
  r.at(40).ev(...Array.from({ length: 9 }, (): GameEvent => ({ e: 'hit', src: 13, dst: 4, dmg: 55, x: 0, y: 0, z: 0, crit: false })));
  return r;
}
const tdmComeback = (): Item[] => finish(tdmRec(), 60, -1);

describe('W10 U3 awards: Team Deathmatch', () => {
  it('a comeback: UNDERDOG for knockouts while behind, streaks, a shared tie, CHEW TOY for the soak', () => {
    const r = tdmRec();
    const items = finish(r, 60, -1);
    const [m] = play(items);
    // BEST IN SHOW: Rex and Pup 2 tie on score (300), knockouts (3) and knockouts taken (1) → shared. HEAVY PAWS and
    // ON A ROLL are the same pair, UNDERDOG is Rex's (3 while behind; Pup 2's third came at 5–5): no new winner, off.
    // FIRST BITE: Cat 11. CHEW TOY: Pup 4 (9 × 55).
    expect(ids(m)).toEqual(['best_in_show', 'chew_toy', 'first_bite']);
    expect(who(m)).toEqual({ best_in_show: [1, 2], chew_toy: [4], first_bite: [11] });
    expect(m.awards[0].local).toBe(true);
    expect(m.awards[0].winners.map((w) => w.name)).toEqual(['Rex', 'Pup 2']);
    expect(m.awards[1].stat).toBe('soaked 495 damage');
    const tally = new AwardsTally();
    let roster: RosterEntry[] = [];
    for (const it of items) { if ('ev' in it) tally.onEvent(it.ev, it.t); else if ('roster' in it) roster = it.roster; else tally.update({ match: it.match, roster, localId: LOCAL, now: it.t }); }
    expect(tally.statsOf(1)).toMatchObject({ kills: 3, behindKills: 3, bestStreak: 3 });
    expect(tally.statsOf(2)).toMatchObject({ kills: 3, behindKills: 2, bestStreak: 3 });
    // a roster alone (no events) still names BEST IN SHOW and HEAVY PAWS: the authoritative columns
    expect(pickAwards('team-deathmatch', r.authorityRoster(), () => undefined, LOCAL, true).map((a) => a.id)).toEqual(['best_in_show', 'heavy_paws']);
  });
});

describe('W10 U3 awards: Skirmish (co-op against the waves)', () => {
  it('only the squad is eligible (wave cats are not on the roster); no UNDERDOG in co-op', () => {
    const r = new Rec('yard-skirmish');
    const squad = (): RosterEntry[] => r.authorityRoster().filter((p) => p.team === 0);
    r.roster(squad()).at(0).frame('warmup').at(5).frame('live');
    for (let i = 0; i < 6; i++) r.at(10 + i).kill(3, 100 + i, RIFLE); // Pup 3 mows a wave down
    r.at(20).kill(100, 3).kill(1, 106, GRENADE).kill(1, 107, GRENADE); // a wave cat gets Pup 3; Rex lobs two
    r.at(30).ev(...Array.from({ length: 6 }, (_, i): GameEvent => ({ e: 'hit', src: 2, dst: 110 + i, dmg: 25, x: 0, y: 0, z: 0, crit: true })));
    r.at(60).roster(squad()).frame('ended', 0).at(60.7).frame('ended', 0);
    const [m] = play(r.items);
    expect(ids(m)).toEqual(['best_in_show', 'lob_star', 'bullseye']);
    expect(who(m)).toEqual({ best_in_show: [3], lob_star: [1], bullseye: [2] });
    expect(m.awards.every((a) => a.winners.every((w) => w.team === 0))).toBe(true);
    expect(MODE_AWARDS['yard-skirmish']).not.toContain('underdog');
  });
});

// ------------------------------------------------------------------------------------------------ rules

const P = (entity: number, team: 0 | 1, kills = 0, deaths = 0, score = 100 * kills): RosterEntry =>
  ({ pid: `p${entity}`, name: NAMES[entity] ?? `P${entity}`, team, cls: 'assault', entity, bot: entity !== LOCAL, kills, deaths, score, ping: 0 } as RosterEntry);
const T = (o: Partial<PlayerTally>): PlayerTally => ({
  kills: 0, deaths: 0, throwKills: 0, throwSpecies: null, crits: 0, dmgTaken: 0, streak: 0, bestStreak: 0, behindKills: 0,
  grabs: 0, steals: 0, captures: 0, stops: 0, longestCarry: 0, firstKill: false, pickupPts: 0, ...o,
});

describe('W10 U3 awards: ties and empty categories', () => {
  const roster = [P(1, 0, 2, 1), P(2, 0, 2, 1), P(3, 0), P(4, 0), P(11, 1, 1), P(12, 1), P(13, 1), P(14, 1)];

  it('a tie at the top is shared (≤ 3, sorted by entity); a wider tie is no achievement and is dropped', () => {
    const two = pickAwards('base-assault', roster, (e) => (e === 3 || e === 12 ? T({ captures: 2 }) : undefined), LOCAL, true);
    const sd = two.find((a) => a.id === 'special_delivery')!;
    expect(sd.winners.map((w) => w.entity)).toEqual([3, 12]);
    expect(sd.winners.map((w) => w.team)).toEqual([0, 1]);
    const four = pickAwards('base-assault', roster, (e) => ([2, 3, 12, 13].includes(e) ? T({ captures: 1 }) : undefined), LOCAL, true);
    expect(four.find((a) => a.id === 'special_delivery')).toBeUndefined();
    const three = pickAwards('base-assault', roster, (e) => ([3, 12, 13].includes(e) ? T({ captures: 1 }) : undefined), LOCAL, true);
    expect(three.find((a) => a.id === 'special_delivery')!.winners).toHaveLength(AWARD_RULES.maxShared);
  });

  it('BEST IN SHOW breaks a score tie like the scoreboard (knockouts, then fewest knockouts taken); an exact tie shares', () => {
    const byKills = pickAwards('team-deathmatch', [P(1, 0, 2, 3, 300), P(2, 0, 3, 3, 300), P(11, 1)], () => undefined, LOCAL, true);
    expect(byKills[0].winners.map((w) => w.entity)).toEqual([2]);
    const byDeaths = pickAwards('team-deathmatch', [P(1, 0, 3, 1, 300), P(2, 0, 3, 2, 300)], () => undefined, LOCAL, true);
    expect(byDeaths[0].winners.map((w) => w.entity)).toEqual([1]);
    const exact = pickAwards('team-deathmatch', [P(1, 0, 3, 1, 300), P(11, 1, 3, 1, 300)], () => undefined, LOCAL, true);
    expect(exact[0].winners.map((w) => w.entity)).toEqual([1, 11]);
  });

  it('empty categories are skipped; a match where nothing was earned gives no awards (the card stays hidden)', () => {
    expect(pickAwards('team-deathmatch', [P(1, 0), P(11, 1)], () => undefined, LOCAL, true)).toEqual([]);
    expect(pickAwards('team-deathmatch', [], () => undefined, LOCAL, true)).toEqual([]);
    expect(pickAwards('adventure', roster, () => T({ kills: 9 }), LOCAL, true)).toEqual([]); // not a PvP mode
    // below the minimum = empty: 2 knockouts is not HEAVY PAWS, 4 crits is not BULLSEYE, an 11 s carry is not MARATHON
    const low = pickAwards('base-assault', [P(1, 0, 2), P(11, 1)], () => T({ crits: 4, longestCarry: 11.4 }), LOCAL, true);
    expect(low.map((a) => a.id)).toEqual(['best_in_show']);
    // an ended match with no live phase seen (joined during the result) reports nothing
    const r = new Rec('team-deathmatch');
    expect(play(r.roster(r.authorityRoster()).at(0).frame('ended', 0).at(2).frame('ended', 0).items)).toEqual([]);
  });

  it('the card holds 3 to 5, spreads winners first, and always carries the local player\'s own earned award', () => {
    const many = [P(1, 0, 1), P(2, 0, 9), P(3, 0), P(4, 0), P(11, 1), P(12, 1), P(13, 1), P(14, 1)];
    const st: Record<number, Partial<PlayerTally>> = {
      2: { captures: 3 }, 3: { stops: 4 }, 4: { steals: 5 }, 11: { longestCarry: 40 }, 12: { throwKills: 2, throwSpecies: 'cat' },
      13: { bestStreak: 6 }, 1: { crits: 9 }, // Rex's BULLSEYE is the lowest priority of the lot
    };
    const out = pickAwards('base-assault', many, (e) => T(st[e] ?? {}), LOCAL, true);
    expect(out).toHaveLength(AWARD_RULES.max);
    // BEST IN SHOW (Pup 2; his SPECIAL DELIVERY is skipped: no new winner), GUARD DOG, STICKY PAWS, MARATHON, LOB STAR
    // fill the card; Rex's BULLSEYE (the lowest priority) replaces the last pick, LOB STAR, so the local player sees his
    expect(out.map((a) => a.id)).toEqual(['best_in_show', 'guard_dog', 'sticky_paws', 'marathon', 'bullseye']);
    expect(out.at(-1)!.local).toBe(true);
    // with Rex not earning anything, the full card stands
    const noRex = pickAwards('base-assault', many, (e) => (e === 1 ? T({}) : T(st[e] ?? {})), LOCAL, true);
    expect(noRex.map((a) => a.id)).toEqual(['best_in_show', 'guard_dog', 'sticky_paws', 'marathon', 'lob_star']);
    // few distinct winners: the card fills to 3 with second awards
    const solo = pickAwards('team-deathmatch', [P(1, 0, 5), P(11, 1)], (e) => (e === 1 ? T({ bestStreak: 5, crits: 6 }) : T({})), LOCAL, true);
    expect(solo.map((a) => a.id)).toEqual(['best_in_show', 'heavy_paws', 'on_a_roll']);
  });
});

describe('W10 U3 awards: determinism', () => {
  it('the same stream twice gives the same card; unrelated events interleaved change nothing', () => {
    const items = baseAssaultMatch();
    const a = play(items), b = play(items);
    expect(b).toEqual(a);
    const noisy: Item[] = [];
    for (const it of items) {
      noisy.push(it);
      noisy.push({ t: it.t, ev: { e: 'fire', id: 2, wpn: RIFLE, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, hx: 0, hy: 0, hz: 5, hit: -1 } });
      noisy.push({ t: it.t, ev: { e: 'jump', id: 11, double: false } }, { t: it.t, ev: { e: 'spawn', id: 3 } });
      noisy.push({ t: it.t, ev: { e: 'pickup', id: 4, item: 'squeaker_grenade' } }); // a kiosk restock is not a ball
    }
    expect(play(noisy)).toEqual(a);
  });

  it('snapshot order (a MatchState read before its events, as main.ts wires it) gives the same card as frame order', () => {
    // within each instant, move the MatchState ahead of the events it arrived with (NetClient: bus 'match', then 'game')
    const snapshotOrder = (items: readonly Item[]): Item[] => {
      const out: Item[] = [];
      for (let i = 0; i < items.length;) {
        let j = i;
        while (j < items.length && items[j].t === items[i].t) j++;
        const group = items.slice(i, j);
        out.push(...group.filter((x) => !('ev' in x)), ...group.filter((x) => 'ev' in x));
        i = j;
      }
      return out;
    };
    // and a caller that also reads the same MatchState on several frames between snapshots
    const repeated = (items: readonly Item[]): Item[] => items.flatMap((x): Item[] => ('match' in x ? [x, x, x] : [x]));
    const tallyOf = (items: readonly Item[]): AwardsTally => {
      const tally = new AwardsTally();
      let roster: RosterEntry[] = [];
      for (const it of items) { if ('ev' in it) tally.onEvent(it.ev, it.t); else if ('roster' in it) roster = it.roster; else tally.update({ match: it.match, roster, localId: LOCAL, now: it.t }); }
      return tally;
    };
    for (const items of [baseAssaultMatch(), tdmComeback()]) {
      const want = play(items), base = tallyOf(items);
      for (const order of [snapshotOrder(items), repeated(snapshotOrder(items)), repeated(items)]) {
        expect(play(order)).toEqual(want);
        const t = tallyOf(order);
        for (const e of Object.keys(NAMES).map(Number)) expect(t.statsOf(e), `entity ${e}`).toEqual(base.statsOf(e));
      }
    }
    expect(tallyOf(snapshotOrder(tdmComeback())).statsOf(1)).toMatchObject({ behindKills: 3 }); // the 5–4 → 5–5 knockout counts
  });

  it('a restart (score reset, ended → warmup) starts the next match clean: one result per match', () => {
    const one = baseAssaultMatch();
    const last = one[one.length - 1] as { t: number };
    const next = new Rec('base-assault');
    next.at(last.t + 5).ev({ e: 'score', team: 0, pts: 0, reason: 'reset' }, { e: 'score', team: 1, pts: 0, reason: 'reset' }).frame('warmup');
    next.at(last.t + 10).frame('live').at(last.t + 11).kill(12, 1, RIFLE);
    const tail = finish(next, last.t + 40, 1);
    const res = play([...one, ...tail]);
    expect(res).toHaveLength(2);
    // only Cat 12's knockout in the second match: BEST IN SHOW, and the card fills with his FIRST BITE
    expect(res[1].awards.map((a) => a.id)).toEqual(['best_in_show', 'first_bite']);
    expect(res[1].awards.every((a) => a.winners.every((w) => w.entity === 12))).toBe(true);
    expect(res[1].complete).toBe(true);
  });
});

describe('W10 U3 awards: content and wiring pins', () => {
  it('every award has a name, a stat line and a medal glyph; every PvP mode lists only known awards', () => {
    for (const id of AWARD_IDS) {
      expect(AWARD_STRINGS.names[id], id).toBeTruthy();
      expect(typeof (AWARD_STRINGS.stat as Record<string, unknown>)[id], id).toBe('function');
      expect(AWARD_GLYPHS[id], id).toContain('<svg');
      expect(AWARD_RULES.min[id], id).toBeGreaterThan(0);
    }
    for (const mode of ['yard-skirmish', 'team-deathmatch', 'core-rush', 'base-assault']) {
      const list = MODE_AWARDS[mode];
      expect(list.length, mode).toBeGreaterThanOrEqual(AWARD_RULES.fill);
      for (const id of list) expect(AWARD_IDS).toContain(id);
    }
  });

  it('the roster credits the returns / pads arithmetic reads are the authority\'s', () => {
    const ba = readFileSync('src/sim/match/base-assault.ts', 'utf8');
    const m = /const ROSTER = \{ capture: (\d+), steal: (\d+), return: (\d+) \}/.exec(ba);
    expect(m, 'base-assault.ts ROSTER').toBeTruthy();
    expect({ capture: +m![1], steal: +m![2], return: +m![3] }).toEqual(AWARD_RULES.baRoster);
    expect(readFileSync('src/host/room.ts', 'utf8')).toMatch(new RegExp(`p\\.kills\\+\\+; p\\.score \\+= ${AWARD_RULES.killCredit};`));
    expect(readFileSync('src/sim/match/core-rush.ts', 'utf8')).toContain('creditRoster(sim, c.id, cfg.captureBonus * 2, \'capture\')');
  });

  it('the card markup escapes names, flags the local player, marks a tie, and colours by team', () => {
    const html = awardCardHtml({ id: 'special_delivery', name: 'SPECIAL DELIVERY', stat: '2 captures', value: 2, local: true,
      winners: [{ entity: 1, name: 'Rex<b>', team: 0, bot: false, local: true }, { entity: 12, name: 'Tom & Co', team: 1, bot: true, local: false }] }, 0);
    expect(html).toContain('Rex&lt;b&gt;');
    expect(html).toContain('Tom &amp; Co');
    expect(html).toContain('aw-card tx me tie'); // mixed teams → the neutral gold medal; the local card is gold
    expect(html).toContain(`>${AWARD_STRINGS.you}<`);
    expect(html).toContain(`>${AWARD_STRINGS.tie}<`);
    const solo = awardCardHtml({ id: 'lob_star', name: 'LOB STAR', stat: '1 hairball knockout', value: 1, local: false, species: 'cat',
      winners: [{ entity: 14, name: 'Cat 14', team: 1, bot: true, local: false }] }, 3);
    expect(solo).toContain('aw-card t1"');
    expect(solo).toContain('color:#c9344a'); // the winner's own throwable as the medal
    expect(solo).not.toContain(AWARD_STRINGS.you);
  });
});

// OWNER: U3 (ux-3, W10). The match awards: 3 to 5 comic awards at the end of a PvP match, chosen from what happened,
// with the local player's own award highlighted. game-design-psychology: recognition drives the next queue, so the
// awards celebrate varied play (captures, defence, streaks, throws, soaking damage), not only knockouts, and spread
// across players before anyone gets a second one.
//
// Computed on the client from what it already receives, never from sim state:
//   • game events (bus 'game'), stamped with the authority's clock knockouts by weapon, crits, damage, streaks, the
//                                                                    first knockout, Base Assault grabs / steals /
//                                                                    captures / carrier stops / carry times
//   • the roster (authoritative per-player score, kills, deaths)     BEST IN SHOW, HEAVY PAWS, and the credits no event
//                                                                    names: Core Rush pads taken, Base Assault returns
//   • the MatchState each frame                                      the phase, the team score (UNDERDOG)
// Returns and pads: the Room credits the roster per player (room.ts: +100 a knockout; base-assault.ts ROSTER: capture
// 10, steal 2, return 3; core-rush: captureBonus × 2 per pad taken; interact/pickups.ts: a core's or kibble's score,
// with a `pickup` event naming the taker). What remains of a player's score after the knockouts and pickups is their
// objective credit: pads = that / (captureBonus × 2); returns = (that − 10 × captures − 2 × grabs) / 3. Both are claimed
// only when the event stream covers the whole match, returns only when the division is exact (else 0: never guessed).
//
//   const awardsTally = new AwardsTally();                        bus 'game'  → awardsTally.onEvent(ev, serverSec())
//   bus 'match' (every snapshot, before its events) → awardsTally.update({ match, roster, localId, now: serverSec() }),
//   non-null once, just after the end. Per snapshot, not per frame: a slow first frame must not miss the warmup (the
//   stream would read as joined mid-match: no FIRST BITE, no returns, no pads).
// serverSec() = the latest snapshot's tick / tickHz (main.ts): carry times are the authority's, whatever the frame rate
// (a client stamping arrival times at 1 fps saw two carries of 64 and 60 s as one 58 s tie).
//   if (awards) awardsCard.show(awards);                          the card (createAwardsCard) holds the scoreboard
//                                                                 while it is up (HudModel.holdScoreboard)
// Pure model (AwardsTally, pickAwards) tested in tests/unit/ui-awards*.test.ts; the card is thin DOM over it.
import type { GameEvent, MatchPhase, MatchState, RosterEntry } from '../../shared/protocol';
import { ordnanceByWire } from '../../shared/content/ordnance';
import { BA_PICKUP_ITEM, BA_REASON, CORE_RUSH } from '../../shared/content/modes';
import { PICKUPS } from '../../shared/content/pickups';
import { Species } from '../../shared/types';
import { PALETTE } from '../style/style-tokens.js';
import { FONT_BODY, FONT_COMIC, FONT_DISPLAY } from './fonts';
import { awardGlyph, WEAPON_GLYPHS } from './icons';
import { AWARD_STRINGS as S, MODE_NAMES } from './strings';

export const AWARD_IDS = [
  'best_in_show', 'heavy_paws', 'lob_star', 'bullseye', 'on_a_roll', 'underdog', 'chew_toy', 'first_bite',
  'special_delivery', 'sticky_paws', 'guard_dog', 'marathon', 'pad_patrol',
] as const;
export type AwardId = (typeof AWARD_IDS)[number];

/**
 * The awards each mode can give, in priority order after BEST IN SHOW (always first): the mode's own play first, then
 * the fights. Modes not listed (adventure: the chapter card has its paws) give none.
 */
export const MODE_AWARDS: Record<string, readonly AwardId[]> = {
  'base-assault': ['special_delivery', 'guard_dog', 'sticky_paws', 'marathon', 'lob_star', 'on_a_roll', 'heavy_paws', 'underdog', 'bullseye', 'chew_toy', 'first_bite'],
  'core-rush': ['pad_patrol', 'heavy_paws', 'lob_star', 'on_a_roll', 'underdog', 'bullseye', 'chew_toy', 'first_bite'],
  'team-deathmatch': ['heavy_paws', 'on_a_roll', 'lob_star', 'underdog', 'bullseye', 'chew_toy', 'first_bite'],
  // co-op against the waves: no team score to be behind on
  'yard-skirmish': ['heavy_paws', 'on_a_roll', 'lob_star', 'bullseye', 'chew_toy', 'first_bite'],
  'boss-rush': ['heavy_paws', 'on_a_roll', 'lob_star', 'bullseye', 'chew_toy', 'first_bite'],
};

export const AWARD_RULES = {
  /** Awards on the card: at most, and the fill target when enough categories qualify. */
  max: 5,
  fill: 3,
  /** A tie at the top is shared by up to this many winners; a wider tie is no achievement and the award is skipped. */
  maxShared: 3,
  /** The least that earns each award (below it the category is empty). */
  min: {
    best_in_show: 1, heavy_paws: 3, lob_star: 1, bullseye: 5, on_a_roll: 3, underdog: 3, chew_toy: 400, first_bite: 1,
    special_delivery: 1, sticky_paws: 2, guard_dog: 2, marathon: 12, pad_patrol: 2,
  } as Record<AwardId, number>,
  /** Seconds after the end before the awards are final (the last roster credits arrive with or just after it). */
  settle: 0.5,
  /** Roster points per knockout (host/room.ts creditDeath). */
  killCredit: 100,
  /** Base Assault roster credits (sim/match/base-assault.ts ROSTER; a test pins them). */
  baRoster: { capture: 10, steal: 2, return: 3 },
};

// ------------------------------------------------------------------------------------------------ model (pure)

export interface AwardWinner { entity: number; name: string; team: 0 | 1; bot: boolean; local: boolean }

export interface MatchAward {
  id: AwardId;
  name: string;
  /** The stat line under the winner: "3 captures", "carried the ball 41 s". */
  stat: string;
  value: number;
  /** One, or two to three for a tie (sorted by entity id). */
  winners: AwardWinner[];
  /** The local player is among the winners. */
  local: boolean;
  /** LOB STAR: which throwable (the medal and the stat line follow it). */
  species?: 'corgi' | 'cat' | 'mixed';
}

export interface MatchAwards {
  mode: string;
  winner: -1 | 0 | 1;
  score: [number, number];
  awards: MatchAward[];
  /** The event stream covered the whole match (the first knockout and returns are only claimed then). */
  complete: boolean;
}

/** Per-entity counters folded from the event stream. */
export interface PlayerTally {
  kills: number;
  deaths: number;
  throwKills: number;
  throwSpecies: 'corgi' | 'cat' | 'mixed' | null;
  crits: number;
  dmgTaken: number;
  streak: number;
  bestStreak: number;
  behindKills: number;
  grabs: number;
  steals: number;
  captures: number;
  stops: number;
  longestCarry: number;
  firstKill: boolean;
  /** Roster points from pickups (cores, kibble): not objective play. */
  pickupPts: number;
}

const blank = (): PlayerTally => ({
  kills: 0, deaths: 0, throwKills: 0, throwSpecies: null, crits: 0, dmgTaken: 0, streak: 0, bestStreak: 0, behindKills: 0,
  grabs: 0, steals: 0, captures: 0, stops: 0, longestCarry: 0, firstKill: false, pickupPts: 0,
});

type BallTrack = { state: 'home' | 'carried' | 'dropped'; carrier: number; since: number };

export interface AwardsFrame {
  match: MatchState | null;
  roster: readonly RosterEntry[];
  localId: number;
  /** Seconds, the same clock as onEvent's (main.ts: the latest snapshot tick / tickHz). */
  now: number;
  /** Optional: the room's mode when MatchState.mode says less (like MatchTally's). */
  mode?: string;
}

/** Folds a match's events, rosters and match states into its awards. One result per match, just after it ends. */
export class AwardsTally {
  private stats = new Map<number, PlayerTally>();
  private teamOf = new Map<number, 0 | 1>();
  private rosterRef: readonly RosterEntry[] | null = null;
  private mode = '';
  private phase: MatchPhase | null = null;
  private sawStart = false;
  private sawLive = false;
  private anyKill = false;
  private endAt = -1;
  private reported = false;
  /** The team score at the latest MatchState and at the one before it (UNDERDOG: a knockout is judged against the score
   *  before the snapshot that carried it, whether its MatchState was read before or after its events). */
  private scoreNow: { t: number; s: [number, number] } = { t: -Infinity, s: [0, 0] };
  private scorePrev: [number, number] = [0, 0];
  private balls: [BallTrack, BallTrack] = [{ state: 'home', carrier: -1, since: 0 }, { state: 'home', carrier: -1, since: 0 }];
  private pendingGrab: { id: number } | null = null;

  /** Counters so far (tests, labs). */
  statsOf(entity: number): Readonly<PlayerTally> | undefined { return this.stats.get(entity); }

  /** Forget the running match (a restart; a new match). `fromStart`: the stream now covers the new match from its start. */
  reset(fromStart = true): void {
    this.stats.clear();
    this.sawStart = fromStart; this.sawLive = false; this.anyKill = false;
    this.endAt = -1; this.reported = false; this.pendingGrab = null;
    this.scoreNow = { t: -Infinity, s: [0, 0] }; this.scorePrev = [0, 0];
    for (const b of this.balls) { b.state = 'home'; b.carrier = -1; b.since = 0; }
  }

  private st(id: number): PlayerTally {
    let s = this.stats.get(id);
    if (!s) { s = blank(); this.stats.set(id, s); }
    return s;
  }

  private endCarry(ball: 0 | 1, now: number): void {
    const b = this.balls[ball];
    if (b.state === 'carried' && b.carrier >= 0) {
      const s = this.st(b.carrier);
      s.longestCarry = Math.max(s.longestCarry, Math.max(0, now - b.since));
    }
    b.carrier = -1;
  }

  /** Feed every game event (bus 'game') with the authority's clock in seconds (the snapshot that carried it). */
  onEvent(ev: GameEvent, now: number): void {
    if (this.reported) return;
    switch (ev.e) {
      case 'death': {
        const v = this.st(ev.id);
        v.deaths++; v.streak = 0;
        const by = ev.by;
        if (by < 0 || by === ev.id) break;
        const kt = this.teamOf.get(by), vt = this.teamOf.get(ev.id);
        if (kt !== undefined && kt === vt) break; // not a knockout of an enemy
        // a carrier knocked out: the defenders stopped it (the drop event follows in the same tick)
        for (const b of this.balls) if (b.state === 'carried' && b.carrier === ev.id) this.st(by).stops++;
        const k = this.st(by);
        k.kills++; k.streak++; k.bestStreak = Math.max(k.bestStreak, k.streak);
        if (!this.anyKill) { this.anyKill = true; k.firstKill = true; }
        const thrown = ev.wpn !== undefined ? ordnanceByWire(ev.wpn) : null;
        if (thrown) {
          const sp = thrown.species === Species.Cat ? 'cat' : 'corgi';
          k.throwKills++;
          k.throwSpecies = k.throwSpecies === null || k.throwSpecies === sp ? sp : 'mixed';
        }
        const sc = this.scoreNow.t < now ? this.scoreNow.s : this.scorePrev;
        if (kt !== undefined && sc[kt] < sc[1 - kt]) k.behindKills++;
        break;
      }
      case 'hit':
        if (ev.src === ev.dst) break; // your own blast is not the enemy's pressure
        if (ev.crit && ev.src >= 0) this.st(ev.src).crits++;
        this.st(ev.dst).dmgTaken += Math.max(0, ev.dmg);
        break;
      case 'pickup':
        // the authority sends a ball's pickup first, then its 'ball taken' score (which names the thieves' team)
        if (ev.item === BA_PICKUP_ITEM) this.pendingGrab = { id: ev.id };
        else if (ev.id >= 0 && Object.hasOwn(PICKUPS, ev.item)) this.st(ev.id).pickupPts += PICKUPS[ev.item as keyof typeof PICKUPS].score;
        break;
      case 'score': {
        if (ev.reason === 'reset') { this.reset(true); break; }
        if (ev.team !== 0 && ev.team !== 1) break;
        const t = ev.team as 0 | 1, foe = (1 - t) as 0 | 1;
        switch (ev.reason) {
          case BA_REASON.taken: { // team = the thieves: their foe's ball
            const g = this.pendingGrab;
            this.pendingGrab = null;
            if (!g) break;
            const b = this.balls[foe], s = this.st(g.id);
            s.grabs++;
            if (b.state === 'home') s.steals++;
            b.state = 'carried'; b.carrier = g.id; b.since = now;
            break;
          }
          case BA_REASON.dropped: // team = the ball's own
            this.endCarry(t, now);
            this.balls[t].state = 'dropped'; this.balls[t].since = now;
            break;
          case BA_REASON.returned:
            this.endCarry(t, now);
            this.balls[t].state = 'home';
            break;
          case BA_REASON.captured: { // team = the scorers: they carried their foe's ball into their ring
            const b = this.balls[foe];
            if (b.state === 'carried' && b.carrier >= 0) this.st(b.carrier).captures++;
            this.endCarry(foe, now);
            b.state = 'home';
            break;
          }
          default:
            break;
        }
        break;
      }
      default:
        break;
    }
  }

  /** Call on every MatchState (main.ts: bus 'match', once per snapshot; per frame works too). Returns the match's awards
   *  once, `AWARD_RULES.settle` s after it ends; otherwise null. */
  update(f: AwardsFrame): MatchAwards | null {
    const ms = f.match;
    if (f.roster !== this.rosterRef) {
      this.rosterRef = f.roster;
      for (const r of f.roster) if (r.team === 0 || r.team === 1) this.teamOf.set(r.entity, r.team);
    }
    if (!ms) return null;
    if (ms.mode !== this.mode) { this.mode = ms.mode; this.reset(ms.phase === 'warmup'); }
    if (this.phase === 'ended' && ms.phase !== 'ended') this.reset(true); // the next match, from its start
    this.phase = ms.phase;
    if (ms.phase === 'live') {
      this.sawLive = true;
      if (f.now !== this.scoreNow.t) this.scorePrev = this.scoreNow.s;
      this.scoreNow = { t: f.now, s: [ms.score[0], ms.score[1]] };
      return null;
    }
    if (ms.phase !== 'ended' || !this.sawLive || this.reported) return null;
    if (this.endAt < 0) this.endAt = f.now;
    if (f.now - this.endAt < AWARD_RULES.settle) return null;
    this.reported = true;
    // a carry still running at the horn counts up to the end
    for (const t of [0, 1] as const) if (this.balls[t].state === 'carried') this.endCarry(t, this.endAt);
    const mode = f.mode ?? ms.mode;
    return {
      mode, winner: ms.winner === 0 || ms.winner === 1 ? ms.winner : -1, score: [ms.score[0], ms.score[1]],
      awards: pickAwards(mode, f.roster, (e) => this.stats.get(e), f.localId, this.sawStart),
      complete: this.sawStart,
    };
  }
}

interface Candidate { id: AwardId; value: number; winners: AwardWinner[]; species?: 'corgi' | 'cat' | 'mixed'; stat: string }

/**
 * Chooses the card's awards (pure, deterministic): every category of the mode that someone earned (value ≥ its min;
 * a tie at the top shared by ≤ maxShared, BEST IN SHOW's tie first broken by knockouts then fewest knockouts taken,
 * like the scoreboard), then
 *   1. BEST IN SHOW first;
 *   2. in the mode's priority order, awards with at least one winner who has none yet, up to `max`;
 *   3. if fewer than `fill`, the rest in order (a player may win twice);
 *   4. the local player's own: if they earned a category the card left out, it goes on (replacing the last pick when
 *      the card is full; never BEST IN SHOW).
 * Displayed in priority order. Nothing earned → no awards (the card stays hidden).
 */
export function pickAwards(mode: string, roster: readonly RosterEntry[], statsOf: (entity: number) => Readonly<PlayerTally> | undefined, localId: number, complete: boolean): MatchAward[] {
  const order = MODE_AWARDS[mode];
  if (!order) return [];
  const players = roster.filter((r) => r.team === 0 || r.team === 1);
  const winnerOf = (r: RosterEntry): AwardWinner => ({ entity: r.entity, name: r.name, team: r.team as 0 | 1, bot: r.bot, local: r.entity === localId });
  const tallyOf = (r: RosterEntry) => statsOf(r.entity) ?? blank();
  const cands: Candidate[] = [];
  for (const id of ['best_in_show', ...order] as AwardId[]) {
    const c = candidate(id, players, tallyOf, winnerOf, complete);
    if (c) cands.push(c);
  }
  const rank = (id: AwardId) => (id === 'best_in_show' ? -1 : order.indexOf(id));
  const picked: Candidate[] = [];
  const awarded = new Set<number>();
  const take = (c: Candidate) => { picked.push(c); for (const w of c.winners) awarded.add(w.entity); };
  const mvp = cands.find((c) => c.id === 'best_in_show');
  if (mvp) take(mvp);
  for (const c of cands) if (c !== mvp && picked.length < AWARD_RULES.max && c.winners.some((w) => !awarded.has(w.entity))) take(c);
  for (const c of cands) if (picked.length < AWARD_RULES.fill && !picked.includes(c)) take(c);
  if (!picked.some((c) => c.winners.some((w) => w.local))) {
    const mine = cands.find((c) => !picked.includes(c) && c.winners.some((w) => w.local));
    if (mine) {
      if (picked.length >= AWARD_RULES.max) {
        let drop = -1; // the lowest-priority pick that isn't BEST IN SHOW
        for (let i = picked.length - 1; i >= 0 && drop < 0; i--) if (picked[i].id !== 'best_in_show') drop = i;
        if (drop >= 0) picked.splice(drop, 1);
      }
      picked.push(mine);
    }
  }
  picked.sort((a, b) => rank(a.id) - rank(b.id));
  return picked.map((c) => ({
    id: c.id, name: S.names[c.id] ?? c.id, stat: c.stat, value: c.value, winners: c.winners,
    local: c.winners.some((w) => w.local), ...(c.species ? { species: c.species } : {}),
  }));
}

function candidate(id: AwardId, players: RosterEntry[], tallyOf: (r: RosterEntry) => PlayerTally, winnerOf: (r: RosterEntry) => AwardWinner, complete: boolean): Candidate | null {
  // the roster's objective credit: what is left after knockouts and pickups
  const objective = (r: RosterEntry) => r.score - AWARD_RULES.killCredit * r.kills - tallyOf(r).pickupPts;
  const ba = AWARD_RULES.baRoster;
  const returnsOf = (r: RosterEntry) => {
    if (!complete) return 0;
    const t = tallyOf(r), rest = objective(r) - ba.capture * t.captures - ba.steal * t.grabs;
    return rest > 0 && rest % ba.return === 0 ? rest / ba.return : 0;
  };
  const padCredit = CORE_RUSH.captureBonus * 2;
  let value: (r: RosterEntry) => number;
  let tiebreak: ((a: RosterEntry, b: RosterEntry) => number) | null = null;
  switch (id) {
    case 'best_in_show':
      value = (r) => r.score;
      tiebreak = (a, b) => b.kills - a.kills || a.deaths - b.deaths; // the scoreboard's order
      break;
    case 'heavy_paws': value = (r) => r.kills; break;
    case 'lob_star': value = (r) => tallyOf(r).throwKills; break;
    case 'bullseye': value = (r) => tallyOf(r).crits; break;
    case 'on_a_roll': value = (r) => tallyOf(r).bestStreak; break;
    case 'underdog': value = (r) => tallyOf(r).behindKills; break;
    case 'chew_toy': value = (r) => Math.round(tallyOf(r).dmgTaken); break;
    case 'first_bite': value = (r) => (complete && tallyOf(r).firstKill ? 1 : 0); break;
    case 'special_delivery': value = (r) => tallyOf(r).captures; break;
    case 'sticky_paws': value = (r) => tallyOf(r).steals; break;
    case 'guard_dog': value = (r) => tallyOf(r).stops + returnsOf(r); break;
    case 'marathon': value = (r) => Math.round(tallyOf(r).longestCarry); break;
    case 'pad_patrol': value = (r) => (complete ? Math.max(0, Math.floor(objective(r) / padCredit)) : 0); break;
    default: return null;
  }
  let best = -Infinity;
  for (const r of players) best = Math.max(best, value(r));
  if (!(best >= AWARD_RULES.min[id])) return null; // empty category (also: no players)
  let top = players.filter((r) => value(r) === best);
  if (tiebreak && top.length > 1) {
    const tb = tiebreak;
    const lead = [...top].sort(tb)[0];
    top = top.filter((r) => tb(r, lead) === 0);
  }
  if (top.length > AWARD_RULES.maxShared) return null; // everyone did it: no one stands out
  top.sort((a, b) => a.entity - b.entity);
  const winners = top.map(winnerOf);
  let species: Candidate['species'];
  let stat: string;
  switch (id) {
    case 'best_in_show': stat = S.stat.best_in_show(best); break;
    case 'lob_star': {
      const kinds = new Set(top.map((r) => tallyOf(r).throwSpecies));
      species = kinds.size === 1 && !kinds.has('mixed') && !kinds.has(null) ? [...kinds][0]! : 'mixed';
      stat = S.stat.lob_star(best, species);
      break;
    }
    case 'guard_dog': {
      const r = top[0], t = tallyOf(r); // (a tie shares the total; the line shows the first winner's split)
      stat = S.stat.guard_dog(t.stops, returnsOf(r));
      break;
    }
    case 'first_bite': stat = S.stat.first_bite(); break;
    default: stat = (S.stat[id] as (v: number) => string)(best);
  }
  return { id, value: best, winners, stat, ...(species ? { species } : {}) };
}

// ------------------------------------------------------------------------------------------------ the card (DOM)

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const u = (n: number) => `calc(var(--u)*${n})`;
/** The card sits above the tallest reward card (bottom placement, ~200 u) and under the win banner (top 32 %). */
const CSS = `
.cvc-aw{position:absolute;inset:0;pointer-events:none;user-select:none;-webkit-user-select:none;z-index:7;
  --u:max(0.6px,min(calc(100vw / 1280),calc(100vh / 720)));--ink:${hex(PALETTE.ink)};--paper:#f6ecd8;--gold:#ffd04a;
  --corgi:${hex(PALETTE.teamCorgis)};--cat:${hex(PALETTE.teamCats)};color:var(--ink);font-family:${FONT_DISPLAY}}
.cvc-aw.hidden{display:none}
.cvc-aw .aw-panel{position:absolute;left:50%;bottom:${u(214)};transform:translateX(-50%) rotate(-.5deg);max-width:94vw;box-sizing:border-box;
  background:var(--paper);border:${u(4)} solid var(--ink);border-radius:${u(14)};box-shadow:${u(6)} ${u(8)} 0 var(--ink);padding:${u(8)} ${u(14)} ${u(12)};
  animation:cvc-aw-in .4s cubic-bezier(.3,1.6,.5,1) both;transition:opacity .5s}
.cvc-aw .aw-panel.out{opacity:0}
.cvc-aw .aw-head{display:flex;align-items:center;justify-content:space-between;gap:${u(12)};margin:0 ${u(2)} ${u(7)}}
.cvc-aw .aw-title{font-size:${u(22)};letter-spacing:.05em}
.cvc-aw .aw-mode{font:800 ${u(11)}/1 ${FONT_BODY};letter-spacing:.1em;background:var(--ink);color:var(--paper);border-radius:${u(10)};padding:${u(4)} ${u(9)}}
.cvc-aw .aw-row{display:flex;gap:${u(10)};margin:0;padding:0;list-style:none}
.cvc-aw .aw-card{position:relative;width:${u(164)};box-sizing:border-box;display:flex;flex-direction:column;align-items:center;text-align:center;gap:${u(3)};
  background:#fffaf0;border:${u(3)} solid var(--ink);border-radius:${u(12)};box-shadow:${u(3)} ${u(4)} 0 var(--ink);padding:${u(8)} ${u(7)} ${u(9)};
  animation:cvc-aw-pop .45s cubic-bezier(.3,1.8,.45,1) both;animation-delay:calc(var(--i) * .18s + .15s);transform:rotate(var(--r))}
.cvc-aw .aw-card.t0{--team:var(--corgi)} .cvc-aw .aw-card.t1{--team:var(--cat)} .cvc-aw .aw-card.tx{--team:var(--gold)}
.cvc-aw .aw-card.me{background:var(--gold);box-shadow:${u(3)} ${u(4)} 0 var(--ink),0 0 0 ${u(3)} var(--paper),0 0 0 ${u(6)} var(--ink);z-index:1}
.cvc-aw .aw-medal{width:${u(50)};height:${u(50)};border-radius:50%;background:var(--paper);border:${u(4)} solid var(--team);box-shadow:0 0 0 ${u(2.5)} var(--ink);
  display:grid;place-items:center;color:var(--team)}
.cvc-aw .aw-medal svg{display:block;width:${u(36)};height:${u(36)}}
.cvc-aw .aw-name{font-family:${FONT_COMIC};font-size:${u(21)};line-height:1;letter-spacing:.04em;margin-top:${u(3)}}
.cvc-aw .aw-who{max-width:100%;font-size:${u(15)};line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cvc-aw .aw-card.tie .aw-who{font-size:${u(13)};white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere}
.cvc-aw .aw-who .t0{color:var(--corgi)} .cvc-aw .aw-who .t1{color:var(--cat)}
.cvc-aw .aw-card.me .aw-who .t0,.cvc-aw .aw-card.me .aw-who .t1{color:var(--ink)}
.cvc-aw .aw-stat{font:800 ${u(11.5)}/1.2 ${FONT_BODY};opacity:.72}
.cvc-aw .aw-you{position:absolute;right:${u(-9)};top:${u(-11)};font-size:${u(12)};letter-spacing:.08em;background:var(--ink);color:var(--gold);border-radius:${u(6)};padding:${u(2)} ${u(6)};transform:rotate(9deg)}
.cvc-aw .aw-tie{position:absolute;left:${u(-9)};top:${u(-11)};font-size:${u(12)};letter-spacing:.08em;background:var(--paper);color:var(--ink);border:${u(2)} solid var(--ink);border-radius:${u(6)};padding:${u(1)} ${u(6)};transform:rotate(-9deg)}
@keyframes cvc-aw-in{0%{opacity:0;scale:.7}100%{opacity:1;scale:1}}
@keyframes cvc-aw-pop{0%{opacity:0;transform:translateY(${u(18)}) scale(.6) rotate(var(--r))}100%{opacity:1;transform:rotate(var(--r))}}
@media (prefers-reduced-motion: reduce){.cvc-aw *{animation-duration:.01s!important;animation-delay:0s!important}}
`;

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Small tilts so the row reads as stickers, not a table. */
const TILT = [-1.6, 1.1, -0.7, 1.5, -1.2];

/** One award's card markup (pure: labs and tests render it). */
export function awardCardHtml(a: MatchAward, i: number): string {
  const teams = new Set(a.winners.map((w) => w.team));
  const tcls = teams.size === 1 ? `t${[...teams][0]}` : 'tx';
  const glyph = a.id === 'lob_star' && a.species === 'cat' ? WEAPON_GLYPHS.hairball_bomb : a.id === 'lob_star' && a.species === 'corgi' ? WEAPON_GLYPHS.squeaker_grenade : awardGlyph(a.id);
  const names = a.winners.map((w) => `<span class="t${w.team}">${esc(w.name)}</span>`);
  const who = names.length < 2 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} &amp; ${names[names.length - 1]}`;
  const tie = a.winners.length > 1;
  return `<li class="aw-card ${tcls}${a.local ? ' me' : ''}${tie ? ' tie' : ''}" style="--i:${i};--r:${TILT[i % TILT.length]}deg">
      <div class="aw-medal">${glyph}</div>
      <div class="aw-name">${esc(a.name)}</div>
      <div class="aw-who">${who}</div>
      <div class="aw-stat">${esc(a.stat)}</div>
      ${tie ? `<span class="aw-tie">${S.tie}</span>` : ''}${a.local ? `<span class="aw-you">${S.you}</span>` : ''}
    </li>`;
}

export interface AwardsCard {
  readonly el: HTMLElement;
  /** Show a match's awards (none → nothing). Hides by itself after `seconds` (default 5.5). */
  show(a: MatchAwards, seconds?: number): void;
  hide(): void;
  /** Up (or fading in): main.ts passes it as HudModel.holdScoreboard, so the match-end scoreboard opens after it. */
  readonly up: boolean;
  /** Call each frame: the card goes as soon as the next match starts (the phase leaves 'ended'). */
  sync(match: MatchState | null): void;
  dispose(): void;
}

export interface AwardsCardOptions {
  /** A UI sound when the card opens. */
  sound?(): void;
  seconds?: number;
}

/**
 * The awards card. Never interactive (no pointer events, focus or keys), beneath the scoreboard (Tab still shows it
 * on top) and above the bottom reward card, which it never covers. Mount it on the page's UI root (main.ts `ui`).
 */
export function createAwardsCard(parent: HTMLElement, opts: AwardsCardOptions = {}): AwardsCard {
  if (typeof document !== 'undefined' && !document.getElementById('cvc-aw-style')) {
    const s = document.createElement('style');
    s.id = 'cvc-aw-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  const el = document.createElement('div');
  el.className = 'cvc-aw hidden';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  parent.appendChild(el);
  let timer: ReturnType<typeof setTimeout> | null = null, fade: ReturnType<typeof setTimeout> | null = null;
  let up = false;
  const clear = () => { if (timer) clearTimeout(timer); if (fade) clearTimeout(fade); timer = fade = null; };
  const card: AwardsCard = {
    el,
    show(a, seconds = opts.seconds ?? 5.5) {
      clear();
      if (!a.awards.length) { card.hide(); return; }
      el.innerHTML = `<div class="aw-panel">
        <div class="aw-head"><span class="aw-title">${S.title}</span><span class="aw-mode">${esc((MODE_NAMES[a.mode] ?? a.mode).toUpperCase())}</span></div>
        <ol class="aw-row">${a.awards.map(awardCardHtml).join('')}</ol>
      </div>`;
      el.classList.remove('hidden');
      up = true;
      opts.sound?.();
      timer = setTimeout(() => {
        el.querySelector('.aw-panel')?.classList.add('out');
        fade = setTimeout(() => card.hide(), 500);
      }, Math.max(1, seconds) * 1000);
    },
    hide() { clear(); up = false; el.classList.add('hidden'); },
    get up() { return up; },
    sync(match) { if (up && match && match.phase !== 'ended') card.hide(); },
    dispose() { clear(); up = false; el.remove(); },
  };
  return card;
}

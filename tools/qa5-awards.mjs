#!/usr/bin/env node
// Q5 verification probe (read-only): U3's match awards against an independent oracle.
//   npx tsx tools/qa5-awards.mjs script                     a hand-written stream with known answers (ties, a leaver, steals)
//   npx tsx tools/qa5-awards.mjs match [--mode base-assault] [--map west_yard] [--seed 31] [--seconds 240] [--leave 0.7]
// match: a real Room (4 v 4 bots + an idle human "Rex", the local player) plays to the horn; the client's stream goes
// through the Node server's frame path (SnapEncoder → JSON → SnapDecoder) into U3's AwardsTally, exactly as main.ts
// feeds it. The oracle is built separately, inside the authority: raw sim events (before the wire) and, for Base
// Assault, the balls' state read every tick (carriers, steals, carry lengths, stops). At `--leave` of the match three
// humans join the cats, so the Room removes three cat bots mid-match: players who left. The oracle names the winner of
// every category over the final roster (who should win) and over everyone who played (would a leaver have won?).
import { Sim } from '../src/sim/sim';
import { Room } from '../src/host/room';
import { SnapDecoder, SnapEncoder, decodeServerFrame, encodeServerMsg } from '../src/host/wire';
import { baseAssaultBalls } from '../src/sim/match';
import { PROTOCOL_VERSION, TICK_HZ } from '../src/shared/constants';
import { Team } from '../src/shared/types';
import { BA_PICKUP_ITEM, BA_REASON, BallState } from '../src/shared/content/modes';
import { ORDNANCE_RULES } from '../src/shared/content/ordnance';

import { register } from 'node:module';
// the client's UI modules import font files (Vite handles them in the game): load them as empty strings here
register('data:text/javascript,' + encodeURIComponent('export async function load(u, c, n) { return /\\.(woff2?|png|svg|css)(\\?|$)/.test(u) ? { format: "module", source: "export default \'\'", shortCircuit: true } : n(u, c); }'), import.meta.url);
const { AwardsTally, AWARD_RULES, MODE_AWARDS } = await import('../src/client/ui/awards');

const argv = process.argv.slice(2);
const scenario = argv[0] ?? 'match';
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const out = (o) => console.log(JSON.stringify(o));
const MIN = AWARD_RULES.min;

/** The oracle's winners for one category: top value (≥ min), ties ≤ maxShared, BEST IN SHOW's scoreboard tiebreak. */
function oracleWinner(id, players, value) {
  let best = -Infinity;
  for (const p of players) best = Math.max(best, value(p));
  if (!(best >= MIN[id])) return null;
  let top = players.filter((p) => value(p) === best);
  if (id === 'best_in_show' && top.length > 1) {
    const tb = (a, b) => b.kills - a.kills || a.deaths - b.deaths;
    const lead = [...top].sort(tb)[0];
    top = top.filter((p) => tb(p, lead) === 0);
  }
  if (top.length > AWARD_RULES.maxShared) return { value: best, winners: [], dropped: `tie of ${top.length}` };
  return { value: best, winners: top.map((p) => p.entity).sort((a, b) => a - b) };
}

// ------------------------------------------------------------------------------------------------ scripted stream
if (scenario === 'script') {
  // Base Assault, 5 corgis (1-5) v 5 cats (11-15); 5 and 15 leave before the end (not on the final roster).
  const R = (entity, team, score, kills, deaths) => ({ pid: `p${entity}`, name: `P${entity}`, team, cls: 'assault', entity, bot: entity !== 1, kills, deaths, score, ping: 0 });
  const ms = (phase, score, winner = -1) => ({ mode: 'base-assault', phase, timeLeft: 0, score, objective: '', wave: 0, winner });
  const tally = new AwardsTally();
  const rosterStart = [1, 2, 3, 4, 5].map((e) => R(e, 0, 0, 0, 0)).concat([11, 12, 13, 14, 15].map((e) => R(e, 1, 0, 0, 0)));
  let t = 0;
  const feed = (m, evs = [], roster = rosterStart) => { tally.update({ match: m, roster, localId: 1, now: t }); for (const e of evs) tally.onEvent(e, t); t += 0.05; };
  feed(ms('warmup', [0, 0]));
  feed(ms('live', [0, 0]));
  const hit = (src, dst, dmg, crit = false) => ({ e: 'hit', src, dst, dmg, x: 0, y: 0, z: 0, crit });
  const death = (id, by, wpn) => ({ e: 'death', id, by, ...(wpn !== undefined ? { wpn } : {}) });
  const grab = (id, thievesTeam) => [{ e: 'pickup', id, item: BA_PICKUP_ITEM }, { e: 'score', team: thievesTeam, pts: 0, reason: BA_REASON.taken }];
  // 1. first knockout: 15 (a leaver) kills 3 → FIRST BITE belongs to a leaver: must be dropped, never reassigned
  feed(ms('live', [0, 0]), [hit(15, 3, 100, true), death(3, 15)]);
  // 2. 15 lands 9 crits (most of anyone, then leaves); 12 lands 6 → BULLSEYE should go to 12
  for (let i = 0; i < 8; i++) feed(ms('live', [0, 0]), [hit(15, 4, 5, true)]);
  for (let i = 0; i < 6; i++) feed(ms('live', [0, 0]), [hit(12, 4, 5, true)]);
  // 3. 2 steals the cats' ball (home → carried: a steal), carries it 14 s, captures (corgis score 1)
  feed(ms('live', [0, 0]), grab(2, 0));
  t += 14;
  feed(ms('live', [1, 0]), [{ e: 'score', team: 0, pts: 1, reason: BA_REASON.captured }]);
  // 4. 13 steals the corgi ball; 4 knocks the carrier out (a stop), the ball drops; 14 picks the dropped ball up (a grab,
  //    not a steal); 3 knocks 14 out with a throwable (wpn = wireBase + 0: the squeaker) → another stop and LOB STAR
  feed(ms('live', [1, 0]), grab(13, 1));
  t += 3;
  feed(ms('live', [1, 0]), [death(13, 4), { e: 'score', team: 0, pts: 0, reason: BA_REASON.dropped }]);
  feed(ms('live', [1, 0]), grab(14, 1));
  t += 2;
  feed(ms('live', [1, 0]), [death(14, 3, ORDNANCE_RULES.wireBase), { e: 'score', team: 0, pts: 0, reason: BA_REASON.dropped }]);
  // 5. 12 picks the dropped corgi ball up (a grab, not a steal); Rex (1, local) knocks 12 out (a stop); 4 touches it home
  feed(ms('live', [1, 0]), grab(12, 1));
  t += 1;
  feed(ms('live', [1, 0]), [death(12, 1), { e: 'score', team: 0, pts: 0, reason: BA_REASON.dropped }]);
  feed(ms('live', [1, 0]), [{ e: 'score', team: 0, pts: 0, reason: BA_REASON.returned }]);
  // 6. 11 goes on a 3-knockout streak while the cats trail 0 : 1 (UNDERDOG 3, ON A ROLL 3); 2 answers with 3 (leading)
  feed(ms('live', [1, 0]), [death(2, 11), death(3, 11), death(4, 11)]);
  feed(ms('live', [1, 0]), [death(12, 2), death(13, 2), death(14, 2)]);
  // 7. four corgis each end on 500 soaked (3 already took 100, 4 took 70): a 4-way tie → CHEW TOY dropped
  feed(ms('live', [1, 0]), [hit(11, 1, 500), hit(11, 2, 500), hit(11, 3, 400), hit(11, 4, 430)]);
  // end: 5 and 15 have left. Roster credits: +100 a knockout, capture 10, grab 2, return 3
  const scoreOf = { 1: 100, 2: 300 + 10 + 2, 3: 100, 4: 100 + 3, 11: 300, 12: 2, 13: 2, 14: 2 };
  const killsOf = { 1: 1, 2: 3, 3: 1, 4: 1, 11: 3, 12: 0, 13: 0, 14: 0 };
  const rosterEnd = [1, 2, 3, 4].map((e) => R(e, 0, scoreOf[e], killsOf[e], 0)).concat([11, 12, 13, 14].map((e) => R(e, 1, scoreOf[e], killsOf[e], 0)));
  feed(ms('ended', [1, 0], 0), [], rosterEnd);
  t += 1;
  let res = null;
  for (let i = 0; i < 3 && !res; i++) { res = tally.update({ match: ms('ended', [1, 0], 0), roster: rosterEnd, localId: 1, now: t }); t += 0.3; }
  const card = (res?.awards ?? []).map((a) => `${a.id}=${a.winners.map((w) => w.entity).join('&')}(${a.value}${a.species ? ' ' + a.species : ''})`);
  // expected by hand (the rules in U3.md §1): candidates BIS 2 · SPECIAL DELIVERY 2 · GUARD DOG 4 (1 stop + 1 return) ·
  // STICKY PAWS none (1 steal max) · MARATHON 2 (14 s) · LOB STAR 3 corgi · ON A ROLL 2&11 · HEAVY PAWS 2&11 · UNDERDOG 11 ·
  // BULLSEYE 12 (6; the leaver 15 had 9) · CHEW TOY dropped (4-way tie) · FIRST BITE dropped (15 left). The spread pass
  // then shows BIS, GUARD DOG, LOB STAR, ON A ROLL, BULLSEYE (2 already has one; 11 gets ON A ROLL; 12 fills the fifth).
  const want = ['best_in_show=2(312)', 'guard_dog=4(2)', 'lob_star=3(1 corgi)', 'on_a_roll=2&11(3)', 'bullseye=12(6)'];
  const st = (e) => tally.statsOf(e);
  const counters = { steals2: st(2)?.steals, steals13: st(13)?.steals, grabs12: st(12)?.grabs, steals12: st(12)?.steals, grabs14: st(14)?.grabs, steals14: st(14)?.steals,
    captures2: st(2)?.captures, marathon2: st(2)?.longestCarry?.toFixed(2), stops: [1, 3, 4].map((e) => st(e)?.stops), behind11: st(11)?.behindKills, behind2: st(2)?.behindKills,
    first15: st(15)?.firstKill, crits15: st(15)?.crits, crits12: st(12)?.crits };
  const wantCounters = { steals2: 1, steals13: 1, grabs12: 1, steals12: 0, grabs14: 1, steals14: 0, captures2: 1, stops: [1, 1, 1], behind11: 3, behind2: 0, first15: true, crits15: 9, crits12: 6 };
  const okCounters = Object.entries(wantCounters).every(([k, v]) => JSON.stringify(counters[k]) === JSON.stringify(v));
  out({ probe: 'script', pass: JSON.stringify(card) === JSON.stringify(want) && okCounters, card, want, counters, okCounters });
  process.exit(0);
}
// ------------------------------------------------------------------------------------------------ real match
const mode = opt('mode', 'base-assault');
const map = opt('map', 'west_yard');
const seed = Number(opt('seed', 31));
const seconds = Number(opt('seconds', 240));
const leaveAt = Number(opt('leave', 0.7));
const cfg = {
  'base-assault': { baseAssault: { warmup: 3, timeLimit: seconds, endedHold: 4, captureLimit: 99 } },
  'team-deathmatch': { tdm: { warmup: 3, killLimit: 999, timeLimit: seconds, endedHold: 4 } },
  'core-rush': { coreRush: { warmup: 3, scoreLimit: 9999, timeLimit: seconds, endedHold: 4 } },
}[mode];

const sim = await Sim.create({ seed, map });
sim.state.matchConfig = cfg;
const room = new Room(sim, { mode, botsPerTeam: [4, 4] });
const raw = []; // raw sim events with their tick
const drain = sim.drainEvents.bind(sim);
sim.drainEvents = () => { const a = drain(); for (const e of a) raw.push({ tick: sim.tick, ev: e }); return a; };
const enc = new SnapEncoder(), dec = new SnapDecoder();
const tally = new AwardsTally();
let roster = [], awards = null, ended = -1, you = -1, live = -1;
const conn = {
  id: 'rex',
  send(m) {
    const msg = decodeServerFrame(encodeServerMsg(m, m.t === 'snap' ? enc : null), dec);
    if (!msg) return;
    if (msg.t === 'roster') roster = msg.players;
    if (msg.t !== 'snap') return;
    you = msg.you;
    const now = msg.tick / TICK_HZ;
    const r = tally.update({ match: msg.match, roster, localId: msg.you, now });
    if (r) awards ??= r;
    for (const ev of msg.ev) tally.onEvent(ev, now);
    if (msg.match.phase === 'live' && live < 0) live = msg.tick;
    if (msg.match.phase === 'ended' && ended < 0) ended = msg.tick;
  },
};
room.join(conn, { t: 'hello', v: PROTOCOL_VERSION, name: 'Rex', team: Team.Corgis, cls: 'assault' });
const everyone = new Map(); // entity → { entity, name, team, bot }
const note = () => { for (const p of room.players.values()) everyone.set(p.entity, { entity: p.entity, name: p.name, team: p.team, bot: p.bot }); };
note();
// BA oracle: per-tick ball state
const carry = new Map(); // entity → { steals, grabs, captures, longest, cur }
const cOf = (e) => { let c = carry.get(e); if (!c) { c = { steals: 0, grabs: 0, captures: 0, stops: 0, longest: 0 }; carry.set(e, c); } return c; };
let prevBalls = null; const carryStart = new Map();
let left = false; const ghosts = [];
for (let k = 0; k < (seconds + 30) * TICK_HZ && (ended < 0 || sim.tick < ended + TICK_HZ); k++) {
  if (!left && live >= 0 && sim.tick - live > leaveAt * seconds * TICK_HZ) {
    left = true;
    for (let i = 0; i < 3; i++) { const g = { id: `ghost${i}`, send() {} }; ghosts.push(g); room.join(g, { t: 'hello', v: PROTOCOL_VERSION, name: `Ghost${i}`, team: Team.Cats, cls: 'assault' }); }
  }
  room.tick();
  note();
  if (mode === 'base-assault') {
    const balls = baseAssaultBalls(sim).map((b) => ({ team: b.team, state: b.state, carrier: b.carrier }));
    if (prevBalls) for (let i = 0; i < balls.length; i++) {
      const a = prevBalls[i], b = balls[i];
      if (b.carrier >= 0 && b.carrier !== a.carrier) { const c = cOf(b.carrier); c.grabs++; if (a.state === BallState.Home) c.steals++; carryStart.set(b.carrier, sim.tick); }
      if (a.carrier >= 0 && b.carrier !== a.carrier) { const c = cOf(a.carrier); c.longest = Math.max(c.longest, (sim.tick - 1 - carryStart.get(a.carrier)) / TICK_HZ); }
    }
    prevBalls = balls;
  }
}
// captures and stops from the raw events, attributed with the carriers the tick before
{
  // rebuild carriers per tick from grabs: a capture's carrier is the entity whose carry ended on that tick; simpler:
  // replay ball states is heavy, so use the raw event order: pickup(id) + taken → carrier; captured → that carrier
  const carrierOf = [-1, -1];
  let pend = -1;
  for (const { ev } of raw) {
    if (ev.e === 'pickup' && ev.item === BA_PICKUP_ITEM) pend = ev.id;
    if (ev.e === 'score' && ev.reason === BA_REASON.taken) { carrierOf[1 - ev.team] = pend; pend = -1; }
    if (ev.e === 'death') for (const t of [0, 1]) if (carrierOf[t] === ev.id && ev.by >= 0 && ev.by !== ev.id) cOf(ev.by).stops++;
    if (ev.e === 'score' && (ev.reason === BA_REASON.dropped || ev.reason === BA_REASON.returned)) carrierOf[ev.team] = -1;
    if (ev.e === 'score' && ev.reason === BA_REASON.captured) { const c = carrierOf[1 - ev.team]; if (c >= 0) cOf(c).captures++; carrierOf[1 - ev.team] = -1; }
  }
}
room.dispose();
// the event oracle (raw sim events, before the wire)
const S = new Map();
const sOf = (e) => { let s = S.get(e); if (!s) { s = { kills: 0, deaths: 0, crits: 0, dmg: 0, streak: 0, best: 0, throwKills: 0, first: false, behind: 0 }; S.set(e, s); } return s; };
let firstDone = false;
for (const { ev } of raw) {
  if (ev.e === 'hit' && ev.src !== ev.dst) { if (ev.crit && ev.src >= 0) sOf(ev.src).crits++; sOf(ev.dst).dmg += Math.max(0, ev.dmg); }
  if (ev.e === 'score' && ev.reason === 'reset') { S.clear(); firstDone = false; }
  if (ev.e === 'death') {
    const v = sOf(ev.id); v.deaths++; v.streak = 0;
    if (ev.by < 0 || ev.by === ev.id) continue;
    const kt = everyone.get(ev.by)?.team, vt = everyone.get(ev.id)?.team;
    if (kt !== undefined && kt === vt) continue;
    const k = sOf(ev.by); k.kills++; k.streak++; k.best = Math.max(k.best, k.streak);
    if (!firstDone) { firstDone = true; k.first = true; }
    if (ev.wpn !== undefined && ev.wpn >= ORDNANCE_RULES.wireBase) k.throwKills++;
  }
}
const finalIds = new Set(roster.map((r) => r.entity));
const leavers = [...everyone.values()].filter((p) => !finalIds.has(p.entity) && (p.team === 0 || p.team === 1));
const rows = (list) => list.map((p) => { const r = roster.find((x) => x.entity === p.entity); const s = S.get(p.entity) ?? sOf(p.entity); const c = carry.get(p.entity) ?? cOf(p.entity);
  return { ...p, score: r?.score ?? NaN, kills: r?.kills ?? s.kills, deaths: r?.deaths ?? s.deaths, s, c }; });
const finalRows = rows(roster.filter((r) => r.team === 0 || r.team === 1));
const allRows = rows([...everyone.values()].filter((p) => p.team === 0 || p.team === 1));
const val = {
  best_in_show: (p) => p.score, heavy_paws: (p) => p.kills, lob_star: (p) => p.s.throwKills, bullseye: (p) => p.s.crits,
  on_a_roll: (p) => p.s.best, chew_toy: (p) => Math.round(p.s.dmg), first_bite: (p) => (p.s.first ? 1 : 0),
  special_delivery: (p) => p.c.captures, sticky_paws: (p) => p.c.steals, marathon: (p) => Math.round(p.c.longest),
};
const shown = awards?.awards ?? [];
const cmp = {};
for (const id of Object.keys(val)) {
  if (!(MODE_AWARDS[mode] ?? []).includes(id) && id !== 'best_in_show') continue;
  const o = oracleWinner(id, finalRows, val[id]);
  const any = id === 'best_in_show' || id === 'heavy_paws' ? null : oracleWinner(id, allRows, (p) => val[id]({ ...p, kills: p.s.kills }));
  const card = shown.find((a) => a.id === id);
  cmp[id] = { oracle: o, card: card ? { value: card.value, winners: card.winners.map((w) => w.entity) } : null,
    agree: !card || (o && card.value === o.value && JSON.stringify(card.winners.map((w) => w.entity)) === JSON.stringify(o.winners)),
    leaverWouldWin: any && any.winners?.some((e) => !finalIds.has(e)) ? any : undefined };
}
// per-player fold vs oracle (only players on the final roster: the tally keeps leavers' counters too)
const diffs = [];
for (const p of allRows) {
  const t = tally.statsOf(p.entity); if (!t) continue;
  const pairs = [['kills', t.kills, p.s.kills], ['crits', t.crits, p.s.crits], ['dmgTaken', Math.round(t.dmgTaken), Math.round(p.s.dmg)], ['bestStreak', t.bestStreak, p.s.best], ['throwKills', t.throwKills, p.s.throwKills], ['firstKill', t.firstKill, p.s.first]];
  if (mode === 'base-assault') pairs.push(['steals', t.steals, p.c.steals], ['grabs', t.grabs, p.c.grabs], ['captures', t.captures, p.c.captures], ['stops', t.stops, p.c.stops], ['longestCarry', +t.longestCarry.toFixed(2), +p.c.longest.toFixed(2)]);
  for (const [k, a, b] of pairs) if (k === 'longestCarry' ? Math.abs(a - b) > 0.2 : a !== b) diffs.push({ entity: p.entity, name: p.name, k, tally: a, oracle: b });
}
const winnersOffRoster = shown.flatMap((a) => a.winners.filter((w) => !finalIds.has(w.entity)).map((w) => `${a.id}:${w.name}`));
out({ probe: 'match', mode, map, seed, seconds, local: you, shown: shown.length, ids: shown.map((a) => `${a.id}=${a.winners.map((w) => w.name).join('&')}(${a.value})`),
  complete: awards?.complete, score: awards?.score, leavers: leavers.map((p) => p.name), winnersOffRoster, playerFoldDiffs: diffs.length, diffs: diffs.slice(0, 12), cmp });

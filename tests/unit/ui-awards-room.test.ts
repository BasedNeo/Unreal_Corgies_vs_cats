// W10 U3: awards from a stream recorded off a real authority. An in-process Room (the Room + Sim the worker and the
// Node server run) plays a short bot-filled match; everything the client would receive goes through the Node server's
// frame path (per-connection SnapEncoder → JSON text → SnapDecoder) into an AwardsTally, exactly as main.ts feeds it.
// The client-side fold must agree with the authority: every roster member's knockouts from events equal the roster's,
// BEST IN SHOW is the scoreboard's top row, every winner is on the roster, and the same seed gives the same card. In
// Base Assault, every player's roster credit is explained by the events (captures, grabs, pickups) plus whole returns:
// the returns arithmetic holds on authoritative data, not only on hand-written streams.
import { describe, it, expect } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Room } from '../../src/host/room';
import { AwardsTally, type MatchAwards } from '../../src/client/ui/awards';
import { buildScoreboard } from '../../src/client/ui/scoreboard';
import { SnapDecoder, SnapEncoder, decodeServerFrame, encodeServerMsg } from '../../src/host/wire';
import type { RosterEntry, ServerMsg } from '../../src/shared/protocol';
import { PROTOCOL_VERSION, TICK_HZ } from '../../src/shared/constants';
import { Team } from '../../src/shared/types';
import { BA_REASON } from '../../src/shared/content/modes';

interface Recorded { awards: MatchAwards | null; roster: RosterEntry[]; tally: AwardsTally; seconds: number; reasons: string[]; log: ServerMsg[] }

/** Feeds decoded server messages to a tally the way main.ts does: NetClient emits a snapshot's MatchState (bus
 *  'match' → update), then its events (bus 'game' → onEvent), both on the snapshot's tick clock. */
function fold(log: readonly ServerMsg[]): { tally: AwardsTally; awards: MatchAwards | null; roster: RosterEntry[]; reasons: string[] } {
  const tally = new AwardsTally();
  let roster: RosterEntry[] = [], awards: MatchAwards | null = null;
  const reasons: string[] = [];
  for (const msg of log) {
    if (msg.t === 'roster') roster = msg.players;
    if (msg.t !== 'snap') continue;
    const now = msg.tick / TICK_HZ;
    const r = tally.update({ match: msg.match, roster, localId: msg.you, now });
    if (r) awards ??= r;
    for (const ev of msg.ev) { tally.onEvent(ev, now); if (ev.e === 'score') reasons.push(ev.reason); }
  }
  return { tally, awards, roster, reasons };
}

async function recordMatch(mode: string, seed: number, overrides: Record<string, unknown>, maxSeconds: number): Promise<Recorded> {
  const sim = await Sim.create({ seed });
  sim.state.matchConfig = overrides;
  const room = new Room(sim, { mode, botsPerTeam: [3, 3] });
  const enc = new SnapEncoder(), dec = new SnapDecoder();
  const log: ServerMsg[] = [];
  let ended = -1;
  const conn = {
    id: 'rex',
    send(m: ServerMsg) {
      const msg = decodeServerFrame(encodeServerMsg(m, m.t === 'snap' ? enc : null), dec); // the online frame path
      if (!msg) return;
      log.push(msg);
      if (msg.t === 'snap' && msg.match.phase === 'ended' && ended < 0) ended = msg.tick;
    },
  };
  room.join(conn as never, { t: 'hello', v: PROTOCOL_VERSION, name: 'Rex', team: Team.Corgis, cls: 'assault' });
  let k = 0;
  // run to the end, then one more second (the awards settle 0.5 s after it)
  for (; k < TICK_HZ * maxSeconds && (ended < 0 || sim.tick < ended + TICK_HZ); k++) room.tick();
  room.dispose();
  return { ...fold(log), seconds: k / TICK_HZ, log };
}

describe('W10 U3: awards from a real Room stream (online frame path)', () => {
  it('Base Assault: grabs, captures, stops and whole returns explain every roster credit', async () => {
    // seed 4, 3 v 3 bots + an idle human, 100 s to the horn: steals both ways, carriers knocked out, touch returns,
    // a capture each (measured when this test was written; the invariants below hold for any stream)
    const a = await recordMatch('base-assault', 4, { baseAssault: { warmup: 1, timeLimit: 100, endedHold: 3 } }, 110);
    expect(a.awards, `no result after ${a.seconds}s`).not.toBeNull();
    const m = a.awards!;
    expect(m.mode).toBe('base-assault');
    expect(m.complete).toBe(true);
    for (const r of [BA_REASON.taken, BA_REASON.dropped, BA_REASON.returned, BA_REASON.captured]) expect(a.reasons, r).toContain(r);
    let captures = 0, grabs = 0, stops = 0;
    for (const r of a.roster) {
      const t = a.tally.statsOf(r.entity);
      const rest = r.score - 100 * r.kills - (t?.pickupPts ?? 0) - 10 * (t?.captures ?? 0) - 2 * (t?.grabs ?? 0);
      expect(rest, `${r.name}: ${r.score} = ${r.kills} knockouts + ${t?.captures} captures + ${t?.grabs} grabs + returns`).toBeGreaterThanOrEqual(0);
      expect(rest % 3, `${r.name}: the remainder is whole returns`).toBe(0);
      expect(t?.kills ?? 0, `${r.name} knockouts`).toBe(r.kills);
      captures += t?.captures ?? 0; grabs += t?.grabs ?? 0; stops += t?.stops ?? 0;
    }
    expect(captures).toBe(m.score[0] + m.score[1]); // every capture the match scored has its carrier
    expect(grabs).toBe(a.reasons.filter((x) => x === BA_REASON.taken).length);
    expect(stops).toBeGreaterThan(0);
    const members = new Set(a.roster.map((r) => r.entity));
    for (const aw of m.awards) for (const w of aw.winners) expect(members.has(w.entity), `${aw.id}: ${w.name}`).toBe(true);
    expect(m.awards.map((x) => x.id)).toContain('special_delivery');
  }, 120_000);

  it('Team Deathmatch: the event fold matches the authority; the same stream gives the same card', async () => {
    const tdm = { tdm: { warmup: 1, killLimit: 5, timeLimit: 70, endedHold: 3 } };
    const a = await recordMatch('team-deathmatch', 3, tdm, 80);
    expect(a.awards, `no result after ${a.seconds}s`).not.toBeNull();
    const m = a.awards!;
    expect(m.mode).toBe('team-deathmatch');
    expect(m.complete).toBe(true);
    const members = new Set(a.roster.map((r) => r.entity));
    let kills = 0;
    for (const r of a.roster) {
      expect(a.tally.statsOf(r.entity)?.kills ?? 0, `${r.name} knockouts`).toBe(r.kills);
      kills += r.kills;
    }
    expect(kills).toBeGreaterThan(0);
    expect(m.awards.length).toBeGreaterThanOrEqual(1);
    expect(m.awards.length).toBeLessThanOrEqual(5);
    for (const aw of m.awards) for (const w of aw.winners) expect(members.has(w.entity), `${aw.id}: ${w.name}`).toBe(true);
    // BEST IN SHOW = the top row of the scoreboard across both teams
    const sb = buildScoreboard(a.roster, -1);
    const rows = [...sb.teams[0], ...sb.teams[1]].sort((x, y) => y.score - x.score || y.kills - x.kills || x.deaths - y.deaths);
    expect(m.awards[0].id).toBe('best_in_show');
    expect(m.awards[0].winners.map((w) => w.entity)).toContain(rows[0].entity);
    // the client fold is deterministic: the same recorded stream into a fresh tally gives the same card
    expect(fold(a.log).awards).toEqual(m);
  }, 120_000);
});

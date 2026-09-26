// L5: kill feed ordering/limits/expiry + scoreboard model.
import { describe, expect, it } from 'vitest';
import { KillFeed, type FeedParty } from '../../src/client/ui/kill-feed';
import { buildScoreboard, kdText } from '../../src/client/ui/scoreboard';
import type { RosterEntry } from '../../src/shared/protocol';

const P = (id: number, team = 0, local = false): FeedParty => ({ id, name: `p${id}`, team, local, bot: false });

describe('KillFeed', () => {
  it('keeps newest first and caps the list', () => {
    const f = new KillFeed(3, 6);
    for (let i = 1; i <= 5; i++) f.push({ killer: P(i), victim: P(i + 10, 1), glyph: 'rifle', crit: false }, i * 0.1);
    expect(f.entries.length).toBe(3);
    expect(f.entries.map((e) => e.killer!.id)).toEqual([5, 4, 3]);
  });

  it('expires entries after ttl, but entries involving the local player linger 1.5×', () => {
    const f = new KillFeed(5, 6);
    f.push({ killer: P(1), victim: P(2, 1), glyph: 'rifle', crit: false }, 0);
    f.push({ killer: P(3, 0, true), victim: P(4, 1), glyph: 'laser', crit: true }, 0);
    expect(f.prune(5)).toBe(false);
    expect(f.prune(6.5)).toBe(true);
    expect(f.entries.length).toBe(1);
    expect(f.entries[0].killer!.local).toBe(true);
    f.prune(9.1);
    expect(f.entries.length).toBe(0);
  });

  it('bumps version on change so the view re-renders only when needed', () => {
    const f = new KillFeed();
    const v0 = f.version;
    f.prune(1);
    expect(f.version).toBe(v0);
    f.push({ killer: null, victim: P(2), glyph: 'fall', crit: false }, 0);
    expect(f.version).toBe(v0 + 1);
  });
});

describe('scoreboard', () => {
  const r = (entity: number, team: 0 | 1, kills: number, deaths: number, score: number, name = `n${entity}`): RosterEntry =>
    ({ pid: `p${entity}`, name, team, cls: 'assault', entity, bot: entity > 5, kills, deaths, score, ping: 20 });

  it('splits by team, sorts by score, then kills, then fewest deaths, then name', () => {
    const m = buildScoreboard([r(1, 0, 3, 1, 300), r(2, 0, 5, 1, 300), r(3, 1, 1, 0, 100), r(4, 0, 5, 0, 300, 'b'), r(5, 0, 5, 0, 300, 'a'), r(6, 1, 9, 9, 900)], 2);
    expect(m.teams[0].map((x) => x.entity)).toEqual([5, 4, 2, 1]);
    expect(m.teams[1].map((x) => x.entity)).toEqual([6, 3]);
    expect(m.teams[0].find((x) => x.entity === 2)!.local).toBe(true);
    expect(m.totals).toEqual([18, 10]);
  });

  it('K/D text never divides by zero', () => {
    expect(kdText(4, 0)).toBe('4');
    expect(kdText(3, 2)).toBe('1.50');
  });
});

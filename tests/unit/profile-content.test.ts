// P2 against C3's real catalogue (src/shared/content/cosmetics.ts): every unlock rule is understood and reachable, the
// level curve paces the real content (simulated players), and the public API returns looks C3's validator accepts.
import { afterEach, describe, expect, it } from 'vitest';
import { CHAPTERS } from '../../src/shared/content/chapters';
import { COSMETICS, FIRST_WIN_MODES, defaultLook, isValidLook } from '../../src/shared/content/cosmetics';
import { Species } from '../../src/shared/types';
import { ProfileStore, currentLook, equipLook, loadProfile, recordMatch, setProfileStore } from '../../src/client/profile';
import { freshProfile, type Profile } from '../../src/client/profile/schema';
import { applyMatch } from '../../src/client/profile/record';
import { ruleOf, lookFor } from '../../src/client/profile/unlocks';
import { MatchTally } from '../../src/client/profile/tally';
import { XP, xpForLevel, type MatchResult } from '../../src/client/profile/xp';
import type { MatchState } from '../../src/shared/protocol';

class MemKV { map = new Map<string, string>(); getItem(k: string) { return this.map.get(k) ?? null; } setItem(k: string, v: string) { this.map.set(k, v); } }

afterEach(() => setProfileStore(null));

describe('C3 content: every unlock rule is understood and reachable', () => {
  it('no rule reads as "never"; chapters and modes exist; levels are on the early curve', () => {
    for (const item of COSMETICS) {
      const r = ruleOf(item);
      expect(r.kind, item.id).not.toBe('never');
      if (r.kind === 'medal') expect(CHAPTERS.some((c) => c.id === r.chapter), item.id).toBe(true);
      if (r.kind === 'firstWin') expect(FIRST_WIN_MODES as readonly string[]).toContain(r.mode);
      if (r.kind === 'level') expect(xpForLevel(r.level), item.id).toBeLessThanOrEqual(2000); // ≤ ~10 typical matches
    }
  });

  it('a profile that has done everything unlocks the whole catalogue', () => {
    const all: Profile = {
      ...freshProfile(), xp: xpForLevel(20), level: 20, firstWins: [...FIRST_WIN_MODES],
      medals: Object.fromEntries(CHAPTERS.map((c) => [c.id, 'gold' as const])),
    };
    const rec = applyMatch(all, { mode: 'team-deathmatch', outcome: 'loss' }, COSMETICS);
    const lockable = COSMETICS.filter((c) => ruleOf(c).kind !== 'default').map((c) => c.id).sort();
    expect(rec.profile.unlocked).toEqual(lockable);
  });

  it('boss-rush reports as boss-rush (its MatchState says yard-skirmish) so its first-win look can unlock', () => {
    const t = new MatchTally();
    const states = new Map([[1, { id: 1, team: 0 } as never]]);
    const ms = (phase: MatchState['phase'], winner: 0 | 1 | -1 = -1): MatchState => ({ mode: 'yard-skirmish', phase, timeLeft: 0, score: [0, 0], objective: '', wave: 1, winner });
    t.update({ match: ms('live'), localId: 1, states, dt: 0.2, mode: 'boss-rush' });
    const res = t.update({ match: ms('ended', 0), localId: 1, states, dt: 0.2, mode: 'boss-rush' })!;
    expect(res.mode).toBe('boss-rush');
    const rec = applyMatch(freshProfile(), { ...res, seconds: 200 }, COSMETICS);
    expect(rec.newly).toContain('taunt_corgi_snack');
  });
});

// Simulated players (per-match results as the tally reports them), 20 matches each.
const tdm = (win: boolean, k = 4): MatchResult => ({ mode: 'team-deathmatch', outcome: win ? 'win' : 'loss', knockouts: k });
const cr = (win: boolean): MatchResult => ({ mode: 'core-rush', outcome: win ? 'win' : 'loss', knockouts: 3, pads: 1, cores: 1 });
const sk = (win: boolean): MatchResult => ({ mode: 'yard-skirmish', outcome: win ? 'win' : 'loss', knockouts: 12, steps: 1, cores: 1 });
const ch = (id: string, medal: 'gold' | 'silver' | 'bronze', steps = 5): MatchResult => ({ mode: 'adventure', outcome: 'win', steps, knockouts: 6, chapter: { id, medal } });
const PLAYERS: Record<string, MatchResult[]> = {
  pvp: Array.from({ length: 20 }, (_, i) => (i % 2 ? cr(i % 4 === 1) : tdm(i % 4 === 2))),
  'pvp, losing streaks': Array.from({ length: 20 }, (_, i) => (i % 2 ? cr(i % 5 === 4) : tdm(i % 5 === 3, 2))),
  story: [ch('yard_day', 'silver'), ch('tall_grass', 'bronze', 3), ch('garage_job', 'silver', 4), ch('laser_dawn', 'bronze', 3), ch('porch_siege', 'silver', 4),
    ch('last_ball', 'bronze'), ch('yard_day', 'gold'), sk(true), sk(false), tdm(true), tdm(false), cr(true), cr(false), sk(true), ch('garage_job', 'gold', 4),
    tdm(true), tdm(false), cr(false), sk(false), tdm(true)],
  mixed: [tdm(false), sk(true), cr(false), ch('yard_day', 'silver'), tdm(true), cr(true), sk(false), ch('tall_grass', 'silver', 3), tdm(false), cr(false),
    sk(true), tdm(true), ch('garage_job', 'bronze', 4), cr(true), tdm(false), sk(true), tdm(true), cr(false), tdm(false), sk(true)],
};

describe('level curve × the real catalogue (simulated players)', () => {
  for (const [name, seq] of Object.entries(PLAYERS)) {
    it(`${name}: a level-up and a new look in match 1, then a new look about every other match, slowing later`, () => {
      let p = freshProfile();
      const hits: number[] = [];
      seq.forEach((r, i) => {
        const rec = applyMatch(p, r, COSMETICS);
        if (i === 0) { expect(rec.profile.level).toBeGreaterThan(1); expect(rec.newly.length).toBeGreaterThanOrEqual(1); }
        if (rec.newly.length) hits.push(i + 1);
        p = rec.profile;
      });
      const first10 = hits.filter((m) => m <= 10).length, last10 = hits.length - first10;
      expect(first10).toBeGreaterThanOrEqual(4); // ≈ one match in two brings a new look…
      expect(first10).toBeLessThanOrEqual(7);
      expect(last10).toBeLessThan(first10); // …and it slows down
    });
  }

  it('a fresh device: the first match (even a quick loss) gives a level-up and the level-2 coats', () => {
    const rec = applyMatch(freshProfile(), { mode: 'core-rush', outcome: 'loss' }, COSMETICS);
    expect(rec.xp).toBe(XP.played + XP.loss);
    expect(rec.profile.level).toBe(2);
    expect(rec.newly).toEqual(['corgi_tricolor', 'cat_tuxedo']);
  });
});

describe('public API over the real catalogue', () => {
  it('currentLook fills every slot with ids C3 accepts; equipping locked looks is refused', () => {
    const kv = new MemKV();
    setProfileStore(new ProfileStore({ storage: kv, content: COSMETICS }));
    expect(currentLook(Species.Corgi)).toEqual(defaultLook('corgi'));
    expect(currentLook('cat')).toEqual(defaultLook('cat'));
    expect(equipLook('corgi', { coat: 'corgi_merle' })).toMatchObject({ ok: false, reason: 'locked' });
    expect(equipLook('cat', { coat: 'corgi_red' })).toMatchObject({ ok: false, reason: 'species' });
    const sum = recordMatch({ mode: 'team-deathmatch', outcome: 'win', knockouts: 5 });
    expect(sum.newLooks.map((l) => l.id)).toEqual(['corgi_tricolor', 'cat_tuxedo', 'taunt_cat_royal']);
    expect(equipLook('corgi', { coat: 'corgi_tricolor', neck: 'neck_none' }).ok).toBe(true);
    expect(equipLook(Species.Cat, { taunt: 'taunt_cat_royal', coat: 'cat_tuxedo' }).ok).toBe(true);
    const look = currentLook('corgi');
    expect(look).toEqual({ coat: 'corgi_tricolor', neck: 'neck_none', taunt: 'taunt_corgi_classic' });
    expect(isValidLook(look, 'corgi')).toBe(true);
    expect(isValidLook(currentLook('cat'), 'cat')).toBe(true);
    expect(loadProfile().equipped.cat).toEqual({ taunt: 'taunt_cat_royal', coat: 'cat_tuxedo' });
  });

  it('a hand-edited store that equips a locked or foreign id still spawns in a valid look', () => {
    const kv = new MemKV();
    kv.map.set('cvc.profile', JSON.stringify({ v: 1, xp: 0, unlocked: [], equipped: { corgi: { coat: 'corgi_merle', neck: 'cat_tabby', taunt: 'x'.repeat(40) } } }));
    setProfileStore(new ProfileStore({ storage: kv, content: COSMETICS }));
    expect(currentLook('corgi')).toEqual(defaultLook('corgi'));
    expect(lookFor(loadProfile(), 0, COSMETICS)).toEqual(defaultLook('corgi'));
  });
});

describe('recordMatch after the chapter card saved the paw', () => {
  it('the look a new paw unlocks is still NEW on the reward card (A1 writes cvc.adventure first)', () => {
    const kv = new MemKV();
    const s = new ProfileStore({ storage: kv, content: COSMETICS });
    s.load(); // boot: the menu loads (and saves) the profile
    kv.setItem('cvc.adventure', JSON.stringify({ unlocked: 4, medals: { garage_job: 'gold' } })); // the chapter card
    const sum = s.recordMatch({ mode: 'adventure', outcome: 'win', steps: 4, chapter: { id: 'garage_job', medal: 'gold' } });
    expect(sum.newLooks.map((l) => l.id)).toContain('neck_spiked');
    expect(sum.lines.map((l) => l.kind)).toContain('newBest');
    expect(s.load().medalXp.garage_job).toBe('gold');
    // other paws on the device (earned while nothing recorded them) still unlock with the save
    kv.setItem('cvc.adventure', JSON.stringify({ unlocked: 4, medals: { garage_job: 'gold', yard_day: 'gold' } }));
    const next = s.recordMatch({ mode: 'team-deathmatch', outcome: 'loss' });
    expect(next.newLooks.map((l) => l.id)).toContain('neck_nametag');
  });
});

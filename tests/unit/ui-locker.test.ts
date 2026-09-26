// U2: the pure parts of the LOCKER (what it shows per species / slot, hints, NEW badges, the next-look line, previews)
// and of the reward card (line labels).
import { describe, expect, it } from 'vitest';
import { COSMETICS, TAUNT_PACKS } from '../../src/shared/content/cosmetics';
import { freshProfile, type Profile } from '../../src/client/profile/schema';
import { applyMatch } from '../../src/client/profile/record';
import { xpForLevel } from '../../src/client/profile/xp';
import { coatSwatch, itemPreview, lockerModel, neckGlyph, nextLine, tauntPreview, unseenLooks } from '../../src/client/ui/locker';
import { lineLabel, rewardLines, rewardSummary } from '../../src/client/ui/rewards';

const withXp = (xp: number, o: Partial<Profile> = {}): Profile => ({ ...freshProfile(), xp, level: 1, ...o });

describe('locker model', () => {
  it('a fresh profile: defaults worn and unlocked, everything else locked with its hint, level 1, next look at level 2', () => {
    const m = lockerModel(freshProfile(), 'corgi', 'coat');
    expect(m.items.map((i) => i.id)).toEqual(['corgi_red', 'corgi_tricolor', 'corgi_sable', 'corgi_merle']);
    expect(m.items[0]).toMatchObject({ locked: false, equipped: true, hint: '' });
    expect(m.items.slice(1).every((i) => i.locked && !i.equipped)).toBe(true);
    expect(m.items.find((i) => i.id === 'corgi_sable')!.hint).toBe('Reach level 6');
    expect(m.items.find((i) => i.id === 'corgi_merle')!.hint).toBe('Gold paw: The Last Tennis Ball');
    expect(m).toMatchObject({ level: 1, into: 0, need: 100, frac: 0, maxed: false, wearing: 'Red & White', newCount: 0 });
    expect(nextLine(m)).toBe('Next looks at level 2: Tricolor +1');
  });

  it('per species and slot: cats see cat coats and cat taunts, both see every neckwear', () => {
    expect(lockerModel(freshProfile(), 'cat', 'coat').items.map((i) => i.id)).toEqual(['cat_tabby', 'cat_tuxedo', 'cat_calico', 'cat_siamese']);
    const catTaunts = lockerModel(freshProfile(), 'cat', 'taunt').items.map((i) => i.id);
    expect(catTaunts.every((id) => id.startsWith('taunt_cat_') || id === 'taunt_fetch')).toBe(true); // + Base Assault's shared pack (W9)
    expect(catTaunts).toContain('taunt_fetch');
    const necks = COSMETICS.filter((c) => c.slot === 'neck').map((c) => c.id);
    expect(lockerModel(freshProfile(), 'corgi', 'neck').items.map((i) => i.id)).toEqual(necks);
    expect(lockerModel(freshProfile(), 'cat', 'neck').items.map((i) => i.id)).toEqual(necks);
    expect(lockerModel(freshProfile(), 'cat', 'taunt').items.find((i) => i.id === 'taunt_cat_royal')!.hint).toBe('Win a Team Deathmatch');
  });

  it('after a first match: the level-2 looks are unlocked and NEW until seen; equipped shows as worn', () => {
    const p = applyMatch(freshProfile(), { mode: 'team-deathmatch', outcome: 'loss' }, COSMETICS).profile;
    expect(unseenLooks(p)).toEqual(['cat_tuxedo', 'corgi_tricolor']);
    const m = lockerModel(p, 'corgi', 'coat');
    expect(m.newCount).toBe(2);
    expect(m.items.find((i) => i.id === 'corgi_tricolor')).toMatchObject({ locked: false, isNew: true, equipped: false });
    const seen = { ...p, seen: ['cat_tuxedo', 'corgi_tricolor'], equipped: { corgi: { coat: 'corgi_tricolor' }, cat: {} } };
    const m2 = lockerModel(seen, 'corgi', 'coat');
    expect(m2.newCount).toBe(0);
    expect(m2.items.find((i) => i.id === 'corgi_tricolor')).toMatchObject({ isNew: false, equipped: true });
    expect(m2.items.find((i) => i.id === 'corgi_red')!.equipped).toBe(false);
    expect(m2.wearing).toBe('Tricolor');
    expect(nextLine(m2)).toBe('Next look at level 4: Bandana');
  });

  it('a stored look that is locked or foreign shows the default as worn (never trusts storage)', () => {
    const p = { ...freshProfile(), equipped: { corgi: { coat: 'corgi_merle' }, cat: { coat: 'corgi_red' } } };
    expect(lockerModel(p, 'corgi', 'coat').items.find((i) => i.equipped)!.id).toBe('corgi_red');
    expect(lockerModel(p, 'cat', 'coat').items.find((i) => i.equipped)!.id).toBe('cat_tabby');
  });

  it('the XP bar and next-look line follow the level curve; past the last level look it says so', () => {
    const m = lockerModel(withXp(400, { level: 3 }), 'corgi', 'coat');
    expect(m).toMatchObject({ level: 3, into: 100, need: 250 });
    expect(m.frac).toBeCloseTo(0.4);
    const done = withXp(xpForLevel(7), { unlocked: ['corgi_tricolor', 'cat_tuxedo', 'neck_bandana', 'corgi_sable', 'cat_calico'] });
    expect(nextLine(lockerModel(done, 'cat', 'coat'))).toMatch(/Every level look is yours/);
  });
});

describe('locker previews', () => {
  it('every coat has its own swatch; unknown ids get a neutral one', () => {
    const coats = COSMETICS.filter((c) => c.slot === 'coat').map((c) => coatSwatch(c.id));
    expect(new Set(coats).size).toBe(coats.length);
    expect(coats.every((c) => /gradient|#/.test(c))).toBe(true);
    expect(coatSwatch('nope')).toContain('repeating-linear-gradient');
  });

  it('every neckwear has a glyph, every taunt pack a first line; markup is escaped', () => {
    for (const c of COSMETICS.filter((i) => i.slot === 'neck')) expect(neckGlyph(c.id)).toMatch(/^<svg viewBox="0 0 48 48"/);
    for (const c of COSMETICS.filter((i) => i.slot === 'taunt')) expect(tauntPreview(c.id)).toBe(TAUNT_PACKS[c.id][0]);
    expect(itemPreview({ id: 'taunt_corgi_classic', slot: 'taunt' })).toContain('“Bring it, whiskers!”');
    expect(itemPreview({ id: 'taunt_x', slot: 'taunt' })).toContain('lo-q');
    const orig = TAUNT_PACKS.taunt_corgi_herder[0];
    expect(itemPreview({ id: 'taunt_corgi_herder', slot: 'taunt' })).not.toMatch(/<(?!\/?span)/);
    expect(orig.length).toBeGreaterThan(0);
  });
});

describe('reward card text', () => {
  it('labels every kind of line', () => {
    expect(lineLabel({ kind: 'played', xp: 60 })).toBe('Played it out');
    expect(lineLabel({ kind: 'loss', xp: 40 })).toBe('Good fight');
    expect(lineLabel({ kind: 'knockouts', count: 4, xp: 40 })).toBe('Knockouts ×4');
    expect(lineLabel({ kind: 'pads', count: 2, xp: 40 })).toBe('Core Pads ×2');
    expect(lineLabel({ kind: 'medal', medal: 'gold', xp: 80 })).toBe('Gold paw');
    expect(lineLabel({ kind: 'newBest', medal: 'gold', xp: 40 })).toBe('New best paw');
    expect(lineLabel({ kind: 'firstWin', mode: 'core-rush', xp: 150 })).toBe('First Core Rush win');
    expect(lineLabel({ kind: 'firstWin', mode: 'boss-rush', xp: 150 })).toBe('First Boss Rush win');
  });

  it('a first match reads as +100 XP, LEVEL UP, two new looks and the next one to play for', () => {
    const rec = applyMatch(freshProfile(), { mode: 'team-deathmatch', outcome: 'loss' }, COSMETICS);
    const sum = rewardSummary(rec.before, rec.profile, { lines: rec.lines, content: COSMETICS });
    expect(rewardLines(sum)).toEqual([{ label: 'Played it out', xp: '+60' }, { label: 'Good fight', xp: '+40' }]);
    expect(sum).toMatchObject({ xp: 100, levelBefore: 1, levelAfter: 2, levelUps: 1, empty: false });
    expect(sum.newLooks.map((l) => l.name)).toEqual(['Tricolor', 'Tuxedo']);
    expect(sum.next).toMatchObject({ level: 4, looks: [{ name: 'Bandana' }] });
  });
});

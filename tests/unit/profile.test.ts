// P2: the versioned profile (cvc.profile): migration from a pre-profile device, corrupt and blocked storage, unlock
// rules (idempotent, never revoke), equipping (locked ids refused). Content here is a fixture in C3's shape; the real
// COSMETICS catalogue is exercised in profile-content.test.ts.
import { describe, expect, it } from 'vitest';
import { PROFILE_KEY, PROFILE_VERSION, freshProfile, migrateProfile, retroXp, sanitizeProfile, type Profile } from '../../src/client/profile/schema';
import { ProfileStore } from '../../src/client/profile/store';
import { equip, evaluateUnlocks, lookFor, nextLevelUnlock, ruleOf } from '../../src/client/profile/unlocks';
import { FIXTURE } from './profile-fixture';
import { XP, levelForXp, xpForLevel } from '../../src/client/profile/xp';
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings } from '../../src/client/ui/settings';
import { PROGRESS_KEY, loadProgress } from '../../src/client/adventure/progress';

class MemKV {
  map = new Map<string, string>();
  writes = 0;
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.writes++; this.map.set(k, v); }
}
class ThrowKV { getItem(): string | null { throw new Error('SecurityError'); } setItem(): void { throw new Error('SecurityError'); } }
class ReadOnlyKV extends MemKV { override setItem(): void { throw new Error('QuotaExceededError'); } }


const store = (kv: MemKV | ThrowKV | null, content = FIXTURE) => new ProfileStore({ storage: kv as never, content });

describe('profile: migration from a pre-profile (v0) device', () => {
  it('keeps every paw and every setting; old paws pay retroactive XP once', () => {
    const kv = new MemKV();
    const settings = { ...DEFAULT_SETTINGS, name: 'Old Pup', sensitivity: 1.7, quality: 'low', team: 1, cls: 'warden' };
    const adventure = { unlocked: 4, medals: { yard_day: 'gold', tall_grass: 'bronze', garage_job: 'gold' } };
    kv.map.set(SETTINGS_KEY, JSON.stringify(settings));
    kv.map.set(PROGRESS_KEY, JSON.stringify(adventure));
    const settingsRaw = kv.map.get(SETTINGS_KEY), advRaw = kv.map.get(PROGRESS_KEY);
    const settingsBefore = loadSettings(kv), progressBefore = loadProgress(kv);

    const p = store(kv).load();
    expect(p.v).toBe(PROFILE_VERSION);
    expect(p.medals).toEqual(adventure.medals);
    expect(p.medalXp).toEqual(adventure.medals); // paid for, so a replay's new-best bonus is not paid twice
    const retro = 2 * (XP.medal.gold + XP.newBest) + XP.medal.bronze + XP.newBest + XP.firstWin;
    expect(retroXp(p.medals)).toBe(retro);
    expect(p.xp).toBe(retro);
    expect(p.level).toBe(levelForXp(retro));
    expect(p.firstWins).toEqual(['adventure']);
    expect(p.stats.chapters).toBe(3);
    // medal looks unlock at once (Gold paw in The Garage Job; Silver+ in Yard Day), and the level ones it reached
    expect(p.unlocked).toContain('coat_merle');
    expect(p.unlocked).toContain('neck_bowtie');
    expect(p.unlocked).toContain('coat_tricolor');
    // the migration is written once; the other keys are untouched, byte for byte
    expect(JSON.parse(kv.map.get(PROFILE_KEY)!).v).toBe(PROFILE_VERSION);
    expect(kv.map.get(SETTINGS_KEY)).toBe(settingsRaw);
    expect(kv.map.get(PROGRESS_KEY)).toBe(advRaw);
    expect(loadSettings(kv)).toEqual(settingsBefore);
    expect(loadProgress(kv)).toEqual(progressBefore);
    // loading again reads v1: no second retro payment, no rewrite
    const writes = kv.writes;
    const again = store(kv).load();
    expect(again.xp).toBe(retro);
    expect(kv.writes).toBe(writes);
  });

  it('a device with only settings starts fresh at level 1 (and keeps its settings)', () => {
    const kv = new MemKV();
    kv.map.set(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, name: 'Biscuit' }));
    const p = store(kv).load();
    expect(p.xp).toBe(0);
    expect(p.level).toBe(1);
    expect(p.unlocked).toEqual([]);
    expect(loadSettings(kv).name).toBe('Biscuit');
  });

  it('a paw earned later (A1 writes cvc.adventure) widens medals on load, never downgrades, pays no XP by itself', () => {
    const kv = new MemKV();
    kv.map.set(PROGRESS_KEY, JSON.stringify({ unlocked: 2, medals: { yard_day: 'bronze' } }));
    const s = store(kv);
    const first = s.load();
    kv.map.set(PROGRESS_KEY, JSON.stringify({ unlocked: 2, medals: { yard_day: 'gold' } }));
    const later = s.load();
    expect(later.medals.yard_day).toBe('gold');
    expect(later.medalXp.yard_day).toBe('bronze');
    expect(later.xp).toBe(first.xp);
    kv.map.set(PROGRESS_KEY, JSON.stringify({ unlocked: 1, medals: {} })); // adventure wiped: the profile still has it
    expect(s.load().medals.yard_day).toBe('gold');
  });

  it('migrations are pure: same input, same output, input untouched', () => {
    const raw = { v: 1, xp: 450, unlocked: ['coat_tricolor'], medals: { yard_day: 'silver' } };
    const adv = { unlocked: 3, medals: { tall_grass: 'gold' as const } };
    const snap = JSON.stringify([raw, adv]);
    expect(migrateProfile(raw, adv)).toEqual(migrateProfile(raw, adv));
    expect(JSON.stringify([raw, adv])).toBe(snap);
  });
});

describe('profile: corrupt data and blocked storage', () => {
  it('corrupt JSON falls back to defaults (plus whatever cvc.adventure still says)', () => {
    const kv = new MemKV();
    kv.map.set(PROFILE_KEY, '{"v":1,"xp":12');
    expect(store(kv).load()).toEqual({ ...freshProfile() });
    kv.map.set(PROGRESS_KEY, JSON.stringify({ unlocked: 2, medals: { yard_day: 'silver' } }));
    kv.map.set(PROFILE_KEY, 'not json at all');
    const p = store(kv).load();
    expect(p.medals).toEqual({ yard_day: 'silver' });
    expect(p.xp).toBe(retroXp({ yard_day: 'silver' }));
  });

  it('junk values are repaired: negative/NaN XP, bad ids, wrong types, unknown chapters, level recomputed', () => {
    const p = sanitizeProfile({
      v: 1, xp: -50, level: 42, unlocked: ['ok_id', 'BAD ID', 7, '<script>', 'ok_id'], seen: ['ok_id', 'not_unlocked'],
      equipped: { corgi: { coat: 'coat_red', 'x y': 'z', neck: 5 }, cat: 'junk' }, firstWins: 'tdm',
      medals: { yard_day: 'platinum', tall_grass: 'gold', nope_chapter: 'gold' }, stats: { matches: 'many', wins: 3.7, knockouts: -1 },
    });
    expect(p.xp).toBe(0);
    expect(p.level).toBe(1);
    expect(p.unlocked).toEqual(['ok_id']);
    expect(p.seen).toEqual(['ok_id']);
    expect(p.equipped).toEqual({ corgi: { coat: 'coat_red' }, cat: {} });
    expect(p.firstWins).toEqual([]);
    expect(p.medals).toEqual({ tall_grass: 'gold' });
    expect(p.stats).toMatchObject({ matches: 0, wins: 3, knockouts: 0 });
    expect(sanitizeProfile({ v: 1, xp: 1e12 }).xp).toBe(xpForLevel(99)); // capped at the top of the curve
  });

  it('arrays, null and numbers at the top level read as nothing stored', () => {
    for (const junk of ['[]', 'null', '42', '"str"', 'true']) {
      const kv = new MemKV();
      kv.map.set(PROFILE_KEY, junk);
      expect(store(kv).load()).toEqual(freshProfile());
    }
  });

  it('a newer version keeps the fields v1 understands (forward-compatible)', () => {
    const p = migrateProfile({ v: 7, xp: 900, unlocked: ['coat_tricolor'], hats: ['future'], stats: { matches: 4 } });
    expect(p.v).toBe(PROFILE_VERSION);
    expect(p.xp).toBe(900);
    expect(p.unlocked).toEqual(['coat_tricolor']);
    expect((p as unknown as Record<string, unknown>).hats).toBeUndefined();
  });

  it('storage that throws (private window) still gives a working profile, kept for the session', () => {
    const s = store(new ThrowKV());
    expect(s.load()).toEqual(freshProfile());
    const sum = s.recordMatch({ mode: 'team-deathmatch', outcome: 'loss', knockouts: 2 });
    expect(sum.xp).toBe(XP.played + XP.loss + 2 * XP.knockout);
    expect(s.load().xp).toBe(sum.xp);
    expect(s.equip('corgi', { coat: 'coat_tricolor' }).ok).toBe(true);
    expect(s.currentLook('corgi').coat).toBe('coat_tricolor');
  });

  it('no storage at all, and storage that refuses writes (quota), keep the session going', () => {
    const none = store(null);
    none.recordMatch({ mode: 'core-rush', outcome: 'win', pads: 2 });
    expect(none.load().firstWins).toEqual(['core-rush']);
    const ro = new ReadOnlyKV();
    const s = store(ro);
    s.recordMatch({ mode: 'core-rush', outcome: 'win' });
    expect(s.load().firstWins).toEqual(['core-rush']);
    expect(ro.map.has(PROFILE_KEY)).toBe(false);
  });

  it('round-trips through storage as versioned JSON', () => {
    const kv = new MemKV();
    const s = store(kv);
    s.recordMatch({ mode: 'team-deathmatch', outcome: 'win', knockouts: 7 });
    s.equip(0, { coat: 'coat_tricolor', neck: 'neck_none' });
    const saved = JSON.parse(kv.map.get(PROFILE_KEY)!) as Profile;
    expect(saved.v).toBe(PROFILE_VERSION);
    expect(store(kv).load()).toEqual(s.load());
    expect(saved.equipped.corgi).toEqual({ coat: 'coat_tricolor', neck: 'neck_none' });
  });
});

describe('profile: unlocks and equipping', () => {
  it('reads C3 unlock rules in either shape (kind or type, level or n)', () => {
    expect(ruleOf({ unlock: 'default' })).toEqual({ kind: 'default' });
    expect(ruleOf({ unlock: { type: 'level', n: 6 } })).toEqual({ kind: 'level', level: 6 });
    expect(ruleOf({ unlock: { kind: 'first_win', mode: 'core-rush' } })).toEqual({ kind: 'firstWin', mode: 'core-rush' });
    expect(ruleOf({ unlock: { kind: 'medal', chapter: 'garage_job', medal: 'gold' } })).toEqual({ kind: 'medal', chapter: 'garage_job', medal: 'gold' });
    expect(ruleOf({ unlock: { kind: 'medal', chapter: 'garage_job', medal: 'diamond' } })).toEqual({ kind: 'never' });
    expect(ruleOf({ unlock: { kind: 'purchase' } })).toEqual({ kind: 'never' });
  });

  it('is idempotent and never revokes', () => {
    const p0: Profile = { ...freshProfile(), xp: xpForLevel(3), level: 3, firstWins: ['core-rush'], medals: { yard_day: 'gold' } };
    const a = evaluateUnlocks(p0, FIXTURE);
    expect(a.newly.sort()).toEqual(['coat_calico', 'coat_tricolor', 'neck_bandana', 'neck_bowtie']);
    const b = evaluateUnlocks(a.profile, FIXTURE);
    expect(b.newly).toEqual([]);
    expect(b.profile).toBe(a.profile); // same object: nothing to write
    // a lower level, a lost first win, a missing paw and a catalogue that dropped an item revoke nothing
    const shrunk = { ...a.profile, level: 1, xp: 0, firstWins: [], medals: {} };
    const c = evaluateUnlocks(shrunk, FIXTURE.filter((i) => i.id !== 'coat_calico'));
    expect(c.profile.unlocked).toEqual(a.profile.unlocked);
    // defaults are never listed: they are always available
    expect(a.profile.unlocked).not.toContain('coat_red');
  });

  it('medal rules accept a better paw than asked (gold meets silver), not a worse one', () => {
    const silver = evaluateUnlocks({ ...freshProfile(), medals: { yard_day: 'silver', garage_job: 'silver' } }, FIXTURE);
    expect(silver.newly).toEqual(['neck_bowtie']);
    const bronze = evaluateUnlocks({ ...freshProfile(), medals: { yard_day: 'bronze' } }, FIXTURE);
    expect(bronze.newly).toEqual([]);
  });

  it('equipping a locked look is refused; defaults and unlocked ones equip; all or nothing', () => {
    const p = { ...freshProfile(), unlocked: ['coat_tricolor'] };
    const locked = equip(p, 'corgi', { coat: 'coat_merle' }, FIXTURE);
    expect(locked).toMatchObject({ ok: false, reason: 'locked', id: 'coat_merle' });
    expect(locked.profile).toBe(p);
    expect(equip(p, 'corgi', { coat: 'coat_nope' }, FIXTURE)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(equip(p, 'corgi', { neck: 'coat_tricolor' }, FIXTURE)).toMatchObject({ ok: false, reason: 'slot' });
    expect(equip(p, 'cat', { coat: 'coat_tricolor' }, FIXTURE)).toMatchObject({ ok: false, reason: 'species' });
    // one locked id in a multi-slot change refuses the whole change
    const mixed = equip(p, 'corgi', { coat: 'coat_tricolor', neck: 'neck_bandana' }, FIXTURE);
    expect(mixed.ok).toBe(false);
    expect(mixed.profile.equipped.corgi).toEqual({});
    const ok = equip(p, 'corgi', { coat: 'coat_tricolor', neck: 'neck_none' }, FIXTURE);
    expect(ok.ok).toBe(true);
    expect(ok.profile.equipped.corgi).toEqual({ coat: 'coat_tricolor', neck: 'neck_none' });
    expect(ok.profile.equipped.cat).toEqual({});
  });

  it('the current look never trusts storage: unknown, locked or wrong-species ids fall back to the default', () => {
    const p = { ...freshProfile(), unlocked: ['coat_tricolor'], equipped: { corgi: { coat: 'coat_merle', neck: 'neck_gone', taunt: 'taunt_cat' }, cat: { coat: 'coat_tricolor' } } };
    expect(lookFor(p, 'corgi', FIXTURE)).toEqual({ coat: 'coat_red', neck: 'neck_none', taunt: 'taunt_corgi' });
    expect(lookFor(p, 1, FIXTURE)).toEqual({ coat: 'coat_tabby', neck: 'neck_none', taunt: 'taunt_cat' });
    expect(lookFor({ ...p, equipped: { corgi: { coat: 'coat_tricolor' }, cat: {} } }, 0, FIXTURE).coat).toBe('coat_tricolor');
  });

  it('shows the next reward: the lowest level still to unlock something', () => {
    expect(nextLevelUnlock({ ...freshProfile() }, FIXTURE)).toMatchObject({ level: 2, items: [{ id: 'coat_tricolor' }] });
    expect(nextLevelUnlock({ ...freshProfile(), level: 3, unlocked: ['coat_tricolor', 'neck_bandana'] }, FIXTURE)?.level).toBe(4);
    expect(nextLevelUnlock({ ...freshProfile(), level: 9 }, FIXTURE)).toBeNull();
  });
});

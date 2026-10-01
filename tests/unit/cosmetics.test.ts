// C3 cosmetics content: ids, unlock spread, taunt packs, and sanitizeLook against hostile input (the server uses it).
import { describe, it, expect } from 'vitest';
import {
  COSMETICS, FIRST_WIN_MODES, MAX_LOOK_ID_LEN, TAUNT_PACKS, cosmeticById, cosmeticsFor, defaultLook, isValidLook,
  randomLook, resolveLook, sanitizeLook, tauntLines, unlockHint, type CosmeticDef,
} from '../../src/shared/content/cosmetics';
import { TAUNTS } from '../../src/shared/content/taunts';
import { CHAPTERS } from '../../src/shared/content/chapters';
import { ROOM_MODES } from '../../src/host/guard';
import { Species } from '../../src/shared/types';

const SPECIES = [Species.Corgi, Species.Cat] as const;

describe('cosmetics content', () => {
  it('ids are unique, save-safe and bounded; every item has a name and a known slot / species', () => {
    const ids = COSMETICS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of COSMETICS) {
      expect(c.id).toMatch(/^[a-z0-9][a-z0-9_-]*$/); // the profile's id rule (P2)
      expect(c.id.length).toBeLessThanOrEqual(MAX_LOOK_ID_LEN);
      expect(['coat', 'neck', 'taunt', 'rank']).toContain(c.slot); // W9 K3: the rank slot
      expect(['corgi', 'cat', 'both']).toContain(c.species);
      expect(c.name.length).toBeGreaterThan(2);
      expect(unlockHint(c.unlock).length).toBeGreaterThan(4);
    }
  });

  it('has the species-true coats, the neckwear and 4 taunt packs per species (+ the corgis\' chapter 7 pack, the cats\' slab pack), one default per slot', () => {
    expect(cosmeticsFor(Species.Corgi, 'coat').map((c) => c.id)).toEqual(['corgi_red', 'corgi_tricolor', 'corgi_sable', 'corgi_merle']);
    expect(cosmeticsFor(Species.Cat, 'coat').map((c) => c.id)).toEqual(['cat_tabby', 'cat_tuxedo', 'cat_calico', 'cat_siamese']);
    for (const sp of SPECIES) {
      expect(cosmeticsFor(sp, 'neck').map((c) => c.id).sort()).toEqual(['neck_bandana', 'neck_bowtie', 'neck_nametag', 'neck_none', 'neck_spiked']);
      // 4 per species + Base Assault's shared 'Fetch This!' (W9) + the corgis' Night Shift (W10 A7, chapter 7's gold paw)
      // + the cats' Sun Spot (W13, the first slab win)
      expect(cosmeticsFor(sp, 'taunt')).toHaveLength(6);
      for (const slot of ['coat', 'neck', 'taunt', 'rank'] as const) {
        const defaults = cosmeticsFor(sp, slot).filter((c) => c.unlock.kind === 'default');
        expect(defaults.map((d) => d.id)).toEqual([defaultLook(sp)[slot]]);
      }
    }
    expect(defaultLook(Species.Corgi)).toEqual({ coat: 'corgi_red', neck: 'neck_none', taunt: 'taunt_corgi_classic', rank: 'rank_none' });
    expect(defaultLook(Species.Cat)).toEqual({ coat: 'cat_tabby', neck: 'neck_none', taunt: 'taunt_cat_classic', rank: 'rank_none' });
  });

  it('spreads unlocks: a few levels 2–10, the gold paw of every chapter, the first win of every room mode', () => {
    const by = (k: CosmeticDef['unlock']['kind']) => COSMETICS.filter((c) => c.unlock.kind === k);
    const levels = by('level').map((c) => (c.unlock as { level: number }).level);
    expect(levels.length).toBeGreaterThanOrEqual(3);
    for (const l of levels) { expect(l).toBeGreaterThanOrEqual(2); expect(l).toBeLessThanOrEqual(10); }
    expect(Math.min(...levels)).toBe(2); // the first match levels up (P2 curve) and unlocks a look
    const medals = by('medal').map((c) => c.unlock as { chapter: string; medal: string });
    expect(medals.map((m) => m.chapter).sort()).toEqual(CHAPTERS.map((c) => c.id).sort());
    for (const m of medals) expect(m.medal).toBe('gold');
    expect([...FIRST_WIN_MODES].sort()).toEqual([...ROOM_MODES].sort()); // no drift from the room modes
    expect(by('firstWin').map((c) => (c.unlock as { mode: string }).mode).sort()).toEqual([...FIRST_WIN_MODES].sort());
    expect(unlockHint({ kind: 'medal', chapter: 'yard_day', medal: 'gold' })).toBe('Gold paw: Yard Day');
    expect(unlockHint({ kind: 'level', level: 4 })).toBe('Reach level 4');
    expect(unlockHint({ kind: 'firstWin', mode: 'core-rush' })).toBe('Win a Core Rush');
  });

  it('taunt packs: 4–6 short original lines each; the classic packs are the existing taunts', () => {
    const all = new Set<string>();
    for (const c of COSMETICS.filter((x) => x.slot === 'taunt')) {
      const lines = TAUNT_PACKS[c.id];
      expect(lines, c.id).toBeDefined();
      expect(lines.length).toBeGreaterThanOrEqual(4);
      expect(lines.length).toBeLessThanOrEqual(6);
      for (const l of lines) {
        expect(l.trim().length).toBeGreaterThan(2);
        expect(l.length).toBeLessThanOrEqual(32); // the voice synth says them as gibberish: keep them short
        expect(all.has(l), `duplicate line ${l}`).toBe(false);
        all.add(l);
      }
    }
    expect(TAUNT_PACKS.taunt_corgi_classic).toEqual(TAUNTS[Species.Corgi]);
    expect(TAUNT_PACKS.taunt_cat_classic).toEqual(TAUNTS[Species.Cat]);
  });

  it('tauntLines: the look\'s pack; unknown, missing or wrong-species packs fall back to the classic lines', () => {
    expect(tauntLines({ taunt: 'taunt_corgi_herder' }, Species.Corgi)).toBe(TAUNT_PACKS.taunt_corgi_herder);
    expect(tauntLines({ taunt: 'taunt_cat_royal' }, Species.Cat)).toBe(TAUNT_PACKS.taunt_cat_royal);
    expect(tauntLines({ taunt: 'taunt_cat_royal' }, Species.Corgi)).toEqual(TAUNTS[Species.Corgi]);
    expect(tauntLines({ taunt: 'nope' }, Species.Cat)).toEqual(TAUNTS[Species.Cat]);
    expect(tauntLines(undefined, Species.Corgi)).toEqual(TAUNTS[Species.Corgi]);
    expect(tauntLines(null, Species.Cat)).toEqual(TAUNTS[Species.Cat]);
    expect(tauntLines({ taunt: 42 } as never, Species.Cat)).toEqual(TAUNTS[Species.Cat]);
  });
});

describe('sanitizeLook: untrusted input', () => {
  it('keeps known ids of the right slot and species', () => {
    expect(sanitizeLook({ coat: 'corgi_merle', neck: 'neck_bowtie', taunt: 'taunt_corgi_snack' }, Species.Corgi))
      .toEqual({ coat: 'corgi_merle', neck: 'neck_bowtie', taunt: 'taunt_corgi_snack' });
    expect(sanitizeLook({ coat: 'cat_calico', neck: 'neck_spiked' }, 'cat')).toEqual({ coat: 'cat_calico', neck: 'neck_spiked' });
    expect(isValidLook({ coat: 'cat_calico' }, Species.Cat)).toBe(true);
    expect(isValidLook({ coat: 'cat_calico', x: 1 }, Species.Cat)).toBe(false);
  });

  it('drops unknown ids, wrong species, wrong slot', () => {
    expect(sanitizeLook({ coat: 'corgi_gold', neck: 'neck_cape', taunt: 'taunt_x' }, Species.Corgi)).toEqual({});
    expect(sanitizeLook({ coat: 'cat_tabby', taunt: 'taunt_cat_royal' }, Species.Corgi)).toEqual({}); // wrong species
    expect(sanitizeLook({ coat: 'neck_bandana', neck: 'corgi_red', taunt: 'neck_none' }, Species.Corgi)).toEqual({}); // wrong slot
    expect(sanitizeLook({ coat: 'CORGI_RED', neck: ' neck_none', taunt: 'taunt_corgi_classic\u0000' }, Species.Corgi)).toEqual({});
    expect(sanitizeLook({ coat: 'corgi_red' }, 7 as never)).toEqual({}); // unknown species
  });

  it('drops wrong types and huge strings without looking them up', () => {
    const big = 'corgi_red'.padEnd(10 * 1024, 'x');
    expect(sanitizeLook({ coat: big, neck: 'n'.repeat(MAX_LOOK_ID_LEN + 1) }, Species.Corgi)).toEqual({});
    for (const v of [null, undefined, 1, true, {}, [], ['corgi_red'], { id: 'corgi_red' }, new String('corgi_red'), () => 'corgi_red', Symbol('x'), 12n]) {
      expect(sanitizeLook({ coat: v, neck: v, taunt: v }, Species.Corgi)).toEqual({});
    }
    for (const raw of [null, undefined, 0, 'corgi_red', ['corgi_red'], true, 3.5, () => ({ coat: 'corgi_red' })]) {
      expect(sanitizeLook(raw, Species.Corgi)).toEqual({});
    }
  });

  it('ignores prototype keys, inherited and accessor properties, and never touches Object.prototype', () => {
    const viaJson = JSON.parse('{"__proto__": {"coat": "corgi_red", "polluted": 1}, "constructor": {"prototype": {"coat": "x"}}, "neck": "neck_bandana"}');
    expect(sanitizeLook(viaJson, Species.Corgi)).toEqual({ neck: 'neck_bandana' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(sanitizeLook(Object.create({ coat: 'corgi_red' }), Species.Corgi)).toEqual({});
    let reads = 0;
    const getter = Object.defineProperty({}, 'coat', { enumerable: true, get: () => { reads++; return 'corgi_red'; } });
    expect(sanitizeLook(getter, Species.Corgi)).toEqual({});
    expect(reads).toBe(0);
    expect(sanitizeLook({ coat: 'constructor', neck: '__proto__', taunt: 'toString' }, Species.Corgi)).toEqual({});
    const out = sanitizeLook({ coat: 'corgi_red' }, Species.Corgi);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(out)).toEqual(['coat']);
  });

  it('survives hostile proxies and never echoes the input object', () => {
    const trap = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('boom'); } });
    expect(sanitizeLook(trap, Species.Corgi)).toEqual({});
    const raw = { coat: 'corgi_sable', extra: 'x'.repeat(5000) };
    const out = sanitizeLook(raw, Species.Corgi);
    expect(out).not.toBe(raw);
    expect(out).toEqual({ coat: 'corgi_sable' });
    expect(JSON.stringify(out).length).toBeLessThan(64);
  });

  it('resolveLook fills every slot with the species default', () => {
    expect(resolveLook({ neck: 'neck_spiked', coat: 'nope' }, Species.Cat)).toEqual({ coat: 'cat_tabby', neck: 'neck_spiked', taunt: 'taunt_cat_classic', rank: 'rank_none' });
    expect(resolveLook('garbage', Species.Corgi)).toEqual(defaultLook(Species.Corgi));
  });
});

describe('randomLook (bots)', () => {
  it('is deterministic per seed and always valid for the species', () => {
    for (const sp of SPECIES) for (let seed = 0; seed < 300; seed++) {
      const a = randomLook(seed, sp);
      expect(randomLook(seed, sp)).toEqual(a);
      expect(sanitizeLook(a, sp)).toEqual(a);
      expect(cosmeticById(a.coat)!.slot).toBe('coat');
    }
  });

  it('shows off the whole catalogue across seeds, with the team collar still the most common neck', () => {
    for (const sp of SPECIES) {
      const seen = new Set<string>(), necks = new Map<string, number>();
      for (let seed = 1; seed <= 600; seed++) {
        const l = randomLook(seed * 7919, sp);
        seen.add(l.coat); seen.add(l.neck); seen.add(l.taunt);
        necks.set(l.neck, (necks.get(l.neck) ?? 0) + 1);
      }
      for (const slot of ['coat', 'neck', 'taunt'] as const) for (const c of cosmeticsFor(sp, slot)) expect(seen.has(c.id), c.id).toBe(true);
      const none = necks.get('neck_none')!;
      for (const [id, n] of necks) if (id !== 'neck_none') expect(n).toBeLessThan(none);
    }
    expect(randomLook(1, Species.Corgi)).not.toEqual(randomLook(2, Species.Corgi)); // seeds differ (spot check)
  });
});

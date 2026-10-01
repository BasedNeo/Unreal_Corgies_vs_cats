// OWNER: C3 cosmetics lane. Looks players earn by playing: coat patterns true to each species, neckwear, taunt packs
// and (W9 K3) a rank. Pure data + pure functions (runs on the server, in the sim worker and in the client; no three, no
// DOM, no Math.random). Looks never change stats: the sim reads a look only to pick taunt lines (tauntLines), and the client
// only to paint the character (src/client/procgen/cosmetics). Class hats and silhouettes stay the class cue (K1);
// neckwear stays out of the head outline and coats only repaint fur, so team colours keep their read.
//
// Unlock rules (P2 evaluates them; the locker shows unlockHint): a few at levels 2–6, the gold paw of every
// adventure chapter unlocks something, and the first win in every mode unlocks something. The veteran rank (K3) is the
// long goal at level 10: the corgi sergeant's chevrons and the cat commander's medal. A rank is worn as the K2 veteran
// kit plus its insignia (src/client/procgen/characters); like every look it changes no stat.
import { mulberry32 } from '../rng';
import { Species, type SpeciesId } from '../types';
import { CHAPTERS, type Medal } from './chapters';
import { TAUNTS } from './taunts';

export type CosmeticSlot = 'coat' | 'neck' | 'taunt' | 'rank';
export type CosmeticSpecies = 'corgi' | 'cat' | 'both';
/** The modes that have a first-win unlock (the room modes). */
export const FIRST_WIN_MODES = ['yard-skirmish', 'team-deathmatch', 'core-rush', 'base-assault', 'boss-rush', 'adventure', 'slab'] as const;
export type FirstWinMode = (typeof FIRST_WIN_MODES)[number];

export type CosmeticUnlock =
  | { kind: 'default' }
  | { kind: 'level'; level: number }
  | { kind: 'medal'; chapter: string; medal: Medal }
  | { kind: 'firstWin'; mode: FirstWinMode };

export interface CosmeticDef {
  /** Stable content id (save data + wire): lower snake case, ≤ MAX_LOOK_ID_LEN. Never rename one. */
  readonly id: string;
  readonly slot: CosmeticSlot;
  readonly species: CosmeticSpecies;
  /** Locker name. */
  readonly name: string;
  readonly unlock: CosmeticUnlock;
}

/** A look: one id per slot. Missing or invalid slots mean the default for that slot. */
export type Look = { coat?: string; neck?: string; taunt?: string; rank?: string };

export const LOOK_SLOTS: readonly CosmeticSlot[] = ['coat', 'neck', 'taunt', 'rank'];
/** Longest id sanitizeLook accepts (every content id is shorter; longer strings are dropped unread). */
export const MAX_LOOK_ID_LEN = 32;

const D = { kind: 'default' } as const;
const lvl = (level: number): CosmeticUnlock => ({ kind: 'level', level });
const gold = (chapter: string): CosmeticUnlock => ({ kind: 'medal', chapter, medal: 'gold' });
const win = (mode: FirstWinMode): CosmeticUnlock => ({ kind: 'firstWin', mode });

/** Every cosmetic, in locker order (per slot: default first, then by how early it unlocks). */
export const COSMETICS: readonly CosmeticDef[] = [
  // --- coats (species-true patterns; they repaint fur only, never the team vest) ---
  { id: 'corgi_red', slot: 'coat', species: 'corgi', name: 'Red & White', unlock: D },
  { id: 'corgi_tricolor', slot: 'coat', species: 'corgi', name: 'Tricolor', unlock: lvl(2) },
  { id: 'corgi_sable', slot: 'coat', species: 'corgi', name: 'Sable', unlock: lvl(6) },
  { id: 'corgi_merle', slot: 'coat', species: 'corgi', name: 'Blue Merle', unlock: gold('last_ball') },
  { id: 'cat_tabby', slot: 'coat', species: 'cat', name: 'Grey Tabby', unlock: D },
  { id: 'cat_tuxedo', slot: 'coat', species: 'cat', name: 'Tuxedo', unlock: lvl(2) },
  { id: 'cat_calico', slot: 'coat', species: 'cat', name: 'Calico', unlock: lvl(6) },
  { id: 'cat_siamese', slot: 'coat', species: 'cat', name: 'Siamese Point', unlock: gold('laser_dawn') },
  // --- neckwear (both species; replaces the team collar) ---
  { id: 'neck_none', slot: 'neck', species: 'both', name: 'Team Collar', unlock: D },
  { id: 'neck_bandana', slot: 'neck', species: 'both', name: 'Bandana', unlock: lvl(4) },
  { id: 'neck_nametag', slot: 'neck', species: 'both', name: 'Name Tag', unlock: gold('yard_day') },
  { id: 'neck_spiked', slot: 'neck', species: 'both', name: 'Spiked Collar', unlock: gold('garage_job') },
  { id: 'neck_bowtie', slot: 'neck', species: 'both', name: 'Bow Tie', unlock: win('core-rush') },
  // --- taunt packs (the existing lines are each species' default pack) ---
  { id: 'taunt_corgi_classic', slot: 'taunt', species: 'corgi', name: 'Good Boy (classic)', unlock: D },
  { id: 'taunt_corgi_herder', slot: 'taunt', species: 'corgi', name: 'Herding Dog', unlock: win('yard-skirmish') },
  { id: 'taunt_corgi_sploot', slot: 'taunt', species: 'corgi', name: 'Low Rider', unlock: gold('tall_grass') },
  { id: 'taunt_corgi_snack', slot: 'taunt', species: 'corgi', name: 'Snack Attack', unlock: win('boss-rush') },
  { id: 'taunt_corgi_nightshift', slot: 'taunt', species: 'corgi', name: 'Night Shift', unlock: gold('night_shift') }, // W10 A7
  { id: 'taunt_cat_classic', slot: 'taunt', species: 'cat', name: 'Aloof (classic)', unlock: D },
  { id: 'taunt_cat_royal', slot: 'taunt', species: 'cat', name: 'Royal Highness', unlock: win('team-deathmatch') },
  { id: 'taunt_cat_hunter', slot: 'taunt', species: 'cat', name: 'Apex Hunter', unlock: gold('porch_siege') },
  { id: 'taunt_cat_midnight', slot: 'taunt', species: 'cat', name: '3 AM Zoomies', unlock: win('adventure') },
  { id: 'taunt_cat_sunspot', slot: 'taunt', species: 'cat', name: 'Sun Spot', unlock: win('slab') }, // W13 slab
  { id: 'taunt_fetch', slot: 'taunt', species: 'both', name: 'Fetch This!', unlock: win('base-assault') }, // W9 G4a
  // --- rank (K3; the veteran kit + the species' insignia; no stat changes) ---
  { id: 'rank_none', slot: 'rank', species: 'both', name: 'No Rank', unlock: D },
  { id: 'rank_sergeant', slot: 'rank', species: 'corgi', name: "Sergeant's Chevrons", unlock: lvl(10) },
  { id: 'rank_commander', slot: 'rank', species: 'cat', name: "Commander's Medal", unlock: lvl(10) },
];

/** The rank ids worn as the veteran kit (K2's sergeant / commander). */
export const VETERAN_RANKS: readonly string[] = ['rank_sergeant', 'rank_commander'];

/**
 * Taunt lines per pack: 4–6 short comic lines each, original, in the voice of taunts.ts (the voice synth turns them
 * into species gibberish, so keep them short). The classic packs ARE the existing TAUNTS lists.
 */
export const TAUNT_PACKS: Readonly<Record<string, readonly string[]>> = {
  taunt_corgi_classic: TAUNTS[Species.Corgi],
  taunt_corgi_herder: ['Back in the flock!', 'Nip nip. Move it!', 'I herd you like losing.', 'Line up, fluffballs.', 'Ankle check!'],
  taunt_corgi_sploot: ['Behold: the sploot.', 'Low rider, high score.', 'Stubby legs, big plays.', 'Loaf mode: engaged.', 'Fluff butt, tough butt.'],
  taunt_corgi_snack: ['Will win for treats.', 'Snack time. You are the snack.', 'Crumbs. Everywhere. You.', 'Bacon-powered!', 'Bark bark, treat please!'],
  taunt_corgi_nightshift: ['Clocked in. You clocked out.', 'Night shift never naps.', 'Overtime? For you? Free.', 'Hard hat. Soft paws.', 'Sirens off. Tails up.'], // W10 A7
  taunt_cat_classic: TAUNTS[Species.Cat],
  taunt_cat_royal: ['You may kiss the paw.', 'Peasant.', 'I own this yard. And you.', 'Bow before the floof.', 'Your defeat bores me.'],
  taunt_cat_hunter: ['Pounce. Pounce. Win.', 'You squeak like a toy.', 'Stalk. Wiggle. Gotcha.', 'Caught one!', 'Red dot? Red YOU.'],
  taunt_cat_midnight: ['3 AM. My hour.', 'Mrrrp? MRRRP!', 'Chaos is a lifestyle.', 'Knocked you off the shelf.', 'Blep.', 'Zoom. Zoom. Gone.'],
  taunt_cat_sunspot: ['I sat here first.', 'If I fits, I sits.', 'Warm slab. Cold you.', 'Off my spot.', 'Mine. All of it.'], // W13 slab
  taunt_fetch: ['Tag, you lost it!', 'Squeak squeak. Mine.', 'Finders keepers!', 'Go fetch, slowpoke.', 'Ball? What ball?'],
};

const BY_ID: ReadonlyMap<string, CosmeticDef> = new Map(COSMETICS.map((c) => [c.id, c]));

export function cosmeticById(id: string): CosmeticDef | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined;
}

/** 'corgi' | 'cat' from a SpeciesId or a species key (anything else → null). */
export function speciesKey(species: SpeciesId | 'corgi' | 'cat' | number | string): 'corgi' | 'cat' | null {
  if (species === Species.Corgi || species === 'corgi') return 'corgi';
  if (species === Species.Cat || species === 'cat') return 'cat';
  return null;
}

/** Can this species wear this item? */
export function fitsSpecies(item: CosmeticDef, species: SpeciesId | 'corgi' | 'cat'): boolean {
  const k = speciesKey(species);
  return k !== null && (item.species === 'both' || item.species === k);
}

/** The items a species can wear in a slot (locker order). */
export function cosmeticsFor(species: SpeciesId | 'corgi' | 'cat', slot: CosmeticSlot): CosmeticDef[] {
  return COSMETICS.filter((c) => c.slot === slot && fitsSpecies(c, species));
}

/** The always-available look of a species (red corgi / grey tabby, the team collar, the classic taunts, no rank). */
export function defaultLook(species: SpeciesId | 'corgi' | 'cat'): Required<Look> {
  const cat = speciesKey(species) === 'cat';
  return { coat: cat ? 'cat_tabby' : 'corgi_red', neck: 'neck_none', taunt: cat ? 'taunt_cat_classic' : 'taunt_corgi_classic', rank: 'rank_none' };
}

/**
 * Does this look wear a veteran rank for this species (K3)? Sanitized like everything else: a rank of the other
 * species, an unknown id or junk is no rank. Players only: bots' veterans come from their seed (isVeteranSeed).
 */
export function wearsVeteranRank(look: Look | null | undefined, species: SpeciesId | 'corgi' | 'cat'): boolean {
  const r = sanitizeLook(look, species).rank;
  return r !== undefined && VETERAN_RANKS.includes(r);
}

/**
 * Untrusted input (network hello, storage) → a Look with only known ids of the right slot and species. Anything
 * else is dropped, never echoed: non-objects, arrays, inherited or accessor properties (prototype keys), non-strings,
 * strings longer than MAX_LOOK_ID_LEN (not even looked up), unknown ids, another slot's or species' ids. Never throws.
 */
export function sanitizeLook(raw: unknown, species: SpeciesId | 'corgi' | 'cat'): Look {
  const out: Look = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || speciesKey(species) === null) return out;
  for (const slot of LOOK_SLOTS) {
    let d: PropertyDescriptor | undefined;
    try { d = Object.getOwnPropertyDescriptor(raw, slot); } catch { return {}; } // hostile Proxy
    if (!d || !('value' in d)) continue; // absent, inherited (prototype) or a getter
    const v: unknown = d.value;
    if (typeof v !== 'string' || v.length === 0 || v.length > MAX_LOOK_ID_LEN) continue;
    const item = BY_ID.get(v);
    if (!item || item.slot !== slot || !fitsSpecies(item, species)) continue;
    out[slot] = item.id;
  }
  return out;
}

/** Is `look` exactly a sanitized look (only known, fitting ids)? */
export function isValidLook(look: unknown, species: SpeciesId | 'corgi' | 'cat'): look is Look {
  if (look === null || typeof look !== 'object' || Array.isArray(look)) return false;
  const clean = sanitizeLook(look, species);
  const keys = Object.keys(look as object);
  return keys.length === Object.keys(clean).length && keys.every((k) => (clean as Record<string, string>)[k] === (look as Record<string, unknown>)[k]);
}

/** Every slot filled: sanitized ids where valid, the species default elsewhere. */
export function resolveLook(look: unknown, species: SpeciesId | 'corgi' | 'cat'): Required<Look> {
  return { ...defaultLook(species), ...sanitizeLook(look, species) };
}

/**
 * Bots: a seeded look from the whole catalogue (bots show off what can be earned). Same seed → same look. The rank is
 * always 'rank_none' and draws nothing from the RNG (bots' veterans come from their seed, isVeteranSeed; K3 left every
 * existing bot look exactly as it was).
 */
export function randomLook(seed: number, species: SpeciesId | 'corgi' | 'cat'): Required<Look> {
  const rng = mulberry32(((seed >>> 0) ^ 0x10c3c0a7) >>> 0);
  const pick = <T>(a: readonly T[]): T => a[Math.min(a.length - 1, Math.floor(rng() * a.length))];
  const coats = cosmeticsFor(species, 'coat'), necks = cosmeticsFor(species, 'neck'), taunts = cosmeticsFor(species, 'taunt');
  if (!coats.length) return defaultLook(Species.Corgi);
  const coat = pick(coats).id;
  // The team collar stays the most common neck (~1 in 3), so a lobby is not wall-to-wall accessories.
  const neck = rng() < 0.34 ? 'neck_none' : pick(necks.filter((n) => n.id !== 'neck_none')).id;
  const taunt = pick(taunts).id;
  return { coat, neck, taunt, rank: 'rank_none' };
}

/** The taunt lines of a look's pack (unknown, missing or wrong-species pack → the species' classic lines). */
export function tauntLines(look: Look | null | undefined, species: SpeciesId | 'corgi' | 'cat'): readonly string[] {
  const id = sanitizeLook(look, species).taunt ?? defaultLook(species).taunt;
  return TAUNT_PACKS[id] ?? TAUNTS[speciesKey(species) === 'cat' ? Species.Cat : Species.Corgi];
}

const MODE_WIN_HINT: Record<FirstWinMode, string> = {
  'yard-skirmish': 'Win a Yard Skirmish',
  'team-deathmatch': 'Win a Team Deathmatch',
  'core-rush': 'Win a Core Rush',
  'base-assault': 'Win a Base Assault',
  'boss-rush': 'Beat a boss in Boss Rush',
  adventure: 'Finish an Adventure chapter',
  slab: 'Win a Slab match',
};

/** Locker text for a locked item ("Reach level 4", "Gold paw: Yard Day", "Win a Core Rush"). */
export function unlockHint(unlock: CosmeticUnlock): string {
  switch (unlock.kind) {
    case 'default': return 'Always yours';
    case 'level': return `Reach level ${unlock.level}`;
    case 'medal': {
      const title = CHAPTERS.find((c) => c.id === unlock.chapter)?.title ?? unlock.chapter;
      return `${unlock.medal[0].toUpperCase()}${unlock.medal.slice(1)} paw: ${title}`;
    }
    case 'firstWin': return MODE_WIN_HINT[unlock.mode] ?? `Win a ${unlock.mode} match`;
  }
}

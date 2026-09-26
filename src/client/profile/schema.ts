// OWNER: P2 (profile). The player's profile on this device: localStorage `cvc.profile`, versioned JSON with a pure
// migration (MASTER_PLAN §7.17, §7.19). Cosmetic only: nothing here is ever sent to or trusted by the authority as a
// competitive truth (the look rides hello → roster and the server validates it, N2).
//
// Schema v1 (docs/handoff/P2.md §1):
//   { v: 1, xp, level, unlocked: [lookId], seen: [lookId], equipped: { corgi: {slot: id}, cat: {slot: id} },
//     firstWins: [mode], medals: {chapterId: medal}, medalXp: {chapterId: medal}, stats: {...} }
//   - `level` is always recomputed from `xp` (it is stored for readability only).
//   - `medals` is the best paw per chapter this device knows. `cvc.adventure` (A1, src/client/adventure/progress.ts)
//     stays where it is and keeps driving the chapter picker; every load folds its medals in (best of both, never
//     downgraded), so nothing is lost if either key is wiped.
//   - `medalXp` is the best paw XP has been paid for (the new-best bonus compares against it, not against
//     `cvc.adventure`, which the chapter card writes a moment before the match result is recorded).
//
// Migrations (all pure, unit-tested in tests/unit/profile*.test.ts):
//   v0 = no `cvc.profile` yet (a device from before Wave 6: only `cvc.adventure` + `cvc.settings`), corrupt JSON, or an
//        unversioned object. Start fresh and fold the device's adventure medals in with retroactive XP (as if each paw
//        had been recorded: medal XP + the new-best bonus; any paw also counts as the first ADVENTURE win).
//        `cvc.settings` is never read or written here: every setting stays exactly where it was.
//   v1 = current: sanitize every field (unknown keys dropped, junk values defaulted), fold adventure medals.
//   v > 1 (a newer build wrote it): keep what v1 understands (forward-compatible downgrade).
import { CHAPTER_PLAN, type Medal } from '../../shared/content/chapters';
import { Species, type SpeciesId } from '../../shared/types';
import { MEDAL_RANK, type AdventureProgress } from '../adventure/progress';
import { XP, levelForXp, MAX_XP } from './xp';

export const PROFILE_KEY = 'cvc.profile';
export const PROFILE_VERSION = 1;

/** Species keys as stored (readable JSON; SpeciesId 0/1 maps to these). */
export const SPECIES_KEYS = ['corgi', 'cat'] as const;
export type SpeciesKey = (typeof SPECIES_KEYS)[number];

/** Look ids, slot names and mode ids are snake/kebab-case content ids. */
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
/** Bounds so a hostile or corrupted store can never grow the profile without limit. */
export const MAX_IDS = 256;
const MAX_SLOTS = 8;
const STAT_CAP = 1e7;

export interface ProfileStats {
  /** Matches and chapters recorded (each counted once, at its end). */
  matches: number;
  wins: number;
  knockouts: number;
  /** Objective steps done with your team (adventure steps, Squeaker mission steps). */
  steps: number;
  cores: number;
  pads: number;
  /** Chapters completed (every completion, replays included). */
  chapters: number;
}

export interface Profile {
  v: typeof PROFILE_VERSION;
  xp: number;
  level: number;
  /** Look ids earned (never revoked). Default looks are always available and are not listed. */
  unlocked: string[];
  /** Unlocked ids the locker has already shown (anything else wears a NEW badge). */
  seen: string[];
  /** Equipped look per species: slot → look id. Validated against content on use (currentLook). */
  equipped: Record<SpeciesKey, Record<string, string>>;
  /** Modes won at least once (MatchState.mode ids). */
  firstWins: string[];
  /** Best paw per chapter id on this device. */
  medals: Record<string, Medal>;
  /** Best paw per chapter id that XP has been paid for. */
  medalXp: Record<string, Medal>;
  stats: ProfileStats;
}

export const EMPTY_STATS: Readonly<ProfileStats> = Object.freeze({ matches: 0, wins: 0, knockouts: 0, steps: 0, cores: 0, pads: 0, chapters: 0 });

export function freshProfile(): Profile {
  return {
    v: PROFILE_VERSION, xp: 0, level: 1, unlocked: [], seen: [], equipped: { corgi: {}, cat: {} },
    firstWins: [], medals: {}, medalXp: {}, stats: { ...EMPTY_STATS },
  };
}

export function speciesKey(s: SpeciesId | SpeciesKey | number | string): SpeciesKey {
  return s === Species.Cat || s === 'cat' ? 'cat' : 'corgi';
}

export const isId = (x: unknown): x is string => typeof x === 'string' && ID_RE.test(x);
const isMedal = (x: unknown): x is Medal => x === 'gold' || x === 'silver' || x === 'bronze';
const CHAPTER_IDS = new Set(CHAPTER_PLAN.map((c) => c.id));
export const isChapterId = (x: unknown): x is string => typeof x === 'string' && CHAPTER_IDS.has(x);

const int = (x: unknown, cap: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(cap, Math.floor(x))) : 0);

function idList(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  const out = new Set<string>();
  for (const v of x) { if (isId(v)) out.add(v); if (out.size >= MAX_IDS) break; }
  return [...out].sort();
}

function medalMap(x: unknown): Record<string, Medal> {
  const out: Record<string, Medal> = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  for (const [id, m] of Object.entries(x as Record<string, unknown>)) if (isChapterId(id) && isMedal(m)) out[id] = m;
  return out;
}

function slotMap(x: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  let n = 0;
  for (const [slot, id] of Object.entries(x as Record<string, unknown>)) {
    if (isId(slot) && isId(id)) { out[slot] = id; if (++n >= MAX_SLOTS) break; }
  }
  return out;
}

/** Best of two medal maps (never downgrades). */
export function bestMedals(a: Record<string, Medal>, b: Record<string, Medal>): Record<string, Medal> {
  const out = { ...a };
  for (const [id, m] of Object.entries(b)) if (!out[id] || MEDAL_RANK[m] > MEDAL_RANK[out[id]]) out[id] = m;
  return out;
}

/** Coerces any object into a valid current-version Profile (unknown keys dropped, junk values defaulted). */
export function sanitizeProfile(o: Record<string, unknown>): Profile {
  const st = (o.stats && typeof o.stats === 'object' && !Array.isArray(o.stats) ? o.stats : {}) as Record<string, unknown>;
  const eq = (o.equipped && typeof o.equipped === 'object' && !Array.isArray(o.equipped) ? o.equipped : {}) as Record<string, unknown>;
  const xp = int(o.xp, MAX_XP);
  const unlocked = idList(o.unlocked);
  const had = new Set(unlocked);
  return {
    v: PROFILE_VERSION,
    xp,
    level: levelForXp(xp),
    unlocked,
    seen: idList(o.seen).filter((id) => had.has(id)),
    equipped: { corgi: slotMap(eq.corgi), cat: slotMap(eq.cat) },
    firstWins: idList(o.firstWins),
    medals: medalMap(o.medals),
    medalXp: medalMap(o.medalXp),
    stats: {
      matches: int(st.matches, STAT_CAP), wins: int(st.wins, STAT_CAP), knockouts: int(st.knockouts, STAT_CAP),
      steps: int(st.steps, STAT_CAP), cores: int(st.cores, STAT_CAP), pads: int(st.pads, STAT_CAP), chapters: int(st.chapters, STAT_CAP),
    },
  };
}

/** XP a pre-profile device earns for its adventure paws (each as if recorded once, plus the first ADVENTURE win). */
export function retroXp(medals: Record<string, Medal>): number {
  const ids = Object.keys(medals);
  let xp = 0;
  for (const id of ids) xp += XP.medal[medals[id]] + XP.newBest;
  return ids.length ? xp + XP.firstWin : 0;
}

/** Fold a pre-profile device's adventure progress in: paws, retroactive XP, the first ADVENTURE win, chapter count. */
function foldRetro(p: Profile, adv: AdventureProgress | null): Profile {
  const medals = medalMap(adv?.medals);
  const ids = Object.keys(medals);
  if (!ids.length) return p;
  const xp = Math.min(MAX_XP, p.xp + retroXp(medals));
  return {
    ...p,
    xp, level: levelForXp(xp),
    medals: bestMedals(p.medals, medals),
    medalXp: bestMedals(p.medalXp, medals),
    firstWins: [...new Set([...p.firstWins, 'adventure'])].sort(),
    stats: { ...p.stats, chapters: p.stats.chapters + ids.length },
  };
}

/**
 * Migrate whatever `cvc.profile` held (already JSON-parsed; `undefined` = nothing stored or unparseable) to the current
 * version, folding in this device's adventure progress (`cvc.adventure`, already validated by loadProgress). Pure.
 */
export function migrateProfile(raw: unknown, adv: AdventureProgress | null = null): Profile {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const v = obj && typeof obj.v === 'number' && Number.isFinite(obj.v) ? obj.v : 0;
  if (!obj || v < 1) {
    // v0: no profile yet (or junk). Keep whatever an unversioned object carries that we understand, then fold in the
    // adventure paws with retroactive XP (medalXp starts empty here, so nothing is paid twice).
    const base = obj ? { ...sanitizeProfile(obj), medalXp: {} } : freshProfile();
    return foldRetro(base, adv);
  }
  const p = sanitizeProfile(obj);
  // v1 and newer: adventure paws only widen `medals` (unlocks); XP for them flows through recordMatch.
  return adv ? { ...p, medals: bestMedals(p.medals, medalMap(adv.medals)) } : p;
}

/** True when `raw` (parsed storage) is already a current profile, so a load needs no write-back. */
export function isCurrent(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { v?: unknown }).v === PROFILE_VERSION;
}

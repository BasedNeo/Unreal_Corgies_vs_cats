// OWNER: P2 (profile). The profile on this device: load (migrate + unlocks), save, record a match, equip, read the
// current look. Every storage access is wrapped: private windows, blocked or full storage and junk values all fall back
// to a working profile, kept in memory for the session when it cannot be written.
import { loadProgress, type ProgressStorage } from '../adventure/progress';
import { rewardSummary, type RewardSummary } from './summary';
import { applyMatch } from './record';
import { PROFILE_KEY, isCurrent, migrateProfile, speciesKey, type Profile, type SpeciesKey } from './schema';
import type { MatchResult } from './xp';
import { equip, evaluateUnlocks, lookFor, type CosmeticLike, type EquipRefusal } from './unlocks';

/** Minimal Storage surface (window.localStorage or a test double). */
export interface ProfileKV { getItem(k: string): string | null; setItem(k: string, v: string): void }

function defaultStorage(): ProfileKV | null {
  try { return (globalThis as { localStorage?: ProfileKV }).localStorage ?? null; } catch { return null; }
}

export interface ProfileStoreOptions {
  /** The cosmetic content (C3's COSMETICS; tests pass fixtures). */
  content: readonly CosmeticLike[];
  /** Where `cvc.profile` lives (default localStorage; null = none). */
  storage?: ProfileKV | null;
  /** Where `cvc.adventure` lives (default: the same storage). */
  adventure?: ProgressStorage | null;
}

export type EquipResult = { ok: true; profile: Profile } | { ok: false; profile: Profile; reason: EquipRefusal; id: string };

export class ProfileStore {
  readonly content: readonly CosmeticLike[];
  private readonly storage: ProfileKV | null;
  private readonly adventure: ProgressStorage | null;
  /** The last profile loaded or saved; what a session keeps using when storage refuses writes. */
  private mem: Profile | null = null;
  private unwritten = false;

  constructor(opts: ProfileStoreOptions) {
    this.content = opts.content;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.adventure = opts.adventure === undefined ? this.storage : opts.adventure;
  }

  /** Read, migrate (a pre-profile device keeps every paw) and evaluate unlocks. Never throws. */
  load(): Profile {
    return this.read(true);
  }

  /**
   * `widen` folds this device's `cvc.adventure` paws into a current profile (unlocks see them). recordMatch reads
   * without it: the chapter card (A1) saves a new paw a moment before the result is recorded, and the look that paw
   * unlocks must still come out as NEW on the reward card. A pre-profile (v0) device always folds them in.
   */
  private read(widen: boolean): Profile {
    if (this.unwritten && this.mem) return this.mem; // storage refused our last write: the session copy is newer
    let raw: unknown;
    let readable = true;
    try {
      const s = this.storage?.getItem(PROFILE_KEY);
      if (this.storage === null) readable = false;
      if (s) { try { raw = JSON.parse(s); } catch { raw = undefined; } }
    } catch { readable = false; }
    if (!readable && this.mem) return this.mem;
    const adv = widen || !isCurrent(raw) ? safeAdventure(this.adventure) : null;
    const migrated = migrateProfile(raw, adv);
    const { profile } = evaluateUnlocks(migrated, this.content);
    // Persist a migration (or unlocks the content now grants) so XP already paid is remembered from here on.
    if (widen && readable && (!isCurrent(raw) || profile !== migrated)) this.save(profile);
    if (widen) this.mem = profile;
    return profile;
  }

  /** Write the profile; false when storage refuses (the session keeps it in memory). */
  save(p: Profile): boolean {
    this.mem = p;
    try {
      if (!this.storage) { this.unwritten = true; return false; }
      this.storage.setItem(PROFILE_KEY, JSON.stringify(p));
      this.unwritten = false;
      return true;
    } catch { this.unwritten = true; return false; }
  }

  /**
   * Record one finished match or chapter for the local player (MatchTally builds the result): XP, stats, first wins,
   * paws, unlocks; saved at once. Returns what the reward card shows.
   */
  recordMatch(result: Partial<MatchResult>): RewardSummary {
    const rec = applyMatch(this.read(false), result, this.content);
    // then the device's other paws (cvc.adventure), as every load does
    const { profile } = evaluateUnlocks(migrateProfile(rec.profile, safeAdventure(this.adventure)), this.content);
    this.save(profile);
    return rewardSummary(rec.before, profile, { lines: rec.lines, content: this.content });
  }

  /** Equip slots for a species (refused when any id is locked, unknown, or for another slot or species). */
  equip(species: SpeciesKey | number, look: Readonly<Record<string, string>>): EquipResult {
    const res = equip(this.load(), species, look, this.content);
    if (res.ok) this.save(res.profile);
    return res;
  }

  /** What a species wears now (slot → id), validated against content and unlocks; defaults fill the gaps. */
  currentLook(species: SpeciesKey | number): Record<string, string> {
    return lookFor(this.load(), speciesKey(species), this.content);
  }

  /** The locker has shown these unlocked ids (their NEW badges go away). */
  markSeen(ids: readonly string[]): Profile {
    const p = this.load();
    const add = ids.filter((id) => p.unlocked.includes(id) && !p.seen.includes(id));
    if (!add.length) return p;
    const next = { ...p, seen: [...p.seen, ...add].sort() };
    this.save(next);
    return next;
  }
}

function safeAdventure(s: ProgressStorage | null): ReturnType<typeof loadProgress> | null {
  try { return s ? loadProgress(s) : null; } catch { return null; }
}

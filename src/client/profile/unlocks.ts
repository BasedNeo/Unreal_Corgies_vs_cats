// OWNER: P2 (profile). Unlock rules and equipping, as pure functions over a profile and the cosmetic content (C3:
// src/shared/content/cosmetics.ts COSMETICS; tests pass their own lists). Unlocks are idempotent and never revoke;
// equipping a locked, unknown, wrong-slot or wrong-species id is refused. Nothing here trusts storage: currentLook-style
// reads (lookFor) fall back to the default look for anything that is not (or no longer) valid.
import type { Medal } from '../../shared/content/chapters';
import { MEDAL_RANK } from '../adventure/progress';
import { MAX_IDS, speciesKey, type Profile, type SpeciesKey } from './schema';

/** An unlock rule, normalized (C3's `unlock` field: default | level | medal(chapter, medal) | firstWin(mode)). */
export type UnlockRule =
  | { kind: 'default' }
  | { kind: 'level'; level: number }
  | { kind: 'medal'; chapter: string; medal: Medal }
  | { kind: 'firstWin'; mode: string }
  /** A rule this build does not understand: stays locked (never unlocks by accident). */
  | { kind: 'never' };

/** The fields of a cosmetic this module reads (C3's CosmeticDef is assignable to it). */
export interface CosmeticLike {
  readonly id: string;
  readonly slot: string;
  /** Which species can wear it: a SpeciesId or 'corgi' / 'cat'; anything else (absent, 'any', 'both') = both. */
  readonly species?: unknown;
  readonly name: string;
  readonly unlock: unknown;
}

const isMedal = (x: unknown): x is Medal => x === 'gold' || x === 'silver' || x === 'bronze';

/** Reads an unlock rule in any of the shapes C3 may use: 'default', { kind | type: … }, level as `level` / `n`. */
export function ruleOf(item: Pick<CosmeticLike, 'unlock'>): UnlockRule {
  const u = item.unlock as unknown;
  if (u === 'default' || u === undefined || u === null) return { kind: 'default' };
  if (typeof u !== 'object') return { kind: 'never' };
  const o = u as Record<string, unknown>;
  const kind = String(o.kind ?? o.type ?? '').replace(/[_-]/g, '').toLowerCase();
  if (kind === 'default') return { kind: 'default' };
  if (kind === 'level') {
    const n = Number(o.level ?? o.n ?? o.value);
    return Number.isFinite(n) && n >= 1 ? { kind: 'level', level: Math.floor(n) } : { kind: 'never' };
  }
  if (kind === 'medal') {
    const chapter = o.chapter, medal = o.medal;
    return typeof chapter === 'string' && isMedal(medal) ? { kind: 'medal', chapter, medal } : { kind: 'never' };
  }
  if (kind === 'firstwin') return typeof o.mode === 'string' ? { kind: 'firstWin', mode: o.mode } : { kind: 'never' };
  return { kind: 'never' };
}

/** Which species an item is for ('any' = both). */
export function speciesOf(item: Pick<CosmeticLike, 'species'>): SpeciesKey | 'any' {
  const s = item.species;
  if (s === 0 || s === 'corgi') return 'corgi';
  if (s === 1 || s === 'cat') return 'cat';
  return 'any';
}

export function fitsSpecies(item: Pick<CosmeticLike, 'species'>, species: SpeciesKey): boolean {
  const s = speciesOf(item);
  return s === 'any' || s === species;
}

/** Is a rule met by this profile (level, best paw, first wins)? */
export function ruleMet(p: Pick<Profile, 'level' | 'medals' | 'firstWins'>, rule: UnlockRule): boolean {
  switch (rule.kind) {
    case 'default': return true;
    case 'level': return p.level >= rule.level;
    case 'medal': { const have = p.medals[rule.chapter]; return !!have && MEDAL_RANK[have] >= MEDAL_RANK[rule.medal]; }
    case 'firstWin': return p.firstWins.includes(rule.mode);
    case 'never': return false;
  }
}

export function isDefault(item: CosmeticLike): boolean {
  return ruleOf(item).kind === 'default';
}

/** Can the player wear it now? Defaults always; anything else once earned (earned ids are never revoked). */
export function isUnlocked(p: Pick<Profile, 'unlocked'>, item: CosmeticLike): boolean {
  return isDefault(item) || p.unlocked.includes(item.id);
}

/**
 * Add every look whose rule the profile now meets. Idempotent (a second call adds nothing and returns the same
 * profile object) and never revokes (ids already earned stay, even ones the content no longer lists).
 */
export function evaluateUnlocks<P extends Profile>(p: P, content: readonly CosmeticLike[]): { profile: P; newly: string[] } {
  const have = new Set(p.unlocked);
  const newly: string[] = [];
  for (const item of content) {
    if (have.has(item.id) || have.size >= MAX_IDS) continue;
    const rule = ruleOf(item);
    if (rule.kind === 'default' || !ruleMet(p, rule)) continue;
    have.add(item.id);
    newly.push(item.id);
  }
  if (!newly.length) return { profile: p, newly };
  return { profile: { ...p, unlocked: [...have].sort() }, newly };
}

export type EquipRefusal = 'unknown' | 'slot' | 'species' | 'locked';

/**
 * Equip one or more slots for a species: `look` maps slot → look id. All or nothing: any unknown, wrong-slot,
 * wrong-species or locked id refuses the whole change (the profile comes back unchanged).
 */
export function equip<P extends Profile>(
  p: P, species: SpeciesKey | number, look: Readonly<Record<string, string>>, content: readonly CosmeticLike[],
): { ok: true; profile: P } | { ok: false; profile: P; reason: EquipRefusal; id: string } {
  const sp = speciesKey(species);
  const byId = new Map(content.map((c) => [c.id, c]));
  for (const [slot, id] of Object.entries(look)) {
    const item = byId.get(id);
    if (!item) return { ok: false, profile: p, reason: 'unknown', id };
    if (item.slot !== slot) return { ok: false, profile: p, reason: 'slot', id };
    if (!fitsSpecies(item, sp)) return { ok: false, profile: p, reason: 'species', id };
    if (!isUnlocked(p, item)) return { ok: false, profile: p, reason: 'locked', id };
  }
  return { ok: true, profile: { ...p, equipped: { ...p.equipped, [sp]: { ...p.equipped[sp], ...look } } } };
}

/** Slots in content order (C3: coat, neck, taunt). */
export function slotsOf(content: readonly CosmeticLike[]): string[] {
  return [...new Set(content.map((c) => c.slot))];
}

/** The default item of a slot for a species (the first default in content order), if any. */
export function defaultItem(content: readonly CosmeticLike[], species: SpeciesKey, slot: string): CosmeticLike | undefined {
  return content.find((c) => c.slot === slot && fitsSpecies(c, species) && isDefault(c));
}

/**
 * The look a species wears now, slot → id: the equipped id when it is still known, fits and is unlocked; otherwise the
 * slot's default. Slots with neither are left out.
 */
export function lookFor(p: Pick<Profile, 'equipped' | 'unlocked'>, species: SpeciesKey | number, content: readonly CosmeticLike[]): Record<string, string> {
  const sp = speciesKey(species);
  const out: Record<string, string> = {};
  const byId = new Map(content.map((c) => [c.id, c]));
  for (const slot of slotsOf(content)) {
    const id = p.equipped[sp]?.[slot];
    const item = id !== undefined ? byId.get(id) : undefined;
    if (item && item.slot === slot && fitsSpecies(item, sp) && isUnlocked(p, item)) { out[slot] = item.id; continue; }
    const d = defaultItem(content, sp, slot);
    if (d) out[slot] = d.id;
  }
  return out;
}

/** The next level that unlocks something, and what (the "always show the next reward" line). Null when none left. */
export function nextLevelUnlock(p: Pick<Profile, 'level' | 'unlocked'>, content: readonly CosmeticLike[]): { level: number; items: CosmeticLike[] } | null {
  let best = Infinity;
  const at = new Map<number, CosmeticLike[]>();
  for (const item of content) {
    const r = ruleOf(item);
    if (r.kind !== 'level' || r.level <= p.level || p.unlocked.includes(item.id)) continue;
    best = Math.min(best, r.level);
    at.set(r.level, [...(at.get(r.level) ?? []), item]);
  }
  return Number.isFinite(best) ? { level: best, items: at.get(best)! } : null;
}

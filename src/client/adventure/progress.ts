// Adventure progress on this device (cosmetic): localStorage `cvc.adventure` = { unlocked: n, medals: { id: medal } }.
// It unlocks chapters in the menu picker and remembers the best paw per chapter. It never gates anything the
// authority decides (a ?chapter= link plays any chapter). Every storage access is wrapped in try/catch: private
// windows, blocked storage and junk values all fall back to "chapter 1 unlocked, no medals".
import { CHAPTER_PLAN, type Medal } from '../../shared/content/chapters';

export const PROGRESS_KEY = 'cvc.adventure';

export interface AdventureProgress {
  /** Highest chapter index the player may pick (1 = only the first). */
  unlocked: number;
  /** Best paw per chapter id. */
  medals: Record<string, Medal>;
}

export interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const MEDAL_RANK: Record<Medal, number> = { bronze: 1, silver: 2, gold: 3 };

function defaultStorage(): ProgressStorage | null {
  try { return (globalThis as { localStorage?: ProgressStorage }).localStorage ?? null; } catch { return null; }
}

export function freshProgress(): AdventureProgress {
  return { unlocked: 1, medals: {} };
}

/** Read the saved progress (validated; anything odd → a fresh start). */
export function loadProgress(storage: ProgressStorage | null = defaultStorage()): AdventureProgress {
  const out = freshProgress();
  try {
    const raw = storage?.getItem(PROGRESS_KEY);
    if (!raw) return out;
    const v = JSON.parse(raw) as { unlocked?: unknown; medals?: unknown };
    if (typeof v.unlocked === 'number' && Number.isFinite(v.unlocked)) out.unlocked = Math.max(1, Math.min(CHAPTER_PLAN.length, Math.floor(v.unlocked)));
    if (v.medals && typeof v.medals === 'object') {
      for (const [id, m] of Object.entries(v.medals as Record<string, unknown>)) {
        if (CHAPTER_PLAN.some((c) => c.id === id) && (m === 'gold' || m === 'silver' || m === 'bronze')) out.medals[id] = m;
      }
    }
  } catch { /* unreadable or junk: fresh start */ }
  return out;
}

/** Write progress; false when storage is unavailable (the game carries on). */
export function saveProgress(p: AdventureProgress, storage: ProgressStorage | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(PROGRESS_KEY, JSON.stringify({ unlocked: p.unlocked, medals: p.medals }));
    return true;
  } catch { return false; }
}

/** Progress after finishing chapter `index` (`id`) with `medal`: the next chapter unlocks, the best paw is kept. */
export function withCompletion(p: AdventureProgress, id: string, index: number, medal: Medal): AdventureProgress {
  const best = p.medals[id];
  return {
    unlocked: Math.max(p.unlocked, Math.min(CHAPTER_PLAN.length, index + 1)),
    medals: { ...p.medals, [id]: best && MEDAL_RANK[best] >= MEDAL_RANK[medal] ? best : medal },
  };
}

/** Load, record a completion and save in one go (returns what was saved, and whether the medal is a new best). */
export function recordCompletion(id: string, index: number, medal: Medal, storage: ProgressStorage | null = defaultStorage()): { progress: AdventureProgress; newBest: boolean } {
  const before = loadProgress(storage);
  const progress = withCompletion(before, id, index, medal);
  saveProgress(progress, storage);
  return { progress, newBest: progress.medals[id] !== before.medals[id] };
}

export function isUnlocked(p: AdventureProgress, index: number): boolean {
  return index <= p.unlocked;
}

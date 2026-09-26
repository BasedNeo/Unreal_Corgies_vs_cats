// OWNER: P2 (profile). XP for one match or chapter, as a pure function of its result for the local player and the
// profile before it, and the level curve. Numbers, reasoning and the simulated-player proof: docs/handoff/P2.md §2.
//
// Design (game-design-psychology): early levels are fast (the first match always levels up, so a fresh device sees a
// level-up and a new look before its second match), later ones slow down gently; every source is visible on the
// reward card; progress never touches stats (MASTER_PLAN §0: no combat-power progression).
import { CHAPTER_PLAN, type Medal } from '../../shared/content/chapters';
import { MEDAL_RANK } from '../adventure/progress';

/** XP per source. Counts are capped per match (CAPS) so no single match (or a corrupted result) runs away. */
export const XP = {
  /** Finished a match or chapter you played at least MIN_PLAY_SECONDS of. */
  played: 60,
  win: 100,
  draw: 60,
  loss: 40,
  /** Per knockout you landed. */
  knockout: 10,
  /** Per objective step your team completed (adventure steps, Squeaker mission steps). */
  step: 15,
  /** Per Upgrade Core you took. */
  core: 10,
  /** Per Core Pad captured with you on it. */
  pad: 20,
  /** Chapter completed, by paw. */
  medal: { bronze: 30, silver: 50, gold: 80 } as Record<Medal, number>,
  /** The first paw on a chapter, or a better one than XP was ever paid for. */
  newBest: 40,
  /** The first win in a mode (once per mode, ever). */
  firstWin: 150,
} as const;

export const CAPS = { knockouts: 25, steps: 12, cores: 8, pads: 10 } as const;

/** Shorter than this in the match (joined at the horn, quit at once) → event XP only: no played, outcome, paw or
 *  first-win XP. Every real match and chapter lasts minutes. */
export const MIN_PLAY_SECONDS = 30;

// ------------------------------------------------------------------------------------------------ level curve
/** XP from level 1 to 2: one match of any kind (played + a loss = 100). */
export const FIRST_LEVEL_XP = 100;
/** Then each level costs STEP_BASE + STEP_GROW × (level − 2): 200, 250, 300, … (≈ 1 match early, ≈ 3 by level 10). */
export const STEP_BASE = 200;
export const STEP_GROW = 50;
export const MAX_LEVEL = 99;

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return level <= 1 ? FIRST_LEVEL_XP : STEP_BASE + STEP_GROW * (Math.floor(level) - 2);
}

/** Total XP at which `level` is reached (level 1 = 0). */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  if (l <= 1) return 0;
  const k = l - 2; // levels past 2
  return FIRST_LEVEL_XP + k * STEP_BASE + (STEP_GROW * k * (k - 1)) / 2;
}

/** XP is capped at the top of the curve. */
export const MAX_XP = xpForLevel(MAX_LEVEL);

export function levelForXp(xp: number): number {
  const x = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  let l = 1;
  while (l < MAX_LEVEL && xpForLevel(l + 1) <= x) l++;
  return l;
}

/** Where `xp` sits inside its level (for the XP bar). At the cap, the bar is full. */
export function levelProgress(xp: number): { level: number; into: number; need: number; frac: number } {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return { level, into: 0, need: 0, frac: 1 };
  const into = Math.max(0, Math.floor(xp) - xpForLevel(level));
  const need = xpToNext(level);
  return { level, into, need, frac: Math.min(1, into / need) };
}

// ------------------------------------------------------------------------------------------------ match result
export type MatchOutcome = 'win' | 'loss' | 'draw';

/** One match or chapter, from the local player's side (built by MatchTally from events, or by hand). */
export interface MatchResult {
  /** MatchState.mode: 'team-deathmatch', 'core-rush', 'yard-skirmish', 'adventure', … */
  mode: string;
  outcome: MatchOutcome;
  knockouts?: number;
  steps?: number;
  cores?: number;
  pads?: number;
  /** A completed adventure chapter and its paw. */
  chapter?: { id: string; medal: Medal } | null;
  /** Seconds the local player was in the live match (absent = a full match). */
  seconds?: number;
}

export type XpKind = 'played' | 'win' | 'draw' | 'loss' | 'knockouts' | 'steps' | 'cores' | 'pads' | 'medal' | 'newBest' | 'firstWin';
/** One reward-card line: `count` for per-event kinds, `medal` for paw lines, `mode` for the first-win line. */
export interface XpLine { kind: XpKind; xp: number; count?: number; medal?: Medal; mode?: string }

const MODE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const count = (x: unknown, cap: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(cap, Math.floor(x))) : 0);
const CHAPTER_IDS = new Set(CHAPTER_PLAN.map((c) => c.id));

/** A result with every field valid (unknown mode → '', bad counts → 0, capped; an unknown chapter is dropped). */
export function sanitizeResult(r: Partial<MatchResult> | null | undefined): Required<Omit<MatchResult, 'chapter'>> & { chapter: MatchResult['chapter'] } {
  const o = (r ?? {}) as Partial<MatchResult>;
  const ch = o.chapter && CHAPTER_IDS.has(o.chapter.id) && (o.chapter.medal === 'gold' || o.chapter.medal === 'silver' || o.chapter.medal === 'bronze')
    ? { id: o.chapter.id, medal: o.chapter.medal } : null;
  return {
    mode: typeof o.mode === 'string' && MODE_RE.test(o.mode) ? o.mode : '',
    outcome: o.outcome === 'win' || o.outcome === 'draw' ? o.outcome : 'loss',
    knockouts: count(o.knockouts, CAPS.knockouts),
    steps: count(o.steps, CAPS.steps),
    cores: count(o.cores, CAPS.cores),
    pads: count(o.pads, CAPS.pads),
    chapter: ch,
    seconds: typeof o.seconds === 'number' && Number.isFinite(o.seconds) ? Math.max(0, o.seconds) : Infinity,
  };
}

/** What XP a profile has already been paid for (the part of Profile matchXp reads). */
export interface XpHistory { firstWins: readonly string[]; medalXp: Readonly<Record<string, Medal>> }

/**
 * XP for one match or chapter: a pure function of its result and what the profile had already earned (first wins,
 * paws paid for). Lines come out in reward-card order; zero lines are left out.
 */
export function matchXp(result: Partial<MatchResult>, before: XpHistory): { total: number; lines: XpLine[] } {
  const r = sanitizeResult(result);
  const lines: XpLine[] = [];
  const full = r.seconds >= MIN_PLAY_SECONDS;
  if (full) {
    lines.push({ kind: 'played', xp: XP.played });
    lines.push({ kind: r.outcome, xp: XP[r.outcome] });
  }
  if (r.knockouts) lines.push({ kind: 'knockouts', count: r.knockouts, xp: r.knockouts * XP.knockout });
  if (r.steps) lines.push({ kind: 'steps', count: r.steps, xp: r.steps * XP.step });
  if (r.cores) lines.push({ kind: 'cores', count: r.cores, xp: r.cores * XP.core });
  if (r.pads) lines.push({ kind: 'pads', count: r.pads, xp: r.pads * XP.pad });
  if (full && r.chapter) {
    const { id, medal } = r.chapter;
    lines.push({ kind: 'medal', medal, xp: XP.medal[medal] });
    const paid = before.medalXp[id];
    if (!paid || MEDAL_RANK[medal] > MEDAL_RANK[paid]) lines.push({ kind: 'newBest', medal, xp: XP.newBest });
  }
  if (full && r.outcome === 'win' && r.mode && !before.firstWins.includes(r.mode)) lines.push({ kind: 'firstWin', xp: XP.firstWin, mode: r.mode });
  return { total: lines.reduce((s, l) => s + l.xp, 0), lines };
}

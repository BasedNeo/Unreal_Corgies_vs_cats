// OWNER: P2 (profile). One match or chapter applied to a profile: XP (xp.ts), stats, first wins, paws, then unlocks.
// Pure: the store (store.ts) loads, calls this, saves.
import { MIN_PLAY_SECONDS, MAX_XP, levelForXp, matchXp, sanitizeResult, type MatchResult, type XpLine } from './xp';
import { bestMedals, type Profile } from './schema';
import { evaluateUnlocks, type CosmeticLike } from './unlocks';

export interface MatchRecord {
  before: Profile;
  profile: Profile;
  /** XP this result earned (after the cap at the top of the curve). */
  xp: number;
  lines: XpLine[];
  /** Look ids this result unlocked (content order). */
  newly: string[];
}

export function applyMatch(before: Profile, result: Partial<MatchResult>, content: readonly CosmeticLike[]): MatchRecord {
  const r = sanitizeResult(result);
  const { total, lines } = matchXp(r, before);
  const full = r.seconds >= MIN_PLAY_SECONDS;
  const win = full && r.outcome === 'win';
  const xp = Math.min(MAX_XP, before.xp + total);
  const ch = r.chapter;
  const next: Profile = {
    ...before,
    xp,
    level: levelForXp(xp),
    firstWins: win && r.mode && !before.firstWins.includes(r.mode) ? [...before.firstWins, r.mode].sort() : before.firstWins,
    medals: ch ? bestMedals(before.medals, { [ch.id]: ch.medal }) : before.medals,
    medalXp: ch && full ? bestMedals(before.medalXp, { [ch.id]: ch.medal }) : before.medalXp,
    stats: {
      matches: before.stats.matches + (full ? 1 : 0),
      wins: before.stats.wins + (win ? 1 : 0),
      knockouts: before.stats.knockouts + r.knockouts,
      steps: before.stats.steps + r.steps,
      cores: before.stats.cores + r.cores,
      pads: before.stats.pads + r.pads,
      chapters: before.stats.chapters + (ch && full ? 1 : 0),
    },
  };
  const { profile, newly } = evaluateUnlocks(next, content);
  return { before, profile, xp: xp - before.xp, lines, newly };
}

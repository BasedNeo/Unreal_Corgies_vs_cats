// OWNER: P2 (profile). What changed between two profiles (before and after a match), for the reward card
// (src/client/ui/rewards.ts re-exports it). Pure: no DOM.
import type { Profile } from './schema';
import { levelProgress, type XpLine } from './xp';
import { nextLevelUnlock, speciesOf, type CosmeticLike } from './unlocks';

export interface RewardLook { id: string; name: string; slot: string; species: 'corgi' | 'cat' | 'any' }

export interface RewardSummary {
  /** XP earned (after − before). */
  xp: number;
  lines: XpLine[];
  levelBefore: number;
  levelAfter: number;
  levelUps: number;
  /** XP bar: where it started (fraction of the starting level) and where it ends (fraction of the final level). */
  bar: { from: number; to: number; into: number; need: number };
  /** Looks unlocked by this result (content order when content is given). */
  newLooks: RewardLook[];
  /** The next level that unlocks something, and its looks. */
  next: { level: number; looks: RewardLook[] } | null;
  /** Nothing worth a card (no XP, no look). */
  empty: boolean;
}

function toLook(item: CosmeticLike): RewardLook {
  return { id: item.id, name: item.name, slot: item.slot, species: speciesOf(item) };
}

/** What changed between two profiles (before and after a match), for the reward card. Pure. */
export function rewardSummary(before: Profile, after: Profile, opts: { lines?: XpLine[]; content?: readonly CosmeticLike[] } = {}): RewardSummary {
  const content = opts.content ?? [];
  const byId = new Map(content.map((c) => [c.id, c]));
  const had = new Set(before.unlocked);
  const gained = after.unlocked.filter((id) => !had.has(id));
  const order = new Map(content.map((c, i) => [c.id, i]));
  gained.sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || (a < b ? -1 : a > b ? 1 : 0));
  const newLooks = gained.map((id) => { const it = byId.get(id); return it ? toLook(it) : { id, name: id.replace(/_/g, ' '), slot: '', species: 'any' as const }; });
  const pb = levelProgress(before.xp), pa = levelProgress(after.xp);
  const xp = Math.max(0, after.xp - before.xp);
  const nx = content.length ? nextLevelUnlock(after, content) : null;
  return {
    xp,
    lines: opts.lines ?? [],
    levelBefore: pb.level,
    levelAfter: pa.level,
    levelUps: Math.max(0, pa.level - pb.level),
    bar: { from: pb.frac, to: pa.frac, into: pa.into, need: pa.need },
    newLooks,
    next: nx ? { level: nx.level, looks: nx.items.map(toLook) } : null,
    empty: xp === 0 && newLooks.length === 0,
  };
}

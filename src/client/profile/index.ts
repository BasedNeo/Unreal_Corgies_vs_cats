// OWNER: P2 (profile). The public profile API for the lead and the UI (docs/handoff/P2.md §3):
//   currentLook(species)   the look to put in hello on the next spawn (every slot filled, validated)
//   recordMatch(result)    at a match / chapter end → the RewardSummary for the reward card (ui/rewards.ts)
//   MatchTally             builds that result from bus 'game' events + per-frame MatchState/entity states
//   loadProfile / equipLook / markLooksSeen   the locker (ui/locker.ts)
// One store over localStorage `cvc.profile` and C3's COSMETICS; tests build their own ProfileStore.
import { COSMETICS, resolveLook, type Look } from '../../shared/content/cosmetics';
import type { SpeciesId } from '../../shared/types';
import type { RewardSummary } from './summary';
import { ProfileStore, type EquipResult } from './store';
import type { Profile, SpeciesKey } from './schema';
import type { MatchResult } from './xp';

export { MatchTally, type TallyFrame } from './tally';
export { ProfileStore, type EquipResult, type ProfileKV } from './store';
export type { Profile, SpeciesKey } from './schema';
export type { MatchResult, XpLine } from './xp';
export { rewardSummary, type RewardSummary, type RewardLook } from './summary';

let store: ProfileStore | null = null;

/** The device's profile store (created on first use, over localStorage; storage failures are handled inside). */
export function profileStore(): ProfileStore {
  return (store ??= new ProfileStore({ content: COSMETICS }));
}

/** Tests and labs: use another store (e.g. over a fake storage). */
export function setProfileStore(s: ProfileStore | null): void {
  store = s;
}

export function loadProfile(): Profile {
  return profileStore().load();
}

/** The look a species wears on its next spawn: every slot filled, only unlocked ids that fit (defaults otherwise). */
export function currentLook(species: SpeciesId | SpeciesKey): Required<Look> {
  return resolveLook(profileStore().currentLook(species), species);
}

/** Record a finished match or chapter (MatchTally's result) and get the reward card's summary. Saved at once. */
export function recordMatch(result: Partial<MatchResult>): RewardSummary {
  return profileStore().recordMatch(result);
}

/** Equip slots for a species; refused (profile unchanged) when an id is locked, unknown, or for another slot/species. */
export function equipLook(species: SpeciesId | SpeciesKey, look: Look): EquipResult {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(look)) if (typeof v === 'string') clean[k] = v;
  return profileStore().equip(species, clean);
}

export function markLooksSeen(ids: readonly string[]): Profile {
  return profileStore().markSeen(ids);
}

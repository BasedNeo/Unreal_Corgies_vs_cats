// OWNER: L5 (juice). UI strings + presentation-only tuning (MASTER_PLAN §12: UI strings are theme data).
// Original copy — no quotes, names or jokes from any existing franchise.
import type { ClassId } from '../../shared/types';

export const TITLE = { left: 'CORGIS', vs: 'VS', right: 'CATS', tagline: 'The backyard war for the last tennis ball.' };

export const TEAM_NAMES = ['CORGIS', 'CATS'] as const;

/** Menu blurbs per class (role line comes from shared content; this is the flavor sentence). */
export const CLASS_BLURBS: Record<ClassId, string> = {
  assault: 'Squeaker rifle, loud bark, zero chill. First through the gate.',
  infiltrator: 'Vanishes in tall grass. Reappears behind you. Snap.',
  overwatch: 'Laser pointer on a long leash. Patience is a treat.',
  breacher: 'Tennis-ball mortar and a digging problem. Walls are suggestions.',
  warden: 'Holds the porch. Sprinkler cannon keeps the lawn contested.',
  skyraider: 'Ears for wings. Frisbees from above. Lands… mostly.',
};

export const ABILITY_LABELS: Record<string, string> = {
  bark_blast: 'Bark Blast', shadow_cloak: 'Shadow Cloak', spotter_drone: 'Spotter Drone',
  dig_charge: 'Dig Charge', squeak_barrier: 'Squeak Barrier', ear_glide: 'Ear Glide',
};

/** Client-side cooldown estimates (s) used only when the lead can't pass authoritative values via HudModel.ability. */
export const ABILITY_COOLDOWN_ESTIMATE: Record<string, number> = {
  bark_blast: 8, shadow_cloak: 12, spotter_drone: 15, dig_charge: 10, squeak_barrier: 14, ear_glide: 6,
};

/** Default respawn countdown (s) when HudModel.respawnIn is not provided. */
export const RESPAWN_ESTIMATE = 5;
/** Default reload duration (s) for the progress chip when HudModel.reloadFrac is not provided. */
export const RELOAD_ESTIMATE = 1.6;

export const DEATH_QUIPS = {
  corgi: ['Walk it off, pup.', 'Good boy. Bad angle.', 'Nap time. Brief nap.', 'The ball will wait for you.', 'Shake it off. Literally.'],
  cat: ['Eight lives left. Probably.', 'Meant to do that.', 'Dignity: bruised. Fur: everywhere.', 'Plotting revenge…', 'Land on your feet next time.'],
};

export const CONTROLS: Array<[string, string]> = [
  ['WASD', 'Move'], ['SPACE ×2', 'Double jump'], ['SHIFT', 'Zoomies'], ['MOUSE', 'Aim · fire'],
  ['RMB', 'Aim down'], ['Q', 'Ability'], ['R', 'Reload'], ['TAB', 'Scoreboard'],
];

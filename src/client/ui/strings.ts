// OWNER: L5 (juice). UI strings + presentation-only tuning (MASTER_PLAN §12: UI strings are theme data).
// Original copy — no quotes, names or jokes from any existing franchise.
import type { ClassId } from '../../shared/types';
import { ABILITIES } from '../../shared/content/abilities';
import { COMBAT_RULES } from '../../shared/content/weapons';

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
// Cooldowns and respawn time come from the authority's content tables so the HUD never contradicts the sim.
export const ABILITY_COOLDOWN_ESTIMATE: Record<string, number> = Object.fromEntries(
  Object.entries(ABILITIES).map(([id, def]) => [id, def.cooldown]),
);

/** Default respawn countdown (s) when HudModel.respawnIn is not provided. */
export const RESPAWN_ESTIMATE = COMBAT_RULES.respawnDelay;
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

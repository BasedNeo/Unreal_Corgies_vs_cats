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
  ['RMB', 'Aim down'], ['Q', 'Ability'], ['R', 'Reload'], ['E', 'Interact'], ['C', 'Slide · pound'], ['B', 'Taunt'],
  ['ENTER', 'Chat'], ['TAB', 'Scoreboard'],
];

// ---- U1 (ux): chat, room browser, first-match tips, quality notice ----

export const CHAT_STRINGS = {
  channel: 'ALL',
  logLabel: 'Chat',
  inputLabel: 'Chat message',
  hint: 'ENTER send · ESC cancel',
  tooFast: 'Easy, pup: one message a second',
  sending: 'sending…',
  failed: 'not delivered',
  you: 'You',
};

/** Keycap markup for tips: `[E]` renders as a key. Text only, no HTML. */
export const TIP_TEXT = {
  basics: '[WASD] move · [MOUSE] aim · [LMB] fire · hold [RMB] to aim down',
  kiosk: 'Press [E] at the Ordnance Kiosk to change kit',
  moves: 'Crouch [C] while sprinting [SHIFT] to slide · crouch in the air to ground-pound',
} as const;

export const TIP_STRINGS = { tag: 'TIP', resetLabel: 'FIRST-MATCH TIPS', resetButton: 'SHOW AGAIN', resetDone: 'RESET ✓', resetNote: 'Tips show again in your next match' };

export const ROOM_STRINGS = {
  title: 'ONLINE ROOMS',
  loading: 'Sniffing out rooms…',
  empty: 'No rooms yet. Start one below and share its name.',
  error: 'Can’t reach that server. Is it running?',
  busy: 'The server is busy. Trying again shortly.',
  offline: 'You’re offline. Reconnect to see rooms.',
  badUrl: 'Enter a server address that starts with ws:// or wss://',
  join: 'JOIN',
  full: 'FULL',
  create: 'CREATE ▸',
  createLabel: 'NEW ROOM',
  unlisted: 'Unlisted',
  unlistedHint: 'Unlisted rooms never show here: share the name to invite',
  back: '‹ CLASSES',
  retry: 'RETRY',
  browse: 'ROOMS ▸',
  quickJoin: 'QUICK JOIN',
  headRoom: 'ROOM', headMode: 'MODE', headPlayers: 'PLAYERS', headPhase: 'STATUS',
};

export const QUALITY_STRINGS = {
  /** World detail is built once at load: foliage, shadow map, clouds, ground shading, rain. */
  reload: 'Shadows, glow, resolution, tall grass, effects and sound switched already. Lawn detail and sky change after a reload.',
  reloadInMatch: 'Reloading leaves this match.',
  reloadButton: 'RELOAD NOW',
};

// ---- A1 (adventure): chapter picker, captions, chapter-complete card ----
export const ADVENTURE_STRINGS = {
  matchLabel: 'ADVENTURE',
  matchHint: 'Story mode: six chapters, one district each. Solo with pups or co-op.',
  pickerTitle: 'THE LAST TENNIS BALL',
  pickerNote: 'pick a chapter',
  chapter: 'CHAPTER',
  comingSoon: 'COMING SOON',
  locked: 'LOCKED',
  lockedHint: (n: number) => `Finish chapter ${n} first`,
  featured: 'FEATURED KIT',
  kitNote: 'swap kits at any Ordnance Kiosk',
  play: 'PLAY CHAPTER ▸',
  skip: 'skip',
  squadDown: 'SQUAD DOWN!',
  backToCheckpoint: (n: number) => `Back to the checkpoint in ${n}…`,
  complete: 'CHAPTER COMPLETE!',
  time: 'TIME',
  par: 'PAR',
  newBest: 'NEW BEST!',
  next: 'NEXT CHAPTER ▸',
  replay: '↻ REPLAY',
  nextSoon: 'MORE CHAPTERS SOON',
  nextIn: (n: number) => `Next chapter in ${n}s`,
  replayIn: (n: number) => `Replaying in ${n}s`,
  medal: { gold: 'GOLD PAW', silver: 'SILVER PAW', bronze: 'BRONZE PAW' } as Record<'gold' | 'silver' | 'bronze', string>,
  keysHint: '[ENTER] next · [BACKSPACE] replay',
  sentryCone: 'sentry',
};

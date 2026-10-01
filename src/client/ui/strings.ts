// OWNER: L5 (juice). UI strings + presentation-only tuning (MASTER_PLAN §12: UI strings are theme data).
// Original copy — no quotes, names or jokes from any existing franchise.
import type { ClassId } from '../../shared/types';
import { ABILITIES } from '../../shared/content/abilities';
import { COMBAT_RULES } from '../../shared/content/weapons';
import { BASE_ASSAULT } from '../../shared/content/modes';

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
  ['WASD', 'Move'], ['SPACE ×2', 'Jump'], ['SHIFT', 'Zoomies'], ['MOUSE', 'Aim · fire'],
  ['RMB', 'Zoom'], ['Q', 'Ability'], ['R', 'Reload'], ['E', 'Interact'], ['C', 'Slide · pound'], ['B', 'Taunt'],
  ['ENTER', 'Chat'], ['TAB', 'Scores'], // short labels: the menu footer fits one row at 1280×720 (Q2 P2-7)
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
  basics: '[WASD] move · [MOUSE] aim · [LMB] fire · hold [RMB] to zoom',
  kiosk: 'Press [E] at the Ordnance Kiosk to change kit',
  moves: 'Crouch [C] while sprinting [SHIFT] to slide · crouch in the air to ground-pound',
  // W10 U3: Base Assault, first Base Assault match only (tips.ts BA_TIP_IDS)
  ba_goal: `Steal their squeaky ball from its stand, run it home, touch your flag's ring to capture · first to ${BASE_ASSAULT.captureLimit}`,
  ba_carry: 'Escort your carrier home: with the ball it runs slower and can\'t glide or ride',
  ba_home: 'They have our ball! We can only capture while our own ball is home: stop their carrier',
  ba_return: `Our ball is down: touch it to send it home now, or it goes back by itself in ${BASE_ASSAULT.returnTime} s`,
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
  backChapters: '‹ CHAPTERS',
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
  matchHint: 'Story mode: seven chapters, solo with pups or co-op',
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
  theEnd: 'THE END!',
  theEndLine: 'Every chapter done. The yard is safe… for now.',
  toMenu: 'MAIN MENU ▸',
  fromTopIn: (n: number) => `Back to chapter 1 in ${n}s`,
  keysHintEnd: '[ENTER] main menu · [BACKSPACE] replay',
  replayIn: (n: number) => `Replaying in ${n}s`,
  medal: { gold: 'GOLD PAW', silver: 'SILVER PAW', bronze: 'BRONZE PAW' } as Record<'gold' | 'silver' | 'bronze', string>,
  keysHint: '[ENTER] next · [BACKSPACE] replay',
  sentryCone: 'sentry',
};

// ---- P2/U2 (profile + ux): the LOCKER view and the reward card ----
/** Mode names for first-win lines and hints (MatchState.mode / C3 FIRST_WIN_MODES ids). */
export const MODE_NAMES: Record<string, string> = {
  'yard-skirmish': 'Skirmish', 'team-deathmatch': 'Deathmatch', 'core-rush': 'Core Rush', 'base-assault': 'Base Assault', 'boss-rush': 'Boss Rush', adventure: 'Adventure',
  slab: 'Slab', // W13: the Godot game's match on The Lot
};

export const LOCKER_STRINGS = {
  button: 'LOCKER',
  title: 'LOCKER',
  note: 'looks never change stats',
  species: { corgi: 'CORGI', cat: 'CAT' } as Record<'corgi' | 'cat', string>,
  slots: { coat: 'COAT', neck: 'NECKWEAR', taunt: 'TAUNTS' } as Record<string, string>,
  level: 'LV',
  xp: 'XP',
  xpOf: (into: number, need: number) => `${into} / ${need} XP`,
  maxed: 'MAX',
  next: (level: number, name: string) => `Next look at level ${level}: ${name}`,
  nextMore: (level: number, name: string, more: number) => `Next looks at level ${level}: ${name} +${more}`,
  noNext: 'Every level look is yours. Paws and first wins still unlock more.',
  equipped: 'WEARING',
  isNew: 'NEW',
  locked: 'LOCKED',
  wearNote: (name: string) => `${name} on. You wear it from your next spawn.`,
  lockedNote: (name: string, hint: string) => `${name} is locked · ${hint}`,
  idle: 'Pick a look to wear it. It shows from your next spawn, online too.',
  back: '‹ CLASSES',
  backChapters: '‹ CHAPTERS',
  newCount: (n: number) => `${n} new look${n === 1 ? '' : 's'}`,
  keys: 'Arrows · Enter wears · Esc back — D-pad · A · B',
  tauntQuote: (line: string) => `“${line}”`,
};

export const REWARD_STRINGS = {
  xp: (n: number) => `+${n} XP`,
  title: 'REWARDS',
  levelUp: 'LEVEL UP!',
  level: (n: number) => `LV ${n}`,
  newLook: 'NEW LOOK!',
  newLooks: (n: number) => `${n} NEW LOOKS!`,
  wearIt: 'Wear it from the LOCKER',
  more: (n: number) => `+${n} more`,
  next: (level: number, name: string) => `Next: level ${level} · ${name}`,
  lines: {
    played: 'Played it out', win: 'Win', draw: 'Draw', loss: 'Good fight', knockouts: 'Knockouts', steps: 'Objectives',
    cores: 'Upgrade Cores', pads: 'Core Pads', newBest: 'New best paw',
  } as Record<string, string>,
  medal: (m: 'gold' | 'silver' | 'bronze') => `${m[0].toUpperCase()}${m.slice(1)} paw`,
  firstWin: (mode: string) => `First ${MODE_NAMES[mode] ?? mode} win`,
};

// ---- W10 U3 (ux-3): the match awards card ----
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Award names and stat lines (ui/awards.ts AWARD_IDS). Names work for both species: a cat can be a GUARD DOG. */
export const AWARD_STRINGS = {
  title: 'MATCH AWARDS',
  you: 'YOU',
  /** Joins tied winners: "Rex & Pup 2", "Rex, Pup 2 & Cat 6". */
  join: (names: readonly string[]) => (names.length < 2 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`),
  tie: 'TIE',
  names: {
    best_in_show: 'BEST IN SHOW', heavy_paws: 'HEAVY PAWS', lob_star: 'LOB STAR', bullseye: 'BULLSEYE', on_a_roll: 'ON A ROLL',
    underdog: 'UNDERDOG', chew_toy: 'CHEW TOY', first_bite: 'FIRST BITE', special_delivery: 'SPECIAL DELIVERY',
    sticky_paws: 'STICKY PAWS', guard_dog: 'GUARD DOG', marathon: 'MARATHON', pad_patrol: 'PAD PATROL',
  } as Record<string, string>,
  stat: {
    best_in_show: (v: number) => `top score · ${v.toLocaleString('en-US')}`,
    heavy_paws: (v: number) => plural(v, 'knockout'),
    lob_star: (v: number, species: 'corgi' | 'cat' | 'mixed') => plural(v, species === 'cat' ? 'hairball knockout' : species === 'corgi' ? 'grenade knockout' : 'throwable knockout'),
    bullseye: (v: number) => plural(v, 'critical hit'),
    on_a_roll: (v: number) => `${v} knockouts in one life`,
    underdog: (v: number) => `${plural(v, 'knockout')} while behind`,
    chew_toy: (v: number) => `soaked ${Math.round(v).toLocaleString('en-US')} damage`,
    first_bite: () => 'the first knockout',
    special_delivery: (v: number) => plural(v, 'capture'),
    sticky_paws: (v: number) => plural(v, 'steal'),
    guard_dog: (stops: number, returns: number) => (stops && returns ? `${plural(stops, 'stop')} · ${plural(returns, 'return')}`
      : stops ? plural(stops, 'carrier stopped', 'carriers stopped') : plural(returns, 'return')),
    marathon: (v: number) => `carried the ball ${Math.round(v)} s`,
    pad_patrol: (v: number) => `took ${plural(v, 'pad')}`,
  },
};

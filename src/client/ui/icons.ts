// OWNER: L5 (juice). Inline SVG glyphs in the comic ink style (chunky warm-black strokes, flat fills).
// Original simple shapes; `currentColor` lets CSS tint them per team.
// W10 U3: the throwables' kill-feed glyphs (X4's own drawings, in their faction's tape) and the match-award medals.
import type { ClassId } from '../../shared/types';
import type { OrdnanceId } from '../../shared/content/ordnance';
import { HAIRBALL_ICON, SQUEAKER_ICON } from './ordnance-hud';

const INK = '#1a120c';
/** The locked team signal colours (style-tokens PALETTE.teamCorgis / teamCats): a throwable's tape is its faction's. */
const TAPE = { corgi: '#2f6fd6', cat: '#c9344a' } as const;
/** X4's HUD-slot drawing as a kill-feed glyph: the same shapes, the tape (`currentColor`) in the faction colour. */
const asGlyph = (icon: string, tape: string) => icon.replace('class="ico"', `class="glyph" style="color:${tape}" aria-hidden="true"`);
const svg = (body: string, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

export const CLASS_ICONS: Record<ClassId, string> = {
  // Frontline starburst.
  assault: svg(`<path fill="currentColor" d="M16 2.5l3 7 7.2-2.6-3.4 6.8L29.5 17l-7.1 2.4 2.2 7.4-6.9-3.3L16 30l-2.4-6.5-6.9 3.3 2.2-7.4L2.5 17l6.7-3.3-3.4-6.8L13 9.5z"/><circle cx="16" cy="16" r="3.2" fill="#fff4dc"/>`),
  // Domino mask.
  infiltrator: svg(`<path fill="currentColor" d="M3 13c3-4 8-4 13-1.5C21 9 26 9 29 13c-.5 5-3.5 8-7.5 8-2.7 0-4.2-2-5.5-2s-2.8 2-5.5 2C6.5 21 3.5 18 3 13z"/><ellipse cx="10.5" cy="15" rx="2.6" ry="2" fill="#fff4dc"/><ellipse cx="21.5" cy="15" rx="2.6" ry="2" fill="#fff4dc"/>`),
  // Scope reticle with laser dot.
  overwatch: svg(`<circle cx="16" cy="16" r="11" fill="currentColor"/><circle cx="16" cy="16" r="6" fill="#fff4dc"/><path d="M16 2v7M16 23v7M2 16h7M23 16h7"/><circle cx="16" cy="16" r="2" fill="#ff3b3b"/>`),
  // Tennis-ball bomb with fuse.
  breacher: svg(`<circle cx="15" cy="18" r="10.5" fill="currentColor"/><path d="M7.5 12.5c4 2 4 9 0 11M22.5 12.5c-4 2-4 9 0 11" stroke="#fff4dc" stroke-width="2"/><path d="M21 8.5l3-3.5"/><path d="M25 3.5l1.5-1.5M27 6l2-.5M24 1.8l.2-1" stroke="#ffd04a"/>`),
  // Shield with a paw.
  warden: svg(`<path fill="currentColor" d="M16 2.5l11 4v8.5c0 7-4.8 11.8-11 14.5C9.8 26.8 5 22 5 15V6.5z"/><circle cx="16" cy="18" r="3.4" fill="#fff4dc" stroke-width="1.8"/><circle cx="11.8" cy="12.8" r="1.6" fill="#fff4dc" stroke-width="1.6"/><circle cx="16" cy="11" r="1.6" fill="#fff4dc" stroke-width="1.6"/><circle cx="20.2" cy="12.8" r="1.6" fill="#fff4dc" stroke-width="1.6"/>`),
  // Ear-wings.
  skyraider: svg(`<path fill="currentColor" d="M16 22c-3-7-7.5-12-13.5-14 1.5 7 5.5 13 13.5 14zM16 22c3-7 7.5-12 13.5-14-1.5 7-5.5 13-13.5 14z"/><path d="M8 13l3 4M24 13l-3 4"/><circle cx="16" cy="24" r="3" fill="#fff4dc"/>`),
};

export const WEAPON_GLYPHS: Record<string, string> = {
  rifle: svg(`<path fill="#f2c14e" d="M3 13h18l4-2h4v6h-5l-3 1H14l-2 5H8l1.5-5H3z"/><circle cx="26" cy="10" r="3" fill="#d7f542"/>`, 'glyph'),
  pistol: svg(`<path fill="#f2c14e" d="M5 11h19v5h-9l-2 7H8.5l1.5-7H5z"/><path d="M24 12.5h3"/>`, 'glyph'),
  laser: svg(`<path fill="#b8b2a6" d="M3 15.5l12-3 1.4 5-12 3z"/><path d="M17 14.5L30 11" stroke="#ff3b3b" stroke-width="2.8"/><circle cx="16.2" cy="15" r="1.4" fill="#ff3b3b"/>`, 'glyph'),
  mortar: svg(`<circle cx="16" cy="16" r="11" fill="#d7f542"/><path d="M7.5 10c5 3 5 9 0 12M24.5 10c-5 3-5 9 0 12" stroke="#fff4dc" stroke-width="2"/>`, 'glyph'),
  sprinkler: svg(`<path fill="#4fb3d9" d="M16 3c5 7 9 11 9 16a9 9 0 0 1-18 0c0-5 4-9 9-16z"/><path d="M12 19a4 4 0 0 0 4 4" stroke="#fff4dc" stroke-width="2"/>`, 'glyph'),
  frisbee: svg(`<ellipse cx="16" cy="17" rx="13" ry="6" fill="#6ff7ff"/><ellipse cx="16" cy="16" rx="7" ry="2.6" fill="#fff4dc" stroke-width="1.8"/>`, 'glyph'),
  paw: svg(`<ellipse cx="16" cy="20" rx="6.5" ry="5.5" fill="#f6e7cf"/><circle cx="8.5" cy="12.5" r="2.8" fill="#f6e7cf"/><circle cx="13.5" cy="8.5" r="2.8" fill="#f6e7cf"/><circle cx="18.5" cy="8.5" r="2.8" fill="#f6e7cf"/><circle cx="23.5" cy="12.5" r="2.8" fill="#f6e7cf"/>`, 'glyph'),
  boom: svg(`<path fill="#ff9b3d" d="M16 2l2.6 7.4 7-3.4-3 7.3L30 16l-7.4 2.6 3.4 7-7.3-3L16 30l-2.6-7.4-7 3.4 3-7.3L2 16l7.4-2.6-3.4-7 7.3 3z"/><circle cx="16" cy="16" r="4" fill="#ffd04a"/>`, 'glyph'),
  fall: svg(`<path fill="#f6e7cf" d="M16 29l-8-9h5V4h6v16h5z"/>`, 'glyph'),
  star: svg(`<path fill="#ffd04a" d="M16 3l3.6 8 8.4.8-6.4 5.6 1.9 8.3L16 21.4l-7.5 4.3 1.9-8.3L4 11.8l8.4-.8z"/>`, 'glyph'),
  // vehicle kills (a kart ram; a plane ram or its gun): the killer was seated
  kart: svg(`<path fill="#e8453c" d="M4 19l3-7h11l3 4h6l1 3z"/><circle cx="9" cy="22" r="3.6" fill="#2b2b2b" stroke="#f6e7cf" stroke-width="1.6"/><circle cx="23.5" cy="22" r="3.6" fill="#2b2b2b" stroke="#f6e7cf" stroke-width="1.6"/><path d="M13 12l1.5-5h3" stroke="#f6e7cf" stroke-width="2"/>`, 'glyph'),
  plane: svg(`<path fill="#ffd04a" d="M4 16.5l17-2.5 6 1.5v3l-6 1.5-17-2z"/><path fill="#6ff7ff" d="M12 15l3-8h3l-1 8zM12 18.5l3 7h3l-1-7z"/><path d="M27 12v10" stroke="#f6e7cf" stroke-width="2"/><path fill="#ffd04a" d="M4 13l2 3.5-2 3.5z"/>`, 'glyph'),
  // W10 U3: throwable kills (death.wpn names the throwable): ids are the ordnance ids (content/ordnance ORDNANCE_IDS)
  squeaker_grenade: asGlyph(SQUEAKER_ICON, TAPE.corgi),
  hairball_bomb: asGlyph(HAIRBALL_ICON, TAPE.cat),
};

/** The kill-feed glyph id of a throwable (W10 U3). Every ORDNANCE_IDS entry has one (tested). */
export function throwableGlyphId(id: OrdnanceId): string { return id; }

export function classIcon(cls: ClassId): string { return CLASS_ICONS[cls] ?? CLASS_ICONS.assault; }
export function weaponGlyph(id: string): string { return WEAPON_GLYPHS[id] ?? WEAPON_GLYPHS.paw; }

// ------------------------------------------------------------------------------------------------ W10 U3: award medals
// One glyph per match award (ui/awards.ts AWARD_IDS), drawn for the medal on the awards card. `currentColor` = the
// winner's team colour (the card sets it); fills stay flat, ink strokes chunky. Original shapes.
const medal = (body: string) => svg(body, 'aw-glyph');
export const AWARD_GLYPHS: Record<string, string> = {
  // a show rosette: petals, a gold heart, two ribbon tails
  best_in_show: medal(`<path fill="currentColor" d="M11 20l-4 10 4.5-2 2.5 3.5 3-9zM21 20l4 10-4.5-2-2.5 3.5-3-9z"/><path fill="#ffd04a" d="M16 2.5l2.6 2.6 3.6-.7.9 3.5 3.4 1.4-1 3.5 2 3.1-2.9 2.2.1 3.7-3.6.5-1.8 3.2L16 22.4l-3.3 1.6-1.8-3.2-3.6-.5.1-3.7-2.9-2.2 2-3.1-1-3.5 3.4-1.4.9-3.5 3.6.7z"/><circle cx="16" cy="13" r="5" fill="currentColor"/><path d="M14 13.3l1.6 1.6 3-3.2" stroke="#fff4dc" stroke-width="2"/>`),
  // a paw coming down with impact lines
  heavy_paws: medal(`<ellipse cx="16" cy="20.5" rx="6.8" ry="5.8" fill="currentColor"/><circle cx="8.6" cy="13" r="2.9" fill="currentColor"/><circle cx="13.4" cy="9" r="2.9" fill="currentColor"/><circle cx="18.6" cy="9" r="2.9" fill="currentColor"/><circle cx="23.4" cy="13" r="2.9" fill="currentColor"/><path d="M3 27.5l4-1.5M29 27.5l-4-1.5M16 30.5v-2" stroke="#ff9b3d" stroke-width="2.2"/>`),
  // the two throwables side by side (the card swaps in the winner's own)
  lob_star: medal(`<ellipse cx="16" cy="18.5" rx="9" ry="9.5" fill="#c8952a"/><path d="M7.4 17.6c5.8 2.1 11.4 2.1 17.2 0" stroke="currentColor" stroke-width="3.2"/><rect x="12" y="5.5" width="8" height="4.6" rx="1.2" fill="#3a3e44"/><circle cx="24" cy="6.5" r="2.8" stroke-width="1.8"/><path d="M3.5 10l2.5 1.5M4 16h3M28.5 22l-2.5-1" stroke="#ffd04a" stroke-width="2"/>`),
  // a target with a dart in the middle
  bullseye: medal(`<circle cx="15" cy="17" r="12" fill="#fff4dc"/><circle cx="15" cy="17" r="8" fill="currentColor"/><circle cx="15" cy="17" r="3.8" fill="#fff4dc"/><path d="M15 17L28 4" stroke-width="2.6"/><path d="M24.5 3.5l4-1-1 4" fill="#ffd04a" stroke-width="1.8"/>`),
  // a flame: three knockouts in one life and counting
  on_a_roll: medal(`<path fill="#ff9b3d" d="M16 2.5c1.5 5 7.5 7.5 7.5 15a7.5 7.5 0 0 1-15 0c0-4 2.5-6 3.5-9 1.5 2 1.5 3.5 1.5 5 2.5-2 3-6 2.5-11z"/><path fill="currentColor" d="M16 15c1 2.5 3.8 3.5 3.8 7a3.8 3.8 0 0 1-7.6 0c0-2 1.2-2.8 1.8-4.2.8.9 1 1.6 1 2.4 1-.9 1.2-3 1-5.2z"/><path d="M7 29.5h18" stroke-width="2.4"/>`),
  // a pup's head rising over a bar: behind on the scoreboard, still biting
  underdog: medal(`<path fill="#fff4dc" d="M4 24h24v5H4z"/><path fill="currentColor" d="M9 22c0-6 3-10 7-10s7 4 7 10z"/><path fill="currentColor" d="M9.5 14l-2-8 6 4.5M22.5 14l2-8-6 4.5"/><circle cx="13.5" cy="17" r="1.3" fill="#fff4dc" stroke-width="1.2"/><circle cx="18.5" cy="17" r="1.3" fill="#fff4dc" stroke-width="1.2"/><path d="M26 4v7M23 7l3-3 3 3" stroke="#8fd14a" stroke-width="2.4"/>`),
  // a chewed bone
  chew_toy: medal(`<path fill="#f6e7cf" d="M9.5 7.5a3.4 3.4 0 0 1 5.3 3.6l7.2 7.2a3.4 3.4 0 1 1 3.6 5.3 3.4 3.4 0 1 1-5.3 3.6l-7.2-7.2a3.4 3.4 0 1 1-3.6-5.3 3.4 3.4 0 0 1 0-7.2z"/><path d="M14 16.5l1.6 1.6M17 13.5l1.2 1.2" stroke="currentColor" stroke-width="2.2"/>`),
  // one sharp fang with a bite mark
  first_bite: medal(`<path fill="#fff4dc" d="M8 5h16c0 9-3.5 17-8 23-4.5-6-8-14-8-23z"/><path d="M8 5h16" stroke-width="2.8"/><path d="M12.5 10.5c1.5 1 5.5 1 7 0" stroke="currentColor" stroke-width="2.2"/><circle cx="26.5" cy="24" r="2" fill="#e8453c" stroke-width="1.4"/><circle cx="23" cy="28.5" r="1.4" fill="#e8453c" stroke-width="1.2"/>`),
  // Base Assault: a squeaky tennis ball with its team tape, landing in the ring
  special_delivery: medal(`<ellipse cx="16" cy="26" rx="12" ry="3.6" fill="currentColor" stroke-width="2"/><circle cx="16" cy="14" r="10" fill="#c6d34c"/><path d="M7.5 9.5c4.5 2.5 4.5 7.5 0 10M24.5 9.5c-4.5 2.5-4.5 7.5 0 10" stroke="#f3eedb" stroke-width="2"/><path d="M10.5 5.5L21 22.5" stroke="currentColor" stroke-width="4"/>`),
  // a paw with the ball stuck to it
  sticky_paws: medal(`<ellipse cx="13" cy="21" rx="7" ry="6" fill="currentColor"/><circle cx="5.8" cy="13.5" r="2.8" fill="currentColor"/><circle cx="10.4" cy="9.4" r="2.8" fill="currentColor"/><circle cx="15.6" cy="9.4" r="2.8" fill="currentColor"/><circle cx="23" cy="20.5" r="6.2" fill="#c6d34c"/><path d="M18.4 17c2.5 1.5 2.5 5.5 0 7" stroke="#f3eedb" stroke-width="1.8"/><path d="M26 11.5l1.5-2.5M29 15l1.5-.5" stroke="#ffd04a" stroke-width="1.8"/>`),
  // a shield with a paw
  guard_dog: medal(`<path fill="currentColor" d="M16 2.5l11 4v8.5c0 7-4.8 11.8-11 14.5C9.8 26.8 5 22 5 15V6.5z"/><circle cx="16" cy="18" r="3.4" fill="#fff4dc" stroke-width="1.8"/><circle cx="11.8" cy="12.8" r="1.6" fill="#fff4dc" stroke-width="1.6"/><circle cx="16" cy="11" r="1.6" fill="#fff4dc" stroke-width="1.6"/><circle cx="20.2" cy="12.8" r="1.6" fill="#fff4dc" stroke-width="1.6"/>`),
  // a stopwatch
  marathon: medal(`<circle cx="16" cy="18" r="11" fill="#fff4dc"/><path d="M13 3.5h6M16 3.5v3.5M25 8l2-2" stroke-width="2.6"/><path fill="currentColor" d="M16 18V9.5a8.5 8.5 0 0 1 8.2 10.7z"/><path d="M16 18l-4 3" stroke-width="2.4"/>`),
  // Core Rush: a core pad with a planted pennant
  pad_patrol: medal(`<ellipse cx="16" cy="24" rx="12.5" ry="5" fill="#6ff7ff"/><ellipse cx="16" cy="23.5" rx="7" ry="2.6" fill="#fff4dc" stroke-width="1.8"/><path d="M16 23V4" stroke-width="2.6"/><path fill="currentColor" d="M16 4.5l10 3.8-10 3.8z"/>`),
};

/** A medal glyph by award id (the rosette for an unknown id). */
export function awardGlyph(id: string): string { return AWARD_GLYPHS[id] ?? AWARD_GLYPHS.best_in_show; }

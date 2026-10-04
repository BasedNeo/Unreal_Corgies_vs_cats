// slab HUD, DOM (W13 TW-VIEW; W15 the HUD contract, docs/qa/w15/HUD_CONTRACT.md): the web twin of
// engines/godot/game/hud.gd for the slab match on The Lot. Godot is the main build and the contract's strings win: the
// words below are copied from it. Idle and hidden unless MatchState.mode is 'slab'. Plain light sans-serif text in white
// and team colours over a soft shadow, thin bars and plain shapes: no panels, no ink, no comic words.
//   top       "CORGI COMPANY  12" and "7  CAT CADRE" with bars racing to the win score (60), the clock between them
//             (m:ss, red in the last 30 s; OVERTIME in overtime: MatchState.objective 'OVERTIME', timeLeft then counts
//             the overtime down)
//   slab line SLAB  NEUTRAL · SLAB  <TEAM> HOLDING  +1/s · SLAB  CONTESTED, in the slab's read-out colour; hidden
//             once the match is over
//   marker    §1: over the slab centre + 4.5 m, two lines ("SLAB  <N> m", the camera's ground distance; the state word)
//             above a diamond whose shape carries the state (hollow neutral, filled held, split by a bar contested).
//             Placed in the contract's order (rev. 3): clamped into the safe area (16 px in from the sides, 110 from
//             the top, 112 from the bottom), then up off any other pet (at most 120 px, never over the safe top), else
//             just under the lowest pet it covers; nothing clamps after. It hides while you stand on the slab or are down
//   you       §4: "YOU: <TEAM>" over the hit points (number + bar, red at 40 or less, with §3's white chip of the HP just
//             lost, draining over 0.4 s), "30 / 30" or RELOADING bottom right, the controls hint for the first 14 s
//   down      §2: the death panel, four lines centred on the screen on a dim rounded backing: who took you down (a square /
//             triangle glyph in their team's colour before their team), your team, where you come back and how far
//             that is from the slab, and the countdown in tenths
//   hits      §3: your confirms at the crosshair (X white; head: X + a centre diamond, yellow: 0.18 s; kill: a larger
//             X + a ring, red: 0.35 s), a wedge on a 110 px ring toward where whoever hit you stood at its last hit
//             (turning with the camera, fading over 0.6 s), a red flash at alpha 0.175 or less (hud.gd: _dmg_t * 0.5);
//             while you are down: no confirm and no wedges (your knockout clears them)
//   winner    <TEAM> WINS or DRAW, the score, your takedowns / knockouts, "R / Enter: rematch" (the authority restarts
//             when a human sends the reload bit while the match is ended; main.ts maps Enter to it then)
// While active it takes over from the general HUD (a class on the HUD parent hides its comic match bar, health and
// ability panel, ammo panel, knocked-out screen, damage arcs and vignettes, the X3 hitmarker and, once the match is
// over, its banner burst, crosshair and click-to-play overlay (hud.gd shows "Click to play" only while the match runs;
// R / Enter work without the pointer); main.ts holds the first-match tips and the end-of-match scoreboard). The general HUD's
// kill feed and click-to-play overlay take hud.gd's plain look from the CSS here (hud.ts writes the feed as
// slabFeedText lines and the title as SLAB_CLICK_TO_PLAY in slab mode). The crosshair (its gap opens with the spread),
// chat and the Tab scoreboard stay the general HUD's.
// Data: the frame (main.ts), the slab reading with the frame's living pets (slab-view.ts), and the client bus's game
// events (hits, knockouts), so the death panel and the hit cues need no new snapshot field; the respawn zone comes from
// The Lot's spawn layout through the sim's own respawn-point rule (slabRespawnPoints).
// The models (slabMarker, slabMarkerPlace, slabDeathPanel, SlabHitCues, SlabHpChip, the field helpers, and slabHudFrame,
// which turns a frame and the kept state into §1-§3: the marker, the death panel, the confirm, the wedges, the chip)
// are DOM-free and tested headless (tests/unit/slab-view.test.ts, tests/unit/slab-hud.test.ts); update() only writes them.
import { Vector3, type Camera } from 'three/webgpu';
import type { EntityState, GameEvent, MatchState, RosterEntry } from '../../shared/protocol';
import { EFlag } from '../../shared/types';
import { SLAB, SLAB_TEXT, onSlab, type SlabConfig } from '../../shared/content/modes';
import { WEAPONS } from '../../shared/content/weapons';
import { moveStatsFor } from '../../shared/content/classes';
import { CAT_SPAWN_XS, CAT_SPAWN_ZS, CORGI_SPAWN_XS, CORGI_SPAWN_ZS } from '../../shared/world/lot/layout';
import type { SpawnPoint } from '../../shared/world/world-types';
import { slabRespawnPoints, type SlabLayout } from '../../sim/match/slab';
import { bus as clientBus, type EventBus } from '../core/events';
import { PALETTE } from '../style/style-tokens.js';
import { FONT_BODY } from './fonts';
import { lighten, type SlabPet, type SlabReading } from '../modes/slab-view';

/** tuning.gd TEAM_NAMES: the slab match names the teams as the Godot game does (SLAB_TEXT.win says "<name> WINS"). */
export const SLAB_TEAM_NAMES = ['CORGI COMPANY', 'CAT CADRE'] as const;
/** The rematch prompt on the winner screen. */
export const SLAB_REMATCH = 'R / Enter: rematch';
const TEAM = [PALETTE.teamCorgis, PALETTE.teamCats] as const;

/** m:ss of whole seconds, rounded up (hud.gd: int(ceil(time_left))). */
export function slabClockText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The match runs in overtime (the slab authority's objective reads SLAB_TEXT.overtime). */
export function slabOvertime(ms: Pick<MatchState, 'objective' | 'phase'>): boolean {
  return ms.phase === 'live' && ms.objective.trimStart().startsWith(SLAB_TEXT.overtime);
}

export type ClockTone = '' | 'warm' | 'low' | 'ot';
/**
 * The clock in the middle of the top bar (hud.gd): m:ss of regulation (red in the last 30 s), OVERTIME in overtime.
 * Ended, the authority freezes timeLeft and the objective turns into the result, so `endedInOvertime` (the last live
 * frame was overtime) keeps OVERTIME up the way Godot's flag does.
 */
export function slabClock(ms: Pick<MatchState, 'objective' | 'phase' | 'timeLeft'>, endedInOvertime = false): { text: string; tone: ClockTone } {
  if (ms.phase === 'warmup') return { text: `WARMUP ${slabClockText(ms.timeLeft)}`, tone: 'warm' };
  if (slabOvertime(ms) || (ms.phase === 'ended' && endedInOvertime)) return { text: 'OVERTIME', tone: 'ot' };
  return { text: slabClockText(ms.timeLeft), tone: ms.phase === 'live' && ms.timeLeft <= 30 ? 'low' : '' };
}

/** The slab line, word for word as hud.gd (double spaces included): contested beats a holder; nobody = neutral. */
export function slabStateText(r: Pick<SlabReading, 'holder' | 'contested'> | null): string {
  if (r?.contested) return 'SLAB  CONTESTED';
  if (r && r.holder !== -1) return `SLAB  ${SLAB_TEAM_NAMES[r.holder]} HOLDING  +1/s`;
  return 'SLAB  NEUTRAL';
}

/**
 * The slab line for this frame, or null to hide it. Once the match is over the slab scores nobody: Godot stops
 * scoring at match_over and its winner veil covers the line; here the line goes (no frozen "HOLDING +1/s" claim).
 */
export function slabLineFor(ms: Pick<MatchState, 'phase'>, r: Pick<SlabReading, 'holder' | 'contested'> | null): string | null {
  return ms.phase === 'ended' ? null : slabStateText(r);
}

/** The "fps · backend · transport · rtt" debug line: Godot shows none, so a slab match hides it unless ?debug is set. */
export function slabShowDebug(slabActive: boolean, search: string): boolean {
  return !slabActive || new URLSearchParams(search).has('debug');
}

/** hud.gd slab_color(): the slab line's and the marker's colour. */
export function slabHudColor(r: Pick<SlabReading, 'holder' | 'contested'> | null): number {
  if (r?.contested) return 0xffa633; // Color(1.0, 0.65, 0.2)
  if (r && r.holder !== -1) return lighten(TEAM[r.holder], 0.35);
  return 0xe6ebf2; // Color(0.9, 0.92, 0.95)
}

export interface SlabWinner {
  /** "<TEAM> WINS" or "DRAW". */
  title: string;
  team: 0 | 1 | -1;
  /** "12  –  7" (corgis first, as hud.gd). */
  score: string;
  /** "You: 3 takedowns · 2 knockouts" (empty when the local player isn't on the roster). */
  you: string;
  prompt: string;
}

/** The winner screen of an ended slab match, or null while it runs. */
export function slabWinner(ms: Pick<MatchState, 'phase' | 'winner' | 'score'>, me: Pick<RosterEntry, 'kills' | 'deaths'> | null = null): SlabWinner | null {
  if (ms.phase !== 'ended') return null;
  const team = ms.winner === 0 || ms.winner === 1 ? ms.winner : -1;
  return {
    title: team === -1 ? SLAB_TEXT.draw : SLAB_TEXT.win[team],
    team,
    score: `${ms.score[0]}  –  ${ms.score[1]}`,
    you: me ? `You: ${me.kills} takedowns · ${me.deaths} knockouts` : '',
    prompt: SLAB_REMATCH,
  };
}

/** Score bar fill toward the win score, 0..1. */
export const slabFrac = (score: number, winScore: number): number => Math.max(0, Math.min(1, winScore > 0 ? score / winScore : 0));

/** hud.gd's clock colours: overtime amber, the last 30 s red, else white. */
export const SLAB_CLOCK_COLOR: Record<ClockTone, number> = { '': 0xffffff, warm: 0xffffff, low: 0xff7366, ot: 0xff9933 };

/** hud.gd's hit-point bar: green above 40, red at 40 or less. */
export const slabHpColor = (hp: number): number => (hp > 40 ? 0x8ce673 : 0xff664d);

/** hud.gd's ammo line: RELOADING while reloading, else "ammo / magazine". */
export function slabAmmoText(local: Pick<EntityState, 'ammo' | 'flags'>, mag: number = WEAPONS[SLAB.weapon].magSize): string {
  return (local.flags & EFlag.Reloading) !== 0 ? 'RELOADING' : `${Math.max(0, local.ammo)} / ${mag}`;
}

/** hud.gd's kill feed line (match.gd _on_died): "Killer  >  Victim"; no killer = "The Lot". */
export const slabFeedText = (killer: string | null, victim: string): string => `${killer ?? 'The Lot'}  >  ${victim}`;

/** hud.gd's line while the mouse is free. */
export const SLAB_CLICK_TO_PLAY = 'Click to play';

/** hud.gd's controls hint (shown for the first 14 s of play), with the web's pad bindings. */
export const SLAB_HINT = 'WASD / stick move · mouse / stick look · Space / A jump · LMB / RT fire · RMB / LT aim · Shift sprint · R / X reload\n'
  + 'Hold the slab alone to score · Esc frees the mouse';
const HINT_SECS = 14;

// ------------------------------------------------------------------------------------------------ §1 the slab marker

/** The marker hangs this far over the slab centre (m): high enough to clear the pets on it (Godot slab.center + 4.5). */
export const SLAB_MARKER_LIFT = 4.5;
/** The marker moves up at most this far (px) to keep off a pet. */
export const SLAB_MARKER_MAX_DODGE = 120;

export type SlabMarkerShape = 'hollow' | 'filled' | 'split';

export interface SlabMarker {
  /** Line 1 "SLAB  <N> m" and line 2 the state word. */
  lines: [string, string];
  /** The shape carries the state on its own: hollow diamond (nobody), filled (one team alone), split by a bar (both). */
  shape: SlabMarkerShape;
  /** Colour is extra: white, the team's colour lightened, amber. */
  color: number;
}

/** §1: the marker's words, shape and colour for the slab state and the camera's ground distance (m) to its centre. */
export function slabMarker(r: Pick<SlabReading, 'holder' | 'contested'> | null, groundDist: number): SlabMarker {
  const lines = (word: string): [string, string] => [`SLAB  ${Math.max(0, Math.round(groundDist))} m`, word];
  if (r?.contested) return { lines: lines('CONTESTED'), shape: 'split', color: 0xffa633 };
  if (r && r.holder !== -1) return { lines: lines(SLAB_TEAM_NAMES[r.holder]), shape: 'filled', color: lighten(TEAM[r.holder], 0.35) };
  return { lines: lines('NEUTRAL'), shape: 'hollow', color: 0xffffff };
}

const DIAMOND = 'M0 -9L9 0L0 9L-9 0Z';
/** The marker's diamond (18 px; viewBox -12..12). Hollow: an outline; filled: solid; split: an outline cut through by a
 *  solid bar wider than the diamond. The geometry differs per state, not only the colour. */
export function slabMarkerSvg(shape: SlabMarkerShape): string {
  const outline = `<path d="${DIAMOND}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/>`;
  if (shape === 'filled') return `<path d="${DIAMOND}" fill="currentColor"/>`;
  if (shape === 'split') return `${outline}<rect x="-12" y="-2" width="24" height="4" fill="currentColor"/>`;
  return outline;
}

/** A screen rectangle (px; y down). */
export interface ScreenBox { x0: number; y0: number; x1: number; y1: number }

const overlaps = (a: ScreenBox, b: ScreenBox) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** §1 (contract rev. 2): the marker shows unless the match is over, you stand on the slab (the top slab line says the
 *  state), or you are down (the death panel gives the distance from the respawn: never two distances at once). */
export function slabMarkerShown(local: Pick<EntityState, 'x' | 'y' | 'z' | 'flags'> | null, ended: boolean): boolean {
  if (ended) return false;
  if (!local) return true;
  return (local.flags & EFlag.Dead) === 0 && !onSlab(local.x, local.y, local.z);
}

/** The marker's safe area (720p px, scaled by the screen): 16 in from the sides, 110 from the top (below the scores,
 *  the timer and the slab line), 112 from the bottom (the YOU / HP and ammo fields). Contract §1 rev. 3. */
export const SLAB_SAFE = { side: 16, top: 110, bottom: 112 } as const;
/** Clearance (720p px) the dodge leaves between the marker and a pet. */
export const SLAB_MARKER_CLEAR = 2;

/** Input of slabMarkerPlace: the anchor's screen point (and whether it is behind the camera), the screen (px), the HUD
 *  unit (px per 720p px), the two lines, and the screen boxes of the OTHER living pets (never the player's own). */
export interface SlabMarkerPlaceIn { x: number; y: number; behind: boolean; w: number; h: number; u: number; lines: readonly [string, string]; pets: readonly ScreenBox[] }

export type SlabMarkerDodge = 'none' | 'lift' | 'below' | 'blocked';

/**
 * §1 placement, in the contract's order (rev. 3; Godot hud.gd place_marker). The box: the 24 px shape on the anchor
 * and the two 13 px lines over it (from 13 px above the anchor, about 0.62 em a character).
 *  1. Clamp the anchor into the safe area (behind the camera: mirrored, on the bottom edge).
 *  2. Move up off any pet it covers, 2 of clearance, by at most 120 and never above the safe top.
 *  3. If that cannot clear it: just below the lowest pet it still covers (2 of clearance), clamped to the safe bottom.
 *  4. If neither clears: stay where step 2 left it. Nothing clamps after the dodge.
 */
export function slabMarkerPlace(p: SlabMarkerPlaceIn): { x: number; y: number; lift: number; dodge: SlabMarkerDodge; box: ScreenBox } {
  const u = p.u;
  const half = Math.max(12, (Math.max(p.lines[0].length, p.lines[1].length) * 13 * 0.62) / 2) * u;
  const above = (13 + 2 * 13 * 1.2) * u, below = 12 * u, clear = SLAB_MARKER_CLEAR * u;
  const minX = SLAB_SAFE.side * u + half, maxX = p.w - SLAB_SAFE.side * u - half;
  const minY = SLAB_SAFE.top * u + above, maxY = Math.max(minY, p.h - SLAB_SAFE.bottom * u - below);
  const x = Math.max(minX, Math.min(maxX, p.behind ? p.w - p.x : p.x));
  const raw = Math.max(minY, Math.min(maxY, p.behind ? p.h : p.y));
  const boxAt = (y: number): ScreenBox => ({ x0: x - half, y0: y - above, x1: x + half, y1: y + below });
  const need = (b: ScreenBox) => { let n = 0; for (const q of p.pets) if (overlaps(b, q)) n = Math.max(n, b.y1 - q.y0 + clear); return n; };
  let y = raw, dodge: SlabMarkerDodge = 'none';
  const room = Math.min(SLAB_MARKER_MAX_DODGE * u, raw - minY); // up to the cap or the safe top
  for (let i = 0; i <= p.pets.length; i++) {
    const step = Math.min(need(boxAt(y)), room - (raw - y));
    if (step <= 0) break;
    y -= step;
    dodge = 'lift';
  }
  if (need(boxAt(y)) > 0) {
    const b = boxAt(y);
    let low = -Infinity; // the lowest bottom of the pet boxes it still covers
    for (const q of p.pets) if (overlaps(b, q)) low = Math.max(low, q.y1);
    const under = Math.min(low + clear + above, maxY);
    if (need(boxAt(under)) <= 0) { y = under; dodge = 'below'; } else dodge = 'blocked';
  }
  return { x, y, lift: raw - y, dodge, box: boxAt(y) };
}

/** The screen boxes of the living pets other than `localId` (8 projected corners of each pet's box; a pet behind the
 *  camera covers nothing). */
export function slabPetBoxes(pets: readonly SlabPet[], localId: number, camera: Camera, w: number, h: number): ScreenBox[] {
  const out: ScreenBox[] = [];
  for (const p of pets) {
    if (p.id === localId) continue; // the player's own pet never pushes the marker (contract §1 rev. 3)
    const ht = slabPetHeight(p.species);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cut = false;
    for (let i = 0; i < 8 && !cut; i++) {
      PV.set(p.x + (i & 1 ? 0.5 : -0.5), p.y + (i & 2 ? ht : 0), p.z + (i & 4 ? 0.5 : -0.5)).project(camera);
      if (PV.z > 1) { cut = true; break; }
      const px = (PV.x * 0.5 + 0.5) * w, py = (-PV.y * 0.5 + 0.5) * h;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    if (!cut) out.push({ x0, y0, x1, y1 });
  }
  return out;
}
const PV = new Vector3();

/** A pet's standing height (m): its species' capsule plus its head and ears. */
export function slabPetHeight(species: number): number {
  const m = moveStatsFor(species === 1 ? 1 : 0, SLAB.cls);
  return 2 * (m.capsuleRadius + m.capsuleHalfHeight) + 0.3;
}

// ------------------------------------------------------------------------------------------------ §2 the death panel

/** The map's names for the team bases (src/shared/world/lot/layout.ts: The Foundation, the pit; The Scaffolds, the heap). */
export const SLAB_BASE_NAMES = ['THE FOUNDATION', 'THE SCAFFOLDS'] as const;

/** Where a team comes back: its base name and the centre of its respawn points (Godot match.gd respawn_zone). */
export interface SlabRespawnZone { name: string; x: number; z: number; dist: number }

const zones = new Map<string, SlabRespawnZone>();
/**
 * §2: a team's respawn zone on The Lot: the centre of its respawn points (the sim's own rule, slabRespawnPoints, run on
 * the layout's spawns; only x and z matter) and its whole-metre ground distance to the slab centre.
 */
export function slabRespawnZone(team: 0 | 1, cfg: SlabConfig = SLAB): SlabRespawnZone {
  const key = `${team}:${cfg.center.x}:${cfg.center.z}`;
  const hit = zones.get(key);
  if (hit) return hit;
  // The Lot's spawns in the-lot.ts's order (the Cats' data slots name them by index); flat ground: x and z only
  const spawns: SpawnPoint[] = [];
  for (const x of CORGI_SPAWN_XS) for (const z of CORGI_SPAWN_ZS) spawns.push({ x, y: 0, z, yaw: 0, team: 0 });
  for (const x of CAT_SPAWN_XS) for (const z of CAT_SPAWN_ZS) spawns.push({ x, y: 0, z, yaw: 0, team: 1 });
  const layout: SlabLayout = { worldData: { spawns, height: () => 0 } };
  const pts = slabRespawnPoints(layout, team, cfg);
  let x = 0, z = 0;
  for (const p of pts) { x += p.x; z += p.z; }
  x /= Math.max(1, pts.length); z /= Math.max(1, pts.length);
  const zone = { name: SLAB_BASE_NAMES[team], x, z, dist: Math.hypot(x - cfg.center.x, z - cfg.center.z) };
  zones.set(key, zone);
  return zone;
}

export type SlabTeamGlyph = 'square' | 'triangle';
/** §2 (contract rev. 2): the death panel's dim rounded backing, so lit scenery cannot cross the lines. */
export const SLAB_DEATH_BACKING = 'rgba(0,0,0,0.55)';

/** The team glyph: Corgi Company a square, Cat Cadre a triangle (the shape carries the team, colour is extra). */
export const slabTeamGlyph = (team: 0 | 1): SlabTeamGlyph => (team === 0 ? 'square' : 'triangle');
export function slabTeamGlyphSvg(team: 0 | 1): string {
  return team === 0 ? '<rect x="-6" y="-6" width="12" height="12" fill="currentColor"/>' : '<path d="M0 -7L7.5 6L-7.5 6Z" fill="currentColor"/>';
}

/** Who took the local player down: a display name and a team; null = nobody (a fall, the map). */
export interface SlabKiller { name: string; team: 0 | 1 }

export interface SlabDeathPanel {
  lines: [string, string, string, string];
  /** The killer team's glyph and team (null: no killer). */
  glyph: { shape: SlabTeamGlyph; team: 0 | 1 } | null;
}

/** §2: the four lines while the player is down (`left`: seconds until the respawn). */
export function slabDeathPanel(killer: SlabKiller | null, you: 0 | 1, zone: Pick<SlabRespawnZone, 'name' | 'dist'>, left: number): SlabDeathPanel {
  return {
    lines: [
      killer ? `TAKEN DOWN BY ${killer.name}  ·  ${SLAB_TEAM_NAMES[killer.team]}` : 'TAKEN DOWN BY THE LOT',
      slabYouText(you),
      `BACK AT ${zone.name}  ·  ${Math.round(zone.dist)} m TO THE SLAB`,
      `BACK IN ${Math.max(0, left).toFixed(1)}`,
    ],
    glyph: killer ? { shape: slabTeamGlyph(killer.team), team: killer.team } : null,
  };
}

/** §4: the team line over the HP bar (and the death panel's second line). */
export const slabYouText = (team: 0 | 1): string => `YOU: ${SLAB_TEAM_NAMES[team]}`;

// ------------------------------------------------------------------------------------------------ §3 hits

export type SlabHitKind = 'body' | 'head' | 'kill';

/** A confirm's geometry (px, centred on the crosshair): four diagonal lines from r0 to r1 (`width` px), an optional
 *  filled centre diamond (half-size) and an optional outline ring (radius). */
export interface SlabHitGeometry { r0: number; r1: number; width: number; diamond: number; ring: number; color: number }

/** §3: body = an X, white; head = the X plus a small filled diamond (11 px across, inside the X's 5 px inner gap and
 *  plainly larger than the crosshair's 4 px dot it sits on), yellow; kill = a larger, heavier X plus a ring about 18 px across, red (hud.gd: lines from 5 px to
 *  10, 14 for a kill). */
export const SLAB_HIT: Record<SlabHitKind, SlabHitGeometry> = {
  body: { r0: 5, r1: 10, width: 2.5, diamond: 0, ring: 0, color: 0xffffff },
  head: { r0: 5, r1: 10, width: 2.5, diamond: 5.5, ring: 0, color: 0xffd933 },
  kill: { r0: 6, r1: 14, width: 3, diamond: 0, ring: 9, color: 0xff4033 },
};
/** How long a confirm shows, fading (contract rev. 2): body and head 0.18 s (hud.gd hit_t), a kill 0.35 s. */
export const SLAB_HIT_LIFE: Record<SlabHitKind, number> = { body: 0.18, head: 0.18, kill: 0.35 };
/** §3 received hit: the wedge's ring radius (px) and its fade (s); the red flash (hud.gd _dmg_t = 0.35, alpha _dmg_t * 0.5). */
export const SLAB_WEDGE = { ring: 110, life: 0.6 } as const;
const FLASH_T = 0.35;

/** The confirm drawn as SVG (viewBox -20..20, px at 720p): a dark underlay (hud.gd draws its crosshair the same way:
 *  dark lines under the light ones), then the cue in its colour; shapes read in grayscale. */
export function slabHitSvg(kind: SlabHitKind): string {
  const g = SLAB_HIT[kind];
  const lines = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4].map((a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return `<line x1="${(c * g.r0).toFixed(2)}" y1="${(s * g.r0).toFixed(2)}" x2="${(c * g.r1).toFixed(2)}" y2="${(s * g.r1).toFixed(2)}"/>`;
  }).join('');
  const ring = g.ring ? `<circle class="ring" r="${g.ring}"/>` : '';
  const dia = g.diamond
    ? `<path class="dia" d="M0 ${-g.diamond}L${g.diamond} 0L0 ${g.diamond}L${-g.diamond} 0Z" fill="currentColor" stroke="rgba(0,0,0,.75)" stroke-width="1.2" stroke-linejoin="round"/>`
    : '';
  return `<g class="under" stroke="rgba(0,0,0,.6)" stroke-width="${g.width + 2.4}" stroke-linecap="round" fill="none">${lines}${ring}</g>`
    + `<g class="over" stroke="currentColor" stroke-width="${g.width}" stroke-linecap="round" fill="none">${lines}${ring}</g>${dia}`;
}

/** The wedge's direction (rad; 0 = ahead, up the screen; positive clockwise) from the player toward where an attacker
 *  stood at its last hit, relative to the camera's facing (`fwd`: the camera's forward on the ground). */
export function slabWedgeAngle(fwd: { x: number; z: number }, from: { x: number; z: number }, to: { x: number; z: number }): number {
  const fl = Math.hypot(fwd.x, fwd.z) || 1;
  const fx = fwd.x / fl, fz = fwd.z / fl;
  const dx = to.x - from.x, dz = to.z - from.z;
  return Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz); // (right, ahead): right = (-fz, fx)
}

/** The wedge: a filled triangle centred on the ring, its tip outward (viewBox -12..12 around the ring point). */
export const SLAB_WEDGE_SVG = '<path d="M0 -11L10 7L-10 7Z" fill="currentColor" stroke="rgba(0,0,0,.7)" stroke-width="1.5" stroke-linejoin="round"/>';

/** §3's pure model: your confirms, the wedges toward whoever hit you, and the red flash. Feed every game event. */
export class SlabHitCues {
  private confirm: { kind: SlabHitKind; t: number } | null = null;
  /** Attacker id → its last hit on you: when, and where it stood (ground x, z) as it hit. */
  readonly wedges = new Map<number, { t: number; x: number; z: number }>();
  private hurtAt = -10;

  /** `from`: where the event's attacker stands now (the HUD's last reading of it); a wedge keeps that point, so it never
   *  follows the attacker after the hit (contract rev. 2: it cannot reveal a hidden attacker). */
  onEvent(ev: GameEvent, localId: number, now: number, from?: { x: number; z: number } | null): void {
    if (localId < 0) return;
    if (ev.e === 'hit' && ev.src === localId && ev.dst !== localId) {
      // a kill still showing is never downgraded by a hit landing with it
      if (this.confirm?.kind === 'kill' && now - this.confirm.t < SLAB_HIT_LIFE.kill) return;
      this.confirm = { kind: ev.crit ? 'head' : 'body', t: now };
    } else if (ev.e === 'death' && ev.by === localId && ev.id !== localId) {
      this.confirm = { kind: 'kill', t: now };
    } else if (ev.e === 'death' && ev.id === localId) {
      this.wedges.clear(); // down: no wedges (and no confirm: slabHudFrame), from the takedown on
      this.confirm = null;
    } else if (ev.e === 'hit' && ev.dst === localId) {
      this.hurtAt = now;
      if (ev.src >= 0 && ev.src !== localId && from) {
        this.wedges.set(ev.src, { t: now, x: from.x, z: from.z });
        if (this.wedges.size > 8) for (const [id, w] of this.wedges) if (now - w.t >= SLAB_WEDGE.life) this.wedges.delete(id);
      }
    }
  }

  /** The confirm showing now (alpha 1 → 0 over its kind's SLAB_HIT_LIFE), or null. */
  confirmAt(now: number): { kind: SlabHitKind; alpha: number } | null {
    const c = this.confirm;
    if (!c) return null;
    const a = 1 - (now - c.t) / SLAB_HIT_LIFE[c.kind];
    return a > 0 && now >= c.t ? { kind: c.kind, alpha: Math.min(1, a) } : null;
  }

  /** The wedges showing now: attacker id, where it stood at its last hit, and alpha (1 → 0 over SLAB_WEDGE.life). */
  wedgesAt(now: number): Array<{ src: number; x: number; z: number; alpha: number }> {
    const out: Array<{ src: number; x: number; z: number; alpha: number }> = [];
    for (const [src, w] of this.wedges) {
      const a = 1 - (now - w.t) / SLAB_WEDGE.life;
      if (a > 0) out.push({ src, x: w.x, z: w.z, alpha: Math.min(1, a) });
    }
    return out;
  }

  /** The red flash's alpha now: hud.gd's _dmg_t * 0.5, at most 0.175 (the contract allows 0.25). */
  flashAt(now: number): number {
    return Math.max(0, FLASH_T - Math.max(0, now - this.hurtAt)) * 0.5;
  }

  reset(): void { this.confirm = null; this.wedges.clear(); this.hurtAt = -10; }
}

/** §3's HP chip: the HP just lost shows as a white segment above the bar's fill that drains to it over 0.4 s. */
export class SlabHpChip {
  static readonly DRAIN = 0.4;
  private last = -1;
  private from = 0;
  private t0 = -10;

  /** Feed the current HP each frame; returns the chip's top (≥ hp; = hp when there is no chip). */
  update(hp: number, now: number): number {
    if (this.last < 0 || hp > this.last) { this.last = hp; this.from = hp; this.t0 = -10; return hp; } // spawn, heal
    if (hp < this.last) { this.from = Math.max(this.top(this.last, now), this.last); this.t0 = now; }
    this.last = hp;
    return this.top(hp, now);
  }

  private top(hp: number, now: number): number {
    const k = 1 - (now - this.t0) / SlabHpChip.DRAIN;
    return k > 0 ? hp + (this.from - hp) * Math.min(1, k) : hp;
  }
}

// ------------------------------------------------------------------------------------------------ the frame model

export interface SlabHudFrame {
  match: MatchState | null;
  /** The slab this frame (SlabView.reading), with the frame's living pets. */
  slab: SlabReading | null;
  localId: number;
  /** The local character this frame (null = not spawned yet). */
  local: EntityState | null;
  roster: readonly RosterEntry[];
  camera: Camera;
}

/** The screen the frame is drawn on (px). */
export interface SlabHudView { w: number; h: number }

/** What the HUD keeps between frames: the hit cues, the HP chip, who downed whom (victim id → killer id and when), the
 *  last ground point of each pet, the local id and when the player went down (-1: up). Game events go in through
 *  slabHudEvent; slabHudFrame advances it. */
export interface SlabHudState {
  readonly hits: SlabHitCues;
  readonly chip: SlabHpChip;
  readonly deaths: Map<number, { by: number; t: number }>;
  readonly lastPos: Map<number, { x: number; z: number }>;
  localId: number;
  downSince: number;
}

export const slabHudState = (): SlabHudState => ({ hits: new SlabHitCues(), chip: new SlabHpChip(), deaths: new Map(), lastPos: new Map(), localId: -1, downSince: -1 });

const DEATH_KEEP = 64;

/** A game event into the state. A hit on you stores where its attacker stood at the last frame (the wedge's point, which
 *  never moves after); a knockout records its killer; your own knockout clears the wedges (SlabHitCues). */
export function slabHudEvent(s: SlabHudState, ev: GameEvent, now: number): void {
  s.hits.onEvent(ev, s.localId, now, ev.e === 'hit' ? s.lastPos.get(ev.src) : null);
  if (ev.e === 'death') {
    if (s.deaths.size >= DEATH_KEEP && !s.deaths.has(ev.id)) s.deaths.clear();
    s.deaths.set(ev.id, { by: ev.by, t: now });
  }
}

/** §2: who took the local player down, from its knockout record (null: a fall, the map, or unknown). The name is the
 *  room's (roster), else a plain "Cat <id>" / "Pup <id>"; the team is the roster's, else the pet's. */
export function slabKillerOf(f: Pick<SlabHudFrame, 'localId' | 'roster' | 'slab'>, rec: { by: number } | null | undefined): SlabKiller | null {
  if (!rec || rec.by < 0 || rec.by === f.localId) return null;
  const r = f.roster.find((p) => p.entity === rec.by);
  const pet = f.slab?.pets.find((p) => p.id === rec.by);
  const team = r ? r.team : pet ? pet.team : -1;
  if (team !== 0 && team !== 1) return null;
  return { name: r?.name ?? (team === 1 ? `Cat ${rec.by}` : `Pup ${rec.by}`), team };
}

/** Everything the slab HUD's §1-§3 draws this frame. */
export interface SlabHudOut {
  /** §1, null while hidden: words, shape, colour, the camera's ground distance (m), the anchor (px) and the box. */
  marker: (SlabMarker & { dist: number; x: number; y: number; box: ScreenBox; dodge: SlabMarkerDodge }) | null;
  /** §2, null unless you are down while the match runs. */
  death: SlabDeathPanel | null;
  /** §3 your confirm (null while you are down). */
  confirm: { kind: SlabHitKind; alpha: number } | null;
  /** §3 the wedges (rad, 0 = up the screen, clockwise; [] while you are down or the match is over). */
  wedges: Array<{ src: number; angle: number; alpha: number }>;
  /** §3 the HP chip's top (= your HP: no chip); null with no local character. */
  chipTop: number | null;
  /** §3 the red flash's alpha. */
  flash: number;
}

const FV = new Vector3(), FWD = new Vector3();

/**
 * The slab HUD's frame, DOM-free (the DOM only writes what this returns):
 *  - §1 the marker: shown per slabMarkerShown; line 1 is the CAMERA's ground distance to the slab centre; placed by
 *    slabMarkerPlace off the other pets (slabPetBoxes skips your own);
 *  - §2 the death panel while you are down and the match runs: the killer from the knockout record, your team, your
 *    team's respawn zone, the countdown from when you went down;
 *  - §3 while you are down: no confirm and no wedges. Otherwise each wedge points at where its attacker stood AT ITS HIT
 *    (stored by slabHudEvent), from you, relative to the camera's facing; the chip follows your HP.
 */
export function slabHudFrame(f: SlabHudFrame & SlabHudView, s: SlabHudState, now: number): SlabHudOut {
  s.localId = f.localId;
  const ended = f.match?.phase === 'ended', live = f.match?.phase === 'live';
  const L = f.local;
  const dead = !!L && (L.flags & EFlag.Dead) !== 0;
  if (f.slab) for (const p of f.slab.pets) s.lastPos.set(p.id, { x: p.x, z: p.z });

  let marker: SlabHudOut['marker'] = null;
  if (f.slab && slabMarkerShown(L, ended)) {
    const cam = f.camera.position;
    const dist = Math.hypot(cam.x - f.slab.x, cam.z - f.slab.z);
    const m = slabMarker(f.slab, dist);
    FV.set(f.slab.x, f.slab.y + SLAB_MARKER_LIFT, f.slab.z).project(f.camera);
    const behind = FV.z > 1;
    const u = Math.max(0.6, Math.min(f.w / 1280, f.h / 720));
    const pets = behind ? [] : slabPetBoxes(f.slab.pets, f.localId, f.camera, f.w, f.h);
    const at = slabMarkerPlace({ x: (FV.x * 0.5 + 0.5) * f.w, y: (-FV.y * 0.5 + 0.5) * f.h, behind, w: f.w, h: f.h, u, lines: m.lines, pets });
    marker = { ...m, dist, x: at.x, y: at.y, box: at.box, dodge: at.dodge };
  }

  const chipTop = L ? s.chip.update(Math.max(0, L.hp), now) : null;

  if (dead && s.downSince < 0) s.downSince = now;
  if (!dead) s.downSince = -1;
  let death: SlabDeathPanel | null = null;
  if (dead && live && L) {
    const rec = s.deaths.get(f.localId);
    const fresh = rec && rec.t >= s.downSince - 1.5 ? rec : null; // this knockout's record, not an old one
    const t0 = fresh ? Math.min(fresh.t, s.downSince) : s.downSince;
    const team = L.team === 1 ? 1 : 0;
    death = slabDeathPanel(slabKillerOf(f, fresh), team, slabRespawnZone(team), SLAB.respawn - (now - t0));
  }

  const confirm = dead ? null : s.hits.confirmAt(now);
  const wedges: SlabHudOut['wedges'] = [];
  if (L && !dead && !ended) {
    f.camera.getWorldDirection(FWD);
    for (const w of s.hits.wedgesAt(now)) wedges.push({ src: w.src, angle: slabWedgeAngle(FWD, L, w), alpha: w.alpha });
  }
  return { marker, death, confirm, wedges, chipTop, flash: s.hits.flashAt(now) };
}

// ------------------------------------------------------------------------------------------------ DOM

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const u = (n: number) => `calc(var(--u)*${n})`;
/** hud.gd draws its labels in white or team colours over a dark outline; the web uses a soft dark shadow instead. */
const SHADOW = `0 0 ${u(3)} rgba(0,0,0,.85),0 ${u(1)} ${u(2)} rgba(0,0,0,.9)`;
const CSS = `
.cvc-slab #cvc-hud .mb,.cvc-slab #cvc-hud .mb-wave,.cvc-slab #cvc-hud .hp,.cvc-slab #cvc-hud .am,.cvc-slab #cvc-hud .ds,
.cvc-slab #cvc-hud .dd,.cvc-slab #cvc-hud .vig,.cvc-slab #cvc-hud .vig-low,.cvc-slab #cvc-hud .hm,.cvc-slab .cvc-hf,
.cvc-slab #cvc-hud .lk [data-k="Q"],.cvc-slab-end #cvc-hud .bn,.cvc-slab-end #cvc-hud .lk,.cvc-slab-end #cvc-hud .xh{display:none!important}
.cvc-slab #cvc-hud .kf{gap:${u(2)}}
.cvc-slab #cvc-hud .kf-e.kf-plain{background:none;border:0;box-shadow:none;padding:0;animation:none;white-space:pre;
  font:500 ${u(15)}/1.25 ${FONT_BODY};color:rgba(255,255,255,.9);text-shadow:${SHADOW}}
.cvc-slab #cvc-hud .lk{background:rgba(0,0,0,.28)}
.cvc-slab #cvc-hud .lk .lk-panel{background:none;border:0;box-shadow:none;transform:none;color:#fff;text-shadow:${SHADOW}}
.cvc-slab #cvc-hud .lk .lk-panel::after{display:none}
.cvc-slab #cvc-hud .lk .lk-title{font:600 ${u(26)} ${FONT_BODY};color:#fff;-webkit-text-stroke:0;text-shadow:${SHADOW}}
.cvc-slab #cvc-hud .lk .lk-sub{font:500 ${u(14)} ${FONT_BODY};opacity:.85}
.cvc-slab #cvc-hud .lk .keys{font:500 ${u(13)} ${FONT_BODY}}
.cvc-slab #cvc-hud .lk kbd{font:600 ${u(11.5)} ${FONT_BODY};background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.45);border-radius:${u(3)};box-shadow:none}
.cvc-slab #cvc-hud .lk-main .btn{font:600 ${u(14)} ${FONT_BODY};letter-spacing:.02em;background:rgba(0,0,0,.45);color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:${u(4)};box-shadow:none;text-shadow:none}
.cvc-slab #cvc-hud .lk-main .btn:hover{background:rgba(255,255,255,.15)}
#cvc-slab{position:absolute;inset:0;pointer-events:none;overflow:hidden;user-select:none;
  --u:max(0.6px,min(calc(100vw / 1280),calc(100vh / 720)));font:500 ${u(16)}/1.2 ${FONT_BODY};color:#fff;text-shadow:${SHADOW}}
#cvc-slab .fl{position:absolute;inset:0;background:#cc0d0d;opacity:0}
#cvc-slab .top{position:absolute;left:50%;top:${u(14)};transform:translateX(-50%);display:flex;align-items:flex-start;gap:${u(18)}}
#cvc-slab .tm{width:${u(250)};display:flex;flex-direction:column;gap:${u(5)}}
#cvc-slab .tm .row{font-size:${u(22)};font-weight:600;white-space:pre;letter-spacing:.02em}
#cvc-slab .t0 .row{text-align:right}
#cvc-slab .bar{position:relative;height:${u(8)};background:rgba(0,0,0,.55)}
#cvc-slab .bar i{position:absolute;top:0;bottom:0;width:0;transition:width .25s}
#cvc-slab .t0 .bar i{right:0} #cvc-slab .t1 .bar i{left:0}
#cvc-slab .clk{width:${u(110)};text-align:center;font-size:${u(30)};font-weight:600;line-height:1.05;white-space:nowrap}
#cvc-slab .clk.ot{font-size:${u(24)};line-height:${u(32)}}
#cvc-slab .st{position:absolute;left:50%;top:${u(76)};transform:translateX(-50%);font-size:${u(18)};font-weight:600;letter-spacing:.06em;white-space:pre}
#cvc-slab .mk{position:absolute;left:0;top:0;width:0;height:0;will-change:transform}
#cvc-slab .mk svg{position:absolute;left:${u(-12)};top:${u(-12)};width:${u(24)};height:${u(24)};overflow:visible;filter:drop-shadow(0 0 ${u(2)} rgba(0,0,0,.85))}
#cvc-slab .mkt{position:absolute;left:0;bottom:${u(13)};transform:translateX(-50%);text-align:center;font-size:${u(13)};font-weight:600;line-height:1.2;white-space:pre}
#cvc-slab .you{position:absolute;left:${u(24)};bottom:${u(80)};font-size:${u(16)};font-weight:600;letter-spacing:.04em;white-space:pre}
#cvc-slab .hpn{position:absolute;left:${u(24)};bottom:${u(52)};font-size:${u(22)};font-weight:600}
#cvc-slab .hpb{position:absolute;left:${u(24)};bottom:${u(32)};width:${u(240)};height:${u(14)};background:rgba(0,0,0,.55)}
#cvc-slab .hpb i{position:absolute;left:0;top:0;bottom:0;width:100%}
#cvc-slab .hpb .chip{background:#fff;width:0}
#cvc-slab .hpb .fill{box-shadow:${u(2)} 0 0 rgba(0,0,0,.75)} /* the dark seam where the fill meets the chip (as hud.gd) */
#cvc-slab .amm{position:absolute;right:${u(24)};bottom:${u(28)};font-size:${u(26)};font-weight:600;text-align:right;white-space:nowrap}
#cvc-slab .dp{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:${u(6)};text-align:center;white-space:pre;
  background:${SLAB_DEATH_BACKING};border-radius:${u(10)};padding:${u(12)} ${u(22)} ${u(14)}}
#cvc-slab .dp .d1{font-size:${u(24)};font-weight:700;display:flex;align-items:center}
#cvc-slab .dp .d1 svg{width:${u(15)};height:${u(15)};margin-right:${u(7)};overflow:visible;filter:drop-shadow(0 0 ${u(2)} rgba(0,0,0,.85))}
#cvc-slab .dp .d2,#cvc-slab .dp .d3{font-size:${u(18)};font-weight:600}
#cvc-slab .dp .d4{font-size:${u(26)};font-weight:700;margin-top:${u(4)}}
#cvc-slab .hc{position:absolute;left:50%;top:50%;width:${u(40)};height:${u(40)};margin:${u(-20)} 0 0 ${u(-20)};overflow:visible;opacity:0;filter:drop-shadow(0 0 ${u(1.5)} rgba(0,0,0,.9))}
#cvc-slab .wg{position:absolute;left:50%;top:50%;width:0;height:0}
#cvc-slab .wg svg{position:absolute;left:${u(-12)};top:${u(-12 - 110)};width:${u(24)};height:${u(24)};overflow:visible;transform-origin:${u(12)} ${u(12 + 110)};
  color:#ff5a4d;opacity:0;filter:drop-shadow(0 0 ${u(2)} rgba(0,0,0,.9))}
#cvc-slab .hint{position:absolute;left:50%;bottom:${u(76)};transform:translateX(-50%);width:${u(1000)};text-align:center;font-size:${u(14)};opacity:.85;white-space:pre-line}
#cvc-slab .win{position:absolute;inset:0;background:rgba(5,5,10,.62);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${u(10)};text-align:center}
#cvc-slab .wt{font-size:${u(58)};font-weight:700;letter-spacing:.02em;white-space:nowrap}
#cvc-slab .ws{font-size:${u(22)};font-weight:600;white-space:pre}
#cvc-slab .wy{font-size:${u(22)}}
#cvc-slab .wr{margin-top:${u(26)};font-size:${u(22)}}
`;

export interface SlabHud {
  /** A slab match is running (MatchState.mode 'slab'). */
  readonly active: boolean;
  /** The winner screen is up (the match is over): Enter rematches, the general scoreboard waits. */
  readonly winnerUp: boolean;
  /** Every snapshot's MatchState (main.ts: bus 'match'): remembers overtime even when frames are seconds apart, so a
   *  match that ends in overtime keeps OVERTIME on the clock. */
  onMatch(ms: MatchState): void;
  /** A game event (the HUD subscribes to the client bus itself; labs and tests may feed events here instead). */
  onGameEvent(ev: GameEvent): void;
  update(f: SlabHudFrame, dt: number): void;
  dispose(): void;
}

export interface SlabHudOptions {
  /** Points to win (SLAB.winScore, 60). */
  winScore: number;
  /** The event source (default: the client bus); null = none (feed onGameEvent yourself). */
  bus?: Pick<EventBus, 'on'> | null;
  /** Seconds clock (default performance.now() / 1000; labs pass a frozen one). */
  clock?: () => number;
}

export function createSlabHud(ui: HTMLElement, opts: SlabHudOptions): SlabHud {
  const clockFn = opts.clock ?? (() => performance.now() / 1000);
  const root = document.createElement('div');
  root.id = 'cvc-slab';
  root.innerHTML = `<style>${CSS}</style>
    <div class="fl" data-slab-flash></div>
    <div class="top">
      <div class="tm t0"><div class="row" data-slab-s0-row>${SLAB_TEAM_NAMES[0]}  <span data-slab-s0>0</span></div><div class="bar"><i></i></div></div>
      <div class="clk" data-slab-clock>3:00</div>
      <div class="tm t1"><div class="row" data-slab-s1-row><span data-slab-s1>0</span>  ${SLAB_TEAM_NAMES[1]}</div><div class="bar"><i></i></div></div>
    </div>
    <div class="st" data-slab-state>SLAB  NEUTRAL</div>
    <div class="mk" data-slab-marker><div class="mkt"><div data-slab-marker-l1></div><div data-slab-marker-l2></div></div><svg viewBox="-12 -12 24 24" aria-hidden="true"></svg></div>
    <div class="you" data-slab-you></div>
    <div class="hpn" data-slab-hp>120</div><div class="hpb"><i class="chip"></i><i class="fill"></i></div>
    <div class="amm" data-slab-ammo>30 / 30</div>
    <div class="dp" data-slab-death style="display:none"><div class="d1"></div><div class="d2"></div><div class="d3"></div><div class="d4"></div></div>
    <svg class="hc" data-slab-hit viewBox="-20 -20 40 40" aria-hidden="true"></svg>
    <div class="wg" data-slab-wedges></div>
    <div class="hint" data-slab-hint style="display:none"></div>
    <div class="win" data-slab-win style="display:none"><div class="wt"></div><div class="ws"></div><div class="wy"></div><div class="wr"></div></div>`;
  ui.appendChild(root);
  root.style.display = 'none';
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as unknown as T;
  const rows = [q('[data-slab-s0-row]'), q('[data-slab-s1-row]')];
  const scores = [q('[data-slab-s0]'), q('[data-slab-s1]')];
  const fills = [q('.t0 .bar i'), q('.t1 .bar i')];
  const flash = q('.fl'), clock = q('.clk'), state = q('.st');
  const mk = q('.mk'), mkLine1 = q('[data-slab-marker-l1]'), mkLine2 = q('[data-slab-marker-l2]'), mkSvg = q<SVGSVGElement>('.mk svg');
  const you = q('.you'), hpNum = q('.hpn'), hpBar = q('.hpb'), hpFill = q('.hpb .fill'), hpChip = q('.hpb .chip'), ammo = q('.amm');
  const dp = q('.dp'), dLines = [q('.dp .d1'), q('.dp .d2'), q('.dp .d3'), q('.dp .d4')];
  const hc = q<SVGSVGElement>('.hc'), wg = q('.wg'), hint = q('.hint');
  const win = q('.win'), wt = q('.wt'), ws = q('.ws'), wy = q('.wy'), wr = q('.wr');
  hint.textContent = SLAB_HINT;
  for (const t of [0, 1] as const) {
    rows[t].style.color = hex(lighten(TEAM[t], 0.45));
    fills[t].style.background = hex(lighten(TEAM[t], 0.15));
  }
  const cache = new Map<Element, string>();
  const text = (e: Element, t: string) => { if (cache.get(e) !== t) { cache.set(e, t); e.textContent = t; } };
  const html = (e: Element, t: string) => { if (cache.get(e) !== t) { cache.set(e, t); e.innerHTML = t; } };
  const disp = (e: HTMLElement | SVGElement, on: boolean) => { const v = on ? '' : 'none'; if (e.style.display !== v) e.style.display = v; };
  const style = (e: HTMLElement | SVGElement, k: string, v: string) => { if (e.style.getPropertyValue(k) !== v) e.style.setProperty(k, v); };
  let active = false, winnerUp = false, overtime = false;
  let hintLeft = HINT_SECS;
  const st = slabHudState();
  const wedgeEls: SVGSVGElement[] = [];

  const onGameEvent = (ev: GameEvent) => slabHudEvent(st, ev, clockFn());
  const bus = opts.bus === undefined ? clientBus : opts.bus;
  const offGame = bus ? bus.on('game', onGameEvent) : () => {};

  const setActive = (on: boolean, ended: boolean) => {
    active = on;
    winnerUp = on && ended;
    disp(root, on);
    ui.classList.toggle('cvc-slab', on);
    ui.classList.toggle('cvc-slab-end', on && ended);
  };

  return {
    get active() { return active; },
    get winnerUp() { return winnerUp; },
    onMatch(ms) {
      if (ms.mode === 'slab' && ms.phase === 'live') overtime = slabOvertime(ms);
    },
    onGameEvent,
    update(f, dt) {
      const M = f.match;
      st.localId = f.localId;
      if (!M || M.mode !== 'slab') { if (active) setActive(false, false); return; }
      setActive(true, M.phase === 'ended');
      const now = clockFn();
      // the frame model decides; below only writes it (and the pure field helpers) to the DOM
      const o = slabHudFrame({ ...f, w: innerWidth, h: innerHeight }, st, now);
      for (const t of [0, 1] as const) {
        text(scores[t], String(M.score[t]));
        style(fills[t], 'width', `${(slabFrac(M.score[t], opts.winScore) * 100).toFixed(1)}%`);
      }
      if (M.phase === 'live') overtime = slabOvertime(M);
      const c = slabClock(M, overtime);
      text(clock, c.text);
      clock.className = c.tone === 'ot' ? 'clk ot' : 'clk';
      style(clock, 'color', hex(SLAB_CLOCK_COLOR[c.tone]));
      const line = slabLineFor(M, f.slab);
      disp(state, line !== null);
      if (line !== null) { text(state, line); style(state, 'color', hex(slabHudColor(f.slab))); }
      const L = f.local;
      const dead = !!L && (L.flags & EFlag.Dead) !== 0;

      // §1 the slab marker
      const m = o.marker;
      disp(mk, !!m);
      if (m) {
        text(mkLine1, m.lines[0]);
        text(mkLine2, m.lines[1]);
        html(mkSvg, slabMarkerSvg(m.shape));
        mk.dataset.shape = m.shape;
        mk.dataset.dodge = m.dodge;
        style(mk, 'color', hex(m.color));
        mk.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
      }

      // §4 you: your team, hit points with the §3 chip, ammo, the controls hint
      for (const e of [you, hpNum, hpBar, ammo]) disp(e, !!L);
      if (L) {
        const team = L.team === 1 ? 1 : 0;
        text(you, slabYouText(team));
        style(you, 'color', hex(lighten(TEAM[team], 0.45)));
        const hp = Math.max(0, L.hp), max = Math.max(1, L.maxHp);
        text(hpNum, String(Math.ceil(hp)));
        style(hpFill, 'width', `${((hp / max) * 100).toFixed(1)}%`);
        style(hpFill, 'background', hex(slabHpColor(hp)));
        style(hpChip, 'width', `${((Math.min(max, o.chipTop ?? hp) / max) * 100).toFixed(1)}%`);
        text(ammo, slabAmmoText(L));
      }
      hintLeft -= dt;
      disp(hint, !!L && !dead && hintLeft > 0 && M.phase === 'live');

      // §2 the death panel
      const panel = o.death;
      disp(dp, !!panel);
      if (panel) {
        const [l1, l2, l3, l4] = panel.lines;
        if (panel.glyph) {
          const split = l1.lastIndexOf('  ·  ') + 5;
          html(dLines[0], `${esc(l1.slice(0, split))}<svg viewBox="-8 -8 16 16" aria-hidden="true" style="color:${hex(lighten(TEAM[panel.glyph.team], 0.35))}" data-glyph="${panel.glyph.shape}">${slabTeamGlyphSvg(panel.glyph.team)}</svg>${esc(l1.slice(split))}`);
        } else html(dLines[0], esc(l1));
        text(dLines[1], l2); text(dLines[2], l3); text(dLines[3], l4);
      }

      // §3 hits: your confirm at the crosshair, the wedges toward where whoever hit you stood, the red flash
      const conf = o.confirm;
      if (conf) {
        html(hc, slabHitSvg(conf.kind));
        hc.dataset.kind = conf.kind;
        style(hc, 'color', hex(SLAB_HIT[conf.kind].color));
      }
      style(hc, 'opacity', conf ? conf.alpha.toFixed(2) : '0');
      while (wedgeEls.length < o.wedges.length) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        el.setAttribute('viewBox', '-12 -12 24 24');
        el.innerHTML = SLAB_WEDGE_SVG;
        wg.appendChild(el);
        wedgeEls.push(el);
      }
      wedgeEls.forEach((el, i) => {
        const w = o.wedges[i];
        if (!w) { style(el, 'opacity', '0'); return; }
        style(el, 'transform', `rotate(${(w.angle * 180 / Math.PI).toFixed(1)}deg)`);
        style(el, 'opacity', w.alpha.toFixed(2));
      });
      style(flash, 'opacity', o.flash.toFixed(3));

      // the winner screen
      const me = f.roster.find((r) => r.entity === f.localId) ?? null;
      const w = slabWinner(M, me);
      disp(win, !!w);
      if (w) {
        text(wt, w.title);
        style(wt, 'color', w.team === -1 ? '#ffffff' : hex(lighten(TEAM[w.team], 0.4)));
        text(ws, w.score);
        text(wy, w.you);
        text(wr, w.prompt);
      }
    },
    dispose() {
      offGame();
      ui.classList.remove('cvc-slab', 'cvc-slab-end');
      root.remove();
      cache.clear();
      st.hits.reset();
      st.deaths.clear();
      st.lastPos.clear();
    },
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

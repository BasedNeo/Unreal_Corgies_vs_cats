// Match modes beyond skirmish/TDM, as data (both the authority and the client read these).
//
// core-rush — PvP domination over three Core Pads (A, B, C) placed fairly between the two bases.
// Snapshot convention for a pad (EntityState, EntityKind.Zone, one entity per pad, never removed):
//   seed = pad index (0 A, 1 B, 2 C) · team = owner (Neutral = 2) · x, y, z = pad centre on the ground ·
//   hp / maxHp = capture progress / CAPTURE_SCALE for the team in `ammo` (ammo = progress team + 1, 0 = none) ·
//   flags & Busy = contested (both teams on the pad).

export interface CoreRushConfig {
  warmup: number;
  /** Match length (s); the leader wins at the horn. */
  timeLimit: number;
  /** First team to this many points wins. */
  scoreLimit: number;
  endedHold: number;
  /** Pad capture radius (m, horizontal) and vertical reach (m). */
  padRadius: number;
  padReach: number;
  /** Seconds for ONE player to take a neutral pad (an enemy pad takes twice as long: neutralize, then capture). */
  captureTime: number;
  /** Extra capture speed per additional teammate on the pad (capped at 3 players). */
  perExtraPlayer: number;
  /** Progress drift per second when nobody stands on a pad (back to its owner, or down to neutral). */
  drift: number;
  /** Points per second per held pad (added silently to the team score). */
  holdRate: number;
  /** One-off points for taking a pad (announced). */
  captureBonus: number;
}

export const CORE_RUSH: CoreRushConfig = {
  warmup: 5,
  timeLimit: 480,
  scoreLimit: 250,
  endedHold: 10,
  padRadius: 4.5,
  padReach: 2.5,
  captureTime: 5,
  perExtraPlayer: 0.4,
  drift: 0.2,
  holdRate: 1,
  captureBonus: 5,
};

export const CORE_PAD_LABELS = ['A', 'B', 'C'] as const;
/** hp/maxHp resolution of pad progress in snapshots. */
export const CAPTURE_SCALE = 100;

// ------------------------------------------------------------------------------------------------ base-assault (W9 G4a)
// Base Assault — each team keeps a squeaky tennis ball on a stand in its base. Touch the enemy's ball to steal it, run
// it home and touch your own flag's capture ring with it: a capture. You can only capture while your own ball is home,
// until the stalemate relief opens the ring (both balls away for `stalemateAfter` s). First to `captureLimit`, or the
// most captures at the horn. The carrier runs `carrierSpeed` × every move speed (movement.ts, predicted too), cannot
// ride vehicles or Ear Glide, and drops the ball where it is knocked out (snapped to the surface under it; floats on
// water). A dropped ball goes home after `returnTime` s, or at once when a defender touches it; an attacker picks it up.
//
// Snapshot convention (EntityState, EntityKind.Prop, cls -1, three entities per team, never removed; `team` = the base):
//   ball   seed BA_BALL_SEED   x, y, z = ball centre (home: on the stand · carried: on the carrier's back · dropped: on
//                              the ground) · weapon = BallState (0 home, 1 carried, 2 dropped) · ammo = carrier id
//                              (0 = none) · hp = seconds until a dropped ball returns (0.1 s), maxHp = returnTime ·
//                              vx, vy, vz = the carrier's velocity (dead reckoning) · flags & Busy = away from home
//   stand  seed BA_STAND_SEED  x, y, z = stand foot on the ground (the ball sits `standTop` + `ballRadius` above it) ·
//                              yaw = the way the stand faces
//   goal   seed BA_GOAL_SEED   x, y, z = capture ring centre on the ground (the base's flag) · flags & Busy = this team
//                              can't capture now (its own ball is away, no relief) · weapon = 1 while the stalemate
//                              relief is open · hp = seconds until the relief opens while both balls are away (else 0),
//                              maxHp = stalemateAfter
// Game events (no protocol change): `score` with reason 'ball taken' (team = the thief's team), 'ball dropped' and
// 'ball returned' (team = the ball's own team), 'captured' (pts 1, team = the scorer); `pickup` item 'squeaky_ball' for
// every steal or pick-up (id = the new carrier).

export interface BaseAssaultConfig {
  warmup: number;
  /** Match length (s); the team with more captures wins at the horn (equal = draw). */
  timeLimit: number;
  /** First team to this many captures wins. */
  captureLimit: number;
  endedHold: number;
  /** Capture ring radius (m, horizontal, around the flag) and vertical reach (m). */
  captureRadius: number;
  captureReach: number;
  /** A dropped ball goes home after this many seconds. */
  returnTime: number;
  /** Both balls away this long (s) → the stalemate relief: either team may capture with its own ball away. */
  stalemateAfter: number;
  /** Multiplier on every move speed of the carrier (walk, run, sprint, slide). */
  carrierSpeed: number;
  /** A ball is touched when its centre is within this distance (m) of a character's capsule. */
  touchReach: number;
}

export const BASE_ASSAULT: BaseAssaultConfig = {
  warmup: 5,
  timeLimit: 480,
  captureLimit: 3,
  endedHold: 10,
  captureRadius: 3.2,
  captureReach: 2.5,
  returnTime: 20,
  stalemateAfter: 60,
  carrierSpeed: 0.75,
  touchReach: 0.55,
};

/** Ball geometry shared by the authority (touch/seat heights) and the views (the drawn ball is the touched ball). */
export const BA_BALL = {
  /** Ball radius (m): a pet-scale tennis ball, about the size of a corgi's head. */
  radius: 0.22,
  /** Height of the stand's cup above the stand foot (m): the ball sits on it at chest height. */
  standTop: 0.86,
  /** Ball centre above the carrier's feet (m), on its back. */
  carryHeight: 1.0,
  /** A dropped ball floats this far above a water surface (m). */
  float: 0.08,
} as const;

/** The ball's state (EntityState.weapon of a ball entity). */
export const BallState = { Home: 0, Carried: 1, Dropped: 2 } as const;
export type BallStateId = (typeof BallState)[keyof typeof BallState];

/** Seeds that mark Base Assault props in snapshots (EntityKind.Prop, cls -1). */
export const BA_BALL_SEED = 0xba11;
export const BA_STAND_SEED = 0xba57;
export const BA_GOAL_SEED = 0xba60;
/** `pickup` event item for a steal / pick-up. */
export const BA_PICKUP_ITEM = 'squeaky_ball';
/** `score` event reasons. */
export const BA_REASON = { taken: 'ball taken', dropped: 'ball dropped', returned: 'ball returned', captured: 'captured' } as const;

// ------------------------------------------------------------------------------------------------ slab (Wave 13 TW-SIM)
// Slab — the Godot game's mode (engines/godot/game/match.gd, slab.gd, tuning.gd are the rules source), on The Lot.
// One neutral control slab at the map's point-symmetry centre: a team scores 1 point per full second while it ALONE has
// at least one alive (not downed) pet on the slab; contested (both teams) or empty, nobody scores, and the second being
// counted starts over whenever the holder changes. First to `winScore`, else the most points at `timeLimit` s; tied
// then: overtime until someone leads, at most `overtimeMax` s, then a draw. Downed pets respawn after `respawn` s at
// their team spawn with a `spawnShield` s shield. Everybody carries the Assault kit with the Squeaker Rifle only: no
// class ability, no ordnance, pickups, vehicles or terminals. No warm-up: the match is live from its first tick.
// The result holds until a human presses Reload (R / pad X; an edge at least `rematchDelay` s after the end), then the
// match restarts at 0-0 and 3:00; a room with no humans restarts by itself after `endedHold` s.
// A pet is on the slab when its feet are inside the square (|x - cx| <= sx/2, |z - cz| <= sz/2) and cy - 1 < y < cy + 3.
//
// Snapshot contract (no protocol change):
//   MatchState  mode 'slab' · phase 'live' (from the first tick; no warm-up) or 'ended' · score = [corgis, cats], whole
//               points · timeLeft = seconds left of regulation, or of overtime while in overtime (frozen at the final
//               value while ended) · objective = SLAB_TEXT.hold ('HOLD THE SLAB'), SLAB_TEXT.overtime ('OVERTIME') in
//               overtime; ended: SLAB_TEXT.win[team] ('CORGI COMPANY WINS' / 'CAT CADRE WINS') or SLAB_TEXT.draw
//               ('DRAW') · winner = team, or -1 (a draw is winner -1 with phase 'ended' and objective 'DRAW') · wave 0
//   Zone        one EntityKind.Zone entity for the slab, seed SLAB_ZONE_SEED (0), never removed: x, y, z = SLAB.center ·
//               team = the holder (Team.Neutral = 2 when nobody holds it) · flags & EFlag.Busy = contested ·
//               hp, maxHp, ammo 0 · state frozen while ended, neutral again on a restart
// Game events: `score` with reason 'reset' (both teams, pts 0) on a restart and 'win' (pts 0) for the winner; points
// for holding are added silently (no event per point), like core-rush's held pads.

export interface SlabConfig {
  /** Slab centre on the ground (m): `slab.center` of engines/godot/data/the_lot.json (tools/godot/export-lot.mjs). */
  center: { x: number; y: number; z: number };
  /** Slab size along x and z (m). */
  size: { x: number; z: number };
  /** Feet height window around center.y (m): on the slab when center.y - below < y < center.y + above. */
  below: number;
  above: number;
  /** First team to this many points wins. */
  winScore: number;
  /** Regulation length (s); the leader at the horn wins. */
  timeLimit: number;
  /** Tied at the horn: overtime until someone leads, at most this long (s), then a draw. */
  overtimeMax: number;
  /** Seconds a downed pet waits before it respawns at its team spawn. */
  respawn: number;
  /** Seconds of spawn shield after every respawn (and at a restart). */
  spawnShield: number;
  /** Seconds after the end before a human's Reload press counts as a rematch request. */
  rematchDelay: number;
  /** Bots-only room (no human present): seconds the result stays up before the match restarts by itself. */
  endedHold: number;
  /** Pets per team: 1v1 by default, 2v2 as the option (the Room fills empty slots with bots). */
  teamSize: number;
  teamSizes: readonly number[];
  /** The one class and the one weapon of this mode. */
  cls: 'assault';
  weapon: 'squeaker_rifle';
}

export const SLAB: SlabConfig = {
  center: { x: 0, y: -0.0572, z: 0 },
  size: { x: 8, z: 8 },
  below: 1,
  above: 3,
  winScore: 60,
  timeLimit: 180,
  overtimeMax: 60,
  respawn: 3,
  spawnShield: 1,
  rematchDelay: 1,
  endedHold: 10,
  teamSize: 1,
  teamSizes: [1, 2],
  cls: 'assault',
  weapon: 'squeaker_rifle',
};

/** EntityState.seed of the slab's Zone entity. */
export const SLAB_ZONE_SEED = 0;

/** MatchState.objective strings of the slab mode (the client compares against these). Team names as Godot's HUD. */
export const SLAB_TEXT = {
  hold: 'HOLD THE SLAB',
  overtime: 'OVERTIME',
  draw: 'DRAW',
  win: ['CORGI COMPANY WINS', 'CAT CADRE WINS'],
} as const;

/** Is a pet whose feet are at (x, y, z) on the slab? (The authority's test; the client may use it for hints.) */
export function onSlab(x: number, y: number, z: number, cfg: Pick<SlabConfig, 'center' | 'size' | 'below' | 'above'> = SLAB): boolean {
  const c = cfg.center;
  return Math.abs(x - c.x) <= cfg.size.x * 0.5 && Math.abs(z - c.z) <= cfg.size.z * 0.5 && y > c.y - cfg.below && y < c.y + cfg.above;
}

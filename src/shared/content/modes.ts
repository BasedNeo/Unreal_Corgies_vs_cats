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

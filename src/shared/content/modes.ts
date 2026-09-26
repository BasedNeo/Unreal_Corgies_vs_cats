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

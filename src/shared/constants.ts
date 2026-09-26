// Global tuning constants shared by sim, host, client and server.
// Units: meters, seconds, radians. +Y up. Characters face -Z at yaw 0.

export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
/** Snapshots per second sent from the authority to each client. */
export const SNAPSHOT_HZ = 30;
export const SNAPSHOT_EVERY = Math.round(TICK_HZ / SNAPSHOT_HZ);
/** Client renders remote entities this far in the past (seconds) to interpolate between snapshots. */
export const INTERP_DELAY = 0.1;

export const GRAVITY = -24;
export const MAX_PLAYERS_PER_ROOM = 12;
export const PROTOCOL_VERSION = 1;

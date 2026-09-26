// Interaction components (module augmentation on SimEntity), the per-Sim runtime and the plain-data
// channels this lane shares through sim.state. No Three.js, no DOM, no Math.random().
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import type { EntityId } from '../../shared/types';
import { TICK_HZ } from '../../shared/constants';
import { hash2, mulberry32 } from '../../shared/rng';
import type { CoreId, PickupId, PickupKind, PickupLayout } from '../../shared/content/pickups';
import type { ObjectiveChain } from '../../shared/content/objectives';

/** One pickup spot (an EntityKind.Pickup entity that lives for the whole match). */
export interface PickupState {
  /** Item on offer — for an empty core spot, the core that appears there next. */
  id: PickupId;
  kind: PickupKind;
  /** Index of the spot in its layout list (cores / kibble). */
  spot: number;
  spotId: string;
  available: boolean;
  /** Seconds until the pickup (re)appears while unavailable (Infinity = waiting for the match to go live). */
  timer: number;
  /** Length of the current wait (progress display). */
  timerTotal: number;
  /** Touch radius (m). */
  radius: number;
}

/** A timed Upgrade Core buff on a character, with what it changed so expiry restores stats exactly. */
export interface ActiveBuff {
  id: CoreId;
  /** Tick at which the buff expires. */
  until: number;
  /** Max-hp bonus granted (Thick Fur), removed on expiry. */
  hpBonus: number;
  /** Move speeds before Zoomies+ scaled them (restored by assignment, bit-exact). */
  move: { walkSpeed: number; runSpeed: number; sprintSpeed: number } | null;
}

export interface OrdnanceState {
  /** Terminal content id (TERMINALS key). */
  id: 'ordnance_terminal';
}

export interface BeaconState {
  chain: string;
}

declare module '../entity' {
  interface SimEntity {
    pickup?: PickupState;
    ordnance?: OrdnanceState;
    buffs?: ActiveBuff[];
    /** Tick from which this character may swap kits again at an Ordnance Terminal. */
    kitSwapReady?: number;
    beacon?: BeaconState;
  }
}

/**
 * Test/lab knobs, read on the first tick: `sim.state.interactConfig = { ... }`. By default the interaction
 * layer switches on when the Room's match mode lists it (TERMINALS.ordnance_terminal.modes), so bare
 * unit-test sims of other lanes never get surprise kiosks, cores or kibble.
 */
export interface InteractConfig {
  /** Force the whole layer on or off (default: by room mode). */
  auto?: boolean;
  /** Individual parts (default true when the layer is on). */
  terminals?: boolean;
  cores?: boolean;
  kibble?: boolean;
  objectives?: boolean;
  /** Map layout override (flat test worlds, labs). Default: PICKUP_LAYOUTS[world.name]. */
  layout?: PickupLayout;
  /** Objective chain override (default: chains for this map + mode). */
  chain?: ObjectiveChain;
  /** Core timing overrides (seconds). */
  coreFirstSpawn?: number;
  coreStagger?: number;
  coreRespawn?: number;
  kibbleRespawn?: number;
}

/** Points owed to players' roster scores (Room drains this every tick: `drainRosterCredits`). */
export interface RosterCredit { id: EntityId; pts: number; reason: string }

export interface InteractRuntime {
  placed: boolean;
  enabled: boolean;
  parts: { terminals: boolean; cores: boolean; kibble: boolean; objectives: boolean };
  /** Identity of the MatchState object last seen (the match system replaces it on restart). */
  matchRef: unknown;
  lastPhase: string;
  /** Cores have been scheduled for the current match (it went live). */
  coresScheduled: boolean;
  pickups: EntityId[];
  /** The pickup entities themselves (fixtures for the whole match: no per-tick map lookups). */
  pickupEnts: SimEntity[];
  terminals: EntityId[];
  beacon: EntityId;
  chain: ObjectiveChain | null;
  /** Private deterministic stream (core rolls) so other systems' sim.rng() sequences are unchanged. */
  rng: () => number;
}

const runtimes = new WeakMap<Sim, InteractRuntime>();

export function interactRuntime(sim: Sim): InteractRuntime {
  let rt = runtimes.get(sim);
  if (!rt) {
    rt = {
      placed: false, enabled: false, parts: { terminals: false, cores: false, kibble: false, objectives: false },
      matchRef: undefined, lastPhase: '', coresScheduled: false, pickups: [], pickupEnts: [], terminals: [], beacon: -1, chain: null,
      rng: mulberry32(Math.floor(hash2(sim.seed, 0x51, 0x1c7) * 0x7fffffff)),
    };
    runtimes.set(sim, rt);
  }
  return rt;
}

export function interactConfig(sim: Sim): InteractConfig {
  return (sim.state.interactConfig as InteractConfig | undefined) ?? {};
}

export function roomMode(sim: Sim): string | undefined {
  return (sim.state.room as { mode?: string } | undefined)?.mode;
}

/** Queue roster points for a player's entity (the Room adds them to the scoreboard). */
export function creditRoster(sim: Sim, id: EntityId, pts: number, reason: string): void {
  if (pts <= 0) return;
  let q = sim.state.rosterCredits as RosterCredit[] | undefined;
  if (!q) { q = []; sim.state.rosterCredits = q; }
  q.push({ id, pts, reason });
}

/** Take (and clear) the queued roster credits. Called by the Room after each tick. */
export function drainRosterCredits(sim: Sim): RosterCredit[] {
  const q = sim.state.rosterCredits as RosterCredit[] | undefined;
  if (!q || q.length === 0) return [];
  sim.state.rosterCredits = [];
  return q;
}

export const ticksOf = (seconds: number): number => Math.round(seconds * TICK_HZ);

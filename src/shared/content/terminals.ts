// Terminals as data (theme content). Two kinds share EntityKind.Terminal:
//   vehicle   Vehicle Terminals vend a vehicle (V1/R1: src/sim/vehicles). "Kart-O-Matic" (one per base, runtime
//             site) and the "Rooftop Hangar" (R1: one, neutral, at a fixed site on The Rooftops, vends RC planes).
//   ordnance  Ordnance Terminals swap a character's class kit IN PLACE (S1: src/sim/interact). The choice
//             arrives as a normal `{t:'class'}` message; the Room applies it without a respawn when the
//             player stands within `useRange` of their own team's Ordnance Terminal.
//
// Snapshot convention (EntityState, EntityKind.Terminal): cls = index into TERMINAL_IDS (wire order,
// append only). V1's kart terminals are sent with cls -1 today; the client treats -1 as the kart
// terminal (`terminalKindAt`). The hangar goes out with its index (2) through the CLASS_IDS trick. Ordnance terminals: x, y, z, yaw = kiosk ground point (screen faces yaw),
// team = owner, flags & Busy = never set (swaps are per-player cooldowns), hp/maxHp = 0.
//
// Units: meters, seconds.
import { CLASS_IDS, type ClassId } from '../types';
import type { VehicleId } from './vehicles';
import { GARAGE, GARAGE_ROOF } from '../world/garage';

interface TerminalBase {
  id: string;
  name: string;
  catName: string;
  /** Interact within this distance (m, horizontal, from the kiosk center). */
  useRange: number;
  /** Solid kiosk collider half extents (m). */
  hx: number; hy: number; hz: number;
  /** Match modes whose map setup places this terminal near each team's spawns (Room-hosted sims). */
  modes: readonly string[];
}

/**
 * A terminal at a fixed spot of a district (instead of a runtime site near a team's spawns). World
 * coordinates; placed only when the world has that district and the surface under the kiosk and the pad
 * is where the data says (tests/unit/vehicle-plane.test.ts validates the runway).
 */
export interface FixedTerminalSite {
  district: string;
  /** Kiosk ground point and facing (the screen faces `yaw`). */
  x: number; y: number; z: number; yaw: number;
  /** Vehicle pad (ground point) and the heading a fresh vehicle gets. */
  padX: number; padY: number; padZ: number; padYaw: number;
  /** Clear take-off run (m) from the pad along padYaw. */
  runway: number;
}

/** A Vehicle Terminal (V1). The name is kept from vehicles.ts so V1's imports keep working. */
export interface TerminalDef extends TerminalBase {
  kind: 'vehicle';
  /** Vehicle this terminal vends. */
  vehicle: VehicleId;
  /** Interact prompt verb ("vend a kart"). */
  verb: string;
  /** Neutral terminals serve every team (the vehicle takes its user's team colors). */
  neutral?: boolean;
  /** Fixed placement (else: a runtime site near each team's spawns, see src/sim/vehicles/sites.ts). */
  site?: FixedTerminalSite;
  /** Seconds after its kart is destroyed before the terminal can vend again. */
  cooldown: number;
  /** Seconds before re-arming after its kart despawned unused (abandoned) — no penalty. */
  rearm: number;
  /** Price in kibble (the economy is not live yet; the authority ignores it while 0). */
  cost: number;
  /** The kart pops out this far (m) to the kiosk's right. */
  padOffset: number;
}

/** An Ordnance Terminal (S1): class kit swap in place. */
export interface OrdnanceTerminalDef extends TerminalBase {
  kind: 'ordnance';
  /** Seconds between two swaps of the same character (the Room also rate-limits class messages to 1 s). */
  swapCooldown: number;
  /** Kits offered on the kiosk screen (all live in the Room's class rules). */
  kits: readonly ClassId[];
  /** Max vertical offset (m) between the character's feet and the kiosk's ground point. */
  maxDy: number;
  /** Placement: preferred distance (m) from the team's spawn centroid and keep-out from other fixtures. */
  siteRadius: number;
  keepOut: number;
}

export type AnyTerminalDef = TerminalDef | OrdnanceTerminalDef;

/** Vehicle terminal ids (V1 uses `TerminalId` for these). */
export const VEHICLE_TERMINAL_IDS = ['kart_terminal', 'plane_hangar'] as const;
export type TerminalId = (typeof VEHICLE_TERMINAL_IDS)[number];

/** Every terminal id, in snapshot `cls` order (append only). */
export const TERMINAL_IDS = ['kart_terminal', 'ordnance_terminal', 'plane_hangar'] as const;
export type AnyTerminalId = (typeof TERMINAL_IDS)[number];

export const TERMINALS: Record<TerminalId, TerminalDef> & { ordnance_terminal: OrdnanceTerminalDef } = {
  kart_terminal: {
    id: 'kart_terminal', kind: 'vehicle', name: 'Kart-O-Matic', catName: 'Kart-O-Matic', verb: 'vend a kart',
    vehicle: 'mower_kart', useRange: 2.5, cooldown: 20, rearm: 3, cost: 0,
    hx: 0.6, hy: 1.1, hz: 0.45, padOffset: 3.1, modes: ['yard-skirmish', 'team-deathmatch', 'core-rush', 'base-assault'],
  },
  // R1: the Rooftop Hangar. One per map, NEUTRAL and contested: The Rooftops sit near the line of equal distance
  // between the bases, so the plane is a power position both teams fight over (and gives Overwatch's perches a
  // reason to be contested). The pad sits at the north end of a 18.7 m take-off run along the roof's east side
  // (x 89.3, clear of the hatch, the skylights and the vent stack), nose south over the parapet toward the yard.
  plane_hangar: {
    id: 'plane_hangar', kind: 'vehicle', name: 'Rooftop Hangar', catName: 'Rooftop Hangar', verb: 'launch a plane',
    vehicle: 'rc_plane', useRange: 2.5, cooldown: 25, rearm: 3, cost: 0, neutral: true,
    hx: 0.6, hy: 1.1, hz: 0.45, padOffset: 2.95,
    site: {
      district: 'rooftops',
      x: GARAGE.x + 11.0, y: GARAGE_ROOF, z: GARAGE.z - 9.3, yaw: Math.PI / 2,
      padX: GARAGE.x + 8.3, padY: GARAGE_ROOF, padZ: GARAGE.z - 8.2, padYaw: Math.PI,
      runway: 18.7,
    },
    modes: ['yard-skirmish', 'team-deathmatch', 'core-rush', 'base-assault', 'adventure'],
  },
  ordnance_terminal: {
    id: 'ordnance_terminal', kind: 'ordnance', name: 'Ordnance Kiosk', catName: 'Ordnance Kiosk',
    useRange: 2.6, swapCooldown: 1, kits: CLASS_IDS, maxDy: 2,
    hx: 0.8, hy: 1.25, hz: 0.55, siteRadius: 7, keepOut: 3.5,
    modes: ['yard-skirmish', 'team-deathmatch', 'boss-rush', 'core-rush', 'base-assault'],
  },
};

/** Index of a terminal id in TERMINAL_IDS (the value carried in `EntityState.cls`), -1 if unknown. */
export function terminalIndex(id: string): number {
  return (TERMINAL_IDS as readonly string[]).indexOf(id);
}

/** The VEHICLE terminal at a wire index (null for other kinds / unknown). V1's views fall back to the kart terminal. */
export function terminalByIndex(i: number): TerminalDef | null {
  const id = TERMINAL_IDS[i];
  const d = id ? TERMINALS[id] : null;
  return d && d.kind === 'vehicle' ? d : null;
}

/** Any terminal definition at a wire index, or null. */
export function anyTerminalByIndex(i: number): AnyTerminalDef | null {
  const id = TERMINAL_IDS[i];
  return id ? TERMINALS[id] : null;
}

/**
 * What kind of terminal a snapshot `cls` is. -1 / unknown = 'vehicle' (V1's kart terminals are sent
 * without a content index). Views: V1's vehicle views should skip `'ordnance'`; S1's views draw it.
 */
export function terminalKindAt(cls: number): AnyTerminalDef['kind'] {
  return anyTerminalByIndex(cls)?.kind ?? 'vehicle';
}

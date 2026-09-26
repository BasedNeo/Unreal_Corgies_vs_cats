// Pickups as data (theme content): Upgrade Cores (match-scoped timed buffs, soft effects — MASTER_PLAN §0:
// no permanent combat power; they reset at match end) and Golden Kibble collectibles, plus where they sit
// on each map. The authoritative pickup systems live in src/sim/interact; clients read this table for
// names, colors and timers.
//
// Snapshot convention (EntityState, EntityKind.Pickup — one entity per spot, never removed):
//   cls = index into PICKUP_IDS (for an empty core spot: the core that spawns there next) · team = Neutral ·
//   x, y, z = pickup center · seed = spot index · flags & Busy = empty (collected / not spawned yet) ·
//   ammo = whole seconds until it (re)appears while Busy · hp / maxHp = refill progress seconds / total.
// Events: `pickup { id: collector, item: PickupId }` (existing GameEvent shape).
import type { TeamId } from '../types';

export type PickupKind = 'core' | 'collectible';

/** Buff multipliers (1 / absent = unchanged). */
export interface BuffEffect {
  /** Weapon fire-rate multiplier (shot cooldowns drain this much faster). */
  fireRate?: number;
  /** Max-hp multiplier: the extra hp is granted as a shield on pickup and removed on expiry. */
  maxHp?: number;
  /** Walk/run/sprint speed multiplier. */
  moveSpeed?: number;
  /** Ability cooldown length multiplier (0.5 = cooldowns tick twice as fast). */
  abilityCooldown?: number;
}

export interface PickupDef {
  id: string;
  kind: PickupKind;
  /** HUD / toast name. */
  name: string;
  /** One-line effect text for the HUD chip. */
  blurb: string;
  /** Touch radius (m): collected when a character's capsule comes this close to the pickup center. */
  radius: number;
  /** Buff length (s); 0 for collectibles. */
  duration: number;
  buff: BuffEffect;
  /** Roster points for the collector (Room scoreboard). */
  score: number;
  /** Palette key for the client (glow color). */
  color: 'accentHot' | 'glowOrange' | 'glowCyan' | 'tennisBall' | 'laserRed' | 'teamCorgisTrim';
}

/** Wire order (EntityState.cls). Append only. */
export const PICKUP_IDS = ['overclock', 'thick_fur', 'zoomies_plus', 'squeaky_clean', 'golden_kibble'] as const;
export type PickupId = (typeof PICKUP_IDS)[number];
export const CORE_IDS = ['overclock', 'thick_fur', 'zoomies_plus', 'squeaky_clean'] as const satisfies readonly PickupId[];
export type CoreId = (typeof CORE_IDS)[number];

export const PICKUPS: Record<PickupId, PickupDef> = {
  overclock: {
    id: 'overclock', kind: 'core', name: 'Overclock', blurb: '+20% fire rate',
    radius: 0.9, duration: 20, buff: { fireRate: 1.2 }, score: 10, color: 'laserRed',
  },
  thick_fur: {
    id: 'thick_fur', kind: 'core', name: 'Thick Fur', blurb: '+30% max hp shield',
    radius: 0.9, duration: 25, buff: { maxHp: 1.3 }, score: 10, color: 'accentHot',
  },
  zoomies_plus: {
    id: 'zoomies_plus', kind: 'core', name: 'Zoomies+', blurb: '+15% move speed',
    radius: 0.9, duration: 20, buff: { moveSpeed: 1.15 }, score: 10, color: 'tennisBall',
  },
  squeaky_clean: {
    id: 'squeaky_clean', kind: 'core', name: 'Squeaky Clean', blurb: 'ability cooldown −50%',
    radius: 0.9, duration: 20, buff: { abilityCooldown: 0.5 }, score: 10, color: 'glowCyan',
  },
  golden_kibble: {
    id: 'golden_kibble', kind: 'collectible', name: 'Golden Kibble', blurb: '+25 score',
    radius: 0.5, duration: 0, buff: {}, score: 25, color: 'teamCorgisTrim',
  },
};

/** Upgrade Core timing (seconds). Spots light up staggered after the match goes live, then refill after a pickup. */
export const CORE_RULES = {
  /** First core at spot i appears `firstSpawn + i × stagger` s after the match goes live. */
  firstSpawn: 15,
  stagger: 6,
  /** Seconds after a pickup before the spot offers its next core (a new type is rolled right away and shown as a ghost). */
  respawn: 35,
  /** Match modes that run cores (Room-hosted sims). */
  modes: ['yard-skirmish', 'team-deathmatch', 'boss-rush'] as readonly string[],
};

/** Golden Kibble timing: a collected kibble comes back for everyone after `respawn` s. */
export const KIBBLE_RULES = {
  respawn: 60,
  modes: ['yard-skirmish', 'team-deathmatch', 'boss-rush'] as readonly string[],
};

export function pickupIndex(id: string): number {
  return (PICKUP_IDS as readonly string[]).indexOf(id);
}

export function pickupByIndex(i: number): PickupDef | null {
  const id = PICKUP_IDS[i];
  return id ? PICKUPS[id] : null;
}

export function isCore(id: string): id is CoreId {
  return (CORE_IDS as readonly string[]).includes(id);
}

// ------------------------------------------------------------------------------------------------ layouts

/** A standing point [x, y, z] (feet) used by the reachability proof. */
export type RoutePoint = readonly [number, number, number];

export interface PickupSpot {
  id: string;
  /** Pickup center (world). */
  x: number; y: number; z: number;
  /** Where it is, in player words (lab labels, docs). */
  hint: string;
  /**
   * Proof route (kibble): standing points from open lawn to the pickup, each hop doable with a run,
   * jump and double jump by the weakest jumper (corgi). The last hop must touch the pickup (landing on
   * it or passing through it mid-air). Validated by tests/unit/interact-yard.test.ts.
   */
  route?: readonly RoutePoint[];
  /** Team base this spot is closest to (balance notes only). */
  side?: TeamId | -1;
}

export interface PickupLayout {
  cores: readonly PickupSpot[];
  kibble: readonly PickupSpot[];
}

// West Yard (WorldData.name 'West Yard'). Heights from surfaceAt(); the tests re-derive them.
// Cores sit at four contested spots roughly equidistant from both bases (corgi spawn centroid ≈ (-34, -72),
// cat ≈ (51, 71)): under the two lawn chairs, the big tree's limb perch, the slide tower deck.
// Kibble: 20 hideouts — easy ones near each base (first success within a minute), parkour ones on the
// deck rail, cat tree, shed roof and bean teepee, and secrets behind the neighbour-strip fence gaps.
const CAT_TREE: RoutePoint[] = [[15.5, 0, 84], [19.4, 0.6, 81.2], [19.6, 1.6, 84.8], [22.4, 2.8, 81.0], [24.8, 4.0, 84.0], [22.0, 5.2, 87.4], [22.2, 6.4, 84.3]];

export const PICKUP_LAYOUTS: Record<string, PickupLayout> = {
  'West Yard': {
    cores: [
      { id: 'lounge_east', x: 21, y: 0.62, z: -14, hint: 'under the orange lawn chair', side: -1, route: [[19.3, 0, -10.4]] },
      { id: 'tree_limb', x: -48.0, y: 5.97, z: 32.25, hint: "on the big tree's limb perch", side: -1,
        route: [[-60.4, 0.21, 33.6], [-55.2, 2.72, 26.4], [-52.8, 4.07, 28.1], [-48.9, 5.17, 29.9]] },
      { id: 'slide_tower', x: 79.4, y: 5.8, z: -36.4, hint: 'on top of the slide tower', side: -1, route: [[79.4, 0, -21.5]] },
      { id: 'lounge_west', x: -20, y: 0.75, z: 10, hint: 'under the teal lawn chair', side: -1, route: [[-21.9, 0, 6.5]] },
    ],
    kibble: [
      // ---- Corgi side (north)
      { id: 'dog_bowl', x: -12.4, y: 1.45, z: -82.2, hint: 'in the dog bowl', side: 0,
        route: [[-12.4, 0, -78.2]] },
      { id: 'doghouse_roof', x: -18, y: 6.8, z: -87, hint: 'on the doghouse ridge', side: 0,
        route: [[-25.5, 0, -81.5], [-23.2, 2.0, -83.8], [-21.2, 4.62, -86.2]] },
      { id: 'deck_rail', x: -34.25, y: 6.75, z: -88.5, hint: 'on the deck railing', side: 0,
        route: [[-53, -0.14, -74.5], [-53, 3.0, -88], [-41, 3.0, -86.4], [-37.4, 4.4, -86.4]] },
      { id: 'ac_unit', x: -78.5, y: 3.95, z: -97.6, hint: 'on the AC unit', side: 0,
        route: [[-78.5, 0.15, -87.5], [-78.5, 2.1, -95.0], [-77.4, 3.4, -97.4]] },
      { id: 'picnic_table', x: 28, y: 3.55, z: -52, hint: 'on the picnic table', side: 0,
        route: [[28.9, -0.06, -58.5], [28.4, 1.86, -55.2]] },
      // ---- Center
      { id: 'trampoline_sky', x: 0, y: 7.4, z: 0, hint: 'high above the trampoline', side: -1,
        route: [[0, -0.12, 9.5]] },
      { id: 'beach_ball', x: -34, y: 2.6, z: -6, hint: 'on the beach ball', side: -1,
        route: [[-34, -0.4, -2.2]] },
      { id: 'chair_arm', x: -18.2, y: 3.35, z: 9.25, hint: "on the teal lawn chair's armrest", side: -1,
        route: [[-22.2, 0, 7.2], [-20.1, 1.85, 9.9]] },
      // ---- West: the Garden, the mound, the neighbour strip
      { id: 'garden_bridge', x: -81, y: 4.25, z: -54.6, hint: 'on the Garden trellis bridge', side: -1,
        route: [[-71, 0, -44.5], [-71, 1.3, -47.8], [-71, 2.5, -52.25], [-73.35, 3.7, -54.6], [-77, 3.7, -54.6]] },
      { id: 'bean_teepee', x: -89, y: 7.75, z: -20, hint: 'on top of the bean teepee', side: -1,
        route: [[-89, 0, -25.8], [-89, 1.2, -22.2], [-86.8, 2.4, -20], [-89, 3.6, -17.8], [-91.2, 4.8, -20], [-89, 6.0, -22.2]] },
      { id: 'gnome_tower', x: -78.8, y: 5.45, z: 33.0, hint: 'on the gnome watchtower', side: -1,
        route: [[-72.5, 0, 39.5], [-75.8, 1.3, 38.5], [-75.8, 2.5, 36.0], [-75.8, 3.7, 33.5]] },
      { id: 'birdbath', x: -36.1, y: 4.7, z: 66, hint: 'under the birdbath on the mound', side: 1,
        route: [[-36.1, 0.04, 40]] },
      { id: 'behind_firewood', x: -112.3, y: 0.55, z: 52, hint: 'behind the firewood (west dig hole)', side: 1,
        route: [[-94.5, 0, 45], [-104.5, 0, 45], [-112.3, 0, 46.8]] },
      // ---- East
      { id: 'swing_seat', x: 60.5, y: 2.4, z: -36, hint: 'on a swing seat', side: 0,
        route: [[60.5, -0.1, -31.8]] },
      { id: 'frog_statue', x: 45.5, y: 2.3, z: 19, hint: 'on the frog statue by the pond', side: -1,
        route: [[45.5, -0.1, 23]] },
      { id: 'tarp_roll', x: 106.5, y: 2.75, z: 48, hint: 'on the tarp (east fence gap)', side: 1,
        route: [[94.5, 0, 45], [103.8, 0, 45.2]] },
      { id: 'kiddie_duck', x: -11.8, y: 1.6, z: 50.5, hint: 'over the rubber duck', side: 1,
        route: [[-11.8, 0, 42.2], [-11.8, 0, 47.2]] },
      // ---- Cat side (south)
      { id: 'cat_tree_top', x: 22.2, y: 6.95, z: 84.1, hint: 'on top of the cat tree', side: 1,
        route: CAT_TREE.slice(0, -1) },
      { id: 'shed_roof', x: 41, y: 11.7, z: 88, hint: 'on the shed roof ridge', side: 1,
        route: [...CAT_TREE, [26.5, 7.16, 82.7], [35.4, 9.1, 82.7]] },
      { id: 'cardboard_fort', x: 30, y: 4.86, z: 58.1, hint: 'on top of the cardboard fort', side: 1,
        route: [[37.2, -0.3, 59.4], [34.2, 1.7, 59], [31.5, 2.5, 58.4]] },
    ],
  },
};

/** The pickup layout for a map (by WorldData.name), or null when the map has none. */
export function pickupLayoutFor(mapName: string): PickupLayout | null {
  return PICKUP_LAYOUTS[mapName] ?? null;
}

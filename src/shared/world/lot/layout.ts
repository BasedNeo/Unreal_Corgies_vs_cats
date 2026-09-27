// The Lot (Wave 8 M2, docs/design/EXPANSION_VISION.md): layout constants shared by the builder, the tests and the
// hand-back (docs/handoff/W8-LOT.md). Pure data. World axes like the West Yard: x east, z south; the corgis hold the
// north (z < 0), the cats the south (z > 0). Pet scale: characters ~1.2 m, the world is real size x 4.
//
//   N  hoarding · the neighbours' house looms beyond it
//   NW The Foundation (corgi base): a 80 x 30 m foundation pit 2.4 m deep, spawns on its floor, a vehicle ramp (E)
//      and a foot ramp (S), cement-bag walls on the rim, two floodlight towers, and three communication trenches
//      (2 m deep) running south: to Container Canyon (T1), to the middle (T2), and a cross trench (T3)
//   W  the West Yard's board fence (its house, big tree and shed read over it) · Container Canyon: two 24 m site-office
//      containers (10.4 m tall, open ends, a side door each) with an 11 m lane between; a gangway to the east roof
//   C  The Mud: open wet mud, mounds, pallets, cable drums, rebar bundles, barrels, cones, tarp-covered skips,
//      tyre ruts of three haul roads · the drainage ditch across the whole lot (still water, 0.9 m deep), crossed dry
//      only on three causeways (canyon, middle, pipes)
//   E  hoarding with the site gate · The Pipeworks: two tunnels of three concrete drainage pipes (6 m, walkable floor),
//      a pallet stair onto the west tunnel's crown
//   SE The Scaffolds (cat base): the 4.6 m spoil heap from the pit (flat top, cat spawns, a north ramp, a gentle west
//      side for karts), a 48 m scaffold along its north edge (deck +4.4 m, 9 m abs) with a crow's nest (13.4 m abs),
//      pallet stacks, two floodlight towers
//   S  hoarding · the tower crane (outside the lot) swings its jib over the cat base
// Point-symmetric about the origin where it matters for balance: pit <-> heap, canyon <-> pipes, causeways.

export const LOT_NAME = 'The Lot';
/** Nav/physics half extent (the nav grid covers [-HALF, HALF]^2). */
export const LOT_HALF = 160;
/** Perimeter line: hoarding (N, E, S) and the West Yard's fence (W). */
export const LOT_EDGE = 152;
/** Out-of-bounds guard. */
export const LOT_BOUNDS = 156;
/** Terrain grid half size (1 m cells). */
export const GRID_HALF = 164;
/** Dusk. */
export const LOT_TIME_OF_DAY = 0.74;
/** W9 L3: rain by default (weather.ts WeatherBias, minutes as [min, span]): a match opens overcast and the rain rolls
 *  in after 1.3-1.8 min, the first cycle always storms (and 85 % of the later ones), then more rain; a 1-2 min dry
 *  break and an overcast lead-in per 13 min cycle. Wet ~3/4 of the time; the West Yard keeps the default (~1/3). */
export const LOT_WEATHER = { id: 'the_lot', open: [1.3, 0.5], rain: [2, 1.5], storm: [1.5, 1], stormChance: 0.85, clear: [1, 1], overcast: [0.8, 0.7] } as const;

// ------------------------------------------------------------------------------------------------ bases
/** Corgi base: the foundation pit (flat floor inside the rect, steep 2.2:1 walls outside it). */
export const PIT = { x: -40, z: -110, hx: 40, hz: 15, floor: -2.4 } as const;
/** Pit ramps: the vehicle ramp climbs east out of the pit, the foot ramp south. */
export const PIT_RAMP_EAST = { z: -109, half: 5, x0: 0, run: 10 } as const;
export const PIT_RAMP_SOUTH = { x: -63, half: 3, z0: -95, run: 8 } as const;
/** Cat base: the spoil heap (flat top inside the rect; slope widths per side: steep north face, gentle west side). */
export const HEAP = { x: 40, z: 110, hx: 40, hz: 15, top: 4.6, wN: 2.6, wS: 9, wE: 11, wW: 16 } as const;
/** The heap's north ramp (x corridor, climbing south from z1 to the top edge). */
export const HEAP_RAMP = { x: 63, half: 3, z1: 95, run: 12.6 } as const;

/** Terrain carve wall steepness (rise per metre): 2.2 = 65.6 deg (unwalkable; nav limit 48, KCC 52). */
export const WALL_STEEP = 2.2;

/** Communication trenches (corgi side): polylines [x0, z0, x1, z1, ...], half width, floor, exit ramp length at the
 *  end (0 = no exit). The floor rises to 0 over the exit. T3 joins T1 and T2. */
export const TRENCHES: readonly { id: string; pts: readonly number[]; half: number; floor: number; exit: number }[] = [
  { id: 'T1', pts: [-50, -97, -56, -80, -78, -70, -86, -57, -86, -47], half: 2, floor: -2, exit: 9 },
  { id: 'T2', pts: [-22, -97, -18, -80, -10, -63, -8, -45], half: 2, floor: -2, exit: 9 },
  { id: 'T3', pts: [-56, -80, -18, -80], half: 2, floor: -2, exit: 0 },
];

// ------------------------------------------------------------------------------------------------ ditch
/** Drainage ditch along z = 0: flat floor |z| <= FLOOR_HZ, banks to the ground at |z| = FLOOR_HZ + BANK. Water
 *  segments between the three dry causeways (x ranges are the full carved footprint incl. banks). */
export const DITCH = { z: 0, floorHz: 2.2, bank: 2.4, floor: -1.9, surface: -1.0 } as const;
export const DITCH_SEGMENTS: readonly (readonly [number, number])[] = [[-150, -106], [-68, -14], [14, 68], [106, 150]];
/** Dry crossings (x ranges). */
export const CAUSEWAYS = { canyon: [-106, -68], middle: [-14, 14], pipes: [68, 106] } as const;

// ------------------------------------------------------------------------------------------------ lanes
/** Site-office container (real 6 x 2.4 x 2.6 m, x4): long axis z, open ends, 0.4 m walls, 0.3 m floor. */
export const CONTAINER = { L: 24, W: 9.6, H: 10.4, wall: 0.4, floor: 0.3, doorW: 3.6, doorH: 7.2 } as const;
export const CONTAINERS: readonly { id: string; x: number; z: number; col: string; stripe: string; door: { side: 1 | -1; z: number } }[] = [
  { id: 'c_west', x: -95.5, z: -32, col: 'garageSiding2', stripe: 'garageSiding', door: { side: 1, z: -25 } },
  { id: 'c_east', x: -74.5, z: -32, col: 'hull', stripe: 'olive', door: { side: -1, z: -39 } },   // (W9: khaki -> hull: it stands in the west container's shade at dusk)
];
/** The gangway up to c_east's roof (east side, climbing south to a landing flush with the roof). */
export const GANGWAY = { x: -68.3, width: 2.4, zLow: -62, zTop: -44, landing: [-44, -40] as const } as const;

/** Concrete drainage pipe (real 1.5 m x 2.25 m, x4): 12-sided ring, outer radius, wall, segment length. */
export const PIPE = { ro: 3.0, ri: 2.55, seg: 12, len: 9, gap: 1.8, sink: 0.12 } as const;
/** Two tunnels of three segments each, axes along z at cell centres (x = k + 0.5), running south from z0. */
export const TUNNELS: readonly { id: string; x: number; z0: number }[] = [
  { id: 'tunnel_west', x: 79.5, z0: 13.7 },
  { id: 'tunnel_east', x: 91.5, z0: 13.7 },
];
/** Pallet stair onto the west tunnel's crown: 4 stacks (1..4 pallets high), x ranges, at z in [z0, z1]. */
export const PALLET_STAIR = { z0: 36.6, z1: 41.4, xs: [[60.4, 64.4], [64.4, 68.4], [68.4, 72.4], [72.4, 76.4]] as const } as const;

/** Flat pads (terrain flattened to h, rect half extents, falloff). */
export const PADS: readonly { id: string; x: number; z: number; hx: number; hz: number; h: number; falloff: number }[] = [
  { id: 'canyon', x: -83.5, z: -40.5, hx: 19.5, hz: 23.5, h: 0, falloff: 4 },
  { id: 'pipes', x: 78, z: 29, hx: 20, hz: 19, h: 0, falloff: 4 },
  { id: 'pipe_mid_w', x: -44, z: -29.5, hx: 5.5, hz: 3.6, h: 0, falloff: 3 },
  { id: 'pipe_mid_e', x: 44, z: 29.5, hx: 5.5, hz: 3.6, h: 0, falloff: 3 },
];

// ------------------------------------------------------------------------------------------------ roads (tyre ruts)
/** Haul roads [x0, z0, ...]: twin ruts RUT.offset either side of the centreline. A: gate -> pit ramp, B: gate ->
 *  heap ramp, C: pit ramp -> middle causeway -> heap's west side. */
export const ROADS: readonly { id: string; pts: readonly number[] }[] = [
  { id: 'A', pts: [150, -30, 110, -40, 62, -58, 32, -84, 16, -108] },
  { id: 'B', pts: [110, -40, 100, -10, 100, 52, 84, 76, 63, 84] },
  { id: 'C', pts: [14, -100, 10, -60, 0, -22, 0, 22, -8, 62, -18, 104] },
];
export const RUT = { offset: 3.2, width: 0.9, depth: 0.22 } as const;

/** Mud mounds (round hills: full height inside r, cosine falloff). Point-symmetric pairs. */
export const MOUNDS: readonly { x: number; z: number; r: number; falloff: number; h: number }[] = [
  { x: -30, z: -20, r: 3.5, falloff: 8, h: 2.2 }, { x: 30, z: 20, r: 3.5, falloff: 8, h: 2.2 },
  { x: 8, z: -44, r: 3, falloff: 7, h: 2.0 }, { x: -8, z: 44, r: 3, falloff: 7, h: 2.0 },
  { x: 46, z: -28, r: 2.5, falloff: 6, h: 1.6 }, { x: -46, z: 28, r: 2.5, falloff: 6, h: 1.6 },
  { x: -124, z: 58, r: 6, falloff: 12, h: 3.2 }, { x: 124, z: -58, r: 6, falloff: 12, h: 3.2 },
  { x: -128, z: -96, r: 5, falloff: 10, h: 2.6 }, { x: 128, z: 96, r: 5, falloff: 10, h: 2.6 },
];

// ------------------------------------------------------------------------------------------------ scaffold (cat base)
/** Scaffold along the heap's north edge: x span, z span, deck height over the heap top, bay length; the crow's nest
 *  is a second deck over bay 4 reached by a ramp in bay 3's south half. Ramps from the heap top at both ends. */
export const SCAFFOLD = { x0: 12, x1: 60, z0: 96.5, z1: 101.3, deck: 4.4, bay: 9.6, nest: 8.8, rampRun: 10 } as const;

// ------------------------------------------------------------------------------------------------ spawns
/** 16 per team on a 6 m grid: corgis on the pit floor, cats on the heap top (point-symmetric). */
export const CORGI_SPAWN_XS = [-74, -68, -62, -56] as const;
export const CORGI_SPAWN_ZS = [-123, -117, -111, -105] as const;
export const CAT_SPAWN_XS = [56, 62, 68, 74] as const;
export const CAT_SPAWN_ZS = [105, 111, 117, 123] as const;

// ------------------------------------------------------------------------------------------------ floodlights
/** Floodlight towers: base (ground point) and the ground point the heads aim at. Also WorldData.lamps (sodium). */
export const FLOOD_TOWERS: readonly { id: string; x: number; z: number; aim: readonly [number, number]; team: 0 | 1 }[] = [
  { id: 'flood_pit_west', x: -85, z: -112, aim: [-58, -110], team: 0 },
  { id: 'flood_pit_east', x: 5.5, z: -121, aim: [-22, -108], team: 0 },
  { id: 'flood_heap_west', x: 20, z: 123.5, aim: [26, 106], team: 1 },
  { id: 'flood_heap_east', x: 44, z: 123.5, aim: [44, 106], team: 1 },
];
// (W9 L3: the heap towers aim at the heap top in front of the scaffold, so the fake pool lies on the ground it lights;
// the real spot cone still covers the scaffold deck.)
/** Mast height (feet of the lamp bar) and lamp heads per tower. */
export const FLOOD = { mast: 22, heads: 4 } as const;

// ------------------------------------------------------------------------------------------------ landmarks
/** Tower crane (visual only, outside the south hoarding): base, mast height, jib length and heading (toward the lot). */
export const CRANE = { x: -30, z: 188, mast: 96, jib: 118, counter: 32 } as const;
/** W9 L3 Base Assault (WorldData.bases): each team's flag (score here) and ball stand, point-symmetric. The corgis'
 *  flag is the pit's banner pole, the cats' a matching pole on the heap top; the stands sit on open floor 9 m from
 *  their flag toward the lot. */
export const BASES = [
  { team: 0, flag: [-36, -112], stand: [-40, -105] },
  { team: 1, flag: [36, 112], stand: [40, 105] },
] as const;
/** W9 L3 (M5): the lanes bots walk between the bases (src/sim/ai/lanes.ts picks one per bot and life by weight),
 *  listed from the corgi end (north) to the cat end (south); cats walk them backwards. Points are [x, z] on the ground
 *  grid, or [x, z, s]: linger s seconds there (the lane's hot spot). Container Canyon (between the containers, or
 *  through the west one), the Mud (the middle causeway), the Pipeworks (through the west or the east tunnel). */
export const LOT_LANES: readonly { id: string; weight: number; pts: readonly (readonly number[])[] }[] = [
  { id: 'canyon', weight: 0.23, pts: [[-63, -86], [-86, -53], [-85, -32, 4], [-86, -12], [-87, 6], [-84, 40], [-50, 78], [-12, 100]] },
  { id: 'canyon_w', weight: 0.16, pts: [[-63, -86], [-95.5, -50], [-95.5, -32, 3], [-95.5, -14], [-92, 6], [-84, 40], [-50, 78], [-12, 100]] },
  { id: 'mud', weight: 0.17, pts: [[12, -109], [6, -62], [0, -28, 2], [0, 0], [0, 28, 2], [-6, 62], [-12, 100]] },
  { id: 'pipes_w', weight: 0.24, pts: [[12, -109], [45, -82], [80, -45], [87, -12], [87, 6], [79.5, 11, 2], [79.5, 29, 4], [79.5, 47], [66, 64], [63, 86]] },
  { id: 'pipes_e', weight: 0.2, pts: [[12, -109], [45, -82], [80, -45], [87, -12], [87, 6], [91.5, 11, 2], [91.5, 29, 3], [91.5, 47], [66, 64], [63, 86]] },
];
/** Portable toilet by the east hoarding. */
export const TOILET = { x: 118, z: -120, yaw: -Math.PI / 2 } as const;
/** Site gate in the east hoarding (visual; closed). */
export const GATE = { x: 152, z0: -38, z1: -22 } as const;

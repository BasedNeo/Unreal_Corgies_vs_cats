// WorldData contract types. OWNER: world lane (L2).
// Everything here is plain data (+ pure functions) shared by the authority (colliders, world systems,
// AI) and the client (visuals). Additions over the Wave 0 skeleton are OPTIONAL fields so older
// callers and hand-built test worlds keep compiling; consumers treat a missing field as empty.
import type { TeamId, Vec3 } from '../types';

/**
 * Solid oriented box collider. Rotation is applied yaw (Y) first, then pitch (local X), then roll
 * (local Z) — Euler order 'YXZ', the same convention as VisualPrim. A pitched box is a ramp.
 */
export interface PropBox {
  /** Content type (e.g. 'fence', 'deck', 'ramp', 'boundary'). Invisible blockers use 'boundary'. */
  type: string;
  x: number; y: number; z: number;
  /** Half extents in meters. */
  hx: number; hy: number; hz: number;
  rotY: number;
  /** Rotation about the local X axis after yaw (radians). Ramps. */
  pitch?: number;
  /** Rotation about the local Z axis after yaw+pitch (radians). */
  roll?: number;
  color?: number;
}

/** Solid upright cylinder collider (axis +Y). y = center. */
export interface PropCylinder {
  type: string;
  x: number; y: number; z: number;
  r: number;
  /** Half height. */
  hh: number;
}

export interface SpawnPoint extends Vec3 { yaw: number; team: TeamId }

/** Trampoline-style launcher: a grounded character whose feet are within r of (x, z) and within
 *  0.35 m of y is launched upward with `vy` (m/s). */
export interface JumpPad {
  id: string;
  x: number; y: number; z: number;
  r: number;
  vy: number;
}

/** Wading water: slows characters whose feet are below `surfaceY - 0.1` inside the zone. */
export interface WaterZone {
  id: string;
  shape: 'circle' | 'rect';
  x: number; z: number;
  /** circle radius, or rect half extents (hx, hz). */
  r?: number; hx?: number; hz?: number;
  surfaceY: number;
  /** Deepest point (for visuals). */
  bottomY: number;
  /** Per-tick horizontal velocity keep factor at 60 Hz (0.6 = strong drag). */
  drag: number;
}

/** Camera bookmark for screenshots / spectator. */
export interface Bookmark {
  name: string;
  pos: [number, number, number];
  look: [number, number, number];
  /** Suggested vertical FOV (degrees). */
  fov?: number;
}

export type PrimShape = 'box' | 'cyl' | 'sphere' | 'torus' | 'cone' | 'ring';
/** Render group for a visual primitive. solid = ink hull + crease ink; soft = ink hull only (organic
 *  shapes: hedges, canopy, cushions); noink = toon lit without ink (glass, tiny details). */
export type PrimGroup = 'solid' | 'soft' | 'noink';

/**
 * One visual primitive of the prop catalog (pure data; the client turns them into merged, styled
 * meshes). Center-positioned, rotated YXZ like PropBox.
 * Dimensions: box [a=width x, b=height y, c=depth z]; cyl [a=top radius, b=height, c=bottom radius];
 * sphere [a,b,c = radii x,y,z]; torus [a=ring radius, b=tube radius, c=arc (radians, 0 = full)];
 * cone [a=radius, b=height]; ring (thick open tube) [a=outer radius, b=height, c=wall thickness].
 */
export interface VisualPrim {
  s: PrimShape;
  x: number; y: number; z: number;
  a: number; b: number; c: number;
  yaw?: number; pitch?: number; roll?: number;
  /** Palette key (style tokens / world palette), e.g. 'fenceWood'. */
  col: string;
  /** Box edge rounding radius (m). */
  bev?: number;
  /** Radial segments for round shapes. */
  seg?: number;
  g?: PrimGroup;
}

/** Baked terrain grid: height() is the exact triangulated surface of these samples
 *  (every quad split on the b–c diagonal, like a Rapier heightfield). */
export interface TerrainGrid {
  x0: number; z0: number;
  /** Meters between samples. */
  cell: number;
  /** Samples per side. */
  n: number;
  /** Row-major: heights[j * n + i] is the height at (x0 + i*cell, z0 + j*cell). */
  heights: Float32Array;
}

/** Ground surface weights at a point, each 0..1 (grass is the remainder). */
export interface SurfaceSample { dirt: number; sand: number; mulch: number; wild: number }

/** A straight run of board fence from (x0,z0) to (x1,z1). Boards face the direction
 *  face * (-dz, dx), where (dx, dz) is the unit run direction; posts and rails sit on the other side.
 *  Colliders for fences are emitted into `props` separately (type 'fence'). */
export interface FenceRun {
  x0: number; z0: number; x1: number; z1: number;
  h: number;
  face: 1 | -1;
  /** Openings along the run, t in meters from (x0,z0). dig = boards raised over a dug hole;
   *  broken = boards snapped off at `top`; open = boards missing. */
  gaps?: { t0: number; t1: number; kind: 'dig' | 'broken' | 'open'; bottom?: number; top?: number }[];
}

/** A foliage/scatter exclusion or density zone for visuals. */
export interface ScatterZone {
  x: number; z: number; r: number;
  /** 0 = no foliage inside, >1 = denser tall tufts. */
  density: number;
}

/**
 * Tall grass / dense foliage that hides characters standing in it (G1, The Garden). An ellipse on the
 * ground (radii rx, rz along its local axes after `yaw`), fading out over the outer ~28 % of the radius.
 * concealmentAt() (queries.ts) turns it into a 0..1 value; the sim's conceal system combines it with
 * stance (still / sneaking / running) and firing into the AI-facing concealment level.
 */
export interface ConcealZone {
  id: string;
  x: number; z: number;
  rx: number; rz: number;
  yaw?: number;
  /** Foliage height above the ground (m). Feet more than ~h - 1 m above the ground are not hidden. */
  h: number;
  /** Visual density multiplier (1 = default). */
  density?: number;
  /** Visual mix: tall grass, grass + flower heads, or scruffy weeds. */
  style?: 'grass' | 'flowers' | 'weeds';
}

/**
 * Garden sprinkler (G1). While a burst is on, a water jet sweeps back and forth across the arc
 * [a0, a1] (math angle in XZ: direction (cos a, sin a)); characters in the jet are shoved along it
 * and popped off their feet, and the swept grass turns slippery. The schedule is a pure function of
 * (world seed, tick): see sprinklerAt() in weather.ts.
 */
export interface Sprinkler {
  id: string;
  /** Nozzle position. */
  x: number; y: number; z: number;
  /** Horizontal reach of the jet (m). */
  reach: number;
  a0: number; a1: number;
  /** Seconds per back-and-forth sweep. */
  sweep: number;
  /** Burst schedule (seconds): one `burst`-long burst per `period`, never before `first`. */
  burst: number; period: number; first: number;
}

/** A named district rectangle (HUD/music/debug: "entering The Garden"). */
export interface District { id: string; name: string; minX: number; maxX: number; minZ: number; maxZ: number }

export interface WorldData {
  seed: number;
  name: string;
  /** Terrain height at world XZ (meters). Must be deterministic and identical on every machine. */
  height(x: number, z: number): number;
  /** Half-size of the playable square, centered on the origin. */
  halfExtent: number;
  props: PropBox[];
  spawns: SpawnPoint[];
  /** Kill plane: anything below this Y respawns. */
  killY: number;
  // ---- L2 additions (optional) ----
  cylinders?: PropCylinder[];
  jumpPads?: JumpPad[];
  water?: WaterZone[];
  bookmarks?: Bookmark[];
  prims?: VisualPrim[];
  fences?: FenceRun[];
  terrain?: TerrainGrid;
  /** Surface weights for visuals/scatter (paths, sand, mulch, un-mowed edges). */
  surface?(x: number, z: number): SurfaceSample;
  scatterZones?: ScatterZone[];
  /** Characters outside these bounds are returned to a spawn (out-of-bounds guard). */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Default time of day for visuals (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset). */
  timeOfDay?: number;
  // ---- G1 additions (optional) ----
  /** Tall-grass concealment zones (The Garden). */
  concealZones?: ConcealZone[];
  /** Garden sprinklers (bursts are scheduled by weather.ts from seed + tick). */
  sprinklers?: Sprinkler[];
  districts?: District[];
}

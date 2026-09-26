// Builds static colliders for the world. OWNER: world lane (L2).
// Used by the authority AND by client-side prediction, so it depends only on (Rapier, World, WorldData).
//  - Terrain: the baked grid's exact triangles (every cell split on the b–c diagonal, the same
//    triangles gridHeight() interpolates and the client renders), as a Rapier TRIMESH by default.
//    tools/world-physics-bench.mjs measured on the West Yard (Rapier 0.21): a heightfield of the same
//    grid misses 24.5 % of straight-down rays on a 0.5 m lattice (edge-aligned rays slip through) and
//    costs ~3x more character-controller time (8 runners: 2.4 ms/tick vs 0.77 ms); the trimesh
//    misses 0 % on the lattice (0.005 % random) with identical geometry. Set TERRAIN_COLLIDER to
//    'heightfield' to compare.
//  - Props: oriented cuboids (yaw/pitch/roll, 'YXZ') and upright cylinders.
//  - Worlds without a baked grid (flat test worlds) get a flat ground slab.
//  - terrainFastMove(): the exact analytic twin of the terrain trimesh for character movement (perf lane P1,
//    see the section at the end of this file).
import type { Collider, ColliderDesc, World } from '@dimforge/rapier3d-compat';
import type { Sim } from '../sim';
import type { Rapier } from '../rapier';
import { WORLD_GROUPS } from '../rapier';
import type { WorldData, TerrainGrid } from '../../shared/world/world-data';
import { quatYXZ } from '../../shared/world/queries';

export const TERRAIN_COLLIDER: 'trimesh' | 'heightfield' = 'trimesh';

/** Column-major height matrix for a Rapier heightfield (rows along z, columns along x). */
export function heightfieldMatrix(g: TerrainGrid): Float32Array {
  const n = g.n, out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[i * n + j] = g.heights[j * n + i];
  return out;
}

const meshCache = new WeakMap<TerrainGrid, { vertices: Float32Array; indices: Uint32Array }>();
/** World-space vertices + indices of the grid triangles (a,c,b)(b,c,d) — identical to the render mesh. */
export function terrainTriangles(g: TerrainGrid): { vertices: Float32Array; indices: Uint32Array } {
  let m = meshCache.get(g);
  if (m) return m;
  const n = g.n, res = n - 1;
  const vertices = new Float32Array(n * n * 3), indices = new Uint32Array(res * res * 6);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    vertices[k * 3] = g.x0 + i * g.cell; vertices[k * 3 + 1] = g.heights[k]; vertices[k * 3 + 2] = g.z0 + j * g.cell;
  }
  let o = 0;
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    indices[o++] = a; indices[o++] = c; indices[o++] = b;
    indices[o++] = b; indices[o++] = c; indices[o++] = d;
  }
  m = { vertices, indices };
  meshCache.set(g, m);
  return m;
}

/** True for the terrain collider built by buildStaticWorld (trimesh or heightfield). Use this instead
 *  of testing the shape type (nav grids, projectile backstops). */
export function isTerrainCollider(c: Collider): boolean {
  return (c as unknown as { __terrain?: boolean }).__terrain === true;
}

/** True for the colliders buildStaticWorld made from WorldData (terrain or ground slab, props, cylinders): the static
 *  world every sim of that world shares. Entity colliders on the World layer (kiosks) and destructibles are not. Data
 *  shared between sims (the nav grid, D1) may only be built from these. */
export function isStaticWorldCollider(c: Collider): boolean {
  return (c as unknown as { __static?: boolean }).__static === true;
}

export function buildStaticWorld(R: Rapier, world: World, data: WorldData): void {
  const g = data.terrain;
  const add = (desc: ColliderDesc): Collider => {
    const c = world.createCollider(desc.setCollisionGroups(WORLD_GROUPS));
    (c as unknown as { __static: boolean }).__static = true;
    return c;
  };
  let terrain: Collider | null = null;
  if (g && TERRAIN_COLLIDER === 'trimesh') {
    const { vertices, indices } = terrainTriangles(g);
    const flags = (R as unknown as { TriMeshFlags?: { FIX_INTERNAL_EDGES: number } }).TriMeshFlags?.FIX_INTERNAL_EDGES;
    terrain = add(R.ColliderDesc.trimesh(vertices, indices, flags as never));
  } else if (g) {
    const res = g.n - 1, size = res * g.cell;
    terrain = add(R.ColliderDesc.heightfield(res, res, heightfieldMatrix(g), { x: size, y: 1, z: size })
      .setTranslation(g.x0 + size / 2, 0, g.z0 + size / 2));
  }
  if (terrain) (terrain as unknown as { __terrain: boolean }).__terrain = true;
  if (terrain && g && TERRAIN_COLLIDER === 'trimesh') terrainOf.set(world, g);
  if (!terrain) {
    const h = data.halfExtent;
    add(R.ColliderDesc.cuboid(h, 0.5, h).setTranslation(0, -0.5, 0));
  }
  for (const p of data.props) {
    const q = quatYXZ(p.pitch ?? 0, p.rotY, p.roll ?? 0);
    add(R.ColliderDesc.cuboid(p.hx, p.hy, p.hz).setTranslation(p.x, p.y, p.z).setRotation(q));
  }
  for (const c of data.cylinders ?? []) {
    add(R.ColliderDesc.cylinder(c.hh, c.r).setTranslation(c.x, c.y, c.z));
  }
}

export function buildSimWorld(sim: Sim): void {
  buildStaticWorld(sim.R, sim.world, sim.worldData);
}

// ------------------------------------------------------------------------------------- terrain fast path (perf P1)
// Rapier's KinematicCharacterController costs ~80-120 us per call on the undulating 1 m lawn trimesh: every call runs
// 3 contact-manifold queries and 2-3 shape casts (GJK per triangle) against the 8-18 triangles around the capsule, and
// neither chunking, decimation within 1 cm, trimesh flags, a heightfield nor Rapier's SIMD build makes that cheaper.
// In a full room ~90 % of calls are plain grounded moves over open terrain. For exactly those, terrainFastMove()
// returns the controller's result analytically from the grid triangles the collider is built from: the sphere-rest
// height is exact to float precision, and the move replays the controller's own rules (travel until the offset gap
// closes, handle_slopes() with the normal nudge, snap-to-ground). Everything else — any collider the controller would
// see within reach (props, kiosks, karts, barriers), slopes steeper than FAST_MAX_SLOPE_DEG, not resting on the
// terrain, off the grid, moving up — returns false and the caller runs the real controller. The authority and client
// prediction both build their worlds through buildStaticWorld(), so both take the same path (prediction stays exact).
// Measured against the controller on identical inputs in a 28-bot room: horizontal p50 0.001 mm / p99 0.4 mm;
// vertical p50 0.008 mm / p99 5 mm, where the difference is the controller's own 1-2 cm hops at triangle edges and
// rare one-tick dead stops on open lawn, which the fast path does not have.

/** A/B and bisecting switch (tools/perf-*.mjs, tests). */
export const terrainFastPath = { enabled: true };
/** Steepest support the fast path handles. Keep below ~33 deg: movement.ts treats contacts within 6 cm of the feet as
 *  floor, and a 0.36 m capsule touches a 33 deg slope 6 cm above its lowest point. */
export const FAST_MAX_SLOPE_DEG = 30;
const FAST_MIN_NY = Math.cos((FAST_MAX_SLOPE_DEG * Math.PI) / 180);
/** Reach around the swept capsule in which any collider the controller would see sends the move to the controller
 *  (covers its 0.05 m ground prediction, parry's <= 0.1 m query-AABB margin and float slack). */
const FAST_REACH = 0.25;

/** Terrain grid per Rapier world, registered by buildStaticWorld() (trimesh terrain only). */
const terrainOf = new WeakMap<World, TerrainGrid>();

export interface TerrainRest { y: number; nx: number; ny: number; nz: number }

/**
 * Highest center height of a sphere of radius R, lowered vertically at (x, z), that touches the grid triangles
 * (a,c,b)(b,d,c) — the exact trimesh buildStaticWorld() creates. Writes the contact normal (unit, contact -> center)
 * into `out`. Returns false when the sphere's footprint leaves the grid.
 */
export function sphereRestOnGrid(g: TerrainGrid, x: number, z: number, R: number, out: TerrainRest): boolean {
  const n = g.n, cell = g.cell, H = g.heights, x0 = g.x0, z0 = g.z0;
  const i0 = Math.floor((x - R - x0) / cell), i1 = Math.floor((x + R - x0) / cell);
  const j0 = Math.floor((z - R - z0) / cell), j1 = Math.floor((z + R - z0) / cell);
  if (i0 < 0 || j0 < 0 || i1 > n - 2 || j1 > n - 2) return false;
  const R2 = R * R;
  let best = -Infinity, bx = 0, by = 1, bz = 0;
  // vertices
  for (let j = j0; j <= j1 + 1; j++) for (let i = i0; i <= i1 + 1; i++) {
    const dx = x - (x0 + i * cell), dz = z - (z0 + j * cell), h2 = dx * dx + dz * dz;
    if (h2 > R2) continue;
    const s = Math.sqrt(R2 - h2), y = H[j * n + i] + s;
    if (y > best) { best = y; bx = dx / R; by = s / R; bz = dz / R; }
  }
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const ax = x0 + i * cell, az = z0 + j * cell, ex = ax + cell, ez = az + cell;
    const ha = H[j * n + i], hb = H[j * n + i + 1], hc = H[(j + 1) * n + i], hd = H[(j + 1) * n + i + 1];
    // faces: (p, q, r) = (a, b, c) and (b, d, c); the sphere touches the plane at C - R*n, which must be inside
    for (let f = 0; f < 2; f++) {
      const px = f === 0 ? ax : ex, pz = az, py = f === 0 ? ha : hb;
      const qx = ex, qz = f === 0 ? az : ez, qy = f === 0 ? hb : hd;
      const rx = ax, rz = ez, ry = hc;
      const ux = rx - px, uy = ry - py, uz = rz - pz, vx = qx - px, vy = qy - py, vz = qz - pz;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= l; ny /= l; nz /= l;
      const y = py + (R - (x - px) * nx - (z - pz) * nz) / ny;
      if (y <= best) continue;
      const cx = x - R * nx, cz = z - R * nz;
      const d = (qz - rz) * (px - rx) + (rx - qx) * (pz - rz);
      const l0 = ((qz - rz) * (cx - rx) + (rx - qx) * (cz - rz)) / d;
      const l1 = ((rz - pz) * (cx - rx) + (px - rx) * (cz - rz)) / d;
      if (l0 < 0 || l1 < 0 || l0 + l1 > 1) continue;
      best = y; bx = nx; by = ny; bz = nz;
    }
    // edges a-b, a-c, b-c, plus b-d / c-d on the patch's far borders (endpoints are the vertex pass)
    for (let k = 0; k < 5; k++) {
      if ((k === 3 && i !== i1) || (k === 4 && j !== j1)) continue;
      const Ax = k === 2 || k === 3 ? ex : ax, Az = k === 4 ? ez : az, Ay = k === 2 || k === 3 ? hb : k === 4 ? hc : ha;
      const Qx = k === 0 || k === 3 || k === 4 ? ex : ax, Qz = k === 0 ? az : ez, Qy = k === 0 ? hb : k === 1 || k === 2 ? hc : hd;
      const Dx = Qx - Ax, Dy = Qy - Ay, Dz = Qz - Az;
      const px = x - Ax, pz = z - Az;
      // |C - A|^2 - ((C - A).D)^2 / |D|^2 = R^2, quadratic in t = C.y - A.y; take the upper root
      const L2 = Dx * Dx + Dy * Dy + Dz * Dz, k0 = px * Dx + pz * Dz;
      const qa = 1 - (Dy * Dy) / L2, qb = (-2 * k0 * Dy) / L2, qc = px * px + pz * pz - (k0 * k0) / L2 - R2;
      if (qa <= 1e-12) continue;
      const disc = qb * qb - 4 * qa * qc;
      if (disc < 0) continue;
      const t = (-qb + Math.sqrt(disc)) / (2 * qa);
      const u = (k0 + t * Dy) / L2;
      if (u <= 0 || u >= 1) continue;
      const y = Ay + t;
      if (y <= best) continue;
      best = y; bx = (x - (Ax + u * Dx)) / R; by = (y - (Ay + u * Dy)) / R; bz = (z - (Az + u * Dz)) / R;
    }
  }
  if (best === -Infinity) return false;
  out.y = best; out.nx = bx; out.ny = by; out.nz = bz;
  return true;
}

/** The controller API the fast path reads its settings from (fixed after Sim creation, cached per controller). */
export interface FastMoveController {
  offset(): number; normalNudgeFactor(): number; snapToGroundDistance(): number | null;
  maxSlopeClimbAngle(): number; minSlopeSlideAngle(): number;
}
interface KccParams { offset: number; nudge: number; snap: number; wallNy: number; nonslipNy: number }
const kccParams = new WeakMap<object, KccParams>();
function paramsOf(kcc: FastMoveController): KccParams {
  let p = kccParams.get(kcc);
  if (!p) {
    p = {
      offset: kcc.offset(), nudge: kcc.normalNudgeFactor(), snap: kcc.snapToGroundDistance() ?? 0,
      wallNy: Math.cos(kcc.maxSlopeClimbAngle()), nonslipNy: Math.cos(kcc.minSlopeSlideAngle()),
    };
    kccParams.set(kcc, p);
  }
  return p;
}
/** Capsule dimensions per collider; null = not a capsule (the boss is a ball): always the real controller. */
const capsuleOf = new WeakMap<Collider, { r: number; hh: number } | null>();
/** Rapier ShapeType.Capsule (a numeric enum; this file only imports Rapier types). */
const SHAPE_CAPSULE = 2;

const restA: TerrainRest = { y: 0, nx: 0, ny: 1, nz: 0 }, restB: TerrainRest = { y: 0, nx: 0, ny: 1, nz: 0 };
const slide = { x: 0, y: 0, z: 0 };
const aabbCenter = { x: 0, y: 0, z: 0 }, aabbHalf = { x: 0, y: 0, z: 0 };
let scanBlocked = false, scanSelf: Collider | null = null, scanFilter = 0;
const scan = (c: Collider): boolean => {
  if (c === scanSelf || isTerrainCollider(c)) return true;
  // Rapier InteractionGroups test between the controller's query groups and the collider's groups
  const g = c.collisionGroups();
  if (((g >>> 16) & scanFilter & 0xffff) !== 0 && ((scanFilter >>> 16) & g & 0xffff) !== 0) { scanBlocked = true; return false; }
  return true;
};

/** Rapier's KinematicCharacterController::handle_slopes() for a hit with unit normal n, input d, remaining r
 *  (up = +Y), including the normal nudge. Result in `slide`. */
function handleSlopes(p: KccParams, nx: number, ny: number, nz: number, dy: number, hdist: number, rx: number, ry: number, rz: number): void {
  const hl = Math.sqrt(nx * nx + nz * nz);                    // horizontal tangent dir = normalize(n x up)
  const tx = hl > 0 ? -nz / hl : 0, tz = hl > 0 ? nx / hl : 0;
  const slippingIntent = -hdist * ny < 0;                     // vertical tangent of the horizontal input points down
  const rdist = rx * nx + ry * ny + rz * nz;
  const tanX = rx - rdist * nx, tanY = ry - rdist * ny, tanZ = rz - rdist * nz;
  const np = rdist >= 0 ? rdist : 0;                          // normal part (moving away); penetration is dropped
  const ht = tanX * tx + tanZ * tz, htx = ht * tx, htz = ht * tz;
  const vtx = tanX - htx, vty = tanY, vtz = tanZ - htz;
  const isWall = ny <= p.wallNy && ny >= 0, nonslip = ny >= p.nonslipNy;
  if ((isWall && vty > 0 && !(dy > 0)) || (nonslip && vty < 0 && !slippingIntent)) {
    slide.x = htx + np * nx; slide.y = np * ny; slide.z = htz + np * nz;
  } else {
    slide.x = np * nx + htx + vtx; slide.y = np * ny + vty; slide.z = np * nz + htz + vtz;
  }
  slide.x += nx * p.nudge; slide.y += ny * p.nudge; slide.z += nz * p.nudge;
}

/**
 * Analytic twin of `kcc.computeColliderMovement(collider, d, undefined, filter)` for a character resting on open
 * terrain (see the section comment). On success writes the movement into `out` — the character is grounded and
 * reports no collisions — and returns true. Returns false whenever the real controller must run. Call it only for a
 * character that was grounded last tick and is not ground-pounding.
 */
export function terrainFastMove(world: World, kcc: FastMoveController, collider: Collider, filter: number,
  d: { x: number; y: number; z: number }, out: { x: number; y: number; z: number }): boolean {
  if (!terrainFastPath.enabled || d.y > 0) return false;
  const g = terrainOf.get(world);
  if (!g) return false;
  let cap = capsuleOf.get(collider);
  if (cap === undefined) {
    cap = collider.shapeType() === SHAPE_CAPSULE ? { r: collider.radius(), hh: collider.halfHeight() } : null;
    capsuleOf.set(collider, cap);
  }
  if (!cap) return false; // the analytic rest height is capsule-only (QA: a ball-shaped boss sank and was unhittable)
  const p = paramsOf(kcc), R = cap.r + p.offset;
  const c = collider.translation();
  const cx = c.x, cy = c.y, cz = c.z, by = cy - cap.hh;      // center of the capsule's bottom sphere
  if (!sphereRestOnGrid(g, cx, cz, R, restA) || restA.ny < FAST_MIN_NY) return false;
  const gap = by - restA.y;
  if (gap < -0.002 || gap > 0.05) return false;               // not resting on the terrain (controller prediction 0.05)
  // Anything else the controller could touch during this move (same broad phase, same group filter) -> controller.
  const top = cy + cap.hh + cap.r + FAST_REACH, bottom = by - cap.r - p.snap - FAST_REACH + Math.min(0, d.y);
  aabbCenter.x = cx + d.x / 2; aabbCenter.y = (top + bottom) / 2; aabbCenter.z = cz + d.z / 2;
  aabbHalf.x = Math.abs(d.x) / 2 + cap.r + FAST_REACH; aabbHalf.y = (top - bottom) / 2; aabbHalf.z = Math.abs(d.z) / 2 + cap.r + FAST_REACH;
  scanBlocked = false; scanSelf = collider; scanFilter = filter;
  world.collidersWithAabbIntersectingAabb(aabbCenter, aabbHalf, scan);
  scanSelf = null;
  if (scanBlocked) return false;
  // 1. The controller's first cast: travel along d until the offset gap closes, then slide along the support.
  const nx = restA.nx, ny = restA.ny, nz = restA.nz;
  const dl = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z), dn = d.x * nx + d.y * ny + d.z * nz;
  let mx = d.x, my = d.y, mz = d.z, hit = false;
  if (dn < 0 && dl > 1e-5) {
    const t = (Math.max(0, gap) * ny * dl) / -dn;
    if (t < dl) {
      hit = true;
      const ax = (d.x * t) / dl, ay = (d.y * t) / dl, az = (d.z * t) / dl;
      handleSlopes(p, nx, ny, nz, d.y, d.x * nx + d.z * nz, d.x - ax, d.y - ay, d.z - az);
      mx = ax + slide.x; my = ay + slide.y; mz = az + slide.z;
    }
  }
  // 2. Ground at the destination: snap down onto it (grounded at start and not moving up), otherwise stay on the
  //    slid plane but never below the surface.
  if (!sphereRestOnGrid(g, cx + mx, cz + mz, R, restB) || restB.ny < FAST_MIN_NY) return false;
  let yb = by + my;
  if (!hit || my <= 0) {
    if (yb - restB.y > p.snap) return false;                  // leaving the ground: the controller decides
    yb = restB.y;
  } else if (yb < restB.y) yb = restB.y;
  out.x = mx; out.y = yb - by; out.z = mz;
  return true;
}

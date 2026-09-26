// Hit-test geometry. Character hit tests are analytic (ray/sphere vs vertical capsule) because
// Rapier's query BVH is only refreshed by world.step(): rewound (lag-compensated) capsules would be
// invisible to Rapier queries until the next step. Static world geometry uses Rapier raycasts.
import type { Ray } from '@dimforge/rapier3d-compat';
import type { Sim } from '../sim';
import { groups, Layer } from '../rapier';

/** Rays that only see static world geometry (terrain, props, vehicles) — never characters. */
export const WORLD_RAY_FILTER = groups(Layer.Projectile, Layer.World | Layer.Vehicle);

/**
 * Ray (unit direction) vs a vertical capsule whose bottom sphere center is (cx, yb, cz) and whose
 * cylinder spans `len` meters upward, radius r. Returns the entry distance in [0, maxT] or -1.
 * A ray starting inside the capsule returns 0.
 */
export function rayCapsule(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  cx: number, yb: number, cz: number, len: number, r: number, maxT: number,
): number {
  const ax = ox - cx, ay = oy - yb, az = oz - cz;
  const cy = ay < 0 ? 0 : ay > len ? len : ay;
  const iy = ay - cy;
  const r2 = r * r;
  if (ax * ax + iy * iy + az * az <= r2) return 0;
  const a = 1 - dy * dy;
  if (a > 1e-9) {
    const b = dx * ax + dz * az;
    const c = ax * ax + az * az - r2;
    const h = b * b - a * c;
    if (h < 0) return -1; // missed the infinite cylinder -> missed the capsule
    const t = (-b - Math.sqrt(h)) / a;
    const y = ay + t * dy;
    if (t >= 0 && y >= 0 && y <= len) return t <= maxT ? t : -1;
  }
  let best = -1;
  const t0 = raySphere(ax, ay, az, dx, dy, dz, r2);
  if (t0 >= 0) best = t0;
  const t1 = raySphere(ax, ay - len, az, dx, dy, dz, r2);
  if (t1 >= 0 && (best < 0 || t1 < best)) best = t1;
  return best >= 0 && best <= maxT ? best : -1;
}

/** Ray from (relative) origin o vs a sphere at the origin with squared radius r2; -1 on miss. */
function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, r2: number): number {
  const b = dx * ox + dy * oy + dz * oz;
  const c = ox * ox + oy * oy + oz * oz - r2;
  const h = b * b - c;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : -1;
}

/** Distance from a point to the surface of a vertical capsule (0 when inside). */
export function pointCapsuleDistance(px: number, py: number, pz: number, cx: number, yb: number, cz: number, len: number, r: number): number {
  const ay = py - yb;
  const cy = ay < 0 ? 0 : ay > len ? len : ay;
  const dx = px - cx, dy = ay - cy, dz = pz - cz;
  return Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - r);
}

interface RayCache { ray: Ray }
const rayCache = new WeakMap<Sim, RayCache>();

function cachedRay(sim: Sim): Ray {
  let c = rayCache.get(sim);
  if (!c) { c = { ray: new sim.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }) }; rayCache.set(sim, c); }
  return c.ray;
}

/** Distance along a unit ray to static world geometry, or maxT when nothing is hit. */
export function worldRay(sim: Sim, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  const ray = cachedRay(sim);
  ray.origin.x = ox; ray.origin.y = oy; ray.origin.z = oz;
  ray.dir.x = dx; ray.dir.y = dy; ray.dir.z = dz;
  const hit = sim.world.castRay(ray, maxT, true, undefined, WORLD_RAY_FILTER);
  return hit ? hit.timeOfImpact : maxT;
}

export interface WorldHit { t: number; nx: number; ny: number; nz: number }

/** Like worldRay but also returns the surface normal; null when nothing is hit within maxT. */
export function worldRayNormal(sim: Sim, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, out: WorldHit): WorldHit | null {
  const ray = cachedRay(sim);
  ray.origin.x = ox; ray.origin.y = oy; ray.origin.z = oz;
  ray.dir.x = dx; ray.dir.y = dy; ray.dir.z = dz;
  const hit = sim.world.castRayAndGetNormal(ray, maxT, true, undefined, WORLD_RAY_FILTER);
  if (!hit) return null;
  out.t = hit.timeOfImpact; out.nx = hit.normal.x; out.ny = hit.normal.y; out.nz = hit.normal.z;
  return out;
}

/** True when the straight segment between two points is not blocked by static world geometry. */
export function worldLineClear(sim: Sim, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-4) return true;
  return worldRay(sim, ax, ay, az, dx / d, dy / d, dz / d, d) >= d - 1e-3;
}

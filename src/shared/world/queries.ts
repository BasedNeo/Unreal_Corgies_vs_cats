// Pure spatial queries over WorldData (no physics engine needed): walkable surface height, prop
// footprints, water and jump-pad lookups. Used by world systems, spawn validation, tests and (later)
// AI navigation grids. Deterministic, allocation-light.
import type { ConcealZone, District, JumpPad, PropBox, PropCylinder, WaterZone, WorldData } from './world-types';

export interface Quat { x: number; y: number; z: number; w: number }

/** Quaternion for Euler order 'YXZ' (yaw about Y, then pitch about local X, then roll about local Z). */
export function quatYXZ(pitch: number, yaw: number, roll: number): Quat {
  const c1 = Math.cos(pitch / 2), c2 = Math.cos(yaw / 2), c3 = Math.cos(roll / 2);
  const s1 = Math.sin(pitch / 2), s2 = Math.sin(yaw / 2), s3 = Math.sin(roll / 2);
  // Same formula as THREE.Quaternion.setFromEuler(order 'YXZ')
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 - s1 * s2 * c3,
    w: c1 * c2 * c3 + s1 * s2 * s3,
  };
}

/** Rotate v by the inverse of q. */
function invRotate(q: Quat, vx: number, vy: number, vz: number): [number, number, number] {
  const x = -q.x, y = -q.y, z = -q.z, w = q.w;
  // t = 2 * cross(q.xyz, v); v' = v + w*t + cross(q.xyz, t)
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

const boxQuat = new WeakMap<PropBox, Quat>();
function qOf(b: PropBox): Quat {
  let q = boxQuat.get(b);
  if (!q) { q = quatYXZ(b.pitch ?? 0, b.rotY, b.roll ?? 0); boxQuat.set(b, q); }
  return q;
}

/**
 * Top of an oriented box along the vertical line through (x, z): the highest y where the line is
 * inside the box, or -Infinity if the line misses it. Exact slab test in the box frame.
 */
export function boxTopAt(b: PropBox, x: number, z: number): number {
  const q = qOf(b);
  // Line p(t) = (x, t, z); local origin/direction.
  const [ox, oy, oz] = invRotate(q, x - b.x, -b.y, z - b.z);
  const [dx, dy, dz] = invRotate(q, 0, 1, 0);
  let tMin = -Infinity, tMax = Infinity;
  const slab = (o: number, d: number, h: number): boolean => {
    if (Math.abs(d) < 1e-12) return Math.abs(o) <= h;
    let t0 = (-h - o) / d, t1 = (h - o) / d;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    if (t0 > tMin) tMin = t0;
    if (t1 < tMax) tMax = t1;
    return tMin <= tMax;
  };
  if (!slab(ox, dx, b.hx) || !slab(oy, dy, b.hy) || !slab(oz, dz, b.hz)) return -Infinity;
  return tMax;
}

/** Horizontal distance from (x, z) to a box's footprint (0 when the vertical line hits it). */
export function boxFootprintDist(b: PropBox, x: number, z: number): number {
  if (!b.pitch && !b.roll) {
    const c = Math.cos(b.rotY), s = Math.sin(b.rotY);
    const dx = x - b.x, dz = z - b.z;
    // inverse yaw: local = Ry(-yaw) * d
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const ex = Math.max(Math.abs(lx) - b.hx, 0), ez = Math.max(Math.abs(lz) - b.hz, 0);
    return Math.hypot(ex, ez);
  }
  // Pitched/rolled: exact distance to the convex hull of the 8 projected corners.
  if (boxTopAt(b, x, z) > -Infinity) return 0;
  const hull = footprintHull(b);
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i], [bx, bz] = hull[(i + 1) % hull.length];
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
  }
  return best;
}

const hulls = new WeakMap<PropBox, [number, number][]>();
/** XZ convex hull (CCW) of an oriented box's corners. */
export function footprintHull(b: PropBox): [number, number][] {
  let h = hulls.get(b);
  if (h) return h;
  const q = quatYXZ(b.pitch ?? 0, b.rotY, b.roll ?? 0);
  const pts: [number, number][] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    // rotate by q (forward): conjugate of invRotate
    const [rx, , rz] = rotate(q, sx * b.hx, sy * b.hy, sz * b.hz);
    pts.push([b.x + rx, b.z + rz]);
  }
  pts.sort((p, r) => p[0] - r[0] || p[1] - r[1]);
  const cross = (o: [number, number], a: [number, number], c: [number, number]) => (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  h = lower.slice(0, -1).concat(upper.slice(0, -1));
  hulls.set(b, h);
  return h;
}

function rotate(q: Quat, vx: number, vy: number, vz: number): [number, number, number] {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

export function cylFootprintDist(c: PropCylinder, x: number, z: number): number {
  return Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r);
}

/** Spatial hash over props/cylinders for fast point queries. Built lazily per WorldData. */
interface Index { cell: number; boxes: Map<string, PropBox[]>; cyls: Map<string, PropCylinder[]> }
const indexes = new WeakMap<WorldData, Index>();
function indexOf(data: WorldData): Index {
  let ix = indexes.get(data);
  if (ix) return ix;
  const cell = 8;
  ix = { cell, boxes: new Map(), cyls: new Map() };
  const put = <T>(m: Map<string, T[]>, x0: number, z0: number, x1: number, z1: number, v: T) => {
    for (let gz = Math.floor(z0 / cell); gz <= Math.floor(z1 / cell); gz++)
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) {
        const k = `${gx},${gz}`;
        const l = m.get(k);
        if (l) l.push(v); else m.set(k, [v]);
      }
  };
  for (const b of data.props) {
    const r = Math.hypot(b.hx, b.hy, b.hz);
    put(ix.boxes, b.x - r, b.z - r, b.x + r, b.z + r, b);
  }
  for (const c of data.cylinders ?? []) put(ix.cyls, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r, c);
  indexes.set(data, ix);
  return ix;
}

export interface SurfaceHit { y: number; kind: 'terrain' | 'box' | 'cyl'; prop: PropBox | PropCylinder | null }

/**
 * Highest solid surface at (x, z) at or below `maxY` (default: anything). Includes terrain, boxes and
 * cylinders; ignores invisible 'boundary' blockers.
 */
export function surfaceAt(data: WorldData, x: number, z: number, maxY = Infinity): SurfaceHit {
  const ix = indexOf(data);
  const k = `${Math.floor(x / ix.cell)},${Math.floor(z / ix.cell)}`;
  let best: SurfaceHit = { y: data.height(x, z), kind: 'terrain', prop: null };
  for (const b of ix.boxes.get(k) ?? []) {
    if (b.type === 'boundary') continue;
    const t = boxTopAt(b, x, z);
    if (t > best.y && t <= maxY) best = { y: t, kind: 'box', prop: b };
  }
  for (const c of ix.cyls.get(k) ?? []) {
    if (Math.hypot(x - c.x, z - c.z) > c.r) continue;
    const t = c.y + c.hh;
    if (t > best.y && t <= maxY) best = { y: t, kind: 'cyl', prop: c };
  }
  return best;
}

/** Nearest horizontal distance from (x, z) to any prop footprint (boxes + cylinders), with the
 *  prop's vertical extent overlapping [y0, y1]. */
export function nearestPropDist(data: WorldData, x: number, z: number, y0 = -Infinity, y1 = Infinity): number {
  let best = Infinity;
  for (const b of data.props) {
    const r = Math.hypot(b.hx, b.hy, b.hz);
    if (b.y + r < y0 || b.y - r > y1) continue;
    best = Math.min(best, boxFootprintDist(b, x, z));
  }
  for (const c of data.cylinders ?? []) {
    if (c.y + c.hh < y0 || c.y - c.hh > y1) continue;
    best = Math.min(best, cylFootprintDist(c, x, z));
  }
  return best;
}

export function waterAt(data: WorldData, x: number, z: number): WaterZone | null {
  for (const w of data.water ?? []) {
    if (w.shape === 'circle') { if (Math.hypot(x - w.x, z - w.z) <= (w.r ?? 0)) return w; }
    else if (Math.abs(x - w.x) <= (w.hx ?? 0) && Math.abs(z - w.z) <= (w.hz ?? 0)) return w;
  }
  return null;
}

export function jumpPadAt(data: WorldData, x: number, y: number, z: number, tolY = 0.35): JumpPad | null {
  for (const p of data.jumpPads ?? []) {
    if (Math.abs(y - p.y) <= tolY && Math.hypot(x - p.x, z - p.z) <= p.r) return p;
  }
  return null;
}

/** Yaw (0 = facing -Z) that looks from (x, z) toward (tx, tz). */
export function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

/** True if the point is inside any solid collider (boxes + cylinders, 'boundary' blockers ignored). */
export function occupiedAt(data: WorldData, x: number, y: number, z: number, pad = 0): boolean {
  const ix = indexOf(data);
  const k = `${Math.floor(x / ix.cell)},${Math.floor(z / ix.cell)}`;
  for (const b of ix.boxes.get(k) ?? []) {
    if (b.type === 'boundary') continue;
    const [lx, ly, lz] = invRotate(qOf(b), x - b.x, y - b.y, z - b.z);
    if (Math.abs(lx) <= b.hx + pad && Math.abs(ly) <= b.hy + pad && Math.abs(lz) <= b.hz + pad) return true;
  }
  for (const c of ix.cyls.get(k) ?? []) {
    if (Math.hypot(x - c.x, z - c.z) <= c.r + pad && Math.abs(y - c.y) <= c.hh + pad) return true;
  }
  return false;
}

/**
 * How hidden a character standing at (x, y, z) (feet) is by tall-grass concealment zones: 0 = in the
 * open, 1 = deep inside tall grass with the feet on the ground. The ellipse edge fades over its outer
 * ~28 % and the value drops to 0 as the feet rise to (grass height - 1 m), so standing on a raised-bed
 * wall, a pumpkin or jumping reveals you. Stance, movement and firing are applied by the sim's conceal
 * system on top of this (src/sim/world/env.ts). Pure; + - * / sqrt only.
 */
export function concealmentAt(data: WorldData, x: number, y: number, z: number): number {
  const zones = data.concealZones;
  if (!zones || zones.length === 0) return 0;
  let best = 0;
  for (const zn of zones) {
    const dx = x - zn.x, dz = z - zn.z;
    const r = zn.rx > zn.rz ? zn.rx : zn.rz;
    if (dx * dx + dz * dz > r * r) continue;
    let lx = dx, lz = dz;
    if (zn.yaw) {
      const c = Math.cos(zn.yaw), s = Math.sin(zn.yaw);
      lx = dx * c - dz * s; lz = dx * s + dz * c;
    }
    const ex = lx / zn.rx, ez = lz / zn.rz;
    const e2 = ex * ex + ez * ez;
    if (e2 >= 1) continue;
    const inside = 1 - smooth01(0.72, 1, Math.sqrt(e2));
    if (inside <= best) continue;
    const above = y - data.height(x, z);
    const hf = 1 - smooth01(0.3, Math.max(0.35, zn.h - 1), above);
    const v = inside * hf;
    if (v > best) best = v;
  }
  return best;
}

/** The concealment zone containing (x, z) with the strongest edge factor, or null. */
export function concealZoneAt(data: WorldData, x: number, z: number): ConcealZone | null {
  let best: ConcealZone | null = null, bestE = 1;
  for (const zn of data.concealZones ?? []) {
    let lx = x - zn.x, lz = z - zn.z;
    if (zn.yaw) { const c = Math.cos(zn.yaw), s = Math.sin(zn.yaw); const t = lx * c - lz * s; lz = lx * s + lz * c; lx = t; }
    const e2 = (lx / zn.rx) ** 2 + (lz / zn.rz) ** 2;
    if (e2 < bestE) { bestE = e2; best = zn; }
  }
  return best;
}

/** The district rectangle containing (x, z), or null. */
export function districtAt(data: WorldData, x: number, z: number): District | null {
  for (const d of data.districts ?? []) if (x >= d.minX && x <= d.maxX && z >= d.minZ && z <= d.maxZ) return d;
  return null;
}

function smooth01(a: number, b: number, x: number): number {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

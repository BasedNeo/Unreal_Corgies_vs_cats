// Runtime placement of Ordnance Terminals. Like the vehicle lane's terminal sites (src/sim/vehicles/sites.ts),
// spots are never hard-coded: for each team we search rings around the team's spawn centroid for a flat,
// clear patch of lawn with room for the kiosk and a walkway, away from props, water, jump pads, spawn points,
// the team's Kart-O-Matic (+ its kart pad) and pickup/objective spots. Pure function of WorldData.
import type { WorldData } from '../../shared/world/world-data';
import { jumpPadAt, nearestPropDist, surfaceAt, waterAt, yawToward } from '../../shared/world/queries';
import type { TeamId } from '../../shared/types';
import { TERMINALS } from '../../shared/content/terminals';
import { VEHICLES } from '../../shared/content/vehicles';
import { findTerminalSite } from '../vehicles/sites';

export interface OrdnanceSite {
  team: TeamId;
  /** Kiosk ground point; the screen faces `yaw` (toward the team's spawns). */
  x: number; y: number; z: number; yaw: number;
}

/** A circle (x, z, r) the kiosk center must stay out of. */
export interface KeepOut { x: number; z: number; r: number }

const RADII = [5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 21, 25];
const ANGLES = 48;

/** Flat, clear terrain disc of radius r at (x, z)? Returns the center height when it is. */
function clearDisc(data: WorldData, x: number, z: number, r: number, maxStep: number): number | null {
  const margin = r + 4;
  const b = data.bounds;
  if (b && (x < b.minX + margin || x > b.maxX - margin || z < b.minZ + margin || z > b.maxZ - margin)) return null;
  if (Math.abs(x) > data.halfExtent - margin || Math.abs(z) > data.halfExtent - margin) return null;
  const s0 = surfaceAt(data, x, z);
  if (s0.kind !== 'terrain') return null;
  const y = s0.y;
  let lo = y, hi = y;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    for (const f of [0.5, 1]) {
      const px = x + Math.cos(a) * r * f, pz = z + Math.sin(a) * r * f;
      const s = surfaceAt(data, px, pz, y + 3);
      if (s.kind !== 'terrain') return null;
      if (waterAt(data, px, pz) || jumpPadAt(data, px, s.y, pz, 5)) return null;
      lo = Math.min(lo, s.y); hi = Math.max(hi, s.y);
    }
  }
  if (hi - lo > maxStep) return null;
  if (nearestPropDist(data, x, z, y - 0.5, y + 4) < r + 0.8) return null;
  for (const p of data.jumpPads ?? []) if (Math.hypot(p.x - x, p.z - z) < p.r + r + 2.5) return null;
  for (const s of data.spawns) if (Math.hypot(s.x - x, s.z - z) < r + 1.8) return null;
  return y;
}

/** Site searches are pure functions of (immutable, per-seed cached) WorldData: remember them per world. */
const siteCache = new WeakMap<WorldData, Map<string, unknown>>();
function cached<T>(data: WorldData, key: string, f: () => T): T {
  let m = siteCache.get(data);
  if (!m) { m = new Map(); siteCache.set(data, m); }
  if (!m.has(key)) m.set(key, f());
  return m.get(key) as T;
}

/** Keep-out circles around the team's vehicle terminal and its kart pad (so Interact never hits both). */
export function kartKeepOut(data: WorldData, team: TeamId): KeepOut[] {
  const kart = cached(data, `kart:${team}`, () => findTerminalSite(data, team));
  if (!kart) return [];
  const od = TERMINALS.ordnance_terminal, kd = TERMINALS.kart_terminal;
  const vd = VEHICLES[kd.vehicle];
  const kioskR = kd.useRange + od.useRange + od.keepOut;
  const padR = vd.radius + vd.mountRange + od.keepOut;
  return [
    { x: kart.x, z: kart.z, r: kioskR },
    { x: kart.padX, z: kart.padZ, r: padR },
    { x: (kart.x + kart.padX) / 2, z: (kart.z + kart.padZ) / 2, r: padR },
  ];
}

/**
 * Best Ordnance Terminal site for a team, or null when the map has no spawns for it / no clear spot.
 * Preference: about `siteRadius` m from the spawn centroid, toward the middle of the map, clear of `avoid`.
 */
export function findOrdnanceSite(data: WorldData, team: TeamId, avoid: readonly KeepOut[] = []): OrdnanceSite | null {
  const key = `ord:${team}:${avoid.map((k) => `${k.x},${k.z},${k.r}`).join(';')}`;
  return cached(data, key, () => searchOrdnanceSite(data, team, avoid));
}

/** The uncached search behind findOrdnanceSite (tests). */
export function searchOrdnanceSite(data: WorldData, team: TeamId, avoid: readonly KeepOut[] = []): OrdnanceSite | null {
  const spawns = data.spawns.filter((s) => s.team === team);
  if (!spawns.length) return null;
  const td = TERMINALS.ordnance_terminal;
  let cx = 0, cz = 0;
  for (const s of spawns) { cx += s.x; cz += s.z; }
  cx /= spawns.length; cz /= spawns.length;
  let ox = -cx, oz = -cz;
  const ol = Math.hypot(ox, oz);
  if (ol > 1e-3) { ox /= ol; oz /= ol; } else { ox = 0; oz = -1; }
  const kioskR = Math.hypot(td.hx, td.hz) + 1.0;
  let best: OrdnanceSite | null = null, bestScore = Infinity;
  for (const r of RADII) {
    for (let i = 0; i < ANGLES; i++) {
      const a = (i / ANGLES) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      let blocked = false;
      for (const k of avoid) if (Math.hypot(k.x - x, k.z - z) < k.r) { blocked = true; break; }
      if (blocked) continue;
      const y = clearDisc(data, x, z, kioskR, 0.45);
      if (y === null) continue;
      const out = (x - cx) * ox + (z - cz) * oz; // + = toward the middle of the map
      const score = Math.abs(r - td.siteRadius) - out * 0.3;
      if (score < bestScore) { bestScore = score; best = { team, x, y, z, yaw: yawToward(x, z, cx, cz) }; }
    }
    if (best && r >= td.siteRadius + 4) break; // good enough: stay near the base
  }
  return best;
}

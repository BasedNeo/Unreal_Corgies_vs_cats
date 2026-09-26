// Runtime placement of vehicle terminals. The world is data (and still changing), so terminal spots
// are never hard-coded: for each team we search rings around the team's spawn centroid for a flat,
// clear patch of lawn with room for the kiosk AND a kart pad beside it, away from props, water,
// jump pads and spawn points. Pure function of WorldData (deterministic; no physics needed).
import type { WorldData } from '../../shared/world/world-data';
import { jumpPadAt, nearestPropDist, surfaceAt, waterAt, yawToward } from '../../shared/world/queries';
import { Team, type TeamId } from '../../shared/types';
import { TERMINALS, VEHICLES, type TerminalId } from '../../shared/content/vehicles';

export interface TerminalSite {
  team: TeamId;
  /** Kiosk ground point and facing (screen side faces `yaw`, toward the team's spawns). */
  x: number; y: number; z: number; yaw: number;
  /** Kart spawn pad (ground point) and the heading a fresh kart gets (out toward the yard). */
  padX: number; padY: number; padZ: number; padYaw: number;
}

const RADII = [7, 9, 11, 13, 15, 18, 21, 25, 30];
const ANGLES = 36;

interface Clearance { ok: boolean; y: number }

/** Flat, clear terrain disc of radius r at (x, z)? Returns the center height when it is. */
function clearDisc(data: WorldData, x: number, z: number, r: number, maxStep: number): Clearance {
  const bad: Clearance = { ok: false, y: 0 };
  const b = data.bounds;
  const margin = r + 4;
  if (b && (x < b.minX + margin || x > b.maxX - margin || z < b.minZ + margin || z > b.maxZ - margin)) return bad;
  if (Math.abs(x) > data.halfExtent - margin || Math.abs(z) > data.halfExtent - margin) return bad;
  const s0 = surfaceAt(data, x, z);
  if (s0.kind !== 'terrain') return bad;
  const y = s0.y;
  let lo = y, hi = y;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    for (const f of [0.5, 1]) {
      const px = x + Math.cos(a) * r * f, pz = z + Math.sin(a) * r * f;
      const s = surfaceAt(data, px, pz, y + 3);
      if (s.kind !== 'terrain') return bad;
      lo = Math.min(lo, s.y); hi = Math.max(hi, s.y);
      if (waterAt(data, px, pz)) return bad;
      if (jumpPadAt(data, px, s.y, pz, 5)) return bad;
    }
  }
  if (hi - lo > maxStep) return bad;
  if (nearestPropDist(data, x, z, y - 0.5, y + 4) < r + 0.8) return bad;
  for (const p of data.jumpPads ?? []) if (Math.hypot(p.x - x, p.z - z) < p.r + r + 2.5) return bad;
  for (const s of data.spawns) if (Math.hypot(s.x - x, s.z - z) < r + 1.6) return bad;
  return { ok: true, y };
}

/**
 * Best terminal site for a team, or null when the map has no spawns for it / no clear spot.
 * Preference: about 9 m from the spawn centroid, on the side facing the middle of the map.
 */
export function findTerminalSite(data: WorldData, team: TeamId, terminal: TerminalId = 'kart_terminal'): TerminalSite | null {
  const spawns = data.spawns.filter((s) => s.team === team);
  if (!spawns.length) return null;
  const td = TERMINALS[terminal];
  const vd = VEHICLES[td.vehicle];
  let cx = 0, cz = 0;
  for (const s of spawns) { cx += s.x; cz += s.z; }
  cx /= spawns.length; cz /= spawns.length;
  // Direction from the spawn centroid toward the map center (the way karts should head out).
  let ox = -cx, oz = -cz;
  const ol = Math.hypot(ox, oz);
  if (ol > 1e-3) { ox /= ol; oz /= ol; } else { ox = 0; oz = -1; }

  const kioskR = Math.hypot(td.hx, td.hz) + 0.9;       // kiosk + a walkway around it
  const padR = vd.radius + 1.0;                         // kart + room to walk around it
  let best: TerminalSite | null = null, bestScore = Infinity;
  for (const r of RADII) {
    for (let i = 0; i < ANGLES; i++) {
      const a = (i / ANGLES) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const k = clearDisc(data, x, z, kioskR, 0.45);
      if (!k.ok) continue;
      const yaw = yawToward(x, z, cx, cz); // the screen faces the spawns
      // The pad sits on the kiosk's right (as seen by someone facing the screen, it is on their left).
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const padX = x + rx * td.padOffset, padZ = z + rz * td.padOffset;
      const p = clearDisc(data, padX, padZ, padR, 0.35);
      if (!p.ok) continue;
      // Also keep the strip between kiosk and pad walkable (no prop in between).
      const mx = (x + padX) / 2, mz = (z + padZ) / 2;
      if (nearestPropDist(data, mx, mz, k.y - 0.5, k.y + 3) < 1.2) continue;
      const out = (x - cx) * ox + (z - cz) * oz; // + = toward the middle of the map
      const score = Math.abs(r - 9) * 1.0 - out * 0.35;
      if (score < bestScore) {
        bestScore = score;
        best = { team, x, y: k.y, z, yaw, padX, padY: p.y, padZ, padYaw: yawToward(padX, padZ, padX + ox, padZ + oz) };
      }
    }
    if (best && r >= 13) break; // good enough: do not wander far from the base once something fits
  }
  return best;
}

/**
 * The Rooftop Hangar's site (R1): a fixed spot on The Rooftops (TERMINALS.plane_hangar.site), used only when
 * this world has that district and the roof is where the data says (kiosk and pad on a surface at the site's
 * height). Null otherwise — e.g. the flat unit-test yards, or a future map without the garage.
 */
export function hangarSite(data: WorldData): TerminalSite | null {
  const td = TERMINALS.plane_hangar, s = td.site;
  if (!s || !data.districts?.some((d) => d.id === s.district)) return null;
  for (const [x, y, z] of [[s.x, s.y, s.z], [s.padX, s.padY, s.padZ]] as const) {
    if (Math.abs(surfaceAt(data, x, z, y + 0.5).y - y) > 0.05) return null;
  }
  return { team: Team.Neutral, x: s.x, y: s.y, z: s.z, yaw: s.yaw, padX: s.padX, padY: s.padY, padZ: s.padZ, padYaw: s.padYaw };
}

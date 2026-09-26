// Footprint-aware navigation for the (5 m wide) boss on top of the combat lane's 1 m nav grid:
// a spot is clear when every cell under a disc is walkable plain ground (no water, no jump pads).
// The boss drives straight lines between clear spots and lets its KCC slide along anything else.
import type { Sim } from '../sim';
import { cellIndex, navGridFor, type NavGrid } from '../ai/nav';
import { simNavGrid } from '../ai';

/** The combat lane's nav grid (null before the first physics step has built Rapier's query structures). */
export function bossNavGrid(sim: Sim): NavGrid | null {
  const g = simNavGrid(sim);
  if (g) return g;
  return sim.tick >= 1 ? navGridFor(sim) : null;
}

/** True when a disc of radius r around (x, z) is plain walkable ground. */
export function discClear(g: NavGrid, x: number, z: number, r: number): boolean {
  const c = g.cell;
  const r2 = r * r;
  for (let dz = -r; dz <= r + 1e-6; dz += c) {
    for (let dx = -r; dx <= r + 1e-6; dx += c) {
      if (dx * dx + dz * dz > r2) continue;
      const i = cellIndex(g, x + dx, z + dz);
      if (i < 0 || !g.walk[i] || g.cost[i] > 1) return false;
    }
  }
  return true;
}

/** True when the disc stays clear along the straight segment a → b (sampled every `step` m). */
export function sweepClear(g: NavGrid, ax: number, az: number, bx: number, bz: number, r: number, step = 1.5): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / step));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!discClear(g, ax + (bx - ax) * t, az + (bz - az) * t, r)) return false;
  }
  return true;
}

const found = { x: 0, z: 0 };
/** Nearest clear spot to (x, z) on a spiral of rings (null if none within maxR). */
export function nearestClear(g: NavGrid, x: number, z: number, r: number, maxR: number): { x: number; z: number } | null {
  if (discClear(g, x, z, r)) { found.x = x; found.z = z; return found; }
  for (let ring = 1.5; ring <= maxR; ring += 1.5) {
    const n = Math.max(8, Math.round((ring * Math.PI * 2) / 1.5));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * ring, pz = z + Math.sin(a) * ring;
      if (discClear(g, px, pz, r)) { found.x = px; found.z = pz; return found; }
    }
  }
  return null;
}

/** Ground height of the nav cell under (x, z) when inside the grid, else the world height. */
export function groundAt(sim: Sim, g: NavGrid | null, x: number, z: number): number {
  if (g) {
    const i = cellIndex(g, x, z);
    if (i >= 0 && g.walk[i]) return Math.max(g.ground[i], sim.worldData.height(x, z));
  }
  return sim.worldData.height(x, z);
}

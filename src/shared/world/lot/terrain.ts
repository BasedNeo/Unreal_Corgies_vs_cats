// The Lot's terrain: a deterministic raw height function (mud undulation + stamps) and surface weights, baked onto
// the same 1 m grid the West Yard uses (terrain.ts bakeTerrainGrid / gridHeight), so the sim collider, the rendered
// mesh and height() are one surface. Pure: no three, no DOM, no Math.random.
//
// Stamp order (each is a pure function of x, z):
//   1. mud undulation (two octaves), faded to 0 at the perimeter
//   2. mounds (+), tyre ruts (-)
//   3. pads: blend to a flat height (container block, pipe block)
//   4. the spoil heap: blend to a flat top with per-side slope widths (lumpy slopes), plus its north ramp (max)
//   5. carves (min): the foundation pit and its two ramps, the communication trenches, the drainage ditch.
//      A carve is floor(x, z) + WALL_STEEP * (distance outside its footprint): steep walls, flat floors.
import type { SurfaceSample } from '../world-types';
import { clamp, createNoise2D, fbm2, lerp, smoothstep } from '../noise';
import {
  DITCH, DITCH_SEGMENTS, HEAP, HEAP_RAMP, LOT_EDGE, MOUNDS, PADS, PIT, PIT_RAMP_EAST, PIT_RAMP_SOUTH, ROADS, RUT,
  TRENCHES, WALL_STEEP,
} from './layout';

export interface LotField {
  raw(x: number, z: number): number;
  surface(x: number, z: number): SurfaceSample;
}

interface Poly { pts: readonly number[]; cum: number[]; total: number; box: [number, number, number, number] }

function poly(pts: readonly number[], pad: number): Poly {
  const cum = [0];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]);
    if (i + 3 < pts.length) cum.push(cum[cum.length - 1] + Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]));
  }
  return { pts, cum, total: cum[cum.length - 1], box: [x0 - pad, z0 - pad, x1 + pad, z1 + pad] };
}

/** Distance to the polyline and the arc length of the closest point. */
function polyDist(p: Poly, x: number, z: number, out: { d: number; s: number }): void {
  let best = Infinity, bs = 0;
  const P = p.pts;
  for (let i = 0, k = 0; i + 3 < P.length; i += 2, k++) {
    const ax = P[i], az = P[i + 1], vx = P[i + 2] - ax, vz = P[i + 3] - az;
    const l2 = vx * vx + vz * vz;
    const t = l2 > 0 ? clamp(((x - ax) * vx + (z - az) * vz) / l2, 0, 1) : 0;
    const ex = x - (ax + vx * t), ez = z - (az + vz * t), d2 = ex * ex + ez * ez;
    if (d2 < best) { best = d2; bs = p.cum[k] + t * Math.sqrt(l2); }
  }
  out.d = Math.sqrt(best); out.s = bs;
}

const inBox = (b: readonly number[], x: number, z: number) => x >= b[0] && z >= b[1] && x <= b[2] && z <= b[3];

/** Signed distance to an axis-aligned rect (noise.ts sdRect with sqrt instead of Math.hypot: the bake's hot path). */
function sdRect(px: number, pz: number, cx: number, cz: number, hx: number, hz: number): number {
  const dx = Math.abs(px - cx) - hx, dz = Math.abs(pz - cz) - hz;
  const ox = dx > 0 ? dx : 0, oz = dz > 0 ? dz : 0;
  const inside = dx > dz ? dx : dz;
  return Math.sqrt(ox * ox + oz * oz) + (inside < 0 ? inside : 0);
}

export function createLotField(seed: number): LotField {
  const nA = createNoise2D(`${seed}:lotMudA`), nB = createNoise2D(`${seed}:lotMudB`);
  const nLump = createNoise2D(`${seed}:lotSpoil`), nPatch = createNoise2D(`${seed}:lotPatch`);
  const trenches = TRENCHES.map((t) => ({ ...t, p: poly(t.pts, t.half + 4) }));
  const roads = ROADS.map((r) => poly(r.pts, RUT.offset + RUT.width + 3));
  const tmp = { d: 0, s: 0 };
  const S = WALL_STEEP;
  const heapBox = [HEAP.x - HEAP.hx - HEAP.wW, HEAP.z - HEAP.hz - HEAP.wN, HEAP.x + HEAP.hx + HEAP.wE, HEAP.z + HEAP.hz + HEAP.wS];
  const pitBox = [PIT.x - PIT.hx - 2, PIT.z - PIT.hz - 2, PIT.x + PIT.hx + 2, PIT.z + PIT.hz + 2];
  const ditchReach = DITCH.floorHz + DITCH.bank;
  const ditchSlope = -DITCH.floor / DITCH.bank;

  /** Heap blend weight at (x, z): 1 on the flat top, 0 at the foot; per-side slope widths, rounded corners. */
  function heapWeight(x: number, z: number): number {
    const dxE = (x - (HEAP.x + HEAP.hx)) / HEAP.wE, dxW = ((HEAP.x - HEAP.hx) - x) / HEAP.wW;
    const dzN = ((HEAP.z - HEAP.hz) - z) / HEAP.wN, dzS = (z - (HEAP.z + HEAP.hz)) / HEAP.wS;
    const tx = Math.max(dxE, dxW, 0), tz = Math.max(dzN, dzS, 0);
    const t = Math.sqrt(tx * tx + tz * tz);
    return 1 - smoothstep(0, 1, t);
  }

  function raw(x: number, z: number): number {
    // 1) mud undulation, faded out toward the perimeter (fences and hoarding stand on y = 0)
    const edge = LOT_EDGE - Math.max(Math.abs(x), Math.abs(z));
    const fade = smoothstep(1, 7, edge);
    let h = fade * (0.32 * fbm2(nA, x / 26, z / 26, 3) + 0.1 * fbm2(nB, x / 6.5, z / 6.5, 2));

    // 2) mounds and ruts
    for (const m of MOUNDS) {
      const dx = x - m.x, dz = z - m.z;
      if (Math.abs(dx) > m.r + m.falloff || Math.abs(dz) > m.r + m.falloff) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= m.r + m.falloff) continue;
      h += m.h * (d <= m.r ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (d - m.r)) / m.falloff));
    }
    for (const r of roads) {
      if (!inBox(r.box, x, z)) continue;
      polyDist(r, x, z, tmp);
      const off = Math.abs(tmp.d - RUT.offset);
      if (off < RUT.width) h -= fade * RUT.depth * (1 - smoothstep(0, RUT.width, off));
      if (tmp.d < RUT.offset + 1) h -= fade * 0.05 * (1 - smoothstep(RUT.offset - 1, RUT.offset + 1, tmp.d));
    }

    // 3) pads
    for (const p of PADS) {
      if (Math.abs(x - p.x) > p.hx + p.falloff || Math.abs(z - p.z) > p.hz + p.falloff) continue;
      const d = sdRect(x, z, p.x, p.z, p.hx, p.hz);
      if (d >= p.falloff) continue;
      h = lerp(h, p.h, 1 - smoothstep(0, p.falloff, d));
    }

    // 4) the spoil heap (lumpy slopes, exactly flat top) + its north ramp
    if (inBox(heapBox, x, z)) {
      const w = heapWeight(x, z);
      if (w > 0) {
        const lump = w < 1 ? 0.55 * fbm2(nLump, x / 4.5, z / 4.5, 2) * 4 * w * (1 - w) : 0;
        h = lerp(h, HEAP.top, w) + lump;
      }
    }
    {
      const R = HEAP_RAMP;
      if (Math.abs(x - R.x) < R.half + 3 && z > R.z1 - R.run - 1 && z < R.z1 + 1) {
        const ramp = HEAP.top * clamp((z - (R.z1 - R.run)) / R.run, 0, 1) - Math.max(0, Math.abs(x - R.x) - R.half) * S;
        if (ramp > h) h = ramp;
      }
    }

    // 5) carves
    if (inBox(pitBox, x, z)) {
      const d = sdRect(x, z, PIT.x, PIT.z, PIT.hx, PIT.hz);
      h = Math.min(h, PIT.floor + Math.max(0, d) * S);
    }
    {
      const R = PIT_RAMP_EAST;
      if (x > R.x0 - 2 && x < R.x0 + R.run + 3 && Math.abs(z - R.z) < R.half + 3) {
        const floor = PIT.floor + Math.max(0, x - R.x0) * (-PIT.floor / R.run);
        h = Math.min(h, floor + Math.max(0, Math.abs(z - R.z) - R.half) * S);
      }
    }
    {
      const R = PIT_RAMP_SOUTH;
      if (z > R.z0 - 2 && z < R.z0 + R.run + 3 && Math.abs(x - R.x) < R.half + 3) {
        const floor = PIT.floor + Math.max(0, z - R.z0) * (-PIT.floor / R.run);
        h = Math.min(h, floor + Math.max(0, Math.abs(x - R.x) - R.half) * S);
      }
    }
    for (const t of trenches) {
      if (!inBox(t.p.box, x, z)) continue;
      polyDist(t.p, x, z, tmp);
      const out = tmp.d - t.half;
      if (out > 3) continue;
      const exitStart = t.p.total - t.exit;
      const floor = t.exit > 0 && tmp.s > exitStart ? t.floor * (1 - (tmp.s - exitStart) / t.exit) : t.floor;
      h = Math.min(h, floor + Math.max(0, out) * S);
    }
    if (Math.abs(z - DITCH.z) < ditchReach + 0.5) {
      for (const [x0, x1] of DITCH_SEGMENTS) {
        if (x < x0 - 0.5 || x > x1 + 0.5) continue;
        const d = sdRect(x, z, (x0 + x1) / 2, DITCH.z, (x1 - x0) / 2 - DITCH.bank, DITCH.floorHz);
        h = Math.min(h, DITCH.floor + Math.max(0, d) * ditchSlope);
      }
    }
    return h;
  }

  /** W9: ~3 m patches that break the gravel rims up (0 = no gravel there). */
  const rimBreak = (px: number, pz: number) => smoothstep(-0.3, 0.25, fbm2(nPatch, px / 3.2 + 17, pz / 3.2 - 5, 2));

  function surface(x: number, z: number): SurfaceSample {
    const edge = LOT_EDGE - Math.max(Math.abs(x), Math.abs(z));
    if (edge < -1) return { dirt: 0, sand: 0, mulch: 0, wild: 1 };        // the neighbours' ground beyond the fence
    const jit = fbm2(nPatch, x / 5, z / 5, 2);
    // base: wet mud; a scruffy strip of weeds along the perimeter
    const weeds = 1 - smoothstep(1.5, 4.5, edge + jit * 1.5);
    let sand = 0, mulch = 0;
    // gravel: the container and pipe blocks, patches on the heap top and the pit floor
    for (const p of PADS) {
      if (Math.abs(x - p.x) > p.hx + 2 || Math.abs(z - p.z) > p.hz + 2) continue;
      const w = 0.85 * (1 - smoothstep(-2, 1.5, sdRect(x, z, p.x, p.z, p.hx - 2, p.hz - 2) + jit * 2));
      if (w > sand) sand = w;
    }
    if (Math.abs(x - PIT.x) < PIT.hx && Math.abs(z - PIT.z) < PIT.hz) {
      const w = smoothstep(-0.1, 0.25, fbm2(nPatch, x / 9, z / 9, 2)) * 0.9;
      if (w > sand) sand = w;
    }
    if (Math.abs(x - HEAP.x) <= HEAP.hx && Math.abs(z - HEAP.z) <= HEAP.hz) {
      const w = smoothstep(0.05, 0.4, fbm2(nPatch, x / 8 + 31, z / 8, 2)) * 0.7;
      if (w > sand) sand = w;
    }
    // pale spoil/gravel rims outline the carves at ground level (the pit and trench shapes read from afar). W9: calmer —
    // narrower, and broken into ~3 m spoil patches (the terrain material thresholds the weight at ~0.5), so they read as
    // spilled gravel along the edge rather than a continuous white outline.
    {
      const pd = sdRect(x, z, PIT.x, PIT.z, PIT.hx, PIT.hz);
      if (pd > 0 && pd < 4) { const w = 0.95 * (1 - smoothstep(1.2, 2.8, pd + jit * 0.8)) * smoothstep(0.6, 1.3, pd) * rimBreak(x, z); if (w > sand) sand = w; }
    }
    for (const t of trenches) {
      if (!inBox(t.p.box, x, z)) continue;
      polyDist(t.p, x, z, tmp);
      const out = tmp.d - t.half;
      if (out > 0.6 && out < 3 && tmp.s < t.p.total - 1) { const w = 0.9 * (1 - smoothstep(1.0, 2.1, out + jit * 0.6)) * smoothstep(0.6, 1.2, out) * rimBreak(x, z); if (w > sand) sand = w; }
    }
    // dark wet mud: trench floors, the ditch banks, the haul roads and their ruts
    for (const t of trenches) {
      if (!inBox(t.p.box, x, z)) continue;
      polyDist(t.p, x, z, tmp);
      const w = 1 - smoothstep(t.half - 0.5, t.half + 1.2, tmp.d + jit * 0.6);
      if (w > mulch) mulch = w;
    }
    if (Math.abs(z - DITCH.z) < ditchReach + 3) {
      for (const [x0, x1] of DITCH_SEGMENTS) {
        if (x < x0 - 3 || x > x1 + 3) continue;
        const w = 1 - smoothstep(-0.5, 1.8, sdRect(x, z, (x0 + x1) / 2, DITCH.z, (x1 - x0) / 2, ditchReach) + jit);
        if (w > mulch) mulch = w;
      }
    }
    for (const r of roads) {
      if (!inBox(r.box, x, z)) continue;
      polyDist(r, x, z, tmp);
      const w = 1 - smoothstep(RUT.offset + 0.6, RUT.offset + 2.4, tmp.d + jit * 1.2);
      if (w > mulch) mulch = w;
    }
    return { dirt: 1 - 0.75 * weeds, sand, mulch, wild: weeds };
  }

  // JIT warm-up: the grid bakes row by row from a corner, so most stamps' branches first run thousands of samples in;
  // TurboFan compiled raw() without their type feedback and deopted ~9 times (cold bake 440 ms vs 67 ms warm).
  // A coarse pass over the whole lot first costs ~1 ms and visits every branch. Results are discarded.
  let warm = 0;
  for (let z = -160; z <= 160; z += 5) for (let x = -160; x <= 160; x += 5) { warm += raw(x, z); warm += surface(x, z).mulch; }
  void warm;
  return { raw, surface };
}

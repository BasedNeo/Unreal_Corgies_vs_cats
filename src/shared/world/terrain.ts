// Yard terrain: a deterministic raw height function built from a data spec (lawn undulation + stamps:
// mound, flat pads, pond bowl, sandbox pit, dug holes, paths), baked onto a regular grid. The world's
// height(x, z) is the EXACT triangulated surface of that grid, split on the same diagonal as a Rapier
// heightfield — so the sim collider, the rendered mesh and every height() query are one surface.
// Pure TS: no three, no DOM, no Math.random.
import type { SurfaceSample, TerrainGrid } from './world-types';
import { clamp, createNoise2D, distToSegment, fbm2, lerp, sdRect, smoothstep } from './noise';

export type TerrainOp =
  /** Blend to height `h` inside an axis-aligned rect, smooth falloff outside. */
  | { op: 'flat'; x: number; z: number; hx: number; hz: number; h: number; falloff: number }
  /** Smooth round hill of height `h`: full height inside r, cosine falloff to r + falloff. */
  | { op: 'raise'; x: number; z: number; r: number; falloff: number; h: number }
  /** Pond: flat bottom at -depth inside r*flat, sloping up to the rim at r; small raised bank. */
  | { op: 'bowl'; x: number; z: number; r: number; depth: number; flat: number; bank: number }
  /** Rect pit (sandbox) of `depth` with a soft edge. */
  | { op: 'pit'; x: number; z: number; hx: number; hz: number; depth: number; falloff: number }
  /** Round dug hole. */
  | { op: 'hole'; x: number; z: number; r: number; depth: number }
  /** Worn path: shallow depression along a polyline. */
  | { op: 'path'; pts: number[]; width: number; depth: number };

export type SurfaceKind = 'dirt' | 'sand' | 'mulch' | 'wild';
export type SurfaceOp =
  | { kind: SurfaceKind; shape: 'circle'; x: number; z: number; r: number; soft: number; amount?: number }
  | { kind: SurfaceKind; shape: 'rect'; x: number; z: number; hx: number; hz: number; soft: number; amount?: number }
  | { kind: SurfaceKind; shape: 'path'; pts: number[]; width: number; soft: number; amount?: number };

export interface TerrainSpec {
  seed: number;
  /** Two octave bands of lawn undulation (meters). */
  undulation: { amp: number; scale: number; amp2: number; scale2: number };
  /** Mowed-lawn rectangle; undulation fades out within edgeFade of it and the ground is 0 outside. */
  yard: { minX: number; maxX: number; minZ: number; maxZ: number; edgeFade: number };
  /** Un-mowed band width along the yard edge (visual "wild" grass). */
  wildBand: number;
  ops: TerrainOp[];
  surfaces: SurfaceOp[];
}

export interface YardField {
  /** Smooth (pre-bake) height. Use height() from WorldData for gameplay. */
  raw(x: number, z: number): number;
  surface(x: number, z: number): SurfaceSample;
}

export function createYardField(spec: TerrainSpec): YardField {
  const nA = createNoise2D(`${spec.seed}:lawnA`), nB = createNoise2D(`${spec.seed}:lawnB`);
  const nEdge = createNoise2D(`${spec.seed}:edges`);
  const Y = spec.yard;
  const ops = spec.ops;
  // Axis-aligned influence boxes: cheap rejection before distance math (bake + scatter hot path).
  const ptsBox = (pts: number[], pad: number) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]); }
    return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
  };
  const opBox = ops.map((o): number[] => {
    switch (o.op) {
      case 'raise': return [o.x - o.r - o.falloff, o.z - o.r - o.falloff, o.x + o.r + o.falloff, o.z + o.r + o.falloff];
      case 'flat': return [o.x - o.hx - o.falloff, o.z - o.hz - o.falloff, o.x + o.hx + o.falloff, o.z + o.hz + o.falloff];
      case 'path': return ptsBox(o.pts, o.width);
      case 'bowl': return [o.x - o.r * 1.45, o.z - o.r * 1.45, o.x + o.r * 1.45, o.z + o.r * 1.45];
      case 'pit': return [o.x - o.hx - o.falloff, o.z - o.hz - o.falloff, o.x + o.hx + o.falloff, o.z + o.hz + o.falloff];
      case 'hole': return [o.x - o.r, o.z - o.r, o.x + o.r, o.z + o.r];
    }
  });
  const surfBox = spec.surfaces.map((o): number[] => {
    const pad = o.soft * 2 + 3;
    if (o.shape === 'circle') return [o.x - o.r - pad, o.z - o.r - pad, o.x + o.r + pad, o.z + o.r + pad];
    if (o.shape === 'rect') return [o.x - o.hx - pad, o.z - o.hz - pad, o.x + o.hx + pad, o.z + o.hz + pad];
    return ptsBox(o.pts, o.width + pad);
  });
  const outside = (b: number[], x: number, z: number) => x < b[0] || z < b[1] || x > b[2] || z > b[3];

  function raw(x: number, z: number): number {
    // 1) lawn undulation, faded to 0 at the yard edge and outside it (fences sit on flat ground)
    const edge = -sdRect(x, z, (Y.minX + Y.maxX) / 2, (Y.minZ + Y.maxZ) / 2, (Y.maxX - Y.minX) / 2, (Y.maxZ - Y.minZ) / 2);
    const fade = smoothstep(0, Y.edgeFade, edge);
    const U = spec.undulation;
    let h = fade * (U.amp * fbm2(nA, x / U.scale, z / U.scale, 3) + U.amp2 * fbm2(nB, x / U.scale2, z / U.scale2, 2));
    // 2) stamps in list order
    for (let k = 0; k < ops.length; k++) {
      const o = ops[k];
      if (outside(opBox[k], x, z)) continue;
      switch (o.op) {
        case 'raise': {
          const d = Math.hypot(x - o.x, z - o.z);
          if (d >= o.r + o.falloff) break;
          const t = d <= o.r ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (d - o.r) / o.falloff);
          h += o.h * t;
          break;
        }
        case 'flat': {
          const d = sdRect(x, z, o.x, o.z, o.hx, o.hz);
          if (d >= o.falloff) break;
          const w = 1 - smoothstep(0, o.falloff, d);
          h = lerp(h, o.h, w);
          break;
        }
        case 'path': {
          let d = Infinity;
          for (let i = 0; i + 3 < o.pts.length; i += 2) d = Math.min(d, distToSegment(x, z, o.pts[i], o.pts[i + 1], o.pts[i + 2], o.pts[i + 3]));
          if (d < o.width) h -= o.depth * (1 - smoothstep(o.width * 0.45, o.width, d));
          break;
        }
        case 'bowl': {
          const d = Math.hypot(x - o.x, z - o.z);
          const t = d / o.r;
          if (t < 1) {
            const target = -o.depth * (1 - smoothstep(o.flat, 1, t));
            h = Math.min(h * smoothstep(0.7, 1, t), target);
          } else if (t < 1.45) {
            h += o.bank * Math.sin(Math.PI * (t - 1) / 0.45);
          }
          break;
        }
        case 'pit': {
          const d = sdRect(x, z, o.x, o.z, o.hx, o.hz);
          if (d >= o.falloff) break;
          const w = 1 - smoothstep(-o.falloff, o.falloff, d);
          h = lerp(h, -o.depth, w);
          break;
        }
        case 'hole': {
          const d = Math.hypot(x - o.x, z - o.z);
          if (d < o.r) { const t = d / o.r; h -= o.depth * (1 - t * t) * (1 - t * t); }
          break;
        }
      }
    }
    return h;
  }

  function surface(x: number, z: number): SurfaceSample {
    const s: SurfaceSample = { dirt: 0, sand: 0, mulch: 0, wild: 0 };
    const jitter = fbm2(nEdge, x / 5, z / 5, 2);            // organic, non-circular edges
    const edge = -sdRect(x, z, (Y.minX + Y.maxX) / 2, (Y.minZ + Y.maxZ) / 2, (Y.maxX - Y.minX) / 2, (Y.maxZ - Y.minZ) / 2);
    s.wild = edge < 0 ? 1 : 1 - smoothstep(spec.wildBand * 0.5, spec.wildBand, edge + jitter * 2.5);
    for (let k = 0; k < spec.surfaces.length; k++) {
      const o = spec.surfaces[k];
      if (outside(surfBox[k], x, z)) continue;
      let d: number, soft: number;
      if (o.shape === 'circle') { d = Math.hypot(x - o.x, z - o.z) - o.r; soft = o.soft; }
      else if (o.shape === 'rect') { d = sdRect(x, z, o.x, o.z, o.hx, o.hz); soft = o.soft; }
      else {
        d = Infinity;
        for (let i = 0; i + 3 < o.pts.length; i += 2) d = Math.min(d, distToSegment(x, z, o.pts[i], o.pts[i + 1], o.pts[i + 2], o.pts[i + 3]));
        d -= o.width * 0.5; soft = o.soft;
      }
      if (d > soft * 2 + 2) continue;
      const w = (1 - smoothstep(-soft, soft, d + jitter * soft * 0.9)) * (o.amount ?? 1);
      if (w > s[o.kind]) s[o.kind] = w;
    }
    // Paths/sand/mulch are never "wild" grass.
    s.wild *= 1 - Math.max(s.dirt, s.sand, s.mulch);
    return s;
  }

  return { raw, surface };
}

/** Sample a height function onto a grid. Heights are float32 so every consumer sees identical values. */
export function bakeTerrainGrid(raw: (x: number, z: number) => number, x0: number, z0: number, cell: number, n: number): TerrainGrid {
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = raw(x0 + i * cell, z0 + j * cell);
  return { x0, z0, cell, n, heights };
}

/** True if (x, z) lies inside the baked grid. */
export function inGrid(g: TerrainGrid, x: number, z: number): boolean {
  const ext = (g.n - 1) * g.cell;
  return x >= g.x0 && z >= g.z0 && x <= g.x0 + ext && z <= g.z0 + ext;
}

/**
 * Exact height of the triangulated grid surface. Each cell (a=(i,j), b=(i+1,j), c=(i,j+1), d=(i+1,j+1))
 * is split on the b–c diagonal into triangles (a,c,b) and (b,c,d) — Rapier's heightfield layout.
 */
export function gridHeight(g: TerrainGrid, x: number, z: number): number {
  const res = g.n - 1;
  const u = clamp((x - g.x0) / g.cell, 0, res - 1e-9), v = clamp((z - g.z0) / g.cell, 0, res - 1e-9);
  const i = Math.floor(u), j = Math.floor(v), fx = u - i, fz = v - j;
  const n = g.n, H = g.heights;
  const a = H[j * n + i], b = H[j * n + i + 1], c = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}

/** Terrain slope in degrees at (x, z) from the triangle under the point. */
export function gridSlopeDeg(g: TerrainGrid, x: number, z: number): number {
  const e = g.cell * 0.25;
  const hx = gridHeight(g, x + e, z) - gridHeight(g, x - e, z), hz = gridHeight(g, x, z + e) - gridHeight(g, x, z - e);
  return (Math.atan(Math.hypot(hx, hz) / (2 * e)) * 180) / Math.PI;
}

export interface TerrainChunkArrays {
  position: Float32Array;
  normal: Float32Array;
  /** vec4 per vertex: dirt, sand, mulch, wild. */
  surf: Float32Array | null;
  index: Uint32Array;
  minY: number; maxY: number;
}

/**
 * Render arrays for the grid sub-rectangle of vertices [i0, i1] x [j0, j1] (inclusive), taking every
 * `step`-th sample. With step = 1 the triangles are exactly the collider's triangles.
 */
export function buildTerrainChunkArrays(
  g: TerrainGrid, i0: number, j0: number, i1: number, j1: number, step = 1,
  surface?: (x: number, z: number) => SurfaceSample,
): TerrainChunkArrays {
  const nx = Math.floor((i1 - i0) / step) + 1, nz = Math.floor((j1 - j0) / step) + 1;
  const count = nx * nz;
  const position = new Float32Array(count * 3), normal = new Float32Array(count * 3);
  const surf = surface ? new Float32Array(count * 4) : null;
  const H = g.heights, n = g.n, cell = g.cell;
  const at = (i: number, j: number) => H[clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1)];
  let minY = Infinity, maxY = -Infinity;
  for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) {
    const i = i0 + a * step, j = j0 + b * step, k = b * nx + a;
    const x = g.x0 + i * cell, z = g.z0 + j * cell, y = at(i, j);
    position[k * 3] = x; position[k * 3 + 1] = y; position[k * 3 + 2] = z;
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    // Central differences on the global grid: identical normals on both sides of chunk borders.
    const dx = at(i + step, j) - at(i - step, j), dz = at(i, j + step) - at(i, j - step);
    const nyv = 2 * step * cell, l = Math.hypot(dx, nyv, dz);
    normal[k * 3] = -dx / l; normal[k * 3 + 1] = nyv / l; normal[k * 3 + 2] = -dz / l;
    if (surf && surface) {
      const s = surface(x, z);
      surf[k * 4] = s.dirt; surf[k * 4 + 1] = s.sand; surf[k * 4 + 2] = s.mulch; surf[k * 4 + 3] = s.wild;
    }
  }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let o = 0;
  for (let b = 0; b < nz - 1; b++) for (let a = 0; a < nx - 1; a++) {
    const ia = b * nx + a, ib = ia + 1, ic = ia + nx, id = ic + 1;
    index[o++] = ia; index[o++] = ic; index[o++] = ib;
    index[o++] = ib; index[o++] = ic; index[o++] = id;
  }
  return { position, normal, surf, index, minY, maxY };
}

// Deterministic noise for the world field (adapted from game-landscape-terrain/landscape-core.js).
// Pure functions of (x, z, seed): identical in the worker authority, Node server, client and tests.
// Never Math.random() here.

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** FNV-1a of any seed (string or number) -> uint32. */
export function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/** Stateless hash of integer lattice coords -> [0,1). */
export function hash2(ix: number, iz: number, seed = 0): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export type Noise2D = (x: number, z: number) => number;

/** Quintic value noise in ~[-1, 1]. */
export function createNoise2D(seed: string | number): Noise2D {
  const s = hashSeed(seed) | 0;
  return (x: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const a = hash2(ix, iz, s) * 2 - 1, b = hash2(ix + 1, iz, s) * 2 - 1;
    const c = hash2(ix, iz + 1, s) * 2 - 1, d = hash2(ix + 1, iz + 1, s) * 2 - 1;
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  };
}

/** Plain fbm, normalized to ~[-1, 1]. */
export function fbm2(noise: Noise2D, x: number, z: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 1, f = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f + o * 17.3, z * f - o * 9.1);
    norm += amp; amp *= gain; f *= lacunarity;
  }
  return sum / norm;
}

/** Small seeded PRNG (mulberry32) with helpers, for layout decisions. */
export function createRng(seed: string | number) {
  let a = hashSeed(seed);
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
  };
}
export type Rng = ReturnType<typeof createRng>;

/** Distance from point to segment (2D). */
export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? clamp(((px - ax) * vx + (pz - az) * vz) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

/** Signed distance to an axis-aligned rectangle (negative inside). */
export function sdRect(px: number, pz: number, cx: number, cz: number, hx: number, hz: number): number {
  const dx = Math.abs(px - cx) - hx, dz = Math.abs(pz - cz) - hz;
  const ox = Math.max(dx, 0), oz = Math.max(dz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(dx, dz), 0);
}

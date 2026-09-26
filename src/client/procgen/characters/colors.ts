// Palette helpers: every character color is a PALETTE token or a mix of two tokens.
import * as THREE from 'three/webgpu';

const a = new THREE.Color(), b = new THREE.Color();

/** Mix two palette hex colors (linear-space lerp) → hex. */
export function mixHex(x: number, y: number, t: number): number {
  return a.setHex(x).lerp(b.setHex(y), t).getHex();
}


/** Integer lattice hash → [0, 1) (pure: same point, same value on every machine). */
function latticeHash(x: number, y: number, z: number, s: number): number {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ Math.imul(s | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Smooth 3D value noise in [0, 1] (trilinear over a hashed unit lattice, smoothstep weights). Coat patches
 * (merle marbling, calico) are painted from model-space positions with it, so every part of the body agrees
 * on where a patch is, and the same kit always gets the same patches (no RNG state).
 */
export function valueNoise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (i: number, j: number, k: number) => latticeHash(xi + i, yi + j, zi + k, seed);
  const x00 = l(0, 0, 0) + (l(1, 0, 0) - l(0, 0, 0)) * sx, x10 = l(0, 1, 0) + (l(1, 1, 0) - l(0, 1, 0)) * sx;
  const x01 = l(0, 0, 1) + (l(1, 0, 1) - l(0, 0, 1)) * sx, x11 = l(0, 1, 1) + (l(1, 1, 1) - l(0, 1, 1)) * sx;
  const y0 = x00 + (x10 - x00) * sy, y1 = x01 + (x11 - x01) * sy;
  return y0 + (y1 - y0) * sz;
}

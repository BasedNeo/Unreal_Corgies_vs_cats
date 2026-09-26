// style-utils.js — renderer-agnostic helpers used by both style-webgl.js and style-webgpu.js.
// Pass in the THREE namespace you use ('three' or 'three/webgpu') so classes never mix.

import { STYLE } from './style-tokens.js';

/** Stepped lighting ramp for MeshToonMaterial / MeshToonNodeMaterial `gradientMap`. */
export function createToonGradient(THREE, steps = STYLE.toonSteps, floor = STYLE.bandFloor) {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 1 : i / (steps - 1);
    data[i] = Math.round(255 * (floor + (1 - floor) * t));
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;   // Nearest = hard bands. Linear would smear them.
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Average normals of all vertices that share a position (angle-weighted), in place.
 * Inverted-hull outlines push vertices along their normal; with split (faceted) normals
 * the hull tears open at every hard edge. This keeps UVs/topology intact — unlike
 * mergeVertices, which won't weld across UV seams.
 * Hard edges are then drawn by crease lines instead of by shading.
 */
export function smoothNormalsByPosition(THREE, geometry, precision = 1e-4) {
  const pos = geometry.getAttribute('position');
  const idx = geometry.index;
  const triCount = (idx ? idx.count : pos.count) / 3;
  const key = (i) => `${Math.round(pos.getX(i) / precision)},${Math.round(pos.getY(i) / precision)},${Math.round(pos.getZ(i) / precision)}`;
  const acc = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const vi = (k) => (idx ? idx.getX(k) : k);
  const corners = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
  for (let t = 0; t < triCount; t++) {
    const ids = [vi(3 * t), vi(3 * t + 1), vi(3 * t + 2)];
    a.fromBufferAttribute(pos, ids[0]); b.fromBufferAttribute(pos, ids[1]); c.fromBufferAttribute(pos, ids[2]);
    n.subVectors(b, a).cross(e1.subVectors(c, a));
    if (n.lengthSq() === 0) continue;
    n.normalize();
    const P = [a, b, c];
    for (const [i, j, k] of corners) {
      // Angle-weighted: a cube corner gets (1,1,1)/sqrt3 no matter how faces are triangulated.
      const ang = e1.subVectors(P[j], P[i]).angleTo(e2.subVectors(P[k], P[i]));
      const key0 = key(ids[i]);
      const v = acc.get(key0) ?? [0, 0, 0];
      v[0] += n.x * ang; v[1] += n.y * ang; v[2] += n.z * ang;
      acc.set(key0, v);
    }
  }
  const normals = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = acc.get(key(i)) ?? [0, 1, 0];
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    normals[3 * i] = v[0] / len; normals[3 * i + 1] = v[1] / len; normals[3 * i + 2] = v[2] / len;
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.userData.outlineReady = true;
  return geometry;
}

/**
 * Procedural "painted grime + panel" texture (no image files). Tileable, seeded.
 * Use as `map` on meshes that have UVs; on WebGPU use triplanarTexture() for UV-less meshes.
 */
export function createGrimeTexture(THREE, { seed = 1, size = 256, panels = 4, grime = 0.25 } = {}) {
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
  // Tileable value noise lattice
  const L = 16, lat = new Float32Array(L * L).map(rnd);
  const at = (x, y) => lat[((y % L + L) % L) * L + ((x % L + L) % L)];
  const vnoise = (u, v) => {
    const x = u * L, y = v * L, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const top = at(xi, yi) * (1 - sx) + at(xi + 1, yi) * sx;
    const bot = at(xi, yi + 1) * (1 - sx) + at(xi + 1, yi + 1) * sx;
    return top * (1 - sy) + bot * sy;
  };
  const data = new Uint8Array(size * size * 4);
  const cell = size / panels;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const g = 0.6 * vnoise(u, v) + 0.4 * vnoise(u * 2 % 1, v * 2 % 1);
      let val = 1 - grime * Math.max(0, g - 0.35) * 1.6;
      const px = x % cell, py = y % cell;
      if (px < 2 || py < 2) val *= 0.55;                               // panel seams (drawn look)
      if ((px - cell / 2) ** 2 + (py - 4) ** 2 < 2.5) val *= 0.6;      // rivet
      const o = (y * size + x) * 4;
      const c = Math.max(0, Math.min(255, Math.round(val * 255)));
      data[o] = c; data[o + 1] = c; data[o + 2] = c; data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;  // crisp, drawn seams
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Stable cache key for material params. */
export const matKey = (o) => {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return `[${o.map(matKey).join(',')}]`;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${matKey(o[k])}`).join(',')}}`;
};

// style-utils.js — renderer-agnostic helpers used by both style-webgl.js and style-webgpu.js.
// Pass in the THREE namespace you use ('three' or 'three/webgpu') so classes never mix.

import { STYLE } from './style-tokens.js';

/**
 * Soft multi-band ramp value at half-lambert coordinate x = N.L * 0.5 + 0.5 (pure, testable).
 * `steps` bands from `floor` to 1; band edges sit from just before the terminator (x = 0.5, N.L = 0) to x ≈ 0.84, each
 * edge a smoothstep of half-width `softness`, and the lit band keeps a slight slope so big faces still read as form.
 */
export function rampValue(x, steps = STYLE.toonSteps, floor = STYLE.bandFloor, softness = STYLE.ramp.softness, terminator = STYLE.ramp.terminator) {
  const n = Math.max(1, steps - 1);
  const e0 = terminator - 0.06, e1 = terminator + 0.34;
  const ss = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  let v = floor;
  for (let i = 0; i < n; i++) {
    const e = n === 1 ? terminator : e0 + ((e1 - e0) * i) / (n - 1);
    v += ((1 - floor) / n) * ss(e - softness, e + softness, x) * (i === n - 1 ? 0.92 : 1);
  }
  // top band: keep a gentle slope up to 1 (stylized-real, not a flat plateau)
  v += (1 - floor) / n * 0.08 * ss(e1, 1, x);
  return Math.min(1, v);
}

/** Soft-banded lighting ramp (HARDENED): linear-filtered, `texels` wide. Used as `gradientMap` by every toon material. */
export function createRampTexture(THREE, { steps = STYLE.toonSteps, floor = STYLE.bandFloor, softness = STYLE.ramp.softness, texels = STYLE.ramp.texels } = {}) {
  const data = new Uint8Array(texels);
  for (let i = 0; i < texels; i++) data[i] = Math.round(255 * rampValue((i + 0.5) / texels, steps, floor, softness));
  const tex = new THREE.DataTexture(data, texels, 1, THREE.RedFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = `style_ramp_${steps}`;
  return tex;
}

/**
 * Per-vertex surface for merged meshes that mix materials in one draw (fur + armor plates + a steel buckle):
 * writes/extends a `surface` vec4 attribute (rough, metal, grime, wear) for vertices [start, end). Use it with
 * toon({ surfaceAttr: true }); every vertex of such a geometry needs a value (unpainted ones read 0 = mirror-smooth).
 * `s` is a SURFACES preset object or any { rough, metal, grime, wear }.
 */
export function paintSurface(THREE, geometry, s, start = 0, end = geometry.getAttribute('position').count) {
  const count = geometry.getAttribute('position').count;
  let attr = geometry.getAttribute('surface');
  if (!attr || attr.count !== count) {
    const arr = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { arr[i * 4] = 0.62; arr[i * 4 + 2] = 0.3; arr[i * 4 + 3] = 0.3; }
    attr = new THREE.BufferAttribute(arr, 4);
    geometry.setAttribute('surface', attr);
  }
  for (let i = start; i < end; i++) attr.setXYZW(i, s.rough ?? 0.62, s.metal ?? 0, s.grime ?? 0.3, s.wear ?? 0.3);
  attr.needsUpdate = true;
  return geometry;
}

/** Stepped lighting ramp (v1, hard bands, nearest-filtered). Kept for labs that want the old flat comic read. */
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

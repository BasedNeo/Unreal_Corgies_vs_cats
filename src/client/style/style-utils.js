// style-utils.js — renderer-agnostic helpers of the style system (style-webgpu.js and the procedural builders).
// Pass in the THREE namespace you use ('three/webgpu') so classes never mix.
// W13 (docs/design/LOOK.md): the toon ramp helpers (rampValue, createRampTexture, createToonGradient) are gone with the
// stepped bands; the look is PBR.

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

/**
 * Average normals of all vertices that share a position (angle-weighted), in place. Welds the shading across UV seams
 * and duplicated poles of smooth shapes (characters, spheres, rings) without touching UVs or topology, unlike
 * mergeVertices. History: it made the retired ink hull watertight (W13 LOOK.md: no hull any more).
 * `angleDeg` (optional): only faces within that angle of the vertex's own faces are averaged, so hard edges (box edges,
 * cylinder caps) keep their faces' normals under the PBR look; omitted = every face at the position (the old weld,
 * right for organic shapes whose low-poly facets meet at wide angles).
 * Sets geometry.userData.outlineReady (kept for the callers and audits that test it: "normals are processed").
 * @param {any} THREE @param {any} geometry @param {number} [precision] @param {number | null} [angleDeg]
 */
export function smoothNormalsByPosition(THREE, geometry, precision = 1e-4, angleDeg = null) {
  const pos = geometry.getAttribute('position');
  const idx = geometry.index;
  const triCount = (idx ? idx.count : pos.count) / 3;
  const key = (i) => `${Math.round(pos.getX(i) / precision)},${Math.round(pos.getY(i) / precision)},${Math.round(pos.getZ(i) / precision)}`;
  const limit = angleDeg === null || angleDeg === undefined ? null : Math.cos((angleDeg * Math.PI) / 180);
  /** position key -> [nx, ny, nz, weight] per contributing face corner (limited mode) or one running sum */
  const acc = new Map();
  /** limited mode: each vertex's own angle-weighted face normal (its reference) */
  const own = limit === null ? null : new Float32Array(pos.count * 3);
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
      if (own) {
        own[3 * ids[i]] += n.x * ang; own[3 * ids[i] + 1] += n.y * ang; own[3 * ids[i] + 2] += n.z * ang;
        const list = acc.get(key0) ?? [];
        list.push(n.x * ang, n.y * ang, n.z * ang);
        acc.set(key0, list);
      } else {
        const v = acc.get(key0) ?? [0, 0, 0];
        v[0] += n.x * ang; v[1] += n.y * ang; v[2] += n.z * ang;
        acc.set(key0, v);
      }
    }
  }
  const normals = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let v = [0, 1, 0];
    if (own) {
      const ox = own[3 * i], oy = own[3 * i + 1], oz = own[3 * i + 2];
      const ol = Math.hypot(ox, oy, oz);
      const list = acc.get(key(i));
      if (list) {
        // a vertex no triangle uses (a sphere's spare pole copy) has no faces of its own: it takes the full weld
        v = [0, 0, 0];
        for (let f = 0; f < list.length; f += 3) {
          const fl = Math.hypot(list[f], list[f + 1], list[f + 2]) || 1;
          if (ol === 0 || (list[f] * ox + list[f + 1] * oy + list[f + 2] * oz) / (fl * ol) >= limit) { v[0] += list[f]; v[1] += list[f + 1]; v[2] += list[f + 2]; }
        }
        if (Math.hypot(v[0], v[1], v[2]) === 0) v = ol > 0 ? [ox, oy, oz] : [0, 1, 0];
      }
    } else v = acc.get(key(i)) ?? v;
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

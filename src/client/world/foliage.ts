// Near-field instanced foliage: giant grass tufts, clover, daisies, pebbles. Candidates come from a
// global jittered grid per species (hash of integer cell coords -> deterministic, no Math.random),
// filtered once at load by surface masks, water, props and slope. Each frame only the instances
// within `radius` of the camera are live: when the camera has moved > `refill` m the InstancedMesh
// buffers are refilled (instances shrink to zero at the edge instead of popping). One draw call
// per species; bounding spheres recomputed after every refill (frustum culling stays correct).
import * as THREE from 'three/webgpu';
import type { WorldData } from '../../shared/world/world-data';
import { createNoise2D, fbm2, hash2, smoothstep } from '../../shared/world/noise';
import { occupiedAt, waterAt } from '../../shared/world/queries';
import { gridSlopeDeg } from '../../shared/world/terrain';
import { createFoliageMaterial, toonFrom } from './materials';
import { worldColor } from './world-palette';

interface Species {
  id: string;
  spacing: number;
  radius: number;
  capacity: number;
  wind: number;
  ink: boolean;
  /** probability + scale for a candidate */
  rule(x: number, z: number, h: number, r: number): { p: number; s: number; tint: THREE.Color } | null;
}

/** Merge parts into one non-indexed geometry with vertex colors + a uv.y height ramp (wind). All
 *  foliage renders FrontSide: back-facing triangles shade black in the toon pipeline here (see
 *  LEARNINGS), so two-sided shapes are built as thin closed wedges instead of DoubleSide cards. */
export function finish(parts: { geo: THREE.BufferGeometry; color: THREE.Color }[], upNormals = true): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (const { geo, color } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      // Up normals: foliage lights like the lawn under it (and the wind positionNode only shades
      // correctly with up normals in this three build — see LEARNINGS).
      if (upNormals) nor.push(0, 1, 0); else nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(color.r, color.g, color.b);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingBox();
  const maxY = Math.max(out.boundingBox!.max.y, 1e-3), uvs = new Float32Array((pos.length / 3) * 2);
  for (let i = 0; i < pos.length / 3; i++) uvs[i * 2 + 1] = Math.max(0, pos[i * 3 + 1] / maxY);
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.computeBoundingSphere();
  out.userData.outlineReady = true;
  return out;
}

/** Tapered, bent blade as a thin wedge (front + back faces with opposite windings, never coincident). */
export function blade(h: number, w: number, lean: number, yaw: number, tipCol: THREE.Color, baseCol: THREE.Color): { geo: THREE.BufferGeometry; color: THREE.Color }[] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const rot = (x: number, y: number, z: number) => [x * c + z * s, y, -x * s + z * c];
  const T = 0.035;
  const mid = baseCol.clone().lerp(tipCol, 0.6);
  const out: { geo: THREE.BufferGeometry; color: THREE.Color }[] = [];
  for (const side of [1, -1]) {
    const dz = side * T * 0.5;
    const P = [rot(-w, 0, dz), rot(w, 0, dz), rot(-w * 0.6, h * 0.55, lean * 0.35 + dz * 0.6), rot(w * 0.6, h * 0.55, lean * 0.35 + dz * 0.6), rot(0, h, lean)];
    const nrm = rot(0, 0.55, side * 0.83);
    const tri = (a: number[], b: number[], d: number[]) => {
      const g = new THREE.BufferGeometry();
      const v = side > 0 ? [...a, ...b, ...d] : [...a, ...d, ...b];
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([...nrm, ...nrm, ...nrm], 3));
      return g;
    };
    out.push({ geo: tri(P[0], P[1], P[2]), color: baseCol }, { geo: tri(P[1], P[3], P[2]), color: mid }, { geo: tri(P[2], P[3], P[4]), color: tipCol });
  }
  return out;
}

function tuftGeometry(seed: number): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; color: THREE.Color }[] = [];
  const base = worldColor('grass').clone().multiplyScalar(0.72), tip = worldColor('grass').clone().lerp(worldColor('grassDry'), 0.45);
  for (let b = 0; b < 7; b++) {
    const r = hash2(b, seed, 11);
    const yaw = (b / 7) * Math.PI * 2 + r * 0.8;
    const h = 0.65 + 0.35 * hash2(b, seed, 12);
    parts.push(...blade(h, 0.09, 0.25 + 0.3 * r, yaw, tip, base));
  }
  return finish(parts);
}

function cloverGeometry(): THREE.BufferGeometry {
  const leaf = worldColor('clover'), stem = worldColor('grassDark');
  const parts: { geo: THREE.BufferGeometry; color: THREE.Color }[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const g = new THREE.CircleGeometry(0.2, 7).rotateX(-Math.PI / 2 + 0.25).scale(1, 1, 1.2).translate(Math.cos(a) * 0.19, 0.24, Math.sin(a) * 0.19);
    g.rotateY(0);
    parts.push({ geo: g, color: leaf });
  }
  void stem;
  return finish(parts);
}

function daisyGeometry(): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; color: THREE.Color }[] = [];
  parts.push({ geo: new THREE.CylinderGeometry(0.03, 0.04, 0.9, 4, 1, false).translate(0, 0.45, 0), color: worldColor('leaf') });
  parts.push({ geo: new THREE.CircleGeometry(0.2, 10).rotateX(-Math.PI / 2 + 0.35).translate(0, 0.9, 0), color: worldColor('daisy') });
  parts.push({ geo: new THREE.CircleGeometry(0.08, 8).rotateX(-Math.PI / 2 + 0.35).translate(0, 0.925, 0.012), color: worldColor('flowerYellow') });
  parts.push({ geo: new THREE.CircleGeometry(0.16, 5).rotateX(-Math.PI / 2 + 0.6).translate(0.12, 0.35, 0), color: worldColor('leaf') });
  return finish(parts);
}

function pebbleGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.8 + 0.25 * Math.abs(Math.sin(x * 3.1 + z * 1.7));
    p.setXYZ(i, x * k * 1.2, Math.max(-0.15, y * k * 0.55), z * k);
  }
  g.computeVertexNormals();
  const out = finish([{ geo: g, color: worldColor('stone') }], false);
  return out;
}

export interface Foliage {
  group: THREE.Group;
  update(camera: THREE.Camera): void;
  stats(): Record<string, number>;
  dispose(): void;
}

export function createFoliage(data: WorldData, opts: { density?: number; radius?: number } = {}): Foliage {
  const density = opts.density ?? 1;
  const R = opts.radius ?? 58;
  const clusterN = createNoise2D(`${data.seed}:foliage-cluster`);
  const daisyN = createNoise2D(`${data.seed}:daisy-cluster`);
  const zoneMul = (x: number, z: number) => {
    let m = 1;
    for (const zn of data.scatterZones ?? []) {
      const d = Math.hypot(x - zn.x, z - zn.z);
      if (d < zn.r) m = zn.density === 0 ? 0 : Math.max(m, zn.density);
    }
    return m;
  };
  const tmp = new THREE.Color();
  const species: Species[] = [
    {
      id: 'tuft', spacing: 1.7, radius: R, capacity: 9000, wind: 0.22, ink: false,
      rule(x, z, _h, r) {
        const s = data.surface!(x, z);
        const bare = Math.max(s.dirt, s.sand, s.mulch);
        if (bare > 0.35) return null;
        const zm = zoneMul(x, z);
        if (zm === 0) return null;
        const cl = smoothstep(0.1, 0.45, fbm2(clusterN, x / 14, z / 14, 2) * 1.4 + 0.3);
        const p = (0.1 + 0.85 * s.wild + 0.3 * cl * (1 - s.wild)) * (zm > 1 ? zm : 1) * (1 - bare * 2);
        const tall = s.wild > 0.5 || zm > 1.2;
        const sc = tall ? 1.3 + 1.1 * r : 0.55 + 0.4 * r;
        tmp.setRGB(1, 1, 1).multiplyScalar(0.85 + 0.3 * hash2(Math.round(x * 7), Math.round(z * 7), 5));
        if (tall) tmp.multiply(new THREE.Color(1.12, 1.04, 0.8));
        return { p, s: sc, tint: tmp };
      },
    },
    {
      id: 'clover', spacing: 1.25, radius: R * 0.8, capacity: 9000, wind: 0.05, ink: false,
      rule(x, z, _h, r) {
        const s = data.surface!(x, z);
        if (Math.max(s.dirt, s.sand, s.mulch, s.wild) > 0.3 || zoneMul(x, z) === 0) return null;
        const cl = fbm2(clusterN, x / 7 + 40, z / 7, 2);
        const p = smoothstep(0.08, 0.3, cl) * 0.8;
        tmp.setRGB(1, 1, 1).multiplyScalar(0.85 + 0.25 * r);
        return { p, s: 0.75 + 0.55 * r, tint: tmp };
      },
    },
    {
      id: 'daisy', spacing: 2.2, radius: R, capacity: 4000, wind: 0.12, ink: false,
      rule(x, z, _h, r) {
        const s = data.surface!(x, z);
        if (Math.max(s.dirt, s.sand, s.mulch) > 0.3 || zoneMul(x, z) === 0) return null;
        const cl = fbm2(daisyN, x / 11, z / 11, 2);
        const p = smoothstep(0.15, 0.35, cl) * (0.55 + 0.4 * s.wild);
        tmp.setRGB(1, 1, 1);
        return { p, s: 0.55 + 0.45 * r, tint: tmp };
      },
    },
    {
      id: 'pebble', spacing: 2.6, radius: R * 1.2, capacity: 3000, wind: 0, ink: true,
      rule(x, z, _h, r) {
        const s = data.surface!(x, z);
        const edge = s.dirt > 0.1 && s.dirt < 0.9 ? 0.55 : s.dirt * 0.18;
        const p = edge + s.sand * 0.05 + s.mulch * 0.1 + s.wild * 0.04;
        tmp.setRGB(1, 1, 1).multiplyScalar(0.75 + 0.4 * r);
        return { p, s: 0.18 + 0.4 * r * r, tint: tmp };
      },
    },
  ];
  const geos: Record<string, THREE.BufferGeometry> = {
    tuft: tuftGeometry(1), clover: cloverGeometry(), daisy: daisyGeometry(), pebble: pebbleGeometry(),
  };
  const windDir = new THREE.Vector2(0.8, 0.45).normalize();

  // ---- candidates (once) ----
  const CELL = 8;
  interface Cand { x: Float32Array; y: Float32Array; z: Float32Array; yaw: Float32Array; s: Float32Array; r: Float32Array; g: Float32Array; b: Float32Array; count: number; buckets: Map<string, number[]> }
  const cands: Record<string, Cand> = {};
  const ext = data.bounds ? Math.max(-data.bounds.minX, data.bounds.maxX, -data.bounds.minZ, data.bounds.maxZ) : data.halfExtent;
  for (const sp of species) {
    const sid = (hashId(sp.id) ^ data.seed) | 0;
    const spacing = sp.spacing / Math.sqrt(density);
    const n = Math.ceil((2 * ext) / spacing);
    const X: number[] = [], Y: number[] = [], Z: number[] = [], YAW: number[] = [], S: number[] = [], CR: number[] = [], CG: number[] = [], CB: number[] = [];
    const buckets = new Map<string, number[]>();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const gi = i - (n >> 1), gj = j - (n >> 1);
      const x = (gi + hash2(gi, gj, sid)) * spacing, z = (gj + hash2(gi, gj, sid ^ 0x9e37)) * spacing;
      const r = hash2(gi, gj, sid ^ 0x2545);
      const h = data.height(x, z);
      const res = sp.rule(x, z, h, r);
      if (!res || res.p <= 0 || hash2(gi, gj, sid ^ 0x51ed) >= res.p) continue;
      const w = waterAt(data, x, z);
      if (w && h < w.surfaceY + 0.05) continue;
      if (occupiedAt(data, x, h + 0.15, z, 0.15) || occupiedAt(data, x, h + 0.7, z, 0.1)) continue;   // inside/under a low prop
      if (data.terrain && gridSlopeDeg(data.terrain, x, z) > 34) continue;
      const k = X.length;
      X.push(x); Y.push(h - 0.03 * res.s); Z.push(z); YAW.push(hash2(gi, gj, sid ^ 0x7f4a) * Math.PI * 2); S.push(res.s);
      CR.push(res.tint.r); CG.push(res.tint.g); CB.push(res.tint.b);
      const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
      const l = buckets.get(key);
      if (l) l.push(k); else buckets.set(key, [k]);
    }
    cands[sp.id] = {
      x: new Float32Array(X), y: new Float32Array(Y), z: new Float32Array(Z), yaw: new Float32Array(YAW), s: new Float32Array(S),
      r: new Float32Array(CR), g: new Float32Array(CG), b: new Float32Array(CB), count: X.length, buckets,
    };
  }

  // ---- instanced meshes ----
  const group = new THREE.Group();
  group.name = 'foliage';
  const meshes: Record<string, THREE.InstancedMesh> = {};
  const mats: THREE.Material[] = [];
  for (const sp of species) {
    const mat = sp.ink ? toonFrom({ vertexColors: true }) : createFoliageMaterial(sp.wind, windDir, { side: THREE.FrontSide });
    mats.push(mat);
    const cap = Math.min(sp.capacity, cands[sp.id].count);
    const mesh = new THREE.InstancedMesh(geos[sp.id], mat, Math.max(1, cap));
    mesh.count = 0;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.name = `foliage_${sp.id}`;
    mesh.userData.noCameraCollide = true;
    group.add(mesh);
    meshes[sp.id] = mesh;
  }

  const last = new THREE.Vector2(Infinity, Infinity);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function refill(cx: number, cz: number) {
    for (const sp of species) {
      const c = cands[sp.id], mesh = meshes[sp.id];
      const arr = mesh.instanceMatrix.array as Float32Array, col = mesh.instanceColor!.array as Float32Array;
      const cap = mesh.instanceMatrix.count;
      const Rr = sp.radius, fade0 = Rr * 0.72;
      let k = 0;
      const b0x = Math.floor((cx - Rr) / CELL), b1x = Math.floor((cx + Rr) / CELL), b0z = Math.floor((cz - Rr) / CELL), b1z = Math.floor((cz + Rr) / CELL);
      for (let bz = b0z; bz <= b1z && k < cap; bz++) for (let bx = b0x; bx <= b1x && k < cap; bx++) {
        const list = c.buckets.get(`${bx},${bz}`);
        if (!list) continue;
        for (const i of list) {
          const d = Math.hypot(c.x[i] - cx, c.z[i] - cz);
          if (d > Rr) continue;
          const f = d < fade0 ? 1 : 1 - (d - fade0) / (Rr - fade0);
          const s = c.s[i] * f;
          q.setFromAxisAngle(up, c.yaw[i]);
          m4.compose(pv.set(c.x[i], c.y[i], c.z[i]), q, sv.set(s, s, s));
          m4.toArray(arr, k * 16);
          col[k * 3] = c.r[i]; col[k * 3 + 1] = c.g[i]; col[k * 3 + 2] = c.b[i];
          if (++k >= cap) break;
        }
      }
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  return {
    group,
    update(camera) {
      const x = camera.position.x, z = camera.position.z;
      if (Math.hypot(x - last.x, z - last.y) > 5) { last.set(x, z); refill(x, z); }
    },
    stats() {
      const o: Record<string, number> = {};
      for (const sp of species) { o[`${sp.id}Candidates`] = cands[sp.id].count; o[`${sp.id}Live`] = meshes[sp.id].count; }
      return o;
    },
    dispose() {
      for (const g of Object.values(geos)) g.dispose();
      for (const m of mats) m.dispose();
      for (const m of Object.values(meshes)) m.dispose();
    },
  };
}

function hashId(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

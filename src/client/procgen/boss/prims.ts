// Extra hard-surface primitives for the Vac-Tank, built on the character lane's mesh kit (L1): every
// shape is a closed Prim (or an open lathe) that MeshBuilder merges with outline-safe normals.
import * as THREE from 'three/webgpu';
import { blob, ellipsoid, sweep, type Prim, type V3 } from '../characters/mesh-builder';

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _e = new THREE.Euler();

function rotateInto(out: V3, x: number, y: number, z: number, rot: THREE.Matrix4 | null, c: V3): void {
  if (rot) { _v.set(x, y, z).applyMatrix4(rot); x = _v.x; y = _v.y; z = _v.z; }
  out[0] = c[0] + x; out[1] = c[1] + y; out[2] = c[2] + z;
}

export interface PuckOpts {
  /** Edge roundness (superellipse exponent in the radius/height plane; 2 = ellipsoid, 8 = crisp cylinder). */
  p?: number;
  /** Depth radius (defaults to r): elliptical pucks. */
  rz?: number;
  /** Radius multiplier by (u, v, dir). */
  mod?: (u: number, v: number, dx: number, dy: number, dz: number) => number;
  /** Euler (YXZ) rotation of the shape. */
  rot?: V3;
}

/** Round in XZ, flat top and bottom with rounded edges: drums, discs, wheels, hubs. */
export function puck(c: V3, r: number, h: number, W: number, H: number, o: PuckOpts = {}): Prim {
  const p = o.p ?? 5, rz = o.rz ?? r;
  const rot = o.rot ? _m.makeRotationFromEuler(_e.set(o.rot[0], o.rot[1], o.rot[2], 'YXZ')).clone() : null;
  return blob(W, H, (dx, dy, dz, u, v, out) => {
    const rho = Math.hypot(dx, dz);
    const k = 1 / Math.pow(Math.pow(rho, p) + Math.pow(Math.abs(dy), p), 1 / p);
    const m = o.mod ? o.mod(u, v, dx, dy, dz) : 1;
    rotateInto(out, dx * k * r * m, dy * k * h, dz * k * rz * m, rot, c);
  });
}

/** Rounded box (superellipsoid), optionally rotated. */
export function rbox(c: V3, half: V3, W: number, H: number, p = 5, rot?: V3): Prim {
  return ellipsoid(c, half, W, H, { p, rot });
}

/** Straight tube from a to b with rounded caps (`cap` = cap length as a fraction of the radius). */
export function tube(a: V3, b: V3, r: number | [number, number], N: number, cap = 0.35): Prim {
  const [r0, r1] = typeof r === 'number' ? [r, r] : r;
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const up: V3 = Math.abs(d[1]) > 0.9 * Math.hypot(d[0], d[1], d[2]) ? [0, 0, 1] : [0, 1, 0];
  return sweep([a, b], [[r0, r0], [r1, r1]], N, { up, capStart: 1, capEnd: 1, capStartLen: cap, capEndLen: cap });
}

/**
 * Surface of revolution around +Y through profile points [radius, y] (outside faces), open at both
 * ends. Used for the pilot's dome lid with its hatch hole.
 */
export function lathe(c: V3, profile: [number, number][], N: number): Prim {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = profile.length;
  for (let j = 0; j < n; j++) {
    const [r, y] = profile[j];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pos.push(c[0] + Math.sin(a) * r, c[1] + y, c[2] - Math.cos(a) * r);
      uv.push(i / N, j / (n - 1));
    }
  }
  const row = N + 1;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * row + i, b = a + 1, c2 = a + row, d = c2 + 1;
      // profile runs outward → inward and bottom → top: this winding faces outward/up
      idx.push(a, c2, b, b, c2, d);
    }
  }
  return { pos, uv, idx };
}

/** Flat triangle-ish tag (a doodle / ear / pennant) as a thin ellipsoid squashed toward one end. */
export function wedge(c: V3, half: V3, W: number, H: number, rot?: V3): Prim {
  const rt = rot ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')) : null;
  return blob(W, H, (dx, dy, dz, _u, _v, out) => {
    const t = (dy + 1) * 0.5; // 0 bottom … 1 tip
    const w = 1 - t * 0.92;
    rotateInto(out, dx * half[0] * w, dy * half[1], dz * half[2] * (0.5 + 0.5 * w), rt, c);
  });
}

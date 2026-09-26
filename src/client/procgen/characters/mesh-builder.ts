// Procedural mesh kit for characters: smooth "blobby" primitives (superellipsoids, swept tubes with
// rounded caps, closed rings), per-vertex colors from palette functions, automatic skin weights
// (inverse distance to bone segments) and a merge into one skinned BufferGeometry.
// Each primitive gets outline-safe normals (smoothNormalsByPosition) before merging, so the ink hull
// of the toon outline pass never tears.
import * as THREE from 'three/webgpu';
import { smoothNormalsByPosition } from '../../style/style-utils.js';
import * as TOKENS from '../../style/style-tokens.js';
import type { RigTemplate } from '../../anim/rig';

export type V3 = [number, number, number];

/**
 * Style surface of a vertex: [rough, metal, grime, wear] (0..1), written as the `surface` vec4 attribute that the style
 * factory reads with toon({ surfaceAttr: true }) (S4, HARDENED): one material, per-part roughness, metal, grime and
 * edge wear (fur is rough and never chips, armour plates are semi-metal and wear at the edges, eyes and noses are wet).
 */
export type Surf = readonly [number, number, number, number];
type SurfPreset = { rough: number; metal: number; grime: number; wear: number };
const PRESETS = ((TOKENS as unknown as { SURFACES?: Record<string, SurfPreset> }).SURFACES ?? {}) as Record<string, SurfPreset>;
const surf = (name: string, fb: Surf, o: Partial<SurfPreset> = {}): Surf => {
  const p = { ...(PRESETS[name] ?? { rough: fb[0], metal: fb[1], grime: fb[2], wear: fb[3] }), ...o };
  return [p.rough, p.metal, p.grime, p.wear];
};
/** Surfaces of the character kit (style presets where the style lane has them). */
export const SURF = {
  default: surf('default', [0.62, 0, 0.3, 0.3]),
  fur: surf('fur', [0.85, 0, 0.22, 0]),
  cloth: surf('cloth', [0.9, 0, 0.4, 0.15]),
  armor: surf('armor', [0.42, 0.25, 0.45, 0.65]),
  metal: surf('metal', [0.38, 0.85, 0.35, 0.5]),
  /** Small bright fittings (brass buckles, tags, rank insignia): half metal, so they keep their colour at dusk. */
  fitting: surf('metal', [0.34, 0.45, 0.25, 0.5], { metal: 0.45, rough: 0.34 }),
  plastic: surf('plastic', [0.35, 0, 0.3, 0.25]),
  leather: surf('cloth', [0.6, 0, 0.45, 0.3], { rough: 0.6, wear: 0.3 }),
  /** Wet noses, eyes and teeth: glossy (the lights glint in them). */
  eye: surf('default', [0.14, 0, 0, 0], { rough: 0.14, grime: 0, wear: 0 }),
  nose: surf('default', [0.3, 0, 0.05, 0], { rough: 0.3, grime: 0.05, wear: 0 }),
  skin: surf('fur', [0.6, 0, 0.15, 0], { rough: 0.6, wear: 0 }),
} as const;

/** Raw primitive: positions + indices + a (u,v) parameter per vertex for patterns. */
export interface Prim {
  pos: number[];
  uv: number[];
  idx: number[];
  /**
   * Optional positions of the same topology used only for normals: fur tufts displace `pos` for a
   * jagged silhouette while the toon bands shade the smooth base shape (no faceted zig-zag).
   */
  nrmPos?: number[];
}

/** Alternating tuft mask per column: 0/1, seam-safe (column W duplicates column 0). */
export const tuftCol = (u: number, W: number) => (Math.round(u * W) % W) % 2;

export type ColorFn = (x: number, y: number, z: number, u: number, v: number) => number;

export type SkinSpec =
  | { rigid: string }
  | { auto: string[]; power?: number }
  | { blend: [string, number][] }
  /** Per-vertex weights from position and the primitive's (u, v) (e.g. a mouth line bending at its corners). */
  | { fn: (x: number, y: number, z: number, u: number, v: number) => [string, number][] };

// ---------------------------------------------------------------------------------------------
// Primitives

/**
 * UV-sphere topology deformed by `f(dir, u, v) → point`. Rows go from the top pole (v = 0) to the
 * bottom pole (v = 1) or to `vMax` (open cap). Poles are single fan vertices (no degenerate tris).
 */
export function blob(W: number, H: number, f: (dx: number, dy: number, dz: number, u: number, v: number, out: V3) => void, vMax = 1): Prim {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const out: V3 = [0, 0, 0];
  const push = (dx: number, dy: number, dz: number, u: number, v: number) => {
    f(dx, dy, dz, u, v, out);
    pos.push(out[0], out[1], out[2]); uv.push(u, v);
    return pos.length / 3 - 1;
  };
  const top = push(0, 1, 0, 0.5, 0);
  const rows: number[][] = [];
  const closedBottom = vMax >= 0.999;
  const lastRow = closedBottom ? H - 1 : H;
  for (let j = 1; j <= lastRow; j++) {
    const v = (j / H) * vMax, th = v * Math.PI;
    const row: number[] = [];
    for (let i = 0; i <= W; i++) {
      const u = i / W, ph = u * Math.PI * 2;
      row.push(push(Math.sin(th) * Math.sin(ph), Math.cos(th), -Math.sin(th) * Math.cos(ph), u, v));
    }
    rows.push(row);
  }
  // Counter-clockwise seen from outside (front faces point outward).
  for (let i = 0; i < W; i++) idx.push(top, rows[0][i + 1], rows[0][i]);
  for (let r = 0; r < rows.length - 1; r++) {
    const a = rows[r], b = rows[r + 1];
    for (let i = 0; i < W; i++) idx.push(a[i], b[i + 1], b[i], a[i], a[i + 1], b[i + 1]);
  }
  if (closedBottom) {
    const bot = push(0, -1, 0, 0.5, 1);
    const a = rows[rows.length - 1];
    for (let i = 0; i < W; i++) idx.push(a[i], a[i + 1], bot);
  }
  return { pos, uv, idx };
}

export interface EllipsoidOpts {
  /** Superellipsoid exponent (2 = ellipsoid, 3–5 = rounded box). */
  p?: number;
  /** Radius multiplier by (u, v, dir) — taper, bulges (shapes the normals too). */
  mod?: (u: number, v: number, dx: number, dy: number, dz: number) => number;
  /** Extra radius multiplier for fur tufts: silhouette only, normals come from the untufted shape. */
  tuft?: (u: number, v: number, dx: number, dy: number, dz: number) => number;
  /** Clamp y (model space) from below (flat soles). */
  floorY?: number;
  /** Rotation applied to the shape (Euler XYZ radians, order YXZ) before translation. */
  rot?: V3;
  vMax?: number;
}

const _eul = new THREE.Euler();
const _mat = new THREE.Matrix4();
const _vec = new THREE.Vector3();

export function ellipsoid(c: V3, r: V3, W: number, H: number, o: EllipsoidOpts = {}): Prim {
  const p = o.p ?? 2;
  const rot = o.rot ? _mat.makeRotationFromEuler(_eul.set(o.rot[0], o.rot[1], o.rot[2], 'YXZ')).clone() : null;
  const shape = (tufted: boolean) => blob(W, H, (dx, dy, dz, u, v, out) => {
    let k = 1;
    if (p !== 2) k = 1 / Math.pow(Math.abs(dx) ** p + Math.abs(dy) ** p + Math.abs(dz) ** p, 1 / p);
    const m = (o.mod ? o.mod(u, v, dx, dy, dz) : 1) * (tufted && o.tuft ? o.tuft(u, v, dx, dy, dz) : 1);
    _vec.set(dx * k * r[0] * m, dy * k * r[1] * m, dz * k * r[2] * m);
    if (rot) _vec.applyMatrix4(rot);
    out[0] = c[0] + _vec.x; out[1] = c[1] + _vec.y; out[2] = c[2] + _vec.z;
    if (o.floorY !== undefined && out[1] < o.floorY) out[1] = o.floorY;
  }, o.vMax ?? 1);
  const prim = shape(true);
  if (o.tuft) prim.nrmPos = shape(false).pos;
  return prim;
}

export interface SweepOpts {
  /** Reference vector that defines the first cross-section axis (must not be parallel to the path). */
  up?: V3;
  /** Number of rings used to round each end (0 = flat open end). */
  capStart?: number;
  capEnd?: number;
  /** Cap length as a fraction of the end radius (1 = hemisphere). */
  capStartLen?: number;
  capEndLen?: number;
  /** Radius multiplier per (ring t in [0,1], angle u in [0,1)). */
  mod?: (t: number, u: number) => number;
  /** Fur-tuft radius multiplier (silhouette only; normals come from the untufted tube). */
  tuft?: (t: number, u: number) => number;
}

/**
 * Swept tube along a polyline with elliptical cross-sections [rA, rB] (rA along the `up`-derived
 * axis, rB along the binormal). Ends are closed with rounded caps ending in a single pole vertex.
 */
export function sweep(path: V3[], radii: [number, number][], N: number, o: SweepOpts = {}): Prim {
  if (o.tuft) {
    const prim = sweep(path, radii, N, { ...o, mod: (t, u) => (o.mod ? o.mod(t, u) : 1) * o.tuft!(t, u), tuft: undefined });
    prim.nrmPos = sweep(path, radii, N, { ...o, tuft: undefined }).pos;
    return prim;
  }
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const up = new THREE.Vector3(...(o.up ?? [0, 0, 1]));
  const P = path.map((p) => new THREE.Vector3(...p));
  const n = P.length;
  const T: THREE.Vector3[] = [], A: THREE.Vector3[] = [], B: THREE.Vector3[] = [];
  for (let k = 0; k < n; k++) {
    const t = new THREE.Vector3().subVectors(P[Math.min(n - 1, k + 1)], P[Math.max(0, k - 1)]).normalize();
    const a = up.clone().addScaledVector(t, -up.dot(t));
    if (a.lengthSq() < 1e-8) a.set(1, 0, 0).addScaledVector(t, -t.x);
    a.normalize();
    T.push(t); A.push(a); B.push(new THREE.Vector3().crossVectors(t, a));
  }
  // Ring list: (center, axisA, axisB, rA, rB, t)
  type Ring = { c: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3; ra: number; rb: number; t: number };
  const rings: Ring[] = [];
  const cs = o.capStart ?? 2, ce = o.capEnd ?? 2;
  const csl = o.capStartLen ?? 1, cel = o.capEndLen ?? 1;
  let startPole: THREE.Vector3 | null = null, endPole: THREE.Vector3 | null = null;
  if (cs > 0) {
    const r0 = Math.max(radii[0][0], radii[0][1]);
    for (let j = cs; j >= 1; j--) {
      const ph = (j / (cs + 1)) * (Math.PI / 2);
      rings.push({ c: P[0].clone().addScaledVector(T[0], -Math.sin(ph) * r0 * csl), a: A[0], b: B[0], ra: radii[0][0] * Math.cos(ph), rb: radii[0][1] * Math.cos(ph), t: 0 });
    }
    startPole = P[0].clone().addScaledVector(T[0], -r0 * csl);
  }
  for (let k = 0; k < n; k++) rings.push({ c: P[k], a: A[k], b: B[k], ra: radii[k][0], rb: radii[k][1], t: n > 1 ? k / (n - 1) : 0 });
  if (ce > 0) {
    const rn = Math.max(radii[n - 1][0], radii[n - 1][1]);
    for (let j = 1; j <= ce; j++) {
      const ph = (j / (ce + 1)) * (Math.PI / 2);
      rings.push({ c: P[n - 1].clone().addScaledVector(T[n - 1], Math.sin(ph) * rn * cel), a: A[n - 1], b: B[n - 1], ra: radii[n - 1][0] * Math.cos(ph), rb: radii[n - 1][1] * Math.cos(ph), t: 1 });
    }
    endPole = P[n - 1].clone().addScaledVector(T[n - 1], rn * cel);
  }
  const ringIdx: number[][] = [];
  for (const r of rings) {
    const row: number[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, ang = u * Math.PI * 2;
      const m = o.mod ? o.mod(r.t, u % 1) : 1;
      const ca = Math.cos(ang) * r.ra * m, sb = Math.sin(ang) * r.rb * m;
      pos.push(r.c.x + r.a.x * ca + r.b.x * sb, r.c.y + r.a.y * ca + r.b.y * sb, r.c.z + r.a.z * ca + r.b.z * sb);
      uv.push(u, r.t);
      row.push(pos.length / 3 - 1);
    }
    ringIdx.push(row);
  }
  for (let r = 0; r < ringIdx.length - 1; r++) {
    const a = ringIdx[r], b = ringIdx[r + 1];
    for (let i = 0; i < N; i++) idx.push(a[i], a[i + 1], b[i + 1], a[i], b[i + 1], b[i]);
  }
  if (startPole) {
    pos.push(startPole.x, startPole.y, startPole.z); uv.push(0.5, 0);
    const pi = pos.length / 3 - 1, a = ringIdx[0];
    for (let i = 0; i < N; i++) idx.push(pi, a[i + 1], a[i]);
  }
  if (endPole) {
    pos.push(endPole.x, endPole.y, endPole.z); uv.push(0.5, 1);
    const pi = pos.length / 3 - 1, a = ringIdx[ringIdx.length - 1];
    for (let i = 0; i < N; i++) idx.push(pi, a[i], a[i + 1]);
  }
  return orientOutward({ pos, uv, idx });
}

/** Closed torus-like ring through `loop` points (belt, collar, helmet rim, bandana). */
export function ring(loop: V3[], radius: number | [number, number], N: number, up: V3 = [0, 1, 0]): Prim {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const P = loop.map((p) => new THREE.Vector3(...p));
  const n = P.length;
  const [ra, rb] = typeof radius === 'number' ? [radius, radius] : radius;
  const upV = new THREE.Vector3(...up);
  for (let k = 0; k < n; k++) {
    const t = new THREE.Vector3().subVectors(P[(k + 1) % n], P[(k - 1 + n) % n]).normalize();
    const a = upV.clone().addScaledVector(t, -upV.dot(t)).normalize();
    const b = new THREE.Vector3().crossVectors(t, a);
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const ca = Math.cos(ang) * ra, sb = Math.sin(ang) * rb;
      pos.push(P[k].x + a.x * ca + b.x * sb, P[k].y + a.y * ca + b.y * sb, P[k].z + a.z * ca + b.z * sb);
      uv.push(i / N, k / n);
    }
  }
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N;
      const a = k * N + i, b = k * N + i2, c = k2 * N + i2, d = k2 * N + i;
      idx.push(a, b, c, a, c, d);
    }
  }
  return orientOutward({ pos, uv, idx });
}

/** Signed volume of a closed triangle mesh (positive when faces point outward). */
export function signedVolume(p: Prim): number {
  let v = 0;
  const P = p.pos;
  for (let i = 0; i < p.idx.length; i += 3) {
    const a = 3 * p.idx[i], b = 3 * p.idx[i + 1], c = 3 * p.idx[i + 2];
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}

/** Flip winding of a closed primitive if it faces inward. */
export function orientOutward(p: Prim): Prim {
  if (signedVolume(p) < 0) for (let i = 0; i < p.idx.length; i += 3) { const t = p.idx[i + 1]; p.idx[i + 1] = p.idx[i + 2]; p.idx[i + 2] = t; }
  return p;
}

/** Ellipse loop helper (in a plane given by center + two axes). */
export function ellipseLoop(c: V3, ax: V3, bx: V3, n: number, f?: (t: number) => number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / n, a = t * Math.PI * 2, m = f ? f(t) : 1;
    out.push([c[0] + (ax[0] * Math.cos(a) + bx[0] * Math.sin(a)) * m, c[1] + (ax[1] * Math.cos(a) + bx[1] * Math.sin(a)) * m, c[2] + (ax[2] * Math.cos(a) + bx[2] * Math.sin(a)) * m]);
  }
  return out;
}

/** Transform a primitive in place (rotation YXZ then translation). */
export function xform(p: Prim, t: V3, rot: V3 = [0, 0, 0], s: V3 = [1, 1, 1]): Prim {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...t), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')), new THREE.Vector3(...s));
  const v = new THREE.Vector3();
  for (const arr of p.nrmPos ? [p.pos, p.nrmPos] : [p.pos]) {
    for (let i = 0; i < arr.length; i += 3) {
      v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(m);
      arr[i] = v.x; arr[i + 1] = v.y; arr[i + 2] = v.z;
    }
  }
  return p;
}

/** Mirror a primitive across x = 0 (flips winding). */
export function mirrorX(p: Prim): Prim {
  const flip = (a: number[]) => { const o = a.slice(); for (let i = 0; i < o.length; i += 3) o[i] = -o[i]; return o; };
  const idx: number[] = [];
  for (let i = 0; i < p.idx.length; i += 3) idx.push(p.idx[i], p.idx[i + 2], p.idx[i + 1]);
  return { pos: flip(p.pos), uv: p.uv.slice(), idx, nrmPos: p.nrmPos ? flip(p.nrmPos) : undefined };
}

/**
 * Surface of revolution around the +Z axis (then placed with `xform`): `profile` is a closed loop of
 * (radius, z) points, revolved in N steps. Makes thin-walled shells (cone collars, brims) that stay
 * closed, so the ink hull and back-face culling work from inside and outside.
 */
export function lathe(profile: [number, number][], N: number, rx = 1, ry = 1): Prim {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = profile.length;
  for (let k = 0; k < n; k++) {
    const [r, z] = profile[k];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      pos.push(Math.sin(a) * r * rx, Math.cos(a) * r * ry, z);
      uv.push(i / N, k / n);
    }
  }
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N;
      idx.push(k * N + i, k * N + i2, k2 * N + i2, k * N + i, k2 * N + i2, k2 * N + i);
    }
  }
  return orientOutward({ pos, uv, idx });
}

// ---------------------------------------------------------------------------------------------
// Merge + skinning

const colorCache = new Map<number, THREE.Color>();
export function linear(hex: number): THREE.Color {
  let c = colorCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c); }
  return c;
}

export interface AddOpts {
  /**
   * Shade this primitive partly as if it were a smooth proxy ellipsoid (center c, radii r, weight w):
   * cheeks and pads blend into the cranium's toon bands instead of showing a faceted seam where the
   * blobs intersect. Positions (and so the silhouette and ink) are unchanged.
   */
  proxy?: { c: V3; r: V3; w: number };
}

/** Accumulates primitives into one geometry with colors (and skin attributes when a rig is given). */
export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private si: number[] = [];
  private sw: number[] = [];
  private sf: number[] = [];
  private idx: number[] = [];
  private curSurf: Surf = SURF.default;
  private anySurf = false;
  triangles = 0;
  /** Triangles per named section (budget accounting). */
  readonly sections = new Map<string, number>();
  private section = 'misc';

  constructor(private readonly rig: RigTemplate | null = null) {}

  /** Name the section subsequent primitives are counted under. */
  begin(name: string): this { this.section = name; return this; }

  /** Style surface for subsequent primitives; once used, build() adds the `surface` attribute (see Surf). */
  surface(s: Surf): this { this.curSurf = s; this.anySurf = true; return this; }

  add(p: Prim, color: number | ColorFn, skin?: SkinSpec, opts: AddOpts = {}): this {
    // Outline-safe normals per primitive (welds seams/poles, averages by position).
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p.nrmPos ?? p.pos, 3));
    g.setIndex(p.idx);
    smoothNormalsByPosition(THREE, g);
    const nAttr = g.getAttribute('normal');
    const base = this.pos.length / 3;
    const vc = p.pos.length / 3;
    const px = opts.proxy;
    for (let i = 0; i < vc; i++) {
      const x = p.pos[3 * i], y = p.pos[3 * i + 1], z = p.pos[3 * i + 2];
      this.pos.push(x, y, z);
      let nx = nAttr.getX(i), ny = nAttr.getY(i), nz = nAttr.getZ(i);
      if (px) {
        // Normal transfer: lean toward the proxy ellipsoid's normal at this point (smooth field).
        const qx = (x - px.c[0]) / (px.r[0] * px.r[0]), qy = (y - px.c[1]) / (px.r[1] * px.r[1]), qz = (z - px.c[2]) / (px.r[2] * px.r[2]);
        const ql = Math.hypot(qx, qy, qz) || 1;
        nx += (qx / ql - nx) * px.w; ny += (qy / ql - ny) * px.w; nz += (qz / ql - nz) * px.w;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
      }
      this.nrm.push(nx, ny, nz);
      const hex = typeof color === 'number' ? color : color(x, y, z, p.uv[2 * i], p.uv[2 * i + 1]);
      const c = linear(hex);
      this.col.push(c.r, c.g, c.b);
      this.sf.push(this.curSurf[0], this.curSurf[1], this.curSurf[2], this.curSurf[3]);
      if (this.rig) this.pushSkin(x, y, z, skin, p.uv[2 * i], p.uv[2 * i + 1]);
    }
    g.dispose();
    for (const i of p.idx) this.idx.push(base + i);
    this.triangles += p.idx.length / 3;
    this.sections.set(this.section, (this.sections.get(this.section) ?? 0) + p.idx.length / 3);
    return this;
  }

  private boneIdx(name: string): number {
    const i = this.rig!.index[name];
    if (i === undefined) throw new Error(`unknown bone ${name}`);
    return i;
  }

  private pushSkin(x: number, y: number, z: number, skin: SkinSpec | undefined, u: number, v: number): void {
    const s = skin ?? { rigid: 'root' };
    if ('rigid' in s) { this.si.push(this.boneIdx(s.rigid), 0, 0, 0); this.sw.push(1, 0, 0, 0); return; }
    let cand: [number, number][];
    if ('blend' in s) cand = s.blend.map(([n, w]) => [this.boneIdx(n), w]);
    else if ('fn' in s) cand = s.fn(x, y, z, u, v).filter(([, w]) => w > 0).map(([n, w]) => [this.boneIdx(n), w]);
    else {
      const pw = s.power ?? 4;
      const t = this.rig!;
      cand = s.auto.map((n) => {
        const b = this.boneIdx(n);
        const d = segDist(x, y, z, t.modelRest[3 * b], t.modelRest[3 * b + 1], t.modelRest[3 * b + 2], t.tail[3 * b], t.tail[3 * b + 1], t.tail[3 * b + 2]);
        return [b, 1 / (Math.pow(d + 1e-3, pw))];
      });
    }
    cand.sort((a, b) => b[1] - a[1]);
    const top = cand.slice(0, 4);
    let sum = top.reduce((a, c) => a + c[1], 0);
    // Prune tiny influences, renormalize.
    const kept = top.filter((c) => c[1] / sum >= 0.03);
    sum = kept.reduce((a, c) => a + c[1], 0);
    for (let k = 0; k < 4; k++) {
      this.si.push(kept[k] ? kept[k][0] : 0);
      this.sw.push(kept[k] ? kept[k][1] / sum : 0);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.anySurf) g.setAttribute('surface', new THREE.Float32BufferAttribute(this.sf, 4));
    if (this.rig) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    }
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.userData.outlineReady = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

function segDist(x: number, y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const vx = bx - ax, vy = by - ay, vz = bz - az;
  const wx = x - ax, wy = y - ay, wz = z - az;
  const l2 = vx * vx + vy * vy + vz * vz;
  let t = l2 > 1e-12 ? (wx * vx + wy * vy + wz * vz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = wx - vx * t, dy = wy - vy * t, dz = wz - vz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Segment count scaled by detail with a floor (floors relax by 20% on the lite/NPC tier). */
export const seg = (base: number, q: number, min = 4) => Math.max(q < LITE_Q ? Math.max(3, Math.round(min * 0.8)) : min, Math.round(base * q));
/** Detail below this is the lite (NPC) tier: tiny parts that vanish at distance are skipped. */
export const LITE_Q = 0.8;
export const isLite = (q: number) => q < LITE_Q;

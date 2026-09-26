// VisualPrims (pure data from src/shared/world) -> a few merged, styled meshes.
// All prims of one render group inside one spatial cell share ONE geometry with vertex colors and
// ONE toon material, so ~1200 prims cost a handful of draw calls:
//   solid: ink hull + crease ink (LineSegments2 via addCreaseInk)   soft: ink hull only
//   noink: toon-lit, no ink (glass, decals, tiny details)
// E4: every vertex also carries its prim's weathering (rough, metal, grime, wear) from the palette key
// (world-palette worldSurface) as a `surface` attribute, read by the hardened style material (surfaceAttr), so
// one merged mesh holds sacks (cloth), crates (wood), poles (metal) and paint with their own wear.
// W7 P3: a cell's crease ink is split into tiles (a third of the cell) that carry `userData.drawDistance`
// (CREASE_DRAW_DISTANCE): the scene pass (engine/renderer.ts ink LOD) draws only the tiles near the camera. Crease lines
// are 1.1 px at every distance (6 triangles per segment), so a whole yard of them was ~160 k triangles a frame; far
// props keep their fills and hulls, like the far scenery that never had creases.
import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PrimGroup, VisualPrim } from '../../shared/world/world-data';
import { hash2 } from '../../shared/world/noise';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { PALETTE, STYLE } from '../style/style-tokens.js';
import { smoothNormalsByPosition } from '../style/style-utils.js';
import { toonFrom, toonNoInk } from './materials';
import { worldColor, worldSurface } from './world-palette';

const edgeCache = new WeakMap<THREE.BufferGeometry, Float32Array>();
/** Crease edges (style crease angle) of one source geometry, computed once per unique geometry. */
export function creaseEdges(g: THREE.BufferGeometry): Float32Array {
  let e = edgeCache.get(g);
  if (!e) {
    const eg = new THREE.EdgesGeometry(g, STYLE.crease.angleDeg);
    e = eg.getAttribute('position').array as Float32Array;
    eg.dispose();
    edgeCache.set(g, e);
  }
  return e;
}

export class Builder {
  pos: number[] = []; nor: number[] = []; col: number[] = []; idx: number[] = []; lines: number[] = [];
  /** E4: per-vertex weathering (rough, metal, grime, wear), only when add() is given one. */
  sur: number[] = [];
  addLines(e: Float32Array, m: THREE.Matrix4): void {
    const v = new THREE.Vector3();
    for (let i = 0; i < e.length; i += 3) { v.set(e[i], e[i + 1], e[i + 2]).applyMatrix4(m); this.lines.push(v.x, v.y, v.z); }
  }
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color, surf?: readonly number[]): void {
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    const base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      w.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z); this.nor.push(w.x, w.y, w.z); this.col.push(color.r, color.g, color.b);
      if (surf) this.sur.push(surf[0], surf[1], surf[2], surf[3]);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.sur.length && this.sur.length === (this.pos.length / 3) * 4) g.setAttribute('surface', new THREE.Float32BufferAttribute(this.sur, 4));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.userData.outlineReady = true;
    return g;
  }
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function strip(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  return g;
}

/** Unit-ish source geometry for a prim (cached by shape+dims). Ink groups get outline-safe normals. */
export function primGeometry(p: VisualPrim, inked: boolean): THREE.BufferGeometry {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const key = `${p.s}|${r3(p.a)}|${r3(p.b)}|${r3(p.c)}|${r3(p.bev ?? 0)}|${p.seg ?? ''}|${inked}|${p.g === 'soft' && p.s === 'sphere' ? 'blob' : ''}`;
  let g = geoCache.get(key);
  if (g) return g;
  switch (p.s) {
    case 'box': {
      const bev = p.bev ?? 0.1;
      if (p.seg === 1 && bev > 0.025 && Math.min(p.a, p.b, p.c) > 0.12) {
        // E4: `seg: 1` on a box = a single-chamfer bevel (44 tris instead of 92): kibble sacks, cheap soft shapes
        g = chamferBoxGeometry(p.a, p.b, p.c, Math.min(bev, p.a / 2 - 0.001, p.b / 2 - 0.001, p.c / 2 - 0.001));
      } else if (bev > 0.025 && Math.min(p.a, p.b, p.c) > 0.12) {
        g = bevelBoxGeometry(p.a, p.b, p.c, Math.min(bev, p.a / 2 - 0.001, p.b / 2 - 0.001, p.c / 2 - 0.001));
      } else {
        g = strip(new THREE.BoxGeometry(p.a, p.b, p.c));
        if (inked) smoothNormalsByPosition(THREE, g);
      }
      break;
    }
    case 'cyl':
      g = strip(new THREE.CylinderGeometry(p.a, p.c, p.b, p.seg ?? 14, 1));
      if (inked) smoothNormalsByPosition(THREE, g);
      break;
    case 'cone':
      g = strip(new THREE.ConeGeometry(p.a, p.b, p.seg ?? 12, 1));
      if (inked) smoothNormalsByPosition(THREE, g);
      break;
    case 'sphere': {
      const seg = p.seg ?? 12;
      g = strip(new THREE.SphereGeometry(1, seg, Math.max(5, Math.round(seg * 0.65))));
      if (p.g === 'soft' && Math.max(p.a, p.b, p.c) > 1.2) blobify(g, p);
      g.scale(p.a, p.b, p.c);
      g.computeVertexNormals();
      smoothNormalsByPosition(THREE, g);
      break;
    }
    case 'torus':
      g = strip(new THREE.TorusGeometry(p.a, p.b, Math.max(6, Math.round((p.seg ?? 16) / 2)), p.seg ?? 16, p.c > 0 ? p.c : Math.PI * 2));
      break;
    case 'ring': {
      const ro = p.a, ri = p.a - p.c, h = p.b / 2, e = Math.min(0.12, p.c * 0.3);
      const prof = [new THREE.Vector2(ri, -h), new THREE.Vector2(ro - e, -h), new THREE.Vector2(ro, -h + e), new THREE.Vector2(ro, h - e),
        new THREE.Vector2(ro - e, h), new THREE.Vector2(ri + e, h), new THREE.Vector2(ri, h - e), new THREE.Vector2(ri, -h)];
      g = strip(new THREE.LatheGeometry(prof, p.seg ?? 32));
      g.computeVertexNormals();
      smoothNormalsByPosition(THREE, g);
      break;
    }
    default:
      g = new THREE.BoxGeometry(1, 1, 1);
  }
  if (!g.getIndex()) g = mergeVertices(g);
  geoCache.set(key, g);
  return g;
}

/**
 * Box with rounded (2-segment) edges and corners, 92 triangles: flat faces keep flat normals, the
 * bevels carry smooth normals (watertight ink hull), and the 45-degree break in the middle of every
 * bevel is exactly one crease-ink line at the style's 35-degree threshold. (RoundedBoxGeometry with
 * the same look costs 300 triangles.)
 */
export function bevelBoxGeometry(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const map = new Map<string, number>();
  const S = Math.SQRT1_2;
  /** vertex for direction n on the corner (sx,sy,sz) of the inner box */
  const vtx = (sx: number, sy: number, sz: number, nx: number, ny: number, nz: number): number => {
    const k = `${sx},${sy},${sz},${nx.toFixed(3)},${ny.toFixed(3)},${nz.toFixed(3)}`;
    let i = map.get(k);
    if (i === undefined) {
      i = pos.length / 3; map.set(k, i);
      pos.push(sx * ix + nx * r, sy * iy + ny * r, sz * iz + nz * r); nor.push(nx, ny, nz);
    }
    return i;
  };
  const tri = (a: number, b: number, c: number) => {
    // orient outward: compare geometric normal with the averaged vertex normal
    const P = (i: number) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const [A, B, C] = [P(a), P(b), P(c)];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const nx = nor[a * 3] + nor[b * 3] + nor[c * 3], ny = nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1], nz = nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2];
    if (gx * nx + gy * ny + gz * nz >= 0) idx.push(a, b, c); else idx.push(a, c, b);
  };
  const quad = (a: number, b: number, c: number, e: number) => { tri(a, b, c); tri(a, c, e); };
  const sg = [-1, 1];
  // corners: octant patches (4 tris each)
  for (const sx of sg) for (const sy of sg) for (const sz of sg) {
    const ax = vtx(sx, sy, sz, sx, 0, 0), ay = vtx(sx, sy, sz, 0, sy, 0), az = vtx(sx, sy, sz, 0, 0, sz);
    const mxy = vtx(sx, sy, sz, sx * S, sy * S, 0), myz = vtx(sx, sy, sz, 0, sy * S, sz * S), mxz = vtx(sx, sy, sz, sx * S, 0, sz * S);
    tri(ax, mxy, mxz); tri(mxy, ay, myz); tri(mxz, myz, az); tri(mxy, myz, mxz);
  }
  // edges: 2 quads each (12 edges)
  for (const a of sg) for (const b of sg) {
    // along x (y=a, z=b)
    const x0 = [vtx(-1, a, b, 0, a, 0), vtx(-1, a, b, 0, a * S, b * S), vtx(-1, a, b, 0, 0, b)];
    const x1 = [vtx(1, a, b, 0, a, 0), vtx(1, a, b, 0, a * S, b * S), vtx(1, a, b, 0, 0, b)];
    quad(x0[0], x1[0], x1[1], x0[1]); quad(x0[1], x1[1], x1[2], x0[2]);
    // along y (x=a, z=b)
    const y0 = [vtx(a, -1, b, a, 0, 0), vtx(a, -1, b, a * S, 0, b * S), vtx(a, -1, b, 0, 0, b)];
    const y1 = [vtx(a, 1, b, a, 0, 0), vtx(a, 1, b, a * S, 0, b * S), vtx(a, 1, b, 0, 0, b)];
    quad(y0[0], y1[0], y1[1], y0[1]); quad(y0[1], y1[1], y1[2], y0[2]);
    // along z (x=a, y=b)
    const z0 = [vtx(a, b, -1, a, 0, 0), vtx(a, b, -1, a * S, b * S, 0), vtx(a, b, -1, 0, b, 0)];
    const z1 = [vtx(a, b, 1, a, 0, 0), vtx(a, b, 1, a * S, b * S, 0), vtx(a, b, 1, 0, b, 0)];
    quad(z0[0], z1[0], z1[1], z0[1]); quad(z0[1], z1[1], z1[2], z0[2]);
  }
  // faces: 1 quad each
  for (const s of sg) {
    quad(vtx(s, -1, -1, s, 0, 0), vtx(s, 1, -1, s, 0, 0), vtx(s, 1, 1, s, 0, 0), vtx(s, -1, 1, s, 0, 0));
    quad(vtx(-1, s, -1, 0, s, 0), vtx(1, s, -1, 0, s, 0), vtx(1, s, 1, 0, s, 0), vtx(-1, s, 1, 0, s, 0));
    quad(vtx(-1, -1, s, 0, 0, s), vtx(1, -1, s, 0, 0, s), vtx(1, 1, s, 0, 0, s), vtx(-1, 1, s, 0, 0, s));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * E4: box with single-segment chamfered edges, 44 triangles: flat faces with face normals, one quad per edge whose
 * normals blend the two faces (reads rounded under toon shading), one triangle per corner. Watertight (ink hull safe).
 */
export function chamferBoxGeometry(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const map = new Map<string, number>();
  const vtx = (sx: number, sy: number, sz: number, nx: number, ny: number, nz: number): number => {
    const k = `${sx},${sy},${sz},${nx},${ny},${nz}`;
    let i = map.get(k);
    if (i === undefined) {
      i = pos.length / 3; map.set(k, i);
      pos.push(sx * ix + nx * r, sy * iy + ny * r, sz * iz + nz * r); nor.push(nx, ny, nz);
    }
    return i;
  };
  const tri = (a: number, b: number, c: number) => {
    const P = (i: number) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const [A, B, C] = [P(a), P(b), P(c)];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const nx = nor[a * 3] + nor[b * 3] + nor[c * 3], ny = nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1], nz = nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2];
    if (gx * nx + gy * ny + gz * nz >= 0) idx.push(a, b, c); else idx.push(a, c, b);
  };
  const quad = (a: number, b: number, c: number, e: number) => { tri(a, b, c); tri(a, c, e); };
  const sg = [-1, 1];
  for (const sx of sg) for (const sy of sg) for (const sz of sg) tri(vtx(sx, sy, sz, sx, 0, 0), vtx(sx, sy, sz, 0, sy, 0), vtx(sx, sy, sz, 0, 0, sz));
  for (const a of sg) for (const b of sg) {
    quad(vtx(-1, a, b, 0, a, 0), vtx(1, a, b, 0, a, 0), vtx(1, a, b, 0, 0, b), vtx(-1, a, b, 0, 0, b));   // along x
    quad(vtx(a, -1, b, a, 0, 0), vtx(a, 1, b, a, 0, 0), vtx(a, 1, b, 0, 0, b), vtx(a, -1, b, 0, 0, b));   // along y
    quad(vtx(a, b, -1, a, 0, 0), vtx(a, b, 1, a, 0, 0), vtx(a, b, 1, 0, b, 0), vtx(a, b, -1, 0, b, 0));   // along z
  }
  for (const s of sg) {
    quad(vtx(s, -1, -1, s, 0, 0), vtx(s, 1, -1, s, 0, 0), vtx(s, 1, 1, s, 0, 0), vtx(s, -1, 1, s, 0, 0));
    quad(vtx(-1, s, -1, 0, s, 0), vtx(1, s, -1, 0, s, 0), vtx(1, s, 1, 0, s, 0), vtx(-1, s, 1, 0, s, 0));
    quad(vtx(-1, -1, s, 0, 0, s), vtx(1, -1, s, 0, 0, s), vtx(1, 1, s, 0, 0, s), vtx(-1, 1, s, 0, 0, s));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Organic lumpy blob: deterministic displacement from position (seams stay closed). */
function blobify(g: THREE.BufferGeometry, p: VisualPrim): void {
  const pos = g.getAttribute('position');
  const seed = Math.round((p.x * 13.1 + p.z * 7.7 + p.y) * 10);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + 0.09 * (hash2(Math.round(x * 3), Math.round(z * 3) + Math.round(y * 3) * 7, seed) - 0.5) * 2
      + 0.05 * Math.sin(x * 4.1 + z * 2.3 + seed) * Math.cos(y * 3.3);
    pos.setXYZ(i, x * k, y * k * (y < -0.4 ? 0.85 : 1), z * k);
  }
}

let inkMat: THREE.Line2NodeMaterial | null = null;
export function inkMaterial(): THREE.Line2NodeMaterial {
  inkMat ??= new THREE.Line2NodeMaterial({ color: PALETTE.ink, linewidth: STYLE.crease.widthPx, worldUnits: false });
  return inkMat;
}

/** Crease-ink tiles are drawn only within this distance (m, camera to the tile's bounds). */
export const CREASE_DRAW_DISTANCE = 40;

/**
 * Splits crease segments (flat xyz pairs, as Builder.lines) into square tiles of `tile` m by segment midpoint (XZ).
 * Returns the tiles' segment arrays keyed "ix,iz" (tile indices), in first-seen order.
 */
export function creaseTiles(lines: readonly number[], tile: number): Map<string, Float32Array> {
  const lists = new Map<string, number[]>();
  for (let i = 0; i + 5 < lines.length; i += 6) {
    const k = `${Math.floor((lines[i] + lines[i + 3]) / 2 / tile)},${Math.floor((lines[i + 2] + lines[i + 5]) / 2 / tile)}`;
    let l = lists.get(k);
    if (!l) { l = []; lists.set(k, l); }
    for (let j = 0; j < 6; j++) l.push(lines[i + j]);
  }
  const out = new Map<string, Float32Array>();
  for (const [k, l] of lists) out.set(k, new Float32Array(l));
  return out;
}

export interface PrimMeshes {
  group: THREE.Group;
  /** Solid meshes (for shadows/debug); crease lines are children flagged styleInk. */
  meshes: THREE.Mesh[];
  stats: { prims: number; triangles: number; meshes: number };
}

export function buildPrimMeshes(prims: readonly VisualPrim[], opts: { cell?: number; creases?: boolean; /** W8: beyond this |x| or |z| a prim is far scenery (no shadow, no crease ink); default 125 = the West Yard. */ far?: number } = {}): PrimMeshes {
  const cell = opts.cell ?? 100;
  const buckets = new Map<string, Builder>();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const color = new THREE.Color();
  prims.forEach((p, i) => {
    const group: PrimGroup = p.g ?? 'solid';
    const inked = group !== 'noink';
    const g = primGeometry(p, inked);
    e.set(p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0, 'YXZ');
    q.setFromEuler(e);
    m.compose(pos.set(p.x, p.y, p.z), q, one);
    // cell: yard quadrants; far scenery in its own cell
    const far = Math.max(Math.abs(p.x), Math.abs(p.z)) > (opts.far ?? 125);
    const ck = far ? 'far' : `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    const key = `${ck}|${group}`;
    let b = buckets.get(key);
    if (!b) { b = new Builder(); buckets.set(key, b); }
    // gentle deterministic brightness jitter so repeated parts (boards, bricks) don't look cloned
    const jit = 1 + (hash2(i, 17, 99) - 0.5) * 0.08;
    color.copy(worldColor(p.col)).multiplyScalar(jit);
    b.add(g, m, color, worldSurface(p.col));
    if (group === 'solid' && !far && opts.creases !== false) b.addLines(creaseEdges(g), m);
  });
  const group = new THREE.Group();
  group.name = 'world_props';
  const mats = {
    solid: toonFrom({ vertexColors: true, surfaceAttr: true }),
    soft: toonFrom({ vertexColors: true, surfaceAttr: true }),
    noink: toonNoInk({ vertexColors: true, surfaceAttr: true }),
  };
  const meshes: THREE.Mesh[] = [];
  let triangles = 0;
  for (const [key, b] of buckets) {
    const g = b.build();
    if (!g) continue;
    const kind = key.split('|')[1] as PrimGroup;
    const mesh = new THREE.Mesh(g, mats[kind]);
    mesh.name = `props_${key}`;
    const far = key.startsWith('far');
    mesh.castShadow = !far;
    mesh.receiveShadow = true;
    mesh.userData.noCameraCollide = true;          // camera uses collider proxies instead (cheap raycasts)
    // crease ink (same look as style addCreaseInk) in distance-culled tiles, a third of a cell each, so tiles never
    // straddle cells
    for (const [tk, seg] of creaseTiles(b.lines, cell / 3)) {
      const lg = new LineSegmentsGeometry();
      lg.setPositions(seg);
      const lines = new LineSegments2(lg, inkMaterial());
      lines.name = `${mesh.name}_crease_${tk}`;
      lines.userData.styleInk = true;
      lines.userData.drawDistance = CREASE_DRAW_DISTANCE;
      mesh.add(lines);
    }
    group.add(mesh);
    meshes.push(mesh);
    triangles += (g.getIndex()?.count ?? 0) / 3;
  }
  return { group, meshes, stats: { prims: prims.length, triangles, meshes: meshes.length } };
}

export function disposePrimMeshes(pm: PrimMeshes): void {
  pm.group.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (g) g.dispose();
  });
  const mats = new Set<THREE.Material>();
  for (const mesh of pm.meshes) mats.add(mesh.material as THREE.Material);
  for (const mat of mats) mat.dispose();
}

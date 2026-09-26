// Silhouette masks for class-readability checks (K1): a posed character's CPU-skinned triangles are
// rasterized into coarse occupancy grids seen from the front (x, y) and the side (z, y). One cell is
// 6 cm, about one pixel at 35 m with the 62° hip-fire camera at 720p, so two classes whose masks
// barely differ cannot be told apart at range from shape alone. Used by tests/unit and
// tools/char-silhouette.mjs; not imported by the game.
import * as THREE from 'three/webgpu';

export const SIL_CELL = 0.06;
const W = 34, H = 34; // 2.04 m × 2.04 m, feet on row 0, x centred
const HALF = (W * SIL_CELL) / 2;

export interface SilhouetteMasks {
  front: Uint8Array;
  side: Uint8Array;
  /** Occupied cells (front + side). */
  area: number;
}

const _v = new THREE.Vector3();

/** Rasterize everything visible under `root` (skinned + rigid meshes, not ink lines). */
export function silhouetteMasks(root: THREE.Object3D): SilhouetteMasks {
  root.updateMatrixWorld(true);
  const front = new Uint8Array(W * H), side = new Uint8Array(W * H);
  const pts: number[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh & { isLineSegments2?: boolean };
    if (!m.isMesh || m.isLineSegments2 || o.userData.styleInk) return;
    const g = m.geometry, pos = g.getAttribute('position'), idx = g.index;
    const skinned = (o as THREE.SkinnedMesh).isSkinnedMesh ? (o as THREE.SkinnedMesh) : null;
    const world: number[] = new Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      if (skinned) skinned.applyBoneTransform(i, _v);
      _v.applyMatrix4(o.matrixWorld);
      world[3 * i] = _v.x; world[3 * i + 1] = _v.y; world[3 * i + 2] = _v.z;
    }
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      for (let k = 0; k < 3; k++) { const vi = idx ? idx.getX(t + k) : t + k; pts.push(world[3 * vi], world[3 * vi + 1], world[3 * vi + 2]); }
    }
  });
  for (let i = 0; i < pts.length; i += 9) {
    tri(front, pts[i], pts[i + 1], pts[i + 3], pts[i + 4], pts[i + 6], pts[i + 7]);
    tri(side, pts[i + 2], pts[i + 1], pts[i + 5], pts[i + 4], pts[i + 8], pts[i + 7]);
  }
  // The ink hull adds ~1.3 px around every silhouette at any distance: model it as a 1-cell dilation,
  // which is what makes thin parts (masts, wings, tails) readable in practice.
  dilate(front); dilate(side);
  let area = 0;
  for (let i = 0; i < W * H; i++) area += front[i] + side[i];
  return { front, side, area };
}

function dilate(g: Uint8Array): void {
  const src = g.slice();
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (src[j * W + i]) continue;
    if ((i > 0 && src[j * W + i - 1]) || (i < W - 1 && src[j * W + i + 1]) || (j > 0 && src[(j - 1) * W + i]) || (j < H - 1 && src[(j + 1) * W + i])) g[j * W + i] = 1;
  }
}

/** Conservative fill: cell centres inside the triangle plus cells touched by its edges (thin masts count). */
function tri(g: Uint8Array, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void {
  const X = (x: number) => (x + HALF) / SIL_CELL, Y = (y: number) => y / SIL_CELL;
  ax = X(ax); bx = X(bx); cx = X(cx); ay = Y(ay); by = Y(by); cy = Y(cy);
  const mark = (x: number, y: number) => { const i = Math.floor(x), j = Math.floor(y); if (i >= 0 && i < W && j >= 0 && j < H) g[j * W + i] = 1; };
  for (const [x0, y0, x1, y1] of [[ax, ay, bx, by], [bx, by, cx, cy], [cx, cy, ax, ay]]) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= steps; s++) mark(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
  }
  const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(d) < 1e-9) return;
  const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), i1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
  const j0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), j1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const px = i + 0.5, py = j + 0.5;
    const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / d;
    const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / d;
    if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) g[j * W + i] = 1;
  }
}

/** Jaccard distance over front + side masks: 0 = identical silhouettes, 1 = disjoint. */
export function silhouetteDistance(a: SilhouetteMasks, b: SilhouetteMasks): number {
  let x = 0, u = 0;
  for (const [p, q] of [[a.front, b.front], [a.side, b.side]] as const) {
    for (let i = 0; i < p.length; i++) { x += p[i] ^ q[i]; u += p[i] | q[i]; }
  }
  return u ? x / u : 0;
}

/** ASCII art of a mask (debugging / tool output). */
export function maskToText(m: Uint8Array): string {
  const rows: string[] = [];
  for (let j = H - 1; j >= 0; j--) { let r = ''; for (let i = 0; i < W; i++) r += m[j * W + i] ? '#' : '.'; rows.push(r); }
  return rows.join('\n');
}

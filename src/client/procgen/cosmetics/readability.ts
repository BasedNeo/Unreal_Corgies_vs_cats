// OWNER: C3 cosmetics lane. Team-colour readability check for looks (tests + lab; not imported by the game).
// A posed character's CPU-skinned, vertex-coloured triangles are rasterized with a depth test into coarse colour
// grids seen from the front and from behind (3 cm cells). The team signal is the share of visible cells in the
// team's vest hue (royal blue / crimson): a look passes when it keeps that share and adds no enemy-hue cells.
// Same projection conventions as the K1 silhouette masks (characters/silhouette.ts): feet on row 0, x centred.
import * as THREE from 'three/webgpu';
import { Team, type TeamId } from '../../../shared/types';
import { teamColors } from '../characters/gear';

export const READ_CELL = 0.03;
const W = 68, H = 68; // 2.04 m × 2.04 m
const HALF = (W * READ_CELL) / 2;

export interface ColorViews {
  /** sRGB hex per cell, -1 = empty (front: seen from -Z; back: seen from +Z). */
  front: Int32Array;
  back: Int32Array;
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();

/** Rasterize every vertex-coloured mesh under `root` (skinned or rigid; glow and ink are skipped). */
export function colorViews(root: THREE.Object3D): ColorViews {
  root.updateMatrixWorld(true);
  const front = new Int32Array(W * H).fill(-1), back = new Int32Array(W * H).fill(-1);
  const zf = new Float32Array(W * H).fill(Infinity), zb = new Float32Array(W * H).fill(-Infinity);
  root.traverse((o) => {
    const m = o as THREE.Mesh & { isLineSegments2?: boolean };
    if (!m.isMesh || m.isLineSegments2 || o.userData.styleInk) return;
    const g = m.geometry, pos = g.getAttribute('position'), col = g.getAttribute('color'), idx = g.index;
    if (!col) return;
    const skinned = (o as THREE.SkinnedMesh).isSkinnedMesh ? (o as THREE.SkinnedMesh) : null;
    const world = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      if (skinned) skinned.applyBoneTransform(i, _v);
      _v.applyMatrix4(o.matrixWorld);
      world[3 * i] = _v.x; world[3 * i + 1] = _v.y; world[3 * i + 2] = _v.z;
    }
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      _c.setRGB((col.getX(a) + col.getX(b) + col.getX(c)) / 3, (col.getY(a) + col.getY(b) + col.getY(c)) / 3, (col.getZ(a) + col.getZ(b) + col.getZ(c)) / 3);
      const hex = _c.getHex(); // linear working space → sRGB
      tri(world, a, b, c, hex, front, zf, 1);
      tri(world, a, b, c, hex, back, zb, -1);
    }
  });
  return { front, back };
}

/** Depth-tested fill of cell centres. dir 1: front view (keep smallest z, x mirrored like a camera at -Z). */
function tri(p: Float32Array, a: number, b: number, c: number, hex: number, grid: Int32Array, depth: Float32Array, dir: 1 | -1): void {
  const X = (x: number) => (dir * -x + HALF) / READ_CELL, Y = (y: number) => y / READ_CELL;
  const ax = X(p[3 * a]), ay = Y(p[3 * a + 1]), az = p[3 * a + 2];
  const bx = X(p[3 * b]), by = Y(p[3 * b + 1]), bz = p[3 * b + 2];
  const cx = X(p[3 * c]), cy = Y(p[3 * c + 1]), cz = p[3 * c + 2];
  const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(d) < 1e-9) return;
  const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), i1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
  const j0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), j1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const px = i + 0.5, py = j + 0.5;
    const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / d;
    const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / d;
    const w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const z = w0 * az + w1 * bz + w2 * cz, k = j * W + i;
    if (dir === 1 ? z < depth[k] : z > depth[k]) { depth[k] = z; grid[k] = hex; }
  }
}

const hsl = { h: 0, s: 0, l: 0 };
/** Hue (degrees), saturation, lightness of an sRGB hex, computed on the sRGB values (what the eye sees). */
export function hslOf(hex: number): { h: number; s: number; l: number } {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  hsl.h = h; hsl.l = l; hsl.s = d < 1e-6 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return hsl;
}

/** Does this colour read as the team's vest colour (its hue family, saturated, not near black or white)? */
export function readsAsTeam(hex: number, team: TeamId): boolean {
  if (team !== Team.Corgis && team !== Team.Cats) return false;
  const ref = hslOf(teamColors(team).main).h;
  const c = hslOf(hex);
  const dh = Math.abs(((c.h - ref + 540) % 360) - 180);
  return dh <= 22 && c.s >= 0.45 && c.l >= 0.18 && c.l <= 0.78;
}

export interface TeamRead {
  /** Visible cells (front + back). */
  cells: number;
  /** Share of visible cells in the wearer's team hue. */
  team: number;
  /** Share of visible cells in the other team's hue. */
  enemy: number;
}

/** Team-colour read of a character (front + back views). */
export function teamRead(root: THREE.Object3D, team: TeamId): TeamRead {
  const v = colorViews(root);
  const other = team === Team.Cats ? Team.Corgis : Team.Cats;
  let cells = 0, own = 0, enemy = 0;
  for (const g of [v.front, v.back]) for (let i = 0; i < g.length; i++) {
    if (g[i] < 0) continue;
    cells++;
    if (readsAsTeam(g[i], team)) own++;
    else if (readsAsTeam(g[i], other)) enemy++;
  }
  return { cells, team: cells ? own / cells : 0, enemy: cells ? enemy / cells : 0 };
}

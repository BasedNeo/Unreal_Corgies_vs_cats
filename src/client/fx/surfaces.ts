// OWNER: X3 (weapons + combat feedback). What did that bullet hit? Classifies a world impact point (GameEvent.fire
// hx/hy/hz with hit = -1) into a surface kind + a surface normal, from WorldData alone: water zones, prop boxes and
// cylinders (by their content `type`), X1 destructibles (by kind), then terrain (height + surface weights).
// Pure (no three/DOM), allocation-free per query: a uniform XZ grid over the props is built once.
//
// Prop types map to materials by keyword (`surfaceOfType`), so new world content (E4's sandbags, containers,
// watchtowers...) gets a sensible impact without touching this file; add a keyword when one reads wrong.
import type { WorldData, PropBox, PropCylinder } from '../../shared/world/world-types';

export const Surface = { Dirt: 0, Grass: 1, Sand: 2, Stone: 3, Metal: 4, Wood: 5, Water: 6, Soft: 7 } as const;
export type SurfaceKind = (typeof Surface)[keyof typeof Surface];
export const SURFACE_NAMES = ['dirt', 'grass', 'sand', 'stone', 'metal', 'wood', 'water', 'soft'] as const;

/** Result of a classification (reused by the caller: fill-in, never allocated per query). */
export interface SurfaceHit {
  kind: SurfaceKind;
  /** Unit surface normal (world). */
  nx: number; ny: number; nz: number;
  /** A persistent mark (bullet hole / scorch) may sit here: static and flat enough (not water, not foliage). */
  decal: boolean;
  /** What was hit: 0 nothing known (fallback), 1 terrain, 2 box prop, 3 cylinder prop, 4 water, 5 destructible. */
  what: number;
}

export function makeSurfaceHit(): SurfaceHit {
  return { kind: Surface.Dirt, nx: 0, ny: 1, nz: 0, decal: false, what: 0 };
}

// Keyword → material. First match wins (checked in this order).
const KEYWORDS: [SurfaceKind, readonly string[]][] = [
  [Surface.Water, ['water', 'pond', 'puddle']],
  [Surface.Soft, ['sack', 'sandbag', 'tarp', 'hedge', 'leaf', 'bed', 'trampoline', 'tire', 'ball', 'sisal', 'hose', 'banner', 'flag', 'net',
    'zucchini', 'pumpkin', 'tomato', 'sunflower', 'vine', 'scarecrow', 'bush', 'cushion', 'kibble', 'compost']],
  [Surface.Metal, ['car', 'ac', 'freezer', 'garage_door', 'mower', 'barrow', 'bin', 'grill', 'bucket', 'paint', 'dish', 'vent', 'toolchest',
    'scaffold', 'pole', 'rail', 'skylight', 'hatch', 'container', 'terminal', 'kiosk', 'barrel', 'tuna', 'can', 'metal', 'steel', 'crane',
    'tank', 'drum', 'pipe', 'light', 'lamp', 'antenna', 'generator', 'sprinkler']],
  [Surface.Wood, ['fence', 'deck', 'bench', 'chair', 'table', 'doghouse', 'crate', 'shed', 'plank', 'wood', 'bridge', 'gate', 'planter',
    'stairs', 'swing', 'leanto', 'shelf', 'tree', 'branch', 'root', 'cattree', 'picket', 'barricade', 'feeder', 'wall_boards', 'board',
    'pallet', 'tower', 'box', 'nest', 'bundle', 'slide']],
  [Surface.Sand, ['sandbox', 'sand', 'castle']],
  [Surface.Stone, ['brick', 'patio', 'house', 'garage', 'roof', 'parapet', 'pool', 'rock', 'pot', 'chimney', 'gnome', 'birdbath', 'frog',
    'concrete', 'stone', 'slab', 'bowl', 'wall', 'bunker', 'step']],
];

/** Material of a prop `type` string (keyword match; unknown types read as stone). */
export function surfaceOfType(type: string): SurfaceKind {
  const t = type.toLowerCase();
  for (const [kind, words] of KEYWORDS) {
    for (const w of words) {
      // whole-word-ish match: 'ac' must not match 'stack' or 'place'
      const i = t.indexOf(w);
      if (i < 0) continue;
      const before = i === 0 ? '_' : t[i - 1], after = i + w.length >= t.length ? '_' : t[i + w.length];
      const sep = (c: string) => c === '_' || c === '-' || c === ' ' || (c >= '0' && c <= '9');
      if (w.length <= 3 ? sep(before) && sep(after) : true) return kind;
    }
  }
  return Surface.Stone;
}

const DESTRUCT_SURFACE: Record<string, SurfaceKind> = { wall_boards: Surface.Wood, tuna_stack: Surface.Metal, crate_stack: Surface.Wood };

/** The subset of WorldData the classifier reads (hand-built lab/test worlds only need these). */
export type SurfaceWorld = Pick<WorldData, 'height' | 'props'> & Partial<Pick<WorldData, 'cylinders' | 'water' | 'surface' | 'destructibles'>>;

const CELL = 4;
/** Impact points sit on a collider's surface up to float noise; this much slack (m) still counts as "on" it. */
const EPS = 0.07;

export class SurfaceMap {
  private boxes: PropBox[] = [];
  private boxKind: Uint8Array = new Uint8Array(0);
  private boxWhat: Uint8Array = new Uint8Array(0);
  /** Row-major 3×3 rotation per box (local → world), 9 floats each. */
  private rot: Float32Array = new Float32Array(0);
  private cyls: PropCylinder[] = [];
  private cylKind: Uint8Array = new Uint8Array(0);
  private gx0 = 0; private gz0 = 0; private gw = 0; private gh = 0;
  /** CSR grid: cellStart[c]..cellStart[c+1] index into cellItems (box ids ≥ 0, cylinder ids as −1 − i). */
  private cellStart: Int32Array = new Int32Array(1);
  private cellItems: Int32Array = new Int32Array(0);
  private world: SurfaceWorld | null = null;

  constructor(world?: SurfaceWorld | null) { if (world) this.setWorld(world); }

  setWorld(world: SurfaceWorld | null): void {
    this.world = world;
    if (!world) { this.boxes = []; this.cyls = []; this.cellStart = new Int32Array(1); this.cellItems = new Int32Array(0); return; }
    const boxes: PropBox[] = [], kinds: number[] = [], whats: number[] = [];
    for (const b of world.props) { if (b.type === 'boundary') continue; boxes.push(b); kinds.push(surfaceOfType(b.type)); whats.push(2); }
    for (const d of world.destructibles ?? []) for (const b of d.boxes) { boxes.push(b); kinds.push(DESTRUCT_SURFACE[d.kind] ?? Surface.Wood); whats.push(5); }
    this.boxes = boxes;
    this.boxKind = Uint8Array.from(kinds);
    this.boxWhat = Uint8Array.from(whats);
    this.rot = new Float32Array(boxes.length * 9);
    boxes.forEach((b, i) => writeRotation(this.rot, i * 9, b.rotY, b.pitch ?? 0, b.roll ?? 0));
    this.cyls = world.cylinders ?? [];
    this.cylKind = Uint8Array.from(this.cyls.map((c) => surfaceOfType(c.type)));
    // Grid bounds over every footprint (bounding circle per prop).
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const foot = (x: number, z: number, r: number) => { x0 = Math.min(x0, x - r); z0 = Math.min(z0, z - r); x1 = Math.max(x1, x + r); z1 = Math.max(z1, z + r); };
    for (const b of boxes) foot(b.x, b.z, Math.hypot(b.hx, b.hy, b.hz));
    for (const c of this.cyls) foot(c.x, c.z, c.r);
    if (!Number.isFinite(x0)) { this.gw = this.gh = 0; this.cellStart = new Int32Array(1); this.cellItems = new Int32Array(0); return; }
    this.gx0 = x0; this.gz0 = z0;
    this.gw = Math.max(1, Math.ceil((x1 - x0) / CELL)); this.gh = Math.max(1, Math.ceil((z1 - z0) / CELL));
    const lists: number[][] = Array.from({ length: this.gw * this.gh }, () => []);
    const add = (id: number, x: number, z: number, r: number) => {
      const a = this.cellX(x - r - EPS), b = this.cellX(x + r + EPS), c = this.cellZ(z - r - EPS), d = this.cellZ(z + r + EPS);
      for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) lists[j * this.gw + i].push(id);
    };
    boxes.forEach((b, i) => add(i, b.x, b.z, Math.hypot(b.hx, b.hy, b.hz)));
    this.cyls.forEach((c, i) => add(-1 - i, c.x, c.z, c.r));
    this.cellStart = new Int32Array(lists.length + 1);
    let n = 0;
    lists.forEach((l, i) => { this.cellStart[i] = n; n += l.length; });
    this.cellStart[lists.length] = n;
    this.cellItems = new Int32Array(n);
    let k = 0;
    for (const l of lists) for (const id of l) this.cellItems[k++] = id;
  }

  private cellX(x: number): number { return Math.max(0, Math.min(this.gw - 1, Math.floor((x - this.gx0) / CELL))); }
  private cellZ(z: number): number { return Math.max(0, Math.min(this.gh - 1, Math.floor((z - this.gz0) / CELL))); }

  /**
   * Classify the impact at (x, y, z) of a shot travelling along (dx, dy, dz) (unit or not). Fills and returns `out`.
   * Without a world: dirt facing back along the shot.
   */
  classify(x: number, y: number, z: number, dx: number, dy: number, dz: number, out: SurfaceHit): SurfaceHit {
    const w = this.world;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    out.nx = -dx / dl; out.ny = -dy / dl; out.nz = -dz / dl;
    out.kind = Surface.Dirt; out.decal = false; out.what = 0;
    if (!w) return out;
    // 1) water surface
    for (const wz of w.water ?? []) {
      const inside = wz.shape === 'circle'
        ? (x - wz.x) ** 2 + (z - wz.z) ** 2 <= (wz.r ?? 0) ** 2
        : Math.abs(x - wz.x) <= (wz.hx ?? 0) && Math.abs(z - wz.z) <= (wz.hz ?? 0);
      if (inside && y <= wz.surfaceY + 0.25 && y >= wz.bottomY - 0.2) {
        out.kind = Surface.Water; out.nx = 0; out.ny = 1; out.nz = 0; out.what = 4;
        return out;
      }
    }
    // 2) props: the box/cylinder whose surface the point lies on (closest face wins)
    let best = EPS, bestId = 0x7fffffff, bnx = 0, bny = 1, bnz = 0;
    if (this.gw > 0 && x >= this.gx0 - EPS && z >= this.gz0 - EPS && x <= this.gx0 + this.gw * CELL + EPS && z <= this.gz0 + this.gh * CELL + EPS) {
      const c = this.cellZ(z) * this.gw + this.cellX(x);
      for (let k = this.cellStart[c], e = this.cellStart[c + 1]; k < e; k++) {
        const id = this.cellItems[k];
        if (id >= 0) {
          const b = this.boxes[id], R = this.rot, o = id * 9;
          const px = x - b.x, py = y - b.y, pz = z - b.z;
          // local = Rᵀ · p
          const lx = R[o] * px + R[o + 3] * py + R[o + 6] * pz;
          const ly = R[o + 1] * px + R[o + 4] * py + R[o + 7] * pz;
          const lz = R[o + 2] * px + R[o + 5] * py + R[o + 8] * pz;
          const ox = Math.abs(lx) - b.hx, oy = Math.abs(ly) - b.hy, oz = Math.abs(lz) - b.hz;
          if (ox > EPS || oy > EPS || oz > EPS) continue;
          // distance to the nearest face (0 on the surface; inside points use how deep they are)
          let d: number, ax: number;
          if (ox >= oy && ox >= oz) { d = Math.abs(ox); ax = 0; } else if (oy >= oz) { d = Math.abs(oy); ax = 1; } else { d = Math.abs(oz); ax = 2; }
          if (d < best || (d === best && id < bestId)) {
            best = d; bestId = id;
            const s = ax === 0 ? Math.sign(lx) || 1 : ax === 1 ? Math.sign(ly) || 1 : Math.sign(lz) || 1;
            // world normal = column `ax` of R, signed
            bnx = R[o + ax] * s; bny = R[o + 3 + ax] * s; bnz = R[o + 6 + ax] * s;
          }
        } else {
          const cy = this.cyls[-1 - id];
          const rx = x - cy.x, rz = z - cy.z, rr = Math.sqrt(rx * rx + rz * rz);
          const side = rr - cy.r, top = y - (cy.y + cy.hh), bot = cy.y - cy.hh - y;
          if (side > EPS || top > EPS || bot > EPS) continue;
          const dSide = Math.abs(side), dTop = Math.abs(top);
          const d = Math.min(dSide, dTop);
          if (d < best) {
            best = d; bestId = id;
            if (dTop < dSide) { bnx = 0; bny = 1; bnz = 0; } else { bnx = rx / (rr || 1); bny = 0; bnz = rz / (rr || 1); }
          }
        }
      }
    }
    if (bestId !== 0x7fffffff) {
      if (bestId >= 0) { out.kind = this.boxKind[bestId] as SurfaceKind; out.what = this.boxWhat[bestId]; }
      else { out.kind = this.cylKind[-1 - bestId] as SurfaceKind; out.what = 3; }
      out.nx = bnx; out.ny = bny; out.nz = bnz;
      out.decal = out.kind !== Surface.Soft && out.kind !== Surface.Water && out.what !== 5; // destructibles break: no marks
      return out;
    }
    // 3) terrain
    const h = w.height(x, z);
    if (Math.abs(y - h) < 0.35) {
      const e = 0.25;
      const gx = (w.height(x + e, z) - w.height(x - e, z)) / (2 * e), gz = (w.height(x, z + e) - w.height(x, z - e)) / (2 * e);
      const l = Math.sqrt(gx * gx + 1 + gz * gz);
      out.nx = -gx / l; out.ny = 1 / l; out.nz = -gz / l;
      out.what = 1; out.decal = true;
      const s = w.surface?.(x, z);
      if (s && s.sand > 0.5) out.kind = Surface.Sand;
      else if (s && s.dirt + s.mulch > 0.5) out.kind = Surface.Dirt;
      else out.kind = Surface.Grass;
      return out;
    }
    // 4) something we don't model (vehicle, drone, barrier, a moving prop): generic chips, no mark
    out.kind = Surface.Stone;
    return out;
  }
}

/** Rotation (YXZ Euler: yaw, then pitch about local X, then roll about local Z) as a row-major 3×3 at `o`. */
function writeRotation(m: Float32Array, o: number, yaw: number, pitch: number, roll: number): void {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), cz = Math.cos(roll), sz = Math.sin(roll);
  // R = Ry · Rx · Rz (three.js Euler 'YXZ')
  m[o] = cy * cz + sy * sx * sz; m[o + 1] = -cy * sz + sy * sx * cz; m[o + 2] = sy * cx;
  m[o + 3] = cx * sz; m[o + 4] = cx * cz; m[o + 5] = -sx;
  m[o + 6] = -sy * cz + cy * sx * sz; m[o + 7] = sy * sz + cy * sx * cz; m[o + 8] = cy * cx;
}

// OWNER: X3. Persistent impact marks (bullet holes by surface, explosion scorch), CPU side — no three.js, testable in
// Node. A ring buffer capped per quality tier (low 16 · medium 40 · high 64): a new mark overwrites the oldest, and
// the few oldest marks of a full ring are already fading, so a replacement never pops. Marks also fade out at the
// end of their life. Zero allocations after construction (tests/unit/fx-weapons.test.ts).

export const DecalKind = { Hole: 0, Scorch: 1 } as const;

/** GPU-facing per-instance arrays (4 floats per instance each), filled by DecalPool.write(). */
export interface DecalArrays {
  /** xyz centre (lifted off the surface), w radius (m). */
  pos: Float32Array;
  /** xyz tangent (unit, rotated), w kind. */
  tan: Float32Array;
  /** xyz bitangent (unit, rotated), w surface kind (fx/surfaces.ts). */
  bit: Float32Array;
  /** x opacity, y seed (0..1), z age (s), w 0. */
  misc: Float32Array;
}

export function createDecalArrays(capacity: number): DecalArrays {
  return { pos: new Float32Array(capacity * 4), tan: new Float32Array(capacity * 4), bit: new Float32Array(capacity * 4), misc: new Float32Array(capacity * 4) };
}

/** Mark lifetimes (s): bullet holes, then scorch. */
export const DECAL_LIFE = { hole: 24, scorch: 40 } as const;
/** How far off the surface a mark sits (m), on top of the material's polygon offset. */
const LIFT = 0.012;
/** The oldest marks of a full ring fade in over this many ranks (so recycling never pops). */
const FADE_RANKS = 4;

export class DecalPool {
  readonly capacity: number;
  /** Current cap (≤ capacity), set per quality tier. */
  cap: number;
  /** Live marks (≤ cap). */
  count = 0;
  readonly stats = { spawned: 0, recycled: 0 };
  private head = 0; // next slot to write (the oldest once the ring is full)
  private x: Float32Array; private y: Float32Array; private z: Float32Array;
  private tx: Float32Array; private ty: Float32Array; private tz: Float32Array;
  private bx: Float32Array; private by: Float32Array; private bz: Float32Array;
  private size: Float32Array; private kind: Float32Array; private surf: Float32Array; private seed: Float32Array;
  private age: Float32Array; private life: Float32Array;

  constructor(capacity: number, cap = capacity) {
    this.capacity = Math.max(1, capacity | 0);
    this.cap = Math.max(0, Math.min(this.capacity, cap | 0));
    const f = () => new Float32Array(this.capacity);
    this.x = f(); this.y = f(); this.z = f(); this.tx = f(); this.ty = f(); this.tz = f(); this.bx = f(); this.by = f(); this.bz = f();
    this.size = f(); this.kind = f(); this.surf = f(); this.seed = f(); this.age = f(); this.life = f();
  }

  /** Change the cap (quality tier). A change drops every mark (a settings change, not a per-frame event). */
  setCap(cap: number): void {
    const c = Math.max(0, Math.min(this.capacity, cap | 0));
    if (c === this.cap) return;
    this.clear();
    this.cap = c;
  }

  clear(): void { this.count = 0; this.head = 0; }

  /**
   * Adds a mark on a surface at (x, y, z) facing (nx, ny, nz) (unit). `rot` spins it in its plane, `seed` (0..1)
   * varies the shape. Returns the slot, or -1 when the cap is 0 (low tier without marks).
   */
  spawn(x: number, y: number, z: number, nx: number, ny: number, nz: number, radius: number, kind: number, surface: number, rot: number, seed: number, life = kind === DecalKind.Scorch ? DECAL_LIFE.scorch : DECAL_LIFE.hole): number {
    if (this.cap <= 0) return -1;
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++; else this.stats.recycled++;
    // Tangent basis: any vector not parallel to n, crossed with n.
    let hx = 0, hy = 1, hz = 0;
    if (ny > 0.9 || ny < -0.9) { hx = 1; hy = 0; }
    let tx = hy * nz - hz * ny, ty = hz * nx - hx * nz, tz = hx * ny - hy * nx;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const c = Math.cos(rot), s = Math.sin(rot);
    this.tx[i] = tx * c + bx * s; this.ty[i] = ty * c + by * s; this.tz[i] = tz * c + bz * s;
    this.bx[i] = bx * c - tx * s; this.by[i] = by * c - ty * s; this.bz[i] = bz * c - tz * s;
    this.x[i] = x + nx * LIFT; this.y[i] = y + ny * LIFT; this.z[i] = z + nz * LIFT;
    this.size[i] = radius; this.kind[i] = kind; this.surf[i] = surface; this.seed[i] = seed;
    this.age[i] = 0; this.life[i] = Math.max(0.1, life);
    this.stats.spawned++;
    return i;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < this.count; i++) this.age[i] += dt;
  }

  /** Writes live marks (in ring order, oldest first) into the GPU arrays; returns the instance count. */
  write(out: DecalArrays): number {
    const n = this.count, full = n >= this.cap;
    let w = 0;
    for (let k = 0; k < n; k++) {
      // Oldest first: the ring's oldest slot is `head` once full, else 0.
      const i = full ? (this.head + k) % this.cap : k;
      const a = this.age[i], life = this.life[i];
      if (a >= life) continue;
      let alpha = Math.min(1, a / 0.05);
      const tail = life * 0.8;
      if (a > tail) alpha *= 1 - (a - tail) / (life - tail);
      if (full && k < FADE_RANKS) alpha *= (k + 1) / (FADE_RANKS + 1);
      const o = w * 4;
      out.pos[o] = this.x[i]; out.pos[o + 1] = this.y[i]; out.pos[o + 2] = this.z[i]; out.pos[o + 3] = this.size[i];
      out.tan[o] = this.tx[i]; out.tan[o + 1] = this.ty[i]; out.tan[o + 2] = this.tz[i]; out.tan[o + 3] = this.kind[i];
      out.bit[o] = this.bx[i]; out.bit[o + 1] = this.by[i]; out.bit[o + 2] = this.bz[i]; out.bit[o + 3] = this.surf[i];
      out.misc[o] = alpha; out.misc[o + 1] = this.seed[i]; out.misc[o + 2] = a; out.misc[o + 3] = 0;
      w++;
    }
    return w;
  }
}

// OWNER: L5 (juice). CPU side of the pooled particle system — no three.js, no DOM, testable in Node.
//
// Structure-of-arrays in typed arrays preallocated at construction. Alive particles are kept compacted in
// [0, count): spawn appends, death swaps the last particle into the hole. When the pool is full, spawns
// overwrite slots round-robin ("steal") instead of growing. Callers describe a particle by mutating ONE
// reusable ParticleSpec and calling spawn(spec) — nothing is allocated per spawn or per frame after
// construction (proved by tests/unit/fx-particles.test.ts).

/** Fragment shape (SDF) drawn by the particle material. X3 added Shard (splinters, metal chips), Splat (a lobed
 *  blob: the hairball's goo and stains; W15 retired the comic hit splat), Casing (ejected brass / shells), Petal
 *  (muzzle-flash tongues, fire) and Glow (a soft light spill). W15 (stylised-realistic, no comic) retired the comic
 *  Star (3) and the spiky Burst (6): their ids stay unused so the other ids keep their values. W15 added Drop (12): a
 *  crisp round drop or clod (water, goo, a soil spray), since a Puff is a soft translucent blob. */
export const Shape = { Puff: 0, Streak: 1, Ring: 2, Tuft: 4, Chunk: 5, Shard: 7, Splat: 8, Casing: 9, Petal: 10, Glow: 11, Drop: 12 } as const;
/** Vertex placement: camera-facing quad, quad stretched along an axis, or flat on the ground (XZ). */
export const Mode = { Billboard: 0, Stretched: 1, Ground: 2 } as const;
/** Size over life. Linear s0→s1 · HoldShrink: s0→s1 then shrink out. (W15 retired the cartoon overshoot "Pop",
 *  id 1: it stays unused.) */
export const Curve = { Linear: 0, HoldShrink: 2 } as const;
/** Color over life. None: constant · Fade: color × (1−t)² (glow systems, additive) · Flash: bright first 25% ·
 *  Soft: opacity × (1−t)^1.5 (real alpha on solids since W15: smoke wisps, dust that thins out). */
export const Fade = { None: 0, Fade: 1, Flash: 2, Soft: 3 } as const;

export interface ParticleSpec {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Seconds. */
  life: number;
  size0: number; size1: number; curve: number;
  r: number; g: number; b: number; fade: number;
  shape: number; mode: number;
  /** m/s² downward (negative = rises). */
  gravity: number;
  /** Velocity damping per second (exponential). */
  drag: number;
  /** Rotation (radians) and spin (rad/s). */
  rot: number; spin: number;
  /** Shape parameter: ring band thickness (Ring only; W15: nothing is inked, so other shapes ignore it). */
  param: number;
  /** Stretched mode: world length along a fixed axis (ax,ay,az). 0 = derive from velocity (head-anchored streak). */
  len: number; ax: number; ay: number; az: number;
  /** Stretched mode with len = 0: streak length = speed × stretch seconds (capped by distance traveled). */
  stretch: number;
  /** Ground plane for bouncing debris (−Infinity = none) and restitution. */
  floorY: number; bounce: number;
  /** Opacity 0..1 (solids: real alpha; glow: scales the color). */
  alpha: number;
}

export function makeSpec(): ParticleSpec {
  return resetSpec({} as ParticleSpec);
}

export function resetSpec(s: ParticleSpec): ParticleSpec {
  s.x = s.y = s.z = 0; s.vx = s.vy = s.vz = 0;
  s.life = 0.5; s.size0 = 0.2; s.size1 = 0.2; s.curve = Curve.Linear;
  s.r = s.g = s.b = 1; s.fade = Fade.None;
  s.shape = Shape.Puff; s.mode = Mode.Billboard;
  s.gravity = 0; s.drag = 0; s.rot = 0; s.spin = 0; s.param = 0;
  s.len = 0; s.ax = 0; s.ay = 1; s.az = 0; s.stretch = 0;
  s.floorY = -Infinity; s.bounce = 0.3; s.alpha = 1;
  return s;
}

/** GPU-facing per-instance arrays (4 floats per instance each), filled by ParticlePool.write(). */
export interface InstanceArrays {
  /** xyz center, w size (radius, m). */
  pos: Float32Array;
  /** rgb color (may exceed 1 for glow), w shape id. */
  col: Float32Array;
  /** xyz axis vector (world, length = streak length) for Stretched mode; w = opacity (0..1). */
  axis: Float32Array;
  /** x rotation, y mode, z shape param, w life fraction t. */
  misc: Float32Array;
}

export function createInstanceArrays(capacity: number): InstanceArrays {
  return { pos: new Float32Array(capacity * 4), col: new Float32Array(capacity * 4), axis: new Float32Array(capacity * 4), misc: new Float32Array(capacity * 4) };
}

// Field order of the SoA store (one Float32Array per field).
const F = {
  x: 0, y: 1, z: 2, vx: 3, vy: 4, vz: 5, age: 6, life: 7, s0: 8, s1: 9, curve: 10, r: 11, g: 12, b: 13, fade: 14,
  shape: 15, mode: 16, grav: 17, drag: 18, rot: 19, spin: 20, param: 21, len: 22, ax: 23, ay: 24, az: 25,
  stretch: 26, floor: 27, bounce: 28, trav: 29, alpha: 30, fresh: 31,
} as const;
const NF = 32;

export class ParticlePool {
  readonly capacity: number;
  /** Alive particles occupy indices [0, count). */
  count = 0;
  /** Diagnostics: typed arrays allocated (constant after construction), spawns, steals. */
  readonly stats = { arrays: 0, spawned: 0, stolen: 0 };
  /**
   * X3: particles spawned between frames skip their first update(), so the first rendered frame shows them at
   * t = 0 (a 70 ms muzzle flash is no longer half faded at 30 fps, and it lands on the same frame as its sound).
   */
  freshFirstFrame = false;
  private f: Float32Array[];
  private steal = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity | 0);
    this.f = [];
    for (let i = 0; i < NF; i++) this.f.push(new Float32Array(this.capacity));
    this.stats.arrays = NF;
  }

  /** Adds one particle; returns its slot. Never allocates. When full, overwrites slots round-robin. */
  spawn(s: ParticleSpec): number {
    let i: number;
    if (this.count < this.capacity) i = this.count++;
    else { i = this.steal; this.steal = (this.steal + 1) % this.capacity; this.stats.stolen++; }
    const f = this.f;
    f[F.x][i] = s.x; f[F.y][i] = s.y; f[F.z][i] = s.z;
    f[F.vx][i] = s.vx; f[F.vy][i] = s.vy; f[F.vz][i] = s.vz;
    f[F.age][i] = 0; f[F.life][i] = Math.max(1e-3, s.life);
    f[F.s0][i] = s.size0; f[F.s1][i] = s.size1; f[F.curve][i] = s.curve;
    f[F.r][i] = s.r; f[F.g][i] = s.g; f[F.b][i] = s.b; f[F.fade][i] = s.fade;
    f[F.shape][i] = s.shape; f[F.mode][i] = s.mode;
    f[F.grav][i] = s.gravity; f[F.drag][i] = s.drag;
    f[F.rot][i] = s.rot; f[F.spin][i] = s.spin; f[F.param][i] = s.param;
    f[F.len][i] = s.len; f[F.ax][i] = s.ax; f[F.ay][i] = s.ay; f[F.az][i] = s.az;
    f[F.stretch][i] = s.stretch; f[F.floor][i] = s.floorY; f[F.bounce][i] = s.bounce; f[F.trav][i] = 0;
    f[F.alpha][i] = s.alpha; f[F.fresh][i] = this.freshFirstFrame ? 1 : 0;
    this.stats.spawned++;
    return i;
  }

  /** Integrates motion, ages and removes dead particles (swap-with-last compaction). */
  update(dt: number): void {
    if (dt <= 0) return;
    const f = this.f;
    const x = f[F.x], y = f[F.y], z = f[F.z], vx = f[F.vx], vy = f[F.vy], vz = f[F.vz];
    const age = f[F.age], life = f[F.life], grav = f[F.grav], drag = f[F.drag], rot = f[F.rot], spin = f[F.spin];
    const floor = f[F.floor], bounce = f[F.bounce], trav = f[F.trav], fresh = f[F.fresh];
    let i = 0;
    while (i < this.count) {
      if (fresh[i] !== 0) { fresh[i] = 0; i++; continue; }
      age[i] += dt;
      if (age[i] >= life[i]) { this.kill(i); continue; }
      vy[i] -= grav[i] * dt;
      if (drag[i] > 0) { const k = Math.exp(-drag[i] * dt); vx[i] *= k; vy[i] *= k; vz[i] *= k; }
      const sx = vx[i] * dt, sy = vy[i] * dt, sz = vz[i] * dt;
      x[i] += sx; y[i] += sy; z[i] += sz;
      trav[i] += Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (y[i] < floor[i]) { y[i] = floor[i]; vy[i] = -vy[i] * bounce[i]; vx[i] *= 0.6; vz[i] *= 0.6; spin[i] *= 0.5; }
      rot[i] += spin[i] * dt;
      i++;
    }
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i !== last) for (let k = 0; k < NF; k++) { const a = this.f[k]; a[i] = a[last]; }
    if (this.steal >= this.count && this.count > 0) this.steal = 0;
  }

  clear(): void { this.count = 0; this.steal = 0; }

  /** Writes the alive particles into GPU instance arrays; returns the instance count. Never allocates. */
  write(out: InstanceArrays): number {
    const f = this.f, n = this.count;
    const x = f[F.x], y = f[F.y], z = f[F.z], vx = f[F.vx], vy = f[F.vy], vz = f[F.vz];
    const { pos, col, axis, misc } = out;
    for (let i = 0; i < n; i++) {
      const t = Math.min(1, f[F.age][i] / f[F.life][i]);
      const size = sizeAt(f[F.curve][i], f[F.s0][i], f[F.s1][i], t);
      let fade = 1, alpha = f[F.alpha][i];
      const fm = f[F.fade][i];
      if (fm === Fade.Fade) { const u = 1 - t; fade = u * u; }
      else if (fm === Fade.Flash) fade = t < 0.25 ? 1.6 - t * 2.4 : 1;
      else if (fm === Fade.Soft) { const u = 1 - t; alpha *= u * Math.sqrt(u); }
      const o = i * 4;
      let cx = x[i], cy = y[i], cz = z[i], axx = 0, axy = 0, axz = 0;
      if (f[F.mode][i] === Mode.Stretched) {
        const len = f[F.len][i];
        if (len > 0) {
          axx = f[F.ax][i] * len; axy = f[F.ay][i] * len; axz = f[F.az][i] * len;
        } else {
          const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
          if (sp > 1e-4) {
            // Head-anchored streak: head at the particle, tail never behind where it started.
            const L = Math.min(sp * f[F.stretch][i], f[F.trav][i] + 1e-3);
            const k = L / sp;
            axx = vx[i] * k; axy = vy[i] * k; axz = vz[i] * k;
            cx -= axx * 0.5; cy -= axy * 0.5; cz -= axz * 0.5;
          }
        }
      }
      pos[o] = cx; pos[o + 1] = cy; pos[o + 2] = cz; pos[o + 3] = size;
      col[o] = f[F.r][i] * fade; col[o + 1] = f[F.g][i] * fade; col[o + 2] = f[F.b][i] * fade; col[o + 3] = f[F.shape][i];
      axis[o] = axx; axis[o + 1] = axy; axis[o + 2] = axz; axis[o + 3] = alpha;
      misc[o] = f[F.rot][i]; misc[o + 1] = f[F.mode][i]; misc[o + 2] = f[F.param][i]; misc[o + 3] = t;
    }
    return n;
  }
}

/** Size-over-life curves (exported for tests). */
export function sizeAt(curve: number, s0: number, s1: number, t: number): number {
  if (curve === Curve.HoldShrink) {
    if (t < 0.7) return s0 + (s1 - s0) * (t / 0.7);
    const u = (t - 0.7) / 0.3;
    return s1 * (1 - u * u);
  }
  return s0 + (s1 - s0) * t;
}

/** Small fast PRNG for presentation variation (keeps FX reproducible in tests; not gameplay). */
export class FxRng {
  private s: number;
  constructor(seed = 0x9e3779b9) { this.s = seed >>> 0 || 1; }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  /** Symmetric: [-a, a]. */
  sym(a: number): number { return (this.next() * 2 - 1) * a; }
}

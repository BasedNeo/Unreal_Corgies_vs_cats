// X1: pooled 3D break debris — planks, plaster lumps, splinters (box chunks) and whole tuna cans (cylinders) that
// burst out of a breaking destructible, tumble, bounce on whatever surface is below them, settle and shrink away.
// Two InstancedMeshes (one draw each + their ink hulls), toon-lit with per-instance colors; every array is allocated
// once at construction, a burst writes into free slots (the oldest are recycled when full): no allocation per break
// or per frame after warm-up (tests/unit/destruct-view.test.ts counts it).
import * as THREE from 'three/webgpu';
import type { DestructKind } from '../../shared/world/world-types';
import { FxRng } from '../fx/particle-pool';
import { bevelBoxGeometry } from './prim-mesh';
import { toonFrom } from './materials';
import { worldColor } from './world-palette';

/** Palette keys and burst shape per kind. */
export const DEBRIS_LOOK: Record<DestructKind, { chunks: number; cans: number; colors: string[]; plank: [number, number]; speed: number }> = {
  wall_boards: { chunks: 44, cans: 0, colors: ['garageSiding', 'garageSiding2', 'plywood', 'plywoodDark', 'garageInside', 'splinter', 'fenceWood'], plank: [0.7, 1.7], speed: 6.5 },
  tuna_stack: { chunks: 18, cans: 14, colors: ['fenceWood', 'fenceDark2', 'tin', 'tunaFish', 'splinter'], plank: [0.4, 1.2], speed: 4.5 },
  crate_stack: { chunks: 34, cans: 0, colors: ['fenceWood', 'fenceDark2', 'fenceDark', 'splinter'], plank: [0.6, 1.4], speed: 5 },
};

const GRAVITY = 17;
const SETTLE = 0.45;       // seconds of shrinking at the end of a chunk's life

interface Pool {
  mesh: THREE.InstancedMesh;
  cap: number;
  count: number;
  /** Next slot to recycle when full. */
  steal: number;
  // per slot: position, velocity, euler angles, angular velocity, scale, age/life, floor (+ where it was sampled)
  p: Float32Array; v: Float32Array; r: Float32Array; w: Float32Array; s: Float32Array;
  age: Float32Array; life: Float32Array; floor: Float32Array; fx: Float32Array; fz: Float32Array; rest: Uint8Array;
}

function copy3(a: Float32Array, i: number, j: number): void {
  a[i * 3] = a[j * 3]; a[i * 3 + 1] = a[j * 3 + 1]; a[i * 3 + 2] = a[j * 3 + 2];
}

function makePool(geo: THREE.BufferGeometry, cap: number, name: string): Pool {
  const mat = toonFrom({});
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;                        // instances fly around; the pool is small
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.noCameraCollide = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));      // allocates instanceColor once
  mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  const f = (n: number) => new Float32Array(cap * n);
  return {
    mesh, cap, count: 0, steal: 0,
    p: f(3), v: f(3), r: f(3), w: f(3), s: f(3), age: f(1), life: f(1), floor: f(1), fx: f(1), fz: f(1), rest: new Uint8Array(cap),
  };
}

export interface DebrisSystem {
  group: THREE.Group;
  /** Burst for one break. Box = where chunks start (world AABB); center = the destructible's center. */
  burst(kind: DestructKind, box: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }, cx: number, cy: number, cz: number): void;
  update(dt: number): void;
  /** Drop every chunk (e.g. after a warm-up burst). */
  clear(): void;
  readonly alive: number;
  dispose(): void;
}

/** `surfaceAt(x, z, belowY)` = the walkable height under a point (terrain or props); must not allocate. */
export function createDebris(surfaceAt: (x: number, z: number, belowY: number) => number, opts: { chunks?: number; cans?: number; seed?: number } = {}): DebrisSystem {
  const group = new THREE.Group();
  group.name = 'destruct_debris';
  const chunkGeo = bevelBoxGeometry(1, 1, 1, 0.12);
  chunkGeo.userData.outlineReady = true;
  const canGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1);
  const chunks = makePool(chunkGeo, opts.chunks ?? 180, 'debris_chunks');
  const cans = makePool(canGeo, opts.cans ?? 48, 'debris_cans');
  group.add(chunks.mesh, cans.mesh);
  const rng = new FxRng(opts.seed ?? 0x5eed);
  const color = new THREE.Color();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3();

  function spawn(pool: Pool, x: number, y: number, z: number, vx: number, vy: number, vz: number, sx: number, sy: number, sz: number, col: string, life: number): void {
    let i: number;
    if (pool.count < pool.cap) i = pool.count++;
    else { i = pool.steal; pool.steal = (pool.steal + 1) % pool.cap; }
    const i3 = i * 3;
    pool.p[i3] = x; pool.p[i3 + 1] = y; pool.p[i3 + 2] = z;
    pool.v[i3] = vx; pool.v[i3 + 1] = vy; pool.v[i3 + 2] = vz;
    pool.r[i3] = rng.sym(3); pool.r[i3 + 1] = rng.sym(3); pool.r[i3 + 2] = rng.sym(3);
    pool.w[i3] = rng.sym(11); pool.w[i3 + 1] = rng.sym(7); pool.w[i3 + 2] = rng.sym(11);
    pool.s[i3] = sx; pool.s[i3 + 1] = sy; pool.s[i3 + 2] = sz;
    pool.age[i] = 0; pool.life[i] = life; pool.rest[i] = 0;
    pool.fx[i] = x; pool.fz[i] = z; pool.floor[i] = surfaceAt(x, z, y + 0.3);
    pool.mesh.setColorAt(i, color.copy(worldColor(col)));
    pool.mesh.instanceColor!.needsUpdate = true;
  }

  function kill(pool: Pool, i: number): void {
    const last = --pool.count;
    if (i !== last) {
      copy3(pool.p, i, last); copy3(pool.v, i, last); copy3(pool.r, i, last); copy3(pool.w, i, last); copy3(pool.s, i, last);
      pool.age[i] = pool.age[last]; pool.life[i] = pool.life[last]; pool.floor[i] = pool.floor[last];
      pool.fx[i] = pool.fx[last]; pool.fz[i] = pool.fz[last]; pool.rest[i] = pool.rest[last];
      const c = pool.mesh.instanceColor!.array as Float32Array;
      c[i * 3] = c[last * 3]; c[i * 3 + 1] = c[last * 3 + 1]; c[i * 3 + 2] = c[last * 3 + 2];
      pool.mesh.instanceColor!.needsUpdate = true;
    }
    if (pool.steal >= pool.count) pool.steal = 0;
  }

  function step(pool: Pool, dt: number): void {
    let i = 0;
    const arr = pool.mesh.instanceMatrix.array as Float32Array;
    while (i < pool.count) {
      pool.age[i] += dt;
      if (pool.age[i] >= pool.life[i]) { kill(pool, i); continue; }
      const i3 = i * 3;
      if (!pool.rest[i]) {
        pool.v[i3 + 1] -= GRAVITY * dt;
        pool.p[i3] += pool.v[i3] * dt; pool.p[i3 + 1] += pool.v[i3 + 1] * dt; pool.p[i3 + 2] += pool.v[i3 + 2] * dt;
        pool.r[i3] += pool.w[i3] * dt; pool.r[i3 + 1] += pool.w[i3 + 1] * dt; pool.r[i3 + 2] += pool.w[i3 + 2] * dt;
        // re-sample the surface below once the chunk has drifted (inside -> outside the garage, off a car hood...)
        if (Math.abs(pool.p[i3] - pool.fx[i]) + Math.abs(pool.p[i3 + 2] - pool.fz[i]) > 0.8) {
          pool.fx[i] = pool.p[i3]; pool.fz[i] = pool.p[i3 + 2];
          pool.floor[i] = surfaceAt(pool.p[i3], pool.p[i3 + 2], pool.p[i3 + 1] + 0.3);
        }
        const half = Math.min(pool.s[i3], pool.s[i3 + 1], pool.s[i3 + 2]) * 0.5;
        if (pool.p[i3 + 1] < pool.floor[i] + half) {
          pool.p[i3 + 1] = pool.floor[i] + half;
          if (Math.abs(pool.v[i3 + 1]) < 1.6) {
            // settle: planks lie flat on their broad face, cans stand upright (the yaw stays)
            pool.rest[i] = 1;
            pool.r[i3] = 0; pool.r[i3 + 2] = 0;
            pool.p[i3 + 1] = pool.floor[i] + pool.s[i3 + 1] * 0.5;
          } else {
            pool.v[i3 + 1] = -pool.v[i3 + 1] * 0.35;
            pool.v[i3] *= 0.55; pool.v[i3 + 2] *= 0.55;
            pool.w[i3] *= 0.5; pool.w[i3 + 1] *= 0.5; pool.w[i3 + 2] *= 0.5;
          }
        }
      }
      const left = pool.life[i] - pool.age[i];
      const k = left < SETTLE ? left / SETTLE : 1;
      e.set(pool.r[i3], pool.r[i3 + 1], pool.r[i3 + 2]);
      q.setFromEuler(e);
      m.compose(pos.set(pool.p[i3], pool.p[i3 + 1], pool.p[i3 + 2]), q, scl.set(pool.s[i3] * k, pool.s[i3 + 1] * k, pool.s[i3 + 2] * k));
      m.toArray(arr, i * 16);
      i++;
    }
    pool.mesh.count = pool.count;
    if (pool.count) pool.mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    group,
    get alive() { return chunks.count + cans.count; },
    burst(kind, box, cx, cy, cz) {
      const look = DEBRIS_LOOK[kind];
      const wall = kind === 'wall_boards';
      const wx = box.x1 - box.x0, wz = box.z1 - box.z0;
      for (let n = 0; n < look.chunks; n++) {
        const x = box.x0 + rng.next() * wx, y = box.y0 + 0.2 + rng.next() * (box.y1 - box.y0 - 0.2), z = box.z0 + rng.next() * wz;
        let dx = x - cx, dz = z - cz;
        if (wall) {
          // a board wall bursts both ways across its thin axis
          const thinX = wx < wz, s = rng.next() < 0.55 ? 1 : -1;
          dx = thinX ? s * (1 + rng.next()) : dx * 0.35; dz = thinX ? dz * 0.35 : s * (1 + rng.next());
        }
        const l = Math.hypot(dx, dz) || 1, sp = look.speed * (0.45 + rng.next() * 0.75);
        const col = look.colors[Math.floor(rng.next() * look.colors.length)];
        const lump = col === 'garageInside' || col === 'tin' || col === 'tunaFish';
        const len = look.plank[0] + rng.next() * (look.plank[1] - look.plank[0]);
        const sx = lump ? 0.22 + rng.next() * 0.2 : len, sy = lump ? 0.18 + rng.next() * 0.15 : 0.08 + rng.next() * 0.06;
        const sz = lump ? 0.2 + rng.next() * 0.2 : 0.16 + rng.next() * 0.14;
        spawn(chunks, x, y, z, (dx / l) * sp, 2.5 + rng.next() * 4.5, (dz / l) * sp, sx, sy, sz, col, 2.4 + rng.next() * 1.4);
      }
      for (let n = 0; n < look.cans; n++) {
        // whole cans pop off the pyramid: layer rings, flung up and out
        const layer = n < 9 ? 0 : n < 13 ? 1 : 2, a = rng.next() * Math.PI * 2, rr = layer === 2 ? 0.1 : 0.4 + rng.next() * 0.6;
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, y = box.y0 + 0.45 + layer * 0.42;
        const sp = look.speed * (0.5 + rng.next() * 0.7);
        spawn(cans, x, y, z, Math.cos(a) * sp, 3 + rng.next() * 4 + layer, Math.sin(a) * sp, 0.8, 0.42, 0.8, rng.next() < 0.72 ? 'tunaLabel' : 'tunaLabel2', 2.6 + rng.next() * 1.4);
      }
    },
    update(dt) {
      if (dt <= 0) return;
      const d = Math.min(dt, 0.05);
      step(chunks, d);
      step(cans, d);
    },
    clear() {
      chunks.count = 0; cans.count = 0; chunks.steal = 0; cans.steal = 0;
      chunks.mesh.count = 0; cans.mesh.count = 0;
    },
    dispose() {
      chunkGeo.dispose(); canGeo.dispose();
      (chunks.mesh.material as THREE.Material).dispose(); (cans.mesh.material as THREE.Material).dispose();
      chunks.mesh.dispose(); cans.mesh.dispose();
    },
  };
}

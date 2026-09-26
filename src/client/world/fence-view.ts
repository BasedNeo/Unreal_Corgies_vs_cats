// Board fences from WorldData.fences: ~1700 dog-eared boards as ONE instanced toon mesh (ink hull
// outlines every board -> drawn plank seams), posts/rails/dig spoil as VisualPrims merged with the
// rest of the props. Colliders come from the shared layout (props of type 'fence').
// E4 (Yard War): boards inside the battle layout's fence-damage zones are snapped short, knocked askew, scorched,
// shot through (dark holes) or patched with plywood — visual only: the fence colliders are untouched (a snapped
// board never opens the map; the tops stay far above any jump).
import * as THREE from 'three/webgpu';
import type { FenceRun, VisualPrim } from '../../shared/world/world-data';
import { hash2 } from '../../shared/world/noise';
import { battleOf } from '../../shared/world/fortifications';
import { toonFrom } from './materials';
import { worldColor } from './world-palette';

const BOARD_W = 0.64, BOARD_T = 0.14, GAP = 0.05, PEAK = 0.34;

function boardGeometry(): THREE.BufferGeometry {
  // Unit-height board (y 0..1 + peak), flat-shaded faces; scaled per instance to the fence height.
  const s = new THREE.Shape();
  const hw = (BOARD_W - GAP) / 2;
  s.moveTo(-hw, 0); s.lineTo(hw, 0); s.lineTo(hw, 1); s.lineTo(0, 1 + PEAK / 8); s.lineTo(-hw, 1); s.lineTo(-hw, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: BOARD_T, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -BOARD_T / 2);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.userData.outlineReady = true;
  return g;
}

export interface FenceView {
  boards: THREE.InstancedMesh;
  prims: VisualPrim[];
  dispose(): void;
}

export function createFenceView(runs: readonly FenceRun[], height: (x: number, z: number) => number): FenceView {
  const mats: THREE.Matrix4[] = [];
  const tints: number[] = [];
  const prims: VisualPrim[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const base = worldColor('fenceWood');
  const damage = battleOf(runs)?.fenceDamage ?? [];
  const tilt = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
  runs.forEach((f, ri) => {
    const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0);
    const dx = (f.x1 - f.x0) / len, dz = (f.z1 - f.z0) / len;
    const nx = f.face * -dz, nz = f.face * dx;               // board facing
    const yaw = Math.atan2(nx, nz);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const n = Math.floor(len / BOARD_W);
    const off = (len - n * BOARD_W) / 2;
    const gapAt = (t: number) => (f.gaps ?? []).find((g) => t >= g.t0 && t <= g.t1);
    for (let i = 0; i < n; i++) {
      const t = off + (i + 0.5) * BOARD_W;
      const x = f.x0 + dx * t + nx * 0.12, z = f.z0 + dz * t + nz * 0.12;
      const g = gapAt(t);
      const r = hash2(i, ri, 7);
      let y0 = Math.min(0, height(x, z)) - 0.3, top = f.h - 0.05 + (r - 0.5) * 0.12;
      if (g?.kind === 'open') continue;
      if (g?.kind === 'dig') y0 = g.bottom ?? 1.2;
      if (g?.kind === 'broken') top = (g.top ?? 1.5) + (hash2(i, ri, 3) - 0.3) * 0.7;
      // E4 battle damage: how hard this spot of the fence was hit (0..1)
      let dmg = 0;
      for (const d of damage) { const dd = Math.hypot(x - d.x, z - d.z); if (dd < d.r) dmg = Math.max(dmg, d.amount * (1 - dd / d.r)); }
      let v = 0.9 + r * 0.16, qq = q;
      if (dmg > 0 && !g) {
        const h1 = hash2(i, ri, 71), h2 = hash2(i, ri, 72), h3 = hash2(i, ri, 73);
        if (h1 < dmg * 0.34) top = f.h - 1.4 - 3.2 * h2;                                  // snapped short
        else if (h1 < dmg * 0.6) qq = tilt.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, (h2 - 0.5) * 0.22));   // knocked askew
        v *= 1 - dmg * (0.25 + 0.45 * h3);                                                  // scorched / weathered darker
        if (h3 < dmg * 0.5) {                                                               // bullet holes (dark, 1 cm proud)
          for (let k = 0; k < 2; k++) {
            const hy = 1.2 + hash2(i, k, ri + 74) * (Math.max(1.5, top - y0) - 1.6);
            prims.push({ s: 'box', x: x + nx * (BOARD_T / 2 + 0.01), y: y0 + hy, z: z + nz * (BOARD_T / 2 + 0.01), a: 0.14, b: 0.14, c: 0.02, yaw, col: 'soot', g: 'noink', bev: 0 });
          }
        }
        if (h2 > 1 - dmg * 0.08 && i % 3 === 0) {                                           // a plywood patch nailed over the damage
          prims.push({ s: 'box', x: x + nx * (BOARD_T / 2 + 0.05), y: 2.6 + h3 * 1.6, z: z + nz * (BOARD_T / 2 + 0.05), a: 1.9, b: 1.6, c: 0.08, yaw: yaw + 0, roll: (h1 - 0.5) * 0.2, col: 'plywood', bev: 0.02 });
        }
      }
      p.set(x, y0, z);
      sc.set(1, top - y0, 1);
      m.compose(p, qq, sc);
      mats.push(m.clone());
      tints.push(base.r * v, base.g * v, base.b * v);
    }
    // posts every ~8 m and two rails on the back side
    const back = -0.42;
    const posts = Math.max(1, Math.round(len / 8));
    for (let k = 0; k <= posts; k++) {
      const t = (len * k) / posts;
      if (gapAt(t)) continue;
      prims.push({ s: 'box', x: f.x0 + dx * t + nx * back, y: f.h / 2 - 0.1, z: f.z0 + dz * t + nz * back, a: 0.5, b: f.h + 0.2, c: 0.5, yaw, col: 'fenceDark', bev: 0.08 });
    }
    for (const ry of [2.3, f.h - 1.4]) {
      // split rails around gaps (except the upper rail over dug holes)
      let t0 = 0;
      const cuts = (f.gaps ?? []).filter((g) => !(g.kind === 'dig' && ry > (g.bottom ?? 1.2) + 0.5)).sort((a, b) => a.t0 - b.t0);
      for (const g of [...cuts, { t0: len, t1: len }]) {
        const t1 = g.t0;
        if (t1 - t0 > 0.5) {
          const tm = (t0 + t1) / 2;
          prims.push({ s: 'box', x: f.x0 + dx * tm + nx * (back + 0.05), y: ry, z: f.z0 + dz * tm + nz * (back + 0.05), a: 0.26, b: 0.55, c: t1 - t0, yaw: Math.atan2(dx, dz), col: 'fenceDark', bev: 0.06 });
        }
        t0 = g.t1;
      }
    }
    // dug-hole spoil piles on the yard side + snapped board bits for broken gaps
    for (const g of f.gaps ?? []) {
      const tm = (g.t0 + g.t1) / 2, cx = f.x0 + dx * tm, cz = f.z0 + dz * tm;
      if (g.kind === 'dig') {
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI - Math.PI / 2, d = 3.4 + (k % 2) * 0.6;
          const px = cx + nx * Math.cos(a) * d + dx * Math.sin(a) * d, pz = cz + nz * Math.cos(a) * d + dz * Math.sin(a) * d;
          prims.push({ s: 'sphere', x: px, y: height(px, pz) + 0.1, z: pz, a: 0.9 + (k % 3) * 0.3, b: 0.5, c: 0.8, col: 'dirt', g: 'soft', seg: 8 });
        }
      } else if (g.kind === 'broken') {
        for (let k = 0; k < 3; k++) {
          const px = cx + nx * (1.6 + k * 0.9) + dx * (k - 1) * 1.2, pz = cz + nz * (1.6 + k * 0.9) + dz * (k - 1) * 1.2;
          prims.push({ s: 'box', x: px, y: height(px, pz) + 0.08, z: pz, a: 0.58, b: 0.12, c: 2.2 + k * 0.5, yaw: yaw + 0.5 + k * 0.9, col: 'fenceWood', bev: 0.03 });
        }
      }
    }
  });
  const geo = boardGeometry();
  const mat = toonFrom({ vertexColors: false, surface: 'wood' });
  const boards = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((mm, i) => boards.setMatrixAt(i, mm));
  boards.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(tints), 3);
  boards.instanceMatrix.needsUpdate = true;
  boards.computeBoundingSphere();
  boards.castShadow = true;
  boards.receiveShadow = true;
  boards.name = 'fence_boards';
  boards.userData.noCameraCollide = true;
  return {
    boards, prims,
    dispose() { geo.dispose(); mat.dispose(); boards.dispose(); },
  };
}

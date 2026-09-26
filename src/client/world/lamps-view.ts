// Glowing light fixtures from WorldData.lamps (D3: the garage's hanging fluorescent tubes).
// One InstancedMesh per glow color (the garage uses one: 1 draw call for every tube), glow() material
// (unlit, > 1 so the comic pipeline's bloom picks it up, never inked). The fixture housings and chains are
// ordinary VisualPrims merged with the rest of the props. Static: no per-frame work.
// E4: the view also owns the Yard War's battle dressing (battle-dressing.ts: sodium floodlights, torn banners, camo
// nets, battle clutter), so the world view shows it without changes. `update(camera)` hands the floodlights' real
// lights around (only with `lights: true`); `quality` 'low' drops the clutter (default: the style's detail tier).
import * as THREE from 'three/webgpu';
import type { Lamp, WorldData } from '../../shared/world/world-data';
import { glow } from '../style/style-webgpu.js';
import { worldHex } from './world-palette';
import { createBattleDressing, type BattleDressingOptions } from './battle-dressing';

export interface LampsView {
  group: THREE.Group;
  stats(): Record<string, number>;
  dispose(): void;
  /** E4: per frame (optional): floodlight real-light hand-off when created with `lights: true`. */
  update(camera: THREE.Camera): void;
}

/** Tube radius (m) and glow intensity (white-ish tubes can bloom harder than hue-carrying cores). */
const TUBE_R = 0.13;
const INTENSITY = 2.2;

export function createLampsView(data: WorldData, opts: BattleDressingOptions = {}): LampsView {
  const group = new THREE.Group();
  group.name = 'lamps';
  const lamps = data.lamps ?? [];
  const byColor = new Map<string, Lamp[]>();
  for (const l of lamps) {
    const k = l.col ?? 'lampTube';
    const list = byColor.get(k);
    if (list) list.push(l); else byColor.set(k, [l]);
  }
  const geo = new THREE.CylinderGeometry(TUBE_R, TUBE_R, 1, 8, 1);
  geo.rotateX(Math.PI / 2);                                // unit tube along +Z
  const meshes: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const [col, list] of byColor) {
    const mesh = new THREE.InstancedMesh(geo, glow(worldHex(col), INTENSITY), list.length);
    list.forEach((l, i) => {
      q.setFromAxisAngle(up, l.yaw ?? 0);
      m.compose(p.set(l.x, l.y, l.z), q, s.set(1, 1, l.len));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = `lamps_${col}`;
    mesh.userData.noCameraCollide = true;
    group.add(mesh);
    meshes.push(mesh);
  }
  const dressing = createBattleDressing(data, opts);
  group.add(dressing.group);
  return {
    group,
    stats: () => ({ lamps: lamps.length, lampDraws: meshes.length, ...dressing.stats() }),
    update(camera) { dressing.update(camera); },
    dispose() {
      geo.dispose();                                       // glow() materials are shared style-cache entries
      dressing.dispose();
      group.removeFromParent();
    },
  };
}

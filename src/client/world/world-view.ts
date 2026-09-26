// OWNER: world lane. Builds the visible world from WorldData (terrain, props, sky, scatter).
// Walking-skeleton version: flat lawn + crates + simple sky color.
import * as THREE from 'three/webgpu';
import type { WorldData } from '../../shared/world/world-data';
import { toon, stylize } from '../style/style-webgpu.js';
import { PALETTE } from '../style/style-tokens.js';

export interface WorldView {
  root: THREE.Group;
  /** Meshes the camera should collide with. */
  cameraColliders: THREE.Object3D[];
  update(dt: number, camera: THREE.Camera): void;
  dispose(): void;
}

export function createWorldView(scene: THREE.Scene, data: WorldData): WorldView {
  const root = new THREE.Group();
  root.name = 'world';
  const size = data.halfExtent * 2;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2), toon({ color: PALETTE.grass }));
  ground.receiveShadow = true;
  root.add(ground);
  const props = new THREE.Group();
  for (const p of data.props) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.hx * 2, p.hy * 2, p.hz * 2), toon({ color: p.color ?? PALETTE.fenceWood }));
    m.position.set(p.x, p.y, p.z);
    m.rotation.y = p.rotY;
    m.castShadow = m.receiveShadow = true;
    props.add(m);
  }
  stylize(props);
  root.add(props);
  scene.background = new THREE.Color(PALETTE.void);
  scene.fog = new THREE.Fog(PALETTE.void, 60, 220);
  scene.add(root);
  return {
    root,
    cameraColliders: [ground, props],
    update() {},
    dispose() { scene.remove(root); },
  };
}

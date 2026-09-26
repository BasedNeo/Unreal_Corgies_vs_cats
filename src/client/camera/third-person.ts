// Third-person follow camera: spring-damped pivot, over-the-shoulder aim mode, wall avoidance.
import * as THREE from 'three/webgpu';
import { damp } from '../../shared/math';

export interface CameraRig {
  update(target: THREE.Vector3, yaw: number, pitch: number, aiming: boolean, dt: number, speed: number): void;
  shake(amount: number): void;
  /** Objects the camera must not pass through (terrain, props). Only solid meshes are tested. */
  setColliders(objects: THREE.Object3D[]): void;
}

export function createThirdPersonCamera(camera: THREE.PerspectiveCamera): CameraRig {
  const pivot = new THREE.Vector3();
  let dist = 4.2, shoulder = 0.55, fov = 62, trauma = 0, first = true;
  const ray = new THREE.Raycaster();
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3(), want = new THREE.Vector3();
  let solids: THREE.Object3D[] = [];
  const rig: CameraRig = {
    setColliders(objects) {
      solids = [];
      for (const o of objects) o.traverse((c) => {
        const m = c as THREE.Mesh & { isLineSegments2?: boolean; isInstancedMesh?: boolean };
        if (m.isMesh && !m.isLineSegments2 && !m.userData.styleInk && !m.userData.noCameraCollide) solids.push(m);
      });
    },
    shake(a) { trauma = Math.min(1, trauma + a); },
    update(target, yaw, pitch, aiming, dt, speed) {
      const pivotTarget = tmp.set(target.x, target.y + 1.25, target.z);
      if (first) { pivot.copy(pivotTarget); first = false; }
      // Follow tightly horizontally, softer vertically (hides jump bob).
      pivot.x = damp(pivot.x, pivotTarget.x, 22, dt);
      pivot.z = damp(pivot.z, pivotTarget.z, 22, dt);
      pivot.y = damp(pivot.y, pivotTarget.y, 10, dt);
      dist = damp(dist, aiming ? 2.3 : 4.2 + Math.min(1.2, speed * 0.06), 10, dt);
      shoulder = damp(shoulder, aiming ? 0.75 : 0.55, 10, dt);
      fov = damp(fov, aiming ? 48 : 62 + Math.min(8, speed * 0.5), 8, dt);
      camera.fov = fov; camera.updateProjectionMatrix();
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      // Direction from pivot to camera (behind and above the view direction).
      dir.set(Math.sin(yaw) * cp, -sp, Math.cos(yaw) * cp).normalize();
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const origin = new THREE.Vector3().copy(pivot).addScaledVector(right, shoulder);
      let d = dist;
      if (solids.length) {
        ray.set(origin, dir); ray.far = dist + 0.3;
        const hit = ray.intersectObjects(solids, false)[0];
        if (hit) d = Math.max(0.6, hit.distance - 0.3);
      }
      want.copy(origin).addScaledVector(dir, d);
      camera.position.copy(want);
      const look = new THREE.Vector3(-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp);
      camera.lookAt(tmp.copy(origin).addScaledVector(look, 20));
      if (trauma > 0) {
        const s = trauma * trauma * 0.06;
        camera.rotation.x += (Math.random() - 0.5) * s; // presentation-only randomness is fine client-side
        camera.rotation.y += (Math.random() - 0.5) * s;
        trauma = Math.max(0, trauma - dt * 2.2);
      }
    },
  };
  return rig;
}

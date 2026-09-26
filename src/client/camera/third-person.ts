// Third-person follow camera: spring-damped pivot, over-the-shoulder aim mode, wall avoidance.
import * as THREE from 'three/webgpu';
import { damp } from '../../shared/math';
import { AIM_RAY } from '../../shared/content/weapons';

/** Chase-camera overrides while driving (from vehicleCameraFor); eased in/out over ~0.3 s. */
export interface CameraVehicleParams { distance: number; height: number; fov: number; shoulder: number }

export interface CameraRig {
  update(target: THREE.Vector3, yaw: number, pitch: number, aiming: boolean, dt: number, speed: number, vehicle?: CameraVehicleParams | null): void;
  shake(amount: number): void;
  /** Objects the camera must not pass through (terrain, props). Only solid meshes are tested. */
  setColliders(objects: THREE.Object3D[]): void;
}

export function createThirdPersonCamera(camera: THREE.PerspectiveCamera): CameraRig {
  const pivot = new THREE.Vector3();
  let dist = 4.2, shoulder: number = AIM_RAY.shoulderHip, fov = 62, trauma = 0, first = true;
  const ray = new THREE.Raycaster();
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3(), want = new THREE.Vector3();
  let solids: THREE.Object3D[] = [];
  let veh = 0; // 0 on foot … 1 driving
  const lastVeh: CameraVehicleParams = { distance: 4.4, height: 1.5, fov: 64, shoulder: 0 };
  const rig: CameraRig = {
    setColliders(objects) {
      solids = [];
      for (const o of objects) o.traverse((c) => {
        const m = c as THREE.Mesh & { isLineSegments2?: boolean; isInstancedMesh?: boolean };
        if (m.isMesh && !m.isLineSegments2 && !m.userData.styleInk && !m.userData.noCameraCollide) solids.push(m);
      });
    },
    shake(a) { trauma = Math.min(1, trauma + a); },
    update(target, yaw, pitch, aiming, dt, speed, vehicle) {
      if (vehicle) Object.assign(lastVeh, vehicle);
      veh = damp(veh, vehicle ? 1 : 0, 10, dt); // ~0.3 s blend on mount/dismount
      const mix = (a: number, b: number) => a + (b - a) * veh;
      // On foot the pivot must match the authority's crosshair ray (AIM_RAY); driving uses the chase params.
      const pivotTarget = tmp.set(target.x, target.y + mix(AIM_RAY.pivotHeight, lastVeh.height), target.z);
      if (first) { pivot.copy(pivotTarget); first = false; }
      // Follow tightly horizontally, softer vertically (hides jump bob).
      pivot.x = damp(pivot.x, pivotTarget.x, 22, dt);
      pivot.z = damp(pivot.z, pivotTarget.z, 22, dt);
      pivot.y = damp(pivot.y, pivotTarget.y, 10, dt);
      const footDist = aiming ? 2.3 : 4.2 + Math.min(1.2, speed * 0.06);
      const footShoulder = aiming ? AIM_RAY.shoulderAim : AIM_RAY.shoulderHip;
      const footFov = aiming ? 48 : 62 + Math.min(8, speed * 0.5);
      dist = damp(dist, mix(footDist, lastVeh.distance), 10, dt);
      shoulder = damp(shoulder, mix(footShoulder, lastVeh.shoulder), 14, dt);
      fov = damp(fov, mix(footFov, lastVeh.fov), 8, dt);
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

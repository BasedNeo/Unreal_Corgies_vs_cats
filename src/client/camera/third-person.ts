// Third-person follow camera: spring-damped pivot, over-the-shoulder aim mode, wall avoidance.
import * as THREE from 'three/webgpu';
import { damp } from '../../shared/math';
import { AIM_RAY } from '../../shared/content/weapons';

/** Chase-camera overrides while driving (from vehicleCameraFor); eased in/out over ~0.3 s. */
export interface CameraVehicleParams { distance: number; height: number; fov: number; shoulder: number }

export interface CameraRig {
  update(target: THREE.Vector3, yaw: number, pitch: number, aiming: boolean, dt: number, speed: number, vehicle?: CameraVehicleParams | null): void;
  shake(amount: number): void;
  /** Current boom length (m) after collision — callers fade the local avatar when it gets very short. */
  readonly boom: number;
  /** Objects the camera must not pass through (terrain, props). Only solid meshes are tested. */
  setColliders(objects: THREE.Object3D[]): void;
}

/** Camera collision radius (near-plane clearance) and the closest the boom may get to the pivot. */
const CAM_RADIUS = 0.22;
const MIN_BOOM = 0.2;

export function createThirdPersonCamera(camera: THREE.PerspectiveCamera): CameraRig {
  const pivot = new THREE.Vector3();
  let dist = 4.2, shoulder: number = AIM_RAY.shoulderHip, fov = 62, aimK = 0, speedFov = 0, trauma = 0, first = true;
  const ray = new THREE.Raycaster();
  const hits: THREE.Intersection[] = []; // reused: 6 casts per frame would otherwise allocate 6 arrays
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3(), want = new THREE.Vector3();
  let solids: THREE.Object3D[] = [];
  let boom = 4.2;
  const right = new THREE.Vector3(), origin = new THREE.Vector3(), look = new THREE.Vector3();
  const up = new THREE.Vector3(), side = new THREE.Vector3(), start = new THREE.Vector3();
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
    get boom() { return boom; },
    update(target, yaw, pitch, aiming, dt, speed, vehicle) {
      if (vehicle) Object.assign(lastVeh, vehicle);
      veh = damp(veh, vehicle ? 1 : 0, 10, dt); // ~0.3 s blend on mount/dismount
      const mix = (a: number, b: number) => a + (b - a) * veh;
      // On foot the pivot is the EXACT (predicted) character position so the screen-centre ray is the same ray the
      // authority traces (AIM_RAY): no pivot damping, or the crosshair lies while strafing/jumping (QA W1).
      // Prediction + correction smoothing already make the target smooth. Driving smooths the interpolated kart.
      const pivotTarget = tmp.set(target.x, target.y + mix(AIM_RAY.pivotHeight, lastVeh.height), target.z);
      if (first || veh < 0.01) { pivot.copy(pivotTarget); first = false; }
      else {
        const k = 1 - veh; // blend from exact (on foot) to smoothed (driving)
        pivot.x = damp(pivot.x, pivotTarget.x, 22 + 200 * k, dt);
        pivot.z = damp(pivot.z, pivotTarget.z, 22 + 200 * k, dt);
        pivot.y = damp(pivot.y, pivotTarget.y, 10 + 200 * k, dt);
      }
      const footDist = aiming ? 2.3 : 4.2 + Math.min(1.2, speed * 0.06);
      const footShoulder = aiming ? AIM_RAY.shoulderAim : AIM_RAY.shoulderHip;
      // aim zoom lands in ~0.12 s (QA W1: λ8 felt sluggish); the speed kick stays gentle
      aimK = damp(aimK, aiming ? 1 : 0, 26, dt);
      speedFov = damp(speedFov, Math.min(8, speed * 0.5), 8, dt);
      const footFov = (62 + speedFov) * (1 - aimK) + 48 * aimK;
      dist = damp(dist, mix(footDist, lastVeh.distance), 10, dt);
      shoulder = damp(shoulder, mix(footShoulder, lastVeh.shoulder), 18, dt);
      fov = mix(footFov, lastVeh.fov);
      camera.fov = fov; camera.updateProjectionMatrix();
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      // Direction from pivot to camera (behind and above the view direction).
      dir.set(Math.sin(yaw) * cp, -sp, Math.cos(yaw) * cp).normalize();
      right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      // 1) Shoulder offset from the character's own centre line — pulled in if a wall is at the shoulder.
      let sh = shoulder;
      if (solids.length && sh > 0.01) {
        ray.set(pivot, right); ray.far = sh + CAM_RADIUS;
        hits.length = 0;
        const hit = ray.intersectObjects(solids, false, hits)[0];
        if (hit) sh = Math.max(0, hit.distance - CAM_RADIUS);
      }
      origin.copy(pivot).addScaledVector(right, sh);
      // 2) Boom from the shoulder back to the camera: centre ray + 4 rays offset by the camera radius (a cheap
      //    sphere cast), so the near plane never pokes through fences, walls or deck boards.
      let d = dist;
      if (solids.length) {
        up.set(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
        side.crossVectors(dir, up).normalize();
        for (let i = 0; i < 5; i++) {
          start.copy(origin);
          if (i === 1) start.addScaledVector(up, CAM_RADIUS); else if (i === 2) start.addScaledVector(up, -CAM_RADIUS);
          else if (i === 3) start.addScaledVector(side, CAM_RADIUS); else if (i === 4) start.addScaledVector(side, -CAM_RADIUS);
          ray.set(start, dir); ray.far = dist + CAM_RADIUS;
          hits.length = 0;
          const hit = ray.intersectObjects(solids, false, hits)[0];
          if (hit) d = Math.min(d, Math.max(MIN_BOOM, hit.distance - CAM_RADIUS));
        }
      }
      boom = d < boom ? d : damp(boom, d, 6, dt); // snap in instantly, ease back out
      want.copy(origin).addScaledVector(dir, boom);
      camera.position.copy(want);
      look.set(-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp);
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

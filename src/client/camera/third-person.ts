// Third-person follow camera: spring-damped pivot, over-the-shoulder aim mode, wall avoidance.
// X3: a visual recoil kick (view pitch/yaw offsets on a critically damped spring) and a short FOV punch on kills.
// Both move the RENDERED view only, after lookAt: the input yaw/pitch the client sends (and the sim aims with) and the
// AIM_RAY pivot never change, so prediction parity and the authority's hit test are untouched.
import * as THREE from 'three/webgpu';
import { damp } from '../../shared/math';
import { AIM_RAY } from '../../shared/content/weapons';

/** Chase-camera overrides while driving (from vehicleCameraFor); eased in/out over ~0.3 s. */
export interface CameraVehicleParams { distance: number; height: number; fov: number; shoulder: number }

export interface CameraRig {
  update(target: THREE.Vector3, yaw: number, pitch: number, aiming: boolean, dt: number, speed: number, vehicle?: CameraVehicleParams | null): void;
  shake(amount: number): void;
  /**
   * X3: visual recoil — kick the view up by `pitch` and sideways by `yaw` (radians), settling in about `recover` s.
   * Stacks for automatic fire but is capped, so a long burst never walks the view away. Scaled by the shake setting.
   */
  kick(pitch: number, yaw: number, recover: number): void;
  /** X3: FOV punch — zoom in by `deg` for a beat, then ease back (kill confirmation). Scaled by the shake setting. */
  punch(deg: number): void;
  /** Settings: shake strength 0..1 (0 = reduce motion) and the on-foot field of view (degrees; aiming zooms from it). */
  setShakeScale(k: number): void;
  setBaseFov(deg: number): void;
  /** Current boom length (m) after collision — callers fade the local avatar when it gets very short. */
  readonly boom: number;
  /** Objects the camera must not pass through (terrain, props). Only solid meshes are tested. */
  setColliders(objects: THREE.Object3D[]): void;
}

/** Camera collision radius (near-plane clearance) and the closest the boom may get to the pivot. */
const CAM_RADIUS = 0.22;
const MIN_BOOM = 0.2;
/** Visual kick caps (radians): an auto weapon's burst climbs to at most this, then holds. */
const KICK_MAX_PITCH = 0.05;
const KICK_MAX_YAW = 0.02;

/**
 * A critically damped 1D spring pulled back to 0 (view kick / FOV punch). impulse() adds velocity, so the offset
 * rises smoothly over a frame or two instead of snapping, then settles in ~`recover` seconds. Pure; tested in Node.
 */
export class KickSpring {
  x = 0;
  v = 0;
  /** Angular frequency (rad/s); settle time ≈ 4.7 / w. */
  w = 30;
  impulse(amount: number, recover: number): void {
    this.w = 4.7 / Math.max(0.05, recover);
    // For x(t) = A·t·e^(−wt), the peak A/(w·e) = amount → A = amount·w·e.
    this.v += amount * this.w * Math.E;
  }
  step(dt: number, cap: number): number {
    if (dt <= 0) return this.x;
    // exact solution of x'' = −w²x − 2w·x' over dt (critically damped): stable and frame-rate independent
    const w = this.w, e = Math.exp(-w * dt), c = this.v + w * this.x;
    this.x = (this.x + c * dt) * e;
    this.v = (this.v - w * c * dt) * e;
    if (this.x > cap) { this.x = cap; if (this.v > 0) this.v = 0; }
    else if (this.x < -cap) { this.x = -cap; if (this.v < 0) this.v = 0; }
    if (Math.abs(this.x) < 1e-6 && Math.abs(this.v) < 1e-5) { this.x = 0; this.v = 0; }
    return this.x;
  }
  reset(): void { this.x = 0; this.v = 0; }
}

export function createThirdPersonCamera(camera: THREE.PerspectiveCamera): CameraRig {
  const pivot = new THREE.Vector3();
  let dist = 4.2, shoulder: number = AIM_RAY.shoulderHip, fov = 62, aimK = 0, speedFov = 0, trauma = 0, first = true;
  let shakeScale = 1, baseFov = 62;
  const ray = new THREE.Raycaster();
  const hits: THREE.Intersection[] = []; // reused: 6 casts per frame would otherwise allocate 6 arrays
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3(), want = new THREE.Vector3();
  let solids: THREE.Object3D[] = [];
  let boom = 4.2;
  const right = new THREE.Vector3(), origin = new THREE.Vector3(), look = new THREE.Vector3();
  const up = new THREE.Vector3(), side = new THREE.Vector3(), start = new THREE.Vector3();
  let veh = 0; // 0 on foot … 1 driving
  const kickP = new KickSpring(), kickY = new KickSpring(), fovK = new KickSpring();
  const lastVeh: CameraVehicleParams = { distance: 4.4, height: 1.5, fov: 64, shoulder: 0 };
  const rig: CameraRig = {
    setColliders(objects) {
      solids = [];
      for (const o of objects) o.traverse((c) => {
        const m = c as THREE.Mesh & { isLineSegments2?: boolean; isInstancedMesh?: boolean };
        if (m.isMesh && !m.isLineSegments2 && !m.userData.styleInk && !m.userData.noCameraCollide) solids.push(m);
      });
    },
    shake(a) { trauma = Math.min(1, trauma + a * shakeScale); },
    kick(pitch, yaw, recover) {
      if (shakeScale <= 0) return;
      // a lighter touch in the scope: aiming already magnifies the same angle
      const k = shakeScale * (1 - aimK * 0.35);
      kickP.impulse(pitch * k, recover);
      kickY.impulse(yaw * k, recover);
    },
    punch(deg) { if (shakeScale > 0) fovK.impulse(deg * shakeScale, 0.28); },
    setShakeScale(k) { shakeScale = Math.max(0, Math.min(1, k)); if (shakeScale === 0) { trauma = 0; kickP.reset(); kickY.reset(); fovK.reset(); } },
    setBaseFov(deg) { baseFov = Math.max(55, Math.min(80, deg)); },
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
      const footFov = (baseFov + speedFov) * (1 - aimK) + (48 + (baseFov - 62) * 0.5) * aimK;
      dist = damp(dist, mix(footDist, lastVeh.distance), 10, dt);
      shoulder = damp(shoulder, mix(footShoulder, lastVeh.shoulder), 18, dt);
      fov = mix(footFov, lastVeh.fov) - fovK.step(dt, 8);
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
      // Visual recoil: rotate the rendered view about its own axes (never the input yaw/pitch).
      const kp = kickP.step(dt, KICK_MAX_PITCH), ky = kickY.step(dt, KICK_MAX_YAW);
      if (kp !== 0) camera.rotateX(kp);
      if (ky !== 0) camera.rotateY(ky);
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

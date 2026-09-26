// Rain near the camera (G1): ONE instanced draw of stretched streak quads, animated entirely in the
// vertex shader. Each instance has a static random seed in a 38 x 24 x 38 m box; the shader wraps it
// around the camera in WORLD space (fract((seed*box - camera - fall*time) / box)), so drops stay put
// while you move and never need a CPU update. Per frame the CPU writes 4 uniforms and the instance
// count (rain intensity scales how many of the pre-shuffled seeds draw): ~0.01 ms.
// Streaks are pale, translucent and not inked (an FX material like L5's particles: non-toon, so the
// outline pass skips it); they fade out with distance and near the camera so nothing strobes.
// W7 S4 (HARDENED): thin, long, sky-lit streaks (their colour follows the sky's horizon, so dusk rain is steel-grey and
// a lightning flash lights every drop), with per-drop brightness jitter; the post grade adds a faint far rain sheet.
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, positionGeometry, cameraViewMatrix, cameraProjectionMatrix, instancedBufferAttribute,
  fract, length, max, smoothstep, uv, abs, clamp,
} from 'three/tsl';
import { hash2 } from '../../shared/world/noise';
import { STYLE_ENV } from '../style/style-webgpu.js';

export interface RainView {
  mesh: THREE.Mesh;
  /** rain 0..1 intensity, wind 0..1, windDir (unit XZ), dt seconds. */
  update(camera: THREE.Camera, rain: number, wind: number, windDirX: number, windDirZ: number, dt: number): void;
  readonly drops: number;
  dispose(): void;
}

export function createRain(opts: { capacity?: number } = {}): RainView {
  const N = opts.capacity ?? 6000;
  const BOX = new THREE.Vector3(38, 24, 38);
  const seeds = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    seeds[i * 4] = hash2(i, 1, 0x7a1);
    seeds[i * 4 + 1] = hash2(i, 2, 0x7a1);
    seeds[i * 4 + 2] = hash2(i, 3, 0x7a1);
    seeds[i * 4 + 3] = Math.round((0.8 + 0.4 * hash2(i, 4, 0x7a1)) * 1000) / 1000;   // speed jitter (k/1000: exact wrap)
  }
  const plane = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plane.index;
  geo.setAttribute('position', plane.getAttribute('position'));
  geo.setAttribute('uv', plane.getAttribute('uv'));
  geo.instanceCount = 0;
  const seedAttr = new THREE.InstancedBufferAttribute(seeds, 4);
  const aSeed = instancedBufferAttribute<'vec4'>(seedAttr, 'vec4');

  const U = {
    cam: uniform(new THREE.Vector3()),
    box: uniform(BOX.clone()),
    fall: uniform(0),                      // accumulated fall distance (m), wraps via fract in the shader
    drift: uniform(new THREE.Vector2()),   // accumulated wind drift (m)
    vel: uniform(new THREE.Vector3(0, -17, 0)),
    alpha: uniform(0.4),
  };
  // world position: seed box wrapped around the camera, world-anchored
  const rel = vec3(aSeed.x.mul(U.box.x), aSeed.y.mul(U.box.y), aSeed.z.mul(U.box.z))
    .sub(U.cam)
    .add(vec3(U.drift.x.mul(aSeed.w), U.fall.negate().mul(aSeed.w), U.drift.y.mul(aSeed.w)));
  const wrapped = fract(rel.div(U.box)).sub(0.5).mul(U.box);
  const center = U.cam.add(wrapped);
  // stretched quad along the fall direction in view space (like the FX 'stretched' mode)
  const q = positionGeometry.xy;
  const viewCenter = cameraViewMatrix.mul(vec4(center, 1));
  const axV = cameraViewMatrix.mul(vec4(U.vel.mul(0.062), 0)).xy;      // ~1.1 m streak
  const axLen = max(length(axV), 0.0001);
  const along = axV.div(axLen);
  const perp = vec2(along.y, along.x.negate());
  const width = float(0.011);
  const view = viewCenter.add(vec4(along.mul(q.y.mul(axLen.add(width))).add(perp.mul(q.x.mul(width))), 0, 0));
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.name = 'fx_rain';
  mat.userData.style = 'fx';
  mat.transparent = true;
  mat.depthWrite = false;
  mat.fog = true;
  mat.vertexNode = cameraProjectionMatrix.mul(view);
  // fade: far drops (> 14 m), very near drops (< 1.2 m), and the streak's ends
  const dist = length(wrapped);
  const fade = smoothstep(19, 12, dist).mul(smoothstep(0.8, 2.2, dist));
  const ends = clamp(float(1).sub(abs(uv().y.sub(0.5)).mul(2)).mul(1.4), 0, 1);
  // sky-lit: the horizon colour lifted (drops catch the brightest part of the sky), jittered per drop
  const jitter = float(0.7).add(fract(aSeed.x.mul(91.7).add(aSeed.z.mul(37.3))).mul(0.6));
  mat.colorNode = clamp(STYLE_ENV.horizon.mul(1.9).add(vec3(0.08, 0.09, 0.11)), 0, 1.4).mul(jitter);
  mat.opacityNode = U.alpha.mul(fade).mul(ends);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx_rain';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 4;
  mesh.userData.noCameraCollide = true;

  let drops = 0;
  return {
    mesh,
    get drops() { return drops; },
    update(camera, rain, wind, dx, dz, dt) {
      drops = Math.round(N * Math.min(1, Math.max(0, rain)));
      geo.instanceCount = drops;
      mesh.visible = drops > 0;
      if (!drops) return;
      const speed = 15 + 7 * rain;                        // m/s
      const ws = 2 + 9 * wind;                            // slant
      (U.cam.value as THREE.Vector3).copy(camera.position);
      (U.vel.value as THREE.Vector3).set(dx * ws, -speed, dz * ws);
      // accumulate (mod a large period so floats stay precise)
      (U.fall as { value: number }).value = ((U.fall.value as number) + speed * dt) % (BOX.y * 1000);
      const d = U.drift.value as THREE.Vector2;
      d.set(((d.x + dx * ws * dt) % (BOX.x * 1000)), ((d.y + dz * ws * dt) % (BOX.z * 1000)));
      // high cameras (overviews, spectators) see thinner rain: near-camera streaks would fill the frame
      const high = Math.min(1, Math.max(0, (camera.position.y - 25) / 30));
      (U.alpha as { value: number }).value = (0.18 + 0.16 * rain) * (1 - 0.6 * high);
    },
    dispose() { geo.dispose(); plane.dispose(); mat.dispose(); },
  };
}

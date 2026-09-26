// Stylized sky + time of day for the yard (adapted from game-landscape-atmosphere: dayState ramps,
// fog = horizon color, low sun by default, shadows only for the near field and following the camera).
// Toon version: a gradient sky dome with a bloom-bright sun disc, flat two-tone cartoon clouds and
// night stars; the style light rig (key / rim / hemisphere from createStyleLights) is driven as the
// sun, sky rim and ambient. Palette-tinted ramps, not physical scattering.
import * as THREE from 'three/webgpu';
import {
  positionLocal, normalize, uniform, vec3, vec2, float, mix, smoothstep, max, dot, pow, step, fract, sin,
  mx_fractal_noise_float, time, floor, clamp,
} from 'three/tsl';
import { STYLE } from '../style/style-tokens.js';

type RGB = [number, number, number];
const hex = (h: number): RGB => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function ramp<T extends number | RGB>(keys: [number, T][], x: number): T {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (x <= keys[i][0]) {
    const [x0, a] = keys[i - 1], [x1, b] = keys[i], t = (x - x0) / (x1 - x0);
    return (Array.isArray(a) ? (a as RGB).map((v, k) => lerp(v, (b as RGB)[k], t)) : lerp(a as number, b as number, t)) as T;
  }
  return keys[keys.length - 1][1];
}

/** Keyed by sun elevation (deg). Colors are linear (from sRGB hex). */
export const YARD_RAMPS = {
  zenith: [[-14, hex(0x0b1430)], [-4, hex(0x26356b)], [2, hex(0x4a67a8)], [12, hex(0x3f86d8)], [40, hex(0x2f7fe0)]] as [number, RGB][],
  horizon: [[-14, hex(0x1b2a50)], [-4, hex(0x8a6f9e)], [2, hex(0xf2a37a)], [9, hex(0xf3cfa0)], [20, hex(0xb4dcf0)], [50, hex(0xa6d6f2)]] as [number, RGB][],
  sun: [[-4, hex(0xff8a4a)], [4, hex(0xffb070)], [14, hex(0xffdcae)], [30, hex(0xfff0d6)], [60, hex(0xfff6e8)]] as [number, RGB][],
  sunI: [[-5, 0], [0, 0.35], [8, 0.8], [20, 1.0], [60, 1.05]] as [number, number][],
  rim: [[-10, hex(0x6f8cff)], [0, hex(0xff9ab0)], [12, hex(0xb8d8ff)], [40, hex(0x9fd8ff)]] as [number, RGB][],
  rimI: [[-10, 0.45], [0, 0.8], [20, 1.0]] as [number, number][],
  hemiSky: [[-12, hex(0x31457a)], [0, hex(0x9d8fc4)], [12, hex(0xa8d0ea)], [40, hex(0xa8d8f0)]] as [number, RGB][],
  hemiGround: [[-12, hex(0x262018)], [0, hex(0x4c3a2c)], [20, hex(0x5a4a30)]] as [number, RGB][],
  hemiI: [[-12, 0.62], [0, 0.85], [20, 1.0]] as [number, number][],
  fogDensity: [[-12, 0.0036], [0, 0.0032], [12, 0.0024], [40, 0.0021]] as [number, number][],
  cloud: [[-12, hex(0x3a4670)], [0, hex(0xffc3a8)], [10, hex(0xfff1dc)], [30, hex(0xffffff)]] as [number, RGB][],
  cloudShade: [[-12, hex(0x222b4f)], [0, hex(0xa98bb0)], [10, hex(0xc9cfe6)], [30, hex(0xd6e4f2)]] as [number, RGB][],
};

export interface SunState {
  t: number; elevation: number; azimuth: number;
  /** Unit vector from the scene toward the sun (or moon at night). */
  dir: THREE.Vector3;
  night: boolean;
}

const MAX_ELEV = 68, AZ_OFFSET = 0.35;
/** t in [0,1): 0 midnight, 0.25 sunrise (east), 0.5 noon (south-ish, +z), 0.75 sunset (west). */
export function sunState(t: number): SunState {
  const phi = (((t % 1) + 1) % 1 - 0.25) * Math.PI * 2;
  const elevation = Math.sin(phi) * MAX_ELEV;
  const az = phi + AZ_OFFSET;
  const el = (Math.max(elevation, -10) * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
  const night = elevation < -3;
  if (night) {
    // moon: opposite side of the sky, fixed-ish height so shapes stay readable
    const mz = phi + Math.PI + AZ_OFFSET;
    dir.set(Math.cos(mz) * 0.6, 0.62, Math.sin(mz) * 0.6).normalize();
  }
  return { t, elevation, azimuth: az, dir, night };
}

export interface YardSky {
  dome: THREE.Mesh;
  sun: THREE.DirectionalLight;
  setTimeOfDay(t: number): void;
  readonly timeOfDay: number;
  update(camera: THREE.Camera, focus?: THREE.Vector3): SunState;
  dispose(): void;
}

export function createYardSky(scene: THREE.Scene, opts: { timeOfDay?: number; shadowSize?: number; shadowMap?: number } = {}): YardSky {
  // --- style light rig: reuse createStyleLights() output if the renderer added it ---
  let rig = scene.getObjectByName('style_lights') as THREE.Group | undefined;
  let ownRig = false;
  if (!rig) {
    rig = new THREE.Group(); rig.name = 'style_lights';
    rig.add(new THREE.DirectionalLight(0xffffff, 2.4), new THREE.DirectionalLight(0x9fd8ff, 1.1), new THREE.HemisphereLight(0xa8d8f0, 0x5a4a30, 1.1));
    scene.add(rig); ownRig = true;
  }
  const dirs = rig.children.filter((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight[];
  const sun = dirs[0], rim = dirs[1] ?? null;
  const hemi = rig.children.find((c) => (c as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight | undefined;
  const base = { key: STYLE.lights.key.intensity, rim: STYLE.lights.rim.intensity, amb: STYLE.lights.ambientIntensity };
  const target = new THREE.Object3D(); target.name = 'sun_target';
  scene.add(target);
  sun.target = target;
  const rimTarget = new THREE.Object3D(); scene.add(rimTarget);
  if (rim) rim.target = rimTarget;

  // Shadows: one map, orthographic box centered ahead of the camera, texel-snapped (no shimmer).
  const S = opts.shadowSize ?? 62;
  sun.castShadow = true;
  sun.shadow.mapSize.set(opts.shadowMap ?? 2048, opts.shadowMap ?? 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.near = 1; sc.far = 420;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;

  // --- sky dome ---
  const U = {
    zenith: uniform(new THREE.Color()), horizon: uniform(new THREE.Color()), sunCol: uniform(new THREE.Color()),
    sunDir: uniform(new THREE.Vector3(0, 1, 0)), night: uniform(0), cloud: uniform(new THREE.Color()), cloudShade: uniform(new THREE.Color()),
    sunVis: uniform(1),
  };
  const dir = normalize(positionLocal);
  const up = max(dir.y, 0);
  let sky = mix(U.horizon, U.zenith, pow(smoothstep(-0.02, 0.62, dir.y), float(0.8)));
  // below the horizon: fade to a darker horizon band (hidden by ground/fences mostly)
  sky = mix(sky, U.horizon.mul(0.75), smoothstep(0.0, -0.12, dir.y));
  const sd = max(dot(dir, U.sunDir), 0);
  sky = sky.add(U.sunCol.mul(pow(sd, float(24)).mul(0.09).add(pow(sd, float(160)).mul(0.22))).mul(U.sunVis));
  // cartoon clouds: flat layer, hard-edged two-tone
  const cuv = dir.xz.div(up.add(0.12)).mul(0.9).add(vec2(time.mul(0.006), time.mul(0.002)));
  const n = mx_fractal_noise_float(cuv.mul(0.55), 3, 2.0, 0.5);
  const n2 = mx_fractal_noise_float(cuv.mul(0.55).add(vec2(U.sunDir.x, U.sunDir.z).mul(0.05)), 3, 2.0, 0.5);
  const cover = smoothstep(0.03, 0.06, n.add(0.02)).mul(smoothstep(0.04, 0.22, dir.y));
  const shade = step(n2, n.sub(0.035));
  const cloudCol = mix(U.cloudShade, U.cloud, shade);
  sky = mix(sky, cloudCol, cover.mul(0.92));
  // sun disc (bright -> bloom) drawn over clouds' gaps
  const disc = smoothstep(0.9993, 0.99965, sd).mul(U.sunVis);
  sky = mix(sky, U.sunCol.mul(2.1), disc.mul(float(1).sub(cover.mul(0.85))));
  // stars at night
  const cell = floor(dir.mul(260));
  const h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  const star = step(0.9975, h).mul(U.night).mul(smoothstep(0.08, 0.35, dir.y)).mul(float(1).sub(cover));
  sky = sky.add(vec3(star.mul(1.4)));
  // Sky dome: unlit and never inked by design (like glow()); not a lit surface material.
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  mat.colorNode = clamp(sky, 0, 8);
  mat.userData.style = 'sky';
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 40, 20), mat);
  dome.name = 'sky_dome';
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.userData.noCameraCollide = true;
  scene.add(dome);

  const fog = new THREE.FogExp2(0xbfe3f4, 0.003);
  scene.fog = fog;
  scene.background = new THREE.Color(0xbfe3f4);

  let tod = opts.timeOfDay ?? 0.68;
  const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), lightSpace = new THREE.Matrix4(), inv = new THREE.Matrix4();
  const c3 = new THREE.Color();
  const setRGB = (c: THREE.Color, v: RGB) => c.setRGB(v[0], v[1], v[2]);

  function apply(s: SunState) {
    const e = s.elevation;
    setRGB(U.zenith.value as THREE.Color, ramp(YARD_RAMPS.zenith, e));
    setRGB(U.horizon.value as THREE.Color, ramp(YARD_RAMPS.horizon, e));
    setRGB(U.sunCol.value as THREE.Color, ramp(YARD_RAMPS.sun, e));
    setRGB(U.cloud.value as THREE.Color, ramp(YARD_RAMPS.cloud, e));
    setRGB(U.cloudShade.value as THREE.Color, ramp(YARD_RAMPS.cloudShade, e));
    (U.night as { value: number }).value = s.night ? 1 : 0;
    (U.sunVis as { value: number }).value = s.night ? 0.25 : 1;
    // true sun direction for the sky even at night (moon handled by the light only)
    const trueDir = sunState(s.t);
    const el = (Math.max(trueDir.elevation, -10) * Math.PI) / 180;
    (U.sunDir.value as THREE.Vector3).set(Math.cos(trueDir.azimuth) * Math.cos(el), Math.sin(el), Math.sin(trueDir.azimuth) * Math.cos(el));
    if (s.night) (U.sunDir.value as THREE.Vector3).copy(s.dir);
    setRGB(sun.color, s.night ? hex(0x9db4ff) : ramp(YARD_RAMPS.sun, e));
    sun.intensity = base.key * (s.night ? 0.32 : ramp(YARD_RAMPS.sunI, e));
    if (rim) { setRGB(rim.color, ramp(YARD_RAMPS.rim, e)); rim.intensity = base.rim * ramp(YARD_RAMPS.rimI, e); }
    if (hemi) {
      setRGB(hemi.color, ramp(YARD_RAMPS.hemiSky, e));
      setRGB(hemi.groundColor, ramp(YARD_RAMPS.hemiGround, e));
      hemi.intensity = base.amb * ramp(YARD_RAMPS.hemiI, e);
    }
    setRGB(c3, ramp(YARD_RAMPS.horizon, e));
    fog.color.copy(c3).lerp(new THREE.Color().setRGB(...ramp(YARD_RAMPS.zenith, e)), 0.12);
    baseFog = ramp(YARD_RAMPS.fogDensity, e);
    fog.density = baseFog;
    (scene.background as THREE.Color).copy(fog.color);
  }
  let state = sunState(tod);
  let baseFog = 0.003;
  apply(state);

  return {
    dome, sun,
    get timeOfDay() { return tod; },
    setTimeOfDay(t: number) { tod = ((t % 1) + 1) % 1; state = sunState(tod); apply(state); },
    update(camera, focus) {
      dome.position.copy(camera.position);
      // less aerial haze when looking down from high up (overviews), full haze at player height
      fog.density = baseFog * Math.max(0.5, Math.min(1, 1 - (camera.position.y - 12) / 130));
      // shadow box centered ~35 m ahead of the camera on the ground (or at the given focus)
      const hgt = Math.max(0, camera.position.y);
      const box = Math.min(150, S + hgt * 0.9);
      if (box !== sc.right) { sc.left = -box; sc.right = box; sc.top = box; sc.bottom = -box; sc.far = 420 + hgt * 2; sc.updateProjectionMatrix(); }
      if (focus) tmp.copy(focus);
      else {
        camera.getWorldDirection(fwd);
        const dy = fwd.y;
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
        fwd.normalize();
        // where the view ray meets the ground (high cameras), else a point ahead of a low camera
        const ahead = dy < -0.05 ? Math.min(hgt / -dy * Math.sqrt(Math.max(0, 1 - dy * dy)), box * 1.1) : Math.min(box * 0.55, 35);
        tmp.copy(camera.position).addScaledVector(fwd, Math.max(ahead, Math.min(box * 0.55, 35))); tmp.y = 0;
      }
      // texel snapping in light space
      const texel = (2 * box) / sun.shadow.mapSize.x;
      lightSpace.lookAt(new THREE.Vector3(0, 0, 0), state.dir.clone().negate(), new THREE.Vector3(0, 1, 0));
      inv.copy(lightSpace).invert();
      tmp.applyMatrix4(inv);
      tmp.x = Math.round(tmp.x / texel) * texel; tmp.y = Math.round(tmp.y / texel) * texel;
      tmp.applyMatrix4(lightSpace);
      target.position.copy(tmp);
      sun.position.copy(tmp).addScaledVector(state.dir, 200);
      target.updateMatrixWorld();
      rimTarget.position.copy(tmp);
      if (rim) rim.position.copy(tmp).add(new THREE.Vector3(-state.dir.x, 0.35, -state.dir.z).normalize().multiplyScalar(100));
      return state;
    },
    dispose() {
      scene.remove(dome); scene.remove(target); scene.remove(rimTarget);
      dome.geometry.dispose(); mat.dispose();
      if (ownRig) scene.remove(rig!);
      sun.castShadow = false;
      if (scene.fog === fog) scene.fog = null;
    },
  };
}

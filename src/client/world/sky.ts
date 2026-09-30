// Stylized sky + time of day for the yard (adapted from game-landscape-atmosphere: dayState ramps,
// fog = horizon color, low sun by default, shadows only for the near field and following the camera).
// Toon version: a gradient sky dome with a bloom-bright sun disc, flat two-tone cartoon clouds and
// night stars; the style light rig (key / rim / hemisphere from createStyleLights) is driven as the
// sun, sky rim and ambient. Palette-tinted ramps, not physical scattering.
// G1 weather: setWeather() blends the ramps toward overcast/storm greys (luminance-preserving, then
// dimmed), thickens the cartoon cloud layer, hides the sun disc, dims + cools the key light, flattens
// light into the hemisphere, thickens and greys the fog, and draws lightning: a whole-sky flash plus
// a jagged comic bolt at the strike's bearing (bloom-bright). All smooth: inputs are blended values.
// W7 S4 (HARDENED): the battle mood. Ramps re-keyed to a desaturated dusk (warm low key, cool rim, slate sky, haze);
// the sun arc tops out at STYLE.mood.sunMaxElevation so the light always rakes; clear weather keeps broken cloud
// (STYLE.mood.minCloud); clouds are soft layered billows with dark undersides instead of flat cartoon puffs; the fog is
// a node (distance exp² + a ground haze that pools in low ground, thicker in rain); and the sky drives the style's
// shared uniforms: STYLE_ENV (reflection colours for wet ground/metal) and STYLE_WEATHER (wet, rain, dark).
// W10 P5: the sky also drives the exposure (STYLE_EXPOSURE, from YARD_RAMPS.exposure: P4's dusk lift at low sun, in storm
// and at night, back to the pre-P4 exposure by day) and hands the world's interiors to the style (setStyleInteriors), so
// its fill light stays out of tunnels and containers.
import * as THREE from 'three/webgpu';
import {
  positionLocal, normalize, uniform, vec3, vec2, float, mix, smoothstep, max, dot, pow, step, fract, sin,
  mx_fractal_noise_float, time, floor, clamp, abs, positionWorld, cameraPosition, length, exp, fog as fogOf,
} from 'three/tsl';
import { STYLE } from '../style/style-tokens.js';
import { STYLE_ENV, STYLE_WEATHER, STYLE_EXPOSURE, setStyleInteriors, styleInteriors } from '../style/style-webgpu.js';

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

/** Keyed by sun elevation (deg). Colors are linear (from sRGB hex). HARDENED: a desaturated dusk at every hour. */
export const YARD_RAMPS = {
  zenith: [[-14, hex(0x080c18)], [-4, hex(0x1a2238)], [2, hex(0x2e3a52)], [12, hex(0x3d5068)], [40, hex(0x46607c)]] as [number, RGB][],
  horizon: [[-14, hex(0x121828)], [-4, hex(0x4a4658)], [2, hex(0xb07a58)], [9, hex(0xb89274)], [20, hex(0x98a0a4)], [50, hex(0x9aa8b2)]] as [number, RGB][],
  sun: [[-4, hex(0xff7a3e)], [4, hex(0xff9c58)], [14, hex(0xffbe84)], [30, hex(0xffd8ae)], [60, hex(0xffe8cc)]] as [number, RGB][],
  sunI: [[-5, 0], [0, 0.4], [8, 0.85], [20, 1.0], [60, 1.02]] as [number, number][],
  rim: [[-10, hex(0x4e64a8)], [0, hex(0x8a8cc8)], [12, hex(0x86a6d8)], [40, hex(0x8fb0da)]] as [number, RGB][],
  // W9 P4 sky fill: the anti-sun "rim" light is the dusk sky's fill for everything seen against the low sun (backlit
  // views: deck, flank). Strongest while the sun is low (×2.5 at t = 0.74), back to the old level by mid-afternoon;
  // was [[-10, 0.5], [0, 0.9], [20, 1.0]].
  // W10 P5: back to the base level by 18 deg (was [16, 1.6], [30, 1.1]), so the afternoon (t = 0.68, e = 18 deg) is lit as
  // before P4; the dusk keys (e <= 6) are P4's.
  rimI: [[-10, 0.6], [-3, 1.2], [0, 2.2], [6, 2.4], [12, 1.6], [18, 1.0], [42, 1.0]] as [number, number][],
  // W9 P4: the fill's height (the up component of its direction, was a fixed 0.35 ≈ 19°): near-horizontal while the sun
  // is low (≈ 3°), like the anti-sun horizon glow, so it lights the faces turned from the sun and grazes the ground.
  // At 19° the strong dusk fill washed the floodlit sodium pools out to cream (saturation 0.58 → 0.38, The Lot's pit).
  rimUp: [[-10, 0.35], [-3, 0.35], [0, 0.05], [8, 0.05], [20, 0.35]] as [number, number][],
  // W10 P5 exposure by time of day: a multiplier on STYLE.grade.exposure (1.25, P4's dusk value; STYLE_EXPOSURE). P4's
  // global 1.25 made daytime ~18 % brighter than pre-P4 (noon overview luma 104 -> 123) and washed out bright moments.
  // 1 while the sun is low (the dusk lift at t = 0.74, e = 2.6 deg) and at night; by day 0.78 (1.25 x 0.78 = 0.975: the
  // pre-P4 exposure, less the ~2 % P4's lighter vignette adds). A storm keeps the lift at any hour (apply: lerp to 1 by
  // the weather's storm).
  exposure: [[-3, 1], [6, 1], [16, 0.78], [42, 0.78]] as [number, number][],
  hemiSky: [[-12, hex(0x243052)], [0, hex(0x6a6a8c)], [12, hex(0x74849c)], [40, hex(0x8092a8)]] as [number, RGB][],
  hemiGround: [[-12, hex(0x16130f)], [0, hex(0x2c241b)], [20, hex(0x3a3024)]] as [number, RGB][],
  hemiI: [[-12, 0.6], [0, 0.82], [20, 0.95]] as [number, number][],
  fogDensity: [[-12, 0.0042], [0, 0.0042], [12, 0.0036], [40, 0.0034]] as [number, number][],
  cloud: [[-12, hex(0x262c44)], [0, hex(0xb07e6c)], [10, hex(0xb8a494)], [30, hex(0xa9b0b8)]] as [number, RGB][],
  cloudShade: [[-12, hex(0x10142a)], [0, hex(0x3e3548)], [10, hex(0x505662)], [30, hex(0x5a6470)]] as [number, RGB][],
};

export interface SunState {
  t: number; elevation: number; azimuth: number;
  /** Unit vector from the scene toward the sun (or moon at night). */
  dir: THREE.Vector3;
  night: boolean;
}

// HARDENED: the sun never climbs above STYLE.mood.sunMaxElevation (was 68): raking light, long shadows, all day.
const MAX_ELEV = STYLE.mood.sunMaxElevation, AZ_OFFSET = 0.35;
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

/** Weather inputs for the sky (the blended values of a WeatherSample). */
export interface SkyWeather {
  cloud: number; rain: number; storm: number; fog: number; dark: number;
  /** Lightning flash 0..1 and the bearing (math angle in XZ) + power of the bolt, if any. */
  flash: number; boltBearing: number; boltPower: number; boltSeed: number;
}
/** setWeather() input: the sky weather plus, optionally, the ground wetness (the style's wet sheen; without it the
 *  look estimates wetness from rain). */
export type SkyWeatherIn = SkyWeather & { wet?: number };
export const CLEAR_SKY: SkyWeather = { cloud: 0.18, rain: 0, storm: 0, fog: 0, dark: 0, flash: 0, boltBearing: 0, boltPower: 0, boltSeed: 0 };

const OVERCAST_ZENITH = hex(0x5a6572), OVERCAST_HORIZON = hex(0x8c949c);
const STORM_ZENITH = hex(0x222932), STORM_HORIZON = hex(0x444c56);
const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** Blend `base` toward a grey of the same luminance (tinted by `tint`), then dim. */
function weatherTint(base: RGB, tint: RGB, amount: number, dim: number): RGB {
  const k = amount <= 0 ? 0 : Math.min(1, amount);
  const lb = lum(base), lt = Math.max(1e-4, lum(tint));
  const out = base.map((v, i) => lerp(v, tint[i] * (lb / lt), k) * (1 - dim)) as RGB;
  return out;
}

export interface YardSky {
  dome: THREE.Mesh;
  sun: THREE.DirectionalLight;
  setTimeOfDay(t: number): void;
  readonly timeOfDay: number;
  /** G1: weather look (cloud cover, greys, fog, lightning). */
  setWeather(w: SkyWeatherIn): void;
  update(camera: THREE.Camera, focus?: THREE.Vector3): SunState;
  dispose(): void;
}

export function createYardSky(scene: THREE.Scene, opts: {
  timeOfDay?: number; shadowSize?: number; shadowMap?: number; clouds?: boolean;
  /** W9 L3: fog density × this (maps larger than the West Yard see proportionally farther) */ fogScale?: number;
  /** W10 P5: WorldData.interiors, boxes the sky fill does not reach (tunnels, containers); set on the style while this sky lives */
  interiors?: { min: [number, number, number]; max: [number, number, number] }[];
} = {}): YardSky {
  const fogScale = opts.fogScale ?? 1;
  const interiors = setStyleInteriors(opts.interiors ?? []);
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
  if (rim) { rim.target = rimTarget; rim.userData.skyFill = true; } // W10 P5: the fill; interiors shut it out

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
    coverBias: uniform(0.02), flash: uniform(0), boltDir: uniform(new THREE.Vector2(1, 0)), bolt: uniform(0), boltSeed: uniform(0),
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
  const withClouds = opts.clouds !== false;
  const n = withClouds ? mx_fractal_noise_float(cuv.mul(0.55), 3, 2.0, 0.5) : float(-1);
  const n2 = withClouds ? mx_fractal_noise_float(cuv.mul(0.55).add(vec2(U.sunDir.x, U.sunDir.z).mul(0.05)), 3, 2.0, 0.5) : float(-1);
  // HARDENED: soft-edged billows (wider coverage ramp) lit on the sun side, dark undersides, a second darker scud layer
  const cover = withClouds ? smoothstep(-0.02, 0.1, n.add(U.coverBias)).mul(smoothstep(0.02, 0.2, dir.y)) : float(0);
  const shade = smoothstep(-0.05, 0.05, n.sub(n2).sub(0.012));
  const thick = smoothstep(0.02, 0.3, n.add(U.coverBias));
  const cloudCol = mix(mix(U.cloudShade, U.cloud, shade), U.cloudShade.mul(0.7), thick.mul(0.55));
  if (withClouds) sky = mix(sky, cloudCol, cover.mul(0.95));
  // sun disc (bright -> bloom) drawn over clouds' gaps
  const disc = smoothstep(0.9993, 0.99965, sd).mul(U.sunVis);
  sky = mix(sky, U.sunCol.mul(2.1), disc.mul(float(1).sub(cover.mul(0.85))));
  // stars at night
  const cell = floor(dir.mul(260));
  const h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  const star = step(0.9975, h).mul(U.night).mul(smoothstep(0.08, 0.35, dir.y)).mul(float(1).sub(cover));
  sky = sky.add(vec3(star.mul(1.4)));
  // lightning: whole-sky flash (lavender white) + a jagged comic bolt at the strike bearing
  const flashCol = vec3(0.86, 0.88, 1.0);
  sky = sky.add(flashCol.mul(U.flash.mul(0.32).mul(float(0.35).add(up))));
  const hxz = normalize(dir.xz.add(vec2(1e-5, 0)));
  const across = hxz.x.mul(U.boltDir.y).sub(hxz.y.mul(U.boltDir.x));
  const facing = step(0, hxz.x.mul(U.boltDir.x).add(hxz.y.mul(U.boltDir.y)));
  // continuous jagged line: sum of two triangle waves of the elevation (no sawtooth jumps)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL node types are too narrow for helpers
  const tri = (x: any) => abs(fract(x).sub(0.5)).mul(2).sub(0.5);
  const zig = tri(dir.y.mul(7).add(U.boltSeed)).mul(0.06).add(tri(dir.y.mul(19).add(U.boltSeed.mul(3.7))).mul(0.02));
  const inBand = smoothstep(-0.01, 0.03, dir.y).mul(float(1).sub(smoothstep(0.38, 0.46, dir.y)));
  const core = smoothstep(0.011, 0.003, abs(across.sub(zig)));
  const halo = smoothstep(0.06, 0.0, abs(across.sub(zig))).mul(0.3);
  sky = sky.add(flashCol.mul(core.mul(4.5).add(halo)).mul(facing).mul(inBand).mul(U.bolt));
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

  const fog = new THREE.FogExp2(0x6b7482, 0.004);
  scene.fog = fog;
  scene.background = new THREE.Color(0x6b7482);
  // Fog node (HARDENED): distance exp² (the FogExp2 above holds colour + density) plus a ground haze that pools in
  // low ground and thickens with rain/fog, so depth reads in layers. Every fogged material evaluates it (a few ALU).
  const FU = { color: uniform(fog.color), density: uniform(0.004), haze: uniform(STYLE.mood.haze), hazeTop: uniform(STYLE.mood.hazeHeight) };
  const dist = length(positionWorld.sub(cameraPosition));
  const fExp = float(1).sub(exp(FU.density.mul(dist).pow(2).negate()));
  // haze layer density exp(-y/H), integrated along the view ray (camera at hc, surface at y0): the mean layer density on
  // the path is H * |e(y0) - e(hc)| / |hc - y0|, so a high camera looks down THROUGH the layer (overviews stay readable)
  // while ground-level views get the full mist between them and the far side of the yard.
  const y0 = max(positionWorld.y, float(0)), hc = max(cameraPosition.y, float(0));
  const e0 = exp(y0.div(FU.hazeTop).negate()), e1 = exp(hc.div(FU.hazeTop).negate());
  const layer = FU.hazeTop.mul(abs(e0.sub(e1))).div(max(abs(hc.sub(y0)), float(0.05)));
  const hazeF = float(1).sub(exp(dist.mul(FU.density).mul(2).mul(layer).negate())).mul(FU.haze);
  scene.fogNode = fogOf(FU.color, float(1).sub(float(1).sub(fExp).mul(float(1).sub(hazeF))).clamp(0, 1));

  let tod = opts.timeOfDay ?? 0.68;
  let wx: SkyWeatherIn = { ...CLEAR_SKY };
  const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), lightSpace = new THREE.Matrix4(), inv = new THREE.Matrix4();
  const c3 = new THREE.Color();
  const setRGB = (c: THREE.Color, v: RGB) => c.setRGB(v[0], v[1], v[2]);

  function apply(s: SunState) {
    const e = s.elevation;
    // battle mood: clear weather still keeps broken cloud (visual only; gameplay weather is untouched)
    const W = { ...wx, cloud: Math.max(wx.cloud, STYLE.mood.minCloud) };
    const grey = Math.min(1, Math.max(0, (W.cloud - 0.2) / 0.7));              // overcast amount
    const storm = W.storm;
    const tintZ = STORM_ZENITH.map((v, i) => lerp(OVERCAST_ZENITH[i], v, storm)) as RGB;
    const tintH = STORM_HORIZON.map((v, i) => lerp(OVERCAST_HORIZON[i], v, storm)) as RGB;
    const dimSky = 0.78 * W.dark;
    setRGB(U.zenith.value as THREE.Color, weatherTint(ramp(YARD_RAMPS.zenith, e), tintZ, grey * 0.92, dimSky));
    const horizon = weatherTint(ramp(YARD_RAMPS.horizon, e), tintH, grey * 0.9, dimSky * 0.8);
    setRGB(U.horizon.value as THREE.Color, horizon);
    setRGB(U.sunCol.value as THREE.Color, ramp(YARD_RAMPS.sun, e));
    setRGB(U.cloud.value as THREE.Color, weatherTint(ramp(YARD_RAMPS.cloud, e), tintH, grey * 0.8, W.dark * 0.45));
    setRGB(U.cloudShade.value as THREE.Color, weatherTint(ramp(YARD_RAMPS.cloudShade, e), tintZ, grey * 0.85, W.dark * 0.55));
    (U.coverBias as { value: number }).value = 0.02 + 0.62 * Math.max(0, W.cloud - 0.18) / 0.82;
    (U.night as { value: number }).value = s.night ? 1 - grey : 0;
    const sunVis = (s.night ? 0.25 : 1) * (1 - 0.95 * Math.min(1, Math.max(0, (W.cloud - 0.45) / 0.4)));
    (U.sunVis as { value: number }).value = sunVis;
    // true sun direction for the sky even at night (moon handled by the light only)
    const trueDir = sunState(s.t);
    const el = (Math.max(trueDir.elevation, -10) * Math.PI) / 180;
    (U.sunDir.value as THREE.Vector3).set(Math.cos(trueDir.azimuth) * Math.cos(el), Math.sin(el), Math.sin(trueDir.azimuth) * Math.cos(el));
    if (s.night) (U.sunDir.value as THREE.Vector3).copy(s.dir);
    // key light: dimmer and cooler under cloud; the hemisphere carries the flat overcast light
    const keyCol = s.night ? hex(0x9db4ff) : ramp(YARD_RAMPS.sun, e);
    setRGB(sun.color, weatherTint(keyCol, hex(0xc8d2dc), grey * 0.7, 0));
    sun.intensity = base.key * (s.night ? 0.32 : ramp(YARD_RAMPS.sunI, e)) * (1 - 0.85 * W.dark) + base.key * 0.6 * W.flash;
    if (rim) { setRGB(rim.color, ramp(YARD_RAMPS.rim, e)); rim.intensity = base.rim * ramp(YARD_RAMPS.rimI, e) * (1 - 0.45 * W.dark); }
    rimUp = ramp(YARD_RAMPS.rimUp, e);
    // W10 P5: exposure follows the sun (P4's dusk lift at low sun and at night, pre-P4 by day); storms keep the lift
    (STYLE_EXPOSURE as { value: number }).value = lerp(ramp(YARD_RAMPS.exposure, s.night ? -10 : e), 1, Math.min(1, Math.max(0, storm)));
    if (hemi) {
      const hs = weatherTint(ramp(YARD_RAMPS.hemiSky, e), tintH, grey * 0.85, W.dark * 0.35);
      setRGB(hemi.color, hs.map((v, i) => lerp(v, [0.8, 0.84, 1.0][i], Math.min(1, W.flash))) as RGB);
      setRGB(hemi.groundColor, ramp(YARD_RAMPS.hemiGround, e));
      hemi.intensity = base.amb * ramp(YARD_RAMPS.hemiI, e) * (1 + 0.12 * grey - 0.55 * W.dark) + base.amb * 1.25 * W.flash;
    }
    setRGB(c3, horizon);
    const zen = weatherTint(ramp(YARD_RAMPS.zenith, e), tintZ, grey * 0.92, dimSky);
    // aerial perspective: distance tints toward the sky's blue, not a beige-green wall (L2 critique)
    fog.color.copy(c3).lerp(new THREE.Color().setRGB(...zen), 0.3).multiplyScalar(1 - 0.3 * storm);
    fog.color.lerp(new THREE.Color(0xc9d0e4), Math.min(1, W.flash * 0.3));
    wxFog = 1 + 1.5 * W.fog + 0.8 * W.rain;
    baseFog = ramp(YARD_RAMPS.fogDensity, e) * wxFog * fogScale;
    fog.density = baseFog;
    (FU.density as { value: number }).value = baseFog;
    (scene.background as THREE.Color).copy(fog.color);
    (FU.color.value as THREE.Color).copy(fog.color);
    (FU.haze as { value: number }).value = Math.min(0.8, STYLE.mood.haze * (1 + 1.2 * W.fog + 0.8 * W.rain) * (s.night ? 0.6 : 1));
    // style uniforms: reflection colours (what wet ground and metal mirror) and the weather of the look
    const zc = STYLE_ENV.zenith.value as THREE.Color, hc = STYLE_ENV.horizon.value as THREE.Color, gc = STYLE_ENV.ground.value as THREE.Color;
    zc.setRGB(zen[0], zen[1], zen[2]);
    hc.setRGB(horizon[0], horizon[1], horizon[2]).lerp(new THREE.Color(0xc9d0e4), Math.min(1, W.flash * 0.6));
    const hg = ramp(YARD_RAMPS.hemiGround, e);
    gc.setRGB(hg[0], hg[1], hg[2]).multiplyScalar(0.6);
    (STYLE_WEATHER.wet as { value: number }).value = W.wet ?? Math.min(1, W.rain * 2.5);
    (STYLE_WEATHER.rain as { value: number }).value = W.rain;
    (STYLE_WEATHER.dark as { value: number }).value = W.dark;
    (U.flash as { value: number }).value = W.flash;
    (U.bolt as { value: number }).value = W.boltPower;
    (U.boltDir.value as THREE.Vector2).set(Math.cos(W.boltBearing), Math.sin(W.boltBearing));
    (U.boltSeed as { value: number }).value = W.boltSeed;
  }
  let rimUp = 0.35; // the fill's height (YARD_RAMPS.rimUp), set by apply()
  let state = sunState(tod);
  let baseFog = 0.003;
  let wxFog = 1; // the weather's fog multiplier (apply)
  apply(state);

  return {
    dome, sun,
    get timeOfDay() { return tod; },
    setTimeOfDay(t: number) { tod = ((t % 1) + 1) % 1; state = sunState(tod); apply(state); },
    setWeather(w: SkyWeatherIn) { wx = w; apply(state); },
    update(camera, focus) {
      dome.position.copy(camera.position);
      // less aerial haze when looking down from high up (overviews), full haze at player height
      // W10 P5: a camera far above the ground also sees through the weather's extra fog: the floor of this factor falls
      // with wxFog ^ STYLE.mood.highFog.wx (rain and storm), so the storm overview reads its structure; low cameras
      // (players, the lineups) keep the full weather
      const H = STYLE.mood.highFog;
      fog.density = baseFog * Math.max(H.floor / Math.pow(wxFog, H.wx), Math.min(1, 1 - (camera.position.y - H.from) / H.span));
      (FU.density as { value: number }).value = fog.density;
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
      if (rim) rim.position.copy(tmp).add(new THREE.Vector3(-state.dir.x, rimUp, -state.dir.z).normalize().multiplyScalar(100));
      return state;
    },
    dispose() {
      scene.remove(dome); scene.remove(target); scene.remove(rimTarget);
      dome.geometry.dispose(); mat.dispose();
      if (ownRig) scene.remove(rig!);
      sun.castShadow = false;
      if (scene.fog === fog) scene.fog = null;
      if (scene.fogNode) scene.fogNode = null;
      if (styleInteriors() === interiors) setStyleInteriors([]); // only its own (a newer sky may have set its world's)
    },
  };
}

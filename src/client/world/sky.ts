// The night sky, fog and light rig for every map (docs/design/LOOK.md: stylised-realistic, the locked night).
// W13: the web takes the Godot build's night [engines/godot/look/: night_sky.gdshader, look.gd _build_environment]:
//   - the dome: a blue-black zenith over a low cold-slate cloud deck lit from above by a hidden moon (brighter around it
//     and at its thin edges), through the breaks a darker sky, faint stars and the moon's disc, the horizon a cold haze;
//     static (no drifting clouds);
//   - the rig (createStyleLights): the moon as the key (cool, weak, shadow-mapped, no specular), a weak sky fill, the
//     hemisphere light as Godot's ambient (half the sky, half a cold moonlit fill colour, energy 1.6);
//   - fog: exponential (Godot's density on The Lot, scaled by the map size), the horizon haze's colour, plus Godot's
//     height mist; high cameras see through more of it (STYLE.night.highFog);
//   - the style's shared uniforms: STYLE_ENV (what wet ground and metal mirror), STYLE_WEATHER (wet, rain, dark),
//     STYLE_EXPOSURE (1: the exposure is STYLE.grade.exposure), the world's interiors (setStyleInteriors).
// The look is locked: time of day is kept as an API (setTimeOfDay / timeOfDay, the authority's schedule) but does not
// change the image. The weather still does: storms darken the sky and the lights, rain and fog thicken the fog, cloud
// cover thickens the deck, lightning flashes the sky and draws a bolt at the strike's bearing.
// The HARDENED dusk (time-of-day ramps, sun disc, cartoon cloud billows) is retired.
import * as THREE from 'three/webgpu';
import {
  positionLocal, normalize, uniform, vec3, vec2, float, mix, smoothstep, max, dot, pow, step, fract, floor,
  mx_fractal_noise_float, clamp, abs, positionWorld, cameraPosition, length, exp, min, fog as fogOf,
} from 'three/tsl';
import { STYLE } from '../style/style-tokens.js';
import { STYLE_ENV, STYLE_WEATHER, STYLE_EXPOSURE, setStyleInteriors, styleInteriors } from '../style/style-webgpu.js';

type RGB = [number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Linear RGB of a Godot `source_color` triplet (sRGB). */
const lin = (c: readonly number[]): RGB => { const k = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); return [k.r, k.g, k.b]; };
const add = (a: RGB, b: RGB, k = 1): RGB => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const N = STYLE.night;
/**
 * The locked night, resolved to linear colours (the dome's uniforms) and the derived values the rig and the reflections
 * use: `skyAvg` ≈ the radiance an up-facing surface sees from the sky (the lit deck), `ambient` = Godot's ambient (half
 * the sky, half the cold fill colour), `ground` = the ambient from below (half the fill colour, half the dark ground).
 */
export const NIGHT = (() => {
  const zenith = lin(N.sky.zenith), horizon = lin(N.sky.horizon), cloudLit = lin(N.sky.cloudLit), cloudDark = lin(N.sky.cloudDark);
  const deckMid = scale(mixRGB(cloudDark, cloudLit, 0.45), 1.1);            // a typical deck, a little moonlight
  const skyAvg = mixRGB(mixRGB(horizon, zenith, 0.5), deckMid, Math.min(1, N.sky.cloudCover + 0.15));
  const fill = lin(N.ambient.color), k = N.ambient.skyContribution;
  return {
    zenith, horizon, cloudLit, cloudDark, deckMid, skyAvg,
    moonDisc: lin(N.sky.moon), star: lin(N.sky.star),
    ambient: mixRGB(fill, skyAvg, k),
    ground: mixRGB(fill, scale(skyAvg, 0.15), k),
    /** what a reflection sees straight down: the dark wet ground */
    below: scale(skyAvg, 0.12),
    fog: lin(N.fog.color),
    moonDir: new THREE.Vector3(...N.moon.dir).normalize(),
    moonColor: lin(N.moon.color),
    fillColor: lin(N.fill.color),
  };
})();

export interface SunState {
  t: number; elevation: number; azimuth: number;
  /** Unit vector from the scene toward the sun (or moon at night). */
  dir: THREE.Vector3;
  night: boolean;
}

const MAX_ELEV = 42, AZ_OFFSET = 0.35;
/**
 * The sun's position at time of day t in [0,1) (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset), for callers that
 * reason about the schedule. The locked night's lights do not follow it (createYardSky lights from the moon).
 */
export function sunState(t: number): SunState {
  const phi = (((t % 1) + 1) % 1 - 0.25) * Math.PI * 2;
  const elevation = Math.sin(phi) * MAX_ELEV;
  const az = phi + AZ_OFFSET;
  const el = (Math.max(elevation, -10) * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
  const night = elevation < -3;
  if (night) {
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
/** setWeather() input: the sky weather plus, optionally, the ground wetness (without it the look estimates wetness
 *  from rain; the materials never go below STYLE.wet.floor anyway). */
export type SkyWeatherIn = SkyWeather & { wet?: number };
export const CLEAR_SKY: SkyWeather = { cloud: 0.18, rain: 0, storm: 0, fog: 0, dark: 0, flash: 0, boltBearing: 0, boltPower: 0, boltSeed: 0 };

export interface YardSky {
  dome: THREE.Mesh;
  /** The key light: the moon (kept under its old name). */
  sun: THREE.DirectionalLight;
  setTimeOfDay(t: number): void;
  readonly timeOfDay: number;
  /** Weather look (cloud cover, darkness, fog, lightning). */
  setWeather(w: SkyWeatherIn): void;
  update(camera: THREE.Camera, focus?: THREE.Vector3): SunState;
  dispose(): void;
}

export function createYardSky(scene: THREE.Scene, opts: {
  /** Kept for the API (the authority's schedule); the locked night does not change with it. */ timeOfDay?: number;
  shadowSize?: number; shadowMap?: number; clouds?: boolean;
  /** W9 L3: the map's fog scale (world-view: 118 / (edge + 1)); The Lot's (STYLE.night.fog.lotScale) gets Godot's density */ fogScale?: number;
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
    const key = new THREE.DirectionalLight(0xffffff, 1), fill = new THREE.DirectionalLight(0xffffff, 0.3);
    key.userData.diffuseOnly = true; fill.userData.diffuseOnly = true;
    rig.add(key, fill, new THREE.HemisphereLight(0xffffff, 0x000000, 1));
    scene.add(rig); ownRig = true;
  }
  const dirs = rig.children.filter((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight[];
  const sun = dirs[0], fill = dirs[1] ?? null;
  const hemi = rig.children.find((c) => (c as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight | undefined;
  const E = STYLE.energyScale;
  const target = new THREE.Object3D(); target.name = 'sun_target';
  scene.add(target);
  sun.target = target;
  const fillTarget = new THREE.Object3D(); scene.add(fillTarget);
  if (fill) { fill.target = fillTarget; fill.userData.skyFill = true; } // W10 P5: interiors shut the fill out

  // Shadows (the moon's): one map, orthographic box centred ahead of the camera, texel-snapped (no shimmer).
  const S = opts.shadowSize ?? 62;
  sun.castShadow = true;
  sun.shadow.mapSize.set(opts.shadowMap ?? 2048, opts.shadowMap ?? 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.near = 1; sc.far = 420;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;

  // --- sky dome [godot night_sky.gdshader] ---
  const col3 = (c: RGB) => uniform(new THREE.Color(c[0], c[1], c[2]));
  const U = {
    zenith: col3(NIGHT.zenith), horizon: col3(NIGHT.horizon), cloudLit: col3(NIGHT.cloudLit), cloudDark: col3(NIGHT.cloudDark),
    moonCol: col3(NIGHT.moonDisc), starCol: col3(NIGHT.star), fogCol: col3(NIGHT.fog), moonDir: uniform(NIGHT.moonDir.clone()),
    cover: uniform(N.sky.cloudCover), energy: uniform(N.sky.energy),
    flash: uniform(0), boltDir: uniform(new THREE.Vector2(1, 0)), bolt: uniform(0), boltSeed: uniform(0),
  };
  const dir = normalize(positionLocal);
  const up = clamp(dir.y, 0, 1);
  const m = max(dot(dir, U.moonDir), 0);
  // the sky above the deck (seen through the breaks): blue-black overhead, a cold haze low down
  const base = mix(U.horizon, U.zenith, pow(up, float(0.4)));
  const withClouds = opts.clouds !== false;
  // the deck: a flat layer, projected. Godot samples a seamless 0..1 noise texture at uv * 0.07 and uv * 0.23 (about 4
  // noise periods per tile): the same frequencies from fractal noise remapped to 0..1
  const cuv = dir.xz.div(up.add(0.12));
  const n = withClouds
    ? mx_fractal_noise_float(cuv.mul(0.29).add(vec2(0.13, 0.71)), 4, 2.0, 0.5).mul(0.5).add(0.5).mul(0.65)
      .add(mx_fractal_noise_float(cuv.mul(0.94), 3, 2.0, 0.5).mul(0.5).add(0.5).mul(0.35))
    : float(0.6);
  const lo = float(0.85).sub(U.cover);
  let cover = withClouds ? smoothstep(lo, lo.add(0.3), n) : float(1);
  // a break drifts across the moon; the deck closes towards the horizon (no breaks low down, no stars on the skyline)
  cover = cover.mul(mix(float(1), smoothstep(0.35, 0.75, n), smoothstep(0.985, 0.998, m)));
  cover = mix(float(1), cover, smoothstep(0.03, 0.3, up));
  const thin = float(1).sub(clamp(n.sub(lo).mul(2.2), 0, 1));             // thin edges let more moonlight through
  const glowM = pow(m, float(6)).mul(0.6).add(pow(m, float(40)).mul(1.4));  // the moon's patch on the deck
  let deck = mix(U.cloudDark, U.cloudLit, clamp(thin.mul(0.6).add(glowM.mul(0.5)), 0, 1)).mul(glowM.add(1));
  deck = mix(deck, U.horizon, float(1).sub(smoothstep(0.0, 0.18, up)));  // the deck's far edge sinks into the haze
  // the break: night sky, faint stars, the moon (a small soft disc and its corona)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL node types are too narrow for reassignment
  let clear: any = base.mul(pow(m, float(10)).mul(2).add(1));
  clear = clear.add(U.moonCol.mul(smoothstep(0.99982, 0.99992, m).mul(N.sky.moonEnergy).add(pow(m, float(300)).mul(0.08 * N.sky.moonEnergy))));
  // sparse faint stars on a lattice of the view direction (static; about 1 px each at 1280 x 720)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL node types are too narrow for helpers
  const hash13 = (q: any): any => { const r: any = fract(q.mul(0.1031)); const r2: any = r.add(dot(r, r.zyx.add(31.32))); return fract(r2.x.add(r2.y).mul(r2.z)); };
  const sp = dir.mul(260), sc0 = floor(sp), sh = hash13(sc0);
  const so = vec3(hash13(sc0.add(7.1)), hash13(sc0.add(13.7)), hash13(sc0.add(29.3))).mul(0.6).add(0.2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const star: any = step(0.97, sh).mul(smoothstep(0.35, 0.0, length(sp.sub(sc0).sub(so)))).mul(sh.sub(0.97).div(0.03));
  clear = clear.add(U.starCol.mul(star.mul(N.sky.starEnergy)).mul(smoothstep(0.1, 0.35, up)));
  let sky = mix(clear, deck, cover);
  const belowSky = mix(U.horizon, U.horizon.mul(0.35), clamp(dir.y.mul(-4), 0, 1));
  sky = mix(sky, belowSky, step(dir.y, 0)).mul(U.energy);
  // the fog's sky affect [godot fog_sky_affect]
  sky = mix(sky, U.fogCol, N.fog.skyAffect);
  // lightning: whole-sky flash (lavender white) + a jagged bolt at the strike bearing
  const flashCol = vec3(0.86, 0.88, 1.0);
  sky = sky.add(flashCol.mul(U.flash.mul(0.22).mul(float(0.35).add(up))));
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
  // Sky dome: unlit by design (like glow()); not a lit surface material.
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  mat.colorNode = clamp(sky, 0, 8);
  mat.userData.style = 'sky';
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 40, 20), mat);
  dome.name = 'sky_dome';
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.userData.noCameraCollide = true;
  scene.add(dome);

  // --- fog [godot: exponential + height mist, aerial perspective] ---
  const fogBase = N.fog.density * fogScale / N.fog.lotScale;
  // Godot's aerial perspective mixes 30 % of the sky behind into the fog: low down that is the same horizon haze
  const fogColor = new THREE.Color().setRGB(...mixRGB(NIGHT.fog, NIGHT.horizon, N.fog.aerial));
  const fog = new THREE.FogExp2(fogColor.getHex(), fogBase);   // holds colour + density for readers of scene.fog
  scene.fog = fog;
  scene.background = new THREE.Color().copy(fogColor);
  const FU = { color: uniform(fog.color), density: uniform(fogBase), height: uniform(N.fog.height), heightDensity: uniform(N.fog.heightDensity) };
  const dist = length(positionWorld.sub(cameraPosition));
  const fExp = float(1).sub(exp(FU.density.mul(dist).negate()));
  const fHeight = float(1).sub(exp(min(float(0), positionWorld.y.sub(FU.height).mul(FU.heightDensity))));
  scene.fogNode = fogOf(FU.color, max(fExp, fHeight).clamp(0, 1));

  let tod = opts.timeOfDay ?? 0.68;
  let wx: SkyWeatherIn = { ...CLEAR_SKY };
  const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), lightSpace = new THREE.Matrix4(), inv = new THREE.Matrix4();
  const state: SunState = { t: tod, elevation: (Math.asin(NIGHT.moonDir.y) * 180) / Math.PI, azimuth: Math.atan2(NIGHT.moonDir.z, NIGHT.moonDir.x), dir: NIGHT.moonDir.clone(), night: true };
  const setRGB = (c: THREE.Color, v: RGB) => c.setRGB(v[0], v[1], v[2]);
  const flashTint = (v: RGB, k: number): RGB => mixRGB(v, [0.8, 0.84, 1.0], Math.min(1, k));

  function apply() {
    const W = wx;
    const dark = Math.min(1, Math.max(0, W.dark));
    const dim = 1 - 0.6 * dark;
    (U.cover as { value: number }).value = Math.min(0.95, Math.max(N.sky.cloudCover, W.cloud));
    (U.energy as { value: number }).value = N.sky.energy * dim;
    // the rig: the moon, the fill, the ambient (Godot energies × energyScale)
    setRGB(sun.color, NIGHT.moonColor);
    sun.intensity = N.moon.energy * E * (1 - 0.85 * dark) + N.moon.energy * E * 2 * W.flash;
    if (fill) { setRGB(fill.color, NIGHT.fillColor); fill.intensity = N.fill.energy * E * (1 - 0.45 * dark); }
    if (hemi) {
      setRGB(hemi.color, flashTint(NIGHT.ambient, W.flash * 0.5));
      setRGB(hemi.groundColor, NIGHT.ground);
      hemi.intensity = N.ambient.energy * E * (1 - 0.55 * dark) + N.ambient.energy * E * W.flash;
    }
    (STYLE_EXPOSURE as { value: number }).value = 1;
    // fog: thicker in rain and fog, a touch darker in a storm, lighter in a flash
    wxFog = 1 + 1.5 * W.fog + 0.8 * W.rain;
    baseFog = fogBase * wxFog;
    fog.density = baseFog;
    (FU.density as { value: number }).value = baseFog;
    fog.color.copy(fogColor).multiplyScalar(1 - 0.3 * dark).lerp(new THREE.Color(0xc9d0e4), Math.min(1, W.flash * 0.3));
    (scene.background as THREE.Color).copy(fog.color);
    (FU.color.value as THREE.Color).copy(fog.color);
    // what wet ground and metal mirror: the lit cloud deck above, the cold horizon haze, the dark ground
    setRGB(STYLE_ENV.zenith.value as THREE.Color, scale(NIGHT.deckMid, dim));
    setRGB(STYLE_ENV.horizon.value as THREE.Color, flashTint(scale(NIGHT.horizon, dim), W.flash * 0.6));
    setRGB(STYLE_ENV.ground.value as THREE.Color, NIGHT.below);
    (STYLE_WEATHER.wet as { value: number }).value = W.wet ?? Math.min(1, W.rain * 2.5);
    (STYLE_WEATHER.rain as { value: number }).value = W.rain;
    (STYLE_WEATHER.dark as { value: number }).value = W.dark;
    (U.flash as { value: number }).value = W.flash;
    (U.bolt as { value: number }).value = W.boltPower;
    (U.boltDir.value as THREE.Vector2).set(Math.cos(W.boltBearing), Math.sin(W.boltBearing));
    (U.boltSeed as { value: number }).value = W.boltSeed;
  }
  let baseFog = fogBase;
  let wxFog = 1; // the weather's fog multiplier (apply)
  apply();

  return {
    dome, sun,
    get timeOfDay() { return tod; },
    setTimeOfDay(t: number) { tod = ((t % 1) + 1) % 1; state.t = tod; },
    setWeather(w: SkyWeatherIn) { wx = w; apply(); },
    update(camera, focus) {
      dome.position.copy(camera.position);
      // a camera far above the ground (overviews) sees through more of the fog; the floor falls with the weather's fog
      // multiplier, so the storm overview reads its structure; low cameras (players, the lineups) keep the full fog
      const H = N.highFog;
      fog.density = baseFog * Math.max(H.floor / Math.pow(wxFog, H.wx), Math.min(1, 1 - (camera.position.y - H.from) / H.span));
      (FU.density as { value: number }).value = fog.density;
      // shadow box centred ~35 m ahead of the camera on the ground (or at the given focus)
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
      fillTarget.position.copy(tmp);
      if (fill) fill.position.copy(tmp).add(new THREE.Vector3(-state.dir.x, N.fill.up, -state.dir.z).normalize().multiplyScalar(100));
      return state;
    },
    dispose() {
      scene.remove(dome); scene.remove(target); scene.remove(fillTarget);
      dome.geometry.dispose(); mat.dispose();
      if (ownRig) scene.remove(rig!);
      sun.castShadow = false;
      if (scene.fog === fog) scene.fog = null;
      if (scene.fogNode) scene.fogNode = null;
      if (styleInteriors() === interiors) setStyleInteriors([]); // only its own (a newer sky may have set its world's)
    },
  };
}

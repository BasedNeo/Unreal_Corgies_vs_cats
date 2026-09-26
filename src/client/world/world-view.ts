// OWNER: world lane (L2 + G1). Builds the visible West Yard from WorldData:
//   terrain (grid-exact toon ground) · props (merged VisualPrims, ink + creases) · board fences ·
//   water · near-field foliage with wind · stylized sky + time of day + fog + camera-following sun shadow
//   · G1: The Garden's tall grass + sprinkler jets · weather (sky/fog/light ramps, rain streaks, wet
//   ground + puddles, lightning, wind) driven by the server tick · D3: glowing lamps (garage tubes).
// cameraColliders are invisible low-poly proxies (collider boxes/cylinders + a coarse terrain) so the
// third-person camera raycasts stay cheap. Budget target: <= 250 world draw calls, <= 1 M visible tris.
//
// Clock (G1): pass the server tick to update(dt, camera, tick) — e.g. net.renderTime(now) * net.tickHz,
// the same timebase remote entities are drawn at (serverNow()*tickHz also works). With a tick the view
// follows weatherAt(seed, tick) and timeOfDayAt(seed, tick) exactly like the authority (and the garden
// sprinklers' jets match the authority's shoves). Without a tick it behaves like L2 (clear weather,
// setTimeOfDay/daySpeed). setTimeOfDay() pins the time of day (URL ?t=); pinTimeOfDay(false) unpins.
// setWeather(kind | partial sample | null) overrides the weather look (labs, menus); null follows the clock.
import * as THREE from 'three/webgpu';
import type { Bookmark, WorldData } from '../../shared/world/world-data';
import { timeOfDayAt, weatherAt, WEATHER_PARAMS, type WeatherKind, type WeatherSample } from '../../shared/world/weather';
import { TICK_HZ } from '../../shared/constants';
import { createTerrainMaterial, WORLD_WEATHER } from './materials';
import { createTerrainView, createColliderProxy } from './terrain-view';
import { buildPrimMeshes, disposePrimMeshes } from './prim-mesh';
import { createFenceView } from './fence-view';
import { createWaterView } from './water-view';
import { createFoliage } from './foliage';
import { createYardSky, type SkyWeather } from './sky';
import { createRain } from './weather-view';
import { createGardenView } from './garden-view';
import { QUALITY, toQualityTier, type QualityTier } from '../engine/quality';
import { createLampsView } from './lamps-view';
import { createDestructView, type DestructView } from './destruct-view';
import { surfaceAt } from '../../shared/world/queries';

/** Post grade uniforms (createComicPipeline(...).grade.uniforms) the weather may desaturate. */
export interface GradeUniforms { saturation: { value: number } }

export interface WorldViewOptions {
  /** Quality tier. low: no foliage, 1024 shadow map, cloudless sky, flat ground shading (headless /
   *  SwiftShader / integrated GPUs); med: 60% foliage, 1536 shadows; high (default): everything. */
  quality?: 'low' | 'med' | 'high';
  /** 0..1 time of day (0 midnight, .25 sunrise, .5 noon, .75 sunset). Default: WorldData.timeOfDay or 0.68. */
  timeOfDay?: number;
  /** Game-time day speed in days per real second (0 = frozen, the default). Ignored while a tick drives the view. */
  daySpeed?: number;
  /** Foliage density multiplier; overrides the tier (low 0, med 0.6, high 1). */
  foliageDensity?: number;
  shadowMapSize?: number;
  /** Ink hull on the terrain (silhouette lines on hills). */
  terrainInk?: boolean;
  /** G1: the comic pipeline's grade uniforms, so storms can desaturate the frame (optional). */
  grade?: GradeUniforms;
  /** G1: rain streak capacity (default 6000 high, 3500 med, 2000 low). */
  rainDrops?: number;
}

export interface WorldView {
  root: THREE.Group;
  /** Meshes the camera should collide with. */
  cameraColliders: THREE.Object3D[];
  /** `tick` (G1, optional): the server tick (float ok) that drives weather, time of day and sprinklers. */
  update(dt: number, camera: THREE.Camera, tick?: number): void;
  dispose(): void;
  // ---- L2 additions ----
  /** Sets the time of day and pins it (the tick no longer moves it) until pinTimeOfDay(false). */
  setTimeOfDay(t: number): void;
  readonly timeOfDay: number;
  bookmarks: Bookmark[];
  stats(): Record<string, number>;
  // ---- G1 additions ----
  /** Override the weather look: a state, a partial sample merged over the clock's, or null (follow the clock). */
  setWeather(w: WeatherKind | Partial<WeatherSample> | null): void;
  /** The weather sample used for the last update (feed it to the weather audio / HUD). */
  readonly weather: WeatherSample;
  /** The tick the view last rendered (NaN before the first tick-driven update). */
  readonly tick: number;
  pinTimeOfDay(pinned: boolean): void;
  /** P2: live part of a quality-tier change (garden density, prop crease ink); the rest of the world knobs apply after a reload. */
  setQuality(tier: QualityTier): void;
  // ---- X1 additions ----
  /** Breakable props (breach wall, tuna/crate stacks): feed it snapshot states (sync) and game events (onGameEvent). */
  destruct: DestructView;
}

const EPS = 0.0015;

export function createWorldView(scene: THREE.Scene, data: WorldData, opts: WorldViewOptions = {}): WorldView {
  const root = new THREE.Group();
  root.name = 'world';

  const q = opts.quality ?? 'high';
  const P = QUALITY[toQualityTier(q)];                  // world knobs of the tier (engine/quality.ts)
  const terrainMat = createTerrainMaterial({ ink: opts.terrainInk ?? false, detail: P.terrainDetail });
  const terrain = createTerrainView(data, terrainMat.material);
  root.add(terrain.group);

  const fence = data.fences?.length ? createFenceView(data.fences, data.height) : null;
  if (fence) root.add(fence.boards);
  const props = buildPrimMeshes([...(data.prims ?? []), ...(fence?.prims ?? [])]);
  root.add(props.group);
  // crease ink is built in every tier and only hidden on low, so the tier can switch live
  const setPropCreases = (on: boolean) => { for (const m of props.meshes) for (const c of m.children) if (c.userData.styleInk) c.visible = on; };
  setPropCreases(P.propCreases);

  const water = createWaterView(data);
  root.add(water.group);

  const density = opts.foliageDensity ?? P.foliageDensity;
  const foliage = data.surface && density > 0 ? createFoliage(data, { density }) : null;
  if (foliage) root.add(foliage.group);

  const garden = createGardenView(data, { density: P.gardenDensity });
  root.add(garden.group);
  // E4: lamps + the battle dressing; S4 floodlights get real spot lights (the tier's budget, moved to the nearest each frame)
  const lamps = createLampsView(data, { quality: q, lights: true });
  root.add(lamps.group);
  // X1: destructibles (their looks are not in data.prims; debris lands on whatever surface is below it)
  const destruct = createDestructView(data, { surfaceAt: (x, z, below) => surfaceAt(data, x, z, below).y });
  destruct.setCreases(P.propCreases);
  root.add(destruct.group, destruct.cameraGroup);
  const rain = createRain({ capacity: opts.rainDrops ?? P.rainDrops });
  root.add(rain.mesh);

  const proxy = createColliderProxy(data);
  root.add(terrain.proxy, proxy.group);

  const sky = createYardSky(scene, {
    timeOfDay: opts.timeOfDay ?? data.timeOfDay ?? 0.68,
    shadowMap: opts.shadowMapSize ?? P.shadowMapSize,
    clouds: P.clouds,
  });
  scene.add(root);

  let daySpeed = opts.daySpeed ?? 0;
  let pinned = opts.timeOfDay !== undefined;
  let clock = NaN;                          // server tick (NaN until a tick-driven update)
  let override: WeatherKind | Partial<WeatherSample> | null = null;
  const sample: WeatherSample = weatherAt(data.seed, 0);
  const applied: SkyWeather = { cloud: -1, rain: 0, storm: 0, fog: 0, dark: 0, flash: 0, boltBearing: 0, boltPower: 0, boltSeed: 0 };
  const baseSat = opts.grade?.saturation.value ?? 1;
  const windDir = new THREE.Vector2(0.8, 0.45).normalize();
  let rainMs = 0, weatherMs = 0;

  function resolveWeather(): void {
    if (Number.isFinite(clock)) weatherAt(data.seed, clock, sample);
    else Object.assign(sample, WEATHER_PARAMS.clear, { kind: 'clear', from: 'clear', to: 'clear', blend: 0, flash: 0, strike: null });
    if (override) {
      if (typeof override === 'string') {
        Object.assign(sample, WEATHER_PARAMS[override], { kind: override, from: override, to: override, blend: 0 });
        if (override !== 'storm') { sample.flash = 0; sample.strike = null; }
      } else Object.assign(sample, override);
    }
  }

  function applyWeather(dt: number, camera: THREE.Camera): void {
    const w = sample;
    const st = w.strike;
    const boltPower = st && w.flash > 0.05 && st.dist < 950 ? Math.min(1, w.flash * 1.4) : 0;
    const next: SkyWeather = {
      cloud: w.cloud, rain: w.rain, storm: w.storm, fog: w.fog, dark: w.dark, flash: w.flash,
      boltBearing: st ? st.bearing : 0, boltPower, boltSeed: st ? (st.id % 97) * 0.173 : 0,
    };
    let changed = false;
    for (const k of Object.keys(next) as (keyof SkyWeather)[]) if (Math.abs(next[k] - applied[k]) > EPS) { changed = true; break; }
    if (changed) { Object.assign(applied, next); sky.setWeather({ ...next }); }
    (WORLD_WEATHER.wet as { value: number }).value = w.wet;
    (WORLD_WEATHER.rain as { value: number }).value = w.rain;
    (WORLD_WEATHER.wind as { value: number }).value = 1 + 2.4 * Math.max(0, w.wind - 0.22);
    if (opts.grade) opts.grade.saturation.value = baseSat * (1 - 0.55 * w.dark - 0.1 * Math.max(0, w.cloud - 0.2));
    const r0 = performance.now();
    rain.update(camera, w.rain, w.wind, windDir.x, windDir.y, dt);
    rainMs += (performance.now() - r0 - rainMs) * 0.05;          // EMA, for stats()/perf proofs
  }

  return {
    root,
    cameraColliders: [terrain.proxy, proxy.group, destruct.cameraGroup],
    destruct,
    bookmarks: data.bookmarks ?? [],
    get timeOfDay() { return sky.timeOfDay; },
    get weather() { return sample; },
    get tick() { return clock; },
    setTimeOfDay(t: number) { pinned = true; sky.setTimeOfDay(t); },
    pinTimeOfDay(p: boolean) { pinned = p; },
    setQuality(tier: QualityTier) { garden.setDensity(QUALITY[tier].gardenDensity); setPropCreases(QUALITY[tier].propCreases); destruct.setCreases(QUALITY[tier].propCreases); },
    setWeather(w) { override = w; },
    update(dt, camera, tick) {
      if (tick !== undefined && Number.isFinite(tick)) clock = tick;
      else if (Number.isFinite(clock)) clock += dt * TICK_HZ;      // free-run between tick-driven frames
      if (Number.isFinite(clock) && !pinned) {
        const t = timeOfDayAt(data.seed, clock);
        // re-ramp the sky/lights only every ~1e-4 day (~0.14 s real, 0.04 deg of sun): no per-frame churn
        const d = Math.abs(t - sky.timeOfDay);
        if (Math.min(d, 1 - d) > 1e-4) sky.setTimeOfDay(t);
      } else if (daySpeed && !Number.isFinite(clock)) sky.setTimeOfDay(sky.timeOfDay + dt * daySpeed);
      const w0 = performance.now();
      resolveWeather();
      applyWeather(dt, camera);
      if (Number.isFinite(clock)) garden.update(clock, dt);
      weatherMs += (performance.now() - w0 - weatherMs) * 0.05;
      sky.update(camera);
      lamps.update(camera);
      foliage?.update(camera);
    },
    stats() {
      return {
        terrainTriangles: terrain.triangles,
        propTriangles: props.stats.triangles,
        propMeshes: props.stats.meshes,
        prims: props.stats.prims,
        fenceBoards: fence?.boards.count ?? 0,
        rainDrops: rain.drops,
        rainCpuMs: +rainMs.toFixed(4),
        weatherCpuMs: +weatherMs.toFixed(4),
        ...garden.stats(),
        ...lamps.stats(),
        ...destruct.stats(),
        ...(foliage?.stats() ?? {}),
      };
    },
    dispose() {
      daySpeed = 0;
      scene.remove(root);
      terrain.dispose();
      terrainMat.material.dispose();
      disposePrimMeshes(props);
      fence?.dispose();
      water.dispose();
      foliage?.dispose();
      garden.dispose();
      lamps.dispose();
      destruct.dispose();
      rain.dispose();
      proxy.dispose();
      sky.dispose();
      if (opts.grade) opts.grade.saturation.value = baseSat;
      for (const k of ['wet', 'rain'] as const) (WORLD_WEATHER[k] as { value: number }).value = 0;
      (WORLD_WEATHER.wind as { value: number }).value = 1;
    },
  };
}

// W10 P5 (the look calls fixed with data), without a GPU:
// - the exposure follows the sky's time of day (STYLE_EXPOSURE): P4's dusk lift at low sun, at night and in storm,
//   the pre-P4 exposure by day;
// - WorldData.interiors keep the sky fill (and the character rim + fill) out of tunnels and containers: the style's
//   interior boxes, the fill light's flag, the CPU twin of the shader test, and The Lot's boxes against its geometry;
// - the storm overview: a camera far above the ground sees through more of the rain fog than one at player height.
import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  STYLE_EXPOSURE, STYLE_INTERIORS, setStyleInteriors, styleInteriors, interiorOpenAt, createStyleLights, toonMaterial,
  HardenedToonMaterial,
} from '../../src/client/style/style-webgpu.js';
import { STYLE } from '../../src/client/style/style-tokens.js';
import { YARD_RAMPS, createYardSky, sunState, CLEAR_SKY } from '../../src/client/world/sky';
import { createWorldData } from '../../src/shared/world/world-data';
import { LOT_PIPES, lotInteriors } from '../../src/shared/world/the-lot';
import { pipeFacets } from '../../src/shared/world/lot/pipes';
import { CONTAINER, CONTAINERS, PIPE } from '../../src/shared/world/lot/layout';
import { WEATHER_PARAMS } from '../../src/shared/world/weather';

const at = (keys: [number, number][], x: number) => {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (x <= keys[i][0]) { const [x0, a] = keys[i - 1], [x1, b] = keys[i]; return a + ((b - a) * (x - x0)) / (x1 - x0); }
  return keys[keys.length - 1][1];
};
type V3 = [number, number, number];
const box = (min: V3, max: V3) => ({ min, max });

afterEach(() => { setStyleInteriors([]); });

describe('P5 the storm overview sees through the rain (high cameras only)', () => {
  it('a camera far above the ground gets less of the weather\'s extra fog; player height and clear skies are unchanged', () => {
    const scene = new THREE.Scene();
    const sky = createYardSky(scene, { clouds: false });
    sky.setTimeOfDay(0.74);
    const cam = new THREE.PerspectiveCamera();
    const density = (y: number) => { cam.position.set(0, y, 0); cam.updateMatrixWorld(); sky.update(cam); return (scene.fog as THREE.FogExp2).density; };
    const clearLow = density(1.7), clearHigh = density(114);
    expect(clearHigh / clearLow).toBeCloseTo(STYLE.mood.highFog.floor, 6);          // clear: the old floor
    const s = WEATHER_PARAMS.storm;
    sky.setWeather({ ...CLEAR_SKY, cloud: s.cloud, rain: s.rain, storm: s.storm, fog: s.fog, dark: s.dark });
    const stormLow = density(1.7), stormHigh = density(114), wxFog = 1 + 1.5 * s.fog + 0.8 * s.rain;
    expect(stormLow / clearLow).toBeCloseTo(wxFog, 6);                                // at player height the storm is full
    expect(stormHigh / stormLow).toBeCloseTo(STYLE.mood.highFog.floor / Math.pow(wxFog, STYLE.mood.highFog.wx), 6);
    expect(stormHigh).toBeLessThan(stormLow * 0.35);
    expect(density(72) / stormLow).toBeCloseTo(1 - (72 - 12) / 130, 6);              // the West Yard overview (72 m): unchanged
    sky.dispose();
  });
});

describe('P5 exposure follows the time of day', () => {
  const dusk = sunState(0.74).elevation, start = sunState(0.68).elevation, noon = sunState(0.5).elevation;

  it('the ramp keeps the dusk lift at low sun and at night, and brings the day back to the pre-P4 exposure (1.0)', () => {
    const k = YARD_RAMPS.exposure;
    expect(dusk).toBeLessThan(4);
    expect(at(k, dusk)).toBe(1);                                     // t = 0.74: P4's 1.25 stays
    expect(at(k, -10)).toBe(1);                                      // night keeps P4's lift
    for (const e of [start, noon]) {
      expect(STYLE.grade.exposure * at(k, e)).toBeGreaterThanOrEqual(0.9);
      expect(STYLE.grade.exposure * at(k, e)).toBeLessThanOrEqual(1.05);  // pre-P4 was 1.0: daytime is not re-lit
    }
    for (let e = 6; e < 42; e += 1) expect(at(k, e + 1)).toBeLessThanOrEqual(at(k, e) + 1e-9); // falls as the sun climbs
    expect(Math.max(...k.map((x) => x[1]))).toBeLessThanOrEqual(1);  // never above P4's dusk exposure
  });

  it('the sky writes STYLE_EXPOSURE: 1 at dusk, the day value at noon, 1 again in a storm at noon', () => {
    const sky = createYardSky(new THREE.Scene(), { clouds: false });
    sky.setTimeOfDay(0.74);
    expect(STYLE_EXPOSURE.value).toBeCloseTo(1, 6);
    sky.setTimeOfDay(0.5);
    expect(STYLE_EXPOSURE.value).toBeCloseTo(at(YARD_RAMPS.exposure, noon), 6);
    expect(STYLE_EXPOSURE.value).toBeLessThan(0.9);
    const storm = WEATHER_PARAMS.storm;
    sky.setWeather({ ...CLEAR_SKY, cloud: storm.cloud, rain: storm.rain, storm: storm.storm, fog: storm.fog, dark: storm.dark });
    expect(STYLE_EXPOSURE.value).toBeCloseTo(1, 6);                  // a storm is dark at any hour: the lift stays
    sky.setWeather({ ...CLEAR_SKY });
    expect(STYLE_EXPOSURE.value).toBeLessThan(0.9);
    sky.dispose();
  });
});

describe('P5 interiors: the style side', () => {
  it('setStyleInteriors fills the uniform array (min/max ordered), counts, clamps to the budget, and returns its list', () => {
    const list = [box([1, 2, 3], [4, 5, 6]), box([10, 0, 10], [-10, 3, -10])];
    expect(setStyleInteriors(list)).toBe(list);
    expect(styleInteriors()).toBe(list);
    expect(STYLE_INTERIORS.count.value).toBe(2);
    const a = STYLE_INTERIORS.boxes.array as THREE.Vector4[];
    expect(a.length).toBe(2 * STYLE.interior.max);
    expect(a[0].toArray().slice(0, 3)).toEqual([1, 2, 3]);
    expect(a[3].toArray().slice(0, 3)).toEqual([10, 3, 10]);
    expect(a[2].toArray().slice(0, 3)).toEqual([-10, 0, -10]);
    const many = Array.from({ length: STYLE.interior.max + 5 }, (_, i) => box([i, 0, 0], [i + 1, 1, 1]));
    setStyleInteriors(many);
    expect(STYLE_INTERIORS.count.value).toBe(STYLE.interior.max);
    setStyleInteriors(null);
    expect(STYLE_INTERIORS.count.value).toBe(0);
    expect(a.every((v) => v.lengthSq() === 0)).toBe(true);
  });

  it('the sky hands its world interiors to the style and clears only its own on dispose', () => {
    const mine = [box([0, 0, 0], [5, 5, 5])];
    const a = createYardSky(new THREE.Scene(), { clouds: false, interiors: mine });
    expect(styleInteriors()).toBe(mine);
    expect(STYLE_INTERIORS.count.value).toBe(1);
    const b = createYardSky(new THREE.Scene(), { clouds: false });  // a newer world (no interiors) takes over
    expect(STYLE_INTERIORS.count.value).toBe(0);
    const theirs = setStyleInteriors([box([9, 9, 9], [10, 10, 10])]);
    a.dispose();                                                      // the old sky must not clear the newer list
    expect(styleInteriors()).toBe(theirs);
    b.dispose();
  });

  it('only the fill light (the sky\'s anti-sun directional) is flagged; the rig is still key + fill + hemisphere', () => {
    const g = createStyleLights();
    const lights = g.children.filter((o) => (o as THREE.Light).isLight) as THREE.Light[];
    expect(lights.length).toBe(3);
    expect(lights.filter((l) => l.userData.skyFill).length).toBe(1);
    expect((lights.find((l) => l.userData.skyFill) as THREE.DirectionalLight).isDirectionalLight).toBe(true);
    expect(lights[0].userData.skyFill).toBeFalsy();                  // the key (sun) keeps its shadow-mapped light
  });

  it('every hardened material hands the lighting model its open factor; no program key changes (no new variants)', () => {
    const m = toonMaterial({ color: 0x808080 }) as HardenedToonMaterial;
    const key = m.customProgramCacheKey();
    const lm = (m as unknown as { setupLightingModel(): { open: unknown } }).setupLightingModel();
    expect('open' in lm).toBe(true);
    expect(key).toBe((toonMaterial({ color: 0x808080 }) as HardenedToonMaterial).customProgramCacheKey());
  });

  it('the CPU twin: a surface facing into a box is shut, one facing out of it is open, a mouth feathers in', () => {
    const I = STYLE.interior;
    expect(I.probe).toBeGreaterThan(I.feather);                      // an inner wall on a box face is fully shut
    const b = [box([0, 0, 0], [4, 4, 10])];
    expect(interiorOpenAt([0, 2, 5], [1, 0, 0], b)).toBe(0);         // inner wall on the x = 0 face, facing in
    expect(interiorOpenAt([-0.3, 2, 5], [-1, 0, 0], b)).toBe(1);     // its outer shell, facing out
    expect(interiorOpenAt([2, 4.3, 5], [0, 1, 0], b)).toBe(1);       // the roof
    expect(interiorOpenAt([2, 0, 5], [0, 1, 0], b)).toBe(0);         // the floor inside
    expect(interiorOpenAt([2, 0, -3], [0, 1, 0], b)).toBe(1);        // the ground outside the mouth
    const mouth = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((z) => interiorOpenAt([2, 0, z], [0, 1, 0], b));
    for (let i = 1; i < mouth.length; i++) expect(mouth[i]).toBeLessThanOrEqual(mouth[i - 1]);
    expect(mouth[0]).toBe(1);
    expect(mouth[mouth.length - 1]).toBe(0);
    expect(interiorOpenAt([2, 2, 5], [0, 1, 0], [])).toBe(1);        // no interiors: open everywhere
  });
});

describe('P5 interiors: The Lot', () => {
  const lot = createWorldData(1, 'the_lot');
  const boxes = lot.interiors ?? [];
  const pipes = LOT_PIPES.get(lot) ?? [];

  it('one box per pipe bore and per site-office container, inside the style budget; the West Yard has none', () => {
    expect(pipes.length).toBe(8);
    expect(boxes.length).toBe(pipes.length + CONTAINERS.length);
    expect(boxes.length).toBeLessThanOrEqual(STYLE.interior.max);
    expect(createWorldData(1).interiors).toBeUndefined();
    for (const b of boxes) for (let k = 0; k < 3; k++) expect(b.max[k]).toBeGreaterThan(b.min[k]);
    expect(createWorldData(1, 'the_lot').interiors).toEqual(boxes); // deterministic
    expect(lotInteriors(pipes, [])).toHaveLength(pipes.length);
  });

  it('every pipe: its inner facets face into its box (shut), its outer facets face out of every box (open)', () => {
    for (const p of pipes) {
      for (const f of pipeFacets(p, PIPE)) {
        const inner: V3 = [p.x + f.n[0] * f.inner, p.y + f.n[1] * f.inner, p.z + f.n[2] * f.inner];
        const outer: V3 = [p.x + f.n[0] * f.outer, p.y + f.n[1] * f.outer, p.z + f.n[2] * f.outer];
        expect(interiorOpenAt(inner, [-f.n[0], -f.n[1], -f.n[2]], boxes)).toBe(0);
        expect(interiorOpenAt(outer, f.n, boxes)).toBe(1);
      }
    }
  });

  it('every container: inner walls, floor and ceiling shut; outer walls and roof open', () => {
    const { W, H, L, wall, floor } = CONTAINER;
    for (const c of CONTAINERS) {
      const b = boxes.find((x) => Math.abs((x.min[0] + x.max[0]) / 2 - c.x) < 1e-6 && Math.abs((x.min[2] + x.max[2]) / 2 - c.z) < 1e-6)!;
      expect(b).toBeTruthy();
      const y0 = b.min[1] + 0.5, ym = y0 + H / 2;
      expect(b.max[1]).toBeCloseTo(y0 + H, 6);                        // through the roof slab: no lit seam at the ceiling
      for (const s of [-1, 1]) {
        expect(interiorOpenAt([c.x + s * (W / 2 - wall), ym, c.z], [-s, 0, 0], boxes)).toBe(0);
        expect(interiorOpenAt([c.x + s * W / 2, ym, c.z], [s, 0, 0], boxes)).toBe(1);
        expect(interiorOpenAt([c.x, ym, c.z + s * (L / 2 + 1)], [0, 0, s], boxes)).toBe(1); // in front of the open ends
      }
      expect(interiorOpenAt([c.x, y0 + floor, c.z], [0, 1, 0], boxes)).toBe(0);
      expect(interiorOpenAt([c.x, y0 + H - 0.4, c.z], [0, -1, 0], boxes)).toBe(0);
      for (const s of [-1, 1]) for (const y of [y0 + floor + 0.02, y0 + H - 0.42]) {   // the wall-floor and wall-ceiling seams
        expect(interiorOpenAt([c.x + s * (W / 2 - wall), y, c.z], [-s, 0, 0], boxes)).toBe(0);
      }
      expect(interiorOpenAt([c.x, y0 + H, c.z], [0, 1, 0], boxes)).toBe(1);
    }
  });

  it('the open ground stays lit (spawns, bases, perches incl. the pipe crown), the pipe-mouth view looks from inside', () => {
    for (const s of lot.spawns) expect(interiorOpenAt([s.x, s.y - 0.05, s.z], [0, 1, 0], boxes)).toBe(1);
    for (const b of lot.bases ?? []) for (const q of [b.flag, b.ballStand]) expect(interiorOpenAt(q, [0, 1, 0], boxes)).toBe(1);
    for (const p of lot.perches ?? []) expect(interiorOpenAt([p.x, p.y, p.z], [0, 1, 0], boxes)).toBe(1);
    const cam = lot.bookmarks!.find((b) => b.name === 'lot_pipe_mouth')!.pos;
    expect(boxes.some((b) => [0, 1, 2].every((k) => cam[k] > b.min[k] && cam[k] < b.max[k]))).toBe(true);
  });
});

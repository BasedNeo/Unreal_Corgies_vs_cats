// W9 P4 (readability + grade pass), without a GPU: the character rim + fill is an opt-in, compiled-in term of the
// hardened material (no real light, no new pass), it grows with distance, characters opt in, and the grade/light
// tokens the pass moved stay inside their mood bounds.
import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three/webgpu';
import { vec4, float } from 'three/tsl';
import { toon, toonMaterial, setStyleDetail, HardenedToonMaterial, STYLE_RIM, createStyleLights, createGrade, TEAM_HUE_DIRS } from '../../src/client/style/style-webgpu.js';
import { PALETTE, STYLE } from '../../src/client/style/style-tokens.js';
import { hslOf } from '../../src/client/procgen/cosmetics/readability';
import { createCharacter } from '../../src/client/procgen/characters';
import { Species, Team } from '../../src/shared/types';
import { YARD_RAMPS } from '../../src/client/world/sky';

afterEach(() => setStyleDetail(2));

describe('P4 character rim + fill', () => {
  it('is an opt-in material term: rim > 0 compiles it in (own program), its strength is a value (shared program)', () => {
    const plain = toonMaterial({ color: 0x808080 }) as HardenedToonMaterial;
    const rim = toonMaterial({ color: 0x808080, rim: 1 }) as HardenedToonMaterial;
    const half = toonMaterial({ color: 0x808080, rim: 0.5 }) as HardenedToonMaterial;
    expect(plain.rim).toBe(0);
    expect(rim.rim).toBe(1);
    expect(rim.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey());
    expect(half.customProgramCacheKey()).toBe(rim.customProgramCacheKey());
    expect(toon({ color: 0x808080, rim: 1 })).not.toBe(toon({ color: 0x808080 }));
    expect(toon({ color: 0x808080, rim: 1 })).toBe(toon({ color: 0x808080, rim: 1 }));
    expect((rim.clone() as HardenedToonMaterial).rim).toBe(1);
  });

  it('builds at every detail level (the low tier gets the same read) and adds no light to the scene', () => {
    for (const d of [0, 1, 2]) {
      setStyleDetail(d);
      const m = toonMaterial({ rim: 1, surfaceAttr: true }) as HardenedToonMaterial & { setupLightingModel(): THREE.LightingModel & { rim: boolean } };
      const lm = m.setupLightingModel();
      expect(lm).toBeInstanceOf(THREE.LightingModel);
      expect(lm.rim).toBe(true);
      expect((toonMaterial({}) as unknown as { setupLightingModel(): { rim: boolean } }).setupLightingModel().rim).toBe(false);
    }
    const lights = createStyleLights();
    expect(lights.children.filter((o) => (o as THREE.Light).isLight).length).toBe(3); // key, rim, hemisphere: unchanged
  });

  it('tokens: a cool colour, a subtle near rim and no near fill, a stronger rim and a fill at range', () => {
    const R = STYLE.rim;
    const c = new THREE.Color(R.color);
    expect(c.b).toBeGreaterThan(c.r);                  // cool against the warm key
    expect(R.near).toBeLessThan(R.far);
    expect(R.nearGain).toBeLessThanOrEqual(0.5);        // close up it is an accent, not a glow
    expect(R.nearFill).toBe(0);
    expect(R.farGain).toBeGreaterThan(R.nearGain);
    expect(R.farFill).toBeGreaterThan(0);
    expect(R.farFill).toBeLessThanOrEqual(0.6);         // a lift, never flat-bright
    expect(STYLE_RIM.color.value).toBeInstanceOf(THREE.Color);
    expect(STYLE_RIM.gain.value).toBe(1);
  });

  it('characters opt in (body, neckwear via the body material, weapon); nothing else in the factory does by default', () => {
    const av = createCharacter({ species: Species.Cat, cls: 'assault', team: Team.Cats, seed: 3, isLocal: false, look: { neck: 'neck_bandana' } });
    const rims: number[] = [];
    av.root.traverse((o) => { const m = (o as THREE.Mesh).material as HardenedToonMaterial | undefined; if ((o as THREE.Mesh).isMesh && m?.isHardenedToonMaterial) rims.push(m.rim); });
    expect(rims.length).toBeGreaterThanOrEqual(3); // body, weapon, neckwear
    expect(rims.every((r) => r > 0)).toBe(true);
    av.dispose();
    expect((toon({ color: 0x556655, surface: 'world' }) as HardenedToonMaterial).rim).toBe(0);
  });
});

describe('P4 grade + light tokens (the dark-bookmark lift, the storm team signal)', () => {
  it('exposure and vignette moved within mood bounds; the grade S-curve and split tone are unchanged', () => {
    const g = STYLE.grade;
    expect(g.exposure).toBeGreaterThan(1);
    expect(g.exposure).toBeLessThanOrEqual(1.3);        // a lift, not a daylight re-grade
    expect(g.vignette).toBeGreaterThanOrEqual(0.4);     // the vignette stays part of the look
    expect(g.contrast).toBe(0.42);
    expect(g.saturation).toBe(0.86);
    expect(STYLE.lights.rim.intensity).toBe(1.35);      // the fill at dusk comes from the sky ramp (sky.ts), not the base
  });

  it('the dusk sky fill: strong and near-horizontal while the sun is low, the old fill by day and at night', () => {
    const at = (keys: [number, number][], x: number) => {
      if (x <= keys[0][0]) return keys[0][1];
      for (let i = 1; i < keys.length; i++) if (x <= keys[i][0]) { const [x0, a] = keys[i - 1], [x1, b] = keys[i]; return a + ((b - a) * (x - x0)) / (x1 - x0); }
      return keys[keys.length - 1][1];
    };
    const { rimI, rimUp } = YARD_RAMPS;
    expect(at(rimI, 2.6)).toBeGreaterThan(2);                       // t = 0.74: the backlit bookmarks' fill
    expect(Math.max(...rimI.map((k) => k[1]))).toBeLessThanOrEqual(2.5);
    expect(at(rimI, 42)).toBe(1);                                   // the highest sun: the base rim light
    expect(at(rimUp, 2.6)).toBeLessThanOrEqual(0.1);                // grazes the ground: the sodium pools stay orange
    expect(at(rimUp, 30)).toBe(0.35);                               // by day and at night: the old 19° rim
    expect(at(rimUp, -10)).toBe(0.35);
  });

  it('team hue protection: its hue directions are the locked team signal colours, the window is narrow', () => {
    const deg = (d: number[]) => ((Math.atan2(d[1], d[0]) * 180) / Math.PI + 360) % 360;
    const near = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
    expect(near(deg(TEAM_HUE_DIRS[0]), hslOf(PALETTE.teamCorgis).h)).toBeLessThan(6);
    expect(near(deg(TEAM_HUE_DIRS[1]), hslOf(PALETTE.teamCats).h)).toBeLessThan(6);
    for (const d of TEAM_HUE_DIRS) expect(Math.hypot(d[0], d[1])).toBeCloseTo(1, 6);
    expect(STYLE.grade.signalHueDeg).toBeLessThanOrEqual(30);          // not every blue-ish or red-ish pixel
    expect(STYLE.grade.signalHueChroma[1]).toBeLessThan(STYLE.grade.signalChroma[0]); // it reaches below the chroma rule
    const g = createGrade();
    expect(g.uniforms.signalHue.value.toArray()).toEqual(STYLE.grade.signalHueChroma);
    const call = (g.node as unknown as (c: unknown) => unknown)(vec4(0.2, 0.3, 0.6, 1)); // Fn's typing drops the [c] param
    expect(call).toBeTruthy(); // the grade's TSL function takes a colour (the call node is made)
  });

  it('characters shed STYLE.rim.fogCut of the haze (a different fog output), other materials keep the full fog', () => {
    expect(STYLE.rim.fogCut).toBeGreaterThan(0);
    expect(STYLE.rim.fogCut).toBeLessThanOrEqual(0.6);  // they still sit in the weather
    const fogNode = vec4(0.5, 0.5, 0.5, 1);
    const out = vec4(float(0.1), float(0.2), float(0.3), float(1));
    const rim = toonMaterial({ rim: 1 }) as unknown as { setupFog(b: unknown, o: unknown): unknown };
    const plain = toonMaterial({}) as unknown as { setupFog(b: unknown, o: unknown): unknown };
    expect(plain.setupFog({ fogNode }, out)).not.toBe(out);
    const r = rim.setupFog({ fogNode }, out);
    expect(r).not.toBe(out);
    expect(r).not.toBe(plain.setupFog({ fogNode }, out));
    expect(rim.setupFog({ fogNode: null }, out)).toBe(out); // no fog: untouched
  });
});

// W9 P4 (readability + grade pass), without a GPU: the character rim + fill is an opt-in, compiled-in term of the
// style material (no real light, no new pass), it grows with distance, characters opt in; the storm keeps the team
// signal. W13 (docs/design/LOOK.md): the material is the stylised-realistic StyleMaterial and the grade and rig are the
// Godot night's (the dusk fill ramps are gone with the time-of-day look).
import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three/webgpu';
import { vec4, float } from 'three/tsl';
import { toon, toonMaterial, setStyleDetail, StyleMaterial, STYLE_RIM, createStyleLights, createGrade, TEAM_HUE_DIRS } from '../../src/client/style/style-webgpu.js';
import { PALETTE, STYLE } from '../../src/client/style/style-tokens.js';
import { hslOf } from '../../src/client/procgen/cosmetics/readability';
import { createCharacter } from '../../src/client/procgen/characters';
import { Species, Team } from '../../src/shared/types';
import { NIGHT } from '../../src/client/world/sky';

afterEach(() => setStyleDetail(2));

describe('P4 character rim + fill', () => {
  it('is an opt-in material term: rim > 0 compiles it in (own program), its strength is a value (shared program)', () => {
    const plain = toonMaterial({ color: 0x808080 }) as StyleMaterial;
    const rim = toonMaterial({ color: 0x808080, rim: 1 }) as StyleMaterial;
    const half = toonMaterial({ color: 0x808080, rim: 0.5 }) as StyleMaterial;
    expect(plain.rim).toBe(0);
    expect(rim.rim).toBe(1);
    expect(rim.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey());
    expect(half.customProgramCacheKey()).toBe(rim.customProgramCacheKey());
    expect(toon({ color: 0x808080, rim: 1 })).not.toBe(toon({ color: 0x808080 }));
    expect(toon({ color: 0x808080, rim: 1 })).toBe(toon({ color: 0x808080, rim: 1 }));
    expect((rim.clone() as StyleMaterial).rim).toBe(1);
  });

  it('builds at every detail level (the low tier gets the same read) and adds no light to the scene', () => {
    for (const d of [0, 1, 2]) {
      setStyleDetail(d);
      const m = toonMaterial({ rim: 1, surfaceAttr: true }) as StyleMaterial & { setupLightingModel(): THREE.LightingModel & { rim: boolean } };
      const lm = m.setupLightingModel();
      expect(lm).toBeInstanceOf(THREE.LightingModel);
      expect(lm.rim).toBe(true);
      expect((toonMaterial({}) as unknown as { setupLightingModel(): { rim: boolean } }).setupLightingModel().rim).toBe(false);
    }
    const lights = createStyleLights();
    expect(lights.children.filter((o) => (o as THREE.Light).isLight).length).toBe(3); // key, rim, hemisphere: unchanged
  });

  it('tokens: a cool colour, a subtle near rim and a small near fill, a stronger rim and a fill at range', () => {
    const R = STYLE.rim;
    const c = new THREE.Color(R.color);
    expect(c.b).toBeGreaterThan(c.r);                  // cool, like the moonlight
    expect(R.near).toBeLessThan(R.far);
    expect(R.nearGain).toBeLessThanOrEqual(0.5);        // close up it is an accent, not a glow
    expect(R.nearFill).toBeGreaterThanOrEqual(0);
    expect(R.nearFill).toBeLessThanOrEqual(0.3);        // the night's faint self-lit read [godot coat], not a lamp
    expect(R.farGain).toBeGreaterThan(R.nearGain);
    expect(R.farFill).toBeGreaterThan(R.nearFill);
    expect(R.farFill).toBeLessThanOrEqual(0.6);         // a lift, never flat-bright
    expect(STYLE_RIM.color.value).toBeInstanceOf(THREE.Color);
    expect(STYLE_RIM.gain.value).toBe(1);
  });

  it('characters opt in (body, neckwear via the body material, weapon); nothing else in the factory does by default', () => {
    const av = createCharacter({ species: Species.Cat, cls: 'assault', team: Team.Cats, seed: 3, isLocal: false, look: { neck: 'neck_bandana' } });
    const rims: number[] = [];
    av.root.traverse((o) => { const m = (o as THREE.Mesh).material as StyleMaterial | undefined; if ((o as THREE.Mesh).isMesh && m?.isStyleMaterial) rims.push(m.rim); });
    expect(rims.length).toBeGreaterThanOrEqual(3); // body, weapon, neckwear
    expect(rims.every((r) => r > 0)).toBe(true);
    av.dispose();
    expect((toon({ color: 0x556655, surface: 'world' }) as StyleMaterial).rim).toBe(0);
  });
});

describe('P4 grade + light tokens under the W13 night', () => {
  it('the grade is Godot\'s (contrast up a touch, saturation down), the exposure a lift', () => {
    const g = STYLE.grade;
    expect(g.exposure).toBeGreaterThan(1);
    expect(g.exposure).toBeLessThanOrEqual(1.6);
    expect(g.contrast).toBeGreaterThan(1);
    expect(g.contrast).toBeLessThan(1.2);
    expect(g.saturation).toBeGreaterThan(0.7);
    expect(g.saturation).toBeLessThan(1);
  });

  it('the night rig: the moon key and the sky fill are weak and cool, the sky ambient carries the shade side', () => {
    const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(NIGHT.moonColor[2]).toBeGreaterThan(NIGHT.moonColor[0]);   // cool
    expect(STYLE.night.moon.energy).toBeLessThan(1);                     // behind cloud
    expect(STYLE.night.fill.energy).toBeLessThan(STYLE.night.moon.energy);
    expect(STYLE.night.fill.up).toBeLessThanOrEqual(0.5);                // grazing: the sodium pools stay orange
    expect(lum(NIGHT.skyAvg)).toBeGreaterThan(lum(NIGHT.zenith));        // the lit deck is brighter than the bare zenith
    expect(NIGHT.ambient[2]).toBeGreaterThan(NIGHT.ambient[0]);           // a cold moonlit ambient
    expect(NIGHT.horizon[2]).toBeGreaterThan(NIGHT.horizon[0]);           // a cold horizon haze (no warm wash)
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

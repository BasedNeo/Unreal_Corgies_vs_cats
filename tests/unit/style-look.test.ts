// W13 LOOK (docs/design/LOOK.md): the web look is the Godot build's stylised-realistic night; the HARDENED comic look
// (ink hull, crease lines, stepped toon bands) is retired. The style factory contract, without a GPU:
//   - no ink anywhere: the post chain is one plain scene pass + bloom + grade, stylize adds no ink and leaves normals
//     alone, the tokens keep only the crease angle (for normals);
//   - toon() keeps its API and returns a PBR StyleMaterial (MeshStandardNodeMaterial), not a toon material: surfaces
//     separate coat / armour plate / rifle metal, weathering values share one program, detail is a build knob;
//   - the tokens are the Godot night (AgX, exposure, bloom threshold, grade, sodium), the grade's curve, the wetness
//     floor, floodlights with Godot's falloff and a fixed light budget.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  toon, toonMaterial, glow, stylize, pbr, setStyleDetail, styleDetail, surfaceOf, createGrade, gradeCurveAt,
  StyleMaterial, StyleLightingModel, StyleScenePass, STYLE_WEATHER, STYLE_ENV, DETAIL_BY_TIER, LOOK,
  buildStyleOutput, createStylePipeline, toneMappingOf, createStyleLights,
} from '../../src/client/style/style-webgpu.js';
import { PALETTE, STYLE, SURFACES } from '../../src/client/style/style-tokens.js';
import { paintSurface, smoothNormalsByPosition } from '../../src/client/style/style-utils.js';
import { createFloodlights, floodlightBudget } from '../../src/client/style/floodlights.js';

afterEach(() => setStyleDetail(2));

const SRC = (f: string) => readFileSync(new URL(`../../src/client/style/${f}`, import.meta.url), 'utf8');

describe('no ink', () => {
  it('the post chain has no outline pass: one plain scene pass, bloom on emissives, the grade', () => {
    const out = buildStyleOutput(new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(typeof createStylePipeline).toBe('function');
    expect(out.scenePass).toBeInstanceOf(StyleScenePass);
    expect(out.scenePass).toBeInstanceOf(THREE.PassNode);
    expect(out.scenePass).not.toBeInstanceOf(THREE.ToonOutlinePassNode);
    const pass = out.scenePass as unknown as Record<string, unknown>;
    expect(pass.isToonOutlinePassNode).toBeFalsy();
    expect(pass._getOutlineMaterial).toBeUndefined();
    expect('uniforms' in out).toBe(false);                     // no ink thickness / far cap any more
    expect(out.bloomPass).toBeTruthy();
    expect(typeof out.grade.node).toBe('function');
    // and the style never names the outline pass or the line classes again
    for (const f of ['style-webgpu.js', 'floodlights.js', 'style-utils.js']) {
      const src = SRC(f).split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      expect(src, f).not.toMatch(/toonOutlinePass|LineSegments2|Line2NodeMaterial|EdgesGeometry/);
    }
  });

  it('stylize adds no ink and leaves the geometry\'s normals alone', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x884422, roughness: 0.3, metalness: 0.8 }));
    const before = (mesh.geometry.getAttribute('normal').array as Float32Array).slice();
    const root = new THREE.Group();
    root.add(mesh);
    stylize(root, { surface: 'metal' });
    expect(mesh.children.length).toBe(0);
    expect(Array.from(mesh.geometry.getAttribute('normal').array as Float32Array)).toEqual(Array.from(before));
    const m = mesh.material as unknown as StyleMaterial;
    expect(m).toBeInstanceOf(StyleMaterial);
    expect(m.userData.style).toBe('toon');
    expect([m.rough, m.metal, m.grime]).toEqual([0.3, 0.8, SURFACES.metal.grime]);
  });

  it('tokens: no outline, ramp or crease line width left (only the crease angle, for the normals)', () => {
    const S = STYLE as unknown as Record<string, unknown>;
    for (const k of ['outline', 'toonSteps', 'bandFloor', 'ramp', 'mood']) expect(S[k], k).toBeUndefined();
    expect(Object.keys(STYLE.crease)).toEqual(['angleDeg']);
  });
});

describe('toon(): a stylised-realistic PBR material', () => {
  it('is a MeshStandardNodeMaterial (StyleMaterial), not a toon material, lit by the physically based model', () => {
    const m = toon({ color: PALETTE.hazardOchre }) as StyleMaterial;
    expect(m).toBeInstanceOf(StyleMaterial);
    expect(m).toBeInstanceOf(THREE.MeshStandardNodeMaterial);
    expect(m).not.toBeInstanceOf(THREE.MeshToonNodeMaterial);
    const f = m as unknown as Record<string, unknown>;
    expect(f.isMeshToonMaterial).toBeFalsy();
    expect(f.isMeshToonNodeMaterial).toBeFalsy();
    expect(f.gradientMap).toBeUndefined();
    expect(m.userData.style).toBe('toon');                    // the factory family tag the audits read
    const lm = (m as unknown as { setupLightingModel(): THREE.LightingModel }).setupLightingModel();
    expect(lm).toBeInstanceOf(StyleLightingModel);
    expect(lm).toBeInstanceOf(THREE.PhysicalLightingModel);
    expect(m.color.getHex()).toBe(new THREE.Color(PALETTE.hazardOchre).getHex());
    expect(LOOK).toBe('stylised-realistic');
  });

  it('caches per params: same call -> same instance; any weathering param -> another material', () => {
    const a = toon({ color: 0x123456, vertexColors: true });
    expect(toon({ color: 0x123456, vertexColors: true })).toBe(a);
    expect(toon({ color: 0x123456, vertexColors: true, grime: 0.9 })).not.toBe(a);
    expect(toon({ color: 0x123456, vertexColors: true, surface: 'armor' })).not.toBe(a);
    expect(toon({ color: 0x123456, vertexColors: true, steps: 3 })).toBe(a);      // bands are gone: steps is ignored
    expect(toonMaterial({ color: 0x123456 })).not.toBe(toonMaterial({ color: 0x123456 })); // uncached by design
  });

  it('applies surface presets, explicit params win; ink:false is only the noink family tag', () => {
    const armor = toon({ color: 0x777777, surface: 'armor' }) as StyleMaterial;
    expect(armor.rough).toBe(SURFACES.armor.rough);
    expect(armor.wear).toBe(SURFACES.armor.wear);
    const custom = toon({ color: 0x777777, surface: 'armor', rough: 0.2, metal: 1 }) as StyleMaterial;
    expect([custom.rough, custom.metal, custom.grime]).toEqual([0.2, 1, SURFACES.armor.grime]);
    expect(surfaceOf({})).toEqual(SURFACES.default);
    for (const s of Object.values(SURFACES)) expect(Object.keys(s).sort()).toEqual(Object.keys(SURFACES.default).sort());
    const noink = toon({ color: 0x335533, ink: false });
    expect(noink.userData.style).toBe('toon-noink');
    expect(noink).toBeInstanceOf(StyleMaterial);
  });

  it('coat, armour plate and rifle metal read as three materials [godot pet_materials: coat 0.42, plate 0.38 + clearcoat 0.12, rifle 0.32 metal 0.9]', () => {
    const { fur, armor, weapon } = SURFACES;
    expect(fur.metal).toBe(0);
    expect(armor.metal).toBeGreaterThan(0);
    expect(armor.metal).toBeLessThanOrEqual(0.2);
    expect(weapon.metal).toBeGreaterThanOrEqual(0.85);
    // wet roughness on a pet's side (soak = sideSoak) at the night's floor: StyleMaterial._weathering's maths
    const sideWet = (s: { rough: number; metal: number; wetK: number }) => {
      const w = STYLE.wet.floor * s.wetK * STYLE.wet.sideSoak;
      const keep = STYLE.wet.rough + (STYLE.wet.roughPorous - STYLE.wet.rough) * (1 - s.metal) * s.rough;
      return s.rough * (1 + (keep - 1) * w);
    };
    const [coat, plate, rifle] = [sideWet(fur), sideWet(armor), sideWet(weapon)];
    expect(coat).toBeGreaterThan(plate + 0.1);                       // broad coat sheen vs the plate's tight gloss
    expect(Math.abs(coat - 0.42)).toBeLessThan(0.08);
    expect(plate).toBeLessThanOrEqual(0.38);                         // the clearcoat's gloss, without a clearcoat pass
    expect(Math.abs(rifle - 0.32)).toBeLessThan(0.05);
  });

  it('materials that differ only in weathering values share one program; detail / attr / puddles / rim do not', () => {
    const a = toonMaterial({ color: 0x808080, rough: 0.3, grime: 0.1 });
    const b = toonMaterial({ color: 0x808080, rough: 0.9, grime: 0.8, wear: 0.9 });
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(toonMaterial({ surfaceAttr: true }).customProgramCacheKey()).not.toBe(a.customProgramCacheKey());
    expect(toonMaterial({ surface: 'ground' }).customProgramCacheKey()).not.toBe(a.customProgramCacheKey()); // puddles
    expect(toonMaterial({ rim: 1 }).customProgramCacheKey()).not.toBe(a.customProgramCacheKey());
    const hooked = toonMaterial({ color: 0x808080 }) as StyleMaterial;
    hooked.puddleNode = STYLE_WEATHER.wet;
    expect(hooked.customProgramCacheKey()).not.toBe(a.customProgramCacheKey());
    setStyleDetail(0);
    const low = toonMaterial({ color: 0x808080 }) as StyleMaterial;
    expect(low.detail).toBe(0);
    expect(low.customProgramCacheKey()).not.toBe(a.customProgramCacheKey());
  });

  it('detail is a build knob: toon() after setStyleDetail() returns that tier\'s material', () => {
    const high = toon({ color: 0x445566 }) as StyleMaterial;
    expect(high.detail).toBe(2);
    setStyleDetail(DETAIL_BY_TIER.low);
    expect(styleDetail()).toBe(0);
    const low = toon({ color: 0x445566 }) as StyleMaterial;
    expect(low).not.toBe(high);
    expect(low.detail).toBe(0);
    expect(DETAIL_BY_TIER).toEqual({ low: 0, medium: 1, high: 2 });
  });

  it('builds the weathering + wetness graph at every detail level (TSL construction, no GPU)', () => {
    for (const d of [0, 1, 2]) {
      setStyleDetail(d);
      for (const p of [{}, { surface: 'ground' }, { surfaceAttr: true }, { rim: 1 }]) {
        const m = toonMaterial(p) as StyleMaterial & { _weathering(): { albedo: unknown; rough: unknown; metal: unknown; wet: unknown; puddle: unknown } };
        const w = m._weathering();
        for (const k of ['albedo', 'rough', 'metal', 'wet', 'puddle'] as const) expect(w[k], `${d} ${k}`).toBeTruthy();
      }
    }
    // surfaceAttr on a geometry WITHOUT the attribute falls back to the material values (not zeros = a mirror)
    const m = toonMaterial({ surfaceAttr: true, surface: 'armor' }) as StyleMaterial & { _weathering(b?: unknown): { rough: { getCacheKey(): string } } };
    const bare = new THREE.BoxGeometry(1, 1, 1), painted = paintSurface(THREE, new THREE.BoxGeometry(1, 1, 1), SURFACES.fur);
    const keyOf = (g: THREE.BufferGeometry) => m._weathering({ geometry: g }).rough.getCacheKey();
    expect(keyOf(bare)).not.toBe(keyOf(painted));
  });

  it('copies its values and hooks with material.clone()', () => {
    const m = toonMaterial({ surface: 'weapon', rim: 1 }) as StyleMaterial;
    m.wetNode = STYLE_WEATHER.rain;
    const c = m.clone() as StyleMaterial;
    expect(c).toBeInstanceOf(StyleMaterial);
    expect([c.rough, c.metal, c.wear, c.detail, c.rim, c.wetNode]).toEqual([m.rough, m.metal, m.wear, m.detail, m.rim, m.wetNode]);
  });
});

describe('glow(), pbr() and the rig', () => {
  it('glow stays unlit, tagged glow, cached', () => {
    const g = glow(PALETTE.sodium, 4);
    expect(g).toBeInstanceOf(THREE.MeshBasicNodeMaterial);
    expect(g.userData.style).toBe('glow');
    expect(glow(PALETTE.sodium, 4)).toBe(g);
  });

  it('pbr() is lit by the same model, with no toon flags', () => {
    const src = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.2 });
    const m = pbr(src) as unknown as Record<string, unknown> & { setupLightingModel(): unknown };
    expect(m.isMeshToonMaterial).toBeFalsy();
    expect(m.isMeshToonNodeMaterial).toBeFalsy();
    expect(m.setupLightingModel()).toBeInstanceOf(StyleLightingModel);
    expect(STYLE.pbr.wrap).toBe(0);                               // no toon-ramp match any more: plain N.L
  });

  it('the rig: the moon (diffuse only), the sky fill (diffuse only, shut out of interiors), the sky ambient', () => {
    const g = createStyleLights();
    const lights = g.children.filter((o) => (o as THREE.Light).isLight) as THREE.Light[];
    expect(lights.length).toBe(3);
    const [moon, fill, hemi] = lights;
    expect((moon as THREE.DirectionalLight).isDirectionalLight && moon.userData.diffuseOnly && !moon.userData.skyFill).toBe(true);
    expect((fill as THREE.DirectionalLight).isDirectionalLight && fill.userData.diffuseOnly && fill.userData.skyFill).toBe(true);
    expect((hemi as THREE.HemisphereLight).isHemisphereLight).toBe(true);
    // Godot energies × π (moon, ambient)
    expect(moon.intensity).toBeCloseTo(STYLE.night.moon.energy * STYLE.energyScale, 6);
    expect(hemi.intensity).toBeCloseTo(STYLE.night.ambient.energy * STYLE.energyScale, 6);
    expect(new THREE.Vector3(...STYLE.lights.key.dir).normalize().toArray()).toEqual(new THREE.Vector3(...STYLE.night.moon.dir).normalize().toArray());
  });
});

describe('tokens: the Godot night', () => {
  it('AgX at Godot\'s exposure, bloom only above an HDR threshold, the Godot grade', () => {
    expect(STYLE.toneMapping).toBe('agx');
    expect(toneMappingOf()).toBe(THREE.AgXToneMapping);
    expect(STYLE.grade.exposure).toBeGreaterThan(1);
    expect(STYLE.bloom.threshold).toBeGreaterThan(1);             // nothing lit blooms; emissives (> 1) do
    expect(glow().colorNode).toBeTruthy();
    expect(STYLE.grade.contrast).toBeGreaterThan(1);
    expect(STYLE.grade.saturation).toBeLessThan(1);                // a muted night
    expect(PALETTE.sodium).toBe(STYLE.floodlight.color);
    const s = new THREE.Color(PALETTE.sodium);
    expect(s.r).toBeGreaterThan(s.g);
    expect(s.g).toBeGreaterThan(s.b);                              // a warm, saturated sodium
  });

  it('a muted night: a dark, cool sky over a cold horizon haze; the fog is that haze', () => {
    const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const { sky, fog } = STYLE.night;
    expect(lum(sky.zenith)).toBeLessThan(lum(sky.horizon));
    expect(lum(sky.horizon)).toBeLessThan(0.3);
    for (const c of [sky.zenith, sky.horizon, sky.cloudLit, sky.cloudDark]) expect(c[2]).toBeGreaterThan(c[0]); // cool
    expect(lum(sky.cloudDark)).toBeLessThan(lum(sky.cloudLit));
    expect(fog.color).toEqual(sky.horizon);
    expect(fog.density).toBeGreaterThan(0.002);
    expect(fog.density).toBeLessThan(0.01);
  });

  it('team signal colours are locked (HUD + trims); faction gear never equals a signal colour', () => {
    expect(PALETTE.teamCorgis).toBe(0x2f6fd6);
    expect(PALETTE.teamCorgisTrim).toBe(0xf2c14e);
    expect(PALETTE.teamCats).toBe(0xc9344a);
    expect(PALETTE.teamCatsTrim).toBe(0x2b2a33);
    const signals = [PALETTE.teamCorgis, PALETTE.teamCorgisTrim, PALETTE.teamCats, PALETTE.teamCatsTrim];
    for (const k of ['hazardOchre', 'camoBlack', 'underSuit', 'charcoal', 'oxblood', 'brass'] as const) {
      expect(typeof PALETTE[k]).toBe('number');
      expect(signals).not.toContain(PALETTE[k]);
    }
  });

  it('the night never dries: materials see max(weather wetness, floor)', () => {
    expect(STYLE.wet.floor).toBeGreaterThan(0.5);
    expect(STYLE_WEATHER.floor.value).toBe(STYLE.wet.floor);
    expect(STYLE.wet.darken).toBeLessThan(1);
    expect(STYLE.wet.puddleRough).toBeLessThan(0.1);
  });
});

describe('grade', () => {
  it('the colour-correction curve hits its keys, is monotonic per channel, teal low and warm high', () => {
    const { offsets, colors } = STYLE.grade.curve;
    offsets.forEach((o, i) => gradeCurveAt([o, o, o]).forEach((v, k) => expect(v).toBeCloseTo(colors[i][k], 6)));
    for (let k = 0; k < 3; k++) {
      let prev = -1;
      for (let x = 0; x <= 1.0001; x += 0.02) { const v = gradeCurveAt([x, x, x])[k]; expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
    }
    const lo = gradeCurveAt([0.15, 0.15, 0.15]), hi = gradeCurveAt([0.9, 0.9, 0.9]);
    expect(lo[2]).toBeGreaterThan(lo[0]);                          // shadows lean teal/blue
    expect(hi[0]).toBeGreaterThan(hi[2]);                          // highlights lean warm
  });

  it('exposes the saturation knob the weather dims, and builds the node', () => {
    const g = createGrade();
    expect(g.uniforms.saturation.value).toBe(STYLE.grade.saturation);
    expect(g.uniforms.contrast.value).toBe(STYLE.grade.contrast);
    expect(typeof g.node).toBe('function');
    expect(STYLE_ENV.horizon.value).toBeInstanceOf(THREE.Color);
  });
});

describe('smoothNormalsByPosition', () => {
  it('welds every face at a position by default; with an angle it keeps hard edges hard', () => {
    const box = () => new THREE.BoxGeometry(1, 1, 1);
    const all = smoothNormalsByPosition(THREE, box());
    expect(Math.abs(all.getAttribute('normal').getY(0))).toBeLessThan(0.99);   // a cube corner: (1, 1, 1) / sqrt 3
    const hard = smoothNormalsByPosition(THREE, box(), 1e-4, STYLE.crease.angleDeg);
    const ref = box().getAttribute('normal');
    const n = hard.getAttribute('normal');
    for (let i = 0; i < n.count; i++) for (const k of [0, 1, 2]) expect(n.getComponent(i, k)).toBeCloseTo(ref.getComponent(i, k), 5);
    expect(hard.userData.outlineReady).toBe(true);
    // a smooth shape's seam still welds with the angle limit
    const s = new THREE.SphereGeometry(1, 16, 12);
    const sm = smoothNormalsByPosition(THREE, s, 1e-4, STYLE.crease.angleDeg).getAttribute('normal');
    const p = s.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      expect(v.dot(new THREE.Vector3(sm.getX(i), sm.getY(i), sm.getZ(i)))).toBeGreaterThan(0.99);
    }
  });
});

describe('floodlights', () => {
  const cam = new THREE.PerspectiveCamera();
  const spots = (n: number) => Array.from({ length: n }, (_, i) => ({ pos: [i * 20, 9, 0] as [number, number, number], target: [i * 20, 0, 3] as [number, number, number] }));

  it('budget per tier: low spends no light, high spends the most', () => {
    expect(floodlightBudget('low')).toBe(0);
    expect(floodlightBudget('medium')).toBeLessThanOrEqual(floodlightBudget('high'));
    expect(floodlightBudget('med')).toBe(floodlightBudget('medium'));
  });

  it('low tier: fake pools, heads and halos only (3 draws, 0 lights)', () => {
    const f = createFloodlights({ tier: 'low' });
    for (const s of spots(5)) f.add(s);
    f.update(cam);
    expect(f.lights.length).toBe(0);
    const meshes: THREE.Object3D[] = [];
    f.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o); });
    expect(meshes.length).toBe(3);
    for (const m of meshes) expect(['glow', 'fx']).toContain(((m as THREE.Mesh).material as THREE.Material).userData.style);
    f.dispose();
  });

  it('high tier: a fixed light count follows the camera to the nearest floodlights, sodium, Godot\'s falloff', () => {
    const f = createFloodlights({ tier: 'high' });
    for (const s of spots(7)) f.add(s);
    const B = floodlightBudget('high');
    expect(f.lights.length).toBe(B);
    cam.position.set(0, 2, 0);
    f.update(cam);
    const xs = () => f.lights.map((l) => l.position.x).sort((a, b) => a - b);
    expect(xs()).toEqual(Array.from({ length: B }, (_, i) => i * 20));
    cam.position.set(120, 2, 0);
    f.update(cam);
    expect(f.lights.length).toBe(B);                               // never adds/removes (no recompiles)
    expect(xs()).toEqual(Array.from({ length: B }, (_, i) => 120 - (B - 1 - i) * 20));
    for (const l of f.lights) {
      expect(l.intensity).toBe(STYLE.floodlight.intensity);
      expect(l.decay).toBe(STYLE.floodlight.decay);
      expect(l.color.getHex()).toBe(new THREE.Color(PALETTE.sodium).getHex());
    }
    f.dispose();
  });

  it('fewer floodlights than the budget: only as many lights as floodlights', () => {
    const f = createFloodlights({ tier: 'high' });
    f.add(spots(1)[0]);
    f.update(cam);
    expect(f.lights.length).toBe(1);
    f.dispose();
  });
});

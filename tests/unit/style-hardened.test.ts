// W7 S4 (HARDENED look): the style factory v2 contract, without a GPU. What the other lanes and the audits rely on:
// toon() is still a toon material (ink hull + 'toon' tag + gradientMap), cached per params; new optional params
// (surface presets, rough/metal/grime/wear/mud/fade/wetK/puddle) change the material but share one shader program;
// detail is a per-tier build knob; the team signal colours are locked; the ramp is soft; floodlights spend a fixed
// light budget per tier.
import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  toon, toonMaterial, glow, stylize, setStyleDetail, styleDetail, surfaceOf, createGrade, HardenedToonMaterial,
  STYLE_WEATHER, STYLE_ENV, DETAIL_BY_TIER,
} from '../../src/client/style/style-webgpu.js';
import { PALETTE, STYLE, SURFACES } from '../../src/client/style/style-tokens.js';
import { rampValue, createRampTexture, paintSurface } from '../../src/client/style/style-utils.js';
import { createFloodlights, floodlightBudget } from '../../src/client/style/floodlights.js';

afterEach(() => setStyleDetail(2));

describe('toon() v2: still a toon material for the ink pass and the audits', () => {
  it('is a MeshToonNodeMaterial tagged toon, inked, with the soft ramp as gradientMap', () => {
    const m = toon({ color: PALETTE.hazardOchre });
    expect(m).toBeInstanceOf(THREE.MeshToonNodeMaterial);
    expect(m).toBeInstanceOf(HardenedToonMaterial);
    expect(m.userData.style).toBe('toon');
    // toonOutlinePass inks `isMeshToonMaterial || isMeshToonNodeMaterial`
    expect((m as unknown as { isMeshToonNodeMaterial: boolean }).isMeshToonNodeMaterial).toBe(true);
    const g = m.gradientMap as THREE.DataTexture;
    expect(g).toBeInstanceOf(THREE.DataTexture);
    expect(g.image.width).toBe(STYLE.ramp.texels);
    expect(g.magFilter).toBe(THREE.LinearFilter);
    expect(m.color.getHex()).toBe(new THREE.Color(PALETTE.hazardOchre).getHex());
  });

  it('caches per params: same call -> same instance; any weathering param -> another material', () => {
    const a = toon({ color: 0x123456, vertexColors: true });
    expect(toon({ color: 0x123456, vertexColors: true })).toBe(a);
    expect(toon({ color: 0x123456, vertexColors: true, grime: 0.9 })).not.toBe(a);
    expect(toon({ color: 0x123456, vertexColors: true, surface: 'armor' })).not.toBe(a);
    expect(toonMaterial({ color: 0x123456 })).not.toBe(toonMaterial({ color: 0x123456 })); // uncached by design
  });

  it('applies surface presets, explicit params win', () => {
    const armor = toon({ color: 0x777777, surface: 'armor' }) as HardenedToonMaterial;
    expect(armor.rough).toBe(SURFACES.armor.rough);
    expect(armor.wear).toBe(SURFACES.armor.wear);
    const custom = toon({ color: 0x777777, surface: 'armor', rough: 0.2, metal: 1 }) as HardenedToonMaterial;
    expect(custom.rough).toBe(0.2);
    expect(custom.metal).toBe(1);
    expect(custom.grime).toBe(SURFACES.armor.grime);
    expect(surfaceOf({})).toEqual(SURFACES.default);
    for (const s of Object.values(SURFACES)) expect(Object.keys(s).sort()).toEqual(Object.keys(SURFACES.default).sort());
  });

  it('ink:false opts out of the ink hull like the world toonNoInk()', () => {
    const m = toon({ color: 0x335533, ink: false });
    expect(m.userData.style).toBe('toon-noink');
    const f = m as unknown as { isMeshToonNodeMaterial: boolean; isMeshToonMaterial: boolean };
    expect(f.isMeshToonNodeMaterial).toBe(false);
    expect(f.isMeshToonMaterial).toBe(false);
  });

  it('materials that differ only in weathering values share one shader program; detail/attr/puddles do not', () => {
    const a = toonMaterial({ color: 0x808080, rough: 0.3, grime: 0.1 });
    const b = toonMaterial({ color: 0x808080, rough: 0.9, grime: 0.8, wear: 0.9 });
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(toonMaterial({ surfaceAttr: true }).customProgramCacheKey()).not.toBe(a.customProgramCacheKey());
    expect(toonMaterial({ surface: 'ground' }).customProgramCacheKey()).not.toBe(a.customProgramCacheKey()); // puddles
    setStyleDetail(0);
    const low = toonMaterial({ color: 0x808080 });
    expect(low.detail).toBe(0);
    expect(low.customProgramCacheKey()).not.toBe(a.customProgramCacheKey());
  });

  it('detail is a build knob: toon() after setStyleDetail() returns that tier\'s material', () => {
    const high = toon({ color: 0x445566 }) as HardenedToonMaterial;
    expect(high.detail).toBe(2);
    setStyleDetail(DETAIL_BY_TIER.low);
    expect(styleDetail()).toBe(0);
    const low = toon({ color: 0x445566 }) as HardenedToonMaterial;
    expect(low).not.toBe(high);
    expect(low.detail).toBe(0);
    expect(DETAIL_BY_TIER).toEqual({ low: 0, medium: 1, high: 2 });
  });

  it('builds the weathering graph at every detail level (TSL construction, no GPU)', () => {
    for (const d of [0, 1, 2]) {
      setStyleDetail(d);
      for (const p of [{}, { surface: 'ground' }, { surfaceAttr: true }]) {
        const m = toonMaterial(p) as HardenedToonMaterial & { _weathering(): { albedo: unknown; rough: unknown; metal: unknown } };
        const w = m._weathering();
        expect(w.albedo).toBeTruthy();
        expect(w.rough).toBeTruthy();
        expect(w.metal).toBeTruthy();
        expect(m.setupLightingModel()).toBeInstanceOf(THREE.LightingModel);
      }
    }
    // surfaceAttr on a geometry WITHOUT the attribute falls back to the material values (not zeros = a mirror)
    const m = toonMaterial({ surfaceAttr: true, surface: 'armor' }) as HardenedToonMaterial & { _weathering(b?: unknown): { rough: { getCacheKey(): string } } };
    const bare = new THREE.BoxGeometry(1, 1, 1), painted = paintSurface(THREE, new THREE.BoxGeometry(1, 1, 1), SURFACES.fur);
    const keyOf = (g: THREE.BufferGeometry) => m._weathering({ geometry: g }).rough.getCacheKey();
    expect(keyOf(bare)).not.toBe(keyOf(painted));
  });

  it('copies weathering values with material.clone()', () => {
    const m = toonMaterial({ surface: 'weapon' }) as HardenedToonMaterial;
    const c = m.clone() as HardenedToonMaterial;
    expect(c).toBeInstanceOf(HardenedToonMaterial);
    expect([c.rough, c.metal, c.wear, c.detail]).toEqual([m.rough, m.metal, m.wear, m.detail]);
  });
});

describe('glow() and stylize()', () => {
  it('glow stays unlit, uninked, tagged glow', () => {
    const g = glow(PALETTE.sodium, 4);
    expect(g).toBeInstanceOf(THREE.MeshBasicNodeMaterial);
    expect(g.userData.style).toBe('glow');
    expect(glow(PALETTE.sodium, 4)).toBe(g);
  });

  it('stylize keeps PBR roughness/metalness of foreign materials as rough/metal', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x884422, roughness: 0.3, metalness: 0.8 }));
    root.add(mesh);
    stylize(root, { surface: 'metal' });
    const m = mesh.material as unknown as HardenedToonMaterial;
    expect(m.userData.style).toBe('toon');
    expect(m.rough).toBe(0.3);
    expect(m.metal).toBe(0.8);
    expect(m.grime).toBe(SURFACES.metal.grime);
    expect(mesh.geometry.userData.outlineReady).toBe(true);
    expect(mesh.children.some((c) => c.userData.styleInk)).toBe(true);
  });
});

describe('tokens', () => {
  it('team signal colours are locked (HUD + trims)', () => {
    expect(PALETTE.teamCorgis).toBe(0x2f6fd6);
    expect(PALETTE.teamCorgisTrim).toBe(0xf2c14e);
    expect(PALETTE.teamCats).toBe(0xc9344a);
    expect(PALETTE.teamCatsTrim).toBe(0x2b2a33);
    expect(PALETTE.ink).toBe(0x1a120c);
  });

  it('faction gear tokens exist and never equal a signal colour', () => {
    const signals = [PALETTE.teamCorgis, PALETTE.teamCorgisTrim, PALETTE.teamCats, PALETTE.teamCatsTrim];
    for (const k of ['hazardOchre', 'camoBlack', 'underSuit', 'charcoal', 'oxblood', 'brass'] as const) {
      expect(typeof PALETTE[k]).toBe('number');
      expect(signals).not.toContain(PALETTE[k]);
    }
  });

  it('the world palette is a desaturated dusk (lower chroma than v1)', () => {
    const chroma = (h: number) => { const c = new THREE.Color(h); return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b); };
    // v1: grass 0x6fa83a, dirt 0x9b6b43, fenceWood 0xc79a62
    expect(chroma(PALETTE.grass)).toBeLessThan(chroma(0x6fa83a));
    expect(chroma(PALETTE.dirt)).toBeLessThan(chroma(0x9b6b43));
    expect(chroma(PALETTE.fenceWood)).toBeLessThan(chroma(0xc79a62));
  });
});

describe('soft ramp', () => {
  it('is monotonic from the floor to 1, with soft (no hard-step) transitions and distinct bands', () => {
    let prev = -1, maxStep = 0;
    const N = STYLE.ramp.texels;
    for (let i = 0; i < N; i++) {
      const v = rampValue((i + 0.5) / N);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      if (prev >= 0) maxStep = Math.max(maxStep, v - prev);
      prev = v;
    }
    expect(rampValue(0)).toBeCloseTo(STYLE.bandFloor, 5);
    expect(rampValue(1)).toBeCloseTo(1, 2);
    expect(maxStep).toBeLessThan(0.2);                       // v1's 3-texel nearest ramp jumped 0.29 per band
    // back faces get the floor (real form shadow), lit faces near full
    expect(rampValue(0.25)).toBeLessThan(0.2);
    expect(rampValue(0.95)).toBeGreaterThan(0.9);
    // plateaus: at least `steps` distinct levels
    const levels = new Set<number>();
    for (let i = 0; i <= 100; i++) levels.add(Math.round(rampValue(i / 100) * 10));
    expect(levels.size).toBeGreaterThanOrEqual(STYLE.toonSteps);
  });

  it('createRampTexture encodes it in a linear-filtered strip', () => {
    const t = createRampTexture(THREE, { steps: 4 });
    const d = t.image.data as Uint8Array;
    expect(d.length).toBe(STYLE.ramp.texels);
    expect(d[0]).toBe(Math.round(255 * rampValue(0.5 / STYLE.ramp.texels)));
    expect(t.minFilter).toBe(THREE.LinearFilter);
  });

  it('paintSurface writes a per-vertex (rough, metal, grime, wear) attribute', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    paintSurface(THREE, g, SURFACES.fur);
    paintSurface(THREE, g, SURFACES.armor, 0, 4);
    const a = g.getAttribute('surface');
    expect(a.itemSize).toBe(4);
    expect([a.getX(0), a.getY(0), a.getZ(0), a.getW(0)]).toEqual([SURFACES.armor.rough, SURFACES.armor.metal, SURFACES.armor.grime, SURFACES.armor.wear].map((v) => Math.fround(v)));
    expect(a.getX(10)).toBe(Math.fround(SURFACES.fur.rough));
  });
});

describe('post grade + shared uniforms', () => {
  it('exposes the saturation knob the weather dims, and the look uniforms', () => {
    const g = createGrade();
    expect(g.uniforms.saturation.value).toBe(STYLE.grade.saturation);
    expect(typeof g.node).toBe('function');
    expect(STYLE_WEATHER.wet.value).toBeGreaterThanOrEqual(0);
    expect(STYLE_ENV.horizon.value).toBeInstanceOf(THREE.Color);
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

  it('high tier: a fixed light count follows the camera to the nearest floodlights', () => {
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
    for (const l of f.lights) expect(l.intensity).toBe(STYLE.floodlight.intensity);
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

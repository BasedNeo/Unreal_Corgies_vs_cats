// style-webgpu.js — comic / cel-shaded look for WebGPURenderer (three/webgpu + TSL), r183+.
// Same public API as style-webgl.js: toon(), glow(), addCreaseInk(), stylize(), createStyleLights(),
// createComicPipeline(). Never import both files (or 'three' and 'three/webgpu') in one app.
//
// HARDENED v2 (W7 S4, docs/design/HARDENED.md): toon() returns a HardenedToonMaterial — still a MeshToonNodeMaterial
// (so the ink hull, the gradientMap and every `userData.style === 'toon'` audit keep working) with its own lighting
// model and a weathered albedo:
//   - soft 4-band ramp (style-utils rampValue) with a low floor: real form shadows instead of v1's flat 42 % back light;
//   - Blinn-Phong specular per light from a per-pixel roughness (floodlights and the key glint on wet ground/armor);
//   - a cheap sky reflection (no env map): the sky's zenith/horizon/ground colours by reflection direction, Fresnel-
//     weighted, so wet ground and metal mirror the dusk;
//   - procedural weathering masks in TSL (object/world space, no textures): grime blotches + vertical streaks, chipped
//     lighter edges where the surface curves hard (curvature from screen-space derivatives), a mud band near the
//     object's local floor, sun-bleach fade;
//   - wetness from the weather (STYLE_WEATHER.wet): porous albedo darkens, roughness drops to a sheen, up-facing
//     surfaces soak most.
// Per-material values (rough, metal, grime, wear, mud, fade, wetK) are read with materialReference, so materials that
// differ only in those share one shader program. Detail is fixed per quality tier at build (setStyleDetail):
//   0 low: ramp + wet darkening + sky reflection, no noise, no per-light specular (≈ v1 cost)
//   1 medium: + per-light specular, one grime octave, edge wear, mud
//   2 high: + second grime octave, wall streaks, specular anti-aliasing
// W9 P4: toon({ rim }) compiles in a character rim + fill (STYLE.rim, STYLE_RIM): a cool Fresnel edge plus a flat fill,
// as light on the albedo, growing with distance, at every detail level (the low tier gets the same read).
// W10 P5: the exposure follows the sky's time of day (STYLE_EXPOSURE, a pre-tone-map multiply); the sky fill and the
// character rim + fill stay out of WorldData.interiors (STYLE_INTERIORS: a box test per fragment, no pass, no light).
//
// W11 P-GLB1: pbr(gltfMaterial) is the one sanctioned entry point for authored PBR assets (shared GLBs): the asset keeps its
// own baseColor / ORM / normal maps and three's GGX lighting, inside the style rig (the same lights, sky reflection,
// weather wetness, interiors, exposure and grade); no ink hull (it is not a toon material). toon/glow/stylize unchanged.
//
// Differences from WebGL that matter:
// - Ink hull comes from TSL toonOutlinePass: it outlines ONLY toon materials (isMeshToonMaterial /
//   isMeshToonNodeMaterial), with ONE global thickness/color. Glass/glow must therefore be non-toon materials
//   (or toon({ ink: false })) to stay outline-free — glow() below returns MeshBasicNodeMaterial for that reason.
// - Post-processing uses THREE.RenderPipeline (renamed from PostProcessing in r183).
import * as THREE from 'three/webgpu';
import {
  toonOutlinePass, renderOutput, uniform, vec3, vec4, float, mix, smoothstep, luminance,
  screenUV, time, Fn, fract, sin, dot, vec2, min, max, normalize, cameraProjectionMatrix, modelViewMatrix,
  positionLocal, normalLocal, positionGeometry, positionWorld, normalWorld, normalView, normalWorldGeometry,
  positionViewDirection, cameraPosition, reflect, fwidth, length, clamp, abs, floor, sqrt,
  mx_noise_float, materialReference, attribute, diffuseColor, roughness, metalness, specularColor,
  BRDF_Lambert, F_Schlick, uniformArray, Loop, materialColor, materialRoughness, cameraWorldMatrix,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { PALETTE, STYLE, SURFACES } from './style-tokens.js';
import { createRampTexture, smoothNormalsByPosition, matKey } from './style-utils.js';

const materialCache = new Map();
const ramps = new Map();

// ---------------------------------------------------------------------------------------------------------------------
// Shared uniforms: the weather and the sky drive every hardened material through these (world/sky.ts writes them).

/** Weather inputs of the look (0..1): wet = ground/surface wetness, rain = rain intensity (post rain sheet). */
export const STYLE_WEATHER = { wet: uniform(0), rain: uniform(0), dark: uniform(0) };
/** Fake environment for reflections: linear sky colours (set by the sky every weather/time change). */
export const STYLE_ENV = {
  zenith: uniform(new THREE.Color(0x2a3444)),
  horizon: uniform(new THREE.Color(0x6b7482)),
  ground: uniform(new THREE.Color(0x1c1914)),
  intensity: uniform(STYLE.env.intensity),
};

/** W9 P4 character rim + fill (STYLE.rim): colour × gain (a live hook: e.g. a menu or a cutscene can dim it; 1 in play). */
export const STYLE_RIM = { color: uniform(new THREE.Color(STYLE.rim.color)), gain: uniform(1) };

/**
 * W10 P5 exposure by time of day: a multiplier on the tone-mapping exposure (STYLE.grade.exposure, the dusk value), applied
 * to the linear HDR colour just before tone mapping (the same maths as renderer.toneMappingExposure). The sky writes it
 * from its time-of-day ramp (sky.ts YARD_RAMPS.exposure): 1 at dusk, in storm and at night, lower by day.
 */
export const STYLE_EXPOSURE = uniform(1);

/**
 * W10 P5 interiors (WorldData.interiors): world-space boxes where the sky fill (the anti-sun directional light, flagged
 * `userData.skyFill`) and the character rim + fill do not reach. Two vec4 per box (min, max); `count` boxes are live.
 * The sky sets them from the world (createYardSky({ interiors })); no interiors = the loop never runs.
 */
export const STYLE_INTERIORS = {
  boxes: uniformArray(Array.from({ length: 2 * STYLE.interior.max }, () => new THREE.Vector4()), 'vec4'),
  count: uniform(0, 'int'),
};
let interiorsSet = null;
/**
 * Sets the interior boxes (world space; at most STYLE.interior.max, the rest are ignored). Returns the list it keeps, so
 * an owner can clear only its own (styleInteriors() === mine) on dispose.
 * @param {{ min: number[], max: number[] }[] | null | undefined} boxes
 */
export function setStyleInteriors(boxes) {
  const list = boxes ?? [];
  const n = Math.min(list.length, STYLE.interior.max);
  const arr = STYLE_INTERIORS.boxes.array;
  for (let i = 0; i < n; i++) {
    const { min: lo, max: hi } = list[i];
    arr[2 * i].set(Math.min(lo[0], hi[0]), Math.min(lo[1], hi[1]), Math.min(lo[2], hi[2]), 0);
    arr[2 * i + 1].set(Math.max(lo[0], hi[0]), Math.max(lo[1], hi[1]), Math.max(lo[2], hi[2]), 0);
  }
  for (let i = 2 * n; i < arr.length; i++) arr[i].set(0, 0, 0, 0);
  STYLE_INTERIORS.count.value = n;
  interiorsSet = list;
  return list;
}
/** The interior list last passed to setStyleInteriors (null before the first call). */
export const styleInteriors = () => interiorsSet;

/**
 * CPU twin of the shader's interior test (tests, tools): 1 where the sky reaches a surface point `p` with unit normal
 * `n`, 0 inside an interior. Same maths as interiorOpen below.
 * @param {number[]} p @param {number[]} n @param {{ min: number[], max: number[] }[]} [boxes]
 */
export function interiorOpenAt(p, n, boxes = interiorsSet ?? []) {
  const I = STYLE.interior;
  const q = [0, 1, 2].map((k) => p[k] + n[k] * I.probe);
  let shut = 0;
  for (const b of boxes.slice(0, I.max)) {
    let d = Infinity;
    for (let k = 0; k < 3; k++) d = Math.min(d, q[k] - Math.min(b.min[k], b.max[k]), Math.max(b.min[k], b.max[k]) - q[k]);
    const x = Math.min(1, Math.max(0, d / I.feather));
    shut = Math.max(shut, x * x * (3 - 2 * x));
  }
  return 1 - shut;
}

/**
 * 1 where the sky reaches a surface, 0 inside an interior: the point `probe` m in front of the surface (along its normal:
 * the air it faces) is tested against every box, feathered over `feather` m inside the box faces. An inner pipe or
 * container wall faces the inside (0); its outer shell and roof face out (1); light spills `feather` m into a mouth.
 */
const interiorOpen = Fn(() => {
  const I = STYLE.interior;
  const p = positionWorld.add(normalWorld.mul(I.probe));
  const shut = float(0).toVar('interiorShut');
  Loop(STYLE_INTERIORS.count, ({ i }) => {
    const lo = STYLE_INTERIORS.boxes.element(i.mul(2)).xyz;
    const hi = STYLE_INTERIORS.boxes.element(i.mul(2).add(1)).xyz;
    const d = min(p.sub(lo), hi.sub(p));
    shut.assign(max(shut, smoothstep(0, I.feather, min(min(d.x, d.y), d.z))));
  });
  return float(1).sub(shut);
});

let detail = 2;
/** Tier → material detail (see the header). */
export const DETAIL_BY_TIER = { low: 0, medium: 1, high: 2 };
/** Sets the material detail for materials created from now on (renderer: once, before the world/characters build). */
export function setStyleDetail(level) { detail = Math.max(0, Math.min(2, Math.round(Number(level) || 0))); }
export const styleDetail = () => detail;

function rampFor(steps) {
  let r = ramps.get(steps);
  if (!r) { r = createRampTexture(THREE, { steps }); ramps.set(steps, r); }
  return r;
}

const W = STYLE.weathering;
const V3 = (a) => vec3(a[0], a[1], a[2]);
const colorVec = (hex) => { const c = new THREE.Color(hex); return vec3(c.r, c.g, c.b); };
/** 1 at x <= lo, 0 at x >= hi (a falling smoothstep; GLSL ES leaves smoothstep with edge0 > edge1 undefined). */
const fall = (hi, lo, x) => float(1).sub(smoothstep(lo, hi, x));

// ---------------------------------------------------------------------------------------------------------------------
// Lighting model

/** Soft ramp irradiance from the material's gradientMap at half-lambert N.L (same lookup as three's toon model). */
const rampIrradiance = Fn(({ dotNL }) => {
  const coord = vec2(dotNL.mul(0.5).add(0.5), 0.0);
  return materialReference('gradientMap', 'texture').context({ getUV: () => coord }).r;
});

/** Roughness-aware Fresnel for the environment term (Karis/Lazarov-style: rough surfaces reflect less at grazing). */
const envFresnel = Fn(({ f0, dotNV, rough }) => {
  const f90 = max(float(1).sub(rough).pow2(), f0.x);
  return f0.add(vec3(f90).sub(f0).mul(float(1).sub(dotNV).pow(5)));
});

export class HardenedLightingModel extends THREE.LightingModel {
  /** `open` (W10 P5): 1 where the sky reaches, 0 inside an interior (interiorOpen); null = everywhere open. */
  constructor(level = 2, rim = false, open = null) { super(); this.level = level; this.rim = rim; this.open = open; }

  direct({ lightDirection, lightColor, lightNode, reflectedLight }) {
    // W10 P5: the sky fill (sky.ts: the anti-sun directional, no shadow) does not reach inside WorldData.interiors
    if (this.open && lightNode?.light?.userData?.skyFill) lightColor = lightColor.mul(this.open);
    const dotNL = normalView.dot(lightDirection);
    reflectedLight.directDiffuse.addAssign(rampIrradiance({ dotNL }).mul(lightColor).mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb })));
    if (this.level >= 1) {
      // normalized Blinn-Phong from roughness (cheap GGX stand-in): shininess = 2 / r^4 - 2
      const halfDir = lightDirection.add(positionViewDirection).normalize();
      const dotNH = normalView.dot(halfDir).clamp();
      const dotVH = positionViewDirection.dot(halfDir).clamp();
      const r2 = roughness.mul(roughness);
      const shin = float(2).div(max(r2.mul(r2), float(0.001))).sub(2).clamp(2, 1500);
      const D = shin.mul(0.5).add(1).mul(1 / Math.PI).mul(dotNH.pow(shin));
      const F = F_Schlick({ f0: specularColor, f90: float(1), dotVH });
      reflectedLight.directSpecular.addAssign(dotNL.clamp().mul(lightColor).mul(F).mul(D).mul(0.25));
    }
  }

  indirect(builder) {
    const { ambientOcclusion, irradiance, reflectedLight } = builder.context;
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb })));
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
    // sky reflection: zenith above the horizon line, horizon glow at grazing, dark ground below
    const V = cameraPosition.sub(positionWorld).normalize();
    const N = normalWorld;
    const R = reflect(V.negate(), N);
    const sky = mix(STYLE_ENV.horizon, STYLE_ENV.zenith, smoothstep(0.03, 0.6, R.y));
    const sharp = mix(STYLE_ENV.ground, sky, smoothstep(-0.14, 0.03, R.y));
    const blurred = mix(STYLE_ENV.ground, STYLE_ENV.horizon.add(STYLE_ENV.zenith).mul(0.5), 0.55);
    const env = mix(sharp, blurred, roughness.clamp(0, 1));
    const F = envFresnel({ f0: specularColor, dotNV: N.dot(V).clamp(), rough: roughness });
    const dim = float(1).sub(STYLE_WEATHER.dark.mul(STYLE.env.stormDim));
    reflectedLight.indirectSpecular.addAssign(env.mul(F).mul(STYLE_ENV.intensity).mul(dim).mul(ambientOcclusion));
    if (this.rim) {
      // W9 P4 rim + fill (characters): light on the albedo, a Fresnel edge plus a flat fill, both growing from `near`
      // to `far` metres. Not occluded: it is the read that separates a pet from the ground at range, front or back.
      const R = STYLE.rim;
      const edge = float(1).sub(N.dot(V).clamp()).pow(R.power);
      const far = smoothstep(R.near, R.far, length(cameraPosition.sub(positionWorld)));
      let k = edge.mul(mix(float(R.nearGain), float(R.farGain), far)).add(mix(float(R.nearFill), float(R.farFill), far));
      // W10 P5: inside an interior the rim + fill fades to STYLE.interior.charKeep (a pet in a tunnel is lit by the tunnel)
      if (this.open) k = k.mul(mix(float(STYLE.interior.charKeep), float(1), this.open));
      reflectedLight.indirectDiffuse.addAssign(diffuseColor.rgb.mul(STYLE_RIM.color).mul(k.mul(STYLE_RIM.gain).mul(materialReference('rim', 'float'))));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Material

/**
 * @typedef {Object} ToonParams
 * @property {number} [color]
 * @property {number} [emissive]
 * @property {number} [emissiveIntensity]
 * @property {THREE.Texture | null} [map]
 * @property {number} [steps] ramp bands (default STYLE.toonSteps)
 * @property {THREE.Side} [side]
 * @property {boolean} [vertexColors]
 * @property {boolean} [transparent]
 * @property {number} [opacity]
 * @property {boolean} [ink] false: toon-lit but skipped by the ink hull (userData.style 'toon-noink')
 * @property {string} [surface] a SURFACES preset: default fur cloth armor metal weapon world wood ground foliage water plastic
 * @property {number} [rough] 0..1 (overrides the preset)
 * @property {number} [metal] 0..1
 * @property {number} [grime] 0..1
 * @property {number} [wear] 0..1
 * @property {number} [mud] 0..1
 * @property {number} [fade] 0..1
 * @property {number} [wetK] 0..1
 * @property {number} [puddle] 0..1 puddle coverage on flat up-facing parts when wet
 * @property {boolean} [surfaceAttr] read (rough, metal, grime, wear) from a `surface` vec4 vertex attribute (paintSurface)
 * @property {number} [rim] 0..1 character rim + fill strength (STYLE.rim; compiled in only when > 0 at creation)
 */

const SURF_KEYS = ['rough', 'metal', 'grime', 'wear', 'mud', 'fade', 'wetK', 'puddle'];

export class HardenedToonMaterial extends THREE.MeshToonNodeMaterial {
  static get type() { return 'HardenedToonNodeMaterial'; }

  constructor(params = {}) {
    const own = {};
    const rest = { ...params };
    for (const k of [...SURF_KEYS, 'detail', 'surfaceAttr', 'rim']) { own[k] = rest[k]; delete rest[k]; }
    super(rest);
    this.isHardenedToonMaterial = true;
    const s = SURFACES.default;
    this.rough = own.rough ?? s.rough;
    this.metal = own.metal ?? s.metal;
    this.grime = own.grime ?? s.grime;
    this.wear = own.wear ?? s.wear;
    this.mud = own.mud ?? s.mud;
    this.fade = own.fade ?? s.fade;
    this.wetK = own.wetK ?? s.wetK;
    /** Puddle coverage on flat up-facing parts when wet (0 = none; compiled in only when > 0 at creation). */
    this.puddle = own.puddle ?? s.puddle;
    /** Material detail (0 low, 1 medium, 2 high), fixed at creation. */
    this.detail = own.detail ?? detail;
    this.surfaceAttr = !!own.surfaceAttr;
    /** W9 P4 character rim + fill strength 0..1 (STYLE.rim; compiled in only when > 0 at creation). */
    this.rim = own.rim ?? 0;
    /** Optional per-pixel base roughness node (e.g. puddles on the terrain). Overrides `rough`. */
    this.roughnessNode = null;
    /** Optional per-pixel extra wetness node 0..1 (e.g. puddles, sprinkler sweep), max-ed with the weather's. */
    this.wetNode = null;
    this._w = null;
  }

  customProgramCacheKey() {
    return `${super.customProgramCacheKey()}|hd${this.detail}${this.surfaceAttr ? 's' : ''}${this.puddle > 0 ? 'p' : ''}${this.rim > 0 ? 'r' : ''}`;
  }

  setupLightingModel() { return new HardenedLightingModel(this.detail, this.rim > 0, this._open); }

  /** W9 P4: a rim material (a character) sheds STYLE.rim.fogCut of the fog/haze: it keeps its read through a storm. */
  setupFog(builder, outputNode) {
    const fogged = super.setupFog(builder, outputNode);
    if (!(this.rim > 0) || !builder.fogNode) return fogged;
    return mix(fogged, outputNode, float(STYLE.rim.fogCut));
  }

  /**
   * Weathering masks + final albedo/roughness/metal nodes (built once per program build). With surfaceAttr, a geometry
   * that lacks the `surface` attribute falls back to the material values (three keys programs by geometry attributes,
   * so both variants coexist) instead of reading zeros (= a mirror).
   */
  _weathering(builder) {
    const lv = this.detail;
    const P = positionGeometry;
    const hasSurf = this.surfaceAttr && (builder?.geometry?.hasAttribute ? builder.geometry.hasAttribute('surface') : true);
    const surf = hasSurf ? attribute('surface', 'vec4') : null;
    const rough0 = this.roughnessNode ?? (surf ? surf.x : materialReference('rough', 'float'));
    const metal0 = surf ? surf.y : materialReference('metal', 'float');
    const grimeK = surf ? surf.z : materialReference('grime', 'float');
    const wearK = surf ? surf.w : materialReference('wear', 'float');
    const mudK = materialReference('mud', 'float');
    const fadeK = materialReference('fade', 'float');
    const wetK = materialReference('wetK', 'float');

    let col = diffuseColor.rgb;
    // sun-bleach: toward a warm grey of the same luminance
    col = mix(col, vec3(luminance(col)).mul(V3(W.fadeTint)), fadeK);
    // rain exposure: up-facing soaks fully, walls partly, undersides barely
    const ny = normalWorld.y;
    const expo = mix(mix(float(STYLE.wet.underSoak), float(STYLE.wet.sideSoak), smoothstep(-0.7, 0.0, ny)), float(1), smoothstep(0.2, 0.75, ny));
    let wet = STYLE_WEATHER.wet.mul(wetK).mul(expo);
    if (this.wetNode) wet = max(wet, this.wetNode);
    wet = wet.clamp(0, 1).toVar('hardWet');

    let grime = float(0), wear = float(0), mud = float(0), puddle = float(0);
    if (lv >= 1) {
      // noise LOD: a pattern fades to its mean once a pixel covers a good part of its wavelength (no far speckle)
      const foot = length(fwidth(P));
      const lod = (freq) => fall(0.4 / freq, 0.12 / freq, foot);
      const n1 = mx_noise_float(P.mul(W.grimeFreq)).mul(lod(W.grimeFreq));
      let n = n1;
      if (lv >= 2) n = n.add(mx_noise_float(P.mul(W.grimeDetailFreq).add(vec3(3.1, 7.7, 1.3))).mul(0.45).mul(lod(W.grimeDetailFreq)));
      // broad soft dirt everywhere it is weathered, plus rare hard blotches (chipped paint, soot) at high grime
      const soft = smoothstep(-0.35, 0.45, n).mul(grimeK).mul(0.85);
      const thr = mix(float(0.95), float(0.05), grimeK);
      grime = max(soft, smoothstep(thr, thr.add(0.1), n).mul(0.75));
      if (lv >= 2) {
        // vertical run-off streaks on walls (stretched noise), strongest under ledges
        const s = mx_noise_float(P.mul(vec3(W.streakFreq[0], W.streakFreq[1], W.streakFreq[0])).add(vec3(-5.3, 0.7, 2.9)));
        const wall = float(1).sub(abs(ny)).pow(2);
        grime = max(grime, smoothstep(0.12, 0.42, s).mul(wall).mul(grimeK).mul(0.75).mul(lod(W.streakFreq[0])));
      }
      // edge wear: curvature (rad/m) = |d normal| / |d position| in screen space; noise breaks it into chips
      const curv = length(fwidth(normalWorldGeometry)).div(max(length(fwidth(positionWorld)), float(1e-4)));
      const edge = smoothstep(W.edgeCurvature[0], W.edgeCurvature[1], curv);
      const wn = lv >= 2 ? mx_noise_float(P.mul(W.wearFreq).add(vec3(1.7, -2.2, 4.4))) : n1.mul(1.6);
      wear = smoothstep(0.55, 0.78, edge.mul(0.8).add(wn.mul(0.55)).add(wearK.sub(0.5).mul(0.5))).mul(wearK.mul(3).min(1)).mul(lod(W.wearFreq * 0.5));
      // mud splash band near the local floor (characters' boots, the foot of walls)
      mud = fall(W.mudLine, W.mudLine * 0.25, P.y.add(n1.mul(0.14))).mul(mudK);
      // puddles: flat, up-facing low spots fill as the weather gets wet; near-mirror, dark water that reflects the sky
      if (this.puddle > 0) {
        const pn = mx_noise_float(vec3(P.x.mul(0.13), 0.37, P.z.mul(0.13))).add(n1.mul(0.08));
        const pthr = mix(float(0.62), float(0.02), materialReference('puddle', 'float'));
        puddle = smoothstep(pthr, pthr.add(0.1), pn).mul(smoothstep(0.965, 0.995, ny)).mul(smoothstep(0.3, 0.9, STYLE_WEATHER.wet.mul(wetK)));
      }
    }
    col = mix(col, col.mul(V3(W.grimeTint)), grime.mul(0.9));
    col = mix(col, col.mul(V3(W.wearTint)).add(W.wearLift), wear);
    col = mix(col, colorVec(W.mudColor), mud.mul(0.85));
    // wet: porous (rough) surfaces darken; smooth ones mostly gain gloss
    col = col.mul(mix(float(1), float(STYLE.wet.darken), wet.mul(rough0.clamp(0, 1))));
    col = mix(col, col.mul(STYLE.wet.puddleAlbedo), puddle);

    let r = rough0.add(grime.mul(0.12)).sub(wear.mul(0.22)).add(mud.mul(0.08));
    r = mix(r, r.mul(STYLE.wet.roughKeep).add(STYLE.wet.rough), wet);
    r = mix(r, float(0.035), puddle);
    if (lv >= 2) {
      // specular AA: widen the lobe where the normal changes faster than a pixel (no sparkle on small bevels)
      const dn = fwidth(normalView);
      r = sqrt(r.mul(r).add(min(dot(dn, dn).mul(0.5), float(0.18))));
    }
    r = clamp(r, 0.06, 1);
    const metal = clamp(metal0.add(wear.mul(0.3).mul(metal0.add(0.2))), 0, 1);
    return { albedo: col, rough: r, metal };
  }

  setupDiffuseColor(builder) {
    super.setupDiffuseColor(builder);
    this._w = this._weathering(builder);
    diffuseColor.assign(vec4(this._w.albedo, diffuseColor.a));
    // W10 P5: evaluated once per fragment, before lighting (setupLightingModel hands it to the lighting model)
    this._open = interiorOpen().toVar('hardOpen');
  }

  setupVariants(builder) {
    const w = this._w ?? this._weathering(builder);
    const metal = w.metal.toVar('hardMetal');
    roughness.assign(w.rough);
    metalness.assign(metal);
    specularColor.assign(mix(vec3(0.04), diffuseColor.rgb, metal));
    diffuseColor.assign(vec4(diffuseColor.rgb.mul(float(1).sub(metal)), diffuseColor.a));
  }

  copy(source) {
    super.copy(source);
    for (const k of SURF_KEYS) this[k] = source[k];
    this.detail = source.detail;
    this.surfaceAttr = source.surfaceAttr;
    this.rim = source.rim;
    this.roughnessNode = source.roughnessNode;
    this.wetNode = source.wetNode;
    return this;
  }
}

/** Surface values of params (preset, then explicit overrides). */
export function surfaceOf(p = {}) {
  const s = { ...SURFACES.default, ...(p.surface ? SURFACES[p.surface] ?? {} : {}) };
  for (const k of SURF_KEYS) if (p[k] !== undefined) s[k] = p[k];
  return s;
}

/**
 * A NEW (uncached) hardened toon material — for code that sets its own nodes (colorNode, normalNode, roughnessNode,
 * positionNode...), e.g. the world's terrain/prop/foliage materials. Same look and ramp as toon().
 * @param {ToonParams} p
 */
export function toonMaterial(p = {}) {
  const { color = PALETTE.hull, emissive = 0x000000, emissiveIntensity = 1, map = null, steps = STYLE.toonSteps,
    side = THREE.FrontSide, vertexColors = false, transparent = false, opacity = 1, ink = true, surfaceAttr = false, rim = 0 } = p;
  const m = new HardenedToonMaterial({
    color, emissive, emissiveIntensity, map, gradientMap: rampFor(steps), side, vertexColors, transparent, opacity,
    ...surfaceOf(p), surfaceAttr, rim,
  });
  m.userData.style = 'toon';
  m.userData.surface = p.surface ?? 'default';
  if (!ink) {
    // toonOutlinePass inks isMeshToonMaterial OR isMeshToonNodeMaterial; MeshToonNodeMaterial inherits both
    const flags = /** @type {any} */ (m);
    flags.isMeshToonNodeMaterial = false;
    flags.isMeshToonMaterial = false;
    m.userData.style = 'toon-noink';
  }
  return m;
}

/**
 * The shared, cached style material. Same params → same instance (never dispose it).
 * @param {ToonParams} p
 */
export function toon(p = {}) {
  const { color = PALETTE.hull, emissive = 0x000000, emissiveIntensity = 1, map = null, steps = STYLE.toonSteps,
    side = THREE.FrontSide, vertexColors = false, transparent = false, opacity = 1, ink = true, surfaceAttr = false, rim = 0 } = p;
  const key = matKey({
    color, emissive, emissiveIntensity, map: map?.uuid ?? null, steps, side, vertexColors, transparent, opacity, ink,
    surfaceAttr, detail, rim, ...surfaceOf(p),
  });
  let m = materialCache.get(key);
  if (!m) { m = toonMaterial(p); materialCache.set(key, m); }
  return m;
}

/** Glowing parts: unlit, bright (>1 so bloom's threshold catches it), never outlined. */
export function glow(color = PALETTE.glowCyan, intensity = 3) {
  const key = matKey({ glow: color, intensity });
  if (materialCache.has(key)) return materialCache.get(key);
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = uniform(new THREE.Color(color)).mul(intensity); // vec3(Color) renders black in r186
  m.userData.style = 'glow';
  materialCache.set(key, m);
  return m;
}

export function addCreaseInk(mesh, { thresholdDeg = STYLE.crease.angleDeg, widthPx = STYLE.crease.widthPx, color = PALETTE.ink } = {}) {
  if (mesh.isSkinnedMesh || !mesh.geometry) return null;
  const edges = new THREE.EdgesGeometry(mesh.geometry, thresholdDeg);
  const geo = new LineSegmentsGeometry().fromEdgesGeometry(edges);
  edges.dispose();
  const mat = new THREE.Line2NodeMaterial({ color, linewidth: widthPx, worldUnits: false });
  const lines = new LineSegments2(geo, mat);
  lines.name = `${mesh.name || 'mesh'}_crease`;
  lines.userData.styleInk = true;
  mesh.add(lines);
  return lines;
}

/**
 * Converts foreign materials (generators, GLBs) to the style: glow for pure emissives, glass stays, the rest become
 * toon() keeping colour, map, emissive and (from PBR materials) roughness/metalness. `surface` sets the weathering
 * preset for everything converted.
 * @param {THREE.Object3D} root
 * @param {{ creases?: boolean, creaseDeg?: number, remap?: (m: any, o: any) => any, surface?: string }} [opts]
 */
export function stylize(root, { creases = true, creaseDeg, remap, surface } = {}) {
  root.traverse((o) => {
    if (!o.isMesh || o.userData.styleInk) return;
    const convert = (m) => {
      if (!m || m.userData?.style) return m;
      if (remap) { const r = remap(m, o); if (r) return r; }
      const isGlow = m.emissive && m.emissive.getHex() !== 0 && (!m.color || m.color.getHex() === 0);
      if (isGlow) return glow(m.emissive.getHex(), m.emissiveIntensity ?? 3);
      const isGlass = m.transmission > 0 || (m.opacity < 1 && m.transparent);
      if (isGlass) return m; // keep non-toon => no ink hull
      return toon({
        color: m.color?.getHex() ?? PALETTE.hull,
        emissive: m.emissive?.getHex() ?? 0,
        emissiveIntensity: m.emissiveIntensity ?? 1,
        map: m.map ?? null,
        vertexColors: !!m.vertexColors,
        surface,
        ...(typeof m.roughness === 'number' ? { rough: Math.round(m.roughness * 100) / 100 } : {}),
        ...(typeof m.metalness === 'number' ? { metal: Math.round(m.metalness * 100) / 100 } : {}),
      });
    };
    o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
    if (!o.geometry.userData.outlineReady) smoothNormalsByPosition(THREE, o.geometry);
    if (creases && !o.isInstancedMesh) addCreaseInk(o, creaseDeg ? { thresholdDeg: creaseDeg } : {});
  });
  return root;
}

// ---------------------------------------------------------------------------------------------------------------------
// W11 P-GLB1: authored PBR assets (shared GLBs, docs/design/ASSET_PIPELINE.md stage 5)

/** Rain exposure of a surface by its world normal's y: up-facing soaks fully, walls partly, undersides barely. */
const soakExposure = (ny) => mix(mix(float(STYLE.wet.underSoak), float(STYLE.wet.sideSoak), smoothstep(-0.7, 0.0, ny)), float(1), smoothstep(0.2, 0.75, ny));

/**
 * pbr()'s lighting: three's physically based model (GGX, the asset's own roughness / metalness / occlusion / normal
 * maps) plus the rig's fake sky reflection (STYLE_ENV: the style has no env map, so without it metal reads black), and
 * the W10 P5 interiors (the sky fill does not reach inside WorldData.interiors).
 */
class StylePbrLightingModel extends THREE.PhysicalLightingModel {
  /** @param {any} open 1 where the sky reaches, 0 inside an interior (null = everywhere open) @param {number} env gain */
  constructor(open, env) { super(); this.open = open; this.env = env; }

  direct(params, builder) {
    if (this.open && params.lightNode?.light?.userData?.skyFill) params = { ...params, lightColor: params.lightColor.mul(this.open) };
    super.direct(params, builder);
  }

  indirect(builder) {
    super.indirect(builder);
    const { ambientOcclusion, reflectedLight } = builder.context;
    // the shading normal (normal-mapped) reflected in view space, then to world for the sky lookup
    const Rv = reflect(positionViewDirection.negate(), normalView);
    const R = normalize(cameraWorldMatrix.mul(vec4(Rv, 0)).xyz);
    const sky = mix(STYLE_ENV.horizon, STYLE_ENV.zenith, smoothstep(0.03, 0.6, R.y));
    const sharp = mix(STYLE_ENV.ground, sky, smoothstep(-0.14, 0.03, R.y));
    const blurred = mix(STYLE_ENV.ground, STYLE_ENV.horizon.add(STYLE_ENV.zenith).mul(0.5), 0.55);
    const env = mix(sharp, blurred, roughness.clamp(0, 1));
    const F = envFresnel({ f0: specularColor, dotNV: normalView.dot(positionViewDirection).clamp(), rough: roughness });
    const dim = float(1).sub(STYLE_WEATHER.dark.mul(STYLE.env.stormDim));
    const ao = ambientOcclusion ?? float(1);
    reflectedLight.indirectSpecular.addAssign(env.mul(F).mul(STYLE_ENV.intensity.mul(this.env)).mul(dim).mul(ao));
  }
}

/** The material pbr() returns: a MeshStandardNodeMaterial lit by StylePbrLightingModel. */
export class StylePbrMaterial extends THREE.MeshStandardNodeMaterial {
  static get type() { return 'StylePbrNodeMaterial'; }
  constructor(params) {
    super(params);
    this.isStylePbrMaterial = true;
    /** 1 where the sky reaches (interiorOpen), null = no interior test. */
    this.openNode = null;
    /** Sky-reflection gain (× STYLE_ENV.intensity). */
    this.envGain = 1;
  }
  customProgramCacheKey() { return `${super.customProgramCacheKey()}|spbr${this.openNode ? 'i' : ''}${this.envGain}`; }
  setupLightingModel() { return new StylePbrLightingModel(this.openNode, this.envGain); }
}

/**
 * W11 P-GLB1: the sanctioned entry point for authored PBR assets (a shared GLB's materials, docs/design/ASSET_PIPELINE.md).
 * Keeps the source material's maps (baseColor, the ORM pair: occlusion R / roughness G / metalness B, normal, emissive)
 * and factors, and puts it inside the style rig: the same lights, the fake sky reflection (STYLE_ENV), weather wetness
 * (STYLE_WEATHER.wet darkens the albedo and drops the roughness toward a sheen, up-facing parts soak most), the W10 P5
 * interiors, and the post chain (exposure, bloom, grade). Not a toon material: no ink hull, no toon ramp (the
 * "stylised-real" side of the W11 A/B; stylize() is the toon side). Cached: the same source + opts give one instance.
 * @param {any} src a GLTFLoader material (MeshStandardMaterial / MeshPhysicalMaterial)
 * @param {{ env?: number, wetK?: number, normalScale?: number, aoIntensity?: number, interiors?: boolean }} [opts]
 *   overrides of STYLE.pbr
 */
export function pbr(src, opts = {}) {
  const P = { ...STYLE.pbr, ...opts };
  const key = matKey({ pbr: src.uuid, ...P });
  let m = materialCache.get(key);
  if (m) return m;
  m = new StylePbrMaterial();
  m.name = src.name;
  if (src.color) m.color.copy(src.color);
  for (const k of ['map', 'roughnessMap', 'metalnessMap', 'aoMap', 'normalMap', 'emissiveMap']) m[k] = src[k] ?? null;
  m.roughness = src.roughness ?? 1;
  m.metalness = src.metalness ?? 0;
  m.aoMapIntensity = (src.aoMapIntensity ?? 1) * P.aoIntensity;
  if (src.normalScale) m.normalScale.copy(src.normalScale).multiplyScalar(P.normalScale);
  if (src.emissive) m.emissive.copy(src.emissive);
  m.emissiveIntensity = src.emissiveIntensity ?? 1;
  m.side = src.side ?? THREE.FrontSide;
  m.vertexColors = !!src.vertexColors;
  // weather: the albedo darkens (porous paint, rust) and the roughness falls toward a wet sheen
  const wet = STYLE_WEATHER.wet.mul(P.wetK).mul(soakExposure(normalWorld.y)).clamp(0, 1);
  m.colorNode = materialColor.mul(mix(float(1), float(STYLE.wet.darken), wet.mul(0.8)));
  m.roughnessNode = mix(materialRoughness, materialRoughness.mul(STYLE.wet.roughKeep).add(STYLE.wet.rough), wet);
  m.openNode = P.interiors ? interiorOpen() : null;
  m.envGain = P.env;
  m.userData.style = 'pbr';
  materialCache.set(key, m);
  return m;
}

export function createStyleLights() {
  const L = STYLE.lights, g = new THREE.Group();
  const key = new THREE.DirectionalLight(L.key.color, L.key.intensity); key.position.fromArray(L.key.dir).multiplyScalar(10);
  const rim = new THREE.DirectionalLight(L.rim.color, L.rim.intensity); rim.position.fromArray(L.rim.dir).multiplyScalar(10);
  rim.userData.skyFill = true; // W10 P5: the sky drives it as the dusk fill; interiors (STYLE_INTERIORS) shut it out
  g.add(key, rim, new THREE.HemisphereLight(L.ambientSky, L.ambientGround, L.ambientIntensity));
  g.name = 'style_lights';
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// Post

/**
 * Gritty grade, applied AFTER tone mapping (display space): S-curve contrast, additive split tone (teal shadows, warm
 * highlights), saturation down with strong-chroma pixels protected (team signals, lamps, tracers keep their punch),
 * elliptical vignette, luminance-weighted animated grain, and a faint screen-space rain sheet when it rains (depth-
 * less far rain that sells a downpour at no extra pass). `uniforms.saturation` is the knob the weather dims.
 */
/** Unit hue directions (opponent a/b plane, display sRGB) of the two team signal colours, and the hue window's cosine. */
const hueDir = (hex) => {
  const c = new THREE.Color(hex); // .r/.g/.b are linear; the grade works on display values: back to sRGB
  const [r, g, b] = [c.r, c.g, c.b].map((v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  const a = r - (g + b) / 2, bb = (g - b) * 0.8660254, l = Math.hypot(a, bb) || 1;
  return [a / l, bb / l];
};
export const TEAM_HUE_DIRS = [hueDir(PALETTE.teamCorgis), hueDir(PALETTE.teamCats)];
const TEAM_HUE = TEAM_HUE_DIRS.map((d) => vec2(d[0], d[1]));
const TEAM_HUE_COS = Math.cos(((STYLE.grade.signalHueDeg ?? 26) * Math.PI) / 180);

export function createGrade(tokens = STYLE.grade) {
  const t = { ...STYLE.grade, ...tokens };
  const u = {
    shadowTint: uniform(new THREE.Vector3(...t.shadowTint)),
    highlightTint: uniform(new THREE.Vector3(...t.highlightTint)),
    saturation: uniform(t.saturation),
    contrast: uniform(t.contrast),
    signal: uniform(new THREE.Vector2(...t.signalChroma)),
    signalHue: uniform(new THREE.Vector2(...t.signalHueChroma)),
    vignette: uniform(t.vignette),
    grain: uniform(t.grain),
    rain: STYLE_WEATHER.rain,
    rainColor: STYLE_ENV.horizon,
  };
  const node = Fn(([c]) => {
    const x = c.rgb.clamp(0, 1);
    // contrast: blend toward a smoothstep S-curve (pivot 0.5 in display space), keeps 0 and 1 fixed
    const s = mix(x, x.mul(x).mul(vec3(3).sub(x.mul(2))), u.contrast);
    const l = luminance(s);
    const toned = s.add(u.shadowTint.mul(fall(0.55, 0.0, l))).add(u.highlightTint.mul(smoothstep(0.4, 1.0, l)));
    const mx = max(max(toned.r, toned.g), toned.b), mn = min(min(toned.r, toned.g), toned.b);
    const chroma = mx.sub(mn);
    // W9 P4: the team hues are protected from a lower chroma up (a storm washes them below signalChroma)
    const ab = vec2(toned.r.sub(toned.g.add(toned.b).mul(0.5)), toned.g.sub(toned.b).mul(0.8660254));
    const dirAB = ab.div(max(length(ab), float(1e-4)));
    const nearTeam = max(smoothstep(TEAM_HUE_COS, TEAM_HUE_COS + 0.04, dot(dirAB, TEAM_HUE[0])), smoothstep(TEAM_HUE_COS, TEAM_HUE_COS + 0.04, dot(dirAB, TEAM_HUE[1])));
    const keep = max(smoothstep(u.signal.x, u.signal.y, chroma), nearTeam.mul(smoothstep(u.signalHue.x, u.signalHue.y, chroma)));
    const sat = mix(u.saturation, max(u.saturation, float(1.05)), keep);
    let out = mix(vec3(luminance(toned)), toned, sat);
    // rain sheet: thin slanted streaks in ~150 screen columns, each with its own speed/phase
    const cx = screenUV.x.mul(150).add(screenUV.y.mul(18));
    const id = floor(cx);
    const h = fract(sin(id.mul(12.9898)).mul(43758.5453));
    const h2 = fract(sin(id.mul(78.233)).mul(24634.6345));
    const yy = fract(screenUV.y.mul(1.3).sub(time.mul(float(1.6).add(h.mul(1.1)))).add(h2.mul(9.1)));
    const along = smoothstep(0.0, 0.04, yy).mul(fall(0.3, 0.04, yy));
    const across = fall(0.16, 0.0, abs(fract(cx).sub(0.5)));
    const on = smoothstep(float(1).sub(u.rain.mul(0.7)), float(1.02).sub(u.rain.mul(0.7)), h2);
    const sheet = along.mul(across).mul(on).mul(u.rain).mul(0.085);
    out = mix(out, u.rainColor.mul(2.2).add(0.12).clamp(0, 1), sheet);
    // vignette (elliptical) and grain (strongest in the mids, animated)
    const d = screenUV.sub(0.5).mul(vec2(1.0, 0.82));
    const vig = float(1).sub(dot(d, d).mul(u.vignette).mul(1.6)).clamp(0, 1);
    const n = fract(sin(dot(screenUV, vec2(12.9898, 78.233)).add(time)).mul(43758.5453)).sub(0.5);
    const gw = float(1).sub(abs(l.sub(0.42)).mul(1.3)).clamp(0.35, 1);
    return vec4(out.mul(vig).add(n.mul(u.grain).mul(gw)), c.a);
  });
  return { node, uniforms: u };
}

/** Builds the output node graph (testable without a GPU). */
export function buildComicOutput(scene, camera, opts = {}) {
  const ink = uniform(new THREE.Color(PALETTE.ink));
  const thickness = uniform(opts.outlineThickness ?? STYLE.outline.thickness);
  const scenePass = toonOutlinePass(scene, camera, ink, thickness, STYLE.outline.alpha);
  const inkFar = uniform(opts.inkFar ?? STYLE.outline.farCap);
  capInkDistance(scenePass, inkFar);
  const b = { ...STYLE.bloom, ...opts.bloom };
  const bloomPass = bloom(scenePass, b.strength, b.radius, b.threshold);
  const grade = createGrade(opts.grade);
  // W10 P5: × STYLE_EXPOSURE before tone mapping = the exposure follows the sky's time of day (no pass, one multiply)
  const outputNode = grade.node(renderOutput(scenePass.add(bloomPass).mul(STYLE_EXPOSURE)));
  return { outputNode, scenePass, bloomPass, grade, uniforms: { ink, thickness, inkFar } };
}

/**
 * The outline hull is extruded by thickness × clip w (constant screen width at every distance). Cap w at `inkFar`
 * metres for this pass: near ink is unchanged, far ink thins with distance, and distant colours read again.
 * Same graph as three's ToonOutlinePassNode._createMaterial (r186) with min(pos.w, inkFar).
 */
function capInkDistance(pass, inkFar) {
  const create = pass._createMaterial.bind(pass);
  pass._createMaterial = () => {
    const material = create();
    const mvp = cameraProjectionMatrix.mul(modelViewMatrix);
    const pos = mvp.mul(vec4(positionLocal, 1.0));
    const pos2 = mvp.mul(vec4(positionLocal.add(normalLocal.negate()), 1.0));
    material.vertexNode = pos.add(normalize(pos.sub(pos2)).mul(pass.thicknessNode).mul(min(pos.w, inkFar)));
    return material;
  };
}

/** Tone mapping from the tokens ('aces' | 'agx' | 'neutral'). */
export function toneMappingOf(name = STYLE.toneMapping) {
  return name === 'agx' ? THREE.AgXToneMapping : name === 'neutral' ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
}

/**
 * Full pipeline. `await renderer.init()` first. Call pipeline.render() each frame.
 * Tone mapping + sRGB happen inside renderOutput(), so outputColorTransform is disabled.
 */
export function createComicPipeline(renderer, scene, camera, opts = {}) {
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, opts.maxPixelRatio ?? STYLE.maxPixelRatio));
  renderer.toneMapping = toneMappingOf(opts.toneMapping);
  renderer.toneMappingExposure = opts.exposure ?? STYLE.grade.exposure;
  scene.background ??= new THREE.Color(PALETTE.void);
  const built = buildComicOutput(scene, camera, opts);
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  pipeline.outputNode = built.outputNode;
  return { pipeline, ...built, render: () => pipeline.render(), setSize: (w, h) => renderer.setSize(w, h) };
}

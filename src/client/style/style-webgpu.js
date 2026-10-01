// style-webgpu.js — the stylised-realistic look for WebGPURenderer (three/webgpu + TSL), r186+.
// LOOK (docs/design/LOOK.md): stylised-realistic, locked Wave 12 by the Godot build (engines/godot/look/), on the web
// since Wave 13: a muted, moonlit overcast night after rain. The HARDENED comic look (ink hull, crease lines, stepped
// toon bands, the dusk grade) is retired (docs/design/HARDENED.md).
// Public API (unchanged names, new look): toon(), toonMaterial(), glow(), stylize(), pbr(), addCreaseInk() (a no-op),
// createStyleLights(), createGrade(), buildComicOutput() / createComicPipeline() (aliases of buildStyleOutput() /
// createStylePipeline()). Never import 'three' next to 'three/webgpu' in one app.
//
// Materials. toon() keeps its parameters and returns a StyleMaterial: a MeshStandardNodeMaterial (GGX, physically based)
// with roughness and metalness per surface (SURFACES presets or per-vertex `surface` values), procedural weathering in
// TSL (object/world space, no textures): grime blotches + vertical streaks, chipped lighter edges where the surface
// curves hard, a mud band near the object's local floor, sun-bleach fade; and the night's wetness [godot look.gd
// WET_DARKEN / WET_ROUGH]: porous albedo darkens, roughness falls (metal and paint most), up-facing faces soak most,
// puddles pool on flat ground. The wetness never falls below STYLE.wet.floor (the locked night never dries).
// Per-material values (rough, metal, grime, wear, mud, fade, wetK, puddle) are read with materialReference, so materials
// that differ only in those share one shader program. Detail is fixed per quality tier at build (setStyleDetail):
//   0 low: wetness + sky reflection, no noise masks
//   1 medium: + one grime octave, edge wear, mud, puddles
//   2 high: + second grime octave, wall streaks, specular anti-aliasing
// No stepped bands, no ink: the material is not a toon material (no ink pass exists, and nothing draws a hull).
// toon({ rim }) compiles in the character readability term (STYLE.rim): a cool Fresnel edge plus a flat fill as light
// on the albedo, growing with distance [godot pet_materials.gd coat rim + self-lit fill].
// glow() stays unlit (MeshBasicNodeMaterial, > 1 so bloom catches it). stylize() converts imported materials to the
// same StyleMaterial (keeping colour, map, emissive, roughness, metalness) and adds no ink. pbr() keeps an authored
// GLB's own maps (baseColor / ORM / normal) inside the same rig and wetness.
//
// Lighting (StyleLightingModel, every lit style material): three's physically based model, plus
//   - the sky reflection (STYLE_ENV: no env map; the night sky's zenith / horizon / ground colours by reflection
//     direction, Fresnel-weighted), so wet ground and metal mirror the sky and its sodium glow;
//   - lights flagged `userData.diffuseOnly` (the moon and the sky fill) add no specular [godot moon light_specular 0];
//   - the W10 P5 interiors: the sky fill (`userData.skyFill`) does not reach inside WorldData.interiors.
//
// Post (buildStyleOutput): one scene pass (no outline pass), bloom on emissives only (an HDR threshold above anything
// lit), the exposure (STYLE.grade.exposure × STYLE_EXPOSURE) and AgX tone mapping [godot tonemap AgX 1.25], then the
// display-space grade [godot adjustments: brightness, contrast, saturation, the colour-correction curve].
import * as THREE from 'three/webgpu';
import {
  renderOutput, uniform, vec3, vec4, float, mix, smoothstep, luminance,
  screenUV, time, Fn, fract, sin, dot, vec2, min, max, normalize, positionWorld, normalWorld, normalView,
  normalWorldGeometry, positionViewDirection, reflect, fwidth, length, clamp, abs, floor, sqrt,
  mx_noise_float, materialReference, attribute, diffuseColor, roughness, metalness, specularColor, specularColorBlended,
  diffuseContribution, BRDF_Lambert, uniformArray, Loop, materialColor, materialRoughness, cameraWorldMatrix,
  cameraPosition, texture, faceDirection, materialNormal, materialMetalness, positionView, positionGeometry,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { PALETTE, STYLE, SURFACES } from './style-tokens.js';
import { matKey } from './style-utils.js';

/** The look's name (docs/design/LOOK.md; Godot: look.gd LOOK). */
export const LOOK = 'stylised-realistic';

const materialCache = new Map();

// ---------------------------------------------------------------------------------------------------------------------
// Shared uniforms: the weather and the sky drive every style material through these (world/sky.ts writes them).

/**
 * Weather inputs of the look (0..1): wet = surface wetness, rain = rain intensity (post rain sheet), dark = storm
 * darkness; floor = the wetness the night never drops below (STYLE.wet.floor; materials use max(wet, floor)).
 */
export const STYLE_WEATHER = { wet: uniform(0), rain: uniform(0), dark: uniform(0), floor: uniform(STYLE.wet.floor) };
/** The sky reflection (no env map): linear sky colours, set by the sky (sky.ts) on every weather change. */
export const STYLE_ENV = {
  zenith: uniform(new THREE.Color(0.013, 0.017, 0.027)),
  horizon: uniform(new THREE.Color(0.012, 0.016, 0.026)),
  ground: uniform(new THREE.Color(0.0015, 0.002, 0.003)),
  intensity: uniform(STYLE.env.intensity),
};

/** Character rim + fill (STYLE.rim): colour × gain (a live hook: a menu or a cutscene can dim it; 1 in play). */
export const STYLE_RIM = { color: uniform(new THREE.Color(STYLE.rim.color)), gain: uniform(1) };

/**
 * A multiplier on the exposure (STYLE.grade.exposure), applied to the linear HDR colour just before tone mapping (the
 * same maths as renderer.toneMappingExposure). The locked night keeps it at 1 (sky.ts); a hook for cutscenes and labs.
 */
export const STYLE_EXPOSURE = uniform(1);

/**
 * W10 P5 interiors (WorldData.interiors): world-space boxes where the sky fill (the directional flagged
 * `userData.skyFill`) and the character rim + fill do not reach, and where the wetness stays out. Two vec4 per box
 * (min, max); `count` boxes are live. The sky sets them from the world (createYardSky({ interiors })).
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
 * `n`, 0 inside an interior. Same maths as interiorOpenFor below.
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
 * the air it faces) is tested against every box, feathered over `feather` m inside the box faces.
 */
const interiorOpenFor = (N) => Fn(() => {
  const I = STYLE.interior;
  const p = positionWorld.add(N.mul(I.probe));
  const shut = float(0).toVar('interiorShut');
  Loop(STYLE_INTERIORS.count, ({ i }) => {
    const lo = STYLE_INTERIORS.boxes.element(i.mul(2)).xyz;
    const hi = STYLE_INTERIORS.boxes.element(i.mul(2).add(1)).xyz;
    const d = min(p.sub(lo), hi.sub(p));
    shut.assign(max(shut, smoothstep(0, I.feather, min(min(d.x, d.y), d.z))));
  });
  return float(1).sub(shut);
});
/** On the geometry normal: the shading normal may read the wetness (a node cycle if it fed the interior test). */
const interiorOpenGeometry = interiorOpenFor(normalWorldGeometry);

let detail = 2;
/** Tier → material detail (see the header). */
export const DETAIL_BY_TIER = { low: 0, medium: 1, high: 2 };
/** Sets the material detail for materials created from now on (renderer: once, before the world/characters build). */
export function setStyleDetail(level) { detail = Math.max(0, Math.min(2, Math.round(Number(level) || 0))); }
export const styleDetail = () => detail;

const W = STYLE.weathering;
const V3 = (a) => vec3(a[0], a[1], a[2]);
const colorVec = (hex) => { const c = new THREE.Color(hex); return vec3(c.r, c.g, c.b); };
/** 1 at x <= lo, 0 at x >= hi (a falling smoothstep; GLSL ES leaves smoothstep with edge0 > edge1 undefined). */
const fall = (hi, lo, x) => float(1).sub(smoothstep(lo, hi, x));
/** The night's wetness 0..1 before a material's own wetK: the weather's, never under the floor. */
const nightWet = () => max(STYLE_WEATHER.wet, STYLE_WEATHER.floor);
/** Rain exposure of a surface by its world normal's y: up-facing soaks fully, walls partly, undersides barely. */
const soakExposure = (ny) => mix(mix(float(STYLE.wet.underSoak), float(STYLE.wet.sideSoak), smoothstep(-0.7, 0.0, ny)), float(1), smoothstep(0.2, 0.75, ny));

// ---------------------------------------------------------------------------------------------------------------------
// Lighting model

/** Roughness-aware Fresnel for the environment term (Karis/Lazarov-style: rough surfaces reflect less at grazing). */
const envFresnel = Fn(({ f0, dotNV, rough }) => {
  const f90 = max(float(1).sub(rough).pow2(), f0.x);
  return f0.add(vec3(f90).sub(f0).mul(float(1).sub(dotNV).pow(5)));
});

/**
 * Every lit style material's lighting: three's PhysicalLightingModel (GGX, multi-scattering) plus the sky reflection,
 * diffuse-only lights, the interiors and (characters) the rim + fill. Options:
 *   open   1 where the sky reaches, 0 inside an interior (null = everywhere open)
 *   env    gain on the sky reflection (× STYLE_ENV.intensity)
 *   rim    compile in the character rim + fill (STYLE.rim)
 *   wrap, floor  pbr()'s optional shade-side read: max(saturate((N.L + w) / (1 + w)), floor) (0, 0 = plain N.L)
 */
export class StyleLightingModel extends THREE.PhysicalLightingModel {
  constructor({ open = null, env = 1, rim = false, wrap = 0, floor = 0 } = {}) {
    super();
    this.open = open; this.env = env; this.rim = rim; this.wrap = wrap; this.floor = floor;
  }

  direct(params, builder) {
    const light = params.lightNode?.light;
    // W10 P5: the sky fill does not reach inside WorldData.interiors; characters keep STYLE.interior.charSky of it
    if (this.open && light?.userData?.skyFill) {
      params = { ...params, lightColor: params.lightColor.mul(this.rim ? mix(float(STYLE.interior.charSky), float(1), this.open) : this.open) };
    }
    const { lightDirection, lightColor, reflectedLight } = params;
    if (light?.userData?.diffuseOnly) {
      // the moon behind cloud and the sky fill: diffuse only, no glint on the puddles
      const dotNL = normalView.dot(lightDirection).clamp();
      reflectedLight.directDiffuse.addAssign(dotNL.mul(lightColor).mul(BRDF_Lambert({ diffuseColor: diffuseContribution })));
    } else super.direct(params, builder);
    if (this.wrap > 0 || this.floor > 0) {
      const nl = normalView.dot(lightDirection);
      const extra = max(nl.add(this.wrap).div(1 + this.wrap).clamp(), float(this.floor)).sub(nl.clamp());
      reflectedLight.directDiffuse.addAssign(extra.mul(lightColor).mul(BRDF_Lambert({ diffuseColor: diffuseContribution })));
    }
  }

  indirect(builder) {
    super.indirect(builder);
    const { ambientOcclusion, reflectedLight } = builder.context;
    const ao = ambientOcclusion ?? float(1);
    // the shading normal reflected in view space, then to world for the sky lookup
    const Rv = reflect(positionViewDirection.negate(), normalView);
    const R = normalize(cameraWorldMatrix.mul(vec4(Rv, 0)).xyz);
    const sky = mix(STYLE_ENV.horizon, STYLE_ENV.zenith, smoothstep(0.03, 0.6, R.y));
    const sharp = mix(STYLE_ENV.ground, sky, smoothstep(-0.14, 0.03, R.y));
    const blurred = mix(STYLE_ENV.ground, STYLE_ENV.horizon.add(STYLE_ENV.zenith).mul(0.5), 0.55);
    const env = mix(sharp, blurred, roughness.clamp(0, 1));
    const F = envFresnel({ f0: specularColorBlended, dotNV: normalView.dot(positionViewDirection).clamp(), rough: roughness });
    const dim = float(1).sub(STYLE_WEATHER.dark.mul(STYLE.env.stormDim));
    reflectedLight.indirectSpecular.addAssign(env.mul(F).mul(STYLE_ENV.intensity.mul(this.env)).mul(dim).mul(ao));
    if (this.rim) {
      // characters: light on the albedo, a Fresnel edge plus a flat fill, both growing from `near` to `far` metres.
      // Not occluded: it is the read that separates a pet from the ground at range, front or back.
      const R2 = STYLE.rim;
      const V = cameraPosition.sub(positionWorld).normalize();
      const edge = float(1).sub(normalWorld.dot(V).clamp()).pow(R2.power);
      const far = smoothstep(R2.near, R2.far, length(cameraPosition.sub(positionWorld)));
      // the edge takes the cool rim colour; the fill is the albedo's own colour [godot coat: emission = the coat colour,
      // multiplied], so a warm coat stays warm and the two species keep their hues at range
      let light = STYLE_RIM.color.mul(edge.mul(mix(float(R2.nearGain), float(R2.farGain), far))).add(mix(float(R2.nearFill), float(R2.farFill), far));
      // inside an interior the rim + fill fades to STYLE.interior.charKeep (a pet in a tunnel is lit by the tunnel)
      if (this.open) light = light.mul(mix(float(STYLE.interior.charKeep), float(1), this.open));
      reflectedLight.indirectDiffuse.addAssign(diffuseColor.rgb.mul(light).mul(STYLE_RIM.gain.mul(materialReference('rim', 'float'))));
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
 * @property {number} [steps] ignored (W13: no stepped bands; kept so old calls still work)
 * @property {THREE.Side} [side]
 * @property {boolean} [vertexColors]
 * @property {boolean} [transparent]
 * @property {number} [opacity]
 * @property {boolean} [ink] false: tagged 'toon-noink' (the factory family of decals, foliage, glass); nothing is inked
 * @property {string} [surface] a SURFACES preset: default fur cloth armor metal weapon world wood ground foliage water plastic
 * @property {number} [rough] 0..1 (overrides the preset)
 * @property {number} [metal] 0..1
 * @property {number} [grime] 0..1
 * @property {number} [wear] 0..1
 * @property {number} [mud] 0..1
 * @property {number} [fade] 0..1
 * @property {number} [wetK] 0..1
 * @property {number} [puddle] 0..1 puddle coverage on flat up-facing parts
 * @property {boolean} [surfaceAttr] read (rough, metal, grime, wear) from a `surface` vec4 vertex attribute (paintSurface)
 * @property {number} [rim] 0..1 character rim + fill strength (STYLE.rim; compiled in only when > 0 at creation)
 */

const SURF_KEYS = ['rough', 'metal', 'grime', 'wear', 'mud', 'fade', 'wetK', 'puddle'];

/**
 * The material toon() returns (W13): a MeshStandardNodeMaterial with the weathering, the wetness and the style's
 * lighting model. Hooks for code that builds its own surfaces (the terrain): `roughnessNode` = the BASE roughness per
 * pixel (before grime and wetness; overrides `rough`), `wetNode` = extra wetness 0..1 (max-ed with the night's),
 * `puddleNode` = the puddle mask 0..1 (replaces the built-in noise puddles; it carries its own wet and flat gating).
 */
export class StyleMaterial extends THREE.MeshStandardNodeMaterial {
  static get type() { return 'StyleNodeMaterial'; }

  constructor(params = {}) {
    const own = {};
    const rest = { ...params };
    for (const k of [...SURF_KEYS, 'detail', 'surfaceAttr', 'rim']) { own[k] = rest[k]; delete rest[k]; }
    super(rest);
    this.isStyleMaterial = true;
    const s = SURFACES.default;
    this.rough = own.rough ?? s.rough;
    this.metal = own.metal ?? s.metal;
    this.grime = own.grime ?? s.grime;
    this.wear = own.wear ?? s.wear;
    this.mud = own.mud ?? s.mud;
    this.fade = own.fade ?? s.fade;
    this.wetK = own.wetK ?? s.wetK;
    /** Puddle coverage on flat up-facing parts (0 = none; compiled in only when > 0 at creation, or a puddleNode). */
    this.puddle = own.puddle ?? s.puddle;
    /** Material detail (0 low, 1 medium, 2 high), fixed at creation. */
    this.detail = own.detail ?? detail;
    this.surfaceAttr = !!own.surfaceAttr;
    /** Character rim + fill strength 0..1 (STYLE.rim; compiled in only when > 0 at creation). */
    this.rim = own.rim ?? 0;
    this.roughnessNode = null;
    this.wetNode = null;
    this.puddleNode = null;
    this._w = null;
    this._open = null;
  }

  customProgramCacheKey() {
    return `${super.customProgramCacheKey()}|sty${this.detail}${this.surfaceAttr ? 's' : ''}${this.puddle > 0 || this.puddleNode ? 'p' : ''}${this.rim > 0 ? 'r' : ''}`;
  }

  setupLightingModel() { return new StyleLightingModel({ open: this._open, rim: this.rim > 0 }); }

  /** A rim material (a character) sheds STYLE.rim.fogCut of the fog: it keeps its read through a storm. */
  setupFog(builder, outputNode) {
    const fogged = super.setupFog(builder, outputNode);
    if (!(this.rim > 0) || !builder.fogNode) return fogged;
    return mix(fogged, outputNode, float(STYLE.rim.fogCut));
  }

  /**
   * Weathering masks + final albedo / roughness / metal nodes (built once per program build). With surfaceAttr, a
   * geometry that lacks the `surface` attribute falls back to the material values (three keys programs by geometry
   * attributes, so both variants coexist) instead of reading zeros (= a mirror).
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
    const open = this._open ?? float(1);

    let col = diffuseColor.rgb;
    // sun-bleach: toward a warm grey of the same luminance
    col = mix(col, vec3(luminance(col)).mul(V3(W.fadeTint)), fadeK);
    // the night's wetness: up-facing soaks fully, walls partly, undersides barely; interiors stay dry
    const ny = normalWorld.y;
    let wet = nightWet().mul(wetK).mul(soakExposure(ny)).mul(open);
    if (this.wetNode) wet = max(wet, this.wetNode);
    wet = wet.clamp(0, 1).toVar('styleWet');

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
      // puddles: flat, up-facing low spots hold water: dark, mirror-smooth, they reflect the sky and the floods
      if (this.puddleNode) puddle = this.puddleNode;
      else if (this.puddle > 0) {
        const pn = mx_noise_float(vec3(P.x.mul(0.13), 0.37, P.z.mul(0.13))).add(n1.mul(0.08));
        const pthr = mix(float(0.62), float(0.02), materialReference('puddle', 'float'));
        puddle = smoothstep(pthr, pthr.add(0.1), pn).mul(smoothstep(0.965, 0.995, ny)).mul(smoothstep(0.3, 0.9, nightWet().mul(wetK))).mul(open);
      }
    } else if (this.puddleNode) puddle = this.puddleNode;
    puddle = float(puddle).clamp(0, 1).toVar('stylePuddle');
    col = mix(col, col.mul(V3(W.grimeTint)), grime.mul(0.9));
    col = mix(col, col.mul(V3(W.wearTint)).add(W.wearLift), wear);
    col = mix(col, colorVec(W.mudColor), mud.mul(0.85));
    // wet [godot WET_DARKEN]: the albedo darkens (porous surfaces show it; metal's diffuse is small anyway)
    const metalK = clamp(metal0.add(wear.mul(0.3).mul(metal0.add(0.2))), 0, 1).toVar('styleMetal');
    col = col.mul(mix(float(1), float(STYLE.wet.darken), wet.mul(float(1).sub(metalK.mul(0.5)))));
    col = mix(col, col.mul(STYLE.wet.puddleAlbedo), puddle);

    let r = rough0.add(grime.mul(0.12)).sub(wear.mul(0.22)).add(mud.mul(0.08));
    // wet [godot WET_ROUGH, kit_wet]: porous surfaces keep more of their roughness than metal and paint; tops smoothest
    const keep = mix(float(STYLE.wet.rough), float(STYLE.wet.roughPorous), float(1).sub(metalK).mul(rough0.clamp(0, 1)));
    r = r.mul(mix(float(1), keep, wet)).mul(mix(float(1), float(STYLE.wet.top), smoothstep(0.85, 0.95, ny).mul(wet)));
    r = mix(r, float(STYLE.wet.puddleRough), puddle);
    if (lv >= 2) {
      // specular AA: widen the lobe where the normal changes faster than a pixel (no sparkle on small bevels)
      const dn = fwidth(normalView);
      r = sqrt(r.mul(r).add(min(dot(dn, dn).mul(0.5), float(0.18))));
    }
    r = clamp(r, 0.03, 1);
    return { albedo: col, rough: r, metal: metalK, wet, puddle };
  }

  setupDiffuseColor(builder) {
    super.setupDiffuseColor(builder);
    // W10 P5: evaluated once per fragment, before lighting (setupLightingModel hands it to the lighting model)
    this._open = interiorOpenFor(normalWorld)().toVar('styleOpen');
    this._w = this._weathering(builder);
    diffuseColor.assign(vec4(this._w.albedo, diffuseColor.a));
  }

  setupVariants(builder) {
    const w = this._w ?? this._weathering(builder);
    metalness.assign(w.metal);
    roughness.assign(w.rough);
    this.setupSpecular();
    if (this.puddle > 0 || this.puddleNode) {
      // standing water is a stronger mirror than the ground under it [godot wet_ground SPECULAR 0.5 -> 0.9]
      const f0 = vec3(0.04).mul(mix(float(1), float(STYLE.ground.puddleF0), w.puddle));
      specularColor.assign(f0);
      specularColorBlended.assign(mix(f0, diffuseColor.rgb, metalness));
    }
    diffuseContribution.assign(diffuseColor.rgb.mul(float(1).sub(metalness)));
  }

  copy(source) {
    super.copy(source);
    for (const k of SURF_KEYS) this[k] = source[k];
    this.detail = source.detail;
    this.surfaceAttr = source.surfaceAttr;
    this.rim = source.rim;
    this.roughnessNode = source.roughnessNode;
    this.wetNode = source.wetNode;
    this.puddleNode = source.puddleNode;
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
 * A NEW (uncached) style material, for code that sets its own nodes (colorNode, normalNode, roughnessNode, wetNode,
 * puddleNode, positionNode...), e.g. the world's terrain, prop and foliage materials. Same look as toon().
 * @param {ToonParams} p
 */
export function toonMaterial(p = {}) {
  const { color = PALETTE.hull, emissive = 0x000000, emissiveIntensity = 1, map = null,
    side = THREE.FrontSide, vertexColors = false, transparent = false, opacity = 1, ink = true, surfaceAttr = false, rim = 0 } = p;
  const m = new StyleMaterial({
    color, emissive, emissiveIntensity, map, side, vertexColors, transparent, opacity, ...surfaceOf(p), surfaceAttr, rim,
  });
  // the factory family tag (audits: "made by the style factory"); 'toon-noink' marks the decal/foliage/glass family.
  // Neither is a toon material any more and nothing is inked.
  m.userData.style = ink ? 'toon' : 'toon-noink';
  m.userData.surface = p.surface ?? 'default';
  return m;
}

/**
 * The shared, cached style material. Same params → same instance (never dispose it).
 * @param {ToonParams} p
 */
export function toon(p = {}) {
  const { color = PALETTE.hull, emissive = 0x000000, emissiveIntensity = 1, map = null,
    side = THREE.FrontSide, vertexColors = false, transparent = false, opacity = 1, ink = true, surfaceAttr = false, rim = 0 } = p;
  const key = matKey({
    color, emissive, emissiveIntensity, map: map?.uuid ?? null, side, vertexColors, transparent, opacity, ink,
    surfaceAttr, detail, rim, ...surfaceOf(p),
  });
  let m = materialCache.get(key);
  if (!m) { m = toonMaterial(p); materialCache.set(key, m); }
  return m;
}

/** Glowing parts: unlit, bright (> the bloom threshold, so only these bloom). */
export function glow(color = PALETTE.glowCyan, intensity = 3) {
  const key = matKey({ glow: color, intensity });
  if (materialCache.has(key)) return materialCache.get(key);
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = uniform(new THREE.Color(color)).mul(intensity); // vec3(Color) renders black in r186
  m.userData.style = 'glow';
  materialCache.set(key, m);
  return m;
}

/**
 * Retired (W13, docs/design/LOOK.md): the look draws no crease ink. Kept so callers still work: adds nothing to `mesh`
 * and returns null (callers already treat null as "no ink": skinned meshes and geometry-less objects returned it).
 * @param {THREE.Object3D} _mesh @param {object} [_opts]
 * @returns {null}
 */
export function addCreaseInk(_mesh, _opts) { return null; }

/**
 * Converts foreign materials (generators, GLBs) to the style: glow for pure emissives, glass stays, the rest become
 * toon() style materials keeping colour, map, emissive and (from PBR materials) roughness/metalness. `surface` sets the
 * weathering preset for everything converted. Adds no ink and leaves the geometry (and its normals) alone.
 * @param {THREE.Object3D} root
 * @param {{ creases?: boolean, creaseDeg?: number, remap?: (m: any, o: any) => any, surface?: string }} [opts]
 *   creases / creaseDeg are ignored (W13: no crease ink); kept so old calls still work
 */
export function stylize(root, { remap, surface } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const convert = (m) => {
      if (!m || m.userData?.style) return m;
      if (remap) { const r = remap(m, o); if (r) return r; }
      const isGlow = m.emissive && m.emissive.getHex() !== 0 && (!m.color || m.color.getHex() === 0);
      if (isGlow) return glow(m.emissive.getHex(), m.emissiveIntensity ?? 3);
      const isGlass = m.transmission > 0 || (m.opacity < 1 && m.transparent);
      if (isGlass) return m;
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
  });
  return root;
}

// ---------------------------------------------------------------------------------------------------------------------
// pbr(): authored PBR assets (shared GLBs, docs/design/ASSET_PIPELINE.md stage 5; stage 6 = the non-destructive layer)

/**
 * Bump from a procedural height `h` (metres) on the view-space normal `N`: Mikkelsen's surface-gradient method with
 * unnormalized screen derivatives, so a 2 mm dent reads as 2 mm at every distance.
 */
export const bumpHeight = Fn(([N, h]) => {
  const sx = positionView.dFdx(), sy = positionView.dFdy();
  const R1 = sy.cross(N), R2 = N.cross(sx);
  const det = sx.dot(R1).mul(faceDirection);
  const grad = det.sign().mul(h.dFdx().mul(R1).add(h.dFdy().mul(R2)));
  return abs(det).mul(N).sub(grad).normalize();
});

/** The material pbr() returns: a MeshStandardNodeMaterial lit by StyleLightingModel. */
export class StylePbrMaterial extends THREE.MeshStandardNodeMaterial {
  static get type() { return 'StylePbrNodeMaterial'; }
  constructor(params) {
    super(params);
    this.isStylePbrMaterial = true;
    /** 1 where the sky reaches (interior test), null = no interior test. */
    this.openNode = null;
    /** Sky-reflection gain (× STYLE_ENV.intensity). */
    this.envGain = 1;
    /** Diffuse wrap w and shade floor (0, 0 = plain N.L). */
    this.wrap = 0;
    this.shadeFloor = 0;
  }
  customProgramCacheKey() { return `${super.customProgramCacheKey()}|spbr${this.openNode ? 'i' : ''}${this.envGain}w${this.wrap}f${this.shadeFloor}`; }
  setupLightingModel() { return new StyleLightingModel({ open: this.openNode, env: this.envGain, wrap: this.wrap, floor: this.shadeFloor }); }
}

/** The per-instance paint tint attribute pbr({ paintTint: true }) reads (vec3, linear; an InstancedBufferAttribute). */
export const PBR_PAINT_TINT = 'paintTint';

/**
 * The sanctioned entry point for authored PBR assets (a shared GLB's materials, docs/design/ASSET_PIPELINE.md). Keeps the
 * source material's maps (baseColor, the ORM pair: occlusion R / roughness G / metalness B, normal, emissive) and
 * factors, inside the style rig: the same lights, the sky reflection (STYLE_ENV), the night's wetness [godot kit_wet:
 * porous parts darken and stay rougher, metal and paint get the water film, tops smoothest], the interiors, and the post
 * chain. Cached: the same source + opts give one instance. Every knob is in STYLE.pbr:
 *   paintTint   the geometry's per-instance `paintTint` (PBR_PAINT_TINT) multiplies the albedo only where the baseColor
 *               alpha (the kit's paint mask) is 1: rust, grime and frame keep their own colour
 *   detail*     two world-space noise scales (m^-1): a bump (m), albedo mottling and roughness breakup, faded out once a
 *               pixel covers a good part of a wavelength (no far shimmer)
 *   scratch     micro-scratches on the paint (contour lines of a stretched noise, in patches): lighter, smoother metal
 *   rivulets    rain running down walls while it rains (STYLE_WEATHER.rain): darker, near-mirror lines
 *   puddle      flat up-facing low spots pool water: dark, mirror-smooth, flat normal
 * Wetness never reaches inside WorldData.interiors (a container's floor and inner walls stay dry).
 * @param {any} src a GLTFLoader material (MeshStandardMaterial / MeshPhysicalMaterial)
 * @param {Partial<typeof STYLE.pbr>} [opts] overrides of STYLE.pbr
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

  // world metres: the web variant's KHR_mesh_quantization leaves the geometry in quantized units (the dequantization
  // lives on the node / the instance matrix), so positionGeometry is not metres there; kit pieces never move
  const G = positionWorld;
  const foot = length(fwidth(G));
  const lod = (freq) => fall(0.4 / freq, 0.12 / freq, foot);
  const [f1, f2] = P.detailFreq, [b1, b2] = P.detailBump;
  const d1 = mx_noise_float(G.mul(f1)).mul(lod(f1)).toVar('pbrD1');                     // dents, mottling (~30 cm)
  const d2 = mx_noise_float(G.mul(f2).add(vec3(3.1, 7.7, 1.3))).mul(lod(f2)).toVar('pbrD2');   // grain (~4 cm)
  const mask = m.map && P.paintTint ? texture(m.map).a : float(0);
  let scratch = float(0);
  if (P.scratch > 0) {
    // contour lines of a noise stretched along y (mostly level marks on walls), in patches, thin at every distance
    const [sa, sb] = P.scratchFreq;
    const sn = mx_noise_float(G.mul(vec3(sa, sb, sa)).add(vec3(-5.3, 0.7, 2.9)));
    const line = fall(fwidth(sn).mul(1.2).add(0.02), float(0), abs(sn));
    const patch = smoothstep(0.1, 0.5, mx_noise_float(G.mul(0.7).add(vec3(9.1, -3.3, 4.7))));
    scratch = line.mul(patch).mul(lod(sb)).mul(P.scratch).mul(P.paintTint ? mask : float(1)).toVar('pbrScratch');
  }
  // the night's wetness (sheltered interiors stay dry), rivulets on walls while it rains, puddles on flat tops
  const open = P.interiors ? interiorOpenGeometry().toVar('pbrOpen') : float(1);
  const ny = normalWorldGeometry.y;                               // the surface's own facing (not the bumps)
  const wet = nightWet().mul(P.wetK).mul(soakExposure(ny)).mul(open).clamp(0, 1).toVar('pbrWet');
  let riv = float(0), puddle = float(0);
  if (P.rivulets > 0) {
    const q = vec3(G.x.mul(6.5), G.y.mul(0.8).add(time.mul(0.9)), G.z.mul(6.5));
    const rn = mx_noise_float(q);
    const wall = float(1).sub(abs(ny)).pow(2);
    riv = fall(fwidth(rn).add(0.05), float(0), abs(rn)).mul(wall).mul(STYLE_WEATHER.rain).mul(wet.min(1).mul(1.5).min(1)).mul(lod(6.5)).mul(P.rivulets).toVar('pbrRiv');
  }
  if (P.puddle > 0) {
    const pn = mx_noise_float(vec3(G.x.mul(0.35), 0.37, G.z.mul(0.35))).add(d1.mul(0.08));
    const pthr = mix(float(0.62), float(0.02), P.puddle);
    puddle = smoothstep(pthr, pthr.add(0.1), pn).mul(smoothstep(0.965, 0.995, ny)).mul(smoothstep(0.3, 0.9, nightWet().mul(P.wetK))).mul(open).toVar('pbrPuddle');
  }

  const porous = float(1).sub(materialMetalness.clamp(0, 1));
  let c = materialColor.rgb;
  if (P.paintTint) c = c.mul(mix(vec3(1), attribute(PBR_PAINT_TINT, 'vec3'), mask));
  c = c.mul(d1.mul(P.detailAlbedo).add(1));
  c = mix(c, c.mul(1.15).add(0.02), scratch);
  // wet [godot kit_wet]: everything darkens, porous (non-metal) parts soak darker still
  c = c.mul(mix(float(1), float(STYLE.wet.darken), wet)).mul(mix(float(1), float(0.6), porous.mul(wet)));
  c = c.mul(float(1).sub(riv.mul(0.2)));
  c = mix(c, c.mul(STYLE.wet.puddleAlbedo), puddle);
  m.colorNode = c;

  let r = materialRoughness.add(d2.mul(P.detailRough)).sub(scratch.mul(0.15));
  // soaked canvas / concrete stay fairly rough; painted metal gets the water film; top faces smoothest
  r = r.mul(mix(float(1), mix(float(STYLE.wet.rough), float(STYLE.wet.roughPorous), porous), wet));
  r = r.mul(mix(float(1), float(STYLE.wet.top), smoothstep(0.85, 0.95, ny).mul(wet)));
  r = mix(r, float(0.06), riv);
  r = mix(r, float(STYLE.wet.puddleRough), puddle);
  m.roughnessNode = r.clamp(0.04, 1);
  m.metalnessNode = materialMetalness.add(scratch.mul(0.2)).clamp(0, 1);

  // detail bump on the normal-mapped normal; puddles are flat water
  const h = d1.mul(b1).add(d2.mul(b2)).sub(scratch.mul(0.0004));
  m.normalNode = mix(bumpHeight(materialNormal, h), normalView, puddle).normalize();
  m.openNode = P.interiors ? open : null;
  m.envGain = P.env;
  m.wrap = P.wrap;
  m.shadeFloor = P.shadeFloor;
  m.userData.style = 'pbr';
  materialCache.set(key, m);
  return m;
}

/**
 * The light rig: the moon as the key (shadow-mapped by the sky; diffuse only), the sky fill (`skyFill`: interiors shut
 * it out; diffuse only) and the hemisphere light as the sky ambient. The sky (world/sky.ts) drives all three.
 */
export function createStyleLights() {
  const L = STYLE.lights, g = new THREE.Group();
  const key = new THREE.DirectionalLight(L.key.color, L.key.intensity); key.position.fromArray(L.key.dir).multiplyScalar(10);
  key.userData.diffuseOnly = true;
  const rim = new THREE.DirectionalLight(L.rim.color, L.rim.intensity); rim.position.fromArray(L.rim.dir).multiplyScalar(10);
  rim.userData.skyFill = true;
  rim.userData.diffuseOnly = true;
  g.add(key, rim, new THREE.HemisphereLight(L.ambientSky, L.ambientGround, L.ambientIntensity));
  g.name = 'style_lights';
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// Post

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

/**
 * CPU twin of the colour-correction curve (tests, tools): each channel through its piecewise-linear curve
 * [godot GradientTexture1D, linear interpolation]. @param {number[]} rgb display values 0..1
 */
export function gradeCurveAt(rgb, curve = STYLE.grade.curve) {
  const { offsets: o, colors: c } = curve;
  return [0, 1, 2].map((k) => {
    const v = Math.min(1, Math.max(0, rgb[k]));
    let out = c[0][k];
    for (let i = 1; i < o.length; i++) out += (c[i][k] - c[i - 1][k]) * Math.min(1, Math.max(0, (v - o[i - 1]) / (o[i] - o[i - 1])));
    return out;
  });
}

/**
 * The display-space grade after tone mapping [godot apply_bcs + colour correction]: brightness, contrast about 0.5,
 * saturation about the channel mean (strong-chroma pixels and the team hues are protected when the weather pulls the
 * saturation down), then the colour-correction curve per channel, and a faint screen-space rain sheet when it rains.
 * `uniforms.saturation` is the knob the weather dims.
 */
export function createGrade(tokens = STYLE.grade) {
  const t = { ...STYLE.grade, ...tokens };
  const u = {
    brightness: uniform(t.brightness),
    contrast: uniform(t.contrast),
    saturation: uniform(t.saturation),
    signal: uniform(new THREE.Vector2(...t.signalChroma)),
    signalHue: uniform(new THREE.Vector2(...t.signalHueChroma)),
    rain: STYLE_WEATHER.rain,
    rainColor: STYLE_ENV.horizon,
  };
  const { offsets: O, colors: C } = t.curve;
  const node = Fn(([c]) => {
    let x = c.rgb.clamp(0, 1).mul(u.brightness);
    x = mix(vec3(0.5), x, u.contrast);
    const mean = x.r.add(x.g).add(x.b).div(3);
    const mx = max(max(x.r, x.g), x.b), mn = min(min(x.r, x.g), x.b);
    const chroma = mx.sub(mn);
    // team hues keep their saturation from a lower chroma up (a storm washes them below signalChroma)
    const ab = vec2(x.r.sub(x.g.add(x.b).mul(0.5)), x.g.sub(x.b).mul(0.8660254));
    const dirAB = ab.div(max(length(ab), float(1e-4)));
    const nearTeam = max(smoothstep(TEAM_HUE_COS, TEAM_HUE_COS + 0.04, dot(dirAB, TEAM_HUE[0])), smoothstep(TEAM_HUE_COS, TEAM_HUE_COS + 0.04, dot(dirAB, TEAM_HUE[1])));
    const keep = max(smoothstep(u.signal.x, u.signal.y, chroma), nearTeam.mul(smoothstep(u.signalHue.x, u.signalHue.y, chroma)));
    const sat = mix(u.saturation, max(u.saturation, float(1)), keep);
    x = mix(vec3(mean), x, sat).clamp(0, 1);
    // colour correction: per channel, the sum of clamped linear ramps between the curve's keys
    let out = V3(C[0]);
    for (let i = 1; i < O.length; i++) {
      const ramp = x.sub(O[i - 1]).div(O[i] - O[i - 1]).clamp(0, 1);
      out = out.add(V3(C[i]).sub(V3(C[i - 1])).mul(ramp));
    }
    // rain sheet: thin slanted streaks in ~150 screen columns, each with its own speed/phase
    const cx = screenUV.x.mul(150).add(screenUV.y.mul(18));
    const id = floor(cx);
    const h = fract(sin(id.mul(12.9898)).mul(43758.5453));
    const h2 = fract(sin(id.mul(78.233)).mul(24634.6345));
    const yy = fract(screenUV.y.mul(1.3).sub(time.mul(float(1.6).add(h.mul(1.1)))).add(h2.mul(9.1)));
    const along = smoothstep(0.0, 0.04, yy).mul(fall(0.3, 0.04, yy));
    const across = fall(0.16, 0.0, abs(fract(cx).sub(0.5)));
    const on = smoothstep(float(1).sub(u.rain.mul(0.7)), float(1.02).sub(u.rain.mul(0.7)), h2);
    const sheet = along.mul(across).mul(on).mul(u.rain).mul(0.06);
    out = mix(out, u.rainColor.mul(2.2).add(0.12).clamp(0, 1), sheet);
    return vec4(out, c.a);
  });
  return { node, uniforms: u };
}

/** The scene pass: three's PassNode, drawing every object once (W13: there is no outline pass and no hull). */
export class StyleScenePass extends THREE.PassNode {
  static get type() { return 'StyleScenePassNode'; }
  constructor(scene, camera) {
    super(THREE.PassNode.COLOR, scene, camera);
    this.isStyleScenePass = true;
  }
}

/**
 * Builds the output node graph (testable without a GPU): the scene pass, bloom on emissives (STYLE.bloom threshold),
 * × STYLE_EXPOSURE before tone mapping, renderOutput (tone mapping + sRGB), the grade.
 */
export function buildStyleOutput(scene, camera, opts = {}) {
  const scenePass = new StyleScenePass(scene, camera);
  const b = { ...STYLE.bloom, ...opts.bloom };
  const bloomPass = bloom(scenePass, b.strength, b.radius, b.threshold);
  const grade = createGrade(opts.grade);
  const outputNode = grade.node(renderOutput(scenePass.add(bloomPass).mul(STYLE_EXPOSURE)));
  return { outputNode, scenePass, bloomPass, grade };
}
/** The old name of buildStyleOutput (callers and labs). */
export const buildComicOutput = buildStyleOutput;

/** Tone mapping from the tokens ('agx' | 'aces' | 'neutral'). */
export function toneMappingOf(name = STYLE.toneMapping) {
  return name === 'aces' ? THREE.ACESFilmicToneMapping : name === 'neutral' ? THREE.NeutralToneMapping : THREE.AgXToneMapping;
}

/**
 * Full pipeline. `await renderer.init()` first. Call pipeline.render() each frame.
 * Tone mapping + sRGB happen inside renderOutput(), so outputColorTransform is disabled.
 */
export function createStylePipeline(renderer, scene, camera, opts = {}) {
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, opts.maxPixelRatio ?? STYLE.maxPixelRatio));
  renderer.toneMapping = toneMappingOf(opts.toneMapping);
  renderer.toneMappingExposure = opts.exposure ?? STYLE.grade.exposure;
  scene.background ??= new THREE.Color(PALETTE.void);
  const built = buildStyleOutput(scene, camera, opts);
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  pipeline.outputNode = built.outputNode;
  return { pipeline, ...built, render: () => pipeline.render(), setSize: (w, h) => renderer.setSize(w, h) };
}
/** The old name of createStylePipeline (engine/renderer.ts). */
export const createComicPipeline = createStylePipeline;

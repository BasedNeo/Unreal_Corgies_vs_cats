// World materials, all toon-lit and sharing the style system's gradient (bands, floor) from toon():
//  - terrainMaterial: palette ground (lawn stripes, clover, un-mowed edges, dirt, sand, mulch, mud)
//    from world-space TSL noise + the chunk's `surf` attribute. No image textures.
//  - toonNoInk: toon lighting WITHOUT the ink hull (foliage that sways, glass, water, decals). The
//    TSL toonOutlinePass inks every material flagged isMeshToonNodeMaterial; clearing the flag on our
//    own instance opts it out (lighting model unchanged). PROPOSED for style-webgpu.js.
//  - waterMaterial: translucent stylized water (depth tint, shore foam, drifting ripple rings).
//  - G1: WORLD_WEATHER uniforms (wet, rain, wind) shared by every world material: rain darkens and
//    cools the ground, fills puddles in flat low spots and on paths (with rain ripple rings), and wind
//    scales foliage sway amplitude (never its frequency, so gusts don't make the grass jump).
import * as THREE from 'three/webgpu';
import {
  attribute, positionWorld, positionLocal, uv, time, sin, vec3, float, mix, smoothstep, step, fract,
  mx_noise_float, uniform, abs, length, vec2, max, min, normalize, normalView, transformNormalToView, floor, normalWorld,
} from 'three/tsl';
import { toon } from '../style/style-webgpu.js';
import { worldColor } from './world-palette';

type Params = { color?: number; vertexColors?: boolean; side?: THREE.Side; transparent?: boolean; opacity?: number };

/** New toon material sharing toon()'s gradient map (same bands as every styled object). */
export function toonFrom(p: Params = {}): THREE.MeshToonNodeMaterial {
  const ref = toon({ color: 0xffffff }) as THREE.MeshToonNodeMaterial;
  const m = new THREE.MeshToonNodeMaterial({
    color: p.color ?? 0xffffff, gradientMap: ref.gradientMap, vertexColors: !!p.vertexColors,
    side: p.side ?? THREE.FrontSide, transparent: !!p.transparent, opacity: p.opacity ?? 1,
  });
  m.userData.style = 'toon';
  return m;
}

/**
 * Toon-lit material that the ink outline pass skips. toonOutlinePass inks any material with
 * isMeshToonMaterial OR isMeshToonNodeMaterial — and MeshToonNodeMaterial inherits
 * isMeshToonMaterial = true through setDefaultValues(new MeshToonMaterial()), so BOTH must be cleared.
 */
export function toonNoInk(p: Params = {}): THREE.MeshToonNodeMaterial {
  const m = toonFrom(p);
  const flags = m as unknown as { isMeshToonNodeMaterial: boolean; isMeshToonMaterial: boolean };
  flags.isMeshToonNodeMaterial = false;
  flags.isMeshToonMaterial = false;
  m.userData.style = 'toon-noink';
  return m;
}

const c = (key: string) => uniform(worldColor(key).clone());

/** Weather uniforms shared by all world materials (driven by the world view from the weather sample). */
export const WORLD_WEATHER = {
  /** Ground wetness 0..1 (darkening, puddles). */
  wet: uniform(0),
  /** Rain intensity 0..1 (puddle ripple rings). */
  rain: uniform(0),
  /** Foliage sway amplitude multiplier (1 = calm breeze). */
  wind: uniform(1),
  /** Up to two running sprinklers: (x, z, reach, wetness 0..1) — their sweep darkens the grass. */
  spr0: uniform(new THREE.Vector4(0, 0, 1, 0)),
  spr1: uniform(new THREE.Vector4(0, 0, 1, 0)),
};

export interface TerrainMaterial { material: THREE.MeshToonNodeMaterial; uniforms: Record<string, ReturnType<typeof uniform>> }

export function createTerrainMaterial({ ink = true, yardHalf = 118, flatten = 0.4, detail = true }: { ink?: boolean; yardHalf?: number; flatten?: number; detail?: boolean } = {}): TerrainMaterial {
  const U = {
    grass: c('grass'), grassDark: c('grassDark'), grassDry: c('grassDry'), clover: c('clover'),
    dirt: c('dirt'), sand: c('sand'), mulch: c('mulch'), bark: c('bark'), stripe: uniform(0.85), yardHalf: uniform(yardHalf),
  };
  const surf = attribute('surf', 'vec4');
  const p = positionWorld;
  // low quality: one noise octave feeds every pattern (cheap for software rasterizers)
  const nBig = mx_noise_float(p.xz.mul(0.045));                   // ~22 m variation
  const nMid = detail ? mx_noise_float(p.xz.mul(0.21).add(vec2(13.7, 4.1))) : nBig.mul(0.7);   // ~5 m patches
  const nFine = detail ? mx_noise_float(p.xz.mul(1.3).add(vec2(-7.3, 2.9))) : nBig.mul(-0.5);   // ~0.8 m grain
  // Lawn: mowing stripes (7 m bands along z), clover patches, a little large-scale hue drift.
  const stripe = step(0.5, fract(p.x.add(nBig.mul(2.2)).div(14)));
  const lightGrass = mix(U.grass, U.grassDry, 0.3);
  let lawn = mix(U.grass.mul(0.94), lightGrass, stripe.mul(U.stripe));
  lawn = mix(lawn, U.clover, smoothstep(0.34, 0.4, nMid).mul(0.3));
  lawn = mix(lawn, U.grassDark, smoothstep(0.3, 0.7, nBig.add(nMid.mul(0.2))).mul(0.16));
  // Un-mowed edge grass: drier, clumpy dark speckles, no stripes.
  const wildGrass = mix(mix(U.grass, U.grassDry, 0.5), U.grassDark, smoothstep(0.25, 0.32, nFine).mul(0.45));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL node types are too narrow for helpers
  const edge = (m: any, jitter: any) => smoothstep(0.44, 0.56, m.add(jitter));
  let col = mix(lawn, wildGrass, edge(surf.w, nMid.mul(0.25)));
  // Dirt paths: warm dirt with darker clods and pale pebbles.
  const dirt = mix(mix(U.dirt, U.mulch, smoothstep(0.2, 0.28, nFine).mul(0.35)), U.sand, smoothstep(0.55, 0.6, nMid.add(nFine.mul(0.4))).mul(0.3));
  col = mix(col, dirt, edge(surf.x, nMid.mul(0.22)));
  // Sand: ripples.
  const sand = U.sand.mul(float(0.94).add(sin(p.x.mul(2.1).add(p.z.mul(0.7)).add(nMid.mul(4))).mul(0.05)));
  col = mix(col, sand, edge(surf.y, nMid.mul(0.12)));
  // Mulch: dark bark chips.
  const mulch = mix(U.mulch, U.bark, smoothstep(0.18, 0.24, nFine).mul(0.5));
  col = mix(col, mulch, edge(surf.z, nMid.mul(0.2)));
  // Pond bed: dark mud under the water line.
  const wet = smoothstep(-0.12, -0.45, p.y);
  col = mix(col, U.dirt.mul(0.55), wet);
  // Neighbours' ground beyond the fence line: a little darker and flatter so the yard reads as the stage.
  const outside = smoothstep(U.yardHalf, U.yardHalf.add(14), max(abs(p.x), abs(p.z)));
  col = mix(col, mix(U.grassDark, U.grassDry, 0.35), outside.mul(0.45));
  // G1 rain: soaked ground reads darker and cooler; puddles gather on flat, low, trodden spots and
  // mirror the grey sky; raindrops ring them. Everything scales with WORLD_WEATHER (0 = dry: no-op).
  const W = WORLD_WEATHER;
  const sprWet = (u: typeof W.spr0) => u.w.mul(float(1).sub(smoothstep(u.z.sub(1.5), u.z.add(0.5), length(p.xz.sub(vec2(u.x, u.y))))));
  const wetAll = max(W.wet, max(sprWet(W.spr0), sprWet(W.spr1)));
  const soaked = col.mul(vec3(0.66, 0.72, 0.8));
  col = mix(col, soaked, wetAll.mul(0.9));
  if (detail) {
    const flat = smoothstep(0.965, 0.995, normalWorld.y);
    // puddles: mostly on trodden dirt/mulch, only the lowest spots of the lawn
    const bare = max(surf.x, surf.z);
    const lowSpot = mx_noise_float(p.xz.mul(0.13).add(vec2(3.1, -7.7))).add(bare.mul(0.55)).add(nFine.mul(0.06));
    const puddle = smoothstep(0.56, 0.6, lowSpot).mul(flat).mul(smoothstep(0.35, 0.95, wetAll)).mul(float(1).sub(outside));
    // dark water mirroring the grey sky, a lighter rim toward the deeper middle (no white blobs)
    const sheen = mix(vec3(0.16, 0.19, 0.23), vec3(0.3, 0.35, 0.42), smoothstep(0.6, 0.72, lowSpot));
    // raindrop rings: one ring per 1.3 m cell, random phase, only on puddles
    const cellP = p.xz.div(1.3);
    const cid = floor(cellP);
    const ph = fract(sin(cid.x.mul(127.1).add(cid.y.mul(311.7))).mul(43758.5453));
    const age = fract(time.mul(1.4).add(ph));
    const rd = length(fract(cellP).sub(0.5));
    const ring = smoothstep(0.05, 0.0, abs(rd.sub(age.mul(0.45)))).mul(float(1).sub(age)).mul(W.rain);
    col = mix(col, sheen, puddle.mul(0.9));
    col = col.add(vec3(ring.mul(puddle).mul(0.22)));
  }
  const material = ink ? toonFrom() : toonNoInk();
  material.colorNode = col;
  // Stylized lighting: bend shading normals toward up so gentle lawn undulation doesn't flip toon
  // bands into blotches; real slopes (mound, pond banks) still read. Geometry is untouched.
  if (flatten > 0) material.normalNode = normalize(mix(normalView, transformNormalToView(vec3(0, 1, 0)), flatten));
  return { material, uniforms: U as unknown as Record<string, ReturnType<typeof uniform>> };
}

/** Foliage: vertex + instance colors, toon-lit, no ink, wind sway by uv.y^2 (bases stay planted). */
export function createFoliageMaterial(strength: number, windDir: THREE.Vector2, opts: { side?: THREE.Side } = {}): THREE.MeshToonNodeMaterial {
  const m = toonNoInk({ vertexColors: true, side: opts.side ?? THREE.DoubleSide });
  if (strength > 0) {
    const h = uv().y.mul(uv().y);
    const phase = positionLocal.x.mul(0.11).add(positionLocal.z.mul(0.07));
    const sway = sin(time.mul(1.4).add(phase)).add(sin(time.mul(3.1).add(phase.mul(1.7))).mul(0.35));
    const amt = sway.mul(h).mul(strength).mul(WORLD_WEATHER.wind);
    m.positionNode = positionLocal.add(vec3(amt.mul(windDir.x), float(0), amt.mul(windDir.y)));
  }
  return m;
}

/**
 * Stylized water: needs a `depth` vertex attribute (meters of water under the vertex) and `center`
 * uniform for ripple rings.
 */
export function createWaterMaterial(center: THREE.Vector2): THREE.MeshToonNodeMaterial {
  const m = toonNoInk({ transparent: true, opacity: 0.86 });
  const depth = attribute('depth', 'float');
  const shallow = c('water'), deep = uniform(new THREE.Color(0x236f9a)), foam = uniform(new THREE.Color(0xeaf8ff));
  const ctr = uniform(center);
  const p = positionWorld;
  const d = length(p.xz.sub(ctr));
  const n = mx_noise_float(p.xz.mul(0.25).add(time.mul(0.05)));
  let col = mix(shallow, deep, smoothstep(0.1, 1.1, depth));
  // drifting ripple rings (thin bright bands)
  const ring = fract(d.mul(0.22).sub(time.mul(0.12)).add(n.mul(0.35)));
  col = mix(col, shallow.mul(1.25), step(0.93, ring).mul(smoothstep(0.05, 0.4, depth)));
  // shore foam: crisp band where the water is shallow
  const f = step(depth.add(n.mul(0.06)), float(0.1));
  col = mix(col, foam, f);
  m.colorNode = col;
  m.opacityNode = max(float(0.62), min(float(0.95), float(0.62).add(depth.mul(0.3)).add(f)));
  m.depthWrite = false;
  void abs;
  return m;
}

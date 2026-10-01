// World materials, all from the style factory (style-webgpu.js toonMaterial: the stylised-realistic StyleMaterial, a
// PBR MeshStandardNodeMaterial with weathering and the night's wetness; docs/design/LOOK.md):
//  - terrainMaterial: palette ground (lawn stripes, clover, un-mowed edges, sand, the E4 battle ground) from world-space
//    TSL noise + the chunk's `surf` attribute; W13: with `ground: 'asphalt'` (The Lot) trodden ground (dirt, mulch,
//    gravel, mud) is the Godot build's wet night asphalt [engines/godot/look/wet_ground.gdshader]; on the West Yard
//    (`ground: 'yard'`) it stays wet dirt, mulch and sand with the same puddles. The asphalt: a dark binder with light aggregate, paving lanes with
//    tar-sealed joints and patch repairs, cracks on old surfaces, broken aggregate on slopes; the palette colour only
//    shades it (luminance), never tints it; a wet film (rough 0.3–0.45), puddles on the flat (mirror 0.03, flat, rain
//    ripples) with a damp rim. No image textures.
//  - toonNoInk: the factory's 'toon-noink' family (foliage that sways, glass, water, decals). Nothing is inked on the
//    web any more (W13); the tag only groups these for the audits.
//  - waterMaterial: translucent water (depth tint, shore foam, drifting ripple rings), near-mirror.
//  - G1: WORLD_WEATHER uniforms (wet, rain, wind) shared by every world material: rain wets the ground further (the
//    night never dries: STYLE_WEATHER.floor), grows the puddles and rings them, and wind scales foliage sway amplitude
//    (never its frequency, so gusts don't make the grass jump).
//  - E4: per-use SURFACES presets (props 'world' or per-vertex `surface` values from prim-mesh, boards 'wood', ground
//    'ground', foliage, water). The terrain reads the `battle` vertex attribute (terrain-view.ts from fortifications.ts):
//    scorch, churned mud, standing puddles and twin tyre ruts.
import * as THREE from 'three/webgpu';
import {
  attribute, positionWorld, positionLocal, uv, time, sin, vec3, float, mix, smoothstep, step, fract, dot, fwidth,
  mx_noise_float, mx_noise_vec3, mx_worley_noise_vec2, uniform, abs, length, vec2, max, min, normalize, normalView,
  transformNormalToView, floor, normalWorldGeometry, clamp, luminance,
} from 'three/tsl';
import { toonMaterial, STYLE_WEATHER, type StyleMaterial } from '../style/style-webgpu.js';
import { STYLE } from '../style/style-tokens.js';
import { worldColor } from './world-palette';

/** The material class every world material is (the style factory's StyleMaterial). */
export type WorldMaterial = StyleMaterial;

type Params = {
  color?: number; vertexColors?: boolean; side?: THREE.Side; transparent?: boolean; opacity?: number;
  /** E4: SURFACES preset of the style factory (default 'world'). */
  surface?: string;
  /** E4: read (rough, metal, grime, wear) from the geometry's `surface` vec4 attribute (prim-mesh builds it). */
  surfaceAttr?: boolean;
  /** internal: false = the 'toon-noink' family tag. */
  ink?: boolean;
  /** W13: overrides of the preset's surface values (e.g. wetK 0 for a material that wets itself). */
  wetK?: number; puddle?: number; rough?: number; metal?: number;
};

/** A new (uncached) world material from the style factory. */
export function toonFrom(p: Params = {}): WorldMaterial {
  return toonMaterial({
    color: p.color ?? 0xffffff, vertexColors: !!p.vertexColors, side: p.side ?? THREE.FrontSide,
    transparent: !!p.transparent, opacity: p.opacity ?? 1, surface: p.surface ?? 'world', surfaceAttr: !!p.surfaceAttr, ink: p.ink ?? true,
    ...(p.wetK !== undefined ? { wetK: p.wetK } : {}), ...(p.puddle !== undefined ? { puddle: p.puddle } : {}),
    ...(p.rough !== undefined ? { rough: p.rough } : {}), ...(p.metal !== undefined ? { metal: p.metal } : {}),
  }) as WorldMaterial;
}

/** The same material in the factory's 'toon-noink' family (foliage, glass, water, decals). */
export function toonNoInk(p: Params = {}): WorldMaterial {
  return toonFrom({ ...p, ink: false });
}

const c = (key: string) => uniform(worldColor(key).clone());

/** Weather uniforms shared by all world materials (driven by the world view from the weather sample). */
export const WORLD_WEATHER = {
  /** Ground wetness 0..1 (the materials never go below STYLE_WEATHER.floor). */
  wet: uniform(0),
  /** Rain intensity 0..1 (puddle ripple rings). */
  rain: uniform(0),
  /** Foliage sway amplitude multiplier (1 = calm breeze). */
  wind: uniform(1),
  /** Up to two running sprinklers: (x, z, reach, wetness 0..1) — their sweep wets the grass. */
  spr0: uniform(new THREE.Vector4(0, 0, 1, 0)),
  spr1: uniform(new THREE.Vector4(0, 0, 1, 0)),
};

export interface TerrainMaterial { material: WorldMaterial; uniforms: Record<string, ReturnType<typeof uniform>> }

const lin = (a: readonly number[]) => { const k = new THREE.Color().setRGB(a[0], a[1], a[2], THREE.SRGBColorSpace); return vec3(k.r, k.g, k.b); };

export function createTerrainMaterial({ ink = true, yardHalf = 118, flatten = 0, detail = true, bedLevel = -0.12, ground = 'yard' }: { ink?: boolean; yardHalf?: number; /** bends the shading normal toward up (0 = the true normal) */ flatten?: number; detail?: boolean; /** W8: below this height the ground reads as a wet pond bed (The Lot's dry pits sit far lower). */ bedLevel?: number; /** W13: 'asphalt' = trodden ground is the Godot wet paved asphalt (The Lot); 'yard' = it stays wet dirt, mulch and sand (the West Yard is a back yard) */ ground?: 'asphalt' | 'yard' } = {}): TerrainMaterial {
  const paving = ground === 'asphalt';
  const G = STYLE.ground;
  const U = {
    grass: c('grass'), grassDark: c('grassDark'), grassDry: c('grassDry'), clover: c('clover'),
    dirt: c('dirt'), sand: c('sand'), mulch: c('mulch'), bark: c('bark'), stripe: uniform(0.4), yardHalf: uniform(yardHalf),
    // E4 battle ground
    mud: c('mudWet'), soot: c('soot'), ash: c('ash'), rutGauge: uniform(0.85),
    // W13 the wet night ground [godot wet_ground]
    puddleCut: uniform(G.puddleCut),
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
  const dirtK = edge(surf.x, nMid.mul(0.22)).toVar('groundDirt');
  const dirt = mix(mix(U.dirt, U.mulch, smoothstep(0.2, 0.28, nFine).mul(0.35)), U.sand, smoothstep(0.55, 0.6, nMid.add(nFine.mul(0.4))).mul(0.3));
  col = mix(col, dirt, dirtK);
  // Sand / gravel: ripples.
  const sandK = edge(surf.y, nMid.mul(0.12)).toVar('groundSand');
  const sand = U.sand.mul(float(0.94).add(sin(p.x.mul(2.1).add(p.z.mul(0.7)).add(nMid.mul(4))).mul(0.05)));
  col = mix(col, sand, sandK);
  // Mulch: dark bark chips.
  const mulchK = edge(surf.z, nMid.mul(0.2)).toVar('groundMulch');
  const mulch = mix(U.mulch, U.bark, smoothstep(0.18, 0.24, nFine).mul(0.5));
  col = mix(col, mulch, mulchK);
  // E4 battle ground (terrain-view's `battle` attribute: scorch, mud, puddle, rut signed distance in m; 0/0/0/9 = none):
  //   churned mud with darker clods, twin tyre ruts (gauge 1.7 m) with a raised middle, blast scorch (soot core, ash
  //   ring, broken by noise) and standing puddles that stay after the rain.
  const bat = attribute('battle', 'vec4');
  const rutD = abs(abs(bat.w).sub(U.rutGauge));
  // (a soft 0.5 m track: churned, not painted; fades out at the ends of the kart lines' baked band)
  const rut = float(1).sub(smoothstep(0.1, 0.44, rutD.add(nFine.mul(0.08)))).mul(step(abs(bat.w), float(4)));
  const mudK = max(smoothstep(0.22, 0.62, bat.y.add(nMid.mul(0.22)).add(nFine.mul(0.14))), rut.mul(0.72)).toVar('battleMud');
  const mudTone = mix(U.mud, U.dirt.mul(0.72), smoothstep(0.05, 0.45, nFine).mul(0.4));
  col = mix(col, mudTone, mudK.mul(0.9));
  const sc = bat.x.add(nMid.mul(0.2)).add(nFine.mul(0.12));
  col = mix(col, U.ash, smoothstep(0.1, 0.28, sc).mul(0.5));
  const sootK = smoothstep(0.34, 0.68, sc).mul(0.9);
  col = mix(col, U.soot, sootK);
  const pud = smoothstep(0.5, 0.58, bat.z.add(nFine.mul(0.1)).add(nMid.mul(0.08))).toVar('battlePuddle');
  // Pond bed: dark mud under the water line.
  const bed = smoothstep(bedLevel, bedLevel - 0.33, p.y);
  col = mix(col, U.dirt.mul(0.55), bed);
  // Neighbours' ground beyond the fence line: no mowing stripes, cooler and patchier, so the map reads as the stage.
  const outside = smoothstep(U.yardHalf, U.yardHalf.add(14), max(abs(p.x), abs(p.z)));
  const plots = mx_noise_float(p.xz.mul(0.012).add(vec2(7.3, 1.9)));
  const neighbour = mix(mix(U.grassDark, U.grass, 0.55), mix(U.grassDry, U.grassDark, 0.35), smoothstep(-0.25, 0.35, plots))
    .mul(vec3(0.88, 0.95, 1.02)).mul(float(0.94).add(nMid.mul(0.05)));
  col = mix(col, neighbour, outside.mul(0.85));

  // --- W13 the wet night ground [godot wet_ground.gdshader] ---
  // wetness: the weather's (or a sprinkler's), never under the night's floor
  const W = WORLD_WEATHER;
  const sprWet = (u: typeof W.spr0) => u.w.mul(float(1).sub(smoothstep(u.z.sub(1.5), u.z.add(0.5), length(p.xz.sub(vec2(u.x, u.y))))));
  const wetG = max(max(W.wet, STYLE_WEATHER.floor), max(sprWet(W.spr0), sprWet(W.spr1))).clamp(0, 1).toVar('groundWet');
  const flat = smoothstep(0.9, 0.97, normalWorldGeometry.y);            // 0 on berms and banks
  // trodden ground (dirt, mulch, gravel, mud, ruts, scorch, the pond bed) is asphalt; lawn and the neighbours stay lawn
  const trodden = max(max(max(dirtK, mulchK), sandK), max(mudK, max(sootK, bed))).mul(float(1).sub(outside)).toVar('groundTrodden');
  // the paved part: dirt and mulch (gravel, churned mud, scorch and pond beds are loose: no joints, no patches)
  const paved = max(dirtK, mulchK).mul(float(1).sub(max(sandK, max(mudK, max(sootK, bed))))).mul(flat).toVar('groundPaved');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL node types are too narrow for helpers
  const n01 = (q: any) => mx_noise_float(q).mul(0.5).add(0.5);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash12 = (q: any) => fract(sin(dot(q, vec2(127.1, 311.7))).mul(43758.5453));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aaLine = (d: any, w: number, fw: any) => float(1).sub(smoothstep(float(w).sub(fw), float(w).add(fw), d)).mul(clamp(float(w * 2).div(max(fw, float(1e-4))), 0, 1));
  // tones: wear (wheel lanes, sun-bleached patches) at ~0.6 m and ~3 m
  const wear = (detail ? n01(p.xz.div(G.grainScale).mul(15.4)) : n01(p.xz.mul(0.33))).toVar('groundWear');
  const wear2 = n01(p.xz.div(G.grainScale * 5.3).mul(15.4).add(vec2(0.37, 0.11)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL node types are too narrow for reassignment
  let tone: any = wear.mul(0.4).add(wear2.mul(0.6)).sub(0.25);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let seal: any = float(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stones: any = float(0.24);                                        // the aggregate's mean at range
  if (detail && paving) {
    // paving: lanes along z with a tar-sealed joint between them, a rare cross joint, and in one panel in four a patch
    // repair (a fresher, darker rectangle with a sealed edge)
    const [px, pz] = G.panel;
    const q0 = p.xz.div(vec2(px, pz));
    const q = vec2(q0.x, q0.y.add(hash12(vec2(floor(q0.x), 3.7))));
    const cell = floor(q), f = fract(q);
    const age = hash12(cell.add(0.5));
    const jfw = fwidth(p.xz).mul(1.5);
    const jd = float(0.5).sub(abs(f.sub(0.5))).mul(vec2(px, pz));         // metres to the panel's edges
    let joint = max(aaLine(jd.x, G.joint * 0.5, jfw.x), aaLine(jd.y, G.joint * 0.5, jfw.y).mul(step(0.8, hash12(cell.add(9.1)))));
    const rr = vec2(hash12(cell.add(1.3)), hash12(cell.add(2.9)));
    const rr2 = vec2(hash12(cell.add(4.1)), hash12(cell.add(6.7)));
    const plo = vec2(rr.x.mul(0.25).add(0.1), rr.y.mul(0.45).add(0.08));
    const phi = min(plo.add(vec2(rr2.x.mul(0.3).add(0.3), rr2.y.mul(0.3).add(0.12))), vec2(0.92, 0.92));
    const pd = min(f.sub(plo), phi.sub(f)).mul(vec2(px, pz));           // metres inside the patch (negative: outside)
    const pin = min(pd.x, pd.y);
    const psd = mix(length(max(pd.negate(), vec2(0, 0))), pin, step(0, pin));
    const hasPatch = step(0.75, age);
    const inPatch = hasPatch.mul(step(0, pin));
    joint = max(joint, hasPatch.mul(aaLine(psd, G.joint * 0.5, max(jfw.x, jfw.y))));
    // cracks: warped cellular edges (~5 m cells), only where the surface is old
    const cw = p.xz.div(G.crackScale).mul(5.12);
    const warp = vec2(mx_noise_float(cw.mul(0.8).add(vec2(4.7, 1.3))), mx_noise_float(cw.mul(0.8).add(vec2(-2.1, 8.9)))).mul(0.35);
    const wf = mx_worley_noise_vec2(cw.add(warp));
    const ce = wf.y.sub(wf.x);
    const crack = aaLine(ce, 0.012, fwidth(ce)).mul(smoothstep(0.42, 0.6, wear2.add(age.sub(0.5).mul(0.4)))).mul(float(1).sub(inPatch));
    seal = max(joint, crack).mul(paved).toVar('groundSeal');
    tone = tone.sub(inPatch.mul(0.3)).add(step(age, 0.1).mul(0.15)).mul(paved).add(tone.mul(float(1).sub(paved)));
    // aggregate: ~1 cm stones up close, their mean beyond a few metres (no shimmer)
    const aggLod = float(1).sub(smoothstep(0.004, 0.02, length(fwidth(p.xz))));
    const agg = n01(p.xz.div(G.aggScale).mul(40));
    const agg2 = n01(p.xz.div(G.aggScale * 0.37).mul(40).add(vec2(0.5, 0.25)));
    stones = mix(float(0.24), smoothstep(0.55, 0.85, agg).mul(0.55).add(smoothstep(0.6, 0.9, agg2).mul(0.3)), aggLod);
  }
  tone = tone.clamp(0, 1);
  const binder = mix(lin(G.asphaltDark), lin(G.asphaltLight), tone);
  // berms and banks: coarse dark wet grit (~4 cm, on their own face: 3D noise, no xz stretch), its mean at range
  const grit = detail
    ? mix(float(0.23), smoothstep(0.4, 0.95, n01(p.mul(25))).mul(0.7), float(1).sub(smoothstep(0.01, 0.05, length(fwidth(p)))))
    : float(0.23);
  const stonesK = mix(grit, stones.mul(mix(float(0.6), float(1), tone)), flat).clamp(0, 1).toVar('groundStones');
  let asphalt = mix(binder, lin(G.aggregate), stonesK);
  asphalt = asphalt.mul(mix(float(G.slopeDark), float(1), flat));       // the slopes face the floods: darker
  // the palette colour only shades it (its luminance against the dirt's): gravel lighter, mulch and mud darker
  const shade = clamp(luminance(col).div(luminance(U.dirt)), 0.5, 1.6);
  asphalt = asphalt.mul(mix(float(1), shade, G.shade));
  asphalt = mix(asphalt, lin(G.tar), seal);
  if (paving) col = mix(col, asphalt, trodden);
  // water: puddles on the flat (the grain breaks the rims), a damp rim, the wet film everywhere; more of it in rain
  const pm = n01(p.xz.div(G.puddleScale).mul(3.07).add(vec2(3.1, -7.7))).add(wear.sub(0.5).mul(0.08)).add(stonesK.sub(0.24).mul(0.05));
  const cut = U.puddleCut.sub(W.rain.mul(0.04));
  const wetPud = smoothstep(0.4, 0.75, wetG);
  const godotPuddle = smoothstep(cut, cut.add(0.035), pm).mul(flat).mul(wetPud);
  const damp = smoothstep(cut.sub(0.1), cut, pm).mul(flat).mul(wetPud).mul(trodden);
  // puddles: on trodden ground, the E4 standing puddles anywhere, never past the fence line
  const puddle = (detail ? max(godotPuddle.mul(trodden), pud.mul(flat)) : pud.mul(flat)).mul(float(1).sub(outside)).clamp(0, 1).toVar('groundPuddle');
  // the wet darkening [godot 0.7 everywhere]; the damp rim a bit more
  col = col.mul(mix(float(1), float(G.darken), wetG)).mul(mix(float(1), float(G.dampAlbedo), damp));
  // roughness [godot]: the wet film 0.3–0.45 (stones rougher), dry 0.75–0.9, slopes 0.62+, tar 0.18, the damp rim
  // smoother; lawn: a wet sheen; churned mud: damp
  let asphaltRough = mix(mix(float(0.75), float(0.9), stonesK), mix(float(G.wetRough[0]), float(G.wetRough[1]), stonesK.mul(1.4).clamp(0, 1)), wetG);
  asphaltRough = mix(stonesK.mul(0.15).add(G.slopeRough), asphaltRough, flat);
  asphaltRough = mix(asphaltRough, float(0.18), seal.mul(wetG));
  asphaltRough = asphaltRough.mul(mix(float(1), float(G.dampRough), damp));
  const lawnRough = mix(float(0.86), float(0.86 * STYLE.wet.roughPorous), wetG);
  // the yard's trodden ground is wet dirt: a sheen, smoother at the puddles' damp rims
  const dirtRough = mix(float(0.88), float(0.55), wetG).mul(mix(float(1), float(G.dampRough), damp));
  let rough = mix(lawnRough, paving ? asphaltRough : dirtRough, trodden);
  rough = mix(rough, float(0.5), mudK.mul(0.6));
  // shading normal: a detail normal off the puddles and the tar [godot detail_nrm], rain ripples in the puddles
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL node types are too narrow for reassignment
  let n: any = normalWorldGeometry;
  if (flatten > 0) n = normalize(mix(n, vec3(0, 1, 0), flatten));
  if (detail) {
    const nLod = float(1).sub(smoothstep(0.01, 0.05, length(fwidth(p.xz))));
    const dn = mx_noise_vec3(vec3(p.x.mul(14.0), 0.5, p.z.mul(14.0))).xz.mul(0.3 * G.detailStrength).mul(nLod);
    // one expanding ring per cell, random centre and phase: a radial normal kick
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL node types are too narrow for helpers
    const ripple = (q: any, t: any) => {
      const cell = floor(q);
      const h = hash12(cell);
      const v = fract(q).sub(0.5).sub(vec2(fract(h.mul(17.3)), fract(h.mul(31.7))).sub(0.5).mul(0.5));
      const d = length(v);
      const ph = fract(t.add(h));
      const w = sin(d.sub(ph.mul(0.45)).mul(70)).mul(smoothstep(0.05, 0.0, abs(d.sub(ph.mul(0.45))))).mul(float(1).sub(ph));
      return v.div(max(d, float(1e-3))).mul(w);
    };
    const r = ripple(p.xz.mul(1.7), time.mul(1.1)).add(ripple(p.xz.mul(2.3).add(5.1), time.mul(0.9).add(0.5)));
    const kick = dn.mul(float(1).sub(puddle)).mul(float(1).sub(seal.mul(0.7))).add(r.mul(W.rain.mul(0.12).mul(puddle)));
    n = normalize(n.add(vec3(kick.x, 0, kick.y)));
  }

  // the factory material: no wetness of its own (wetK 0: this graph wets itself), the puddles through puddleNode
  const material = toonFrom({ surface: 'ground', ink, wetK: 0, puddle: 0 });
  material.colorNode = col;
  material.roughnessNode = rough;
  material.puddleNode = puddle;
  // puddles are flat water
  material.normalNode = mix(transformNormalToView(n), normalView, puddle).normalize();
  return { material, uniforms: U as unknown as Record<string, ReturnType<typeof uniform>> };
}

/** Foliage: vertex + instance colors, no ink, wind sway by uv.y^2 (bases stay planted). */
export function createFoliageMaterial(strength: number, windDir: THREE.Vector2, opts: { side?: THREE.Side } = {}): WorldMaterial {
  const m = toonNoInk({ vertexColors: true, side: opts.side ?? THREE.DoubleSide, surface: 'foliage' });
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
 * Water: needs a `depth` vertex attribute (meters of water under the vertex) and `center` uniform for ripple rings.
 * Near-mirror (SURFACES.water): it reflects the night sky and the floods.
 */
export function createWaterMaterial(center: THREE.Vector2): WorldMaterial {
  const m = toonNoInk({ transparent: true, opacity: 0.86, surface: 'water' });
  const depth = attribute('depth', 'float');
  const shallow = c('water'), deep = uniform(new THREE.Color(0x236f9a)), foam = uniform(new THREE.Color(0xeaf8ff));
  const ctr = uniform(center);
  const p = positionWorld;
  const d = length(p.xz.sub(ctr));
  const n = mx_noise_float(p.xz.mul(0.25).add(time.mul(0.05)));
  let col = mix(shallow, deep, smoothstep(0.1, 1.1, depth));
  // drifting ripple rings (thin lighter bands)
  const ring = fract(d.mul(0.22).sub(time.mul(0.12)).add(n.mul(0.35)));
  col = mix(col, shallow.mul(1.25), step(0.93, ring).mul(smoothstep(0.05, 0.4, depth)));
  // shore foam: crisp band where the water is shallow
  const f = step(depth.add(n.mul(0.06)), float(0.1));
  col = mix(col, foam, f);
  m.colorNode = col;
  m.opacityNode = max(float(0.62), min(float(0.95), float(0.62).add(depth.mul(0.3)).add(f)));
  m.depthWrite = false;
  return m;
}

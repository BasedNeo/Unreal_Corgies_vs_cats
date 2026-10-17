// W15 item 11 (TW-LOOK), the cover read on the web twin [godot look.gd COVER / kit_wet.gdshader, tests/test_look_cover.gd].
// 1. The cover set comes from the shared colliders, by Godot's rule: per placement, the piece's colliders at least
//    SHIELD_W across are stacked up from the ground (each starting at most GROUND_EPS over the one below); a stack that
//    reaches BODY_H shields a standing pet. KitPiece.cover must agree (cover or not, and where the zone ends).
// 2. The shared terms, read from Godot's own files (engines/godot/look/look.gd COVER / COVER_VALUES / COVER_MEAN /
//    COVER_SHEEN_COLOR, kit_wet.gdshader's cover block; docs/handoff/G-ATMOS.md "The rule the web twin mirrors"), so a
//    change there shows here: the cover table and the FloodMast's zone, the band (floor, ceil), the guard (lo, cap), the
//    power, the up-facing edges, the cone, the luminance weights, the near-zero guards, the moon, COVER_MEAN (also
//    recomputed from the master GLBs) and the floods (WorldData.floodlights = Godot's the_lot.json); the gains (fill,
//    sheen, sat, pool) are per build: the web's own, one set for every piece except KIT_COVER_SCALE (Container20 x2.1,
//    FloodMast x0.85, fill only; asserted below). No dim on either side.
// 3. The rule in the built node graph (not the tokens): the emission is masked to the zone (the step on the foot-relative
//    height against the zone's top); the fill is the wet albedo × the piece's own gain (clamp(mean, floor, ceil) / mean,
//    no per-texel band), each texel's luminance kept in [lo, cap], × sat, × fill × (1 − pool_k × the strongest flood
//    cone, on the world position); the sheen is the moon × sheen × the graze (a back face turned to the viewer) × the
//    up-facing mask, with no pool; the colour is the plain wet albedo; the peak emission stays under the bloom
//    threshold; the A/B switch is a uniform.
import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { normalWorldGeometry, positionWorld } from 'three/tsl';
import sharp from 'sharp';
import { getBounds } from '@gltf-transform/core';
import { createWorldData } from '../../src/shared/world/world-data';
import {
  LOT_KIT, KIT_FLOODMAST, KIT_FLOODLAMP, KIT_FLOODMAST_COVER, KIT_COVER_MEAN, KIT_COVER_SCALE, kitCoverFloods, kitPbrOpts, kitPlacementMatrix,
  splitLotKitPrims,
} from '../../src/client/assets/kit-glb';
import { COVER_ALL, PBR_COVER_BASE, STYLE_COVER, coverPeakLuminance, pbr, setCoverRead } from '../../src/client/style/style-webgpu.js';
import { STYLE } from '../../src/client/style/style-tokens.js';
import { createIO } from '../../tools/assets/validate-glb.mjs';

const BODY_H = 0.6, GROUND_EPS = 0.35, SHIELD_W = 1.0;

// ---- Godot's terms, parsed from its files (look.gd may change: these must follow) ----
const LOOK_GD = readFileSync('engines/godot/look/look.gd', 'utf8');
const KIT_WET = readFileSync('engines/godot/look/kit_wet.gdshader', 'utf8');
const nums = (t: string) => t.split(',').map((x) => Number(x.trim()));
/** look.gd COVER: piece -> the zone's top (m over the foot); COVER_ALL maps to the web's COVER_ALL. */
const GODOT_COVER: Record<string, number> = (() => {
  const body = /const COVER := \{([\s\S]*?)\}/.exec(LOOK_GD)![1];
  const out: Record<string, number> = {};
  for (const m of body.matchAll(/"(Kit_Lot_\w+)":\s*(COVER_ALL|[0-9.]+)/g)) out[m[1]] = m[2] === 'COVER_ALL' ? COVER_ALL : Number(m[2]);
  return out;
})();
/** look.gd COVER_VALUES: renderer -> { fill, floor, ceil, lo, cap, sheen, power, sat, pool }. */
const GODOT_VALUES: Record<string, Record<string, number>> = (() => {
  const block = /const COVER_VALUES := \{([\s\S]*?)\n\}/.exec(LOOK_GD)![1];
  const out: Record<string, Record<string, number>> = {};
  for (const m of block.matchAll(/"(\w+)":\s*\{([^}]*)\}/g)) {
    out[m[1]] = {};
    for (const kv of m[2].matchAll(/"(\w+)":\s*([0-9.]+)/g)) out[m[1]][kv[1]] = Number(kv[2]);
  }
  return out;
})();
const GODOT_MOON = nums(/const COVER_SHEEN_COLOR := Color\(([^)]+)\)/.exec(LOOK_GD)![1]);
/** look.gd COVER_MEAN: piece -> its mean base-colour luminance. */
const GODOT_MEAN: Record<string, number> = (() => {
  const body = /const COVER_MEAN := \{([\s\S]*?)\}/.exec(LOOK_GD)?.[1] ?? '';
  return Object.fromEntries([...body.matchAll(/"(Kit_Lot_\w+)":\s*([0-9.]+)/g)].map((m) => [m[1], Number(m[2])]));
})();
/** kit_wet.gdshader's cover block: from the zone's step to the emission it adds. */
const KIT_COVER = /float cover = step\(ly, cover_top\)[\s\S]*?EMISSION \+=[^;]*;/.exec(KIT_WET)?.[0] ?? '';
/** every luminance weight vector in the cover block (dot(held, vec3(...))) */
const GODOT_LUMAS = [...KIT_COVER.matchAll(/dot\(held, vec3\(([^)]+)\)\)/g)].map((m) => nums(m[1]));
const GODOT_LUMA = GODOT_LUMAS[0] ?? [];
/** held = the wet albedo × the piece's gain clamp(cover_mean, floor, ceil) / max(cover_mean, eps) */
const GODOT_GAIN = /vec3 held = wet_alb \* \(clamp\(cover_mean, cover_floor, cover_ceil\) \/ max\(cover_mean, ([0-9.e-]+)\)\);/.exec(KIT_COVER);
/** the per-texel guard: luminance kept in [lo, cap], black -> grey lo */
const GODOT_GUARD = /held = mix\(vec3\(cover_lo\), held \* \(clamp\(hl, cover_lo, cover_cap\) \/ max\(hl, ([0-9.e-]+)\)\), step\(([0-9.e-]+), hl\)\);/.exec(KIT_COVER);
/** the saturation, then no negative channel */
const GODOT_SAT = /held = max\(mix\(vec3\(dot\(held, vec3\([^)]+\)\)\), held, cover_sat\), vec3\(0\.0\)\);/.test(KIT_COVER);
/** the pool: max over the floods of smoothstep(cone, dot(normalize(wpos - lamp), aim)) */
const GODOT_CONE_M = /pool = max\(pool, smoothstep\(([0-9.]+), ([0-9.]+), dot\(normalize\(wpos - cover_flood_pos\[i\]\), cover_flood_aim\[i\]\)\)\)/.exec(KIT_COVER);
const GODOT_CONE = GODOT_CONE_M ? [Number(GODOT_CONE_M[1]), Number(GODOT_CONE_M[2])] : [];
const GODOT_FLOODS_MAX = Number(/uniform vec3 cover_flood_pos\[(\d+)\]/.exec(KIT_WET)?.[1] ?? NaN);
/** what the cover block adds: the fill faded by the pool, plus the sheen (no pool) */
const GODOT_EMIT = /EMISSION \+= held \* cover_fill \* \(1\.0 - cover_pool \* pool\) \+ cover_sheen_color \* cover_sheen \* graze;/.test(KIT_COVER);
/** kit_wet.gdshader: the graze × (1 - smoothstep(lo, hi, wnrm.y)), wnrm the world normal: no sheen on a flat top. */
const GODOT_UP_M = /graze = [^;]*\*\s*\(1\.0 - smoothstep\(([0-9.]+, [0-9.]+), wnrm\.y\)\)/.exec(KIT_WET);
const GODOT_UP = GODOT_UP_M ? nums(GODOT_UP_M[1]) : [];
/** look.gd _cover_params (what it sets on a kit material), up to the next declaration. */
const GODOT_PARAMS = /func _cover_params\([\s\S]*?(?=\n(?:func|static func|##|const|var) )/.exec(LOOK_GD)![0];

/** The web's per-build gains [fill, sheen, sat, pool], measured with labs/cover-metric.mjs against the lead's bar
 *  (docs/qa/w15/COVER.md, Web): a change must be re-measured. */
const WEB_GAINS = [0.16, 0.1, 1.0, 1.0];
/** The web's per-piece fill scales (lead ruling: Container20 and FloodMast only, each in [0.5, 2.5]), measured likewise. */
const WEB_SCALES = { Kit_Lot_Container20_01: { fill: 2.1 }, Kit_Lot_FloodMast_01: { fill: 0.85 } };

// ---- a TSL node graph, walked ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL nodes are untyped here
type N = any;
const kind = (n: N): string => n?.constructor?.type ?? '';
const unwrap = (n: N): N => { while (n && (kind(n) === 'VarNode' || kind(n) === 'ConvertNode')) n = n.node; return n; };
const constOf = (n: N): unknown => { const u = unwrap(n); return kind(u) === 'ConstNode' ? u.value : undefined; };
function all(root: N): N[] {
  const seen = new Set<N>(), out: N[] = [];
  const walk = (n: N) => { if (!n || seen.has(n)) return; seen.add(n); out.push(n); for (const c of n.getChildren()) walk(c); };
  walk(root);
  return out;
}
const vecEq = (v: unknown, w: number[]) => { const o = v as { x?: number; r?: number; y?: number; g?: number; z?: number; b?: number } | undefined; if (!o) return false; const a = [o.x ?? o.r, o.y ?? o.g, o.z ?? o.b]; return a.every((x, i) => typeof x === 'number' && Math.abs(x - w[i]) < 1e-6); };
const has = (ns: N[], f: (n: N) => boolean) => ns.some(f);
const reads = (ns: N[], u: unknown) => ns.includes(u);
/** collider type -> kit piece [godot test_look_cover.gd OWNER] */
const OWNER: Record<string, string> = {
  bags: 'Kit_Lot_BagWall_01', footing: 'Kit_Lot_Footing_01',
  pipe: 'Kit_Lot_Pipe_01', pipe_invert: 'Kit_Lot_Pipe_01', pipe_wedge: 'Kit_Lot_Pipe_01',
  container_floor: 'Kit_Lot_Container20_01', container_roof: 'Kit_Lot_Container20_01', container_wall: 'Kit_Lot_Container20_01',
  container_door: 'Kit_Lot_Container20_01', container_post: 'Kit_Lot_Container20_01', container_header: 'Kit_Lot_Container20_01',
  flood_base: 'Kit_Lot_FloodMast_01', flood_mast: 'Kit_Lot_FloodMast_01', flood_bar: 'Kit_Lot_FloodLamp_01', flood_head: 'Kit_Lot_FloodLamp_01',
};

type Aabb = { min: THREE.Vector3; max: THREE.Vector3 };

/** {piece: {stops, coverTop (m over the ground; 0 = not cover), top}} from the shared colliders and the placed meshes. */
async function coverTable() {
  const data = createWorldData(1, 'the_lot');
  const rows = new Map<string, Aabb[]>();
  const add = (piece: string, a: Aabb) => { if (!rows.has(piece)) rows.set(piece, []); rows.get(piece)!.push(a); };
  for (const b of data.props) {
    const piece = OWNER[b.type];
    if (!piece) continue;
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(b.pitch ?? 0, b.rotY ?? 0, b.roll ?? 0, 'YXZ')).elements;
    const h = [b.hx, b.hy, b.hz];
    const ext = [0, 1, 2].map((i) => Math.abs(m[i]) * h[0] + Math.abs(m[4 + i]) * h[1] + Math.abs(m[8 + i]) * h[2]);
    add(piece, { min: new THREE.Vector3(b.x - ext[0], b.y - ext[1], b.z - ext[2]), max: new THREE.Vector3(b.x + ext[0], b.y + ext[1], b.z + ext[2]) });
  }
  for (const c of data.cylinders ?? []) {
    const piece = OWNER[c.type];
    if (piece) add(piece, { min: new THREE.Vector3(c.x - c.r, c.y - c.hh, c.z - c.r), max: new THREE.Vector3(c.x + c.r, c.y + c.hh, c.z + c.r) });
  }
  const io = await createIO();
  const split = splitLotKitPrims(data);
  const out = new Map<string, { stops: boolean; coverTop: number; top: number; placements: number }>();
  for (const p of split.pieces) {
    const name = p.piece.name;
    const e = { stops: rows.has(name), coverTop: 0, top: 0, placements: p.placements.length };
    out.set(name, e);
    if (!rows.has(name) || !p.placements.length) continue;
    const doc = await io.read(`assets/masters/${name}.glb`);
    const node = doc.getRoot().listNodes().find((n) => n.getName() === `${name}_LOD0`)!;
    const bb = getBounds(node);
    let lowest = Infinity;
    for (const pl of p.placements) {
      const foot = new THREE.Box3().setFromPoints([0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(
        i & 1 ? bb.max[0] : bb.min[0], i & 2 ? bb.max[1] : bb.min[1], i & 4 ? bb.max[2] : bb.min[2]).applyMatrix4(kitPlacementMatrix(pl))));
      const g = data.height(pl.x, pl.z);
      const mine = rows.get(name)!.filter((r) => r.min.x <= foot.max.x && r.max.x >= foot.min.x && r.min.z <= foot.max.z && r.max.z >= foot.min.z);
      for (const r of mine) e.top = Math.max(e.top, r.max.y - g);
      mine.sort((u, v) => u.min.y - v.min.y);
      let stack = 0;
      for (const r of mine) {
        if (Math.max(r.max.x - r.min.x, r.max.z - r.min.z) >= SHIELD_W && r.min.y - g <= stack + GROUND_EPS) stack = Math.max(stack, r.max.y - g);
      }
      lowest = Math.min(lowest, stack);
    }
    e.coverTop = lowest >= BODY_H && lowest < Infinity ? lowest : 0;
  }
  return out;
}

/** Every node reachable from a TSL node (names of attributes, and the node types). */
function graph(node: unknown): { types: string[]; attrs: string[] } {
  const types: string[] = [], attrs: string[] = [];
  (node as { traverse(cb: (n: { constructor: { type?: string }; _attributeName?: string }) => void): void })
    .traverse((n) => { types.push(n.constructor.type ?? ''); if (typeof n._attributeName === 'string') attrs.push(n._attributeName); });
  return { types, attrs };
}

afterEach(() => setCoverRead(true));

describe('the cover read (W15 item 11): which kit pieces are cover', () => {
  it('KitPiece.cover agrees with the shared colliders, piece for piece [godot test_look_cover.gd cover_table]', async () => {
    const table = await coverTable();
    expect([...table.keys()].sort()).toEqual(LOT_KIT.map((e) => e.piece.name).sort());
    const want: Record<string, string> = {};
    for (const { piece } of LOT_KIT) {
      const t = table.get(piece.name)!;
      console.log(`cover table: ${piece.name.padEnd(24)} stops ${t.stops}  cover up to ${t.coverTop.toFixed(2)} m (top ${t.top.toFixed(2)} m)  KitPiece.cover ${piece.cover}`);
      want[piece.name] = `${piece.cover >= COVER_ALL ? 'all' : piece.cover > 0 ? 'part' : 'none'}`;
      expect(t.placements, `${piece.name} has placements`).toBeGreaterThan(0);
      expect(t.stops, `${piece.name} stops bullets (has colliders)`).toBe(true);
      expect(t.coverTop > 0, `${piece.name}: colliders say cover up to ${t.coverTop.toFixed(2)} m, KitPiece.cover says ${piece.cover}`).toBe(piece.cover > 0);
      if (piece.cover > 0 && piece.cover < COVER_ALL) expect(Math.abs(piece.cover - t.coverTop), `${piece.name}: zone end vs collider stack`).toBeLessThanOrEqual(0.35);
      if (piece.cover >= COVER_ALL) expect(t.top - t.coverTop, `${piece.name}: the whole piece is cover only if its colliders shield all of it`).toBeLessThanOrEqual(0.5);
    }
    // the card's set: BagWall, Footing, Pipe, Container20 and the FloodMast's ballast; never the mast pole or the lamps
    expect(want).toEqual({
      Kit_Lot_Container20_01: 'all', Kit_Lot_BagWall_01: 'all', Kit_Lot_Pipe_01: 'all', Kit_Lot_Footing_01: 'all',
      Kit_Lot_FloodMast_01: 'part', Kit_Lot_FloodLamp_01: 'none',
    });
    // and Godot's own table, piece for piece (look.gd COVER; COVER_ALL = the whole piece)
    for (const { piece } of LOT_KIT) expect(piece.cover, `${piece.name} vs look.gd COVER`).toBe(GODOT_COVER[piece.name]);
    expect(KIT_FLOODMAST_COVER).toBe(GODOT_COVER[KIT_FLOODMAST]);
  });
});

/** Mean Rec.709 luminance of a GLB's baseColor image, sRGB-decoded, full resolution, × the factor's luminance [godot
 *  look.gd COVER_MEAN; test_look_cover.gd _check_means]. */
async function baseColorMean(file: string): Promise<number> {
  const io = await createIO();
  const doc = await io.read(file);
  const mat = doc.getRoot().listMaterials()[0];
  const img = mat.getBaseColorTexture()?.getImage();
  if (!img) throw new Error(`${file}: no baseColor image`);
  const { data, info } = await sharp(Buffer.from(img)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const lin = Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += 0.2126 * lin[data[i]] + 0.7152 * lin[data[i + 1]] + 0.0722 * lin[data[i + 2]];
  const f = mat.getBaseColorFactor();
  return (sum / (info.width * info.height)) * (0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]);
}

describe('the cover read (W15 item 11): the material terms', () => {
  it('copies Godot\'s shared terms (parsed from look.gd and kit_wet.gdshader); the gains are the web\'s, one set', () => {
    // the band, the guard and the power: the same on every Godot renderer, and the web's
    expect(Object.keys(GODOT_VALUES).length).toBeGreaterThanOrEqual(2);
    for (const [renderer, v] of Object.entries(GODOT_VALUES)) {
      for (const k of ['floor', 'ceil', 'lo', 'cap', 'power'] as const) expect(STYLE.cover[k], `${k} vs look.gd ${renderer}`).toBe(v[k]);
    }
    expect(STYLE.cover.sheenColor).toEqual(GODOT_MOON);
    expect(GODOT_UP, 'kit_wet.gdshader: the graze x (1 - smoothstep(lo, hi, wnrm.y))').toHaveLength(2);
    expect(STYLE.cover.upFace, 'the up-facing mask\'s edges vs kit_wet.gdshader').toEqual(GODOT_UP);
    expect(GODOT_CONE, 'kit_wet.gdshader: pool = max(pool, smoothstep(lo, hi, dot(normalize(wpos - lamp), aim)))').toHaveLength(2);
    expect(STYLE.cover.cone, 'the cone vs kit_wet.gdshader').toEqual(GODOT_CONE);
    // the rest of the block, as Godot writes it
    expect(GODOT_LUMAS.length, 'kit_wet.gdshader: dot(held, vec3(weights)) twice').toBe(2);
    for (const w of GODOT_LUMAS) expect(w, 'the luminance weights').toEqual([0.2126, 0.7152, 0.0722]);
    expect(GODOT_GAIN?.[1], 'kit_wet.gdshader: held = wet_alb x clamp(cover_mean, floor, ceil) / max(cover_mean, 1e-4)').toBe('1e-4');
    expect(GODOT_GUARD?.slice(1), 'kit_wet.gdshader: the guard, max(hl, 1e-4) and step(1e-4, hl)').toEqual(['1e-4', '1e-4']);
    expect(GODOT_SAT, 'kit_wet.gdshader: held = max(mix(vec3(lum(held)), held, cover_sat), 0)').toBe(true);
    expect(GODOT_EMIT, 'kit_wet.gdshader: EMISSION += held x fill x (1 - pool_k x pool) + moon x sheen x graze').toBe(true);
    expect(GODOT_FLOODS_MAX, 'kit_wet.gdshader: at most 8 floods').toBe(8);
    // the gains are per build: the web's own (Godot's are per renderer), measured with labs/cover-metric.mjs (COVER.md Web)
    expect([STYLE.cover.fill, STYLE.cover.sheen, STYLE.cover.sat, STYLE.cover.pool]).toEqual(WEB_GAINS);
    // one set for every piece, but for the web's per-piece fill scale: Container20 and FloodMast only, each in [0.5, 2.5]
    expect(KIT_COVER_SCALE).toEqual(WEB_SCALES);
    for (const [name, k] of Object.entries(KIT_COVER_SCALE)) {
      expect(k.fill, `${name}: scale in [0.5, 2.5]`).toBeGreaterThanOrEqual(0.5);
      expect(k.fill, `${name}: scale in [0.5, 2.5]`).toBeLessThanOrEqual(2.5);
    }
    for (const { piece } of LOT_KIT) {
      const scaled = piece.name in WEB_SCALES;
      expect(piece.coverScale, `${piece.name}: KitPiece.coverScale`).toEqual(scaled ? KIT_COVER_SCALE[piece.name] : undefined);
      const keys = Object.keys(kitPbrOpts(piece)).filter((k) => /^cover/.test(k)).sort();
      expect(keys, `${piece.name}: the cover read's pbr() options`).toEqual(['coverBase', 'coverFloods', 'coverMean', ...(scaled ? ['coverScale'] : []), 'coverTop']);
    }
  });

  it('COVER_MEAN is Godot\'s, and recomputed from each master GLB\'s baseColor image', async () => {
    expect(Object.keys(GODOT_MEAN).sort()).toEqual(LOT_KIT.map((e) => e.piece.name).sort());
    for (const { piece } of LOT_KIT) {
      expect(piece.coverMean, `${piece.name} vs look.gd COVER_MEAN`).toBe(GODOT_MEAN[piece.name]);
      expect(KIT_COVER_MEAN[piece.name]).toBe(piece.coverMean);
      const mean = await baseColorMean(`assets/masters/${piece.name}.glb`);
      console.log(`cover mean: ${piece.name.padEnd(24)} recomputed ${mean.toFixed(5)}  table ${piece.coverMean}`);
      expect(Math.abs(mean - piece.coverMean), `${piece.name}: recomputed ${mean.toFixed(5)}`).toBeLessThanOrEqual(0.0005);
    }
  });

  it('the floods are the shared Lot\'s (WorldData.floodlights = Godot\'s the_lot.json): lamp and unit aim, at most 8', () => {
    const data = createWorldData(1, 'the_lot');
    const floods = kitCoverFloods(data);
    const godot = (JSON.parse(readFileSync('engines/godot/data/the_lot.json', 'utf8')) as { floodlights: { pos: number[]; target: number[] }[] }).floodlights;
    expect(floods.length).toBe(4);
    expect(godot.length).toBe(floods.length);
    floods.forEach((f, i) => {
      const t = godot[i].target, p = godot[i].pos;
      for (let k = 0; k < 3; k++) expect(Math.abs(f[k] - p[k]), `flood ${i} lamp vs the_lot.json`).toBeLessThan(1e-3);
      const aim = new THREE.Vector3(t[0] - p[0], t[1] - p[1], t[2] - p[2]).normalize();
      expect(Math.hypot(f[3], f[4], f[5])).toBeCloseTo(1, 6);
      expect(f[3] * aim.x + f[4] * aim.y + f[5] * aim.z, `flood ${i} aim vs the_lot.json`).toBeGreaterThan(1 - 1e-6);
    });
    expect(splitLotKitPrims(data).floods).toEqual(floods);
    expect(kitCoverFloods({ ...data, floodlights: [{ pos: [1, 5, 2], target: [1, 5, 2] }] })[0].slice(3)).toEqual([0, -1, 0]);
  });

  it('no dim, on either side: Godot leaves the albedo as it was (look.gd, kit_wet.gdshader), and so does the twin', () => {
    // Godot dropped its non-cover dim (albedo x 0.6: no measurable effect); on the web it moved the mast pole ~0.4 L*
    // against a gap of >= 24.7. A dim brought back on either side fails here.
    for (const [renderer, v] of Object.entries(GODOT_VALUES)) expect(Object.keys(v).filter((k) => /dim/i.test(k)), `look.gd COVER_VALUES ${renderer}`).toEqual([]);
    expect(GODOT_PARAMS, 'look.gd _cover_params sets no dim').not.toMatch(/dim/i);
    expect(KIT_WET, 'kit_wet.gdshader has no dim uniform').not.toMatch(/uniform\s+\w+\s+\w*dim\w*/i);
    expect(KIT_WET, 'kit_wet.gdshader: the albedo is the wet albedo').toMatch(/\n\s*ALBEDO = wet_alb;/);
    expect(Object.keys(STYLE.cover).filter((k) => /dim/i.test(k)), 'STYLE.cover').toEqual([]);
    expect(Object.keys(STYLE_COVER).filter((k) => /dim/i.test(k)), 'STYLE_COVER').toEqual([]);
    // the built colour: every kit piece's colour graph is the one it would have without the cover read, and reads none of
    // its knobs or its zone
    const src = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const knobs = Object.values(STYLE_COVER) as unknown[];
    for (const { piece } of LOT_KIT) {
      const m = pbr(src, kitPbrOpts(piece)) as THREE.MeshStandardNodeMaterial;
      const plain = pbr(src, { ...(piece.pbrOpts ?? {}) }) as THREE.MeshStandardNodeMaterial;
      expect(plain).not.toBe(m);
      const col = all(m.colorNode);
      expect(col.map(kind), `${piece.name}: the colour graph, with the cover read vs without`).toEqual(all(plain.colorNode).map(kind));
      expect(col.filter((n) => knobs.includes(n)).length, `${piece.name}: the colour reads no cover knob`).toBe(0);
      expect(has(col, (n) => kind(n) === 'AttributeNode' && n._attributeName === PBR_COVER_BASE), `${piece.name}: the colour reads no zone`).toBe(false);
    }
  });

  it('the rule is in each cover piece\'s built graph: zone, per-piece gain, guard, sat, pool on the fill, masked sheen', () => {
    const data = createWorldData(1, 'the_lot');
    const floods = kitCoverFloods(data);
    const luma = (n: N) => kind(n) === 'MathNode' && n.method === 'dot' && (vecEq(constOf(n.aNode), GODOT_LUMA) || vecEq(constOf(n.bNode), GODOT_LUMA));
    const op = (n: N, o: string) => kind(n) === 'OperatorNode' && n.op === o;
    const operands = (n: N) => [unwrap(n.aNode), unwrap(n.bNode)];
    const moon = new THREE.Color().setRGB(GODOT_MOON[0], GODOT_MOON[1], GODOT_MOON[2], THREE.SRGBColorSpace);
    for (const { piece } of LOT_KIT.filter((e) => e.piece.cover > 0)) {
      const tag = piece.name;
      const m = pbr(new THREE.MeshStandardMaterial({ color: 0x808080 }), kitPbrOpts(piece, floods)) as THREE.MeshStandardNodeMaterial;
      const em = all(m.emissiveNode);
      expect(reads(em, STYLE_COVER.on), `${tag}: the emission reads STYLE_COVER.on`).toBe(true);
      // the per-piece gain: clamp(mean, floor, ceil) / max(mean, 1e-4), the piece's COVER_MEAN; no per-texel band
      const gain = em.find((n) => kind(n) === 'MathNode' && n.method === 'clamp' && constOf(n.aNode) === piece.coverMean
        && constOf(n.bNode) === STYLE.cover.floor && constOf(n.cNode) === STYLE.cover.ceil);
      expect(gain, `${tag}: the gain clamp(COVER_MEAN ${piece.coverMean}, floor, ceil)`).toBeTruthy();
      expect(has(em, (n) => op(n, '/') && unwrap(n.aNode) === gain && kind(unwrap(n.bNode)) === 'MathNode' && unwrap(n.bNode).method === 'max'
        && constOf(unwrap(n.bNode).aNode) === piece.coverMean && constOf(unwrap(n.bNode).bNode) === 1e-4), `${tag}: / max(mean, 1e-4)`).toBe(true);
      expect(em.filter((n) => kind(n) === 'MathNode' && n.method === 'clamp' && constOf(n.bNode) === STYLE.cover.floor && constOf(n.aNode) === undefined).length,
        `${tag}: no per-texel band (a clamp of a varying luminance in [floor, ceil])`).toBe(0);
      // the guard: each texel's held luminance in [lo, cap] (Godot's weights), black -> grey lo
      const hl = em.find((n) => kind(n) === 'MathNode' && n.method === 'clamp' && constOf(n.bNode) === STYLE.cover.lo && constOf(n.cNode) === STYLE.cover.cap && luma(unwrap(n.aNode)));
      expect(hl, `${tag}: the guard clamp(lum(held), lo, cap)`).toBeTruthy();
      expect(has(em, (n) => kind(n) === 'MathNode' && n.method === 'mix' && vecEq(constOf(n.aNode), [STYLE.cover.lo, STYLE.cover.lo, STYLE.cover.lo])
        && kind(unwrap(n.cNode)) === 'MathNode' && unwrap(n.cNode).method === 'step' && constOf(unwrap(n.cNode).aNode) === 1e-4 && luma(unwrap(unwrap(n.cNode).bNode))),
      `${tag}: mix(vec3(lo), ..., step(1e-4, lum))`).toBe(true);
      // the saturation (STYLE_COVER.sat, read as is), then no negative channel
      const satMix = em.find((n) => kind(n) === 'MathNode' && n.method === 'mix' && unwrap(n.cNode) === STYLE_COVER.sat && has(all(unwrap(n.aNode)), luma));
      expect(satMix, `${tag}: mix(vec3(lum(held)), held, STYLE_COVER.sat)`).toBeTruthy();
      const held = em.find((n) => kind(n) === 'MathNode' && n.method === 'max' && unwrap(n.aNode) === satMix && vecEq(constOf(n.bNode), [0, 0, 0]));
      expect(held, `${tag}: max(..., vec3(0))`).toBeTruthy();
      // the pool: one cone per flood on the world position, max'd; Godot's cone; the lamp and aim of each flood
      const cones = em.filter((n) => kind(n) === 'MathNode' && n.method === 'smoothstep' && constOf(n.aNode) === GODOT_CONE[0] && constOf(n.bNode) === GODOT_CONE[1]);
      expect(cones.length, `${tag}: a cone per flood`).toBe(floods.length);
      cones.forEach((c, i) => {
        const d = unwrap(c.cNode), nrm = unwrap(d?.aNode), sub = unwrap(nrm?.aNode);
        expect(kind(d) === 'MathNode' && d.method === 'dot' && kind(nrm) === 'MathNode' && nrm.method === 'normalize' && op(sub, '-') && sub.aNode === positionWorld,
          `${tag}: cone ${i}: dot(normalize(positionWorld - lamp), aim)`).toBe(true);
        expect(vecEq(constOf(sub.bNode), floods[i].slice(0, 3)) && vecEq(constOf(d.bNode), floods[i].slice(3)), `${tag}: cone ${i}: the flood's lamp and aim`).toBe(true);
      });
      const fade = em.find((n) => op(n, '-') && constOf(n.aNode) === 1 && op(unwrap(n.bNode), '*') && unwrap(unwrap(n.bNode).aNode) === STYLE_COVER.pool
        && cones.every((c) => has(all(unwrap(unwrap(n.bNode).bNode)), (x) => x === c)));
      expect(fade, `${tag}: 1 - STYLE_COVER.pool x max(cones)`).toBeTruthy();
      // the fill: held x STYLE_COVER.fill (read as is), x the piece's own scale where the web has one, x the fade
      const k = (m.userData as { coverScale?: { fill: { value: number } } }).coverScale;
      expect(k?.fill.value, `${tag}: the per-piece scale's uniform`).toBe(WEB_SCALES[tag as keyof typeof WEB_SCALES]?.fill);
      const fillK = k ? em.find((n) => op(n, '*') && unwrap(n.aNode) === STYLE_COVER.fill && unwrap(n.bNode) === k.fill) : STYLE_COVER.fill;
      expect(fillK, `${tag}: STYLE_COVER.fill${k ? ' x its scale' : ''}`).toBeTruthy();
      const heldFill = em.find((n) => op(n, '*') && operands(n).includes(held) && operands(n).includes(fillK));
      expect(heldFill, `${tag}: held x the fill`).toBeTruthy();
      const filled = em.find((n) => op(n, '*') && operands(n).includes(heldFill) && operands(n).includes(fade));
      expect(filled, `${tag}: (held x fill) x the pool fade`).toBeTruthy();
      // the sheen: moon x STYLE_COVER.sheen (as is) x graze x the up-facing mask; no pool on it
      const moonSheen = em.find((n) => op(n, '*') && vecEq(constOf(n.aNode), [moon.r, moon.g, moon.b]) && unwrap(n.bNode) === STYLE_COVER.sheen);
      expect(moonSheen, `${tag}: the moon's colour (linear) x STYLE_COVER.sheen`).toBeTruthy();
      const sheen = em.find((n) => op(n, '*') && unwrap(n.aNode) === moonSheen);
      expect(sheen, `${tag}: x the graze`).toBeTruthy();
      expect(cones.some((c) => all(sheen).includes(c)), `${tag}: no pool on the sheen`).toBe(false);
      expect(has(em, (n) => op(n, '+') && operands(n).includes(filled) && operands(n).includes(sheen)), `${tag}: the fill plus the sheen`).toBe(true);
    }
  });

  it('the rule is in the FloodMast\'s built graph: emission masked to the zone, Godot\'s power, mask and moon', () => {
    const piece = LOT_KIT.find((e) => e.piece.name === KIT_FLOODMAST)!.piece;
    const m = pbr(new THREE.MeshStandardMaterial({ color: 0x808080 }), kitPbrOpts(piece)) as THREE.MeshStandardNodeMaterial;
    const em = all(m.emissiveNode);
    // the zone: step(foot-relative height, the zone's top), and it masks the EMISSION (not only the colour)
    const steps = em.filter((n) => kind(n) === 'MathNode' && n.method === 'step');
    expect(steps.length, 'the emission is masked by the cover step').toBeGreaterThan(0);
    const zone = steps.find((n) => {
      const a = all(unwrap(n.aNode));
      return kind(unwrap(n.aNode)) === 'OperatorNode' && unwrap(n.aNode).op === '-'
        && has(a, (x) => kind(x) === 'AttributeNode' && x._attributeName === PBR_COVER_BASE) && has(a, (x) => kind(x) === 'SplitNode' && x.components === 'y');
    });
    expect(zone, 'the step\'s first operand is the height over the foot (positionWorld.y - coverBase)').toBeTruthy();
    expect(constOf(zone.bNode), 'the step\'s second operand is the zone\'s top').toBe(KIT_FLOODMAST_COVER);
    expect(constOf(zone.bNode)).toBe(GODOT_COVER[KIT_FLOODMAST]);
    // and the switch: the masked emission is gated by STYLE_COVER.on
    expect(reads(em, STYLE_COVER.on), 'the emission reads STYLE_COVER.on').toBe(true);
    // the sheen: (1 - N.V)^power in the moon's colour (sRGB -> linear), N turned to the viewer on a back face
    const pows = em.filter((n) => kind(n) === 'MathNode' && n.method === 'pow' && constOf(n.bNode) === STYLE.cover.power);
    expect(pows.length, 'the sheen power').toBeGreaterThan(0);
    const moon = new THREE.Color().setRGB(GODOT_MOON[0], GODOT_MOON[1], GODOT_MOON[2], THREE.SRGBColorSpace);
    expect(has(em, (n) => vecEq(constOf(n), [moon.r, moon.g, moon.b])), 'the moon\'s colour (linear)').toBe(true);
    expect(has(pows, (p) => has(all(p.aNode), (n) => kind(n) === 'FrontFacingNode')), 'the graze: a back face turns its normal to the viewer').toBe(true);
    // the up-facing mask: the graze × (1 - smoothstep(lo, hi, y of the world normal as seen)), Godot's edges
    const ups = em.filter((n) => kind(n) === 'MathNode' && n.method === 'smoothstep' && constOf(n.aNode) === GODOT_UP[0] && constOf(n.bNode) === GODOT_UP[1]);
    expect(ups.length, 'a smoothstep with kit_wet.gdshader\'s up-facing edges').toBeGreaterThan(0);
    const onUp = (n: N) => {
      const y = unwrap(n.cNode), v = unwrap(y?.node);
      return kind(y) === 'SplitNode' && y.components === 'y' && kind(v) === 'OperatorNode' && v.op === '*'
        && v.aNode === normalWorldGeometry && has(all(v.bNode), (x) => kind(x) === 'FrontFacingNode');
    };
    const up = ups.find(onUp);
    expect(up, 'its x is the y of the world normal (geometric, turned to the viewer)').toBeTruthy();
    const operands = (n: N) => [unwrap(n.aNode), unwrap(n.bNode)];
    const mask = em.find((n) => kind(n) === 'OperatorNode' && n.op === '-' && constOf(n.aNode) === 1 && unwrap(n.bNode) === up);
    expect(mask, '1 - that smoothstep').toBeTruthy();
    expect(has(em, (n) => kind(n) === 'OperatorNode' && n.op === '*' && operands(n).some((o) => pows.includes(o)) && operands(n).includes(mask)),
      'the mask multiplies the graze (the sheen only, not the fill)').toBe(true);
  });

  it('cover pieces wear the fill and sheen; the lamp nothing; the mast\'s zone is measured from each placement\'s foot', () => {
    const src = new THREE.MeshStandardMaterial({ color: 0x808080 });
    for (const { piece } of LOT_KIT) {
      const m = pbr(src, kitPbrOpts(piece)) as THREE.MeshStandardNodeMaterial;
      const emission = m.emissiveNode ? graph(m.emissiveNode) : { types: [], attrs: [] };
      if (piece.cover > 0) {
        expect(m.emissiveNode, `${piece.name}: the fill and sheen`).toBeTruthy();
        expect(m.userData.cover).toBe(piece.cover);
        // the emission really reads the fill, the sheen and the switch (not just the tokens)
        const ids: string[] = [];
        (m.emissiveNode as unknown as { traverse(cb: (n: { uuid: string }) => void): void }).traverse((n) => ids.push(n.uuid));
        for (const [k, u] of Object.entries({ fill: STYLE_COVER.fill, sheen: STYLE_COVER.sheen, on: STYLE_COVER.on })) {
          expect(ids, `${piece.name}: the emission reads STYLE_COVER.${k}`).toContain((u as unknown as { uuid: string }).uuid);
        }
      } else {
        expect(m.emissiveNode, `${piece.name}: not cover, no fill`).toBeFalsy();
      }
      expect(emission.attrs.includes(PBR_COVER_BASE), `${piece.name}: zone from the foot`).toBe(piece.name === KIT_FLOODMAST);
    }
    expect(kitPbrOpts(LOT_KIT.find((e) => e.piece.name === KIT_FLOODLAMP)!.piece).coverTop).toBe(0);
  });

  it('stays under the bloom threshold: a texel at the guard\'s cap × the fill plus a full sheen, exposed, < STYLE.bloom.threshold', () => {
    expect(STYLE.cover.fill).toBeGreaterThan(0);
    expect(STYLE.cover.sheen).toBeGreaterThan(0);
    expect(coverPeakLuminance() * STYLE.grade.exposure).toBeLessThan(STYLE.bloom.threshold);
    // and with the largest per-piece fill scale (the container's)
    const k = Math.max(...Object.values(KIT_COVER_SCALE).map((v) => v.fill));
    expect(coverPeakLuminance({ ...STYLE.cover, fill: STYLE.cover.fill * k }) * STYLE.grade.exposure).toBeLessThan(STYLE.bloom.threshold);
  });

  it('its live knobs start at the tokens (a lab may sweep them; the game never does)', () => {
    expect(STYLE_COVER.fill.value).toBe(STYLE.cover.fill);
    expect(STYLE_COVER.sheen.value).toBe(STYLE.cover.sheen);
    expect(STYLE_COVER.sat.value).toBe(STYLE.cover.sat);
    expect(STYLE_COVER.pool.value).toBe(STYLE.cover.pool);
    expect(STYLE_COVER.on.value).toBe(1);
  });

  it('has an A/B switch that adds no draw: a uniform, not a second material', () => {
    const src = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const piece = LOT_KIT[0].piece;
    const a = pbr(src, kitPbrOpts(piece));
    setCoverRead(false);
    expect(STYLE_COVER.on.value).toBe(0);
    expect(pbr(src, kitPbrOpts(piece))).toBe(a);
    setCoverRead(true);
    expect(STYLE_COVER.on.value).toBe(1);
  });
});

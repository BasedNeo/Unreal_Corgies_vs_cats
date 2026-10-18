// TW-PETS (W17): the twin's slab match draws Godot's PLACEHOLDER pets (src/client/views/slab-pet.ts). Godot is the product.
// 1. Godot's numbers, parsed from its own files (as kit-cover.test.ts parses look.gd), so the twin cannot drift:
//    pet_model.gd (the surfaces, GAP, TRIM, Kit's segments, and every numeric literal of _corgi, _cat, _vest, _chest,
//    _collar and rifle() in order against the twin's transliteration), pet_materials.gd (colours, energies, fills,
//    roughness, metallic, the plate's band rows and triplanar scale), tuning.gd TEAM_COLORS, pet.gd (the rifle mount, the
//    aim pitch clamp). The built materials carry those values.
// 2. The built pet: one mesh with the five surfaces + a rifle with two, 7 draws, materials only from the style factory;
//    Godot's own read checks (test_read_pets.gd) on the twin's geometry: the silhouettes, the vest over the back, flanks
//    and chest (Godot's orthographic coverage, ported), the team pattern, the team colours, nothing at the bloom threshold.
// 3. The view over time (pet.gd): faces the aim yaw, pitches the rifle (clamped), hides while dead; the muzzle.
// 4. The one switch: only a slab match draws them (EntityViews + main.ts's welcome mode); every other mode keeps
//    createCharacter. Shared geometry per (species, team), released only when its last pet goes.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three/webgpu';
import {
  AIM_PITCH_MAX, GAP, PET_LOOK, PET_SURFACES, RIFLE_MOUNT, RIFLE_SURFACES, SEGMENTS, TRIM,
  buildPetLayout, buildRifle, createSlabPet, petMaterial, slabPetCacheStats, type PetSurface, type SlabPetAvatar,
} from '../../src/client/views/slab-pet';
import { EntityViews, drawsSlabPets } from '../../src/client/views/entity-views';
import type { AvatarFrame } from '../../src/client/views/avatar';
import type { CharacterAvatar } from '../../src/client/procgen/characters';
import { PALETTE, STYLE } from '../../src/client/style/style-tokens.js';
import { StylePbrMaterial } from '../../src/client/style/style-webgpu.js';
import { FIRST_WIN_MODES } from '../../src/shared/content/cosmetics';
import type { EntityState } from '../../src/shared/protocol';
import { Anim, CLASS_IDS, EntityKind, Species, Team, type AnimId, type SpeciesId, type TeamId } from '../../src/shared/types';

const read = (rel: string) => readFileSync(rel, 'utf8');
const GD_MODEL = read('engines/godot/game/pet_model.gd');
const GD_MATS = read('engines/godot/look/pet_materials.gd');
const GD_TUNING = read('engines/godot/game/tuning.gd');
const GD_PET = read('engines/godot/game/pet.gd');
const TS_PET = read('src/client/views/slab-pet.ts');

// ---- parsing ----
const nums = (t: string) => [...t.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
/** Every Color(r, g, b) in a text, as [r, g, b]. */
const colors = (t: string) => [...t.matchAll(/Color\(([-\d.]+), ([-\d.]+), ([-\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
const hexes = (t: string) => [...t.matchAll(/Color\("([0-9a-fA-F]{6})"\)/g)].map((m) => parseInt(m[1], 16));
const gdConst = (src: string, name: string) => {
  const m = new RegExp(`^const ${name} := (.*)$`, 'm').exec(src);
  if (!m) throw new Error(`no const ${name}`);
  return m[1].replace(/#.*$/, '');
};
/** A top-level GDScript function, from its `static func` line to the next top-level declaration or comment. */
const gdFunc = (name: string) => {
  const i = GD_MODEL.indexOf(`\nstatic func ${name}(`);
  if (i < 0) throw new Error(`pet_model.gd has no ${name}()`);
  const rest = GD_MODEL.slice(i + 1);
  const end = rest.slice(1).search(/\n(static |func |class |const |var |## |# -)/);
  return end < 0 ? rest : rest.slice(0, end + 1);
};
/** A top-level TypeScript function of slab-pet.ts, from `function name(` to its closing brace at column 0. */
const tsFunc = (name: string) => {
  const i = TS_PET.indexOf(`\nfunction ${name}(`);
  if (i < 0) throw new Error(`slab-pet.ts has no ${name}()`);
  return TS_PET.slice(i, TS_PET.indexOf('\n}', i) + 2);
};
/** The numeric literals of a code body, in order (comments, then strings, out first; digits inside names ignored). */
const literals = (code: string, comment: RegExp) => (code.replace(comment, '').replace(/"[^"\n]*"|'[^'\n]*'/g, '""')
  .match(/(?<![\w.])-?\d+(?:\.\d+)?/g) ?? []).map(Number);
/** The calls and names of a code body, in order: Kit primitives and frames (snake_case folded: cyl_at = cylAt) and every
 *  string (the surface each primitive goes on, the part it belongs to). */
const tokens = (code: string, comment: RegExp) => [...code.replace(comment, '').matchAll(/\b(k|Kit)\.(\w+)\(|"([^"\n]*)"|'([^'\n]*)'/g)]
  .map((m) => (m[2] ? `${m[1]}.${m[2].replace(/_/g, '').toLowerCase()}` : `"${m[3] ?? m[4]}"`));
/** (primitive, surface) of every k.<primitive>("surface", ...) call. */
const kitCalls = (code: string, comment: RegExp) => [...code.replace(comment, '').matchAll(/\bk\.(\w+)\(\s*["']([^"'\n]+)["']/g)]
  .map((m) => `${m[1].replace(/_/g, '').toLowerCase()}:${m[2]}`);
const GD_COMMENT = /#[^\n]*/g;
const TS_COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
/** pet_materials.gd get_material's `match kind:` branch for a label (e.g. '"plate"'). */
const gdBranch = (label: string) => {
  const i = GD_MATS.indexOf(`\t\t${label}:`);
  if (i < 0) throw new Error(`pet_materials.gd has no ${label} branch`);
  const rest = GD_MATS.slice(i);
  const end = rest.slice(1).search(/\n\t\t["_]|\n\tcache|\n\t_cache/);
  return end < 0 ? rest : rest.slice(0, end + 1);
};
const gdFuncMats = (name: string) => {
  const i = GD_MATS.indexOf(`\nfunc ${name}(`);
  if (i < 0) throw new Error(`pet_materials.gd has no ${name}()`);
  const end = GD_MATS.indexOf('\n\n\n', i + 1);
  return GD_MATS.slice(i, end < 0 ? undefined : end);
};
/** A top-level function of pet_materials.gd by its text: its `func` line and every following line that is blank or
 *  indented, up to the next top-level line (a declaration or a comment at column 0); trailing blank lines dropped. */
const gdTopFunc = (name: string) => {
  const m = new RegExp(`^func ${name}\\(.*$`, 'm').exec(GD_MATS);
  if (!m) throw new Error(`pet_materials.gd has no ${name}()`);
  const lines = GD_MATS.slice(m.index).split('\n');
  let n = 1;
  while (n < lines.length && (lines[n] === '' || /^\s/.test(lines[n]))) n++;
  return lines.slice(0, n).join('\n').trimEnd();
};
/**
 * The texture means (PET_LOOK.furMean / wearMean) are MEASURED, not parsed: Godot's fur and wear textures are FastNoiseLite
 * noise that CI cannot run. They depend on exactly this source: the bodies of _noise, _fur and _wear (the only file
 * function they call is _noise) and any pet_materials.gd constant those bodies read (none at f7f45b5). Its sha256 and the
 * values measured from it (Godot 4.7.2-stable, linear mean over every texel) are recorded together; if the source
 * changes, re-measure with MEASURE_TEXTURES (repo root, $GODOT = a Godot 4 binary), then update all three.
 */
const TEXTURE_PIN = {
  fns: ['_noise', '_fur', '_wear'],
  sha256: '33bd14252a9042df2ea0213a39fb8647fdac5375bef31ac1671309e2577f0b8d',
  measured: { fur: [0.7424, 0.5082], wear: 0.6926 }, // MEAN fur0 0.7424 · MEAN fur1 0.5082 · MEAN wear 0.6926
};
const MEASURE_TEXTURES = `D=$(mktemp -d) && mkdir -p $D/look && cp engines/godot/look/pet_materials.gd $D/look/ && printf 'config_version=5\\n' > $D/project.godot && printf '%s\\n' 'extends SceneTree' 'func _init():' '    var pm = load("res://look/pet_materials.gd").new()' '    for k in ["fur0", "fur1", "wear"]:' '        var img: Image = (pm._wear() if k == "wear" else pm._fur(int(k[3]))).get_image()' '        var s := 0.0' '        for y in img.get_height():' '            for x in img.get_width():' '                s += img.get_pixel(x, y).srgb_to_linear().r' '        print("MEAN %s %.4f" % [k, s / (img.get_width() * img.get_height())])' '    quit()' > $D/m.gd && "$GODOT" --headless --path $D -s res://m.gd | grep MEAN`;

/**
 * Godot's own layout(species, team) part boxes (model space, [min x, y, z, max x, y, z], m, snapped to 0.1 mm) and the
 * cat's tail centre line, dumped from engines/godot/game/pet_model.gd at f7f45b5 by Godot 4.7.2 (PARITY P3d). The twin's
 * parts must sit within GODOT_PART_TOL of these (measured worst: 7.3 mm, the neck's capsule tessellation). Regenerate
 * (repo root, $GODOT = a Godot 4 binary): copy engines/godot/game/{pet_model,tuning}.gd into a throwaway project's game/
 * (project.godot = "config_version=5"), add a SceneTree script that, for sp, tm in 0..1, writes PM.layout(sp, tm).parts
 * (each AABB as position.xyz + end.xyz, snappedf 0.0001) and .tail to JSON, run "$GODOT" --headless --path <dir> -s
 * res://dump.gd, and paste the boxes here. The script used: <scratchpad>/confirm-l1/pets/gdgeo/dump.gd (output out.json).
 */
const GODOT_PARTS: Record<string, Record<string, number[]>> = {
  '0_0': { band: [-0.258, 0.162, -0.41, 0.258, 0.678, 0.31], bib: [-0.1852, 0.19, -0.6657, 0.1852, 0.61, -0.3343], body: [-0.24, 0.18, -0.58, 0.24, 0.66, 0.68], collar: [-0.165, 0.4593, -0.6557, 0.165, 0.6947, -0.3493], ear_l: [-0.2018, 0.8119, -0.635, 0.0418, 1.3272, -0.565], ear_r: [-0.0418, 0.8119, -0.635, 0.2018, 1.3272, -0.565], eyes: [-0.1142, 0.808, -0.8114, 0.1142, 0.872, -0.7686], head: [-0.2047, 0.6, -0.835, 0.2047, 0.96, -0.445], legs: [-0.215, 0.01, -0.435, 0.215, 0.25, 0.515], muzzle: [-0.1462, 0.6, -0.99, 0.1462, 0.805, -0.603], neck: [-0.1427, 0.3504, -0.7496, 0.1427, 0.8696, -0.3004], nose: [-0.039, 0.695, -1.0241, 0.039, 0.765, -0.9559], panel: [-0.25, 0.2188, -0.7532, 0.25, 0.6204, -0.6579], socks: [-0.218, -0.005, -0.4775, 0.218, 0.085, 0.5175], tail: [-0.078, 0.49, 0.622, 0.078, 0.63, 0.778], trim: [-0.275, 0.15, -0.7302, 0.275, 0.69, 0.35] },
  '0_1': { band: [-0.258, 0.162, -0.41, 0.258, 0.678, 0.31], bib: [-0.1852, 0.19, -0.6657, 0.1852, 0.61, -0.3343], body: [-0.24, 0.18, -0.58, 0.24, 0.66, 0.68], collar: [-0.165, 0.4593, -0.6557, 0.165, 0.6947, -0.3493], ear_l: [-0.2018, 0.8119, -0.635, 0.0418, 1.3272, -0.565], ear_r: [-0.0418, 0.8119, -0.635, 0.2018, 1.3272, -0.565], eyes: [-0.1142, 0.808, -0.8114, 0.1142, 0.872, -0.7686], head: [-0.2047, 0.6, -0.835, 0.2047, 0.96, -0.445], legs: [-0.215, 0.01, -0.435, 0.215, 0.25, 0.515], muzzle: [-0.1462, 0.6, -0.99, 0.1462, 0.805, -0.603], neck: [-0.1427, 0.3504, -0.7496, 0.1427, 0.8696, -0.3004], nose: [-0.039, 0.695, -1.0241, 0.039, 0.765, -0.9559], panel: [-0.25, 0.2188, -0.7532, 0.25, 0.6204, -0.6579], socks: [-0.218, -0.005, -0.4775, 0.218, 0.085, 0.5175], tail: [-0.078, 0.49, 0.622, 0.078, 0.63, 0.778], trim: [-0.27, 0.15, -0.7478, 0.27, 0.69, 0.35] },
  '1_0': { band: [-0.18, 0.44, -0.33, 0.18, 0.8, 0.31], bib: [-0.1072, 0.45, -0.457, 0.1072, 0.71, -0.223], body: [-0.15, 0.43, -0.42, 0.15, 0.77, 0.4357], collar: [-0.1, 0.6792, -0.452, 0.1, 0.8288, -0.248], ear_l: [-0.1435, 0.9854, -0.52, -0.0065, 1.1956, -0.38], ear_r: [0.0065, 0.9854, -0.52, 0.1435, 1.1956, -0.38], eyes: [-0.0853, 0.93, -0.5945, 0.0853, 0.99, -0.5555], head: [-0.1462, 0.795, -0.5965, 0.1462, 1.065, -0.3235], legs: [-0.1337, 0.0, -0.3484, 0.1337, 0.53, 0.3184], muzzle: [-0.0731, 0.825, -0.6385, 0.0731, 0.935, -0.5215], neck: [-0.0808, 0.615, -0.505, 0.0808, 0.965, -0.235], nose: [-0.0214, 0.882, -0.6575, 0.0214, 0.918, -0.6225], panel: [-0.25, 0.4686, -0.5249, 0.25, 0.791, -0.4407], tail: [-0.0618, 0.6168, 0.3568, 0.0618, 1.5038, 0.6638], trim: [-0.275, 0.428, -0.5018, 0.275, 0.812, 0.35] },
  '1_1': { band: [-0.18, 0.44, -0.33, 0.18, 0.8, 0.31], bib: [-0.1072, 0.45, -0.457, 0.1072, 0.71, -0.223], body: [-0.15, 0.43, -0.42, 0.15, 0.77, 0.4357], collar: [-0.1, 0.6792, -0.452, 0.1, 0.8288, -0.248], ear_l: [-0.1435, 0.9854, -0.52, -0.0065, 1.1956, -0.38], ear_r: [0.0065, 0.9854, -0.52, 0.1435, 1.1956, -0.38], eyes: [-0.0853, 0.93, -0.5945, 0.0853, 0.99, -0.5555], head: [-0.1462, 0.795, -0.5965, 0.1462, 1.065, -0.3235], legs: [-0.1337, 0.0, -0.3484, 0.1337, 0.53, 0.3184], muzzle: [-0.0731, 0.825, -0.6385, 0.0731, 0.935, -0.5215], neck: [-0.0808, 0.615, -0.505, 0.0808, 0.965, -0.235], nose: [-0.0214, 0.882, -0.6575, 0.0214, 0.918, -0.6225], panel: [-0.25, 0.4686, -0.5249, 0.25, 0.791, -0.4407], tail: [-0.0618, 0.6168, 0.3568, 0.0618, 1.5038, 0.6638], trim: [-0.192, 0.428, -0.5194, 0.192, 0.812, 0.35] },
};
const GODOT_CAT_TAIL = [[0.0, 0.68, 0.42], [0.0, 0.81, 0.5573], [0.0, 0.94, 0.5906], [0.0, 1.07, 0.52], [0.0, 1.2, 0.4494], [0.0, 1.33, 0.4827], [0.0, 1.46, 0.62]];
const GODOT_PART_TOL = 0.01;

// ---- colour maths (as test_read_pets.gd) ----
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const Y = (c: readonly number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const srgbOf = (col: THREE.Color) => { const t = { r: 0, g: 0, b: 0 }; col.getRGB(t, THREE.SRGBColorSpace); return [t.r, t.g, t.b]; };
const hexRgb = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((x) => x / 255);
const hueOf = (c: readonly number[]) => { const hsl = { h: 0, s: 0, l: 0 }; new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace); return hsl.h; };

// ---- helpers ----
const frame = (o: Partial<AvatarFrame> = {}): AvatarFrame => ({ speed: 0, vy: 0, grounded: true, anim: Anim.Idle as AnimId, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false, ...o });
const groupsOf = (m: THREE.Mesh) => m.geometry.groups.map((g) => ({ ...g }));
/** test_read_pets.gd _coverage, ported: the merged mesh rasterised orthographically on a 2 cm grid with a depth test,
 *  view 0 side on (from +X), view 2 head-on (from -Z); the frontmost cells per surface. */
function coverage(geo: THREE.BufferGeometry, view: 0 | 2): { band: number; plate: number; total: number } {
  const CELL = 0.02, u0 = -1.2, v0 = -0.1, w = 120, h = 90;
  const depth = new Float32Array(w * h).fill(-Infinity), owner = new Int32Array(w * h).fill(-1);
  const pos = geo.getAttribute('position'), idx = geo.index!;
  const q = (i: number) => { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); return view === 0 ? [z, y, x] : [x, y, -z]; };
  geo.groups.forEach((g, s) => {
    for (let t = g.start; t < g.start + g.count; t += 3) {
      const p0 = q(idx.getX(t)), p1 = q(idx.getX(t + 1)), p2 = q(idx.getX(t + 2));
      const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
      if (Math.abs(area) < 1e-9) continue;
      const i0 = Math.max(0, Math.floor((Math.min(p0[0], p1[0], p2[0]) - u0) / CELL)), i1 = Math.min(w - 1, Math.floor((Math.max(p0[0], p1[0], p2[0]) - u0) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(p0[1], p1[1], p2[1]) - v0) / CELL)), j1 = Math.min(h - 1, Math.floor((Math.max(p0[1], p1[1], p2[1]) - v0) / CELL));
      for (let j = j0; j <= j1; j++) {
        const y = v0 + (j + 0.5) * CELL;
        for (let i = i0; i <= i1; i++) {
          const x = u0 + (i + 0.5) * CELL;
          const b1 = ((x - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (y - p0[1])) / area;
          const b2 = ((p1[0] - p0[0]) * (y - p0[1]) - (x - p0[0]) * (p1[1] - p0[1])) / area;
          if (b1 < 0 || b2 < 0 || b1 + b2 > 1) continue;
          const d = p0[2] + b1 * (p1[2] - p0[2]) + b2 * (p2[2] - p0[2]);
          const k = j * w + i;
          if (d > depth[k]) { depth[k] = d; owner[k] = s; }
        }
      }
    }
  });
  const out = { band: 0, plate: 0, total: 0 };
  const band = PET_SURFACES.indexOf('band'), plate = PET_SURFACES.indexOf('plate');
  for (const o of owner) { if (o < 0) continue; out.total++; if (o === band) out.band++; else if (o === plate) out.plate++; }
  return out;
}

// ------------------------------------------------------------------------------------------------ 1. Godot's numbers
describe("TW-PETS: the twin's numbers are Godot's (parsed from pet_model.gd, pet_materials.gd, tuning.gd, pet.gd)", () => {
  it('pet_model.gd: the surfaces, GAP, TRIM and Kit\'s segments per primitive', () => {
    expect(JSON.parse(gdConst(GD_MODEL, 'SURFACES'))).toEqual([...PET_SURFACES]);
    expect(JSON.parse(gdConst(GD_MODEL, 'RIFLE_SURFACES'))).toEqual([...RIFLE_SURFACES]);
    expect(Number(gdConst(GD_MODEL, 'GAP'))).toBe(GAP);
    expect(Number(gdConst(GD_MODEL, 'TRIM'))).toBe(TRIM);
    const seg = (fn: string) => {
      const m = new RegExp(`func ${fn}\\([\\s\\S]*?radial_segments = (\\d+)[\\s\\S]*?rings = (\\d+)`).exec(GD_MODEL);
      return m ? [Number(m[1]), Number(m[2])] : [];
    };
    expect(seg('ellipsoid')).toEqual([...SEGMENTS.ellipsoid]);
    expect(seg('capsule')).toEqual([...SEGMENTS.capsule]);
    expect(seg('cyl_at')).toEqual([...SEGMENTS.cyl]);
    expect(seg('tube')).toEqual([...SEGMENTS.tube]);
    expect(seg('segment')).toEqual([...SEGMENTS.segment]);
  });

  it.each([['_corgi', 'corgi'], ['_cat', 'cat'], ['_vest', 'vest'], ['_chest', 'chest'], ['_collar', 'collar'], ['rifle', 'rifle']])(
    'pet_model.gd %s(): every number, in order, is the twin\'s %s()', (gd, ts) => {
      const want = literals(gdFunc(gd), GD_COMMENT);
      expect(want.length, `${gd}: parsed`).toBeGreaterThan(gd === '_collar' ? 0 : 10);
      expect(literals(tsFunc(ts), TS_COMMENT), 'the numbers').toEqual(want);
      // the same primitives on the same surfaces, in the same parts (rifle(): Godot also names its nodes, so only the calls)
      const calls = kitCalls(gdFunc(gd), GD_COMMENT);
      expect(calls.length, `${gd}: calls parsed`).toBeGreaterThan(0);
      expect(kitCalls(tsFunc(ts), TS_COMMENT), 'the primitives and surfaces').toEqual(calls);
      if (gd !== 'rifle') expect(tokens(tsFunc(ts), TS_COMMENT), 'the calls, surfaces and parts').toEqual(tokens(gdFunc(gd), GD_COMMENT));
    });

  it('pet_materials.gd: colours, energies, fills, roughness, metallic; tuning.gd TEAM_COLORS; the locked palette', () => {
    expect(hexes(gdConst(GD_MATS, 'TEAM'))).toEqual([...PET_LOOK.team]);
    expect(hexes(gdConst(GD_TUNING, 'TEAM_COLORS'))).toEqual([...PET_LOOK.team]);
    expect([PALETTE.teamCorgis, PALETTE.teamCats]).toEqual([...PET_LOOK.team]);
    expect(colors(gdConst(GD_MATS, 'BAND'))).toEqual(PET_LOOK.band.map((c) => [...c]));
    expect(nums(gdConst(GD_MATS, 'BAND_ENERGY'))).toEqual([...PET_LOOK.bandEnergy]);
    expect(colors(gdConst(GD_MATS, 'OCHRE'))).toEqual([[...PET_LOOK.ochre]]);
    expect(colors(gdConst(GD_MATS, 'CORGI_COAT'))).toEqual([[...PET_LOOK.coat[0]]]);
    expect(colors(gdConst(GD_MATS, 'CAT_COAT'))).toEqual([[...PET_LOOK.coat[1]]]);
    expect(colors(gdConst(GD_MATS, 'ACCENT'))).toEqual(PET_LOOK.accent.map((c) => [...c]));
    expect(colors(gdConst(GD_MATS, 'DARK'))).toEqual([[...PET_LOOK.dark]]);
    expect(nums(gdConst(GD_MATS, 'FUR_FILL'))).toEqual([...PET_LOOK.furFill]);
    // BAND is the locked blue itself and the crimson darkened 0.45 (Godot's Color.darkened: × (1 − 0.45))
    PET_LOOK.band[0].forEach((c, i) => expect(c).toBeCloseTo(hexRgb(PET_LOOK.team[0])[i], 3));
    PET_LOOK.band[1].forEach((c, i) => expect(c).toBeCloseTo(hexRgb(PET_LOOK.team[1])[i] * 0.55, 3));
    // the match kind: branches
    const ca = gdBranch('"coat", "accent"');
    const r = /m\.roughness = ([\d.]+) if kind == "coat" else ([\d.]+)/.exec(ca)!;
    expect([Number(r[1]), Number(r[2])]).toEqual([PET_LOOK.rough.coat, PET_LOOK.rough.accent]);
    expect(ca).toMatch(/m\.emission = c\n/);
    expect(ca).toMatch(/m\.emission_energy_multiplier = FUR_FILL\[species\]/);
    expect(Number(/m\.roughness = ([\d.]+)/.exec(gdBranch('"dark"'))![1])).toBe(PET_LOOK.rough.dark);
    const band = gdBranch('"band"');
    expect(Number(/m\.roughness = ([\d.]+)/.exec(band)![1])).toBe(PET_LOOK.rough.band);
    expect(band).toMatch(/m\.albedo_color = BAND\[team\]/);
    expect(band).toMatch(/m\.emission = BAND\[team\]/);
    expect(band).toMatch(/m\.emission_energy_multiplier = BAND_ENERGY\[team\]/);
    const plate = gdBranch('"plate"');
    expect(Number(/m\.roughness = ([\d.]+)/.exec(plate)![1])).toBe(PET_LOOK.rough.plate);
    expect(Number(/m\.metallic = ([\d.]+)/.exec(plate)![1])).toBe(PET_LOOK.metal.plate);
    expect(nums(/m\.uv1_scale = Vector3\(([^)]+)\)/.exec(plate)![1])).toEqual([PET_LOOK.plateUvScale, PET_LOOK.plateUvScale, PET_LOOK.plateUvScale]);
    expect(plate).toMatch(/m\.emission = BAND\[team\]/);
    expect(plate).toMatch(/m\.emission_energy_multiplier = BAND_ENERGY\[team\]/);
    expect(plate).toMatch(/m\.emission_texture = _band_mask\(\)/);
    expect(plate).toMatch(/EMISSION_OP_MULTIPLY/);
    const metal = gdBranch('"metal"');
    expect(colors(metal)[0]).toEqual([...PET_LOOK.metalColor]);
    expect(Number(/m\.metallic = ([\d.]+)/.exec(metal)![1])).toBe(PET_LOOK.metal.metal);
    expect(Number(/m\.roughness = ([\d.]+)/.exec(metal)![1])).toBe(PET_LOOK.rough.metal);
    // the plate texture: the team band in the top rows, ochre below; the mask the same rows
    const pt = gdFuncMats('_plate'), mask = gdFuncMats('_band_mask');
    expect(Number(/BAND\[team\] if y < (\d+) else OCHRE/.exec(pt)![1])).toBe(PET_LOOK.bandRows);
    expect(Number(/Color\.WHITE if y < (\d+) else Color\.BLACK/.exec(mask)![1])).toBe(PET_LOOK.bandRows);
    expect(nums(/Image\.create\((\d+), (\d+)/.exec(pt)!.slice(1).join(','))).toEqual([PET_LOOK.plateRows, PET_LOOK.plateRows]);
  });

  it('the measured texture means are pinned to the exact Godot noise source they were measured from', () => {
    const bodies = TEXTURE_PIN.fns.map(gdTopFunc);
    // the pinned set is closed: these bodies call no other pet_materials.gd function
    const calls = new Set([...bodies.join('\n').matchAll(/\b(_\w+)\(/g)].map((m) => m[1]));
    expect([...calls].filter((f) => GD_MATS.includes(`\nfunc ${f}(`) && !TEXTURE_PIN.fns.includes(f)), 'an unpinned helper').toEqual([]);
    // ... and any file constant they read is part of the pinned text
    const consts = new Map([...GD_MATS.matchAll(/^const (\w+) :=.*$/gm)].map((m) => [m[1], m[0]]));
    const read = [...new Set(bodies.join('\n').match(/\b[A-Z][A-Z0-9_]*\b/g) ?? [])].filter((k) => consts.has(k)).sort();
    const text = [...bodies, ...read.map((k) => consts.get(k)!)].join('\n\n');
    expect(bodies.every((b) => b.split('\n').length > 3), 'each body extracted').toBe(true);
    expect(createHash('sha256').update(text).digest('hex'), `re-measure the fur/wear means: ${MEASURE_TEXTURES}`).toBe(TEXTURE_PIN.sha256);
    // the twin uses exactly the values recorded with that hash
    expect([...PET_LOOK.furMean], 'PET_LOOK.furMean is not the measured fur mean').toEqual(TEXTURE_PIN.measured.fur);
    expect(PET_LOOK.wearMean, 'PET_LOOK.wearMean is not the measured wear mean').toBe(TEXTURE_PIN.measured.wear);
  });

  it('pet.gd: the rifle mount per species, the aim pitch clamp, the model turns to the yaw and hides at death', () => {
    const m = /rifle\.position = Vector3\(([^)]+)\) if species == T\.CORGI else Vector3\(([^)]+)\)/.exec(GD_PET)!;
    expect([nums(m[1]), nums(m[2])]).toEqual(RIFLE_MOUNT.map((r) => [...r]));
    const c = /rifle\.rotation\.x = clampf\(aim_pitch, (-?[\d.]+), ([\d.]+)\)/.exec(GD_PET)!;
    expect([Number(c[1]), Number(c[2])]).toEqual([-AIM_PITCH_MAX, AIM_PITCH_MAX]);
    expect(GD_PET).toMatch(/model\.rotation\.y = yaw/);
    expect(/func die\([\s\S]*?model\.visible = false/.test(GD_PET)).toBe(true);
    expect(/func respawn\([\s\S]*?model\.visible = true/.test(GD_PET)).toBe(true);
  });

  it('the built materials carry those values (sRGB as Godot writes them), one per pet_materials.gd sharing rule', () => {
    const near = (a: number[], b: readonly number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 4));
    /** a colour (three keeps linear) = Godot's sRGB colour, linearised, × a texture's linear mean */
    const nearLin = (col: THREE.Color, c: readonly number[], k: number) => [col.r, col.g, col.b].forEach((x, i) => expect(x).toBeCloseTo(lin(c[i]) * k, 4));
    expect(gdBranch('"coat", "accent"')).toMatch(/m\.albedo_texture = _fur\(species\)[\s\S]*m\.emission_texture = _fur\(species\)/);
    expect(gdBranch('"band"')).toMatch(/m\.albedo_texture = _wear\(\)/);
    expect(gdBranch('"band"')).not.toMatch(/emission_texture/);
    expect(gdBranch('"metal"')).toMatch(/m\.albedo_texture = _wear\(\)/);
    for (const sp of [0, 1]) for (const tm of [0, 1]) {
      const m = (k: PetSurface) => petMaterial(k, sp, tm) as THREE.MeshStandardMaterial;
      for (const k of ['coat', 'accent', 'dark', 'band', 'plate', 'metal'] as const) {
        expect(m(k)).toBeInstanceOf(StylePbrMaterial);
        expect(m(k).userData.style, k).toBe('pbr');
        expect(m(k).roughness, k).toBe(PET_LOOK.rough[k]);
        expect(m(k).metalness, k).toBe(PET_LOOK.metal[k]);
      }
      // coat and accent: the colour × the fur's mean, albedo and self-lit fill (× FUR_FILL)
      nearLin(m('coat').color, PET_LOOK.coat[sp], PET_LOOK.furMean[sp]);
      nearLin(m('coat').emissive, PET_LOOK.coat[sp], PET_LOOK.furMean[sp]);
      expect(m('coat').emissiveIntensity).toBe(PET_LOOK.furFill[sp]);
      nearLin(m('accent').color, PET_LOOK.accent[sp], PET_LOOK.furMean[sp]);
      nearLin(m('accent').emissive, PET_LOOK.accent[sp], PET_LOOK.furMean[sp]);
      expect(m('accent').emissiveIntensity).toBe(PET_LOOK.furFill[sp]);
      near(srgbOf(m('dark').color), PET_LOOK.dark);
      // the team paint: albedo × the wear's mean, self-lit in the plain band colour × BAND_ENERGY
      nearLin(m('band').color, PET_LOOK.band[tm], PET_LOOK.wearMean);
      near(srgbOf(m('band').emissive), PET_LOOK.band[tm]);
      expect(m('band').emissiveIntensity).toBe(PET_LOOK.bandEnergy[tm]);
      nearLin(m('metal').color, PET_LOOK.metalColor, PET_LOOK.wearMean);
      // the plate: white × its texture (the band rows, ochre below), self-lit in the band colour through the mask
      const pl = m('plate');
      near(srgbOf(pl.color), [1, 1, 1]);
      near(srgbOf(pl.emissive), PET_LOOK.band[tm]);
      expect(pl.emissiveIntensity).toBe(PET_LOOK.bandEnergy[tm]);
      const rows = (t: THREE.Texture | null) => { const d = (t as THREE.DataTexture).image.data as Uint8Array; return (y: number) => [...d.slice(y * 4, y * 4 + 3)]; };
      const map = rows(pl.map), em = rows(pl.emissiveMap);
      expect(pl.map!.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(map(0)).toEqual(PET_LOOK.band[tm].map((x) => Math.round(x * 255)));
      expect(map(PET_LOOK.bandRows - 1)).toEqual(map(0));
      expect(map(PET_LOOK.bandRows)).toEqual(PET_LOOK.ochre.map((x) => Math.round(x * 255)));
      expect(em(PET_LOOK.bandRows - 1)).toEqual([255, 255, 255]);
      expect(em(PET_LOOK.bandRows)).toEqual([0, 0, 0]);
      expect((pl.map as THREE.DataTexture).image.height).toBe(PET_LOOK.plateRows);
      // sharing: band and plate per team (both species), dark and metal one, coat and accent per species
      expect(petMaterial('band', 1 - sp, tm)).toBe(m('band'));
      expect(petMaterial('plate', 1 - sp, tm)).toBe(m('plate'));
      expect(petMaterial('dark', 1 - sp, 1 - tm)).toBe(m('dark'));
      expect(petMaterial('metal', 1 - sp, 1 - tm)).toBe(m('metal'));
      expect(petMaterial('coat', sp, 1 - tm)).toBe(m('coat'));
      expect(petMaterial('coat', 1 - sp, tm)).not.toBe(m('coat'));
      expect(petMaterial('band', sp, 1 - tm)).not.toBe(m('band'));
    }
  });
});

// ------------------------------------------------------------------------------------------------ 2. the built pet
describe('TW-PETS: the built pet (one merged mesh, five surfaces; Godot\'s read checks from test_read_pets.gd)', () => {
  it('one mesh per pet with the five surfaces in order, a rifle with two: 7 draws per pass; style-factory materials only, no lines', () => {
    for (const sp of [Species.Corgi, Species.Cat]) for (const tm of [Team.Corgis, Team.Cats]) {
      const pet = createSlabPet({ species: sp, team: tm as TeamId });
      const meshes: THREE.Mesh[] = [];
      let lines = 0;
      pet.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); if ((o as THREE.Line).isLine || (o as THREE.LineSegments).isLineSegments) lines++; });
      expect(meshes.map((m) => m.name)).toEqual(['Body', 'RifleModel']);
      expect(lines, 'no ink, no crease lines').toBe(0);
      const [body, rifle] = meshes;
      expect(body.geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1, 2, 3, 4]);
      expect(body.geometry.groups.every((g) => g.count > 0)).toBe(true);
      expect((body.material as THREE.Material[]).map((m) => m.userData.petSurface)).toEqual([...PET_SURFACES]);
      expect(rifle.geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
      expect((rifle.material as THREE.Material[]).map((m) => m.userData.petSurface)).toEqual([...RIFLE_SURFACES]);
      for (const m of meshes) for (const mat of m.material as THREE.Material[]) expect(mat.userData.style).toBe('pbr');
      // draws per pass: one per group (Godot: 5 surfaces + 2 rifle, test_read_pets.gd MAX_DRAWS_PER_PET 8)
      expect(pet.stats.draws).toBe(7);
      expect(groupsOf(body).length + groupsOf(rifle).length).toBe(7);
      expect(body.castShadow && rifle.castShadow).toBe(true);
      expect(pet.root.userData.placeholder, 'PLACEHOLDER (pet_model.gd meta)').toBe(true);
      pet.dispose();
    }
    expect(slabPetCacheStats()).toEqual({ layouts: 0, rifle: 0 });
    // PARITY F14: the slab HUD keeps hud.gd's PLACEHOLDER PETS tag while the pets are placeholders
    expect(read('src/client/ui/slab-hud.ts')).toMatch(/SLAB_PLACEHOLDER_TAG = 'PLACEHOLDER PETS'/);
  });

  it("every part's box is Godot's layout() box within 1 cm, and the cat's tail is Godot's centre line (PARITY P3d)", () => {
    for (const [key, want] of Object.entries(GODOT_PARTS)) {
      const lay = buildPetLayout(Number(key[0]), Number(key[2]));
      expect(Object.keys(lay.parts).sort(), key + ': the parts').toEqual(Object.keys(want).sort());
      for (const [name, box] of Object.entries(want)) {
        const got = [...lay.parts[name].min.toArray(), ...lay.parts[name].max.toArray()];
        got.forEach((x, i) => expect(Math.abs(x - box[i]), key + ' ' + name + ' [' + i + ']: twin ' + x.toFixed(4) + ', Godot ' + box[i]).toBeLessThanOrEqual(GODOT_PART_TOL));
      }
      if (key === '1_1') lay.tail.forEach((p, i) => p.toArray().forEach((x, j) => expect(x).toBeCloseTo(GODOT_CAT_TAIL[i][j], 4)));
      lay.geometry.dispose();
    }
  });

  it("the prisms point the right way: the corgi's ears narrow to their tips, the Corgi Company shield to its bottom point", () => {
    const lay = buildPetLayout(0, 0), g = lay.geometry, pos = g.getAttribute('position'), idx = g.index!;
    /** The x extent of a surface's cross-section at height y (its triangles sliced by the plane), for triangles whose
     *  centroid passes `keep`: the prisms have vertices only at their corners, so the slice measures the width. */
    const width = (surface: string, y: number, keep: (x: number, z: number) => boolean) => {
      const grp = g.groups[PET_SURFACES.indexOf(surface as (typeof PET_SURFACES)[number])];
      let lo = Infinity, hi = -Infinity;
      for (let t = grp.start; t < grp.start + grp.count; t += 3) {
        const v = [0, 1, 2].map((k) => { const i = idx.getX(t + k); return [pos.getX(i), pos.getY(i), pos.getZ(i)]; });
        if (!keep((v[0][0] + v[1][0] + v[2][0]) / 3, (v[0][2] + v[1][2] + v[2][2]) / 3)) continue;
        for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
          const [p, q] = [v[a], v[b]];
          if ((p[1] - y) * (q[1] - y) > 0 || p[1] === q[1]) continue;
          const x = p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]);
          lo = Math.min(lo, x); hi = Math.max(hi, x);
        }
      }
      return hi - lo;
    };
    // the right ear (coat), above the head: nothing else of the corgi's coat reaches there
    const ear = lay.parts.ear_r, earH = ear.max.y - ear.min.y, head = lay.parts.head.max.y;
    const inEar = (x: number, z: number) => x > 0 && z > ear.min.z - 1e-4 && z < ear.max.z + 1e-4;
    const earTop = width('coat', ear.max.y - 0.08 * earH, inEar);
    const earLow = width('coat', head + 0.02, inEar);
    expect(earTop, 'the ear narrows to its tip').toBeLessThan(0.06);
    expect(earLow, 'the ear is wide above the head').toBeGreaterThan(3 * earTop);
    // the Corgi Company chest shield (band, in front of the chest): full width at its top, a point at its bottom
    const pan = lay.parts.panel, panH = pan.max.y - pan.min.y;
    const inShield = (_x: number, z: number) => z < pan.max.z + 1e-4;
    const shieldBottom = width('band', pan.min.y + 0.08 * panH, inShield);
    const shieldTop = width('band', pan.max.y - 0.08 * panH, inShield);
    expect(shieldBottom, 'the shield narrows to its point').toBeLessThan(0.15);
    expect(shieldTop, 'the shield is full width at the top').toBeGreaterThan(0.45);
    lay.geometry.dispose();
  });

  it('the silhouettes read the species (test_read_pets.gd _silhouettes): long low corgi, big ears; leggy cat with an S tail on top', () => {
    const c = buildPetLayout(0, 0), k = buildPetLayout(1, 1);
    const cp = c.parts, kp = k.parts, size = (b: THREE.Box3) => b.getSize(new THREE.Vector3());
    expect(size(cp.body).z / cp.body.max.y).toBeGreaterThanOrEqual(1.7);
    expect(size(kp.body).z / kp.body.max.y).toBeLessThanOrEqual(1.3);
    expect(size(kp.body).x).toBeLessThanOrEqual(0.75 * size(cp.body).x);
    expect(size(cp.legs).y).toBeLessThanOrEqual(0.3);
    expect(size(kp.legs).y).toBeGreaterThanOrEqual(Math.max(0.45, 1.8 * size(cp.legs).y));
    for (const ear of ['ear_l', 'ear_r']) {
      expect(size(cp[ear]).y).toBeGreaterThanOrEqual(Math.max(0.38, 1.1 * size(cp.head).y));
      expect(cp[ear].max.y).toBeGreaterThanOrEqual(cp.head.max.y + 0.3);
      expect(size(kp[ear]).y).toBeLessThanOrEqual(0.6 * size(cp[ear]).y);
    }
    expect(Math.max(...size(cp.tail).toArray())).toBeLessThanOrEqual(0.2);
    let len = 0, turns = 0, prev = 0;
    for (let i = 1; i < k.tail.length; i++) {
      len += k.tail[i].distanceTo(k.tail[i - 1]);
      const dz = k.tail[i].z - k.tail[i - 1].z;
      if (prev !== 0 && Math.sign(dz) !== Math.sign(prev)) turns++;
      prev = dz;
    }
    expect(len).toBeGreaterThanOrEqual(0.8);
    expect(turns).toBeGreaterThanOrEqual(2);
    const top = Math.max(...Object.values(kp).map((b) => b.max.y));
    expect(kp.tail.max.y).toBeGreaterThanOrEqual(top - 0.001);
    expect(kp.tail.max.y).toBeGreaterThanOrEqual(kp.ear_l.max.y + 0.15);
    for (const sp of [0, 1]) for (const p of Object.keys(buildPetLayout(sp, 0).parts)) expect(p).not.toMatch(/mouth|tongue/);
    c.geometry.dispose(); k.geometry.dispose();
  });

  it('the vest covers the back, flanks and chest: it wraps the torso, the chest shield faces the front, team paint dominates the armour', () => {
    // test_read_pets.gd MIN_TEAM_SHARE [side on, head-on] per species (each pet in its game pairing, species = team)
    const MIN_TEAM_SHARE = [[0.4, 0.32], [0.3, 0.26]];
    for (const sp of [0, 1]) {
      const lay = buildPetLayout(sp, sp);
      const p = lay.parts, size = (b: THREE.Box3) => b.getSize(new THREE.Vector3());
      const mid = p.body.getCenter(new THREE.Vector3()).y;
      // flanks: as wide as the torso; back and belly: over the body's middle both ways; the back's top covered
      expect(size(p.band).x, 'flanks').toBeGreaterThanOrEqual(0.95 * size(p.body).x);
      expect(p.band.min.y).toBeLessThanOrEqual(mid - 0.1);
      expect(p.band.max.y, 'back').toBeGreaterThanOrEqual(mid + 0.1);
      expect(p.band.max.y, 'back').toBeGreaterThanOrEqual(p.body.max.y - 0.03);
      // chest: a team panel >= 0.30 m across and 0.25 m tall, in front of the chest, centred under the head
      expect(size(p.panel).x).toBeGreaterThanOrEqual(0.3);
      expect(size(p.panel).y).toBeGreaterThanOrEqual(0.25);
      expect(p.panel.min.z).toBeLessThanOrEqual(Math.min(p.bib.min.z, p.body.min.z));
      expect(p.panel.max.y).toBeLessThanOrEqual(p.head.min.y + 0.03);
      expect(Math.abs(p.panel.getCenter(new THREE.Vector3()).x)).toBeLessThanOrEqual(0.01);
      // Godot's orthographic coverage: team paint share of the pet and of the armour, side on and head-on
      for (const view of [0, 2] as const) {
        const cov = coverage(lay.geometry, view);
        expect(cov.band / Math.max(1, cov.total), `species ${sp} view ${view}: team share`).toBeGreaterThanOrEqual(MIN_TEAM_SHARE[sp][view / 2]);
        expect(cov.band / Math.max(1, cov.band + cov.plate), `species ${sp} view ${view}: paint of the armour`).toBeGreaterThanOrEqual(0.6);
        expect(cov.plate, 'with ochre trim').toBeGreaterThan(0);
      }
      lay.geometry.dispose();
    }
  });

  it('the team pattern follows the team, not the species: Corgi Company solid, Cat Cadre split (features >= 0.15 m)', () => {
    for (const sp of [0, 1]) {
      const solid = buildPetLayout(sp, 0), split = buildPetLayout(sp, 1);
      expect([solid.bands, solid.chest]).toEqual([1, 1]);
      expect([split.bands, split.chest]).toEqual([2, 2]);
      expect(Math.min(solid.bandFeature, split.bandFeature)).toBeGreaterThanOrEqual(GAP);
      solid.geometry.dispose(); split.geometry.dispose();
    }
  });

  it('team colours: the locked hues, apart in lightness both ways (greyscale, colour blindness), self-lit under the bloom threshold', () => {
    const band = PET_LOOK.band, E = PET_LOOK.bandEnergy;
    // self-lit luminance, linear, as built (test_read_pets.gd _team: the coat's emission × its fur texture × its fill)
    const glow = (m: THREE.MeshStandardMaterial) => (0.2126 * m.emissive.r + 0.7152 * m.emissive.g + 0.0722 * m.emissive.b) * m.emissiveIntensity;
    const coatGlow = [0, 1].map((sp) => glow(petMaterial('coat', sp, sp) as THREE.MeshStandardMaterial));
    const bandGlow = [0, 1].map((t) => glow(petMaterial('band', t, t) as THREE.MeshStandardMaterial));
    bandGlow.forEach((g, t) => expect(g).toBeCloseTo(Y(band[t]) * E[t], 5));
    // hue: each band is its team's locked hue (tuning.gd TEAM_COLORS = PALETTE)
    for (const t of [0, 1]) expect(Math.abs(hueOf(band[t]) - hueOf(hexRgb(PET_LOOK.team[t])))).toBeLessThan(0.01);
    // lightness: Corgi Company paint brighter than its tan corgi (>= 1.25x), Cat Cadre paint darker than its grey cat
    // (the coat >= 3x), and the two sides >= 3:1 apart in self-lit luminance (test_read_pets.gd _team / _bands)
    expect(bandGlow[0]).toBeGreaterThanOrEqual(1.25 * coatGlow[0]);
    expect(coatGlow[1]).toBeGreaterThanOrEqual(3 * bandGlow[1]);
    expect(bandGlow[0]).toBeGreaterThanOrEqual(3 * bandGlow[1]);
    // the built pets wear their team's paint: the band group's material is the team's band, never the other's
    for (const sp of [0, 1] as SpeciesId[]) for (const tm of [0, 1] as const) {
      const pet = createSlabPet({ species: sp, team: tm as TeamId });
      const mats = pet.body.material as THREE.MeshStandardMaterial[];
      const paint = mats[PET_SURFACES.indexOf('band')];
      const want: readonly number[] = band[tm];
      expect(srgbOf(paint.emissive).map((x) => +x.toFixed(4))).toEqual(want.map((x) => +x.toFixed(4)));
      expect(paint.color.r / paint.color.b).toBeCloseTo(lin(want[0]) / lin(want[2]), 4);
      expect((pet.rifleBody.material as THREE.Material[])[1]).toBe(paint);
      pet.dispose();
    }
    // nothing on a pet reaches the bloom (an HDR threshold on the scene pass, before the exposure): every emission
    // peak, linear × energy, stays under 0.85 × the threshold
    for (const k of ['coat', 'accent', 'band', 'plate'] as const) for (const sp of [0, 1]) for (const tm of [0, 1]) {
      const m = petMaterial(k, sp, tm) as THREE.MeshStandardMaterial;
      const peak = Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * m.emissiveIntensity;
      expect(peak, `${k} ${sp}/${tm}`).toBeLessThan(0.85 * STYLE.bloom.threshold);
    }
  });

  it("the plate's team band is Godot's object-space triplanar: a side face's v is -1.4 y, a top face's v is 1.4 z", () => {
    const lay = buildPetLayout(1, 1); // Cat Cadre: the split band, the rims and the chest strip are plate
    const g = lay.geometry, grp = g.groups[PET_SURFACES.indexOf('plate')];
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv = g.getAttribute('uv'), idx = g.index!;
    let side = 0, top = 0, front = 0;
    for (let t = grp.start; t < grp.start + grp.count; t++) {
      const i = idx.getX(t), n = [Math.abs(nor.getX(i)), Math.abs(nor.getY(i)), Math.abs(nor.getZ(i))];
      if (n[0] > 0.97) { expect(uv.getY(i)).toBeCloseTo(-PET_LOOK.plateUvScale * pos.getY(i), 4); side++; }
      if (n[1] > 0.97) { expect(uv.getY(i)).toBeCloseTo(PET_LOOK.plateUvScale * pos.getZ(i), 4); top++; }
      if (n[2] > 0.97) { expect(uv.getY(i)).toBeCloseTo(-PET_LOOK.plateUvScale * pos.getY(i), 4); front++; }
    }
    expect(side && top && front).toBeTruthy();
    lay.geometry.dispose();
  });
});

// ------------------------------------------------------------------------------------------------ 3. over time (pet.gd)
describe('TW-PETS: the pet over time (pet.gd set_facing, die, respawn; rifle.gd muzzle)', () => {
  it('faces the aim yaw, pitches the rifle (clamped to ±0.9), hides while dead; the muzzle at the barrel tip; height = head top', () => {
    const pet = createSlabPet({ species: Species.Corgi, team: Team.Corgis });
    pet.update(frame({ aimYawOffset: 0.3, aimPitch: 0.5 }), 1 / 60);
    expect(pet.model.rotation.y).toBeCloseTo(0.3, 6);
    expect(pet.rifle.rotation.x).toBeCloseTo(0.5, 6);
    pet.update(frame({ aimPitch: 1.4 }), 1 / 60);
    expect(pet.rifle.rotation.x).toBeCloseTo(AIM_PITCH_MAX, 6);
    pet.update(frame({ aimPitch: -2 }), 1 / 60);
    expect(pet.rifle.rotation.x).toBeCloseTo(-AIM_PITCH_MAX, 6);
    expect(pet.model.visible).toBe(true);
    pet.update(frame({ dead: true }), 1 / 60);
    expect(pet.model.visible).toBe(false);
    pet.update(frame(), 1 / 60);
    expect(pet.model.visible).toBe(true);
    // the rifle is the model's (pet.gd: model.add_child(rifle)): hidden with it while dead, turned with it to the aim yaw
    const shown = (o: THREE.Object3D | null) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
    pet.update(frame({ dead: true }), 1 / 60);
    expect(shown(pet.rifleBody), 'the rifle hides while dead').toBe(false);
    pet.update(frame({ aimYawOffset: 0.6 }), 1 / 60);
    expect(shown(pet.rifleBody)).toBe(true);
    pet.root.rotation.y = 0.25;
    const ry = new THREE.Euler().setFromQuaternion(pet.rifleBody.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    expect(ry, "the rifle's world yaw = the body yaw + aimYawOffset").toBeCloseTo(0.25 + 0.6, 5);
    pet.root.rotation.y = 0;
    pet.update(frame(), 1 / 60);
    pet.trigger('death'); expect(pet.model.visible).toBe(false);
    pet.trigger('spawn'); expect(pet.model.visible).toBe(true);
    for (const a of ['hit', 'fire', 'jump', 'land', 'emote']) pet.trigger(a); // no reaction in Godot: no throw, no change
    expect(pet.model.visible).toBe(true);
    // muzzle: root (feet) + the mount + the rifle's pitch applied to (0, 0.015, -0.47)
    pet.root.position.set(1, 2, 3);
    const th = 0.4;
    pet.update(frame({ aimPitch: th }), 1 / 60);
    const m = pet.muzzleWorld(new THREE.Vector3());
    const [mx, my, mz] = RIFLE_MOUNT[0], [, oy, oz] = buildRifle().muzzle.toArray();
    expect(m.x).toBeCloseTo(1 + mx, 5);
    expect(m.y).toBeCloseTo(2 + my + oy * Math.cos(th) - oz * Math.sin(th), 5);
    expect(m.z).toBeCloseTo(3 + mz + oy * Math.sin(th) + oz * Math.cos(th), 5);
    expect(m.y, 'pitched up: the muzzle rises').toBeGreaterThan(2 + my + oy);
    expect(pet.height).toBeCloseTo(0.78 + 0.18, 5); // the corgi's head ellipsoid (pet_model.gd) top
    pet.dispose();
    const cat = createSlabPet({ species: Species.Cat, team: Team.Cats });
    expect(cat.height).toBeCloseTo(0.93 + 0.135, 5);
    expect(cat.rifle.position.toArray()).toEqual([...RIFLE_MOUNT[1]]);
    cat.dispose();
  });
});

// ------------------------------------------------------------------------------------------------ 4. the switch, sharing
const state = (id: number, kind: number, species: SpeciesId, team: TeamId, o: Partial<EntityState> = {}): EntityState => ({
  id, kind, team, species, cls: CLASS_IDS.indexOf('assault'), seed: 10 + id, x: id * 3, y: 0, z: 0, yaw: 0.7, pitch: 0,
  vx: 0, vy: 0, vz: 0, hp: 120, maxHp: 120, anim: Anim.Idle, flags: 1, weapon: 0, ammo: 30, ...o,
} as EntityState);

describe('TW-PETS: the one switch (only a slab match draws the slab pets) and shared geometry', () => {
  it('drawsSlabPets: slab only, never any other mode; main.ts hands EntityViews the welcome\'s mode', () => {
    expect(FIRST_WIN_MODES.length).toBeGreaterThanOrEqual(7);
    for (const mode of FIRST_WIN_MODES) expect(drawsSlabPets(mode), mode).toBe(mode === 'slab');
    expect(drawsSlabPets('')).toBe(false);
    expect(drawsSlabPets(undefined)).toBe(false);
    const main = read('src/client/main.ts');
    expect(main).toMatch(/new EntityViews\(ctx\.scene, \{[\s\S]*?mode: \(\) => net\?\.mode \?\? ''[\s\S]*?\}\);/);
  });

  it('EntityViews: a slab match draws a slab pet for every player and bot (facing the aim yaw); every other mode draws createCharacter', () => {
    let mode = 'slab';
    const scene = new THREE.Scene();
    const views = new EntityViews(scene, { mode: () => mode });
    const states = new Map<number, EntityState>([
      [1, state(1, EntityKind.Player, Species.Corgi, Team.Corgis)],
      [2, state(2, EntityKind.Bot, Species.Cat, Team.Cats)],
      [3, state(3, EntityKind.Bot, Species.Corgi, Team.Corgis)],
      [4, state(4, EntityKind.Bot, Species.Cat, Team.Cats)],
    ]);
    views.sync(states, 1, 1 / 60);
    const isPet = (id: number) => views.get(id)!.avatar.root.userData.placeholder === true;
    expect([1, 2, 3, 4].map(isPet)).toEqual([true, true, true, true]);
    expect(views.get(1)!.lookKey, 'no looks on a placeholder pet').toBe('');
    expect(slabPetCacheStats(), '2 v 2 shares one layout per (species, team) and one rifle').toEqual({ layouts: 2, rifle: 1 });
    expect((views.get(1)!.avatar as SlabPetAvatar).body.geometry).toBe((views.get(3)!.avatar as SlabPetAvatar).body.geometry);
    // running sideways while aiming elsewhere: the root follows the body yaw, the model the aim yaw (pet.gd set_facing)
    states.set(2, state(2, EntityKind.Bot, Species.Cat, Team.Cats, { vx: 4, yaw: 0.7 }));
    for (let i = 0; i < 120; i++) views.sync(states, 1, 1 / 60);
    const pet = views.get(2)!.avatar as SlabPetAvatar;
    expect(Math.abs(pet.root.rotation.y - 0.7)).toBeGreaterThan(0.5);
    const e = new THREE.Euler().setFromQuaternion(pet.model.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
    expect(e.y).toBeCloseTo(0.7, 5);
    // every other mode: the character kits, rebuilt in place when the mode changes; the pets' geometry released
    for (const m of FIRST_WIN_MODES.filter((x) => x !== 'slab')) {
      mode = m;
      views.sync(states, 1, 1 / 60);
      for (const id of [1, 2, 3, 4]) {
        expect(isPet(id), `${m} #${id}`).toBe(false);
        expect((views.get(id)!.avatar as CharacterAvatar).stats, `${m} #${id}: a character kit`).toBeDefined();
      }
      expect(slabPetCacheStats()).toEqual({ layouts: 0, rifle: 0 });
    }
    mode = 'slab';
    views.sync(states, 1, 1 / 60);
    expect([1, 2, 3, 4].map(isPet)).toEqual([true, true, true, true]);
    views.sync(new Map(), 1, 1 / 60); // all gone: every view released
    expect(slabPetCacheStats()).toEqual({ layouts: 0, rifle: 0 });
  });

  it('shared per (species, team): two pets share geometry and materials; dispose frees the geometry only when the last pet goes', () => {
    const a = createSlabPet({ species: Species.Cat, team: Team.Cats });
    const b = createSlabPet({ species: Species.Cat, team: Team.Cats });
    const c = createSlabPet({ species: Species.Cat, team: Team.Corgis });
    expect(b.body.geometry).toBe(a.body.geometry);
    expect(b.rifleBody.geometry).toBe(a.rifleBody.geometry);
    expect(c.body.geometry).not.toBe(a.body.geometry);
    (a.body.material as THREE.Material[]).forEach((m, i) => expect((b.body.material as THREE.Material[])[i]).toBe(m));
    expect(slabPetCacheStats()).toEqual({ layouts: 2, rifle: 1 });
    let body = 0, rifle = 0, other = 0;
    a.body.geometry.addEventListener('dispose', () => body++);
    a.rifleBody.geometry.addEventListener('dispose', () => rifle++);
    c.body.geometry.addEventListener('dispose', () => other++);
    a.dispose();
    a.dispose(); // twice: still one release
    expect([body, rifle, other]).toEqual([0, 0, 0]);
    expect(slabPetCacheStats()).toEqual({ layouts: 2, rifle: 1 });
    c.dispose();
    expect([body, rifle, other]).toEqual([0, 0, 1]);
    b.dispose();
    expect([body, rifle, other]).toEqual([1, 1, 1]);
    expect(slabPetCacheStats()).toEqual({ layouts: 0, rifle: 0 });
    // a fresh pet after the last went builds anew (not a disposed geometry)
    const d = createSlabPet({ species: Species.Cat, team: Team.Cats });
    expect(d.body.geometry).not.toBe(a.body.geometry);
    d.dispose();
  });
});

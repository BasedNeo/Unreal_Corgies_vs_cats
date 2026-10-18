// TW-PETS (W17): the twin's slab match draws Godot's PLACEHOLDER pets, ported line by line (Godot is the product; it wins
// any clash). The W17 30 m team read (docs/qa/w17/AAA-30M.md) failed on the twin because its slab match drew the W7 K2
// hardened kits (faction camo, team colour on small trim) while Godot draws these pets: a long low corgi and a tall
// S-tailed cat in a team-painted barding vest, chest shield and collar (W13 R-PETS, W14 TEAM: docs/qa/w13/READ*,
// docs/qa/w14/READ3_VERIFICATION.md).
// Sources, each number copied (tests/unit/slab-pet.test.ts parses them back out of Godot's files, so they cannot drift):
//   engines/godot/game/pet_model.gd   the primitives, proportions, vest / chest shield / collar, the Cat Cadre split, the
//                                     surfaces coat / accent / dark / plate / band (rifle: metal / band), Kit's segments
//   engines/godot/look/pet_materials.gd   colours, roughness, metallic, the self-lit fills and the plate's team band
//                                     (its band rows, triplanar scale and self-light energy)
//   engines/godot/game/pet.gd         what the view does over time: the model faces the aim yaw, the rifle pitches with
//                                     the aim (clamped), the model hides while dead. No bob, no lean, no hit reaction.
// Like Godot, every part of a pet is merged into ONE mesh with one group (draw) per surface, built once per (species,
// team) and shared, and the rifle is one shared mesh with two groups: 5 + 2 draws per pet per pass. Origin at the feet,
// facing -Z (the twin's yaw 0, as Godot's). Materials only through the style factory (pbr(): no raw three materials,
// no ink, no crease lines). Render only: collision, hit boxes and aim heights stay the sim's capsule.
// Godot's procedural noise textures are not ported as patterns (docs/handoff/TW-PETS.md): the fur and wear textures enter
// as their measured means, the plate's grime and scuffs not at all; nor the coat's rim sheen or the plate's clearcoat
// (Forward+ only). The step-up catch-up (pet.gd step_offset) belongs to Godot's own
// movement; the twin's snapshots already move the pet smoothly.
import * as THREE from 'three/webgpu';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { pbr } from '../style/style-webgpu.js';
import type { SpeciesId, TeamId } from '../../shared/types';
import type { Avatar, AvatarFrame } from './avatar';

// ------------------------------------------------------------------------------------------------ Godot's numbers
/** pet_model.gd SURFACES / RIFLE_SURFACES: the mesh's groups in order, one material each. */
export const PET_SURFACES = ['coat', 'accent', 'dark', 'plate', 'band'] as const;
export const RIFLE_SURFACES = ['metal', 'band'] as const;
export type PetSurface = (typeof PET_SURFACES)[number] | (typeof RIFLE_SURFACES)[number];
/** pet_model.gd GAP: the Cat Cadre split (m, a feature that resolves at 30 m). */
export const GAP = 0.15;
/** pet_model.gd TRIM: the ochre rims at the ends of the vest (m). */
export const TRIM = 0.04;
/** pet_model.gd Kit: [radial_segments, rings] per primitive (Godot's rings + 1 rows of faces). */
export const SEGMENTS = { ellipsoid: [12, 6], capsule: [16, 6], cyl: [12, 1], tube: [12, 1], segment: [10, 2] } as const;
/** pet.gd _ready: the rifle's mount on the model, per species (corgi, cat). */
export const RIFLE_MOUNT = [[0.27, 0.64, -0.3], [0.22, 0.76, -0.22]] as const;
/** pet.gd set_facing: the rifle pitches with the aim, clamped to ± this (rad). */
export const AIM_PITCH_MAX = 0.9;

/** engines/godot/look/pet_materials.gd, every colour as Godot writes it (sRGB 0..1). */
export const PET_LOOK = {
  /** TEAM: the locked team signal colours (tuning.gd TEAM_COLORS, PALETTE.teamCorgis / teamCats). */
  team: [0x2f6fd6, 0xc9344a],
  /** BAND: Corgi Company the locked blue itself, Cat Cadre the crimson darkened 0.45. */
  band: [[0.1843, 0.4353, 0.8392], [0.4335, 0.1122, 0.1596]],
  /** BAND_ENERGY: the team paint's self-light (below the glow threshold). */
  bandEnergy: [1.15, 1.0],
  ochre: [0.74, 0.53, 0.16],
  /** CORGI_COAT, CAT_COAT */
  coat: [[0.7, 0.43, 0.22], [0.67, 0.66, 0.64]],
  /** ACCENT: corgi white bib / cat pale muzzle */
  accent: [[0.95, 0.91, 0.84], [0.85, 0.84, 0.82]],
  dark: [0.05, 0.045, 0.045],
  /** FUR_FILL: the coat's (and accent's) self-lit fill, × its own colour, per species. */
  furFill: [0.6, 0.9],
  /** The mean (linear) of Godot's procedural textures, measured in Godot 4.7.2 from pet_materials.gd itself (_fur(species)
   *  over all 128 x 128 texels, _wear() over 64 x 64; tests/unit/slab-pet.test.ts pins their source): the fur
   *  multiplies the coat's and accent's albedo AND emission (EMISSION_OP_MULTIPLY), the wear the band's and metal's
   *  albedo. FastNoiseLite's pattern is not ported; at 30 m a pet is ~7 x 20 px and the texture averages out. */
  furMean: [0.7424, 0.5082],
  wearMean: 0.6926,
  metalColor: [0.23, 0.23, 0.24],
  rough: { coat: 0.42, accent: 0.5, dark: 0.25, band: 0.6, plate: 0.38, metal: 0.32 },
  metal: { coat: 0, accent: 0, dark: 0, band: 0, plate: 0.1, metal: 0.9 },
  /** The plate's texture: 128 rows, the team band in rows 0..43 and ochre below (_plate, _band_mask); object-space
   *  triplanar at uv1_scale 1.4. The plate self-lights the band rows only (band × BAND_ENERGY × the mask). */
  plateRows: 128,
  bandRows: 44,
  plateUvScale: 1.4,
} as const;

// ------------------------------------------------------------------------------------------------ the merged-mesh kit
type V3 = THREE.Vector3;
const v3 = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z);
const add = (a: V3, b: V3): V3 => a.clone().add(b);
const sub = (a: V3, b: V3): V3 => a.clone().sub(b);
/** Godot's Transform3D product, left to right. */
const mul = (...m: THREE.Matrix4[]): THREE.Matrix4 => m.reduce((acc, x) => acc.multiply(x), new THREE.Matrix4());
const ZERO = v3(0, 0, 0);
const ONE = v3(1, 1, 1);
const RIGHT = v3(1, 0, 0);
const FORWARD = v3(0, 0, -1);
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const lerpf = (a: number, b: number, t: number) => a + (b - a) * t;
/** GDScript's `for i in n`. */
const range = (n: number): number[] => Array.from({ length: Math.max(0, n) }, (_, i) => i);

/**
 * Collects primitives per material surface, transformed into model space (three's normal matrix: the inverse transpose,
 * so the scaled spheres shade right), and records each named part's model-space box. Mirrors pet_model.gd's Kit; the
 * primitives are three's equivalents of Godot's (CapsuleMesh height is the whole capsule, three's the middle).
 */
class Kit {
  readonly surfs = new Map<string, THREE.BufferGeometry[]>();
  readonly parts: Record<string, THREE.Box3> = {};
  tail: V3[] = [];
  bands = 0;
  bandFeature = 0;
  chest = 0;

  /** Basis.from_euler (Godot's default order YXZ) × scale, at pos. */
  static at(pos: V3, rotDeg: V3 = ZERO, scale: V3 = ONE): THREE.Matrix4 {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotDeg.x * DEG, rotDeg.y * DEG, rotDeg.z * DEG, 'YXZ'));
    return new THREE.Matrix4().compose(pos, q, scale);
  }

  /** A frame at `base` turned by `rotDeg`: children placed in it rotate about the base (ears hinge at the skull). */
  static pivot(base: V3, rotDeg: V3): THREE.Matrix4 { return Kit.at(base, rotDeg); }

  /** A frame at `c` whose +Y runs along `dir` (for capsules and rings between two points). */
  static along(c: V3, dir: V3): THREE.Matrix4 {
    const up = dir.clone().normalize();
    const ref = Math.abs(up.x) < 0.9 ? RIGHT : FORWARD;
    const z = ref.clone().cross(up).normalize();
    return new THREE.Matrix4().makeBasis(up.clone().cross(z), up, z).setPosition(c);
  }

  put(kind: string, prim: THREE.BufferGeometry, xf: THREE.Matrix4, part = ''): void {
    prim.clearGroups();
    prim.applyMatrix4(xf);
    const g = kind === 'plate' ? plateUv(prim) : prim;
    let list = this.surfs.get(kind);
    if (!list) this.surfs.set(kind, (list = []));
    list.push(g);
    if (part) {
      g.computeBoundingBox();
      const box = g.boundingBox!.clone();
      this.parts[part] = this.parts[part] ? this.parts[part].union(box) : box;
    }
  }

  ellipsoid(kind: string, radii: V3, pos: V3, part = ''): void {
    const [radial, rings] = SEGMENTS.ellipsoid;
    this.put(kind, new THREE.SphereGeometry(1, radial, rings + 1), Kit.at(pos, ZERO, radii), part);
  }

  capsule(kind: string, radius: number, height: number, pos: V3, rot: V3, part = ''): void {
    const [radial, rings] = SEGMENTS.capsule;
    this.put(kind, new THREE.CapsuleGeometry(radius, height - 2 * radius, rings + 1, radial), Kit.at(pos, rot), part);
  }

  cyl(kind: string, top: number, bottom: number, height: number, pos: V3, rot: V3 = ZERO, part = ''): void {
    this.cylAt(kind, top, bottom, height, Kit.at(pos, rot), part);
  }

  cylAt(kind: string, top: number, bottom: number, height: number, xf: THREE.Matrix4, part = ''): void {
    const [radial, rings] = SEGMENTS.cyl;
    this.put(kind, new THREE.CylinderGeometry(top, bottom, height, radial, rings + 1), xf, part);
  }

  /** An open ring (no caps): a rim around something, seen from outside. */
  tube(kind: string, radius: number, height: number, xf: THREE.Matrix4, part = ''): void {
    const [radial, rings] = SEGMENTS.tube;
    this.put(kind, new THREE.CylinderGeometry(radius, radius, height, radial, rings + 1, true), xf, part);
  }

  box(kind: string, size: V3, pos: V3, part = ''): void { this.boxAt(kind, size, Kit.at(pos), part); }

  boxAt(kind: string, size: V3, xf: THREE.Matrix4, part = ''): void {
    this.put(kind, new THREE.BoxGeometry(size.x, size.y, size.z), xf, part);
  }

  prism(kind: string, size: V3, xf: THREE.Matrix4, part = ''): void { this.put(kind, prismGeometry(size), xf, part); }

  /** A capsule from a to b (the radius caps reach just past both ends, so a chain of segments has no gaps). */
  segment(kind: string, a: V3, b: V3, radius: number, part = ''): void {
    const [radial, rings] = SEGMENTS.segment;
    this.put(kind, new THREE.CapsuleGeometry(radius, a.distanceTo(b), rings + 1, radial), Kit.along(a.clone().add(b).multiplyScalar(0.5), sub(b, a)), part);
  }

  /** One geometry, one group per surface in `order` (a surface with no primitive is an empty group). */
  mesh(order: readonly string[]): THREE.BufferGeometry {
    const per = order.map((kind) => {
      const list = this.surfs.get(kind);
      if (!list?.length) throw new Error(`slab pet: no primitive on surface '${kind}'`);
      const g = mergeGeometries(list, false);
      for (const p of list) p.dispose();
      return g;
    });
    const out = mergeGeometries(per, true);
    for (const g of per) g.dispose();
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  }
}

/** Godot's PrismMesh (left_to_right 0.5): a triangle in XY with its apex on top, `size.z` deep, flat faces. */
function prismGeometry(size: V3): THREE.BufferGeometry {
  const w = size.x / 2, h = size.y / 2, d = size.z / 2;
  const A = [-w, -h], B = [w, -h], C = [0, h];
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const face = (pts: number[][], n: V3) => {
    n.normalize();
    const base = pos.length / 3;
    for (const p of pts) { pos.push(p[0], p[1], p[2]); nor.push(n.x, n.y, n.z); }
    for (let i = 1; i + 1 < pts.length; i++) {
      const a = v3(pts[0][0], pts[0][1], pts[0][2]), b = v3(pts[i][0], pts[i][1], pts[i][2]), c = v3(pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]);
      const out = sub(b, a).cross(sub(c, a)).dot(n) >= 0;
      idx.push(base, base + (out ? i : i + 1), base + (out ? i + 1 : i));
    }
  };
  face([[...A, d], [...B, d], [...C, d]], v3(0, 0, 1));
  face([[...A, -d], [...B, -d], [...C, -d]], v3(0, 0, -1));
  face([[...A, d], [...A, -d], [...B, -d], [...B, d]], v3(0, -1, 0));
  face([[...A, d], [...C, d], [...C, -d], [...A, -d]], v3(-size.y, size.x / 2, 0));
  face([[...B, d], [...B, -d], [...C, -d], [...C, d]], v3(size.y, size.x / 2, 0));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.setIndex(idx);
  return g;
}

/**
 * The plate's object-space triplanar mapping [pet_materials.gd plate: uv1_triplanar, uv1_scale 1.4; Godot's
 * triplanar_texture: P = VERTEX × scale × (1, -1, 1), sampled at P.xy (normal along z), P.xz (along y), P.zy × (-1, 1)
 * (along x)], one projection per triangle by its normal's dominant axis (Godot blends the three by |normal|). The
 * texture's rows run along v, so v alone places the team band. Model space, as Godot's merged mesh.
 */
function plateUv(prim: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = prim.index ? prim.toNonIndexed() : prim;
  if (g !== prim) prim.dispose();
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const s = PET_LOOK.plateUvScale;
  const uv = new Float32Array(p.count * 2);
  for (let t = 0; t + 2 < p.count; t += 3) {
    let nx = 0, ny = 0, nz = 0;
    for (let k = t; k < t + 3; k++) { nx += n.getX(k); ny += n.getY(k); nz += n.getZ(k); }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    for (let k = t; k < t + 3; k++) {
      const x = p.getX(k) * s, y = -p.getY(k) * s, z = p.getZ(k) * s;
      const [u, v] = az >= ax && az >= ay ? [x, y] : ay >= ax ? [x, z] : [-z, y];
      uv[k * 2] = u; uv[k * 2 + 1] = v;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const out = mergeVertices(g, 1e-5);
  g.dispose();
  return out;
}

// ------------------------------------------------------------------------------------------------ the pets (pet_model.gd)
function corgi(k: Kit, team: number): void {
  // long, low barrel body lying along Z: 1.26 m long, back at 0.66 m
  k.capsule('coat', 0.24, 1.26, v3(0, 0.42, 0.05), v3(90, 0, 0), 'body');
  k.ellipsoid('accent', v3(0.19, 0.21, 0.17), v3(0, 0.4, -0.5), 'bib'); // white chest
  // short legs with white socks
  for (const p of [v3(-0.14, 0, -0.36), v3(0.14, 0, -0.36), v3(-0.14, 0, 0.44), v3(0.14, 0, 0.44)]) {
    k.cyl('coat', 0.075, 0.065, 0.24, add(p, v3(0, 0.13, 0)), ZERO, 'legs');
    k.ellipsoid('accent', v3(0.08, 0.045, 0.1), add(p, v3(0, 0.04, -0.02)), 'socks');
  }
  // neck, head, fox face: a pointed white muzzle (closed: no mouth), nose, eyes
  k.segment('coat', v3(0, 0.5, -0.45), v3(0, 0.72, -0.6), 0.15, 'neck');
  k.ellipsoid('coat', v3(0.21, 0.18, 0.2), v3(0, 0.78, -0.64), 'head');
  k.ellipsoid('accent', v3(0.15, 0.09, 0.12), v3(0, 0.69, -0.72), 'muzzle');
  k.cyl('accent', 0.03, 0.085, 0.26, v3(0, 0.72, -0.86), v3(-90, 0, 0), 'muzzle');
  k.ellipsoid('dark', v3(0.04, 0.035, 0.035), v3(0, 0.73, -0.99), 'nose');
  for (const s of [-1.0, 1.0]) {
    k.ellipsoid('dark', v3(0.03, 0.032, 0.022), v3(0.085 * s, 0.84, -0.79), 'eyes');
    // big upright ears, taller than the head: the corgi's signature at range (cream inside, seen from the front)
    const ear = Kit.pivot(v3(0.08 * s, 0.84, -0.6), v3(0, 0, -13.0 * s));
    k.prism('coat', v3(0.25, 0.5, 0.07), mul(ear, Kit.at(v3(0, 0.25, 0))), s < 0 ? 'ear_l' : 'ear_r');
    k.prism('accent', v3(0.15, 0.3, 0.02), mul(ear, Kit.at(v3(0, 0.2, -0.04))));
  }
  k.ellipsoid('coat', v3(0.08, 0.07, 0.08), v3(0, 0.56, 0.7), 'tail'); // stub tail
  // team armour: a barding vest over the front two thirds of the torso (0.80 m), a chest shield 0.50 m across, a collar
  vest(k, team, v3(0, 0.42, -0.05), 0.258, 0.8);
  collar(k, v3(0, 0.5, -0.45), v3(0, 0.72, -0.6), 0.35, 0.165);
  chest(k, team, v3(0, 0.38, -0.7), 0.5, 0.24, 0.16);
}

function cat(k: Kit, team: number): void {
  // slim body on long legs: 0.84 m long, back at 0.77 m
  k.capsule('coat', 0.15, 0.84, v3(0, 0.62, 0.0), v3(90, 0, 0), 'body');
  k.ellipsoid('coat', v3(0.14, 0.17, 0.17), v3(0, 0.6, 0.27), 'body'); // haunches
  k.ellipsoid('accent', v3(0.11, 0.13, 0.12), v3(0, 0.58, -0.34), 'bib');
  for (const p of [v3(-0.085, 0, -0.27), v3(0.085, 0, -0.27), v3(-0.085, 0, 0.27), v3(0.085, 0, 0.27)]) {
    k.cyl('coat', 0.045, 0.037, 0.52, add(p, v3(0, 0.27, 0)), ZERO, 'legs');
    k.ellipsoid('coat', v3(0.05, 0.03, 0.065), add(p, v3(0, 0.03, -0.015)), 'legs');
  }
  // neck, round head, small flat muzzle (closed: no mouth), nose, eyes
  k.segment('coat', v3(0, 0.7, -0.32), v3(0, 0.88, -0.42), 0.085, 'neck');
  k.ellipsoid('coat', v3(0.15, 0.135, 0.14), v3(0, 0.93, -0.46), 'head');
  k.ellipsoid('accent', v3(0.075, 0.055, 0.06), v3(0, 0.88, -0.58), 'muzzle');
  k.ellipsoid('dark', v3(0.022, 0.018, 0.018), v3(0, 0.9, -0.64), 'nose');
  for (const s of [-1.0, 1.0]) {
    k.ellipsoid('dark', v3(0.026, 0.03, 0.02), v3(0.06 * s, 0.96, -0.575), 'eyes');
    // small pointed ears
    const ear = Kit.pivot(v3(0.075 * s, 1.0, -0.45), v3(0, 0, -12.0 * s));
    k.cylAt('coat', 0.0, 0.07, 0.2, mul(ear, Kit.at(v3(0, 0.1, 0))), s < 0 ? 'ear_l' : 'ear_r');
  }
  // a long tail held up in an S, above the head: the cat's signature at range
  const pts: V3[] = [];
  for (const i of range(7)) {
    const t = i / 6.0;
    pts.push(v3(0, 0.68 + 0.78 * t, 0.42 + 0.2 * t + 0.12 * Math.sin(TAU * t)));
  }
  for (const i of range(pts.length - 1)) {
    k.segment('coat', pts[i], pts[i + 1], lerpf(0.065, 0.045, i / 5.0), 'tail');
  }
  k.tail = pts;
  // team armour: a barding vest over the whole torso (0.72 m), a chest shield 0.50 m across (wider than the cat), a collar
  vest(k, team, v3(0, 0.62, -0.01), 0.18, 0.72);
  collar(k, v3(0, 0.7, -0.32), v3(0, 0.88, -0.42), 0.3, 0.1);
  chest(k, team, v3(0, 0.61, -0.48), 0.5, 0.18, 0.14);
}

/** pet_model.gd _vest: the barding vest around the torso (axis Z), centred at `c`, in the team colour with open ochre rims
 *  (TRIM) at both ends. Corgi Company one solid block; Cat Cadre two blocks split by a GAP-wide ochre band. */
function vest(k: Kit, team: number, c: V3, radius: number, length: number): void {
  const inner = length - 2.0 * TRIM;
  if (team === 0) {
    k.cyl('band', radius, radius, inner, c, v3(90, 0, 0), 'band');
    k.bands = 1;
    k.bandFeature = inner;
  } else {
    const block = (inner - GAP) * 0.5;
    for (const s of [-1.0, 1.0]) {
      k.cyl('band', radius, radius, block, add(c, v3(0, 0, s * (GAP + block) * 0.5)), v3(90, 0, 0), 'band');
    }
    k.tube('plate', radius + 0.004, GAP, Kit.at(c, v3(90, 0, 0)), 'trim');
    k.bands = 2;
    k.bandFeature = Math.min(block, GAP);
  }
  for (const s of [-1.0, 1.0]) {
    k.tube('plate', radius + 0.012, TRIM, Kit.at(add(c, v3(0, 0, s * (inner + TRIM) * 0.5)), v3(90, 0, 0)), 'trim');
  }
}

/** pet_model.gd _chest: the team chest shield facing -Z, `width` across, `top` above `seam` and `point` below it, tucked
 *  back 8 degrees. Corgi Company a solid pointed shield on an ochre backing; Cat Cadre a square plate split by a GAP strip. */
function chest(k: Kit, team: number, seam: V3, width: number, top: number, point: number): void {
  const f = Kit.at(seam, v3(-8, 0, 0));
  if (team === 0) {
    k.boxAt('band', v3(width, top, 0.04), mul(f, Kit.at(v3(0, top * 0.5, 0))), 'panel');
    k.prism('band', v3(width, point, 0.04), mul(f, Kit.at(v3(0, -point * 0.5, 0), v3(0, 0, 180))), 'panel');
    const b = Kit.at(v3(0, 0, 0.02)); // the ochre backing, 0.025 m proud all round
    k.boxAt('plate', v3(width + 0.05, top + 0.025, 0.03), mul(f, b, Kit.at(v3(0, top * 0.5, 0))), 'trim');
    k.prism('plate', v3(width + 0.05, point + 0.04, 0.03), mul(f, b, Kit.at(v3(0, -(point + 0.04) * 0.5, 0),
      v3(0, 0, 180))), 'trim');
    k.chest = 1;
  } else {
    const h = top + point;
    const strip = Math.max(GAP, (width - GAP) * 0.5);
    for (const s of [-1.0, 1.0]) {
      k.boxAt('band', v3(strip, h, 0.04), mul(f, Kit.at(v3(s * (GAP + strip) * 0.5, top - h * 0.5, 0))), 'panel');
    }
    k.boxAt('plate', v3(GAP, h, 0.035), mul(f, Kit.at(v3(0, top - h * 0.5, 0.003))), 'trim');
    k.chest = 2;
  }
}

/** pet_model.gd _collar: a collar ring around the neck from a to b, `along` of the way up. */
function collar(k: Kit, a: V3, b: V3, along: number, radius: number): void {
  k.cylAt('band', radius, radius, 0.06, Kit.along(a.clone().lerp(b, along), sub(b, a)), 'collar');
}

/** pet_model.gd rifle(): the rifle body (metal, a team band strip on top), -Z forward; returns the muzzle marker. */
function rifle(k: Kit): V3 {
  k.box('metal', v3(0.07, 0.1, 0.34), v3(0, 0, 0.02));
  k.cyl('metal', 0.022, 0.022, 0.32, v3(0, 0.015, -0.3), v3(90, 0, 0));
  k.box('metal', v3(0.05, 0.12, 0.06), v3(0, -0.09, 0.06));
  k.box('band', v3(0.075, 0.03, 0.14), v3(0, 0.065, 0.0));
  return v3(0, 0.015, -0.47);
}

// ------------------------------------------------------------------------------------------------ layouts (shared)
/** pet_model.gd layout(): a (species, team)'s geometry (groups in PET_SURFACES order), each named part's model-space
 *  box, the cat's tail centre line, the vest's straps (1 solid, 2 split), the smallest team block or gap (m) and the
 *  chest shield's team pieces (1 solid, 2 split). */
export interface PetLayout {
  geometry: THREE.BufferGeometry;
  parts: Record<string, THREE.Box3>;
  tail: V3[];
  bands: number;
  bandFeature: number;
  chest: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Math.round(Number(n) || 0)));

/** A fresh build (the caller owns the geometry). createSlabPet shares one per (species, team). */
export function buildPetLayout(species: number, team: number): PetLayout {
  const k = new Kit();
  if (clamp01(species) === 0) corgi(k, clamp01(team));
  else cat(k, clamp01(team));
  return { geometry: k.mesh(PET_SURFACES), parts: k.parts, tail: k.tail, bands: k.bands, bandFeature: k.bandFeature, chest: k.chest };
}

/** A fresh rifle build: the geometry (groups in RIFLE_SURFACES order) and the muzzle in the rifle's frame. */
export function buildRifle(): { geometry: THREE.BufferGeometry; muzzle: V3 } {
  const k = new Kit();
  const muzzle = rifle(k);
  return { geometry: k.mesh(RIFLE_SURFACES), muzzle };
}

interface Shared<T> { value: T; refs: number }
const layouts = new Map<string, Shared<PetLayout>>();
let rifleShared: Shared<{ geometry: THREE.BufferGeometry; muzzle: V3 }> | null = null;

function acquireLayout(species: number, team: number): { key: string; layout: PetLayout } {
  const key = `${clamp01(species)}_${clamp01(team)}`;
  let s = layouts.get(key);
  if (s) s.refs++;
  else layouts.set(key, (s = { value: buildPetLayout(species, team), refs: 1 }));
  return { key, layout: s.value };
}

function releaseLayout(key: string): void {
  const s = layouts.get(key);
  if (!s || --s.refs > 0) return;
  layouts.delete(key);
  s.value.geometry.dispose();
}

function acquireRifle(): { geometry: THREE.BufferGeometry; muzzle: V3 } {
  if (rifleShared) rifleShared.refs++;
  else rifleShared = { value: buildRifle(), refs: 1 };
  return rifleShared.value;
}

function releaseRifle(): void {
  if (!rifleShared || --rifleShared.refs > 0) return;
  rifleShared.value.geometry.dispose();
  rifleShared = null;
}

/** Live shared geometry: pet layouts (one per (species, team) in use) and the rifle (leak tests). */
export function slabPetCacheStats(): { layouts: number; rifle: number } {
  return { layouts: layouts.size, rifle: rifleShared ? 1 : 0 };
}

// ------------------------------------------------------------------------------------------------ materials (pet_materials.gd)
const srgb = (c: readonly number[]) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
const bytes = (c: readonly number[]) => c.map((x) => Math.round(x * 255));
const textures = new Map<string, THREE.DataTexture>();

/** One column of `rows` texels: the first PET_LOOK.bandRows in `top`, the rest in `rest` (sRGB 0..1). Cached. */
function rowsTexture(key: string, top: readonly number[], rest: readonly number[], color: boolean): THREE.DataTexture {
  let t = textures.get(key);
  if (t) return t;
  const n = PET_LOOK.plateRows, data = new Uint8Array(n * 4);
  for (let y = 0; y < n; y++) data.set([...bytes(y < PET_LOOK.bandRows ? top : rest), 255], y * 4);
  t = new THREE.DataTexture(data, 1, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.name = `slab_pet_${key}`;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  textures.set(key, t);
  return t;
}

/** pbr() options: Godot's pet materials are plain StandardMaterial3D (no wetness, no weathering detail on pets). */
const PET_PBR = { wetK: 0, detailAlbedo: 0, detailRough: 0, detailBump: [0, 0], scratch: 0, rivulets: 0, puddle: 0 };

/**
 * pet_materials.gd get_material(kind, species, team), through the style factory. Its sharing rule: band and plate per
 * team (both species), dark and metal one each, coat and accent per species. pbr() caches by the source's uuid.
 */
export function petMaterial(kind: PetSurface, species: number, team: number): THREE.Material {
  const sp = clamp01(species), tm = clamp01(team);
  const L = PET_LOOK;
  const key = kind === 'band' || kind === 'plate' ? `${kind}_${tm}` : kind === 'dark' || kind === 'metal' ? kind : `${kind}_${sp}`;
  let src: Record<string, unknown>;
  switch (kind) {
    case 'coat': case 'accent': {
      const c = kind === 'coat' ? L.coat[sp] : L.accent[sp];
      // × the fur texture's mean; the self-lit fill (W12 Q6 P1, W13): the same colour × fur × FUR_FILL, under the glow
      src = { color: srgb(c).multiplyScalar(L.furMean[sp]), emissive: srgb(c).multiplyScalar(L.furMean[sp]), emissiveIntensity: L.furFill[sp] };
      break;
    }
    case 'dark': src = { color: srgb(L.dark) }; break;
    case 'band': // the team paint × the wear texture's mean; self-lit in the plain band colour (no emission texture)
      src = { color: srgb(L.band[tm]).multiplyScalar(L.wearMean), emissive: srgb(L.band[tm]), emissiveIntensity: L.bandEnergy[tm] };
      break;
    case 'plate':
      // ochre paint with the team band across the top rows; the band rows self-light in the band colour (the mask)
      src = {
        color: new THREE.Color(1, 1, 1), map: rowsTexture(`plate_${tm}`, L.band[tm], L.ochre, true),
        emissive: srgb(L.band[tm]), emissiveIntensity: L.bandEnergy[tm], emissiveMap: rowsTexture('band_mask', [1, 1, 1], [0, 0, 0], false),
      };
      break;
    case 'metal': src = { color: srgb(L.metalColor).multiplyScalar(L.wearMean) }; break;
  }
  const m = pbr({ uuid: `slab-pet:${key}`, name: `slab_pet_${key}`, roughness: L.rough[kind], metalness: L.metal[kind], ...src }, PET_PBR);
  m.userData.petSurface = kind;
  return m;
}

// ------------------------------------------------------------------------------------------------ the avatar (pet.gd)
export interface SlabPetOptions { species: SpeciesId; team: TeamId }

export interface SlabPetAvatar extends Avatar {
  readonly species: number;
  readonly team: number;
  /** pet.gd `model`: turns to the aim yaw, hidden while dead. */
  readonly model: THREE.Group;
  /** The merged pet mesh (PET_SURFACES groups) and the rifle mesh (RIFLE_SURFACES groups). */
  readonly body: THREE.Mesh;
  readonly rifle: THREE.Group;
  readonly rifleBody: THREE.Mesh;
  /** Draws per pass (groups over both meshes) and triangles. */
  readonly stats: { draws: number; triangles: number };
}

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

export function createSlabPet(o: SlabPetOptions): SlabPetAvatar {
  const species = clamp01(o.species), team = clamp01(o.team);
  const { key, layout } = acquireLayout(species, team);
  const rifleAsset = acquireRifle();
  const root = new THREE.Group();
  root.name = 'slab_pet';
  root.userData.placeholder = true; // pet_model.gd: root.set_meta("placeholder", true) (PARITY F14: PLACEHOLDER PETS)
  const model = new THREE.Group();
  model.name = 'Model';
  root.add(model);
  const body = new THREE.Mesh(layout.geometry, PET_SURFACES.map((s) => petMaterial(s, species, team)));
  body.name = 'Body';
  body.userData.petSurfaces = PET_SURFACES;
  body.castShadow = true;
  model.add(body);
  // pet.gd: the rifle on the model at its mount, pitched with the aim; rifle.gd: the rifle model, its muzzle marker
  const rifle = new THREE.Group();
  rifle.name = 'Rifle';
  rifle.position.fromArray([...RIFLE_MOUNT[species]]);
  model.add(rifle);
  const rifleBody = new THREE.Mesh(rifleAsset.geometry, RIFLE_SURFACES.map((s) => petMaterial(s, species, team)));
  rifleBody.name = 'RifleModel';
  rifleBody.userData.petSurfaces = RIFLE_SURFACES;
  rifleBody.userData.rifle = true;
  rifleBody.castShadow = true;
  rifle.add(rifleBody);
  const muzzle = new THREE.Object3D();
  muzzle.name = 'Muzzle';
  muzzle.position.copy(rifleAsset.muzzle);
  rifleBody.add(muzzle);
  let disposed = false;
  return {
    root, model, body, rifle, rifleBody, species, team,
    // the head's top (nameplates); the corgi's ears and the cat's tail rise above it
    height: layout.parts.head.max.y,
    stats: { draws: body.geometry.groups.length + rifleBody.geometry.groups.length, triangles: tris(body.geometry) + tris(rifleBody.geometry) },
    update(f: AvatarFrame) {
      // pet.gd set_facing: model.rotation.y = yaw (the aim; EntityViews turns the root to its body yaw), rifle.rotation.x =
      // clamp(aim_pitch); die(): model.visible = false, respawn(): true
      model.rotation.y = f.aimYawOffset;
      rifle.rotation.x = Math.max(-AIM_PITCH_MAX, Math.min(AIM_PITCH_MAX, f.aimPitch));
      model.visible = !f.dead;
    },
    trigger(action: string) {
      if (action === 'death') model.visible = false;
      else if (action === 'spawn') model.visible = true;
    },
    muzzleWorld(target: THREE.Vector3) {
      muzzle.updateWorldMatrix(true, false);
      return muzzle.getWorldPosition(target);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseLayout(key);
      releaseRifle();
    },
  };
}

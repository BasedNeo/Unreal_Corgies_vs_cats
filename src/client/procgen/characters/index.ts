// OWNER: L1 characters lane (C3 added looks). Procedural corgi + cat characters: one parameterized anthropomorphic
// body plan, a shared 47-bone skeleton, automatic skin weights, a face rig with expressions, team armor + class kit,
// and code-authored animation (src/client/anim).
//
// Draw calls per character: 1 skinned body (fur + face + gear, vertex colors) + 1 rigid weapon
// (+ its crease ink) + 1 weapon glow (+ 1 skinned kit glow for Overwatch: monocle + mast beacon)
// (+ 1 skinned neckwear with a C3 look) ≤ 6.
// Geometry is cached and shared: a kit (rig template, weapon, glow parts) per (species, breed, class, team, tier), and
// under it a body (fur + gear) per (coat paint, team collar or not). Every avatar gets its own skeleton and animator.
// Seeds drive the breed (body shape), per-instance proportions (bone scales), blink timing, idle moods and ear
// twitches, so two bots with the same kit still look and act differently. Without a look the seed also picks the
// coat; with a look (C3, `look` option or setLook) the look's coat repaints the fur and its neckwear replaces the
// team collar. Looks never change the breed, the rig or the class gear.
import * as THREE from 'three/webgpu';
import type { Avatar, AvatarFrame, AvatarOptions } from '../../views/avatar';
import { toon, glow, addCreaseInk } from '../../style/style-webgpu.js';
import { PALETTE } from '../../style/style-tokens.js';
import { releaseObject3D } from '../../engine/release';
import { Species, type ClassId, type SpeciesId, type TeamId } from '../../../shared/types';
import { mulberry32 } from '../../../shared/rng';
import { resolveLook, type Look } from '../../../shared/content/cosmetics';
import { RigInstance, type RigTemplate } from '../../anim/rig';
import { CharacterAnimator } from '../../anim/character-animator';
import type { Expression } from '../../anim/face';
import { MeshBuilder, ellipsoid } from './mesh-builder';
import { buildBody, faceInfo } from './body';
import { buildGear, monoclePos, mastPath } from './gear';
import { buildWeapon, type WeaponGeo } from './weapons';
import { buildRigTemplate } from './skeleton';
import { breedOfCoat, coatsFor, planForBreed, type BodyPlan, type Breed, type Coat } from './species';
import { lookCoat } from '../cosmetics/coats';
import { acquireNeckwear, isNeckwearId, releaseNeckwear, type NeckwearAsset, type NeckwearId } from '../cosmetics/neckwear';

export const HERO_TRI_BUDGET = 6000;
export const NPC_TRI_BUDGET = 3500;
/**
 * Segment-count multipliers per tier (tuned so every species × class fits its budget). The face
 * (cranium, cheeks, muzzle, lids) and headgear get their own, higher hero multiplier: close-ups show
 * polygon edges in the toon bands there first, while the body reads the same at 0.86.
 */
export const DETAIL = { hero: 0.86, npc: 0.66 } as const;
export const FACE_DETAIL = { hero: 1.12, npc: 0.66 } as const;
/** Bump when existing seeds change appearance (seeds are save data). */
export const CHARACTER_VERSION = 1;

/** Rig, weapon and glow parts: everything a look never changes. */
interface KitAsset {
  key: string;
  /** Species + breed + class build: what the neckwear is fitted to (shared across teams and tiers). */
  planKey: string;
  template: RigTemplate;
  boneInverses: THREE.Matrix4[];
  weapon: WeaponGeo;
  weaponInk: THREE.Object3D | null;
  /** Skinned glow parts on the shared skeleton (Overwatch monocle lens + mast beacon). */
  kitGlow: THREE.BufferGeometry | null;
  kitTriangles: number;
  plan: BodyPlan;
  cls: ClassId;
  team: TeamId;
  hero: boolean;
  headTop: number;
  snoutTip: [number, number, number];
  bodies: Map<string, BodyAsset>;
  refs: number;
}

/** Fur + face + team gear for one coat paint, with or without the team collar (a neckwear replaces it). */
interface BodyAsset {
  key: string;
  kit: KitAsset;
  coat: Coat;
  collar: boolean;
  geometry: THREE.BufferGeometry;
  triangles: number;
  refs: number;
}

const kits = new Map<string, KitAsset>();

export interface CharacterStats {
  key: string;
  variant: string;
  triangles: number;
  drawCalls: number;
  bones: number;
  snoutTip: [number, number, number];
  version: number;
  /** The look being worn (every slot resolved), or null for the seeded classic look (no look applied). */
  look: Required<Look> | null;
}

/** createAvatar options plus an optional look (C3). null / absent = the seeded classic look. */
export type CharacterOptions = AvatarOptions & { look?: Look | null };

/** Avatar plus lab/test extras (not part of the shared contract). */
export interface CharacterAvatar extends Avatar {
  animator: CharacterAnimator;
  stats: CharacterStats;
  /** The body mesh (a getter: a coat change swaps in a new mesh on the same skeleton). */
  readonly skinned: THREE.SkinnedMesh;
  setExpression(e: Expression | null): void;
  /**
   * Wear a look (C3): repaint the coat, swap the neckwear, in place (same skeleton, animator and weapon).
   * Idempotent; what it replaces is released (renderer 'dispose' + cache refs). Unknown or wrong-species ids fall back
   * to the species default; null restores the seeded classic look. Returns whether anything changed.
   */
  setLook(look: Look | null | undefined): boolean;
}

/** Variant (coat / breed) chosen from the seed. */
export function variantFor(species: SpeciesId, seed: number): Coat {
  const coats = coatsFor(species);
  const r = mulberry32((seed >>> 0) ^ 0x9e3779b9)();
  return coats[Math.floor(r * coats.length) % coats.length];
}

/** Body shape family chosen from the seed (a look never changes it). */
export function breedFor(species: SpeciesId, seed: number): Breed {
  return breedOfCoat(species, variantFor(species, seed));
}

function getKit(species: SpeciesId, breed: Breed, cls: ClassId, team: TeamId, hero: boolean): KitAsset {
  const key = `${species}:${breed}:${cls}:${team}:${hero ? 'hero' : 'npc'}:v${CHARACTER_VERSION}`;
  let a = kits.get(key);
  if (a) { a.refs++; return a; }
  const q = hero ? DETAIL.hero : DETAIL.npc;
  const plan = planForBreed(species, breed, cls);
  const template = buildRigTemplate(plan);
  const weapon = buildWeapon(cls, team, q);
  // Crease ink for the rigid weapon, made once by the style system and cloned per instance.
  let weaponInk: THREE.Object3D | null = null;
  {
    const tmp = new THREE.Mesh(weapon.geometry, toon({ color: 0xffffff, vertexColors: true }));
    weaponInk = addCreaseInk(tmp, { thresholdDeg: 40 }) as THREE.Object3D | null;
    if (weaponInk) tmp.remove(weaponInk);
  }
  let kitGlow: THREE.BufferGeometry | null = null;
  if (cls === 'overwatch') {
    const g = new MeshBuilder(template);
    if (hero) g.add(ellipsoid(monoclePos(plan), [0.03, 0.03, 0.008], 10, 4), 0, { rigid: 'head' });
    const tip = mastPath(plan)[3];
    g.add(ellipsoid([tip[0], tip[1] + 0.03, tip[2]], [0.036, 0.036, 0.036], hero ? 8 : 6, hero ? 6 : 4), 0, { rigid: 'chest' });
    kitGlow = g.build();
  }
  const boneInverses = RigInstance.bindMatrices(template).map((m) => m.invert());
  const face = faceInfo(plan);
  const kitTriangles = weapon.triangles + (kitGlow ? (kitGlow.index!.count / 3) : 0);
  a = { key, planKey: `${species}:${breed}:${cls}`, template, boneInverses, weapon, weaponInk, kitGlow, kitTriangles, plan, cls, team, hero, headTop: face.headTop, snoutTip: face.snoutTip, bodies: new Map(), refs: 1 };
  kits.set(key, a);
  return a;
}

function releaseKit(a: KitAsset): void {
  if (--a.refs > 0) return;
  kits.delete(a.key);
  for (const b of a.bodies.values()) b.geometry.dispose(); // defensive: every body ref is released first
  a.bodies.clear();
  a.weapon.geometry.dispose();
  a.weapon.glow?.dispose();
  a.kitGlow?.dispose();
  if (a.weaponInk) {
    const ink = a.weaponInk as THREE.Mesh;
    ink.geometry?.dispose();
    (ink.material as THREE.Material | undefined)?.dispose();
  }
}

function getBody(kit: KitAsset, coat: Coat, collar: boolean): BodyAsset {
  const key = `${coat.name}:${collar ? 'collar' : 'bare'}`;
  let b = kit.bodies.get(key);
  if (b) { b.refs++; return b; }
  const q = kit.hero ? DETAIL.hero : DETAIL.npc;
  const qf = kit.hero ? FACE_DETAIL.hero : FACE_DETAIL.npc;
  const mb = new MeshBuilder(kit.template);
  buildBody(mb, kit.plan, coat, q, qf);
  buildGear(mb, kit.plan, kit.cls, kit.team, q, qf, collar);
  b = { key, kit, coat, collar, geometry: mb.build(), triangles: mb.triangles, refs: 1 };
  kit.bodies.set(key, b);
  return b;
}

function releaseBody(b: BodyAsset): void {
  if (--b.refs > 0) return;
  b.kit.bodies.delete(b.key);
  b.geometry.dispose();
}

/** What an avatar wears: coat paint, team collar or a neckwear, and the resolved look (null = seeded classic). */
interface Paint { coat: Coat; collar: boolean; neck: NeckwearId | null; look: Required<Look> | null }

function paintFor(species: SpeciesId, seeded: Coat, look: Look | null | undefined): Paint {
  if (look === null || look === undefined) return { coat: seeded, collar: true, neck: null, look: null };
  const r = resolveLook(look, species);
  const neck = isNeckwearId(r.neck) ? r.neck : null;
  return { coat: lookCoat(r.coat) ?? seeded, collar: neck === null, neck, look: r };
}

interface Pinned { kit: KitAsset; body: BodyAsset; neck: NeckwearAsset | null }
const pinned: Pinned[] = [];

/**
 * Build and pin the shared geometry for kits that will appear soon (e.g. during match loading),
 * so the first spawn of each kit does not pay the ~20 ms build. Pinned kits stay cached until
 * `releasePrewarmedCharacters()`. Pass the roster's looks so the right coats and neckwear are built.
 */
export function prewarmCharacters(list: (Omit<AvatarOptions, 'isLocal'> & { isLocal?: boolean; look?: Look | null })[]): void {
  for (const k of list) {
    const seeded = variantFor(k.species, k.seed >>> 0);
    const kit = getKit(k.species, breedOfCoat(k.species, seeded), k.cls, k.team, !!k.isLocal);
    const p = paintFor(k.species, seeded, k.look);
    pinned.push({ kit, body: getBody(kit, p.coat, p.collar), neck: p.neck ? acquireNeckwear(p.neck, kit.plan, kit.planKey, kit.cls) : null });
  }
}

export function releasePrewarmedCharacters(): void {
  for (const p of pinned.splice(0)) {
    if (p.neck) releaseNeckwear(p.neck);
    releaseBody(p.body);
    releaseKit(p.kit);
  }
}

/** Number of live cached character bodies (one per species, breed, coat, collar, class, team, tier; leak tests). */
export function characterCacheSize(): number {
  let n = 0;
  for (const k of kits.values()) n += k.bodies.size;
  return n;
}

/** Live cached kits (rig + weapon) and bodies (fur + gear variants). */
export function characterCacheStats(): { kits: number; bodies: number } {
  return { kits: kits.size, bodies: characterCacheSize() };
}

const IDENTITY = new THREE.Matrix4();

export function createCharacter(o: CharacterOptions): CharacterAvatar {
  const seed = o.seed >>> 0;
  const seeded = variantFor(o.species, seed);
  const kit = getKit(o.species, breedOfCoat(o.species, seeded), o.cls, o.team, o.isLocal);
  let paint = paintFor(o.species, seeded, o.look);
  let body = getBody(kit, paint.coat, paint.collar);
  const rng = mulberry32(seed ^ 0x51ed);
  const rig = new RigInstance(kit.template);
  const bodyMat = toon({ color: 0xffffff, vertexColors: true });
  // Generous static bounds: poses (zoomies, death flop, flips) leave the bind-pose box.
  const sphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 1.7);
  const box = new THREE.Box3(new THREE.Vector3(-1.2, -0.2, -1.2), new THREE.Vector3(1.2, 1.9, 1.2));
  const bodyMesh = (g: THREE.BufferGeometry): THREE.SkinnedMesh => {
    const m = new THREE.SkinnedMesh(g, bodyMat);
    m.name = 'character_body';
    m.boundingSphere = sphere;
    m.boundingBox = box;
    m.castShadow = true;
    return m;
  };
  let skinned = bodyMesh(body.geometry);
  skinned.add(rig.root);
  skinned.bind(new THREE.Skeleton(rig.bones, kit.boneInverses), IDENTITY);
  const skeleton = skinned.skeleton;
  const root = new THREE.Group();
  const speciesName = o.species === Species.Cat ? 'cat' : 'corgi';
  root.add(skinned);

  // Per-instance proportions (seeded bone scales; geometry stays shared).
  const bi = kit.template.index;
  const setScale = (name: string, x: number, y = x, z = x) => { const i = bi[name] * 3; rig.baseScale[i] = x; rig.baseScale[i + 1] = y; rig.baseScale[i + 2] = z; };
  const jit = (a: number) => 1 + (rng() * 2 - 1) * a;
  const bodyScale = jit(0.04);
  setScale('head', jit(0.05));
  const earS = jit(0.1);
  setScale('ear1.L', 1, earS, 1); setScale('ear1.R', 1, earS, 1);
  setScale('tail1', jit(0.1));
  setScale('butt', jit(0.08));

  // Weapon (rigid, crease-inked) + glow parts.
  let fixedDraws = 1; // weapon
  const weaponBone = rig.bones[bi.weapon];
  const weapon = new THREE.Mesh(kit.weapon.geometry, bodyMat);
  weapon.name = `weapon_${kit.weapon.id}`;
  weapon.castShadow = true;
  weaponBone.add(weapon);
  if (kit.weaponInk) { weapon.add(kit.weaponInk.clone()); fixedDraws++; }
  if (kit.weapon.glow) {
    const g = new THREE.Mesh(kit.weapon.glow, glow(kit.weapon.glowColor, 2.6));
    g.name = 'weapon_glow';
    weapon.add(g);
    fixedDraws++;
  }
  if (kit.kitGlow) {
    // Shares the body's skeleton: one draw for glow parts riding different bones.
    const g = new THREE.SkinnedMesh(kit.kitGlow, glow(PALETTE.laserRed, 2.2));
    g.name = 'kit_glow';
    g.bind(skeleton, IDENTITY);
    g.boundingSphere = sphere;
    g.boundingBox = box;
    root.add(g);
    fixedDraws++;
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.fromArray(kit.weapon.muzzle);
  weapon.add(muzzle);

  // Neckwear (C3): one skinned mesh on the body skeleton, sharing the body material.
  let neck: { asset: NeckwearAsset; mesh: THREE.SkinnedMesh } | null = null;
  const setNeck = (id: NeckwearId | null) => {
    if ((neck?.asset.id ?? null) === id) return;
    if (neck) {
      root.remove(neck.mesh);
      releaseObject3D(neck.mesh);
      releaseNeckwear(neck.asset);
      neck = null;
    }
    if (!id) return;
    const asset = acquireNeckwear(id, kit.plan, kit.planKey, kit.cls);
    const mesh = new THREE.SkinnedMesh(asset.geometry, bodyMat);
    mesh.name = 'neckwear';
    mesh.bind(skeleton, IDENTITY);
    mesh.boundingSphere = sphere;
    mesh.boundingBox = box;
    mesh.castShadow = true;
    root.add(mesh);
    neck = { asset, mesh };
  };
  setNeck(paint.neck);

  const animator = new CharacterAnimator(rig, {
    species: kit.plan.species,
    quadruped: kit.plan.species === 'corgi',
    seed,
    leftGrip: kit.weapon.leftGrip,
    muzzle: kit.weapon.muzzle,
    handReach: kit.plan.handR * 0.75,
    backZ: 0.3,
  });
  animator.yawSource = root;
  animator.bodyScale = bodyScale;

  const headTop = kit.headTop;
  const headY = kit.plan.headY;
  const height = (headY + (headTop - headY) * rig.baseScale[bi.head * 3]) * bodyScale;
  const stats: CharacterStats = {
    key: '', variant: '', triangles: 0, drawCalls: 0, bones: kit.template.names.length,
    snoutTip: kit.snoutTip, version: CHARACTER_VERSION, look: null,
  };
  const refresh = () => {
    stats.key = `${kit.key}:${body.key}${neck ? ':' + neck.asset.id : ''}`;
    stats.variant = body.coat.name;
    stats.triangles = body.triangles + kit.kitTriangles + (neck ? neck.asset.triangles : 0);
    stats.drawCalls = 1 + fixedDraws + (neck ? 1 : 0);
    stats.look = paint.look;
    root.name = `character_${speciesName}_${body.coat.name}_${o.cls}`;
  };
  refresh();
  root.userData.character = stats;

  /** Swap the body for another paint / collar variant: new mesh on the same skeleton, the old one released. */
  const setBody = (coat: Coat, collar: boolean) => {
    const next = getBody(kit, coat, collar);
    if (next === body) { releaseBody(next); return false; }
    const old = skinned;
    const mesh = bodyMesh(next.geometry);
    mesh.add(rig.root); // re-parents the bone tree (weapon included) before the old mesh is released
    mesh.bind(skeleton, IDENTITY);
    root.remove(old);
    releaseObject3D(old);
    root.add(mesh);
    root.children.unshift(root.children.pop()!); // the body stays the first child
    releaseBody(body);
    skinned = mesh;
    body = next;
    return true;
  };

  // Settle into the idle pose immediately so the first rendered frame is never the bind pose.
  const idleFrame: AvatarFrame = { speed: 0, vy: 0, grounded: true, anim: 0, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false };
  animator.update(idleFrame, 1 / 60);

  let disposed = false;
  return {
    root,
    height,
    animator,
    stats,
    get skinned() { return skinned; },
    update(frame: AvatarFrame, dt: number) { animator.update(frame, dt); },
    trigger(action: string, strength?: number) { animator.trigger(action, strength); },
    muzzleWorld(target: THREE.Vector3) {
      muzzle.updateWorldMatrix(true, false);
      return muzzle.getWorldPosition(target);
    },
    setExpression(e) { animator.setExpression(e); },
    setLook(look) {
      if (disposed) return false;
      const next = paintFor(o.species, seeded, look);
      const bodyChanged = setBody(next.coat, next.collar);
      const neckChanged = (neck?.asset.id ?? null) !== next.neck;
      setNeck(next.neck);
      const lookChanged = JSON.stringify(paint.look) !== JSON.stringify(next.look);
      paint = next;
      refresh();
      return bodyChanged || neckChanged || lookChanged;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      skeleton.dispose();
      if (neck) releaseNeckwear(neck.asset);
      releaseBody(body);
      releaseKit(kit);
    },
  };
}

export function createAvatar(o: AvatarOptions): Avatar {
  return createCharacter(o);
}

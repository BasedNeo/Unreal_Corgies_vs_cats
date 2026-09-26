// OWNER: L1 characters lane. Procedural corgi + cat characters: one parameterized anthropomorphic
// body plan, a shared 45-bone skeleton, automatic skin weights, a face rig with expressions, team
// armor + class kit, and code-authored animation (src/client/anim).
//
// Draw calls per character: 1 skinned body (fur + face + gear, vertex colors) + 1 rigid weapon
// (+ its crease ink) + 1 weapon glow (+ 1 visor glow for Overwatch) ≤ 5.
// Geometry is cached per (species, variant, class, team, tier) and shared; every avatar gets its own
// skeleton and animator. Seeds also drive per-instance proportions (bone scales), blink timing,
// idle moods and ear twitches, so two bots with the same kit still look and act differently.
import * as THREE from 'three/webgpu';
import type { Avatar, AvatarFrame, AvatarOptions } from '../../views/avatar';
import { toon, glow, addCreaseInk } from '../../style/style-webgpu.js';
import { PALETTE } from '../../style/style-tokens.js';
import { Species, type ClassId, type SpeciesId, type TeamId } from '../../../shared/types';
import { mulberry32 } from '../../../shared/rng';
import { RigInstance, type RigTemplate } from '../../anim/rig';
import { CharacterAnimator } from '../../anim/character-animator';
import type { Expression } from '../../anim/face';
import { MeshBuilder, ellipsoid } from './mesh-builder';
import { buildBody } from './body';
import { buildGear, monoclePos } from './gear';
import { buildWeapon, type WeaponGeo } from './weapons';
import { buildRigTemplate, computeJoints } from './skeleton';
import { coatsFor, planFor, type BodyPlan, type Coat } from './species';

export const HERO_TRI_BUDGET = 6000;
export const NPC_TRI_BUDGET = 3500;
/** Segment-count multipliers per tier (tuned so every species × class fits its budget). */
export const DETAIL = { hero: 0.93, npc: 0.66 } as const;
/** Bump when existing seeds change appearance (seeds are save data). */
export const CHARACTER_VERSION = 1;

interface CharacterAsset {
  key: string;
  template: RigTemplate;
  boneInverses: THREE.Matrix4[];
  body: THREE.BufferGeometry;
  weapon: WeaponGeo;
  weaponInk: THREE.Object3D | null;
  visorGlow: THREE.BufferGeometry | null;
  plan: BodyPlan;
  coat: Coat;
  headTop: number;
  snoutTip: [number, number, number];
  triangles: number;
  refs: number;
}

const cache = new Map<string, CharacterAsset>();

export interface CharacterStats {
  key: string;
  variant: string;
  triangles: number;
  drawCalls: number;
  bones: number;
  snoutTip: [number, number, number];
  version: number;
}

/** Avatar plus lab/test extras (not part of the shared contract). */
export interface CharacterAvatar extends Avatar {
  animator: CharacterAnimator;
  stats: CharacterStats;
  skinned: THREE.SkinnedMesh;
  setExpression(e: Expression | null): void;
}

/** Variant (coat / breed) chosen from the seed. */
export function variantFor(species: SpeciesId, seed: number): Coat {
  const coats = coatsFor(species);
  const r = mulberry32((seed >>> 0) ^ 0x9e3779b9)();
  return coats[Math.floor(r * coats.length) % coats.length];
}

function getAsset(species: SpeciesId, coat: Coat, cls: ClassId, team: TeamId, hero: boolean): CharacterAsset {
  const key = `${species}:${coat.name}:${cls}:${team}:${hero ? 'hero' : 'npc'}:v${CHARACTER_VERSION}`;
  let a = cache.get(key);
  if (a) { a.refs++; return a; }
  const q = hero ? DETAIL.hero : DETAIL.npc;
  const plan = planFor(species, coat);
  const template = buildRigTemplate(plan);
  const mb = new MeshBuilder(template);
  const face = buildBody(mb, plan, coat, q);
  buildGear(mb, plan, cls, team, q);
  const body = mb.build();
  const weapon = buildWeapon(cls, team, q);
  // Crease ink for the rigid weapon, made once by the style system and cloned per instance.
  let weaponInk: THREE.Object3D | null = null;
  {
    const tmp = new THREE.Mesh(weapon.geometry, toon({ color: 0xffffff, vertexColors: true }));
    weaponInk = addCreaseInk(tmp, { thresholdDeg: 40 }) as THREE.Object3D | null;
    if (weaponInk) tmp.remove(weaponInk);
  }
  let visorGlow: THREE.BufferGeometry | null = null;
  if (cls === 'overwatch') {
    const j = computeJoints(plan);
    const m = monoclePos(plan);
    const g = new MeshBuilder(null);
    g.add(ellipsoid([m[0] - j.head[0], m[1] - j.head[1], m[2] - j.head[2]], [0.03, 0.03, 0.008], 10, 4), 0);
    visorGlow = g.build();
  }
  const boneInverses = RigInstance.bindMatrices(template).map((m) => m.invert());
  const triangles = mb.triangles + weapon.triangles + (visorGlow ? (visorGlow.index!.count / 3) : 0);
  a = { key, template, boneInverses, body, weapon, weaponInk, visorGlow, plan, coat, headTop: face.headTop, snoutTip: face.snoutTip, triangles, refs: 1 };
  cache.set(key, a);
  return a;
}

function releaseAsset(a: CharacterAsset): void {
  if (--a.refs > 0) return;
  cache.delete(a.key);
  a.body.dispose();
  a.weapon.geometry.dispose();
  a.weapon.glow?.dispose();
  a.visorGlow?.dispose();
  if (a.weaponInk) {
    const ink = a.weaponInk as THREE.Mesh;
    ink.geometry?.dispose();
    (ink.material as THREE.Material | undefined)?.dispose();
  }
}

const pinned: CharacterAsset[] = [];

/**
 * Build and pin the shared geometry for kits that will appear soon (e.g. during match loading),
 * so the first spawn of each kit does not pay the ~20 ms build. Pinned kits stay cached until
 * `releasePrewarmedCharacters()`.
 */
export function prewarmCharacters(kits: (Omit<AvatarOptions, 'isLocal'> & { isLocal?: boolean })[]): void {
  for (const k of kits) pinned.push(getAsset(k.species, variantFor(k.species, k.seed >>> 0), k.cls, k.team, !!k.isLocal));
}

export function releasePrewarmedCharacters(): void {
  for (const a of pinned.splice(0)) releaseAsset(a);
}

/** Number of live cached character assets (for leak tests). */
export function characterCacheSize(): number { return cache.size; }

export function createCharacter(o: AvatarOptions): CharacterAvatar {
  const seed = o.seed >>> 0;
  const coat = variantFor(o.species, seed);
  const asset = getAsset(o.species, coat, o.cls, o.team, o.isLocal);
  const rng = mulberry32(seed ^ 0x51ed);
  const rig = new RigInstance(asset.template);
  const bodyMat = toon({ color: 0xffffff, vertexColors: true });
  const skinned = new THREE.SkinnedMesh(asset.body, bodyMat);
  skinned.name = 'character_body';
  skinned.add(rig.root);
  skinned.bind(new THREE.Skeleton(rig.bones, asset.boneInverses), new THREE.Matrix4());
  // Generous static bounds: poses (zoomies, death flop, flips) leave the bind-pose box.
  skinned.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 1.7);
  skinned.boundingBox = new THREE.Box3(new THREE.Vector3(-1.2, -0.2, -1.2), new THREE.Vector3(1.2, 1.9, 1.2));
  skinned.castShadow = true;
  let drawCalls = 1;

  // Per-instance proportions (seeded bone scales; geometry stays shared).
  const bi = asset.template.index;
  const setScale = (name: string, x: number, y = x, z = x) => { const i = bi[name] * 3; rig.baseScale[i] = x; rig.baseScale[i + 1] = y; rig.baseScale[i + 2] = z; };
  const jit = (a: number) => 1 + (rng() * 2 - 1) * a;
  const bodyScale = jit(0.04);
  setScale('head', jit(0.05));
  const earS = jit(0.1);
  setScale('ear1.L', 1, earS, 1); setScale('ear1.R', 1, earS, 1);
  setScale('tail1', jit(0.1));
  setScale('butt', jit(0.08));

  // Weapon (rigid, crease-inked) + glow parts.
  const weaponBone = rig.bones[bi.weapon];
  const weapon = new THREE.Mesh(asset.weapon.geometry, bodyMat);
  weapon.name = `weapon_${asset.weapon.id}`;
  weapon.castShadow = true;
  weaponBone.add(weapon);
  drawCalls++;
  if (asset.weaponInk) { weapon.add(asset.weaponInk.clone()); drawCalls++; }
  if (asset.weapon.glow) {
    const g = new THREE.Mesh(asset.weapon.glow, glow(asset.weapon.glowColor, 2.6));
    g.name = 'weapon_glow';
    weapon.add(g);
    drawCalls++;
  }
  if (asset.visorGlow) {
    const g = new THREE.Mesh(asset.visorGlow, glow(PALETTE.laserRed, 2.2));
    g.name = 'visor_glow';
    rig.bones[bi.head].add(g);
    drawCalls++;
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.fromArray(asset.weapon.muzzle);
  weapon.add(muzzle);

  const root = new THREE.Group();
  root.name = `character_${o.species === Species.Cat ? 'cat' : 'corgi'}_${coat.name}_${o.cls}`;
  root.add(skinned);

  const animator = new CharacterAnimator(rig, {
    species: asset.plan.species,
    quadruped: asset.plan.species === 'corgi',
    seed,
    leftGrip: asset.weapon.leftGrip,
    muzzle: asset.weapon.muzzle,
    handReach: asset.plan.handR * 0.75,
    backZ: 0.3,
  });
  animator.yawSource = root;
  animator.bodyScale = bodyScale;

  const headTop = asset.headTop;
  const headY = asset.plan.headY;
  const height = (headY + (headTop - headY) * rig.baseScale[bi.head * 3]) * bodyScale;
  const stats: CharacterStats = {
    key: asset.key, variant: coat.name, triangles: asset.triangles, drawCalls, bones: asset.template.names.length,
    snoutTip: asset.snoutTip, version: CHARACTER_VERSION,
  };
  root.userData.character = stats;

  // Settle into the idle pose immediately so the first rendered frame is never the bind pose.
  const idleFrame: AvatarFrame = { speed: 0, vy: 0, grounded: true, anim: 0, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false };
  animator.update(idleFrame, 1 / 60);

  let disposed = false;
  return {
    root,
    height,
    animator,
    stats,
    skinned,
    update(frame: AvatarFrame, dt: number) { animator.update(frame, dt); },
    trigger(action: string, strength?: number) { animator.trigger(action, strength); },
    muzzleWorld(target: THREE.Vector3) {
      muzzle.updateWorldMatrix(true, false);
      return muzzle.getWorldPosition(target);
    },
    setExpression(e) { animator.setExpression(e); },
    dispose() {
      if (disposed) return;
      disposed = true;
      skinned.skeleton.dispose();
      releaseAsset(asset);
    },
  };
}

export function createAvatar(o: AvatarOptions): Avatar {
  return createCharacter(o);
}

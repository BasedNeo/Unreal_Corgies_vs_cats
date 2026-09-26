// OWNER: L1 characters lane (C3 added looks, K2 the HARDENED veterans). Procedural corgi + cat characters: one
// parameterized anthropomorphic body plan, a shared 47-bone skeleton, automatic skin weights, a face rig with
// expressions, faction armour + team signal + class kit, and code-authored animation (src/client/anim).
//
// Draw calls per character: 1 skinned body (fur + face + suit + armour, vertex colors) + 1 rigid weapon
// (+ its crease ink) + 1 weapon glow + 1 skinned team-lamp glow (helmet / visor / goggle lamps, the Overwatch
// monocle + mast beacon) (+ 1 skinned neckwear with a C3 look) ≤ 6. W7 P3 distance LOD: past
// CHARACTER_DETAIL_DISTANCE the weapon ink and glow hide and only the body casts a shadow (4 draws + 1 shadow). The
// body and weapon keep their ink hulls at every distance (`keepInk`: a whip mast or a barrel at 35 m is mostly its
// hull); the neckwear's goes by the renderer's sub-pixel rule. The tree (and stats.drawCalls) never changes.
// Geometry is cached and shared: a kit (rig template, weapon, glow parts) per (species, breed, class, team, tier), and
// under it a body (fur + gear) per (coat paint, team collar or not). Every avatar gets its own skeleton and animator.
// Seeds drive the breed (body shape), per-instance proportions (bone scales), blink timing, idle moods and ear
// twitches, so two bots with the same kit still look and act differently. Without a look the seed also picks the
// coat; with a look (C3, `look` option or setLook) the look's coat repaints the fur and its neckwear replaces the
// team collar. Looks never change the breed, the rig or the class gear. `veteran` (K2) builds the elite variant of a
// kit: heavier armour, a crest or rank badge, extra scars, and an eye patch on cats. `squad` (W9 K3, squads.ts) builds
// a PvE squad kit instead of the class gear (alley-cat raider / tabby heavy): its own build, headgear and armour on the
// same rig and draw structure; the weapon stays the class's (it is what the bot fires).
import * as THREE from 'three/webgpu';
import type { Avatar, AvatarFrame, AvatarOptions } from '../../views/avatar';
import { toon, glow, addCreaseInk } from '../../style/style-webgpu.js';
import { releaseObject3D } from '../../engine/release';
import { Species, type ClassId, type SpeciesId, type TeamId } from '../../../shared/types';
import { mulberry32 } from '../../../shared/rng';
import { resolveLook, type Look } from '../../../shared/content/cosmetics';
import { RigInstance, type RigTemplate } from '../../anim/rig';
import { CharacterAnimator } from '../../anim/character-animator';
import type { Expression } from '../../anim/face';
import { MeshBuilder } from './mesh-builder';
import { buildBody, faceInfo } from './body';
import { buildGear, buildGearGlow, dressFor, teamColors } from './gear';
import { buildSquadGear, buildSquadGlow, squadBuildClass, squadDress } from './squads';
import type { SquadKit } from '../../../sim/ai/archetypes';
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
/**
 * Bump when existing seeds change appearance (seeds are save data). v2: K2 HARDENED veterans. v3: W9 K3 (lifted field
 * suits, full-sleeve team bands, rear team strobes, veteran insignia and team thigh shells, open vest ends).
 */
export const CHARACTER_VERSION = 3;

/**
 * W7 P3 distance LOD. Beyond this camera distance (m) a character drops its small detail: the weapon's crease ink
 * (≈ 1.2 k triangles of 1.1 px lines on a gun ~25 px long), the weapon glow (sight / emitter, a pixel or two) and the
 * weapon's and neckwear's shadows. The body, the weapon, the neckwear, the team lamps, the body's shadow and the body
 * and weapon ink hulls stay, so team, class and look read the same. The neckwear's hull goes by the renderer's
 * sub-pixel rule (engine/renderer.ts ink LOD, ~19 m at a 720 px buffer). Nothing changes within 18.5 m.
 */
export const CHARACTER_DETAIL_DISTANCE = 20;
/** Half-width (m) of the band where the detail level holds, so a character at the threshold never flickers. */
export const CHARACTER_DETAIL_BAND = 1.5;

/** Detail level at `dist` m given the current one (hysteresis): true = far (detail dropped). */
export function characterFarAt(dist: number, far: boolean): boolean {
  return far ? dist > CHARACTER_DETAIL_DISTANCE - CHARACTER_DETAIL_BAND : dist > CHARACTER_DETAIL_DISTANCE + CHARACTER_DETAIL_BAND;
}
const _lodP = new THREE.Vector3(), _lodE = new THREE.Vector3();

/** Rig, weapon and glow parts: everything a look never changes. */
interface KitAsset {
  key: string;
  /** Species + breed + class build: what the neckwear is fitted to (shared across teams and tiers). */
  planKey: string;
  template: RigTemplate;
  boneInverses: THREE.Matrix4[];
  weapon: WeaponGeo;
  weaponInk: THREE.Object3D | null;
  /** Skinned team-lamp glow parts on the shared skeleton (helmet / visor / goggle lamps, Overwatch monocle + beacon). */
  kitGlow: THREE.BufferGeometry | null;
  kitTriangles: number;
  plan: BodyPlan;
  cls: ClassId;
  /** The class the body build, dress and neckwear fit follow (the squad's build for a squad kit, else `cls`). */
  gearCls: ClassId;
  team: TeamId;
  hero: boolean;
  veteran: boolean;
  /** K3 squad kit (null = the class kit). */
  squad: SquadKit | null;
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
  /** Elite / veteran variant (K2). */
  veteran: boolean;
  /** K3 PvE squad kit (null = the class kit). */
  squad: SquadKit | null;
}

/**
 * createAvatar options plus an optional look (C3; null / absent = the seeded classic look) and the elite / veteran
 * variant (K2: a scarred corgi sergeant, a one-eyed cat commander; any class).
 */
export type CharacterOptions = AvatarOptions & { look?: Look | null; veteran?: boolean; squad?: SquadKit | null };

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
  /**
   * P3 distance LOD: 'far' hides the weapon's crease ink and glow and stops the weapon and neckwear casting shadows
   * (CHARACTER_DETAIL_DISTANCE). Set automatically from the rendering camera each frame the body is drawn; tests
   * and labs may force it (the next rendered frame re-evaluates it).
   */
  detail: 'near' | 'far';
}

/** Variant (coat / breed) chosen from the seed. */
export function variantFor(species: SpeciesId, seed: number): Coat {
  const coats = coatsFor(species);
  const r = mulberry32((seed >>> 0) ^ 0x9e3779b9)();
  return coats[Math.floor(r * coats.length) % coats.length];
}

/**
 * A deterministic pick of veteran bots from the seed (K2): about one bot in `oneIn` is a sergeant / commander. No
 * network needed, every client agrees. Players' veteran status is the lead's call (e.g. a profile level via the roster).
 */
export function isVeteranSeed(seed: number, oneIn = 6): boolean {
  return mulberry32((seed >>> 0) ^ 0x7e7e7e1)() * oneIn < 1;
}

/** Body shape family chosen from the seed (a look never changes it). */
export function breedFor(species: SpeciesId, seed: number): Breed {
  return breedOfCoat(species, variantFor(species, seed));
}

function getKit(species: SpeciesId, breed: Breed, cls: ClassId, team: TeamId, hero: boolean, veteran = false, squad: SquadKit | null = null): KitAsset {
  if (squad) veteran = false; // a squad kit is its own look (no sergeant stripes on a raider)
  const key = `${species}:${breed}:${cls}:${team}:${hero ? 'hero' : 'npc'}${veteran ? ':vet' : ''}${squad ? `:sq-${squad}` : ''}:v${CHARACTER_VERSION}`;
  let a = kits.get(key);
  if (a) { a.refs++; return a; }
  const q = hero ? DETAIL.hero : DETAIL.npc;
  const gearCls = squad ? squadBuildClass(squad) : cls;
  const plan = planForBreed(species, breed, gearCls, true);
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
  {
    const g = new MeshBuilder(template);
    // Vertex colours = the lamp colour (the glow material ignores them; colour readability checks count them right).
    if (squad) buildSquadGlow(g, plan, squad, hero, teamColors(team).main);
    else buildGearGlow(g, plan, cls, hero, teamColors(team).main);
    if (g.triangles > 0) kitGlow = g.build();
  }
  const boneInverses = RigInstance.bindMatrices(template).map((m) => m.invert());
  const face = faceInfo(plan);
  const kitTriangles = weapon.triangles + (kitGlow ? (kitGlow.index!.count / 3) : 0);
  a = { key, planKey: `${species}:${breed}:${gearCls}`, template, boneInverses, weapon, weaponInk, kitGlow, kitTriangles, plan, cls, gearCls, team, hero, veteran, squad, headTop: face.headTop, snoutTip: face.snoutTip, bodies: new Map(), refs: 1 };
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
  if (kit.squad) {
    buildBody(mb, kit.plan, coat, q, qf, squadDress(kit.plan, kit.squad, kit.team));
    buildSquadGear(mb, kit.plan, kit.squad, kit.team, q, qf, collar);
  } else {
    buildBody(mb, kit.plan, coat, q, qf, dressFor(kit.plan, kit.cls, kit.team, kit.veteran));
    buildGear(mb, kit.plan, kit.cls, kit.team, q, qf, collar, { veteran: kit.veteran });
  }
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
export function prewarmCharacters(list: (Omit<AvatarOptions, 'isLocal'> & { isLocal?: boolean; look?: Look | null; veteran?: boolean; squad?: SquadKit | null })[]): void {
  for (const k of list) {
    const seeded = variantFor(k.species, k.seed >>> 0);
    const kit = getKit(k.species, breedOfCoat(k.species, seeded), k.cls, k.team, !!k.isLocal, !!k.veteran, k.squad ?? null);
    const p = paintFor(k.species, seeded, k.look);
    pinned.push({ kit, body: getBody(kit, p.coat, p.collar), neck: p.neck ? acquireNeckwear(p.neck, kit.plan, kit.planKey, kit.gearCls) : null });
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
  const kit = getKit(o.species, breedOfCoat(o.species, seeded), o.cls, o.team, o.isLocal, !!o.veteran, o.squad ?? null);
  let paint = paintFor(o.species, seeded, o.look);
  let body = getBody(kit, paint.coat, paint.collar);
  const rng = mulberry32(seed ^ 0x51ed);
  const rig = new RigInstance(kit.template);
  // HARDENED (S4 style v2): one weathered toon material for fur, suit and armour, reading per-vertex roughness / metal /
  // grime / edge wear from the `surface` attribute (MeshBuilder.surface); a light mud band at the boots. The weapon gets
  // its own weathered material from its finish (X3). Older style factories ignore these params.
  const bodyMat = toon({ color: 0xffffff, vertexColors: true, surfaceAttr: true, surface: 'fur', mud: 0.3 } as Parameters<typeof toon>[0]);
  const finish = (kit.weapon as { finish?: { metal: number; wear: number; grime: number } }).finish;
  const weaponMat = toon({ color: 0xffffff, vertexColors: true, surface: 'weapon', ...(finish ?? {}) } as Parameters<typeof toon>[0]);
  // Generous static bounds: poses (zoomies, death flop, flips) leave the bind-pose box.
  const sphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 1.7);
  const box = new THREE.Box3(new THREE.Vector3(-1.2, -0.2, -1.2), new THREE.Vector3(1.2, 1.9, 1.2));
  // P3: the body picks the detail level from the camera that draws it (main pass only: the sun's shadow camera is
  // orthographic). A culled body keeps its last level, which is fine: its detail is off-screen too.
  const lodHook = (_r: unknown, scene: THREE.Scene, camera: THREE.Camera) => {
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera || scene.overrideMaterial) return;
    const d = _lodP.setFromMatrixPosition(root.matrixWorld).distanceTo(_lodE.setFromMatrixPosition(camera.matrixWorld));
    const next = characterFarAt(d, far);
    if (next !== far) { far = next; applyDetail(); }
  };
  const bodyMesh = (g: THREE.BufferGeometry): THREE.SkinnedMesh => {
    const m = new THREE.SkinnedMesh(g, bodyMat);
    m.name = 'character_body';
    m.boundingSphere = sphere;
    m.boundingBox = box;
    m.castShadow = true;
    m.userData.keepInk = true;         // P3: the renderer's ink LOD keeps this hull at range (masts, ears, tails)
    m.onBeforeRender = lodHook as unknown as THREE.Object3D['onBeforeRender'];
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
  const weapon = new THREE.Mesh(kit.weapon.geometry, weaponMat);
  weapon.name = `weapon_${kit.weapon.id}`;
  weapon.castShadow = true;
  weapon.userData.keepInk = true;      // P3: a barrel at range is mostly its hull (the class read, like the body)
  weaponBone.add(weapon);
  let weaponInk: THREE.Object3D | null = null, weaponGlow: THREE.Mesh | null = null;
  if (kit.weaponInk) { weaponInk = kit.weaponInk.clone(); weapon.add(weaponInk); fixedDraws++; }
  if (kit.weapon.glow) {
    const g = new THREE.Mesh(kit.weapon.glow, glow(kit.weapon.glowColor, 2.6));
    g.name = 'weapon_glow';
    weapon.add(g);
    weaponGlow = g;
    fixedDraws++;
  }
  if (kit.kitGlow) {
    // Team lamps: share the body's skeleton, one draw for glow parts riding different bones.
    const g = new THREE.SkinnedMesh(kit.kitGlow, glow(teamColors(kit.team).main, 2.2));
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
    const asset = acquireNeckwear(id, kit.plan, kit.planKey, kit.gearCls);
    const mesh = new THREE.SkinnedMesh(asset.geometry, bodyMat);
    mesh.name = 'neckwear';
    mesh.bind(skeleton, IDENTITY);
    mesh.boundingSphere = sphere;
    mesh.boundingBox = box;
    mesh.castShadow = !far;
    root.add(mesh);
    neck = { asset, mesh };
  };
  // P3 distance LOD (CHARACTER_DETAIL_DISTANCE): the small detail a far character drops.
  let far = false;
  const applyDetail = () => {
    if (weaponInk) weaponInk.visible = !far;
    if (weaponGlow) weaponGlow.visible = !far;
    weapon.castShadow = !far;
    if (neck) neck.mesh.castShadow = !far;
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
    snoutTip: kit.snoutTip, version: CHARACTER_VERSION, look: null, veteran: kit.veteran, squad: kit.squad,
  };
  const refresh = () => {
    stats.key = `${kit.key}:${body.key}${neck ? ':' + neck.asset.id : ''}`;
    stats.variant = body.coat.name;
    stats.triangles = body.triangles + kit.kitTriangles + (neck ? neck.asset.triangles : 0);
    stats.drawCalls = 1 + fixedDraws + (neck ? 1 : 0);
    stats.look = paint.look;
    root.name = `character_${speciesName}_${body.coat.name}_${o.cls}${kit.squad ? `_${kit.squad}` : ''}`;
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
    get detail() { return far ? 'far' : 'near'; },
    set detail(d) { const next = d === 'far'; if (next !== far) { far = next; applyDetail(); } },
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

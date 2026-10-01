// "Mower Kart": a toy ride-on lawnmower go-kart (original design). Round mower deck skirt, chunky
// wheels (big rears, small fronts), a cheeky headlight-eyed hood, bucket seat with team ears on the
// headrest, a grass-catcher bag, an exhaust stack and a tall team pennant for readability at range.
// Kart space: +Y up, forward = -Z, the wheels' ground point at y = 0 (matches the sim's ground point).
//
// Draw calls per kart: body (vertex-colored toon) + crease ink + 4 wheels (one InstancedMesh)
// + boost flame (glow, only while boosting) = 4. Geometry is built once per team and shared.
import * as THREE from 'three/webgpu';
import { PALETTE } from '../style/style-tokens.js';
import { Team, type TeamId } from '../../shared/types';
import { PartBuilder, at, rbox, box, cyl, cone, torus } from './parts';

export interface KartPalette {
  body: number; trim: number; accent: number; seat: number; dark: number; metal: number; bag: number;
  tire: number; hub: number; bolt: number; eye: number; ear: number; earInner: number;
}

export const KART_PALETTES: Record<0 | 1, KartPalette> = {
  [Team.Corgis]: {
    body: PALETTE.teamCorgis, trim: PALETTE.teamCorgisTrim, accent: PALETTE.teamCorgisTrim, seat: PALETTE.corgiCream,
    dark: PALETTE.corgiTri, metal: PALETTE.concrete, bag: PALETTE.grassDry, tire: PALETTE.catBlack,
    hub: PALETTE.teamCorgisTrim, bolt: PALETTE.corgiTri, eye: PALETTE.hullLight, ear: PALETTE.corgiOrange, earInner: PALETTE.corgiCream,
  },
  [Team.Cats]: {
    body: PALETTE.teamCats, trim: PALETTE.teamCatsTrim, accent: PALETTE.catWhite, seat: PALETTE.catSiamese,
    dark: PALETTE.catBlack, metal: PALETTE.concrete, bag: PALETTE.hullDark, tire: PALETTE.catBlack,
    hub: PALETTE.catWhite, bolt: PALETTE.teamCats, eye: PALETTE.hullLight, ear: PALETTE.catBlack, earInner: PALETTE.catSiamese,
  },
};

/** Wheel layout (kart space). Radii/widths feed the wheel instance scale and the spin rate. */
export const KART_WHEELS = [
  { x: -0.5, y: 0.27, z: 0.3, r: 0.27, w: 0.2, front: false },
  { x: 0.5, y: 0.27, z: 0.3, r: 0.27, w: 0.2, front: false },
  { x: -0.45, y: 0.19, z: -0.5, r: 0.19, w: 0.13, front: true },
  { x: 0.45, y: 0.19, z: -0.5, r: 0.19, w: 0.13, front: true },
] as const;

/** Exhaust tip (kart space), where puffs and the boost flame come out. */
export const KART_EXHAUST = new THREE.Vector3(0.3, 1.06, 0.5);
/** Side-discharge chute mouth (grass clippings) and its outward direction (+X). */
export const KART_CHUTE = new THREE.Vector3(0.9, 0.2, -0.02);
/** Hood front (damage smoke). */
export const KART_HOOD = new THREE.Vector3(0, 0.62, -0.62);

export interface KartAssets {
  body: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  flame: THREE.BufferGeometry;
  triangles: number;
}

const cache = new Map<number, KartAssets>();

function teamKey(team: TeamId): 0 | 1 { return team === Team.Cats ? 1 : 0; }

function buildBody(team: 0 | 1, b: PartBuilder): void {
  const P = KART_PALETTES[team];
  // Mower deck: the round skirt the collision body is built around, with a trim stripe and a dark underside.
  b.add(cyl(0.68, 0.62, 0.16, 20), at(0, 0.2, 0.02, 0, 0, 0, 1, 1, 1.06), P.body, true);
  b.add(torus(0.685, 0.032, 3, 20), at(0, 0.265, 0.02, Math.PI / 2, 0, 0, 1, 1.06, 1), P.trim);
  b.add(cyl(0.6, 0.52, 0.1, 16), at(0, 0.08, 0.02), P.dark);
  // Tub + hood (the hood has a racing stripe and a face: headlight eyes, grille grin).
  b.add(rbox(0.78, 0.26, 1.02, 0.1, 1), at(0, 0.38, 0.06), P.body);
  b.add(rbox(0.66, 0.3, 0.52, 0.12), at(0, 0.5, -0.42, -0.12), P.body);
  b.add(box(0.16, 0.03, 0.5), at(0, 0.66, -0.43, -0.12), P.trim);
  b.add(rbox(0.36, 0.1, 0.06, 0.03, 1), at(0, 0.43, -0.685), P.dark);
  for (const sx of [-1, 1]) {
    b.add(cyl(0.078, 0.078, 0.06, 12), at(sx * 0.18, 0.575, -0.665, Math.PI / 2), P.eye, true);
    b.add(cyl(0.036, 0.036, 0.02, 8), at(sx * 0.17, 0.585, -0.7, Math.PI / 2), P.dark);
  }
  b.add(rbox(0.88, 0.1, 0.12, 0.05, 1), at(0, 0.22, -0.75), P.dark);
  b.add(box(0.92, 0.05, 0.05), at(0, 0.19, -0.5), P.dark);
  // Side-discharge chute on the deck's right: the ride-on-mower tell (it spits grass clippings).
  b.add(rbox(0.3, 0.12, 0.3, 0.04, 1), at(0.72, 0.22, -0.02, 0, 0, -0.35), P.dark);
  b.add(box(0.05, 0.1, 0.26), at(0.86, 0.19, -0.02, 0, 0, -0.35), P.trim);
  // Rear fenders over the big wheels.
  for (const sx of [-1, 1]) b.add(torus(0.31, 0.055, 4, 9, Math.PI * 0.62), at(sx * 0.5, 0.27, 0.3, 0, Math.PI / 2, Math.PI * 0.19), P.body);
  // Bucket seat with piping.
  b.add(rbox(0.5, 0.12, 0.42, 0.05, 1), at(0, 0.56, 0.18), P.seat);
  b.add(rbox(0.52, 0.46, 0.12, 0.06), at(0, 0.82, 0.42, 0.18), P.seat);
  b.add(box(0.54, 0.05, 0.13), at(0, 1.03, 0.46, 0.18), P.trim);
  // Steering column + wheel, tilted toward the driver.
  b.add(cyl(0.025, 0.025, 0.34, 6), at(0, 0.7, -0.15, 0.75), P.dark);
  b.add(torus(0.15, 0.028, 3, 12), at(0, 0.84, -0.04, -0.85), P.dark);
  b.add(cyl(0.05, 0.05, 0.04, 8), at(0, 0.84, -0.04, -0.85 + Math.PI / 2), P.trim);
  // Grass-catcher bag with a trim band.
  b.add(rbox(0.64, 0.38, 0.24, 0.09, 1), at(0, 0.5, 0.6), P.bag);
  b.add(box(0.66, 0.06, 0.25), at(0, 0.6, 0.6), P.trim);
  // Exhaust stack.
  b.add(cyl(0.045, 0.05, 0.42, 8), at(0.3, 0.8, 0.5), P.metal, true);
  b.add(cyl(0.066, 0.066, 0.05, 8), at(0.3, 1.02, 0.5), P.dark);
  // Pennant whip: team flag well above head height, readable at range.
  b.add(cyl(0.016, 0.022, 1.5, 5), at(-0.3, 1.25, 0.55), P.dark);
  b.add(cone(0.2, 0.62, 3), at(-0.3, 1.78, 0.84, Math.PI / 2, 0, 0, 0.16, 1, 1), P.accent);
  b.add(cyl(0.045, 0.045, 0.06, 6), at(-0.3, 2.0, 0.55), P.accent);
}

function buildWheel(team: 0 | 1): THREE.BufferGeometry {
  const P = KART_PALETTES[team];
  // Unit wheel: radius 1, width 1, axis +Y while building, rotated to +X at the end.
  const b = new PartBuilder();
  const prof = [[0.56, -0.5], [0.88, -0.5], [1, -0.36], [1, 0.36], [0.88, 0.5], [0.56, 0.5]].map(([x, y]) => new THREE.Vector2(x, y));
  b.add(new THREE.LatheGeometry(prof, 10), at(0, 0, 0), P.tire);
  b.add(cyl(0.6, 0.6, 0.94, 10), at(0, 0, 0), P.hub);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.add(box(0.2, 1.02, 0.2), at(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32, 0, -a), P.bolt);
  }
  const { geometry } = b.build();
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  geometry.computeBoundingSphere();
  return geometry;
}

export function kartAssets(team: TeamId): KartAssets {
  const key = teamKey(team);
  let a = cache.get(key);
  if (a) return a;
  const b = new PartBuilder();
  buildBody(key, b);
  const { geometry } = b.build();
  const wheel = buildWheel(key);
  const flame = new THREE.ConeGeometry(0.1, 0.46, 7);
  flame.translate(0, 0.23, 0);
  const wheelTris = (wheel.index!.count / 3) * 4;
  a = { body: geometry, wheel, flame, triangles: b.triangles + wheelTris + flame.index!.count / 3 };
  cache.set(key, a);
  return a;
}

/** Free the shared kart geometry (tests / hot reload). */
export function releaseKartAssets(): void {
  for (const a of cache.values()) { a.body.dispose(); a.wheel.dispose(); a.flame.dispose(); }
  cache.clear();
}

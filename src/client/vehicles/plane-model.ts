// "Fetch Flyer" / "Pounce Plane": a foam-winged toy RC plane a pet rides on top of (original design, R1).
// Chunky rounded fuselage in team colors with a cream belly, cream foam wings with team-color tip stripes and a
// trim band, a T-less toy tail with a paw roundel on the fin, fat balloon wheels, a tennis-ball-can booster
// strapped under the belly (it glows when boosting), two squeaky-gun barrels by the nose, and a little saddle
// with a backrest on top for the rider. The propeller is a separate mesh (it spins with throttle) plus comic
// "whirl" strokes that appear when it spins fast.
//
// Plane space: +Y up, forward = -Z, the landing gear's ground point at y = 0 (the sim's EntityState y); the
// view rotates everything about the pivot (0, PlaneDef.pivotY, 0) like the sim's planeLocalToWorld().
//
// Draw calls per plane: body (vertex-colored toon) + crease ink + propeller + whirl strokes (only while the prop
// spins fast) + booster flame (glow, only while boosting) = 3–5. Geometry is built once per team and shared.
import * as THREE from 'three/webgpu';
import { PALETTE } from '../style/style-tokens.js';
import { Team, type TeamId } from '../../shared/types';
import { VEHICLES } from '../../shared/content/vehicles';
import { PartBuilder, at, rbox, box, cyl, cone, torus, ball } from './parts';

export interface PlanePalette {
  body: number; belly: number; trim: number; stripe: number; wing: number; dark: number; metal: number;
  seat: number; tire: number; hub: number; roundel: number; roundelInner: number; can: number; canLid: number;
}

export const PLANE_PALETTES: Record<0 | 1, PlanePalette> = {
  [Team.Corgis]: {
    body: PALETTE.teamCorgis, belly: PALETTE.corgiCream, trim: PALETTE.teamCorgisTrim, stripe: PALETTE.teamCorgis,
    wing: PALETTE.hullLight, dark: PALETTE.corgiTri, metal: PALETTE.concrete, seat: PALETTE.corgiOrange,
    tire: PALETTE.catBlack, hub: PALETTE.teamCorgisTrim, roundel: PALETTE.teamCorgisTrim, roundelInner: PALETTE.corgiOrange,
    can: PALETTE.tennisBall, canLid: PALETTE.hullLight,
  },
  [Team.Cats]: {
    body: PALETTE.teamCats, belly: PALETTE.catWhite, trim: PALETTE.teamCatsTrim, stripe: PALETTE.teamCats,
    wing: PALETTE.catWhite, dark: PALETTE.catBlack, metal: PALETTE.concrete, seat: PALETTE.catSiamese,
    tire: PALETTE.catBlack, hub: PALETTE.catWhite, roundel: PALETTE.catBlack, roundelInner: PALETTE.teamCats,
    can: PALETTE.tennisBall, canLid: PALETTE.catGrey,
  },
};

const DEF = VEHICLES.rc_plane;
/** Nose hub where the propeller sits (plane space). */
export const PLANE_PROP = new THREE.Vector3(0, 0.44, -0.8);
export const PLANE_PROP_RADIUS = 0.34;
/** Booster can nozzle (flame, boost puffs) — points backward (+Z). */
export const PLANE_BOOSTER = new THREE.Vector3(0, 0.17, 0.46);
/** Engine exhaust stub (idle puffs) and the damage-smoke vent. */
export const PLANE_EXHAUST = new THREE.Vector3(0.14, 0.52, -0.52);
/** Wing tips (contrails while pulling hard / boosting). */
export const PLANE_WINGTIPS = [new THREE.Vector3(-0.8, 0.46, -0.04), new THREE.Vector3(0.8, 0.46, -0.04)] as const;
/** Main wheels (spin with ground speed) and the tail wheel. */
export const PLANE_WHEELS = [
  { x: -0.3, y: 0.13, z: -0.26, r: 0.13, w: 0.09 },
  { x: 0.3, y: 0.13, z: -0.26, r: 0.13, w: 0.09 },
  { x: 0, y: 0.07, z: 0.62, r: 0.07, w: 0.05 },
] as const;

export interface PlaneAssets {
  body: THREE.BufferGeometry;
  prop: THREE.BufferGeometry;
  whirl: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  flame: THREE.BufferGeometry;
  triangles: number;
}

const cache = new Map<number, PlaneAssets>();
const teamKey = (team: TeamId): 0 | 1 => (team === Team.Cats ? 1 : 0);

function buildBody(team: 0 | 1, b: PartBuilder): void {
  const P = PLANE_PALETTES[team];
  // Fuselage: a fat foam capsule (team color) with a cream belly, tapering to the tail.
  b.add(rbox(0.34, 0.3, 0.9, 0.13, 2), at(0, 0.45, -0.22), P.body);
  b.add(rbox(0.26, 0.22, 0.62, 0.1, 1), at(0, 0.47, 0.42, 0.08), P.body);
  b.add(rbox(0.3, 0.1, 0.86, 0.05, 1), at(0, 0.32, -0.2), P.belly);
  // Racing stripe along the spine and a trim band around the nose.
  b.add(box(0.08, 0.02, 1.2), at(0, 0.61, -0.05, 0.02), P.trim);
  b.add(torus(0.165, 0.03, 4, 16), at(0, 0.45, -0.62), P.trim);
  // Nose: a rounded cowling with a spinner collar, eyes that make it a cheeky toy (headlights).
  b.add(cyl(0.16, 0.17, 0.16, 16), at(0, 0.45, -0.7, Math.PI / 2), P.body, true);
  b.add(cyl(0.1, 0.13, 0.08, 12), at(0, 0.45, -0.78, Math.PI / 2), P.dark);
  for (const sx of [-1, 1]) {
    b.add(ball(0.055, 8, 6), at(sx * 0.1, 0.55, -0.62, 0, 0, 0, 1, 1, 0.6), P.wing);
    b.add(ball(0.028, 6, 4), at(sx * 0.1, 0.555, -0.655, 0, 0, 0, 1, 1, 0.5), P.dark);
  }
  // Squeaky-gun barrels beside the nose.
  for (const sx of [-1, 1]) {
    b.add(cyl(0.026, 0.026, 0.3, 8), at(sx * 0.2, 0.4, -0.62, Math.PI / 2), P.dark, true);
    b.add(cyl(0.036, 0.036, 0.05, 8), at(sx * 0.2, 0.4, -0.78, Math.PI / 2), P.trim);
  }
  // Wings: cream foam, slight dihedral, team-color tip stripes and a trim band inboard.
  for (const sx of [-1, 1]) {
    const dih = sx * 0.07;
    b.add(rbox(0.72, 0.05, 0.36, 0.024, 1), at(sx * 0.44, 0.42 + 0.025, -0.08, 0, 0, dih), P.wing, true);
    b.add(box(0.14, 0.056, 0.37), at(sx * 0.72, 0.45 + 0.022, -0.08, 0, 0, dih), P.stripe);
    b.add(box(0.05, 0.058, 0.37), at(sx * 0.3, 0.435 + 0.012, -0.08, 0, 0, dih), P.trim);
    // Wing-tip "paw" pads (winglets).
    b.add(box(0.04, 0.12, 0.2), at(sx * 0.8, 0.5, -0.06, 0, 0, dih), P.stripe);
  }
  // Tail: stabilizer + fin with a paw roundel (a toy logo, readable at range).
  b.add(rbox(0.62, 0.04, 0.2, 0.02, 1), at(0, 0.53, 0.62), P.wing, true);
  for (const sx of [-1, 1]) b.add(box(0.1, 0.045, 0.21), at(sx * 0.27, 0.53, 0.62), P.stripe);
  b.add(rbox(0.04, 0.3, 0.24, 0.02, 1), at(0, 0.7, 0.64, -0.2), P.body, true);
  b.add(box(0.045, 0.06, 0.25), at(0, 0.83, 0.67, -0.2), P.trim);
  for (const sx of [-1, 1]) {
    b.add(cyl(0.07, 0.07, 0.012, 10), at(sx * 0.024, 0.68, 0.65, 0, 0, Math.PI / 2), P.roundel);
    b.add(cyl(0.035, 0.035, 0.014, 10), at(sx * 0.026, 0.67, 0.65, 0, 0, Math.PI / 2), P.roundelInner);
    for (let i = 0; i < 3; i++) b.add(cyl(0.013, 0.013, 0.014, 6), at(sx * 0.026, 0.715, 0.62 + i * 0.03, 0, 0, Math.PI / 2), P.roundelInner);
  }
  // Landing gear: struts to the balloon wheels (the wheels are a separate instanced-free part of the body).
  for (const w of PLANE_WHEELS.slice(0, 2)) {
    b.add(cyl(0.018, 0.022, 0.22, 6), at(w.x * 0.8, 0.25, w.z, 0, 0, -Math.sign(w.x) * 0.35), P.dark);
    b.add(cyl(0.04, 0.04, w.w + 0.02, 8), at(w.x, w.y, w.z, 0, 0, Math.PI / 2), P.hub);
  }
  b.add(cyl(0.014, 0.014, 0.2, 5), at(0, 0.18, 0.6, 0.3), P.dark);
  // Tennis-ball-can booster under the belly (glows from its nozzle when boosting).
  b.add(cyl(0.085, 0.085, 0.52, 14), at(0, 0.19, 0.18, Math.PI / 2), P.can, true);
  b.add(torus(0.086, 0.018, 4, 14), at(0, 0.19, -0.08), P.canLid);
  b.add(cyl(0.07, 0.05, 0.06, 12), at(0, 0.19, 0.45, Math.PI / 2), P.dark);
  for (const z of [-0.02, 0.32]) b.add(torus(0.09, 0.012, 3, 14), at(0, 0.19, z), P.metal);
  // Engine exhaust stub.
  b.add(cyl(0.025, 0.03, 0.1, 6), at(PLANE_EXHAUST.x, PLANE_EXHAUST.y, PLANE_EXHAUST.z, 0, 0, -0.5), P.metal);
  // The rider's saddle: a cushion with piping and a small backrest on the spine (the Drive pose's rump sits ~0.3 m
  // above its feet, so the saddle top is at seat.y + 0.3), and a handlebar where the pose's paws reach forward.
  const s = DEF.seat, top = s.y + 0.3;
  b.add(rbox(0.32, 0.08, 0.34, 0.04, 1), at(s.x, top - 0.04, s.z + 0.04), P.seat);
  b.add(box(0.34, 0.03, 0.36), at(s.x, top - 0.085, s.z + 0.04), P.trim);
  b.add(rbox(0.3, 0.26, 0.07, 0.035, 1), at(s.x, top + 0.1, s.z + 0.26, 0.2), P.seat);
  b.add(cyl(0.022, 0.026, 0.42, 6), at(s.x, top + 0.12, s.z - 0.26, -0.25), P.dark, true);
  b.add(cyl(0.02, 0.02, 0.4, 6), at(s.x, top + 0.32, s.z - 0.31, 0, 0, Math.PI / 2), P.dark);
  for (const sx of [-1, 1]) b.add(cyl(0.032, 0.032, 0.1, 8), at(s.x + sx * 0.2, top + 0.32, s.z - 0.31, 0, 0, Math.PI / 2), P.trim);
  // Antenna whip with a team pennant (readable above the rider).
  b.add(cyl(0.008, 0.012, 0.9, 4), at(-0.12, 1.0, 0.5, -0.12), P.dark);
  b.add(cone(0.12, 0.34, 3), at(-0.12, 1.36, 0.62, Math.PI / 2 + 0.1, 0, 0, 0.14, 1, 1), P.trim);
}

function buildProp(team: 0 | 1): THREE.BufferGeometry {
  const P = PLANE_PALETTES[team];
  // Two chunky blades + spinner, in the XY plane (spins about Z), centered on the hub.
  const b = new PartBuilder();
  for (const s of [-1, 1]) b.add(box(0.07, PLANE_PROP_RADIUS, 0.025), at(0, s * PLANE_PROP_RADIUS * 0.5, 0, 0, s * 0.25, 0), P.dark);
  for (const s of [-1, 1]) b.add(box(0.072, 0.05, 0.028), at(0, s * (PLANE_PROP_RADIUS - 0.04), 0), P.trim);
  b.add(cone(0.075, 0.14, 10), at(0, 0, -0.05, -Math.PI / 2), P.trim);
  return b.build().geometry;
}

function buildWhirl(): THREE.BufferGeometry {
  // Comic motion strokes: three short ink-colored arcs around the prop disc.
  const b = new PartBuilder();
  for (let i = 0; i < 3; i++) b.add(torus(PLANE_PROP_RADIUS * (0.72 + i * 0.12), 0.008, 3, 10, Math.PI * 0.45), at(0, 0, 0, 0, 0, (i * Math.PI * 2) / 3), PALETTE.ink);
  return b.build().geometry;
}

function buildWheel(team: 0 | 1): THREE.BufferGeometry {
  const P = PLANE_PALETTES[team];
  const b = new PartBuilder();
  const prof = [[0.4, -0.5], [0.85, -0.5], [1, -0.25], [1, 0.25], [0.85, 0.5], [0.4, 0.5]].map(([x, y]) => new THREE.Vector2(x, y));
  b.add(new THREE.LatheGeometry(prof, 8), at(0, 0, 0), P.tire);
  b.add(cyl(0.45, 0.45, 0.9, 8), at(0, 0, 0), P.hub);
  const { geometry } = b.build();
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  geometry.computeBoundingSphere();
  return geometry;
}

export function planeAssets(team: TeamId): PlaneAssets {
  const key = teamKey(team);
  let a = cache.get(key);
  if (a) return a;
  const b = new PartBuilder();
  buildBody(key, b);
  const { geometry } = b.build();
  const prop = buildProp(key), whirl = buildWhirl(), wheel = buildWheel(key);
  const flame = new THREE.ConeGeometry(0.075, 0.42, 8);
  flame.rotateX(Math.PI / 2); // tip toward +Z (backward)
  flame.translate(0, 0, 0.21);
  const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  a = { body: geometry, prop, whirl, wheel, flame, triangles: b.triangles + tris(prop) + tris(whirl) + tris(wheel) * PLANE_WHEELS.length + tris(flame) };
  cache.set(key, a);
  return a;
}

/** Free the shared plane geometry (tests / hot reload). */
export function releasePlaneAssets(): void {
  for (const a of cache.values()) { a.body.dispose(); a.prop.dispose(); a.whirl.dispose(); a.wheel.dispose(); a.flame.dispose(); }
  cache.clear();
}

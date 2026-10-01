// C2 (combat-2). Procedural geometry for the ability entities, built once per team and shared by every view:
//   Spotter Drone   corgi: a round blue toy quadcopter with gold trim and floppy corgi ears; cat ("Bird Watcher"):
//                   a crimson toy bird-copter with a beak and tail feathers. Rotor blur discs, a big lens eye
//                   (glow, separate) and a scan ring under it (glow, separate).
//   Dig Charge      a tennis-ball bomb (corgi) / a yarn-ball bomb (cat) half buried in a dirt / litter mound, with
//                   a fuse nub; the armed light is a separate glow bead.
//   Squeak Barrier  corgi: four inflatable squeaky-toy pillows with squeak buttons and a gold rail; cat ("Scratch
//                   Wall"): four sisal scratching posts with crimson bands and a carpeted top plank.
// Model space: +Y up, ground at y = 0, facing -Z (the sim's yaw 0). Merged vertex-colored parts come from the
// vehicle lane's PartBuilder: one style-material draw per model (W13: no crease ink).
import * as THREE from 'three/webgpu';
import { PALETTE } from '../style/style-tokens.js';
import { Team, type TeamId } from '../../shared/types';
import { PartBuilder, at, rbox, box, cyl, cone, torus, ball } from '../vehicles/parts';
import { BARRIER, DRONE, CHARGE } from '../../sim/combat/ability-tuning';

export interface Built { geometry: THREE.BufferGeometry }

interface TeamColors { main: number; trim: number; dark: number; light: number }
export function teamColors(team: TeamId): TeamColors {
  return team === Team.Cats
    ? { main: PALETTE.teamCats, trim: PALETTE.teamCatsTrim, dark: PALETTE.catBlack, light: PALETTE.catCream }
    : { main: PALETTE.teamCorgis, trim: PALETTE.teamCorgisTrim, dark: PALETTE.corgiTri, light: PALETTE.corgiCream };
}

// ------------------------------------------------------------------------------------------------ drone
/** Drone body (centered on the sim's drone position). */
export function buildDrone(team: TeamId): Built {
  const c = teamColors(team);
  const cat = team === Team.Cats;
  const R = DRONE.radius;
  const b = new PartBuilder();
  // round body, squashed a little, with a trim belt
  b.add(ball(R * 0.82, 16, 11), at(0, 0, 0, 0, 0, 0, 1, 0.78, 1.05), c.main, false);
  b.add(torus(R * 0.8, 0.045, 5, 20), at(0, -0.02, 0, Math.PI / 2), c.trim, false);
  // four arms + motor hubs + rotor blur discs
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const ax = Math.cos(a), az = Math.sin(a);
    const L = R * 1.45;
    b.add(rbox(0.07, 0.05, L, 0.02), at(ax * L * 0.5, 0.04, az * L * 0.5, 0, Math.atan2(ax, az)), c.dark, true);
    b.add(cyl(0.06, 0.07, 0.1, 8), at(ax * L, 0.07, az * L), c.trim, true);
    b.add(cyl(0.22, 0.22, 0.03, 16), at(ax * L, 0.13, az * L), c.light, false);
  }
  // landing skids
  for (const s of [-1, 1]) b.add(rbox(0.05, 0.05, 0.5, 0.02), at(s * 0.18, -R * 0.75, 0), c.dark, true);
  if (cat) {
    // bird: yellow beak forward, tail feathers back, tiny wings
    b.add(cone(0.09, 0.22, 8), at(0, -0.02, -R * 0.95, -Math.PI / 2), PALETTE.accentHot, true);
    for (const s of [-1, 0, 1]) b.add(rbox(0.07, 0.02, 0.26, 0.01), at(s * 0.08, 0.06, R * 0.95, 0.35, s * 0.35), c.trim, true);
    for (const s of [-1, 1]) b.add(rbox(0.26, 0.03, 0.14, 0.01), at(s * R * 0.9, 0.02, 0.02, 0, 0, s * 0.35), c.light, true);
  } else {
    // corgi: two floppy triangle ears on top, a tiny nub tail
    for (const s of [-1, 1]) b.add(cone(0.08, 0.2, 4), at(s * 0.12, R * 0.7, 0.02, 0, 0, -s * 0.35), PALETTE.corgiOrange, true);
    b.add(ball(0.05, 8, 6), at(0, 0.05, R * 0.88), PALETTE.corgiCream, false);
  }
  return b.build();
}
/** Lens eye (front, -Z) — drawn with a glow material. */
export function droneLens(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.1, 12, 8);
  g.translate(0, -0.02, -DRONE.radius * 0.8);
  return g;
}
/** Flat scan ring under the drone — drawn with a glow material, pulsed by the view. */
export function droneRing(): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(0.55, 0.025, 4, 28);
  g.rotateX(Math.PI / 2);
  g.translate(0, -DRONE.radius - 0.12, 0);
  return g;
}

// ------------------------------------------------------------------------------------------------ charge
export function buildCharge(team: TeamId): Built {
  const c = teamColors(team);
  const cat = team === Team.Cats;
  const b = new PartBuilder();
  // mound of dirt (corgi) or litter (cat), with clumps
  const mound = cat ? PALETTE.concrete : PALETTE.dirt;
  b.add(ball(0.42, 14, 8, ), at(0, 0, 0, 0, 0, 0, 1, 0.32, 1), mound, false);
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26 + 0.4, r = 0.36 + (i % 2) * 0.05;
    b.add(ball(0.08 + (i % 3) * 0.02, 7, 5), at(Math.cos(a) * r, 0.03, Math.sin(a) * r), cat ? PALETTE.catCream : PALETTE.mulch, false);
  }
  // the bomb: a tennis ball (corgi) / yarn ball (cat) poking out, a team band and a fuse nub
  b.add(ball(0.17, 12, 9), at(0, 0.12, 0), cat ? c.main : PALETTE.tennisBall, false);
  b.add(torus(0.17, 0.025, 4, 16), at(0, 0.12, 0, Math.PI / 2 - 0.3, 0.4), cat ? c.light : c.main, false);
  b.add(cyl(0.035, 0.045, 0.1, 8), at(0, 0.31, 0), c.dark, true);
  return b.build();
}
/** Armed light bead on top of the fuse — glow. */
export function chargeLight(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.05, 8, 6);
  g.translate(0, 0.39, 0);
  return g;
}
/** Trigger-radius ring on the ground (allies only) — glow. */
export function chargeRing(): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(CHARGE.trigger, 0.03, 3, 48);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0.04, 0);
  return g;
}

// ------------------------------------------------------------------------------------------------ barrier
/** A wall `width` wide, ground at y = 0 (reaching BARRIER.sink below), BARRIER.height tall, facing -Z. */
export function buildBarrier(team: TeamId, width: number): Built {
  const c = teamColors(team);
  const cat = team === Team.Cats;
  const H = BARRIER.height, S = BARRIER.sink, D = BARRIER.thickness;
  const b = new PartBuilder();
  const n = 4, w = width / n;
  const h = H + S;
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + w * (i + 0.5);
    if (cat) {
      // sisal post with crimson bands
      b.add(cyl(w * 0.47, w * 0.49, h, 14), at(x, h / 2 - S, 0), PALETTE.catSiamese, false);
      for (const [y, col] of [[0.25, c.main], [H * 0.5, c.trim], [H - 0.35, c.main]] as const) b.add(torus(w * 0.49, 0.1, 4, 16), at(x, y, 0, Math.PI / 2), col, false);
    } else {
      // inflatable squeaky pillow, alternating blue / gold, squeak buttons on both faces
      b.add(rbox(w * 0.96, h, D * 1.05, 0.14, 3), at(x, h / 2 - S, 0), i % 2 ? c.trim : c.main, false);
      for (const f of [-1, 1]) {
        b.add(cyl(0.13, 0.15, 0.08, 12), at(x, H * 0.62, f * (D * 0.52 + 0.03), Math.PI / 2), i % 2 ? c.main : c.trim, true);
        b.add(cyl(0.07, 0.07, 0.05, 10), at(x, H * 0.3, f * (D * 0.52 + 0.02), Math.PI / 2), PALETTE.corgiCream, true);
      }
    }
  }
  if (cat) {
    // carpeted top plank + a dangling toy mouse
    b.add(rbox(width + 0.1, 0.16, D + 0.2, 0.05), at(0, H + 0.02, 0), c.main, true);
    b.add(cyl(0.012, 0.012, 0.5, 4), at(width * 0.2, H - 0.25, -D / 2 - 0.12), PALETTE.ink, false);
    b.add(ball(0.09, 8, 6), at(width * 0.2, H - 0.52, -D / 2 - 0.12, 0, 0, 0, 1, 0.8, 1.5), PALETTE.catGrey, false);
  } else {
    // gold rail along the top + fat end caps
    b.add(rbox(width + 0.05, 0.14, D * 0.6, 0.06), at(0, H + 0.02, 0), c.trim, true);
    for (const s of [-1, 1]) b.add(ball(0.2, 10, 7), at(s * (width / 2), H + 0.08, 0), c.main, false);
  }
  return b.build();
}

// ------------------------------------------------------------------------------------------------ spotted marker
/** "Spotted" marker: a diamond reticle over a down-pointing chevron, in the XY plane (billboarded by the view). */
export function spottedMarker(): THREE.BufferGeometry {
  const b = new PartBuilder();
  b.add(torus(0.3, 0.07, 3, 4), at(0, 0.2, 0, 0, 0, Math.PI / 4), 0xffffff, false);
  b.add(ball(0.09, 8, 6), at(0, 0.2, 0), 0xffffff, false);
  b.add(cone(0.16, 0.26, 3), at(0, -0.3, 0, Math.PI), 0xffffff, false);
  return b.build().geometry;
}

// Class weapon props: chunky toy-military shapes. Weapon-local frame: origin = right-hand grip,
// barrel along -Z, +Y up. Each weapon is one rigid vertex-colored mesh (crease ink allowed) plus
// one glow part (sights, emitters, ammo) in a single emissive color.
import * as THREE from 'three/webgpu';
import { PALETTE } from '../../style/style-tokens.js';
import type { ClassId, TeamId } from '../../../shared/types';
import { mixHex } from './colors';
import { teamColors } from './gear';
import { MeshBuilder, ellipsoid, sweep, ring, ellipseLoop, xform, seg, type V3 } from './mesh-builder';

export interface WeaponGeo {
  geometry: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
  glowColor: number;
  /** Left-hand (support) grip point, weapon-local. */
  leftGrip: V3;
  /** Muzzle point, weapon-local. */
  muzzle: V3;
  triangles: number;
  /** Weapon id from the class kit (src/shared/content/classes.ts). */
  id: string;
}

const GUN = mixHex(PALETTE.hullDark, PALETTE.ink, 0.35);
const STEEL = mixHex(PALETTE.concrete, PALETTE.hullDark, 0.45);
const GRIP = mixHex(PALETTE.ink, PALETTE.hullDark, 0.4);

/** Cylinder along Z from z0 to z1 at (x, y). */
function tubeZ(x: number, y: number, z0: number, z1: number, r0: number, r1: number, n: number, caps = 1) {
  return sweep([[x, y, z0], [x, y, z1]], [[r0, r0], [r1, r1]], n, { up: [0, 1, 0], capStart: caps, capEnd: caps, capStartLen: 0.35, capEndLen: 0.35 });
}
function tubeX(c: V3, len: number, r: number, n: number) {
  return sweep([[c[0] - len / 2, c[1], c[2]], [c[0] + len / 2, c[1], c[2]]], [[r, r], [r, r]], n, { up: [0, 1, 0], capStart: 1, capEnd: 1, capStartLen: 0.3, capEndLen: 0.3 });
}
const box = (c: V3, h: V3, q: number, rot?: V3, p = 4) => ellipsoid(c, h, seg(6, q, 5), seg(5, q, 4), { p, rot });

export function buildWeapon(cls: ClassId, team: TeamId, q: number): WeaponGeo {
  const tc = teamColors(team);
  const mb = new MeshBuilder(null);
  const gl = new MeshBuilder(null);
  let leftGrip: V3 = [0, -0.02, -0.22], muzzle: V3 = [0, 0.06, -0.48], glowColor: number = PALETTE.tennisBall, id = '';
  const n = seg(8, q, 6);
  switch (cls) {
    case 'assault': { // squeaker rifle: toy-bulb stock, drum mag, fat barrel
      id = 'squeaker_rifle';
      mb.add(box([0, 0.045, -0.08], [0.038, 0.048, 0.15], q), GUN);
      mb.add(box([0, 0.05, -0.1], [0.041, 0.018, 0.13], q, undefined, 6), tc.main);
      mb.add(tubeZ(0, 0.06, -0.2, -0.42, 0.022, 0.02, n), STEEL);
      mb.add(tubeZ(0, 0.06, -0.41, -0.47, 0.034, 0.032, n), tc.trim);
      mb.add(ellipsoid([0, 0.05, 0.11], [0.05, 0.058, 0.075], seg(8, q, 6), seg(6, q, 5)), tc.main);
      mb.add(ring(ellipseLoop([0, 0.05, 0.045], [0.047, 0, 0], [0, 0.052, 0], seg(10, q, 7)), 0.01, 4, [0, 0, 1]), tc.trim);
      mb.add(box([0, -0.04, 0.0], [0.02, 0.045, 0.024], q, [0.3, 0, 0]), GRIP);
      mb.add(tubeX([0, -0.02, -0.11], 0.06, 0.052, seg(10, q, 7)), tc.trim);
      mb.add(box([0, -0.035, -0.14], [0.017, 0.035, 0.02], q), GRIP);
      mb.add(box([0, 0.11, -0.06], [0.012, 0.018, 0.05], q), GRIP);
      gl.add(ellipsoid([0, 0.132, -0.03], [0.016, 0.016, 0.016], 6, 4), 0);
      glowColor = PALETTE.tennisBall;
      leftGrip = [0, -0.03, -0.14]; muzzle = [0, 0.06, -0.49];
      break;
    }
    case 'infiltrator': { // snap pistol: compact slide, mousetrap snap bar, suppressor, laser
      id = 'snap_pistol';
      mb.add(box([0, 0.05, -0.07], [0.03, 0.034, 0.11], q), STEEL);
      mb.add(box([0, -0.03, 0.01], [0.023, 0.052, 0.028], q, [0.25, 0, 0]), GRIP);
      mb.add(sweep([[-0.028, 0.084, -0.02], [-0.028, 0.12, -0.08], [0.028, 0.12, -0.08], [0.028, 0.084, -0.02]], [[0.007, 0.007], [0.007, 0.007], [0.007, 0.007], [0.007, 0.007]], 5, { up: [0, 0, 1], capStart: 1, capEnd: 1 }), PALETTE.accentHot);
      mb.add(tubeZ(0, 0.05, -0.17, -0.31, 0.024, 0.024, n), GUN);
      mb.add(ring(ellipseLoop([0, 0.05, -0.24], [0.026, 0, 0], [0, 0.026, 0], seg(10, q, 7)), 0.007, 4, [0, 0, 1]), tc.main);
      mb.add(box([0, 0.0, -0.13], [0.014, 0.014, 0.03], q), GUN);
      gl.add(ellipsoid([0, 0.0, -0.165], [0.011, 0.011, 0.008], 6, 4), 0);
      glowColor = PALETTE.laserRed;
      leftGrip = [-0.035, -0.035, 0.005]; muzzle = [0, 0.05, -0.33];
      break;
    }
    case 'overwatch': { // laser longshot: long barrel, scope, team stock, glowing emitter
      id = 'laser_longshot';
      mb.add(box([0, 0.04, -0.04], [0.032, 0.042, 0.18], q), GUN);
      mb.add(tubeZ(0, 0.05, -0.2, -0.68, 0.019, 0.016, n), STEEL);
      mb.add(tubeZ(0, 0.05, -0.62, -0.7, 0.028, 0.028, n), tc.trim);
      mb.add(tubeZ(0, 0.118, 0.04, -0.2, 0.024, 0.024, n), GRIP);
      mb.add(tubeZ(0, 0.118, -0.16, -0.22, 0.034, 0.034, n), GRIP);
      mb.add(box([0, 0.03, 0.2], [0.026, 0.055, 0.1], q), tc.main);
      mb.add(box([0, -0.035, 0.0], [0.019, 0.045, 0.024], q, [0.3, 0, 0]), GRIP);
      for (const s of [-1, 1]) mb.add(sweep([[0.012 * s, 0.03, -0.42], [0.02 * s, 0.0, -0.3]], [[0.006, 0.006], [0.006, 0.006]], 4, { up: [1, 0, 0], capStart: 1, capEnd: 1 }), GRIP);
      gl.add(ellipsoid([0, 0.05, -0.715], [0.02, 0.02, 0.014], 8, 5), 0);
      gl.add(ellipsoid([0, 0.118, -0.225], [0.022, 0.022, 0.006], 8, 4), 0);
      glowColor = PALETTE.laserRed;
      leftGrip = [0, -0.005, -0.17]; muzzle = [0, 0.05, -0.73];
      break;
    }
    case 'breacher': { // tennis mortar: fat tube, ball hopper, two handles
      id = 'tennis_mortar';
      mb.add(tubeZ(0, 0.075, 0.16, -0.4, 0.072, 0.07, seg(10, q, 8)), STEEL);
      mb.add(ring(ellipseLoop([0, 0.075, -0.4], [0.078, 0, 0], [0, 0.078, 0], seg(10, q, 7)), 0.016, 4, [0, 0, 1]), tc.trim);
      mb.add(ring(ellipseLoop([0, 0.075, 0.1], [0.076, 0, 0], [0, 0.076, 0], seg(10, q, 7)), 0.014, 4, [0, 0, 1]), tc.main);
      mb.add(box([0, 0.17, -0.06], [0.055, 0.045, 0.085], q), tc.main);
      mb.add(box([0, -0.035, 0.02], [0.02, 0.045, 0.025], q, [0.3, 0, 0]), GRIP);
      mb.add(box([0, -0.02, -0.16], [0.018, 0.04, 0.02], q), GRIP);
      for (let i = 0; i < 3; i++) gl.add(ellipsoid([0, 0.225, -0.12 + i * 0.06], [0.03, 0.03, 0.03], 6, 4), 0);
      glowColor = PALETTE.tennisBall;
      leftGrip = [0, -0.025, -0.16]; muzzle = [0, 0.075, -0.45];
      break;
    }
    case 'warden': { // sprinkler cannon: team body, flared nozzle with spokes, glowing tank window
      id = 'sprinkler_cannon';
      mb.add(tubeZ(0, 0.06, 0.12, -0.26, 0.058, 0.055, seg(10, q, 7)), tc.main);
      mb.add(sweep([[0, 0.06, -0.25], [0, 0.06, -0.31], [0, 0.06, -0.36]], [[0.042, 0.042], [0.055, 0.055], [0.078, 0.078]], seg(10, q, 7), { up: [0, 1, 0], capStart: 0, capEnd: 1, capEndLen: 0.15 }), STEEL);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        mb.add(ellipsoid([Math.cos(a) * 0.05, 0.06 + Math.sin(a) * 0.05, -0.375], [0.014, 0.014, 0.02], 6, 4), tc.trim);
      }
      mb.add(box([0, -0.035, 0.02], [0.02, 0.045, 0.025], q, [0.3, 0, 0]), GRIP);
      mb.add(box([0, -0.01, -0.14], [0.018, 0.04, 0.02], q), GRIP);
      gl.add(xform(tubeX([0, 0, 0], 0.13, 0.03, seg(10, q, 7)), [0, 0.13, -0.06], [0, Math.PI / 2, 0]), 0);
      glowColor = PALETTE.glowCyan;
      leftGrip = [0, -0.015, -0.14]; muzzle = [0, 0.06, -0.39];
      break;
    }
    case 'skyraider': { // frisbee launcher: flat wide body, loaded disc with a glowing rim
      id = 'frisbee_launcher';
      mb.add(box([0, 0.04, -0.1], [0.075, 0.034, 0.17], q, undefined, 3.5), tc.main);
      mb.add(box([0, 0.02, 0.12], [0.03, 0.045, 0.07], q), GUN);
      mb.add(box([0, -0.035, 0.0], [0.02, 0.045, 0.024], q, [0.3, 0, 0]), GRIP);
      mb.add(box([0, -0.01, -0.13], [0.018, 0.04, 0.02], q), GRIP);
      mb.add(ellipsoid([0, 0.088, -0.18], [0.105, 0.017, 0.105], seg(10, q, 8), seg(6, q, 4)), tc.trim);
      gl.add(ring(ellipseLoop([0, 0.09, -0.18], [0.1, 0, 0], [0, 0, 0.1], seg(16, q, 10)), 0.008, 4, [0, 1, 0]), 0);
      glowColor = PALETTE.glowCyan;
      leftGrip = [0, -0.02, -0.13]; muzzle = [0, 0.09, -0.3];
      break;
    }
  }
  const geometry = mb.build();
  const glow = gl.triangles > 0 ? gl.build() : null;
  return { geometry, glow, glowColor, leftGrip, muzzle, triangles: mb.triangles + gl.triangles, id };
}

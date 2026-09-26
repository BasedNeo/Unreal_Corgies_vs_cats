// Team armor (vest, straps, belt, collar) + class kit silhouettes (headgear, backpack, plates).
// Chunky toy-military read: team color fields with trim bands, readable from behind at 4 m and
// at thumbnail size. Original designs only.
import { PALETTE } from '../../style/style-tokens.js';
import { Team, type ClassId, type TeamId } from '../../../shared/types';
import { mixHex } from './colors';
import { ellipsoid, sweep, ring, ellipseLoop, xform, seg, isLite, type ColorFn, type MeshBuilder, type V3 } from './mesh-builder';
import { computeJoints, SIDES, SX } from './skeleton';
import type { BodyPlan } from './species';

export interface TeamColors { main: number; trim: number; dark: number; light: number; emblem: number }

export function teamColors(team: TeamId): TeamColors {
  if (team === Team.Cats) return { main: PALETTE.teamCats, trim: PALETTE.teamCatsTrim, dark: mixHex(PALETTE.teamCats, PALETTE.ink, 0.35), light: mixHex(PALETTE.teamCats, PALETTE.catWhite, 0.25), emblem: PALETTE.accentHot };
  if (team === Team.Corgis) return { main: PALETTE.teamCorgis, trim: PALETTE.teamCorgisTrim, dark: mixHex(PALETTE.teamCorgis, PALETTE.ink, 0.35), light: mixHex(PALETTE.teamCorgis, PALETTE.catWhite, 0.25), emblem: PALETTE.teamCorgisTrim };
  return { main: PALETTE.hull, trim: PALETTE.hullDark, dark: PALETTE.hullDark, light: PALETTE.hullLight, emblem: PALETTE.accent };
}

const KHAKI = mixHex(PALETTE.fenceWood, PALETTE.grassDry, 0.35);
const LEATHER = mixHex(PALETTE.fenceDark, PALETTE.mulch, 0.3);
const STEEL = mixHex(PALETTE.concrete, PALETTE.hullDark, 0.35);
const LENS = mixHex(PALETTE.tealDark, PALETTE.water, 0.4);

/** Torso radii at height y (interpolated from the plan) — gear hugs the body. */
function torsoAt(plan: BodyPlan, y: number): [number, number, number] {
  const T = plan.torso;
  if (y <= T.y[0]) return [T.rx[0], T.rz[0], T.z[0]];
  for (let i = 0; i < T.y.length - 1; i++) {
    if (y <= T.y[i + 1]) {
      const t = (y - T.y[i]) / (T.y[i + 1] - T.y[i]);
      return [T.rx[i] + (T.rx[i + 1] - T.rx[i]) * t, T.rz[i] + (T.rz[i + 1] - T.rz[i]) * t, T.z[i] + (T.z[i + 1] - T.z[i]) * t];
    }
  }
  const n = T.y.length - 1;
  return [T.rx[n], T.rz[n], T.z[n]];
}

export function buildGear(mb: MeshBuilder, plan: BodyPlan, cls: ClassId, team: TeamId, q: number): void {
  const j = computeJoints(plan);
  const tc = teamColors(team);
  const H = plan.headY;
  const isCat = plan.species === 'cat';
  const heavy = cls === 'breacher';
  const pad = heavy ? 0.036 : 0.02;

  mb.begin('vest');
  // --- vest: a closed shell over the torso, trim bands top/bottom -------------------------
  const y0 = plan.hipsY - 0.01, y1 = plan.neckY + 0.015;
  const ys: number[] = [];
  const rings = 6;
  for (let i = 0; i <= rings; i++) ys.push(y0 + ((y1 - y0) * i) / rings);
  const vestPath: V3[] = ys.map((y) => [0, y, torsoAt(plan, y)[2]]);
  const vestR = ys.map((y, i): [number, number] => {
    const [rx, rz] = torsoAt(plan, y);
    const top = i === ys.length - 1 ? 0.8 : 1;
    return [(rx + pad) * top, (rz + pad) * top];
  });
  const vestColor: ColorFn = (x, y, z) => {
    if (y < y0 + 0.035) return tc.trim;
    if (y > y1 - 0.03) return tc.trim;
    if (z > 0.05 && Math.abs(x) < 0.022) return tc.dark; // back seam
    return tc.main;
  };
  mb.add(sweep(vestPath, vestR, seg(13, q, 9), { up: [1, 0, 0], capStart: 1, capEnd: 1, capStartLen: 0.25, capEndLen: 0.35 }), vestColor, { auto: ['hips', 'spine', 'chest'] });

  // Chest plate with a trim border and a team emblem.
  const cy = plan.chestY - 0.005;
  const [crx, crz, cz] = torsoAt(plan, cy);
  const plateZ = cz - crz - pad - 0.012;
  const plateW = crx * (heavy ? 1.3 : 1.05), plateH = heavy ? 0.22 : 0.17;
  mb.add(ellipsoid([0, cy, plateZ + 0.012], [plateW * 0.55 + 0.012, plateH * 0.5 + 0.012, 0.022], seg(10, q, 7), seg(6, q, 5), { p: 4 }), tc.trim, { auto: ['spine', 'chest'] });
  mb.add(ellipsoid([0, cy, plateZ + 0.004], [plateW * 0.55, plateH * 0.5, 0.024], seg(10, q, 7), seg(6, q, 5), { p: 4.5 }), tc.main, { auto: ['spine', 'chest'] });
  // Emblem: corgis a gold "medal" disc, cats a trim-black diamond with a gold core.
  if (team === Team.Cats) {
    mb.add(ellipsoid([0, cy + 0.01, plateZ - 0.022], [0.04, 0.048, 0.012], 4, 4, { p: 1.2 }), tc.trim, { auto: ['spine', 'chest'] });
    if (!isLite(q)) mb.add(ellipsoid([0, cy + 0.01, plateZ - 0.031], [0.016, 0.02, 0.008], 6, 4), tc.emblem, { auto: ['spine', 'chest'] });
  } else {
    mb.add(ellipsoid([0, cy + 0.01, plateZ - 0.022], [0.036, 0.036, 0.012], seg(8, q, 6), 4), tc.emblem, { auto: ['spine', 'chest'] });
    if (!isLite(q)) mb.add(ellipsoid([0, cy + 0.01, plateZ - 0.031], [0.017, 0.017, 0.008], 6, 4), tc.main, { auto: ['spine', 'chest'] });
  }
  // Side utility pouch on the belt (left hip, clear of the weapon arms).
  const [prx, , pz] = torsoAt(plan, plan.spineY - 0.035);
  if (!isLite(q)) mb.add(ellipsoid([-prx - pad - 0.01, plan.hipsY + 0.01, pz - 0.02], [0.03, 0.045, 0.055], seg(6, q, 5), seg(5, q, 4), { p: 3.5 }), tc.dark, { auto: ['hips', 'spine'] });
  // Belt ring + buckle.
  const by = plan.hipsY - 0.005;
  const [brx, brz, bz] = torsoAt(plan, by);
  mb.add(ring(ellipseLoop([0, by, bz], [brx + pad + 0.012, 0, 0], [0, 0, brz + pad + 0.012], seg(12, q, 8)), [0.02, 0.014], 4, [0, 1, 0]), tc.trim, { auto: ['hips', 'spine'] });
  if (!isLite(q)) mb.add(ellipsoid([0, by, bz - brz - pad - 0.026], [0.036, 0.028, 0.014], 6, 4, { p: 4 }), team === Team.Cats ? PALETTE.accentHot : tc.dark, { rigid: 'hips' });
  // Shoulder straps (front → over shoulder → back).
  for (const s of SIDES) {
    const k = SX[s];
    const [, srz] = torsoAt(plan, plan.chestY + 0.06);
    const path: V3[] = [[0.085 * k, plan.chestY + 0.05, -srz - pad + 0.005], [0.12 * k, plan.neckY + 0.02, -0.06], [0.125 * k, plan.neckY + 0.035, 0.02], [0.1 * k, plan.chestY + 0.05, srz + pad - 0.005]];
    mb.add(sweep(path, [[0.014, 0.03], [0.014, 0.03], [0.014, 0.03], [0.014, 0.03]], 4, { up: [0, 1, 0], capStart: 1, capEnd: 1 }), tc.dark, { auto: ['chest', 'neck'] });
  }
  // Collar + tag (corgi: gold dog tag; cat: bell).
  const colY = plan.neckY + 0.045;
  mb.add(ring(ellipseLoop([0, colY, -0.01], [0.108, 0, 0], [0, 0, 0.1], seg(10, q, 8)), [0.022, 0.018], 4, [0, 1, 0]), isCat ? mixHex(tc.trim, tc.main, 0.4) : tc.trim, { auto: ['chest', 'neck'] });
  if (isCat) mb.add(ellipsoid([0, colY - 0.035, -0.118], [0.028, 0.03, 0.028], seg(6, q, 5), seg(5, q, 4)), PALETTE.accentHot, { rigid: 'neck' });
  else mb.add(ellipsoid([0, colY - 0.04, -0.118], [0.03, 0.036, 0.008], seg(6, q, 5), 4, { p: 3 }), PALETTE.accentHot, { rigid: 'neck' });

  mb.begin('kit');
  // --- class kit ---------------------------------------------------------------------------
  const cr = plan.cranium;
  const hc: V3 = [0, H + cr.c[1], cr.c[2]];
  const back = (y: number): number => { const [, rz, z] = torsoAt(plan, y); return z + rz + pad; };

  /** Helmet dome: the cranium's upper cap, cut by a plane tilted up at the front. */
  const dome = (grow: number, cutFront: number, cutBack: number, color: ColorFn | number, p = 2) => {
    const W = seg(14, q, 10), Hh = seg(5, q, 4);
    mb.add(helmetCap(W, Hh, [cr.r[0] + grow, cr.r[1] + grow, cr.r[2] + grow], cutFront, cutBack, p, hc), color, { rigid: 'head' });
    // Rim tube along the cut edge.
    const loop: V3[] = [];
    const n = seg(14, q, 10);
    for (let i = 0; i < n; i++) {
      const ph = (i / n) * Math.PI * 2;
      loop.push(capPoint(cutAngle(ph, cutFront, cutBack), ph, [cr.r[0] + grow, cr.r[1] + grow, cr.r[2] + grow], p, hc));
    }
    return loop;
  };

  switch (cls) {
    case 'assault': {
      const stripe: ColorFn = (x) => (Math.abs(x) < 0.03 ? tc.trim : tc.main);
      const loop = dome(0.02, 0.27, 0.6, stripe);
      mb.add(ring(loop, [0.016, 0.02], 4, [0, 1, 0]), tc.dark, { rigid: 'head' });
      // Compact pack + bedroll.
      const py2 = plan.chestY - 0.03;
      mb.add(ellipsoid([0, py2, back(py2) + 0.05], [0.13, 0.12, 0.06], seg(8, q, 6), seg(6, q, 4), { p: 3.5 }), tc.dark, { rigid: 'chest' });
      mb.add(xform(sweep([[-0.13, 0, 0], [0.13, 0, 0]], [[0.04, 0.04], [0.04, 0.04]], seg(8, q, 6), { up: [0, 1, 0], capStart: 1, capEnd: 1, capStartLen: 0.4, capEndLen: 0.4 }), [0, py2 + 0.13, back(py2) + 0.05]), KHAKI, { rigid: 'chest' });
      break;
    }
    case 'infiltrator': {
      // Bandana band around the brow with a knot and two trailing tails.
      const band: V3[] = [];
      const n = seg(18, q, 12);
      for (let i = 0; i < n; i++) {
        const ph = (i / n) * Math.PI * 2;
        const th = 1.12 - 0.3 * Math.cos(ph);
        band.push([hc[0] + Math.sin(th) * Math.sin(ph) * (cr.r[0] + 0.01), hc[1] + Math.cos(th) * (cr.r[1] + 0.01), hc[2] - Math.sin(th) * Math.cos(ph) * (cr.r[2] + 0.01)]);
      }
      mb.add(ring(band, [0.028, 0.012], seg(6, q, 4), [0, 1, 0]), tc.dark, { rigid: 'head' });
      const kz = hc[2] + cr.r[2] + 0.01, ky = hc[1] + 0.02;
      mb.add(ellipsoid([0, ky, kz], [0.035, 0.03, 0.025], 8, 6), tc.dark, { rigid: 'head' });
      for (const s of [-1, 1]) {
        mb.add(sweep([[0.015 * s, ky, kz], [0.05 * s, ky - 0.08, kz + 0.06], [0.06 * s, ky - 0.18, kz + 0.07]], [[0.008, 0.028], [0.008, 0.026], [0.006, 0.02]], seg(6, q, 4), { up: [0, 0, 1], capStart: 1, capEnd: 1 }), tc.dark, { rigid: 'head' });
      }
      // Slim pack with a coiled rope.
      const py2 = plan.chestY - 0.04;
      mb.add(ellipsoid([0, py2, back(py2) + 0.035], [0.1, 0.13, 0.04], seg(10, q, 7), seg(7, q, 5), { p: 3.5 }), tc.dark, { rigid: 'chest' });
      mb.add(ring(ellipseLoop([0, py2 - 0.02, back(py2) + 0.085], [0.06, 0, 0], [0, 0.06, 0], seg(12, q, 8)), 0.016, seg(5, q, 4), [0, 0, 1]), KHAKI, { rigid: 'chest' });
      break;
    }
    case 'overwatch': {
      // Boonie hat: soft crown + wide brim, team hat-band.
      const crown = dome(0.024, 0.25, 0.5, KHAKI, 2.4);
      mb.add(ring(crown, [0.014, 0.02], 4, [0, 1, 0]), tc.main, { rigid: 'head' });
      const brimY = hc[1] + cr.r[1] * 0.74;
      mb.add(ring(ellipseLoop([0, brimY, hc[2] + 0.015], [cr.r[0] * 0.78 + 0.1, 0, 0], [0, 0, cr.r[2] * 0.78 + 0.1], seg(20, q, 14)), [0.008, 0.07], seg(6, q, 4), [0, 1, 0]), KHAKI, { rigid: 'head' });
      // Flip-up targeting monocle on the right side of the hat (glowing lens in index.ts).
      const mo = monoclePos(plan);
      mb.add(ring(ellipseLoop(mo, [0.036, 0, 0], [0, 0.036, 0], seg(10, q, 8)), 0.011, 4, [0, 0, 1]), STEEL, { rigid: 'head' });
      mb.add(sweep([[mo[0] + 0.03, mo[1] - 0.005, mo[2] + 0.01], [hc[0] + cr.r[0] * 0.8, mo[1] + 0.01, hc[2] - 0.02]], [[0.009, 0.009], [0.009, 0.009]], 4, { up: [0, 1, 0], capStart: 1, capEnd: 1 }), STEEL, { rigid: 'head' });
      // Radio pack with a whip antenna.
      const py2 = plan.chestY - 0.03;
      const bz2 = back(py2);
      mb.add(ellipsoid([0, py2, bz2 + 0.055], [0.12, 0.14, 0.065], seg(10, q, 7), seg(8, q, 5), { p: 4 }), mixHex(KHAKI, PALETTE.hullDark, 0.4), { rigid: 'chest' });
      mb.add(sweep([[0.07, py2 + 0.1, bz2 + 0.06], [0.08, py2 + 0.3, bz2 + 0.08], [0.1, py2 + 0.52, bz2 + 0.12]], [[0.009, 0.009], [0.007, 0.007], [0.005, 0.005]], 5, { up: [0, 0, 1], capStart: 1, capEnd: 1 }), PALETTE.hullDark, { rigid: 'chest' });
      mb.add(ellipsoid([0.1, py2 + 0.53, bz2 + 0.12], [0.018, 0.018, 0.018], 6, 4), tc.trim, { rigid: 'chest' });
      break;
    }
    case 'breacher': {
      // Heavy boxy helmet with a jaw guard; big pauldrons; knee plates; ammo canister pack.
      const loop = dome(0.026, 0.29, 0.66, tc.dark, 2.8);
      mb.add(ring(loop, [0.024, 0.024], 4, [0, 1, 0]), tc.trim, { rigid: 'head' });
      for (const s of SIDES) {
        const k = SX[s];
        const sh = j.shoulder[s];
        mb.add(ellipsoid([sh[0] + 0.02 * k, sh[1] + 0.03, sh[2]], [0.1, 0.07, 0.1], seg(10, q, 7), seg(7, q, 5), { vMax: 0.62, p: 2.3, rot: [0, 0, -0.45 * k] }), tc.main, { rigid: `upperArm.${s}` });
        mb.add(ellipsoid([sh[0] + 0.02 * k, sh[1] + 0.012, sh[2]], [0.104, 0.03, 0.104], seg(10, q, 7), 4, { rot: [0, 0, -0.45 * k] }), tc.trim, { rigid: `upperArm.${s}` });
        const kn = j.knee[s];
        mb.add(ellipsoid([kn[0], kn[1] + 0.005, kn[2] - plan.thighR * 0.85], [0.055, 0.06, 0.03], seg(8, q, 6), seg(6, q, 4), { p: 3 }), STEEL, { rigid: `shin.${s}` });
      }
      const py2 = plan.chestY - 0.02;
      const bz2 = back(py2);
      mb.add(xform(sweep([[0, -0.13, 0], [0, 0.13, 0]], [[0.1, 0.085], [0.1, 0.085]], seg(12, q, 8), { up: [0, 0, 1], capStart: 1, capEnd: 1, capStartLen: 0.3, capEndLen: 0.3 }), [0, py2, bz2 + 0.09]), STEEL, { rigid: 'chest' });
      for (let i = 0; i < 3; i++) mb.add(ellipsoid([-0.06 + i * 0.06, py2 + 0.16, bz2 + 0.09], [0.032, 0.032, 0.032], seg(8, q, 6), seg(6, q, 4)), PALETTE.accentHot, { rigid: 'chest' });
      break;
    }
    case 'warden': {
      // Riot helmet with a raised tinted visor + a big shield pad on the left forearm.
      const loop = dome(0.022, 0.28, 0.62, tc.main, 2.2);
      mb.add(ring(loop, [0.015, 0.018], 4, [0, 1, 0]), tc.trim, { rigid: 'head' });
      const vy = hc[1] + cr.r[1] * 0.93, vz = hc[2] - cr.r[2] * 0.3;
      mb.add(ellipsoid([0, vy, vz], [cr.r[0] * 0.95, 0.07, 0.07], seg(14, q, 8), seg(6, q, 4), { vMax: 0.55, rot: [-0.9, 0, 0] }), LENS, { rigid: 'head' });
      const fa = j.elbow.L, wr = j.wrist.L;
      const mid: V3 = [(fa[0] + wr[0]) / 2 - 0.05, (fa[1] + wr[1]) / 2, (fa[2] + wr[2]) / 2 - 0.02];
      mb.add(ellipsoid(mid, [0.02, 0.15, 0.13], seg(14, q, 8), seg(8, q, 6), { p: 2.2, rot: [0, 0.35, 0.3] }), tc.main, { rigid: 'foreArm.L' });
      mb.add(ellipsoid([mid[0] - 0.012, mid[1], mid[2]], [0.012, 0.075, 0.065], seg(10, q, 7), seg(6, q, 4), { rot: [0, 0.35, 0.3] }), tc.trim, { rigid: 'foreArm.L' });
      // Water tank on the back (feeds the sprinkler cannon).
      const py2 = plan.chestY - 0.02;
      const bz2 = back(py2);
      mb.add(xform(sweep([[0, -0.12, 0], [0, 0.12, 0]], [[0.075, 0.075], [0.075, 0.075]], seg(12, q, 8), { up: [0, 0, 1], capStart: 2, capEnd: 2, capStartLen: 0.6, capEndLen: 0.6 }), [0, py2, bz2 + 0.08]), mixHex(PALETTE.water, PALETTE.tealLight, 0.3), { rigid: 'chest' });
      mb.add(ring(ellipseLoop([0, py2, bz2 + 0.08], [0.079, 0, 0], [0, 0, 0.079], seg(12, q, 8)), 0.012, 4, [0, 1, 0]), tc.trim, { rigid: 'chest' });
      break;
    }
    case 'skyraider': {
      // Leather aviator cap, goggles on the forehead, scarf, twin-fan jump pack.
      const loop = dome(0.016, 0.3, 0.9, LEATHER, 2);
      mb.add(ring(loop, [0.012, 0.014], 4, [0, 1, 0]), mixHex(LEATHER, PALETTE.ink, 0.3), { rigid: 'head' });
      const gy = hc[1] + cr.r[1] * 0.66, gz = hc[2] - cr.r[2] * 0.72;
      for (const s of [-1, 1]) {
        mb.add(ring(ellipseLoop([0.07 * s, gy, gz], [0.045, 0, 0], [0, 0.04, 0.02], seg(10, q, 8)), 0.013, seg(5, q, 4), [0, 0, 1]), tc.trim, { rigid: 'head' });
        mb.add(ellipsoid([0.07 * s, gy, gz + 0.004], [0.042, 0.037, 0.012], seg(8, q, 6), 4, { rot: [-0.45, 0, 0] }), LENS, { rigid: 'head' });
      }
      // Scarf tail streaming back from the collar.
      const sy = plan.neckY + 0.04;
      mb.add(sweep([[0.04, sy, 0.1], [0.08, sy - 0.05, 0.2], [0.1, sy - 0.14, 0.26]], [[0.01, 0.04], [0.01, 0.042], [0.008, 0.036]], seg(6, q, 4), { up: [0, 0, 1], capStart: 1, capEnd: 1 }), tc.trim, { auto: ['chest', 'neck'] });
      const py2 = plan.chestY - 0.02;
      const bz2 = back(py2);
      for (const s of [-1, 1]) {
        mb.add(xform(sweep([[0, -0.14, 0], [0, 0.1, 0]], [[0.05, 0.05], [0.06, 0.06]], seg(10, q, 7), { up: [0, 0, 1], capStart: 1, capEnd: 2, capStartLen: 0.5 }), [0.07 * s, py2, bz2 + 0.06]), STEEL, { rigid: 'chest' });
        mb.add(ring(ellipseLoop([0.07 * s, py2 - 0.12, bz2 + 0.06], [0.056, 0, 0], [0, 0, 0.056], seg(10, q, 7)), 0.012, 4, [0, 1, 0]), tc.main, { rigid: 'chest' });
      }
      mb.add(xform(ellipsoid([0, 0, 0], [0.16, 0.012, 0.05], seg(10, q, 6), 4, { p: 3 }), [0, py2 + 0.07, bz2 + 0.07]), tc.main, { rigid: 'chest' });
      break;
    }
  }
}

/** Overwatch monocle center (model space): raised above the right eye, flipped up. */
export function monoclePos(plan: BodyPlan): V3 {
  const j = computeJoints(plan);
  const e = j.eye.R;
  return [e[0] + 0.05, e[1] + plan.eye.r * 1.9, e[2] - 0.035];
}

/**
 * Polar angle of the helmet cut at azimuth ph (0 = front): the front sits above the brows, the sides
 * stay above the cheeks (ears poke through), the back drops over the nape.
 */
function cutAngle(ph: number, front: number, backA: number): number {
  const c = Math.cos(ph), side = Math.min(0.43, (front + backA) / 2);
  return (side + (front - side) * Math.max(0, c) + (backA - side) * Math.max(0, -c)) * Math.PI;
}

/** Point on a superellipsoid at polar angle th (0 = top) and azimuth ph (0 = front, -Z). */
function capPoint(th: number, ph: number, r: V3, p: number, c: V3): V3 {
  let dx = Math.sin(th) * Math.sin(ph), dy = Math.cos(th), dz = -Math.sin(th) * Math.cos(ph);
  if (p !== 2) { const k = 1 / Math.pow(Math.abs(dx) ** p + Math.abs(dy) ** p + Math.abs(dz) ** p, 1 / p); dx *= k; dy *= k; dz *= k; }
  return [c[0] + dx * r[0], c[1] + dy * r[1], c[2] + dz * r[2]];
}

/** Ellipsoid cap from the top pole down to a cut that varies with azimuth. */
function helmetCap(W: number, H: number, r: V3, front: number, backA: number, p: number, c: V3) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const pt = (th: number, ph: number) => {
    pos.push(...capPoint(th, ph, r, p, c));
    return pos.length / 3 - 1;
  };
  const top = pt(0, 0); uv.push(0.5, 0);
  const rows: number[][] = [];
  for (let jj = 1; jj <= H; jj++) {
    const row: number[] = [];
    for (let i = 0; i <= W; i++) {
      const ph = (i / W) * Math.PI * 2;
      row.push(pt((jj / H) * cutAngle(ph, front, backA), ph)); uv.push(i / W, jj / H);
    }
    rows.push(row);
  }
  for (let i = 0; i < W; i++) idx.push(top, rows[0][i + 1], rows[0][i]);
  for (let rr = 0; rr < rows.length - 1; rr++) {
    const a = rows[rr], b = rows[rr + 1];
    for (let i = 0; i < W; i++) idx.push(a[i], b[i + 1], b[i], a[i], a[i + 1], b[i + 1]);
  }
  return { pos, uv, idx };
}

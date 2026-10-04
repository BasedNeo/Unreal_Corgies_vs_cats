// OWNER: K3 (char-3). The Wave 9 PvE squad kits on the shared 46-bone rig (docs/handoff/K3.md). Original designs.
//
//   alley  ALLEY-CAT RAIDERS: light, fast flankers in scavenged kit. A patched leather jerkin, a knotted bandana with
//          streaming tails (team colour), a giant bottle cap strapped on the left shoulder (team-colour top), bottle caps
//          sewn on the chest as scale armour, a bike-chain belt and a bike-chain bandolier, one bottle-cap knee pad, a
//          bike light clipped on the bandolier (the team lamp). Lean build (the infiltrator's).
//   heavy  TABBY HEAVIES: slow shield-bearers in heavy plates. A battered galvanized bin lid on the left forearm (a
//          team roundel painted on its face, dents, rust, the lid handle outside), big layered pauldrons (team shells),
//          a double chest plate, thigh plates, a heavy helmet with a nasal guard and a helmet lamp. Broad build (the
//          breacher's).
//
// Readability (HARDENED pillar 3): team first (bandana, cap top, roundel, shells, armbands, lamps), squad second (the
// silhouette: bandana tails + one big shoulder disc + lean frame vs a big shield disc + broad pauldrons), then detail.
// Budgets: the squads are PvE bots, so they are always drawn at the NPC tier (3,500 triangles incl. the weapon, with a
// 20-triangle margin, any neckwear); the hero tier fits too (labs). Draws are the classes' exactly: body, weapon (+ ink
// + glow), one team-lamp glow mesh (+ neckwear): no extra draw per character.
import { PALETTE } from '../../style/style-tokens.js';
import type { ClassId, TeamId } from '../../../shared/types';
import type { SquadKit } from '../../../sim/ai/archetypes';
import { mixHex, paintAt, muddy, valueNoise3, INK, GUNMETAL, WORN_STEEL, BRASS, OLIVE, KHAKI } from './colors';
import { ellipsoid, sweep, ring, ellipseLoop, xform, seg, isLite, SURF, type ColorFn, type MeshBuilder, type V3 } from './mesh-builder';
import { computeJoints, SIDES, SX, type HeadCut } from './skeleton';
import { armourCollar, capPoint, carrierPad, factionGear, helmetCap, HEADGEAR, LEATHER, mottled, teamColors, torsoAt, type Headgear } from './gear';
import { ruffShape, type BodyDress } from './body';
import type { BodyPlan } from './species';

/** The class build each squad wears (species.ts CLASS_BUILD) and fits its neckwear to: raiders lean, heavies broad. */
const BUILD: Record<SquadKit, ClassId> = { alley: 'infiltrator', heavy: 'breacher' };
export function squadBuildClass(k: SquadKit): ClassId {
  return BUILD[k];
}

/** Squad headgear domes (same conventions as gear.ts HEADGEAR): a low bandana; a heavy helmet (the breacher's cut). */
const HEAD: Record<SquadKit, Headgear> = {
  alley: { grow: 0.013, cut: { front: 0.28, back: 0.64, side: 0.5 }, p: 2.05 },
  heavy: { grow: 0.03, cut: HEADGEAR.breacher!.cut, p: 2.7 },
};
export function squadHeadCut(k: SquadKit): HeadCut {
  return HEAD[k].cut;
}

// --- scavenged colours (palette mixes; never a team hue) --------------------------------------------------------------
/** Sun-cracked leather jerkin. */
const JERKIN = mixHex(LEATHER, KHAKI, 0.55);
/** Canvas and old-tent patches sewn on it. */
const PATCH = mixHex(KHAKI, OLIVE, 0.45);
const STITCH = mixHex(JERKIN, INK, 0.45);
/** Bike chain: oily steel links. */
const CHAIN = mixHex(WORN_STEEL, GUNMETAL, 0.35);
const CHAIN_DARK = mixHex(GUNMETAL, INK, 0.4);
const RUST = mixHex(PALETTE.rust ?? 0x7a3e22, GUNMETAL, 0.2);
/** Galvanized bin-lid steel, its pressed ridges darker. */
const GALV = mixHex(WORN_STEEL, PALETTE.concrete ?? 0x9a968e, 0.35);
const GALV_DARK = mixHex(GALV, INK, 0.38);

/** What the body wears under a squad kit (body.ts BodyDress). */
export function squadDress(plan: BodyPlan, k: SquadKit, team: TeamId): BodyDress {
  const fg = factionGear(plan.species);
  const tc = teamColors(team);
  // Raiders wear scavenged olive fatigues over the faction under-suit's cut; heavies the faction suit.
  const suit = k === 'alley' ? mixHex(fg.suit, OLIVE, 0.4) : fg.suit;
  return {
    suit: { cloth: suit, seam: mixHex(suit, INK, 0.45), band: tc.main, glove: k === 'alley' ? mixHex(LEATHER, INK, 0.3) : fg.glove, boot: fg.boot, sole: fg.sole, paint: fg.paint },
    headCut: squadHeadCut(k),
    weathered: true,
    // Alley cats are scrappier: the muzzle / claw-mark scar too, and the bitten ear.
    scars: k === 'alley' ? 2 : 1,
    scarSide: k === 'alley' ? 'R' : 'L',
    notch: true,
  };
}

interface Ctx {
  mb: MeshBuilder; plan: BodyPlan; team: TeamId; q: number; qf: number; lite: boolean; isCat: boolean;
  j: ReturnType<typeof computeJoints>; tc: ReturnType<typeof teamColors>; fg: ReturnType<typeof factionGear>; pad: number;
  hc: V3;
}

/** Torso shell hugging the body from the hips to the neck (the plate carrier's shape, so neckwear fits it). */
function shell(c: Ctx, color: ColorFn): void {
  const { plan, pad, q } = c;
  const y0 = plan.hipsY - 0.01, y1 = plan.neckY + 0.015;
  const ys: number[] = [];
  for (let i = 0; i <= 6; i++) ys.push(y0 + ((y1 - y0) * i) / 6);
  const path: V3[] = ys.map((y) => [0, y, torsoAt(plan, y)[2]]);
  const radii = ys.map((y, i): [number, number] => {
    const [rx, rz] = torsoAt(plan, y);
    const top = i === ys.length - 1 ? 0.8 : 1;
    return [(rx + pad) * top, (rz + pad) * top];
  });
  c.mb.add(sweep(path, radii, seg(12, q, 9), { up: [1, 0, 0], capStart: 0, capEnd: 0 }), color, { auto: ['hips', 'spine', 'chest'] });
}

/** The armour collar ring (the neckwear hugs it) in a given colour. */
function collarRing(c: Ctx, color: ColorFn | number): void {
  const ac = armourCollar(c.plan);
  c.mb.add(ring(ellipseLoop([0, ac.y, ac.cz], [ac.rx, 0, 0], [0, 0, ac.rz], seg(12, c.q, 8)), [ac.h, ac.t], c.lite ? 3 : 4, [0, 1, 0]), color, { auto: ['chest', 'neck'] });
}

/** The team collar + tags (corgi) / bell (cat), as gear.ts; left out when a C3 neckwear takes its place. */
function teamCollar(c: Ctx, strap: number): void {
  const { mb, plan, isCat, q, lite } = c;
  const colY = plan.neckY + 0.045;
  const nr = plan.neckR ?? [0.1, 0.095];
  mb.add(ring(ellipseLoop([0, colY, -0.01], [nr[0] + 0.008, 0, 0], [0, 0, nr[1] + 0.005], seg(10, q, 8)), [0.022, 0.018], 3, [0, 1, 0]), strap, { auto: ['chest', 'neck'] });
  const ty = colY - (isCat ? 0.035 : 0.042);
  const ruff = ruffShape(plan);
  const ry = (ty - ruff.c[1]) / ruff.r[1];
  const tz = Math.min(-(nr[1] + 0.023), ruff.c[2] - ruff.r[2] * Math.sqrt(Math.max(0, 1 - ry * ry)) * (1 + (ry < 0 ? ruff.tuft : 0)) - 0.008);
  mb.surface(SURF.fitting);
  if (isCat) mb.add(ellipsoid([0, ty, tz], [0.028, 0.03, 0.028], seg(6, q, 5), seg(5, q, 4)), BRASS, { rigid: 'neck' });
  else {
    mb.add(ellipsoid([-0.006, ty, tz], [0.021, 0.032, 0.006], seg(6, q, 5), 4, { p: 3, rot: [0, 0, 0.12] }), WORN_STEEL, { rigid: 'neck' });
    if (!lite) mb.add(ellipsoid([0.012, ty - 0.008, tz - 0.004], [0.021, 0.032, 0.006], 5, 4, { p: 3, rot: [0, 0, -0.2] }), mixHex(WORN_STEEL, GUNMETAL, 0.4), { rigid: 'neck' });
  }
}

/** A headgear dome over the cranium (the skull under it is culled by body.ts); returns its rim loop. */
function dome(c: Ctx, hg: Headgear, color: ColorFn | number, rows = 5): V3[] {
  const { plan, qf, hc } = c;
  const cr = plan.cranium;
  const R: V3 = [cr.r[0] + hg.grow, cr.r[1] + hg.grow, cr.r[2] + hg.grow];
  c.mb.add(helmetCap(seg(14, qf, 10), seg(rows, qf, 4), R, hg.cut.front, hg.cut.back, hg.p, hc, hg.cut.side), color, { rigid: 'head' });
  const loop: V3[] = [];
  const n = seg(14, qf, 10);
  for (let i = 0; i < n; i++) {
    const ph = (i / n) * Math.PI * 2;
    const side = hg.cut.side ?? Math.min(0.43, (hg.cut.front + hg.cut.back) / 2);
    const cc = Math.cos(ph);
    const th = (side + (hg.cut.front - side) * Math.max(0, cc) + (hg.cut.back - side) * Math.max(0, -cc)) * Math.PI;
    loop.push(capPoint(th, ph, R, hg.p, hc));
  }
  return loop;
}

/** Front (z < 0) or back surface z of the torso shell at height y, lifted by `off`. */
const shellZ = (c: Ctx, y: number, side: -1 | 1, off = 0): number => {
  const [, rz, z] = torsoAt(c.plan, y);
  return z + side * (rz + c.pad + off);
};

/**
 * A bottle cap (flat, crimped rim) at `p` facing `n` (unit, model space): the crown is `top`, the crimp and rim bare
 * metal. Built as a squat superellipsoid whose pole points along n.
 */
function bottleCap(c: Ctx, p: V3, r: number, depth: number, top: ColorFn | number, rim: number, skin: { rigid: string } | { auto: string[] }, W: number, H: number, rot: V3): void {
  const crimps = W; // one crimp per column: a star-ish rim that reads as a pressed cap up close
  const cap = ellipsoid([0, 0, 0], [r, depth, r], W, H, {
    p: 2.4, vMax: 0.62,
    mod: (u, v) => (v > 0.34 ? 1 + 0.07 * (Math.round(u * crimps) % 2 ? 1 : -0.4) * Math.min(1, (v - 0.34) * 5) : 1),
  });
  xform(cap, p, rot);
  const col: ColorFn = (x, y, z, u, v) => (v > 0.4 ? rim : typeof top === 'number' ? top : top(x, y, z, u, v));
  c.mb.add(cap, col, skin);
}

// ============================================================================================ ALLEY-CAT RAIDERS

function alleyGear(c: Ctx, collar: boolean): void {
  const { mb, plan, j, tc, q, qf, lite, isCat } = c;
  const H = plan.headY;

  // --- jerkin: patched leather, stitched seams, mud low down -----------------------------------------------------
  mb.begin('vest').surface(SURF.leather);
  const y1 = plan.neckY + 0.015;
  shell(c, (x, y, z) => {
    if (y > y1 - 0.03) return STITCH;
    const n = valueNoise3(x * 8 + 2.3, y * 8, z * 8, 61);
    const base = n > 0.64 ? PATCH : n < 0.28 ? mixHex(JERKIN, INK, 0.22) : JERKIN;
    return muddy(Math.abs(y - plan.spineY) < 0.012 ? STITCH : base, x, y, z, 0.2);
  });
  if (plan.hardened) collarRing(c, (x, y, z) => muddy(mixHex(JERKIN, INK, 0.2), x, y, z));

  // --- bottle caps sewn on the chest (scale armour), one of them a team-colour soda cap ---------------------------
  const caps: [number, number, number][] = [[-0.07, 0.035, 0], [0.055, 0.05, 1], [-0.005, -0.045, 2]];
  if (!lite) caps.push([0.075, -0.045, 3], [-0.08, -0.06, 4]);
  const capTop = [mixHex(BRASS, PALETTE.accentHot, 0.2), WORN_STEEL, tc.main, RUST, mixHex(BRASS, INK, 0.2)];
  for (const [x, dy, i] of caps) {
    const y = plan.chestY + dy;
    const z = shellZ(c, y, -1, 0.004);
    bottleCap(c, [x, y, z], 0.036, 0.012, capTop[(i + 1) % capTop.length], mixHex(WORN_STEEL, INK, 0.25), { auto: ['spine', 'chest'] }, seg(8, q, 6), seg(4, q, 3), [-Math.PI / 2, 0, 0]);
  }

  // --- bike-chain belt (alternating links) and a pouch ------------------------------------------------------------
  mb.surface(SURF.metal);
  const by = plan.hipsY - 0.005;
  const [brx, brz, bz] = torsoAt(plan, by);
  const beltN = seg(14, q, 10);
  mb.add(ring(ellipseLoop([0, by, bz], [brx + c.pad + 0.014, 0, 0], [0, 0, brz + c.pad + 0.014], beltN), [0.021, 0.017], 3, [0, 1, 0]),
    (x, y, z, _u, v) => muddy(Math.round(v * beltN) % 2 ? CHAIN : CHAIN_DARK, x, y, z, 0.2), { auto: ['hips', 'spine'] });
  mb.surface(SURF.cloth).add(ellipsoid([-brx - c.pad - 0.014, plan.hipsY + 0.012, bz - 0.02], [0.03, 0.046, 0.054], seg(6, q, 5), seg(5, q, 4), { p: 3.5 }),
    (x, y, z) => muddy(PATCH, x, y, z), { auto: ['hips', 'spine'] });

  // --- bike-chain bandolier: from the back over the right shoulder, down across the chest to the left hip ----------
  {
    const bp: V3[] = [];
    const yTop = plan.neckY + 0.005;
    const back = (y: number) => shellZ(c, y, 1, 0.012), front = (y: number) => shellZ(c, y, -1, 0.012);
    bp.push([0.04, plan.chestY - 0.1, back(plan.chestY - 0.1)], [0.1, yTop - 0.03, back(yTop - 0.03) - 0.01], [0.13, yTop + 0.02, torsoAt(plan, yTop)[2]]);
    const n = lite ? 4 : 6;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = 0.11 - 0.23 * t, y = yTop - 0.03 - (yTop - 0.03 - plan.hipsY - 0.03) * t;
      bp.push([x, y, front(y) - 0.012 * Math.sin(t * Math.PI)]); // clears the sewn caps mid-chest
    }
    const links = bp.length;
    mb.surface(SURF.metal).add(sweep(bp, bp.map(() => [0.016, 0.012] as [number, number]), lite ? 3 : 4, { up: [0, 0, 1], capStart: 1, capEnd: 1 }),
      (x, y, z, _u, v) => muddy(Math.round(v * (links - 1)) % 2 ? CHAIN : CHAIN_DARK, x, y, z, 0.2), { auto: ['chest', 'spine'] });
  }

  // --- the giant bottle cap pauldron (left shoulder; team-colour crown with a trim ring) --------------------------
  mb.begin('armour').surface(SURF.armor);
  {
    const k = SX.L, sh = j.shoulder.L, R = isCat ? 0.108 : 0.118;
    // a soda cap printed in the team colour, a thin dark ring round the crown (a printed logo's edge)
    const crown: ColorFn = (_x, _y, _z, _u, v) => (v > 0.22 && v < 0.29 ? mixHex(tc.main, INK, 0.55) : tc.main);
    const cap = ellipsoid([0, 0, 0], [R, R * 0.46, R], seg(9, q, 7), seg(5, q, 4), {
      p: 2.3, vMax: 0.62,
      mod: (u, v) => (v > 0.36 ? 1 + 0.08 * (Math.round(u * seg(9, q, 7)) % 2 ? 1 : -0.35) * Math.min(1, (v - 0.36) * 4) : 1),
    });
    xform(cap, [sh[0] + 0.02 * k, sh[1] + 0.022, sh[2] + 0.004], [0, 0, -0.45 * k]);
    mb.add(cap, (x, y, z, u, v) => (v > 0.4 ? paintAt(c.fg.paint, x, y, z, 1) : crown(x, y, z, u, v)), { rigid: 'upperArm.L' });
  }
  // a bottle-cap knee pad (left knee only: scavenged, not issued)
  {
    const kn = j.knee.L;
    bottleCap(c, [kn[0], kn[1] + 0.01, kn[2] - plan.thighR * 0.92], 0.05, 0.016, mixHex(BRASS, INK, 0.15), mixHex(WORN_STEEL, INK, 0.2), { rigid: 'shin.L' }, seg(8, q, 6), seg(4, q, 3), [-Math.PI / 2, 0, 0]);
  }

  // --- the knotted bandana (team colour, trim polka dots) with two tails streaming off the back of the head ----------
  mb.begin('kit').surface(SURF.cloth);
  const hg = HEAD.alley;
  const cr = plan.cranium;
  const dots: ColorFn = (x, y, z) => (valueNoise3(x * 38, y * 38, z * 38, 5) > 0.74 ? tc.trim : tc.main);
  const rim = dome(c, hg, dots, 5);
  mb.add(ring(rim, [0.011, 0.014], 3, [0, 1, 0]), mixHex(tc.main, INK, 0.3), { rigid: 'head' }); // rolled hem
  {
    const kz = c.hc[2] + cr.r[2] + hg.grow - 0.012, ky = c.hc[1] - cr.r[1] * 0.05;
    mb.add(ellipsoid([0, ky, kz], [0.034, 0.03, 0.026], seg(6, q, 5), seg(4, q, 3)), mixHex(tc.main, INK, 0.2), { rigid: 'head' });
    for (const s of [-1, 1]) {
      const tail: V3[] = [[0.012 * s, ky - 0.01, kz + 0.01], [0.05 * s, ky - 0.07, kz + 0.07], [0.075 * s, ky - 0.13, kz + 0.12], [0.085 * s, ky - 0.2, kz + 0.14]];
      mb.add(sweep(tail, [[0.009, 0.034], [0.008, 0.036], [0.007, 0.032], [0.005, 0.024]], lite ? 3 : 4, { up: [0, 0, 1], capStart: 1, capEnd: 1 }), dots, { rigid: 'head' });
    }
  }
  if (collar) teamCollar(c, mixHex(LEATHER, INK, 0.35));
  void H; void qf;
}

// ================================================================================================ TABBY HEAVIES

function heavyGear(c: Ctx, collar: boolean): void {
  const { mb, plan, j, tc, fg, q, qf, lite, isCat } = c;
  const paint: ColorFn = (x, y, z) => paintAt(fg.paint, x, y, z);

  // --- plate carrier (breacher thickness), faction paint, webbing sides ------------------------------------------
  mb.begin('vest').surface(SURF.armor);
  const y1 = plan.neckY + 0.015;
  shell(c, (x, y, z) => {
    if (y > y1 - 0.03) return mixHex(fg.suit, INK, 0.4);
    const [rx, rz, tz] = torsoAt(plan, y);
    const nx = x / (rx + c.pad), nz = (z - tz) / (rz + c.pad);
    if (Math.abs(nx) > 0.8 && Math.abs(nz) < 0.62) return muddy(fg.web, x, y, z);
    return paint(x, y, z, 0, 0);
  });
  if (plan.hardened) {
    const ac = armourCollar(plan);
    collarRing(c, (x, y, z) => paintAt(fg.paint, x, y, z, y > ac.y + ac.h * 0.55 ? 1 : 0));
  }
  // Double chest plate: a heavy breast plate and a lower belly plate, chipped at the rims; a team stripe between them.
  {
    const [crx] = torsoAt(plan, plan.chestY);
    const pw = crx * 1.3 * 0.55 + 0.012;
    for (const [dy, ph, stripe] of [[-0.005, 0.12, false], [-0.15, 0.075, true]] as const) {
      const cy = plan.chestY + dy, z = shellZ(c, cy, -1, 0.012) + 0.008;
      const col: ColorFn = (x, y, zz) => (stripe && y > cy + ph * 0.62 ? tc.main : paintAt(fg.paint, x, y, zz, zz > z - 0.03 * 0.3 ? 1 : 0));
      mb.add(ellipsoid([0, cy, z], [pw * (stripe ? 0.9 : 1), ph, 0.03], seg(10, q, 7), seg(6, q, 5), { p: 4.5 }), col, { auto: ['spine', 'chest'] });
    }
  }
  // Belt, buckle, one pouch.
  mb.surface(SURF.leather);
  const by = plan.hipsY - 0.005;
  const [brx, brz, bz] = torsoAt(plan, by);
  mb.add(ring(ellipseLoop([0, by, bz], [brx + c.pad + 0.012, 0, 0], [0, 0, brz + c.pad + 0.012], seg(12, q, 8)), [0.022, 0.016], 3, [0, 1, 0]), fg.web, { auto: ['hips', 'spine'] });
  if (!lite) mb.surface(SURF.fitting).add(ellipsoid([0, by, bz - brz - c.pad - 0.028], [0.036, 0.028, 0.013], 6, 4, { p: 4 }), fg.fitting, { rigid: 'hips' });
  mb.surface(SURF.cloth).add(ellipsoid([-brx - c.pad - 0.014, plan.hipsY + 0.012, bz - 0.02], [0.032, 0.048, 0.058], seg(6, q, 5), seg(5, q, 4), { p: 3.5 }),
    (x, y, z) => muddy(fg.pouch, x, y, z), { auto: ['hips', 'spine'] });
  if (collar) teamCollar(c, fg.web);

  // --- big layered pauldrons (team shells, faction rims), knee pads, thigh plates --------------------------------------
  mb.begin('armour').surface(SURF.armor);
  for (const s of SIDES) {
    const k = SX[s], sh = j.shoulder[s];
    const shellCol: ColorFn = (x, y, z, _u, v) => (v < 0.5 ? tc.main : paintAt(fg.paint, x, y, z, v > 0.58 ? 1 : 0));
    const R = isCat ? 0.118 : 0.13;
    mb.add(ellipsoid([sh[0] + 0.035 * k, sh[1] + 0.032, sh[2]], [R, R * 0.66, R * 0.92], seg(10, q, 7), seg(6, q, 5), { vMax: 0.62, p: 2.4, rot: [0, 0, -0.42 * k] }), shellCol, { rigid: `upperArm.${s}` });
    mb.surface(SURF.fitting).add(ellipsoid([sh[0] + 0.035 * k, sh[1] + 0.006, sh[2]], [R * 1.03, 0.03, R * 0.95], seg(10, q, 7), 4, { rot: [0, 0, -0.42 * k] }), fg.fitting, { rigid: `upperArm.${s}` });
    mb.surface(SURF.armor);
    const kn = j.knee[s];
    const kneeColor: ColorFn = (x, y, z) => paintAt(fg.paint, x, y, z, Math.abs(y - kn[1] - 0.008) > 0.05 ? 1 : 0);
    mb.add(ellipsoid([kn[0], kn[1] + 0.008, kn[2] - plan.thighR * 0.88], [0.06, 0.066, 0.028], seg(6, q, 4), seg(4, q, 3), { p: 3 }), kneeColor, { rigid: `shin.${s}` });
    const hp = j.hip[s], t: V3 = [hp[0] * 1.05, (hp[1] + kn[1]) / 2 + 0.01, (hp[2] + kn[2]) / 2 - plan.thighR * 0.9];
    mb.add(ellipsoid(t, [0.06, 0.052, 0.022], seg(6, q, 4), seg(4, q, 3), { p: 3.2, rot: [0.12, 0, 0] }), paint, { rigid: `thigh.${s}` });
  }

  // --- the bin-lid shield on the left forearm: galvanized dome, pressed ridges, dents, rust, a team roundel ----------
  // (armour, not metal: a full-metal surface mirrors the dark dusk sky and the lid went black; galvanized steel is dull)
  mb.begin('kit').surface(SURF.armor);
  {
    const fa = j.elbow.L, wr = j.wrist.L;
    const R = isCat ? 0.25 : 0.27;
    const mid: V3 = [(fa[0] + wr[0]) / 2 - 0.07, (fa[1] + wr[1]) / 2 + 0.01, (fa[2] + wr[2]) / 2 - 0.03];
    const W = seg(14, q, 9), Hh = seg(6, q, 4);
    // Pole along +Y, then turned to face out (-X) past the forearm, yawed to the front (the warden's shield mount).
    const lid = ellipsoid([0, 0, 0], [R, 0.075, R], W, Hh, {
      vMax: 0.5,
      mod: (u, v) => 1 - 0.05 * Math.max(0, valueNoise3(u * 7, v * 9, 1.3, 71) - 0.5) * 2, // dents
    });
    const rot: V3 = [0.3, 0.35, Math.PI / 2];
    xform(lid, mid, rot);
    const face: ColorFn = (x, y, z, _u, v) => {
      if (v < 0.27) return tc.main;                                           // the painted roundel
      if (v < 0.33) return tc.trim === PALETTE.teamCatsTrim ? INK : tc.trim;  // its border
      const ridge = Math.abs(v - 0.36) < 0.03 || Math.abs(v - 0.45) < 0.025;  // pressed rings
      const dent = valueNoise3(x * 11, y * 11, z * 11, 83) > 0.7;
      const rust = valueNoise3(x * 16 + 5, y * 16, z * 16, 29) > 0.76;
      return muddy(rust ? RUST : ridge || dent ? GALV_DARK : GALV, x, y, z, 0.2);
    };
    mb.add(lid, face, { rigid: 'foreArm.L' });
    // Rolled rim.
    const rimLoop: V3[] = ellipseLoop([0, 0, 0], [R * 1.005, 0, 0], [0, 0, R * 1.005], W).map((p) => [p[0], p[1] - 0.004, p[2]] as V3);
    const rimP = ring(rimLoop, [0.012, 0.016], 3, [0, 1, 0]);
    xform(rimP, mid, rot);
    mb.add(rimP, (x, y, z) => muddy(GALV_DARK, x, y, z, 0.2), { rigid: 'foreArm.L' });
    // The lid handle, outside (a bin lid's handle is on its crown).
    if (!lite) {
      const h = sweep([[-0.05, 0.068, 0], [-0.03, 0.098, 0], [0.03, 0.098, 0], [0.05, 0.068, 0]], [[0.011, 0.011], [0.011, 0.011], [0.011, 0.011], [0.011, 0.011]], 4, { up: [0, 0, 1], capStart: 1, capEnd: 1 });
      xform(h, mid, rot);
      mb.add(h, GALV_DARK, { rigid: 'foreArm.L' });
    }
  }

  // --- the heavy helmet: faction paint, a team band, a nasal guard; the lamp housing over the brow ------------------
  mb.surface(SURF.armor);
  const hg = HEAD.heavy;
  const cr = plan.cranium;
  const helmetPaint: ColorFn = (x, y, z, _u, v) => paintAt(fg.paint, x, y, z, v > 0.88 ? 1 : 0);
  const rimLoop = dome(c, hg, helmetPaint, 5);
  mb.add(ring(rimLoop, [0.022, 0.024], 3, [0, 1, 0]), tc.main, { rigid: 'head' });
  {
    const R: V3 = [cr.r[0] + hg.grow, cr.r[1] + hg.grow, cr.r[2] + hg.grow];
    const top = capPoint(hg.cut.front * 0.55 * Math.PI, 0, R, hg.p, c.hc), rimF = capPoint(hg.cut.front * Math.PI, 0, R, hg.p, c.hc);
    const nose: V3[] = [[0, top[1], top[2] - 0.006], [0, rimF[1], rimF[2] - 0.012], [0, rimF[1] - 0.075, rimF[2] - 0.028]];
    mb.surface(SURF.metal).add(sweep(nose, [[0.01, 0.017], [0.011, 0.02], [0.009, 0.016]], 4, { up: [0, 0, 1], capStart: 1, capEnd: 1 }), GUNMETAL, { rigid: 'head' });
    const lamp = helmetLamp(plan);
    mb.add(ellipsoid(lamp, [0.03, 0.021, 0.022], seg(6, q, 5), 4, { p: 3 }), GUNMETAL, { rigid: 'head' });
  }
  void qf;
}

/** Heavy helmet lamp (model space, head-rigid): on the helmet's left brow (the nasal guard takes the centre). */
function helmetLamp(plan: BodyPlan): V3 {
  const cr = plan.cranium, hg = HEAD.heavy;
  const hc: V3 = [0, plan.headY + cr.c[1], cr.c[2]];
  const p = capPoint(hg.cut.front * 0.66 * Math.PI, -0.62, [cr.r[0] + hg.grow, cr.r[1] + hg.grow, cr.r[2] + hg.grow], hg.p, hc);
  return [p[0], p[1] + 0.004, p[2] - 0.01];
}

/** Where the raider's bike light sits (model space, chest-rigid): on the bandolier over the left chest. */
function bikeLight(plan: BodyPlan, pad: number): V3 {
  const y = plan.chestY + 0.02;
  const [, rz, z] = torsoAt(plan, y);
  return [-0.045, y, z - rz - pad - 0.03];
}

/**
 * Squad gear (armour, kit, headgear) for `k`, in place of gear.ts buildGear. `collar` false leaves the team collar
 * out (a C3 neckwear takes its place).
 */
export function buildSquadGear(mb: MeshBuilder, plan: BodyPlan, k: SquadKit, team: TeamId, q: number, qf = q, collar = true): void {
  const cr = plan.cranium;
  const c: Ctx = {
    mb, plan, team, q, qf, lite: isLite(q), isCat: plan.species === 'cat', j: computeJoints(plan), tc: teamColors(team),
    fg: factionGear(plan.species), pad: carrierPad(BUILD[k]), hc: [0, plan.headY + cr.c[1], cr.c[2]],
  };
  if (k === 'alley') alleyGear(c, collar);
  else heavyGear(c, collar);
}

/** Squad team lamps (one team-colour glow mesh, like every class): the raider's bike light, the heavy's helmet lamp. */
export function buildSquadGlow(g: MeshBuilder, plan: BodyPlan, k: SquadKit, hero: boolean, color = 0): void {
  const W = hero ? 7 : 5, Hh = hero ? 4 : 3;
  if (k === 'alley') {
    const p = bikeLight(plan, carrierPad(BUILD.alley));
    g.add(ellipsoid([p[0], p[1], p[2] - 0.004], [0.02, 0.016, 0.01], W, Hh, { p: 3 }), color, { rigid: 'chest' });
  } else {
    const p = helmetLamp(plan);
    g.add(ellipsoid([p[0], p[1], p[2] - 0.02], [0.019, 0.015, 0.008], W, Hh), color, { rigid: 'head' });
  }
}

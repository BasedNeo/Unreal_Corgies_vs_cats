// Armour + class kit, HARDENED (K2, docs/design/HARDENED.md): veterans, not mascots. A plate carrier in faction paint
// (corgis hazard ochre with gunmetal/black camo blocks, cats oxblood with charcoal tiger-stripe camo, brass fittings)
// over a dark under-suit, chipped to bare metal at the rims and speckled with mud; shoulder plates, knee pads, boots and
// bracers (the last two live in body.ts), a utility belt with pouches, webbing straps and dog tags. Original designs.
//
// Team signal (blue + gold / crimson + black) never goes on the camo: it rides the shoulder plates, the sleeve
// armbands (body.ts), a small unit patch on the left chest, class markings (hat band, pennant, wing tips, ribbons) and
// the glowing helmet / visor / goggle lamps (buildGearGlow, a team-colour glow mesh), so a team reads in a firefight.
//
// K1 readability at 30–40 m: at that range a character is ~20–30 px tall and the ink hull turns
// interior detail into a dark blob, so each class owns ONE big shape that breaks the shared body
// outline in a different direction (checked by tests/unit/characters-k1.test.ts). Common armour hugs the body
// (≤ 3 cm proud) so it never blurs those shapes:
//   Assault     baseline: combat helmet with a lamp, medium pack + bedroll
//   Infiltrator hood with a long drooping tail behind the head, lean build, no backpack
//   Overwatch   wide boonie brim + a tall whip mast (team pennant, glowing beacon) above the head
//   Breacher    broad build, huge pauldrons, a flip-up visor, a satchel wider than the torso with strapped charges
//   Warden      a riot cone collar around the head (a disc from the front and back)
//   Skyraider   swept wings on the jet pack + a long scarf streaming behind
import { PALETTE } from '../../style/style-tokens.js';
import { Team, type ClassId, type TeamId } from '../../../shared/types';
import {
  mixHex, paintAt, muddy, INK, OCHRE, CAMO_BLACK, GUNMETAL, WORN_STEEL, OXBLOOD, CHARCOAL, BRASS, OLIVE, KHAKI, UNDERSUIT,
  type Paint,
} from './colors';
import { ellipsoid, sweep, ring, lathe, ellipseLoop, xform, seg, isLite, SURF, type ColorFn, type MeshBuilder, type Surf, type V3 } from './mesh-builder';
import { computeJoints, cutAngle, SIDES, SX, type HeadCut } from './skeleton';
import { ruffShape, type BodyDress } from './body';
import type { BodyPlan } from './species';

export interface TeamColors { main: number; trim: number; dark: number; light: number; emblem: number }

export function teamColors(team: TeamId): TeamColors {
  if (team === Team.Cats) return { main: PALETTE.teamCats, trim: PALETTE.teamCatsTrim, dark: mixHex(PALETTE.teamCats, PALETTE.ink, 0.35), light: mixHex(PALETTE.teamCats, PALETTE.catWhite, 0.25), emblem: PALETTE.accentHot };
  if (team === Team.Corgis) return { main: PALETTE.teamCorgis, trim: PALETTE.teamCorgisTrim, dark: mixHex(PALETTE.teamCorgis, PALETTE.ink, 0.35), light: mixHex(PALETTE.teamCorgis, PALETTE.catWhite, 0.25), emblem: PALETTE.teamCorgisTrim };
  return { main: PALETTE.hull, trim: PALETTE.hullDark, dark: PALETTE.hullDark, light: PALETTE.hullLight, emblem: PALETTE.accent };
}

const LEATHER = mixHex(PALETTE.fenceDark, PALETTE.mulch, 0.3);
/** Aviator scarf: off-white on both teams (reads against every coat), grubby after a week in the field. */
const SCARF = mixHex(mixHex(PALETTE.catWhite, PALETTE.corgiCream, 0.3), KHAKI, 0.25);
/** Hazard-yellow breaching charges (the K1 cue beside the Breacher's head). */
const CHARGE = mixHex(PALETTE.accentHot, OCHRE, 0.3);

/** Faction gear colours: the camo and everything that is not the team signal. */
export interface FactionGear {
  /** Armour plates. */
  paint: Paint;
  suit: number;
  /** Seams, hems, cuffs. */
  seam: number;
  glove: number;
  boot: number;
  sole: number;
  /** Straps, belt, collar webbing, cummerbund. */
  web: number;
  pouch: number;
  /** Buckles, tags, rims: steel (corgis) or brass (cats). */
  fitting: number;
  /** Soft headgear (boonie, cap) and the infiltrator hood. */
  soft: number;
  hood: number;
}

export function factionGear(species: 'corgi' | 'cat'): FactionGear {
  if (species === 'cat') {
    const suit = mixHex(CHARCOAL, INK, 0.45);
    return {
      paint: { base: OXBLOOD, camo: CHARCOAL, chip: mixHex(WORN_STEEL, BRASS, 0.35), scale: 6, stripes: true },
      suit, seam: mixHex(suit, INK, 0.5), glove: mixHex(OXBLOOD, INK, 0.62), boot: mixHex(CHARCOAL, INK, 0.25), sole: INK,
      web: mixHex(OXBLOOD, INK, 0.45), pouch: mixHex(CHARCOAL, OLIVE, 0.3), fitting: BRASS,
      soft: mixHex(CHARCOAL, OXBLOOD, 0.3), hood: mixHex(CHARCOAL, INK, 0.3),
    };
  }
  return {
    paint: { base: OCHRE, camo: CAMO_BLACK, chip: WORN_STEEL, scale: 7.5, stripes: false },
    suit: UNDERSUIT, seam: mixHex(UNDERSUIT, INK, 0.5), glove: mixHex(LEATHER, INK, 0.55), boot: mixHex(LEATHER, INK, 0.35), sole: INK,
    web: mixHex(OLIVE, INK, 0.5), pouch: OLIVE, fitting: WORN_STEEL,
    soft: mixHex(KHAKI, OLIVE, 0.35), hood: mixHex(UNDERSUIT, OLIVE, 0.3),
  };
}

/** Headgear dome per class: how far it grows off the cranium, where it is cut, how square it is. */
interface Headgear { grow: number; cut: HeadCut; p: number; rows?: number }
const HEADGEAR: Partial<Record<ClassId, Headgear>> = {
  assault: { grow: 0.022, cut: { front: 0.27, back: 0.6 }, p: 2.2 },
  infiltrator: { grow: 0.03, cut: { front: 0.25, back: 0.8, side: 0.7 }, p: 2.2, rows: 7 },
  overwatch: { grow: 0.024, cut: { front: 0.25, back: 0.5 }, p: 2.4 },
  breacher: { grow: 0.028, cut: { front: 0.29, back: 0.66 }, p: 2.8 },
  skyraider: { grow: 0.016, cut: { front: 0.3, back: 0.9 }, p: 2 },
};

/** The part of the cranium this class's headgear covers (the Warden's cone leaves the head bare). */
export function headCutFor(cls: ClassId): HeadCut | undefined {
  return HEADGEAR[cls]?.cut;
}

/** Shoulder plate radius per class (the Breacher has its own huge pauldrons). Kept close to the arm: K1 shapes rule. */
const SHOULDER: Record<ClassId, number> = { assault: 0.082, infiltrator: 0.064, overwatch: 0.068, breacher: 0, warden: 0.078, skyraider: 0.066 };

/** Warden riot cone profile (radius, z about the head centre): back rim b0 and front rim f0 (HARDENED: a wider flare). */
const CONE = { b0: [0.265, 0.06] as [number, number], f0: [0.43, -0.2] as [number, number], ry: 0.92 };

/** Which side carries the scar and the bitten ear: varies by class so a squad does not look cloned. */
const SCAR_SIDE: Record<ClassId, 'L' | 'R'> = { assault: 'L', infiltrator: 'R', overwatch: 'L', breacher: 'R', warden: 'L', skyraider: 'R' };

/** What the body wears for a kit (body.ts BodyDress): suit, boots, armbands, the hidden cranium, battle wear. */
export function dressFor(plan: BodyPlan, cls: ClassId, team: TeamId, veteran = false): BodyDress {
  const fg = factionGear(plan.species);
  return {
    suit: { cloth: fg.suit, seam: fg.seam, band: teamColors(team).main, glove: fg.glove, boot: fg.boot, sole: fg.sole, paint: fg.paint },
    headCut: headCutFor(cls),
    weathered: true,
    scars: veteran ? 2 : 1,
    scarSide: SCAR_SIDE[cls],
    notch: true,
  };
}

/** Torso radii at height y (interpolated from the plan) — gear hugs the body. */
export function torsoAt(plan: BodyPlan, y: number): [number, number, number] {
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

/** Plate-carrier thickness over the torso. */
const carrierPad = (cls: ClassId) => (cls === 'breacher' ? 0.04 : 0.026);
/** Chest plate: centre height, half width, half height, front z. */
function chestPlate(plan: BodyPlan, cls: ClassId) {
  const heavy = cls === 'breacher', pad = carrierPad(cls);
  const cy = plan.chestY - 0.005;
  const [crx, crz, cz] = torsoAt(plan, cy);
  const plateZ = cz - crz - pad - 0.012;
  return { cy, pw: crx * (heavy ? 1.3 : 1.12) * 0.55 + 0.012, ph: (heavy ? 0.23 : 0.19) * 0.5 + 0.012, z: plateZ + 0.008, depth: 0.03 };
}

export interface GearOptions {
  /** Elite / veteran (sergeant, commander): striped shoulder plates, a crest or rank badge, thigh plates; cats an eye patch. */
  veteran?: boolean;
}

/**
 * `collar` false leaves out the team collar and its tags / bell: a C3 neckwear (src/client/procgen/cosmetics) takes
 * that spot, and the ~100 triangles it frees pay for the neckwear, so a kit with any look stays in budget.
 */
export function buildGear(mb: MeshBuilder, plan: BodyPlan, cls: ClassId, team: TeamId, q: number, qf = q, collar = true, o: GearOptions = {}): void {
  const j = computeJoints(plan);
  const tc = teamColors(team);
  const fg = factionGear(plan.species);
  const H = plan.headY;
  const isCat = plan.species === 'cat';
  const heavy = cls === 'breacher';
  const vet = !!o.veteran;
  const lite = isLite(q);
  const pad = carrierPad(cls);
  const paint: ColorFn = (x, y, z) => paintAt(fg.paint, x, y, z);
  /** Rank colour (veterans): gold on corgis, brass on cats (the cats' trim is black). */
  const rank = isCat ? BRASS : tc.trim;

  mb.begin('vest').surface(SURF.armor);
  // --- plate carrier: a closed shell over the torso. Armour paint front and back, dark webbing cummerbund at the
  // sides, a seam between the upper and lower plates, a dark hem at the neck.
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
    if (y > y1 - 0.03) return fg.seam;
    const [rx, rz, tz] = torsoAt(plan, y);
    const nx = x / (rx + pad), nz = (z - tz) / (rz + pad);
    if (Math.abs(nx) > 0.8 && Math.abs(nz) < 0.62) return muddy(fg.web, x, y, z);
    if (Math.abs(y - plan.spineY) < 0.014) return fg.seam;
    return paint(x, y, z, 0, 0);
  };
  mb.add(sweep(vestPath, vestR, seg(12, q, 9), { up: [1, 0, 0], capStart: 1, capEnd: 1, capStartLen: 0.25, capEndLen: 0.35 }), vestColor, { auto: ['hips', 'spine', 'chest'] });
  // Armoured collar: the carrier rises round the neck (the fur ruff spills over it at the throat).
  if (plan.hardened) {
    const ac = armourCollar(plan);
    const collarColor: ColorFn = (x, y, z) => paintAt(fg.paint, x, y, z, y > ac.y + ac.h * 0.55 ? 1 : 0);
    mb.add(ring(ellipseLoop([0, ac.y, ac.cz], [ac.rx, 0, 0], [0, 0, ac.rz], seg(12, q, 8)), [ac.h, ac.t], lite ? 3 : 4, [0, 1, 0]), collarColor, { auto: ['chest', 'neck'] });
  }

  // Chest plate: one thick plate, chipped to bare metal round its rim.
  const cp = chestPlate(plan, cls);
  // (Rim = every vertex off the front face: the plate's thickness reads as a bare-metal edge.)
  const plateColor: ColorFn = (x, y, z) => paintAt(fg.paint, x, y, z, z > cp.z - cp.depth * 0.3 ? 1 : 0);
  mb.add(ellipsoid([0, cp.cy, cp.z], [cp.pw, cp.ph, cp.depth], seg(10, q, 7), seg(6, q, 5), { p: 4.5 }), plateColor, { auto: ['spine', 'chest'] });
  // Unit patch on the left chest (team colour, trim border): clear of C3 neckwear, which drapes onto the plate's centre.
  mb.surface(SURF.cloth);
  {
    const px = -cp.pw * 0.5, py = cp.cy + cp.ph * 0.36, pr = 0.044;
    const patch: ColorFn = (x, y) => (Math.hypot((x - px) / pr, (y - py) / (pr * 0.85)) > 0.72 ? tc.trim : tc.main);
    mb.add(ellipsoid([px, py, cp.z - cp.depth + 0.004], [pr, pr * 0.85, 0.01], seg(7, q, 5), seg(4, q, 3), { p: 3 }), patch, { auto: ['spine', 'chest'] });
  }

  // Utility belt: webbing ring, steel/brass buckle, pouches (left hip always; front-right and back on the hero tier).
  mb.surface(SURF.leather);
  const by = plan.hipsY - 0.005;
  const [brx, brz, bz] = torsoAt(plan, by);
  mb.add(ring(ellipseLoop([0, by, bz], [brx + pad + 0.012, 0, 0], [0, 0, brz + pad + 0.012], seg(12, q, 8)), [0.021, 0.015], 3, [0, 1, 0]), fg.web, { auto: ['hips', 'spine'] });
  if (!lite) mb.surface(SURF.fitting).add(ellipsoid([0, by, bz - brz - pad - 0.028], [0.034, 0.027, 0.013], 6, 4, { p: 4 }), fg.fitting, { rigid: 'hips' });
  mb.surface(SURF.cloth);
  const pouchColor: ColorFn = (x, y, z) => muddy(y > by + 0.03 ? mixHex(fg.pouch, INK, 0.3) : fg.pouch, x, y, z);
  const pouch = (x: number, z: number, r: V3) => mb.add(ellipsoid([x, plan.hipsY + 0.012, z], r, seg(6, q, 5), seg(5, q, 4), { p: 3.5 }), pouchColor, { auto: ['hips', 'spine'] });
  pouch(-brx - pad - 0.014, bz - 0.02, [0.032, 0.048, 0.058]);
  if (!lite) {
    pouch(brx * 0.62, bz - brz - pad - 0.02, [0.04, 0.042, 0.026]);
    if (cls !== 'infiltrator') pouch(-brx * 0.45, bz + brz + pad + 0.018, [0.045, 0.04, 0.026]);
  }
  // Webbing shoulder straps (front → over the shoulder → back).
  for (const s of SIDES) {
    const k = SX[s];
    const [, srz] = torsoAt(plan, plan.chestY + 0.06);
    const path: V3[] = [[0.085 * k, plan.chestY + 0.05, -srz - pad + 0.005], [0.12 * k, plan.neckY + 0.02, -0.06], [0.125 * k, plan.neckY + 0.035, 0.02], [0.1 * k, plan.chestY + 0.05, srz + pad - 0.005]];
    mb.add(sweep(path, [[0.014, 0.03], [0.014, 0.03], [0.014, 0.03], [0.014, 0.03]], 3, { up: [0, 1, 0], capStart: 1, capEnd: 1 }), fg.web, { auto: ['chest', 'neck'] });
  }
  // Collar + tags: corgis wear two steel dog tags (one on the NPC tier), cats a brass bell.
  const colY = plan.neckY + 0.045;
  if (collar) {
    const nr = plan.neckR ?? [0.1, 0.095];
    mb.add(ring(ellipseLoop([0, colY, -0.01], [nr[0] + 0.008, 0, 0], [0, 0, nr[1] + 0.005], seg(10, q, 8)), [0.022, 0.018], 3, [0, 1, 0]), fg.web, { auto: ['chest', 'neck'] });
    // Tags hang on the front of the fur ruff (it spills over the armour collar at the throat).
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

  mb.begin('armour').surface(SURF.armor);
  // --- shoulder plates (team signal on top, faction paint chipped at the rim), knee pads -------------------------
  const R = SHOULDER[cls] * (vet ? 1.12 : 1) * (isCat ? 0.86 : 1);
  // The whole outer shell carries the team signal (seen from the front, the back and above); the rim is faction paint,
  // chipped. Veterans: a rank stripe (gold / brass) round the shell.
  const shoulderColor: ColorFn = (x, y, z, _u, v) => (v < 0.5 ? (vet && v > 0.24 && v < 0.36 ? rank : tc.main) : paintAt(fg.paint, x, y, z, v > 0.58 ? 1 : 0));
  for (const s of SIDES) {
    const k = SX[s];
    const sh = j.shoulder[s];
    if (R > 0) {
      mb.add(ellipsoid([sh[0] + 0.014 * k, sh[1] + 0.018, sh[2] + 0.004], [R, R * 0.64, R * 0.95], seg(8, q, 6), seg(5, q, 4), { vMax: 0.6, p: 2.3, rot: [0, 0, -0.42 * k] }), shoulderColor, { rigid: `upperArm.${s}` });
    }
    const kn = j.knee[s], kp = heavy || vet ? 1.18 : 1;
    const kneeColor: ColorFn = (x, y, z) => paintAt(fg.paint, x, y, z, Math.abs(y - kn[1] - 0.008) > 0.042 * kp ? 1 : 0);
    mb.add(ellipsoid([kn[0], kn[1] + 0.008, kn[2] - plan.thighR * 0.88], [0.05 * kp, 0.056 * kp, 0.026], seg(6, q, 4), seg(4, q, 3), { p: 3 }), kneeColor, { rigid: `shin.${s}` });
    if (vet) {
      // Veterans: a plate on the front of each thigh.
      const hp = j.hip[s], t: V3 = [hp[0] * 1.05, (hp[1] + kn[1]) / 2 + 0.01, (hp[2] + kn[2]) / 2 - plan.thighR * 0.9];
      mb.add(ellipsoid(t, [0.058, 0.05, 0.022], seg(6, q, 4), seg(4, q, 3), { p: 3.2, rot: [0.12, 0, 0] }), (x, y, z) => paintAt(fg.paint, x, y, z), { rigid: `thigh.${s}` });
    }
  }

  mb.begin('kit').surface(SURF.armor);
  // --- class kit ---------------------------------------------------------------------------
  const cr = plan.cranium;
  const hc: V3 = [0, H + cr.c[1], cr.c[2]];
  const back = (y: number): number => { const [, rz, z] = torsoAt(plan, y); return z + rz + pad; };
  const hg = HEADGEAR[cls];
  const R3 = (g: number): V3 => [cr.r[0] + g, cr.r[1] + g, cr.r[2] + g];

  /** Headgear dome: the cranium's upper cap, cut by the class's line. Returns the rim loop. */
  const dome = (color: ColorFn | number, rows = hg?.rows ?? 5) => {
    const W = seg(14, qf, 10), Hh = seg(rows, qf, 4);
    mb.add(helmetCap(W, Hh, R3(hg!.grow), hg!.cut.front, hg!.cut.back, hg!.p, hc, hg!.cut.side), color, { rigid: 'head' });
    const loop: V3[] = [];
    const n = seg(14, qf, 10);
    for (let i = 0; i < n; i++) {
      const ph = (i / n) * Math.PI * 2;
      loop.push(capPoint(cutAngle(ph, hg!.cut.front, hg!.cut.back, hg!.cut.side), ph, R3(hg!.grow), hg!.p, hc));
    }
    return loop;
  };
  const helmetPaint: ColorFn = (x, y, z, _u, v) => paintAt(fg.paint, x, y, z, v > 0.88 ? 1 : 0);
  const rimN = 3; // rims, bands: a 3-sided section reads the same under the ink line and pays for the armour
  /** Veterans on helmet classes: a low crest along the helmet's centre line. */
  const crest = (after: Surf) => {
    if (!vet || !hg) return;
    const at = (th: number, ph: number): V3 => capPoint(th * Math.PI, ph, R3(hg.grow + 0.014), hg.p, hc);
    const path = [at(hg.cut.front * 0.85, 0), at(hg.cut.front * 0.3, 0), at(0.1, Math.PI), at(hg.cut.back * 0.75, Math.PI)];
    mb.surface(SURF.fitting).add(sweep(path, [[0.014, 0.018], [0.018, 0.03], [0.018, 0.028], [0.013, 0.016]], lite ? 4 : 5, { up: [1, 0, 0], capStart: 1, capEnd: 1 }), rank, { rigid: 'head' });
    mb.surface(after);
  };
  /** Veterans on soft headgear: a rank badge on the front. */
  const badge = (p: V3, after: Surf) => { if (vet) mb.surface(SURF.fitting).add(ellipsoid(p, [0.026, 0.026, 0.009], seg(6, q, 5), 4, { p: 2.6 }), rank, { rigid: 'head' }).surface(after); };

  switch (cls) {
    case 'assault': {
      const loop = dome(helmetPaint);
      mb.add(ring(loop, [0.014, 0.018], rimN, [0, 1, 0]), tc.main, { rigid: 'head' }); // team band round the helmet
      // Helmet lamp housing above the brow (the lens is a team-colour glow: buildGearGlow).
      mb.surface(SURF.metal).add(ellipsoid(lampHousing(plan), [0.03, 0.021, 0.022], seg(6, q, 5), 4, { p: 3 }), GUNMETAL, { rigid: 'head' });
      crest(SURF.cloth);
      // Compact pack + bedroll; a team band round the pack (seen from behind).
      const py2 = plan.chestY - 0.03;
      const packColor: ColorFn = (x, y, z) => (Math.abs(y - py2 - 0.02) < 0.036 ? tc.main : muddy(fg.pouch, x, y, z));
      mb.add(ellipsoid([0, py2, back(py2) + 0.05], [0.13, 0.12, 0.06], seg(8, q, 6), seg(6, q, 4), { p: 3.5 }), packColor, { rigid: 'chest' });
      mb.add(xform(sweep([[-0.13, 0, 0], [0.13, 0, 0]], [[0.04, 0.04], [0.04, 0.04]], seg(8, q, 6), { up: [0, 1, 0], capStart: 1, capEnd: 1, capStartLen: 0.4, capEndLen: 0.4 }), [0, py2 + 0.13, back(py2) + 0.05]), mixHex(OLIVE, KHAKI, 0.3), { rigid: 'chest' });
      break;
    }
    case 'infiltrator': {
      // Hood (dark, framing the face; ears poke through) whose peak droops into a long tail behind the
      // head — the side/back silhouette. Lean build (species.ts CLASS_BUILD), no backpack.
      mb.surface(SURF.cloth);
      const hood = fg.hood;
      const hoodColor: ColorFn = (x, y, z) => (mottled(x, y, z) ? mixHex(hood, INK, 0.3) : hood);
      // A team trim round the face opening and the nape (the hood's last row).
      dome((x, y, z, u, v) => (v > 0.84 ? tc.main : hoodColor(x, y, z, u, v)));
      // The peak flops over to the left and hangs past the ear: an asymmetric head outline that no
      // other class has, from the front and from behind.
      const g = hg!.grow, Rx = cr.r[0] + g, RY = cr.r[1] + g, RZ = cr.r[2] + g;
      const tail: V3[] = [
        [0, hc[1] + RY * 0.72, hc[2] + RZ * 0.55],
        [-Rx * 0.25, hc[1] + RY * 1.06, hc[2] + RZ * 0.85],
        [-Rx * 0.95, hc[1] + RY * 0.95, hc[2] + RZ * 0.9],
        [-Rx * 1.35, hc[1] + RY * 0.35, hc[2] + RZ * 0.75],
        [-Rx * 1.45, hc[1] - RY * 0.45, hc[2] + RZ * 0.55],
        [-Rx * 1.35, hc[1] - RY * 1.1, hc[2] + RZ * 0.45],
      ];
      mb.add(sweep(tail, [[0.1, 0.1], [0.075, 0.07], [0.058, 0.052], [0.046, 0.04], [0.03, 0.026], [0.014, 0.012]], seg(8, q, 5), { up: [0, 0, 1], capStart: 0, capEnd: 2, capEndLen: 1.2 }), hoodColor, { rigid: 'head' });
      // A mask knot at the back: two ribbon tails in team colour (the infiltrator's team mark from behind).
      {
        const ky = hc[1] - 0.01, kz = hc[2] + cr.r[2] + 0.02;
        for (const k of [-1, 1]) mb.add(sweep([[0.02 * k, ky, kz], [0.05 * k, ky - 0.07, kz + 0.05], [0.055 * k, ky - 0.15, kz + 0.06]], [[0.007, 0.026], [0.007, 0.024], [0.005, 0.018]], lite ? 3 : 4, { up: [0, 0, 1], capStart: 1, capEnd: 1 }), tc.main, { rigid: 'head' });
      }
      badge([0, hc[1] + (cr.r[1] + g) * 0.72, hc[2] - (cr.r[2] + g) * 0.66], SURF.cloth);
      // No pack: the unit patch goes on the back plate, between the shoulder blades.
      {
        const py = plan.chestY + 0.015, pz = back(py) + 0.004;
        mb.add(ellipsoid([0, py, pz], [0.06, 0.05, 0.012], seg(7, q, 5), seg(4, q, 3), { p: 3 }), (x, y) => (Math.abs(x) > 0.043 || Math.abs(y - py) > 0.034 ? tc.trim : tc.main), { auto: ['spine', 'chest'] });
      }
      // Hip pouch instead of a pack (keeps the back flat).
      const [prx, , pz] = torsoAt(plan, plan.hipsY + 0.02);
      mb.add(ellipsoid([prx + pad + 0.012, plan.hipsY - 0.005, pz + 0.02], [0.03, 0.05, 0.06], seg(6, q, 5), seg(5, q, 4), { p: 3.5 }), pouchColor, { auto: ['hips', 'spine'] });
      break;
    }
    case 'overwatch': {
      // Boonie hat: soft crown + wide brim, team hat-band; the brim edge frayed dark.
      mb.surface(SURF.cloth);
      const soft: ColorFn = (x, y, z) => (mottled(x, y, z) ? mixHex(fg.soft, INK, 0.28) : fg.soft);
      const crown = dome(soft);
      mb.add(ring(crown, [0.014, 0.02], rimN, [0, 1, 0]), tc.main, { rigid: 'head' });
      const brimY = hc[1] + cr.r[1] * 0.74;
      const brimRx = cr.r[0] * 0.78 + 0.12, brimRz = cr.r[2] * 0.78 + 0.12;
      const brimColor: ColorFn = (x, y, z) => (Math.hypot(x / brimRx, (z - hc[2] - 0.015) / brimRz) > 0.93 ? mixHex(fg.soft, INK, 0.45) : soft(x, y, z, 0, 0));
      mb.add(ring(ellipseLoop([0, brimY, hc[2] + 0.015], [brimRx, 0, 0], [0, 0, brimRz], seg(20, q, 14)), [0.008, 0.08], lite ? 3 : 4, [0, 1, 0]), brimColor, { rigid: 'head' });
      badge([0, brimY + 0.05, hc[2] - cr.r[2] * 0.85 - 0.02], SURF.cloth);
      // Flip-up targeting monocle on the right side of the hat (its lens glows: buildGearGlow).
      if (!lite) {
        mb.surface(SURF.metal);
        const mo = monoclePos(plan);
        mb.add(ring(ellipseLoop(mo, [0.036, 0, 0], [0, 0.036, 0], seg(10, q, 8)), 0.011, 3, [0, 0, 1]), fg.fitting, { rigid: 'head' });
        mb.add(sweep([[mo[0] + 0.03, mo[1] - 0.005, mo[2] + 0.01], [hc[0] + cr.r[0] * 0.8, mo[1] + 0.01, hc[2] - 0.02]], [[0.009, 0.009], [0.009, 0.009]], 4, { up: [0, 1, 0], capStart: 1, capEnd: 1 }), fg.fitting, { rigid: 'head' });
      }
      // Radio pack with a tall whip mast: team pennant near the top, glowing beacon on the tip
      // (buildGearGlow) — the Overwatch reads as a vertical line + a lamp above the head at any range.
      const py2 = plan.chestY - 0.03;
      const bz2 = back(py2);
      mb.surface(SURF.cloth).add(ellipsoid([0, py2, bz2 + 0.055], [0.12, 0.14, 0.065], seg(10, q, 7), seg(8, q, 5), { p: 4 }), (x, y, z) => (Math.abs(y - py2 - 0.04) < 0.028 ? tc.main : muddy(mixHex(OLIVE, GUNMETAL, 0.5), x, y, z)), { rigid: 'chest' });
      const m = mastPath(plan);
      mb.surface(SURF.metal).add(sweep(m, [[0.016, 0.016], [0.013, 0.013], [0.011, 0.011], [0.009, 0.009]], seg(6, q, 4), { up: [0, 0, 1], capStart: 1, capEnd: 1 }), GUNMETAL, { rigid: 'chest' });
      mb.surface(SURF.cloth);
      const pt = m[2], pb = m[3];
      const pen: V3 = [(pt[0] + pb[0]) / 2 + 0.004, (pt[1] + pb[1]) / 2 - 0.04, (pt[2] + pb[2]) / 2 + 0.075];
      mb.add(ellipsoid(pen, [0.008, 0.055, 0.085], seg(8, q, 6), seg(5, q, 4), { p: 2.4, rot: [-0.25, 0, 0] }), tc.main, { rigid: 'chest' });
      break;
    }
    case 'breacher': {
      // Heavy boxy helmet with a flip-up welding visor (its slit glows: buildGearGlow); huge pauldrons; a satchel
      // wider than the torso with two strapped charges on top (broad build from species.ts CLASS_BUILD).
      const loop = dome(helmetPaint);
      mb.add(ring(loop, [0.024, 0.024], rimN, [0, 1, 0]), tc.main, { rigid: 'head' }); // team band round the helmet
      const vz = visorPos(plan);
      mb.add(ellipsoid(vz, [0.13, 0.05, 0.03], seg(10, q, 7), seg(4, q, 3), { p: 3.2, rot: [-0.55, 0, 0] }), (x, y, z) => paintAt(fg.paint, x, y, z, y > vz[1] + 0.03 ? 1 : 0), { rigid: 'head' });
      crest(SURF.armor);
      for (const s of SIDES) {
        const k = SX[s];
        const sh = j.shoulder[s];
        const big: ColorFn = (x, y, z, _u, v) => (v < 0.5 ? (vet && v > 0.24 && v < 0.36 ? rank : tc.main) : paintAt(fg.paint, x, y, z, v > 0.58 ? 1 : 0));
        // HARDENED: 10% bigger than K1's, so the armoured standard classes (shoulder plates) stay well clear of it.
        mb.add(ellipsoid([sh[0] + 0.042 * k, sh[1] + 0.04, sh[2]], [0.148, 0.1, 0.136], seg(10, q, 7), seg(7, q, 5), { vMax: 0.62, p: 2.4, rot: [0, 0, -0.42 * k] }), big, { rigid: `upperArm.${s}` });
        mb.add(ellipsoid([sh[0] + 0.042 * k, sh[1] + 0.014, sh[2]], [0.153, 0.034, 0.141], seg(10, q, 7), 4, { rot: [0, 0, -0.42 * k] }), fg.fitting, { rigid: `upperArm.${s}` });
      }
      const py2 = plan.chestY - 0.035;
      const bz2 = back(py2);
      const [trx] = torsoAt(plan, py2);
      // Satchel sticks out past the arms; two upright charges at its corners rise beside the head.
      const sw = trx + pad + 0.14;
      mb.surface(SURF.cloth);
      const satchel: ColorFn = (x, y, z) => (Math.abs(y - py2) < 0.02 ? tc.main : muddy(mixHex(fg.pouch, INK, 0.25), x, y, z));
      mb.add(ellipsoid([0, py2, bz2 + 0.115], [sw, 0.17, 0.115], seg(10, q, 8), seg(7, q, 5), { p: 4 }), satchel, { rigid: 'chest' });
      for (const k of [-1, 1]) {
        const cx = k * (sw - 0.05);
        mb.surface(SURF.plastic).add(sweep([[cx, py2 - 0.02, bz2 + 0.12], [cx + 0.018 * k, py2 + 0.39, bz2 + 0.145]], [[0.052, 0.052], [0.052, 0.052]], seg(8, q, 6), { up: [0, 0, 1], capStart: 1, capEnd: 1, capStartLen: 0.4, capEndLen: 0.4 }), (x, y, z) => (mottled(x * 2, y, z) ? mixHex(CHARGE, INK, 0.2) : CHARGE), { rigid: 'chest' });
        if (!lite) mb.surface(SURF.cloth).add(ring(ellipseLoop([cx + 0.01 * k, py2 + 0.22, bz2 + 0.135], [0.056, 0, 0], [0, 0, 0.056], seg(8, q, 7)), 0.009, 3, [0, 1, 0]), fg.web, { rigid: 'chest' });
      }
      break;
    }
    case 'warden': {
      // Riot cone collar (a pet recovery cone, armoured): a thin flared shell around the head in faction paint with
      // a dark reinforcing band and two riot lamps on the rim (buildGearGlow). A disc from the front and back.
      const d = [0.14, -0.25], dl = Math.hypot(d[0], d[1]);
      const dx = d[0] / dl, dz = d[1] / dl, nx = -dz, nz = dx; // wall direction + its outward normal
      const b0 = CONE.b0, f0 = CONE.f0;
      const t = 0.018;
      const prof: [number, number][] = [
        b0, [f0[0] - dx * 0.004, f0[1] - dz * 0.004], [f0[0] + dx * 0.006 + nx * t * 0.5, f0[1] + dz * 0.006 + nz * t * 0.5],
        [f0[0] + nx * t, f0[1] + nz * t], [b0[0] + nx * t, b0[1] + nz * t], [b0[0] - dx * 0.006 + nx * t * 0.5, b0[1] - dz * 0.006 + nz * t * 0.5],
      ];
      const cone = xform(lathe(prof, seg(18, q, 12), 1, CONE.ry), [hc[0], hc[1] - 0.01, hc[2] - 0.02]);
      // Profile rings: 0 inner back, 1 inner front, 2–3 the front lip, 4–5 the outer back. The dish and the lip round
      // the face are team colour (riot gear wears high-visibility marks, and it frames the face); faction paint behind.
      const coneColor: ColorFn = (x, y, z, _u, v) => (v < 0.55 ? tc.main : paintAt(fg.paint, x, y, z, v > 0.9 ? 1 : 0));
      mb.add(cone, coneColor, { rigid: 'head' });
      badge([0, hc[1] + cr.r[1] * 0.95, hc[2] - cr.r[2] * 0.55], SURF.armor);
      // Riot shield on the left forearm: faction paint with a team border.
      const fa = j.elbow.L, wr = j.wrist.L;
      const mid: V3 = [(fa[0] + wr[0]) / 2 - 0.05, (fa[1] + wr[1]) / 2, (fa[2] + wr[2]) / 2 - 0.02];
      const shieldColor: ColorFn = (x, y, z, _u, v) => (v > 0.3 && v < 0.7 && Math.abs(y - mid[1]) > 0.1 ? tc.main : paintAt(fg.paint, x, y, z));
      mb.add(ellipsoid(mid, [0.02, 0.15, 0.13], seg(12, q, 8), seg(7, q, 5), { p: 2.2, rot: [0, 0.35, 0.3] }), shieldColor, { rigid: 'foreArm.L' });
      if (!lite) mb.add(ellipsoid([mid[0] - 0.012, mid[1], mid[2]], [0.012, 0.075, 0.065], seg(10, q, 7), seg(6, q, 4), { rot: [0, 0.35, 0.3] }), tc.main, { rigid: 'foreArm.L' });
      // Water tank on the back (feeds the sprinkler cannon).
      const py2 = plan.chestY - 0.02;
      const bz2 = back(py2);
      mb.surface(SURF.metal).add(xform(sweep([[0, -0.12, 0], [0, 0.12, 0]], [[0.075, 0.075], [0.075, 0.075]], seg(12, q, 8), { up: [0, 0, 1], capStart: 2, capEnd: 2, capStartLen: 0.6, capEndLen: 0.6 }), [0, py2, bz2 + 0.08]), (x, y, z) => (Math.abs(y - py2 - 0.07) < 0.03 ? tc.main : muddy(mixHex(PALETTE.water, GUNMETAL, 0.35), x, y, z)), { rigid: 'chest' });
      mb.add(ring(ellipseLoop([0, py2, bz2 + 0.08], [0.079, 0, 0], [0, 0, 0.079], seg(12, q, 8)), 0.012, rimN, [0, 1, 0]), tc.main, { rigid: 'chest' });
      break;
    }
    case 'skyraider': {
      // Leather aviator cap, goggles on the forehead (the lenses glow: buildGearGlow), a long grubby scarf, a
      // twin-fan pack with swept wings (team tips).
      mb.surface(SURF.leather);
      const loop = dome((x, y, z) => (mottled(x, y, z) ? mixHex(LEATHER, INK, 0.3) : LEATHER));
      mb.add(ring(loop, [0.013, 0.016], rimN, [0, 1, 0]), tc.main, { rigid: 'head' }); // team band round the cap
      const [gy, gz] = goggleYZ(plan);
      mb.surface(SURF.metal);
      for (const s of [-1, 1]) mb.add(ring(ellipseLoop([0.07 * s, gy, gz], [0.045, 0, 0], [0, 0.04, 0.02], seg(10, q, 8)), 0.013, lite ? 3 : 4, [0, 0, 1]), fg.fitting, { rigid: 'head' });
      badge([0, gy + 0.06, gz + 0.012], SURF.cloth);
      // Scarf: two long streamers flying straight back from the collar like a flag, on edge, so the
      // aviator reads from the side too (a horizontal band trailing behind the head).
      mb.surface(SURF.cloth);
      const sy = plan.neckY + 0.04;
      for (const k of [-1, 1]) {
        const path: V3[] = [[0.03 * k, sy, 0.09], [0.05 * k, sy + 0.025 + 0.02 * k, 0.26], [0.065 * k, sy - 0.005 + 0.02 * k, 0.43], [0.08 * k, sy + 0.035 + 0.03 * k, 0.6]];
        mb.add(sweep(path, [[0.045, 0.011], [0.05, 0.011], [0.046, 0.009], [0.036, 0.008]], seg(6, q, 4), { up: [0, 1, 0], capStart: 1, capEnd: 1 }), (x, y, z) => (z > 0.45 ? mixHex(SCARF, KHAKI, 0.4) : SCARF), { auto: ['chest', 'neck'] });
      }
      const py2 = plan.chestY - 0.02;
      const bz2 = back(py2);
      for (const s of [-1, 1]) {
        // Fan housing: gunmetal with a team-colour intake cowl (the skyraider's mark from behind).
        mb.surface(SURF.metal).add(xform(sweep([[0, -0.14, 0], [0, 0.1, 0]], [[0.05, 0.05], [0.06, 0.06]], seg(10, q, 7), { up: [0, 0, 1], capStart: 1, capEnd: 2, capStartLen: 0.5 }), [0.07 * s, py2, bz2 + 0.06]), (_x, y) => (y > py2 + 0.08 ? tc.main : GUNMETAL), { rigid: 'chest' });
        mb.add(ring(ellipseLoop([0.07 * s, py2 - 0.12, bz2 + 0.06], [0.056, 0, 0], [0, 0, 0.056], seg(10, q, 7)), 0.012, rimN, [0, 1, 0]), tc.main, { rigid: 'chest' });
        // Swept, dihedral wing: a raised "V" behind the arms from the front, a fin from the side; team-colour tips.
        mb.surface(SURF.armor);
        const wing = ellipsoid([0, 0, 0], [0.3, 0.03, 0.105], seg(10, q, 7), seg(5, q, 4), { p: 2.6 });
        xform(wing, [s * 0.33, py2 + 0.12, bz2 + 0.1], [0, -0.4 * s, 0.36 * s]);
        mb.add(wing, (x, y, z) => (Math.abs(x) > 0.42 ? tc.main : paintAt(fg.paint, x, y, z)), { rigid: 'chest' });
      }
      break;
    }
  }

  // Veteran cats: a black eye patch over the scarred eye, strapped round the head.
  if (vet && isCat) {
    mb.surface(SURF.leather);
    const s = SCAR_SIDE[cls], k = SX[s], e = j.eye[s], er = plan.eye.r;
    const pc: V3 = [e[0], e[1] + er * 0.08, e[2] - er * plan.eye.scale[2] * 1.18];
    mb.add(ellipsoid(pc, [er * 1.28, er * 1.2, er * 0.34], seg(8, qf, 6), seg(4, qf, 3), { p: 2.4 }), mixHex(INK, LEATHER, 0.25), { rigid: 'head' });
    const strap: V3[] = [[pc[0] + k * er * 0.9, pc[1] + er * 0.6, pc[2] + er * 0.3], [k * cr.r[0] * 0.98, hc[1] + cr.r[1] * 0.18, hc[2] - cr.r[2] * 0.15], [k * cr.r[0] * 0.62, hc[1] + cr.r[1] * 0.3, hc[2] + cr.r[2] * 0.78]];
    mb.add(sweep(strap, [[0.006, 0.011], [0.006, 0.011], [0.006, 0.011]], 3, { up: [0, 0, 1], capStart: 1, capEnd: 1 }), INK, { rigid: 'head' });
  }
}

/** Coarse dark mottling for soft fabrics and leather (sweat, rain, mud): a warped-sine threshold in model space. */
function mottled(x: number, y: number, z: number): boolean {
  return Math.sin(x * 23 + Math.sin(y * 17) * 2 + z * 19) > 0.72;
}

/**
 * Team lamps (glow parts, one team-colour glow mesh on the body skeleton): assault helmet lamp, infiltrator IR strobe
 * on the back of the hood, overwatch monocle (hero) + mast beacon, breacher visor slit, warden riot lamps on the cone,
 * skyraider goggle lenses. Seen at night and through the dusk haze, they are the team signal in a firefight.
 */
export function buildGearGlow(g: MeshBuilder, plan: BodyPlan, cls: ClassId, hero: boolean, color = 0): void {
  const cr = plan.cranium, H = plan.headY;
  const hc: V3 = [0, H + cr.c[1], cr.c[2]];
  const W = hero ? 7 : 5, Hh = hero ? 4 : 3;
  switch (cls) {
    case 'assault': {
      const p = lampHousing(plan);
      g.add(ellipsoid([p[0], p[1], p[2] - 0.02], [0.019, 0.015, 0.008], W, Hh), color, { rigid: 'head' });
      break;
    }
    case 'infiltrator': {
      const hg = HEADGEAR.infiltrator!;
      const p = capPoint(0.3 * Math.PI, Math.PI * 0.82, [cr.r[0] + hg.grow + 0.008, cr.r[1] + hg.grow + 0.008, cr.r[2] + hg.grow + 0.008], hg.p, hc);
      g.add(ellipsoid(p, [0.014, 0.014, 0.014], W, Hh), color, { rigid: 'head' });
      break;
    }
    case 'overwatch': {
      if (hero) g.add(ellipsoid(monoclePos(plan), [0.03, 0.03, 0.008], 10, 4), color, { rigid: 'head' });
      const tip = mastPath(plan)[3];
      g.add(ellipsoid([tip[0], tip[1] + 0.03, tip[2]], [0.036, 0.036, 0.036], hero ? 8 : 6, hero ? 6 : 4), color, { rigid: 'chest' });
      break;
    }
    case 'breacher': {
      const v = visorPos(plan);
      g.add(ellipsoid([v[0], v[1] - 0.012, v[2] - 0.028], [0.085, 0.007, 0.006], hero ? 8 : 6, 3, { rot: [-0.55, 0, 0] }), color, { rigid: 'head' });
      break;
    }
    case 'warden': {
      for (const k of [-1, 1]) {
        // On the cone's front rim (CONE.f0), upper left and right.
        const a = 0.62 * k, rr = CONE.f0[0] - 0.014;
        g.add(ellipsoid([hc[0] + Math.sin(a) * rr, hc[1] - 0.01 + Math.cos(a) * rr * CONE.ry, hc[2] - 0.02 + CONE.f0[1] - 0.008], [0.017, 0.017, 0.01], W, Hh), color, { rigid: 'head' });
      }
      break;
    }
    case 'skyraider': {
      const [gy, gz] = goggleYZ(plan);
      for (const s of [-1, 1]) g.add(ellipsoid([0.07 * s, gy, gz + 0.004], [0.042, 0.037, 0.012], hero ? 8 : 6, hero ? 4 : 3, { rot: [-0.45, 0, 0] }), color, { rigid: 'head' });
      break;
    }
  }
}

/**
 * The chest plate's front face (model space): its top edge y and its front z at the centre line. Neckwear (C3)
 * drapes onto the plate's top trim instead of cutting through it, whatever the class build.
 */
export function chestPlateFront(plan: BodyPlan, cls: ClassId): { top: number; z: number } {
  const cp = chestPlate(plan, cls);
  return { top: cp.cy + cp.ph, z: cp.z - cp.depth };
}

/**
 * The HARDENED plate carrier's armoured collar (model space): a ring round the neck, centre (0, y, cz), radii rx / rz,
 * half height h, half thickness t. Neckwear (C3) hugs it.
 */
export function armourCollar(plan: BodyPlan): { y: number; cz: number; rx: number; rz: number; h: number; t: number } {
  const nr = plan.neckR ?? [0.1, 0.095];
  return { y: plan.neckY - 0.004, cz: -0.008, rx: nr[0] + 0.034, rz: nr[1] + 0.03, h: 0.03, t: 0.019 };
}

/** Assault helmet lamp housing (model space, head-rigid): on the helmet front, above the brow line. */
function lampHousing(plan: BodyPlan): V3 {
  const cr = plan.cranium, hg = HEADGEAR.assault!;
  const hc: V3 = [0, plan.headY + cr.c[1], cr.c[2]];
  const p = capPoint(hg.cut.front * 0.62 * Math.PI, 0, [cr.r[0] + hg.grow, cr.r[1] + hg.grow, cr.r[2] + hg.grow], hg.p, hc);
  return [p[0], p[1] + 0.004, p[2] - 0.012];
}

/** Breacher flip-up visor centre (model space, head-rigid): hinged up on the helmet brow. */
function visorPos(plan: BodyPlan): V3 {
  const cr = plan.cranium, hg = HEADGEAR.breacher!;
  const hc: V3 = [0, plan.headY + cr.c[1], cr.c[2]];
  const p = capPoint(hg.cut.front * 0.72 * Math.PI, 0, [cr.r[0] + hg.grow, cr.r[1] + hg.grow, cr.r[2] + hg.grow], hg.p, hc);
  return [p[0], p[1] + 0.015, p[2] - 0.035];
}

/** Skyraider goggles (model space, head-rigid): pushed up on the forehead of the cap. */
function goggleYZ(plan: BodyPlan): [number, number] {
  const cr = plan.cranium, hc = [0, plan.headY + cr.c[1], cr.c[2]];
  return [hc[1] + cr.r[1] * 0.66, hc[2] - cr.r[2] * 0.72];
}

/** Overwatch whip mast (model space, chest-rigid): leans back so zoomies do not turn it into a lance. */
export function mastPath(plan: BodyPlan): V3[] {
  const py2 = plan.chestY - 0.03;
  const [, rz, z] = torsoAt(plan, py2);
  const bz = z + rz + 0.02 + 0.06;
  const x = 0.075;
  return [[x, py2 + 0.1, bz], [x + 0.005, py2 + 0.45, bz + 0.07], [x + 0.01, py2 + 0.8, bz + 0.17], [x + 0.012, py2 + 1.08, bz + 0.27]];
}

/** Overwatch monocle center (model space): raised above the right eye, flipped up. */
export function monoclePos(plan: BodyPlan): V3 {
  const j = computeJoints(plan);
  const e = j.eye.R;
  return [e[0] + 0.05, e[1] + plan.eye.r * 1.9, e[2] - 0.035];
}

/** Point on a superellipsoid at polar angle th (0 = top) and azimuth ph (0 = front, -Z). */
function capPoint(th: number, ph: number, r: V3, p: number, c: V3): V3 {
  let dx = Math.sin(th) * Math.sin(ph), dy = Math.cos(th), dz = -Math.sin(th) * Math.cos(ph);
  if (p !== 2) { const k = 1 / Math.pow(Math.abs(dx) ** p + Math.abs(dy) ** p + Math.abs(dz) ** p, 1 / p); dx *= k; dy *= k; dz *= k; }
  return [c[0] + dx * r[0], c[1] + dy * r[1], c[2] + dz * r[2]];
}

/** Ellipsoid cap from the top pole down to a cut that varies with azimuth. */
function helmetCap(W: number, H: number, r: V3, front: number, backA: number, p: number, c: V3, side?: number) {
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
      row.push(pt((jj / H) * cutAngle(ph, front, backA, side), ph)); uv.push(i / W, jj / H);
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

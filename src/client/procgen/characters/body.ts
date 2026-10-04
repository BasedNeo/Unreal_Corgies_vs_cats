// Fur body + face for one species/coat, built as merged smooth primitives on the shared skeleton.
// Color regions follow shape boundaries (muzzle, cheeks, bib, socks, inner ears) so they stay crisp;
// soft markings (blaze, cap, stripes, points) are per-vertex palette functions.
import { PALETTE } from '../../style/style-tokens.js';
import { mixHex, valueNoise3, weatherFur, muddy, paintAt, INK, SCAR, type Paint } from './colors';
import { ellipsoid, sweep, mirrorX, xform, seg, isLite, tuftCol, SURF, type ColorFn, type MeshBuilder, type Prim, type V3 } from './mesh-builder';
import { computeJoints, cutAngle, muzzlePoint, padPoint, SIDES, SX, type HeadCut, type P3 } from './skeleton';
import type { BodyPlan, Coat } from './species';

const add = (a: P3, b: P3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp3 = (a: P3, b: P3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/**
 * HARDENED dress (K2): what the playable body wears under the class kit. Absent (the boss pilot and sniper) = bare fur
 * limbs and a clean coat, as before.
 */
export interface BodyDress {
  /** Under-suit sleeves and trouser legs; mitten paws become gloves and foot paws become boots (absent: bare fur). */
  suit?: {
    cloth: number;
    /** Seams, cuffs. */
    seam: number;
    /** Team signal armband on each sleeve (the team colour; never on the camo). */
    band: number;
    glove: number;
    /** Boot upper leather and sole. */
    boot: number;
    sole: number;
    /** Faction paint on the toe caps. */
    paint: Paint;
  };
  /** Cranium triangles fully under the class headgear (never visible) are left out: they pay for the armour. */
  headCut?: HeadCut;
  /** Wet, matted, muddy fur. */
  weathered: boolean;
  /** 0 none · 1 a scar through one brow and down the cheek · 2 (veterans) + a scar across the muzzle. */
  scars: number;
  /** Side of the scar and of the bitten ear notch. */
  scarSide: 'L' | 'R';
  notch: boolean;
}

/** Neck tube (model space): bottom at y0 (z 0, radii r0 [x, z]) to top at y1 (z z1, radii r1). Neckwear (C3) hugs it. */
export function neckTube(plan: BodyPlan): { y0: number; y1: number; z1: number; r0: [number, number]; r1: [number, number] } {
  const nr = plan.neckR ?? [0.1, 0.095];
  return { y0: plan.chestY + 0.06, y1: plan.headY + 0.1, z1: -0.015, r0: [nr[0], nr[1]], r1: [nr[0], nr[0]] };
}

/**
 * Chest ruff ellipsoid (model space) and the extra radius its lower-rim fur tufts add. Classic: a fluffy bib; HARDENED:
 * a ragged ruff of fur spilling out of the armour collar, which leaves the chest plate to read.
 */
export function ruffShape(plan: BodyPlan): { c: V3; r: V3; tuft: number } {
  const tuft = plan.hairless ? 0 : plan.hardened ? 0.3 : 0.2;
  return plan.hardened
    ? { c: [0, plan.neckY + 0.024, -0.078], r: [0.135, 0.056, 0.088], tuft }
    : { c: [0, plan.neckY - 0.005, -0.1], r: [0.15, 0.1, 0.085], tuft };
}

/** Drop the triangles whose three corners are all well inside a headgear cut, then the unused vertices. */
function cullUnderCut(p: Prim, c: V3, r: V3, cut: HeadCut, margin = 0.06): Prim {
  const n = p.pos.length / 3;
  const hidden = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const dx = (p.pos[3 * i] - c[0]) / r[0], dy = (p.pos[3 * i + 1] - c[1]) / r[1], dz = (p.pos[3 * i + 2] - c[2]) / r[2];
    const th = Math.acos(Math.max(-1, Math.min(1, dy / (Math.hypot(dx, dy, dz) || 1))));
    const ph = Math.atan2(dx, -dz);
    hidden[i] = th < cutAngle(ph, cut.front, cut.back, cut.side) - margin * Math.PI ? 1 : 0;
  }
  const keep: number[] = [];
  for (let t = 0; t < p.idx.length; t += 3) {
    const a = p.idx[t], b = p.idx[t + 1], d = p.idx[t + 2];
    if (!(hidden[a] && hidden[b] && hidden[d])) keep.push(a, b, d);
  }
  const remap = new Int32Array(n).fill(-1);
  const pos: number[] = [], uv: number[] = [], nrm: number[] | undefined = p.nrmPos ? [] : undefined;
  const idx = keep.map((i) => {
    if (remap[i] < 0) {
      remap[i] = pos.length / 3;
      pos.push(p.pos[3 * i], p.pos[3 * i + 1], p.pos[3 * i + 2]); uv.push(p.uv[2 * i], p.uv[2 * i + 1]);
      if (nrm) nrm.push(p.nrmPos![3 * i], p.nrmPos![3 * i + 1], p.nrmPos![3 * i + 2]);
    }
    return remap[i];
  });
  return { pos, uv, idx, nrmPos: nrm };
}

export interface FaceInfo {
  /** Model-space snout tip (for tests: the face points to -Z). */
  snoutTip: V3;
  headTop: number;
}

/** Snout tip + head top of a plan (what buildBody returns; the coat never moves them). */
export function faceInfo(plan: BodyPlan): FaceInfo {
  const H = plan.headY;
  const headAt = (p: P3): V3 => [p[0], p[1] + H, p[2]];
  let snoutTip: V3;
  if (plan.muzzle) { const m = plan.muzzle; snoutTip = headAt([m.tip[0], m.tip[1], m.tip[2] - m.rTip[0] * 0.8]); }
  else { const pd = plan.pads!; snoutTip = headAt([0, pd.c[1], pd.c[2] - pd.r * 0.85]); }
  return { snoutTip, headTop: computeJoints(plan).headTop[1] };
}

/**
 * The coat's main fur colour at a model-space point. Plain coats: `base`. Patched coats (C3 looks) paint from
 * 3D value noise, so the patches wrap continuously over head, body, limbs and tail:
 *   merle  — silver-grey marbled with slate, and black patches;
 *   calico — white with big ginger and black patches.
 */
export function furFn(coat: Coat): (x: number, y: number, z: number) => number {
  if (coat.pattern === 'merle') {
    const slate = mixHex(coat.base, coat.dark, 0.42);
    return (x, y, z) => {
      const n = valueNoise3(x * 9 + 3.1, y * 9, z * 9, 11);
      if (n > 0.6) return coat.dark;
      return valueNoise3(x * 14, y * 14 + 1.7, z * 14, 29) > 0.5 ? slate : coat.base;
    };
  }
  if (coat.pattern === 'calico') {
    const accent = coat.accent ?? coat.dark;
    return (x, y, z) => {
      if (valueNoise3(x * 6.5 + 0.4, y * 6.5, z * 6.5, 5) > 0.5) return accent;
      if (valueNoise3(x * 7.5, y * 7.5 + 2.2, z * 7.5, 17) > 0.57) return coat.dark;
      return coat.base;
    };
  }
  return () => coat.base;
}

/** Head-surface color (model space) for the coat's markings. */
export function headColorFn(plan: BodyPlan, coat: Coat): ColorFn {
  const h = plan.headY, c = plan.cranium.c, r = plan.cranium.r;
  const fur = furFn(coat);
  return (x, y, z) => {
    const nx = x / r[0], ny = (y - h - c[1]) / r[1], nz = (z - c[2]) / r[2];
    const ax = Math.abs(nx);
    switch (coat.pattern) {
      case 'plain':
      case 'sable':
      case 'merle':
      case 'tri': {
        // White blaze between the eyes widening into the muzzle + light throat.
        const blazeW = 0.1 + 0.34 * Math.max(0, Math.min(1, (0.25 - ny) * 1.2));
        if (nz < -0.25 && ax < blazeW && ny < 0.8) return coat.light;
        if (ny < -0.55 && nz < 0.2) return coat.light;
        if (coat.pattern === 'tri' && (ny > 0.55 + 0.2 * Math.max(0, -nz) || (nz > 0.25 && ny > -0.35))) return coat.dark;
        if (coat.pattern === 'sable' && ny > 0.35 + 0.15 * ax) return coat.dark;
        return fur(x, y, z);
      }
      case 'calico': {
        // White muzzle, chin and a blaze up the nose; patches over the crown, ears and cheeks.
        if (nz < -0.3 && ny < -0.05 && ax < 0.55) return coat.light;
        if (nz < -0.45 && ax < 0.12 && ny < 0.45) return coat.light;
        if (ny < -0.6) return coat.light;
        return fur(x, y, z);
      }
      case 'tabby': {
        // Forehead "M" stripes, side and back stripes.
        if (nz < -0.2 && ny > 0.2 && Math.sin(nx * 26) > 0.35) return coat.dark;
        if (ax > 0.55 && Math.sin(ny * 17 + 1) > 0.55) return coat.dark;
        if (nz > 0.3 && Math.sin(nx * 14) > 0.5) return coat.dark;
        if (ny < -0.6 && nz < 0.1) return coat.light;
        return coat.base;
      }
      case 'points': {
        const mask = sstep(-0.1, -0.55, nz) * sstep(0.55, 0.1, ny);
        return mixHex(coat.base, coat.dark, Math.min(1, mask * 1.25));
      }
      case 'tux': {
        if (nz < -0.3 && ny < -0.05 && ax < 0.6) return coat.light;
        if (nz < -0.4 && ax < 0.08 && ny < 0.5) return coat.light;
        if (ny < -0.6) return coat.light;
        return coat.base;
      }
      case 'sphynx': {
        if (nz < -0.3 && ny > 0.35 && ny < 0.75 && Math.sin(ny * 40) > 0.7) return coat.dark;
        return coat.base;
      }
    }
  };
}

/** Limb color: socks / points / rings along the limb (v = 0 at the root, 1 at the paw). */
function limbColorFn(coat: Coat, from: number): ColorFn {
  const fur = furFn(coat);
  return (x, y, z, _u, v) => {
    if (coat.pattern === 'points') return mixHex(coat.base, coat.dark, sstep(from - 0.25, from + 0.1, v));
    if (coat.socks && v > from) return coat.light;
    if (coat.pattern === 'tabby' && Math.sin(v * Math.PI * 6) > 0.6) return coat.dark;
    if (coat.pattern === 'tri' && v < 0.3) return coat.dark;
    return fur(x, y, z);
  };
}

function pawColor(coat: Coat): number {
  if (coat.pattern === 'points') return coat.dark;
  return coat.socks ? coat.light : coat.base;
}

/**
 * Builds the fur body, head and face into `mb`. Detail `q` scales every segment count
 * (hero ≈ 1, NPC ≈ 0.62).
 */
export function buildBody(mb: MeshBuilder, plan: BodyPlan, coat: Coat, q: number, qf = q, dress?: BodyDress): FaceInfo {
  const j = computeJoints(plan);
  const H = plan.headY;
  const isCat = plan.species === 'cat';
  const suit = dress?.suit;
  // Battle wear: every fur colour is wet-matted and muddy low down (the coat keeps its hue).
  const wet = dress?.weathered ? (c: number, x: number, y: number, z: number) => weatherFur(c, x, y, z) : (c: number) => c;
  const wetFn = (f: ColorFn | number): ColorFn => (x, y, z, u, v) => wet(typeof f === 'number' ? f : f(x, y, z, u, v), x, y, z);
  const headClean = headColorFn(plan, coat);
  const headFn = dress?.weathered ? wetFn(headClean) : headClean;
  const furClean = furFn(coat);
  const fur = (x: number, y: number, z: number) => wet(furClean(x, y, z), x, y, z);

  mb.begin('torso').surface(SURF.fur);
  // --- torso -------------------------------------------------------------------------------
  // Only the belly/hips below the vest are ever visible: the vest (gear.ts) is a closed shell from the
  // hips to the neck, so the fur torso stops ~12 cm inside it (saves ~90 hero / ~60 NPC triangles).
  const T = plan.torso;
  const keep = T.y.map((_, i) => i).filter((i) => T.y[i] <= plan.hipsY + 0.12);
  const torsoPath: V3[] = keep.map((i) => [0, T.y[i], T.z[i]]);
  const torsoR: [number, number][] = keep.map((i) => [T.rx[i], T.rz[i]]);
  const torsoColor: ColorFn = (x, y, z) => {
    if (coat.pattern === 'tri' && z > 0.02 && y > plan.hipsY) return coat.dark;
    if (coat.pattern === 'tux' && z < -0.05 && Math.abs(x) < 0.12) return coat.light;
    if (coat.pattern === 'tabby' && z > 0 && Math.sin(y * 45) > 0.5) return coat.dark;
    if ((coat.pattern === 'plain' || coat.pattern === 'sable' || coat.pattern === 'merle') && z < -0.08 && y < plan.hipsY + 0.08) return coat.light;
    if (coat.pattern === 'calico' && z < -0.06) return coat.light;
    return fur(x, y, z);
  };
  // (Suited: the trousers' seat; only the fluffy rump and the tail stay bare fur below the vest.)
  mb.surface(suit ? SURF.cloth : SURF.fur).add(sweep(torsoPath, torsoR, seg(12, q, 8), { up: [1, 0, 0], capStart: 1, capEnd: 1, capStartLen: 0.6, capEndLen: 0.5 }),
    suit ? (x, y, z) => muddy(suit.cloth, x, y, z, 0.26) : wetFn(torsoColor), { auto: ['hips', 'spine', 'chest'] });
  mb.surface(SURF.fur);

  // Neck (mostly hidden under head + collar). HARDENED plans are thicker-necked.
  const nt = neckTube(plan);
  mb.add(sweep([[0, nt.y0, 0], [0, nt.y1, nt.z1]], [nt.r0, nt.r1], seg(8, q, 6), { up: [1, 0, 0], capStart: 0, capEnd: 0 }), headFn, { auto: ['chest', 'neck', 'head'] });

  // Chest ruff: fluffy bib poking out of the vest neckline (tufts along the lower rim).
  const ruffColor = coat.pattern === 'points' || coat.pattern === 'sphynx' ? coat.base : coat.pattern === 'tri' ? coat.light : coat.light;
  // Fur tufts shape the silhouette only; the toon bands shade the smooth base shape (no zig-zag facets).
  const ruffW = seg(10, q, 8);
  const ruff = ruffShape(plan);
  mb.add(ellipsoid(ruff.c, ruff.r, ruffW, seg(6, q, 4), {
    tuft: (u, v) => (v > 0.5 ? 1 + ruff.tuft * tuftCol(u, ruffW) * sstep(0.5, 0.85, v) : 1),
  }), wetFn(ruffColor), { auto: ['chest', 'neck'] });

  // Fluffy rear: two cream "buns" (corgi) with base-colored tops.
  if (plan.butt) {
    const b = plan.butt;
    const buttColor: ColorFn = (x, y, z) => (y < b.y + 0.02 ? coat.light : coat.pattern === 'tri' ? coat.dark : fur(x, y, z));
    const lobeW = seg(8, q, 6);
    const lobe = ellipsoid([b.x, b.y, b.z], [b.r, b.r * 0.92, b.r * 0.85], lobeW, seg(6, q, 5), {
      tuft: (u, v) => 1 + 0.07 * tuftCol(u, lobeW) * sstep(0.45, 0.8, v),
    });
    mb.add(lobe, wetFn(buttColor), { blend: [['butt', 0.75], ['hips', 0.25]] });
    mb.add(mirrorX(lobe), wetFn(buttColor), { blend: [['butt', 0.75], ['hips', 0.25]] });
  }

  mb.begin('tail');
  // --- tail --------------------------------------------------------------------------------
  const tl = plan.tail;
  const tailColor: ColorFn = (x, y, z, _u, v) => {
    if (coat.pattern === 'points') return mixHex(coat.base, coat.dark, sstep(0.0, 0.4, v));
    if (coat.pattern === 'tabby') return Math.sin(v * Math.PI * 7) > 0.35 || v > 0.9 ? coat.dark : coat.base;
    if (coat.pattern === 'tux') return v > 0.88 ? coat.light : coat.base;
    if (!isCat) return v > 0.7 ? coat.light : coat.pattern === 'tri' ? coat.dark : fur(x, y, z);
    return fur(x, y, z);
  };
  const tailN = seg(tl.fluffy ? 10 : 8, q, 6);
  mb.add(sweep(tl.pts as V3[], tl.r.map((r) => [r, r] as [number, number]), tailN, {
    up: [1, 0, 0], capStart: 1, capEnd: 2, capEndLen: tl.fluffy ? 0.9 : 1,
    tuft: tl.fluffy ? (t, u) => 1 + 0.22 * tuftCol(u, tailN) * sstep(0.2, 0.6, t) : undefined,
  }), wetFn(tailColor), { auto: ['hips', 'tail1', 'tail2', 'tail3', 'tail4'], power: 3 });

  mb.begin('legs');
  // --- legs + feet -------------------------------------------------------------------------
  for (const s of SIDES) {
    const k = SX[s];
    const legPath: V3[] = [add(j.hip[s], [0, 0.02, 0]), lerp3(j.hip[s], j.knee[s], 0.5), j.knee[s], j.ankle[s]];
    const tr = plan.thighR, sr = plan.shinR;
    const fluffPants = !isCat && !plan.hairless && !suit;
    const legN = seg(8, q, 6);
    // Under-suit trousers: seam at the knee, mud splashed up the shins.
    mb.surface(suit ? SURF.cloth : SURF.fur);
    const legColor: ColorFn = suit ? (x, y, z, _u, v) => muddy(Math.abs(v - 0.66) < 0.07 ? suit.seam : suit.cloth, x, y, z, 0.26) : limbColorFn(coat, 0.72);
    mb.add(sweep(legPath, [[tr, tr * 1.05], [tr * 0.98, tr], [(tr + sr) / 2, (tr + sr) / 2], [sr, sr]], legN, {
      up: [0, 0, 1], capStart: 1, capEnd: 1,
      // Fluffy "pants" on the back of corgi thighs (tufts on the +Z side, upper half of the leg).
      tuft: fluffPants ? (t, u) => { const back = Math.max(0, Math.cos(u * Math.PI * 2)); return 1 + 0.16 * back * sstep(0.55, 0.1, t) * (tuftCol(u, legN) ? 1 : 0.4); } : undefined,
    }), legColor, { auto: ['hips', `thigh.${s}`, `shin.${s}`, `foot.${s}`] });
    const f = plan.foot;
    const fw = seg(10, q, 8);
    if (suit) {
      // Combat boot: a boxy superellipsoid with a flat sole that swallows the ankle; painted toe cap, strap, mud.
      const bc: V3 = [j.ankle[s][0] + 0.004 * k, f.h * 1.08, (f.toeZ + f.heelZ) / 2 - 0.006];
      const br: V3 = [f.w * 1.1, f.h * 1.18, f.len / 2 * 1.06];
      // Armoured boot: painted plates over the toe and shin, a dark sole and strap, the cuff chipped, mud up the sides.
      const bootColor: ColorFn = (x, y, z) => {
        let c: number;
        if (y < 0.02) c = suit.sole;
        else if (Math.abs(y - (bc[1] + br[1] * 0.45)) < 0.012) c = suit.boot;
        else c = paintAt(suit.paint, x, y, z, y > bc[1] + br[1] * 0.85 ? 1 : 0);
        return muddy(c, x, y, z, 0.13);
      };
      mb.surface(SURF.armor).add(ellipsoid(bc, br, fw, seg(7, q, 5), { floorY: 0, p: 2.7 }), bootColor, { rigid: `foot.${s}` });
    } else {
      // Big paw with a flat sole and three toe scallops at the front.
      const fc: V3 = [j.ankle[s][0] + 0.004 * k, f.h * 0.92, (f.toeZ + f.heelZ) / 2];
      mb.add(ellipsoid(fc, [f.w, f.h, f.len / 2], fw, seg(7, q, 5), {
        floorY: 0,
        mod: (u, v, dx, dy, dz) => (dz < -0.55 && dy > -0.5 ? 1 + 0.06 * Math.max(0, Math.cos(u * Math.PI * 2 * 6)) * sstep(-0.55, -0.85, dz) : 1),
      }), pawColor(coat), { rigid: `foot.${s}` });
    }
  }

  mb.begin('arms');
  // --- arms + hands ------------------------------------------------------------------------
  for (const s of SIDES) {
    const k = SX[s];
    const sh = j.shoulder[s];
    const [ra, rb] = plan.armR;
    let armPath: V3[], armR: [number, number][], armColor: ColorFn;
    if (suit) {
      // Under-suit sleeve: a wide team armband round the upper arm (under the shoulder plate), a seam at the elbow, and
      // an armoured bracer over the forearm (one extra ring makes its top edge; the rest is paint on the sleeve).
      armPath = [add(sh, [-0.03 * k, 0.01, 0]), lerp3(sh, j.elbow[s], 0.45), j.elbow[s], lerp3(j.elbow[s], j.wrist[s], 0.14), lerp3(j.elbow[s], j.wrist[s], 0.6), j.wrist[s]];
      armR = [[ra * 1.05, ra * 1.05], [ra * 0.98, ra * 0.98], [(ra + rb) / 2, (ra + rb) / 2], [rb * 1.2, rb * 1.2], [rb * 1.22, rb * 1.22], [rb * 1.08, rb * 1.08]];
      // W9 K3: the team armband runs the whole upper sleeve, through the elbow ring (was v < 0.3, one ring pair: the
      // triangles on its edge averaged into the lifted suit colour and lost the team hue at range).
      armColor = (x, y, z, _u, v) => (v < 0.45 ? suit.band : v > 0.58 ? paintAt(suit.paint, x, y, z, v > 0.97 ? 1 : 0) : suit.cloth);
    } else {
      armPath = [add(sh, [-0.03 * k, 0.01, 0]), lerp3(sh, j.elbow[s], 0.45), j.elbow[s], lerp3(j.elbow[s], j.wrist[s], 0.55), j.wrist[s]];
      armR = [[ra * 1.05, ra * 1.05], [ra * 0.98, ra * 0.98], [(ra + rb) / 2, (ra + rb) / 2], [rb, rb], [rb * 0.95, rb * 0.95]];
      armColor = limbColorFn(coat, 0.8);
    }
    mb.surface(suit ? SURF.cloth : SURF.fur).add(sweep(armPath, armR, seg(8, q, 6), { up: [0, 0, 1], capStart: 1, capEnd: 1 }), armColor, { auto: [`clav.${s}`, `upperArm.${s}`, `foreArm.${s}`, `hand.${s}`] });
    // Mitten paw (oversized) + thumb nub; a glove under the suit.
    const d = j.foreDir[s];
    const hr = plan.handR;
    const hc = add(j.wrist[s], [d[0] * hr * 0.8, d[1] * hr * 0.8, d[2] * hr * 0.8]);
    const pitch = Math.atan2(-d[2], -d[1]);
    const roll = Math.atan2(d[0], -d[1]);
    const handColor = suit ? suit.glove : pawColor(coat);
    mb.surface(suit ? SURF.leather : SURF.fur);
    const hand = ellipsoid([0, 0, 0], [hr * 0.95, hr * 1.15, hr * 0.85], seg(suit ? 8 : 9, q, 7), seg(7, q, 5));
    xform(hand, hc, [pitch, 0, roll]);
    mb.add(hand, handColor, { rigid: `hand.${s}` });
    if (!isLite(q)) {
      const thumb = ellipsoid([0, 0, 0], [hr * 0.36, hr * 0.5, hr * 0.36], seg(5, q, 4), seg(4, q, 3));
      xform(thumb, add(hc, [-0.55 * hr * k, hr * 0.25, -hr * 0.6]), [pitch - 0.5, 0, roll + 0.6 * k]);
      mb.add(thumb, handColor, { rigid: `hand.${s}` });
    }
  }

  mb.begin('head').surface(SURF.fur);
  // --- head --------------------------------------------------------------------------------
  const hc = plan.cranium;
  const headAt = (p: P3): V3 => [p[0], p[1] + H, p[2]];
  const cranP = isCat ? 2.15 : 2;
  let cranium = ellipsoid(headAt(hc.c), hc.r, seg(20, qf, 12), seg(14, qf, 9), { p: cranP });
  // Under a helmet, hood or hat the top of the skull is never seen: leave it out (pays for the armour).
  if (dress?.headCut) cranium = cullUnderCut(cranium, headAt(hc.c), hc.r, dress.headCut);
  mb.add(cranium, headFn, { rigid: 'head' });

  // Cheek fluff (tufted outward and down).
  const ch = plan.cheek;
  // Corgi cheeks: cream fluff (tri: tan). HARDENED: the coat colour over the top and back of the cheek, cream only
  // low and forward (a fox face, not two white puffballs).
  const cheekLight = coat.pattern === 'tri' ? coat.base : coat.light;
  const cheekColor: ColorFn = isCat ? headFn
    : plan.hardened ? wetFn((x, y, z, u, v) => (y > H + plan.cheek.c[1] + plan.cheek.r[1] * 0.1 && z > plan.cheek.c[2] - plan.cheek.r[2] * 0.55 ? headClean(x, y, z, u, v) : cheekLight))
    : wetFn(cheekLight);
  // (HARDENED cheeks are smaller, so they take fewer segments: part of what pays for the armour.)
  const cw = seg(dress ? 11 : 12, qf, 6);
  const cheek = ellipsoid(headAt(ch.c), ch.r, cw, seg(dress ? 7 : 8, qf, 5), {
    tuft: ch.tufts ? (u, v, dx, dy) => 1 + 0.07 * tuftCol(u, cw) * sstep(0.3, 0.8, Math.abs(dx)) * sstep(0.2, -0.5, dy) : undefined,
  });
  const cheekCol: ColorFn = isCat ? (x, y, z, u, v) => (coat.pattern === 'tux' ? coat.light : coat.pattern === 'points' ? mixHex(coat.base, coat.dark, 0.7) : headFn(x, y, z, u, v)) : cheekColor;
  // Cheeks (and cat pads) shade partly as one smooth head volume: no faceted seam into the cranium.
  const faceProxy = { c: headAt(hc.c), r: [hc.r[0] * 1.15, hc.r[1] * 1.1, hc.r[2] * 1.2] as V3, w: 0.55 };
  mb.add(cheek, cheekCol, { rigid: 'head' }, { proxy: faceProxy });
  mb.add(mirrorX(cheek), cheekCol, { rigid: 'head' }, { proxy: faceProxy });

  // Muzzle (corgi, fox-like) or whisker pads (cat).
  const muzzleColor = coat.pattern === 'points' ? coat.dark : coat.pattern === 'sphynx' ? coat.base : coat.light;
  const muzzleFur = wetFn(muzzleColor);
  let snoutTip: V3;
  if (plan.muzzle) {
    const m = plan.muzzle;
    const mid = lerp3(m.base, m.tip, 0.55);
    mb.add(sweep([headAt(m.base), headAt(mid as P3), headAt(m.tip)], [[m.rBase[1], m.rBase[0]], [(m.rBase[1] + m.rTip[1]) / 2 * 1.02, (m.rBase[0] + m.rTip[0]) / 2 * 1.05], [m.rTip[1], m.rTip[0]]], seg(12, qf, 8), {
      up: [0, 1, 0], capStart: 1, capEnd: 2, capEndLen: 0.8,
    }), muzzleFur, { rigid: 'head' });
    snoutTip = headAt([m.tip[0], m.tip[1], m.tip[2] - m.rTip[0] * 0.8]);
  } else {
    const pd = plan.pads!;
    const pad = ellipsoid(headAt(pd.c), [pd.r, pd.r * 0.82, pd.r * 0.85], seg(8, qf, 6), seg(6, qf, 5));
    mb.add(pad, muzzleFur, { rigid: 'head' }, { proxy: { ...faceProxy, w: 0.35 } });
    mb.add(mirrorX(pad), muzzleFur, { rigid: 'head' }, { proxy: { ...faceProxy, w: 0.35 } });
    snoutTip = headAt([0, pd.c[1], pd.c[2] - pd.r * 0.85]);
  }

  // Battle scars: pale, hairless lines (inked by the outline pass) through one brow and down the cheek past the eye;
  // veterans add a scar across the muzzle (corgi) or claw marks on the other cheek (cat).
  if (dress && dress.scars > 0) {
    mb.begin('scars').surface(SURF.skin);
    const ks = SX[dress.scarSide];
    const cz = (x: number, y: number) => { // outermost face surface z (head-local) at (x, y): cranium or a cheek
      const surf = (c: P3, r: P3, p: number, xx: number) => {
        const k = 1 - Math.abs((xx - c[0]) / r[0]) ** p - Math.abs((y - c[1]) / r[1]) ** p;
        return k > 0 ? c[2] - r[2] * Math.pow(k, 1 / p) : Infinity;
      };
      return Math.min(surf(hc.c, hc.r, cranP, x), surf(ch.c, ch.r, 2, Math.abs(x)));
    };
    const onFace = (x: number, y: number, lift: number): V3 => headAt([x, y, cz(x, y) - lift]);
    const sr = isLite(q) ? 0.0065 : 0.0056;
    const line = (pts: [number, number][]) => {
      const path = pts.map(([x, y]) => onFace(x, y, sr * 0.35));
      mb.add(sweep(path, path.map(() => [sr, sr] as [number, number]), 3, { up: [0, 0, 1], capStart: 1, capEnd: 1, capStartLen: 0.8, capEndLen: 0.8 }), SCAR, { rigid: 'head' });
    };
    const e = plan.eye, er = e.r * e.scale[1];
    const dx = -0.42 * ks, dy = -1, dl = Math.hypot(dx, dy); // above the eye it runs outward, across the brow's outer half
    const at = (s: number): [number, number] => [e.c[0] * ks + (dx / dl) * s, e.c[1] + (dy / dl) * s];
    line([at(-er * 2.15), at(-er * 1.05)]);
    line([at(er * 1.25), at(er * 2.3)]);
    if (dress.scars > 1) {
      if (plan.muzzle) {
        const m = plan.muzzle, z0 = m.base[2] + (m.tip[2] - m.base[2]) * 0.35;
        const mp = (th: number, z: number): V3 => headAt(muzzlePoint(plan, th, z, 0.7));
        const path = [mp(Math.PI - 0.95, z0), mp(Math.PI, z0 - 0.02), mp(Math.PI + 0.95, z0 - 0.04)];
        mb.add(sweep(path, path.map(() => [sr, sr] as [number, number]), 3, { up: [0, 0, 1], capStart: 1, capEnd: 1 }), SCAR, { rigid: 'head' });
      } else {
        const cx = ch.c[0] * -ks, cy = ch.c[1];
        for (const o of [-0.022, 0.012]) line([[cx - 0.035 * ks, cy + 0.03 + o], [cx + 0.02 * ks, cy - 0.02 + o]]);
      }
    }
    mb.begin('head').surface(SURF.fur);
  }
  // Nose.
  const nz = plan.nose;
  mb.surface(SURF.nose).add(ellipsoid(headAt(nz.c), nz.r, seg(8, qf, 6), seg(5, qf, 4), { p: isCat ? 2 : 2.2, mod: isCat ? (_u, _v, _dx, dy) => 1 + 0.25 * Math.max(0, dy) : undefined }), coat.nose, { rigid: 'head' });
  mb.surface(SURF.skin);

  // Mouth interior (revealed when the jaw drops), chin, tongue.
  const jw = plan.jaw;
  const mouthDark = mixHex(PALETTE.ink, PALETTE.danger, 0.35);
  const mouthC = lerp3(headAt(jw.a), headAt(jw.b), 0.5);
  mb.add(ellipsoid([mouthC[0], mouthC[1] + 0.02, mouthC[2] - 0.01], [jw.r[0] * 0.85, 0.034, Math.abs(jw.b[2] - jw.a[2]) * 0.5 + 0.018], seg(6, q, 5), seg(4, q, 3)), mouthDark, { rigid: 'head' });
  mb.surface(SURF.fur).add(sweep([headAt(jw.a), headAt(jw.b)], [[jw.r[1], jw.r[0]], [jw.r[1] * 0.8, jw.r[0] * 0.7]], seg(8, q, 6), { up: [0, 1, 0], capStart: 1, capEnd: 2 }), muzzleColor, { rigid: 'jaw' });
  mb.surface(SURF.eye); // teeth: wet enamel
  // Lower tooth row on the chin's front rim: hidden inside the muzzle / pads when the jaw is shut,
  // it rises into view as soon as the jaw drops (gritted-teeth snarl, toothy grin, battle yell).
  const TOOTH = mixHex(PALETTE.catWhite, PALETTE.corgiCream, 0.15);
  {
    const bz = jw.b[2] - jw.r[0] * 0.55, ty = jw.b[1] + jw.r[1] * 0.72, w = jw.r[0] * 0.62;
    mb.add(sweep([headAt([-w, ty, bz + w * 0.75]), headAt([-w * 0.45, ty + 0.002, bz + w * 0.12]), headAt([0, ty + 0.003, bz]), headAt([w * 0.45, ty + 0.002, bz + w * 0.12]), headAt([w, ty, bz + w * 0.75])],
      [[0.009, 0.005], [0.01, 0.005], [0.01, 0.005], [0.01, 0.005], [0.009, 0.005]], seg(5, q, 4), { up: [0, 1, 0], capStart: 1, capEnd: 1 }), TOOTH, { rigid: 'jaw' });
  }
  // Upper fangs (rigid to the head): the tips peek just under the lip line — scrappy, not scary.
  for (const k of isCat ? [-1, 1] : [-1]) { // corgi: one snaggle fang on the smirk (left) side
    const lip: P3 = isCat ? padPoint(plan, -1.9, -0.2) : muzzlePoint(plan, 0.62, plan.muzzle!.tip[2] + 0.035, -0.2);
    const tip: V3 = [lip[0] * k * (isCat ? 0.55 : 0.92), lip[1] - (isCat ? 0.017 : 0.014), lip[2] + 0.002];
    const root: V3 = [tip[0], lip[1] + 0.012, lip[2] + 0.006];
    mb.add(sweep([headAt(root as P3), headAt(tip as P3)], [[0.0065, 0.0055], [0.0015, 0.0015]], 5, { up: [0, 0, 1], capStart: 1, capEnd: 1, capEndLen: 0.6 }), TOOTH, { rigid: 'head' });
  }

  mb.begin('mouth').surface(SURF.skin);
  // Dark lip line (philtrum + mouth). Its ends are weighted to the mouth-corner bones, so the face rig
  // bends it into a smirk, grin or snarl; the middle stays on the head.
  const INK_LIP = mixHex(PALETTE.ink, coat.nose, 0.25);
  const lipPts: V3[] = [];
  const NL = 3;
  for (let i = -NL; i <= NL; i++) {
    const t = Math.abs(i) / NL, sg = Math.sign(i);
    if (plan.muzzle) {
      const m = plan.muzzle, capL = Math.max(m.rTip[0], m.rTip[1]) * 0.8;
      lipPts.push(headAt(muzzlePoint(plan, sg * 1.15 * Math.pow(t, 0.85), (m.tip[2] - capL * 0.55) + (m.base[2] - 0.055 - (m.tip[2] - capL * 0.55)) * Math.pow(t, 1.15), 0.6)));
    } else {
      // Cat "ω": from the pad cleft along each pad's lower edge to its outer side.
      const ang = -2.45 + 2.05 * t; // -2.45 (inner, under the cleft) → -0.4 (outer corner)
      const pp = padPoint(plan, ang, 0.6);
      lipPts.push(headAt(t === 0 ? [0, pp[1] - 0.004, pp[2] + 0.004] : [pp[0] * sg, pp[1], pp[2]]));
    }
  }
  const lipR = 0.0055;
  const cornerW = (t: number) => sstep(0.3, 1, t);
  // (NPC tier, HARDENED: a 3-sided ink line; it is a pixel or two wide at gameplay range.)
  const lipN = dress && isLite(q) ? 3 : 4;
  mb.add(sweep(lipPts, lipPts.map(() => [lipR, lipR] as [number, number]), lipN, { up: [0, 1, 0], capStart: 1, capEnd: 1 }), INK_LIP, {
    fn: (_x, _y, _z, _u, v) => {
      const t = Math.abs(v * 2 - 1), w = cornerW(t);
      return [['head', 1 - w], [v < 0.5 ? 'mouth.L' : 'mouth.R', w]];
    },
  });
  // Philtrum: from under the nose down to the middle of the lip line.
  {
    const nb: V3 = headAt([0, plan.nose.c[1] - plan.nose.r[1] * 0.75, plan.nose.c[2] + plan.nose.r[2] * 0.2]);
    const mc = lipPts[NL];
    const midY = (nb[1] + mc[1]) / 2;
    let midZ: number;
    if (plan.muzzle) {
      const m = plan.muzzle, L = Math.max(m.rTip[0], m.rTip[1]) * 0.8;
      const dy = (midY - H - m.tip[1]) / m.rTip[1];
      midZ = m.tip[2] - L * Math.sqrt(Math.max(0, 1 - dy * dy)) - lipR * 0.6;
    } else midZ = (nb[2] + mc[2]) / 2 - 0.004;
    mb.add(sweep([nb, [0, midY, midZ], mc], [[lipR, lipR], [lipR, lipR], [lipR, lipR]], lipN, { up: [0, 0, 1], capStart: 1, capEnd: 1 }), INK_LIP, { rigid: 'head' });
  }
  const tongueC = lerp3(headAt(jw.a), headAt(jw.b), 0.62);
  mb.surface(SURF.nose).add(ellipsoid([tongueC[0], tongueC[1] + jw.r[1] * 0.7, tongueC[2]], [jw.r[0] * 0.55, 0.012, Math.abs(jw.b[2] - jw.a[2]) * 0.42], seg(6, q, 5), seg(4, q, 3)), coat.tongue, { rigid: 'tongue' });

  mb.begin('ears').surface(SURF.fur);
  // --- ears --------------------------------------------------------------------------------
  const E = plan.ear;
  for (const s of SIDES) {
    const b = j.earBase[s], m = j.earMid[s], t = j.earTip[s];
    const outerColor: ColorFn | number = coat.pattern === 'tri' || coat.pattern === 'points' ? coat.dark : coat.pattern === 'tabby' ? coat.dark
      : coat.pattern === 'merle' || coat.pattern === 'calico' ? (x: number, y: number, z: number) => fur(x, y, z) : coat.base;
    const up: V3 = [0, 0, 1];
    const earN = seg(8, q, 6);
    const tipIn = lerp3(m, t, 0.55);
    // A bite notch out of the outer edge of one ear (battle wear): one extra ring whose outer half is pulled in.
    const notched = !!dress?.notch && s === dress.scarSide;
    const path: V3[] = notched ? [lerp3(b, m, -0.25), b, m, lerp3(m, tipIn, 0.45), tipIn] : [lerp3(b, m, -0.25), b, m, tipIn];
    const radii: [number, number][] = notched
      ? [[E.d, E.w], [E.d, E.w], [E.d * 0.85, E.w * 0.8], [E.d * 0.72, E.w * 0.63], [E.d * 0.55, E.w * 0.42]]
      : [[E.d, E.w], [E.d, E.w], [E.d * 0.85, E.w * 0.8], [E.d * 0.55, E.w * 0.42]];
    const uo = s === 'R' ? 0.25 : 0.75; // the sweep's +binormal is +X for both ears: the outer edge
    mb.surface(SURF.fur).add(sweep(path, radii, earN, {
      up, capStart: 0, capEnd: 2, capEndLen: 2.2,
      mod: notched ? (tt, u) => (Math.abs(tt - 0.75) < 0.01 ? 1 - 0.6 * Math.max(0, Math.cos((u - uo) * Math.PI * 2)) ** 2 : 1) : undefined,
    }), wetFn(outerColor), { auto: ['head', `ear1.${s}`, `ear2.${s}`] });
    // Inner ear: flatter, pushed forward (-Z).
    const f: P3 = [0, -0.004, -E.d * 0.62];
    mb.surface(SURF.skin);
    mb.add(sweep([add(b, f), add(m, f), add(tipIn as P3, f)], [[E.d * 0.45, E.w * 0.72], [E.d * 0.42, E.w * 0.58], [E.d * 0.3, E.w * 0.3]], seg(6, q, 5), {
      up, capStart: 1, capEnd: 2, capEndLen: 2,
    }), coat.innerEar, { auto: [`ear1.${s}`, `ear2.${s}`] });
  }

  mb.begin('eyes');
  // --- eyes, lids, brows, X-eyes -----------------------------------------------------------
  const ey = plan.eye;
  const r = ey.r;
  const sc = ey.scale;
  for (const s of SIDES) {
    const k = SX[s];
    const c = j.eye[s];
    // Eye-local (unscaled) → model: c + scale ⊙ (tilt-rotated) p.
    const toModel = (p: Prim): Prim => {
      const tilt = ey.tilt * k;
      for (let i = 0; i < p.pos.length; i += 3) {
        const x = p.pos[i], y = p.pos[i + 1];
        const xr = x * Math.cos(tilt) - y * Math.sin(tilt), yr = x * Math.sin(tilt) + y * Math.cos(tilt);
        p.pos[i] = c[0] + xr * sc[0]; p.pos[i + 1] = c[1] + yr * sc[1]; p.pos[i + 2] = c[2] + p.pos[i + 2] * sc[2];
      }
      return p;
    };
    // Look direction: forward, turned slightly outward and down (cute focus).
    const yaw = -ey.look * k, pitch = -0.08;
    const L: V3 = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const faceRot: V3 = [pitch, yaw, 0];
    // Iris, pupil and highlight are spherical caps ON the eyeball (radius ≤ 1.05 r), with the pole on
    // their own direction: every point stays inside the lid shells (1.1 r), so lowered lids cover them
    // from any angle, and the outline seen from the front is the full W-sided ring (no hexagon eyes).
    const cap = (R: number, dir: V3, lat: number, W: number, H: number, sx = 1): Prim => {
      const c = ellipsoid([0, 0, 0], [R, R, R], W, H, { vMax: Math.asin(Math.min(0.99, lat / R)) / Math.PI });
      if (sx !== 1) for (let i = 0; i < c.pos.length; i += 3) { // slit: squeeze x, then back onto the sphere
        const x = c.pos[i] * sx, z = c.pos[i + 2];
        c.pos[i] = x; c.pos[i + 1] = Math.sign(c.pos[i + 1]) * Math.sqrt(Math.max(0, R * R - x * x - z * z));
      }
      const p2 = Math.asin(dir[1]), y2 = Math.atan2(-dir[0], -dir[2]);
      return xform(c, [0, 0, 0], [-Math.PI / 2 + p2, y2, 0]);
    };
    const irisW = seg(12, qf, 8), pupW = seg(10, qf, 6);
    const irisLat = r * (isCat ? 0.77 : 0.69), irisH = seg(4, qf, 3);
    // HARDENED eyes: a dark limbal ring round the iris (its outer row), a smaller corgi pupil (a hard stare).
    const ringV = (Math.asin(Math.min(0.99, irisLat / (r * 1.012))) / Math.PI) * (1 - 0.6 / irisH);
    const irisRing = mixHex(coat.iris, INK, 0.62);
    const irisColor: ColorFn | number = dress ? (_x, _y, _z, _u, v) => (v >= ringV ? irisRing : coat.iris) : coat.iris;
    mb.surface(SURF.eye).add(toModel(cap(r * 1.012, L, irisLat, irisW, irisH)), irisColor, { rigid: `eye.${s}` });
    mb.add(toModel(cap(r * 1.03, L, r * (isCat ? 0.64 : dress ? 0.36 : 0.42), pupW, seg(dress ? 3 : 4, qf, 3), isCat ? 0.375 : 1)), PALETTE.ink, { rigid: `pupil.${s}` });
    // Highlight (up and toward the key light).
    const hd = [L[0] + 0.3, L[1] + 0.32, L[2]], hn = Math.hypot(hd[0], hd[1], hd[2]);
    // (HARDENED: a smaller, harder catch-light; big soft highlights are the mascot look.)
    mb.add(toModel(cap(r * 1.045, [hd[0] / hn, hd[1] / hn, hd[2] / hn], r * (dress ? 0.15 : 0.2), seg(7, qf, 5), 2)), PALETTE.catWhite, { rigid: `eye.${s}` });
    // Upper lid: spherical shell cap around +Y; lower lid around -Y (rotated by their bones).
    // Lid fur = the coat just in front of the eye (so a Siamese mask colours its lids too).
    const lidColor = headClean(c[0], c[1] + r * 0.5, c[2] - r * 0.8, 0, 0);
    mb.surface(SURF.fur);
    const lidR = r * 1.1;
    mb.add(toModel(ellipsoid([0, 0, 0], [lidR, lidR, lidR], seg(12, qf, 8), seg(4, q, 3), { vMax: 0.42 })), lidColor, { rigid: `lidUp.${s}` });
    if (!isLite(q)) {
    const lo = ellipsoid([0, 0, 0], [lidR * 0.99, lidR * 0.99, lidR * 0.99], seg(8, q, 6), seg(3, q, 3), { vMax: 0.42 });
    for (let i = 1; i < lo.pos.length; i += 3) lo.pos[i] = -lo.pos[i];
    for (let i = 0; i < lo.idx.length; i += 3) { const tmp = lo.idx[i + 1]; lo.idx[i + 1] = lo.idx[i + 2]; lo.idx[i + 2] = tmp; }
    mb.add(toModel(lo), headClean(c[0], c[1] - r, c[2] - r * 0.5, 0, 0), { rigid: `lidLo.${s}` });
    }
    // W15 (stylised-realistic): no comic X eyes on a dead face; the face rig closes the lids instead.
    // Brow: a wedge, thick at the inner end, so an angled brow reads as a V (fierce) or a tent (worried).
    const bw = plan.brow, BL = bw.r[0], BT = bw.r[1];
    const brow = sweep([[-k * BL, -BT * 0.2, BT * 0.25], [-k * BL * 0.1, BT * 0.35, 0], [k * BL, -BT * 0.3, BT * 0.5]],
      [[BT * 1.25, bw.r[2] * 1.05], [BT * 0.95, bw.r[2]], [BT * 0.5, bw.r[2] * 0.7]], seg(6, q, 5), { up: [0, 1, 0], capStart: 1, capEnd: 1, capStartLen: 0.7, capEndLen: 0.9 });
    mb.add(xform(brow, j.brow[s], [0, -0.25 * k, -0.08 * k]), coat.brow, { rigid: `brow.${s}` });
  }

  return { snoutTip, headTop: j.headTop[1] };
}

// Fur body + face for one species/coat, built as merged smooth primitives on the shared skeleton.
// Color regions follow shape boundaries (muzzle, cheeks, bib, socks, inner ears) so they stay crisp;
// soft markings (blaze, cap, stripes, points) are per-vertex palette functions.
import { PALETTE } from '../../style/style-tokens.js';
import { mixHex } from './colors';
import { ellipsoid, sweep, mirrorX, xform, seg, isLite, tuftCol, type ColorFn, type MeshBuilder, type Prim, type V3 } from './mesh-builder';
import { computeJoints, muzzlePoint, padPoint, SIDES, SX, type P3 } from './skeleton';
import type { BodyPlan, Coat } from './species';

const add = (a: P3, b: P3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp3 = (a: P3, b: P3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export interface FaceInfo {
  /** Model-space snout tip (for tests: the face points to -Z). */
  snoutTip: V3;
  headTop: number;
}

/** Head-surface color (model space) for the coat's markings. */
export function headColorFn(plan: BodyPlan, coat: Coat): ColorFn {
  const h = plan.headY, c = plan.cranium.c, r = plan.cranium.r;
  return (x, y, z) => {
    const nx = x / r[0], ny = (y - h - c[1]) / r[1], nz = (z - c[2]) / r[2];
    const ax = Math.abs(nx);
    switch (coat.pattern) {
      case 'plain':
      case 'sable':
      case 'tri': {
        // White blaze between the eyes widening into the muzzle + light throat.
        const blazeW = 0.1 + 0.34 * Math.max(0, Math.min(1, (0.25 - ny) * 1.2));
        if (nz < -0.25 && ax < blazeW && ny < 0.8) return coat.light;
        if (ny < -0.55 && nz < 0.2) return coat.light;
        if (coat.pattern === 'tri' && (ny > 0.55 + 0.2 * Math.max(0, -nz) || (nz > 0.25 && ny > -0.35))) return coat.dark;
        if (coat.pattern === 'sable' && ny > 0.35 + 0.15 * ax) return coat.dark;
        return coat.base;
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
  return (_x, _y, _z, _u, v) => {
    if (coat.pattern === 'points') return mixHex(coat.base, coat.dark, sstep(from - 0.25, from + 0.1, v));
    if (coat.socks && v > from) return coat.light;
    if (coat.pattern === 'tabby' && Math.sin(v * Math.PI * 6) > 0.6) return coat.dark;
    if (coat.pattern === 'tri' && v < 0.3) return coat.dark;
    return coat.base;
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
export function buildBody(mb: MeshBuilder, plan: BodyPlan, coat: Coat, q: number, qf = q): FaceInfo {
  const j = computeJoints(plan);
  const H = plan.headY;
  const isCat = plan.species === 'cat';
  const headFn = headColorFn(plan, coat);

  mb.begin('torso');
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
    if ((coat.pattern === 'plain' || coat.pattern === 'sable') && z < -0.08 && y < plan.hipsY + 0.08) return coat.light;
    return coat.base;
  };
  mb.add(sweep(torsoPath, torsoR, seg(12, q, 8), { up: [1, 0, 0], capStart: 1, capEnd: 1, capStartLen: 0.6, capEndLen: 0.5 }), torsoColor, { auto: ['hips', 'spine', 'chest'] });

  // Neck (mostly hidden under head + collar).
  mb.add(sweep([[0, plan.chestY + 0.06, 0], [0, H + 0.1, -0.015]], [[0.1, 0.095], [0.1, 0.1]], seg(8, q, 6), { up: [1, 0, 0], capStart: 0, capEnd: 0 }), headFn, { auto: ['chest', 'neck', 'head'] });

  // Chest ruff: fluffy bib poking out of the vest neckline (tufts along the lower rim).
  const ruffColor = coat.pattern === 'points' || coat.pattern === 'sphynx' ? coat.base : coat.pattern === 'tri' ? coat.light : coat.light;
  const ruffTufts = coat.pattern === 'sphynx' ? 0 : 0.2;
  // Fur tufts shape the silhouette only; the toon bands shade the smooth base shape (no zig-zag facets).
  const ruffW = seg(10, q, 8);
  mb.add(ellipsoid([0, plan.neckY - 0.005, -0.1], [0.15, 0.1, 0.085], ruffW, seg(6, q, 4), {
    tuft: (u, v) => (v > 0.5 ? 1 + ruffTufts * tuftCol(u, ruffW) * sstep(0.5, 0.85, v) : 1),
  }), ruffColor, { auto: ['chest', 'neck'] });

  // Fluffy rear: two cream "buns" (corgi) with base-colored tops.
  if (plan.butt) {
    const b = plan.butt;
    const buttColor: ColorFn = (_x, y) => (y < b.y + 0.02 ? coat.light : coat.pattern === 'tri' ? coat.dark : coat.base);
    const lobeW = seg(8, q, 6);
    const lobe = ellipsoid([b.x, b.y, b.z], [b.r, b.r * 0.92, b.r * 0.85], lobeW, seg(6, q, 5), {
      tuft: (u, v) => 1 + 0.07 * tuftCol(u, lobeW) * sstep(0.45, 0.8, v),
    });
    mb.add(lobe, buttColor, { blend: [['butt', 0.75], ['hips', 0.25]] });
    mb.add(mirrorX(lobe), buttColor, { blend: [['butt', 0.75], ['hips', 0.25]] });
  }

  mb.begin('tail');
  // --- tail --------------------------------------------------------------------------------
  const tl = plan.tail;
  const tailColor: ColorFn = (_x, _y, _z, _u, v) => {
    if (coat.pattern === 'points') return mixHex(coat.base, coat.dark, sstep(0.0, 0.4, v));
    if (coat.pattern === 'tabby') return Math.sin(v * Math.PI * 7) > 0.35 || v > 0.9 ? coat.dark : coat.base;
    if (coat.pattern === 'tux') return v > 0.88 ? coat.light : coat.base;
    if (!isCat) return v > 0.7 ? coat.light : coat.pattern === 'tri' ? coat.dark : coat.base;
    return coat.base;
  };
  const tailN = seg(tl.fluffy ? 10 : 8, q, 6);
  mb.add(sweep(tl.pts as V3[], tl.r.map((r) => [r, r] as [number, number]), tailN, {
    up: [1, 0, 0], capStart: 1, capEnd: 2, capEndLen: tl.fluffy ? 0.9 : 1,
    tuft: tl.fluffy ? (t, u) => 1 + 0.22 * tuftCol(u, tailN) * sstep(0.2, 0.6, t) : undefined,
  }), tailColor, { auto: ['hips', 'tail1', 'tail2', 'tail3', 'tail4'], power: 3 });

  mb.begin('legs');
  // --- legs + feet -------------------------------------------------------------------------
  for (const s of SIDES) {
    const k = SX[s];
    const legPath: V3[] = [add(j.hip[s], [0, 0.02, 0]), lerp3(j.hip[s], j.knee[s], 0.5), j.knee[s], j.ankle[s]];
    const tr = plan.thighR, sr = plan.shinR;
    const fluffPants = !isCat && coat.pattern !== 'sphynx';
    const legN = seg(8, q, 6);
    mb.add(sweep(legPath, [[tr, tr * 1.05], [tr * 0.98, tr], [(tr + sr) / 2, (tr + sr) / 2], [sr, sr]], legN, {
      up: [0, 0, 1], capStart: 1, capEnd: 1,
      // Fluffy "pants" on the back of corgi thighs (tufts on the +Z side, upper half of the leg).
      tuft: fluffPants ? (t, u) => { const back = Math.max(0, Math.cos(u * Math.PI * 2)); return 1 + 0.16 * back * sstep(0.55, 0.1, t) * (tuftCol(u, legN) ? 1 : 0.4); } : undefined,
    }), limbColorFn(coat, 0.72), { auto: ['hips', `thigh.${s}`, `shin.${s}`, `foot.${s}`] });
    // Big paw with a flat sole and three toe scallops at the front.
    const f = plan.foot;
    const fc: V3 = [j.ankle[s][0] + 0.004 * k, f.h * 0.92, (f.toeZ + f.heelZ) / 2];
    const fw = seg(10, q, 8);
    mb.add(ellipsoid(fc, [f.w, f.h, f.len / 2], fw, seg(7, q, 5), {
      floorY: 0,
      mod: (u, v, dx, dy, dz) => (dz < -0.55 && dy > -0.5 ? 1 + 0.06 * Math.max(0, Math.cos(u * Math.PI * 2 * 6)) * sstep(-0.55, -0.85, dz) : 1),
    }), pawColor(coat), { rigid: `foot.${s}` });
  }

  mb.begin('arms');
  // --- arms + hands ------------------------------------------------------------------------
  for (const s of SIDES) {
    const k = SX[s];
    const sh = j.shoulder[s];
    const armPath: V3[] = [add(sh, [-0.03 * k, 0.01, 0]), lerp3(sh, j.elbow[s], 0.45), j.elbow[s], lerp3(j.elbow[s], j.wrist[s], 0.55), j.wrist[s]];
    const [ra, rb] = plan.armR;
    mb.add(sweep(armPath, [[ra * 1.05, ra * 1.05], [ra * 0.98, ra * 0.98], [(ra + rb) / 2, (ra + rb) / 2], [rb, rb], [rb * 0.95, rb * 0.95]], seg(8, q, 6), {
      up: [0, 0, 1], capStart: 1, capEnd: 1,
    }), limbColorFn(coat, 0.8), { auto: [`clav.${s}`, `upperArm.${s}`, `foreArm.${s}`, `hand.${s}`] });
    // Mitten paw (oversized) + thumb nub.
    const d = j.foreDir[s];
    const hr = plan.handR;
    const hc = add(j.wrist[s], [d[0] * hr * 0.8, d[1] * hr * 0.8, d[2] * hr * 0.8]);
    const pitch = Math.atan2(-d[2], -d[1]);
    const roll = Math.atan2(d[0], -d[1]);
    const hand = ellipsoid([0, 0, 0], [hr * 0.95, hr * 1.15, hr * 0.85], seg(9, q, 7), seg(7, q, 5));
    xform(hand, hc, [pitch, 0, roll]);
    mb.add(hand, pawColor(coat), { rigid: `hand.${s}` });
    if (!isLite(q)) {
      const thumb = ellipsoid([0, 0, 0], [hr * 0.36, hr * 0.5, hr * 0.36], seg(5, q, 4), seg(4, q, 3));
      xform(thumb, add(hc, [-0.55 * hr * k, hr * 0.25, -hr * 0.6]), [pitch - 0.5, 0, roll + 0.6 * k]);
      mb.add(thumb, pawColor(coat), { rigid: `hand.${s}` });
    }
  }

  mb.begin('head');
  // --- head --------------------------------------------------------------------------------
  const hc = plan.cranium;
  const headAt = (p: P3): V3 => [p[0], p[1] + H, p[2]];
  mb.add(ellipsoid(headAt(hc.c), hc.r, seg(20, qf, 12), seg(14, qf, 9), { p: isCat ? 2.15 : 2 }), headFn, { rigid: 'head' });

  // Cheek fluff (tufted outward and down).
  const ch = plan.cheek;
  const cheekColor: ColorFn = isCat ? headFn : (x, y, z) => (coat.pattern === 'tri' ? coat.base : coat.light) ?? headFn(x, y, z, 0, 0);
  const cw = seg(12, qf, 6);
  const cheek = ellipsoid(headAt(ch.c), ch.r, cw, seg(8, qf, 5), {
    tuft: ch.tufts ? (u, v, dx, dy) => 1 + 0.07 * tuftCol(u, cw) * sstep(0.3, 0.8, Math.abs(dx)) * sstep(0.2, -0.5, dy) : undefined,
  });
  const cheekCol: ColorFn = isCat ? (x, y, z, u, v) => (coat.pattern === 'tux' ? coat.light : coat.pattern === 'points' ? mixHex(coat.base, coat.dark, 0.7) : headFn(x, y, z, u, v)) : cheekColor;
  // Cheeks (and cat pads) shade partly as one smooth head volume: no faceted seam into the cranium.
  const faceProxy = { c: headAt(hc.c), r: [hc.r[0] * 1.15, hc.r[1] * 1.1, hc.r[2] * 1.2] as V3, w: 0.55 };
  mb.add(cheek, cheekCol, { rigid: 'head' }, { proxy: faceProxy });
  mb.add(mirrorX(cheek), cheekCol, { rigid: 'head' }, { proxy: faceProxy });

  // Muzzle (corgi, fox-like) or whisker pads (cat).
  const muzzleColor = coat.pattern === 'points' ? coat.dark : coat.pattern === 'sphynx' ? coat.base : coat.light;
  let snoutTip: V3;
  if (plan.muzzle) {
    const m = plan.muzzle;
    const mid = lerp3(m.base, m.tip, 0.55);
    mb.add(sweep([headAt(m.base), headAt(mid as P3), headAt(m.tip)], [[m.rBase[1], m.rBase[0]], [(m.rBase[1] + m.rTip[1]) / 2 * 1.02, (m.rBase[0] + m.rTip[0]) / 2 * 1.05], [m.rTip[1], m.rTip[0]]], seg(12, qf, 8), {
      up: [0, 1, 0], capStart: 1, capEnd: 2, capEndLen: 0.8,
    }), muzzleColor, { rigid: 'head' });
    snoutTip = headAt([m.tip[0], m.tip[1], m.tip[2] - m.rTip[0] * 0.8]);
  } else {
    const pd = plan.pads!;
    const pad = ellipsoid(headAt(pd.c), [pd.r, pd.r * 0.82, pd.r * 0.85], seg(8, qf, 6), seg(6, qf, 5));
    mb.add(pad, muzzleColor, { rigid: 'head' }, { proxy: { ...faceProxy, w: 0.35 } });
    mb.add(mirrorX(pad), muzzleColor, { rigid: 'head' }, { proxy: { ...faceProxy, w: 0.35 } });
    snoutTip = headAt([0, pd.c[1], pd.c[2] - pd.r * 0.85]);
  }
  // Nose.
  const nz = plan.nose;
  mb.add(ellipsoid(headAt(nz.c), nz.r, seg(8, qf, 6), seg(5, qf, 4), { p: isCat ? 2 : 2.2, mod: isCat ? (_u, _v, _dx, dy) => 1 + 0.25 * Math.max(0, dy) : undefined }), coat.nose, { rigid: 'head' });

  // Mouth interior (revealed when the jaw drops), chin, tongue.
  const jw = plan.jaw;
  const mouthDark = mixHex(PALETTE.ink, PALETTE.danger, 0.35);
  const mouthC = lerp3(headAt(jw.a), headAt(jw.b), 0.5);
  mb.add(ellipsoid([mouthC[0], mouthC[1] + 0.02, mouthC[2] - 0.01], [jw.r[0] * 0.85, 0.034, Math.abs(jw.b[2] - jw.a[2]) * 0.5 + 0.018], seg(6, q, 5), seg(4, q, 3)), mouthDark, { rigid: 'head' });
  mb.add(sweep([headAt(jw.a), headAt(jw.b)], [[jw.r[1], jw.r[0]], [jw.r[1] * 0.8, jw.r[0] * 0.7]], seg(8, q, 6), { up: [0, 1, 0], capStart: 1, capEnd: 2 }), muzzleColor, { rigid: 'jaw' });
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

  mb.begin('mouth');
  // Ink lip line (philtrum + mouth). Its ends are weighted to the mouth-corner bones, so the face rig
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
  mb.add(sweep(lipPts, lipPts.map(() => [lipR, lipR] as [number, number]), 4, { up: [0, 1, 0], capStart: 1, capEnd: 1 }), INK_LIP, {
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
    mb.add(sweep([nb, [0, midY, midZ], mc], [[lipR, lipR], [lipR, lipR], [lipR, lipR]], 4, { up: [0, 0, 1], capStart: 1, capEnd: 1 }), INK_LIP, { rigid: 'head' });
  }
  const tongueC = lerp3(headAt(jw.a), headAt(jw.b), 0.62);
  mb.add(ellipsoid([tongueC[0], tongueC[1] + jw.r[1] * 0.7, tongueC[2]], [jw.r[0] * 0.55, 0.012, Math.abs(jw.b[2] - jw.a[2]) * 0.42], seg(6, q, 5), seg(4, q, 3)), coat.tongue, { rigid: 'tongue' });

  mb.begin('ears');
  // --- ears --------------------------------------------------------------------------------
  const E = plan.ear;
  for (const s of SIDES) {
    const b = j.earBase[s], m = j.earMid[s], t = j.earTip[s];
    const outerColor = coat.pattern === 'tri' || coat.pattern === 'points' ? coat.dark : coat.pattern === 'tabby' ? coat.dark : coat.base;
    const up: V3 = [0, 0, 1];
    const earN = seg(8, q, 6);
    const tipIn = lerp3(m, t, 0.55);
    mb.add(sweep([lerp3(b, m, -0.25), b, m, tipIn], [[E.d, E.w], [E.d, E.w], [E.d * 0.85, E.w * 0.8], [E.d * 0.55, E.w * 0.42]], earN, {
      up, capStart: 0, capEnd: 2, capEndLen: 2.2,
    }), outerColor, { auto: ['head', `ear1.${s}`, `ear2.${s}`] });
    // Inner ear: flatter, pushed forward (-Z).
    const f: P3 = [0, -0.004, -E.d * 0.62];
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
    const onEye = (d: number): V3 => [L[0] * r * d, L[1] * r * d, L[2] * r * d];
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
    mb.add(toModel(cap(r * 1.012, L, r * (isCat ? 0.77 : 0.69), irisW, seg(4, qf, 3))), coat.iris, { rigid: `eye.${s}` });
    mb.add(toModel(cap(r * 1.03, L, r * (isCat ? 0.64 : 0.42), pupW, seg(4, qf, 3), isCat ? 0.375 : 1)), PALETTE.ink, { rigid: `pupil.${s}` });
    // Highlight (up and toward the key light).
    const hd = [L[0] + 0.3, L[1] + 0.32, L[2]], hn = Math.hypot(hd[0], hd[1], hd[2]);
    mb.add(toModel(cap(r * 1.045, [hd[0] / hn, hd[1] / hn, hd[2] / hn], r * 0.2, seg(7, qf, 5), 2)), PALETTE.catWhite, { rigid: `eye.${s}` });
    // Upper lid: spherical shell cap around +Y; lower lid around -Y (rotated by their bones).
    // Lid fur = the coat just in front of the eye (so a Siamese mask colours its lids too).
    const lidColor = headFn(c[0], c[1] + r * 0.5, c[2] - r * 0.8, 0, 0);
    const lidR = r * 1.1;
    mb.add(toModel(ellipsoid([0, 0, 0], [lidR, lidR, lidR], seg(12, qf, 8), seg(4, q, 3), { vMax: 0.42 })), lidColor, { rigid: `lidUp.${s}` });
    if (!isLite(q)) {
    const lo = ellipsoid([0, 0, 0], [lidR * 0.99, lidR * 0.99, lidR * 0.99], seg(8, q, 6), seg(3, q, 3), { vMax: 0.42 });
    for (let i = 1; i < lo.pos.length; i += 3) lo.pos[i] = -lo.pos[i];
    for (let i = 0; i < lo.idx.length; i += 3) { const tmp = lo.idx[i + 1]; lo.idx[i + 1] = lo.idx[i + 2]; lo.idx[i + 2] = tmp; }
    mb.add(toModel(lo), headFn(c[0], c[1] - r, c[2] - r * 0.5, 0, 0), { rigid: `lidLo.${s}` });
    }
    // X eyes for the comic death read (collapsed inside the head unless dead).
    const xe = onEye(1.05);
    for (const a of [0.785, -0.785]) {
      mb.add(toModel(xform(ellipsoid([0, 0, 0], [r * 0.14, r * 0.95, r * 0.1], 4, 3, { p: 3 }), xe, [pitch, yaw, a])), PALETTE.ink, { rigid: 'xEyes' });
    }
    // Brow: a wedge, thick at the inner end, so an angled brow reads as a V (fierce) or a tent (worried).
    const bw = plan.brow, BL = bw.r[0], BT = bw.r[1];
    const brow = sweep([[-k * BL, -BT * 0.2, BT * 0.25], [-k * BL * 0.1, BT * 0.35, 0], [k * BL, -BT * 0.3, BT * 0.5]],
      [[BT * 1.25, bw.r[2] * 1.05], [BT * 0.95, bw.r[2]], [BT * 0.5, bw.r[2] * 0.7]], seg(6, q, 5), { up: [0, 1, 0], capStart: 1, capEnd: 1, capStartLen: 0.7, capEndLen: 0.9 });
    mb.add(xform(brow, j.brow[s], [0, -0.25 * k, -0.08 * k]), coat.brow, { rigid: `brow.${s}` });
  }

  return { snoutTip, headTop: j.headTop[1] };
}

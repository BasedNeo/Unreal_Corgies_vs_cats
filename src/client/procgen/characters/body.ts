// Fur body + face for one species/coat, built as merged smooth primitives on the shared skeleton.
// Color regions follow shape boundaries (muzzle, cheeks, bib, socks, inner ears) so they stay crisp;
// soft markings (blaze, cap, stripes, points) are per-vertex palette functions.
import { PALETTE } from '../../style/style-tokens.js';
import { mixHex } from './colors';
import { ellipsoid, sweep, mirrorX, xform, seg, isLite, type ColorFn, type MeshBuilder, type Prim, type V3 } from './mesh-builder';
import { computeJoints, SIDES, SX, type P3 } from './skeleton';
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
export function buildBody(mb: MeshBuilder, plan: BodyPlan, coat: Coat, q: number): FaceInfo {
  const j = computeJoints(plan);
  const H = plan.headY;
  const isCat = plan.species === 'cat';
  const headFn = headColorFn(plan, coat);

  mb.begin('torso');
  // --- torso -------------------------------------------------------------------------------
  const T = plan.torso;
  const torsoPath: V3[] = T.y.map((y, i) => [0, y, T.z[i]]);
  const torsoR: [number, number][] = T.rx.map((rx, i) => [rx, T.rz[i]]);
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
  mb.add(ellipsoid([0, plan.neckY - 0.005, -0.1], [0.15, 0.1, 0.085], seg(10, q, 8), seg(6, q, 4), {
    mod: (u, v) => (v > 0.5 ? 1 + ruffTufts * (Math.round(u * seg(10, q, 8)) % 2) * sstep(0.5, 0.85, v) : 1),
  }), ruffColor, { auto: ['chest', 'neck'] });

  // Fluffy rear: two cream "buns" (corgi) with base-colored tops.
  if (plan.butt) {
    const b = plan.butt;
    const buttColor: ColorFn = (_x, y) => (y < b.y + 0.02 ? coat.light : coat.pattern === 'tri' ? coat.dark : coat.base);
    const lobe = ellipsoid([b.x, b.y, b.z], [b.r, b.r * 0.92, b.r * 0.85], seg(8, q, 6), seg(6, q, 5), {
      mod: (u, v) => 1 + 0.07 * (Math.round(u * seg(8, q, 6)) % 2) * sstep(0.45, 0.8, v),
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
    mod: tl.fluffy ? (t, u) => 1 + 0.22 * (Math.round(u * tailN) % 2) * sstep(0.2, 0.6, t) : undefined,
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
      mod: fluffPants ? (t, u) => { const back = Math.max(0, Math.cos((u - 0.0) * Math.PI * 2)); return 1 + 0.16 * back * sstep(0.55, 0.1, t) * (Math.round(u * legN) % 2 ? 1 : 0.4); } : undefined,
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
  mb.add(ellipsoid(headAt(hc.c), hc.r, seg(20, q, 12), seg(14, q, 9), { p: isCat ? 2.15 : 2 }), headFn, { rigid: 'head' });

  // Cheek fluff (tufted outward and down).
  const ch = plan.cheek;
  const cheekColor: ColorFn = isCat ? headFn : (x, y, z) => (coat.pattern === 'tri' ? coat.base : coat.light) ?? headFn(x, y, z, 0, 0);
  const cw = seg(12, q, 6);
  const cheek = ellipsoid(headAt(ch.c), ch.r, cw, seg(8, q, 5), {
    mod: (u, v, dx, dy) => (ch.tufts ? 1 + 0.07 * (Math.round(u * cw) % 2) * sstep(0.3, 0.8, Math.abs(dx)) * sstep(0.2, -0.5, dy) : 1),
  });
  const cheekCol: ColorFn = isCat ? (x, y, z, u, v) => (coat.pattern === 'tux' ? coat.light : coat.pattern === 'points' ? mixHex(coat.base, coat.dark, 0.7) : headFn(x, y, z, u, v)) : cheekColor;
  mb.add(cheek, cheekCol, { rigid: 'head' });
  mb.add(mirrorX(cheek), cheekCol, { rigid: 'head' });

  // Muzzle (corgi, fox-like) or whisker pads (cat).
  const muzzleColor = coat.pattern === 'points' ? coat.dark : coat.pattern === 'sphynx' ? coat.base : coat.light;
  let snoutTip: V3;
  if (plan.muzzle) {
    const m = plan.muzzle;
    const mid = lerp3(m.base, m.tip, 0.55);
    mb.add(sweep([headAt(m.base), headAt(mid as P3), headAt(m.tip)], [[m.rBase[1], m.rBase[0]], [(m.rBase[1] + m.rTip[1]) / 2 * 1.02, (m.rBase[0] + m.rTip[0]) / 2 * 1.05], [m.rTip[1], m.rTip[0]]], seg(10, q, 8), {
      up: [0, 1, 0], capStart: 1, capEnd: 2, capEndLen: 0.8,
    }), muzzleColor, { rigid: 'head' });
    snoutTip = headAt([m.tip[0], m.tip[1], m.tip[2] - m.rTip[0] * 0.8]);
  } else {
    const pd = plan.pads!;
    const pad = ellipsoid(headAt(pd.c), [pd.r, pd.r * 0.82, pd.r * 0.85], seg(8, q, 6), seg(6, q, 5));
    mb.add(pad, muzzleColor, { rigid: 'head' });
    mb.add(mirrorX(pad), muzzleColor, { rigid: 'head' });
    snoutTip = headAt([0, pd.c[1], pd.c[2] - pd.r * 0.85]);
  }
  // Nose.
  const nz = plan.nose;
  mb.add(ellipsoid(headAt(nz.c), nz.r, seg(8, q, 6), seg(5, q, 4), { p: isCat ? 2 : 2.2, mod: isCat ? (_u, _v, _dx, dy) => 1 + 0.25 * Math.max(0, dy) : undefined }), coat.nose, { rigid: 'head' });

  // Mouth interior (revealed when the jaw drops), chin, tongue.
  const jw = plan.jaw;
  const mouthDark = mixHex(PALETTE.ink, PALETTE.danger, 0.35);
  const mouthC = lerp3(headAt(jw.a), headAt(jw.b), 0.5);
  mb.add(ellipsoid([mouthC[0], mouthC[1] + 0.018, mouthC[2]], [jw.r[0] * 0.85, 0.03, Math.abs(jw.b[2] - jw.a[2]) * 0.5 + 0.01], seg(6, q, 5), seg(4, q, 3)), mouthDark, { rigid: 'head' });
  mb.add(sweep([headAt(jw.a), headAt(jw.b)], [[jw.r[1], jw.r[0]], [jw.r[1] * 0.8, jw.r[0] * 0.7]], seg(8, q, 6), { up: [0, 1, 0], capStart: 1, capEnd: 2 }), muzzleColor, { rigid: 'jaw' });
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
    const sclera = mixHex(PALETTE.catWhite, PALETTE.hullLight, 0.2);
    mb.add(toModel(ellipsoid([0, 0, 0], [r, r, r], seg(10, q, 7), seg(7, q, 5))), sclera, { rigid: `eyeSocket.${s}` });
    if (isCat) {
      mb.add(toModel(xform(ellipsoid([0, 0, 0], [r * 0.74, r * 0.8, r * 0.2], seg(12, q, 8), seg(4, q, 3)), onEye(0.9), faceRot)), coat.iris, { rigid: `eye.${s}` });
      mb.add(toModel(xform(ellipsoid([0, 0, 0], [r * 0.2, r * 0.62, r * 0.14], seg(6, q, 5), seg(3, q, 3)), onEye(0.99), faceRot)), PALETTE.ink, { rigid: `pupil.${s}` });
    } else {
      mb.add(toModel(xform(ellipsoid([0, 0, 0], [r * 0.66, r * 0.72, r * 0.2], seg(12, q, 8), seg(4, q, 3)), onEye(0.9), faceRot)), coat.iris, { rigid: `eye.${s}` });
      mb.add(toModel(xform(ellipsoid([0, 0, 0], [r * 0.4, r * 0.44, r * 0.14], seg(6, q, 5), seg(3, q, 3)), onEye(0.99), faceRot)), PALETTE.ink, { rigid: `pupil.${s}` });
    }
    // Highlight (up and toward the key light).
    const hl = onEye(1.07);
    mb.add(toModel(xform(ellipsoid([0, 0, 0], [r * 0.2, r * 0.22, r * 0.1], seg(5, q, 4), 3), [hl[0] + r * 0.28, hl[1] + r * 0.3, hl[2] + r * 0.02], faceRot)), PALETTE.catWhite, { rigid: `eye.${s}` });
    // Upper lid: spherical shell cap around +Y; lower lid around -Y (rotated by their bones).
    const lidColor = headFn(c[0] + 0.0, c[1] + r * 1.2, c[2] - r * 0.3, 0, 0);
    const lidR = r * 1.08;
    mb.add(toModel(ellipsoid([0, 0, 0], [lidR, lidR, lidR], seg(10, q, 8), seg(4, q, 3), { vMax: 0.42 })), lidColor, { rigid: `lidUp.${s}` });
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
    // Brow pad.
    const bw = plan.brow;
    mb.add(xform(ellipsoid([0, 0, 0], bw.r, seg(6, q, 5), seg(4, q, 3)), j.brow[s], [0, -0.25 * k, -0.12 * k]), coat.brow, { rigid: `brow.${s}` });
  }

  return { snoutTip, headTop: j.headTop[1] };
}

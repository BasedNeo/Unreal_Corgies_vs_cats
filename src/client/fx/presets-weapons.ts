// OWNER: X3 (weapons + combat feedback). Weapon effect recipes on the L5 particle pools: muzzle flashes by weight
// class (forward flame tongue, brake petals, a hot core, sparks, smoke wisps), amber tracers with a white-hot core,
// ejected brass that bounces and shrinks away, impacts by surface (dirt, grass, sand, stone, metal sparks, wood
// splinters, water splashes, soft fibres), the comic pet hit (fur tufts + a small red comic splat, never real blood)
// and the bigger explosion (fireball, smoke column, embers, dirt spray).
// Theme data: colours come from the style palette only. No allocations: numbers in, one module-level spec reused.
import { PALETTE } from '../style/style-tokens.js';
import { Curve, Fade, Mode, Shape, makeSpec, resetSpec, type ParticleSpec } from './particle-pool';
import { Surface } from './surfaces';
import { TRACER_SPEED } from './delays';
import type { FxPools } from './presets';
import type { WeaponFx } from './weapon-fx';

const S: ParticleSpec = makeSpec();

/** Palette hex (sRGB) → linear RGB × k: the particle materials write colour straight into the linear HDR scene. */
const lin = (c: number) => Math.pow(c / 255, 2.2);
function rgb(hex: number, k = 1): [number, number, number] {
  return [lin((hex >> 16) & 255) * k, lin((hex >> 8) & 255) * k, lin(hex & 255) * k];
}
function mixRgb(a: number, b: number, t: number, k = 1): [number, number, number] {
  const A = rgb(a), B = rgb(b);
  return [(A[0] + (B[0] - A[0]) * t) * k, (A[1] + (B[1] - A[1]) * t) * k, (A[2] + (B[2] - A[2]) * t) * k];
}
const C = {
  smoke: mixRgb(PALETTE.hullDark, PALETTE.concrete, 0.35, 0.75), smokeDark: mixRgb(PALETTE.hullDark, PALETTE.ink, 0.45, 1),
  mist: mixRgb(PALETTE.water, PALETTE.catWhite, 0.6, 0.85),
  brass: mixRgb(PALETTE.accentHot, PALETTE.fenceDark, 0.35), brassHi: mixRgb(PALETTE.accentHot, PALETTE.catWhite, 0.3, 0.9),
  hull: mixRgb(PALETTE.danger, PALETTE.ink, 0.15), steel: mixRgb(PALETTE.concrete, PALETTE.hullDark, 0.5),
  dirt: rgb(PALETTE.dirt), mulch: rgb(PALETTE.mulch), dust: mixRgb(PALETTE.hull, PALETTE.dirt, 0.35, 0.9),
  sand: mixRgb(PALETTE.hullLight, PALETTE.fenceWood, 0.45, 0.9), grass: rgb(PALETTE.grass), grassDark: rgb(PALETTE.grassDark),
  stone: mixRgb(PALETTE.concrete, PALETTE.hullDark, 0.25), stoneLight: mixRgb(PALETTE.concrete, PALETTE.hullLight, 0.4, 0.9),
  wood: rgb(PALETTE.fenceWood), woodLight: mixRgb(PALETTE.fenceWood, PALETTE.hullLight, 0.45), woodDark: rgb(PALETTE.fenceDark),
  sawdust: mixRgb(PALETTE.hullLight, PALETTE.fenceWood, 0.3, 0.9),
  water: rgb(PALETTE.water), waterLight: mixRgb(PALETTE.water, PALETTE.catWhite, 0.65, 0.85),
  fibre: mixRgb(PALETTE.grassDry, PALETTE.hull, 0.4),
  splat: rgb(PALETTE.danger), splatHi: mixRgb(PALETTE.danger, PALETTE.catWhite, 0.3),
  fire: rgb(0xff5a14), fireHot: rgb(0xffa412), fireCore: rgb(PALETTE.accentHot),
};

function color(s: ParticleSpec, c: readonly number[], k = 1): void { s.r = c[0] * k; s.g = c[1] * k; s.b = c[2] * k; }
/** Glow colours per call: a 256-entry sRGB→linear table keeps this allocation- and pow-free on the hot path. */
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) LIN[i] = lin(i);
function colorHex(s: ParticleSpec, hex: number, k: number): void { s.r = LIN[(hex >> 16) & 255] * k; s.g = LIN[(hex >> 8) & 255] * k; s.b = LIN[hex & 255] * k; }
function n(p: FxPools, base: number): number { return base <= 0 ? 0 : Math.max(1, Math.round(base * p.density)); }

/**
 * Muzzle flash by weight class, oriented along the shot (dx, dy, dz: unit, muzzle → hit) with `rx, ry, rz` the
 * weapon's right vector (unit). Heavier weapons: bigger burst, longer tongue, more petals, more smoke.
 */
export function muzzle(p: FxPools, w: WeaponFx, x: number, y: number, z: number, dx: number, dy: number, dz: number, rx: number, ry: number, rz: number): void {
  const R = p.rng, sz = w.flashSize;
  if (sz <= 0) return;
  // up = right × forward
  const ux = ry * dz - rz * dy, uy = rz * dx - rx * dz, uz = rx * dy - ry * dx;
  if (w.klass === 'disc') {
    // flywheels, not powder: an air-blast ring off the muzzle, speed lines, a puff — no fire, no light
    resetSpec(S);
    S.x = x + dx * 0.08; S.y = y + dy * 0.08; S.z = z + dz * 0.08; S.vx = dx * 2.5; S.vy = dy * 2.5; S.vz = dz * 2.5; S.drag = 6;
    S.shape = Shape.Ring; S.param = 0.07; S.life = 0.2; S.size0 = sz * 0.3; S.size1 = sz * 1.2; S.fade = Fade.Soft;
    color(S, C.mist);
    p.solid.spawn(S); // an inked comic shockwave ring (air, not light)
    for (let i = 0; i < 3; i++) {
      resetSpec(S);
      const a = (i / 3) * Math.PI * 2 + R.sym(0.4), o = sz * 0.5;
      S.x = x + (rx * Math.cos(a) + ux * Math.sin(a)) * o; S.y = y + (ry * Math.cos(a) + uy * Math.sin(a)) * o; S.z = z + (rz * Math.cos(a) + uz * Math.sin(a)) * o;
      const sp = R.range(10, 14);
      S.vx = dx * sp; S.vy = dy * sp; S.vz = dz * sp; S.drag = 4; S.life = 0.16; S.size0 = 0.012; S.size1 = 0.006;
      S.mode = Mode.Stretched; S.stretch = 0.03; S.shape = Shape.Streak; S.fade = Fade.Fade; colorHex(S, 0xe8f6ff, 1.6);
      p.glow.spawn(S);
    }
    smoke(p, C.mist, w.smoke, x, y, z, dx, dy, dz, sz);
    return;
  }
  // hot core (white) + the coloured burst
  resetSpec(S);
  S.x = x + dx * sz * 0.15; S.y = y + dy * sz * 0.15; S.z = z + dz * sz * 0.15;
  S.life = 0.045; S.size0 = sz * 0.34; S.size1 = sz * 0.15; S.shape = Shape.Puff; S.fade = Fade.Fade; colorHex(S, 0xfff6d0, 3);
  p.glow.spawn(S);
  S.life = 0.06; S.size0 = sz * 0.6; S.size1 = sz * 0.3; S.shape = Shape.Burst; S.rot = R.sym(Math.PI); colorHex(S, w.flashColor, 2.2);
  p.glow.spawn(S);
  // forward flame tongue(s)
  if (w.flashLen > 0) {
    const L = w.flashLen * R.range(0.8, 1.2);
    resetSpec(S);
    S.x = x + dx * L * 0.5; S.y = y + dy * L * 0.5; S.z = z + dz * L * 0.5;
    S.mode = Mode.Stretched; S.len = L; S.ax = dx; S.ay = dy; S.az = dz; S.shape = Shape.Petal;
    S.life = 0.055; S.size0 = sz * 0.36; S.size1 = sz * 0.18; S.fade = Fade.Fade; colorHex(S, w.flashColor, 2.8);
    p.glow.spawn(S);
    // inner white tongue
    S.size0 = sz * 0.14; S.size1 = sz * 0.06; S.len = L * 0.6; S.x = x + dx * L * 0.3; S.y = y + dy * L * 0.3; S.z = z + dz * L * 0.3;
    colorHex(S, 0xfff2c8, 3);
    p.glow.spawn(S);
  }
  // brake / nozzle petals: sideways (2), a Y (3) or a cross (4)
  for (let i = 0; i < w.petals; i++) {
    const a = w.petals === 3 ? Math.PI / 2 + (i / 3) * Math.PI * 2 : (i / w.petals) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const px = rx * c + ux * s, py = ry * c + uy * s, pz = rz * c + uz * s;
    // petals lean forward a little
    let ax = px + dx * 0.35, ay = py + dy * 0.35, az = pz + dz * 0.35;
    const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    ax /= al; ay /= al; az /= al;
    const L = Math.max(0.12, w.flashLen * 0.5) * R.range(0.8, 1.15);
    resetSpec(S);
    S.x = x + ax * L * 0.5; S.y = y + ay * L * 0.5; S.z = z + az * L * 0.5;
    S.mode = Mode.Stretched; S.len = L; S.ax = ax; S.ay = ay; S.az = az; S.shape = Shape.Petal;
    S.life = 0.05; S.size0 = sz * 0.24; S.size1 = sz * 0.1; S.fade = Fade.Fade; colorHex(S, w.flashColor, 2.6);
    p.glow.spawn(S);
  }
  // sparks along the shot
  for (let i = 0, k = n(p, w.klass === 'shotgun' ? 2 : 2 + Math.round(sz * 5)); i < k; i++) {
    resetSpec(S);
    const sp = R.range(9, 16);
    S.x = x; S.y = y; S.z = z;
    S.vx = (dx + R.sym(0.35)) * sp; S.vy = (dy + R.sym(0.35)) * sp; S.vz = (dz + R.sym(0.35)) * sp;
    S.life = R.range(0.07, 0.14); S.size0 = 0.009; S.size1 = 0.004; S.mode = Mode.Stretched; S.stretch = 0.012; S.shape = Shape.Streak;
    S.gravity = 6; colorHex(S, w.flashColor, 2.6); S.fade = Fade.Fade; S.drag = 5;
    p.glow.spawn(S);
  }
  smoke(p, w.klass === 'shotgun' ? C.mist : C.smoke, w.smoke, x, y, z, dx, dy, dz, sz);
}

/** Muzzle smoke: halftone wisps that drift forward, rise, grow and thin out. */
export function smoke(p: FxPools, c: readonly number[], count: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, scale: number): void {
  const R = p.rng;
  for (let i = 0, k = n(p, count); i < k; i++) {
    resetSpec(S);
    const f = R.range(0.2, 1.4);
    S.x = x + dx * 0.05 * i; S.y = y + dy * 0.05 * i; S.z = z + dz * 0.05 * i;
    S.vx = dx * f + R.sym(0.35); S.vy = dy * f + R.range(0.2, 0.6); S.vz = dz * f + R.sym(0.35);
    S.drag = 2.2; S.gravity = -0.35; S.life = R.range(0.55, 1.05);
    S.size0 = 0.04 + scale * 0.15; S.size1 = R.range(0.16, 0.3) * (0.6 + scale); S.curve = Curve.Linear;
    S.shape = Shape.Puff; S.param = 0; S.rot = R.sym(3); S.spin = R.sym(0.8);
    S.fade = Fade.Soft; S.alpha = R.range(0.35, 0.55); color(S, c, R.range(0.9, 1.08));
    p.solid.spawn(S);
  }
}

/** Soft light spill on the ground under a flash (additive, flat): reads as the muzzle lighting the yard. */
export function groundGlow(p: FxPools, x: number, groundY: number, z: number, hex: number, size: number, k: number, life = 0.07): void {
  resetSpec(S);
  S.x = x; S.y = groundY + 0.03; S.z = z; S.mode = Mode.Ground; S.shape = Shape.Glow; S.life = life;
  S.size0 = size; S.size1 = size * 0.8; S.fade = Fade.Fade; colorHex(S, hex, k);
  p.glow.spawn(S);
}

/** A glowing tracer: an amber halo streak with a white-hot core, flying muzzle → hit and dying exactly there. */
export function tracer(p: FxPools, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number, glow: number, width: number): void {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 0.25) return;
  const speed = TRACER_SPEED;
  resetSpec(S);
  S.x = x0; S.y = y0; S.z = z0;
  S.vx = dx / d * speed; S.vy = dy / d * speed; S.vz = dz / d * speed;
  S.life = Math.max(0.04, d / speed); S.size0 = width; S.size1 = width * 0.85;
  S.mode = Mode.Stretched; S.stretch = 0.03; S.shape = Shape.Streak;
  colorHex(S, hex, glow);
  p.glow.spawn(S);
  S.size0 = width * 0.38; S.size1 = width * 0.3; S.stretch = 0.022; colorHex(S, 0xfff6e0, glow * 1.3);
  p.glow.spawn(S);
}

/**
 * Ejected casing from the port at (x, y, z): kicked right (rx..) and up (ux..), spinning, bouncing on `floorY`,
 * shrinking away at the end. 'shell' = a red shotgun hull, 'magnum' = long rifle brass, 'pistol' = short brass.
 */
export function casing(p: FxPools, kind: 'rifle' | 'pistol' | 'magnum' | 'shell', x: number, y: number, z: number, rx: number, ry: number, rz: number, bx: number, by: number, bz: number, floorY: number): void {
  const R = p.rng;
  resetSpec(S);
  const side = R.range(1.6, 2.6), up = R.range(1.4, 2.4), back = R.range(0.2, 0.8);
  S.x = x; S.y = y; S.z = z;
  S.vx = rx * side + bx * back; S.vy = ry * side + by * back + up; S.vz = rz * side + bz * back;
  S.gravity = 11; S.drag = 0.4; S.life = R.range(1.2, 1.7); S.curve = Curve.HoldShrink;
  const big = kind === 'magnum' || kind === 'shell';
  // a touch oversized for pet scale, so the brass reads at 4 m
  S.size0 = kind === 'pistol' ? 0.024 : big ? 0.042 : 0.031; S.size1 = S.size0;
  S.shape = Shape.Casing; S.rot = R.sym(Math.PI); S.spin = R.sym(26) + (R.next() < 0.5 ? -14 : 14); S.param = 0.22;
  S.floorY = floorY + S.size0 * 0.5; S.bounce = 0.42;
  color(S, kind === 'shell' ? C.hull : R.next() < 0.3 ? C.brassHi : C.brass);
  p.solid.spawn(S);
}

// ---------------------------------------------------------------------------------------------
// Impacts by surface

/** Direction helper: a random unit-ish vector in a cone around (ax, ay, az) (not normalized exactly; fine for FX). */
let vx = 0, vy = 0, vz = 0;
function cone(p: FxPools, ax: number, ay: number, az: number, spread: number): void {
  const R = p.rng;
  vx = ax + R.sym(spread); vy = ay + R.sym(spread); vz = az + R.sym(spread);
  const l = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
  vx /= l; vy /= l; vz /= l;
}

/**
 * Surface impact at (x, y, z) with surface normal (nx, ny, nz) for a shot along (dx, dy, dz) (unit).
 * `scale` = weapon impact scale; `groundY` = where debris lands.
 */
export function impact(p: FxPools, surface: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, dx: number, dy: number, dz: number, scale: number, groundY: number): void {
  const R = p.rng;
  // Reflected direction (ricochets / spray): r = d − 2(d·n)n, then leaned toward the normal.
  const dn = dx * nx + dy * ny + dz * nz;
  let rx = dx - 2 * dn * nx, ry = dy - 2 * dn * ny, rz = dz - 2 * dn * nz;
  rx = rx * 0.5 + nx * 0.8; ry = ry * 0.5 + ny * 0.8; rz = rz * 0.5 + nz * 0.8;
  const px = x + nx * 0.03, py = y + ny * 0.03, pz = z + nz * 0.03;
  const k = scale;
  switch (surface) {
    case Surface.Metal: {
      // hot white flash + a fan of sparks + two dark shards + a wisp
      resetSpec(S);
      S.x = px; S.y = py; S.z = pz; S.life = 0.06; S.size0 = 0.2 * k; S.size1 = 0.06; S.shape = Shape.Burst; S.fade = Fade.Fade;
      S.rot = R.sym(3); colorHex(S, 0xfff2d0, 3.6);
      p.glow.spawn(S);
      for (let i = 0, c = n(p, 8 * k); i < c; i++) {
        cone(p, rx, ry, rz, 0.75);
        resetSpec(S);
        const sp = R.range(5, 12) * Math.sqrt(k);
        S.x = px; S.y = py; S.z = pz; S.vx = vx * sp; S.vy = vy * sp; S.vz = vz * sp;
        S.gravity = 14; S.drag = 1.5; S.life = R.range(0.18, 0.42); S.size0 = 0.018; S.size1 = 0.008;
        S.mode = Mode.Stretched; S.stretch = 0.025; S.shape = Shape.Streak; S.fade = Fade.Fade;
        S.floorY = groundY; S.bounce = 0.35;
        colorHex(S, i % 3 === 0 ? 0xfff0b0 : PALETTE.glowOrange, 3.2);
        p.glow.spawn(S);
      }
      for (let i = 0, c = n(p, 2); i < c; i++) {
        cone(p, rx, ry, rz, 0.9);
        resetSpec(S);
        S.x = px; S.y = py; S.z = pz; S.vx = vx * 3; S.vy = vy * 3 + 1; S.vz = vz * 3;
        S.gravity = 14; S.life = R.range(0.4, 0.6); S.size0 = 0.04; S.size1 = 0.026; S.curve = Curve.HoldShrink;
        S.shape = Shape.Shard; S.rot = R.sym(3); S.spin = R.sym(20); S.param = 0.3; S.floorY = groundY; S.bounce = 0.3;
        color(S, C.steel);
        p.solid.spawn(S);
      }
      smoke(p, C.smoke, 1, px, py, pz, nx * 0.4, ny * 0.4, nz * 0.4, 0.2);
      break;
    }
    case Surface.Wood: {
      // splinters (pale slivers) + a sawdust puff
      for (let i = 0, c = n(p, 6 * k); i < c; i++) {
        cone(p, rx, ry, rz, 0.8);
        resetSpec(S);
        const sp = R.range(2.5, 6) * Math.sqrt(k);
        S.x = px; S.y = py; S.z = pz; S.vx = vx * sp; S.vy = vy * sp + 1; S.vz = vz * sp;
        S.gravity = 13; S.drag = 1; S.life = R.range(0.5, 0.9); S.size0 = R.range(0.048, 0.08) * Math.sqrt(k); S.size1 = 0.04;
        S.curve = Curve.HoldShrink; S.shape = Shape.Shard; S.rot = R.sym(3); S.spin = R.sym(18); S.param = 0.26;
        S.floorY = groundY; S.bounce = 0.3;
        color(S, i % 3 === 0 ? C.woodDark : i % 3 === 1 ? C.woodLight : C.wood);
        p.solid.spawn(S);
      }
      puff(p, C.sawdust, px, py, pz, nx, ny, nz, 0.22 * k, 0.65);
      break;
    }
    case Surface.Stone: {
      for (let i = 0, c = n(p, 5 * k); i < c; i++) {
        cone(p, rx, ry, rz, 0.85);
        resetSpec(S);
        const sp = R.range(2.5, 6);
        S.x = px; S.y = py; S.z = pz; S.vx = vx * sp; S.vy = vy * sp + 1; S.vz = vz * sp;
        S.gravity = 15; S.life = R.range(0.45, 0.8); S.size0 = R.range(0.034, 0.06) * Math.sqrt(k); S.size1 = 0.028;
        S.curve = Curve.HoldShrink; S.shape = i % 2 ? Shape.Shard : Shape.Chunk; S.rot = R.sym(3); S.spin = R.sym(16); S.param = 0.3;
        S.floorY = groundY; S.bounce = 0.35; color(S, i % 2 ? C.stone : C.stoneLight);
        p.solid.spawn(S);
      }
      for (let i = 0, c = n(p, 2); i < c; i++) { // a couple of pale sparks off hard stone
        cone(p, rx, ry, rz, 0.6);
        resetSpec(S);
        S.x = px; S.y = py; S.z = pz; S.vx = vx * 7; S.vy = vy * 7; S.vz = vz * 7; S.gravity = 12; S.life = 0.14;
        S.size0 = 0.014; S.size1 = 0.006; S.mode = Mode.Stretched; S.stretch = 0.02; S.shape = Shape.Streak; S.fade = Fade.Fade;
        colorHex(S, 0xfff0c8, 2.4);
        p.glow.spawn(S);
      }
      puff(p, C.stoneLight, px, py, pz, nx, ny, nz, 0.24 * k, 0.7);
      break;
    }
    case Surface.Water: {
      // a splash column + crown ring on the surface + mist
      for (let i = 0, c = n(p, 8 * k); i < c; i++) {
        resetSpec(S);
        S.x = x + R.sym(0.08); S.y = y + 0.02; S.z = z + R.sym(0.08);
        S.vx = R.sym(1.3) - dx * 0.8; S.vy = R.range(2.5, 5.2) * Math.sqrt(k); S.vz = R.sym(1.3) - dz * 0.8;
        S.gravity = 12; S.life = R.range(0.45, 0.75); S.size0 = R.range(0.04, 0.07) * Math.sqrt(k); S.size1 = 0.025;
        S.curve = Curve.HoldShrink; S.shape = Shape.Puff; S.param = 0.28; S.floorY = y - 0.02; S.bounce = 0;
        color(S, i % 2 ? C.water : C.waterLight);
        p.solid.spawn(S);
      }
      resetSpec(S);
      S.x = x; S.y = y + 0.015; S.z = z; S.mode = Mode.Ground; S.shape = Shape.Ring; S.param = 0.1;
      S.life = 0.5; S.size0 = 0.08; S.size1 = 0.5 * k; color(S, C.waterLight);
      p.solid.spawn(S);
      puff(p, C.mist, x, y + 0.1, z, 0, 1, 0, 0.26 * k, 0.55);
      break;
    }
    case Surface.Soft: {
      for (let i = 0, c = n(p, 4); i < c; i++) {
        cone(p, rx, ry, rz, 1);
        resetSpec(S);
        S.x = px; S.y = py; S.z = pz; S.vx = vx * 2.5; S.vy = vy * 2.5 + 1.2; S.vz = vz * 2.5;
        S.gravity = 5; S.drag = 2.5; S.life = R.range(0.5, 0.8); S.size0 = 0.05; S.size1 = 0.035; S.curve = Curve.HoldShrink;
        S.shape = Shape.Tuft; S.rot = R.sym(3); S.spin = R.sym(8); S.param = 0.3; color(S, i % 2 ? C.fibre : C.dust);
        p.solid.spawn(S);
      }
      puff(p, C.dust, px, py, pz, nx, ny, nz, 0.2 * k, 0.6);
      break;
    }
    default: { // dirt, grass, sand: clods (bouncing), a dirt spray, the dust puff (+ grass bits on grass)
      const sand = surface === Surface.Sand, grass = surface === Surface.Grass;
      for (let i = 0, c = n(p, 4 * k); i < c; i++) {
        cone(p, rx, ry, rz, 0.7);
        resetSpec(S);
        const sp = R.range(2.5, 5.5) * Math.sqrt(k);
        S.x = px; S.y = py; S.z = pz; S.vx = vx * sp; S.vy = vy * sp + 1.2; S.vz = vz * sp;
        S.gravity = 16; S.life = R.range(0.5, 0.8); S.size0 = R.range(0.04, 0.08) * Math.sqrt(k); S.size1 = 0.034; S.curve = Curve.HoldShrink;
        S.shape = Shape.Chunk; S.rot = R.sym(3); S.spin = R.sym(14); S.param = 0.34; S.floorY = groundY; S.bounce = 0.3;
        color(S, sand ? C.sand : i % 2 ? C.dirt : C.mulch);
        p.solid.spawn(S);
      }
      if (grass) {
        for (let i = 0, c = n(p, 3); i < c; i++) {
          resetSpec(S);
          S.x = px; S.y = py; S.z = pz; S.vx = R.sym(2); S.vy = R.range(2, 4); S.vz = R.sym(2);
          S.gravity = 8; S.drag = 2.5; S.life = R.range(0.4, 0.7); S.size0 = 0.06; S.size1 = 0.035; S.curve = Curve.HoldShrink;
          S.shape = Shape.Tuft; S.rot = R.sym(3); S.spin = R.sym(10); S.param = 0.3; color(S, i % 2 ? C.grass : C.grassDark);
          p.solid.spawn(S);
        }
      }
      // spray column (a quick upward jet of dark soil)
      resetSpec(S);
      S.x = px; S.y = py; S.z = pz; S.vx = rx * 3.5; S.vy = ry * 3.5 + 1; S.vz = rz * 3.5; S.gravity = 10; S.drag = 3;
      S.life = 0.28; S.size0 = 0.05 * k; S.size1 = 0.16 * k; S.shape = Shape.Puff; S.param = 0.14; S.rot = R.sym(3);
      color(S, sand ? C.sand : C.mulch);
      p.solid.spawn(S);
      puff(p, sand ? C.sand : C.dust, px, py, pz, nx, ny, nz, 0.26 * k, 0.75);
      break;
    }
  }
}

/** A dust/sawdust puff that pops then thins out in halftone. */
function puff(p: FxPools, c: readonly number[], x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, alpha: number): void {
  const R = p.rng;
  resetSpec(S);
  S.x = x; S.y = y; S.z = z; S.vx = nx * 0.8; S.vy = ny * 0.8 + 0.35; S.vz = nz * 0.8; S.drag = 2.5; S.gravity = -0.2;
  S.life = R.range(0.5, 0.75); S.size0 = size * 0.4; S.size1 = size; S.curve = Curve.Linear; S.shape = Shape.Puff;
  S.param = 0.1; S.rot = R.sym(3); S.fade = Fade.Soft; S.alpha = alpha; color(S, c);
  p.solid.spawn(S);
}

/**
 * The comic pet hit (on top of L5's fur tufts): a small red comic splat that pops and shrinks in 0.25 s, drawn a
 * little toward the camera (never a pool, never on the ground: rated for everyone). Crits splat bigger.
 */
export function comicSplat(p: FxPools, x: number, y: number, z: number, towardX: number, towardY: number, towardZ: number, crit: boolean): void {
  const R = p.rng;
  resetSpec(S);
  S.x = x + towardX * 0.12; S.y = y + towardY * 0.12; S.z = z + towardZ * 0.12;
  S.life = crit ? 0.3 : 0.24; S.size0 = 0.04; S.size1 = crit ? 0.24 : 0.17; S.curve = Curve.Pop;
  S.shape = Shape.Splat; S.rot = R.sym(Math.PI); S.param = 0.16; color(S, crit ? C.splatHi : C.splat);
  p.solid.spawn(S);
  // two droplets flicked off the splat
  for (let i = 0; i < (crit ? 3 : 2); i++) {
    resetSpec(S);
    S.x = x + towardX * 0.12; S.y = y + towardY * 0.12; S.z = z + towardZ * 0.12;
    S.vx = R.sym(2.2); S.vy = R.range(1, 2.6); S.vz = R.sym(2.2); S.gravity = 9; S.life = R.range(0.25, 0.4);
    S.size0 = 0.035; S.size1 = 0.02; S.curve = Curve.HoldShrink; S.shape = Shape.Puff; S.param = 0.3; color(S, C.splat);
    p.solid.spawn(S);
  }
}

/** Claw swipe: three quick pale slash streaks at the victim (kittens' melee). */
export function clawSlash(p: FxPools, x: number, y: number, z: number, rx: number, rz: number): void {
  for (let i = 0; i < 3; i++) {
    resetSpec(S);
    const o = (i - 1) * 0.07;
    S.x = x + rx * o; S.y = y + 0.05 - i * 0.02; S.z = z + rz * o;
    S.mode = Mode.Stretched; S.len = 0.32; S.ax = rx * 0.35; S.ay = -0.94; S.az = rz * 0.35; S.shape = Shape.Petal;
    S.life = 0.14; S.size0 = 0.035; S.size1 = 0.01; S.fade = Fade.Fade; colorHex(S, 0xfff4dc, 2.2);
    p.glow.spawn(S);
  }
}

/**
 * The HARDENED explosion extras on top of L5's `explosion()`: a rolling fireball of petals and hot puffs, a dark
 * smoke column that rises and thins in halftone, long-lived embers and a dirt spray fountain.
 */
export function explosionExtras(p: FxPools, x: number, y: number, z: number, r: number, groundY: number): void {
  const R = p.rng;
  const k = Math.max(0.6, Math.min(2.2, r / 3));
  // fireball tongues (glow petals) bursting outward and up
  for (let i = 0, c = n(p, 6); i < c; i++) {
    // irregular tongues (random reach, width and lean) so the burst reads as fire, not a flower
    const a = R.range(0, Math.PI * 2), e = R.range(0.35, 1);
    let ax = Math.cos(a) * (1 - e * 0.55), ay = e, az = Math.sin(a) * (1 - e * 0.55);
    const l = Math.sqrt(ax * ax + ay * ay + az * az); ax /= l; ay /= l; az /= l;
    const L = R.range(0.5, 1.4) * k;
    resetSpec(S);
    S.x = x + ax * L * 0.5 + R.sym(0.2 * k); S.y = y + 0.3 + ay * L * 0.5; S.z = z + az * L * 0.5 + R.sym(0.2 * k);
    S.mode = Mode.Stretched; S.len = L; S.ax = ax; S.ay = ay; S.az = az; S.shape = Shape.Petal;
    S.life = R.range(0.1, 0.2); S.size0 = R.range(0.22, 0.4) * k; S.size1 = 0.12 * k; S.fade = Fade.Fade;
    colorHex(S, i % 3 ? PALETTE.glowOrange : PALETTE.accentHot, R.range(1.5, 2.1));
    p.glow.spawn(S);
  }
  // hot inner fireball puffs (inked, bright) that roll up
  for (let i = 0, c = n(p, 6); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2);
    S.x = x + Math.cos(a) * 0.3 * k; S.y = y + 0.4 * k; S.z = z + Math.sin(a) * 0.3 * k;
    S.vx = Math.cos(a) * R.range(1, 2.5) * k; S.vy = R.range(2, 4) * k; S.vz = Math.sin(a) * R.range(1, 2.5) * k;
    S.drag = 3; S.gravity = -1; S.life = R.range(0.3, 0.5); S.size0 = 0.3 * k; S.size1 = R.range(0.6, 0.9) * k; S.curve = Curve.Pop;
    S.shape = Shape.Puff; S.rot = R.sym(3); S.param = 0.1; color(S, i % 2 ? C.fireCore : C.fireHot, 0.95);
    p.solid.spawn(S);
  }
  // dark smoke column
  for (let i = 0, c = n(p, 9); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2), rr = R.range(0, 0.6) * k;
    S.x = x + Math.cos(a) * rr; S.y = y + 0.5 + i * 0.12 * k; S.z = z + Math.sin(a) * rr;
    S.vx = Math.cos(a) * 0.4 + R.sym(0.3); S.vy = R.range(1.4, 2.8); S.vz = Math.sin(a) * 0.4 + R.sym(0.3);
    S.drag = 0.9; S.gravity = -0.5; S.life = R.range(1.6, 2.6); S.size0 = 0.35 * k; S.size1 = R.range(0.9, 1.4) * k;
    S.shape = Shape.Puff; S.rot = R.sym(3); S.spin = R.sym(0.6); S.param = 0.05; S.fade = Fade.Soft; S.alpha = R.range(0.7, 0.9);
    color(S, i % 3 === 0 ? C.smoke : C.smokeDark);
    p.solid.spawn(S);
  }
  // embers
  for (let i = 0, c = n(p, 10); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2), sp = R.range(2, 6) * k;
    S.x = x; S.y = y + 0.4; S.z = z; S.vx = Math.cos(a) * sp; S.vz = Math.sin(a) * sp; S.vy = R.range(3, 8);
    S.gravity = 5; S.drag = 1.2; S.life = R.range(0.8, 1.5); S.size0 = 0.03; S.size1 = 0.012; S.shape = Shape.Puff;
    S.fade = Fade.Fade; colorHex(S, PALETTE.glowOrange, 3);
    S.floorY = groundY; S.bounce = 0.2;
    p.glow.spawn(S);
  }
  // dirt spray fountain (dark clods thrown high)
  for (let i = 0, c = n(p, 10); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2), sp = R.range(1.5, 4.5) * k;
    S.x = x + Math.cos(a) * 0.2; S.y = groundY + 0.1; S.z = z + Math.sin(a) * 0.2;
    S.vx = Math.cos(a) * sp; S.vz = Math.sin(a) * sp; S.vy = R.range(6, 11) * Math.sqrt(k);
    S.gravity = 18; S.life = R.range(0.9, 1.4); S.size0 = R.range(0.06, 0.12) * k; S.size1 = 0.05; S.curve = Curve.HoldShrink;
    S.shape = Shape.Chunk; S.rot = R.sym(3); S.spin = R.sym(14); S.param = 0.3; S.floorY = groundY; S.bounce = 0.3;
    color(S, i % 2 ? C.mulch : C.dirt);
    p.solid.spawn(S);
  }
}

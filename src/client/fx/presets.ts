// OWNER: L5 (juice). Effect recipes: each mutates one shared ParticleSpec and spawns into the solid (inked,
// opaque) or glow (additive, blooms) pool. Theme-swappable data: colors come from the style palette only.
// No allocations: recipes take numbers, reuse the module-level spec and a seeded FxRng.
import { PALETTE } from '../style/style-tokens.js';
import { Curve, Fade, FxRng, Mode, Shape, makeSpec, resetSpec, type ParticlePool, type ParticleSpec } from './particle-pool';

export interface FxPools { solid: ParticlePool; glow: ParticlePool; rng: FxRng; /** 0.35..1 particle budget scale. */ density: number }

const S: ParticleSpec = makeSpec();

// Linear-ish RGB triplets (0..1) from palette hex, computed once.
function rgb(hex: number, k = 1): [number, number, number] {
  return [((hex >> 16) & 255) / 255 * k, ((hex >> 8) & 255) / 255 * k, (hex & 255) / 255 * k];
}
const C = {
  dust: rgb(0xe9dcc0, 0.82), dustDark: rgb(0xb9a47e, 0.8), dirt: rgb(PALETTE.dirt), mulch: rgb(PALETTE.mulch),
  grass: rgb(PALETTE.grass), grassDark: rgb(PALETTE.grassDark), stuffing: rgb(0xfff6e4, 0.84),
  corgiFur: rgb(PALETTE.corgiOrange), corgiCream: rgb(PALETTE.corgiCream, 0.85), catFur: rgb(PALETTE.catGrey), catDark: rgb(PALETTE.catBlack, 1.4),
  teamCorgis: rgb(PALETTE.teamCorgis), teamCats: rgb(PALETTE.teamCats), gold: rgb(PALETTE.teamCorgisTrim),
  smoke: rgb(0x7a7268, 0.9), smokeLight: rgb(0xc9c0b0, 0.82), fire: rgb(0xff5a14), fireHot: rgb(0xffa412),
  water: rgb(PALETTE.water), waterLight: rgb(0xbfeaff, 0.85), white: rgb(0xfff4dc, 0.84),
};

function color(s: ParticleSpec, c: readonly number[], k = 1): void { s.r = c[0] * k; s.g = c[1] * k; s.b = c[2] * k; }
function colorHex(s: ParticleSpec, hex: number, k: number): void { s.r = ((hex >> 16) & 255) / 255 * k; s.g = ((hex >> 8) & 255) / 255 * k; s.b = (hex & 255) / 255 * k; }
function n(p: FxPools, base: number): number { return Math.max(1, Math.round(base * p.density)); }

/** Muzzle flash: spiky glow burst + a few sparks along the barrel direction. */
export function muzzleFlash(p: FxPools, x: number, y: number, z: number, dx: number, dy: number, dz: number, hex: number, size: number): void {
  const R = p.rng;
  resetSpec(S);
  S.x = x; S.y = y; S.z = z; S.life = 0.07; S.size0 = size; S.size1 = size * 0.6; S.shape = Shape.Burst;
  S.rot = R.sym(Math.PI); colorHex(S, hex, 3.2); S.fade = Fade.Fade;
  p.glow.spawn(S);
  // Hot white core.
  S.size0 = size * 0.45; S.size1 = size * 0.2; S.shape = Shape.Puff; colorHex(S, 0xfff6d0, 4);
  p.glow.spawn(S);
  for (let i = 0, k = n(p, 3); i < k; i++) {
    resetSpec(S);
    const sp = R.range(9, 16);
    S.x = x; S.y = y; S.z = z;
    S.vx = (dx + R.sym(0.35)) * sp; S.vy = (dy + R.sym(0.35)) * sp; S.vz = (dz + R.sym(0.35)) * sp;
    S.life = R.range(0.06, 0.12); S.size0 = 0.03; S.size1 = 0.015; S.mode = Mode.Stretched; S.stretch = 0.02; S.shape = Shape.Streak;
    colorHex(S, hex, 3); S.fade = Fade.Fade; S.drag = 6;
    p.glow.spawn(S);
  }
}

/** Tracer: a head-anchored glowing streak flying muzzle → hit, dying exactly at the hit point. */
export function tracer(p: FxPools, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number, glow: number, width = 0.045): void {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 0.2) return;
  const speed = 140;
  resetSpec(S);
  S.x = x0; S.y = y0; S.z = z0;
  S.vx = dx / d * speed; S.vy = dy / d * speed; S.vz = dz / d * speed;
  S.life = Math.max(0.045, d / speed); S.size0 = width; S.size1 = width * 0.8;
  S.mode = Mode.Stretched; S.stretch = 0.035; S.shape = Shape.Streak;
  colorHex(S, hex, glow);
  p.glow.spawn(S);
}

/** Laser: the whole beam at once, fading fast, plus a hot dot at the hit. */
export function laserBeam(p: FxPools, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number, glow: number): void {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 0.2) return;
  resetSpec(S);
  S.x = (x0 + x1) / 2; S.y = (y0 + y1) / 2; S.z = (z0 + z1) / 2;
  S.mode = Mode.Stretched; S.len = d; S.ax = dx / d; S.ay = dy / d; S.az = dz / d;
  S.life = 0.16; S.size0 = 0.06; S.size1 = 0.01; S.shape = Shape.Streak; S.fade = Fade.Fade;
  colorHex(S, hex, glow);
  p.glow.spawn(S);
  resetSpec(S);
  S.x = x1; S.y = y1; S.z = z1; S.life = 0.2; S.size0 = 0.28; S.size1 = 0.05; S.shape = Shape.Burst; S.fade = Fade.Fade;
  S.rot = p.rng.sym(3); colorHex(S, hex, glow);
  p.glow.spawn(S);
}

/** Sprinkler spray: chunky inked water droplets arcing toward the target. */
export function waterSpray(p: FxPools, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  const R = p.rng;
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const d = Math.max(0.5, Math.sqrt(dx * dx + dy * dy + dz * dz));
  const t = Math.min(0.6, d / 22);
  for (let i = 0, k = n(p, 5); i < k; i++) {
    resetSpec(S);
    S.x = x0; S.y = y0; S.z = z0;
    const j = R.range(0.85, 1.1);
    S.vx = dx / t * j + R.sym(1.2); S.vz = dz / t * j + R.sym(1.2); S.vy = dy / t + 12 * t * 0.5 + R.sym(1);
    S.gravity = 12; S.life = t * R.range(0.9, 1.1); S.size0 = R.range(0.06, 0.1); S.size1 = 0.04;
    S.shape = Shape.Puff; S.param = 0.28; color(S, i % 2 ? C.water : C.waterLight);
    p.solid.spawn(S);
  }
}

/** Frisbee: a pale whoosh streak. */
export function discWhoosh(p: FxPools, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  tracer(p, x0, y0, z0, x1, y1, z1, PALETTE.corgiCream, 1.6, 0.09);
}

/** Character hit: fur tufts in the victim's coat, stuffing puffs, a team-colored fleck; crits add stars. */
export function furHit(p: FxPools, x: number, y: number, z: number, cat: boolean, team: number, crit: boolean, dirX: number, dirZ: number): void {
  const R = p.rng;
  const fur = cat ? C.catFur : C.corgiFur, fur2 = cat ? C.catDark : C.corgiCream;
  const teamC = team === 1 ? C.teamCats : C.teamCorgis;
  for (let i = 0, k = n(p, crit ? 8 : 5); i < k; i++) {
    resetSpec(S);
    S.x = x; S.y = y; S.z = z;
    S.vx = dirX * R.range(1, 4) + R.sym(3); S.vy = R.range(1.5, 5); S.vz = dirZ * R.range(1, 4) + R.sym(3);
    S.gravity = 7; S.drag = 2.2; S.life = R.range(0.45, 0.8); S.size0 = R.range(0.07, 0.12); S.size1 = 0.05; S.curve = Curve.HoldShrink;
    S.shape = Shape.Tuft; S.rot = R.sym(Math.PI); S.spin = R.sym(10); S.param = 0.3;
    color(S, i % 3 === 2 ? fur2 : fur);
    p.solid.spawn(S);
  }
  for (let i = 0, k = n(p, crit ? 4 : 2); i < k; i++) {
    resetSpec(S);
    S.x = x; S.y = y; S.z = z; S.vx = R.sym(1.6); S.vy = R.range(0.5, 2); S.vz = R.sym(1.6);
    S.drag = 3; S.life = R.range(0.35, 0.55); S.size1 = R.range(0.14, 0.22); S.curve = Curve.Pop;
    S.shape = Shape.Puff; S.param = 0.2; S.rot = R.sym(3); color(S, C.stuffing);
    p.solid.spawn(S);
  }
  resetSpec(S);
  S.x = x; S.y = y; S.z = z; S.vx = R.sym(2); S.vy = R.range(2, 4); S.vz = R.sym(2); S.gravity = 9; S.life = 0.6;
  S.size0 = 0.07; S.size1 = 0.05; S.shape = Shape.Chunk; S.spin = R.sym(12); S.param = 0.3; color(S, teamC);
  p.solid.spawn(S);
  // Impact flash (small, glowing) so the hit reads at a distance.
  resetSpec(S);
  S.x = x; S.y = y; S.z = z; S.life = 0.08; S.size0 = crit ? 0.42 : 0.26; S.size1 = 0.1; S.shape = Shape.Burst; S.fade = Fade.Fade;
  S.rot = R.sym(3); colorHex(S, crit ? PALETTE.accentHot : 0xfff2d6, crit ? 3 : 1.8);
  p.glow.spawn(S);
  if (crit) {
    for (let i = 0; i < 4; i++) {
      resetSpec(S);
      const a = R.range(0, Math.PI * 2);
      S.x = x; S.y = y + 0.1; S.z = z; S.vx = Math.cos(a) * 2.5; S.vz = Math.sin(a) * 2.5; S.vy = R.range(1.5, 3);
      S.gravity = 3; S.drag = 2; S.life = 0.55; S.size1 = 0.13; S.curve = Curve.Pop; S.shape = Shape.Star; S.spin = R.sym(6);
      colorHex(S, PALETTE.accentHot, 2.2);
      p.glow.spawn(S);
    }
  }
}

/** World hit: dirt clods that bounce, grass bits, a dust puff. */
export function worldHit(p: FxPools, x: number, y: number, z: number, groundY: number): void {
  const R = p.rng;
  for (let i = 0, k = n(p, 3); i < k; i++) {
    resetSpec(S);
    S.x = x; S.y = y; S.z = z; S.vx = R.sym(2.5); S.vy = R.range(2.5, 5); S.vz = R.sym(2.5);
    S.gravity = 16; S.life = R.range(0.5, 0.8); S.size0 = R.range(0.045, 0.08); S.size1 = 0.03; S.curve = Curve.HoldShrink;
    S.shape = Shape.Chunk; S.rot = R.sym(3); S.spin = R.sym(14); S.param = 0.34; S.floorY = groundY; S.bounce = 0.35;
    color(S, i % 2 ? C.dirt : C.mulch);
    p.solid.spawn(S);
  }
  for (let i = 0, k = n(p, 3); i < k; i++) {
    resetSpec(S);
    S.x = x; S.y = y; S.z = z; S.vx = R.sym(2); S.vy = R.range(2, 4); S.vz = R.sym(2);
    S.gravity = 8; S.drag = 2.5; S.life = R.range(0.4, 0.7); S.size0 = 0.07; S.size1 = 0.04; S.curve = Curve.HoldShrink;
    S.shape = Shape.Tuft; S.rot = R.sym(3); S.spin = R.sym(10); S.param = 0.3; color(S, i % 2 ? C.grass : C.grassDark);
    p.solid.spawn(S);
  }
  resetSpec(S);
  S.x = x; S.y = y + 0.05; S.z = z; S.vy = 0.6; S.drag = 2; S.life = 0.45; S.size1 = 0.22; S.curve = Curve.Pop; S.shape = Shape.Puff;
  S.rot = R.sym(3); S.param = 0.18; color(S, C.dust);
  p.solid.spawn(S);
}

/**
 * X1: a destructible breaking (the 3D planks/cans are the world view's debris): a ground shock ring, a billowing
 * dust cloud over its footprint and a spray of splinters. `size` ~ half its width (m); `plaster` for a wall.
 */
export function destructDust(p: FxPools, x: number, y: number, z: number, groundY: number, size: number, plaster: boolean): void {
  const R = p.rng;
  const k = Math.max(0.7, Math.min(2.2, size));
  resetSpec(S);
  S.x = x; S.y = groundY + 0.05; S.z = z; S.mode = Mode.Ground; S.shape = Shape.Ring; S.param = 0.08;
  S.life = 0.45; S.size0 = 0.6 * k; S.size1 = 3.2 * k; color(S, C.dust);
  p.solid.spawn(S);
  for (let i = 0, c = n(p, 12); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2), r = R.range(0.2, 1) * k;
    S.x = x + Math.cos(a) * r; S.y = groundY + R.range(0.3, 1.2) * Math.max(1, y - groundY); S.z = z + Math.sin(a) * r;
    S.vx = Math.cos(a) * R.range(0.6, 2.2); S.vz = Math.sin(a) * R.range(0.6, 2.2); S.vy = R.range(0.4, 1.8);
    S.gravity = -0.4; S.drag = 1.6; S.life = R.range(0.9, 1.6); S.size0 = 0.25 * k; S.size1 = R.range(0.55, 0.9) * k; S.curve = Curve.HoldShrink;
    S.shape = Shape.Puff; S.rot = R.sym(3); S.spin = R.sym(0.8); S.param = 0.1;
    color(S, plaster ? (i % 3 ? C.white : C.dust) : i % 3 ? C.dust : C.dustDark);
    p.solid.spawn(S);
  }
  for (let i = 0, c = n(p, 14); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2), sp = R.range(3, 8);
    S.x = x; S.y = y; S.z = z; S.vx = Math.cos(a) * sp; S.vz = Math.sin(a) * sp; S.vy = R.range(3, 8);
    S.gravity = 18; S.life = R.range(0.7, 1.1); S.size0 = R.range(0.07, 0.14); S.size1 = 0.05; S.curve = Curve.HoldShrink;
    S.shape = Shape.Chunk; S.rot = R.sym(3); S.spin = R.sym(18); S.param = 0.3; S.floorY = groundY; S.bounce = 0.35;
    color(S, i % 2 ? C.dustDark : C.dust);
    p.solid.spawn(S);
  }
}

/** Landing: a flat dust ring + radial puffs, scaled by impact speed. */
export function landDust(p: FxPools, x: number, y: number, z: number, impact: number): void {
  const k = Math.min(1.6, Math.max(0.35, impact / 12));
  const R = p.rng;
  resetSpec(S);
  S.x = x; S.y = y + 0.04; S.z = z; S.mode = Mode.Ground; S.shape = Shape.Ring; S.param = 0.1;
  S.life = 0.35; S.size0 = 0.3 * k; S.size1 = 1.1 * k; color(S, C.dust);
  p.solid.spawn(S);
  const count = n(p, Math.round(4 + 4 * k));
  for (let i = 0; i < count; i++) {
    resetSpec(S);
    const a = (i / count) * Math.PI * 2 + R.sym(0.3);
    const sp = R.range(2.4, 3.6) * k;
    S.x = x + Math.cos(a) * 0.25; S.y = y + 0.1; S.z = z + Math.sin(a) * 0.25;
    S.vx = Math.cos(a) * sp; S.vz = Math.sin(a) * sp; S.vy = R.range(0.3, 1.2);
    S.drag = 4.5; S.life = R.range(0.3, 0.5); S.size1 = R.range(0.11, 0.17) * Math.sqrt(k); S.curve = Curve.Pop;
    S.shape = Shape.Puff; S.rot = R.sym(3); S.param = 0.2; color(S, i % 3 ? C.dust : C.dustDark);
    p.solid.spawn(S);
  }
}

/** Jump: small puffs at the feet; a double jump gets an airy ring under the paws. */
export function jumpDust(p: FxPools, x: number, y: number, z: number, double: boolean): void {
  const R = p.rng;
  if (double) {
    resetSpec(S);
    S.x = x; S.y = y; S.z = z; S.mode = Mode.Ground; S.shape = Shape.Ring; S.param = 0.12; S.life = 0.3;
    S.size0 = 0.25; S.size1 = 0.75; S.vy = -1; color(S, C.white);
    p.solid.spawn(S);
  }
  for (let i = 0, k = n(p, double ? 4 : 3); i < k; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2);
    S.x = x + Math.cos(a) * 0.2; S.y = y + 0.05; S.z = z + Math.sin(a) * 0.2;
    S.vx = Math.cos(a) * 1.4; S.vz = Math.sin(a) * 1.4; S.vy = double ? -0.6 : 0.4;
    S.drag = 4; S.life = 0.35; S.size1 = 0.15; S.curve = Curve.Pop; S.shape = Shape.Puff; S.rot = R.sym(3); S.param = 0.2;
    color(S, double ? C.white : C.dust);
    p.solid.spawn(S);
  }
}

/** Zoomies trail: one puff kicked up behind a sprinting character. */
export function sprintPuff(p: FxPools, x: number, y: number, z: number, vx: number, vz: number): void {
  const R = p.rng;
  resetSpec(S);
  S.x = x + R.sym(0.15); S.y = y + 0.08; S.z = z + R.sym(0.15);
  S.vx = -vx * 0.12 + R.sym(0.4); S.vz = -vz * 0.12 + R.sym(0.4); S.vy = R.range(0.4, 1.1);
  S.drag = 3; S.life = R.range(0.3, 0.45); S.size1 = R.range(0.12, 0.18); S.curve = Curve.Pop; S.shape = Shape.Puff;
  S.rot = R.sym(3); S.param = 0.2; color(S, C.dust);
  p.solid.spawn(S);
}

/** Tennis-ball projectile trail: fuzzy yellow-green puffs. */
export function ballTrail(p: FxPools, x: number, y: number, z: number): void {
  resetSpec(S);
  S.x = x; S.y = y; S.z = z; S.life = 0.3; S.size0 = 0.14; S.size1 = 0.02; S.shape = Shape.Puff; S.fade = Fade.Fade;
  S.rot = p.rng.sym(3); colorHex(S, PALETTE.tennisBall, 1.6);
  p.glow.spawn(S);
}

/** Explosion: flash, fireball puffs (inked), smoke, bouncing debris, ground shockwave ring, sparks. */
export function explosion(p: FxPools, x: number, y: number, z: number, r: number, groundY: number): void {
  const R = p.rng;
  const k = Math.max(0.6, Math.min(2.2, r / 3));
  // X3: a round, hot core instead of the 3 m 8-lobed flower (the fire tongues in presets-weapons carry the shape)
  resetSpec(S);
  S.x = x; S.y = y + 0.3; S.z = z; S.life = 0.13; S.size0 = 1.5 * k; S.size1 = 0.8 * k; S.shape = Shape.Puff; S.fade = Fade.Fade;
  S.rot = R.sym(3); colorHex(S, 0xffe7a0, 2.4);
  p.glow.spawn(S);
  resetSpec(S);
  S.x = x; S.y = groundY + 0.06; S.z = z; S.mode = Mode.Ground; S.shape = Shape.Ring; S.param = 0.08;
  S.life = 0.4; S.size0 = 0.6 * k; S.size1 = 3.4 * k; color(S, C.smokeLight);
  p.solid.spawn(S);
  for (let i = 0, c = n(p, 10); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2), e = R.range(0.1, 1);
    const sp = R.range(2.5, 6) * k;
    S.x = x; S.y = y + 0.3; S.z = z;
    S.vx = Math.cos(a) * sp * (1 - e * 0.5); S.vz = Math.sin(a) * sp * (1 - e * 0.5); S.vy = e * sp;
    S.drag = 3.5; S.life = R.range(0.35, 0.6); S.size1 = R.range(0.4, 0.7) * k; S.curve = Curve.Pop;
    S.shape = Shape.Puff; S.rot = R.sym(3); S.param = 0.12; color(S, i % 3 === 0 ? C.fireHot : C.fire, 0.8);
    p.solid.spawn(S);
  }
  for (let i = 0, c = n(p, 7); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2);
    S.x = x + Math.cos(a) * 0.5 * k; S.y = y + 0.5; S.z = z + Math.sin(a) * 0.5 * k;
    S.vx = Math.cos(a) * R.range(0.5, 1.5); S.vz = Math.sin(a) * R.range(0.5, 1.5); S.vy = R.range(1.2, 2.6);
    S.gravity = -0.6; S.drag = 1.2; S.life = R.range(0.9, 1.4); S.size0 = 0.2 * k; S.size1 = R.range(0.5, 0.8) * k; S.curve = Curve.HoldShrink;
    S.shape = Shape.Puff; S.rot = R.sym(3); S.spin = R.sym(1); S.param = 0.1; color(S, i % 2 ? C.smoke : C.smokeLight);
    p.solid.spawn(S);
  }
  for (let i = 0, c = n(p, 8); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2);
    S.x = x; S.y = y + 0.3; S.z = z; S.vx = Math.cos(a) * R.range(3, 7); S.vz = Math.sin(a) * R.range(3, 7); S.vy = R.range(4, 9);
    S.gravity = 18; S.life = R.range(0.8, 1.2); S.size0 = R.range(0.08, 0.16); S.size1 = 0.06; S.curve = Curve.HoldShrink;
    S.shape = Shape.Chunk; S.rot = R.sym(3); S.spin = R.sym(16); S.param = 0.3; S.floorY = groundY; S.bounce = 0.4;
    color(S, i % 3 === 0 ? C.grassDark : i % 3 === 1 ? C.dirt : C.mulch);
    p.solid.spawn(S);
  }
  for (let i = 0, c = n(p, 10); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2);
    const sp = R.range(8, 15);
    S.x = x; S.y = y + 0.3; S.z = z; S.vx = Math.cos(a) * sp; S.vz = Math.sin(a) * sp; S.vy = R.range(2, 9);
    S.gravity = 14; S.drag = 2; S.life = R.range(0.25, 0.45); S.size0 = 0.05; S.size1 = 0.02;
    S.mode = Mode.Stretched; S.stretch = 0.03; S.shape = Shape.Streak; S.fade = Fade.Fade; colorHex(S, PALETTE.glowOrange, 3);
    p.glow.spawn(S);
  }
}

/** Death: a cartoon "poof" cloud ring, fur tufts, and dizzy stars. */
export function deathPoof(p: FxPools, x: number, y: number, z: number, cat: boolean): void {
  const R = p.rng;
  const count = n(p, 10);
  for (let i = 0; i < count; i++) {
    resetSpec(S);
    const a = (i / count) * Math.PI * 2;
    S.x = x + Math.cos(a) * 0.3; S.y = y + 0.6 + R.sym(0.3); S.z = z + Math.sin(a) * 0.3;
    S.vx = Math.cos(a) * R.range(1.5, 2.6); S.vz = Math.sin(a) * R.range(1.5, 2.6); S.vy = R.range(0.2, 1.4);
    S.drag = 3.2; S.life = R.range(0.55, 0.8); S.size1 = R.range(0.35, 0.5); S.curve = Curve.Pop;
    S.shape = Shape.Puff; S.rot = R.sym(3); S.spin = R.sym(1.5); S.param = 0.12; color(S, i % 3 ? C.white : C.smokeLight);
    p.solid.spawn(S);
  }
  const fur = cat ? C.catFur : C.corgiFur;
  for (let i = 0, c = n(p, 6); i < c; i++) {
    resetSpec(S);
    S.x = x; S.y = y + 0.7; S.z = z; S.vx = R.sym(3); S.vy = R.range(2, 5); S.vz = R.sym(3);
    S.gravity = 6; S.drag = 2; S.life = R.range(0.7, 1.1); S.size0 = 0.1; S.size1 = 0.06; S.curve = Curve.HoldShrink;
    S.shape = Shape.Tuft; S.rot = R.sym(3); S.spin = R.sym(8); S.param = 0.3; color(S, fur);
    p.solid.spawn(S);
  }
  for (let i = 0; i < 3; i++) {
    resetSpec(S);
    const a = (i / 3) * Math.PI * 2;
    S.x = x + Math.cos(a) * 0.35; S.y = y + 1.3; S.z = z + Math.sin(a) * 0.35; S.vy = 0.5;
    S.vx = -Math.sin(a) * 1.2; S.vz = Math.cos(a) * 1.2; S.life = 0.9; S.size1 = 0.14; S.curve = Curve.Pop; S.shape = Shape.Star;
    S.spin = 5; colorHex(S, PALETTE.accentHot, 2);
    p.glow.spawn(S);
  }
}

/** Respawn: team-colored ground ring + rising sparkles. */
export function respawnSparkle(p: FxPools, x: number, y: number, z: number, team: number): void {
  const R = p.rng;
  const hex = team === 1 ? PALETTE.teamCats : PALETTE.teamCorgis;
  resetSpec(S);
  S.x = x; S.y = y + 0.05; S.z = z; S.mode = Mode.Ground; S.shape = Shape.Ring; S.param = 0.08; S.life = 0.6;
  S.size0 = 1.2; S.size1 = 0.2; S.fade = Fade.Fade; colorHex(S, hex, 2.4);
  p.glow.spawn(S);
  for (let i = 0, c = n(p, 10); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2), rr = R.range(0.2, 0.6);
    S.x = x + Math.cos(a) * rr; S.y = y + R.range(0, 0.6); S.z = z + Math.sin(a) * rr; S.vy = R.range(1.5, 3); S.drag = 1.5;
    S.life = R.range(0.5, 0.9); S.size1 = R.range(0.08, 0.14); S.curve = Curve.Pop; S.shape = Shape.Star; S.spin = R.sym(4);
    colorHex(S, i % 3 === 0 ? PALETTE.teamCorgisTrim : hex, 2.4);
    p.glow.spawn(S);
  }
}

/** Pickup: gold sparkle pop. */
export function pickupSparkle(p: FxPools, x: number, y: number, z: number): void {
  const R = p.rng;
  for (let i = 0, c = n(p, 8); i < c; i++) {
    resetSpec(S);
    const a = (i / 8) * Math.PI * 2;
    S.x = x; S.y = y + 0.6; S.z = z; S.vx = Math.cos(a) * 2; S.vz = Math.sin(a) * 2; S.vy = R.range(1, 2.5); S.drag = 3;
    S.life = 0.5; S.size1 = 0.12; S.curve = Curve.Pop; S.shape = Shape.Star; S.spin = R.sym(5); colorHex(S, PALETTE.accentHot, 2.4);
    p.glow.spawn(S);
  }
}

/** Ability burst: an expanding ground ring in team color (bark blast gets a big shockwave). */
export function abilityRing(p: FxPools, x: number, y: number, z: number, team: number, big: boolean): void {
  const hex = team === 1 ? PALETTE.teamCats : PALETTE.teamCorgis;
  resetSpec(S);
  S.x = x; S.y = y + 0.08; S.z = z; S.mode = Mode.Ground; S.shape = Shape.Ring; S.param = 0.07; S.life = big ? 0.45 : 0.35;
  S.size0 = 0.4; S.size1 = big ? 5 : 2; S.fade = Fade.Fade; colorHex(S, hex, 2.2);
  p.glow.spawn(S);
  resetSpec(S);
  S.x = x; S.y = y + 0.8; S.z = z; S.shape = Shape.Ring; S.param = 0.1; S.life = 0.3; S.size0 = 0.3; S.size1 = big ? 2.6 : 1.2;
  color(S, C.white);
  p.solid.spawn(S);
}

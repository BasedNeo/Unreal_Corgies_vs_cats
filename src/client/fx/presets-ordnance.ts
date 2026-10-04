// W9 X4 (arms-2): particle recipes for the throwables, on the L5/X3 pools (FxPools) and specs — no new shapes, no
// allocations (one module spec, numbers in). They ride ON TOP of the generic `explode` FX (fireball, smoke column,
// embers, dirt, scorch, light pulse, word) that fx/index.ts already draws for every blast; these add the faction:
//   squeaker   a squeak-pop: rubber shreds in hazard ochre + gunmetal + team tape, a white squeal ring, springy bits;
//              lively dust on each bounce; a warm speck trail so the arc reads at dusk; its cap light blinks (view).
//   hairball   a wet splat: hair clumps drifting down, olive-brown goo splats, a stain on the ground, a sickly stink
//              cloud; a squelch spray on the (few) bounces; drips and wisps in flight; a spitting wick.
// Colours: palette hex (sRGB) → linear like presets-weapons (the particle materials write linear HDR colour).
import { PALETTE } from '../style/style-tokens.js';
import { Curve, Fade, Mode, Shape, makeSpec, resetSpec, type ParticleSpec } from './particle-pool';
import type { FxPools } from './presets';

const S: ParticleSpec = makeSpec();
const lin = (c: number) => Math.pow(c / 255, 2.2);
function rgb(hex: number, k = 1): [number, number, number] {
  return [lin((hex >> 16) & 255) * k, lin((hex >> 8) & 255) * k, lin(hex & 255) * k];
}
function mixRgb(a: number, b: number, t: number, k = 1): [number, number, number] {
  const A = rgb(a), B = rgb(b);
  return [(A[0] + (B[0] - A[0]) * t) * k, (A[1] + (B[1] - A[1]) * t) * k, (A[2] + (B[2] - A[2]) * t) * k];
}
const C = {
  ochre: rgb(PALETTE.hazardOchre), ochreWorn: rgb(PALETTE.ochreWorn), gunmetal: rgb(PALETTE.gunmetal, 1.2), steel: rgb(PALETTE.steel),
  tape0: rgb(PALETTE.teamCorgis), tape1: rgb(PALETTE.teamCats),
  dust: mixRgb(PALETTE.hull, PALETTE.dirt, 0.4, 0.9),
  hair: rgb(PALETTE.catGrey), hairDark: rgb(PALETTE.charcoal, 1.3), hairGinger: mixRgb(PALETTE.catGinger, PALETTE.mud, 0.45),
  goo: mixRgb(PALETTE.olive, PALETTE.mud, 0.45, 1.1), gooWet: mixRgb(PALETTE.olive, PALETTE.grassDry, 0.35, 1.2),
  stink: mixRgb(PALETTE.olive, PALETTE.grassDry, 0.5, 0.85),
};
function color(s: ParticleSpec, c: readonly number[], k = 1): void { s.r = c[0] * k; s.g = c[1] * k; s.b = c[2] * k; }
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) LIN[i] = lin(i);
function colorHex(s: ParticleSpec, hex: number, k: number): void { s.r = LIN[(hex >> 16) & 255] * k; s.g = LIN[(hex >> 8) & 255] * k; s.b = LIN[hex & 255] * k; }
function n(p: FxPools, base: number): number { return base <= 0 ? 0 : Math.max(1, Math.round(base * p.density)); }

/** Throwable kind for the recipes: 0 = squeaker grenade (corgis), 1 = hairball bomb (cats). */
export type OrdKind = 0 | 1;

/** In flight: a warm speck (squeaker) or a drip and a wisp (hairball). Call every ~0.05 s while it moves. */
export function ordTrail(p: FxPools, kind: OrdKind, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
  const R = p.rng;
  resetSpec(S);
  if (kind === 0) {
    // a warm streak of specks: the arc must read at 20 m at dusk (the body is a tennis ball at pet scale)
    S.x = x; S.y = y; S.z = z; S.life = 0.34; S.size0 = 0.12; S.size1 = 0.015; S.shape = Shape.Puff; S.fade = Fade.Fade;
    S.rot = R.sym(3); colorHex(S, PALETTE.accentHot, 2.2);
    p.glow.spawn(S);
    return;
  }
  // the lit wick: an orange speck trailing it (the fur and goo are dark on purpose)
  S.x = x; S.y = y + 0.05; S.z = z; S.life = 0.3; S.size0 = 0.1; S.size1 = 0.015; S.shape = Shape.Puff; S.fade = Fade.Fade;
  S.rot = R.sym(3); colorHex(S, PALETTE.glowOrange, 2.2);
  p.glow.spawn(S);
  resetSpec(S);
  // a drip falls off the wet hairball; now and then a wisp of fur trails it
  S.x = x + R.sym(0.05); S.y = y - 0.05; S.z = z + R.sym(0.05);
  S.vx = vx * 0.25; S.vy = Math.min(0, vy * 0.2) - 0.5; S.vz = vz * 0.25; S.gravity = 12;
  S.life = R.range(0.35, 0.55); S.size0 = 0.035; S.size1 = 0.02; S.shape = Shape.Drop; color(S, C.goo);
  p.solid.spawn(S);
  if (R.next() < 0.45) {
    resetSpec(S);
    S.x = x; S.y = y + 0.04; S.z = z; S.vx = -vx * 0.08 + R.sym(0.4); S.vy = R.range(0.1, 0.5); S.vz = -vz * 0.08 + R.sym(0.4);
    S.drag = 2.5; S.gravity = 1.5; S.life = R.range(0.5, 0.8); S.size0 = 0.06; S.size1 = 0.04; S.shape = Shape.Tuft;
    S.rot = R.sym(3); S.spin = R.sym(5); color(S, R.next() < 0.5 ? C.hair : C.hairDark);
    p.solid.spawn(S);
  }
}

/** A bounce (k = impact speed 0..1): a lively dust kick (squeaker) or a wet squelch spray + a smear (hairball). */
export function ordBounce(p: FxPools, kind: OrdKind, x: number, y: number, z: number, k: number, groundY: number): void {
  const R = p.rng;
  const s = 0.5 + Math.min(1, k) * 0.7;
  if (kind === 0) {
    resetSpec(S);
    S.x = x; S.y = groundY + 0.04; S.z = z; S.mode = Mode.Ground; S.shape = Shape.Ring; S.param = 0.12;
    S.life = 0.22; S.size0 = 0.12 * s; S.size1 = 0.55 * s; S.fade = Fade.Soft; color(S, C.dust);
    p.solid.spawn(S);
    for (let i = 0, c = n(p, 4 * s); i < c; i++) {
      resetSpec(S);
      const a = R.range(0, Math.PI * 2), sp = R.range(0.6, 1.6) * s;
      S.x = x; S.y = y + 0.05; S.z = z; S.vx = Math.cos(a) * sp; S.vz = Math.sin(a) * sp; S.vy = R.range(0.4, 1.2);
      S.drag = 3; S.gravity = 1; S.life = R.range(0.35, 0.6); S.size0 = 0.06 * s; S.size1 = 0.16 * s; S.shape = Shape.Puff;
      S.rot = R.sym(3); S.fade = Fade.Soft; S.alpha = 0.8; color(S, C.dust);
      p.solid.spawn(S);
    }
    return;
  }
  for (let i = 0, c = n(p, 5 * s); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2), sp = R.range(1, 2.6) * s;
    S.x = x; S.y = y + 0.04; S.z = z; S.vx = Math.cos(a) * sp; S.vz = Math.sin(a) * sp; S.vy = R.range(0.8, 2.2) * s;
    S.gravity = 14; S.life = R.range(0.3, 0.5); S.size0 = R.range(0.03, 0.06); S.size1 = 0.02; S.shape = Shape.Splat;
    S.rot = R.sym(3); S.floorY = groundY; S.bounce = 0.05; color(S, i % 2 ? C.goo : C.gooWet);
    p.solid.spawn(S);
  }
  resetSpec(S);
  S.x = x; S.y = groundY + 0.03; S.z = z; S.mode = Mode.Ground; S.shape = Shape.Splat; S.rot = R.sym(3);
  S.life = 1.6; S.size0 = 0.18 * s; S.size1 = 0.22 * s; S.curve = Curve.HoldShrink; color(S, C.goo);
  p.solid.spawn(S);
}

/** The fuse telegraph's sparkle at each blink (k = urgency 0..1): the cap light's glint or the wick spitting. */
export function ordFuse(p: FxPools, kind: OrdKind, x: number, y: number, z: number, k: number): void {
  const R = p.rng;
  if (kind === 0) {
    resetSpec(S);
    S.x = x; S.y = y; S.z = z; S.life = 0.1; S.size0 = 0.1 + 0.08 * k; S.size1 = 0.02; S.shape = Shape.Glow; S.fade = Fade.Fade;
    S.rot = R.sym(3); colorHex(S, PALETTE.laserRed, 2.4 + 1.5 * k);
    p.glow.spawn(S);
    return;
  }
  for (let i = 0, c = 2 + Math.round(k * 2); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2), sp = R.range(1, 2.5);
    S.x = x; S.y = y; S.z = z; S.vx = Math.cos(a) * sp; S.vz = Math.sin(a) * sp; S.vy = R.range(1, 3);
    S.gravity = 9; S.drag = 1; S.life = R.range(0.12, 0.25); S.size0 = 0.025; S.size1 = 0.008;
    S.mode = Mode.Stretched; S.stretch = 0.03; S.shape = Shape.Streak; S.fade = Fade.Fade; colorHex(S, PALETTE.glowOrange, 3);
    p.glow.spawn(S);
  }
}

/**
 * The faction layer of the blast (the generic explosion is drawn by fx/index.ts from the same `explode` event).
 * `team` picks the squeaker's tape colour in the shreds.
 */
export function ordBlast(p: FxPools, kind: OrdKind, team: number, x: number, y: number, z: number, r: number, groundY: number): void {
  const R = p.rng;
  const k = Math.max(0.6, Math.min(1.6, r / 3.5));
  if (kind === 0) {
    // the squeak-pop: a white squeal ring snapping out first
    resetSpec(S);
    S.x = x; S.y = y + 0.35; S.z = z; S.shape = Shape.Ring; S.param = 0.1; S.life = 0.16; S.size0 = 0.3; S.size1 = 1.9 * k;
    S.fade = Fade.Fade; colorHex(S, PALETTE.catWhite, 2.2);
    p.glow.spawn(S);
    // rubber shreds: ochre body, gunmetal cap, a strip of team tape; they spin, bounce and settle
    for (let i = 0, c = n(p, 14); i < c; i++) {
      resetSpec(S);
      const a = R.range(0, Math.PI * 2), sp = R.range(3.5, 8.5) * k;
      S.x = x; S.y = y + 0.3; S.z = z; S.vx = Math.cos(a) * sp; S.vz = Math.sin(a) * sp; S.vy = R.range(3, 8.5);
      S.gravity = 15; S.drag = 0.6; S.life = R.range(1.1, 1.8); S.size0 = R.range(0.07, 0.13); S.size1 = 0.05; S.curve = Curve.HoldShrink;
      S.shape = i % 5 === 4 ? Shape.Chunk : Shape.Shard; S.rot = R.sym(3); S.spin = R.sym(18);
      S.floorY = groundY; S.bounce = 0.55;
      color(S, i % 7 === 3 ? (team === 1 ? C.tape1 : C.tape0) : i % 3 === 1 ? C.gunmetal : i % 2 ? C.ochreWorn : C.ochre);
      p.solid.spawn(S);
    }
    // the squeaker reed and the pin ring: two bright steel glints tumbling high
    for (let i = 0; i < 2; i++) {
      resetSpec(S);
      const a = R.range(0, Math.PI * 2);
      S.x = x; S.y = y + 0.4; S.z = z; S.vx = Math.cos(a) * 3; S.vz = Math.sin(a) * 3; S.vy = R.range(8, 11);
      S.gravity = 16; S.life = 1.3; S.size0 = 0.05; S.size1 = 0.04; S.shape = Shape.Chunk; S.spin = R.sym(20);
      S.floorY = groundY; S.bounce = 0.4; color(S, C.steel, 1.2);
      p.solid.spawn(S);
    }
    return;
  }
  // the wet splat: goo flung out fast...
  for (let i = 0, c = n(p, 12); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2), sp = R.range(4, 9) * k;
    S.x = x; S.y = y + 0.3; S.z = z; S.vx = Math.cos(a) * sp; S.vz = Math.sin(a) * sp; S.vy = R.range(2, 6);
    S.gravity = 18; S.drag = 0.8; S.life = R.range(0.45, 0.75); S.size0 = R.range(0.1, 0.2) * k; S.size1 = 0.06; S.curve = Curve.HoldShrink;
    S.shape = Shape.Splat; S.rot = R.sym(3); S.floorY = groundY; S.bounce = 0.05; color(S, i % 3 ? C.goo : C.gooWet);
    p.solid.spawn(S);
  }
  // ...hair clumps that hang in the air and drift down
  for (let i = 0, c = n(p, 14); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2), sp = R.range(1.5, 5) * k;
    S.x = x; S.y = y + 0.4; S.z = z; S.vx = Math.cos(a) * sp; S.vz = Math.sin(a) * sp; S.vy = R.range(2.5, 6);
    S.gravity = 4; S.drag = 2.2; S.life = R.range(1.4, 2.4); S.size0 = R.range(0.1, 0.18); S.size1 = 0.07; S.curve = Curve.HoldShrink;
    S.shape = Shape.Tuft; S.rot = R.sym(3); S.spin = R.sym(4); S.floorY = groundY; S.bounce = 0;
    color(S, i % 4 === 0 ? C.hairGinger : i % 2 ? C.hair : C.hairDark);
    p.solid.spawn(S);
  }
  // a stain where it went off, and a sickly cloud that lingers
  resetSpec(S);
  S.x = x; S.y = groundY + 0.035; S.z = z; S.mode = Mode.Ground; S.shape = Shape.Splat; S.rot = R.sym(3);
  S.life = 4; S.size0 = 0.5 * k; S.size1 = 1.1 * k; S.curve = Curve.HoldShrink; color(S, C.goo, 0.9);
  p.solid.spawn(S);
  for (let i = 0, c = n(p, 6); i < c; i++) {
    resetSpec(S);
    const a = R.range(0, Math.PI * 2), rr = R.range(0.3, 1.4) * k;
    S.x = x + Math.cos(a) * rr; S.y = y + 0.3; S.z = z + Math.sin(a) * rr;
    S.vx = Math.cos(a) * 0.4; S.vy = R.range(0.3, 0.9); S.vz = Math.sin(a) * 0.4;
    S.drag = 0.8; S.gravity = -0.3; S.life = R.range(1.6, 2.6); S.size0 = 0.3 * k; S.size1 = R.range(0.8, 1.2) * k;
    S.shape = Shape.Puff; S.rot = R.sym(3); S.spin = R.sym(0.5); S.fade = Fade.Soft; S.alpha = R.range(0.55, 0.75);
    color(S, C.stink);
    p.solid.spawn(S);
  }
}

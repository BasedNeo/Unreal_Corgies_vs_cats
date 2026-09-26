// OWNER: interaction lane (S1). Procedural geometry for the interaction layer, built once and shared:
//   Ordnance Kiosk   a chunky toy vending cabinet in team colors: a glowing screen of six class tiles with
//                    inked class symbols, a row of fat kit buttons, a kit-drop chute, an ammo-crate header
//                    with crossed toy bones and a giant tennis ball, and a painted "stand here" ring.
//   Upgrade Core     a glowing crystal inside a two-ring gyroscope cage over a small pedestal with 12
//                    countdown pips.
//   Golden Kibble    a fat three-lobed kibble nugget (gold toon, a little emissive) + 4-point sparkles.
//   Squeaker         the objective toy: a corgi-blue rubber squeaky bone with a gold squeak nub.
// Kiosk space: +Y up, the screen faces -Z (like the Kart-O-Matic), ground at y = 0.
// Merged vertex-colored parts come from the vehicle lane's PartBuilder (one toon draw + one crease-ink draw).
import * as THREE from 'three/webgpu';
import type { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { PALETTE } from '../style/style-tokens.js';
import { Team, CLASS_IDS, type TeamId, type ClassId } from '../../shared/types';
import { PartBuilder, at, rbox, box, cyl, cone, torus, ball } from '../vehicles/parts';
import { KART_PALETTES } from '../vehicles/kart-model';

export interface Built { geometry: THREE.BufferGeometry; lines: LineSegmentsGeometry | null }

// ------------------------------------------------------------------------------------------------ kiosk
/** Screen placement in kiosk space: center (x, y, z), size, back-tilt (rad). */
export const KIOSK_SCREEN = { x: 0, y: 1.66, z: -0.566, w: 1.02, h: 0.66, tilt: 0.12 };
/** Six class tiles on the screen (3 × 2), in screen space (x right, y up, from the screen center). */
export const KIOSK_TILES: { cls: ClassId; x: number; y: number }[] = CLASS_IDS.map((cls, i) => ({
  cls, x: (i % 3 - 1) * 0.31, y: i < 3 ? 0.14 : -0.14,
}));
export const TILE_W = 0.27, TILE_H = 0.23;
/** Giant tennis ball on the roof (kiosk space, center) — spun by the view. */
export const KIOSK_BALL = { x: 0, y: 3.02, z: 0.02, r: 0.3 };

export interface KioskAssets {
  body: Built;
  /** Inked class symbols, placed on the screen (screen space, one merged mesh). */
  icons: THREE.BufferGeometry;
  /** Unit tile quad (TILE_W × TILE_H), facing -Z. */
  tile: THREE.BufferGeometry;
  /** Screen backing quad, facing -Z. */
  screen: THREE.BufferGeometry;
  ball: Built;
  pad: THREE.BufferGeometry;
  triangles: number;
}

const kioskCache = new Map<number, KioskAssets>();

/** One class symbol in tile space (~0.2 × 0.17), pushed into the builder with a transform. */
function classSymbol(b: PartBuilder, cls: ClassId, tx: number, ty: number, ink: number): void {
  const z = -0.012;
  const put = (g: THREE.BufferGeometry, x: number, y: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => b.add(g, at(tx + x, ty + y, z, rx, ry, rz, sx, sy, sz), ink);
  switch (cls) {
    case 'assault': // crosshair
      put(torus(0.062, 0.013, 4, 16), 0, 0);
      for (const [x, y, r] of [[0.085, 0, 0], [-0.085, 0, 0], [0, 0.085, Math.PI / 2], [0, -0.085, Math.PI / 2]] as const) put(box(0.05, 0.018, 0.012), x, y, 0, 0, r);
      put(ball(0.016, 6, 4), 0, 0);
      break;
    case 'infiltrator': // sneaky eye
      put(ball(0.08, 12, 6), 0, 0, 0, 0, 0, 1.25, 0.5, 0.2);
      put(ball(0.03, 8, 6), 0, 0, 0, 0, 0, 1, 1, 0.5);
      put(box(0.2, 0.018, 0.012), 0, 0.055, 0, 0, -0.12);
      break;
    case 'overwatch': // scope
      put(cyl(0.03, 0.03, 0.16, 10), -0.02, 0, 0, 0, Math.PI / 2, 1, 1, 0.4);
      put(torus(0.042, 0.012, 4, 14), 0.075, 0);
      put(box(0.04, 0.05, 0.012), -0.03, -0.045);
      break;
    case 'breacher': // bomb
      put(ball(0.062, 12, 8), -0.01, -0.02, 0, 0, 0, 1, 1, 0.35);
      put(cyl(0.012, 0.012, 0.06, 6), 0.045, 0.05, 0, 0, -0.7);
      put(cone(0.022, 0.04, 5), 0.075, 0.085, 0, 0, -0.7, 1, 1, 0.4);
      break;
    case 'warden': // shield
      put(rbox(0.13, 0.09, 0.02, 0.02, 1), 0, 0.03);
      put(cone(0.066, 0.08, 4), 0, -0.052, 0, Math.PI / 4, Math.PI, 1, 1, 0.3);
      break;
    case 'skyraider': // wings
      for (const s of [-1, 1]) put(ball(0.06, 10, 6), s * 0.055, 0.01, 0, 0, s * 0.35, 1.3, 0.45, 0.2);
      put(ball(0.03, 8, 6), 0, 0, 0, 0, 0, 1, 1, 0.4);
      break;
  }
}

export function kioskAssets(team: TeamId): KioskAssets {
  const key = team === Team.Cats ? 1 : 0;
  const hit = kioskCache.get(key);
  if (hit) return hit;
  const P = KART_PALETTES[key];
  const S = KIOSK_SCREEN;
  const b = new PartBuilder();
  // Cabinet (matches the sim collider 1.6 × 2.5 × 1.1) on stubby feet, cream front, trim stripes.
  b.add(rbox(1.56, 2.28, 1.06, 0.14), at(0, 1.2, 0), P.body);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cyl(0.08, 0.1, 0.1, 6), at(sx * 0.6, 0.05, sz * 0.36), P.dark);
  b.add(rbox(1.34, 1.96, 0.06, 0.04, 1), at(0, 1.18, -0.51), PALETTE.hullLight);
  for (const sx of [-1, 1]) {
    b.add(box(0.035, 1.9, 0.62), at(sx * 0.785, 1.15, 0), P.trim);
    // ammo-belt decal on the sides: a row of chunky shells
    for (let i = 0; i < 5; i++) b.add(cyl(0.05, 0.05, 0.16, 8), at(sx * 0.8, 0.62 + i * 0.12, 0.18, 0, 0, Math.PI / 2), PALETTE.accentHot, true);
  }
  // Screen bezel, tilted back a touch.
  b.add(rbox(S.w + 0.14, S.h + 0.14, 0.08, 0.04, 1), at(0, S.y, S.z + 0.04, -S.tilt), P.dark, true);
  // Six fat kit buttons (one per class) under the screen.
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 0.19;
    b.add(cyl(0.065, 0.075, 0.08, 12), at(x, 1.1, -0.57, Math.PI / 2), i % 2 ? P.trim : PALETTE.accentHot, true);
    b.add(torus(0.075, 0.015, 4, 12), at(x, 1.1, -0.545), P.dark);
  }
  // Kit-drop chute with a swinging flap.
  b.add(rbox(0.9, 0.38, 0.1, 0.04, 1), at(0, 0.56, -0.54), P.dark, true);
  b.add(box(0.78, 0.26, 0.02), at(0, 0.58, -0.6, 0.12), P.metal);
  // Header: a wooden ammo crate (the "ordnance" read, unlike the Kart-O-Matic's steering wheel) with
  // team-colored bands, corner brackets and rope handles.
  b.add(rbox(1.72, 0.4, 1.18, 0.08), at(0, 2.5, 0), PALETTE.fenceWood, true);
  for (const x of [-0.5, 0.5]) b.add(box(0.12, 0.42, 1.2), at(x, 2.5, 0), P.body);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(box(0.14, 0.44, 0.14), at(sx * 0.8, 2.5, sz * 0.54), P.dark);
  b.add(box(0.5, 0.2, 0.02), at(0, 2.5, -0.6), P.trim, true); // stencil plate
  for (const sx of [-1, 1]) b.add(torus(0.1, 0.025, 4, 10, Math.PI), at(sx * 0.87, 2.5, 0, 0, Math.PI / 2), P.dark);
  // Crossed toy bones behind the ball (ordnance!), on a short post.
  b.add(cyl(0.06, 0.07, 0.26, 8), at(0, 2.78, 0.02), P.dark);
  for (const s of [-1, 1]) {
    const r = s * 0.7;
    b.add(cyl(0.055, 0.055, 0.95, 8), at(0, 3.0, 0.24, 0, 0, r), PALETTE.catWhite);
    for (const e of [-1, 1]) for (const k of [-1, 1]) {
      const ex = Math.sin(-r) * e * 0.47, ey = Math.cos(r) * e * 0.47;
      b.add(ball(0.085, 10, 7), at(ex + Math.cos(r) * k * 0.055, 3.0 + ey + Math.sin(r) * k * 0.055, 0.24), PALETTE.catWhite);
    }
  }
  const body = b.build();

  const ib = new PartBuilder();
  for (const t of KIOSK_TILES) classSymbol(ib, t.cls, t.x, t.y, PALETTE.ink);
  const icons = ib.build().geometry;

  const tile = new THREE.PlaneGeometry(TILE_W, TILE_H);
  tile.rotateY(Math.PI);
  const screen = new THREE.PlaneGeometry(S.w, S.h);
  screen.rotateY(Math.PI);

  const bb = new PartBuilder();
  bb.add(ball(KIOSK_BALL.r, 16, 12), at(0, 0, 0), PALETTE.tennisBall);
  bb.add(torus(KIOSK_BALL.r * 0.98, 0.022, 4, 24), at(0, 0, 0, 0.5, 0, 0.3), PALETTE.hullLight);
  const ballB = bb.build();

  const pb = new PartBuilder();
  pb.add(torus(0.95, 0.06, 3, 32), at(0, 0.03, 0, Math.PI / 2), P.trim);
  for (let i = 0; i < 3; i++) pb.add(cone(0.14, 0.24, 3), at(0, 0.03, 0.45 - i * 0.3, Math.PI / 2, 0, 0, 1, 1, 0.25), P.trim);
  const pad = pb.build().geometry;

  const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  const a: KioskAssets = {
    body, icons, tile, screen, ball: ballB, pad,
    triangles: tris(body.geometry) + tris(icons) + 7 * 2 + 2 + tris(ballB.geometry) + tris(pad),
  };
  kioskCache.set(key, a);
  return a;
}

// ------------------------------------------------------------------------------------------------ pickups
export interface PickupAssets {
  /** Core crystal (glow) and its gyroscope cage rings (toon). */
  crystal: THREE.BufferGeometry;
  ring: Built;
  pedestal: Built;
  /** One countdown pip (instanced 12× around the pedestal). */
  pip: THREE.BufferGeometry;
  /** Flat ground glow ring (unit radius, scaled). */
  halo: THREE.BufferGeometry;
  kibble: THREE.BufferGeometry;
  sparkle: THREE.BufferGeometry;
  squeaker: Built;
  /** Objective marker: a downward chevron and a thin light pillar (unit height). */
  chevron: THREE.BufferGeometry;
  pillar: THREE.BufferGeometry;
}

let pickupCache: PickupAssets | null = null;

export function pickupAssets(): PickupAssets {
  if (pickupCache) return pickupCache;
  const crystal = new THREE.OctahedronGeometry(0.26, 0);
  crystal.scale(1, 1.35, 1);

  const rb = new PartBuilder();
  rb.add(torus(0.44, 0.035, 5, 24), at(0, 0, 0), PALETTE.hullDark, false);
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) rb.add(ball(0.055, 8, 6), at(Math.cos(a) * 0.44, Math.sin(a) * 0.44, 0), PALETTE.accentHot);
  const ring = rb.build();

  const pe = new PartBuilder();
  pe.add(cyl(0.5, 0.6, 0.16, 20), at(0, 0.08, 0), PALETTE.hullDark, true);
  pe.add(cyl(0.34, 0.4, 0.08, 20), at(0, 0.2, 0), PALETTE.concrete, true);
  pe.add(torus(0.56, 0.03, 4, 24), at(0, 0.16, 0, Math.PI / 2), PALETTE.accentHot);
  const pedestal = pe.build();

  const pip = new THREE.BoxGeometry(0.1, 0.05, 0.16);
  const halo = new THREE.TorusGeometry(1, 0.03, 3, 40);
  halo.rotateX(Math.PI / 2);

  // Golden Kibble: a chunky bone-shaped biscuit (the classic dog treat) with a baked rim and two dimples.
  const kb = new PartBuilder();
  const gold = PALETTE.accentHot, crust = PALETTE.teamCorgisTrim, dimple = PALETTE.accent;
  kb.add(rbox(0.36, 0.15, 0.13, 0.05, 2), at(0, 0, 0), gold);
  // (8×6 knobs and 6×4 dimples: a kibble is ~0.45 m across, so the old 12×8 spheres were 1 132 triangles a piece for
  //  no visible gain; up to 22 on screen at once, Q2 P2-5)
  for (const e of [-1, 1]) for (const k of [-1, 1]) kb.add(ball(0.1, 8, 6), at(e * 0.2, k * 0.068, 0, 0, 0, 0, 1, 1, 0.72), crust);
  for (const e of [-1, 1]) kb.add(ball(0.028, 6, 4), at(e * 0.07, 0.005, -0.062, 0, 0, 0, 1, 1, 0.4), dimple);
  const kibble = kb.build().geometry;
  kibble.scale(1.25, 1.25, 1.25);

  // Sparkle: a 4-point star (two squashed octahedra).
  const sp = new THREE.OctahedronGeometry(0.1, 0);
  sp.scale(0.35, 1.3, 0.12);
  const sp2 = new THREE.OctahedronGeometry(0.1, 0);
  sp2.scale(1.3, 0.35, 0.12);
  const sparkle = mergeSimple([sp, sp2]);

  // Squeaker: rubber bone + squeak nub (the squad's toy the cats stole).
  const sq = new PartBuilder();
  const red = PALETTE.teamCorgis, yellow = PALETTE.accentHot; // the squad's own toy: corgi blue + gold
  sq.add(cyl(0.11, 0.11, 0.62, 12), at(0, 0, 0, 0, 0, Math.PI / 2), red);
  for (const e of [-1, 1]) for (const k of [-1, 1]) sq.add(ball(0.13, 12, 8), at(e * 0.33, k * 0.09, 0), red);
  sq.add(cyl(0.06, 0.07, 0.06, 10), at(0, 0.13, 0), yellow, true);
  const squeaker = sq.build();

  const chevron = new THREE.ConeGeometry(0.34, 0.5, 4);
  chevron.rotateX(Math.PI);
  chevron.scale(1, 1, 0.35);
  const pillar = new THREE.CylinderGeometry(0.06, 0.06, 1, 6);
  pillar.translate(0, 0.5, 0);

  pickupCache = { crystal, ring, pedestal, pip, halo, kibble, sparkle, squeaker, chevron, pillar };
  return pickupCache;
}

/** Merge non-indexed-compatible simple geometries (position + normal only). */
function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
    if (g !== g0) g.dispose();
    g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

export function releaseInteractAssets(): void {
  for (const a of kioskCache.values()) {
    a.body.geometry.dispose(); a.body.lines?.dispose(); a.icons.dispose(); a.tile.dispose(); a.screen.dispose();
    a.ball.geometry.dispose(); a.ball.lines?.dispose(); a.pad.dispose();
  }
  kioskCache.clear();
  if (pickupCache) {
    const p = pickupCache;
    for (const g of [p.crystal, p.pip, p.halo, p.kibble, p.sparkle, p.chevron, p.pillar, p.ring.geometry, p.pedestal.geometry, p.squeaker.geometry]) g.dispose();
    for (const l of [p.ring.lines, p.pedestal.lines, p.squeaker.lines]) l?.dispose();
    pickupCache = null;
  }
}
